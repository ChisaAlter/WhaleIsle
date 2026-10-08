package provider

import (
	"fmt"
	"strings"
	"time"
)

func earlierLogin(order, before int, seen, last time.Time) bool {
	if order != before {
		return order > 0 && (before == 0 || order < before)
	}
	return seen.After(last)
}

// WhaleBridgeSetAccountOrder changes this component's routing order without
// signing a native client into another account.
func WhaleBridgeSetAccountOrder(id string, order []string) error {
	p, err := Find(id)
	if err != nil {
		return err
	}
	if p.Account == nil {
		return SetAccountOrder(id, order)
	}
	if !p.IsPlugin() && (p.Account.Agent == "codex" || p.Account.Agent == "claude") {
		// Ordering uses a fresh read of the native sign-in, even while the
		// usual observation cache is warm. Only this component's list is written.
		rememberLogins(true)
	}
	agent, stored := p.Account.Agent, p.Account.Agent
	if p.IsPlugin() {
		agent, stored = p.ID, pluginAgent(*p.Account.plugin)
	}
	var available []string
	var first Login
	for _, l := range Logins(agent) {
		available = append(available, l.User)
		if len(order) > 0 && l.User == order[0] {
			first = l
		}
	}
	if err := validateAccountOrder(available, order); err != nil {
		return err
	}
	if !first.On || first.Paused {
		return fmt.Errorf("turn this account on before moving it first")
	}
	loginsMu.Lock()
	defer loginsMu.Unlock()
	ls := readLogins()
	rank := map[string]int{}
	for i, user := range order {
		rank[user] = i + 1
	}
	seen := map[string]bool{}
	for i := range ls {
		if ls[i].Agent == stored {
			if n, ok := rank[ls[i].User]; ok {
				ls[i].Order, seen[ls[i].User] = n, true
				ls[i].First = n == 1
			}
		}
	}
	for _, user := range order {
		if !seen[user] {
			return fmt.Errorf("accounts changed; reopen the provider and try again")
		}
	}
	// Component-owned Codex/Claude accounts use the saved first marker.
	// Their token holders and native client credential files stay in place.
	for i := range ls {
		if ls[i].Agent == stored && strings.EqualFold(ls[i].User, order[0]) {
			ls[i].On = true
		}
	}
	return writeLogins(ls)
}
