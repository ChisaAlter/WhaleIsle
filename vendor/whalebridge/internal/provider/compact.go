package provider

import (
	"strings"

	"github.com/yetone/magpie/internal/catalog"
	"github.com/yetone/magpie/internal/settings"
)

// Where Codex and Claude Code compact a long conversation (#876): the
// window they are told for a model whose own is longer. A model's own
// (settings.ModelCompacts, "provider/model"), else its provider's
// ("provider/*"), else the one for every model (settings.Compact: 272K, a
// number the user gave, or none under Full window).

// compactOf is the user's threshold for a provider's model: its own, else
// its provider's "*"; 0 when neither is set.
func compactOf(s settings.Settings, providerID, model string) int {
	if n := s.ModelCompacts[providerID+"/"+model]; n > 0 {
		return n
	}
	return s.ModelCompacts[providerID+"/*"]
}

// CompactSet is the threshold the user set on a model, by its catalog id
// ("provider/model", magpie/ and a [1m] mark taken off), or on its
// provider; for a group, the smallest its models have, so none of them
// outgrows its own. 0 when none is set: settings.Compact then answers.
func CompactSet(id string) int {
	return compactSet(settings.Load(), id, GroupFinder())
}

// CompactSetIn is CompactSet for a caller that already holds the settings
// and the group finder: an agent's list is built for hundreds of models at
// magpie's start, and reading both again for each is what EffectivePriceIn
// saves the same loop.
func CompactSetIn(s settings.Settings, id string, find func(string) (Group, []Member, bool)) int {
	return compactSet(s, id, find)
}

func compactSet(s settings.Settings, id string, find func(string) (Group, []Member, bool)) int {
	if len(s.ModelCompacts) == 0 {
		return 0
	}
	id = strings.TrimSuffix(strings.TrimPrefix(strings.TrimSpace(id), "magpie/"), "[1m]")
	if strings.HasPrefix(id, GroupPrefix) {
		_, ms, _ := find(id)
		least := 0
		for _, m := range ms {
			if n := compactOf(s, m.Provider.ID, entryModel(m)); n > 0 && (least == 0 || n < least) {
				least = n
			}
		}
		return least
	}
	pid, model, ok := strings.Cut(id, "/")
	if !ok {
		return 0
	}
	return compactOf(s, pid, model)
}

// entryModel is the model id a group's member is listed under: the last
// of its path, the provider's id taken off, which is not always what the
// vendor is asked for (a wire name).
func entryModel(m Member) string {
	if n := len(m.Path); n > 0 {
		if model, ok := strings.CutPrefix(m.Path[n-1], m.Provider.ID+"/"); ok {
			return model
		}
	}
	return m.Model
}

// CompactsOf is the thresholds the user set on a provider's models, by
// model id, "*" for all of them: what its editor's Compact at shows.
func CompactsOf(providerID string) map[string]int {
	out := map[string]int{}
	for k, n := range settings.Load().ModelCompacts {
		if model, ok := strings.CutPrefix(k, providerID+"/"); ok && model != "" && n > 0 {
			out[model] = n
		}
	}
	return out
}

// SetModelCompacts makes a provider's thresholds cs, by model id, "*" for
// all of them, as its editor's Compact at says: those it leaves out are
// taken away, and every one set has to be a model the provider serves, as
// for a reply limit (SetModelOutputs). Codex's and Claude Code's lists are
// written again when anything changed.
func SetModelCompacts(providerID string, cs map[string]int) error {
	p, err := Find(providerID)
	if err != nil {
		return err
	}
	for model, n := range cs {
		if n < 0 {
			return errorf("a compaction threshold is a number of tokens, not %d", n)
		}
		if err := settings.CheckModelKey("a compaction threshold", p.ID+"/"+model); err != nil {
			return err
		}
		if model != "*" && n > 0 && !p.serves(model) {
			return errorf("%s has no model %s (magpie provider %s lists them)", p.ID, model, p.ID)
		}
	}
	s := settings.Load()
	changed := false
	for k := range s.ModelCompacts {
		if model, ok := strings.CutPrefix(k, p.ID+"/"); ok && cs[model] <= 0 {
			delete(s.ModelCompacts, k)
			changed = true
		}
	}
	for model, n := range cs {
		if n <= 0 || s.ModelCompacts[p.ID+"/"+model] == n {
			continue
		}
		if s.ModelCompacts == nil {
			s.ModelCompacts = map[string]int{}
		}
		s.ModelCompacts[p.ID+"/"+model] = n
		changed = true
	}
	if !changed {
		return nil
	}
	if err := settings.Save(s); err != nil {
		return err
	}
	catalog.Touched()
	return nil
}

// SetCompactAt has every model without a threshold of its own compacted at
// n tokens, Full window turned off; 0 is the working window again
// (settings.WorkingWindow).
func SetCompactAt(n int) error {
	if n < 0 {
		return errorf("a compaction threshold is a number of tokens, not %d", n)
	}
	s := settings.Load()
	if n == settings.WorkingWindow {
		n = 0
	}
	if s.CompactAt == n && !s.FullContext {
		return nil
	}
	s.CompactAt, s.FullContext = n, false
	if err := settings.Save(s); err != nil {
		return err
	}
	catalog.Touched()
	return nil
}
