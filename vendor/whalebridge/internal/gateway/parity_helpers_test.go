package gateway

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"slices"
	"sync"
	"testing"
	"time"
)

type slowVendor struct {
	mu      sync.Mutex
	order   []string
	out     int
	most    int
	release map[string]chan struct{}
	quit    chan struct{} // closed when the test ends, so nothing is left waiting
}

func (v *slowVendor) gate(tag string) chan struct{} {
	v.mu.Lock()
	defer v.mu.Unlock()
	if v.release[tag] == nil {
		v.release[tag] = make(chan struct{})
	}
	return v.release[tag]
}

func (v *slowVendor) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	b, _ := io.ReadAll(r.Body)
	var req struct {
		Messages []struct {
			Content string `json:"content"`
		} `json:"messages"`
	}
	json.Unmarshal(b, &req)
	tag := req.Messages[0].Content
	v.mu.Lock()
	v.order = append(v.order, tag)
	v.out++
	v.most = max(v.most, v.out)
	v.mu.Unlock()
	defer func() {
		v.mu.Lock()
		v.out--
		v.mu.Unlock()
	}()
	gate := v.gate(tag)
	w.Header().Set("Content-Type", "text/event-stream")
	chunk := func(s string) {
		fmt.Fprintf(w, "data: {\"id\":\"x\",\"choices\":[{\"index\":0,\"delta\":{\"content\":%q}}]}\n\n", s)
		w.(http.Flusher).Flush()
	}
	chunk("from " + tag)
	select {
	case <-gate:
	case <-v.quit:
		return
	case <-r.Context().Done():
		return
	}
	chunk(" done")
	io.WriteString(w, "data: {\"id\":\"x\",\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n")
}

func (v *slowVendor) seen() []string {
	v.mu.Lock()
	defer v.mu.Unlock()
	return slices.Clone(v.order)
}

// within waits for cond, failing the test after a few seconds.
func within(t *testing.T, what string, cond func() bool) {
	t.Helper()
	for end := time.Now().Add(5 * time.Second); time.Now().Before(end); time.Sleep(5 * time.Millisecond) {
		if cond() {
			return
		}
	}
	t.Fatalf("timed out waiting for %s", what)
}

func fresh(t *testing.T) {
	t.Helper()
	home := t.TempDir()
	for k, v := range map[string]string{"HOME": home, "USERPROFILE": home, "APPDATA": filepath.Join(home, "roaming"), "LOCALAPPDATA": filepath.Join(home, "local"), "XDG_CONFIG_HOME": filepath.Join(home, "config"), "XDG_CACHE_HOME": filepath.Join(home, "cache"), "PATH": home, "LAUNCHER_COMPONENT_ID": "whalebridge", "WHALEBRIDGE_GATEWAY_TOKEN": "test-private-gateway-key"} {
		t.Setenv(k, v)
	}
	for _, k := range []string{"MAGPIE_ADDR", "MAGPIE_KEY", "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY"} {
		t.Setenv(k, "")
	}
	restingUntil.Lock()
	restingUntil.m = map[string]time.Time{}
	restingUntil.note = map[string]Rest{}
	restingUntil.Unlock()
	sticks.Lock()
	sticks.m = map[string]stick{}
	sticks.Unlock()
	keepRoutes = false
	whaleBridgeRequests.Lock()
	whaleBridgeRequests.active = 0
	whaleBridgeRequests.draining = false
	whaleBridgeRequests.Unlock()
}
