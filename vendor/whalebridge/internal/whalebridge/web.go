package whalebridge

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/yetone/magpie/internal/appdir"
	"github.com/yetone/magpie/internal/catalog"
	"github.com/yetone/magpie/internal/davsync"
	"github.com/yetone/magpie/internal/edit"
	"github.com/yetone/magpie/internal/gateway"
	"github.com/yetone/magpie/internal/netproxy"
	"github.com/yetone/magpie/internal/provider"
	"github.com/yetone/magpie/internal/sessions"
	"github.com/yetone/magpie/internal/settings"
	"github.com/yetone/magpie/internal/usage"
)

//go:embed assets/*
var assets embed.FS
var mutations sync.Mutex

func secret() (string, error) {
	b := make([]byte, 16)
	_, err := rand.Read(b)
	return hex.EncodeToString(b), err
}
func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}
func decode(w http.ResponseWriter, r *http.Request, v any) error {
	return json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(v)
}

// Run binds both listeners before publishing readiness or registering the DSH
// route. Subscription maintenance runs here; client installers, native account
// switching, session scans and the LAN listener are excluded.
func Run(version string) error {
	if os.Getenv("LAUNCHER_COMPONENT_DATA_DIR") == "" || os.Getenv("WHALEBRIDGE_DSH_HOME") == "" {
		return fmt.Errorf("请从鲸屿启动器安装并打开鲸桥")
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if err := os.MkdirAll(appdir.Config(), 0700); err != nil {
		return err
	}
	keyFile := filepath.Join(appdir.Config(), "gateway.key")
	stored, err := os.ReadFile(keyFile)
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	token := strings.TrimSpace(string(stored))
	if os.IsNotExist(err) {
		token, err = secret()
		if err != nil {
			return err
		}
		if err = edit.WriteAtomic(keyFile, []byte(token)); err != nil {
			return err
		}
	}
	if decoded, err := hex.DecodeString(token); err != nil || len(decoded) != 16 {
		return fmt.Errorf("鲸桥网关密钥文件无效")
	}
	os.Setenv("WHALEBRIDGE_GATEWAY_TOKEN", token)
	key, err := secret()
	if err != nil {
		return err
	}
	netproxy.Install()
	gateway.Version = version
	usage.Agents = func() []usage.Known {
		return []usage.Known{{ID: "dsh", Names: []string{"dsh", "deepseek-harness"}, UA: []string{"deepseek-harness"}}}
	}
	// Supplier accounting covers calls served by this component. Native
	// client session discovery is outside WhaleBridge's management scope.
	usage.LogCalls = func(time.Time) []sessions.Call { return nil }
	s := settings.Load()
	if s.OTel.Sessions {
		s.OTel.Sessions = false
		if err := settings.Save(s); err != nil {
			return err
		}
	}
	g, err := net.Listen("tcp", gateway.Addr())
	if err != nil {
		return fmt.Errorf("鲸桥网关端口不可用: %w", err)
	}
	defer g.Close()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return err
	}
	defer listener.Close()
	if err := syncDSH(); err != nil {
		return err
	}
	stopCatalogSync := watchDSHCatalog(ctx)
	defer stopCatalogSync()
	server := gateway.New()
	stopOTel := usage.StartOTel()
	defer stopOTel()
	gateway.ArchiveBucket = func() (gateway.Putter, bool) { b, ok := davsync.S3Bucket(); return b, ok }
	go davsync.Run(ctx)
	failures := make(chan error, 2)
	go func() {
		failures <- (&http.Server{Handler: server.Handler(), ReadHeaderTimeout: 30 * time.Second}).Serve(g)
	}()
	origin := "http://" + listener.Addr().String()
	cookieName := "magpie_web_" + strings.Split(listener.Addr().String(), ":")[1]
	mux := http.NewServeMux()
	accountRoutes(mux)
	mux.HandleFunc("GET /api/whalebridge/status", func(w http.ResponseWriter, r *http.Request) {
		models, _ := provider.CatalogFor("dsh")
		writeJSON(w, map[string]any{"models": len(models), "defaultModel": isDefault(), "version": version, "gateway": gateway.URL(), "pid": os.Getpid(), "catalog": catalog.Status(), "syncError": dshSyncError()})
	})
	mux.HandleFunc("POST /api/whalebridge/maintenance", func(w http.ResponseWriter, r *http.Request) {
		var b struct {
			On bool `json:"on"`
		}
		if err := decode(w, r, &b); err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		active, ok := server.WhaleBridgeMaintenance(b.On)
		if !ok {
			http.Error(w, "DSH 有正在生成的回复，请完成后再操作", 409)
			return
		}
		writeJSON(w, map[string]any{"active": active})
	})
	mux.HandleFunc("GET /api/state", stateHandler(version))
	providerRoutes(mux, server)
	globalRoutes(mux, server, version)
	mux.HandleFunc("GET /api/usage", func(w http.ResponseWriter, r *http.Request) {
		period := usage.Period(r.URL.Query().Get("period"))
		switch period {
		case "":
			period = usage.Today
		case usage.Today, usage.Week, usage.Month, usage.All:
		default:
			http.Error(w, "未知用量周期", http.StatusBadRequest)
			return
		}
		writeJSON(w, usage.Summarize(period))
	})
	mux.HandleFunc("POST /api/provider", mutate(func(w http.ResponseWriter, r *http.Request) error {
		_, err := saveProvider(r)
		return err
	}))
	mux.HandleFunc("POST /api/provider/delete", mutate(func(w http.ResponseWriter, r *http.Request) error {
		var b struct {
			ID string `json:"id"`
		}
		if err := decode(w, r, &b); err != nil {
			return err
		}
		return provider.Delete(b.ID)
	}))
	mux.HandleFunc("POST /api/provider/fetch", mutate(func(w http.ResponseWriter, r *http.Request) error {
		var b struct {
			ID string `json:"id"`
		}
		if err := decode(w, r, &b); err != nil {
			return err
		}
		p, err := provider.Find(b.ID)
		if err != nil {
			return err
		}
		_, _, err = p.Refetch(r.Context())
		return err
	}))
	mux.HandleFunc("POST /api/models/hidden", mutate(func(w http.ResponseWriter, r *http.Request) error {
		var b struct {
			IDs    []string `json:"ids"`
			ID     string   `json:"id"`
			Hidden *bool    `json:"hidden"`
		}
		if err := decode(w, r, &b); err != nil {
			return err
		}
		if b.Hidden != nil {
			if b.ID != "" {
				b.IDs = append(b.IDs, b.ID)
			}
			if len(b.IDs) == 0 {
				return fmt.Errorf("缺少模型 ID")
			}
			ids := provider.HiddenModels("dsh")
			for _, id := range b.IDs {
				if strings.TrimSpace(id) == "" {
					return fmt.Errorf("缺少模型 ID")
				}
				if *b.Hidden {
					ids[id] = true
				} else {
					delete(ids, id)
				}
			}
			b.IDs = make([]string, 0, len(ids))
			for id := range ids {
				b.IDs = append(b.IDs, id)
			}
		}
		return provider.SetHiddenModels("dsh", b.IDs)
	}))
	mux.HandleFunc("POST /api/group", mutate(func(w http.ResponseWriter, r *http.Request) error {
		var b struct {
			provider.Group
			From string `json:"from"`
		}
		if err := decode(w, r, &b); err != nil {
			return err
		}
		to := strings.ToLower(strings.TrimSpace(b.ID))
		from := strings.ToLower(strings.TrimSpace(b.From))
		if to == "" || to != provider.GroupSlug(to) {
			return fmt.Errorf("路由 ID 只能包含小写字母、数字、点和连字符")
		}
		if from != to {
			taken, err := provider.GroupIDTaken(to)
			if err != nil {
				return err
			}
			if taken {
				return fmt.Errorf("路由 ID %q 已被使用，请选择其他 ID", to)
			}
		}
		if from == "" {
			b.ID = to
			return provider.SaveGroup(b.Group)
		}
		found := false
		for _, g := range provider.Groups() {
			if g.ID == from && !g.Hidden {
				found = true
				break
			}
		}
		if !found {
			return fmt.Errorf("原路由组 %q 已不存在，请刷新后再编辑", from)
		}
		b.ID = from
		if err := provider.SaveGroup(b.Group); err != nil {
			return err
		}
		return provider.RenameGroup(from, to)
	}))
	mux.HandleFunc("POST /api/group/delete", mutate(func(w http.ResponseWriter, r *http.Request) error {
		var b struct {
			ID  string   `json:"id"`
			IDs []string `json:"ids"`
		}
		if err := decode(w, r, &b); err != nil {
			return err
		}
		if b.ID != "" {
			b.IDs = append(b.IDs, b.ID)
		}
		if len(b.IDs) == 0 {
			return fmt.Errorf("请选择路由组")
		}
		for _, id := range b.IDs {
			if err := provider.DeleteGroup(id); err != nil {
				return err
			}
		}
		return nil
	}))
	mux.HandleFunc("POST /api/group/order", mutate(func(w http.ResponseWriter, r *http.Request) error {
		var b struct {
			Order []string `json:"order"`
		}
		if err := decode(w, r, &b); err != nil {
			return err
		}
		return provider.SetGroupOrder(b.Order)
	}))
	mux.HandleFunc("POST /api/dsh/sync", mutate(func(w http.ResponseWriter, r *http.Request) error { return nil }))
	mux.HandleFunc("POST /api/catalog/refresh", mutate(func(w http.ResponseWriter, r *http.Request) error { return catalog.Sync(r.Context()) }))
	sub, _ := fs.Sub(assets, "assets")
	mux.Handle("/", http.FileServer(http.FS(sub)))
	auth := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; frame-ancestors 'none'")
		if r.Host != listener.Addr().String() {
			http.Error(w, "无效访问地址", 403)
			return
		}
		if k := r.URL.Query().Get("k"); k != "" && subtle.ConstantTimeCompare([]byte(k), []byte(key)) == 1 {
			http.SetCookie(w, &http.Cookie{Name: cookieName, Value: key, Path: "/", HttpOnly: true, SameSite: http.SameSiteStrictMode})
			http.Redirect(w, r, "/", 303)
			return
		}
		c, err := r.Cookie(cookieName)
		if err != nil || subtle.ConstantTimeCompare([]byte(c.Value), []byte(key)) != 1 {
			http.Error(w, "请从启动器打开鲸桥", 401)
			return
		}
		if r.Method != "GET" && r.Method != "HEAD" {
			if o := r.Header.Get("Origin"); o != "" && o != origin {
				http.Error(w, "无效请求来源", 403)
				return
			}
			if !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
				http.Error(w, "需要 JSON 请求", 415)
				return
			}
		}
		mux.ServeHTTP(w, r)
	})
	state := map[string]any{"id": "whalebridge", "pid": os.Getpid(), "url": origin + "/?k=" + key, "gateway": gateway.URL(), "version": version, "ready": true}
	bytes, _ := json.Marshal(state)
	if err := edit.WriteAtomic(filepath.Join(appdir.Config(), "state.json"), bytes); err != nil {
		return err
	}
	defer os.Remove(filepath.Join(appdir.Config(), "state.json"))
	go func() { failures <- (&http.Server{Handler: auth, ReadHeaderTimeout: 10 * time.Second}).Serve(listener) }()
	go provider.StartModelRefresh(ctx)
	gateway.StartWhaleBridgeSubscriptions(ctx)
	return <-failures
}

func stateHandler(version string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err := provider.FileError(); err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		suppliers := []map[string]any{}
		modelSuppliers := map[string]map[string]string{}
		for _, p := range provider.All() {
			available := p.Available()
			modelSuppliers[p.ID] = map[string]string{}
			for _, m := range available {
				modelSuppliers[p.ID][m.ID] = modelSupplier(m.ID, m.Provider)
			}
			suppliers = append(suppliers, supplierInfo(p))
		}
		shown, hidden := provider.CatalogFor("dsh")
		removed := []map[string]any{}
		for _, p := range provider.Hidden() {
			row := supplierInfo(p)
			row["hidden"], row["quiet"], row["tucked"] = true, p.Quiet, p.Tucked
			removed = append(removed, row)
		}
		s := settings.Load()
		writeJSON(w, map[string]any{"version": version, "gateway": gateway.URL(), "providers": suppliers, "removed": removed, "excluded": provider.Excluded(), "presets": provider.Presets(), "models": settingsModels(shown, modelSuppliers), "hidden": settingsModels(hidden, modelSuppliers), "groups": provider.Groups(), "defaultModel": isDefault(), "catalog": catalog.Status(), "syncError": dshSyncError(), "chineseUnits": s.ChineseUnits, "quotaLeft": s.QuotaLeft})
	}
}

type settingsModel struct {
	provider.Entry
	ChannelID    string `json:"channelId"`
	ChannelName  string `json:"channelName"`
	SupplierID   string `json:"supplierId"`
	SupplierName string `json:"supplierName"`
	CanFast      bool   `json:"canFast,omitempty"`
}

// Relay catalogs label every model with the relay (for example Cursor), not
// its maker. Known model families provide the second grouping level there.
func modelSupplier(id, listed string) string {
	id = strings.ToLower(id)
	if _, bare, ok := strings.Cut(id, "/"); ok {
		id = bare
	}
	id = strings.TrimPrefix(id, "cursor-")
	for _, family := range []struct{ prefix, supplier string }{
		{"gpt-", "openai"}, {"chatgpt-", "openai"}, {"o1", "openai"}, {"o3", "openai"}, {"o4", "openai"},
		{"claude-", "anthropic"}, {"gemini-", "google"}, {"grok-", "xai"}, {"composer-", "cursor"},
		{"deepseek-", "deepseek"}, {"qwen", "alibaba"}, {"glm-", "zhipuai"}, {"kimi-", "moonshotai"},
		{"minimax-", "minimax"}, {"mimo-", "xiaomi"}, {"doubao-", "bytedance"},
		{"muse-spark-", "meta"}, {"hy3", "tencent"}, {"hy4-", "tencent"},
	} {
		if strings.HasPrefix(id, family.prefix) {
			return family.supplier
		}
	}
	return listed
}

// Only settings receive source labels; gateway and DSH model IDs stay unchanged.
func settingsModels(entries []provider.Entry, sources map[string]map[string]string) []settingsModel {
	rows := make([]settingsModel, 0, len(entries))
	for _, e := range entries {
		row := settingsModel{Entry: e, ChannelID: e.Provider.ID, ChannelName: e.Provider.Name}
		row.CanFast = e.Group == "" && provider.CanFast(e.Provider, e.Model)
		if e.Group != "" {
			row.ChannelID, row.ChannelName = "group", "路由组"
			row.SupplierID, row.SupplierName = "group", "组合模型"
		} else {
			row.SupplierID = modelSupplier(e.Model, sources[e.Provider.ID][e.Model])
			if row.SupplierID == "" {
				row.SupplierID, row.SupplierName = e.Provider.ID, e.Provider.Name
			} else {
				row.SupplierName = catalog.ProviderName(row.SupplierID)
				if pr := provider.Preset(row.SupplierID); row.SupplierName == "" && pr != nil {
					row.SupplierName = pr.Name
				}
				if row.SupplierName == "" {
					row.SupplierName = row.SupplierID
				}
			}
		}
		rows = append(rows, row)
	}
	return rows
}

// Header values can be credentials: the UI sees names only and patches filled
// values. A nil value explicitly removes a header; omitted values stay intact.
func patchHeaders(p *provider.Provider, changes map[string]*string) error {
	for raw, value := range changes {
		name := strings.TrimSpace(raw)
		if name == "" || strings.IndexFunc(name, func(r rune) bool {
			return r > 127 || !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || strings.ContainsRune("!#$%&'*+-.^_`|~", r))
		}) >= 0 {
			return fmt.Errorf("HTTP Header 名称无效")
		}
		if value != nil && strings.ContainsAny(*value, "\r\n") {
			return fmt.Errorf("HTTP Header 值不能包含换行")
		}
		if value != nil && strings.TrimSpace(*value) == "" {
			continue
		}
		for existing := range p.Headers {
			if strings.EqualFold(existing, name) {
				delete(p.Headers, existing)
			}
		}
		if value != nil {
			if p.Headers == nil {
				p.Headers = map[string]string{}
			}
			p.Headers[name] = strings.TrimSpace(*value)
		}
	}
	return nil
}

func syncConfiguration() error {
	mutations.Lock()
	defer mutations.Unlock()
	return syncDSH()
}

var catalogSyncState struct {
	sync.Mutex
	err string
}

func dshSyncError() string {
	catalogSyncState.Lock()
	defer catalogSyncState.Unlock()
	return catalogSyncState.err
}

// Background supplier refreshes and automatic cloud sync also change the
// DSH model list. Queue the callback because provider writes can occur inside
// an API mutation; the worker then sees the latest atomically stored catalog.
func watchDSHCatalog(ctx context.Context) func() {
	wake := make(chan struct{}, 1)
	previous := catalog.Changed
	catalog.Changed = func() {
		if previous != nil {
			previous()
		}
		select {
		case wake <- struct{}{}:
		default:
		}
	}
	go func() {
		for {
			select {
			case <-ctx.Done():
				return
			case <-wake:
				err := syncConfiguration()
				catalogSyncState.Lock()
				catalogSyncState.err = ""
				if err != nil {
					catalogSyncState.err = err.Error()
					log.Printf("鲸桥后台 DSH 同步失败: %v", err)
				}
				catalogSyncState.Unlock()
			}
		}
	}()
	return func() { catalog.Changed = previous }
}
func mutate(fn func(http.ResponseWriter, *http.Request) error) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		mutations.Lock()
		defer mutations.Unlock()
		if err := fn(w, r); err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		if err := syncDSH(); err != nil {
			http.Error(w, "配置已保存，但 DSH 渠道同步失败: "+err.Error(), 500)
			return
		}
		writeJSON(w, map[string]any{"ok": true})
	}
}
