package settings

import (
	"encoding/json"
	"math"
	"strings"
	"testing"

	"github.com/yetone/magpie/internal/catalog"
)

// A price with a long-context tier and a 1-hour cache write is kept and read
// back whole; one written before either reads as before, its 1-hour write
// unset (2× input); a tier not above the one before it, or with a bad part,
// is refused by name.
func TestModelPriceTiers(t *testing.T) {
	p := catalog.Price{Input: 10, Output: 50, CacheRead: 1, CacheWrite: 12.5, CacheWrite1h: 20,
		Tiers: []catalog.Tier{{Above: 272000, Input: 20, Output: 75, CacheRead: 2, CacheWrite: 25}}}
	b, err := json.Marshal(StatedPrice(p))
	if err != nil {
		t.Fatal(err)
	}
	var back ModelPrice
	if err := json.Unmarshal(b, &back); err != nil {
		t.Fatal(err)
	}
	if got, bad := back.Price(); bad != "" || !got.Same(p) {
		t.Errorf("read back %s as %+v, %q; want %+v", b, got, bad, p)
	}

	var old ModelPrice
	if err := json.Unmarshal([]byte(`{"input":1,"output":2,"cache_read":0.1,"cache_write":0}`), &old); err != nil {
		t.Fatal(err)
	}
	if got, bad := old.Price(); bad != "" || !got.Same(catalog.Price{Input: 1, Output: 2, CacheRead: 0.1}) || got.OneHour() != 0 {
		t.Errorf("an old price = %+v, %q", got, bad)
	}
	if b, _ := json.Marshal(StatedPrice(catalog.Price{Input: 1, Output: 2})); strings.Contains(string(b), "cache_write_1h") || strings.Contains(string(b), "tiers") {
		t.Errorf("a price without either is written %s, as before", b)
	}

	for name, m := range map[string]ModelPrice{
		"tier 2":             {Tiers: []catalog.Tier{{Above: 272000, Input: 1}, {Above: 272000, Input: 2}}},
		"tier 1":             {Tiers: []catalog.Tier{{Above: 0, Input: 1}}},
		"tier 1 ":            {Tiers: []catalog.Tier{{Above: 1000, Input: math.NaN()}}},
		"1-hour cache write": {CacheWrite1h: new(-1.0)},
	} {
		m.Input, m.Output, m.CacheRead, m.CacheWrite = new(1.0), new(2.0), new(0.0), new(0.0)
		if _, bad := m.Price(); bad != strings.TrimSpace(name) {
			t.Errorf("%s: bad = %q", name, bad)
		}
		if err := CheckModelPrice("relay/x", m); err == nil {
			t.Errorf("%s: no error", name)
		}
	}
}
