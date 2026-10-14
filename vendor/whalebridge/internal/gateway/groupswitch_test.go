package gateway

import (
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/yetone/magpie/internal/provider"
)

// A routing group switched off (PAMI on Discord) is not in /v1/models, a
// request to it is turned away saying it is off rather than sent to its
// models, and a group that has it in it goes on to its next member.
func TestSwitchedOffGroup(t *testing.T) {
	fresh(t)
	a, b := &keyed{}, &keyed{}
	serveOn(t, "pa", "ka", []string{"x"}, a)
	serveOn(t, "pb", "kb", []string{"y"}, b)
	if err := provider.SaveGroup(provider.Group{Name: "Inner", Members: []string{"pa/x"}}); err != nil {
		t.Fatal(err)
	}
	if err := provider.SaveGroup(provider.Group{Name: "Outer", Members: []string{"group/inner", "pb/y"}, Routing: provider.Ordered}); err != nil {
		t.Fatal(err)
	}
	if err := provider.SwitchGroup("inner", false); err != nil {
		t.Fatal(err)
	}
	s := New()
	code, body := postAs(t, s, "", `{"model":"group/inner","messages":[{"role":"user","content":"hi"}]}`)
	if code != 404 || !strings.Contains(body, "switched off") || len(a.tried) != 0 {
		t.Fatalf("to the group switched off: %d %s, tried %v", code, body, a.tried)
	}
	code, body = postAs(t, s, "", `{"model":"group/outer","messages":[{"role":"user","content":"hi"}]}`)
	if code != 200 || !strings.Contains(body, "from kb") || len(a.tried) != 0 {
		t.Fatalf("the group with it in it: %d %s, tried %v", code, body, a.tried)
	}
	rec := httptest.NewRecorder()
	s.upstreamHandler().ServeHTTP(rec, httptest.NewRequest("GET", "/v1/models", nil))
	if strings.Contains(rec.Body.String(), `"group/inner"`) || !strings.Contains(rec.Body.String(), `"group/outer"`) {
		t.Fatalf("listed: %s", rec.Body.String())
	}
	// on again, it answers
	if err := provider.SwitchGroup("inner", true); err != nil {
		t.Fatal(err)
	}
	code, body = postAs(t, s, "", `{"model":"group/inner","messages":[{"role":"user","content":"hi"}]}`)
	if code != 200 || !strings.Contains(body, "from ka") {
		t.Fatalf("on again: %d %s", code, body)
	}
}
