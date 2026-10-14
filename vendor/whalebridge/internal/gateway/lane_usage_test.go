package gateway

import (
	"context"
	"testing"
	"time"

	"github.com/yetone/magpie/internal/provider"
	"github.com/yetone/magpie/internal/usage"
)

// A request turned away by a key's or account's queue answers 429 (that part
// works), and shows in the Routing trace and the recent-calls ring, but never
// reaches the usage ledger: the final write is guarded by `call.To != ""`
// (gateway.go:2155) and call.To is only set inside s.attempt, which a lane
// refusal never reaches (the attempt is gated on `err == nil`).
//
// Every other turn-away that happens before any provider was asked goes through
// turnedAway(), which does write a Rejected record: an unknown model, a usage
// cap, an account barred, a sealed subagent task. The same class of refusal
// should read the same in Usage and in a CSV export.
func TestQueueRefusalIsInTheUsageLedger(t *testing.T) {
	fresh(t)
	v, up := slowUp(t)
	one := 1
	if err := provider.Save(provider.Provider{ID: "slow", Name: "Slow", Key: "k", Models: []string{"m"}, Chat: up + "/v1", Anthropic: up,
		MaxConcurrency: &one, QueueLimit: 1, QueueWait: 1}); err != nil {
		t.Fatal(err)
	}
	g := newLaneRig(t)
	lane := func() Lane { return g.s.Lanes()["slow#"+provider.KeyID("k")] }

	// a takes the only slot, b waits behind it
	g.send(context.Background(), "/v1/chat/completions", "slow/m", "a")
	within(t, "a at the vendor", func() bool { return len(v.seen()) == 1 })
	g.send(context.Background(), "/v1/chat/completions", "slow/m", "b")
	within(t, "b queued", func() bool { return lane().Waiting == 1 })

	// c is turned away at once by the full queue
	g.send(context.Background(), "/v1/chat/completions", "slow/m", "c")
	r := g.reply()
	if r.tag != "c" || r.status != 429 {
		t.Fatalf("c = %+v, want a 429", r)
	}
	// the answer is out, so the ledger write is due
	time.Sleep(500 * time.Millisecond)

	// one entry in Recent calls and one row in the ledger, both saying the
	// request was turned away: it is one refusal, not two
	if n := recent429s(g.s); n != 1 {
		t.Errorf("%d recent-calls entries for the 429, want 1", n)
	}
	if n := ledger429s(); n != 1 {
		t.Errorf("%d rejected 429 rows in the usage ledger, want 1", n)
	}

	close(v.gate("a"))
	g.reply()
}

// recent429s is how many of the recent calls are the 429 the queue gave.
func recent429s(s *Server) int {
	n := 0
	for _, c := range s.Recent() {
		if c.Status == 429 {
			n++
		}
	}
	return n
}

// ledger429s is how many rejected 429 rows the ledger holds.
func ledger429s() int {
	n := 0
	for _, rec := range usage.Load(time.Time{}) {
		if rec.Status == 429 && rec.Rejected {
			n++
		}
	}
	return n
}

// The contrast that makes this a defect rather than a design choice: a refusal
// turned away the same way, for a model magpie does not know, does reach the
// ledger, because it goes through turnedAway().
func TestUnknownModelRefusalIsInTheUsageLedger(t *testing.T) {
	fresh(t)
	_, up := slowUp(t)
	if err := provider.Save(provider.Provider{ID: "slow", Name: "Slow", Key: "k", Models: []string{"m"}, Chat: up + "/v1"}); err != nil {
		t.Fatal(err)
	}
	g := newLaneRig(t)

	g.send(context.Background(), "/v1/chat/completions", "nope/nothing", "a")
	r := g.reply()
	if r.status == 200 {
		t.Fatalf("a = %+v, want a refusal", r)
	}
	time.Sleep(500 * time.Millisecond)

	for _, rec := range usage.Load(time.Time{}) {
		if rec.Rejected {
			return // an unknown model is logged as the failure it was
		}
	}
	t.Fatalf("an unknown model's refusal is in no usage record either (status %d): the contrast this test needs is gone", r.status)
}
