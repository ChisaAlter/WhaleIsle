package provider

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func parityHome(t *testing.T) string {
	t.Helper()
	h := t.TempDir()
	for k, v := range map[string]string{"HOME": h, "USERPROFILE": h, "APPDATA": filepath.Join(h, "roaming"), "LOCALAPPDATA": filepath.Join(h, "local"), "XDG_CONFIG_HOME": filepath.Join(h, "config"), "XDG_CACHE_HOME": filepath.Join(h, "cache"), "PATH": h, "LAUNCHER_COMPONENT_ID": "whalebridge"} {
		t.Setenv(k, v)
	}
	oldClaude, oldDevin := claudeExecutable, DevinExecutable
	claudeExecutable = func() string { return "" }
	DevinExecutable = func() string { return "" }
	ForgetAccounts()
	forgetClaudeCredential()
	t.Cleanup(func() {
		claudeExecutable, DevinExecutable = oldClaude, oldDevin
		ForgetAccounts()
		forgetClaudeCredential()
	})
	return h
}

func parityAuth(t *testing.T, user, workspace string) json.RawMessage {
	t.Helper()
	jwt := func(claims map[string]any) string {
		b, err := json.Marshal(claims)
		if err != nil {
			t.Fatal(err)
		}
		return "e30." + base64.RawURLEncoding.EncodeToString(b) + ".sig"
	}
	id := jwt(map[string]any{"email": user, "https://api.openai.com/auth": map[string]any{"chatgpt_plan_type": "pro", "chatgpt_account_id": workspace}})
	token := jwt(map[string]any{"exp": time.Now().Add(time.Hour).Unix()})
	b, err := json.Marshal(map[string]any{"auth_mode": "chatgpt", "tokens": map[string]any{"id_token": id, "access_token": token, "refresh_token": "refresh-" + workspace, "account_id": workspace}})
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func TestComponentAccountOrderPreservesNativeCredentials(t *testing.T) {
	parityHome(t)
	native := parityAuth(t, "native@example.com", "native")
	if err := os.MkdirAll(filepath.Dir(codexAuthPath()), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(codexAuthPath(), native, 0o600); err != nil {
		t.Fatal(err)
	}
	for _, user := range []string{"a@example.com", "b@example.com"} {
		if using, err := addLogin(savedLogin{Agent: "codex", User: user, Plan: "pro", On: true, Auth: parityAuth(t, user, user)}); err != nil || using {
			t.Fatalf("component sign in using=%v err=%v", using, err)
		}
	}
	order := []string{"b@example.com", "a@example.com", "native@example.com"}
	if err := WhaleBridgeSetAccountOrder("codex", order); err != nil {
		t.Fatal(err)
	}
	p, err := Find("codex")
	if err != nil {
		t.Fatal(err)
	}
	ranks := p.LoginRanks()
	if ranks[strings.ToLower(order[0])] != 1 || ranks[strings.ToLower(order[2])] != 3 {
		t.Fatalf("ranks=%v", ranks)
	}
	for _, l := range readLogins() {
		if l.Agent == "codex" && l.User == order[0] && (!l.First || l.Order != 1 || !l.Owned) {
			t.Fatalf("first saved account=%+v", l)
		}
	}
	var found bool
	for _, q := range p.AlsoOn() {
		if q.Account.User != order[0] {
			continue
		}
		tok, saved, err := q.Account.Token(context.Background())
		if err != nil || !saved || tok == "" {
			t.Fatalf("saved credential token=%q saved=%v err=%v", tok, saved, err)
		}
		found = true
	}
	if !found {
		t.Fatal("first routed account missing from AlsoOn")
	}
	after, err := os.ReadFile(codexAuthPath())
	if err != nil || !bytes.Equal(after, native) {
		t.Fatal("component account ordering changed native credentials")
	}
}

func TestComponentOrderIncludesCurrentNativeAccount(t *testing.T) {
	parityHome(t)
	if err := writeLogins([]savedLogin{{Agent: "codex", User: "saved@example.com", Plan: "pro", On: true, Owned: true, Auth: parityAuth(t, "saved@example.com", "saved")}}); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(codexAuthPath()), 0o700); err != nil {
		t.Fatal(err)
	}
	native := parityAuth(t, "new-native@example.com", "new-native")
	if err := os.WriteFile(codexAuthPath(), native, 0o600); err != nil {
		t.Fatal(err)
	}
	loginsMu.Lock()
	loginsSeenAt = time.Now()
	loginsMu.Unlock()
	if err := WhaleBridgeSetAccountOrder("codex", []string{"saved@example.com", "new-native@example.com"}); err != nil {
		t.Fatal(err)
	}
	after, err := os.ReadFile(codexAuthPath())
	if err != nil || !bytes.Equal(after, native) {
		t.Fatal("remembering current native account changed its credential file")
	}
}

func TestQuotaReadingOrderProtectsNewerCard(t *testing.T) {
	newer := SubscriptionQuota{Provider: "relay", User: "spare", Balance: "$10", readSeq: 3}
	kept := []SubscriptionQuota{newer}
	got := []SubscriptionQuota{{Provider: "relay", User: "spare", Balance: "$25"}, {Provider: "relay", User: "main", Balance: "$90"}}
	for _, partial := range []bool{false, true} {
		out := cacheCards(kept, got, 2, partial)
		if len(out) != 2 {
			t.Fatalf("partial=%v cards=%+v", partial, out)
		}
		for _, q := range out {
			if q.User == "spare" && q.Balance != "$10" {
				t.Fatalf("older read replaced newer card: %+v", q)
			}
		}
	}
}

func TestHeldReadingStopsHoldingAfterItsWindowReset(t *testing.T) {
	parityHome(t)
	lastQuotas.Lock()
	lastQuotas.loaded = false
	lastQuotas.m = nil
	lastQuotas.Unlock()
	past := time.Now().Add(-time.Minute)
	q := SubscriptionQuota{Provider: "codex", User: "test@example.com", Held: true, Windows: []QuotaWindow{{Used: 100, ResetsAt: &past}}}
	keepLast(q, q.User)
	q.Error = "HTTP 503 service unavailable"
	got := keepLast(q, q.User)
	if got.Held || got.AsOf == nil {
		t.Fatalf("stale card=%+v", got)
	}
}
