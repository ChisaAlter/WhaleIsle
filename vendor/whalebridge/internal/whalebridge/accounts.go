package whalebridge

import (
	"context"
	"fmt"
	"github.com/yetone/magpie/internal/plugin"
	"github.com/yetone/magpie/internal/provider"
	"net/http"
	"time"
)

func accountRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/subscription/prompt", func(w http.ResponseWriter, r *http.Request) {
		var b struct {
			ID     string            `json:"id"`
			Method int               `json:"method"`
			Inputs map[string]string `json:"inputs"`
		}
		if err := decode(w, r, &b); err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		p, err := plugin.NextPrompt(r.Context(), b.ID, b.Method, b.Inputs)
		if err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		writeJSON(w, p)
	})
	mux.HandleFunc("GET /api/subscriptions", func(w http.ResponseWriter, r *http.Request) { writeJSON(w, provider.WhaleBridgeSubscriptions()) })
	mux.HandleFunc("POST /api/signin", func(w http.ResponseWriter, r *http.Request) {
		var b struct {
			Agent  string            `json:"agent"`
			Site   string            `json:"site"`
			Plugin bool              `json:"plugin"`
			Method int               `json:"method"`
			Inputs map[string]string `json:"inputs"`
			Key    string            `json:"key"`
		}
		if err := decode(w, r, &b); err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		var st provider.SignInState
		var err error
		if b.Plugin && b.Key != "" {
			_, err = provider.PluginAPIKey(r.Context(), b.Agent, b.Method, b.Inputs, b.Key)
			st.State = "done"
		} else if b.Plugin {
			st, err = provider.StartPluginSignIn(b.Agent, b.Method, b.Inputs)
		} else {
			st, err = provider.StartSignInAt(b.Agent, b.Site)
		}
		if err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		if st.State == "done" {
			if err := syncDSH(); err != nil {
				http.Error(w, err.Error(), 500)
				return
			}
		}
		writeJSON(w, st)
	})
	mux.HandleFunc("GET /api/signin/{id}", func(w http.ResponseWriter, r *http.Request) {
		st, ok := provider.SignInStatus(r.PathValue("id"))
		if !ok {
			http.NotFound(w, r)
			return
		}
		if st.State == "done" {
			if err := syncDSH(); err != nil {
				http.Error(w, err.Error(), 500)
				return
			}
		}
		writeJSON(w, st)
	})
	mux.HandleFunc("POST /api/signin/{id}/cancel", func(w http.ResponseWriter, r *http.Request) {
		provider.CancelSignIn(r.PathValue("id"))
		writeJSON(w, map[string]any{"ok": true})
	})
	mux.HandleFunc("POST /api/signin/{id}/callback", func(w http.ResponseWriter, r *http.Request) {
		var b struct {
			URL string `json:"url"`
		}
		if err := decode(w, r, &b); err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		if err := provider.SubmitSignInCallback(r.PathValue("id"), b.URL); err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		writeJSON(w, map[string]any{"ok": true})
	})
	mux.HandleFunc("POST /api/subscription/adapter", mutate(func(w http.ResponseWriter, r *http.Request) error {
		var b struct {
			ID string `json:"id"`
		}
		if err := decode(w, r, &b); err != nil {
			return err
		}
		pkg := provider.MovePackage(b.ID)
		if pkg == "" {
			return fmt.Errorf("该订阅没有官方适配器")
		}
		_, err := plugin.Add(r.Context(), pkg)
		if err != nil {
			return err
		}
		_, err = plugin.Providers(r.Context())
		return err
	}))
	mux.HandleFunc("GET /api/accounts/{id}", func(w http.ResponseWriter, r *http.Request) { writeJSON(w, provider.Logins(r.PathValue("id"))) })
	mux.HandleFunc("POST /api/accounts/on", mutate(func(w http.ResponseWriter, r *http.Request) error {
		var b struct {
			ID   string `json:"id"`
			User string `json:"user"`
			On   bool   `json:"on"`
		}
		if err := decode(w, r, &b); err != nil {
			return err
		}
		return provider.SetLoginOn(b.ID, b.User, b.On)
	}))
	mux.HandleFunc("POST /api/accounts/remove", mutate(func(w http.ResponseWriter, r *http.Request) error {
		var b struct {
			ID   string `json:"id"`
			User string `json:"user"`
		}
		if err := decode(w, r, &b); err != nil {
			return err
		}
		return provider.ForgetLogin(b.ID, b.User)
	}))
	mux.HandleFunc("GET /api/keys/{id}", func(w http.ResponseWriter, r *http.Request) {
		p, err := provider.Find(r.PathValue("id"))
		if err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		writeJSON(w, p.KeyList())
	})
	mux.HandleFunc("POST /api/keys", mutate(func(w http.ResponseWriter, r *http.Request) error {
		var b struct {
			ID       string            `json:"id"`
			Ref      string            `json:"ref"`
			Action   string            `json:"action"`
			Name     string            `json:"name"`
			Key      string            `json:"key"`
			On       bool              `json:"on"`
			Protocol provider.Protocol `json:"protocol"`
			Weight   int               `json:"weight"`
		}
		if err := decode(w, r, &b); err != nil {
			return err
		}
		switch b.Action {
		case "add":
			return provider.AddKey(b.ID, b.Name, b.Key, b.Protocol)
		case "on":
			return provider.SetKeyOn(b.ID, b.Ref, b.On)
		case "remove":
			return provider.RemoveKey(b.ID, b.Ref)
		case "weight":
			return provider.SetKeyWeight(b.ID, b.Ref, b.Weight)
		default:
			return fmt.Errorf("未知密钥操作")
		}
	}))
	mux.HandleFunc("GET /api/quotas", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
		defer cancel()
		writeJSON(w, provider.Quotas(ctx))
	})
}
