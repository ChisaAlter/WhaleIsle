package gateway

import (
	"bytes"
	"encoding/json"
	"strings"
)

// upstreamOf is the provider an aggregator's reply (a JSON body, or one
// event of its stream) says answered behind it, "" when it says none.
// OpenRouter names it in a top-level "provider" — a Chat body and every
// chunk of its stream, an Anthropic Messages body — and in a Messages
// stream's message_start, as message.provider (seen 2026-10-05: DeepInfra,
// StreamLake). Its Responses replies name none.
func upstreamOf(b []byte) string {
	if !bytes.Contains(b, []byte(`"provider"`)) {
		return ""
	}
	var v struct {
		Provider json.RawMessage `json:"provider"`
		Message  struct {
			Provider json.RawMessage `json:"provider"`
		} `json:"message"`
		Response struct {
			Provider json.RawMessage `json:"provider"`
		} `json:"response"`
	}
	if json.Unmarshal(b, &v) != nil {
		return ""
	}
	for _, raw := range []json.RawMessage{v.Provider, v.Message.Provider, v.Response.Provider} {
		var s string // a request's provider options echoed back are an object
		if json.Unmarshal(raw, &s) == nil {
			if s = strings.TrimSpace(s); s != "" && len(s) <= 64 {
				return s
			}
		}
	}
	return ""
}

// upstreamStop is why a reply (a JSON body, or one event of its stream)
// says it ended, in the upstream's own words: an Anthropic stop_reason, a
// Chat finish_reason, a Responses reply's status and the reason it was
// incomplete. Kept with the request, so a reply that ended too soon shows
// what the upstream said of it — a relay's "end_turn" after a few words,
// or nothing at all (蓝猫 on Discord). "" when this one says none.
func upstreamStop(b []byte) string {
	if !bytes.Contains(b, []byte(`stop_reason"`)) && !bytes.Contains(b, []byte(`finish_reason"`)) && !bytes.Contains(b, []byte(`"response.`)) {
		return ""
	}
	var v struct {
		Type       string `json:"type"`
		StopReason string `json:"stop_reason"`
		Delta      struct {
			StopReason string `json:"stop_reason"`
		} `json:"delta"`
		Choices []struct {
			FinishReason string `json:"finish_reason"`
		} `json:"choices"`
		Response struct {
			Status            string `json:"status"`
			IncompleteDetails *struct {
				Reason string `json:"reason"`
			} `json:"incomplete_details"`
		} `json:"response"`
	}
	if json.Unmarshal(b, &v) != nil {
		return ""
	}
	switch {
	case v.Delta.StopReason != "":
		return v.Delta.StopReason
	case v.StopReason != "":
		return v.StopReason
	case strings.HasPrefix(v.Type, "response.") && v.Response.Status != "" && v.Response.Status != "in_progress" && v.Response.Status != "queued":
		if d := v.Response.IncompleteDetails; d != nil && d.Reason != "" {
			return v.Response.Status + ": " + d.Reason
		}
		return v.Response.Status
	}
	for _, c := range v.Choices {
		if c.FinishReason != "" {
			return c.FinishReason
		}
	}
	return ""
}
