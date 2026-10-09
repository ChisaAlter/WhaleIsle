package middleware

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/Calcium-Ion/moejs"
)

func jsonMarshal(v any) ([]byte, error) { return json.Marshal(v) }

// Info is what a request's hooks are told of it, in ctx.
type Info struct {
	Protocol string `json:"protocol"` // the agent's API: anthropic, chat, responses, gemini
	Model    string `json:"model"`
	Stream   bool   `json:"stream"`
	Path     string `json:"path"`
	Agent    string `json:"agent,omitempty"`
}

// Reject is a request a middleware turned away (ctx.reject).
type Reject struct {
	Status  int
	Message string
}

// Run is the middleware of one request. Each middleware's hooks run in
// one runtime for the whole request, so they share ctx.state.
type Run struct {
	set      *set
	info     []byte // Info as JSON
	insts    []*inst
	ctxs     []moejs.Value
	rejected *Reject
	status   int
}

// Begin starts a request's middleware; nil when there is none, and a nil
// Run does nothing.
func Begin(info Info) *Run {
	s := current()
	if s == nil || len(s.list) == 0 {
		return nil
	}
	b, _ := json.Marshal(info)
	return &Run{set: s, info: b, insts: make([]*inst, len(s.list)), ctxs: make([]moejs.Value, len(s.list))}
}

// End gives the runtimes back.
func (r *Run) End() {
	if r == nil {
		return
	}
	for i, in := range r.insts {
		if in != nil {
			r.set.list[i].put(in)
			r.insts[i] = nil
		}
	}
}

// acquire is middleware i's runtime for this request and its ctx: the
// request's Info, the plugin's options, a state of its own and reject.
func (r *Run) acquire(i int) (*inst, moejs.Value, error) {
	if in := r.insts[i]; in != nil {
		return in, r.ctxs[i], nil
	}
	m := r.set.list[i]
	in, err := m.get()
	if err != nil {
		return nil, moejs.Undefined(), err
	}
	in.run = r
	b := make([]byte, 0, len(r.info)+len(m.options)+32)
	b = append(b, r.info[:len(r.info)-1]...)
	b = append(b, `,"options":`...)
	b = append(b, m.options...)
	b = append(b, `,"state":{}}`...)
	ctx, err := in.rt.ParseJSON(b)
	if err == nil {
		realm := in.rt.Realm()
		err = realm.SetV(ctx, realm.KeyFromGoString("reject"), in.rt.Function("reject", 2, r.reject))
	}
	if err != nil {
		m.put(in)
		return nil, moejs.Undefined(), err
	}
	r.insts[i], r.ctxs[i] = in, ctx
	return in, ctx, nil
}

// reject is ctx.reject(status, message): onRequest turns the request
// away, and it gets this answer in the agent's API's error shape.
func (r *Run) reject(realm *moejs.Realm, _ moejs.Value, args []moejs.Value) (moejs.Value, error) {
	j := Reject{Status: http.StatusForbidden, Message: "turned away by a gateway middleware"}
	if a := moejs.Arg(args, 0); a.IsNumber() {
		if n := int(a.AsNumber()); n >= 400 && n <= 599 {
			j.Status = n
		}
	}
	if a := moejs.Arg(args, 1); a.IsString() {
		if s, err := realm.ToString(a); err == nil {
			j.Message = s.GoString()
		}
	}
	if r.rejected == nil {
		r.rejected = &j
	}
	return moejs.Undefined(), nil
}

// Request runs each onRequest on body, in turn: what one returns is the
// body the next is given, and undefined leaves it as it was. A hook that
// throws or takes too long leaves it as it was too. A non-nil Reject is a
// request a hook turned away.
func (r *Run) Request(body []byte) ([]byte, *Reject) {
	if r == nil {
		return body, nil
	}
	for i, m := range r.set.list {
		if !m.hasReq {
			continue
		}
		out, err := r.apply(i, m.onReq, requestLimit, body, nil)
		if err != nil {
			m.fail("onRequest", err)
			continue
		}
		if r.rejected != nil {
			return body, r.rejected
		}
		if out != nil {
			body = out
		}
	}
	return body, nil
}

var errDropped = errors.New("dropped")

// apply calls h on the JSON in data; the JSON it returned, nil for
// undefined, or errDropped for null.
func (r *Run) apply(i int, h moejs.Hook, limit time.Duration, data []byte, status *int) ([]byte, error) {
	// a call's time is all it costs the request: the JSON read into the
	// runtime and written back out, which is most of it on a large body,
	// as well as the hook
	m := r.set.list[i]
	start := time.Now()
	defer func() {
		m.calls.Add(1)
		m.nanos.Add(int64(time.Since(start)))
	}()
	in, ctx, err := r.acquire(i)
	if err != nil {
		return nil, err
	}
	if status != nil {
		realm := in.rt.Realm()
		if err := realm.SetV(ctx, realm.KeyFromGoString("status"), moejs.Int(int64(*status))); err != nil {
			return nil, err
		}
	}
	v, err := in.rt.ParseJSON(data)
	if err != nil {
		return nil, err
	}
	res, err := in.call(h, limit, v, ctx)
	switch {
	case err != nil:
		return nil, err
	case res.IsUndefined():
		return nil, nil
	case res.IsNull():
		return nil, errDropped
	case !res.IsObject():
		return nil, errors.New("returned neither an object, null nor undefined")
	}
	return in.rt.AppendJSON(nil, res)
}

// Wrap wraps w so each onEvent sees the reply's stream event by event,
// and each onResponse a whole JSON reply; w as it is when no middleware
// has either. done writes what the wrapper still holds.
func (r *Run) Wrap(w http.ResponseWriter) (http.ResponseWriter, func()) {
	if r == nil {
		return w, func() {}
	}
	ev, resp := false, false
	for _, m := range r.set.list {
		ev = ev || m.hasEv
		resp = resp || m.hasResp
	}
	if !ev && !resp {
		return w, func() {}
	}
	rw := &writer{w: w, run: r, ev: ev, resp: resp, status: http.StatusOK}
	return rw, rw.finish
}

const (
	unknown = iota
	stream
	whole
	asIs
)

type writer struct {
	w        http.ResponseWriter
	run      *Run
	ev, resp bool
	mode     int
	status   int
	buf      bytes.Buffer
	done     bool
}

func (rw *writer) Header() http.Header { return rw.w.Header() }

// Unwrap is for http.ResponseController.
func (rw *writer) Unwrap() http.ResponseWriter { return rw.w }

func (rw *writer) decide(first []byte) {
	h := rw.w.Header()
	ct := h.Get("Content-Type")
	switch {
	case h.Get("Content-Encoding") != "" && !strings.EqualFold(h.Get("Content-Encoding"), "identity"):
		rw.mode = asIs
	case strings.Contains(ct, "event-stream"):
		rw.mode = stream
	case ct == "" && (bytes.HasPrefix(first, []byte("event:")) || bytes.HasPrefix(first, []byte("data:"))):
		rw.mode = stream
	case strings.Contains(ct, "json"):
		rw.mode = whole
	default:
		rw.mode = asIs
	}
	if rw.mode == stream && !rw.ev || rw.mode == whole && !rw.resp {
		rw.mode = asIs
	}
	if rw.mode != asIs {
		h.Del("Content-Length")
	}
}

func (rw *writer) WriteHeader(code int) {
	rw.status = code
	if rw.mode == unknown && rw.w.Header().Get("Content-Type") != "" {
		rw.decide(nil)
	}
	rw.w.WriteHeader(code)
}

func (rw *writer) Write(p []byte) (int, error) {
	if rw.mode == unknown {
		rw.decide(p)
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
		ev := b[:i+n]
		err := rw.event(ev)
		rw.buf.Next(i + n)
		if err != nil {
			return len(p), err
		}
	}
	return len(p), nil
}

func (rw *writer) Flush() {
	if f, ok := rw.w.(http.Flusher); ok && rw.mode != whole {
		f.Flush()
	}
}

func (rw *writer) finish() {
	if rw.done {
		return
	}
	rw.done = true
	switch rw.mode {
	case whole:
		body := rw.buf.Bytes()
		for i, m := range rw.run.set.list {
			if !m.hasResp {
				continue
			}
			out, err := rw.run.apply(i, m.onResp, requestLimit, body, &rw.status)
			switch {
			case errors.Is(err, errDropped):
				m.fail("onResponse", errors.New("returned null; a whole reply can't be dropped"))
			case err != nil:
				m.fail("onResponse", err)
			case out != nil:
				body = out
			}
		}
		rw.w.Write(body)
	case stream:
		if rw.buf.Len() > 0 {
			rw.w.Write(rw.buf.Bytes())
		}
	}
	rw.Flush()
}

// event runs each onEvent that wants it on one event of the stream, and
// writes it, or nothing when one dropped it.
func (rw *writer) event(ev []byte) error {
	name, data, pre, post, ok := splitEvent(ev)
	if !ok {
		_, err := rw.w.Write(ev)
		return err
	}
	changed := false
	for i, m := range rw.run.set.list {
		if !m.hasEv || m.events != nil && !m.events[name] {
			continue
		}
		out, err := rw.run.apply(i, m.onEv, eventLimit, data, nil)
		switch {
		case errors.Is(err, errDropped):
			return nil
		case err != nil:
			m.fail("onEvent", err)
		case out != nil:
			data, changed = out, true
		}
	}
	if !changed {
		_, err := rw.w.Write(ev)
		return err
	}
	out := make([]byte, 0, len(pre)+len(data)+len(post))
	_, err := rw.w.Write(append(append(append(out, pre...), data...), post...))
	return err
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

// splitEvent finds the one data line of an event that has JSON in it:
// what comes before the JSON, the JSON, and what comes after it.
func splitEvent(ev []byte) (name string, data, pre, post []byte, ok bool) {
	at, off, atOff := -1, 0, 0
	var line []byte
	for rest := ev; len(rest) > 0; {
		l := rest
		if k := bytes.IndexByte(rest, '\n'); k >= 0 {
			l = rest[:k+1]
		}
		rest = rest[len(l):]
		t := bytes.TrimRight(l, "\r\n")
		switch {
		case bytes.HasPrefix(t, []byte("event:")):
			name = strings.TrimSpace(string(t[6:]))
		case bytes.HasPrefix(t, []byte("data:")):
			if at >= 0 {
				return "", nil, nil, nil, false // data over more than one line
			}
			at, atOff, line = off, off, t
		}
		off += len(l)
	}
	if at < 0 {
		return "", nil, nil, nil, false
	}
	start := 5
	if len(line) > 5 && line[5] == ' ' {
		start = 6
	}
	// an event's JSON is an object in every API; data: [DONE] isn't JSON
	d := line[start:]
	if len(d) == 0 || d[0] != '{' {
		return "", nil, nil, nil, false
	}
	return name, d, ev[:atOff+start], ev[atOff+len(line):], true
}
