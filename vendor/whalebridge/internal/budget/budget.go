// Package budget holds each gateway key to its own limit (#585): what a
// key has used in its window is summed from usage.jsonl, the records the
// Usage page shows, so it survives a restart; a request is let in only
// while the key has something left after what its requests in flight are
// expected to use, and those are settled with what the call recorded.
//
// The rules:
//   - A call counts in the window it started in (its record's time), and
//     windows are calendar ones in local time (access.Window).
//   - Tokens are a call's uncached input, output and cache writes, and
//     its cache reads when the limit says so; cost is an estimate at the
//     Usage page's prices, and a call with no known price adds none.
//   - A request refused before any upstream (no model, a refusal like
//     this one) uses nothing; a failed call counts the tokens it recorded.
//   - A streamed reply is settled when it ends, with the usage its vendor
//     reported; one cut off before that counts what was recorded.
//   - While a request is in flight it holds a reservation: its body's
//     size in tokens (4 bytes a token) plus the key's mean output per
//     call this window. A request is let in while used + reserved is
//     under the cap, so parallel requests overshoot by about one call.
//   - Only requests that came with a gateway key are limited: from
//     another computer one is required; on this one a request without one
//     (or with a token that is no key) isn't limited.
package budget

import (
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/yetone/magpie/internal/access"
	"github.com/yetone/magpie/internal/provider"
	"github.com/yetone/magpie/internal/settings"
	"github.com/yetone/magpie/internal/usage"
)

// sums is what a key's calls came to in a window.
type sums struct {
	start                                time.Time
	calls                                int
	input, output, cacheRead, cacheWrite int64
	cost                                 float64
	unpriced                             int
}

func (s *sums) add(r usage.Record, cost float64, priced bool) {
	s.calls++
	s.input += int64(r.Input)
	s.output += int64(r.Output)
	s.cacheRead += int64(r.CacheRead)
	s.cacheWrite += int64(r.CacheWrite)
	s.cost += cost
	if !priced {
		s.unpriced++
	}
}

func (s *sums) tokens(l *access.Limit) int64 {
	n := s.input + s.output + s.cacheWrite
	if l != nil && l.CacheReads {
		n += s.cacheRead
	}
	return n
}

type held struct {
	n      int
	tokens int64
	cost   float64
}

// A reservation stays in the window where the request began, even if it
// finishes after the next one has started.
type window struct {
	key   string
	start int64 // the window's start as Unix seconds
}

var state = struct {
	sync.Mutex
	sums map[string]*sums // by usage.Path() and key
	held map[window]*held
}{sums: map[string]*sums{}, held: map[window]*held{}}

func slot(keyID string) string { return usage.Path() + "\x00" + keyID }

// counts reports whether r is a call a key's budget counts.
func counts(r usage.Record) bool { return !r.IsRejected() && r.Computer == "" }

// sumsFor is keyID's sums for the window starting at start, read from
// usage.jsonl the first time. Called with state held.
func sumsFor(keyID string, start time.Time) *sums {
	k := slot(keyID)
	if s := state.sums[k]; s != nil && s.start.Equal(start) {
		return s
	}
	s := read(keyID, start)
	state.sums[k] = s
	return s
}

func read(keyID string, start time.Time) *sums {
	s := &sums{start: start}
	cost := usage.NewCoster()
	usage.Visit(start, func(r usage.Record) {
		if r.CallerKeyID == keyID && counts(r) && !r.Time.Before(start) {
			c, ok := cost(r)
			s.add(r, c, ok)
		}
	})
	return s
}

// Forget drops what is kept in memory, as a restart would.
func Forget() {
	state.Lock()
	defer state.Unlock()
	state.sums = map[string]*sums{}
	state.held = map[window]*held{}
}

// Append writes rec to usage.jsonl and, for a key's call, counts it
// against the key's window. The two happen together so a window read from
// the file meanwhile counts the call once.
func Append(rec usage.Record) {
	if rec.CallerKeyID == "" {
		usage.Append(rec)
		return
	}
	state.Lock()
	defer state.Unlock()
	if rec.Time.IsZero() {
		rec.Time = time.Now()
	}
	usage.Append(rec)
	s := state.sums[slot(rec.CallerKeyID)]
	if s == nil || !counts(rec) || rec.Time.Before(s.start) {
		return
	}
	c, ok := usage.NewCoster()(rec)
	s.add(rec, c, ok)
}

// Status is a key's limit and what it has used of it.
type Status struct {
	Period   string    `json:"period"`
	Start    time.Time `json:"start"`
	Reset    time.Time `json:"reset"`
	Calls    int       `json:"calls"`
	Tokens   int64     `json:"tokens"`
	Cost     float64   `json:"cost"`
	Unpriced int       `json:"unpriced,omitempty"`
	// InFlight requests, and the tokens and cost they are reserved at
	InFlight     int     `json:"inFlight,omitempty"`
	Reserved     int64   `json:"reserved,omitempty"`
	ReservedCost float64 `json:"reservedCost,omitempty"`
	TokenLimit   int64   `json:"tokenLimit,omitempty"`
	CostLimit    float64 `json:"costLimit,omitempty"`
	CacheReads   bool    `json:"cacheReads,omitempty"`
	// TokensLeft and CostLeft are what is left of each cap, 0 at most
	TokensLeft int64   `json:"tokensLeft"`
	CostLeft   float64 `json:"costLeft"`
	// Spent: the key is refused until Reset
	Spent bool `json:"spent"`
}

func status(keyID string, l *access.Limit, s *sums, h *held, reset time.Time) Status {
	st := Status{Period: l.Period, Start: s.start, Reset: reset, Calls: s.calls, Tokens: s.tokens(l), Cost: s.cost, Unpriced: s.unpriced,
		TokenLimit: l.Tokens, CostLimit: l.Cost, CacheReads: l.CacheReads}
	if h != nil {
		st.InFlight, st.Reserved, st.ReservedCost = h.n, h.tokens, h.cost
	}
	if l.Tokens > 0 {
		st.TokensLeft = max(l.Tokens-st.Tokens, 0)
		st.Spent = st.Tokens >= l.Tokens
	}
	if l.Cost > 0 {
		st.CostLeft = max(l.Cost-st.Cost, 0)
		st.Spent = st.Spent || st.Cost >= l.Cost
	}
	return st
}

// Of is key k's status now, nil when it has no limit. It reads the file
// afresh rather than the gateway's sums, so it is right for a gateway
// served by another process too.
func Of(k access.Key, now time.Time) *Status {
	if !k.Limit.Limited() {
		return nil
	}
	start, reset := access.Window(k.Limit.Period, now)
	s := read(k.ID, start)
	state.Lock()
	h := state.held[window{slot(k.ID), start.Unix()}]
	st := status(k.ID, k.Limit, s, h, reset)
	state.Unlock()
	return &st
}

// Refusal is why a key's request was turned away.
type Refusal struct {
	Status
	Key string
}

// Error says it as a client is told: the key, what it used of which
// cap, and when it resets.
func (r *Refusal) Error() string {
	what := ""
	if r.TokenLimit > 0 && r.Tokens+r.Reserved >= r.TokenLimit {
		counted := "input, output and cache-write tokens"
		if r.CacheReads {
			counted = "input, output and cache tokens"
		}
		what = fmt.Sprintf("%d of its %d %s", r.Tokens, r.TokenLimit, counted)
	} else {
		what = fmt.Sprintf("$%.2f of its $%.2f estimated cost", r.Cost, r.CostLimit)
	}
	if !r.Spent {
		what += fmt.Sprintf(", with %d requests in flight holding the rest", r.InFlight)
	}
	return fmt.Sprintf("magpie gateway key %q has used %s for this %s; it resets at %s",
		r.Key, what, r.Period, r.Reset.Format("2006-01-02 15:04 MST"))
}

// RetryAfter is how long until the window resets, in whole seconds.
func (r *Refusal) RetryAfter(now time.Time) int {
	return max(int(r.Reset.Sub(now).Seconds()+0.999), 1)
}

// Reserve lets a request of who's in, holding a reservation for it until
// the release it returns is called, or refuses it. body is the request's
// size in bytes (-1 unknown) and model the model it named, for a cost cap
// before the key has a price of its own this window.
func Reserve(who access.Identity, body int64, model string, now time.Time) (release func(), refused *Refusal) {
	l := who.Limit
	if who.KeyID == "" || !l.Limited() {
		return func() {}, nil
	}
	start, reset := access.Window(l.Period, now)
	state.Lock()
	defer state.Unlock()
	k := window{slot(who.KeyID), start.Unix()}
	s := sumsFor(who.KeyID, start)
	h := state.held[k]
	if h == nil {
		h = &held{}
		state.held[k] = h
	}
	used := s.tokens(l)
	if (l.Tokens > 0 && used+h.tokens >= l.Tokens) || (l.Cost > 0 && s.cost+h.cost >= l.Cost) {
		return nil, &Refusal{Status: status(who.KeyID, l, s, h, reset), Key: who.KeyName}
	}
	est := max(body, 0) / 4
	if s.calls > 0 {
		est += s.output / int64(s.calls)
	}
	var cost float64
	if l.Cost > 0 {
		if used > 0 && s.cost > 0 {
			cost = float64(est) * s.cost / float64(used)
		} else if p, ok := priceOf(model); ok {
			cost = float64(est) * p
		}
	}
	h.n++
	h.tokens += est
	h.cost += cost
	once := sync.Once{}
	return func() {
		once.Do(func() {
			state.Lock()
			defer state.Unlock()
			h.n--
			h.tokens -= est
			h.cost -= cost
			if h.n == 0 && state.held[k] == h {
				delete(state.held, k)
			}
		})
	}, nil
}

// priceOf is the input price per token of model when it names its
// provider ("provider/model").
func priceOf(model string) (float64, bool) {
	p, m, ok := strings.Cut(model, "/")
	if !ok || p == "" || m == "" {
		return 0, false
	}
	pr, ok := provider.EffectivePriceIn(settings.Load(), p, m)
	if !ok {
		return 0, false
	}
	return pr.Input / 1e6, true
}

// ModelOf is the model a JSON request body names, "" for none.
func ModelOf(body []byte) string {
	var v struct {
		Model string `json:"model"`
	}
	if json.Unmarshal(body, &v) != nil {
		return ""
	}
	return v.Model
}
