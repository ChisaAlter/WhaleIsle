package gateway

import (
	"net/http"
	"strings"
	"sync/atomic"
	"time"
)

// Busy is what a restart of the magpie serving the gateway would cut
// short (#577): the agents' requests in flight — a reply streaming, an
// image being made — and the turns of Claude Code run through the
// subscription bridge waiting on their caller's tool results, whose
// Claude Code lives only in this process. A request in flight is one
// that does work (not a GET: the model lists, the info another magpie
// asks for every 15 s); the bridge's own helper calls are not counted
// apart, a turn waiting on them being in Tools. Last is when the last
// counted request ended, so a caller can tell a tool chain's gap — the
// agent running a tool between two requests — from the end of its turn.
type Busy struct {
	Requests int       `json:"requests"`
	Tools    int       `json:"tools"`
	Last     time.Time `json:"-"`
}

// Any is whether there is anything in flight.
func (b Busy) Any() bool { return b.Requests > 0 || b.Tools > 0 }

// Busy says what is in flight at the gateway now.
func (s *Server) Busy() Busy {
	b := Busy{Requests: int(s.inFlight.Load()), Tools: s.subscription.parked()}
	if n := s.lastDone.Load(); n != 0 {
		b.Last = time.Unix(0, n)
	}
	return b
}

// counted is h with its requests counted for Busy.
func (s *Server) counted(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet || r.Method == http.MethodHead || r.Method == http.MethodOptions || strings.HasPrefix(r.URL.Path, "/_magpie/") || strings.HasPrefix(r.URL.Path, "/mcp/") {
			h.ServeHTTP(w, r)
			return
		}
		s.inFlight.Add(1)
		defer func() {
			s.lastDone.Store(time.Now().UnixNano())
			s.inFlight.Add(-1)
		}()
		h.ServeHTTP(w, r)
	})
}

// busyCounters are the Server's counts for Busy.
type busyCounters struct {
	inFlight atomic.Int64
	lastDone atomic.Int64 // unix ns
}

// parked is how many runs wait on their caller's tool results.
func (b *subscriptionBridge) parked() int {
	if b == nil {
		return 0
	}
	b.mu.Lock()
	runs := make([]*subscriptionRun, 0, len(b.runs))
	for _, run := range b.runs {
		runs = append(runs, run)
	}
	b.mu.Unlock()
	n := 0
	for _, run := range runs {
		run.mu.Lock()
		if !run.closed && !run.parkedAt.IsZero() {
			n++
		}
		run.mu.Unlock()
	}
	return n
}
