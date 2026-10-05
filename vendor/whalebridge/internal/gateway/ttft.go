package gateway

// Time to first token (#196): how long a streamed reply took to begin —
// the first of its text, reasoning or a tool call — and to show its first
// text, so how fast a model writes can be told from how long it thought
// or waited. Read off the stream as it goes to the agent, in the agent's
// protocol, whichever the vendor spoke: one place for every way a reply
// comes, translated or not. A reply that isn't streamed isn't timed.

import (
	"bytes"
	"encoding/json"
	"time"
)

// firstMost is the most of a stream read for its first tokens: a reply
// that is all tool calls has no text to wait for.
const firstMost = 8 << 20

// firstToken times a stream's first content and first text from start.
type firstToken struct {
	start time.Time
	first time.Duration // to the first content; 0 until it comes
	text  time.Duration // to the first text
	off   bool          // not a stream, or read as far as it is
	began bool
	read  int
	pend  []byte
}

// see reads what was written of the reply.
func (f *firstToken) see(b []byte) {
	if f.off || len(b) == 0 {
		return
	}
	if !f.began {
		// a JSON reply is no stream
		if t := bytes.TrimLeft(b, " \t\r\n"); len(t) == 0 {
			return
		} else if t[0] == '{' || t[0] == '[' {
			f.off = true
			return
		}
		f.began = true
	}
	if f.read += len(b); f.read > firstMost {
		f.off, f.pend = true, nil
		return
	}
	f.pend = append(f.pend, b...)
	for !f.off {
		end := eventEnd(f.pend)
		if end < 0 {
			break
		}
		content, text := firstKind(f.pend[:end])
		f.pend = f.pend[end:]
		if !content && !text {
			continue
		}
		d := max(time.Since(f.start), time.Millisecond)
		if f.first == 0 {
			f.first = d
		}
		if text {
			f.text = d
			f.off, f.pend = true, nil // all there is to know
		}
	}
	if len(f.pend) == 0 {
		f.pend = nil
	}
}

// ms are the two as milliseconds from start, 0 for none.
func (f *firstToken) ms() (first, text int64) {
	return f.first.Milliseconds(), f.text.Milliseconds()
}

// firstKind says whether a server-sent event of a reply, in any protocol an
// agent speaks, carries content — text, reasoning or a tool call — and
// whether that is text the reader sees.
func firstKind(ev []byte) (content, text bool) {
	var name string
	var data []byte
	for _, ln := range bytes.Split(ev, []byte("\n")) {
		ln = bytes.TrimRight(ln, "\r")
		switch {
		case bytes.HasPrefix(ln, []byte("event:")):
			name = string(bytes.TrimSpace(ln[6:]))
		case bytes.HasPrefix(ln, []byte("data:")):
			data = append(data, bytes.TrimSpace(ln[5:])...)
		}
	}
	// only deltas, a tool call's start and Gemini's parts carry any: the
	// rest go by unread
	if len(data) == 0 || !(bytes.Contains(data, []byte("delta")) || bytes.Contains(data, []byte(`"parts"`)) ||
		bytes.Contains(data, []byte("content_block_start")) || bytes.Contains(data, []byte("output_item.added"))) {
		return false, false
	}
	var v struct {
		Type         string          `json:"type"`
		Delta        json.RawMessage `json:"delta"` // Anthropic's an object, Responses' a string
		ContentBlock *struct {
			Type string `json:"type"`
		} `json:"content_block"`
		Item *struct {
			Type string `json:"type"`
		} `json:"item"`
		Choices []struct {
			Delta struct {
				Content          json.RawMessage `json:"content"`
				Refusal          json.RawMessage `json:"refusal"`
				ReasoningContent json.RawMessage `json:"reasoning_content"`
				Reasoning        json.RawMessage `json:"reasoning"`
				ToolCalls        json.RawMessage `json:"tool_calls"`
				FunctionCall     json.RawMessage `json:"function_call"`
			} `json:"delta"`
		} `json:"choices"`
		Candidates []struct {
			Content struct {
				Parts []struct {
					Text         string          `json:"text"`
					Thought      bool            `json:"thought"`
					FunctionCall json.RawMessage `json:"functionCall"`
				} `json:"parts"`
			} `json:"content"`
		} `json:"candidates"`
	}
	if json.Unmarshal(data, &v) != nil {
		return false, false
	}
	typ := v.Type
	if typ == "" {
		typ = name
	}
	switch typ {
	case "content_block_delta": // Anthropic
		var d struct {
			Type        string `json:"type"`
			Text        string `json:"text"`
			Thinking    string `json:"thinking"`
			PartialJSON string `json:"partial_json"`
		}
		json.Unmarshal(v.Delta, &d)
		switch {
		case d.Text != "":
			return true, true
		case d.Thinking != "", d.PartialJSON != "":
			return true, false
		}
		return false, false
	case "content_block_start":
		if b := v.ContentBlock; b != nil && (b.Type == "tool_use" || b.Type == "server_tool_use") {
			return true, false
		}
		return false, false
	case "response.output_text.delta", "response.refusal.delta": // Responses
		return filled(v.Delta), filled(v.Delta)
	case "response.reasoning_summary_text.delta", "response.reasoning_text.delta",
		"response.function_call_arguments.delta", "response.custom_tool_call_input.delta":
		return filled(v.Delta), false
	case "response.output_item.added":
		if it := v.Item; it != nil && (it.Type == "function_call" || it.Type == "custom_tool_call") {
			return true, false
		}
		return false, false
	}
	for _, c := range v.Choices { // Chat
		d := c.Delta
		if filled(d.Content) || filled(d.Refusal) {
			return true, true
		}
		if filled(d.ReasoningContent) || filled(d.Reasoning) || filled(d.ToolCalls) || filled(d.FunctionCall) {
			content = true
		}
	}
	for _, c := range v.Candidates { // Gemini
		for _, p := range c.Content.Parts {
			switch {
			case p.Text != "" && !p.Thought:
				return true, true
			case p.Text != "", filled(p.FunctionCall):
				content = true
			}
		}
	}
	return content, false
}

// filled is a JSON value with something in it.
func filled(raw json.RawMessage) bool {
	switch string(bytes.TrimSpace(raw)) {
	case "", "null", `""`, "[]", "{}":
		return false
	}
	return true
}
