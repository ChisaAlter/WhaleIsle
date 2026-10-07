package gateway

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/yetone/magpie/internal/provider"
)

// A provider's keys and accounts each have concurrency slots. When all
// are occupied, requests wait in arrival order subject to QueueLimit and
// QueueWait. A cancelled request leaves the queue without reaching a vendor.
// Another account or group member with a free slot is tried before waiting;
// a full queue or an expired wait is recorded as a rejection.

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
	release, err := l.take(ctx, who, limit, 0, 0)
	return release, err == nil
}

var (
	errQueueFull = errors.New("queue full")
	errQueueWait = errors.New("waited too long")
)

func (l *lanes) take(ctx context.Context, who string, limit, queue int, wait time.Duration) (release func(), err error) {
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
		return func() {}, nil
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
		return l.releaser(who, ln), nil
	}
	if queue > 0 && len(ln.queue) >= queue {
		l.mu.Unlock()
		return nil, errQueueFull
	}
	ch := make(chan struct{})
	ln.queue = append(ln.queue, ch)
	l.mu.Unlock()
	var timeout <-chan time.Time
	if wait > 0 {
		t := time.NewTimer(wait)
		defer t.Stop()
		timeout = t.C
	}
	select {
	case <-ch:
		return l.releaser(who, ln), nil
	case <-ctx.Done():
		err = ctx.Err()
	case <-timeout:
		err = errQueueWait
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	for i, c := range ln.queue {
		if c == ch {
			ln.queue = append(ln.queue[:i], ln.queue[i+1:]...)
			l.drop(who, ln)
			return nil, err
		}
	}
	// granted as ctx ended: the slot is given on to the next
	ln.busy--
	ln.grant()
	l.drop(who, ln)
	return nil, err
}

func (l *lanes) free(who string, limit int) bool {
	if limit <= 0 {
		return true
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	ln := l.m[who]
	return ln == nil || ln.busy < limit && len(ln.queue) == 0
}

// Use another account of this provider, or member of this group, before waiting.
// Fallback vendors are not selected merely because a concurrency slot is full.
func (s *Server) laneMate(cands []candidate, i int, group bool, gave map[string]bool) int {
	c := cands[i]
	who := c.who()
	if gave[who] || s.lanes.free(who, c.p.LaneLimit()) {
		return -1
	}
	for j := i + 1; j < len(cands); j++ {
		m := cands[j]
		if m.who() == who || !group && m.p.ID != c.p.ID {
			continue
		}
		if s.lanes.free(m.who(), m.p.LaneLimit()) {
			return j
		}
	}
	return -1
}

func laneMessage(c candidate, err error, queued int64) string {
	lim := c.p.LaneLimit()
	if errors.Is(err, errQueueFull) {
		return fmt.Sprintf("%s: %d requests at once is its limit, and its queue is full (%d waiting); try again shortly", c.label(), lim, c.p.QueueLimit)
	}
	return fmt.Sprintf("%s: %d requests at once is its limit, and this one waited %.1fs for a free slot, as long as it may (%ds); try again shortly", c.label(), lim, float64(queued)/1000, c.p.QueueWait)
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
