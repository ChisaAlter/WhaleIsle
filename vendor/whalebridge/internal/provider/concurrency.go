package provider

import "fmt"

// Concurrency is how many requests the gateway lets be out at the vendor
// at once on each of the provider's keys or accounts, 0 for no limit: the
// user's MaxConcurrency when they set one, else what the plugin giving the
// provider says it takes (its auth hook's maxConcurrency, or its
// package.json's magpie.maxConcurrency), else none.
func (p Provider) Concurrency() int {
	if p.MaxConcurrency != nil {
		return max(*p.MaxConcurrency, 0)
	}
	return p.PluginConcurrency()
}

// PluginConcurrency is what the plugin giving the provider says it takes
// at once, as it lists it now; 0 for none, or for a provider no plugin
// gives.
func (p Provider) PluginConcurrency() int {
	if !p.IsPlugin() {
		return 0
	}
	if cur, ok := PluginOf(p.ID); ok {
		return max(cur.MaxConcurrency, 0)
	}
	return max(p.Account.plugin.MaxConcurrency, 0)
}

const (
	MaxLimit      = 1000
	MaxQueueLimit = 10000
	MaxQueueWait  = 3600
)

func (p Provider) LaneLimit() int {
	ref := ""
	if p.Account != nil {
		ref = p.Account.User
	} else if p.Key != "" {
		ref = KeyID(p.Key)
	}
	m := p.AccountConcurrency
	if m == nil && p.Account != nil {
		if saved, ok := storedPicks(p.ID); ok {
			m = saved.AccountConcurrency
		}
	}
	if n, ok := m[accountKey(ref)]; ok && ref != "" {
		return max(n, 0)
	}
	return p.Concurrency()
}

func (p Provider) AccountConcurrencyOf(ref string) (int, bool) {
	n, ok := p.AccountConcurrency[accountKey(ref)]
	return n, ok
}

func (p Provider) AccountRefOf(ref string) (string, bool) { return p.accountRef(ref) }

func SetAccountConcurrency(id, ref string, limit *int) error {
	if limit != nil && (*limit < 0 || *limit > MaxLimit) {
		return fmt.Errorf("并发上限必须为 0 到 %d", MaxLimit)
	}
	p, err := Find(id)
	if err != nil {
		return err
	}
	r, ok := p.accountRef(ref)
	if !ok {
		return fmt.Errorf("%s 没有账号或密钥 %q", p.Name, ref)
	}
	m := map[string]int{}
	for k, v := range p.AccountConcurrency {
		m[k] = v
	}
	if limit == nil {
		delete(m, accountKey(r))
	} else {
		m[accountKey(r)] = *limit
	}
	p.AccountConcurrency = m
	return Save(*p)
}

func CheckQueue(limit, wait int) error {
	if limit < 0 || limit > MaxQueueLimit {
		return fmt.Errorf("排队上限必须为 0 到 %d", MaxQueueLimit)
	}
	if wait < 0 || wait > MaxQueueWait {
		return fmt.Errorf("排队等待必须为 0 到 %d 秒", MaxQueueWait)
	}
	return nil
}

func SetQueue(id string, limit, wait int) error {
	if err := CheckQueue(limit, wait); err != nil {
		return err
	}
	p, err := Find(id)
	if err != nil {
		return err
	}
	p.QueueLimit, p.QueueWait = limit, wait
	return Save(*p)
}

func normalAccountConcurrency(m map[string]int) map[string]int {
	var out map[string]int
	for ref, n := range m {
		ref = accountKey(ref)
		if ref == "" {
			continue
		}
		if out == nil {
			out = map[string]int{}
		}
		out[ref] = min(max(n, 0), MaxLimit)
	}
	return out
}
