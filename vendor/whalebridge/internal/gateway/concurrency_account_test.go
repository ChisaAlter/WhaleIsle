package gateway

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/yetone/magpie/internal/provider"
)

// laneRig is a gateway in front of slow vendors, and a way to send it
// requests that answer on a channel.
type laneRig struct {
	t       *testing.T
	s       *Server
	gw      *httptest.Server
	replies chan laneReply
	ctx     context.Context // ended when the test ends: nothing is left waiting in a lane
}

type laneReply struct {
	tag, body string
	status    int
	header    http.Header
	err       error
}

func newLaneRig(t *testing.T) *laneRig {
	s := New()
	gw := httptest.NewServer(s.Handler())
	t.Cleanup(gw.Close)
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel) // runs before gw.Close, which waits for every request
	return &laneRig{t: t, s: s, gw: gw, replies: make(chan laneReply, 20), ctx: ctx}
}

func slowUp(t *testing.T) (*slowVendor, string) {
	v := &slowVendor{release: map[string]chan struct{}{}, quit: make(chan struct{})}
	up := httptest.NewServer(v)
	t.Cleanup(up.Close)
	t.Cleanup(func() { close(v.quit) }) // runs first: a failed test leaves no handler waiting
	return v, up.URL
}

// send asks for model with a chat completions stream whose message is tag,
// or with Anthropic's Messages when path says so.
func (g *laneRig) send(ctx context.Context, path, model, tag string) {
	body := `{"model":"` + model + `","stream":true,"messages":[{"role":"user","content":"` + tag + `"}]}`
	if path == "/v1/messages" {
		body = `{"model":"` + model + `","max_tokens":64,"stream":true,"messages":[{"role":"user","content":"` + tag + `"}]}`
	}
	ctx, stop := context.WithCancel(ctx)
	context.AfterFunc(g.ctx, stop)
	go func() {
		defer stop()
		req, _ := http.NewRequestWithContext(ctx, "POST", g.gw.URL+path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer test-private-gateway-key")
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			g.replies <- laneReply{tag: tag, err: err}
			return
		}
		b, err := io.ReadAll(res.Body)
		res.Body.Close()
		g.replies <- laneReply{tag, string(b), res.StatusCode, res.Header, err}
	}()
}

func (g *laneRig) reply() laneReply {
	g.t.Helper()
	select {
	case r := <-g.replies:
		return r
	case <-time.After(5 * time.Second):
		g.t.Fatal("no reply")
	}
	return laneReply{}
}

// An account's or key's own limit (#892) is over the provider's, and its
// count is one whatever asks for it: a request for the model and requests
// through two routing groups, each with the key in it, wait for the one
// slot the key has, never more out at the vendor than that.
func TestAccountLimitSharedAcrossGroups(t *testing.T) {
	fresh(t)
	v, up := slowUp(t)
	five := 5
	if err := provider.Save(provider.Provider{ID: "slow", Name: "Slow", Key: "k", Models: []string{"m"}, Chat: up + "/v1",
		MaxConcurrency: &five, AccountConcurrency: map[string]int{provider.KeyID("k"): 1}}); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"one", "two"} {
		if err := provider.SaveGroup(provider.Group{ID: id, Name: id, Members: []string{"slow/m"}, Routing: provider.Ordered}); err != nil {
			t.Fatal(err)
		}
	}
	g := newLaneRig(t)
	lane := func() Lane { return g.s.Lanes()["slow#"+provider.KeyID("k")] }

	g.send(context.Background(), "/v1/chat/completions", "group/one", "a")
	within(t, "a at the vendor", func() bool { return len(v.seen()) == 1 })
	g.send(context.Background(), "/v1/chat/completions", "group/two", "b")
	within(t, "b queued", func() bool { return lane().Waiting == 1 })
	g.send(context.Background(), "/v1/chat/completions", "slow/m", "c")
	within(t, "c queued", func() bool { return lane().Waiting == 2 })
	if l := lane(); l.Busy != 1 || l.Limit != 1 {
		t.Fatalf("lane = %+v, want 1 out of a limit of 1 (the key's own, not the provider's 5)", l)
	}
	for i, tag := range []string{"a", "b", "c"} {
		close(v.gate(tag))
		if r := g.reply(); r.err != nil || r.tag != tag || !strings.Contains(r.body, "[DONE]") {
			t.Fatalf("reply %d = %+v, want %s whole", i, r, tag)
		}
	}
	if v.most != 1 {
		t.Fatalf("most out at once = %d, want 1", v.most)
	}
	within(t, "every slot given back", func() bool { return len(g.s.Lanes()) == 0 })

	// set to none, the key takes no slot at all, the provider's 5 or not
	if err := provider.SetAccountConcurrency("slow", provider.KeyID("k"), new(int)); err != nil {
		t.Fatal(err)
	}
	p, _ := provider.Find("slow")
	if n := p.LaneLimit(); n != 0 {
		t.Fatalf("limit set to none = %d", n)
	}
	// and given the provider's again, it has 5
	if err := provider.SetAccountConcurrency("slow", provider.KeyID("k"), nil); err != nil {
		t.Fatal(err)
	}
	p, _ = provider.Find("slow")
	if n := p.LaneLimit(); n != 5 {
		t.Fatalf("limit given back to the provider's = %d, want 5", n)
	}
}

// A provider's QueueLimit turns away one more than it holds at once, and
// QueueWait one that waited that long: each with a 429 in the API's own
// shape, Retry-After, the queue left as it was, and the vendor never asked.
func TestQueueFullAndWaitedOut(t *testing.T) {
	fresh(t)
	v, up := slowUp(t)
	one := 1
	if err := provider.Save(provider.Provider{ID: "slow", Name: "Slow", Key: "k", Models: []string{"m"}, Chat: up + "/v1", Anthropic: up,
		MaxConcurrency: &one, QueueLimit: 1, QueueWait: 1}); err != nil {
		t.Fatal(err)
	}
	g := newLaneRig(t)
	lane := func() Lane { return g.s.Lanes()["slow#"+provider.KeyID("k")] }

	g.send(context.Background(), "/v1/chat/completions", "slow/m", "a")
	within(t, "a at the vendor", func() bool { return len(v.seen()) == 1 })
	g.send(context.Background(), "/v1/chat/completions", "slow/m", "b")
	within(t, "b queued", func() bool { return lane().Waiting == 1 })

	// the queue full: c turned away at once, as OpenAI says a 429
	began := time.Now()
	g.send(context.Background(), "/v1/chat/completions", "slow/m", "c")
	r := g.reply()
	if r.tag != "c" || r.status != 429 || r.header.Get("Retry-After") == "" || time.Since(began) > 900*time.Millisecond {
		t.Fatalf("c = %+v, want an immediate 429 with Retry-After", r)
	}
	var oe struct {
		Error struct{ Message, Type string } `json:"error"`
	}
	if json.Unmarshal([]byte(r.body), &oe) != nil || !strings.Contains(oe.Error.Message, "queue is full") || oe.Error.Type == "" {
		t.Fatalf("c's body = %s, want OpenAI's error saying the queue is full", r.body)
	}
	// WhaleBridge exposes only the DSH chat endpoint; queue controls never open Messages.
	g.send(context.Background(), "/v1/messages", "slow/m", "d")
	r = g.reply()
	if r.status != 404 {
		t.Fatalf("excluded Messages endpoint status=%d", r.status)
	}

	// b waits its second and is turned away, out of the queue
	r = g.reply()
	if r.tag != "b" || r.status != 429 || !strings.Contains(r.body, "waited") {
		t.Fatalf("b = %+v, want a 429 for waiting too long", r)
	}
	if l := lane(); l.Busy != 1 || l.Waiting != 0 {
		t.Fatalf("lane after b waited out = %+v, want a alone", l)
	}
	if got := v.seen(); !slices.Equal(got, []string{"a"}) {
		t.Fatalf("vendor saw %v, want a alone", got)
	}
	close(v.gate("a"))
	if r := g.reply(); r.tag != "a" || !strings.Contains(r.body, "[DONE]") {
		t.Fatalf("a = %+v", r)
	}
	within(t, "every slot given back", func() bool { return len(g.s.Lanes()) == 0 })
}

// A slot is given back when the vendor fails the request, and the next
// one waiting is sent.
func TestLaneReleasedOnFailure(t *testing.T) {
	fresh(t)
	var mu sync.Mutex
	calls := 0
	gate := make(chan struct{})
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		calls++
		n := calls
		mu.Unlock()
		if n == 1 {
			<-gate
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(400)
			io.WriteString(w, `{"error":{"message":"bad request","type":"invalid_request_error"}}`)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		io.WriteString(w, "data: {\"id\":\"x\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"ok\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n")
	}))
	t.Cleanup(up.Close)
	one := 1
	if err := provider.Save(provider.Provider{ID: "slow", Name: "Slow", Key: "k", Models: []string{"m"}, Chat: up.URL + "/v1", MaxConcurrency: &one}); err != nil {
		t.Fatal(err)
	}
	g := newLaneRig(t)
	lane := func() Lane { return g.s.Lanes()["slow#"+provider.KeyID("k")] }
	g.send(context.Background(), "/v1/chat/completions", "slow/m", "a")
	within(t, "a out", func() bool { return lane().Busy == 1 })
	g.send(context.Background(), "/v1/chat/completions", "slow/m", "b")
	within(t, "b queued", func() bool { return lane().Waiting == 1 })
	close(gate)
	got := map[string]laneReply{}
	for range 2 {
		r := g.reply()
		got[r.tag] = r
	}
	if got["a"].status != 400 || got["b"].status != 200 || !strings.Contains(got["b"].body, "ok") {
		t.Fatalf("a = %+v, b = %+v: want a's failure, then b served", got["a"], got["b"])
	}
	within(t, "every slot given back", func() bool { return len(g.s.Lanes()) == 0 })
}

// A full member of a routing group gives way to one with a slot free (no
// waiting while another member has room), while a provider's fallback is
// never asked for want of a slot: the request waits for its own.
func TestFullMemberGivesWay(t *testing.T) {
	fresh(t)
	v1, up1 := slowUp(t)
	v2, up2 := slowUp(t)
	one := 1
	if err := provider.Save(provider.Provider{ID: "first", Name: "First", Key: "k1", Models: []string{"m"}, Chat: up1 + "/v1", MaxConcurrency: &one, Fallback: []string{"second/m"}}); err != nil {
		t.Fatal(err)
	}
	if err := provider.Save(provider.Provider{ID: "second", Name: "Second", Key: "k2", Models: []string{"m"}, Chat: up2 + "/v1", MaxConcurrency: &one}); err != nil {
		t.Fatal(err)
	}
	if err := provider.SaveGroup(provider.Group{ID: "pair", Name: "Pair", Members: []string{"first/m", "second/m"}, Routing: provider.Ordered}); err != nil {
		t.Fatal(err)
	}
	g := newLaneRig(t)
	firstLane := func() Lane { return g.s.Lanes()["first#"+provider.KeyID("k1")] }

	g.send(context.Background(), "/v1/chat/completions", "group/pair", "a")
	within(t, "a at first", func() bool { return len(v1.seen()) == 1 })
	// first is full: b goes to second at once
	g.send(context.Background(), "/v1/chat/completions", "group/pair", "b")
	within(t, "b at second", func() bool { return slices.Contains(v2.seen(), "b") })
	if l := firstLane(); l.Waiting != 0 {
		t.Fatalf("first's lane = %+v, want nobody waiting", l)
	}
	// both full: c waits for first, the group's first member
	g.send(context.Background(), "/v1/chat/completions", "group/pair", "c")
	within(t, "c queued at first", func() bool { return firstLane().Waiting == 1 })

	// asked for first/m itself, d waits for first rather than going to its
	// fallback
	g.send(context.Background(), "/v1/chat/completions", "first/m", "d")
	within(t, "d queued at first", func() bool { return firstLane().Waiting == 2 })
	close(v2.gate("b"))
	if r := g.reply(); r.tag != "b" || !strings.Contains(r.body, "from b") {
		t.Fatalf("b = %+v", r)
	}
	time.Sleep(50 * time.Millisecond)
	if slices.Contains(v2.seen(), "d") {
		t.Fatal("d went to first's fallback for want of a slot")
	}
	for _, tag := range []string{"a", "c", "d"} {
		close(v1.gate(tag))
		if r := g.reply(); r.tag != tag || !strings.Contains(r.body, "[DONE]") {
			t.Fatalf("%s = %+v", tag, r)
		}
	}
	within(t, "every slot given back", func() bool { return len(g.s.Lanes()) == 0 })
}
