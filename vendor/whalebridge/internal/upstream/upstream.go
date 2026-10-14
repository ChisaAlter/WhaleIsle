// Package upstream reads the vendors' own status pages (#971, emo172): a
// request that fails while Anthropic's or OpenAI's API is down looks, in
// magpie, like a sign-in or quota problem, and the user signs in again and
// again for nothing. A vendor whose page says its API is degraded or down
// is said so where its providers are listed.
//
// Only the page's own parts that the API magpie calls stands on are read
// (the Claude API and Claude Code, not claude.ai; OpenAI's Chat
// Completions, Responses and Codex, not ChatGPT's or its desktop app's): a vendor's
// app being down says nothing of its API. A page that couldn't be read is
// unknown, never "all well". The pages are read only when the GUI asks,
// at most once in Fresh, and never on a request's way.
package upstream

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"slices"
	"strings"
	"sync"
	"time"
)

// Vendor is a vendor whose status page magpie knows.
type Vendor struct {
	ID   string
	Name string
	// Page is the status page people read; Summary its Statuspage-style
	// JSON (/api/v2/summary.json), "" when it has none magpie can read
	// (DeepSeek's, on Flashduty): the page is then only linked.
	Page    string
	Summary string
	// Hosts are the API hosts a provider calls the vendor on.
	Hosts []string
	// Part says whether a component of the page is one the API stands on.
	Part func(name string) bool
}

// Vendors are the ones whose pages were checked by hand (2026-10-06):
// each one's summary.json answered with its components.
var Vendors = []Vendor{
	{ID: "anthropic", Name: "Anthropic", Page: "https://status.claude.com",
		Summary: "https://status.claude.com/api/v2/summary.json",
		Hosts:   []string{"api.anthropic.com"},
		// "Claude API (api.anthropic.com)", and "Claude Code", which a
		// Claude subscription's requests run through
		Part: func(n string) bool { return strings.HasPrefix(n, "Claude API") || n == "Claude Code" }},
	{ID: "openai", Name: "OpenAI", Page: "https://status.openai.com",
		Summary: "https://status.openai.com/api/v2/summary.json",
		Hosts:   []string{"api.openai.com", "chatgpt.com"},
		// a ChatGPT account's Codex requests are Responses requests; the
		// page's "Codex in ChatGPT Desktop" is the app, not the API
		Part: func(n string) bool {
			return slices.Contains([]string{"Chat Completions", "Responses", "Codex", "Codex CLI"}, n)
		}},
	{ID: "moonshot", Name: "Moonshot AI", Page: "https://status.moonshot.cn",
		Summary: "https://status.moonshot.cn/api/v2/summary.json",
		Hosts:   []string{"api.moonshot.cn", "api.moonshot.ai"},
		// the Open API and its models, not Kimi's website or sign-up
		Part: func(n string) bool {
			return n == "Open API" || n == "API Service" || n == "Model" || strings.HasSuffix(n, " Model")
		}},
	{ID: "deepseek", Name: "DeepSeek", Page: "https://status.deepseek.com",
		Hosts: []string{"api.deepseek.com"}},
}

// VendorOf is the vendor a provider calling these base URLs reaches, ""
// for none magpie knows (a relay, a local server).
func VendorOf(bases ...string) string {
	for _, b := range bases {
		h := hostOf(b)
		for _, v := range Vendors {
			if slices.Contains(v.Hosts, h) {
				return v.ID
			}
		}
	}
	return ""
}

func hostOf(u string) string {
	u = strings.TrimSpace(u)
	if i := strings.Index(u, "://"); i >= 0 {
		u = u[i+3:]
	}
	if i := strings.IndexAny(u, "/?#"); i >= 0 {
		u = u[:i]
	}
	if i := strings.LastIndex(u, ":"); i >= 0 && !strings.Contains(u[i:], "]") {
		u = u[:i]
	}
	return strings.ToLower(u)
}

// Status is what a vendor's page says of its API.
type Status struct {
	Vendor string `json:"vendor"`
	Name   string `json:"name"`
	Page   string `json:"page"`
	// Level is the worst of its API's parts: "ok", "degraded", "partial"
	// (a partial outage), "major" (a major outage) or "maintenance"; ""
	// when the page wasn't read (none to read, or it failed: Error).
	Level     string     `json:"level"`
	Parts     []Part     `json:"parts,omitempty"`     // the API's parts that aren't operational
	Incidents []Incident `json:"incidents,omitempty"` // open incidents on them
	Read      time.Time  `json:"read,omitzero"`
	Error     string     `json:"error,omitempty"`
}

// Part is a component of the page and its state as the page words it
// (degraded_performance, partial_outage, major_outage, under_maintenance).
type Part struct {
	Name   string `json:"name"`
	Status string `json:"status"`
}

// Incident is an open incident the page lists.
type Incident struct {
	Name   string `json:"name"`
	Impact string `json:"impact,omitempty"`
	URL    string `json:"url,omitempty"`
}

// Fresh is how long a page read is kept: the pages change by the
// minute in an outage, but nobody needs them to the second.
const Fresh = 5 * time.Minute

var (
	mu     sync.Mutex
	kept   = map[string]Status{}
	asking = map[string]bool{}
	// now and client are for tests to stand in for
	now    = time.Now
	client = func() *http.Client { return http.DefaultClient }
)

// Of is what each of these vendors' pages said when last read. One not
// read within Fresh is asked for again in the background; until it
// answers, the last reading (or an unread one) stands. Of never waits.
func Of(ids ...string) []Status {
	mu.Lock()
	defer mu.Unlock()
	var out []Status
	for _, id := range ids {
		i := slices.IndexFunc(Vendors, func(v Vendor) bool { return v.ID == id })
		if i < 0 {
			continue
		}
		v := Vendors[i]
		s, ok := kept[id]
		if !ok {
			s = Status{Vendor: v.ID, Name: v.Name, Page: v.Page}
		}
		if v.Summary != "" && !asking[id] && (!ok || now().Sub(s.Read) >= Fresh) {
			asking[id] = true
			go ask(v)
		}
		out = append(out, s)
	}
	return out
}

// Wait is Of, after waiting up to d for the pages being asked for: for
// tests, and the GUI's first look.
func Wait(d time.Duration, ids ...string) []Status {
	Of(ids...)
	for end := time.Now().Add(d); time.Now().Before(end); time.Sleep(20 * time.Millisecond) {
		mu.Lock()
		busy := slices.ContainsFunc(ids, func(id string) bool { return asking[id] })
		mu.Unlock()
		if !busy {
			break
		}
	}
	return Of(ids...)
}

func ask(v Vendor) {
	s := read(v)
	mu.Lock()
	defer mu.Unlock()
	delete(asking, v.ID)
	if s.Error != "" {
		// a page that failed is unknown, not "all well", and not asked
		// again for a while either; what it said before is not kept as
		// if it were still so
		s.Level = ""
	}
	kept[v.ID] = s
}

// Forget drops every reading, for tests.
func Forget() {
	mu.Lock()
	defer mu.Unlock()
	kept = map[string]Status{}
}

// summary is the part of a Statuspage summary.json (and incident.io's,
// which OpenAI's is) that is read.
type summary struct {
	Components []struct {
		ID     string `json:"id"`
		Name   string `json:"name"`
		Status string `json:"status"`
		Group  *bool  `json:"group"`
	} `json:"components"`
	Incidents []struct {
		Name       string `json:"name"`
		Status     string `json:"status"`
		Impact     string `json:"impact"`
		Shortlink  string `json:"shortlink"`
		Components []struct {
			ID   string `json:"id"`
			Name string `json:"name"`
		} `json:"components"`
	} `json:"incidents"`
}

// level ranks a component's status; 0 is operational (or one unknown).
var level = map[string]int{"under_maintenance": 1, "degraded_performance": 2, "partial_outage": 3, "major_outage": 4}
var levelName = []string{"ok", "maintenance", "degraded", "partial", "major"}

func read(v Vendor) Status {
	s := Status{Vendor: v.ID, Name: v.Name, Page: v.Page, Read: now()}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, "GET", v.Summary, nil)
	if err != nil {
		s.Error = err.Error()
		return s
	}
	req.Header.Set("Accept", "application/json")
	res, err := client().Do(req)
	if err != nil {
		s.Error = err.Error()
		return s
	}
	defer res.Body.Close()
	body, err := io.ReadAll(io.LimitReader(res.Body, 4<<20))
	if err != nil {
		s.Error = err.Error()
		return s
	}
	if res.StatusCode != http.StatusOK {
		s.Error = fmt.Sprintf("%s answered %d", v.Page, res.StatusCode)
		return s
	}
	var sum summary
	if err := json.Unmarshal(body, &sum); err != nil || sum.Components == nil {
		s.Error = fmt.Sprintf("%s's summary couldn't be read", v.Page)
		return s
	}
	worst, mine := 0, map[string]bool{}
	for _, c := range sum.Components {
		if c.Group != nil && *c.Group || !v.Part(c.Name) {
			continue
		}
		mine[c.ID], mine[c.Name] = true, true
		if n := level[c.Status]; n > 0 {
			worst = max(worst, n)
			s.Parts = append(s.Parts, Part{c.Name, c.Status})
		}
	}
	if len(mine) == 0 {
		// none of the parts it is known by: the page changed, and what
		// it says can't be told for the API
		s.Error = fmt.Sprintf("%s lists none of its API's parts", v.Page)
		return s
	}
	s.Level = levelName[worst]
	for _, in := range sum.Incidents {
		if in.Status == "resolved" || in.Status == "postmortem" {
			continue
		}
		// one on the API's parts; one that names no parts (OpenAI's do
		// not) only while those parts are said to be affected
		on := len(in.Components) == 0 && worst > 0
		for _, c := range in.Components {
			on = on || mine[c.ID] || mine[c.Name]
		}
		if on {
			s.Incidents = append(s.Incidents, Incident{in.Name, in.Impact, in.Shortlink})
		}
	}
	return s
}
