/**
 * dsh-platform-session — desktop-owned Host plugin mirroring upstream
 * desktop-host's installPlatformSessionPublisher, published over a
 * Bearer-gated loopback route instead of the desktop-host process channel
 * (our web profile's `dsh web` child has no process IPC).
 *
 * The route reads `deepseekAccount.getPlatformSession()` live: absent
 * account, absent method (non-platform credential plugin), or signed-out
 * returns {session:null}. The Electron side refetches on open and on every
 * account-state transition, so no push channel is needed.
 */

import { internalSecret } from '../../dsh-shared/lib/internal-secret.mjs';
import { PLATFORM_PREFIX, createPlatformHandler } from './http.js';

export const name = 'dsh-platform-session';
/** @type {string[]} */
export const inject = [];

/** @param {import('@deepseek-ai/cordis').Context} ctx */
export function apply(ctx) {
  const token = internalSecret('DSHD_PLATFORM_TOKEN');
  let routeRegistered = false;
  const install = () => {
    const webServer = ctx.get('webServer');
    if (!webServer || typeof webServer.register !== 'function') return false;
    const read = async () => {
      const account = ctx.get('deepseekAccount');
      if (!account || typeof account.getPlatformSession !== 'function') return null;
      return account.getPlatformSession();
    };
    webServer.register({
      kind: 'prefix',
      path: PLATFORM_PREFIX,
      handler: createPlatformHandler({ token, read }),
    });
    routeRegistered = true;
    return true;
  };
  if (!install()) {
    ctx.on('internal/service', () => { if (!routeRegistered) install(); });
  }
}
