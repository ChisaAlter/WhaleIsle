package gateway

import (
	"bytes"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"sync/atomic"
)

// A model deep into a long conversation may write its tool calls into its
// text instead of making them (#823, Dazzle-sys: DeepSeek through a group,
// in Pi, ~700k tokens in): Hermes' <tool_call>{"name": …, "arguments": …}
// </tool_call>, or DeepSeek's own <｜DSML｜invoke name="…"> with its
// parameters, often with the other's closing tags strewn after it. The
// agent got it as text, ran nothing and ended the turn; told to go on, the
// model read its own text-written call back and wrote the next one the
// same way, so the session was lost. When the request offered tools, text
// from the first such tag on is held; at the reply's end each block in it
// that names an offered tool and whose arguments can be read becomes a
// real tool call, and the reply ends as one that called tools. Held text
// that isn't all such blocks goes on as the text it was.

// textCallMarks are what a call written into the text opens with.
var textCallMarks = []string{"<tool_call>", "<｜DSML｜", "<|DSML|"}

// writtenCall is one call read out of the text.
type writtenCall struct {
	Name string
	Args json.RawMessage
}

var (
	dsmlTag    = `<\s*/?\s*[|｜][\s|｜]*DSML[\s|｜]*`
	dsmlInvoke = regexp.MustCompile(`<\s*[|｜][\s|｜]*DSML[\s|｜]*invoke\s+name\s*=\s*"([^"]+)"\s*>`)
	dsmlParam  = regexp.MustCompile(`(?s)<\s*[|｜][\s|｜]*DSML[\s|｜]*parameter\s+name\s*=\s*"([^"]+)"((?:\s+\w+\s*=\s*"[^"]*")*)\s*>(.*?)` + dsmlTag + `parameter\s*>`)
	dsmlClose  = regexp.MustCompile(`<\s*/\s*[|｜][\s|｜]*DSML[\s|｜]*invoke\s*>`)
	dsmlString = regexp.MustCompile(`string\s*=\s*"true"`)
	// what is left of the tags once the calls are read out
	textCallJunk = regexp.MustCompile(dsmlTag + `[^<>]*>?|</?tool_calls?>`)
)

// textCallNames are the tools a request offers, by name.
func textCallNames(tools []Tool) map[string]bool {
	if len(tools) == 0 {
		return nil
	}
	m := map[string]bool{}
	for _, t := range tools {
		if t.Name != "" {
			m[t.Name] = true
		}
	}
	return m
}

// chatToolNames are the function tools of a Chat Completions request.
func chatToolNames(body []byte) map[string]bool {
	var q struct {
		Tools []struct {
			Function struct {
				Name string `json:"name"`
			} `json:"function"`
			Name string `json:"name"`
		} `json:"tools"`
	}
	if json.Unmarshal(body, &q) != nil || len(q.Tools) == 0 {
		return nil
	}
	m := map[string]bool{}
	for _, t := range q.Tools {
		if n := t.Function.Name; n != "" {
			m[n] = true
		} else if t.Name != "" {
			m[t.Name] = true
		}
	}
	return m
}

// textCallAt is where in s a call written into the text begins, -1 for
// nowhere; and, when it doesn't, how much of s's end could be one's
// beginning still being written.
func textCallAt(s string) (at, tail int) {
	at = -1
	for _, m := range textCallMarks {
		if i := strings.Index(s, m); i >= 0 && (at < 0 || i < at) {
			at = i
		}
	}
	if at >= 0 {
		return at, 0
	}
	for _, m := range textCallMarks {
		for n := min(len(m)-1, len(s)); n > tail; n-- {
			if strings.HasSuffix(s, m[:n]) {
				tail = n
				break
			}
		}
	}
	return -1, tail
}

// parseTextCalls reads the calls written in s, which begins with one.
// ok is false unless every block in it is a call of one of names whose
// arguments can be read; rest is the text in it that is no call or tag.
func parseTextCalls(s string, names map[string]bool) (calls []writtenCall, rest string, ok bool) {
	var left strings.Builder
	for s != "" {
		h := strings.Index(s, "<tool_call>")
		d := dsmlInvoke.FindStringSubmatchIndex(s)
		switch {
		case h >= 0 && (d == nil || h < d[0]):
			left.WriteString(s[:h])
			if t := strings.TrimLeft(s[h+len("<tool_call>"):], " \t\r\n"); t == "" || strings.HasPrefix(t, "<") {
				// no JSON after it: DeepSeek's own tags, an invoke or the
				// closes of one (#823), or nothing; the opener is dropped
				// and what follows read as it is
				s = t
				continue
			}
			c, n, good := hermesCall(s[h+len("<tool_call>"):], names)
			if !good {
				return nil, "", false
			}
			calls = append(calls, c)
			s = s[h+len("<tool_call>")+n:]
		case d != nil:
			left.WriteString(s[:d[0]])
			c, n, good := dsmlCall(s[d[0]:], s[d[2]:d[3]], d[1]-d[0], names)
			if !good {
				return nil, "", false
			}
			calls = append(calls, c)
			s = s[d[0]+n:]
		default:
			left.WriteString(s)
			s = ""
		}
	}
	rest = strings.TrimSpace(textCallJunk.ReplaceAllString(left.String(), ""))
	rest = strings.TrimSpace(strings.TrimSuffix(rest, cutMark(rest)))
	// tags and nothing else (#823, Dazzle-sys: <tool_call></｜DSML｜parameter>
	// </｜DSML｜invoke></ was all a reply said) are dropped too: shown to the
	// agent and read back, they had the model write its next calls the same
	// way
	return calls, rest, len(calls) > 0 || rest == ""
}

// cutMark is the end of s that is a mark's beginning cut short (</ of
// </tool_call>), "" when there's none; a lone < may be text.
func cutMark(s string) string {
	for _, m := range append([]string{"</tool_call>", "</｜DSML｜", "</|DSML|"}, textCallMarks...) {
		for n := len(m) - 1; n >= 2; n-- {
			if strings.HasSuffix(s, m[:n]) {
				return m[:n]
			}
		}
	}
	return ""
}

// hermesCall reads the JSON object a <tool_call> opens, and says how much
// of s it took.
func hermesCall(s string, names map[string]bool) (writtenCall, int, bool) {
	lead := len(s) - len(strings.TrimLeft(s, " \t\r\n"))
	body := s[lead:]
	if !strings.HasPrefix(body, "{") {
		return writtenCall{}, 0, false
	}
	// a file's content written raw puts real newlines and tabs inside
	// the JSON's strings, which JSON doesn't allow: they are read as the
	// escapes they stand for
	fixed, back := escapeRawControls(body)
	dec := json.NewDecoder(strings.NewReader(fixed))
	dec.UseNumber()
	var v struct {
		Name       string          `json:"name"`
		Arguments  json.RawMessage `json:"arguments"`
		Parameters json.RawMessage `json:"parameters"`
		Input      json.RawMessage `json:"input"`
	}
	if dec.Decode(&v) != nil || !names[v.Name] {
		return writtenCall{}, 0, false
	}
	args := v.Arguments
	if len(args) == 0 {
		args = v.Parameters
	}
	if len(args) == 0 {
		args = v.Input
	}
	args, ok := callArgs(args)
	if !ok {
		return writtenCall{}, 0, false
	}
	n := lead + back(int(dec.InputOffset()))
	if t := strings.TrimLeft(s[n:], " \t\r\n"); strings.HasPrefix(t, "</tool_call>") {
		n = len(s) - len(t) + len("</tool_call>")
	}
	return writtenCall{Name: v.Name, Args: args}, n, true
}

// dsmlCall reads DeepSeek's <｜DSML｜invoke name="…"> and its parameters,
// up to its close, the next invoke or the end of s.
func dsmlCall(s, name string, open int, names map[string]bool) (writtenCall, int, bool) {
	if !names[name] {
		return writtenCall{}, 0, false
	}
	end := len(s)
	if m := dsmlClose.FindStringIndex(s[open:]); m != nil {
		end = open + m[1]
	}
	if m := dsmlInvoke.FindStringIndex(s[open:]); m != nil && open+m[0] < end {
		end = open + m[0]
	}
	args := map[string]any{}
	for _, p := range dsmlParam.FindAllStringSubmatch(s[open:end], -1) {
		val := p[3]
		if dsmlString.MatchString(p[2]) {
			args[p[1]] = val
			continue
		}
		var v any
		if json.Unmarshal([]byte(strings.TrimSpace(val)), &v) == nil {
			args[p[1]] = v
		} else {
			args[p[1]] = val
		}
	}
	b, err := json.Marshal(args)
	if err != nil {
		return writtenCall{}, 0, false
	}
	return writtenCall{Name: name, Args: b}, end, true
}

// callArgs is a call's arguments as a JSON object: one given as a string
// of JSON is read, none is {}.
func callArgs(raw json.RawMessage) (json.RawMessage, bool) {
	raw = bytes.TrimSpace(raw)
	if len(raw) == 0 || string(raw) == "null" {
		return json.RawMessage("{}"), true
	}
	if raw[0] == '"' {
		var s string
		if json.Unmarshal(raw, &s) != nil {
			return nil, false
		}
		fixed, _ := escapeRawControls(strings.TrimSpace(s))
		raw = json.RawMessage(fixed)
	}
	var m map[string]any
	if json.Unmarshal(raw, &m) != nil {
		return nil, false
	}
	b, err := json.Marshal(m)
	return b, err == nil
}

// escapeRawControls escapes the newlines, carriage returns and tabs inside
// the strings of JSON text; back maps an offset in what it gives to one in
// s.
func escapeRawControls(s string) (string, func(int) int) {
	var b strings.Builder
	var grew []int // offsets in the output after which it is one byte longer
	in, esc := false, false
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch {
		case esc:
			esc = false
		case in && c == '\\':
			esc = true
		case c == '"':
			in = !in
		case in && (c == '\n' || c == '\r' || c == '\t'):
			b.WriteString(map[byte]string{'\n': `\n`, '\r': `\r`, '\t': `\t`}[c])
			grew = append(grew, b.Len())
			continue
		}
		b.WriteByte(c)
	}
	return b.String(), func(n int) int {
		for _, g := range grew {
			if g <= n {
				n--
			}
		}
		return n
	}
}

var textCallSeq atomic.Int64

func textCallID() string { return fmt.Sprintf("call_text_%d", textCallSeq.Add(1)) }

// textCallSee holds, in a translated reply, the text from where a call
// written into it begins, and at the reply's end hands see the calls it
// held, or the text when it held no calls.
type textCallSee struct {
	names   map[string]bool
	see     func(Event)
	pending string // the text's end, which may be a mark begun
	held    string
	holding bool
	native  bool // the reply made a call itself: nothing is read out of its text
}

func (t *textCallSee) event(ev Event) {
	switch ev.Kind {
	case KText:
		if t.native {
			break
		}
		s := t.pending + ev.Text
		t.pending = ""
		if t.holding {
			t.held += s
			return
		}
		at, tail := textCallAt(s)
		if at >= 0 {
			t.holding, t.held, s = true, s[at:], s[:at]
		} else {
			t.pending, s = s[len(s)-tail:], s[:len(s)-tail]
		}
		if s != "" {
			t.see(Event{Kind: KText, Text: s})
		}
		return
	case KToolStart:
		t.release()
		t.native = true
	case KStop:
		if t.holding && !t.native {
			if calls, rest, ok := parseTextCalls(t.held, t.names); ok {
				t.holding, t.held = false, ""
				if rest != "" {
					t.see(Event{Kind: KText, Text: rest})
				}
				for _, c := range calls {
					t.see(Event{Kind: KToolStart, ID: textCallID(), Name: c.Name})
					t.see(Event{Kind: KToolArgs, Text: string(c.Args)})
				}
				if len(calls) > 0 {
					ev.Stop = "tool"
				}
			}
		}
		t.release()
	case KError:
		t.release()
	}
	t.see(ev)
}

// release hands on as text what is held.
func (t *textCallSee) release() {
	if s := t.pending + t.held; s != "" {
		t.see(Event{Kind: KText, Text: s})
	}
	t.pending, t.held, t.holding = "", "", false
}

// textCallTidy does the same in a relayed Chat Completions stream.
type textCallTidy struct {
	names   map[string]bool
	buf     []byte
	pending string
	held    string
	holding bool
	native  bool
	last    map[string]any // the last chunk read, for the ones made
}

func (t *textCallTidy) write(b []byte) []byte {
	t.buf = append(t.buf, b...)
	i := bytes.LastIndexByte(t.buf, '\n')
	if i < 0 {
		return nil
	}
	var out []byte
	for _, line := range bytes.SplitAfter(t.buf[:i+1], []byte("\n")) {
		out = append(out, t.line(line)...)
	}
	t.buf = append(t.buf[:0], t.buf[i+1:]...)
	return out
}

func (t *textCallTidy) flush() []byte {
	var out []byte
	if len(t.buf) > 0 {
		out = t.line(t.buf)
		t.buf = nil
	}
	return append(out, t.release()...)
}

// chunk is a Chat chunk like the last one read, with delta and finish.
func (t *textCallTidy) chunk(delta map[string]any, finish any) []byte {
	c := map[string]any{"object": "chat.completion.chunk"}
	for _, k := range []string{"id", "object", "created", "model"} {
		if v, ok := t.last[k]; ok {
			c[k] = v
		}
	}
	c["choices"] = []any{map[string]any{"index": 0, "delta": delta, "finish_reason": finish}}
	b, _ := marshalPlain(c)
	return append(append([]byte("data: "), b...), '\n', '\n')
}

func (t *textCallTidy) release() []byte {
	s := t.pending + t.held
	t.pending, t.held, t.holding = "", "", false
	if s == "" {
		return nil
	}
	return t.chunk(map[string]any{"content": s}, nil)
}

func (t *textCallTidy) line(line []byte) []byte {
	body := bytes.TrimRight(line, "\r\n")
	data, ok := bytes.CutPrefix(body, []byte("data:"))
	if !ok {
		return line
	}
	data = bytes.TrimSpace(data)
	if string(data) == "[DONE]" {
		return append(t.release(), line...)
	}
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.UseNumber()
	var ev map[string]any
	if dec.Decode(&ev) != nil || ev == nil {
		return line
	}
	t.last = ev
	choices, _ := ev["choices"].([]any)
	if len(choices) != 1 {
		return line
	}
	ch, _ := choices[0].(map[string]any)
	delta, _ := ch["delta"].(map[string]any)
	if ch == nil {
		return line
	}
	var pre []byte
	changed := false
	if calls, _ := delta["tool_calls"].([]any); len(calls) > 0 && !t.native {
		pre, t.native = t.release(), true
	}
	if s, isStr := delta["content"].(string); isStr && s != "" && !t.native {
		s = t.pending + s
		t.pending = ""
		if t.holding {
			t.held += s
			s = ""
		} else if at, tail := textCallAt(s); at >= 0 {
			t.holding, t.held, s = true, s[at:], s[:at]
		} else {
			t.pending, s = s[len(s)-tail:], s[:len(s)-tail]
		}
		if s == "" {
			delete(delta, "content")
		} else {
			delta["content"] = s
		}
		changed = true
	}
	if f, _ := ch["finish_reason"].(string); f != "" && (t.holding || t.pending != "") {
		if calls, rest, ok := parseTextCalls(t.held, t.names); t.holding && !t.native && ok {
			t.holding, t.held = false, ""
			if rest != "" {
				pre = append(pre, t.chunk(map[string]any{"content": rest}, nil)...)
			}
			tcs := make([]any, len(calls))
			for i, c := range calls {
				tcs[i] = map[string]any{"index": i, "id": textCallID(), "type": "function",
					"function": map[string]any{"name": c.Name, "arguments": string(c.Args)}}
			}
			pre = append(pre, t.release()...)
			if len(tcs) > 0 {
				pre = append(pre, t.chunk(map[string]any{"tool_calls": tcs}, nil)...)
				ch["finish_reason"] = "tool_calls"
				changed = true
			}
		} else {
			pre = append(pre, t.release()...)
		}
	}
	if !changed {
		return append(pre, line...)
	}
	if len(delta) == 0 && ch["finish_reason"] == nil && ev["usage"] == nil {
		return pre // nothing left to say
	}
	nb, err := marshalPlain(ev)
	if err != nil {
		return append(pre, line...)
	}
	return append(append(append(pre, "data: "...), nb...), line[len(body):]...)
}
