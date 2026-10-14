package catalog

import (
	"encoding/json"
	"math"
	"testing"
)

func near(a, b float64) bool { return math.Abs(a-b) < 1e-9 }

// PAMI on Discord: OpenAI bills gpt-6-astra over 272K input at 2× input and
// cache, 1.5× output, the whole request; models.dev lists it as a tier of
// type "context". The tier is read, the whole call billed at it once its
// input with the cached tokens in it is over the size, and not at it
// otherwise.
func TestPriceTiers(t *testing.T) {
	writeCatalog(t, `{"openai":{"id":"openai","models":{"gpt-6-astra":{"id":"gpt-6-astra","cost":{
		"input":10,"output":50,"cache_read":1,"cache_write":12.5,
		"tiers":[{"input":20,"output":75,"cache_read":2,"cache_write":25,"tier":{"type":"context","size":272000}},
			{"input":99,"tier":{"type":"time","size":5}}]}}}},
	"anthropic":{"id":"anthropic","models":{"claude-opus-5-5":{"id":"claude-opus-5-5","cost":{"input":5,"output":25,"cache_read":0.5,"cache_write":6.25}}}}}`)
	p, ok := PriceOf("openai", "gpt-6-astra")
	if !ok {
		t.Fatal("no price")
	}
	if want := []Tier{{Above: 272000, Input: 20, Output: 75, CacheRead: 2, CacheWrite: 25}}; len(p.Tiers) != 1 || p.Tiers[0] != want[0] {
		t.Fatalf("tiers = %+v, want %+v (a tier of another type left out)", p.Tiers, want)
	}
	// 200K input, 72K of it cached: exactly 272K is not over it
	if got, want := p.Cost(200_000, 1000, 72_000, 0), (200_000*10.0+1000*50+72_000*1)/1e6; !near(got, want) {
		t.Errorf("at 272K: %v, want the base %v", got, want)
	}
	// one more cached token: the whole call at the tier
	if got, want := p.Cost(200_000, 1000, 72_001, 0), (200_000*20.0+1000*75+72_001*2)/1e6; !near(got, want) {
		t.Errorf("over 272K: %v, want the tier's %v", got, want)
	}
	// cache writes count toward the size too
	if got, want := p.Cost(100, 10, 0, 300_000), (100*20.0+10*75+300_000*25)/1e6; !near(got, want) {
		t.Errorf("written over 272K: %v, want %v", got, want)
	}
	if b := p.At(0); len(b.Tiers) != 0 || b.Input != 10 {
		t.Errorf("At(0) = %+v, want the base price without tiers", b)
	}
	if r := p.Times(0.5); r.Tiers[0].Input != 10 || r.Tiers[0].Above != 272000 {
		t.Errorf("Times = %+v, the tier halved too", r)
	}

	// a Claude list price is given its 1-hour cache write, 2× input
	c, _ := PriceOf("anthropic", "claude-opus-5-5")
	if c.CacheWrite1h != 10 {
		t.Errorf("claude 1h = %v, want 10", c.CacheWrite1h)
	}
	if p.CacheWrite1h != 0 {
		t.Errorf("gpt 1h = %v, want none", p.CacheWrite1h)
	}
}

// Anthropic bills a 1-hour cache write at 2× input and a 5-minute one at
// 1.25×: a call's 1-hour writes at theirs, the price's own else the
// 5-minute one (PAMI on Discord: not 2× input for a model with no 1-hour
// writes at all), and a call from before the split was kept (none for 1
// hour) as before. A Claude model's price is given 2× input.
func TestCostSplit(t *testing.T) {
	p := Price{Input: 5, Output: 25, CacheRead: 0.5, CacheWrite: 6.25}
	if got, want := p.CostSplit(1000, 100, 0, 3000, 1000), (1000*5.0+100*25+3000*6.25)/1e6; !near(got, want) {
		t.Errorf("unset 1h: %v, want %v, every write at the 5-minute price", got, want)
	}
	c := p
	OneHourFor("claude-sonnet-5-5", &c)
	if got, want := c.CostSplit(1000, 100, 0, 3000, 1000), (1000*5.0+100*25+2000*6.25+1000*10)/1e6; !near(got, want) {
		t.Errorf("claude unset 1h: %v, want %v", got, want)
	}
	g := p
	OneHourFor("gpt-6-astra", &g)
	if g.CacheWrite1h != 0 {
		t.Errorf("gpt given a 1-hour write: %v", g.CacheWrite1h)
	}
	p.CacheWrite1h = 8
	if got, want := p.CostSplit(1000, 100, 0, 3000, 1000), (1000*5.0+100*25+2000*6.25+1000*8)/1e6; !near(got, want) {
		t.Errorf("1h given: %v, want %v", got, want)
	}
	if got, want := p.CostSplit(1000, 100, 0, 3000, 0), p.Cost(1000, 100, 0, 3000); got != want {
		t.Errorf("no 1h: %v, want Cost's %v", got, want)
	}
	// more 1h than written is held to what was written
	if got, want := p.CostSplit(0, 0, 0, 10, 50), 10*8/1e6; !near(got, want) {
		t.Errorf("clamped: %v, want %v", got, want)
	}
}

// A price magpie saved before tiers and the 1-hour write reads as it did,
// and one with them reads back the same.
func TestPriceJSON(t *testing.T) {
	var old Price
	if err := json.Unmarshal([]byte(`{"input":1,"output":2,"cache_read":0.1,"cache_write":0}`), &old); err != nil {
		t.Fatal(err)
	}
	if !old.Same(Price{Input: 1, Output: 2, CacheRead: 0.1}) {
		t.Errorf("old = %+v", old)
	}
	p := Price{Input: 10, Output: 50, CacheRead: 1, CacheWrite: 12.5, CacheWrite1h: 20, Tiers: []Tier{{Above: 272000, Input: 20, Output: 75, CacheRead: 2, CacheWrite: 25}}}
	b, _ := json.Marshal(p)
	var back Price
	if err := json.Unmarshal(b, &back); err != nil || !back.Same(p) {
		t.Errorf("round trip %s = %+v, %v", b, back, err)
	}
	// a part a tier leaves out is the base price's
	var part Price
	if err := json.Unmarshal([]byte(`{"input":1,"output":2,"cache_read":0.1,"cache_write":0.5,"tiers":[{"above":1000,"input":3}]}`), &part); err != nil {
		t.Fatal(err)
	}
	if want := (Tier{Above: 1000, Input: 3, Output: 2, CacheRead: 0.1, CacheWrite: 0.5}); len(part.Tiers) != 1 || part.Tiers[0] != want {
		t.Errorf("part = %+v, want %+v", part.Tiers, want)
	}
}
