package provider

// A key's balance over time (TJHHHH on Discord): each balance magpie reads
// anyway (KeyBalances, a minute apart at most while something asks) is kept
// as a point — when it was read and the amount — so the balance's card can
// draw it, as the subscriptions' windows are (quota_history.go), and say
// when it runs out at the pace it has been spent: a least-squares line
// through the points since the last top-up, over the last balanceFitSpan.
//
// Kept in balance-history.json, by provider and key name: the amount only,
// no key and nothing else of the vendor's. A balance kept from before
// (AsOf), failed, or told as several amounts or a percent (BalanceParts)
// isn't one to keep. Points come at least balanceHistGap apart (a nearer one
// moves the last instead), and a run of the same amount is its first and
// last point only. Points older than balanceHistKept go, and a key keeps
// balanceHistMax.

import (
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"slices"
	"sync"
	"time"
)

const (
	balanceHistKept = 45 * 24 * time.Hour
	balanceHistMax  = 4000
	balanceHistGap  = 5 * time.Minute
	// the points a trend is drawn from, and fitted over
	balanceShowSpan = 14 * 24 * time.Hour
	balanceFitSpan  = 7 * 24 * time.Hour
	// a fit needs this many points, this far apart first to last
	balanceFitPoints = 3
	balanceFitMin    = time.Hour
	// a runs-out further than this isn't said
	balanceRunsOutMax = 365 * 24 * time.Hour
)

// BalancePoint is one reading of a balance: Amount was left at At.
type BalancePoint struct {
	At     time.Time `json:"at"`
	Amount float64   `json:"amount"`
}

// BalanceTrend is a balance's points over balanceShowSpan, oldest first,
// and the line fitted through the latest of them: spent PerDay a day,
// from FitFrom (the amount FitStart then) to now (FitNow), running out at
// RunsOut. With no fit (too few points, or a top-up just now) only Points.
type BalanceTrend struct {
	Points   []BalancePoint `json:"points"`
	FitFrom  *time.Time     `json:"fitFrom,omitempty"`
	FitStart float64        `json:"fitStart,omitempty"`
	FitNow   float64        `json:"fitNow,omitempty"`
	PerDay   float64        `json:"perDay,omitempty"`
	RunsOut  *time.Time     `json:"runsOut,omitempty"`
}

// balanceHist is the file: key ("provider|user") → points.
type balanceHist map[string][]BalancePoint

var balanceHistMu sync.Mutex

func balanceHistPath() string { return filepath.Join(filepath.Dir(Path()), "balance-history.json") }

func readBalanceHist() balanceHist {
	h := balanceHist{}
	if b, err := os.ReadFile(balanceHistPath()); err == nil {
		if json.Unmarshal(b, &h) != nil || h == nil {
			return balanceHist{}
		}
	}
	return h
}

func writeBalanceHist(h balanceHist) {
	b, err := json.Marshal(h)
	if err != nil {
		return
	}
	path := balanceHistPath()
	_ = os.MkdirAll(filepath.Dir(path), 0o700)
	_ = writeFileAtomic(path, b)
}

// addBalancePoint puts n after pts, the last moved to it when near, or in
// a run of the same amount.
func addBalancePoint(pts []BalancePoint, n BalancePoint) []BalancePoint {
	k := len(pts)
	if k > 0 && !n.At.After(pts[k-1].At) {
		return pts
	}
	if k >= 2 {
		p1, p2 := pts[k-2], pts[k-1]
		flat := n.Amount == p2.Amount && p2.Amount == p1.Amount
		// a top-up, or the first spending after one, keeps its point
		if flat || n.At.Sub(p1.At) < balanceHistGap && n.Amount <= p2.Amount && p2.Amount <= p1.Amount {
			pts[k-1] = n
			return pts
		}
	}
	return append(pts, n)
}

// balancePointOf is the point q's balance makes, if it is one to keep.
func balancePointOf(q SubscriptionQuota, now time.Time) (BalancePoint, bool) {
	if q.Error != "" || q.AsOf != nil || q.Provider == "" || q.Balance == "" || len(q.BalanceParts) > 0 {
		return BalancePoint{}, false
	}
	n, ok := BalanceNumber(q.Balance)
	if !ok {
		return BalancePoint{}, false
	}
	at := now
	if q.ReadAt != nil && !q.ReadAt.After(now) {
		at = *q.ReadAt
	}
	return BalancePoint{At: at.UTC().Truncate(time.Second), Amount: n}, true
}

// noteBalanceHistory keeps the balance each card among qs tells, and gives
// every card with a balance its trend.
func noteBalanceHistory(qs []SubscriptionQuota, now time.Time) {
	balanceHistMu.Lock()
	defer balanceHistMu.Unlock()
	var h balanceHist
	changed := false
	for _, q := range qs {
		if p, ok := balancePointOf(q, now); ok {
			if h == nil {
				h = readBalanceHist()
			}
			key := quotaHistKey(q.Provider, q.User)
			before := h[key]
			k := len(before)
			var last BalancePoint
			if k > 0 {
				last = before[k-1]
			}
			after := addBalancePoint(before, p)
			if len(after) != k || k > 0 && after[k-1] != last {
				changed = true
			}
			h[key] = after
		}
	}
	if changed {
		cut := now.Add(-balanceHistKept)
		for key, pts := range h {
			i, _ := slices.BinarySearchFunc(pts, cut, func(p BalancePoint, t time.Time) int { return p.At.Compare(t) })
			pts = pts[i:]
			if len(pts) > balanceHistMax {
				pts = pts[len(pts)-balanceHistMax:]
			}
			if len(pts) == 0 {
				delete(h, key)
			} else {
				h[key] = slices.Clip(pts)
			}
		}
		writeBalanceHist(h)
	}
	for i, q := range qs {
		if q.Balance == "" || len(q.BalanceParts) > 0 {
			continue
		}
		if h == nil {
			h = readBalanceHist()
		}
		qs[i].BalanceTrend = balanceTrend(h[quotaHistKey(q.Provider, q.User)], now)
	}
}

// balanceTrend is pts' trend at now, nil with fewer than two points shown.
func balanceTrend(pts []BalancePoint, now time.Time) *BalanceTrend {
	i, _ := slices.BinarySearchFunc(pts, now.Add(-balanceShowSpan), func(p BalancePoint, t time.Time) int { return p.At.Compare(t) })
	shown := slices.Clone(pts[i:])
	if len(shown) < 2 {
		return nil
	}
	tr := &BalanceTrend{Points: shown}
	// the points since the last top-up, within balanceFitSpan
	j := len(shown) - 1
	for j > 0 && shown[j-1].Amount >= shown[j].Amount && now.Sub(shown[j-1].At) <= balanceFitSpan {
		j--
	}
	fit := shown[j:]
	if len(fit) < balanceFitPoints || fit[len(fit)-1].At.Sub(fit[0].At) < balanceFitMin {
		return tr
	}
	// least squares, time in days from the fit's first point
	t0 := fit[0].At
	var sx, sy, sxx, sxy float64
	for _, p := range fit {
		x := p.At.Sub(t0).Hours() / 24
		sx, sy, sxx, sxy = sx+x, sy+p.Amount, sxx+x*x, sxy+x*p.Amount
	}
	n := float64(len(fit))
	den := n*sxx - sx*sx
	if den <= 0 {
		return tr
	}
	slope := (n*sxy - sx*sy) / den
	icept := (sy - slope*sx) / n
	from := t0
	xNow := now.Sub(t0).Hours() / 24
	tr.FitFrom, tr.FitStart, tr.FitNow = &from, round4(icept), round4(icept+slope*xNow)
	tr.PerDay = round4(-slope)
	if slope < 0 {
		days := -icept / slope // where the line meets zero
		out := t0.Add(time.Duration(days * 24 * float64(time.Hour)))
		if out.Before(now) {
			out = now
		}
		if out.Sub(now) <= balanceRunsOutMax {
			out = out.UTC().Truncate(time.Second)
			tr.RunsOut = &out
		}
	}
	return tr
}

func round4(v float64) float64 { return math.Round(v*1e4) / 1e4 }
