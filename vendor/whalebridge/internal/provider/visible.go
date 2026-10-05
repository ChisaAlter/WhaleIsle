package provider

import (
	"errors"
	"slices"
	"strings"

	"github.com/yetone/magpie/internal/catalog"
	"github.com/yetone/magpie/internal/settings"
)

// Which of the catalog an agent is shown. Settings' Visible names, for an
// agent, the families its lists hold: a family is the tag providers and
// groups are given (magpie provider set <id> family=relay), and a
// provider's or group's id names it alone. The gateway's model list and
// what magpie writes into the agents' files both come from CatalogFor, so
// the two never differ.

// Names are what an entry answers to in a visibility: its family, and its
// provider's id or its group's id (as group/<id> too).
func (e Entry) Names() []string {
	var out []string
	if e.Family != "" {
		out = append(out, e.Family)
	}
	if e.Group != "" {
		return append(out, e.Group, GroupPrefix+e.Group)
	}
	return append(out, e.Provider.ID)
}

// VisibleTo is what agent's lists are narrowed to, and whether they are.
func VisibleTo(agent string) ([]string, bool) {
	names, ok := heldSettings().Visible[strings.ToLower(agent)]
	return slices.Clone(names), ok
}

// Shows reports whether a visibility shows e.
func Shows(names []string, e Entry) bool {
	for _, n := range e.Names() {
		if slices.ContainsFunc(names, func(v string) bool { return strings.EqualFold(v, n) }) {
			return true
		}
	}
	return false
}

// Described is set by the gateway: whether an image sent to a model that
// can't see is described to it by one that can (Settings › Vision). Agents
// are then told every model takes images; told a model is text-only, they
// turn the user's image away before magpie is asked (Codex: "does not
// support image input").
var Described func() bool

// described is Described, false before the gateway sets it.
func described() bool { return Described != nil && Described() }

// CatalogFor is the catalog as agent is shown it, and what is kept from it
// (none when its lists aren't narrowed): its visibility's, less the models
// taken out of its lists one by one (HiddenModels).
func CatalogFor(agent string) (shown, hidden []Entry) {
	listed, hidden := ListedFor(agent)
	off := HiddenModels(agent)
	for _, e := range listed {
		if off[e.ID] {
			hidden = append(hidden, e)
		} else {
			shown = append(shown, e)
		}
	}
	return shown, hidden
}

// ListedFor is the catalog agent's visibility gives it, the models it may
// pick to show or not among, and what the visibility keeps from it.
func ListedFor(agent string) (listed, kept []Entry) {
	all := Catalog()
	names, ok := VisibleTo(agent)
	if !ok {
		return all, nil
	}
	for _, e := range all {
		if Shows(names, e) {
			listed = append(listed, e)
		} else {
			kept = append(kept, e)
		}
	}
	return listed, kept
}

// HiddenModels are the ids of the entries taken out of agent's lists.
func HiddenModels(agent string) map[string]bool {
	ids := heldSettings().HiddenModels[strings.ToLower(agent)]
	out := make(map[string]bool, len(ids))
	for _, id := range ids {
		out[id] = true
	}
	return out
}

// SetHiddenModels takes these entries out of agent's lists, and puts back
// every other; none shows it every model its visibility gives it. The
// agents that keep the models in files of their own are told.
func SetHiddenModels(agent string, ids []string) error {
	agent = strings.ToLower(strings.TrimSpace(agent))
	if agent == "" {
		return errors.New("no agent")
	}
	var keep []string
	for _, id := range ids {
		if id = strings.TrimSpace(id); id != "" && !slices.Contains(keep, id) {
			keep = append(keep, id)
		}
	}
	slices.Sort(keep)
	s := settings.Load()
	if slices.Equal(s.HiddenModels[agent], keep) {
		return nil
	}
	if len(keep) == 0 {
		delete(s.HiddenModels, agent)
	} else {
		if s.HiddenModels == nil {
			s.HiddenModels = map[string][]string{}
		}
		s.HiddenModels[agent] = keep
	}
	if err := settings.Save(s); err != nil {
		return err
	}
	catalog.Touched()
	return nil
}

// Families are the families providers and groups are tagged with, sorted.
func Families() []string {
	var out []string
	add := func(f string) {
		if f != "" && !slices.Contains(out, f) {
			out = append(out, f)
		}
	}
	for _, p := range All() {
		add(p.Family)
	}
	for _, g := range Groups() {
		add(g.Family)
	}
	slices.Sort(out)
	return out
}
