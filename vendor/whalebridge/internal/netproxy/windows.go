package netproxy

import "strings"

// parseWindows reads Internet Options' ProxyServer ("host:port", or
// "http=h:p;https=h:p;socks=h:p") and ProxyOverride ("a;*.b;<local>").
func parseWindows(server, override string) Proxy {
	server = strings.TrimSpace(server)
	if server == "" {
		return Proxy{}
	}
	bypass := strings.Split(override, ";")
	if !strings.Contains(server, "=") {
		if !strings.Contains(server, "://") {
			server = "http://" + server
		}
		return Proxy{URL: server, Bypass: bypass}
	}
	by := map[string]string{}
	for _, part := range strings.Split(server, ";") {
		if k, v, ok := strings.Cut(part, "="); ok {
			by[strings.ToLower(strings.TrimSpace(k))] = strings.TrimSpace(v)
		}
	}
	for _, p := range []struct{ key, scheme string }{{"https", "http"}, {"http", "http"}, {"socks", "socks5"}} {
		if v := by[p.key]; v != "" {
			if !strings.Contains(v, "://") {
				v = p.scheme + "://" + v
			}
			return Proxy{URL: v, Bypass: bypass}
		}
	}
	return Proxy{}
}
