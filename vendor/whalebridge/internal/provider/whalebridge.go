package provider

import "github.com/yetone/magpie/internal/plugin"

// Subscription choices are provider/authentication backends, not client
// configuration adapters. Their credentials are still served to DSH.
type WhaleBridgeSubscription struct {
	ID      string          `json:"id"`
	PID     string          `json:"pid,omitempty"`
	Name    string          `json:"name"`
	Plugin  bool            `json:"plugin"`
	Checkin bool            `json:"checkin,omitempty"`
	Methods []plugin.Method `json:"methods,omitempty"`
	Package string          `json:"package,omitempty"`
}

func WhaleBridgeSubscriptions() []WhaleBridgeSubscription {
	out := []WhaleBridgeSubscription{}
	for _, id := range builtinOrder {
		if Moved(id) {
			continue
		}
		out = append(out, WhaleBridgeSubscription{ID: id, Name: nameOf(id), Package: MovePackage(id)})
	}
	for _, p := range plugin.Cached() {
		out = append(out, WhaleBridgeSubscription{ID: PluginID(p.ID), PID: p.ID, Name: p.Name, Plugin: true, Methods: p.Methods, Checkin: p.Checkin})
	}
	return out
}
