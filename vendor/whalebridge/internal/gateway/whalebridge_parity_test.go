package gateway

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"io"
	"math"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/yetone/magpie/internal/catalog"
	"github.com/yetone/magpie/internal/provider"
	"github.com/yetone/magpie/internal/usage"
)

func TestComponentSavedOrderIsActualCandidateOrder(t *testing.T) {
	fresh(t)
	jwt := func(v any) string {
		b, _ := json.Marshal(v)
		return "e30." + base64.RawURLEncoding.EncodeToString(b) + ".sig"
	}
	auth := func(user string) map[string]any {
		return map[string]any{"auth_mode": "chatgpt", "tokens": map[string]any{"id_token": jwt(map[string]any{"email": user, "https://api.openai.com/auth": map[string]any{"chatgpt_plan_type": "pro", "chatgpt_account_id": user}}), "access_token": jwt(map[string]any{"exp": time.Now().Add(time.Hour).Unix()}), "refresh_token": "r-" + user, "account_id": user}}
	}
	native, _ := json.Marshal(auth("native@example.com"))
	path := filepath.Join(os.Getenv("USERPROFILE"), ".codex", "auth.json")
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, native, 0o600); err != nil {
		t.Fatal(err)
	}
	accounts := []map[string]any{}
	for _, user := range []string{"a@example.com", "b@example.com"} {
		accounts = append(accounts, map[string]any{"agent": "codex", "user": user, "plan": "pro", "on": true, "owned": true, "auth": auth(user)})
	}
	b, _ := json.Marshal(accounts)
	logins := filepath.Join(filepath.Dir(provider.Path()), "logins.json")
	if err := os.MkdirAll(filepath.Dir(logins), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(logins, b, 0o600); err != nil {
		t.Fatal(err)
	}
	provider.ForgetAccounts()
	if err := provider.WhaleBridgeSetAccountOrder("codex", []string{"b@example.com", "a@example.com", "native@example.com"}); err != nil {
		t.Fatal(err)
	}
	p, err := provider.Find("codex")
	if err != nil {
		t.Fatal(err)
	}
	two := 2
	p.MaxConcurrency, p.QueueLimit, p.QueueWait, p.PinUpstream, p.PriceRate = &two, 17, 3, true, 0.5
	cs := perKey(*p, "gpt-5.5", provider.Chat)
	if len(cs) != 3 || cs[0].p.Account.User != "b@example.com" || cs[1].p.Account.User != "a@example.com" || cs[2].p.Account.User != "native@example.com" {
		t.Fatalf("candidate order=%+v", cs)
	}
	if q := cs[0].p; q.LaneLimit() != 2 || q.QueueLimit != 17 || q.QueueWait != 3 || !q.PinUpstream || q.PriceRate != 0.5 {
		t.Fatalf("secondary account settings=%+v", q)
	}
	after, err := os.ReadFile(path)
	if err != nil || !bytes.Equal(after, native) {
		t.Fatal("routing order changed native sign in")
	}
}

func TestDSHClaudeSupplierCachesAndPricesOneHourWrites(t *testing.T) {
	fresh(t)
	var endpoint string
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		endpoint = r.URL.Path
		if r.Header.Get("x-api-key") != "supplier-key" {
			t.Errorf("supplier authentication header=%q", r.Header.Get("x-api-key"))
		}
		w.Header().Set("Content-Type", "text/event-stream")
		io.WriteString(w, "event: message_start\ndata: {\"type\":\"message_start\",\"message\":{\"id\":\"msg1\",\"type\":\"message\",\"role\":\"assistant\",\"model\":\"claude-sonnet-5\",\"content\":[],\"usage\":{\"input_tokens\":100,\"cache_read_input_tokens\":200,\"cache_creation_input_tokens\":1000,\"cache_creation\":{\"ephemeral_5m_input_tokens\":700,\"ephemeral_1h_input_tokens\":300}}}}\n\nevent: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"pong\"}}\n\nevent: message_delta\ndata: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"},\"usage\":{\"output_tokens\":20}}\n\nevent: message_stop\ndata: {\"type\":\"message_stop\"}\n\n")
	}))
	t.Cleanup(up.Close)
	if err := provider.Save(provider.Provider{ID: "relay", Name: "Relay", Key: "supplier-key", Chat: up.URL + "/v1", Anthropic: up.URL, Models: []string{"claude-sonnet-5"}}); err != nil {
		t.Fatal(err)
	}
	price := catalog.Price{Input: 5, Output: 25, CacheRead: 0.5, CacheWrite: 6.25, CacheWrite1h: 10, Tiers: []catalog.Tier{{Above: 1000, Input: 10, Output: 50, CacheRead: 1, CacheWrite: 12.5, CacheWrite1h: 20}}}
	if err := provider.SetModelPrice("relay/claude-sonnet-5", &price); err != nil {
		t.Fatal(err)
	}
	s := New()
	r := httptest.NewRequest(http.MethodPost, "http://127.0.0.1/v1/chat/completions", strings.NewReader(`{"model":"relay/claude-sonnet-5","messages":[{"role":"user","content":"hello"}],"max_tokens":64}`))
	r.Header.Set("Authorization", "Bearer test-private-gateway-key")
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	s.Handler().ServeHTTP(w, r)
	if w.Code != 200 || !strings.Contains(w.Body.String(), "pong") || endpoint != "/v1/messages" {
		t.Fatalf("endpoint=%s response=%d %s", endpoint, w.Code, w.Body.String())
	}
	rs := usage.Load(time.Time{})
	if len(rs) != 1 || rs[0].CacheWrite1h != 300 || rs[0].CacheWrite != 1000 {
		t.Fatalf("ledger=%+v", rs)
	}
	totals := usage.NewPricer()(rs)
	want := (100*10.0 + 20*50.0 + 200*1.0 + 700*12.5 + 300*20.0) / 1e6
	if math.Abs(totals.Cost-want) > 1e-9 {
		t.Fatalf("ledger cost=%v want=%v", totals.Cost, want)
	}
}

func TestAccountUsageCapAndCreditsGate(t *testing.T) {
	fresh(t)
	old := allowances
	t.Cleanup(func() { allowances = old })
	used := 75.0
	reset := time.Now().Add(time.Hour)
	allowances = func(string) map[string]provider.Allowance {
		return map[string]provider.Allowance{"a@example.com": {{Used: used, Resets: reset, Span: 5 * time.Hour}}}
	}
	p := provider.Provider{ID: "codex", AccountCaps: map[string]int{"a@example.com": 70}, Account: &provider.Account{Agent: "codex", User: "a@example.com"}}
	if h := capHeld(p, p, "gpt-5.5", time.Now()); h == nil || h.cap != 70 || h.noCredits {
		t.Fatalf("account cap hold=%+v", h)
	}
	p.AccountCaps = nil
	if h := capHeld(p, p, "gpt-5.5", time.Now()); h != nil {
		t.Fatalf("default credits hold=%+v", h)
	}
	if err := provider.SetCodexCredits("a@example.com", false); err != nil {
		t.Fatal(err)
	}
	used = 100
	if h := capHeld(p, p, "gpt-5.5", time.Now()); h == nil || h.cap != 100 || !h.noCredits {
		t.Fatalf("no-credits hold=%+v", h)
	}
	used = 55
	if h := capHeld(p, p, "gpt-5.5", time.Now()); h != nil {
		t.Fatalf("credits hold below quota=%+v", h)
	}
}
