package whalebridge

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/yetone/magpie/internal/plugin"
	"github.com/yetone/magpie/internal/provider"
	"github.com/yetone/magpie/internal/settings"
)

func latestWarm(times map[string]time.Time) *time.Time {
	var newest time.Time
	for _, at := range times {
		if at.After(newest) {
			newest = at
		}
	}
	if newest.IsZero() {
		return nil
	}
	return &newest
}

func setAdapterMirror(on bool) error {
	s := settings.Load()
	changed := s.ChinaMirror != on
	s.ChinaMirror = on
	if err := settings.Save(s); err != nil {
		return err
	}
	if changed {
		plugin.RefreshMarket()
	}
	return nil
}

func subscriptionAdapters(ctx context.Context) map[string]any {
	installed, available, moves := []map[string]any{}, []plugin.Listing{}, []map[string]any{}
	ps, providerErr := plugin.Providers(ctx)
	errs := map[string]string{}
	if plugin.Running() || plugin.HasBun() {
		loaded, err := plugin.Plugins(ctx)
		if err != nil && providerErr == nil {
			providerErr = err
		}
		for _, p := range loaded {
			errs[plugin.Name(p.Spec)] = p.Error
		}
	}
	es := plugin.Load().Plugins
	names := []string{}
	for _, e := range es {
		if !plugin.IsPath(e.Spec) && !plugin.IsGit(e.Spec) {
			names = append(names, plugin.Name(e.Spec))
		}
	}
	known := plugin.InfoCached(names)
	for _, e := range es {
		ids := []string{}
		for _, p := range ps {
			if plugin.Name(p.Spec) == plugin.Name(e.Spec) {
				ids = append(ids, p.ID)
			}
		}
		row := map[string]any{"id": plugin.Name(e.Spec), "name": plugin.Name(e.Spec), "package": e.Spec, "version": plugin.Installed(e.Spec), "enabled": !e.Off, "providers": ids, "error": errs[plugin.Name(e.Spec)], "latest": known[plugin.Name(e.Spec)].Version, "moved": provider.MovedOnto(e.Spec), "optionsExample": plugin.OptionsExample(plugin.Target(e.Spec))}
		if u, ok := plugin.LastUpdated(plugin.Name(e.Spec), time.Now().Add(-3*24*time.Hour)); ok && !plugin.IsPath(e.Spec) {
			row["autoUpdated"] = u
		}
		installed = append(installed, row)
	}
	for _, e := range plugin.Market(ctx) {
		if len(e.Providers) > 0 {
			available = append(available, e)
		}
	}
	for _, id := range provider.MovableIDs() {
		m, _ := provider.MigrationOf(id)
		p, _ := provider.Find(id)
		moves = append(moves, map[string]any{"id": id, "package": provider.MovePackage(id), "moved": provider.Moved(id), "signedIn": p != nil && p.Account != nil, "state": m.State, "error": m.Err})
	}
	out := map[string]any{"installed": installed, "available": available, "moves": moves, "updates": plugin.PendingUpdates(), "bun": plugin.HasBun(), "bunVer": plugin.BunInUse(), "mirror": settings.Load().ChinaMirror}
	if providerErr != nil {
		out["error"] = providerErr.Error()
	}
	return out
}

func adapterDiscoveryRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/subscription/adapters/search", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
		defer cancel()
		hits, err := plugin.Search(ctx, r.URL.Query().Get("q"))
		if err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		writeJSON(w, map[string]any{"hits": hits})
	})
	mux.HandleFunc("GET /api/subscription/adapters/page", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
		defer cancel()
		p, err := plugin.Readme(ctx, r.URL.Query().Get("name"))
		if err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		writeJSON(w, p)
	})
	mux.HandleFunc("GET /api/subscription/adapters/github", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, map[string]any{"repos": plugin.TaggedRepos(r.Context()), "topic": plugin.Topic})
	})
	mux.HandleFunc("GET /api/subscription/adapters/npm", func(w http.ResponseWriter, r *http.Request) {
		names := []string{}
		for _, n := range strings.Split(r.URL.Query().Get("names"), ",") {
			if n = strings.TrimSpace(n); n != "" && len(names) < 100 {
				names = append(names, n)
			}
		}
		writeJSON(w, map[string]any{"npm": plugin.Info(r.Context(), names)})
	})
	mux.HandleFunc("POST /api/subscription/adapters/check", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 3*time.Minute)
		defer cancel()
		writeJSON(w, plugin.CheckNow(ctx))
	})
}
