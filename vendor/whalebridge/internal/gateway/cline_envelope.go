package gateway

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/tidwall/gjson"
	"github.com/yetone/magpie/internal/provider"
)

// clineUnwrapped is a Cline reply with the {success, data} envelope its API
// puts a whole (non-streamed) answer in taken off: {"success":true,"data":
// {chat.completion}} goes on as the completion, which every client of the
// Chat API reads at the top (6094S on Discord: Alma's tool-model calls
// failed with "Invalid JSON response"), and the translators read it so too.
// {"success":false,"error":…} goes on as an error, {"error":{"message":…}},
// with a 502 when it came with a 2xx. A stream, a compressed reply and any
// other body pass as they came; a provider other than Cline is never asked.
func clineUnwrapped(p provider.Provider, res *http.Response) *http.Response {
	if res == nil || !p.IsCline() || res.Header.Get("Content-Encoding") != "" {
		return res
	}
	ct := res.Header.Get("Content-Type")
	if !strings.Contains(ct, "json") || strings.Contains(ct, "event-stream") {
		return res
	}
	b, err := io.ReadAll(io.LimitReader(res.Body, 64<<20))
	res.Body.Close()
	set := func(nb []byte) *http.Response {
		res.Body = io.NopCloser(bytes.NewReader(nb))
		res.ContentLength = int64(len(nb))
		res.Header.Set("Content-Length", strconv.Itoa(len(nb)))
		return res
	}
	if err != nil {
		return set(b)
	}
	ok := gjson.GetBytes(b, "success")
	if ok.Type != gjson.True && ok.Type != gjson.False {
		return set(b)
	}
	if ok.Type == gjson.True {
		if d := gjson.GetBytes(b, "data"); d.IsObject() {
			return set([]byte(d.Raw))
		}
		return set(b)
	}
	msg := "Cline request failed"
	if e := gjson.GetBytes(b, "error"); e.Type == gjson.String && e.Str != "" {
		msg = e.Str
	} else if m := e.Get("message"); m.Type == gjson.String && m.Str != "" {
		msg = m.Str
	} else if m := gjson.GetBytes(b, "message"); m.Type == gjson.String && m.Str != "" {
		msg = m.Str
	}
	nb, _ := json.Marshal(map[string]any{"error": map[string]any{"message": msg}})
	if res.StatusCode < 400 {
		res.StatusCode, res.Status = http.StatusBadGateway, "502 Bad Gateway"
	}
	return set(nb)
}
