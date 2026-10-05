package whalebridge

import (
	"crypto/rand"
	"crypto/subtle"
	"embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"github.com/yetone/magpie/internal/appdir"
	"github.com/yetone/magpie/internal/catalog"
	"github.com/yetone/magpie/internal/edit"
	"github.com/yetone/magpie/internal/gateway"
	"github.com/yetone/magpie/internal/netproxy"
	"github.com/yetone/magpie/internal/provider"
	"github.com/yetone/magpie/internal/usage"
	"io/fs"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
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
// route. It starts no client installers, account-switching jobs, session scans,
// plugin updaters or LAN listener from Magpie's general-purpose server.
func Run(version string) error {
	if os.Getenv("LAUNCHER_COMPONENT_DATA_DIR") == "" || os.Getenv("WHALEBRIDGE_DSH_HOME") == "" {
		return fmt.Errorf("请从鲸屿启动器安装并打开鲸桥")
	}
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
	server := gateway.New()
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
		writeJSON(w, map[string]any{"models": len(models), "defaultModel": isDefault(), "version": version, "gateway": gateway.URL(), "pid": os.Getpid()})
	})
	mux.HandleFunc("POST /api/whalebridge/maintenance", func(w http.ResponseWriter, r *http.Request) {
		var b struct {
			On bool `json:"on"`
		}
		if err := decode(w, r, &b); err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		active, ok := gateway.WhaleBridgeMaintenance(b.On)
		if !ok {
			http.Error(w, "DSH 有正在生成的回复，请完成后再操作", 409)
			return
		}
		writeJSON(w, map[string]any{"active": active})
	})
	mux.HandleFunc("GET /api/state", func(w http.ResponseWriter, r *http.Request) {
		if err := provider.FileError(); err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		type supplier struct {
			ID         string          `json:"id"`
			Name       string          `json:"name"`
			Preset     string          `json:"preset"`
			Chat       string          `json:"chat"`
			Responses  string          `json:"responses"`
			Anthropic  string          `json:"anthropic"`
			KeySet     bool            `json:"keySet"`
			Models     []string        `json:"models"`
			Off        bool            `json:"off"`
			Routing    string          `json:"routing"`
			Proxy      string          `json:"proxy"`
			Fallback   []string        `json:"fallback"`
			Available  []catalog.Model `json:"available"`
			ModelCount int             `json:"modelCount"`
			Account    bool            `json:"account"`
		}
		suppliers := []supplier{}
		for _, p := range provider.All() {
			suppliers = append(suppliers, supplier{p.ID, p.Name, p.Preset, p.Chat, p.Responses, p.Anthropic, p.Key != "", p.Models, p.Off, p.Routing, p.Proxy, p.Fallback, p.Available(), len(p.Exposed()), p.Account != nil})
		}
		shown, hidden := provider.CatalogFor("dsh")
		writeJSON(w, map[string]any{"version": version, "gateway": gateway.URL(), "providers": suppliers, "presets": provider.Presets(), "models": shown, "hidden": hidden, "groups": provider.Groups(), "defaultModel": isDefault()})
	})
	mux.HandleFunc("GET /api/usage", func(w http.ResponseWriter, r *http.Request) {
		period := usage.Period(r.URL.Query().Get("period"))
		switch period {
		case usage.Today, usage.Week, usage.Month, usage.All:
		default:
			period = usage.Today
		}
		writeJSON(w, usage.Summarize(period))
	})
	mux.HandleFunc("POST /api/provider", mutate(func(w http.ResponseWriter, r *http.Request) error {
		var input struct {
			ID        string   `json:"id"`
			Preset    string   `json:"preset"`
			Name      string   `json:"name"`
			Chat      string   `json:"chat"`
			Responses string   `json:"responses"`
			Anthropic string   `json:"anthropic"`
			Key       *string  `json:"key"`
			Models    []string `json:"models"`
			Off       bool     `json:"off"`
			Routing   string   `json:"routing"`
			Proxy     string   `json:"proxy"`
			Fallback  []string `json:"fallback"`
		}
		if err := decode(w, r, &input); err != nil {
			return err
		}
		var p provider.Provider
		if input.ID != "" {
			old, err := provider.Find(input.ID)
			if err != nil {
				return err
			}
			p = *old
		} else if input.Preset != "" {
			var err error
			p, err = provider.FromPreset(input.Preset)
			if err != nil {
				return err
			}
		}
		p.Name, p.Chat, p.Responses, p.Anthropic = input.Name, input.Chat, input.Responses, input.Anthropic
		if input.Key != nil {
			p.Key = *input.Key
		}
		p.Models, p.Off, p.Routing, p.Proxy, p.Fallback = input.Models, input.Off, input.Routing, input.Proxy, input.Fallback
		if input.ID == "" {
			_, err := provider.Add(p)
			return err
		}
		return provider.Save(p)
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
			IDs []string `json:"ids"`
		}
		if err := decode(w, r, &b); err != nil {
			return err
		}
		return provider.SetHiddenModels("dsh", b.IDs)
	}))
	mux.HandleFunc("POST /api/group", mutate(func(w http.ResponseWriter, r *http.Request) error {
		var b provider.Group
		if err := decode(w, r, &b); err != nil {
			return err
		}
		return provider.SaveGroup(b)
	}))
	mux.HandleFunc("POST /api/group/delete", mutate(func(w http.ResponseWriter, r *http.Request) error {
		var b struct {
			ID string `json:"id"`
		}
		if err := decode(w, r, &b); err != nil {
			return err
		}
		return provider.DeleteGroup(b.ID)
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
	return <-failures
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
