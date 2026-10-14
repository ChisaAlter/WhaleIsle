// Package middleware runs the gateway middleware plugins declare: a
// module with onRequest, onEvent and onResponse hooks that the gateway
// calls on every request an agent sends it, every event of the reply's
// stream and every whole reply.
//
// It runs in the gateway's own process, in moejs, a JavaScript engine
// written in Go: a hook on one streamed event costs about a microsecond,
// where a round trip to the plugin host's Bun costs tens of them, and a
// reply streams thousands of events. Each middleware is compiled once;
// each request takes a runtime of its own from the middleware's pool, so
// requests run their hooks in parallel and a request's hooks share its
// ctx.state.
package middleware

import (
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/Calcium-Ion/moejs"
	"github.com/yetone/magpie/internal/plugin"
)

// How long a hook may run before it is stopped and its input kept as it
// was: a request or a whole reply, and one event of a stream.
var (
	requestLimit = 250 * time.Millisecond
	eventLimit   = 50 * time.Millisecond
	loadLimit    = time.Second
)

var errTimeout = errors.New("took too long")

// mw is one middleware, compiled.
type mw struct {
	spec, name string
	mod        *moejs.Module
	onReq      moejs.Hook
	onEv       moejs.Hook
	onResp     moejs.Hook
	hasReq     bool
	hasEv      bool
	hasResp    bool
	// events are the stream events onEvent is called for, by name; nil
	// is every one
	events  map[string]bool
	options []byte // the plugin's options, as JSON
	pool    sync.Pool

	calls, nanos, failures atomic.Int64
	lastErr                atomic.Pointer[string]
	logged                 atomic.Int64 // lines logged this minute, and the minute
}

// set is the middleware in force, in plugins.json's order.
type set struct {
	stamp string
	list  []*mw
	errs  map[string]string // by spec: why it didn't load
}

var (
	loadMu    sync.Mutex
	cur       atomic.Pointer[set]
	nextCheck atomic.Int64
)

// current is the middleware in force, loaded again when plugins.json or a
// middleware's file changed, which is looked at once a second.
func current() *set {
	s := cur.Load()
	now := time.Now().UnixNano()
	n := nextCheck.Load()
	if s != nil && (now < n || !nextCheck.CompareAndSwap(n, now+int64(time.Second))) {
		return s
	}
	st := stamp()
	if s != nil && s.stamp == st {
		return s
	}
	loadMu.Lock()
	defer loadMu.Unlock()
	if s := cur.Load(); s != nil && s.stamp == st {
		return s
	}
	s = load(st)
	cur.Store(s)
	return s
}

// Reload drops the middleware loaded, so the next request loads it again.
func Reload() {
	loadMu.Lock()
	cur.Store(nil)
	loadMu.Unlock()
}

type found struct {
	e    plugin.Entry
	file string
}

func middlewares() []found {
	var out []found
	for _, e := range plugin.Load().Plugins {
		if e.Off {
			continue
		}
		if file, _ := plugin.Middleware(plugin.Target(e.Spec)); file != "" {
			out = append(out, found{e, file})
		}
	}
	return out
}

// stamp changes when plugins.json or a middleware's file does.
func stamp() string {
	var b strings.Builder
	b.WriteString(plugin.ListStamp())
	for _, f := range middlewares() {
		b.WriteString("|" + f.file)
		if fi, err := os.Stat(f.file); err == nil {
			fmt.Fprint(&b, ":", fi.ModTime().UnixNano(), ":", fi.Size())
		}
	}
	return b.String()
}

func load(st string) *set {
	s := &set{stamp: st, errs: map[string]string{}}
	for _, f := range middlewares() {
		m, err := compile(f.e, f.file)
		if err != nil {
			s.errs[f.e.Spec] = err.Error()
			log.Printf("middleware %s didn't load: %v", plugin.Name(f.e.Spec), err)
			continue
		}
		s.list = append(s.list, m)
	}
	return s
}

// compile compiles the middleware in file and the modules it imports,
// which are files beside it: there is no node_modules here, so a package
// is bundled into the middleware.
func compile(e plugin.Entry, file string) (*mw, error) {
	root := filepath.Dir(file)
	if t := plugin.Target(e.Spec); t != file {
		root = t
	}
	src, err := os.ReadFile(file)
	if err != nil {
		return nil, err
	}
	entry, err := moejs.Compile(file, string(src))
	if err != nil {
		return nil, err
	}
	mods := map[string]*moejs.Module{file: entry}
	mod, err := moejs.Link(entry, func(ref moejs.Referrer, spec string) (*moejs.Module, error) {
		if !strings.HasPrefix(spec, "./") && !strings.HasPrefix(spec, "../") {
			return nil, fmt.Errorf("%q: a middleware imports only files beside it; bundle packages into it", spec)
		}
		from := file
		if ref != nil {
			from = ref.Name()
		}
		p := filepath.Clean(filepath.Join(filepath.Dir(from), filepath.FromSlash(spec)))
		if rel, err := filepath.Rel(root, p); err != nil || strings.HasPrefix(rel, "..") {
			return nil, fmt.Errorf("%q is outside the plugin", spec)
		}
		if m, ok := mods[p]; ok {
			return m, nil
		}
		src, err := os.ReadFile(p)
		if err != nil {
			return nil, err
		}
		m, err := moejs.Compile(p, string(src))
		if err != nil {
			return nil, err
		}
		mods[p] = m
		return m, nil
	})
	if err != nil {
		return nil, err
	}
	m := &mw{spec: e.Spec, name: plugin.Name(e.Spec), mod: mod, options: []byte("{}")}
	if len(e.Options) > 0 {
		if b, err := jsonMarshal(e.Options); err == nil {
			m.options = b
		}
	}
	// a runtime of its own says which hooks it has, and is the pool's first
	in, err := m.newInst()
	if err != nil {
		return nil, err
	}
	m.onReq, m.hasReq = in.hook("onRequest")
	m.onEv, m.hasEv = in.hook("onEvent")
	m.onResp, m.hasResp = in.hook("onResponse")
	if !m.hasReq && !m.hasEv && !m.hasResp {
		return nil, errors.New("exports none of onRequest, onEvent and onResponse")
	}
	if names, ok := in.strings("events"); ok {
		m.events = map[string]bool{}
		for _, n := range names {
			m.events[n] = true
		}
	}
	m.pool.Put(in)
	return m, nil
}

// inst is one runtime of a middleware.
type inst struct {
	m     *mw
	rt    *moejs.Runtime
	timer *time.Timer
	mu    sync.Mutex
	armed bool // a call is running, which the timer may stop
	fired bool
	run   *Run // the request it serves
}

func (m *mw) newInst() (*inst, error) {
	in := &inst{m: m, rt: moejs.NewRuntime(moejs.Options{})}
	in.timer = time.AfterFunc(time.Hour, func() {
		in.mu.Lock()
		if in.armed {
			in.fired = true
			in.rt.Interrupt(errTimeout)
		}
		in.mu.Unlock()
	})
	in.timer.Stop()
	if err := in.rt.SetGlobal("console", in.console()); err != nil {
		return nil, err
	}
	in.arm(loadLimit)
	err := in.rt.Load(m.mod)
	if in.disarm() {
		err = errTimeout
	}
	if err != nil {
		return nil, err
	}
	return in, nil
}

func (m *mw) get() (*inst, error) {
	if in, ok := m.pool.Get().(*inst); ok {
		return in, nil
	}
	return m.newInst()
}

func (m *mw) put(in *inst) {
	in.run = nil
	in.rt.ReleaseCallData()
	m.pool.Put(in)
}

func (in *inst) arm(d time.Duration) {
	in.mu.Lock()
	in.armed, in.fired = true, false
	in.mu.Unlock()
	in.timer.Reset(d)
}

// disarm ends what arm began, and says whether the timer stopped it.
func (in *inst) disarm() bool {
	in.mu.Lock()
	in.armed = false
	fired := in.fired
	in.mu.Unlock()
	in.timer.Stop()
	if fired {
		in.rt.ClearInterrupt()
	}
	return fired
}

// call calls h with the time it has, and settles the promise an async
// hook returns: there is nothing for one to wait on, so it has settled by
// the time the call returns, unless it waits on a promise that never does.
func (in *inst) call(h moejs.Hook, limit time.Duration, args ...moejs.Value) (moejs.Value, error) {
	in.arm(limit)
	v, err := in.rt.Call(h, args...)
	if in.disarm() {
		err = errTimeout
	}
	if err != nil {
		return v, err
	}
	switch st, res, ok := moejs.PromiseResult(v); {
	case !ok:
		return v, nil
	case st == moejs.PromiseFulfilled:
		return res, nil
	case st == moejs.PromiseRejected:
		return v, fmt.Errorf("rejected: %s", in.text(res))
	default:
		return v, errors.New("returned a promise that never settled")
	}
}

// hook is the export name, or default's member name, when it's a function.
func (in *inst) hook(name string) (moejs.Hook, bool) {
	if h, err := in.m.mod.Hook(name); err == nil {
		if ok, _ := in.rt.Has(h); ok {
			return h, true
		}
	}
	if h, err := in.m.mod.Hook("default", name); err == nil {
		if ok, _ := in.rt.Has(h); ok {
			return h, true
		}
	}
	return moejs.Hook{}, false
}

// strings is the export name, or default's member name, as strings.
func (in *inst) strings(name string) ([]string, bool) {
	v, ok := in.rt.Export(name)
	if !ok || v.IsUndefined() {
		d, ok := in.rt.Export("default")
		if !ok || !d.IsObject() {
			return nil, false
		}
		if v, _ = in.rt.Get(d, name); v.IsUndefined() {
			return nil, false
		}
	}
	g, err := in.rt.ToGo(v)
	if err != nil {
		return nil, false
	}
	list, ok := g.([]any)
	if !ok {
		return nil, false
	}
	out := make([]string, 0, len(list))
	for _, x := range list {
		if s, ok := x.(string); ok {
			out = append(out, s)
		}
	}
	return out, true
}

// text is v as console.log prints it: a string as it is, else JSON.
func (in *inst) text(v moejs.Value) string {
	if v.IsString() {
		if s, err := in.rt.Realm().ToString(v); err == nil {
			return s.GoString()
		}
	}
	if b, err := in.rt.AppendJSON(nil, v); err == nil && len(b) > 0 {
		return string(b)
	}
	if s, err := in.rt.Realm().ToString(v); err == nil {
		return s.GoString()
	}
	return "?"
}

func (in *inst) console() map[string]any {
	say := func(level string) moejs.NativeFunc {
		return func(_ *moejs.Realm, _ moejs.Value, args []moejs.Value) (moejs.Value, error) {
			parts := make([]string, len(args))
			for i, a := range args {
				parts[i] = in.text(a)
			}
			in.m.say(level, strings.Join(parts, " "))
			return moejs.Undefined(), nil
		}
	}
	return map[string]any{"log": say("info"), "info": say("info"), "debug": say("debug"), "warn": say("warn"), "error": say("error")}
}

// linesAMinute is how many lines a middleware may log a minute, so one
// that logs every event doesn't fill magpie's log.
const linesAMinute = 60

func (m *mw) say(level, msg string) {
	minute := time.Now().Unix() / 60
	for {
		v := m.logged.Load()
		n, at := v&0xffff, v>>16
		if at != minute {
			n = 0
		}
		if n >= linesAMinute {
			return
		}
		if m.logged.CompareAndSwap(v, minute<<16|(n+1)) {
			break
		}
	}
	if len(msg) > 2000 {
		msg = msg[:2000] + "…"
	}
	log.Printf("middleware %s [%s]: %s", m.name, level, msg)
}

// fail notes a hook that failed, whose input goes on as it was.
func (m *mw) fail(hook string, err error) {
	m.failures.Add(1)
	msg := hook + ": " + errText(err)
	m.lastErr.Store(&msg)
	m.say("error", msg)
}

func errText(err error) string {
	var exc *moejs.Exception
	if errors.As(err, &exc) {
		return exc.Name() + ": " + exc.Message()
	}
	return err.Error()
}

// State is a middleware as the Plugins page shows it.
type State struct {
	Hooks    []string `json:"hooks"`
	Events   []string `json:"events,omitempty"`
	Error    string   `json:"error,omitempty"` // why it didn't load
	Calls    int64    `json:"calls"`
	AvgMicro float64  `json:"avgMicros"`
	Failures int64    `json:"failures"`
	Last     string   `json:"lastError,omitempty"`
}

// States are the middleware plugins, by spec.
func States() map[string]State {
	s := current()
	out := map[string]State{}
	for spec, e := range s.errs {
		out[spec] = State{Hooks: []string{}, Error: e}
	}
	for _, m := range s.list {
		st := State{Hooks: []string{}, Calls: m.calls.Load(), Failures: m.failures.Load()}
		for _, h := range []struct {
			ok   bool
			name string
		}{{m.hasReq, "onRequest"}, {m.hasEv, "onEvent"}, {m.hasResp, "onResponse"}} {
			if h.ok {
				st.Hooks = append(st.Hooks, h.name)
			}
		}
		for n := range m.events {
			st.Events = append(st.Events, n)
		}
		sort.Strings(st.Events)
		if st.Calls > 0 {
			st.AvgMicro = float64(m.nanos.Load()) / float64(st.Calls) / 1e3
		}
		if p := m.lastErr.Load(); p != nil {
			st.Last = *p
		}
		out[m.spec] = st
	}
	return out
}
