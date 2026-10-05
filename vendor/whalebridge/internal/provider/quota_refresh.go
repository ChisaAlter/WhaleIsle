package provider

import (
	"context"
	"slices"
	"strings"
	"sync"
	"time"
)

// A card read again on its own, from its refresh button on the Usage page
// (Hu9956, #840: 只刷新单个套餐的用量): the provider's, and of the one
// account user when it has several ("" for every one). Only that card is
// asked for; the others stay as they were last read.
type cardRefresh struct{ provider, user string }

type cardRefreshKey struct{}

// refreshing is the card a read is for, when it is for one card alone.
func refreshing(ctx context.Context) (cardRefresh, bool) {
	r, ok := ctx.Value(cardRefreshKey{}).(cardRefresh)
	return r, ok
}

// wantsCard reports whether a read asks for the card of provider and
// account user: every card, unless it reads one again on its own.
func wantsCard(ctx context.Context, provider, user string) bool {
	r, ok := refreshing(ctx)
	return !ok || r.wants(provider, user)
}

func (r cardRefresh) wants(provider, user string) bool {
	return provider == r.provider && (r.user == "" || strings.EqualFold(user, r.user))
}

// refreshLogins is the accounts of ls a read asks for, each read afresh
// rather than from the minute's cache when it reads one card again.
func refreshLogins(ctx context.Context, ls []Login) []Login {
	r, ok := refreshing(ctx)
	if !ok {
		return ls
	}
	var out []Login
	for _, l := range ls {
		if r.user != "" && !strings.EqualFold(l.User, r.user) {
			continue
		}
		forgetLoginReading(l)
		out = append(out, l)
	}
	return out
}

// forgetLoginReading has l's next reading asked for, keeping what it was
// for a hiccup (as AskUsage does for every account).
func forgetLoginReading(l Login) {
	key := l.Agent + "/" + strings.ToLower(l.User)
	c := &loginUsageCache
	c.Lock()
	if e, ok := c.m[key]; ok {
		e.at = time.Time{}
		c.m[key] = e
	}
	c.Unlock()
}

// RefreshUsage reads the card of provider (of account user, "" for every
// account it has) again, whether a subscription's, a plan's or a key's
// balance, and keeps it with the others, which aren't asked. The next
// Quotas has it.
func RefreshUsage(ctx context.Context, provider, user string) {
	r := cardRefresh{provider, user}
	ctx = context.WithValue(ctx, cardRefreshKey{}, r)
	if provider == "claude" {
		// Claude Code's /usage, run when the user asks (claudeWindows)
		claudeAsked.Store(time.Now().UnixNano())
	}
	var wg sync.WaitGroup
	wg.Add(3)
	go func() { defer wg.Done(); PlanQuotas(ctx) }()
	go func() { defer wg.Done(); KeyBalances(ctx) }()
	go func() {
		defer wg.Done()
		out := fetchSubscriptionUsage(ctx)
		now := time.Now()
		noteDailyCredits(out, now)
		noteQuotaHistory(out, now)
		c := &subscriptionUsageCache
		c.Lock()
		c.data = mergeCards(c.data, out)
		c.Unlock()
	}()
	wg.Wait()
}

// mergeCards is the cards of kept with each of got in place of the one of
// its provider and account, or after them when it is new. Nothing kept,
// nothing is: the next read reads every card.
func mergeCards(kept, got []SubscriptionQuota) []SubscriptionQuota {
	if kept == nil {
		return nil
	}
	out := slices.Clone(kept)
	for _, g := range got {
		i := slices.IndexFunc(out, func(q SubscriptionQuota) bool {
			return q.Provider == g.Provider && strings.EqualFold(q.User, g.User)
		})
		if i < 0 {
			out = append(out, g)
		} else {
			out[i] = g
		}
	}
	return out
}
