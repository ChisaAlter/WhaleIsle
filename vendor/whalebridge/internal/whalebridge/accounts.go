package whalebridge

import (
	"context"
	"github.com/yetone/magpie/internal/plugin"
	"github.com/yetone/magpie/internal/provider"
	"net/http"
	"time"
)

func accountRoutes(mux *http.ServeMux) {
	subscriptionRoutes(mux)
	mux.HandleFunc("POST /api/subscription/prompt", func(w http.ResponseWriter, r *http.Request) {
		var b struct {
			ID     string            `json:"id"`
			Method int               `json:"method"`
			Inputs map[string]string `json:"inputs"`
			Key    string            `json:"key"`
			Value  string            `json:"value"`
		}
		if err := decode(w, r, &b); err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), time.Minute)
		defer cancel()
		if b.Inputs == nil {
			b.Inputs = map[string]string{}
		}
		if b.Key != "" {
			message, err := plugin.Validate(ctx, b.ID, b.Method, b.Key, b.Value)
			if err != nil {
				http.Error(w, err.Error(), 400)
				return
			}
			if message != "" {
				writeJSON(w, map[string]any{"error": message})
				return
			}
			b.Inputs[b.Key] = b.Value
		}
		p, err := plugin.NextPrompt(ctx, b.ID, b.Method, b.Inputs)
		if err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		writeJSON(w, map[string]any{"prompt": p, "inputs": b.Inputs})
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
			if err := syncConfiguration(); err != nil {
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
			if err := syncConfiguration(); err != nil {
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
	mux.HandleFunc("GET /api/accounts/{id}", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, provider.WhaleBridgeLogins(r.PathValue("id")))
	})
	mux.HandleFunc("GET /api/accounts/{id}/project", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		if id != "gemini" && id != "antigravity" {
			http.Error(w, "只有 Google 账号支持 Cloud project", 400)
			return
		}
		writeJSON(w, map[string]any{"project": provider.GoogleProject(id, r.URL.Query().Get("user"))})
	})
	mux.HandleFunc("POST /api/accounts/project", mutate(func(w http.ResponseWriter, r *http.Request) error {
		var b struct {
			ID      string `json:"id"`
			User    string `json:"user"`
			Project string `json:"project"`
		}
		if err := decode(w, r, &b); err != nil {
			return err
		}
		return provider.SetGoogleProject(b.ID, b.User, b.Project)
	}))
	mux.HandleFunc("POST /api/accounts/on", mutate(func(w http.ResponseWriter, r *http.Request) error {
		var b struct {
			ID   string `json:"id"`
			User string `json:"user"`
			On   bool   `json:"on"`
		}
		if err := decode(w, r, &b); err != nil {
			return err
		}
		return provider.WhaleBridgeSetLoginOn(b.ID, b.User, b.On)
	}))
	mux.HandleFunc("POST /api/accounts/remove", mutate(func(w http.ResponseWriter, r *http.Request) error {
		var b struct {
			ID   string `json:"id"`
			User string `json:"user"`
		}
		if err := decode(w, r, &b); err != nil {
			return err
		}
		return provider.WhaleBridgeForgetLogin(b.ID, b.User)
	}))
	mux.HandleFunc("GET /api/keys/{id}", func(w http.ResponseWriter, r *http.Request) {
		p, err := provider.Find(r.PathValue("id"))
		if err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		writeJSON(w, keyInfos(*p))
	})
	mux.HandleFunc("POST /api/keys", keyAction)
	mux.HandleFunc("POST /api/keys/{action}", keyAction)
}
