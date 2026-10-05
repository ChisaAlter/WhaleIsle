package provider

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
