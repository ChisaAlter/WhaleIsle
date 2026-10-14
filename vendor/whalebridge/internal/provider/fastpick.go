package provider

import (
	"errors"
	"fmt"
	"slices"
	"strings"

	"github.com/yetone/magpie/internal/settings"
)

// An agent's pick of a model may be sent in its vendor's fast mode (#954),
// as a routing group's member may (Group.Fast): switched by the model in
// the agent's picker, kept by agent (settings' FastPicks), and asked for by
// the gateway on every request the agent sends that model. A group takes
// none: its members are sent as it says.

// IsFastPick reports whether agent's requests for the entry id
// ("<provider>/<model>") are sent fast.
func IsFastPick(agent, id string) bool {
	return slices.Contains(FastPicks(agent), id)
}

// FastPicks are the entries agent's requests for are sent fast, read once
// for a list of them all.
func FastPicks(agent string) []string {
	return heldSettings().FastPicks[strings.ToLower(agent)]
}

// SetFastPick sends agent's requests for the entry id fast, or not. Only a
// model with a fast mode magpie can ask for (CanFast) is switched on.
func SetFastPick(agent, id string, fast bool) error {
	agent, id = strings.ToLower(strings.TrimSpace(agent)), strings.TrimSpace(id)
	if agent == "" {
		return errors.New("no agent")
	}
	if fast {
		if strings.HasPrefix(id, GroupPrefix) {
			return fmt.Errorf("%s is a routing group: its members are sent fast as it says, on the Routing page", id)
		}
		p, model, ok := Resolve(id)
		if !ok {
			return fmt.Errorf("magpie knows no model %q", id)
		}
		if p.ID+"/"+model != id {
			return fmt.Errorf("%s is not a model as <provider>/<model>", id)
		}
		if !CanFast(p, model) {
			return fmt.Errorf("%s has no fast mode magpie can ask for", id)
		}
	}
	s := settings.Load()
	was := s.FastPicks[agent]
	keep := slices.DeleteFunc(slices.Clone(was), func(x string) bool { return x == id })
	if fast {
		keep = append(keep, id)
	}
	if slices.Equal(was, keep) {
		return nil
	}
	if len(keep) == 0 {
		delete(s.FastPicks, agent)
	} else {
		if s.FastPicks == nil {
			s.FastPicks = map[string][]string{}
		}
		s.FastPicks[agent] = keep
	}
	if err := settings.Save(s); err != nil {
		return err
	}
	Changed() // a held settings read sees it
	return nil
}
