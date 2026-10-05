package sessions

import (
	"crypto/sha256"
	"encoding/json"
	"time"
)

// Snapshot stores metadata only for emitted observations. Later patches update
// the same observation IDs without counting model metrics a second time.
// The latest 4096 observations per source bound memory for long-lived sessions.
type traceSnapshot struct {
	size    int64
	mod     time.Time
	done    map[string][32]byte
	ends    map[string]time.Time
	floor   time.Time
	order   []string
	gemini  *geminiTraceState
	settled bool
	oc      *ocTraceState
}

func (r *TraceReader) snapshot(path string) *traceSnapshot {
	s := r.snapshots[path]
	if s == nil {
		s = &traceSnapshot{done: map[string][32]byte{}, ends: map[string]time.Time{}}
		r.snapshots[path] = s
	}
	return s
}

func (r *TraceReader) observations(s *traceSnapshot, spans []TraceSpan) []TraceSpan {
	var out []TraceSpan
	for _, span := range spans {
		if span.Session == "" || span.Turn == "" || span.Start.IsZero() || span.End.Before(span.Start) || span.End.Before(r.Since) {
			continue
		}
		b, _ := json.Marshal(span)
		hash := sha256.Sum256(b)
		if prior, ok := s.done[span.ID]; ok {
			if prior == hash {
				continue
			}
			span.Update = true
		} else {
			if !s.floor.IsZero() && !span.End.After(s.floor) {
				continue
			}
			s.order = append(s.order, span.ID)
		}
		s.done[span.ID] = hash
		s.ends[span.ID] = span.End
		out = append(out, span)
	}
	if len(s.order) > 4096 {
		for _, id := range s.order[:len(s.order)-4096] {
			if s.ends[id].After(s.floor) {
				s.floor = s.ends[id]
			}
			delete(s.done, id)
			delete(s.ends, id)
		}
		s.order = append([]string(nil), s.order[len(s.order)-4096:]...)
	}
	return out
}
