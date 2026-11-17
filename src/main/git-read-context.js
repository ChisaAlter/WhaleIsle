'use strict';

/**
 * Short-lived, per-worktree Git read context.
 *
 * One titlebar refresh fires three IPC calls (`shell:git-status`,
 * `shell:git-fetch-status`, `shell:git-read-pr`). Each used to walk the whole
 * `gitStatus()` path again — repository probe, porcelain, remote discovery,
 * default-branch lookup, provider selection, numstat — which multiplies both
 * the child-process count and the working-tree reads.
 *
 * This module memoizes **read-only** git invocations for the duration of one
 * refresh. Only a whitelist of read subcommands is cached: a `fetch`, `add`,
 * `checkout`, `commit`, … must never be answered from memory, and the context
 * is dropped on any write (see `invalidateReadContext`).
 */
/**
 * How long a completed read stays available to the sibling IPC calls of the
 * same refresh. The renderer issues them within a few milliseconds of each
 * other; this is a handoff window, not a cache TTL for the UI.
 */
const READ_CONTEXT_TTL_MS = 2_000;

/**
 * Read subcommands safe to answer from the context. Deliberately a whitelist:
 * an unrecognized or mutating command runs uncached.
 */
const READ_ONLY_COMMANDS = new Set([
  'status',
  'rev-parse',
  'rev-list',
  'remote',
  'config',
  'symbolic-ref',
  'show-ref',
  'for-each-ref',
  'diff',
  'ls-files',
  'cat-file',
  'merge-base',
]);

/**
 * `git config` is read-only only for its getter forms: `git config user.name=v`
 * writes, and `--unset*` / `--replace-all` mutate. Cache the getters only.
 */
function isReadOnlyConfigInvocation(args) {
  return /^--get(?:-all|-regexp)?$/.test(args[1] || '')
    || args[1] === '--list'
    || args[1] === '-l';
}

/** Subcommands of `git remote` that only report state. */
const READ_ONLY_REMOTE_SUBCOMMANDS = new Set(['get-url', 'show']);

/**
 * `git remote` is read-only only when listing or reading: bare `git remote`,
 * `remote -v`, `remote get-url`, `remote show`. `remote add/set-head/set-url/
 * rename/remove/prune/update` all mutate the config or refs and must run
 * uncached — the previous verb-only check treated them as reads, which let a
 * cached "origin/HEAD is missing" answer survive the `remote set-head --auto`
 * that had just created it.
 */
function isReadOnlyRemoteInvocation(args) {
  const operands = args.slice(1).filter((token) => token !== '' && !token.startsWith('-'));
  if (operands.length === 0) return true;
  return READ_ONLY_REMOTE_SUBCOMMANDS.has(operands[0]);
}

/**
 * `git symbolic-ref` reads when given a single ref name and writes when given
 * a target (`symbolic-ref <name> <ref>`) or a deleting flag.
 */
function isReadOnlySymbolicRefInvocation(args) {
  if (args.some((token) => token === '--delete' || token === '-d')) return false;
  const operands = [];
  for (let index = 1; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith('-')) {
      operands.push(token);
      continue;
    }
    // `-m <reason>` consumes the following token.
    if (token === '-m' || token === '--message') index += 1;
  }
  return operands.length === 1;
}

/**
 * True when this exact git invocation is a pure read whose answer cannot be
 * changed by anything other than another git command.
 * @param {string[]} args
 */
function isReadOnlyInvocation(args) {
  const verb = args[0];
  if (!verb || !READ_ONLY_COMMANDS.has(verb)) {
    return false;
  }
  if (verb === 'config') {
    return isReadOnlyConfigInvocation(args);
  }
  if (verb === 'remote') {
    return isReadOnlyRemoteInvocation(args);
  }
  if (verb === 'symbolic-ref') {
    return isReadOnlySymbolicRefInvocation(args);
  }
  return true;
}

/**
 * Build the memo that answers repeated read invocations for one worktree.
 * `runGitImpl` is injected (by `git-exec`) so this module never re-enters the
 * memoized `runGit` and never doubles the spawn count.
 * @param {{ runGitImpl: (cwd: string, args: string[], limits?: object) => Promise<object>, now?: () => number }} options
 */
function createGitReadContext({ runGitImpl, now = () => Date.now() }) {
  if (typeof runGitImpl !== 'function') {
    throw new TypeError('createGitReadContext requires runGitImpl');
  }
  /** @type {Map<string, Promise<object>>} */
  const memo = new Map();
  let cwd = null;
  /**
   * A write anywhere in this worktree revokes the context, including contexts
   * an in-flight reader is still holding. Without this flag an operation that
   * captured the context before a concurrent write would keep answering from
   * pre-write memory after `invalidateReadContext` dropped the registry entry.
   */
  let revoked = false;
  /**
   * The status object this refresh already produced. Sibling calls read it
   * instead of walking porcelain a second time just to learn the branch name.
   * @type {object | null}
   */
  let statusResult = null;

  const run = (target, args, limits) => {
    // Streaming / bounded calls (progress lines, custom timeouts) are never
    // shared: their limits are part of the caller's contract.
    if (revoked || limits) {
      return runGitImpl(target, args, limits);
    }
    if (!isReadOnlyInvocation(args)) {
      // A mutating command invalidates every memoized answer *before* it runs
      // and again after it settles: a reader that follows it inside the same
      // refresh (for example `symbolic-ref` right after `remote set-head`)
      // must never be answered from pre-write memory, and a failed or
      // partially applied write must not leave the old answers behind either.
      memo.clear();
      statusResult = null;
      return Promise.resolve(runGitImpl(target, args, limits)).finally(() => {
        memo.clear();
        statusResult = null;
      });
    }
    if (cwd === null) {
      cwd = target;
    } else if (cwd !== target) {
      // A context is per worktree; a different root must not share entries.
      return runGitImpl(target, args, limits);
    }
    const key = args.join('\u0000');
    const hit = memo.get(key);
    if (hit) {
      return hit;
    }
    const pending = runGitImpl(target, args, limits);
    memo.set(key, pending);
    return pending;
  };

  /** Drop cached answers for commands whose result a completed fetch moved. */
  const forget = (predicate) => {
    for (const key of [...memo.keys()]) {
      if (predicate(key.split('\u0000'))) {
        memo.delete(key);
      }
    }
  };

  return {
    run,
    forget,
    revoke: () => {
      revoked = true;
      memo.clear();
      statusResult = null;
    },
    isRevoked: () => revoked,
    setStatus: (value) => {
      statusResult = value;
    },
    getStatus: () => statusResult,
    root: () => cwd,
    stats: () => ({ entries: memo.size, createdAt: now() }),
  };
}

/**
 * A refresh context is keyed by *who* asked (the owning webContents) and *where*
 * (the resolved worktree root), and it carries a hard lifetime cap so a slow
 * fetch cannot strand its siblings on a different context:
 *
 * - `usedAt` implements the short handoff window. Each acquisition slides it,
 *   because `git fetch` may legitimately run for seconds between the status
 *   call and the PR lookup of the same refresh.
 * - `armedAt` bounds the total life. Without it a renderer that keeps issuing
 *   status calls could keep one memo (and its answers) alive indefinitely.
 *
 * A bare worktree path is never a key, so a later refresh by a different window
 * can not be answered from this one's memory.
 * @type {Map<string, { context: object, armedAt: number, usedAt: number }>}
 */
const activeContexts = new Map();

/** Idle window after the last acquisition. */
const READ_CONTEXT_IDLE_MS = READ_CONTEXT_TTL_MS;
/** Absolute lifetime of one refresh context, regardless of activity. */
const READ_CONTEXT_MAX_LIFETIME_MS = 30_000;

function contextKey(owner, root) {
  return `${String(owner ?? 'unknown')}\u0000${root}`;
}

/**
 * Arm a fresh context for one owner + worktree.
 * @param {string | number} owner owning webContents id (or a test label)
 * @param {string} root resolved worktree root
 * @param {{ runGitImpl: Function, now?: () => number }} options
 */
function armReadContext(owner, root, options) {
  const context = createGitReadContext(options);
  if (typeof root === 'string' && root) {
    const now = (options.now || Date.now)();
    activeContexts.set(contextKey(owner, root), { context, armedAt: now, usedAt: now });
  }
  return context;
}

/**
 * The context this owner armed for this worktree, or null. Expired and revoked
 * entries are dropped here rather than by a timer.
 * @param {string | number} owner
 * @param {string} root
 * @param {number} [now]
 */
function acquireReadContext(owner, root, now = Date.now()) {
  const key = contextKey(owner, root);
  const entry = activeContexts.get(key);
  if (!entry) return null;
  const revoked = typeof entry.context.isRevoked === 'function' && entry.context.isRevoked();
  const expired = now - entry.usedAt > READ_CONTEXT_IDLE_MS
    || now - entry.armedAt > READ_CONTEXT_MAX_LIFETIME_MS;
  if (revoked || expired) {
    if (typeof entry.context.revoke === 'function') entry.context.revoke();
    activeContexts.delete(key);
    return null;
  }
  entry.usedAt = now;
  return entry.context;
}

/**
 * Mark a context as still in use after a long read settles.
 *
 * `acquireReadContext` only slides the idle window at the moment work *starts*.
 * A `git fetch` may legitimately run for seconds between the status call and
 * the PR lookup of the same refresh, so without this the sibling lookup would
 * find a mid-refresh context already expired and re-walk the whole status
 * path. Only the same live context is touched: a superseded or revoked entry
 * stays dead.
 * @param {string | number} owner
 * @param {string} root
 * @param {object} context the context the caller was handed
 * @param {number} [now]
 * @returns {boolean} true when the window was extended
 */
function touchReadContext(owner, root, context, now = Date.now()) {
  const key = contextKey(owner, root);
  const entry = activeContexts.get(key);
  if (!entry || entry.context !== context) return false;
  if (typeof context.isRevoked === 'function' && context.isRevoked()) return false;
  // The absolute cap is enforced from `armedAt`, so touching never extends it.
  if (now - entry.armedAt > READ_CONTEXT_MAX_LIFETIME_MS) {
    entry.context.revoke();
    activeContexts.delete(key);
    return false;
  }
  entry.usedAt = now;
  return true;
}

/**
 * Any write (stage/unstage/discard/commit/branch/pull/push/init) drops the
 * worktree's context so the next read cannot answer from pre-write memory.
 */
function invalidateReadContext(root) {
  // A write invalidates every owner's view of this worktree, not just the
  // writer's: a second window holding a context describes the same index and
  // refs, and its answers are stale the moment the write lands.
  const suffix = root ? `\u0000${root}` : null;
  for (const key of [...activeContexts.keys()]) {
    if (suffix && !key.endsWith(suffix)) continue;
    const entry = activeContexts.get(key);
    // Revoke before deleting: a reader that already captured this context must
    // not keep memoized answers from before the write.
    if (entry && typeof entry.context.revoke === 'function') entry.context.revoke();
    activeContexts.delete(key);
  }
}

function resetReadContexts() {
  for (const entry of activeContexts.values()) {
    if (typeof entry.context.revoke === 'function') entry.context.revoke();
  }
  activeContexts.clear();
}

/** Exposed for the process-count gates. */
function readContextSize() {
  return activeContexts.size;
}

module.exports = {
  READ_CONTEXT_TTL_MS,
  READ_CONTEXT_MAX_LIFETIME_MS,
  createGitReadContext,
  armReadContext,
  isReadOnlyInvocation,
  isReadOnlyConfigInvocation,
  isReadOnlyRemoteInvocation,
  isReadOnlySymbolicRefInvocation,
  acquireReadContext,
  touchReadContext,
  invalidateReadContext,
  resetReadContexts,
  readContextSize,
};
