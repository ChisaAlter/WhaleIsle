package davsync

import (
	"context"
	"errors"
	"os"
	"time"

	"github.com/yetone/magpie/internal/settings"
)

// ErrBusy is a wait for another magpie's sync that ran out of time.
var ErrBusy = errors.New("another magpie is syncing: try again in a moment")

// lock keeps what reads or writes sync's files — a sync, Configure, Off,
// Dismiss — to one at a time across magpies: the gateway's syncs every
// Every, and magpie webdav from a terminal meanwhile, would each save
// sync-state.json over the other's. It keeps them apart within one magpie
// too, each taking it through a descriptor of its own, and is taken before
// mu, so a wait for another magpie never holds mu. The system holds it on
// sync.lock and lets it go when the magpie holding it ends, however it
// ends, so none is ever left behind. The file stays: taken away, one
// magpie could hold the lock on it while another took one on a new file.
func lock(ctx context.Context) (unlock func(), err error) {
	os.MkdirAll(settings.Dir(), 0o755)
	f, err := os.OpenFile(path("sync.lock"), os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return func() {}, nil // no lock to be had here: sync as before there was one
	}
	for {
		got, err := tryLock(f)
		if err != nil { // a file system without locks, as an NFS home with no lockd
			f.Close()
			return func() {}, nil
		}
		if got {
			return func() { unlockFile(f); f.Close() }, nil
		}
		select {
		case <-ctx.Done():
			f.Close()
			if errors.Is(ctx.Err(), context.DeadlineExceeded) {
				return nil, ErrBusy
			}
			return nil, ctx.Err()
		case <-time.After(200 * time.Millisecond):
		}
	}
}

// wait is how long Configure, Off, Dismiss and a sync wait for a sync in
// progress, which itself has no time limit (see stallAfter).
const wait = 30 * time.Second

// locked runs fn holding the lock, then mu, after a sync in progress: it
// would save its state over what fn does.
func locked(fn func() error) error {
	ctx, cancel := context.WithTimeout(context.Background(), wait)
	defer cancel()
	unlock, err := lock(ctx)
	if err != nil {
		return err
	}
	defer unlock()
	mu.Lock()
	defer mu.Unlock()
	return fn()
}
