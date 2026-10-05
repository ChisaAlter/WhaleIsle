package gateway

import (
	"bytes"
	"encoding/json"
	"regexp"

	"github.com/tidwall/gjson"

	"github.com/yetone/magpie/internal/provider"
)

// Claude Code (2.1.288) asks Anthropic's API for what its newest models
// take and a relay may not know yet (Keenc on Discord: CHCP and a Vertex
// relay answered 400 for each):
//
//   - thinking.display "updates" (and "highlights"), where a relay that
//     checks the field takes only "summarized" and "omitted": "thinking.
//     adaptive.display: Input should be 'summarized', 'omitted'";
//   - the effort of each turn, as output_config on a {role: "system"}
//     message inside messages: "messages.1.output_config: Extra inputs are
//     not permitted".
//
// Claude Code mends either after the 400, once per conversation, sending
// the request again without it; every new conversation asks again, and a
// relay's refusal is an error in magpie's log each time. magpie mends it
// itself instead: the provider that refused is asked again at once without
// it, and is not sent it again while magpie runs. A provider that takes
// them (Anthropic's own API, a relay passing them on) is sent them as the
// agent wrote them.

// The refusals, remembered in unfit under the provider's id as betas are.
const (
	shapeDisplayNew = "shape:thinking.display=new" // a display other than summarized or omitted
	shapeDisplay    = "shape:thinking.display"     // display at all
	shapeTurnEffort = "shape:messages[].output_config"
)

var (
	displayValueRefused = regexp.MustCompile(`thinking\.(?:adaptive|enabled)\.display:? Input should be`)
	displayRefused      = regexp.MustCompile(`thinking\.(?:adaptive|enabled)\.display:? Extra inputs are not permitted`)
	turnEffortRefused   = regexp.MustCompile(`messages\.\d+\.output_config:? Extra inputs are not permitted`)
)

// knownDisplay is a thinking.display every Anthropic endpoint has taken.
func knownDisplay(d string) bool { return d == "summarized" || d == "omitted" }

// refuseShapes notes what of body the provider turned away in errBody, a
// 400's; true when body has something to leave out on the next try.
func (s *Server) refuseShapes(p provider.Provider, errBody, body []byte) bool {
	fresh := false
	mark := func(key string) {
		if s.fits(p.ID, key, provider.Anthropic) {
			s.markUnfit(p.ID, key, provider.Anthropic)
			fresh = true
		}
	}
	if d := gjson.GetBytes(body, "thinking.display"); d.Exists() {
		if displayRefused.Match(errBody) {
			mark(shapeDisplay)
		} else if displayValueRefused.Match(errBody) && !knownDisplay(d.String()) {
			mark(shapeDisplayNew)
		}
	}
	if turnEffortRefused.Match(errBody) && hasTurnEffort(body) {
		mark(shapeTurnEffort)
	}
	return fresh
}

// withoutRefusedShapes is body as the provider takes it, leaving out what
// it has refused before.
func (s *Server) withoutRefusedShapes(p provider.Provider, body []byte) []byte {
	if !bytes.Contains(body, []byte(`"display"`)) && !bytes.Contains(body, []byte(`"output_config"`)) {
		return body
	}
	if d := gjson.GetBytes(body, "thinking.display"); d.Exists() {
		all := !s.fits(p.ID, shapeDisplay, provider.Anthropic)
		if all || !knownDisplay(d.String()) && !s.fits(p.ID, shapeDisplayNew, provider.Anthropic) {
			body = withDisplay(body, all)
		}
	}
	if !s.fits(p.ID, shapeTurnEffort, provider.Anthropic) {
		body = withoutTurnEffort(body)
	}
	return body
}

// withDisplay is body with thinking.display left out, or (not all) only a
// value beyond summarized and omitted: "highlights" as "summarized", the
// thinking still shown; "updates", or any other, left out, as Claude Code
// itself sends it again.
func withDisplay(body []byte, all bool) []byte {
	var v struct {
		Thinking map[string]any `json:"thinking"`
	}
	if json.Unmarshal(body, &v) != nil || v.Thinking == nil {
		return body
	}
	d, _ := v.Thinking["display"].(string)
	switch {
	case all:
		delete(v.Thinking, "display")
	case knownDisplay(d):
		return body
	case d == "highlights":
		v.Thinking["display"] = "summarized"
	default:
		delete(v.Thinking, "display")
	}
	return withFields(body, map[string]any{"thinking": v.Thinking})
}

// hasTurnEffort is a request with an output_config on one of its messages.
func hasTurnEffort(body []byte) bool {
	if !bytes.Contains(body, []byte(`"output_config"`)) {
		return false
	}
	found := false
	gjson.GetBytes(body, "messages").ForEach(func(_, m gjson.Result) bool {
		found = m.Get("output_config").Exists()
		return !found
	})
	return found
}

// withoutTurnEffort is body without the per-turn effort on its messages, as
// Claude Code sends it once refused: a system message that carried nothing
// else goes with it. The request's own output_config, the effort of the
// turn now asked, stays.
func withoutTurnEffort(body []byte) []byte {
	if !hasTurnEffort(body) {
		return body
	}
	var v struct {
		Messages []json.RawMessage `json:"messages"`
	}
	if json.Unmarshal(body, &v) != nil {
		return body
	}
	out := make([]json.RawMessage, 0, len(v.Messages))
	for _, raw := range v.Messages {
		var m map[string]json.RawMessage
		if json.Unmarshal(raw, &m) != nil {
			out = append(out, raw)
			continue
		}
		if _, ok := m["output_config"]; !ok {
			out = append(out, raw)
			continue
		}
		delete(m, "output_config")
		if r := gjson.GetBytes(raw, "role").String(); r == "system" && emptyContent(gjson.GetBytes(raw, "content")) {
			continue
		}
		b, err := marshalPlain(m)
		if err != nil {
			return body
		}
		out = append(out, b)
	}
	return withFields(body, map[string]any{"messages": out})
}

// emptyContent is a message's content with nothing in it: missing, "", or
// [] (or text blocks with no text).
func emptyContent(c gjson.Result) bool {
	switch {
	case !c.Exists() || c.Type == gjson.Null:
		return true
	case c.Type == gjson.String:
		return c.String() == ""
	case c.IsArray():
		empty := true
		c.ForEach(func(_, b gjson.Result) bool {
			empty = b.Get("type").String() == "text" && b.Get("text").String() == ""
			return empty
		})
		return empty
	}
	return false
}
