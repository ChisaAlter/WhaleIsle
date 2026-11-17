'use strict';

// shell:install-delta delegates to the launcher's guarded install service.
// An explicitly selected delta never changes into a full download.
// contributeStatus surfaces locally cached delta artifacts —
// sync and cheap, never a network call.
const fs = require('fs');
const path = require('path');
const deltaManifest = require('../launcher/delta/manifest');

let lastDeltaError = '';
// Test seam: register()/contributeStatus() signatures are frozen, so hermetic
// The cached-artifact directory can be isolated without changing the IPC edge.
/** @type {{ deltaDir?: string } | null} */
let depsOverride = null;

/** @param {{ deltaDir?: string } | null | undefined} deps */
function setDeltaDeps(deps) {
  depsOverride = deps || null;
  lastDeltaError = '';
}

function deltaDir() {
  if (depsOverride && typeof depsOverride.deltaDir === 'string') {
    return depsOverride.deltaDir;
  }
  if (process.env.DSHD_DELTA_DIR) {
    return process.env.DSHD_DELTA_DIR;
  }
  try {
    const { app } = require('electron');
    return path.join(app.getPath('userData'), 'deltas');
  } catch {
    return '';
  }
}

/**
 * @param {{ handle: (channel: string, listener: (event: unknown, ...args: unknown[]) => unknown) => void,
 *           send: (event: unknown, channel: string, payload: unknown) => void,
 *           launcher: { installDelta: (tag: string, onProgress: (payload: unknown) => void) =>
 *             Promise<{ ok?: boolean, error?: string, message?: string }> } }} ctx
 */
function register(ctx) {
  ctx.handle('shell:install-delta', async (event, tag) => {
    const progress = (/** @type {unknown} */ payload) => ctx.send(event, 'shell:update-progress', { delta: true, .../** @type {Record<string, unknown>} */ (payload) });
    try {
      const result = await ctx.launcher.installDelta(/** @type {string} */ (tag), progress);
      lastDeltaError = result && result.ok === false
        ? (result.error || result.message || 'delta-failed')
        : '';
      return result;
    } catch (error) {
      lastDeltaError = String(/** @type {{ message?: unknown } | null | undefined} */ (error)?.message || error);
      return { ok: false, mode: 'delta', error: lastDeltaError };
    }
  });
}

function contributeStatus() {
  const available = [];
  const dir = deltaDir();
  if (dir) {
    try {
      for (const name of fs.readdirSync(dir)) {
        const parsed = deltaManifest.parseDeltaAssetName(name);
        if (!parsed) {
          continue;
        }
        const file = path.join(dir, name);
        const size = fs.statSync(file).size;
        let tag = parsed.to;
        try {
          const sidecar = JSON.parse(fs.readFileSync(`${file}.json`, 'utf8'));
          if (typeof sidecar.tag === 'string' && sidecar.tag) {
            tag = sidecar.tag;
          }
        } catch { /* filename versions still carry from/to */ }
        available.push({ tag, from: parsed.from, size });
      }
    } catch { /* cache dir unreadable → empty list */ }
  }
  if (!available.length && !lastDeltaError) {
    return null;
  }
  return {
    deltas: {
      available,
      ...(lastDeltaError ? { lastError: lastDeltaError } : {}),
    },
  };
}

module.exports = { register, contributeStatus, setDeltaDeps };
