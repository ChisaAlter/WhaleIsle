package plugin

import (
	"context"
	"net/url"
	"path/filepath"
	"testing"
	"time"
)

// 𝕏 on Discord: the Grok plugin's sign-in said "grok login gave no link
// to open". The plugin runs `grok login`, and the host has magpie's proxy
// only as MAGPIE_*_PROXY, so the CLI went out with none where x.ai is
// reached only through one. A program a plugin starts has it, as the
// built-in's `grok login` had it.
func TestPluginCLIHasTheProxy(t *testing.T) {
	sandbox(t)
	const proxy = "http://127.0.0.1:7890"
	t.Setenv("HTTPS_PROXY", proxy)
	t.Setenv("HTTP_PROXY", proxy)
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	abs, _ := filepath.Abs("testdata/cliproxy/index.js")
	if _, err := Add(ctx, abs); err != nil {
		t.Fatal(err)
	}
	a, err := Authorize(ctx, "cliproxy", 0, nil, NewAccount)
	if err != nil {
		t.Fatal(err)
	}
	u, err := url.Parse(a.URL)
	if err != nil {
		t.Fatal(err)
	}
	for _, k := range []string{"inherited", "copied"} {
		if got := u.Query().Get(k); got != proxy {
			t.Errorf("a CLI started with the %s environment has HTTPS_PROXY %q, want %q", k, got, proxy)
		}
	}
}
