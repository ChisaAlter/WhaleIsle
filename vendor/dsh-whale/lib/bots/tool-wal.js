/**
 * High-side-effect Tool Write-Ahead Log (WAL) coordinator.
 *
 * Wraps `workStore`'s `tool_wal` primitives so external / destructive / code tools:
 * 1. Persist an `intent` record before executing side effects.
 * 2. Resolve the entry to `committed` or `failed` once execution settles.
 * 3. Mark crash-orphaned `intent` rows as `unknown` on startup recovery and
 *    NEVER automatically replay an `unknown` or in-flight `intent` operation.
 */
import crypto from 'node:crypto';

/**
 * @param {unknown} value
 * @returns {any}
 */
function canonicalize(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  /** @type {Record<string, any>} */
  const src = /** @type {Record<string, any>} */ (value);
  /** @type {Record<string, any>} */
  const out = {};
  for (const key of Object.keys(src).sort()) {
    const v = src[key];
    if (v !== undefined) out[key] = canonicalize(v);
  }
  return out;
}

/**
 * Compute a stable SHA-256 digest of tool arguments for WAL auditing.
 * @param {unknown} args
 */
export function computeArgsDigest(args) {
  const payload = JSON.stringify(canonicalize(args ?? {}));
  return crypto.createHash('sha256').update(payload).digest('hex');
}

/** @param {unknown} summary */
function formatSummary(summary) {
  if (summary === null || summary === undefined) return null;
  const text = typeof summary === 'string' ? summary : JSON.stringify(summary);
  return text.slice(0, 1000);
}

/**
 * Create a WAL coordinator bound to `workStore`.
 * @param {{ workStore: any, now?: () => number }} deps
 */
export function createToolWalManager({ workStore, now = () => Date.now() }) {
  if (!workStore) throw new Error('createToolWalManager requires workStore');

  /**
   * Append a tool intent before executing a high-side-effect action.
   * @param {{
   *   botId: string,
   *   sessionId: string,
   *   toolName: string,
   *   action: string,
   *   effect: string,
   *   args?: any,
   *   argsDigest?: string,
   *   idempotencyKey?: string | null,
   *   walId?: string,
   * }} spec
   */
  function beginIntent(spec) {
    const argsDigest = spec.argsDigest || computeArgsDigest(spec.args);
    return workStore.appendToolWalIntent({
      walId: spec.walId,
      botId: spec.botId,
      sessionId: spec.sessionId,
      toolName: spec.toolName,
      action: spec.action,
      effect: spec.effect,
      idempotencyKey: spec.idempotencyKey ?? null,
      argsDigest,
    }, now());
  }

  /** @param {string} walId @param {unknown} [resultSummary] */
  function commit(walId, resultSummary = null) {
    return workStore.resolveToolWal(walId, {
      status: 'committed',
      resultSummary: formatSummary(resultSummary),
    }, now());
  }

  /** @param {string} walId @param {unknown} [errorOrSummary] */
  function fail(walId, errorOrSummary = null) {
    const msg = errorOrSummary instanceof Error
      ? errorOrSummary.message
      : errorOrSummary;
    return workStore.resolveToolWal(walId, {
      status: 'failed',
      resultSummary: formatSummary(msg),
    }, now());
  }

  /** @param {string} walId @param {unknown} [reason] */
  function markUnknown(walId, reason = 'outcome_unknown') {
    return workStore.resolveToolWal(walId, {
      status: 'unknown',
      resultSummary: formatSummary(reason),
    }, now());
  }

  /** Mark any crash-orphaned `intent` WAL entries as `unknown` (never replayed). */
  function recoverStaleIntents(at = now()) {
    return workStore.markStaleToolWalUnknown(at);
  }

  /**
   * Execute an asynchronous side-effect operation guarded by WAL intent/resolution.
   * - If `idempotencyKey` matches a `committed` entry: returns `{ status: 'committed', deduplicated: true }` without re-running `fn`.
   * - If `idempotencyKey` matches an `unknown` or `intent` entry: returns `{ status: 'UNKNOWN', replayBlocked: true }` without re-running `fn`.
   * - If `idempotencyKey` matches a `failed` entry: returns `{ status: 'failed', replayBlocked: true }` so callers mint a fresh key before retrying.
   * @template T
   * @param {{
   *   botId: string,
   *   sessionId: string,
   *   toolName: string,
   *   action: string,
   *   effect: string,
   *   args?: any,
   *   idempotencyKey?: string | null,
   *   summarizeResult?: (result: T) => unknown,
   * }} spec
   * @param {(entry: any) => Promise<T>} fn
   */
  async function executeWithWal(spec, fn) {
    const started = beginIntent(spec);
    const { entry, deduplicated } = started;
    if (deduplicated) {
      if (entry.status === 'committed') {
        return {
          ok: true,
          deduplicated: true,
          replayBlocked: false,
          status: 'committed',
          walId: entry.walId,
          entry,
          result: null,
        };
      }
      if (entry.status === 'unknown' || entry.status === 'intent') {
        return {
          ok: false,
          deduplicated: true,
          replayBlocked: true,
          status: 'UNKNOWN',
          walId: entry.walId,
          entry,
          error: 'Previous side-effect execution outcome is UNKNOWN after interruption; automatic replay is forbidden.',
        };
      }
      return {
        ok: false,
        deduplicated: true,
        replayBlocked: true,
        status: 'failed',
        walId: entry.walId,
        entry,
        error: 'Previous execution with this idempotencyKey failed; provide a new idempotencyKey to retry.',
      };
    }

    try {
      const result = await fn(entry);
      const summary = typeof spec.summarizeResult === 'function' ? spec.summarizeResult(result) : result;
      const committed = commit(entry.walId, summary);
      return {
        ok: true,
        deduplicated: false,
        replayBlocked: false,
        status: 'committed',
        walId: entry.walId,
        entry: committed,
        result,
      };
    } catch (error) {
      const failed = fail(entry.walId, error);
      return {
        ok: false,
        deduplicated: false,
        replayBlocked: false,
        status: 'failed',
        walId: entry.walId,
        entry: failed,
        error: String(/** @type {any} */ (error)?.message ?? error),
      };
    }
  }

  return {
    beginIntent,
    commit,
    fail,
    markUnknown,
    recoverStaleIntents,
    executeWithWal,
    /** @param {string} walId */
    get: (walId) => workStore.getToolWal(walId),
    /** @param {string} botId @param {string} key */
    getByIdempotencyKey: (botId, key) => workStore.getToolWalByIdempotencyKey(botId, key),
    /** @param {Record<string, any>} [filters] */
    list: (filters) => workStore.listToolWal(filters),
  };
}
