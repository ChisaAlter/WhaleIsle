package provider

import (
	"fmt"
	"os"
	"slices"
	"strings"
)

// WhaleBridgeLogins includes Cursor's single native login. Its upstream
// adapter supplies a saved-account list only after an explicit migration.
func WhaleBridgeLogins(id string) []Login {
	if id != "cursor" || Moved(id) {
		return Logins(id)
	}
	p, err := Find(id)
	if err != nil || p.Account == nil {
		return []Login{}
	}
	return []Login{{Agent: id, User: p.Account.User, Plan: p.Account.Plan, Active: true, On: !p.Off, Paused: p.Off, Own: true}}
}

// WhaleBridgeBorrowing identifies credentials the component did not issue.
// Reading a native credential does not authorize moving or rewriting it.
func WhaleBridgeBorrowing(id, user string) bool {
	if id == "cursor" && !Moved(id) {
		return true
	}
	if id == "claude" || id == "codex" {
		loginsMu.Lock()
		defer loginsMu.Unlock()
		for _, l := range readLogins() {
			if l.Agent == id && strings.EqualFold(l.User, user) {
				return !l.Owned
			}
		}
		return true
	}
	for _, l := range Logins(id) {
		if strings.EqualFold(l.User, user) {
			return l.Own
		}
	}
	return false
}

func whaleBridgeHiddenLogin(id, user string) bool {
	if os.Getenv("LAUNCHER_COMPONENT_ID") != "whalebridge" {
		return false
	}
	return slices.ContainsFunc(readLogins(), func(l savedLogin) bool { return l.Agent == id && strings.EqualFold(l.User, user) && l.Hidden != "" })
}

func WhaleBridgeSetLoginOn(id, user string, on bool) error {
	if id == "cursor" && !Moved(id) {
		p, err := Find(id)
		if err != nil {
			return err
		}
		if p.Account == nil || !strings.EqualFold(p.Account.User, user) {
			return fmt.Errorf("no Cursor account %q", user)
		}
		return SetOff(id, !on)
	}
	return SetLoginOn(id, user, on)
}

// A borrowed native credential is forgotten in this component, never signed
// out or deleted in its owner. A new component sign-in replaces this marker.
func WhaleBridgeForgetLogin(id, user string) error {
	if id == "cursor" && !Moved(id) {
		return Delete(id)
	}
	if (id != "claude" && id != "codex") || !WhaleBridgeBorrowing(id, user) {
		return ForgetLogin(id, user)
	}
	loginsMu.Lock()
	ls := readLogins()
	found := false
	for i := range ls {
		if ls[i].Agent == id && strings.EqualFold(ls[i].User, user) {
			ls[i].Hidden = "whalebridge"
			ls[i].Auth = nil
			ls[i].Profile = nil
			ls[i].On = false
			ls[i].First = false
			ls[i].Held = false
			found = true
		}
	}
	if !found {
		loginsMu.Unlock()
		return fmt.Errorf("no saved %s account %q", id, user)
	}
	err := writeLogins(ls)
	loginsMu.Unlock()
	if err == nil {
		ForgetAccounts()
	}
	return err
}
