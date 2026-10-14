package provider

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func whaleBridgeAccountHome(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	native := filepath.Join(root, "native")
	t.Setenv("LAUNCHER_COMPONENT_ID", "whalebridge")
	t.Setenv("LAUNCHER_COMPONENT_DATA_DIR", filepath.Join(root, "component"))
	t.Setenv("HOME", native)
	t.Setenv("USERPROFILE", native)
	t.Setenv("CODEX_HOME", "")
	t.Setenv("CLAUDE_CONFIG_DIR", "")
	if err := os.MkdirAll(filepath.Join(native, ".codex"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := writeLogins(nil); err != nil {
		t.Fatal(err)
	}
	ForgetAccounts()
	t.Cleanup(ForgetAccounts)
	return native
}

func TestWhaleBridgeBorrowedCodexForgetKeepsNativeAndOwnedRelogin(t *testing.T) {
	native := whaleBridgeAccountHome(t)
	payload := base64.RawURLEncoding.EncodeToString([]byte(`{"email":"borrowed@example.test","https://api.openai.com/auth":{"chatgpt_account_id":"account-test","chatgpt_plan_type":"plus"}}`))
	auth := []byte(`{"auth_mode":"chatgpt","tokens":{"id_token":"e30.` + payload + `.signature","access_token":"native-access","refresh_token":"native-refresh","account_id":"account-test"}}`)
	path := filepath.Join(native, ".codex", "auth.json")
	if err := os.WriteFile(path, auth, 0600); err != nil {
		t.Fatal(err)
	}
	ls := Logins("codex")
	if len(ls) != 1 || !ls[0].Own {
		t.Fatalf("borrowed native account not exposed: %+v", ls)
	}
	user := ls[0].User
	stableID := LoginID("codex", user)
	if err := WhaleBridgeForgetLogin("codex", user); err != nil {
		t.Fatal(err)
	}
	rememberLogins(true)
	if got := Logins("codex"); len(got) != 0 {
		t.Fatalf("removed borrowed account was rediscovered: %+v", got)
	}
	if _, ok := codexAccount(native); ok {
		t.Fatal("removed native account still served by the component")
	}
	got, err := os.ReadFile(path)
	if err != nil || !bytes.Equal(got, auth) {
		t.Fatalf("native credential was changed: %v", err)
	}
	kept := readLogins()
	if len(kept) != 1 || kept[0].Hidden == "" {
		t.Fatal("component retained borrowed credential after removal")
	}
	for _, raw := range []json.RawMessage{kept[0].Auth, kept[0].Profile} {
		var value any
		if len(raw) > 0 {
			if err := json.Unmarshal(raw, &value); err != nil || value != nil {
				t.Fatal("component retained nonempty borrowed credential after removal")
			}
		}
	}
	owned := savedLogin{Agent: "codex", User: user, Plan: "plus", Auth: json.RawMessage(auth), Owned: true, On: true}
	if err := writeLogins(upsertLogin(kept, owned)); err != nil {
		t.Fatal(err)
	}
	if WhaleBridgeBorrowing("codex", user) {
		t.Fatal("new component sign-in classified as borrowed")
	}
	if LoginID("codex", user) != stableID {
		t.Fatal("relogin changed stable account id and loses account settings")
	}
	if len(Logins("codex")) != 1 {
		t.Fatal("explicit component sign-in did not restore hidden identity")
	}
	got, err = os.ReadFile(path)
	if err != nil || !bytes.Equal(got, auth) {
		t.Fatal("component relogin touched native credential")
	}
}

func TestWhaleBridgeCursorCurrentIdentityAndLocalToggle(t *testing.T) {
	whaleBridgeAccountHome(t)
	before := cursorStatus
	cursorStatus = &cliIdentity{name: "cursor", at: time.Now(), read: true, user: "cursor@example.test", plan: "pro", ok: true}
	t.Cleanup(func() { cursorStatus = before })
	ls := WhaleBridgeLogins("cursor")
	if len(ls) != 1 || ls[0].User != "cursor@example.test" || !ls[0].Own || !ls[0].On {
		t.Fatalf("current Cursor identity omitted: %+v", ls)
	}
	if err := WhaleBridgeSetLoginOn("cursor", ls[0].User, false); err != nil {
		t.Fatal(err)
	}
	ls = WhaleBridgeLogins("cursor")
	if len(ls) != 1 || ls[0].On || !ls[0].Paused {
		t.Fatalf("component stop did not appear: %+v", ls)
	}
	if err := WhaleBridgeSetLoginOn("cursor", ls[0].User, true); err != nil {
		t.Fatal(err)
	}
	ls = WhaleBridgeLogins("cursor")
	if len(ls) != 1 || !ls[0].On || ls[0].Paused {
		t.Fatal("component enable did not restore Cursor")
	}
}

func TestWhaleBridgeZCodeSpentSiblingDoesNotHoldLiveModel(t *testing.T) {
	ws := []QuotaWindow{{Name: "Trust Build", Used: 100}, {Name: "Start Plan", Used: 20}, {Name: "Other model", Used: 100}}
	zcodeAlternatives(ws, []zcodeBucket{{models: []string{"glm-5.3-flash"}, spent: true}, {models: []string{"glm-5.3-flash"}}, {models: []string{"other-model"}, spent: true}})
	if !ws[0].Aside || ws[1].Aside || ws[1].matches == nil || !ws[1].matches("GLM-5.3-Flash") {
		t.Fatal("spent alternative holds a model with a live bucket")
	}
	if ws[2].Aside || ws[2].matches == nil || !ws[2].matches("other-model") {
		t.Fatal("genuinely exhausted model no longer held")
	}
}
