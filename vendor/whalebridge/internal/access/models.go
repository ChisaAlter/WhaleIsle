package access

import (
	"errors"
	"regexp"
	"slices"
	"strings"
)

// CleanModels is a key's model list as kept (#882): each pattern trimmed,
// empty and repeated ones dropped. A pattern names a provider and a model,
// "<provider>/<model>", every model of one, "<provider>/*", or a routing
// group, "group/<name>".
func CleanModels(in []string) ([]string, error) {
	var out []string
	for _, m := range in {
		m = strings.TrimSpace(m)
		if m == "" || slices.ContainsFunc(out, func(o string) bool { return strings.EqualFold(o, m) }) {
			continue
		}
		if !strings.Contains(m, "/") || strings.HasPrefix(m, "/") || strings.HasSuffix(m, "/") {
			return nil, errors.New("A key's model is <provider>/<model> or <provider>/*, like openai/gpt-5 or anthropic/*: " + m)
		}
		if len(m) > 300 {
			return nil, errors.New("A key's model is at most 300 characters")
		}
		out = append(out, m)
	}
	if len(out) > 500 {
		return nil, errors.New("A key can list at most 500 models")
	}
	return out, nil
}

// Restricted says the key may use only the models or accounts it lists.
func (who Identity) Restricted() bool { return len(who.Models) > 0 || len(who.Accounts) > 0 }

// Allows says one of ids is among the key's models; any, for a key that
// lists none. The accounts a key may be held to say nothing of its
// models: they hold the candidates of a plan, not its models.
func (who Identity) Allows(ids ...string) bool {
	if len(who.Models) == 0 {
		return true
	}
	for _, id := range ids {
		if id != "" && ModelAllowed(who.Models, id) {
			return true
		}
	}
	return false
}

// ModelAllowed says id ("<provider>/<model>") matches one of patterns,
// letter case aside; a "*" in a pattern stands for any run of characters,
// slashes too. No patterns allow every model.
func ModelAllowed(patterns []string, id string) bool {
	if len(patterns) == 0 {
		return true
	}
	for _, p := range patterns {
		if strings.EqualFold(p, id) {
			return true
		}
		if strings.Contains(p, "*") && globRe(p).MatchString(id) {
			return true
		}
	}
	return false
}

func globRe(p string) *regexp.Regexp {
	parts := strings.Split(p, "*")
	for i, s := range parts {
		parts[i] = regexp.QuoteMeta(s)
	}
	return regexp.MustCompile("(?is)^" + strings.Join(parts, ".*") + "$")
}
