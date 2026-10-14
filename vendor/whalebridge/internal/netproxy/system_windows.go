package netproxy

import "golang.org/x/sys/windows/registry"

// system reads Internet Options' manual proxy (what most proxy clients set).
func system() Proxy {
	k, err := registry.OpenKey(registry.CURRENT_USER, `Software\Microsoft\Windows\CurrentVersion\Internet Settings`, registry.QUERY_VALUE)
	if err != nil {
		return Proxy{}
	}
	defer k.Close()
	if on, _, err := k.GetIntegerValue("ProxyEnable"); err != nil || on == 0 {
		return Proxy{}
	}
	server, _, err := k.GetStringValue("ProxyServer")
	if err != nil {
		return Proxy{}
	}
	override, _, _ := k.GetStringValue("ProxyOverride")
	return parseWindows(server, override)
}
