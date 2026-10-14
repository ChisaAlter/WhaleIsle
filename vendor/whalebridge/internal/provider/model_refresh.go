package provider

import (
	"context"
	"time"

	"github.com/yetone/magpie/internal/catalog"
)

// StartModelRefresh restores the catalog/bootstrap work the native
// component's HTTP-only entrypoint otherwise skips. Run in a goroutine.
func StartModelRefresh(ctx context.Context) {
	if catalog.Stale() {
		catalog.Refresh(ctx)
	}
	if ctx.Err() != nil {
		return
	}
	FetchNewBehind(20 * time.Second)
	catalog.Maintain(ctx)
}
