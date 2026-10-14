package gateway

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/yetone/magpie/internal/provider"
)

// Factory's DeepSeek V4.1 Flash and Kimi K3 (Fireworks) and GLM-5.2
// (Baseten) stop thinking at reasoning_effort "none", as droid sends for its
// "off" (#899); GLM-5.3 and GLM-5.3-Flash can't ("Reasoning is mandatory"),
// and are asked for low, their least. Whichever agent turns reasoning off
// — none on chat completions or Responses, Anthropic's thinking disabled —
// a model with none among its levels is asked for none, not low.
func TestFactoryThinkingOff(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(home, ".config"))
	t.Setenv("XDG_CACHE_HOME", filepath.Join(home, ".cache"))
	t.Setenv("XDG_DATA_HOME", filepath.Join(home, ".local", "share"))

	f := &fake{t: t, code: http.StatusForbidden, ctype: "application/json", reply: `{"error":{"message":"no"}}`}
	up := httptest.NewServer(f)
	t.Cleanup(up.Close)
	t.Cleanup(provider.FactoryBaseForTest(up.URL, up.URL+"/eu"))

	auth, _ := json.Marshal(map[string]any{
		"accessToken": "tok", "refreshToken": "r",
		"expiresAt": time.Now().Add(time.Hour).UnixMilli(),
		"orgId":     "org_D", "activeOrganizationId": "fac_D", "email": "d@example.com",
	})
	dir := filepath.Dir(provider.Path())
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal([]map[string]any{{
		"agent": "factory", "user": "d@example.com", "plan": "pro", "on": true, "auth": json.RawMessage(auth),
	}})
	if err := os.WriteFile(filepath.Join(dir, "logins.json"), raw, 0o600); err != nil {
		t.Fatal(err)
	}

	for _, tt := range []struct {
		name, path, body, want string
	}{
		{"chat none", "/v1/chat/completions", `{"model":"factory/deepseek-v4.1-flash","reasoning_effort":"none","messages":[{"role":"user","content":"hi"}]}`, "none"},
		{"chat none kimi", "/v1/chat/completions", `{"model":"factory/kimi-k3","reasoning_effort":"none","messages":[{"role":"user","content":"hi"}]}`, "none"},
		{"chat low", "/v1/chat/completions", `{"model":"factory/deepseek-v4.1-flash","reasoning_effort":"low","messages":[{"role":"user","content":"hi"}]}`, "low"},
		{"responses none", "/v1/responses", `{"model":"factory/kimi-k3","reasoning":{"effort":"none"},"input":[{"role":"user","content":"hi"}]}`, "none"},
		{"messages disabled", "/v1/messages", `{"model":"factory/deepseek-v4.1-flash","thinking":{"type":"disabled"},"messages":[{"role":"user","content":"hi"}],"max_tokens":8}`, "none"},
		{"baseten none", "/v1/chat/completions", `{"model":"factory/glm-5.2","reasoning_effort":"none","messages":[{"role":"user","content":"hi"}]}`, "none"},
		// reasoning is mandatory on these: low is the least
		{"glm-5.3 none", "/v1/chat/completions", `{"model":"factory/glm-5.3","reasoning_effort":"none","messages":[{"role":"user","content":"hi"}]}`, "low"},
		{"glm-5.3-flash none", "/v1/responses", `{"model":"factory/glm-5.3-flash","reasoning":{"effort":"none"},"input":[{"role":"user","content":"hi"}]}`, "low"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			f.got, f.path = nil, ""
			post(t, tt.path, tt.body)
			if f.path != "/api/llm/o/v1/chat/completions" {
				t.Fatalf("went to %s: %s", f.path, f.got)
			}
			var m map[string]any
			if json.Unmarshal(f.got, &m) != nil {
				t.Fatalf("upstream %s", f.got)
			}
			if m["reasoning_effort"] != tt.want {
				t.Errorf("reasoning_effort %v, want %s", m["reasoning_effort"], tt.want)
			}
		})
	}
}
