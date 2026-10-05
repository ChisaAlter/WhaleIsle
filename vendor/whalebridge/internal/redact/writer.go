package redact

import (
	"bytes"
	"net/http"
	"strings"
)

// Writer puts the values back in what a vendor answers, on its way to the
// agent. A stream is put back event by event, as it comes; anything else
// when it is done, at Finish.
//
// A placeholder a stream splits between two events — {{API_ in one text
// delta, KEY_k3v9x2mq}} in the next — is put back whole: an event whose
// text ends in what may be the start of one is held until the next, and if
// that one goes on with the same text the start moves over to it. Nothing
// is added or dropped, so the text the agent puts together is the same.
type Writer struct {
	w       http.ResponseWriter
	mode    int // 0 not yet known, 1 a stream, 2 a whole body, 3 left as it is
	buf     bytes.Buffer
	pending *held
	done    bool
}

const (
	unknown = iota
	stream
	whole
	asIs
)

// held is an event that ended in what may be the start of a placeholder.
type held struct {
	ctx, path string
	tail      string
	full, cut []byte // the event as it is, and without the tail
}

// NewWriter wraps w; Finish must be called when the handler is done.
func NewWriter(w http.ResponseWriter) *Writer { return &Writer{w: w} }

func (rw *Writer) Header() http.Header { return rw.w.Header() }

// Unwrap is for http.ResponseController.
func (rw *Writer) Unwrap() http.ResponseWriter { return rw.w }

func (rw *Writer) decide(first []byte) {
	h := rw.w.Header()
	ct := h.Get("Content-Type")
	switch {
	case h.Get("Content-Encoding") != "" && !strings.EqualFold(h.Get("Content-Encoding"), "identity"):
		rw.mode = asIs
	case strings.Contains(ct, "event-stream"):
		rw.mode = stream
	case ct == "" && (bytes.HasPrefix(first, []byte("event:")) || bytes.HasPrefix(first, []byte("data:")) || bytes.HasPrefix(first, []byte(":"))):
		rw.mode = stream // the ChatGPT backend streams without saying so
	default:
		rw.mode = whole
	}
}

func (rw *Writer) WriteHeader(code int) {
	if rw.mode == unknown {
		h := rw.w.Header()
		if ct := h.Get("Content-Type"); ct != "" {
			rw.decide(nil)
		}
		// what is put back is not as long as what came
		if rw.mode != asIs {
			h.Del("Content-Length")
		}
	}
	rw.w.WriteHeader(code)
}

func (rw *Writer) Write(p []byte) (int, error) {
	if rw.mode == unknown {
		rw.decide(p)
		if rw.mode != asIs {
			rw.w.Header().Del("Content-Length")
		}
	}
	switch rw.mode {
	case asIs:
		return rw.w.Write(p)
	case whole:
		return rw.buf.Write(p)
	}
	rw.buf.Write(p)
	for {
		b := rw.buf.Bytes()
		i, n := eventEnd(b)
		if i < 0 {
			break
		}
		ev := append([]byte(nil), b[:i+n]...)
		rw.buf.Next(i + n)
		if err := rw.event(ev); err != nil {
			return len(p), err
		}
	}
	return len(p), nil
}

// eventEnd is where the first complete event in b ends, and the length of
// the blank line that ends it.
func eventEnd(b []byte) (int, int) {
	i := bytes.Index(b, []byte("\n\n"))
	j := bytes.Index(b, []byte("\r\n\r\n"))
	switch {
	case i < 0 && j < 0:
		return -1, 0
	case j >= 0 && (i < 0 || j < i):
		return j, 4
	default:
		return i, 2
	}
}

func (rw *Writer) Flush() {
	if f, ok := rw.w.(http.Flusher); ok && rw.mode != whole {
		f.Flush()
	}
}

// Finish writes what is still held.
func (rw *Writer) Finish() {
	if rw.done {
		return
	}
	rw.done = true
	switch rw.mode {
	case whole:
		rw.w.Write(RestoreJSON(rw.buf.Bytes()))
	case stream:
		if rw.pending != nil {
			rw.w.Write(rw.pending.full)
			rw.pending = nil
		}
		if rw.buf.Len() > 0 {
			rw.w.Write([]byte(Restore(rw.buf.String(), false)))
		}
	}
	rw.Flush()
}

// event puts the values back in one event and writes it, or holds it.
func (rw *Writer) event(ev []byte) error {
	name, data, pre, post, ok := splitEvent(ev)
	if !ok {
		if err := rw.release(); err != nil {
			return err
		}
		_, err := rw.w.Write([]byte(Restore(string(ev), false)))
		return err
	}
	ctx := name + "|" + eventCtx(data)
	// the start of a placeholder the last event ended in goes on here
	carry, at := "", ""
	if p := rw.pending; p != nil {
		if p.ctx == ctx && hasPath(data, p.path) {
			if _, err := rw.w.Write(p.cut); err != nil {
				return err
			}
			carry, at = p.tail, p.path
		} else if _, err := rw.w.Write(p.full); err != nil {
			return err
		}
		rw.pending = nil
	}
	typ := ""
	tailPath, tail := "", ""
	restored, _ := walk(data, func(path, key, s string) string {
		if path == "type" {
			typ = s
		}
		if path == at {
			s = carry + s
		}
		if keep(key, s) {
			return s
		}
		s = Restore(s, asJSON(key, typ))
		if n := partialTail(s); n > 0 {
			tailPath, tail = path, s[len(s)-n:]
		}
		return s
	})
	full := rebuild(pre, restored, post)
	if tail == "" {
		_, err := rw.w.Write(full)
		return err
	}
	cutData, _ := walk(restored, func(path, _, s string) string {
		if path == tailPath {
			return strings.TrimSuffix(s, tail)
		}
		return s
	})
	rw.pending = &held{ctx: ctx, path: tailPath, tail: tail, full: full, cut: rebuild(pre, cutData, post)}
	return nil
}

func (rw *Writer) release() error {
	if p := rw.pending; p != nil {
		rw.pending = nil
		_, err := rw.w.Write(p.full)
		return err
	}
	return nil
}

func rebuild(pre, data, post []byte) []byte {
	out := make([]byte, 0, len(pre)+len(data)+len(post))
	return append(append(append(out, pre...), data...), post...)
}

// splitEvent finds the one data line of an event that has JSON in it:
// what comes before the JSON, the JSON, and what comes after it.
func splitEvent(ev []byte) (name string, data, pre, post []byte, ok bool) {
	lines := bytes.SplitAfter(ev, []byte("\n"))
	at := -1
	off := 0
	for i, l := range lines {
		t := bytes.TrimRight(l, "\r\n")
		switch {
		case bytes.HasPrefix(t, []byte("event:")):
			name = strings.TrimSpace(string(t[6:]))
		case bytes.HasPrefix(t, []byte("data:")):
			if at >= 0 {
				return "", nil, nil, nil, false // data over more than one line
			}
			at = i
		}
		if at < 0 {
			off += len(l)
		}
	}
	if at < 0 {
		return "", nil, nil, nil, false
	}
	l := lines[at]
	t := bytes.TrimRight(l, "\r\n")
	start := 5
	if len(t) > 5 && t[5] == ' ' {
		start = 6
	}
	d := t[start:]
	if len(d) == 0 || d[0] != '{' && d[0] != '[' {
		return "", nil, nil, nil, false
	}
	return name, d, ev[:off+start], ev[off+len(t):], true
}

// eventCtx is what says which text an event goes on with.
func eventCtx(data []byte) string {
	var b strings.Builder
	walk(data, func(path, _, s string) string {
		switch path {
		case "type", "item_id":
			b.WriteString(path + "=" + s + ";")
		}
		return s
	})
	for _, k := range []string{`"index":`, `"output_index":`, `"content_index":`} {
		if i := bytes.Index(data, []byte(k)); i >= 0 {
			j := i + len(k)
			e := j
			for e < len(data) && (data[e] >= '0' && data[e] <= '9' || data[e] == ' ') {
				e++
			}
			b.WriteString(k + string(data[j:e]) + ";")
		}
	}
	return b.String()
}

func hasPath(data []byte, path string) bool {
	found := false
	walk(data, func(p, _, s string) string {
		if p == path {
			found = true
		}
		return s
	})
	return found
}
