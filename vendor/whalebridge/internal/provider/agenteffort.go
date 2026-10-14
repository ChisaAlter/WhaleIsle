package provider

import (
	"errors"
	"fmt"
	"slices"
	"strings"

	"github.com/yetone/magpie/internal/settings"
)

// An agent whose own config can't carry a reasoning effort (Cursor Private
// Inference, #1003: neither its environment nor its app picks one for most
// models) has one picked in magpie, kept by agent (settings' AgentEfforts),
// and asked for by the gateway on the agent's requests to a model that
// reasons, in place of the level the agent sent: the user picked it, and
// Cursor's own, where it has a Reasoning control, is its default as often
// as a choice. None picked, the agent's requests go as it asks.

// AgentEffort is the effort agent's requests are asked for, "" for none.
func AgentEffort(agent string) string {
	return heldSettings().AgentEfforts[strings.ToLower(agent)]
}

// SetAgentEffort asks agent's requests for level, one of MemberEfforts;
// "" asks for none, leaving each request's own.
func SetAgentEffort(agent, level string) error {
	agent, level = strings.ToLower(strings.TrimSpace(agent)), strings.ToLower(strings.TrimSpace(level))
	if agent == "" {
		return errors.New("no agent")
	}
	if level != "" && !slices.Contains(MemberEfforts, level) {
		return fmt.Errorf("%q is not a reasoning effort: one of %s", level, strings.Join(MemberEfforts, ", "))
	}
	s := settings.Load()
	if s.AgentEfforts[agent] == level {
		return nil
	}
	if level == "" {
		delete(s.AgentEfforts, agent)
	} else {
		if s.AgentEfforts == nil {
			s.AgentEfforts = map[string]string{}
		}
		s.AgentEfforts[agent] = level
	}
	if err := settings.Save(s); err != nil {
		return err
	}
	Changed() // a held settings read sees it
	return nil
}
