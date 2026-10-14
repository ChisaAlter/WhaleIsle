package provider

// PLUGIN-SERVED (see AGENTS.md): Cursor ("cursor") is a deprecated built-in
// subscription served by its plugin, @magpie-community/opencode-cursor-auth,
// once moved onto it (provider.Moved; the default for a new sign-in). A
// moved one's sign-ins, models, requests and usage are all the plugin's,
// never this code's (only the move, in migrate*.go, still reads its
// accounts). A fix here alone doesn't reach those users; fix the plugin
// (github.com/magpie-community/plugins, packages/cursor) and raise the
// mover's min in internal/provider/migrate_side.go.

// `cursor-agent models` lists what GetUsableModels has, and Cursor's model
// picker (AiService/AvailableModels) offers models it leaves out: one added
// since, or one the account hasn't turned on (ARNO on Discord: "cursor
// provider 里少了 glm-5.3 和 glm-5.3-flash"). They are listed too, by the
// slug or name the agent API takes.

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/yetone/magpie/internal/catalog"
)

// cursorPickerSkip are left out of the CLI's picker as it leaves them out.
var cursorPickerSkip = map[string]bool{"claude-4.5-haiku": true, "claude-4.5-haiku-thinking": true, "gemini-2.5-pro": true, "gemini-2.5-flash": true}

type cursorPickerModel struct {
	Name              string   `json:"name"`
	ClientDisplayName string   `json:"clientDisplayName"`
	ServerModelName   string   `json:"serverModelName"`
	LegacySlugs       []string `json:"legacySlugs"`
	IDAliases         []string `json:"idAliases"`
	IsHidden          bool     `json:"isHidden"`
	IsChatOnly        bool     `json:"isChatOnly"`
	OnlySupportsCmdK  bool     `json:"onlySupportsCmdK"`
	SupportsAgent     *bool    `json:"supportsAgent"`
	ContextTokenLimit int      `json:"contextTokenLimit"`
	Variants          []struct {
		DisplayName                 string `json:"displayName"`
		DisplayNameOutsidePicker    string `json:"displayNameOutsidePicker"`
		LegacySlug                  string `json:"legacySlug"`
		VariantStringRepresentation string `json:"variantStringRepresentation"`
	} `json:"variants"`
}

// cursorPickerModels are the picker's models that none of have names (by
// id, name or slug): one for each variant with a slug of its own, else the
// model by its name. Hidden, chat-only, Tab-only and non-agent models stay
// out. A picker Cursor can't give is none.
func cursorPickerModels(ctx context.Context, token string, have []catalog.Model) []catalog.Model {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, cursorBase+"/aiserver.v1.AiService/AvailableModels",
		bytes.NewReader([]byte(`{"useModelParameters":true,"doNotUseMarkdown":true}`)))
	if err != nil {
		return nil
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Connect-Protocol-Version", "1")
	req.Header.Set("x-cursor-client-version", CursorClientVersion())
	req.Header.Set("x-cursor-client-type", "cli")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(io.LimitReader(res.Body, 8<<20))
	var data struct {
		Models []cursorPickerModel `json:"models"`
	}
	if res.StatusCode/100 != 2 || json.Unmarshal(b, &data) != nil {
		return nil
	}
	known := map[string]bool{}
	for _, m := range have {
		known[m.ID] = true
	}
	clean := func(s string) string { return strings.Join(strings.Fields(strings.ReplaceAll(s, "​", "")), " ") }
	var out []catalog.Model
	for _, m := range data.Models {
		if m.Name == "" || m.IsHidden || m.IsChatOnly || m.OnlySupportsCmdK || (m.SupportsAgent != nil && !*m.SupportsAgent) || cursorPickerSkip[m.Name] {
			continue
		}
		names := append([]string{m.Name, m.ServerModelName}, append(m.LegacySlugs, m.IDAliases...)...)
		for _, v := range m.Variants {
			names = append(names, v.LegacySlug, v.VariantStringRepresentation)
		}
		listed := false
		for _, n := range names {
			listed = listed || (n != "" && known[n])
		}
		if listed {
			continue
		}
		title := clean(m.ClientDisplayName)
		if title == "" {
			title = m.Name
		}
		add := func(id, name string) {
			known[id] = true
			c := m.ContextTokenLimit
			if c <= 0 {
				c = cursorContext(id, name)
			}
			out = append(out, catalog.Model{ID: id, Name: name, Context: c})
		}
		slugged := false
		for _, v := range m.Variants {
			if v.LegacySlug == "" {
				continue
			}
			slugged = true
			if known[v.LegacySlug] {
				continue
			}
			name := clean(v.DisplayNameOutsidePicker)
			if name == "" {
				name = clean(title + " " + v.DisplayName)
			}
			add(v.LegacySlug, name)
		}
		if !slugged && !known[m.Name] {
			add(m.Name, title)
		}
	}
	return out
}
