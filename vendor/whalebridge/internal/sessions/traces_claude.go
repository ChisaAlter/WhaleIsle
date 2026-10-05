package sessions

import (
	"encoding/json"
	"strings"
	"time"
)

// Claude appends one record per content block, repeating message-level usage.
// Keep the current response until a result, next response or turn boundary;
// count it once, using the last usage record. Transcript timestamps don't
// record request or tool start, so those intervals are explicitly inferred.
type claudeTraceMessage struct {
	span    TraceSpan
	content []json.RawMessage
	stop    string
}

func (c *traceCursor) flushClaude() []TraceSpan {
	m := c.claudeMessage
	if m == nil {
		return nil
	}
	c.claudeMessage = nil
	if len(m.content) > 0 {
		b, _ := json.Marshal(m.content)
		m.span.Output = string(b)
	}
	return []TraceSpan{m.span}
}

func (c *traceCursor) finishClaude(force bool) []TraceSpan {
	m := c.claudeMessage
	if m == nil || !force && (len(c.tools) != 0 || m.stop == "tool_use") {
		return nil
	}
	out := c.flushClaude()
	if t := c.turns[c.current]; t != nil {
		t.completed = true
		t.output = out[0].Output
		root := c.root(t, t.last, t.failed)
		root.Inferred = true
		out = append(out, root)
	}
	return out
}

func (c *traceCursor) claude(line []byte, bodies bool) []TraceSpan {
	var o struct {
		Type, Subtype, UUID, SessionID, Entrypoint string
		Timestamp                                  time.Time
		IsMeta, IsApiErrorMessage                  bool
		Message                                    struct {
			ID, Model  string
			StopReason string `json:"stop_reason"`
			Content    json.RawMessage
			Usage      struct {
				Input      int `json:"input_tokens"`
				Output     int `json:"output_tokens"`
				CacheRead  int `json:"cache_read_input_tokens"`
				CacheWrite int `json:"cache_creation_input_tokens"`
			}
		}
	}
	if json.Unmarshal(line, &o) != nil || o.Timestamp.IsZero() {
		return nil
	}
	if o.SessionID != "" {
		c.session = o.SessionID
	}
	if o.Entrypoint == "claude-desktop" {
		c.agent = "claude-desktop"
	}
	type block struct {
		Type, ID, Name string
		ToolUseID      string `json:"tool_use_id"`
		Input, Content json.RawMessage
		IsError        bool `json:"is_error"`
	}
	var parts []block
	// tool_use_id cannot be decoded into ToolUseID without its explicit tag.
	var blocks []json.RawMessage
	json.Unmarshal(o.Message.Content, &blocks)
	for _, b := range blocks {
		var p block
		if json.Unmarshal(b, &p) == nil {
			parts = append(parts, p)
		}
	}
	var out []TraceSpan
	if o.Type == "user" {
		result := false
		for _, p := range parts {
			if p.Type != "tool_result" {
				continue
			}
			result = true
			out = append(out, c.flushClaude()...)
			if tool, ok := c.tools[p.ToolUseID]; ok {
				delete(c.tools, p.ToolUseID)
				tool.End, tool.Error = o.Timestamp, p.IsError
				if bodies {
					tool.Output = string(p.Content)
				}
				out = append(out, tool)
				if t := c.turns[tool.Turn]; t != nil {
					t.last = o.Timestamp
					t.failed = t.failed || tool.Error
				}
			}
		}
		if result {
			return out
		}
		if o.IsMeta || strings.HasPrefix(string(o.Message.Content), `"<local-command`) {
			return nil
		}
		if o.UUID == "" {
			return nil
		}
		if previous := c.turns[c.current]; previous != nil && !previous.completed && len(c.tools) > 0 {
			previous.last, previous.failed = o.Timestamp, true
			for key, tool := range c.tools {
				tool.End, tool.Error = o.Timestamp, true
				out = append(out, tool)
				delete(c.tools, key)
			}
		}
		out = append(out, c.finishClaude(true)...)
		if t := c.turns[c.current]; t != nil && !t.completed {
			root := c.root(t, t.last, t.failed)
			root.Inferred = true
			out = append(out, root)
		}
		// The next user prompt begins a new main interaction.
		c.turns = map[string]*traceTurn{}
		c.current = o.UUID
		if c.scope != "" {
			c.current = c.scope + "/" + c.current
		}
		t := c.turn(c.current, o.Timestamp)
		if bodies {
			t.input = string(o.Message.Content)
		}
		out = append(out, c.root(t, o.Timestamp, false))
		return out
	}
	if c.current == "" {
		return nil
	}
	t := c.turns[c.current]
	if t == nil {
		return nil
	}
	if o.Type == "system" && o.Subtype == "turn_duration" {
		out = append(out, c.flushClaude()...)
		if len(out) > 0 && bodies {
			t.output = out[0].Output
		}
		t.completed = true
		root := c.root(t, o.Timestamp, t.failed)
		// durationMs excludes pauses/permission waits in some versions; retain
		// the user's recorded start rather than subtracting active duration.
		out = append(out, root)
		return out
	}
	if o.IsApiErrorMessage {
		out = append(out, c.flushClaude()...)
		t.failed, t.last = true, o.Timestamp
		if bodies {
			t.output = string(o.Message.Content)
		}
		out = append(out, c.root(t, o.Timestamp, true))
		return out
	}
	if o.Type != "assistant" || o.Message.ID == "" || o.Message.Model == "<synthetic>" {
		return nil
	}
	if c.claudeMessage != nil && c.claudeMessage.span.ID != traceSpanID(c.agent, c.session, c.current, o.Message.ID) {
		out = append(out, c.flushClaude()...)
	}
	if c.claudeMessage == nil {
		s := c.span(c.current, o.Message.ID, "model "+o.Message.Model, "generation", t.last, o.Timestamp)
		s.Model, s.Provider, s.Inferred = o.Message.Model, "anthropic", true
		if bodies {
			s.Input = t.input
		}
		c.claudeMessage = &claudeTraceMessage{span: s}
	}
	m := c.claudeMessage
	m.span.End = o.Timestamp
	m.span.Tokens = Tokens{o.Message.Usage.Input, o.Message.Usage.Output, o.Message.Usage.CacheRead, o.Message.Usage.CacheWrite}
	m.span.Error = o.IsApiErrorMessage
	m.stop = o.Message.StopReason
	if bodies {
		m.content = append(m.content, blocks...)
	}
	for _, p := range parts {
		if p.Type != "tool_use" || p.ID == "" {
			continue
		}
		tool := c.span(c.current, p.ID, p.Name, "tool", o.Timestamp, o.Timestamp)
		tool.Inferred = true
		if bodies {
			tool.Input = string(p.Input)
		}
		c.tools[p.ID] = tool
	}
	t.last, t.failed = o.Timestamp, t.failed || m.span.Error
	// Keep end_turn blocks pending too: thinking and text can each repeat
	// the stop reason and usage for the same message. The next boundary or
	// Poll's unchanged-file fallback exports the combined response once.
	return out
}
