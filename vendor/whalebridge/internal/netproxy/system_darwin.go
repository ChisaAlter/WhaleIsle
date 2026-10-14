package netproxy

import "github.com/yetone/magpie/internal/proc"

// system reads what System Settings → Network → Proxies says, through
// scutil (the same dictionary CFNetwork uses).
func system() Proxy {
	out, err := proc.Command("scutil", "--proxy").Output()
	if err != nil {
		return Proxy{}
	}
	return parseScutil(string(out))
}
