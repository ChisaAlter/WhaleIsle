package gateway

import (
	"sync"
	"testing"

	"github.com/yetone/magpie/internal/provider"
)

func TestWhaleBridgeNativeAlertClaimKeepsHistory(t *testing.T) {
	ClaimWhaleBridgeAlerts()
	before := WhaleBridgeAlerts(0).Sequence
	for range 4 {
		recordWhaleBridgeQuotaAlert(provider.QuotaAlert{Provider: "clinepass", Used: 95})
	}
	var wg sync.WaitGroup
	claims := make(chan WhaleBridgeQuotaNotices, 2)
	for range 2 {
		wg.Add(1)
		go func() { defer wg.Done(); claims <- ClaimWhaleBridgeAlerts() }()
	}
	wg.Wait()
	close(claims)
	seen := map[int64]bool{}
	for claim := range claims {
		if claim.Sequence != before+4 {
			t.Fatalf("cursor = %d", claim.Sequence)
		}
		for _, notice := range claim.Alerts {
			if seen[notice.Sequence] {
				t.Fatalf("notice %d delivered to both hosts", notice.Sequence)
			}
			seen[notice.Sequence] = true
		}
	}
	if len(seen) != 4 {
		t.Fatalf("claimed %d notices", len(seen))
	}
	if again := ClaimWhaleBridgeAlerts(); len(again.Alerts) != 0 {
		t.Fatal("host restart replays native notices")
	}
	if history := WhaleBridgeAlerts(before); len(history.Alerts) != 4 {
		t.Fatal("native claim erased management history")
	}
	recordWhaleBridgeQuotaAlert(provider.QuotaAlert{Provider: "clinepass", Kind: "renews"})
	if next := ClaimWhaleBridgeAlerts(); len(next.Alerts) != 1 || next.Alerts[0].Sequence != before+5 {
		t.Fatal("next reset reminder was not claimable")
	}
}
