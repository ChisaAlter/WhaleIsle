package plugin

import "context"

// PrepareNativeAuth, when set, refreshes a provider's explicitly borrowed
// native-client identity before the plugin reads it. Browser and API-key
// sign-ins have no native-client dependency.
var PrepareNativeAuth func(ctx context.Context, provider, account string) error

func prepareNativeAuth(ctx context.Context, provider, account string) error {
	if PrepareNativeAuth != nil {
		return PrepareNativeAuth(ctx, provider, account)
	}
	return nil
}
