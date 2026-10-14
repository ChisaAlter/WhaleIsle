package gateway

import (
	"encoding/json"
	"strings"
	"testing"
)

// PAMI on Discord: Anthropic bills a 1-hour cache write at 2× input and a
// 5-minute one at 1.25×, and its usage says which were which
// (cache_creation's ephemeral_5m/1h_input_tokens). Both the API's usage and
// the Claude subscription's carry the split, which goes back out to an
// Anthropic client as it came; a usage without it reads as before.
func TestAnthropicCacheWriteSplit(t *testing.T) {
	var a aUsage
	if err := json.Unmarshal([]byte(`{"input_tokens":10,"output_tokens":5,"cache_read_input_tokens":100,"cache_creation_input_tokens":3000,
		"cache_creation":{"ephemeral_5m_input_tokens":1000,"ephemeral_1h_input_tokens":2000}}`), &a); err != nil {
		t.Fatal(err)
	}
	u := a.usage()
	if u.CacheWrite != 3000 || u.CacheWrite1h != 2000 {
		t.Fatalf("usage = %+v, want 3000 written, 2000 of them for an hour", u)
	}
	b, _ := json.Marshal(u.anthropic())
	if !strings.Contains(string(b), `"ephemeral_5m_input_tokens":1000`) || !strings.Contains(string(b), `"ephemeral_1h_input_tokens":2000`) {
		t.Errorf("back out as %s, want the split", b)
	}

	var old aUsage
	if err := json.Unmarshal([]byte(`{"input_tokens":10,"output_tokens":5,"cache_creation_input_tokens":300}`), &old); err != nil {
		t.Fatal(err)
	}
	if u := old.usage(); u.CacheWrite != 300 || u.CacheWrite1h != 0 {
		t.Errorf("no split = %+v", u)
	}
	if b, _ := json.Marshal(old.usage().anthropic()); strings.Contains(string(b), "cache_creation\"") {
		t.Errorf("no split back out as %s, want no cache_creation", b)
	}

	var c cliUsage
	if err := json.Unmarshal([]byte(`{"input_tokens":1,"output_tokens":2,"cache_creation_input_tokens":0,
		"cache_creation":{"ephemeral_5m_input_tokens":0,"ephemeral_1h_input_tokens":4000}}`), &c); err != nil {
		t.Fatal(err)
	}
	if u := c.gateway(); u.CacheWrite != 4000 || u.CacheWrite1h != 4000 {
		t.Errorf("subscription usage = %+v, want 4000 written for an hour", u)
	}
	// a stream's usage counted again keeps the split
	if s := (Usage{CacheWrite: 10, CacheWrite1h: 4}).plus(Usage{CacheWrite: 5, CacheWrite1h: 5}, false); s.CacheWrite1h != 9 {
		t.Errorf("plus = %+v", s)
	}
}
