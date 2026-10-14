package gateway

import (
	"context"
	"encoding/json"
	"github.com/yetone/magpie/internal/plugin"
	"github.com/yetone/magpie/internal/provider"
	"io"
	"net/http"
	"net/http/httptest"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// Upstream regression fixtures exercise the protocol handler. Component
// admission and its private token are verified separately through Handler.
// fake is an upstream that records what it got and replies with a script.
type fake struct {
	t     *testing.T
	got   []byte
	path  string
	head  http.Header
	reply string // SSE body
	ctype string // "" means text/event-stream; "none" sends no header at all
	code  int
	// refuse, when set, answers a request it gives a code for with it
	refuse func(body []byte) (code int, reply string)
	calls  int
}

func (f *fake) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.got, _ = io.ReadAll(r.Body)
	f.path, f.head = r.URL.Path, r.Header
	f.calls++
	if f.refuse != nil {
		if code, reply := f.refuse(f.got); code != 0 {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(code)
			io.WriteString(w, reply)
			return
		}
	}
	ct := f.ctype
	if ct == "" {
		ct = "text/event-stream"
	}
	if ct == "none" {
		w.Header()["Content-Type"] = nil // like the ChatGPT backend: the body alone says it streams
	} else {
		w.Header().Set("Content-Type", ct)
	}
	if f.code != 0 {
		w.WriteHeader(f.code)
	}
	io.WriteString(w, f.reply)
}

func sse(lines ...string) string {
	var b strings.Builder
	for _, l := range lines {
		b.WriteString(l + "\n\n")
	}
	return b.String()
}

// setup points magpie's provider file at a temp dir and adds one provider
// speaking only the given protocol, backed by the fake.
func setup(t *testing.T, proto provider.Protocol, f *fake) *httptest.Server {
	t.Helper()
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	t.Setenv("XDG_CACHE_HOME", t.TempDir())
	up := httptest.NewServer(f)
	t.Cleanup(up.Close)
	p := provider.Provider{ID: "fake", Name: "Fake", Key: "k", Models: []string{"m1"}}
	switch proto {
	case provider.Chat:
		p.Chat = up.URL + "/v1"
	case provider.Responses:
		p.Responses = up.URL + "/v1"
	case provider.Anthropic:
		p.Anthropic = up.URL
	}
	if err := provider.Save(p); err != nil {
		t.Fatal(err)
	}
	return up
}

func post(t *testing.T, path, body string) (int, string) {
	t.Helper()
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("POST", path, strings.NewReader(body))
	New().upstreamHandler().ServeHTTP(rec, req)
	return rec.Code, rec.Body.String()
}

func events(body string) []map[string]any {
	var out []map[string]any
	readSSE(strings.NewReader(body), func(_, data string) error {
		var m map[string]any
		if json.Unmarshal([]byte(data), &m) == nil {
			out = append(out, m)
		}
		return nil
	})
	return out
}

func serveOn(t *testing.T, id, key string, models []string, v http.Handler, keys ...string) {
	t.Helper()
	up := httptest.NewServer(v)
	t.Cleanup(up.Close)
	p := provider.Provider{ID: id, Name: strings.ToUpper(id), Key: key, Models: models, Chat: up.URL + "/v1"}
	for _, k := range keys {
		p.Keys = append(p.Keys, provider.KeyAccount{Key: k})
	}
	if err := provider.Save(p); err != nil {
		t.Fatal(err)
	}
}

func postAs(t *testing.T, s *Server, session, body string) (int, string) {
	t.Helper()
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/v1/chat/completions", strings.NewReader(body))
	if session != "" {
		req.Header.Set("x-session-id", session)
	}
	s.upstreamHandler().ServeHTTP(rec, req)
	return rec.Code, rec.Body.String()
}

// openRouterFreeLimit answers one free model with an OpenRouter limit and its
// sibling successfully.

type countTransport func(*http.Request) (*http.Response, error)

func (f countTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func refusalGroup(t *testing.T, members ...string) {
	t.Helper()
	if err := provider.SaveGroup(provider.Group{Name: "G", Members: members, Routing: provider.Ordered}); err != nil {
		t.Fatal(err)
	}
}

func lastRoute(s *Server) Route {
	s.trace.mu.Lock()
	defer s.trace.mu.Unlock()
	return *s.trace.routes[len(s.trace.routes)-1]
}

// scripted answers each request with the next of its replies, the last
// one over and over.
type scripted struct {
	replies []reply
	n       int
	hang    chan struct{} // when set, the first request waits on it
	limited http.Header   // headers each 429 goes with
}

type reply struct {
	code  int
	ctype string
	body  string
}

func (s *scripted) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	io.ReadAll(r.Body)
	i := min(s.n, len(s.replies)-1)
	s.n++
	if s.hang != nil && i == 0 {
		<-s.hang
	}
	x := s.replies[i]
	if x.ctype == "" {
		x.ctype = "application/json"
	}
	w.Header().Set("Content-Type", x.ctype)
	if x.code == http.StatusTooManyRequests {
		for k, vs := range s.limited {
			w.Header()[k] = vs
		}
	}
	if x.code != 0 {
		w.WriteHeader(x.code)
	}
	io.WriteString(w, x.body)
}

const chatOK = `{"id":"ok","choices":[{"index":0,"message":{"role":"assistant","content":"hello"},"finish_reason":"stop"}]}`

func scriptedOn(t *testing.T, id string, proto provider.Protocol, s *scripted) {
	t.Helper()
	up := httptest.NewServer(s)
	t.Cleanup(up.Close)
	p := provider.Provider{ID: id, Name: strings.ToUpper(id), Key: "k", Models: []string{"m"}}
	switch proto {
	case provider.Anthropic:
		p.Anthropic = up.URL
	default:
		p.Chat = up.URL + "/v1"
	}
	if err := provider.Save(p); err != nil {
		t.Fatal(err)
	}
}

// keepFast makes the keepalives of a test's streams come at its pace.
func keepFast(t *testing.T, gap, every, longest time.Duration) {
	t.Helper()
	g, e, l := keepaliveGap, keepaliveEvery, keepaliveLongest
	keepaliveGap, keepaliveEvery, keepaliveLongest = gap, every, longest
	t.Cleanup(func() { keepaliveGap, keepaliveEvery, keepaliveLongest = g, e, l })
}

// besideFake installs the fake plugin as the plugin of the built-in id,
// not moved onto it (id-plugin beside the built-in), signed in with a
// key, its requests going to up; it gives the provider's id.
func besideFake(t *testing.T, id string, up http.Handler) string {
	t.Helper()
	bun, err := exec.LookPath("bun")
	if err != nil {
		t.Skip("no bun on PATH")
	}
	fresh(t)
	t.Setenv("MAGPIE_BUN", bun)
	t.Setenv("FAKE_ID", id)
	t.Setenv("FAKE_RESPONSES", "1")
	t.Cleanup(plugin.Settle)
	srv := httptest.NewServer(up)
	t.Cleanup(srv.Close)
	t.Setenv("FAKE_BASE", srv.URL+"/v1")
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	abs, _ := filepath.Abs("../plugin/testdata/fake/index.js")
	if _, err := plugin.Add(ctx, abs); err != nil {
		t.Fatal(err)
	}
	if _, err := plugin.Providers(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := plugin.APIKey(ctx, id, 0, nil, "k1", plugin.NewAccount); err != nil {
		t.Fatal(err)
	}
	pid := provider.PluginID(id)
	if p, err := provider.Find(pid); err != nil || !p.IsPlugin() || p.PluginProvider() != id {
		t.Fatalf("Find(%s) = %+v, %v", pid, p, err)
	}
	return pid
}

func setHome(t *testing.T, dir string) {
	t.Helper()
	t.Setenv("HOME", dir)
	t.Setenv("USERPROFILE", dir)
}
func jsonStr(s string) string { b, _ := json.Marshal(s); return string(b) }
func forgetRouting() {
	routed.Lock()
	routed.turn, routed.used, routed.failures = map[string]int{}, map[string]tokenUse{}, map[string]int{}
	routed.Unlock()
	wrr.Lock()
	wrr.m = map[string]*wrrRound{}
	wrr.Unlock()
}

// keyed is a vendor that says which key each request came with, and
// answers as told for each.
type keyed struct {
	tried []string
	fail  map[string]int // key → status to fail with
}

func (k *keyed) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	io.ReadAll(r.Body)
	key := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	k.tried = append(k.tried, key)
	w.Header().Set("Content-Type", "application/json")
	if c := k.fail[key]; c != 0 {
		w.WriteHeader(c)
		io.WriteString(w, `{"error":{"message":"slow down"}}`)
		return
	}
	io.WriteString(w, `{"id":"x","choices":[{"index":0,"message":{"role":"assistant","content":"from `+key+`"},"finish_reason":"stop"}],`+
		`"usage":{"prompt_tokens":3000,"completion_tokens":5,"prompt_tokens_details":{"cached_tokens":2500}}}`)
}
