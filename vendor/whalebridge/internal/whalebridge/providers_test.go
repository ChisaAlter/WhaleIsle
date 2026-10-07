package whalebridge

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/yetone/magpie/internal/gateway"
	"github.com/yetone/magpie/internal/provider"
	"github.com/yetone/magpie/internal/settings"
)

type providerHTTP struct {
	t      *testing.T
	url    string
	vendor string
	data   string
}

func newProviderHTTP(t *testing.T) providerHTTP {
	t.Helper()
	root := t.TempDir()
	data, native := filepath.Join(root, "component"), filepath.Join(root, "native")
	for _, path := range []string{data, native, filepath.Join(root, "dsh")} {
		if err := os.MkdirAll(path, 0700); err != nil {
			t.Fatal(err)
		}
	}
	t.Setenv("LAUNCHER_COMPONENT_DATA_DIR", data)
	t.Setenv("WHALEBRIDGE_DSH_HOME", filepath.Join(root, "dsh"))
	t.Setenv("WHALEBRIDGE_GATEWAY_TOKEN", "11111111111111111111111111111111")
	t.Setenv("HOME", native)
	t.Setenv("USERPROFILE", native)
	t.Setenv("APPDATA", filepath.Join(native, "AppData", "Roaming"))
	t.Setenv("LOCALAPPDATA", filepath.Join(native, "AppData", "Local"))
	// A native credential sentinel detects accidental client mutations.
	sentinel := filepath.Join(native, ".codex", "auth.json")
	if err := os.MkdirAll(filepath.Dir(sentinel), 0700); err != nil {
		t.Fatal(err)
	}
	marker := []byte(`{"nativeCredentialSentinel":"leave this file untouched"}`)
	if err := os.WriteFile(sentinel, marker, 0600); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		got, err := os.ReadFile(sentinel)
		if err != nil || !bytes.Equal(got, marker) {
			t.Errorf("native credential changed: %v", err)
		}
	})
	vendor := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if strings.Contains(r.URL.Path, "recommended-models") {
			io.WriteString(w, `{"clinePass":[{"id":"deepseek-v4.1-flash","name":"DeepSeek V4.1 Flash"}],"free":[{"id":"cline-free/test-model","name":"Free model"}]}`)
			return
		}
		io.WriteString(w, `{"data":[{"id":"test-model","name":"Test model"},{"id":"deepseek-v4.1-flash","name":"DeepSeek V4.1 Flash"}]}`)
	}))
	t.Cleanup(vendor.Close)
	mux := http.NewServeMux()
	g := gateway.New()
	providerRoutes(mux, g)
	globalRoutes(mux, g, "http-test")
	accountRoutes(mux)
	mux.HandleFunc("GET /api/state", stateHandler("http-test"))
	server := httptest.NewServer(mux)
	t.Cleanup(server.Close)
	return providerHTTP{t: t, url: server.URL, vendor: vendor.URL, data: data}
}

func (a providerHTTP) call(method, path string, body any, status int) []byte {
	a.t.Helper()
	var input io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			a.t.Fatal(err)
		}
		input = bytes.NewReader(b)
	}
	r, err := http.NewRequest(method, a.url+"/api/"+path, input)
	if err != nil {
		a.t.Fatal(err)
	}
	r.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 20 * time.Second}
	res, err := client.Do(r)
	if err != nil {
		a.t.Fatal(err)
	}
	defer res.Body.Close()
	b, err := io.ReadAll(res.Body)
	if err != nil {
		a.t.Fatal(err)
	}
	if res.StatusCode != status {
		a.t.Fatalf("%s %s: got %d, want %d: %s", method, path, res.StatusCode, status, b)
	}
	return b
}

func (a providerHTTP) save(body map[string]any) string {
	a.t.Helper()
	b := a.call("POST", "provider/save", body, 200)
	var out struct{ ID string }
	if err := json.Unmarshal(b, &out); err != nil {
		a.t.Fatal(err)
	}
	if out.ID == "" {
		a.t.Fatal("save did not return supplier id")
	}
	return out.ID
}

func (a providerHTTP) provider(id string) *provider.Provider {
	a.t.Helper()
	p, err := provider.Find(id)
	if err != nil {
		a.t.Fatal(err)
	}
	return p
}

func assertSecretsAbsent(t *testing.T, data []byte, secrets ...string) {
	t.Helper()
	for _, secret := range secrets {
		if bytes.Contains(data, []byte(secret)) {
			t.Fatal("response exposed a saved credential")
		}
	}
}

func TestProviderClinePassHTTPPersistence(t *testing.T) {
	a := newProviderHTTP(t)
	key, extra, header, token := "secret-primary-clinepass-123456789", "secret-secondary-clinepass-987654321", "secret-header-123456789", "secret-balance-987654321"
	id := a.save(map[string]any{
		"new": true, "id": "clinepass", "preset": "clinepass", "name": "ClinePass", "chat": a.vendor + "/v1", "responses": a.vendor + "/v1", "anthropic": a.vendor,
		"key": key, "keyName": "Personal", "keyWeight": 2, "keyProtocol": "responses", "keys": []map[string]any{{"key": extra, "name": "Team", "weight": 3, "protocol": "responses"}}, "headers": map[string]any{"X-Secret": header}, "balanceToken": token,
		"models": []string{"deepseek-v4.1-flash"}, "maxConcurrency": 4, "queueLimit": 12, "queueWait": 15, "priceRate": 0.8, "pinUpstream": true, "routing": "weight", "affinity": "key", "sink": true,
		"contexts": map[string]int{"deepseek-v4.1-flash": 128000}, "outputs": map[string]int{"deepseek-v4.1-flash": 8192}, "compacts": map[string]int{"deepseek-v4.1-flash": 100000},
	})
	p := a.provider(id)
	if p.MaxConcurrency == nil || *p.MaxConcurrency != 4 || p.QueueLimit != 12 || p.QueueWait != 15 || p.PriceRate != 0.8 || !p.PinUpstream {
		t.Fatalf("ClinePass controls did not persist: %#v", p)
	}
	if p.KeyName != "Personal" || p.KeyWeight != 2 || p.KeyProtocol != provider.Responses {
		t.Fatal("new supplier/import lost the primary key's explicit policies")
	}
	if !p.ClinePinnable() || p.ClinePin("deepseek-v4.1-flash") == "" {
		t.Fatal("saved DeepSeek upstream pin is ineffective")
	}
	state := a.call("GET", "state", nil, 200)
	assertSecretsAbsent(t, state, key, extra, header, token)
	var view struct {
		Providers []struct {
			ID                                    string
			MaxConcurrency, QueueLimit, QueueWait int
			PriceRate                             float64
			PinUpstream, KeySet, BalanceTokenSet  bool
			Outputs, Compacts                     map[string]int
		}
	}
	if err := json.Unmarshal(state, &view); err != nil {
		t.Fatal(err)
	}
	if len(view.Providers) != 1 || view.Providers[0].QueueWait != 15 || view.Providers[0].MaxConcurrency != 4 || !view.Providers[0].PinUpstream || !view.Providers[0].KeySet || !view.Providers[0].BalanceTokenSet || view.Providers[0].Outputs["deepseek-v4.1-flash"] != 8192 || view.Providers[0].Compacts["deepseek-v4.1-flash"] != 100000 {
		t.Fatalf("state lost editable ClinePass controls: %s", state)
	}
	a.save(map[string]any{"id": id, "from": id, "name": "ClinePass team", "key": "", "balanceToken": "", "headers": map[string]any{"X-Secret": "", "X-New": "new value"}, "queueWait": nil, "queueLimit": nil, "priceRate": nil})
	p = a.provider(id)
	if p.Key != key || p.BalanceToken != token || p.Headers["X-Secret"] != header || p.Headers["X-New"] != "new value" || len(p.Keys) != 1 {
		t.Fatal("partial save changed omitted or blank credentials")
	}
	if p.QueueWait != 0 || p.QueueLimit != 0 || p.PriceRate != 0 {
		t.Fatal("explicit inherited/null controls did not reset")
	}
	a.save(map[string]any{"id": id, "headers": map[string]any{"X-Secret": nil}})
	if _, ok := a.provider(id).Headers["X-Secret"]; ok {
		t.Fatal("explicit header removal did not persist")
	}
	var shown struct{ Key string }
	if err := json.Unmarshal(a.call("GET", "provider/"+id+"/key", nil, 200), &shown); err != nil || shown.Key != key {
		t.Fatal("explicit reveal did not return saved key")
	}
	assertSecretsAbsent(t, a.call("GET", "keys/"+id, nil, 200), key, extra)
}

func TestProviderCopyExportImportRenameHTTP(t *testing.T) {
	a := newProviderHTTP(t)
	key, header, token := "secret-copy-provider-123456789", "secret-copy-header-123456789", "secret-copy-balance-123456789"
	id := a.save(map[string]any{"new": true, "id": "original", "name": "Original", "chat": a.vendor + "/v1", "responses": a.vendor + "/v1", "key": key, "keyName": "Team", "keyWeight": 7, "keyProtocol": "responses", "headers": map[string]string{"X-Secret": header}, "balanceToken": token, "models": []string{"test-model"}, "modelPrefs": map[string]any{"test-model": map[string]any{"name": "Custom model", "efforts": []string{"low", "high"}, "api": "responses"}}, "modelPrices": map[string]any{"test-model": map[string]any{"input": 1, "output": 2, "cache_read": 0.1, "cache_write": 1.25, "cache_write_1h": 2, "tiers": []map[string]any{{"above": 200000, "input": 3, "output": 4, "cache_read": 0.5, "cache_write": 3.75, "cache_write_1h": 6}}}}, "outputs": map[string]int{"test-model": 1024}, "compacts": map[string]int{"test-model": 24000}})
	copyID := a.save(map[string]any{"new": true, "copyOf": id, "name": "Copy", "id": "copy"})
	cp := a.provider(copyID)
	if cp.Key != key || cp.Headers["X-Secret"] != header || cp.BalanceToken != token {
		t.Fatal("copy lost omitted credentials")
	}
	export := a.call("POST", "provider/export", map[string]string{"id": id}, 200)
	assertSecretsAbsent(t, export, key, header, token)
	var exported struct{ Text string }
	if err := json.Unmarshal(export, &exported); err != nil || exported.Text == "" {
		t.Fatal("export did not return a JSON import document")
	}
	before := len(provider.All())
	preview := a.call("POST", "provider/import", map[string]any{"text": exported.Text, "preview": true}, 200)
	assertSecretsAbsent(t, preview, key, header, token)
	if len(provider.All()) != before {
		t.Fatal("import preview mutated saved suppliers")
	}
	imported := a.call("POST", "provider/import", map[string]any{"text": exported.Text, "key": "secret-imported-key-123456789"}, 200)
	var imp struct{ Added []string }
	if err := json.Unmarshal(imported, &imp); err != nil || len(imp.Added) != 1 || imp.Added[0] == id {
		t.Fatalf("import overwrote original: %s", imported)
	}
	if a.provider(imp.Added[0]).Key != "secret-imported-key-123456789" {
		t.Fatal("confirmed import credential was not saved")
	}
	ip := a.provider(imp.Added[0])
	if ip.KeyName != "Team" || ip.KeyWeight != 7 || ip.KeyProtocol != provider.Responses {
		t.Fatal("credential replacement during import lost explicit key policies")
	}
	a.save(map[string]any{"id": "renamed", "from": id, "name": "Renamed"})
	if a.provider("renamed").Key != key {
		t.Fatal("rename lost saved credentials")
	}
	s := settings.Load()
	price, bad := s.ModelPrices["renamed/test-model"].Price()
	if s.ModelNames["renamed/test-model"] != "Custom model" || s.ModelAPIs["renamed/test-model"] != "responses" || bad != "" || price.CacheWrite1h != 2 || len(price.Tiers) != 1 || price.Tiers[0].Above != 200000 || s.ModelOutputs["renamed/test-model"] != 1024 || s.ModelCompacts["renamed/test-model"] != 24000 {
		t.Fatal("rename lost model overrides or extended prices")
	}
	if _, exists := s.ModelPrices[id+"/test-model"]; exists {
		t.Fatal("rename left price keyed by the old supplier id")
	}
	old := a.provider(id)
	if old.ID != "renamed" {
		t.Fatal("old model/provider ids no longer resolve after rename")
	}
}

func TestProviderInvalidPricesRejectBeforeWritesHTTP(t *testing.T) {
	a := newProviderHTTP(t)
	id := a.save(map[string]any{"new": true, "id": "priced", "name": "Priced", "chat": a.vendor + "/v1", "key": "secret-priced-key-123456789", "models": []string{"test-model"}})
	before, err := os.ReadFile(provider.Path())
	if err != nil {
		t.Fatal(err)
	}
	cases := []struct {
		name  string
		price map[string]any
		model string
	}{
		{"negative input", map[string]any{"input": -1, "output": 2, "cache_read": 0, "cache_write": 0}, "test-model"},
		{"negative one-hour cache", map[string]any{"input": 1, "output": 2, "cache_read": 0, "cache_write": 0, "cache_write_1h": -1}, "test-model"},
		{"duplicate tiers", map[string]any{"input": 1, "output": 2, "cache_read": 0, "cache_write": 0, "tiers": []map[string]any{{"above": 200000, "input": 3}, {"above": 200000, "input": 4}}}, "test-model"},
		{"unknown priced model", map[string]any{"input": 1, "output": 2, "cache_read": 0, "cache_write": 0}, "missing-model"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			check := a
			check.t = t
			check.call("POST", "provider/save", map[string]any{"id": "should-not-rename", "from": id, "name": "Should not save", "key": "replacement-key-that-must-not-save", "modelPrices": map[string]any{c.model: c.price}}, 400)
			after, err := os.ReadFile(provider.Path())
			if err != nil || !bytes.Equal(before, after) {
				t.Fatalf("invalid price changed saved supplier: %v", err)
			}
		})
	}
	a.call("POST", "provider/save", map[string]any{"new": true, "id": "bad-new", "name": "Bad new", "chat": a.vendor + "/v1", "key": "secret-invalid-new-123456789", "models": []string{"test-model"}, "modelPrefs": map[string]any{"test-model": map[string]any{"price": map[string]any{"input": -1}}}}, 400)
	after, err := os.ReadFile(provider.Path())
	if err != nil || !bytes.Equal(before, after) {
		t.Fatal("invalid new supplier price wrote a supplier")
	}
}

func TestProviderKeysAndSubscriptionBoundariesHTTP(t *testing.T) {
	a := newProviderHTTP(t)
	id := a.save(map[string]any{"new": true, "id": "keys", "name": "Keys", "chat": a.vendor + "/v1", "key": "secret-key-first-123456789", "models": []string{"test-model"}})
	a.call("POST", "keys/import", map[string]any{"id": id, "key": "secret-key-second-123456789\nsecret-key-third-123456789", "protocol": "chat"}, 200)
	var keys []provider.KeyInfo
	if err := json.Unmarshal(a.call("GET", "keys/"+id, nil, 200), &keys); err != nil || len(keys) != 3 {
		t.Fatal("multiple keys were not saved")
	}
	order := []string{keys[2].ID, keys[0].ID, keys[1].ID}
	a.call("POST", "keys/arrange", map[string]any{"id": id, "order": order}, 200)
	p := a.provider(id)
	if got := []string{p.KeyList()[0].ID, p.KeyList()[1].ID, p.KeyList()[2].ID}; !reflect.DeepEqual(got, order) {
		t.Fatal("key order was not saved")
	}
	a.call("POST", "keys/weight", map[string]any{"id": id, "ref": keys[1].ID, "weight": 5}, 200)
	a.call("POST", "keys/models", map[string]any{"id": id, "ref": keys[1].ID, "allow": []string{"test-model"}}, 200)
	a.call("POST", "keys/concurrency", map[string]any{"id": id, "ref": keys[1].ID, "limit": 2}, 200)
	p = a.provider(id)
	if p.KeyList()[2].Weight != 5 || p.AccountConcurrency[keys[1].ID] != 2 || !reflect.DeepEqual(p.AccountModels[keys[1].ID], []string{"test-model"}) {
		t.Fatal("per-key policies did not persist")
	}
	before, _ := os.ReadFile(provider.Path())
	a.call("POST", "keys/remove-many", map[string]any{"id": id, "refs": []string{keys[0].ID, keys[1].ID, keys[2].ID}}, 400)
	after, _ := os.ReadFile(provider.Path())
	if !bytes.Equal(before, after) {
		t.Fatal("rejected key deletion partially saved")
	}
	a.call("POST", "keys/off", map[string]any{"id": id, "ref": keys[0].ID}, 200)
	a.call("POST", "keys/off", map[string]any{"id": id, "ref": keys[1].ID}, 200)
	a.call("POST", "keys/remove-many", map[string]any{"id": id, "refs": []string{keys[0].ID, keys[1].ID}}, 200)
	if len(a.provider(id).KeyList()) != 1 {
		t.Fatal("paused keys were not removed")
	}
	a.call("POST", "accounts/settings", map[string]any{"id": "codex", "user": "a@example.invalid", "codexAutoReset": true, "codexCredits": false, "codexWarmAt": "09:30"}, 200)
	s := settings.Load()
	warmAt, warmSet := provider.CodexWarmAtOf("a@example.invalid")
	if !provider.CodexAutoReset("a@example.invalid") || provider.CodexCredits("a@example.invalid") || !warmSet || warmAt != "09:30" {
		t.Fatal("account maintenance settings did not persist")
	}
	a.call("POST", "accounts/settings", map[string]any{"id": "codex", "user": "", "codexCredits": true}, 400)
	if !reflect.DeepEqual(s.CodexNoCredits, settings.Load().CodexNoCredits) {
		t.Fatal("missing account changed settings")
	}
	a.call("GET", "signin/no-such-login", nil, 404)
	a.call("POST", "signin/no-such-login/callback", map[string]string{"url": "http://127.0.0.1/?code=not-real"}, 400)
	a.call("POST", "accounts/order", map[string]any{"id": "codex", "order": []string{"missing"}}, 400)
	a.call("POST", "quotas/checkin", map[string]any{"provider": "plugin:no-such-provider"}, 400)
	assertSecretsAbsent(t, a.call("GET", "state", nil, 200), "secret-key-first-123456789", "secret-key-second-123456789", "secret-key-third-123456789")
}
