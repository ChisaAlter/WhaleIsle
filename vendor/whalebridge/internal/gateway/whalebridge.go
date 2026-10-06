package gateway

import (
	"crypto/subtle"
	"encoding/json"
	"net/http"
	"os"
	"strings"
	"sync"
)

var whaleBridgeRequests struct {
	sync.Mutex
	active   int
	draining bool
}

// Freeze admission atomically before a stop/update. An existing stream keeps
// its own request, including tool calls; maintenance never cuts it off.
func (s *Server) WhaleBridgeMaintenance(on bool) (int, bool) {
	whaleBridgeRequests.Lock()
	defer whaleBridgeRequests.Unlock()
	active := whaleBridgeRequests.active + s.subscription.parked()
	if on && active > 0 {
		return active, false
	}
	whaleBridgeRequests.draining = on
	return active, true
}

func (s *Server) Handler() http.Handler {
	next := s.upstreamHandler()
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "GET" && r.URL.Path == "/whalebridge/identity" {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]any{"pid": os.Getpid(), "version": Version})
			return
		}
		// Claude's stdio helper authenticates with the run's private token.
		// This internal callback is never available to a remote or browser caller.
		if r.Method == http.MethodPost && strings.HasPrefix(r.URL.Path, "/_magpie/claude-mcp/") {
			if !local(r) || !loopbackHost(r.Host) || r.Header.Get("Origin") != "" {
				http.Error(w, "invalid Claude helper callback", http.StatusForbidden)
				return
			}
			next.ServeHTTP(w, r)
			return
		}
		// DSH uses these two APIs. Other Magpie client, MCP, image and
		// administrative endpoints are not exposed by this component.
		if !(r.Method == "POST" && r.URL.Path == "/v1/chat/completions") && !(r.Method == "GET" && r.URL.Path == "/v1/models") {
			http.NotFound(w, r)
			return
		}
		if subtle.ConstantTimeCompare([]byte(r.Header.Get("Authorization")), []byte("Bearer "+os.Getenv("WHALEBRIDGE_GATEWAY_TOKEN"))) != 1 {
			http.Error(w, "invalid WhaleBridge gateway key", http.StatusUnauthorized)
			return
		}
		if r.Method != "POST" {
			next.ServeHTTP(w, r)
			return
		}
		whaleBridgeRequests.Lock()
		if whaleBridgeRequests.draining {
			whaleBridgeRequests.Unlock()
			http.Error(w, "鲸桥正在更新或停止，请稍后再试", http.StatusServiceUnavailable)
			return
		}
		whaleBridgeRequests.active++
		whaleBridgeRequests.Unlock()
		defer func() { whaleBridgeRequests.Lock(); whaleBridgeRequests.active--; whaleBridgeRequests.Unlock() }()
		next.ServeHTTP(w, r)
	})
}
