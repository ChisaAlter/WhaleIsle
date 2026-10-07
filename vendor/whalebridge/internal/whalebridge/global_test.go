package whalebridge

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/yetone/magpie/internal/backup"
	"github.com/yetone/magpie/internal/davsync"
	"github.com/yetone/magpie/internal/provider"
	"github.com/yetone/magpie/internal/settings"
	"github.com/yetone/magpie/internal/usage"
)

func TestGlobalSettingsPatchPreservesSecretsAndPrivateAccess(t *testing.T) {
	a := newProviderHTTP(t)
	s := settings.Load()
	s.OTel.Headers = map[string]string{"Authorization": "stored-secret"}
	s.LANKey = "local-caller-key"
	if err := settings.Save(s); err != nil {
		t.Fatal(err)
	}
	a.call("POST", "global/settings", map[string]any{"currency": "cny", "searchFirst": "api", "redact": true, "usageAlert": 80, "otel": map[string]any{"endpoint": "http://127.0.0.1:4318", "metrics": true}, "lan": true, "lanKey": "replaced"}, 200)
	s = settings.Load()
	if s.Currency != "cny" || s.SearchFirst != "api" || !s.Redact || s.UsageAlert != 80 || s.OTel.Headers["Authorization"] != "stored-secret" || s.LANKey != "local-caller-key" || s.LAN {
		t.Fatalf("patch lost values or changed private access: %+v", s)
	}
	a.call("POST", "global/settings", map[string]any{"otel": map[string]any{"headers": map[string]any{"Authorization": nil, "X-Key": "new"}}}, 200)
	if s = settings.Load(); s.OTel.Headers["X-Key"] != "new" || s.OTel.Headers["Authorization"] != "" {
		t.Fatal("header patch did not remove/add the intended values")
	}
	a.call("POST", "global/settings", map[string]any{"requestArchive": true}, 400)
	// Inherited upstream flags must not widen this component to native
	// client sessions; gateway metadata overrides remain effective.
	t.Setenv("MAGPIE_OTEL_METRICS", "false")
	for _, inherited := range []string{"true", "invalid"} {
		t.Setenv("MAGPIE_OTEL_SESSIONS", inherited)
		effective, err := settings.OTelExport()
		if err != nil || effective.Sessions || effective.Metrics {
			t.Fatalf("inherited session flag changed component export scope: %+v, %v", effective, err)
		}
	}
}

func TestSupplierBackupSelectiveRestoreAndForeignSections(t *testing.T) {
	a := newProviderHTTP(t)
	if err := provider.Save(provider.Provider{ID: "fixture", Name: "Fixture", Chat: a.vendor + "/v1/chat/completions", Key: "fixture-secret", Models: []string{"test-model"}, Contexts: map[string]int{"*": 500000}}); err != nil {
		t.Fatal(err)
	}
	if err := provider.SetSearchAPI(provider.SearchAPI{Vendor: "brave", Key: "search-secret"}); err != nil {
		t.Fatal(err)
	}
	if err := provider.SetModelCompacts("fixture", map[string]int{"test-model": 128000}); err != nil {
		t.Fatal(err)
	}
	data := a.call("POST", "backup/export", map[string]any{"pass": "separate-backup-pass", "keys": true}, 200)
	if bytes.Contains(data, []byte("fixture-secret")) {
		t.Fatal("backup is not encrypted")
	}
	b, err := backup.Open(data, "separate-backup-pass")
	if err != nil {
		t.Fatal(err)
	}
	if len(b.Providers) != 1 || len(*b.Searches) != 1 || len(b.Agents) != 0 || b.Library != nil || len(b.Profiles) != 0 || b.GatewayKeys != nil {
		t.Fatalf("wrong supplier backup scope: %+v", b)
	}
	if _, err := backup.Open(data, "wrong-password"); err == nil {
		t.Fatal("wrong backup passphrase accepted")
	}
	if err := provider.Delete("fixture"); err != nil {
		t.Fatal(err)
	}
	s := settings.Load()
	s.Currency = "cny"
	if err := settings.Save(s); err != nil {
		t.Fatal(err)
	}
	a.call("POST", "backup/import", map[string]any{"pass": "separate-backup-pass", "data": base64.StdEncoding.EncodeToString(data), "providers": true, "settings": false}, 200)
	p, err := provider.Find("fixture")
	if err != nil || p.Key != "fixture-secret" {
		t.Fatalf("supplier not restored: %v", err)
	}
	if settings.Load().Currency != "cny" {
		t.Fatal("unselected settings restored")
	}
	profile, err := os.ReadFile(profilePath(os.Getenv("WHALEBRIDGE_DSH_HOME")))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(profile, []byte("compactionThreshold: 128000")) {
		t.Fatalf("saved threshold was not projected to DSH: %s", profile)
	}
}

func TestSupplierSyncPreservesForeignRemoteSections(t *testing.T) {
	a := newProviderHTTP(t)
	var mu sync.Mutex
	var stored []byte
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		switch r.Method {
		case "MKCOL":
			w.WriteHeader(201)
		case "GET":
			if stored == nil {
				w.WriteHeader(404)
				return
			}
			w.Header().Set("ETag", `"fixture"`)
			w.Write(stored)
		case "PUT":
			stored, _ = io.ReadAll(r.Body)
			w.Header().Set("ETag", `"fixture"`)
			w.WriteHeader(201)
		default:
			w.WriteHeader(405)
		}
	}))
	defer server.Close()
	opaque := json.RawMessage(`{"servers":[{"id":"do-not-change"}]}`)
	remoteUI := json.RawMessage(`{"family":"Remote UI","name":"Remote UI Regular","weight":400,"style":"normal","stretch":100}`)
	remoteCode := json.RawMessage(`{"family":"Remote Code","name":"Remote Code Italic","weight":400,"style":"italic","stretch":100}`)
	localUI := json.RawMessage(`{"family":"Local UI","name":"Local UI Regular","weight":500,"style":"normal","stretch":100}`)
	localCode := json.RawMessage(`{"family":"Local Code","name":"Local Code Regular","weight":400,"style":"normal","stretch":100}`)
	local := settings.Load()
	local.UIFont, local.CodeFont = localUI, localCode
	if err := settings.Save(local); err != nil {
		t.Fatal(err)
	}
	b := backup.Bundle{Version: backup.BundleVersion, Created: time.Now(), Settings: &settings.Settings{Currency: "usd", UIFont: remoteUI, CodeFont: remoteCode}, Library: &opaque, Profiles: map[string]json.RawMessage{"external": json.RawMessage(`{"model":"external/model"}`)}, Agents: map[string]string{"external.model": "preserve"}}
	var err error
	stored, err = backup.Seal(b, "sync-pass")
	if err != nil {
		t.Fatal(err)
	}
	no := false
	if err = davsync.Configure(davsync.Config{URL: server.URL + "/sync", Passphrase: "sync-pass", Keys: true, Library: &no}); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err = davsync.SyncNow(ctx); err != nil {
		t.Fatal(err)
	}
	local = settings.Load()
	if !bytes.Equal(local.UIFont, localUI) || !bytes.Equal(local.CodeFont, localCode) {
		t.Fatal("settings restore replaced this computer's opaque font choices")
	}
	if err = provider.Save(provider.Provider{ID: "fixture", Name: "Fixture", Chat: a.vendor, Models: []string{"test-model"}}); err != nil {
		t.Fatal(err)
	}
	if err = davsync.SyncNow(ctx); err != nil {
		t.Fatal(err)
	}
	mu.Lock()
	data := bytes.Clone(stored)
	mu.Unlock()
	result, err := backup.Open(data, "sync-pass")
	if err != nil {
		t.Fatal(err)
	}
	if result.Library == nil || !bytes.Equal(*result.Library, opaque) || result.Agents["external.model"] != "preserve" || len(result.Profiles) != 1 {
		t.Fatal("supplier sync destroyed excluded remote sections")
	}
	if result.Settings == nil || !bytes.Equal(result.Settings.UIFont, remoteUI) || !bytes.Equal(result.Settings.CodeFont, remoteCode) {
		t.Fatal("provider-only backup round trip destroyed remote opaque font choices")
	}
	local = settings.Load()
	local.Currency = "cny"
	if err = settings.Save(local); err != nil {
		t.Fatal(err)
	}
	if err = davsync.SyncNow(ctx); err != nil {
		t.Fatal(err)
	}
	mu.Lock()
	data = bytes.Clone(stored)
	mu.Unlock()
	result, err = backup.Open(data, "sync-pass")
	if err != nil {
		t.Fatal(err)
	}
	if result.Settings == nil || result.Settings.Currency != "cny" || !bytes.Equal(result.Settings.UIFont, remoteUI) || !bytes.Equal(result.Settings.CodeFont, remoteCode) {
		t.Fatal("settings merge overwrote remote opaque font choices")
	}
	local = settings.Load()
	if !bytes.Equal(local.UIFont, localUI) || !bytes.Equal(local.CodeFont, localCode) {
		t.Fatal("settings sync changed this computer's opaque font choices")
	}
}

func TestUsageLedgerAccountKeyAndCSV(t *testing.T) {
	a := newProviderHTTP(t)
	usage.Append(usage.Record{Time: time.Now(), Provider: "fixture", ProviderAccount: "account@example.test", ProviderKeyID: "fingerprint", ProviderKeyName: "key-name", Model: "test-model", Input: 42, Output: 8, CacheRead: 11, Status: 502, Error: "known-failure", TTFT: 123, Millis: 321})
	data := a.call("GET", "requests?period=all&failed=1&account=account@example.test", nil, 200)
	if !bytes.Contains(data, []byte("known-failure")) || !bytes.Contains(data, []byte("account@example.test")) || !bytes.Contains(data, []byte("key-name")) {
		t.Fatalf("ledger attribution/filter missing: %s", data)
	}
	csv := a.call("GET", "requests/export?period=all&failed=1", nil, 200)
	if !strings.Contains(string(csv), "known-failure") || !strings.Contains(string(csv), "42") {
		t.Fatalf("CSV did not export filtered request: %s", csv)
	}
}

func TestBackgroundSupplierChangeUpdatesDSH(t *testing.T) {
	a := newProviderHTTP(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	stop := watchDSHCatalog(ctx)
	defer stop()
	if err := provider.Save(provider.Provider{ID: "background", Name: "Background", Chat: a.vendor, Models: []string{"new-model"}}); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		b, _ := os.ReadFile(profilePath(os.Getenv("WHALEBRIDGE_DSH_HOME")))
		if bytes.Contains(b, []byte("background/new-model")) {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("background supplier change did not update DSH: %s", dshSyncError())
}
