package catalog

import (
	"context"
	"log"
	"os"
	"sync"
	"sync/atomic"
	"time"
)

// Keeping the catalog fresh. It is where a model's list price comes from,
// so a model models.dev has just listed (gpt-6.1-sol, #224) has no cost
// until the cache is fetched again: a day old at most, looked at every hour
// by a magpie left running for days, and sooner when a call's model has no
// price, since models.dev may list it by now.

// staleAfter is how old the cached catalog may be before it is fetched
// again.
var staleAfter = 24 * time.Hour

// missingAfter is how old it may be, and how long since the last try,
// before a model with no price has it fetched again.
var missingAfter = 6 * time.Hour

// freshEvery is how often KeepFresh looks.
var freshEvery = time.Hour

var (
	keeping   atomic.Bool  // KeepFresh is running: Missing may fetch
	lastFetch atomic.Int64 // when fetch last started, Unix nanoseconds
	fetching  atomic.Bool
	fetchState struct {
		sync.Mutex
		attempted time.Time
		errorText string
	}
)

type RefreshStatus struct {
	Source     string    `json:"source"`
	Refreshing bool      `json:"refreshing"`
	Attempted  time.Time `json:"attempted,omitzero"`
	Error      string    `json:"error,omitempty"`
}

// Status exposes bootstrap failures without discarding a usable cache.
func Status() RefreshStatus {
	fetchState.Lock()
	defer fetchState.Unlock()
	return RefreshStatus{Source: Source(), Refreshing: fetching.Load(), Attempted: fetchState.attempted, Error: fetchState.errorText}
}

// Maintain refreshes a stale catalog at startup and then on the existing
// catalog cadence. Cancellation ends this component-owned job.
func Maintain(ctx context.Context) {
	keeping.Store(true)
	defer keeping.Store(false)
	for {
		t := time.NewTimer(freshEvery)
		select {
		case <-ctx.Done():
			t.Stop()
			return
		case <-t.C:
		}
		if Stale() {
			Refresh(ctx)
		}
	}
}

// KeepFresh fetches the catalog whenever it is stale, now and every hour
// after, for as long as the process runs (the app's backend, `magpie
// serve`). It never returns.
func KeepFresh() {
	keeping.Store(true)
	for {
		if Stale() {
			fetch()
		}
		time.Sleep(freshEvery)
	}
}

// Missing says a call's model has no price: the catalog is fetched again,
// in the background, when it is older than six hours and wasn't tried in
// that time. Only in a process that keeps it fresh (KeepFresh), so a CLI
// command or a test never fetches on its own.
func Missing() {
	if !keeping.Load() || time.Since(time.Unix(0, lastFetch.Load())) < missingAfter {
		return
	}
	if src := Source(); src != "" {
		if st, err := os.Stat(src); err == nil && time.Since(st.ModTime()) < missingAfter {
			return
		}
	}
	go fetch()
}

// fetch is Sync with a bound, one at a time.
func fetch() {
	Refresh(context.Background())
}

// Refresh bounds one automatic model-catalog download and records its
// result. It never retries a failed download on its own.
func Refresh(parent context.Context) {
	if !fetching.CompareAndSwap(false, true) {
		return
	}
	defer fetching.Store(false)
	lastFetch.Store(time.Now().UnixNano())
	fetchState.Lock()
	fetchState.attempted, fetchState.errorText = time.Now(), ""
	fetchState.Unlock()
	ctx, cancel := context.WithTimeout(parent, 30*time.Second)
	defer cancel()
	err := Sync(ctx)
	fetchState.Lock()
	if err != nil {
		fetchState.errorText = err.Error()
	}
	fetchState.Unlock()
	if err != nil {
		log.Println("catalog:", err)
	}
}
