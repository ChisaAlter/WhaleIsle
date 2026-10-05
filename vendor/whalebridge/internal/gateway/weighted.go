package gateway

// Weighted routing (#841): a provider's requests spread over its keys by
// each key's weight, as NGINX's smooth weighted round robin does — keys
// weighing 3 and 1 go a, a, b, a, a, a, b, a…, the ratio held over a
// handful of requests rather than only on average. A key resting after a
// failure is left out of the round while it rests, so the others share
// its requests by their own weights and it takes up its share when it is
// back. A conversation still stays with the key that answered it while
// its affinity says (affinity.go); a request kept so counts against the
// key that took it, not the one the round picked (weightedKept), so new
// conversations make up the share.

import (
	"sync"

	"github.com/yetone/magpie/internal/provider"
)

// wrr is each weighted provider's round: every key's current weight, and
// the total the last pick was charged.
var wrr = struct {
	sync.Mutex
	m map[string]*wrrRound // provider id → its round
}{m: map[string]*wrrRound{}}

type wrrRound struct {
	cur   map[string]int // candidate rest → current weight
	total int
}

// keyWeight is a candidate's weight: its key's, 1 when none.
func keyWeight(c candidate) int { return max(c.p.KeyWeight, 1) }

// resting says whether c rests now, as restLast will find.
func resting(c candidate) bool {
	if _, ok := restOf(c.restKey()); ok {
		return true
	}
	if c.restID() != c.restKey() {
		_, ok := restOf(c.restID())
		return ok
	}
	return false
}

// weightedFirst puts first the key the provider id's round picks now, the
// others after it in their order, for failover.
func weightedFirst(id string, cs []candidate) []candidate {
	wrr.Lock()
	defer wrr.Unlock()
	r := wrr.m[id]
	if r == nil {
		r = &wrrRound{cur: map[string]int{}}
		wrr.m[id] = r
	}
	// keys no longer on are dropped from the round
	on := make(map[string]bool, len(cs))
	for _, c := range cs {
		on[c.rest] = true
	}
	for k := range r.cur {
		if !on[k] {
			delete(r.cur, k)
		}
	}
	best, total := -1, 0
	for i, c := range cs {
		if resting(c) {
			continue
		}
		w := keyWeight(c)
		r.cur[c.rest] += w
		total += w
		if best < 0 || r.cur[c.rest] > r.cur[cs[best].rest] {
			best = i
		}
	}
	if best < 0 {
		return cs // all resting: restLast orders them
	}
	r.cur[cs[best].rest] -= total
	r.total = total
	if best == 0 {
		return cs
	}
	return append(append([]candidate{cs[best]}, cs[:best]...), cs[best+1:]...)
}

// weightedKept moves the pick of picked's round to kept, when affinity
// keeps a conversation with kept, another key of the same weighted
// provider: the round counts the requests each key really took.
func weightedKept(picked, kept candidate) {
	if picked.p.Routing != provider.Weighted || picked.p.ID != kept.p.ID || picked.rest == kept.rest {
		return
	}
	wrr.Lock()
	defer wrr.Unlock()
	r := wrr.m[picked.p.ID]
	if r == nil {
		return
	}
	if _, ok := r.cur[kept.rest]; !ok {
		return
	}
	r.cur[picked.rest] += r.total
	r.cur[kept.rest] -= r.total
}
