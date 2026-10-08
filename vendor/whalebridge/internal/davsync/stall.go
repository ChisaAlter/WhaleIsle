package davsync

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"sync"
	"time"
)

// A sync is never given a time to end in: a backup of tens of MB to a
// server on a slow line takes minutes (#657, 43 MB at 305 KB/s). What ends
// a request is a server that stops: the backup's GET and PUT (and S3's)
// fail once nothing has moved, either way, for stallAfter — a body still
// coming in or going out, however slowly, keeps them going. The other
// requests (PROPFIND, MKCOL, MOVE, DELETE…) move a few KB at most and have
// metaLimit in all.
var (
	stallAfter = 60 * time.Second
	metaLimit  = 30 * time.Second
)

// errStalled is what a request ended for having moved nothing in time.
type errStalled struct {
	method string
	after  time.Duration
	idle   bool
}

func (e *errStalled) Error() string {
	if e.idle {
		return fmt.Sprintf("the server sent and took nothing for %s (%s): the line or the server stopped", e.after, e.method)
	}
	return fmt.Sprintf("the server didn't answer in %s (%s)", e.after, e.method)
}

// syncClient is the client WebDAV and S3 are reached with.
var syncClient = &http.Client{Transport: stallTransport{http.DefaultTransport}}

// stallTransport gives each request its watchdog: for a GET or a PUT one
// put back each time bytes move, for the rest one that isn't.
type stallTransport struct{ base http.RoundTripper }

func (t stallTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	moving := req.Method == http.MethodGet || req.Method == http.MethodPut
	after := metaLimit
	if moving {
		after = stallAfter
	}
	ctx, cancel := context.WithCancelCause(req.Context())
	w := &watch{after: after, moving: moving, start: time.Now()}
	w.timer = time.AfterFunc(after, func() {
		cancel(&errStalled{method: req.Method, after: after, idle: moving})
	})
	done := func() { w.timer.Stop(); cancel(nil) }
	r := req.Clone(ctx)
	if req.Body != nil && req.Body != http.NoBody {
		r.Body = &watched{ReadCloser: req.Body, w: w, ctx: ctx}
	}
	res, err := t.base.RoundTrip(r)
	if err != nil {
		done()
		return nil, cause(ctx, err)
	}
	w.moved() // the answer's head came
	res.Body = &watched{ReadCloser: res.Body, w: w, ctx: ctx, done: done}
	return res, nil
}

// cause is err, or why ctx was ended when the watchdog ended it.
func cause(ctx context.Context, err error) error {
	var s *errStalled
	if c := context.Cause(ctx); errors.As(c, &s) {
		return s
	}
	return err
}

type watch struct {
	mu     sync.Mutex
	timer  *time.Timer
	after  time.Duration
	moving bool
	start  time.Time
}

// allSent is the request's body all handed to the network. The last MBs of
// it may sit in the system's buffers (macOS and Linux tune them up to 4 MB,
// and a proxy between holds more) and go out on a slow line long after: the
// answer is given stallAfter on top of as long as the write took, and at
// least 4 times stallAfter, for them to leave.
func (w *watch) allSent() {
	if !w.moving {
		return
	}
	w.mu.Lock()
	w.timer.Reset(w.after + max(time.Since(w.start), 4*w.after))
	w.mu.Unlock()
}

// moved puts the watchdog back: bytes went one way or the other.
func (w *watch) moved() {
	if !w.moving {
		return
	}
	w.mu.Lock()
	w.timer.Reset(w.after)
	w.mu.Unlock()
}

// watched is a body whose reads tell the watchdog.
type watched struct {
	io.ReadCloser
	w    *watch
	ctx  context.Context
	done func()
	once sync.Once
}

func (b *watched) Read(p []byte) (int, error) {
	n, err := b.ReadCloser.Read(p)
	if n > 0 {
		b.w.moved()
	}
	if b.done == nil && err == io.EOF { // the request's body
		b.w.allSent()
	}
	if err != nil && err != io.EOF {
		err = cause(b.ctx, err)
	}
	return n, err
}

func (b *watched) Close() error {
	err := b.ReadCloser.Close()
	if b.done != nil {
		b.once.Do(b.done)
	}
	return err
}
