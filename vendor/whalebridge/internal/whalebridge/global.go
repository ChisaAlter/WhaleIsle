package whalebridge

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/yetone/magpie/internal/backup"
	"github.com/yetone/magpie/internal/catalog"
	"github.com/yetone/magpie/internal/davsync"
	"github.com/yetone/magpie/internal/fx"
	"github.com/yetone/magpie/internal/gateway"
	"github.com/yetone/magpie/internal/provider"
	"github.com/yetone/magpie/internal/settings"
	"github.com/yetone/magpie/internal/usage"
)

var globalSettingKeys = strings.Fields("proxy currency chineseUnits searcher searchFirst vision imageGen redact redactPersonal redactWords redactRules plainNames plainOwnNames memberModel fullContext compactAt quotaLeft usageAlert balanceAlert resetReminder requestArchive requestArchiveMaxMB")

func globalState() map[string]any {
	s := settings.Load()
	b, _ := json.Marshal(s)
	all := map[string]any{}
	_ = json.Unmarshal(b, &all)
	out := map[string]any{}
	for _, k := range globalSettingKeys {
		out[k] = all[k]
	}
	names := []string{}
	for k := range s.OTel.Headers {
		names = append(names, k)
	}
	sort.Strings(names)
	out["otel"] = map[string]any{"enabled": s.OTel.Enabled, "endpoint": s.OTel.Endpoint, "metrics": s.OTel.Metrics, "bodies": s.OTel.Bodies, "bodiesWhole": s.OTel.BodiesWhole, "headerNames": names}
	searches := []map[string]any{}
	for _, a := range provider.StoredSearchAPIs() {
		searches = append(searches, map[string]any{"vendor": a.Vendor, "name": a.Name(), "url": a.URL, "keySet": a.Key != "", "keyMasked": provider.Mask(a.Key), "ready": a.Ready()})
	}
	searchVendors := []map[string]any{}
	for _, v := range provider.SearchVendors {
		searchVendors = append(searchVendors, map[string]any{"id": v.ID, "name": v.Name, "base": v.Base, "keysURL": v.KeysURL})
	}
	searchers := []map[string]any{}
	for _, c := range gateway.Searchers() {
		models := []map[string]string{}
		for _, m := range c.Models {
			name := m.Name
			if name == "" {
				name = m.ID
			}
			models = append(models, map[string]string{"id": c.Provider.ID + "/" + m.ID, "name": name})
		}
		searchers = append(searchers, map[string]any{"id": c.Provider.ID, "name": c.Provider.Name, "small": c.Small, "models": models})
	}
	visionModels := []map[string]string{}
	for _, m := range provider.Served() {
		if m.Images && (m.ImageInput == nil || *m.ImageInput) {
			visionModels = append(visionModels, map[string]string{"id": m.ID, "name": m.Name})
		}
	}
	drawingModels := []map[string]string{}
	for _, p := range provider.All() {
		if !p.On() || p.DecideOnly() {
			continue
		}
		for _, m := range gateway.Drawers(p) {
			name := m.Name
			if name == "" {
				name = m.ID
			}
			drawingModels = append(drawingModels, map[string]string{"id": p.ID + "/" + m.ID, "name": p.Name + " · " + name})
		}
	}
	unresolved := func(id string) bool {
		if id == "" || id == "off" {
			return false
		}
		_, _, ok := provider.Resolve(id)
		return !ok
	}
	models, _ := provider.CatalogFor("dsh")
	rate := fx.Soon()
	fxAt := ""
	if !rate.At.IsZero() {
		fxAt = rate.At.Format(time.RFC3339)
	}
	return map[string]any{"settings": out, "searchVendors": searchVendors, "searches": searches, "searchers": searchers, "autoSearcher": gateway.AutoSearcher(), "searcher": gateway.Searcher(), "searcherUnused": gateway.SearcherUnused(), "visionModels": visionModels, "drawingModels": drawingModels, "autoVision": gateway.AutoVision(), "autoDrawer": gateway.AutoDrawer(), "visionUnused": unresolved(s.Vision), "imageGenUnused": unresolved(s.ImageGen), "models": models, "fx": map[string]any{"rate": rate.CNYPerUSD, "at": fxAt, "stale": rate.Stale()}, "sync": davsync.Status(), "modelPrices": s.ModelPrices}
}

// Settings patches preserve omitted fields and never send saved authorization
// headers to the initial page. A null header removes it; an empty edit keeps it.
func saveGlobalSettings(r *http.Request) error {
	in, err := readProviderBody(r)
	if err != nil {
		return err
	}
	s := settings.Load()
	b, _ := json.Marshal(s)
	merged := map[string]json.RawMessage{}
	_ = json.Unmarshal(b, &merged)
	for _, k := range globalSettingKeys {
		if v, ok := in[k]; ok {
			merged[k] = v
		}
	}
	b, _ = json.Marshal(merged)
	if err := json.Unmarshal(b, &s); err != nil {
		return err
	}
	if raw, ok := in["otel"]; ok {
		var patch map[string]json.RawMessage
		if err := json.Unmarshal(raw, &patch); err != nil {
			return err
		}
		old, _ := json.Marshal(s.OTel)
		values := map[string]json.RawMessage{}
		_ = json.Unmarshal(old, &values)
		for _, k := range strings.Fields("enabled endpoint metrics bodies bodiesWhole") {
			if v, ok := patch[k]; ok {
				values[k] = v
			}
		}
		data, _ := json.Marshal(values)
		if err := json.Unmarshal(data, &s.OTel); err != nil {
			return err
		}
		if h, ok := patch["headers"]; ok {
			var headers map[string]*string
			if err := json.Unmarshal(h, &headers); err != nil {
				return err
			}
			if s.OTel.Headers == nil {
				s.OTel.Headers = map[string]string{}
			}
			for k, v := range headers {
				if v == nil {
					delete(s.OTel.Headers, k)
				} else if *v != "" {
					s.OTel.Headers[k] = *v
				}
			}
		}
	}
	s.OTel.Sessions = false
	if s.RequestArchive {
		if _, ok := davsync.S3Bucket(); !ok {
			return fmt.Errorf("请先配置 S3 同步，再开启请求归档")
		}
	}
	if err := settings.Save(s); err != nil {
		return err
	}
	gateway.WakeWhaleBridgeQuotaAlerts()
	return nil
}

func requestFilter(r *http.Request) usage.Filter {
	q := r.URL.Query()
	id, _ := strconv.ParseInt(q.Get("route"), 10, 64)
	return usage.Filter{Day: q.Get("day"), RouteID: id, Model: q.Get("model"), Provider: q.Get("provider"), Purpose: q.Get("purpose"), Account: q.Get("account"), Failed: q.Get("failed") == "1", Query: q.Get("q"), Computer: q.Get("computer")}
}
func usagePeriod(r *http.Request) usage.Period {
	p := usage.Period(r.URL.Query().Get("period"))
	for _, v := range usage.Periods {
		if p == v {
			return p
		}
	}
	return usage.Month
}
func globalRoutes(mux *http.ServeMux, server *gateway.Server, version string) {
	mux.HandleFunc("POST /api/group/switch", mutate(func(w http.ResponseWriter, r *http.Request) error {
		var in struct {
			ID  string `json:"id"`
			Off bool   `json:"off"`
		}
		if err := decode(w, r, &in); err != nil {
			return err
		}
		return provider.SwitchGroup(in.ID, !in.Off)
	}))
	mux.HandleFunc("POST /api/group/match", func(w http.ResponseWriter, r *http.Request) {
		var g provider.Group
		if err := decode(w, r, &g); err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		patterns, err := provider.CleanPatterns(g.Match)
		if err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		g.Match = patterns
		matched := []string{}
		for _, e := range provider.Catalog() {
			if e.Group != "" {
				continue
			}
			for _, p := range patterns {
				if provider.PatternMatches(p, e.ID) {
					matched = append(matched, e.ID)
					break
				}
			}
		}
		writeJSON(w, map[string]any{"hits": provider.PatternHits(g), "matched": matched})
	})
	mux.HandleFunc("GET /api/subscriptions/alerts", func(w http.ResponseWriter, r *http.Request) {
		after, _ := strconv.ParseInt(r.URL.Query().Get("after"), 10, 64)
		writeJSON(w, gateway.WhaleBridgeAlerts(after))
	})
	mux.HandleFunc("POST /api/subscriptions/alerts/claim", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, gateway.ClaimWhaleBridgeAlerts())
	})
	mux.HandleFunc("GET /api/global", func(w http.ResponseWriter, r *http.Request) { writeJSON(w, globalState()) })
	mux.HandleFunc("POST /api/global/settings", mutate(func(w http.ResponseWriter, r *http.Request) error { return saveGlobalSettings(r) }))
	mux.HandleFunc("POST /api/search/save", mutate(func(w http.ResponseWriter, r *http.Request) error {
		var a provider.SearchAPI
		if err := decode(w, r, &a); err != nil {
			return err
		}
		return provider.SetSearchAPI(a)
	}))
	mux.HandleFunc("POST /api/search/delete", mutate(func(w http.ResponseWriter, r *http.Request) error {
		var a struct{ Vendor string }
		if err := decode(w, r, &a); err != nil {
			return err
		}
		return provider.RemoveSearchAPI(a.Vendor)
	}))
	mux.HandleFunc("GET /api/search/key", func(w http.ResponseWriter, r *http.Request) {
		for _, a := range provider.StoredSearchAPIs() {
			if a.Vendor == r.URL.Query().Get("vendor") {
				writeJSON(w, map[string]string{"key": a.Key})
				return
			}
		}
		http.Error(w, "搜索服务不存在", 404)
	})
	mux.HandleFunc("POST /api/model-price", mutate(func(w http.ResponseWriter, r *http.Request) error {
		var b struct {
			ID    string
			Price *catalog.Price
		}
		if err := decode(w, r, &b); err != nil {
			return err
		}
		if !strings.HasPrefix(b.ID, "*/") {
			return fmt.Errorf("统一价格使用 */模型 ID")
		}
		return provider.SetModelPrice(b.ID, b.Price)
	}))
	mux.HandleFunc("GET /api/requests", func(w http.ResponseWriter, r *http.Request) {
		offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
		if offset < 0 {
			offset = 0
		}
		writeJSON(w, usage.QueryPage(usagePeriod(r), requestFilter(r), offset, 50))
	})
	mux.HandleFunc("GET /api/requests/export", func(w http.ResponseWriter, r *http.Request) {
		rows := usage.LedgerOf(usagePeriod(r), requestFilter(r))
		w.Header().Set("Content-Type", "text/csv; charset=utf-8")
		w.Header().Set("Content-Disposition", `attachment; filename="whalebridge-requests-`+time.Now().Format(time.DateOnly)+`.csv"`)
		_ = usage.WriteCSV(w, rows.Rows)
	})
	mux.HandleFunc("GET /api/routes", func(w http.ResponseWriter, r *http.Request) { writeJSON(w, server.Trace(r.Context(), 0, 0)) })
	mux.HandleFunc("GET /api/routes/history", func(w http.ResponseWriter, r *http.Request) {
		day := r.URL.Query().Get("day")
		if day != "" {
			if _, err := time.Parse(time.DateOnly, day); err != nil {
				http.Error(w, "日期格式应为 YYYY-MM-DD", 400)
				return
			}
		}
		days, routes, cut := gateway.History(day)
		writeJSON(w, map[string]any{"days": days, "routes": routes, "cut": cut})
	})
	mux.HandleFunc("POST /api/backup/export", func(w http.ResponseWriter, r *http.Request) {
		var in struct {
			Pass string
			Keys bool
		}
		if err := decode(w, r, &in); err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		b, err := backup.Collect(in.Keys, version)
		if err == nil {
			var data []byte
			data, err = backup.Seal(b, in.Pass)
			if err == nil {
				w.Header().Set("Content-Type", "application/octet-stream")
				w.Header().Set("Content-Disposition", `attachment; filename="whalebridge-`+time.Now().Format(time.DateOnly)+backup.Ext+`"`)
				w.Write(data)
				return
			}
		}
		http.Error(w, err.Error(), 400)
	})
	mux.HandleFunc("POST /api/backup/import", mutate(func(w http.ResponseWriter, r *http.Request) error {
		var in struct {
			Data, Pass          string
			Providers, Settings bool
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<20)).Decode(&in); err != nil {
			return err
		}
		data, err := base64.StdEncoding.DecodeString(in.Data)
		if err != nil {
			return err
		}
		b, err := backup.Open(data, in.Pass)
		if err != nil {
			return err
		}
		if !in.Providers && !in.Settings {
			return fmt.Errorf("请选择至少一项恢复内容")
		}
		_, err = backup.Restore(b, backup.Parts{Providers: in.Providers, Settings: in.Settings})
		return err
	}))
	mux.HandleFunc("POST /api/sync/{action}", func(w http.ResponseWriter, r *http.Request) {
		var err error
		switch r.PathValue("action") {
		case "save":
			var c davsync.Config
			if err = decode(w, r, &c); err == nil {
				c.Agents = false
				no := false
				c.Library = &no
				err = davsync.Configure(c)
			}
			if err == nil {
				err = davsync.SyncNow(r.Context())
			}
		case "now":
			err = davsync.SyncNow(r.Context())
		case "off":
			err = davsync.Off()
		case "dismiss":
			err = davsync.Dismiss()
		case "auto":
			var in struct{ Minutes int }
			if err = decode(w, r, &in); err == nil {
				err = davsync.SetAuto(in.Minutes)
			}
		case "restore":
			_, err = davsync.Restore(r.Context())
		case "undo":
			_, err = davsync.Undo()
		default:
			http.NotFound(w, r)
			return
		}
		if err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		if err = syncDSH(); err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		writeJSON(w, davsync.Status())
	})
	mux.HandleFunc("GET /api/archive/file", func(w http.ResponseWriter, r *http.Request) {
		name := r.URL.Query().Get("name")
		parts := strings.Split(name, "/")
		if len(parts) != 2 {
			http.Error(w, "归档名称无效", 400)
			return
		}
		if _, err := time.Parse(time.DateOnly, parts[0]); err != nil {
			http.Error(w, "归档日期无效", 400)
			return
		}
		object, valid := gateway.ArchiveName(parts[0], strings.TrimSuffix(parts[1], ".json"))
		if !valid {
			http.Error(w, "归档请求 ID 无效", 400)
			return
		}
		b, ok := davsync.S3Bucket()
		if !ok {
			http.Error(w, "尚未配置 S3 归档", 400)
			return
		}
		body, _, err := b.Open(r.Context(), object)
		if err != nil {
			http.Error(w, err.Error(), 502)
			return
		}
		defer body.Close()
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Content-Disposition", `attachment; filename="request-`+parts[1]+`"`)
		_, _ = io.Copy(w, body)
	})
}
