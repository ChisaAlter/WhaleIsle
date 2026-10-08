package catalog

import (
	"os"
	"path/filepath"
	"testing"
)

func writeCatalog(t *testing.T, body string) {
	t.Helper()
	dir := t.TempDir()
	t.Setenv("XDG_CACHE_HOME", dir)
	if err := os.MkdirAll(filepath.Join(dir, "magpie"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(CachePath(), []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	Reset()
	t.Cleanup(Reset)
}
