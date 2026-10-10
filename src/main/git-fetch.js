const path = require('node:path');
const { runGit, FETCH_TIMEOUT_MS } = require('./git-exec');
const { resolveCurrentUpstream, resolvePrimaryRemoteName } = require('./git-remotes');

/** Status-fetch TTL: success is reused briefly; failures back off. */
const FETCH_OK_TTL_MS = 15_000;
/** First failure cooldown for status-fetch. */
const FETCH_FAIL_BASE_MS = 30_000;
/** Ceiling for status-fetch failure cooldown. */
const FETCH_FAIL_MAX_MS = 15 * 60_000;
const fetchCooldownByRoot = new Map();
const fetchInFlightByRoot = new Map();

function resetFetchCooldowns() {
  fetchCooldownByRoot.clear();
}

/**
 * Background `git fetch --quiet --no-tags`. A failure must not hide local status.
 * @param {string} cwd
 * @returns {Promise<{ fetched: boolean, ok: boolean }>} whether a real fetch ran.
 */
async function fetchCooldownKey(cwd, remote, readRun = runGit) {
  const common = await readRun(cwd, ['rev-parse', '--git-common-dir']);
  const dir = common.code === 0 && common.stdout.trim()
    ? path.resolve(cwd, common.stdout.trim())
    : cwd;
  return `${dir}\u0000${remote}`;
}

/**
 * @param {string} cwd
 * @param {(cwd: string, args: string[], limits?: object) => Promise<object>} [readRun]
 *   read seam of the enclosing refresh; concurrent refreshes share only the
 *   fetch for the same common git directory and remote.
 */
async function fetchForStatus(cwd, readRun = runGit) {
  // Fetch the tracking remote, else the primary remote.
  const upstream = await resolveCurrentUpstream(cwd, readRun);
  const remote = upstream?.remoteName || await resolvePrimaryRemoteName(cwd, readRun);
  if (!remote) return { fetched: false, ok: false };
  const key = await fetchCooldownKey(cwd, remote, readRun);
  const inFlight = fetchInFlightByRoot.get(key);
  if (inFlight) return inFlight;
  const now = Date.now();
  const previous = fetchCooldownByRoot.get(key);
  if (previous && now - previous.at < previous.delayMs) return { fetched: false, ok: false };
  const pending = (async () => {
    const fetched = await runGit(cwd, ['fetch', '--quiet', '--no-tags', remote], { timeoutMs: FETCH_TIMEOUT_MS });
    if (fetched.code === 0) {
      fetchCooldownByRoot.set(key, { at: now, fails: 0, delayMs: FETCH_OK_TTL_MS });
      return { fetched: true, ok: true };
    }
    const fails = (previous?.fails || 0) + 1;
    fetchCooldownByRoot.set(key, {
      at: now,
      fails,
      delayMs: Math.min(FETCH_FAIL_MAX_MS, FETCH_FAIL_BASE_MS * (2 ** (fails - 1))),
    });
    return { fetched: true, ok: false };
  })();
  fetchInFlightByRoot.set(key, pending);
  try {
    // Every waiter must refresh its remote-derived status after this fetch.
    return await pending;
  } finally {
    fetchInFlightByRoot.delete(key);
  }
}

module.exports = {
  resetFetchCooldowns,
  fetchForStatus,
};
