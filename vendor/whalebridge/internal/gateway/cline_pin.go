package gateway

import (
	"bytes"
	"encoding/json"

	"github.com/tidwall/gjson"
	"github.com/yetone/magpie/internal/provider"
)

// clinePin is body with its DeepSeek model pinned to DeepSeek's own API
// on the Cline API, when the provider asks it (provider.PinUpstream):
// providerOptions.gateway.only, which Cline's AI gateway reads to serve
// the model from that host alone, as ClinePass + ProviderPin set it
// (linux.do/t/topic/2918145). A body naming providerOptions itself is
// left as the client sent it. The field goes at the end, so the prefix a
// cache keys on doesn't change.
func clinePin(p provider.Provider, to provider.Protocol, body []byte) []byte {
	if to != provider.Chat {
		return body
	}
	up := p.ClinePin(gjson.GetBytes(body, "model").String())
	if up == "" || gjson.GetBytes(body, "providerOptions").Exists() {
		return body
	}
	end := bytes.LastIndexByte(body, '}')
	if end < 0 {
		return body
	}
	opts, _ := json.Marshal(map[string]any{"gateway": map[string]any{"only": []string{up}}})
	out := make([]byte, 0, len(body)+len(opts)+24)
	out = append(out, body[:end]...)
	if len(bytes.TrimSpace(body[bytes.IndexByte(body, '{')+1:end])) > 0 {
		out = append(out, ',')
	}
	out = append(out, `"providerOptions":`...)
	out = append(out, opts...)
	return append(out, body[end:]...)
}
