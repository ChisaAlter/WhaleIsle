package gateway

import (
	"net/http"
	"time"

	"github.com/yetone/magpie/internal/access"
	"github.com/yetone/magpie/internal/provider"
	"github.com/yetone/magpie/internal/usage"
)

// isMemoryKind: a call Codex makes to write or consolidate its memories,
// however it names one (usage.PurposeOf's memory_consolidation).
func isMemoryKind(kind string) bool {
	return usage.PurposeOf(kind) == "kind:memory_consolidation"
}

// codexTurnKey is whose turns codexTurns holds: the agent recorded and the
// gateway key it came with, so a Codex on another computer (its own key,
// #742's Codex-BWG and Codex-R4S) is told apart from this one's.
func codexTurnKey(r *http.Request, who string) string {
	return who + "\x00" + access.Caller(r.Context()).KeyID
}

// rememberCodexTurn keeps the model a turn of Codex's own conversation
// was asked on, one magpie serves, for its memory calls.
func (s *Server) rememberCodexTurn(r *http.Request, who, agent, kind, asked string) {
	if agent != "codex" || kind != "" {
		return
	}
	s.codexTurns.Store(codexTurnKey(r, who), asked)
}

// codexMemoryStandIn is the model a Codex memory call goes to when magpie
// knows none by the name it came with (#742): Codex writes and
// consolidates its memories on models of its own (memories.extract_model
// and consolidation_model, gpt-5.6-luna and gpt-5.6-terra by default) by
// their bare names, whatever it is set to, so with magpie as its provider
// every one was turned away as an unknown model before it was routed. It
// goes to the model that Codex's own turns go to — the last one it had
// answered here, else the last in the ledger (a week back) from the same
// agent with the same key — so it is routed, and in the views, as the
// memory call it is. "" for any other call, a model magpie serves, or a
// Codex that has had no turn answered here.
func (s *Server) codexMemoryStandIn(r *http.Request, who, agent, kind, asked string) string {
	if agent != "codex" || !isMemoryKind(kind) {
		return ""
	}
	if _, _, ok := provider.Resolve(asked); ok {
		return ""
	}
	key := codexTurnKey(r, who)
	if m, ok := s.codexTurns.Load(key); ok {
		if m, _ := m.(string); m != "" && m != asked {
			if _, _, ok := provider.Resolve(m); ok {
				return m
			}
		}
	}
	keyID := access.Caller(r.Context()).KeyID
	var last usage.Record
	usage.Visit(time.Now().Add(-7*24*time.Hour), func(rec usage.Record) {
		if rec.Agent != who || rec.CallerKeyID != keyID || rec.Kind != "" || rec.Rejected || rec.Failed() || rec.Requested == "" {
			return
		}
		if rec.Time.After(last.Time) {
			last = rec
		}
	})
	m := last.Requested
	if id, ok := provider.GroupFor(m); ok {
		m = id
	}
	if m == "" || m == asked {
		return ""
	}
	if _, _, ok := provider.Resolve(m); !ok {
		return ""
	}
	return m
}
