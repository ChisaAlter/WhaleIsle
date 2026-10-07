package provider

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/yetone/magpie/internal/catalog"
)

// ClineVersion is the Cline desktop release magpie says it is to the Cline
// API.
const ClineVersion = "3.5.54"

// clineHeaders are what Cline's desktop app sends the Cline API (cline/cline
// sdk/packages/llms/src/providers/cline-client-headers.ts, with the
// desktop's client type). The cline-free/ models are answered 403 "only
// available via Cline product surfaces" without them, and X-CLIENT-TYPE is
// what the recommended-models feed keys its free list on: cline-desktop is
// given the desktop's.
var clineHeaders = map[string]string{
	"HTTP-Referer":     "https://cline.bot",
	"X-Title":          "Cline",
	"X-IS-MULTIROOT":   "false",
	"X-CLIENT-TYPE":    "cline-desktop",
	"X-CLIENT-VERSION": ClineVersion,
	"User-Agent":       "Cline/" + ClineVersion,
}

// ClineClient makes a request to the Cline API carry the desktop app's
// headers.
func ClineClient(h http.Header) {
	for k, v := range clineHeaders {
		h.Set(k, v)
	}
}

// IsCline reports whether the provider is the Cline API: made from the
// ClinePass preset, or at Cline's host.
func (p Provider) IsCline() bool {
	if p.Preset == "clinepass" {
		return true
	}
	h := p.Host()
	return h == "cline.bot" || strings.HasSuffix(h, ".cline.bot")
}

// clineFreePrefix is what the ids of Cline's free models start with; one
// the feed's free list names may not (stealth/space-bunny-alpha).
const clineFreePrefix = "cline-free/"

// clineFeed is the list Cline's own clients take their pickers from:
// GET {base}/ai/cline/recommended-models, asked with the client's headers
// and no key. Its clinePass models are the plan's, its free ones are served
// at no cost and apart from the plan's quota ("Try with limited usage,
// separate from ClinePass quota"). Paid models are left out, as the
// plan's preset leaves them out of the API's list.
func (p Provider) clineFeed(ctx context.Context) ([]catalog.Model, string, error) {
	u := strings.TrimRight(strings.TrimSpace(p.Chat), "/") + "/ai/cline/recommended-models"
	ctx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, u, err
	}
	req.Header.Set("Accept", "application/json")
	ClineClient(req.Header)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, u, err
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(io.LimitReader(res.Body, 4<<20))
	if res.StatusCode != http.StatusOK {
		return nil, u, errorf("%s: HTTP %d", u, res.StatusCode)
	}
	type entry struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	}
	var feed struct {
		ClinePass []entry `json:"clinePass"`
		Free      []entry `json:"free"`
	}
	if err := json.Unmarshal(b, &feed); err != nil {
		return nil, u, err
	}
	var ms []catalog.Model
	add := func(e entry, free bool) {
		if e.ID == "" {
			return
		}
		for _, m := range ms {
			if m.ID == e.ID {
				return
			}
		}
		name := e.Name
		if name == "" || free && name == e.ID {
			name = clineFreeName(e.ID)
		}
		ms = append(ms, catalog.Model{ID: e.ID, Name: name, Free: free})
	}
	for _, e := range feed.ClinePass {
		add(e, false)
	}
	for _, e := range feed.Free {
		add(e, true)
	}
	if len(ms) == 0 {
		return nil, u, errors.New(u + ": no models listed")
	}
	return p.planModels(ms), u, nil
}

// clineFree are Cline's free models as its desktop app listed them
// (2026-10-02; cline/cline sdk/packages/llms/src/catalog/
// cline-recommended.generated.ts), for when the feed wasn't had.
var clineFree = []catalog.Model{
	{ID: "cline-free/deepseek-v4.1-flash", Name: "DeepSeek V4.1 Flash"},
	{ID: "stealth/space-bunny-alpha", Name: "Space Bunny Alpha"},
	{ID: "cline-free/mimo-v2.6-flash", Name: "MiMo-V2.6-Flash"},
	{ID: "cline-free/muse-spark-1.3-contributor", Name: "Muse Spark 1.3 Contributor"},
}

// clineFreeName is the fallback list's name for a free model, else its id.
func clineFreeName(id string) string {
	for _, m := range clineFree {
		if m.ID == id {
			return m.Name
		}
	}
	return id
}

// isClineFree reports whether id is a free model by its id alone: a
// cline-free/ one, or one the fallback names.
func isClineFree(id string) bool {
	if strings.HasPrefix(id, clineFreePrefix) {
		return true
	}
	for _, m := range clineFree {
		if m.ID == id {
			return true
		}
	}
	return false
}

// clineFreeModel reports whether model is one of Cline's free models on
// p: one the fetched list marks free, else one free by its id.
func (p Provider) clineFreeModel(model string) bool {
	if !p.IsCline() {
		return false
	}
	if strings.HasPrefix(model, clineFreePrefix) {
		return true
	}
	if ms, _, ok := p.live(); ok {
		for _, m := range ms {
			if m.ID == model {
				return m.Free
			}
		}
	}
	return isClineFree(model)
}

// ClinePinnable reports whether p's requests reach Cline's API and can be
// pinned to an upstream (PinUpstream): the ClinePass provider, one on
// cline.bot, or the Cline plugin's (@magpie-community/opencode-cline-auth),
// whose requests magpie writes before the plugin sends them on.
func (p Provider) ClinePinnable() bool {
	return p.IsCline() || p.PluginProvider() == "cline"
}

// ClinePin is the upstream a request for model is pinned to on p
// (PinUpstream): "deepseek" for a DeepSeek model of the Cline API, ""
// for anything else. Cline's free models are served where Cline puts
// them, so they never are.
func (p Provider) ClinePin(model string) string {
	if !p.PinUpstream || !p.ClinePinnable() || strings.HasPrefix(model, clineFreePrefix) {
		return ""
	}
	if name := model[strings.LastIndex(model, "/")+1:]; strings.HasPrefix(strings.ToLower(name), "deepseek") {
		return "deepseek"
	}
	return ""
}
