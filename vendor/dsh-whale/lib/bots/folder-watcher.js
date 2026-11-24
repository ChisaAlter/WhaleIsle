/**
 * Local folder change watcher for event-driven Bot Automations.
 *
 * Uses Node `fs.watch` with per-(automation, path) debouncing (default 1500ms)
 * and ignores `.git` and `node_modules` segments by default.
 */
import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_FOLDER_DEBOUNCE_MS = 1500;
export const DEFAULT_SELF_WRITE_SUPPRESS_MS = 2000;
export const DEFAULT_IGNORED_SEGMENTS = Object.freeze(['.git', 'node_modules']);

/**
 * Determine whether a watched relative path should be ignored.
 * @param {string | Buffer | null | undefined} filename
 * @param {string[]} [extraIgnore]
 */
export function shouldIgnoreWatchedPath(filename, extraIgnore = []) {
  if (!filename) return false;
  const raw = Buffer.isBuffer(filename) ? filename.toString('utf8') : String(filename);
  const segments = raw.replace(/\\/gu, '/').split('/').filter(Boolean);
  if (segments.length === 0) return false;
  const ignoreSet = new Set(DEFAULT_IGNORED_SEGMENTS);
  for (const item of extraIgnore ?? []) {
    const clean = String(item ?? '').trim();
    if (clean) ignoreSet.add(clean);
  }
  return segments.some((seg) => ignoreSet.has(seg));
}

/** @param {string} p */
function normalizeWatchKey(p) {
  const resolved = path.resolve(p);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

/** @param {any[]} automations */
function collectFolderSubscriptions(automations) {
  /** @type {Map<string, { watchPath: string, subscribers: Array<{ automationId: string, botId: string, ignore: string[] }> }>} */
  const desired = new Map();
  for (const auto of automations ?? []) {
    if (!auto || auto.enabled === false || !Array.isArray(auto.triggers)) continue;
    for (const trigger of auto.triggers) {
      if (!trigger || trigger.kind !== 'folder') continue;
      const rawPath = String(trigger.path ?? trigger.dir ?? '').trim();
      if (!rawPath) continue;
      const watchPath = path.resolve(rawPath);
      const key = normalizeWatchKey(watchPath);
      const entry = desired.get(key) ?? { watchPath, subscribers: [] };
      const already = entry.subscribers.some((s) => s.automationId === auto.id);
      if (!already) {
        entry.subscribers.push({
          automationId: auto.id,
          botId: auto.botId,
          ignore: Array.isArray(trigger.ignore) ? trigger.ignore : [],
        });
      }
      desired.set(key, entry);
    }
  }
  return desired;
}

/**
 * Create a debounced local folder watcher synchronized with active automations.
 * @param {{
 *   onChange: (event: {
 *     automationId: string,
 *     botId: string,
 *     watchPath: string,
 *     changedPaths: string[],
 *     eventTypes: string[],
 *     detectedAt: number,
 *   }) => any,
 *   debounceMs?: number,
 *   selfWriteSuppressMs?: number,
 *   watchFactory?: typeof fs.watch,
 *   onError?: (error: unknown, context?: Record<string, any>) => void,
 * }} options
 */
export function createFolderWatcher(options) {
  const onChange = options?.onChange;
  if (typeof onChange !== 'function') {
    throw new Error('createFolderWatcher requires an onChange callback');
  }
  const debounceMs = Math.max(0, typeof options?.debounceMs === 'number' && Number.isFinite(options.debounceMs) ? options.debounceMs : DEFAULT_FOLDER_DEBOUNCE_MS);
  const selfWriteSuppressMs = Math.max(
    0,
    typeof options?.selfWriteSuppressMs === 'number' && Number.isFinite(options.selfWriteSuppressMs)
      ? options.selfWriteSuppressMs
      : DEFAULT_SELF_WRITE_SUPPRESS_MS,
  );
  const watchFactory = typeof options?.watchFactory === 'function' ? options.watchFactory : fs.watch;
  /** @type {(error: unknown, context?: Record<string, any>) => void} */
  const reportError = typeof options?.onError === 'function'
    ? options.onError
    : (err, ctx) => { console.error('[dsh-bots:folder-watcher]', ctx?.watchPath ?? '', err); };

  /** @type {Map<string, { watchPath: string, watcher: fs.FSWatcher, subscribers: Array<{ automationId: string, botId: string, ignore: string[] }> }>} */
  const active = new Map();
  /** @type {Map<string, { timer: any, automationId: string, botId: string, watchPath: string, paths: Set<string>, eventTypes: Set<string> }>} */
  const pending = new Map();
  /** @type {Map<string, number>} */
  const subSuppressUntil = new Map();
  /** @type {Map<string, number>} */
  const pathSuppressUntil = new Map();
  let closed = false;

  /** @param {string} targetPath @param {number} [durationMs] */
  function suppressSelfWrite(targetPath, durationMs = selfWriteSuppressMs) {
    const clean = String(targetPath ?? '').trim();
    if (!clean) return;
    const ms = Math.max(0, Number(durationMs) || 0);
    if (ms <= 0) return;
    pathSuppressUntil.set(normalizeWatchKey(clean), Date.now() + ms);
  }

  /** @param {string} watchPath @param {string} relName @param {number} now */
  function isPathSuppressed(watchPath, relName, now) {
    const dirKey = normalizeWatchKey(watchPath);
    const dirUntil = pathSuppressUntil.get(dirKey);
    if (dirUntil !== undefined) {
      if (dirUntil > now) return true;
      pathSuppressUntil.delete(dirKey);
    }
    if (relName) {
      const fullKey = normalizeWatchKey(path.join(watchPath, relName));
      const fileUntil = pathSuppressUntil.get(fullKey);
      if (fileUntil !== undefined) {
        if (fileUntil > now) return true;
        pathSuppressUntil.delete(fullKey);
      }
    }
    return false;
  }

  /** @param {string} pendingKey */
  function flushPending(pendingKey) {
    const bucket = pending.get(pendingKey);
    if (!bucket) return;
    pending.delete(pendingKey);
    if (closed) return;
    const payload = {
      automationId: bucket.automationId,
      botId: bucket.botId,
      watchPath: bucket.watchPath,
      changedPaths: [...bucket.paths],
      eventTypes: [...bucket.eventTypes],
      detectedAt: Date.now(),
    };
    if (selfWriteSuppressMs > 0) {
      subSuppressUntil.set(pendingKey, Number.POSITIVE_INFINITY);
    }
    Promise.resolve()
      .then(() => onChange(payload))
      .then(undefined, (err) => { reportError(err, payload); })
      .finally(() => {
        if (selfWriteSuppressMs > 0 && !closed) {
          subSuppressUntil.set(pendingKey, Date.now() + selfWriteSuppressMs);
        } else {
          subSuppressUntil.delete(pendingKey);
        }
      });
  }

  /** @param {string} watchKey @param {string} eventType @param {string | Buffer | null} filename */
  function handleFsEvent(watchKey, eventType, filename) {
    if (closed) return;
    const entry = active.get(watchKey);
    if (!entry) return;
    const relName = filename ? (Buffer.isBuffer(filename) ? filename.toString('utf8') : String(filename)) : '';
    const now = Date.now();
    if (isPathSuppressed(entry.watchPath, relName, now)) return;

    for (const sub of entry.subscribers) {
      if (relName && shouldIgnoreWatchedPath(relName, sub.ignore)) continue;
      const pendingKey = `${sub.automationId}::${watchKey}`;
      const suppressUntil = subSuppressUntil.get(pendingKey);
      if (suppressUntil !== undefined) {
        if (suppressUntil > now) continue;
        subSuppressUntil.delete(pendingKey);
      }
      let bucket = pending.get(pendingKey);
      if (!bucket) {
        bucket = {
          timer: null,
          automationId: sub.automationId,
          botId: sub.botId,
          watchPath: entry.watchPath,
          paths: new Set(),
          eventTypes: new Set(),
        };
        pending.set(pendingKey, bucket);
      }
      if (relName) bucket.paths.add(relName.replace(/\\/gu, '/'));
      if (eventType) bucket.eventTypes.add(String(eventType));
      if (bucket.timer) clearTimeout(bucket.timer);
      bucket.timer = setTimeout(() => flushPending(pendingKey), debounceMs);
      bucket.timer.unref?.();
    }
  }

  /** @param {string} watchPath @param {string} watchKey */
  function openFsWatcher(watchPath, watchKey) {
    if (!fs.existsSync(watchPath)) {
      reportError(new Error(`Watch path does not exist: ${watchPath}`), { watchPath });
      return null;
    }
    /** @type {(eventType: string, filename: string | Buffer | null) => void} */
    const listener = (eventType, filename) => handleFsEvent(watchKey, eventType, filename);
    let watcher;
    try {
      watcher = watchFactory(watchPath, { recursive: true }, listener);
    } catch (err) {
      if (/** @type {any} */ (err)?.code === 'ERR_FEATURE_UNAVAILABLE_ON_PLATFORM') {
        try {
          watcher = watchFactory(watchPath, {}, listener);
        } catch (fallbackErr) {
          reportError(fallbackErr, { watchPath });
          return null;
        }
      } else {
        reportError(err, { watchPath });
        return null;
      }
    }
    watcher.on?.('error', (err) => {
      reportError(err, { watchPath });
      if (active.get(watchKey)?.watcher === watcher) {
        closeWatcherKey(watchKey);
      } else {
        try { watcher.close?.(); } catch { /* Best-effort close on unattached watcher. */ }
      }
    });
    return watcher;
  }

  /** @param {string} watchKey */
  function closeWatcherKey(watchKey) {
    const entry = active.get(watchKey);
    if (!entry) return;
    active.delete(watchKey);
    try { entry.watcher.close(); } catch (err) { reportError(err, { watchPath: entry.watchPath }); }
    for (const [pkey, bucket] of pending.entries()) {
      if (!pkey.endsWith(`::${watchKey}`)) continue;
      if (bucket.timer) clearTimeout(bucket.timer);
      pending.delete(pkey);
    }
  }

  /** @param {any[]} automations */
  function syncWatches(automations) {
    if (closed) return listWatches();
    const desired = collectFolderSubscriptions(automations);
    for (const key of [...active.keys()]) {
      if (!desired.has(key)) closeWatcherKey(key);
    }
    for (const [key, spec] of desired.entries()) {
      const existing = active.get(key);
      if (existing) {
        existing.subscribers = spec.subscribers;
        continue;
      }
      const watcher = openFsWatcher(spec.watchPath, key);
      if (watcher) {
        active.set(key, { watchPath: spec.watchPath, watcher, subscribers: spec.subscribers });
      }
    }
    return listWatches();
  }

  function listWatches() {
    return [...active.values()].map((entry) => ({
      watchPath: entry.watchPath,
      automationIds: entry.subscribers.map((s) => s.automationId),
    }));
  }

  function close() {
    closed = true;
    for (const bucket of pending.values()) {
      if (bucket.timer) clearTimeout(bucket.timer);
    }
    pending.clear();
    subSuppressUntil.clear();
    pathSuppressUntil.clear();
    for (const key of [...active.keys()]) {
      closeWatcherKey(key);
    }
  }

  return {
    syncWatches,
    listWatches,
    suppressSelfWrite,
    close,
  };
}
