package whalebridge

import (
	"os"
	"testing"

	"github.com/yetone/magpie/internal/provider"
	"github.com/yetone/magpie/internal/settings"
)

func TestDSHCompactionThresholdProjection(t *testing.T) {
	a := newProviderHTTP(t)
	for id, window := range map[string]int{"large": 1000000, "small": 128000} {
		if err := provider.Save(provider.Provider{ID: id, Name: id, Chat: a.vendor + "/v1/chat/completions", Key: "test-secret", Models: []string{"test-model"}, Contexts: map[string]int{"*": window}}); err != nil {
			t.Fatal(err)
		}
	}
	read := func() map[string]int {
		t.Helper()
		if err := syncDSH(); err != nil {
			t.Fatal(err)
		}
		doc, err := profileDocument(os.Getenv("WHALEBRIDGE_DSH_HOME"))
		if err != nil {
			t.Fatal(err)
		}
		row := configRow(doc, "llm-pi-ai")
		models := member(member(member(member(row, "config"), "providers"), "whalebridge"), "models")
		var rows []routeModel
		if models == nil {
			t.Fatal("DSH route has no models")
		}
		if err := models.Decode(&rows); err != nil {
			t.Fatal(err)
		}
		out := make(map[string]int)
		for _, row := range rows {
			if row.ID == "large/test-model" && row.ContextWindow != 1000000 || row.ID == "small/test-model" && row.ContextWindow != 128000 {
				t.Fatalf("compaction setting changed the actual context capacity: %+v", row)
			}
			out[row.ID] = row.CompactionThreshold
		}
		return out
	}
	s := settings.Load()
	s.CompactAt = 160000
	if err := settings.Save(s); err != nil {
		t.Fatal(err)
	}
	if got := read(); got["large/test-model"] != 160000 || got["small/test-model"] != 0 {
		t.Fatalf("global threshold does not respect actual model windows: %v", got)
	}
	s.ModelCompacts = map[string]int{"large/*": 96000, "small/test-model": 64000}
	if err := settings.Save(s); err != nil {
		t.Fatal(err)
	}
	if got := read(); got["large/test-model"] != 96000 || got["small/test-model"] != 64000 {
		t.Fatalf("provider/model threshold did not precede global threshold: %v", got)
	}
	s.FullContext, s.ModelCompacts = true, nil
	if err := settings.Save(s); err != nil {
		t.Fatal(err)
	}
	if got := read(); got["large/test-model"] != 0 || got["small/test-model"] != 0 {
		t.Fatalf("full context still projects an early global threshold: %v", got)
	}
}
