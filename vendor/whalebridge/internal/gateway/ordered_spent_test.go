package gateway

import (
	"net/http"
	"testing"
	"time"

	"github.com/yetone/magpie/internal/provider"
)

// In order, an account at 98% of its week is still tried in its turn, and
// a failure that isn't the vendor saying it's out rests it as any failure,
// not until the week renews; Smart keeps it for when nothing else can take
// a request, as before. A week used up is out either way (#530).
func TestOrderedKeepsAnAccountAt98(t *testing.T) {
	forgetRouting()
	old := allowances
	defer func() { allowances = old }()
	now := time.Now()
	week := now.Add(39 * time.Hour)
	allowances = func(string) map[string]provider.Allowance {
		return map[string]provider.Allowance{
			"low@x.com":  {{Used: 98, Resets: week, Span: 7 * 24 * time.Hour}, {Used: 0, Resets: now.Add(5 * time.Hour), Span: 5 * time.Hour}},
			"full@x.com": {{Used: 100, Resets: week, Span: 7 * 24 * time.Hour}},
		}
	}
	acct := func(routing, user string) candidate {
		return candidate{p: provider.Provider{ID: "codex", Routing: routing, Account: &provider.Account{Agent: "codex", User: user}}, model: "gpt-5.6-sol", rest: "codex#" + routing + user}
	}
	s := &Server{}
	near := func(d, want time.Duration) bool { return d > want-time.Minute && d <= want }

	if !acct(provider.Ordered, "low@x.com").full(now).IsZero() {
		t.Fatal("in order, an account at 98% counts as full")
	}
	if !acct("", "low@x.com").full(now).Equal(week) {
		t.Fatal("smart no longer counts an account at 98% as full")
	}
	if !acct(provider.Ordered, "full@x.com").full(now).Equal(week) {
		t.Fatal("in order, a week used up isn't full")
	}

	r := s.restAfter(acct(provider.Ordered, "low@x.com"), 502, http.Header{}, []byte("bad gateway"))
	if r.By != "backoff" || !near(time.Until(r.Until), fallbackCooldown) {
		t.Fatalf("in order, a failure at 98%% rests %v by %s", time.Until(r.Until), r.By)
	}
	r = s.restAfter(acct("", "low@x.com"), 502, http.Header{}, []byte("bad gateway"))
	if r.By != "window" || !near(time.Until(r.Until), 39*time.Hour) {
		t.Fatalf("smart, a failure at 98%% rests %v by %s", time.Until(r.Until), r.By)
	}
	// the vendor saying it's out rests it until then, in order too
	r = s.restAfter(acct(provider.Ordered, "full@x.com"), 429, http.Header{}, []byte(`{"error":{"message":"You've hit your usage limit"}}`))
	if r.Why != failQuota || r.By != "window" || !near(time.Until(r.Until), 39*time.Hour) {
		t.Fatalf("in order, used up rests %v by %s (%s)", time.Until(r.Until), r.By, r.Why)
	}
	// and with no window known full, until the quota rest
	r = s.restAfter(acct(provider.Ordered, "low@x.com"), 429, http.Header{}, []byte(`{"error":{"message":"You've hit your usage limit"}}`))
	if r.Why != failQuota || r.By != "quota" {
		t.Fatalf("in order, refused at 98%%: rests %v by %s (%s)", time.Until(r.Until), r.By, r.Why)
	}
}
