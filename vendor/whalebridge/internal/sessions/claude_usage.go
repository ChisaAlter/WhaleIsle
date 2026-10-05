package sessions

import (
	"container/list"
	"time"
)

// claudeUsageState tracks message revisions while a source is live. It is
// never persisted: a changed source reconstructs it after a cache reload.
type claudeUsageState struct {
	Messages map[string]map[string]*claudeContribution `json:"messages,omitempty"`
	recent   list.List
	entries  int
}

// Each active file keeps a recent window even when the whole source exceeds
// the shared index budget. Older messages fall back to the original reader
// behavior; their complete replay history is not retained.
const claudeRevisionEntries = revisionEntries / revisionFiles

type claudeContribution struct {
	key      string
	node     *list.Element
	weight   int
	Request  string                     `json:"request,omitempty"`
	Usage    *claudeUsageVersion        `json:"usage,omitempty"`
	Updated  time.Time                  `json:"updated"`
	Previous []claudeUsageVersion       `json:"previous,omitempty"`
	ReplyDay string                     `json:"reply_day,omitempty"`
	Replied  bool                       `json:"replied,omitempty"`
	Tools    map[string]claudeToolUsage `json:"tools,omitempty"`
	Call     int                        `json:"call"`
	Began    time.Time                  `json:"began"`
	Blocks   map[string]bool            `json:"blocks,omitempty"`
}

type claudeUsageVersion struct {
	At    time.Time `json:"at"`
	Model string    `json:"model"`
	Tokens
}

type claudeToolUsage struct {
	At          time.Time `json:"at"`
	Updated     time.Time `json:"updated"`
	Name, Skill string
	Previous    []claudeToolVersion `json:"previous,omitempty"`
}

type claudeToolVersion struct{ Name, Skill string }

func ccUsageState(p **claudeUsageState) *claudeUsageState {
	if *p == nil {
		*p = &claudeUsageState{}
	}
	return *p
}

// message only joins identities with compatible request IDs. Missing request
// IDs can adopt the sole known branch; a conflict keeps a separate branch.
// With neither ID there is no evidence that two lines are the same call.
func (r *claudeUsageState) message(id, request string) *claudeContribution {
	if id == "" && request == "" {
		return &claudeContribution{Call: -1}
	}
	key := "message:" + id
	if id == "" {
		key = "request:" + request
	}
	if r.Messages == nil {
		r.Messages = make(map[string]map[string]*claudeContribution)
	}
	branches := r.Messages[key]
	if branches == nil {
		branches = make(map[string]*claudeContribution)
		r.Messages[key] = branches
	}
	if m := branches[request]; m != nil {
		return m
	}
	if len(branches) == 1 {
		if request == "" {
			for _, m := range branches {
				return m
			}
		} else if m := branches[""]; m != nil {
			delete(branches, "")
			m.Request = request
			branches[request] = m
			return m
		}
	}
	m := &claudeContribution{Request: request, Call: -1, key: key}
	m.node = r.recent.PushBack(m)
	branches[request] = m
	return m
}

// finish accounts for changes made by this line and evicts the least recently
// used contributions. It never throws away the file's append offset or the
// current message's usage. Weight includes nested revision, block and tool IDs.
func (r *claudeUsageState) finish(m *claudeContribution) {
	if m.node == nil {
		return
	}
	n := m.entryWeight()
	if n > claudeRevisionEntries {
		// One exceptionally long message can fill the window by itself. Keep its
		// latest contribution (the original last-message rule), not its history.
		m.Previous, m.Tools, m.Blocks = nil, nil, nil
		n = m.entryWeight()
	}
	r.entries += n - m.weight
	m.weight = n
	r.recent.MoveToBack(m.node)
	for r.entries > claudeRevisionEntries {
		e := r.recent.Front()
		old := e.Value.(*claudeContribution)
		branches := r.Messages[old.key]
		delete(branches, old.Request)
		if len(branches) == 0 {
			delete(r.Messages, old.key)
		}
		r.entries -= old.weight
		r.recent.Remove(e)
		old.node = nil
	}
}

func (m *claudeContribution) entryWeight() int {
	n := 2 + len(m.Previous) + len(m.Tools) + len(m.Blocks)
	for _, tool := range m.Tools {
		n += len(tool.Previous)
	}
	return n
}

// accept replaces a contribution only for an unseen, later revision. Exact
// replays keep their original date, and replayed old snapshots cannot undo a
// later block even when the replay was written with a new timestamp.
func (m *claudeContribution) accept(at time.Time, model string, tokens Tokens) (*claudeUsageVersion, bool) {
	old := m.Usage
	if old != nil {
		if old.Model == model && old.Tokens == tokens {
			// Later blocks often repeat the same usage. Their timestamps
			// still bound the revision order, even though the contribution
			// keeps its original date. A modified replay of one of these
			// blocks must not become a new revision merely by appearing later.
			if at.After(m.Updated) {
				m.Updated = at
			}
			return old, false
		}
		for _, v := range m.Previous {
			if v.Model == model && v.Tokens == tokens {
				return old, false
			}
		}
		if at.IsZero() || !m.Updated.IsZero() && !at.After(m.Updated) {
			return old, false
		}
		m.Previous = append(m.Previous, *old)
	}
	m.Usage = &claudeUsageVersion{At: at, Model: model, Tokens: tokens}
	m.Updated = at
	return old, true
}

func (r *claudeUsageState) clone() *claudeUsageState {
	if r == nil {
		return nil
	}
	c := &claudeUsageState{Messages: make(map[string]map[string]*claudeContribution, len(r.Messages))}
	for key, branches := range r.Messages {
		copied := make(map[string]*claudeContribution, len(branches))
		for request, m := range branches {
			n := *m
			n.node = nil
			if m.Usage != nil {
				v := *m.Usage
				n.Usage = &v
			}
			n.Previous = append([]claudeUsageVersion(nil), m.Previous...)
			if m.Blocks != nil {
				n.Blocks = make(map[string]bool, len(m.Blocks))
				for id, seen := range m.Blocks {
					n.Blocks[id] = seen
				}
			}
			if m.Tools != nil {
				n.Tools = make(map[string]claudeToolUsage, len(m.Tools))
				for id, tool := range m.Tools {
					tool.Previous = append([]claudeToolVersion(nil), tool.Previous...)
					n.Tools[id] = tool
				}
			}
			copied[request] = &n
		}
		c.Messages[key] = copied
	}
	for e := r.recent.Front(); e != nil; e = e.Next() {
		m := e.Value.(*claudeContribution)
		n := c.Messages[m.key][m.Request]
		n.node = c.recent.PushBack(n)
		c.entries += n.weight
	}
	return c
}

func ccCount(s *state, m *claudeContribution, at time.Time, model string, tokens Tokens, main bool) {
	old, changed := m.accept(at, model, tokens)
	if changed {
		if old != nil {
			s.unuse(dateOf(old.At), old.Model, old.Tokens)
		}
		s.use(dateOf(at), model, tokens)
	}
	if main && !m.Replied {
		m.Replied, m.ReplyDay = true, dateOf(at)
		s.day(m.ReplyDay).Replies++
	}
}

// A later block can contain new tools even though its message usage repeats.
func ccTool(s *state, m *claudeContribution, at time.Time, id, name, skill string) {
	if id == "" {
		s.tool(at, name, skill)
		return
	}
	if m.Tools == nil {
		m.Tools = make(map[string]claudeToolUsage)
	}
	var previous []claudeToolVersion
	if old, ok := m.Tools[id]; ok {
		if old.Name == name && old.Skill == skill {
			if at.After(old.Updated) {
				old.Updated = at
				m.Tools[id] = old
			}
			return
		}
		if at.IsZero() || !old.Updated.IsZero() && !at.After(old.Updated) {
			return
		}
		for _, v := range old.Previous {
			if v.Name == name && v.Skill == skill {
				return
			}
		}
		previous = append(append([]claudeToolVersion(nil), old.Previous...), claudeToolVersion{old.Name, old.Skill})
		d := s.day(dateOf(old.At))
		if old.Name != "" {
			d.Tools[old.Name]--
		}
		if old.Skill != "" {
			d.Skills[old.Skill]--
		}
	}
	m.Tools[id] = claudeToolUsage{At: at, Updated: at, Name: name, Skill: skill, Previous: previous}
	s.tool(at, name, skill)
}
