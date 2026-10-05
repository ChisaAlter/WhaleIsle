//go:build !darwin && !windows

package netproxy

// system: elsewhere the desktop's proxy reaches apps as *_PROXY variables.
func system() Proxy { return Proxy{} }
