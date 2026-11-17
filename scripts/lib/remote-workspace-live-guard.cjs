'use strict';

const crypto = require('node:crypto');
const net = require('node:net');

const REQUIRED_CONFIG = [
  ['host', 'DSHR_TEST_HOST'],
  ['auth', 'DSHR_TEST_KEY or DSHR_TEST_PASSWORD'],
];

const DEFAULT_TIMEOUTS = Object.freeze({
  requestMs: 15000,
  bodyMs: 15000,
  runMs: 120000,
  cleanupMs: 30000,
  childExitMs: 5000,
});

function parseLiveArgs(argv = []) {
  return {
    requireLive: argv.includes('--require-live'),
  };
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function resolveLiveConfig(env = process.env, argv = []) {
  const host = String(env.DSHR_TEST_HOST || '');
  const key = String(env.DSHR_TEST_KEY || '');
  const password = String(env.DSHR_TEST_PASSWORD || '');
  const missing = [];
  if (!host.trim()) missing.push(REQUIRED_CONFIG[0][1]);
  if (!key.trim() && !password.trim()) missing.push(REQUIRED_CONFIG[1][1]);

  return {
    ...parseLiveArgs(argv),
    host,
    user: String(env.DSHR_TEST_USER || 'root'),
    port: Number(env.DSHR_TEST_PORT) || 22,
    key,
    password,
    // lsPath is intentionally independent from fixture ownership: callers may
    // point the read-only listing check at any existing remote directory.
    lsPath: String(env.DSHR_TEST_LS_PATH || '/root'),
    // Writes are always confined to the run-owned fixture. A caller may
    // override the mirror target only inside that root; the empty default
    // selects the fixture's own created directory. This must NOT inherit
    // lsPath: the listing check is read-only and may point anywhere, while a
    // mirror target must be a writable path the run itself creates.
    mirrorPath: String(env.DSHR_TEST_MIRROR_PATH || ''),
    missing,
    timeouts: {
      requestMs: positiveNumber(env.DSHR_TEST_REQUEST_TIMEOUT_MS, DEFAULT_TIMEOUTS.requestMs),
      bodyMs: positiveNumber(env.DSHR_TEST_BODY_TIMEOUT_MS, DEFAULT_TIMEOUTS.bodyMs),
      runMs: positiveNumber(env.DSHR_TEST_RUN_TIMEOUT_MS, DEFAULT_TIMEOUTS.runMs),
      cleanupMs: positiveNumber(env.DSHR_TEST_CLEANUP_TIMEOUT_MS, DEFAULT_TIMEOUTS.cleanupMs),
      childExitMs: positiveNumber(env.DSHR_TEST_CHILD_EXIT_TIMEOUT_MS, DEFAULT_TIMEOUTS.childExitMs),
    },
  };
}

function notRunMessage(config) {
  const missing = config.missing.join(', ');
  if (config.requireLive) {
    return `[verify-remote-workspace-live] NOT RUN (not PASS) — --require-live is set but required SSH config is missing: ${missing}.`;
  }
  return `[verify-remote-workspace-live] NOT RUN (not PASS) — skipped because required SSH config is missing: ${missing}; set it or pass --require-live in a required-live gate.`;
}

function requireReadySession(probeResult) {
  if (!probeResult || probeResult.ok !== true || typeof probeResult.cookie !== 'string' || !probeResult.cookie.trim()) {
    throw new Error('ready probe failed: ok=true and a non-empty cookie are required');
  }
  return {
    ok: true,
    cookie: probeResult.cookie,
  };
}

function combineSignals(...signals) {
  const active = signals.filter((signal) => signal instanceof AbortSignal);
  if (active.length === 0) return undefined;
  if (active.length === 1) return active[0];
  if (typeof AbortSignal.any === 'function') return AbortSignal.any(active);

  const controller = new AbortController();
  const onAbort = () => controller.abort(active.find((signal) => signal.aborted)?.reason);
  for (const signal of active) {
    if (signal.aborted) {
      onAbort();
      break;
    }
    signal.addEventListener('abort', onAbort, { once: true });
  }
  return controller.signal;
}

function deadlineSignal(parentSignal, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    const error = new Error(`operation timed out after ${timeoutMs}ms`);
    error.name = 'TimeoutError';
    controller.abort(error);
  }, timeoutMs);
  // The deadline is the only thing that can settle a stalled operation, so it
  // must keep the event loop alive. With `unref()` Node 22 resolves the loop
  // first and `node:test` cancels the pending test ("Promise resolution is
  // still pending but the event loop has already resolved"). The timer is
  // always cleared by `withDeadline`'s `finally`, so a referenced timer cannot
  // leak past the operation.
  return {
    signal: combineSignals(parentSignal, controller.signal),
    clear: () => clearTimeout(timer),
    timedOut: () => controller.signal.aborted,
    timeoutError: () => controller.signal.reason,
  };
}

function withDeadline(parentSignal, timeoutMs, operation) {
  const deadline = deadlineSignal(parentSignal, timeoutMs);
  return Promise.resolve()
    .then(() => operation(deadline.signal))
    .catch((error) => {
      if (deadline.timedOut() && parentSignal?.aborted !== true) throw deadline.timeoutError();
      throw error;
    })
    .finally(deadline.clear);
}

/**
 * Containment check for paths that are about to be created/removed on a remote
 * host. `path.resolve()` cannot be used here (no local filesystem, unknown
 * remote OS), so the comparison is segment-aware instead of a raw string
 * prefix: `<root>/../outside`, `<root>-sibling`, drive-relative `C:foo` and
 * mismatched drive/UNC forms are all rejected.
 *
 * Symlink escape cannot be detected without a remote round-trip and is out of
 * scope: the caller only ever picks fixture paths it created itself.
 */
function normalizeContainmentPath(value, label) {
  const raw = String(value == null ? '' : value).trim().replace(/\\/g, '/');
  if (!raw) throw new Error(`${label} must be an absolute path`);
  if (/^[a-zA-Z]:(?![\/])/.test(raw)) {
    throw new Error(`${label} must be an absolute path, not a drive-relative path (${raw})`);
  }
  const unc = /^\/\/[^/]+\/[^/]+/.test(raw);
  const posixAbsolute = !unc && raw.startsWith('/');
  const driveAbsolute = /^[a-zA-Z]:\//.test(raw);
  if (!unc && !posixAbsolute && !driveAbsolute) {
    throw new Error(`${label} must be an absolute path (${raw})`);
  }
  const segments = raw.split('/').filter((segment) => segment !== '' && segment !== '.');
  if (segments.some((segment) => segment === '..')) {
    throw new Error(`${label} must not contain a ".." traversal segment (${raw})`);
  }
  if (segments.length === 0) throw new Error(`${label} must not be a filesystem root (${raw})`);
  // Rebuild from segments so '.' and duplicate separators cannot smuggle a
  // prefix match, while the absolute prefix is preserved.
  const prefix = unc ? '//' : (posixAbsolute ? '/' : '');
  return prefix + segments.join('/');
}

function assertInsideRoot(root, target, label = 'path') {
  const rootPath = normalizeContainmentPath(root, 'fixture root');
  const targetPath = normalizeContainmentPath(target, label);
  if (targetPath === rootPath || !targetPath.startsWith(rootPath + '/')) {
    throw new Error(`${label} must be inside the run-owned remote fixture root (${rootPath})`);
  }
  return target;
}

function makeRemoteFixturePaths(home, runId) {
  const base = String(home || '').replace(/[\\/]+$/, '');
  if (!base || base === '/' || /^[a-zA-Z]:[\\/]?$/.test(base)) {
    throw new Error('remote home did not resolve to a writable directory');
  }
  const separator = base.includes('\\') ? '\\' : '/';
  const safeRunId = String(runId).replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 64);
  if (!safeRunId) throw new Error('run id is required for the remote fixture');
  const root = `${base}${separator}.dshr-live-${safeRunId}`;
  const join = (...parts) => parts.reduce((acc, part) => (acc ? joinRemotePath(acc, part) : String(part)), '');
  return {
    root,
    fileName: join(root, 'fixture.txt'),
    // `/mirror` requires the remote target to already exist, so the run
    // creates this directory and mirrors it (never a sibling name).
    dirName: join(root, 'mirror'),
    mirrorName: join(root, 'mirror'),
  };
}

/**
 * Join two remote paths with the separator style the first one uses. Kept
 * separator-agnostic (no local `path` module) because the remote host may be
 * POSIX or Windows regardless of the machine running this script.
 */
function joinRemotePath(base, ...parts) {
  const head = String(base == null ? '' : base);
  if (!head) return String(parts.join('/'));
  const separator = head.includes('\\') ? '\\' : '/';
  let out = head;
  for (const part of parts) {
    const tail = String(part == null ? '' : part).replace(/^[\\/]+/, '');
    if (!tail) continue;
    out = out.replace(/[\\/]+$/, '') + separator + tail;
  }
  return out;
}

function createRunId(prefix = 'dshr') {
  return `${prefix}-${process.pid}-${Date.now().toString(36)}-${crypto.randomBytes(6).toString('hex')}`;
}

async function reservePort(host = '127.0.0.1') {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, host, resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  if (!port) throw new Error('could not allocate a local port');
  return port;
}

function errorMessage(error) {
  return String((error && error.message) || error || 'unknown error');
}

function waitForChildExit(child, timeoutMs) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.removeListener('exit', onExit);
      resolve(false);
    }, timeoutMs);
    timer.unref?.();
    const onExit = () => {
      clearTimeout(timer);
      resolve(true);
    };
    child.once('exit', onExit);
    if (child.exitCode !== null || child.signalCode !== null) onExit();
  });
}

async function stopChild(child, options = {}) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const timeoutMs = positiveNumber(options.timeoutMs, DEFAULT_TIMEOUTS.childExitMs);
  const termMs = Math.max(1, Math.floor(timeoutMs / 2));
  const killMs = Math.max(1, timeoutMs - termMs);

  try { child.kill('SIGTERM'); } catch { /* already gone */ }
  if (await waitForChildExit(child, termMs)) return;

  try { child.kill('SIGKILL'); } catch { /* already gone */ }
  if (!(await waitForChildExit(child, killMs))) throw new Error('harness child did not exit');
}

async function establishLiveSession(url, options = {}) {
  const probe = options.probe;
  if (typeof probe !== 'function') {
    throw new TypeError('establishLiveSession requires a probe function');
  }
  const signal = options.signal;
  if (signal && signal.aborted) throw signal.reason;
  // The run-level signal covers startup too: a cancelled run must not keep
  // waiting on a readiness probe after teardown has begun.
  const probeResult = await probe(url, {
    timeoutMs: options.timeoutMs || 30000,
    ...(signal ? { signal } : {}),
  });
  if (signal?.aborted) throw signal.reason;
  return requireReadySession(probeResult);
}

async function responseText(response, signal) {
  if (!response.body || typeof response.body.getReader !== 'function') {
    return response.text();
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  const onAbort = () => {
    reader.cancel(signal.reason).catch(() => { /* The abort signal already defines the request failure; the reader may already be cancelled. */ });
  };
  if (signal.aborted) onAbort();
  else signal.addEventListener('abort', onAbort, { once: true });
  try {
    while (true) {
      if (signal.aborted) throw signal.reason;
      const read = reader.read().then((result) => {
        if (signal.aborted) throw signal.reason;
        return result;
      });
      const { done, value } = await read;
      if (done) break;
      chunks.push(value);
      total += value.byteLength;
    }
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/**
 * Perform one API request with independent transport, response-body, and
 * whole-run cancellation.
 */
async function requestJson(base, cookie, method, route, body, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const parentSignal = options.signal;
  const requestMs = positiveNumber(options.requestMs, DEFAULT_TIMEOUTS.requestMs);
  const bodyMs = positiveNumber(options.bodyMs, DEFAULT_TIMEOUTS.bodyMs);
  return withDeadline(parentSignal, requestMs, async (signal) => {
    const response = await fetchImpl(base + '/api' + route, {
      method,
      headers: { cookie, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual',
      signal,
    });
    const text = await withDeadline(parentSignal, bodyMs, async (bodySignal) => {
      const responseSignal = combineSignals(signal, bodySignal);
      return responseText(response, responseSignal);
    });
    let json = null;
    if (text) {
      try { json = JSON.parse(text); } catch { /* preserve raw text */ }
    }
    return { status: response.status, json, text };
  });
}

function waitForUrl(child, options = {}) {
  if (!child || !child.stdout) throw new TypeError('waitForUrl requires a child with stdout');
  const timeoutMs = positiveNumber(options.timeoutMs, DEFAULT_TIMEOUTS.runMs);
  const parentSignal = options.signal;
  return new Promise((resolve, reject) => {
    if (parentSignal && parentSignal.aborted) {
      reject(parentSignal.reason);
      return;
    }
    let settled = false;
    let buffer = '';
    const timer = setTimeout(() => finish(new Error(`web url not printed within ${timeoutMs}ms`)), timeoutMs);
    timer.unref?.();
    const finish = (error, url) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stdout.removeListener('data', onData);
      child.removeListener('error', onError);
      child.removeListener('exit', onExit);
      parentSignal?.removeEventListener('abort', onAbort);
      if (error) reject(error);
      else resolve(url);
    };
    const onAbort = () => finish(parentSignal.reason || new Error('live run cancelled'));
    const onData = (data) => {
      buffer += String(data);
      const match = buffer.match(/https?:\/\/\S+/);
      if (match) finish(null, match[0].replace(/[)\]]+$/, ''));
    };
    const onError = (error) => finish(new Error(`harness child spawn error: ${errorMessage(error)}`));
    const onExit = (code, signal) => finish(new Error(`harness child exited before printing a URL (code=${code}, signal=${signal || 'none'})`));
    child.stdout.on('data', onData);
    child.once('error', onError);
    child.once('exit', onExit);
    parentSignal?.addEventListener('abort', onAbort, { once: true });
  });
}

module.exports = {
  DEFAULT_TIMEOUTS,
  assertInsideRoot,
  createRunId,
  deadlineSignal,
  errorMessage,
  establishLiveSession,
  joinRemotePath,
  makeRemoteFixturePaths,
  notRunMessage,
  parseLiveArgs,
  requireReadySession,
  requestJson,
  reservePort,
  resolveLiveConfig,
  stopChild,
  waitForUrl,
  withDeadline,
};
