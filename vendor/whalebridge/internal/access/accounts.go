package access

import (
	"errors"
	"fmt"
	"slices"
	"strings"

	"github.com/yetone/magpie/internal/provider"
)

// CleanAccounts is a key's account list as kept (#905): each entry
// "<provider>/<account>", an account named by its stable id — or by the
// name it is shown by, resolved to that id, so the command line reads
// while the list keeps what a rename doesn't move — and a key by its
// fingerprint; trimmed, told apart in lower case as accounts are, each
// once, in the order given. Every account the entry names must be one
// its provider has now, so a typo can't quietly hold a key to nothing;
// one gone later — a key rotated, an account signed out — is kept as it
// is, matching nothing.
func CleanAccounts(in []string) ([]string, error) {
	var out []string
	for _, a := range in {
		a = strings.TrimSpace(a)
		if a == "" {
			continue
		}
		pid, ref, ok := strings.Cut(a, "/")
		if !ok || pid == "" || ref == "" {
			return nil, errors.New("A key's account is <provider>/<account> or <provider>/<key id>, like codex/me@example.com: " + a)
		}
		if len(a) > 300 {
			return nil, errors.New("A key's account is at most 300 characters")
		}
		p, err := provider.Find(pid)
		if err != nil {
			return nil, err
		}
		id := ""
		for _, r := range p.AccountIDs() {
			if strings.EqualFold(r.ID, ref) || strings.EqualFold(r.User, ref) {
				id = r.ID
				break
			}
		}
		if id == "" {
			if p.Account == nil {
				return nil, fmt.Errorf("%s has no key %q", p.Name, ref)
			}
			return nil, fmt.Errorf("%s has no account %q", p.Name, ref)
		}
		kept := p.ID + "/" + id
		if !slices.ContainsFunc(out, func(o string) bool { return strings.EqualFold(o, kept) }) {
			out = append(out, kept)
		}
	}
	if len(out) > 500 {
		return nil, errors.New("A key can list at most 500 accounts")
	}
	return out, nil
}

// AllowsAccount says the provider pid's account or key ref is among the
// key's accounts — "<provider>/<ref>", told apart in lower case, as
// accounts are. The list holds a key to some accounts **of the providers
// it names**: a provider it names no account of, the key uses as it
// always did, its every account and key. Any, for a key that lists none.
func (who Identity) AllowsAccount(pid, ref string) bool {
	if len(who.Accounts) == 0 {
		return true
	}
	pid = strings.ToLower(strings.TrimSpace(pid))
	key := pid + "/" + strings.ToLower(strings.TrimSpace(ref))
	named := false
	for _, a := range who.Accounts {
		if a = strings.ToLower(strings.TrimSpace(a)); a == key {
			return true
		} else if p, _, ok := strings.Cut(a, "/"); ok && p == pid {
			named = true
		}
	}
	return !named
}
