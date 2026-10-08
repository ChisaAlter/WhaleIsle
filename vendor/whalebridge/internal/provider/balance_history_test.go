package provider

import (
	"math"
	"testing"
	"time"
)

func balCard(user, balance string) SubscriptionQuota {
	return SubscriptionQuota{Provider: "deepseek", Name: "DeepSeek", User: user, Windows: []QuotaWindow{}, Balance: balance}
}

// TestBalanceHistoryRecords: each balance read is a point of its amount,
// by key; readings within five minutes are one point, a run of the same
// amount its first and last, and a failed balance, one kept from before or
// one told as several amounts isn't kept. Every card with a balance is
// given its trend, the stale one too.
func TestBalanceHistoryRecords(t *testing.T) {
	parityHome(t)
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	t0 := time.Date(2026, 10, 3, 8, 0, 0, 0, time.UTC)
	at := func(m int) time.Time { return t0.Add(time.Duration(m) * time.Minute) }
	note := func(m int, qs ...SubscriptionQuota) []SubscriptionQuota {
		noteBalanceHistory(qs, at(m))
		return qs
	}
	note(0, balCard("Main", "¥100.00"))
	note(1, balCard("Main", "¥99.90")) // within 5 min, still spending: moves it
	note(2, balCard("Main", "¥99.80"))
	note(10, balCard("Main", "¥99.00"))
	note(20, balCard("Main", "¥99.00")) // the same: the run's end moves
	note(30, balCard("Main", "¥99.00"))
	bad := balCard("Main", "")
	bad.Error = "401"
	stale := balCard("Main", "¥1.00")
	stale.AsOf = &t0
	parts := balCard("Main", "$5 / ¥30")
	parts.BalanceParts = []BalancePart{{Text: "$5"}, {Text: "¥30"}}
	got := note(40, bad, stale, parts, balCard("Other", "$3"))

	h := readBalanceHist()
	pts := h[quotaHistKey("deepseek", "main")]
	want := []BalancePoint{{at(0), 100}, {at(2), 99.8}, {at(10), 99}, {at(30), 99}}
	if len(pts) != len(want) {
		t.Fatalf("points = %+v, want %+v", pts, want)
	}
	for i := range want {
		if !pts[i].At.Equal(want[i].At) || pts[i].Amount != want[i].Amount {
			t.Fatalf("point %d = %+v, want %+v", i, pts[i], want[i])
		}
	}
	if o := h[quotaHistKey("deepseek", "other")]; len(o) != 1 || o[0].Amount != 3 {
		t.Fatalf("other key = %+v", o)
	}
	if got[1].BalanceTrend == nil || len(got[1].BalanceTrend.Points) != 4 {
		t.Fatalf("stale card's trend = %+v, want its key's points", got[1].BalanceTrend)
	}
	if got[0].BalanceTrend != nil || got[2].BalanceTrend != nil || got[3].BalanceTrend != nil {
		t.Fatalf("a failed card, one of several amounts and a key of one point have no trend: %+v", got)
	}
}

// TestBalanceTrendRunsOut: a balance spent evenly is fitted by least
// squares, from the last top-up on, and runs out where the line meets
// zero; one not spent, or one of too few points or too short a span, has
// no runs-out.
func TestBalanceTrendRunsOut(t *testing.T) {
	now := time.Date(2026, 10, 5, 12, 0, 0, 0, time.UTC)
	h := func(n float64) time.Time { return now.Add(time.Duration(-n * float64(time.Hour))) }
	// spent 10 a day for two days, with noise, after a top-up to 50
	pts := []BalancePoint{{h(96), 5}, {h(72), 3}, {h(48), 50}, {h(36), 45.2}, {h(24), 39.8}, {h(12), 35.1}, {h(0), 30}}
	tr := balanceTrend(pts, now)
	if tr == nil || len(tr.Points) != len(pts) {
		t.Fatalf("trend = %+v", tr)
	}
	if !tr.FitFrom.Equal(h(48)) {
		t.Fatalf("fit from %v, want the top-up at %v", tr.FitFrom, h(48))
	}
	if math.Abs(tr.PerDay-10) > 0.3 {
		t.Fatalf("per day = %v, want about 10", tr.PerDay)
	}
	if tr.RunsOut == nil || math.Abs(tr.RunsOut.Sub(now.Add(72*time.Hour)).Hours()) > 3 {
		t.Fatalf("runs out %v, want about 3 days from now", tr.RunsOut)
	}
	if math.Abs(tr.FitNow-30) > 0.5 || math.Abs(tr.FitStart-50) > 0.5 {
		t.Fatalf("fit %v → %v", tr.FitStart, tr.FitNow)
	}

	flat := []BalancePoint{{h(48), 20}, {h(24), 20}, {h(0), 20}}
	if tr := balanceTrend(flat, now); tr == nil || tr.RunsOut != nil || tr.PerDay != 0 {
		t.Fatalf("a balance not spent: %+v", tr)
	}
	topped := []BalancePoint{{h(48), 20}, {h(24), 10}, {h(0), 60}}
	if tr := balanceTrend(topped, now); tr == nil || tr.RunsOut != nil || tr.FitFrom != nil {
		t.Fatalf("just topped up: %+v", tr)
	}
	short := []BalancePoint{{now.Add(-20 * time.Minute), 10}, {now.Add(-10 * time.Minute), 9}, {now, 8}}
	if tr := balanceTrend(short, now); tr == nil || tr.RunsOut != nil {
		t.Fatalf("within an hour: %+v", tr)
	}
	slow := []BalancePoint{{h(48), 1000}, {h(24), 999.99}, {h(0), 999.98}}
	if tr := balanceTrend(slow, now); tr == nil || tr.RunsOut != nil || tr.PerDay <= 0 {
		t.Fatalf("runs out past a year isn't said: %+v", tr)
	}
	old := []BalancePoint{{now.Add(-20 * 24 * time.Hour), 10}, {h(0), 9}}
	if tr := balanceTrend(old, now); tr != nil {
		t.Fatalf("one point within the span shown: %+v", tr)
	}
}
