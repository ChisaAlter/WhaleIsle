package provider

import (
	"context"
	"runtime"

	"github.com/yetone/magpie/internal/plugin"
)

func init() {
	plugin.PrepareNativeAuth = func(ctx context.Context, id, account string) error {
		if runtime.GOOS != "windows" || id != "cursor" {
			return nil
		}
		for key, auth := range plugin.Auths(id) {
			if account != "" && key != account || auth["refresh"] != "cursor-agent" {
				continue
			}
			// This marker borrows the CLI's current identity. The community
			// plugin's Windows finder only knows .exe; the native finder also
			// reaches the official .cmd shim and lets status renew its token.
			_, err := cursorTokenContext(ctx)
			return err
		}
		return nil
	}
}
