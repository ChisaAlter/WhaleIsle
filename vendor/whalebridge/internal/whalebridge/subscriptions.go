package whalebridge

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/yetone/magpie/internal/plugin"
	"github.com/yetone/magpie/internal/provider"
	"github.com/yetone/magpie/internal/settings"
)

func subscriptionRoutes(mux *http.ServeMux) {
	adapterDiscoveryRoutes(mux)
	mux.HandleFunc("GET /api/subscription/adapters", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
		defer cancel()
		writeJSON(w, subscriptionAdapters(ctx))
	})
	mux.HandleFunc("POST /api/subscription/adapter", func(w http.ResponseWriter, r *http.Request) {
		var b struct {
			ID, Package, Action string
			Enabled             *bool
			Options             map[string]any
		}
		if err := decode(w, r, &b); err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		if b.Action == "" {
			b.Action = "install"
		}
		pkg := b.Package
		if pkg == "" {
			pkg = provider.MovePackage(b.ID)
		}
		if pkg == "" {
			for _, e := range plugin.Load().Plugins {
				if plugin.Name(e.Spec) == b.ID {
					pkg = e.Spec
					break
				}
			}
		}
		mutations.Lock()
		defer mutations.Unlock()
		ctx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), 10*time.Minute)
		defer cancel()
		var err error
		switch b.Action {
		case "update-all":
			err = plugin.Update(ctx)
		case "mirror":
			if b.Enabled == nil {
				err = fmt.Errorf("缺少镜像开关")
			} else {
				err = setAdapterMirror(*b.Enabled)
			}
		case "install":
			if pkg == "" {
				err = fmt.Errorf("缺少订阅适配器包名")
			} else {
				_, err = plugin.Add(ctx, pkg)
			}
		case "update":
			if pkg == "" {
				err = fmt.Errorf("缺少订阅适配器包名")
			} else {
				err = plugin.Upgrade(ctx, plugin.Name(pkg))
			}
		case "remove":
			if pkg == "" {
				err = fmt.Errorf("缺少订阅适配器包名")
			} else {
				err = provider.RemovePlugin(ctx, plugin.Name(pkg))
			}
		case "enable", "disable", "on", "off":
			if pkg == "" {
				err = fmt.Errorf("缺少订阅适配器包名")
			} else {
				err = provider.SetPluginOff(ctx, plugin.Name(pkg), b.Action == "disable" || b.Action == "off")
			}
		case "options":
			if pkg == "" {
				err = fmt.Errorf("缺少订阅适配器包名")
			} else {
				err = plugin.SetOptions(pkg, b.Options)
			}
		case "move":
			err = provider.Move(ctx, b.ID)
		case "adopt":
			err = provider.Adopt(ctx, b.ID)
		case "moveback":
			err = provider.MoveBack(ctx, b.ID)
		default:
			err = fmt.Errorf("未知订阅适配器操作")
		}
		if err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		if b.Action == "install" || b.Action == "update" || b.Action == "update-all" {
			for id, handErr := range provider.WhaleBridgeHandOver(ctx) {
				if handErr != nil {
					http.Error(w, "适配器已安装，但 "+id+" 交接失败: "+handErr.Error(), 500)
					return
				}
			}
		}
		if _, err = plugin.Providers(ctx); err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		provider.ForgetAccounts()
		if err = syncDSH(); err != nil {
			http.Error(w, "订阅适配器已更新，但 DSH 渠道同步失败: "+err.Error(), 500)
			return
		}
		writeJSON(w, map[string]bool{"ok": true})
	})
	mux.HandleFunc("GET /api/subscription/adapter/{id}/options", func(w http.ResponseWriter, r *http.Request) {
		for _, e := range plugin.Load().Plugins {
			if plugin.Name(e.Spec) == r.PathValue("id") {
				options := e.Options
				if options == nil {
					options = map[string]any{}
				}
				writeJSON(w, map[string]any{"options": options, "example": plugin.OptionsExample(plugin.Target(e.Spec))})
				return
			}
		}
		http.NotFound(w, r)
	})
	mux.HandleFunc("GET /api/subscription/settings", func(w http.ResponseWriter, r *http.Request) { writeJSON(w, subscriptionSettings()) })
	mux.HandleFunc("POST /api/subscription/settings", mutate(func(w http.ResponseWriter, r *http.Request) error {
		in, err := readProviderBody(r)
		if err != nil {
			return err
		}
		s := settings.Load()
		patch := map[string]json.RawMessage{}
		for _, k := range strings.Fields("codexWarmup claudeWarmup codexWarmAt claudeWarmAt workbuddyCheckin traeCheckin minimaxCheckin qoderCheckin pluginCheckins quotaLeft proxy usageAlert balanceAlert resetReminder chinaMirror") {
			if v, ok := in[k]; ok {
				patch[k] = v
			}
		}
		data, _ := json.Marshal(patch)
		if err := json.Unmarshal(data, &s); err != nil {
			return err
		}
		mirrorChanged := s.ChinaMirror != settings.Load().ChinaMirror
		if err := settings.Save(s); err != nil {
			return err
		}
		if mirrorChanged {
			plugin.RefreshMarket()
		}
		return nil
	}))
	mux.HandleFunc("POST /api/accounts/settings", mutate(func(w http.ResponseWriter, r *http.Request) error {
		var b struct {
			ID, User                     string
			CodexAutoReset, CodexCredits *bool
			CodexWarmAt                  *string
		}
		if err := decode(w, r, &b); err != nil {
			return err
		}
		if b.ID != "codex" {
			return fmt.Errorf("该设置仅适用于 ChatGPT / Codex 账号")
		}
		if strings.TrimSpace(b.User) == "" {
			return fmt.Errorf("缺少账号")
		}
		if b.CodexAutoReset != nil {
			if err := provider.SetCodexAutoReset(b.User, *b.CodexAutoReset); err != nil {
				return err
			}
		}
		if b.CodexCredits != nil {
			if err := provider.SetCodexCredits(b.User, *b.CodexCredits); err != nil {
				return err
			}
		}
		if b.CodexWarmAt != nil {
			if err := provider.SetCodexWarmAt(b.User, *b.CodexWarmAt); err != nil {
				return err
			}
		}
		return nil
	}))
	mux.HandleFunc("GET /api/accounts/{id}/usage", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
		defer cancel()
		id := r.PathValue("id")
		qs := provider.LoginUsage(ctx, id)
		if id == "cursor" && !provider.Moved(id) {
			qs = map[string]provider.SubscriptionQuota{}
			for _, q := range provider.Quotas(ctx) {
				if q.Provider == id {
					qs[q.User] = q
				}
			}
		}
		writeJSON(w, provider.WithCapped(qs))
	})
	mux.HandleFunc("POST /api/accounts/{action}", mutate(func(w http.ResponseWriter, r *http.Request) error {
		var b struct {
			ID, User, Account, Proxy           string
			Models, Allow, Order, AccountOrder []string
			Cap                                int
			Limit                              *int
		}
		if err := decode(w, r, &b); err != nil {
			return err
		}
		ref := b.User
		if ref == "" {
			ref = b.Account
		}
		switch r.PathValue("action") {
		case "order", "arrange":
			order := b.Order
			if order == nil {
				order = b.AccountOrder
			}
			return provider.WhaleBridgeSetAccountOrder(b.ID, order)
		case "models":
			allow := b.Allow
			if allow == nil {
				allow = b.Models
			}
			return provider.SetAccountModels(b.ID, ref, allow)
		case "cap":
			return provider.SetAccountCap(b.ID, ref, b.Cap)
		case "concurrency":
			return provider.SetAccountConcurrency(b.ID, ref, b.Limit)
		case "proxy":
			p, err := provider.Find(b.ID)
			if err != nil {
				return err
			}
			account, ok := p.AccountRefOf(ref)
			if !ok {
				return fmt.Errorf("供应商没有账号 %q", ref)
			}
			proxies := cloneHeaders(p.AccountProxies)
			if strings.TrimSpace(b.Proxy) == "" {
				delete(proxies, strings.ToLower(account))
			} else {
				proxies[strings.ToLower(account)] = b.Proxy
			}
			p.AccountProxies = proxies
			return provider.Save(*p)
		default:
			return fmt.Errorf("未知账号操作")
		}
	}))
	for _, path := range []string{"POST /api/signin/import", "POST /api/accounts/import"} {
		mux.HandleFunc(path, importAccounts)
	}
	mux.HandleFunc("POST /api/stepfun/{site}/session", func(w http.ResponseWriter, r *http.Request) {
		var b struct{ Text string }
		if err := decode(w, r, &b); err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
		defer cancel()
		if err := provider.SaveStepFunPaste(ctx, r.PathValue("site"), b.Text); err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		writeJSON(w, map[string]bool{"ok": true})
	})
	mux.HandleFunc("POST /api/stepfun/{site}/signout", func(w http.ResponseWriter, r *http.Request) {
		if err := provider.SignOutStepFun(r.PathValue("site")); err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		writeJSON(w, map[string]bool{"ok": true})
	})
	quotaRoutes(mux)
}

func importAccounts(w http.ResponseWriter, r *http.Request) {
	var b struct {
		Agent, ID string
		Files     []string
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8<<20)).Decode(&b); err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	if b.Agent == "" {
		b.Agent = b.ID
	}
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Minute)
	defer cancel()
	mutations.Lock()
	defer mutations.Unlock()
	var res []provider.ImportedAccount
	var err error
	switch b.Agent {
	case "codex", "claude":
		res, err = provider.ImportLogins(ctx, b.Agent, b.Files)
	case "factory":
		res, err = provider.ImportFactoryKeys(ctx, b.Files)
	case "gemini", "antigravity":
		res, err = provider.ImportGoogleAccounts(ctx, b.Agent, b.Files)
	default:
		err = fmt.Errorf("该订阅不支持账号文件导入")
	}
	if err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	if err := syncDSH(); err != nil {
		http.Error(w, "账号已导入，但 DSH 渠道同步失败: "+err.Error(), 500)
		return
	}
	writeJSON(w, map[string]any{"results": res, "ok": true})
}

func subscriptionSettings() map[string]any {
	s := settings.Load()
	out := map[string]any{"codexWarmup": s.CodexWarmup, "claudeWarmup": s.ClaudeWarmup, "codexWarmAt": s.CodexWarmAt, "claudeWarmAt": s.ClaudeWarmAt, "codexWarmAtOf": s.CodexWarmAtOf, "codexAutoReset": s.CodexAutoReset, "codexNoCredits": s.CodexNoCredits, "workbuddyCheckin": s.WorkBuddyCheckin, "traeCheckin": s.TraeCheckin, "minimaxCheckin": s.MiniMaxCheckin, "qoderCheckin": s.QoderCheckin, "pluginCheckins": s.PluginCheckins, "quotaLeft": s.QuotaLeft, "proxy": s.Proxy, "usageAlert": s.UsageAlert, "balanceAlert": s.BalanceAlert, "resetReminder": s.ResetReminder, "chinaMirror": s.ChinaMirror, "codexWarmed": latestWarm(provider.CodexWarmed()), "claudeWarmed": latestWarm(provider.ClaudeWarmed())}
	effective := map[string]bool{}
	for _, p := range provider.WhaleBridgeSubscriptions() {
		if p.Plugin && p.Checkin {
			effective[p.PID] = provider.PluginCheckinOn(s, p.PID)
		}
	}
	out["pluginCheckinsEffective"] = effective
	return out
}

func quotaRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/quotas", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
		defer cancel()
		if r.URL.Query().Get("asked") == "1" {
			provider.AskClaudeUsage()
		}
		qs := provider.WithCheckins(provider.Quotas(ctx))
		if provider.SubscriptionUsageReading() {
			w.Header().Set("X-Magpie-Reading", "1")
		}
		writeJSON(w, qs)
	})
	mux.HandleFunc("POST /api/quotas/refresh", func(w http.ResponseWriter, r *http.Request) {
		var b struct{ Provider, ID, User string }
		if err := decode(w, r, &b); err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		if b.Provider == "" {
			b.Provider = b.ID
		}
		ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
		defer cancel()
		if b.Provider == "" {
			for _, p := range provider.All() {
				provider.RefreshUsage(ctx, p.ID, "")
			}
		} else {
			provider.RefreshUsage(ctx, b.Provider, b.User)
		}
		writeJSON(w, provider.WithCheckins(provider.Quotas(ctx)))
	})
	mux.HandleFunc("GET /api/quotas/history", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		histories := provider.QuotaHistories(provider.QuotaHistorySince(q.Get("days"), time.Now()), q.Get("provider"), q.Get("user"))
		ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
		defer cancel()
		for _, h := range provider.RemoteQuotaHistories(ctx, q.Get("days")) {
			if q.Get("provider") != "" && h.Provider != q.Get("provider") || q.Get("user") != "" && !strings.EqualFold(h.User, q.Get("user")) {
				continue
			}
			histories = append(histories, h)
		}
		writeJSON(w, histories)
	})
	mux.HandleFunc("POST /api/quotas/checkin", func(w http.ResponseWriter, r *http.Request) {
		var b struct{ Provider, ID string }
		if err := decode(w, r, &b); err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		if b.Provider == "" {
			b.Provider = b.ID
		}
		ctx, cancel := context.WithTimeout(r.Context(), time.Minute)
		defer cancel()
		var rows []provider.WorkBuddyCheckin
		pluginID := strings.TrimPrefix(b.Provider, "plugin:")
		pp, hasPlugin := provider.PluginOf(pluginID)
		if strings.HasPrefix(b.Provider, "plugin:") || hasPlugin && pp.Checkin {
			rows = provider.CheckInPlugins(ctx, pluginID)
		} else {
			switch b.Provider {
			case "workbuddy", "workbuddy-cn":
				rows = provider.CheckInWorkBuddy(ctx)
			case "trae", "trae-cn":
				rows = provider.CheckInTrae(ctx)
			case "minimax", "minimax-code", "minimax-cn":
				rows = provider.CheckInMiniMax(ctx)
			case "qoder", "qoder-cn":
				rows = provider.CheckInQoder(ctx)
			default:
				if b.Provider == "" {
					http.Error(w, "缺少订阅供应商", 400)
					return
				}
				rows = provider.CheckInPlugins(ctx, b.Provider)
			}
		}
		if len(rows) == 0 {
			http.Error(w, "该供应商没有可签到的已启用账号", http.StatusBadRequest)
			return
		}
		writeJSON(w, rows)
	})
	mux.HandleFunc("POST /api/quotas/codex-reset", func(w http.ResponseWriter, r *http.Request) {
		var b struct{ User string }
		if err := decode(w, r, &b); err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
		defer cancel()
		out, err := provider.UseCodexReset(ctx, b.User)
		if err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		writeJSON(w, out)
	})
}

func keyAction(w http.ResponseWriter, r *http.Request) {
	var b struct {
		ID, Ref, Action, Name, Key string
		Refs, Order, Allow, Models []string
		On                         bool
		Protocol                   provider.Protocol
		Weight                     int
		Limit                      *int
	}
	if err := decode(w, r, &b); err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	if b.Action == "" {
		b.Action = r.PathValue("action")
	}
	mutations.Lock()
	defer mutations.Unlock()
	var err error
	added, had, removed := 0, 0, 0
	switch b.Action {
	case "add":
		err = provider.AddKey(b.ID, b.Name, b.Key, b.Protocol)
	case "import":
		added, had, err = provider.AddKeys(b.ID, provider.SplitKeys(b.Key), b.Protocol)
	case "use":
		err = provider.UseKey(b.ID, b.Ref)
	case "rename":
		err = provider.RenameKey(b.ID, b.Ref, b.Name)
	case "protocol":
		err = provider.SetKeyProtocol(b.ID, b.Ref, b.Protocol)
	case "weight":
		err = provider.SetKeyWeight(b.ID, b.Ref, b.Weight)
	case "on":
		err = provider.SetKeyOn(b.ID, b.Ref, b.On || r.PathValue("action") == "on")
	case "off":
		err = provider.SetKeyOn(b.ID, b.Ref, false)
	case "remove":
		err = provider.RemoveKey(b.ID, b.Ref)
	case "remove-many":
		removed, err = provider.RemoveKeys(b.ID, b.Refs)
	case "arrange", "order":
		err = provider.WhaleBridgeSetAccountOrder(b.ID, b.Order)
	case "models":
		allow := b.Allow
		if allow == nil {
			allow = b.Models
		}
		err = provider.SetAccountModels(b.ID, b.Ref, allow)
	case "concurrency":
		err = provider.SetAccountConcurrency(b.ID, b.Ref, b.Limit)
	default:
		err = fmt.Errorf("未知密钥操作")
	}
	if err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	if b.Action == "add" || b.Action == "import" || b.Action == "on" {
		if p, err := provider.Find(b.ID); err == nil && p.Ready() && len(p.KeysOn()) > 1 {
			ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
			p.Fetch(ctx)
			cancel()
		}
	}
	if err := syncDSH(); err != nil {
		http.Error(w, "密钥设置已保存，但 DSH 渠道同步失败: "+err.Error(), 500)
		return
	}
	writeJSON(w, map[string]any{"ok": true, "added": added, "had": had, "removed": removed})
}
