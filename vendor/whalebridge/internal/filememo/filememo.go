// Package filememo keeps what was parsed from a file until the file
// changes, so a page that asks many times over reads it once.
package filememo

import (
	"bytes"
	"os"
	"sync"
	"time"

	"github.com/yetone/magpie/internal/steady"
)

type entry struct {
	mod  time.Time
	size int64
	v    any
	// the bytes parsed, while the file's time is too recent to tell a
	// second write by: Linux stamps a file from a clock a tick (a few
	// milliseconds) coarse, so two writes of one size inside a tick (two
	// accounts swapped) leave the same time and size
	raw []byte
	// when the file was last found unchanged, while a request held them
	// (Hold), and in which of Forget's generations
	checked time.Time
	gen     uint64
}

// settled is how old a file's time must be for any later write to stamp
// a later one, many ticks of the coarsest clock.
const settled = 2 * time.Second

var (
	mu   sync.Mutex
	seen = map[string]entry{}
	// holds is how many requests hold what was read (Hold); gen is moved
	// on by every write magpie makes (Forget)
	holds int
	gen   uint64
)

// heldFor is how long a file found unchanged is taken as unchanged, while
// a request holds what was read, before it is looked at again.
const heldFor = time.Second

// Hold has a file found unchanged not looked at again, for a request that
// only reads, until release is called or a second has gone by: the GUI's
// state looked at each agent's files hundreds of times over, a few
// thousand looks at the disk that a slow one (a Mac's antivirus looking
// at each) made seconds. A write meanwhile (Forget) has them looked at.
func Hold() (release func()) {
	mu.Lock()
	holds++
	mu.Unlock()
	return sync.OnceFunc(func() {
		mu.Lock()
		holds--
		mu.Unlock()
	})
}

// Forget has every file looked at again on its next read: magpie wrote
// one.
func Forget() {
	mu.Lock()
	gen++
	mu.Unlock()
}

// Read is parse of the file at path, from what it gave last time when the
// file has the same size and time as then (and, written just now, the same
// bytes). kind tells apart two parses of
// one file. What it returns is shared: the caller must not change it.
func Read[T any](kind, path string, parse func([]byte) (T, error)) (T, error) {
	var zero T
	key := kind + "\x00" + path
	mu.Lock()
	e, ok := seen[key]
	if ok && holds > 0 && e.raw == nil && e.gen == gen && time.Since(e.checked) < heldFor {
		mu.Unlock()
		return e.v.(T), nil
	}
	g := gen
	mu.Unlock()
	fi, err := os.Stat(path)
	if err != nil {
		return zero, err
	}
	if ok && e.mod.Equal(fi.ModTime()) && e.size == fi.Size() && e.raw == nil {
		mu.Lock()
		if holds > 0 && g == gen {
			e.checked, e.gen = time.Now(), g
			seen[key] = e
		}
		mu.Unlock()
		return e.v.(T), nil
	}
	b, err := steady.ReadFile(path)
	if err != nil {
		return zero, err
	}
	if ok && e.mod.Equal(fi.ModTime()) && bytes.Equal(b, e.raw) {
		if time.Since(e.mod) > settled {
			mu.Lock()
			e.raw = nil
			seen[key] = e
			mu.Unlock()
		}
		return e.v.(T), nil
	}
	v, err := parse(b)
	if err != nil {
		return zero, err
	}
	mu.Lock()
	e = entry{mod: fi.ModTime(), size: fi.Size(), v: v}
	if time.Since(e.mod) <= settled {
		e.raw = b
	} else if holds > 0 && g == gen {
		e.checked, e.gen = time.Now(), g
	}
	seen[key] = e
	mu.Unlock()
	return v, nil
}
