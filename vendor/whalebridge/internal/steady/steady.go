// Package steady reads and replaces files that another process may be
// replacing at that moment. On Windows a file being renamed over refuses
// to open, and one held open refuses to be renamed over, both for a
// moment ("Access is denied"): read as none, a file of accounts is no
// accounts, and the next write leaves them out. Elsewhere a rename is
// atomic and these are os.ReadFile and os.Rename.
package steady

import (
	"errors"
	"io/fs"
	"os"
	"runtime"
	"time"
)

// tries and pause bound the wait to half a second: what holds the file is
// another read or rename, done in milliseconds.
const (
	tries = 50
	pause = 10 * time.Millisecond
)

func retry(f func() error) error {
	err := f()
	for i := 0; err != nil && runtime.GOOS == "windows" && !errors.Is(err, fs.ErrNotExist) && i < tries; i++ {
		time.Sleep(pause)
		err = f()
	}
	return err
}

// ReadFile is os.ReadFile, waiting out a file being replaced.
func ReadFile(p string) ([]byte, error) {
	var b []byte
	err := retry(func() (err error) {
		b, err = os.ReadFile(p)
		return err
	})
	return b, err
}

// Rename is os.Rename, waiting out a reader holding newpath open.
func Rename(oldpath, newpath string) error {
	return retry(func() error { return os.Rename(oldpath, newpath) })
}
