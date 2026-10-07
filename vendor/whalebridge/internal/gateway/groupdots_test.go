package gateway

import (
	"strings"
	"testing"
	"time"

	"github.com/yetone/magpie/internal/provider"
)

// A routing group whose id keeps a model's dots (#968) is served by it, as
// group/<id> and as the bare name, and the call is recorded under it.
func TestDottedGroupID(t *testing.T) {
	fresh(t)
	a, b := &keyed{}, &keyed{fail: map[string]int{"kb": 429}}
	serveOn(t, "a", "ka", []string{"gpt-6.1-sol"}, a)
	serveOn(t, "b", "kb", []string{"gpt-6.1-sol"}, b)
	if err := provider.SaveGroup(provider.Group{Name: "GPT 6.1 Sol", Members: []string{"b/gpt-6.1-sol", "a/gpt-6.1-sol"}, Routing: provider.Ordered}); err != nil {
		t.Fatal(err)
	}
	s := New()
	for _, id := range []string{"group/gpt-6.1-sol", "gpt-6.1-sol"} {
		a.tried, b.tried = nil, nil
		restingUntil.Lock()
		restingUntil.m = map[string]time.Time{}
		restingUntil.Unlock()
		sticks.Lock()
		sticks.m = map[string]stick{}
		sticks.Unlock()
		code, body := postAs(t, s, "", `{"model":"`+id+`","messages":[{"role":"user","content":"hi"}]}`)
		if code != 200 || !strings.Contains(body, "from ka") || strings.Join(b.tried, ",") != "kb" {
			t.Fatalf("%s: %d %s, b tried %v", id, code, body, b.tried)
		}
		r := s.trace.routes[len(s.trace.routes)-1]
		if r.Group == nil || r.Group.ID != "gpt-6.1-sol" || s.Recent()[0].Model != id {
			t.Fatalf("%s: route %+v call %+v", id, r.Group, s.Recent()[0])
		}
	}
}
