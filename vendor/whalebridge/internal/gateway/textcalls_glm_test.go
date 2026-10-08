package gateway

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/yetone/magpie/internal/provider"
)

// glmExec is GLM's own call of Codex's exec, as GLM-5.3-Flash through vLLM
// wrote it into its text (#906, nullburn).
const glmExec = "<tool_call>exec\n<arg_key>input</arg_key>\n<arg_value>const r = await tools.shell({cmd: \"ls\"});\nconsole.log(r);</arg_value>\n</tool_call>"

const glmExecInput = "const r = await tools.shell({cmd: \"ls\"});\nconsole.log(r);"

// responsesItems sends body to the gateway's Responses endpoint, upstream
// answering up, and gives back the output items the client read.
func responsesItems(t *testing.T, body string, up ...string) (items []map[string]any, raw string) {
	t.Helper()
	fresh(t)
	a := &scripted{replies: []reply{{200, "text/event-stream", sse(append(up, `data: [DONE]`)...)}}}
	scriptedOn(t, "a", provider.Chat, a)
	rec := httptest.NewRecorder()
	New().upstreamHandler().ServeHTTP(rec, httptest.NewRequest("POST", "/v1/responses", strings.NewReader(body)))
	if rec.Code != 200 {
		t.Fatalf("%d %s", rec.Code, rec.Body.String())
	}
	raw = rec.Body.String()
	if strings.Contains(body, `"stream":true`) {
		for _, line := range strings.Split(raw, "\n") {
			data, ok := strings.CutPrefix(line, "data: ")
			if !ok {
				continue
			}
			var ev struct {
				Type string         `json:"type"`
				Item map[string]any `json:"item"`
			}
			if json.Unmarshal([]byte(data), &ev) == nil && ev.Type == "response.output_item.done" {
				items = append(items, ev.Item)
			}
		}
		return items, raw
	}
	var r struct {
		Output []map[string]any `json:"output"`
	}
	if err := json.Unmarshal([]byte(raw), &r); err != nil {
		t.Fatalf("unreadable reply: %v\n%s", err, raw)
	}
	return r.Output, raw
}

// Codex's exec is a custom tool: GLM's call of it, its tags split across
// chunks, reaches Codex as the custom_tool_call it is, with the code as
// its input, after the text before it — streamed and whole.
func TestGLMTextCallCustomTool(t *testing.T) {
	text := "Let me look.\n\n" + glmExec
	for _, stream := range []string{"true", "false"} {
		items, raw := responsesItems(t, `{"model":"a/m","stream":`+stream+`,"input":"list the files",`+
			`"tools":[{"type":"custom","name":"exec","description":"Run JavaScript.","format":{"type":"grammar","syntax":"lark","definition":"start: /[\\s\\S]+/"}}]}`,
			chunkOf(text[:20]), chunkOf(text[20:31]), chunkOf(text[31:52]), chunkOf(text[52:]), stopChunk)
		var call map[string]any
		var said string
		for _, it := range items {
			switch it["type"] {
			case "custom_tool_call":
				call = it
			case "message":
				b, _ := json.Marshal(it["content"])
				said += string(b)
			}
		}
		if call == nil || call["name"] != "exec" || call["input"] != glmExecInput {
			t.Fatalf("stream=%s call %v\n%s", stream, call, raw)
		}
		if !strings.Contains(said, "Let me look.") || strings.Contains(raw, "arg_key") || strings.Contains(raw, "tool_call>") {
			t.Fatalf("stream=%s text %s\n%s", stream, said, raw)
		}
	}
}

// A function tool's arguments: a value that is JSON is kept as JSON, any
// other is the string it says; two calls in a row are both made.
func TestGLMTextCallFunctionTool(t *testing.T) {
	items, raw := responsesItems(t, `{"model":"a/m","stream":true,"input":"go",`+
		`"tools":[{"type":"function","name":"shell","parameters":{"type":"object"}},{"type":"function","name":"read","parameters":{"type":"object"}}]}`,
		chunkOf("<tool_call>shell<arg_key>command</arg_key><arg_value>[\"ls\",\"-la\"]</arg_value><arg_key>timeout_ms</arg_key><arg_value>"),
		chunkOf("5000</arg_value><arg_key>workdir</arg_key><arg_value>/tmp/x</arg_value></tool_call>\n<tool_call>read\n<arg_key>path</arg_key>\n<arg_value>a.md</arg_value>\n</tool_call>"),
		stopChunk)
	var calls []map[string]any
	for _, it := range items {
		if it["type"] == "function_call" {
			calls = append(calls, it)
		}
	}
	if len(calls) != 2 || calls[0]["name"] != "shell" || calls[1]["name"] != "read" || strings.Contains(raw, "arg_value") {
		t.Fatalf("calls %v\n%s", calls, raw)
	}
	var shell map[string]any
	if err := json.Unmarshal([]byte(calls[0]["arguments"].(string)), &shell); err != nil {
		t.Fatalf("arguments %v: %v", calls[0]["arguments"], err)
	}
	cmd, _ := shell["command"].([]any)
	if len(cmd) != 2 || cmd[0] != "ls" || shell["timeout_ms"] != float64(5000) || shell["workdir"] != "/tmp/x" {
		t.Fatalf("shell %v", shell)
	}
	if calls[1]["arguments"] != `{"path":"a.md"}` {
		t.Fatalf("read %v", calls[1]["arguments"])
	}
}

// Chat's relay and Anthropic's translation read GLM's call as well.
func TestGLMTextCallChatAndMessages(t *testing.T) {
	text, calls, finish, raw := relayedChat(t, `{"model":"a/m","stream":true,"messages":[{"role":"user","content":"hi"}],`+textCallTools+`}`,
		chunkOf("Looking.<tool_call>bash<arg_key>com"), chunkOf("mand</arg_key><arg_value>ls -la</arg_value></tool_"), chunkOf("call>"), stopChunk)
	if text != "Looking." || calls["bash"] != `{"command":"ls -la"}` || finish != "tool_calls" || strings.Contains(raw, "arg_key") {
		t.Fatalf("chat: text %q calls %v finish %q\n%s", text, calls, finish, raw)
	}
	fresh(t)
	up := sse(chunkOf("<tool_call>bash\n<arg_key>command</arg_key>\n<arg_value>ls</arg_value>\n</tool_call>"), stopChunk, `data: [DONE]`)
	a := &scripted{replies: []reply{{200, "text/event-stream", up}}}
	scriptedOn(t, "a", provider.Chat, a)
	for _, stream := range []string{"true", "false"} {
		a.replies = []reply{{200, "text/event-stream", up}}
		rec := httptest.NewRecorder()
		New().upstreamHandler().ServeHTTP(rec, httptest.NewRequest("POST", "/v1/messages", strings.NewReader(
			`{"model":"a/m","max_tokens":100,"stream":`+stream+`,"messages":[{"role":"user","content":"hi"}],"tools":[{"name":"bash","input_schema":{"type":"object"}}]}`)))
		body := rec.Body.String()
		if rec.Code != 200 || strings.Contains(body, "arg_key") || !strings.Contains(body, `"tool_use"`) || !strings.Contains(body, `"stop_reason":"tool_use"`) {
			t.Fatalf("messages stream=%s %d %s", stream, rec.Code, body)
		}
	}
}

// A GLM block naming a tool the request didn't offer stays the text it was.
func TestGLMTextCallUnofferedLeftAsText(t *testing.T) {
	block := "<tool_call>rm_rf<arg_key>path</arg_key><arg_value>/</arg_value></tool_call>"
	text, calls, finish, _ := relayedChat(t, `{"model":"a/m","stream":true,"messages":[{"role":"user","content":"hi"}],`+textCallTools+`}`,
		chunkOf("Like this: "+block), stopChunk)
	if text != "Like this: "+block || len(calls) != 0 || finish != "stop" {
		t.Fatalf("text %q calls %v finish %q", text, calls, finish)
	}
	items, raw := responsesItems(t, `{"model":"a/m","stream":true,"input":"go","tools":[{"type":"custom","name":"exec"}]}`,
		chunkOf(block), stopChunk)
	for _, it := range items {
		if it["type"] != "message" {
			t.Fatalf("item %v\n%s", it, raw)
		}
	}
	if !strings.Contains(raw, "rm_rf") {
		t.Fatalf("text lost: %s", raw)
	}
}

// A plugin's model writing GLM's call is read the same: Codex gets its
// custom tool call.
func TestPluginGLMTextCall(t *testing.T) {
	pid := besideFake(t, "glm-local", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		for _, part := range []string{glmExec[:15], glmExec[15:]} {
			b, _ := json.Marshal(map[string]any{"id": "c1", "object": "chat.completion.chunk", "choices": []any{map[string]any{"index": 0, "delta": map[string]any{"content": part}, "finish_reason": nil}}})
			io.WriteString(w, "data: "+string(b)+"\n\n")
		}
		io.WriteString(w, `data: {"id":"c1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}`+"\n\ndata: [DONE]\n\n")
	}))
	req := httptest.NewRequest("POST", "/v1/responses", strings.NewReader(`{"model":"`+pid+`/fake-1","stream":true,"input":"go","tools":[{"type":"custom","name":"exec"}]}`))
	req.Header.Set("Authorization", "Bearer magpie")
	rec := httptest.NewRecorder()
	New().upstreamHandler().ServeHTTP(rec, req)
	body := rec.Body.String()
	if rec.Code != 200 || strings.Contains(body, "arg_key") || !strings.Contains(body, `"custom_tool_call"`) {
		t.Fatalf("%d %s", rec.Code, body)
	}
	in, _ := json.Marshal(glmExecInput)
	if !strings.Contains(body, `"input":`+string(in)) {
		t.Fatalf("input: %s", body)
	}
}
