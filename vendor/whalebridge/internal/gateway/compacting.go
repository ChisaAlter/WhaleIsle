package gateway

import "strings"

// An agent compacting its conversation asks a model to summarize it, with
// a prompt of its own in the system prompt or as the last user message; a
// rule may send that request to a cheaper, faster model (provider.Rule's
// Compact). The prompts are the agents' own, read from each one's release.

// compactSystems open (or are) the system prompt of a compaction request.
var compactSystems = []string{
	// Claude Code 2.1, and OpenCode's before its own agent
	"You are a helpful AI assistant tasked with summarizing conversations.",
	// OpenCode's compaction agent (agent/prompt/compaction.txt)
	"You are a context summarization agent.",
	// Pi
	"You are a context summarization assistant.",
	// Gemini CLI
	"You are a specialized system component responsible for distilling chat history into a structured XML <state_snapshot>",
	// Qwen Code
	"You are the component that summarizes a conversation when its context window is about to overflow.",
}

// compactAsks are in the last user message of a compaction request.
var compactAsks = []string{
	// Claude Code's /compact and auto-compact
	"Your task is to create a detailed summary of the conversation so far",
	// Codex (and magpie's own for a Codex compaction_trigger)
	"You are performing a CONTEXT CHECKPOINT COMPACTION.",
	// Kimi Code (prompts/compact.md)
	"You are now given a task to compact this conversation context",
}

// compacting reports whether req is an agent compacting its conversation.
func compacting(req *Request) bool {
	if req == nil {
		return false
	}
	for _, p := range compactSystems {
		if strings.Contains(req.System, p) {
			return true
		}
	}
	for i := len(req.Messages) - 1; i >= 0; i-- {
		m := req.Messages[i]
		if m.Role != "user" {
			continue
		}
		for _, p := range m.Parts {
			if p.Kind != Text {
				continue
			}
			for _, a := range compactAsks {
				if strings.Contains(p.Text, a) {
					return true
				}
			}
		}
		break
	}
	return false
}
