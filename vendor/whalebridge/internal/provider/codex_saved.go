package provider

import (
	"context"
	"encoding/json"
	"strings"
	"time"
)

// codexStandIn picks a usable saved sign-in when the native client has
// none. Enabled accounts lead, then the one most recently signed in.
func codexStandIn(ls []savedLogin) string {
	user, best := "", -1
	var seen time.Time
	for _, l := range ls {
		if l.Agent != "codex" {
			continue
		}
		var a codexAuth
		if json.Unmarshal(l.Auth, &a) != nil || a.Tokens.AccessToken == "" || a.AuthMode == "apikey" {
			continue
		}
		rank := 0
		if l.Lapsed == "" {
			rank = 2
			if l.On {
				rank++
			}
		}
		if rank > best || rank == best && l.Seen.After(seen) {
			user, seen, best = l.User, l.Seen, rank
		}
	}
	return user
}

func codexStandInAccount() (Provider, bool) {
	loginsMu.Lock()
	ls := readLogins()
	loginsMu.Unlock()
	user := codexStandIn(ls)
	if user == "" {
		return Provider{}, false
	}
	plan := ""
	for _, l := range ls {
		if l.Agent == "codex" && strings.EqualFold(l.User, user) {
			plan = l.Plan
		}
	}
	return codexSavedAccount(user, plan), true
}

func codexSavedAccount(user, plan string) Provider {
	a := &Account{Agent: "codex", Stream: true, User: user, Plan: plan, standIn: true}
	a.token = func(ctx context.Context) (string, error) {
		tok, _, err := savedLoginToken(ctx, "codex", user)
		return tok, err
	}
	return codexProvider(a, func(ctx context.Context) (string, string, error) { return savedLoginToken(ctx, "codex", user) })
}
