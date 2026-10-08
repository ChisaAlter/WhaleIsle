package provider

import (
	"context"
	"log"
	"maps"
	"time"
)

// whaleBridgeOwnAccounts keeps automatic maintenance within credentials
// issued or imported into this component. Explicit Move/Adopt remain the
// user's choice, including when they choose to take a native login.
func whaleBridgeOwnAccounts(id string, accounts []Moving) bool {
	for _, a := range accounts {
		if WhaleBridgeBorrowing(id, a.User) {
			return false
		}
	}
	return true
}

// WhaleBridgeHandOver adopts an installed provider plugin and transfers
// component-owned accounts. A native client's borrowed login stays in place.
func WhaleBridgeHandOver(ctx context.Context) map[string]error {
	return handOver(ctx, true, whaleBridgeOwnAccounts)
}

func KeepWhaleBridgeRetiringMoved(ctx context.Context) {
	t := time.NewTimer(20 * time.Second)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
		keepMovedCurrent(ctx)
		moves := moveRetiring(ctx, whaleBridgeOwnAccounts)
		maps.Copy(moves, WhaleBridgeHandOver(ctx))
		for id, err := range moves {
			if err != nil {
				log.Printf("moving %s to its plugin: %s (it stays built-in)", id, err)
			} else {
				log.Printf("moved %s to its plugin, %s", id, MovePackage(id))
			}
		}
		t.Reset(time.Hour)
	}
}
