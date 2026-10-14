package usage

import (
	"math"
	"testing"

	"github.com/yetone/magpie/internal/catalog"
)

func TestRecordPricePreservesCacheDurationAndContextTier(t *testing.T) {
	p := catalog.Price{Input: 5, Output: 25, CacheRead: 0.5, CacheWrite: 6.25, CacheWrite1h: 10, Tiers: []catalog.Tier{{Above: 1000, Input: 10, Output: 50, CacheRead: 1, CacheWrite: 12.5, CacheWrite1h: 20}}}
	r := Record{Input: 100, Output: 20, CacheRead: 200, CacheWrite: 1000, CacheWrite1h: 300}
	want := (100*10.0 + 20*50.0 + 200*1.0 + 700*12.5 + 300*20.0) / 1e6
	if cost := r.CostAt(p); math.Abs(cost-want) > 1e-9 {
		t.Fatalf("cost=%v want=%v", cost, want)
	}
	var sum Totals
	sum.add(r, &p)
	if sum.CacheWrite1h != 300 || math.Abs(sum.Cost-want) > 1e-9 {
		t.Fatalf("totals=%+v", sum)
	}
}
