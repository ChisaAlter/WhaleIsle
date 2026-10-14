package netproxy

import (
	"net"
	"strings"
)

// parseScutil reads `scutil --proxy`. HTTPS wins over HTTP over SOCKS.
func parseScutil(out string) Proxy {
	kv := map[string]string{}
	var bypass []string
	inList := false
	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimSpace(line)
		if inList {
			if line == "}" {
				inList = false
			} else if _, v, ok := strings.Cut(line, " : "); ok {
				bypass = append(bypass, v)
			}
			continue
		}
		k, v, ok := strings.Cut(line, " : ")
		if !ok {
			continue
		}
		if k == "ExceptionsList" {
			inList = true
			continue
		}
		kv[k] = v
	}
	for _, p := range []struct{ key, scheme string }{{"HTTPS", "http"}, {"HTTP", "http"}, {"SOCKS", "socks5"}} {
		if kv[p.key+"Enable"] == "1" && kv[p.key+"Proxy"] != "" {
			host := kv[p.key+"Proxy"]
			if port := kv[p.key+"Port"]; port != "" {
				host = net.JoinHostPort(host, port)
			}
			return Proxy{URL: p.scheme + "://" + host, Bypass: bypass}
		}
	}
	return Proxy{}
}
