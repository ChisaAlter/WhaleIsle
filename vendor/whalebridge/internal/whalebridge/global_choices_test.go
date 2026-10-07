package whalebridge

import (
	"bytes"
	"encoding/json"
	"testing"

	"github.com/yetone/magpie/internal/provider"
	"github.com/yetone/magpie/internal/settings"
)

func TestGlobalAuxiliaryChoicesUseSafeJSON(t *testing.T) {
	a := newProviderHTTP(t)
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
	if len(got.VisionModels) == 0 || len(got.DrawingModels) == 0 || got.SearcherUnused != "gone" || !got.VisionUnused || !got.ImageGenUnused {
		t.Fatalf("tool candidates or missing-model diagnostics were lost: %s", raw)
	}
}
