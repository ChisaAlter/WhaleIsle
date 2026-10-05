package gateway

import (
	"context"
	"net/http"
	"sync"

	"github.com/yetone/magpie/internal/provider"
)

// A provider's MaxConcurrency (Discord, Lemon: a Codex account is
// risk-controlled past five or six requests at once) is how many requests
// may be out at the vendor at once on each of its keys or accounts — the
// key, the account, else the provider: a candidate's who(). One more waits
// in a queue of no bound, in the order it came, and is sent when one out
// is done: its reply read to the end, or the agent gone. A request whose
// agent goes away while it waits leaves the queue and is never sent.
//
// Waiting is not failing: a request queued is never passed to a fallback
// or another member of its routing group for want of a free slot, and the
// key or account it waits for doesn't rest. That is what the setting is
// for — the vendor sees no more than that many — and what is waited is
// told in the route's try (Try.Queued).

// lanes are the slots of each key or account with a limit.
type lanes struct {
	mu sync.Mutex
	m  map[string]*lane
}

// lane is one key's or account's: how many are out, and who waits, first
// first.
type lane struct {
	limit int
	busy  int
	queue []chan struct{}
}

// acquire waits for one of who's limit slots, in turn. It answers the
// release, to call once the request is done with the vendor, and false
// with no slot taken when ctx ended first. A limit of 0 takes no slot.
func (l *lanes) acquire(ctx context.Context, who string, limit int) (release func(), ok bool) {
	l.mu.Lock()
	if l.m == nil {
		l.m = map[string]*lane{}
	}
	ln := l.m[who]
	if limit <= 0 {
		if ln != nil {
			// the limit was lifted: whoever waits goes now
			ln.limit = 0
			ln.grant()
		}
		l.mu.Unlock()
		return func() {}, true
	}
	if ln == nil {
		ln = &lane{}
		l.m[who] = ln
	}
	ln.limit = limit
	ln.grant() // a limit raised lets more of those waiting go
	if ln.busy < limit && len(ln.queue) == 0 {
		ln.busy++
		l.mu.Unlock()
		return l.releaser(who, ln), true
	}
	ch := make(chan struct{})
	ln.queue = append(ln.queue, ch)
	l.mu.Unlock()
	select {
	case <-ch:
		return l.releaser(who, ln), true
	case <-ctx.Done():
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	for i, c := range ln.queue {
		if c == ch {
			ln.queue = append(ln.queue[:i], ln.queue[i+1:]...)
			l.drop(who, ln)
			return nil, false
		}
	}
	// granted as ctx ended: the slot is given on to the next
	ln.busy--
	ln.grant()
	l.drop(who, ln)
	return nil, false
}

// releaser gives the slot back, once however often it is called.
func (l *lanes) releaser(who string, ln *lane) func() {
	var once sync.Once
	return func() {
		once.Do(func() {
			l.mu.Lock()
			ln.busy--
			ln.grant()
			l.drop(who, ln)
			l.mu.Unlock()
		})
	}
}

// grant lets those first in the queue go while there is room.
func (ln *lane) grant() {
	for len(ln.queue) > 0 && (ln.limit <= 0 || ln.busy < ln.limit) {
		ln.busy++
		close(ln.queue[0])
		ln.queue = ln.queue[1:]
	}
}

// drop forgets a lane nobody holds or waits on.
func (l *lanes) drop(who string, ln *lane) {
	if ln.busy <= 0 && len(ln.queue) == 0 && l.m[who] == ln {
		delete(l.m, who)
	}
}

// Lane is how a key's or account's requests stand: out at the vendor, and
// waiting their turn.
type Lane struct {
	Busy    int `json:"busy"`
	Waiting int `json:"waiting"`
	Limit   int `json:"limit"`
}

// concurrency tells each key's or account's Lane. It names the accounts,
// so it answers as quotas does: this machine, or one with the key of the
// gateway shared on the local network.
func (s *Server) concurrency(w http.ResponseWriter, r *http.Request) {
	if !local(r) && !sharedWith(r) {
		writeError(w, provider.Chat, http.StatusForbidden, "magpie's concurrency is told to another machine only when magpie is shared on the local network and the request carries its API key")
		return
	}
	writeJSON(w, 200, map[string]any{"object": "concurrency", "data": s.Lanes()})
}

// Lanes is how each key or account with requests out or waiting under a
// limit stands, by its who (provider, provider#key, provider@account).
func (s *Server) Lanes() map[string]Lane {
	s.lanes.mu.Lock()
	defer s.lanes.mu.Unlock()
	out := map[string]Lane{}
	for who, ln := range s.lanes.m {
		out[who] = Lane{Busy: ln.busy, Waiting: len(ln.queue), Limit: ln.limit}
	}
	return out
}
