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
let depsOverride = null;

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

function register(ctx) {
  ctx.handle('shell:install-delta', ctx.LAUNCHER_ONLY, async (event, tag) => {
    const progress = (payload) => ctx.send(event, 'shell:update-progress', { delta: true, ...payload });
    try {
      const result = await ctx.launcher.installDelta(tag, progress);
      lastDeltaError = result && result.ok === false
        ? (result.error || result.message || 'delta-failed')
        : '';
      return result;
    } catch (error) {
      lastDeltaError = error?.message || String(error);
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
