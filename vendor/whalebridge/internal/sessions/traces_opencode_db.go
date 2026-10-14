package sessions

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"github.com/yetone/magpie/internal/provider"
)

// These connections belong to the trace reader, not the Sessions listing cache.
// Updates are read in timestamp/ID order in bounded batches; large histories
// neither hold dbReadMu nor force the entire conversation to be re-exported.
type ocTraceState struct {
	messages      map[string]ocTraceMessage
	order         []string
	bytes         int
	sizes         map[string]int
	message, part ocTracePosition
	turns         map[string]TraceSpan
	v2            bool
}
type ocTracePosition struct {
	at int64
	id string
}

func (r *TraceReader) pollOpenCodeDB(path string, bodies bool, budget *int64) ([]TraceSpan, bool) {
	db, err := provider.OpenReadOnly(path)
	if err != nil {
		return nil, true
	}
	defer db.Close()
	db.SetMaxOpenConns(1)
	parent := map[string]string{}
	const q = `SELECT id, COALESCE(parent_id, ''), time_updated, 0, 0 FROM %s %s`
	var files []file
	if ocHasTable(db, "session_v2") {
		files = ocDBRows(db, fmt.Sprintf(q, "session_v2", ""), "opencode", path, ocV2DB{db}, parent)
	}
	if ocHasTable(db, "session") && !ocMigrated(db) {
		where := ""
		if len(files) > 0 {
			where = `WHERE id NOT IN (SELECT id FROM session_v2)`
		}
		files = append(files, ocDBRows(db, fmt.Sprintf(q, "session", where), "opencode", path, ocDB{db}, parent)...)
	}
	files = ocRoots(files, parent)
	// Retain only the latest stores, as for JSONL discovery.
	sortTraceOCFiles(files)
	if len(files) > Limit {
		files = files[:Limit]
	}
	var out []TraceSpan
	pending := false
	seen := map[string]bool{}
	resumeSaved := false
	start := 0
	if len(files) > 0 {
		start = r.ocNext % len(files)
	}
	r.ocNext = 0
	for n := 0; n < len(files); n++ {
		i := (start + n) % len(files)
		f := files[i]
		key := "opencode:" + f.path
		seen[key] = true
		if !f.main {
			continue
		}
		if *budget <= 0 {
			pending = true
			if !resumeSaved {
				r.ocNext = i
				resumeSaved = true
			}
			continue
		}
		snap := r.snapshot(key)
		v2 := false
		if _, ok := f.oc.(ocV2DB); ok {
			v2 = true
		}
		if snap.oc == nil || snap.oc.v2 != v2 {
			// Older prompts are fetched on demand as ancestry, never exported.
			snap.oc = &ocTraceState{v2: v2, messages: map[string]ocTraceMessage{}, turns: map[string]TraceSpan{}, message: ocTracePosition{at: r.Since.UnixMilli() - 1}, part: ocTracePosition{at: r.Since.UnixMilli() - 1}}
		}
		state := snap.oc
		changed := map[string]bool{}
		table, kind := "message", "''"
		if v2 {
			table, kind = "session_message", "type"
		}
		// A row too large for the retained body window is read as metadata;
		// body export is bounded independently from traversal progress.
		more, ok := state.readRows(db, table, kind, f.sid, false, bodies, budget, changed)
		pending = pending || more || !ok
		if !v2 && *budget > 0 {
			more, ok = state.readRows(db, "part", "''", f.sid, true, bodies, budget, changed)
			pending = pending || more || !ok
		}
		// Part-only updates may refer to messages evicted from the body window.
		// Hydrate their small headers after closing the streaming rows cursor.
		for mid, m := range state.messages {
			if m.Role != "" {
				continue
			}
			var raw []byte
			if db.QueryRow(`SELECT CASE WHEN length(data)>8388608 THEN json_remove(data,'$.text','$.content') ELSE data END FROM message WHERE id=? AND session_id=?`, mid, f.sid).Scan(&raw) == nil {
				*budget -= int64(len(raw))
				var doc ocTraceMessage
				if json.Unmarshal(raw, &doc) == nil {
					doc.ID = mid
					doc.Content = m.Content
					normalizeOCMessage(&doc, bodies)
					state.put(doc)
					changed[mid] = true
				}
			}
		}
		for mid := range changed {
			if state.messages[mid].Role == "user" {
				for id, m := range state.messages {
					if m.Role == "assistant" && m.ParentID == mid {
						changed[id] = true
					}
				}
			}
		}
		for mid := range changed {
			m, ok := state.messages[mid]
			if !ok || m.Role != "assistant" {
				continue
			}
			user := state.user(db, table, m, bodies, budget)
			if user.ID == "" {
				continue
			}
			m.ParentID = user.ID
			spans := traceOpenCode(f.sid, []ocTraceMessage{user, m}, bodies)
			for i, span := range spans {
				if span.Parent != "" {
					continue
				}
				if prior, exists := state.turns[user.ID]; exists {
					if prior.End.After(span.End) {
						span.End, span.Output = prior.End, prior.Output
					}
					span.Error = span.Error || prior.Error
				}
				state.turns[user.ID] = span
				spans[i] = span
			}
			out = append(out, r.observations(snap, spans)...)
		}
		state.trim()
	}
	for key := range r.snapshots {
		if strings.HasPrefix(key, "opencode:") && !seen[key] {
			delete(r.snapshots, key)
		}
	}
	return out, pending
}

// Soft budgets allow one row's metadata to make progress. LIMIT and the cursor
// ensure an oversized session resumes next tick instead of restarting forever.
func (s *ocTraceState) readRows(db *sql.DB, table, kind, sid string, parts, bodies bool, budget *int64, changed map[string]bool) (bool, bool) {
	pos := &s.message
	mid := "id"
	if parts {
		pos, mid = &s.part, "message_id"
	}
	query := fmt.Sprintf(`SELECT id, %s, %s, time_updated, length(data), CASE WHEN length(data) > %d THEN json_remove(data,'$.text','$.content','$.state.input','$.state.output','$.state.content','$.state.error') ELSE data END FROM %s WHERE session_id=? AND (time_updated>? OR (time_updated=? AND id>?)) ORDER BY time_updated,id LIMIT 256`, mid, kind, 8<<20, table)
	rows, err := db.Query(query, sid, pos.at, pos.at, pos.id)
	if err != nil {
		return false, false
	}
	defer rows.Close()
	n := 0
	for rows.Next() {
		var id, message, typ string
		var at, size int64
		var raw []byte
		if rows.Scan(&id, &message, &typ, &at, &size, &raw) != nil {
			return true, false
		}
		*budget -= int64(len(raw))
		*pos = ocTracePosition{at: at, id: id}
		n++
		if parts {
			m, exists := s.messages[message]
			if !exists {
				// Fetch outside the active rows cursor after it is closed.
				changed[message] = true
				// Missing messages are hydrated in a second pass below.
				m.ID = message
			}
			var p ocTracePart
			if json.Unmarshal(raw, &p) == nil {
				p.ID = id
				if !bodies {
					stripOCPart(&p)
				}
				found := false
				for i := range m.Content {
					if m.Content[i].ID == id {
						m.Content[i], found = p, true
						break
					}
				}
				if !found && len(m.Content) < 4096 {
					m.Content = append(m.Content, p)
				}
				s.put(m)
				changed[message] = true
			}
		} else {
			var m ocTraceMessage
			if json.Unmarshal(raw, &m) == nil {
				m.ID = id
				if m.Role == "" {
					m.Role = typ
				}
				normalizeOCMessage(&m, bodies)
				if table == "message" {
					m.Content = s.messages[id].Content
				}
				s.put(m)
				changed[id] = true
			}
		}
		if *budget <= 0 {
			return true, true
		}
	}
	if rows.Err() != nil {
		return true, false
	}
	rows.Close()
	return n == 256, true
}

func normalizeOCMessage(m *ocTraceMessage, bodies bool) {
	if m.Role == "" {
		m.Role = m.Type
	}
	if m.Model.ID != "" {
		m.ModelID, m.ProviderID = m.Model.ID, m.Model.ProviderID
	}
	if !bodies {
		m.Text = ""
		for i := range m.Content {
			stripOCPart(&m.Content[i])
		}
		if len(m.Error) > 0 && string(m.Error) != "null" {
			m.Error = json.RawMessage(`true`)
		}
	}
}
func stripOCPart(p *ocTracePart) {
	p.Text = ""
	p.State.Input = nil
	p.State.Output = nil
	p.State.Content = nil
	p.State.Error = nil
}
func (s *ocTraceState) put(m ocTraceMessage) {
	for i, id := range s.order {
		if id == m.ID {
			s.order = append(s.order[:i], s.order[i+1:]...)
			break
		}
	}
	s.order = append(s.order, m.ID)
	if s.sizes == nil {
		s.sizes = map[string]int{}
	}
	b, _ := json.Marshal(m)
	s.bytes += len(b) - s.sizes[m.ID]
	s.sizes[m.ID] = len(b)
	s.messages[m.ID] = m
}
func (s *ocTraceState) trim() {
	// Bodies are never retained when disabled; cap both count and bytes when on.
	bytes := 0
	keep := len(s.order)
	for i := len(s.order) - 1; i >= 0; i-- {
		bytes += s.sizes[s.order[i]]
		if len(s.order)-i > 256 || (bytes > 8<<20 && i < len(s.order)-1) {
			keep = len(s.order) - i - 1
			break
		}
	}
	for _, id := range s.order[:len(s.order)-keep] {
		s.bytes -= s.sizes[id]
		delete(s.messages, id)
		delete(s.sizes, id)
	}
	s.order = append([]string(nil), s.order[len(s.order)-keep:]...)
	if len(s.turns) > 256 {
		keys := make([]string, 0, len(s.turns))
		for id := range s.turns {
			keys = append(keys, id)
		}
		sort.Slice(keys, func(i, j int) bool { return s.turns[keys[i]].End.After(s.turns[keys[j]].End) })
		for _, id := range keys[128:] {
			delete(s.turns, id)
		}
	}
	// Root bodies also retain references; keep the most recent within the bound.
	rootKeys := make([]string, 0, len(s.turns))
	for id := range s.turns {
		rootKeys = append(rootKeys, id)
	}
	sort.Slice(rootKeys, func(i, j int) bool { return s.turns[rootKeys[i]].End.After(s.turns[rootKeys[j]].End) })
	rootBytes := 0
	for _, id := range rootKeys {
		span := s.turns[id]
		rootBytes += len(span.Input) + len(span.Output)
		if rootBytes > 8<<20 {
			span.Input, span.Output = "", ""
			s.turns[id] = span
		}
	}
}

func (s *ocTraceState) user(db *sql.DB, table string, m ocTraceMessage, bodies bool, budget *int64) ocTraceMessage {
	if user, ok := s.messages[m.ParentID]; ok && user.Role == "user" {
		return user
	}
	var id string
	var raw []byte
	doc := `CASE WHEN length(data)>8388608 THEN json_remove(data,'$.text','$.content') ELSE data END`
	if !bodies || *budget <= 0 {
		doc = `json_remove(data,'$.text','$.content')`
	}
	if m.ParentID != "" {
		if db.QueryRow("SELECT id,"+doc+" FROM "+table+" WHERE id=?", m.ParentID).Scan(&id, &raw) != nil {
			return ocTraceMessage{}
		}
	} else {
		role := `json_extract(data,'$.role')`
		if table == "session_message" {
			role = "type"
		}
		// V2 has no parentID; pick the preceding user in this session only.
		if db.QueryRow("SELECT id,"+doc+" FROM "+table+" WHERE session_id=(SELECT session_id FROM "+table+" WHERE id=?) AND "+role+"='user' AND time_created<=? ORDER BY time_created DESC,id DESC LIMIT 1", m.ID, m.Time.Created).Scan(&id, &raw) != nil {
			return ocTraceMessage{}
		}
	}
	*budget -= int64(len(raw))
	var user ocTraceMessage
	if json.Unmarshal(raw, &user) != nil {
		return user
	}
	user.ID, user.Role = id, "user"
	normalizeOCMessage(&user, bodies)
	if table == "message" && bodies && *budget > 0 {
		rows, err := db.Query(`SELECT id,CASE WHEN length(data)>8388608 THEN json_remove(data,'$.text','$.state.input','$.state.output','$.state.content','$.state.error') ELSE data END FROM part WHERE message_id=? LIMIT 4096`, id)
		if err == nil {
			defer rows.Close()
			for *budget > 0 && rows.Next() {
				var pid string
				var b []byte
				if rows.Scan(&pid, &b) == nil {
					*budget -= int64(len(b))
					var p ocTracePart
					if json.Unmarshal(b, &p) == nil {
						p.ID = pid
						user.Content = append(user.Content, p)
					}
				}
			}
		}
	}
	s.put(user)
	return user
}

func sortTraceOCFiles(files []file) {
	sort.Slice(files, func(i, j int) bool { return files[i].mod.After(files[j].mod) })
}
