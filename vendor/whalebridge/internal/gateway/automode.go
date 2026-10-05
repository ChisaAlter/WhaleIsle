package gateway

import (
	"bytes"
	"strings"

	"github.com/tidwall/gjson"

	"github.com/yetone/magpie/internal/provider"
)

// Claude Code's auto mode checks each action with a classifier (#250).
// Behind a gateway, its first requests ask the API to do it: the
// dangerous-tool-use beta and a `safeguards` field, answered by
// `safeguard_results` in the reply. Anthropic's own API (and a relay in front
// of it) gets them through passthrough as they were sent and hands the
// reply back as it came. Any other model neither sees them nor answers
// them, and Claude Code, finding no result in a whole reply, classifies
// locally for the rest of the session. magpie says nothing on the API's
// behalf.
//
// Locally, the classifier is a request of its own on the session's model:
// the transcript in <transcript> blocks, a system prompt asking for
// <block>yes</block> or <block>no</block>, thinking turned off, and for its
// first stage 64 tokens to answer in (stopping at </block>). A model that
// reasons whatever it is told spends those 64 tokens reasoning and answers
// nothing, which Claude Code reads as no verdict and blocks the action.

// classifierRoom is what a model that reasons is given on top of the
// classifier's own budget, as Claude Code gives a Claude model that can't
// turn its thinking off.
const classifierRoom = 2048

// autoModeClassifier reports whether req is Claude Code's auto mode
// classifier asking about an action.
func autoModeClassifier(req *Request) bool {
	if len(req.Tools) > 0 || !strings.Contains(req.System, "<block>") && !strings.Contains(req.System, "<severity>") {
		return false
	}
	for _, m := range req.Messages {
		if m.Role != "user" {
			continue
		}
		for _, p := range m.Parts {
			if p.Kind == Text && strings.HasPrefix(strings.TrimSpace(p.Text), "<transcript>") {
				return true
			}
		}
	}
	return false
}

// hasReply reports whether msgs hold a reply: without one, a request is
// a one-off ask however many user messages it comes in.
func hasReply(msgs []Message) bool {
	for _, m := range msgs {
		if m.Role == "assistant" {
			return true
		}
	}
	return false
}

// fitAutoModeClassifier asks a model that isn't Claude, for Claude Code's
// auto mode classifier, to reason least — none when it can go without, its
// lowest level otherwise, left to the vendor when its levels aren't known —
// with room for that reasoning and the verdict.
func fitAutoModeClassifier(p provider.Provider, model string, req *Request) {
	if anthropicModel.MatchString(model) || !autoModeClassifier(req) {
		return
	}
	if req.MaxTokens > 0 && req.MaxTokens < classifierRoom {
		req.MaxTokens += classifierRoom
	}
	if req.Effort == "" {
		if levels := p.Efforts(model); len(levels) > 0 {
			req.Effort = fitEffort("none", levels)
		}
	}
}

// autoModeClassifierBody is fitAutoModeClassifier for a request relayed to
// an Anthropic endpoint as it was sent: a model that isn't Claude gets the
// room to reason in. The rest of the body is left alone.
func autoModeClassifierBody(model string, body []byte) []byte {
	if anthropicModel.MatchString(model) || !bytes.Contains(body, []byte("<transcript>")) || !bytes.Contains(body, []byte("<block>")) && !bytes.Contains(body, []byte("<severity>")) {
		return body
	}
	req, err := parseAnthropic(body)
	if err != nil || !autoModeClassifier(req) {
		return body
	}
	asked := gjson.GetBytes(body, "max_tokens").Int()
	if asked <= 0 || asked >= classifierRoom {
		return body
	}
	return withFields(body, map[string]any{"max_tokens": asked + classifierRoom})
}
