package provider

// When each subscription account, plan and key last answered a request
// through the gateway (#570): magpie quota --json and the gateway's GET
// /v1/magpie/quotas tell it as each Quota's lastServedAt, and mark the
// latest last, so a menu-bar widget can show the one in use — under
// routing Smart nobody is first for good. It is kept on disk (served.json,
// next to the providers), so the CLI, a process of its own, reads what the
// gateway noted, and a restart doesn't forget it.

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// servedKeep is how long an answer is remembered: a key or account gone
// since is dropped from the file after it.
const servedKeep = 30 * 24 * time.Hour

var servedAt = struct {
	sync.Mutex
	m    map[string]time.Time // ServedID → when it last answered
	path string               // the file m goes with: another (a test's HOME) starts afresh
}{m: map[string]time.Time{}}

// ours is servedAt.m for the file at path. Called with servedAt held.
func ours(path string) map[string]time.Time {
	if servedAt.path != path {
		servedAt.path, servedAt.m = path, map[string]time.Time{}
	}
	return servedAt.m
}

func servedPath() string { return filepath.Join(filepath.Dir(Path()), "served.json") }

// ServedID names who answers for p, as its Quota is found by: an account
// by its agent and user ("codex@a@b.c"), a key by its provider and the
// key's id ("deepseek#k1a2b3c"), else the provider.
func ServedID(p Provider) string {
	if a := p.Account; a != nil {
		return loginProvider(Login{Agent: a.Agent}) + "@" + strings.ToLower(a.User)
	}
	if p.Key != "" {
		return p.ID + "#" + KeyID(p.Key)
	}
	return p.ID
}

// NoteServed records that p just answered a request, at at.
func NoteServed(p Provider, at time.Time) {
	id := ServedID(p)
	path := servedPath()
	servedAt.Lock()
	defer servedAt.Unlock()
	mine := ours(path)
	if at.Before(mine[id]) {
		return
	}
	mine[id] = at
	m := readServed(path)
	for k, t := range mine {
		if t.After(m[k]) {
			m[k] = t
		}
	}
	for k, t := range m {
		if at.Sub(t) > servedKeep {
			delete(m, k)
		}
	}
	if b, err := json.Marshal(m); err == nil && os.MkdirAll(filepath.Dir(path), 0o700) == nil {
		writeFileAtomic(path, b)
	}
}

// LastServed is when each ServedID last answered: what this process noted
// and what the file holds, whichever gateway wrote it.
func LastServed() map[string]time.Time {
	path := servedPath()
	m := readServed(path)
	servedAt.Lock()
	for k, t := range ours(path) {
		if t.After(m[k]) {
			m[k] = t
		}
	}
	servedAt.Unlock()
	for k, t := range m {
		if time.Since(t) > servedKeep {
			delete(m, k)
		}
	}
	return m
}

func readServed(path string) map[string]time.Time {
	m := map[string]time.Time{}
	if b, err := os.ReadFile(path); err == nil {
		json.Unmarshal(b, &m)
	}
	if m == nil {
		m = map[string]time.Time{}
	}
	return m
}

// withServed sets each quota's LastServedAt from served, and Last on the
// latest (on each of them, when a key's plan and balance tie).
func withServed(qs []Quota, served map[string]time.Time) []Quota {
	if len(served) == 0 {
		return qs
	}
	var keys map[string][]KeyInfo // provider → its keys, read once
	var latest time.Time
	for i := range qs {
		q := &qs[i]
		var at time.Time
		latestOf := func(id string) {
			if t, ok := served[id]; ok && t.After(at) {
				at = t
			}
		}
		user := strings.ToLower(q.User)
		switch {
		case q.Kind == "subscription" && user != "":
			latestOf(q.Provider + "@" + user)
		case q.User == "":
			// the one account or key it has, or any of them: a balance
			// one account has whichever key asks
			for id, t := range served {
				if (id == q.Provider || strings.HasPrefix(id, q.Provider+"@") || strings.HasPrefix(id, q.Provider+"#")) && t.After(at) {
					at = t
				}
			}
		default:
			// a plan's or balance's key, by the name or mask it is told by
			if keys == nil {
				keys = map[string][]KeyInfo{}
				for _, p := range All() {
					keys[p.ID] = p.KeyList()
				}
			}
			for _, k := range keys[q.Provider] {
				if k.Name == q.User || k.Name == "" && k.Masked == q.User {
					latestOf(q.Provider + "#" + k.ID)
				}
			}
		}
		if !at.IsZero() {
			t := at.UTC()
			q.LastServedAt = &t
			if at.After(latest) {
				latest = at
			}
		}
	}
	for i := range qs {
		if qs[i].LastServedAt != nil && qs[i].LastServedAt.Equal(latest) {
			qs[i].Last = true
		}
	}
	return qs
}
