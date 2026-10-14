package provider

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"regexp"
	"strings"

	"github.com/yetone/magpie/internal/catalog"
)

// OpenCodeVersion is the OpenCode release magpie says it is to OpenCode's
// gateway. Zen's free tier turns away anything older than 1.18.0 (426
// "OpenCode 1.18.0 or newer is required to use the free tier").
const OpenCodeVersion = "1.18.34"

// OpenCodeAnonymousKey is the key OpenCode asks Zen with when no one is
// signed in to it, which Zen's free models answer.
const OpenCodeAnonymousKey = "public"

// OpenCodeClient makes a request to OpenCode's gateway (Zen or Go) carry
// what OpenCode itself sends there (packages/opencode/src/session/llm/
// request.ts, for a provider whose id starts with "opencode"): its
// User-Agent, the session in x-opencode-session, the turn in
// x-opencode-request, and x-opencode-client and x-opencode-project. Zen's
// free models are served to no one else ("OpenCode's free tier can only be
// used from within OpenCode"). session names the conversation; one already
// in OpenCode's form (ses_…) goes as it is, any other becomes one, the same
// for the same conversation, which Zen routes and caches by.
func OpenCodeClient(h http.Header, session string) {
	h.Set("User-Agent", "opencode/"+OpenCodeVersion)
	h.Set("x-opencode-session", openCodeID("ses", session))
	h.Set("x-opencode-request", openCodeID("msg", ""))
	h.Set("x-opencode-client", "cli")
	// OpenCode's project outside a git repository
	h.Set("x-opencode-project", "global")
}

// OpenCodeFree says whether model is one of OpenCode Zen's free ones on p,
// which Zen serves only to what looks like OpenCode: besides the headers
// OpenCodeClient sets, a streamed request offering tools named bash and
// read (lowercase, by name alone; checked against Zen, October 2026). The
// gateway asks them so whoever the client is (gateway/zenfree.go), and the
// Test button's probe so (zenFreeProbe). A free model is one whose id ends
// in -free, or one models.dev's opencode prices at nothing, as big-pickle,
// whose id doesn't say so (361 on Discord: it answered 403 "OpenCode's
// free tier can only be used from within OpenCode"); openCodeFreeIDs are
// such ones known without the catalog.
func (p Provider) OpenCodeFree(model string) bool {
	if !p.IsOpenCode() {
		return false
	}
	if strings.HasSuffix(model, "-free") || openCodeFreeIDs[model] {
		return true
	}
	pr, ok := catalog.PriceOf("opencode", model)
	return ok && pr.Input == 0 && pr.Output == 0
}

// openCodeFreeIDs are Zen's free models whose ids don't end in -free.
var openCodeFreeIDs = map[string]bool{"big-pickle": true, "grok-code": true}

// OpenCodeTools are the tools Zen's free tier wants offered, by name.
var OpenCodeTools = []string{"bash", "read"}

// OpenCodeStub describes a tool offered only for Zen's free tier to see,
// which the client doesn't have.
const OpenCodeStub = "Not available in this session. Never call this tool."

// zenFreeProbe is the Test button's smallest request, body, asked as Zen's
// free tier wants it: streamed, offering bash and read, which say they
// aren't to be called.
func zenFreeProbe(proto Protocol, body string) string {
	var m map[string]any
	if json.Unmarshal([]byte(body), &m) != nil {
		return body
	}
	var tools []any
	for _, n := range OpenCodeTools {
		schema := map[string]any{"type": "object", "properties": map[string]any{}}
		switch proto {
		case Chat:
			tools = append(tools, map[string]any{"type": "function", "function": map[string]any{"name": n, "description": OpenCodeStub, "parameters": schema}})
		case Responses:
			tools = append(tools, map[string]any{"type": "function", "name": n, "description": OpenCodeStub, "parameters": schema})
		default:
			tools = append(tools, map[string]any{"name": n, "description": OpenCodeStub, "input_schema": schema})
		}
	}
	m["stream"], m["tools"] = true, tools
	b, err := json.Marshal(m)
	if err != nil {
		return body
	}
	return string(b)
}

var openCodeIDRe = regexp.MustCompile(`^[a-z]{3}_[0-9a-f]{12}[0-9A-Za-z]{14}$`)

const base62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"

// openCodeID is an id as OpenCode makes them (prefix_, 12 hex digits and 14
// base62 ones): seed's own when it is one with this prefix, else made from
// seed, or at random when there is none.
func openCodeID(prefix, seed string) string {
	if strings.HasPrefix(seed, prefix+"_") && openCodeIDRe.MatchString(seed) {
		return seed
	}
	var b [32]byte
	if seed != "" {
		b = sha256.Sum256([]byte(seed))
	} else if _, err := rand.Read(b[:]); err != nil {
		b = sha256.Sum256([]byte(randomUUID()))
	}
	id := []byte(prefix + "_" + hex.EncodeToString(b[:6]))
	for _, c := range b[6:20] {
		id = append(id, base62[int(c)%len(base62)])
	}
	return string(id)
}
