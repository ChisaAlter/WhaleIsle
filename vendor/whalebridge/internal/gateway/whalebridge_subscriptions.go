package gateway

import (
	"context"

	"github.com/yetone/magpie/internal/plugin"
	"github.com/yetone/magpie/internal/provider"
)

// StartWhaleBridgeSubscriptions runs the gateway's subscription maintenance.
// User-selected warmups, resets and check-ins use this component's settings;
// native client account switching and client integrations are not started.
func StartWhaleBridgeSubscriptions(ctx context.Context) {
	go provider.KeepLoginsAlive(ctx)
	go provider.KeepCodexWindowsWarm(ctx)
	go provider.KeepClaudeWindowsWarm(ctx, warmClaude)
	go provider.KeepResetsFromRunningOut(ctx)
	go provider.KeepWorkBuddyCheckedIn(ctx)
	go provider.KeepTraeCheckedIn(ctx)
	go provider.KeepMiniMaxCheckedIn(ctx)
	go provider.KeepQoderCheckedIn(ctx)
	go provider.KeepPluginsCheckedIn(ctx)
	go plugin.KeepUpdated(ctx)
	go plugin.KeepBunUpdated(ctx)
}
