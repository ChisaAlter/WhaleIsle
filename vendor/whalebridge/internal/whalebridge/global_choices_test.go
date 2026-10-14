package whalebridge

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/yetone/magpie/internal/catalog"
	"github.com/yetone/magpie/internal/provider"
	"github.com/yetone/magpie/internal/settings"
)

func TestGlobalAuxiliaryChoicesUseSafeJSON(t *testing.T) {
	a := newProviderHTTP(t)
	// Provider.Save keeps the user's picks without fetching a vendor list.
	// Searchers use Available(), and vision needs the catalog's input
	// modalities, so the isolated home must carry those real prerequisites.
	if err := os.MkdirAll(filepath.Dir(catalog.CachePath()), 0700); err != nil {
		t.Fatal(err)
	}
	models := []byte(`{"openai":{"id":"openai","name":"OpenAI","models":{"gpt-4.1":{"id":"gpt-4.1","name":"GPT 4.1","modalities":{"input":["text","image"],"output":["text"]},"limit":{"context":1000000,"output":16384},"cost":{"input":1,"output":2}},"gpt-image-1":{"id":"gpt-image-1","name":"GPT Image 1","modalities":{"input":["text","image"],"output":["image"]},"limit":{"context":32768,"output":1024}}}}}`)
	if err := os.WriteFile(catalog.CachePath(), models, 0600); err != nil {
		t.Fatal(err)
	}
	catalog.Reset()
	t.Cleanup(catalog.Reset)
	if err := provider.Save(provider.Provider{ID: "search-relay", Name: "Search relay", Responses: a.vendor + "/v1/responses", Key: "do-not-publish-this-key", Catalog: "openai", Models: []string{"gpt-4.1", "gpt-image-1"}, Searches: true}); err != nil {
		t.Fatal(err)
	}
	s := settings.Load()
	s.Searcher, s.Vision, s.ImageGen = "missing/model", "missing/vision", "missing/image"
	if err := settings.Save(s); err != nil {
		t.Fatal(err)
	}
	raw := a.call("GET", "global", nil, 200)
	if bytes.Contains(raw, []byte("do-not-publish-this-key")) {
		t.Fatal("auxiliary choices disclosed the provider credential")
	}
	var got struct {
		SearchVendors                []struct{ ID, Name string }
		Searchers                    []map[string]json.RawMessage
		VisionModels                 []struct{ ID string }
		DrawingModels                []struct{ ID string }
		SearcherUnused               string
		VisionUnused, ImageGenUnused bool
	}
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatal(err)
	}
	var vendorRows []map[string]json.RawMessage
	var fields map[string]json.RawMessage
	_ = json.Unmarshal(raw, &fields)
	_ = json.Unmarshal(fields["searchVendors"], &vendorRows)
	if len(vendorRows) != 5 || vendorRows[0]["id"] == nil || vendorRows[0]["ID"] != nil || got.SearchVendors[0].ID != "tavily" {
		t.Fatalf("search vendor JSON does not match renderer fields: %s", raw)
	}
	if len(got.Searchers) == 0 || got.Searchers[0]["id"] == nil || got.Searchers[0]["provider"] != nil {
		t.Fatalf("search candidates are absent or not a safe DTO: %s", raw)
	}
	if len(got.Searchers) != 1 || string(got.Searchers[0]["id"]) != `"search-relay"` || len(got.Searchers[0]) != 4 || got.Searchers[0]["name"] == nil || got.Searchers[0]["small"] == nil || got.Searchers[0]["models"] == nil {
		t.Fatalf("search candidate JSON must contain only id, name, small and models: %s", raw)
	}
	visionFound := false
	for _, m := range got.VisionModels {
		visionFound = visionFound || m.ID == "search-relay/gpt-4.1"
	}
	if !visionFound || len(got.DrawingModels) != 1 || got.DrawingModels[0].ID != "search-relay/gpt-image-1" {
		t.Fatalf("catalog capabilities did not reach the tool candidates: %s", raw)
	}
	if len(got.VisionModels) == 0 || len(got.DrawingModels) == 0 || got.SearcherUnused != "gone" || !got.VisionUnused || !got.ImageGenUnused {
		t.Fatalf("tool candidates or missing-model diagnostics were lost: %s", raw)
	}
}
