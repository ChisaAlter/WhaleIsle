'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { tryGetDesktopDshHome } = require('../shared/dsh-home');

/** Registry file `dsh-workspace` persists under `$DSH_HOME/storages/`. */
const WORKSPACE_REGISTRY_FILE = 'workspace.json';
/** Re-arm interval while the storages directory does not exist yet. */
const WATCH_RETRY_MS = 2_000;
/** Collapse the write+rename burst of one registry save into one signal. */
const WATCH_DEBOUNCE_MS = 200;

function defaultStoragesDir() {
  const home = tryGetDesktopDshHome();
  return home ? path.join(home, 'storages') : null;
}

/**
 * Watch the harness workspace registry (`$DSH_HOME/storages/workspace.json`)
 * and fire `onChange` (debounced) whenever it is created or rewritten.
 *
 * Why: the harness registers a newly opened workspace asynchronously, so the
 * titlebar's first `shell:git-status` read can race that write, lose the
 * authorization check, and stay "unavailable" until the next window focus.
 * This watcher closes that gap by telling the renderer when the trust roots
 * actually changed. The watch targets the storages directory (not the file):
 * the file may not exist yet, and registry saves that go through a temp-file
 * rename would drop an inode-bound file watch.
 *
 * @param {() => void} onChange - fired after each debounced registry change.
 * @param {{
 *   storagesDir?: string | null,
 *   retryMs?: number,
 *   debounceMs?: number,
 * }} [options] - test seams; production callers pass none.
 * @returns {() => void} stop watching.
 */
function watchWorkspaceRegistrations(onChange, options = {}) {
  const storagesDir = options.storagesDir !== undefined ? options.storagesDir : defaultStoragesDir();
  const retryMs = options.retryMs ?? WATCH_RETRY_MS;
  const debounceMs = options.debounceMs ?? WATCH_DEBOUNCE_MS;
  let watcher = null;
  let retryTimer = null;
  let debounceTimer = null;
  let pollTimer = null;
  let closed = false;
  let deliveredStamp = null;

  const registryStamp = () => {
    try {
      const stat = fs.statSync(path.join(storagesDir, WORKSPACE_REGISTRY_FILE), { bigint: true });
      return stat.isFile() ? `${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}` : null;
    } catch {
      return null;
    }
  };

  const fire = () => {
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      if (closed) return;
      const stamp = registryStamp();
      if (stamp === deliveredStamp) return;
      deliveredStamp = stamp;
      onChange();
    }, debounceMs);
    if (typeof debounceTimer.unref === 'function') debounceTimer.unref();
  };

  const scheduleRetry = () => {
    if (closed || retryTimer !== null) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      arm();
    }, retryMs);
    if (typeof retryTimer.unref === 'function') retryTimer.unref();
  };

  function arm() {
    if (closed || watcher !== null || storagesDir === null) return;
    try {
      watcher = fs.watch(storagesDir, (_eventType, filename) => {
        // Platforms may omit the filename; treat those events as potential
        // registry writes rather than dropping them.
        if (filename && filename !== WORKSPACE_REGISTRY_FILE) return;
        fire();
      });
    } catch {
      // Fresh dsh-home: storages/ is created by the harness later. Keep
      // retrying so the first registration of this run still signals.
      scheduleRetry();
      return;
    }
    // A registry write can land inside the unwatched retry gap (storages/
    // created and workspace.json written between two arm attempts). If the
    // file already exists when the watch comes up, signal once: a spurious
    // refresh is a cheap status re-read, a missed registration is the flake.
    try {
      if (fs.statSync(path.join(storagesDir, WORKSPACE_REGISTRY_FILE)).isFile()) fire();
    } catch {
      // No registry yet; the watch reports its creation.
    }
    watcher.on('error', () => {
      // Watch handle died (directory removed, EPERM); drop it and re-arm.
      try {
        watcher.close();
      } catch {
        // close() on a broken handle: nothing left to release.
      }
      watcher = null;
      scheduleRetry();
    });
  }

  arm();
  if (storagesDir !== null) {
    // Native watchers can miss writes during FSEvents startup or directory replacement.
    // Reconcile one file's metadata; share the debounce/stamp with native events.
    pollTimer = setInterval(() => {
      if (!closed && debounceTimer === null && registryStamp() !== deliveredStamp) fire();
    }, retryMs);
    pollTimer.unref();
  }

  return () => {
    closed = true;
    if (pollTimer !== null) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    if (watcher !== null) {
      try {
        watcher.close();
      } catch {
        // close() on a broken handle: nothing left to release.
      }
      watcher = null;
    }
    if (retryTimer !== null) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
  };
}

module.exports = {
  WORKSPACE_REGISTRY_FILE,
  watchWorkspaceRegistrations,
};
