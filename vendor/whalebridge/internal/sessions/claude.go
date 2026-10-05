package sessions

import (
	"bytes"
	"encoding/json"
	"regexp"
	"strings"
	"time"

	"github.com/tidwall/gjson"
)

// Claude Code writes one line per event: the prompts as "user" lines, each
// block of a reply as an "assistant" line carrying the whole message's
// usage (so a message's later blocks repeat it), and titles of its own.

type ccLine struct {
	Type        string `json:"type"`
	IsMeta      bool   `json:"isMeta"`
	IsSidechain bool   `json:"isSidechain"`
	Cwd         string `json:"cwd"`
	SessionID   string `json:"sessionId"`
	RequestID   ccStr  `json:"requestId"`
	AITitle     string `json:"aiTitle"`
	Summary     string `json:"summary"`
	Message     struct {
		ID      string          `json:"id"`
		Model   string          `json:"model"`
		Content json.RawMessage `json:"content"`
		Usage   *struct {
			Input      int `json:"input_tokens"`
			Output     int `json:"output_tokens"`
			CacheRead  int `json:"cache_read_input_tokens"`
			CacheWrite int `json:"cache_creation_input_tokens"`
		} `json:"usage"`
	} `json:"message"`
}

var (
	ccAssistant = []byte(`"type":"assistant"`)
	ccUser      = []byte(`"type":"user"`)
	ccTitle     = []byte(`"type":"ai-title"`)
	ccSummary   = []byte(`"type":"summary"`)
	ccCwd       = []byte(`"cwd":"`)
)

var (
	ccMessage = []byte(`"message":{`)
	ccAttach  = []byte(`"attachment":{`)
	ccRole    = []byte(`"role":"`)
	ccModel   = []byte(`"model":"`)
	ccID      = []byte(`"id":"`)
	ccUsage   = []byte(`"usage":{`)
	ccSession = []byte(`"sessionId":"`)
	ccTop     = []byte(`{"type":"`)
)

// claudeLine reads a line, telling from its first bytes what it is: most of
// a long session is tool results and attachments, read for their time
// alone, and a reply's usage is decoded without its content.
func claudeLine(s *state, b []byte, main bool) {
	h := b[:min(len(b), 1024)]
	if bytes.HasPrefix(h, ccTop) {
		// a line of Claude Code's own: a title, a summary, a mode…
		switch typeAfter(h, ccTop) {
		case "user", "assistant":
			// a message laid out type first
		case "ai-title", "summary":
			claudeFull(s, b, main)
			return
		default:
			s.saw(tsAt(b, true), main)
			return
		}
	}
	m, a := bytes.Index(h, ccMessage), bytes.Index(h, ccAttach)
	if a >= 0 && (m < 0 || a < m) {
		s.saw(tsAt(b, true), main)
		ccWhere(s, b)
		return
	}
	if m < 0 {
		claudeFull(s, b, main)
		return
	}
	// Claude Code's own order: a reply opens with its model and id, a
	// prompt with its role; a message written another way is read whole
	msg := h[m+len(ccMessage):]
	switch {
	case bytes.HasPrefix(msg, ccModel) && typeAfter(msg, ccRole) == "assistant":
		at := tsAt(b, true)
		s.saw(at, main)
		ccWhere(s, b)
		ccReply(s, at, msg, b, main)
	case bytes.HasPrefix(msg, ccRole) && typeAfter(msg, ccRole) == "user":
		if main && !ccToolResult(msg) {
			// a prompt, or something Claude Code put in: read whole
			claudeFull(s, b, main)
			return
		}
		s.saw(tsAt(b, true), main)
		ccWhere(s, b)
	default:
		claudeFull(s, b, main)
	}
}

// ccWhere takes the session's folder and id from the end of a line, while
// they are not known.
func ccWhere(s *state, b []byte) {
	if s.Cwd == "" {
		s.Cwd = strAt(b, ccCwd)
	}
	if s.ID == "" {
		s.ID = strAt(b, ccSession)
	}
}

// strAt is the string after the last key in b.
func strAt(b, key []byte) string {
	i := bytes.LastIndex(b, key)
	if i < 0 {
		return ""
	}
	rest := b[i+len(key)-1:]
	for j := 1; j < len(rest); j++ {
		switch rest[j] {
		case '\\':
			j++
		case '"':
			var v string
			if json.Unmarshal(rest[:j+1], &v) != nil {
				return ""
			}
			return v
		}
	}
	return ""
}

var (
	ccContent = []byte(`"content":`)
	ccResult1 = []byte(`[{"tool_use_id"`)
	ccResult2 = []byte(`[{"type":"tool_result"`)
	ccToolUse = []byte(`{"type":"tool_use"`)
)

// ccToolResult tells a user message that is a tool's result from its head.
func ccToolResult(msg []byte) bool {
	i := bytes.Index(msg, ccContent)
	if i < 0 {
		return false
	}
	c := msg[i+len(ccContent):]
	return bytes.HasPrefix(c, ccResult1) || bytes.HasPrefix(c, ccResult2)
}

// ccTools finds Claude Code's tool blocks (type first) and decodes their
// identity without retaining their arguments. Advancing over the whole block
// also prevents a nested tool-shaped object in its input from being counted.
func ccTools(s *state, m *claudeContribution, at time.Time, b []byte) {
	for rest := b; ; {
		i := bytes.Index(rest, ccToolUse)
		if i < 0 {
			return
		}
		var tool struct {
			ID, Name string
			Input    struct{ Skill any }
		}
		dec := json.NewDecoder(bytes.NewReader(rest[i:]))
		if dec.Decode(&tool) != nil {
			return
		}
		rest = rest[i+int(dec.InputOffset()):]
		skill, _ := tool.Input.Skill.(string)
		if tool.Name != "Skill" {
			skill = ""
		}
		ccTool(s, m, at, tool.ID, tool.Name, skill)
	}
}

// ccReply counts a reply's usage: its model and id lead the message, its
// usage follows the content.
func ccReply(s *state, at time.Time, msg, b []byte, main bool) {
	model, id := typeAfter(msg, ccModel), typeAfter(msg, ccID)
	// Decode just the outer identity: a tool's input may itself contain a
	// requestId, which must never become the identity of this response.
	identity := gjson.GetBytes(b, "requestId")
	request := ""
	if identity.Type == gjson.String {
		request = identity.String()
	}
	m := ccUsageState(&s.Claude).message(id, request)
	defer s.Claude.finish(m)

	i := bytes.LastIndex(b, ccUsage)
	if i < 0 {
		i = len(b)
	}
	ccTools(s, m, at, b[:i])
	if i == len(b) || model == "<synthetic>" {
		return
	}
	var u struct {
		Input      int `json:"input_tokens"`
		Output     int `json:"output_tokens"`
		CacheRead  int `json:"cache_read_input_tokens"`
		CacheWrite int `json:"cache_creation_input_tokens"`
	}
	if json.NewDecoder(bytes.NewReader(b[i+len(ccUsage)-1:])).Decode(&u) != nil {
		return
	}
	ccCount(s, m, at, model, Tokens{Input: u.Input, Output: u.Output, CacheRead: u.CacheRead, CacheWrite: u.CacheWrite}, main)
}

// claudeFull reads a line whole.
func claudeFull(s *state, b []byte, main bool) {
	at := tsAt(b, true)
	s.saw(at, main)
	want := bytes.Contains(b, ccAssistant) ||
		main && bytes.Contains(b, ccUser) ||
		main && (bytes.Contains(b, ccTitle) || bytes.Contains(b, ccSummary)) ||
		s.Cwd == "" && bytes.Contains(b, ccCwd)
	if !want {
		return
	}
	var l ccLine
	if json.Unmarshal(b, &l) != nil {
		return
	}
	if s.Cwd == "" && l.Cwd != "" {
		s.Cwd = l.Cwd
	}
	if s.ID == "" && l.SessionID != "" {
		s.ID = l.SessionID
	}
	switch l.Type {
	case "ai-title":
		if l.AITitle != "" {
			s.Named = title(l.AITitle)
		}
	case "summary":
		if l.Summary != "" && s.Named == "" {
			s.Named = title(l.Summary)
		}
	case "user":
		if main && !l.IsMeta && !l.IsSidechain {
			p := ccPrompt(l.Message.Content)
			if p != "" {
				s.day(dateOf(at)).Prompts++
			}
			if s.Title == "" {
				s.Title = p
				if s.Title == "" && s.First == "" {
					s.First = untagged(ccText(l.Message.Content))
				}
			}
		}
	case "assistant":
		m := ccUsageState(&s.Claude).message(l.Message.ID, string(l.RequestID))
		defer s.Claude.finish(m)
		var blocks []struct {
			Type, ID, Name string
			Input          struct{ Skill any }
		}
		if json.Unmarshal(l.Message.Content, &blocks) == nil {
			for _, c := range blocks {
				if c.Type == "tool_use" {
					skill, _ := c.Input.Skill.(string)
					if c.Name != "Skill" {
						skill = ""
					}
					ccTool(s, m, at, c.ID, c.Name, skill)
				}
			}
		}
		u := l.Message.Usage
		if u == nil || l.Message.Model == "<synthetic>" {
			return
		}
		ccCount(s, m, at, l.Message.Model, Tokens{Input: u.Input, Output: u.Output, CacheRead: u.CacheRead, CacheWrite: u.CacheWrite}, main)
	}
}

// ccText is the text of a user message, "" for a tool's result.
func ccText(content json.RawMessage) string {
	var text string
	if json.Unmarshal(content, &text) != nil {
		var blocks []struct{ Type, Text string }
		if json.Unmarshal(content, &blocks) != nil {
			return ""
		}
		var parts []string
		for _, b := range blocks {
			if b.Type == "tool_result" {
				return ""
			}
			if b.Type == "text" && b.Text != "" {
				parts = append(parts, b.Text)
			}
		}
		text = strings.Join(parts, " ")
	}
	return strings.TrimSpace(text)
}

var (
	ccCommand = regexp.MustCompile(`<command-name>\s*([^<]*?)\s*</command-name>`)
	ccArgs    = regexp.MustCompile(`<command-args>\s*([^<]*?)\s*</command-args>`)
)

// ccPrompt is the words of a prompt someone typed, or "" for what Claude
// Code put in the conversation itself (tool results, command output).
func ccPrompt(content json.RawMessage) string {
	text := ccText(content)
	if m := ccCommand.FindStringSubmatch(text); m != nil {
		// a slash command: its name and what was typed after it
		cmd := m[1]
		if a := ccArgs.FindStringSubmatch(text); a != nil && a[1] != "" {
			cmd += " " + a[1]
		}
		return title(cmd)
	}
	if text == "" || strings.HasPrefix(text, "<") || strings.HasPrefix(text, "[Request interrupted") || strings.HasPrefix(text, "Caveat:") {
		return ""
	}
	return title(text)
}
