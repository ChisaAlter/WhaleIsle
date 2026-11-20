'use strict';

const http = require('http');
const crypto = require('crypto');

const { isValidGithubSpec, normalizeAllowBuilds } = require('../host/install-dsh-plugin-client.js');
const { effectOf, NEVER_ALWAYS_LEVELS } = require('../shared/model-tool-effects.js');
const { constantTimeEqual, readBodyLimited } = require('../shared/secret');

const RESTART_DELAY_MS = 500;
const MAX_BODY_BYTES = 64 * 1024;

let active = null;

// Only the loopback URL rides the child env (#427): the Bearer token is a
// credential and reaches the host over the stdin secret channel instead, so
// tool-spawned grandchildren can never inherit it. desktopInstallToken() is
// the producer-side getter for that write.
function desktopInstallEnv() {
  if (!active?.url || !active?.token) {
    return {};
  }
  return {
    DSH_DESKTOP_INSTALL_URL: active.url,
  };
}

function desktopInstallToken() {
  return active?.token || '';
}

function desktopInstallReady() {
  return active?.ready || Promise.resolve();
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function unauthorized(res) {
  sendJson(res, 401, { ok: false, error: 'unauthorized' });
}

function badRequest(res, error) {
  sendJson(res, 400, { ok: false, error });
}

function serverError(res, error) {
  sendJson(res, 500, {
    ok: false,
    error: error instanceof Error ? error.message : String(error || 'internal error'),
  });
}

let confirmChain = Promise.resolve();

const PLUGIN_WORDING = {
  decline: '用户拒绝了这次插件变更',
  failure: '插件变更确认失败',
  disconnected: '确认前请求已断开，未执行这次插件变更',
};

const ACTION_WORDING = {
  decline: '用户拒绝了这次操作',
  failure: '操作确认失败',
  disconnected: '确认前请求已断开，未执行这次操作',
};

/**
 * Model-initiated side effects must pass a desktop confirmation before they
 * execute. Prompts are serialized so only one dialog is up at a time, and a
 * missing, throwing or misbehaving confirmer fails closed as a decline. The
 * confirmer answers `true` (legacy plugin allows), 'once' or 'always';
 * anything else is a refusal.
 */
function requestModelAction(confirmModelAction, request, wording) {
  const run = confirmChain.then(async () => {
    if (typeof confirmModelAction !== 'function') {
      return { allowed: false, always: false, error: wording.decline };
    }
    try {
      const decision = await confirmModelAction(request);
      return decision === true || decision === 'once' || decision === 'always'
        ? { allowed: true, always: decision === 'always', error: '' }
        : { allowed: false, always: false, error: wording.decline };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error || 'confirm failed');
      return { allowed: false, always: false, error: `${wording.failure}：${reason}` };
    }
  });
  confirmChain = run.then(() => undefined, () => undefined);
  return run;
}

/**
 * Confirm for a live request: an approval that arrives after the caller timed
 * out or disconnected is not executed, so a late click cannot act on a call the
 * tool already reported as failed.
 */
async function confirmForRequest(res, confirmModelAction, request, wording = PLUGIN_WORDING) {
  const confirmation = await requestModelAction(confirmModelAction, request, wording);
  if (confirmation.allowed && (res.destroyed || res.socket?.destroyed)) {
    return { allowed: false, always: false, error: wording.disconnected };
  }
  return confirmation;
}

function declinedBody(error) {
  return { ok: false, declined: true, error: error || '用户拒绝了这次插件变更' };
}

function scheduleRestart(startHarness, delayMs) {
  // The install response is flushed before this timer fires, so the tool
  // result reaches the session log first. The delay is a fixed grace period,
  // not an ACK: a tool/result still slower than the delay would be cut off.
  if (!active) {
    return;
  }
  if (active.restartTimer) {
    clearTimeout(active.restartTimer);
  }
  active.restartTimer = setTimeout(() => {
    if (!active) {
      return;
    }
    active.restartTimer = null;
    if (typeof startHarness === 'function') {
      Promise.resolve().then(() => startHarness()).catch((error) => { console.warn('[desktop-install-control] 插件变更后的重启失败；请从启动器重试启动。', error); });
    }
  }, delayMs);
}

function normalizeInstallResult(result, fallbackSpec) {
  return {
    ok: Boolean(result?.ok),
    needsAllowBuilds: Boolean(result?.needsAllowBuilds),
    allowBuilds: Array.isArray(result?.allowBuilds) ? result.allowBuilds : [],
    spec: String(result?.spec || fallbackSpec || ''),
    error: String(result?.error || ''),
    log: String(result?.log || ''),
  };
}

async function handleInstall(req, res, { installPlugin, startHarness, restartDelayMs, confirmModelAction }) {
  let payload;
  try {
    payload = JSON.parse(await readBodyLimited(req, MAX_BODY_BYTES, { res }) || '{}');
  } catch {
    badRequest(res, 'invalid json');
    return;
  }
  const spec = String(payload.spec || '').trim();
  const allowBuilds = normalizeAllowBuilds(payload.allowBuilds);
  if (!isValidGithubSpec(spec)) {
    badRequest(res, '仅支持 github:owner/repo[#ref] 安装规格');
    return;
  }
  if (!allowBuilds) {
    badRequest(res, 'allowBuilds 包含非法包名');
    return;
  }
  const confirmation = await confirmForRequest(res, confirmModelAction, {
    action: 'install',
    target: spec,
    allowBuilds,
  });
  if (!confirmation.allowed) {
    sendJson(res, 200, {
      ...declinedBody(confirmation.error),
      needsAllowBuilds: false,
      allowBuilds: [],
      spec,
      log: '',
    });
    return;
  }
  try {
    const body = normalizeInstallResult(await installPlugin(spec, { allowBuilds }), spec);
    sendJson(res, 200, body);
    if (body.ok && !body.needsAllowBuilds) {
      scheduleRestart(startHarness, restartDelayMs);
    }
  } catch (error) {
    sendJson(res, 500, {
      ok: false,
      needsAllowBuilds: false,
      allowBuilds: [],
      spec,
      error: error instanceof Error ? error.message : String(error || 'install failed'),
      log: '',
    });
  }
}

/**
 * `/desktop/plugin` actions for the whale assistant's desktop management
 * tools. Guards live in the desktop callbacks (plugin-ops / marketplace
 * validation), so this layer only normalizes the envelope.
 */
async function handleDesktopPlugin(req, res, desktop, { installPlugin, startHarness, restartDelayMs, confirmModelAction }) {
  let payload;
  try {
    payload = JSON.parse(await readBodyLimited(req, MAX_BODY_BYTES, { res }) || '{}');
  } catch {
    badRequest(res, 'invalid json');
    return;
  }
  const action = String(payload.action || '').trim();
  const allowBuilds = normalizeAllowBuilds(payload.allowBuilds);
  if (allowBuilds === null) {
    badRequest(res, 'allowBuilds 包含非法包名');
    return;
  }
  switch (action) {
    case 'install': {
      const id = String(payload.id || '').trim();
      const spec = String(payload.spec || '').trim();
      if (!id && !spec) {
        badRequest(res, '缺少插件 id 或安装规格');
        return;
      }
      if (spec && !isValidGithubSpec(spec)) {
        badRequest(res, '仅支持 github:owner/repo[#ref] 安装规格');
        return;
      }
      const confirmation = await confirmForRequest(res, confirmModelAction, {
        action: 'install',
        target: id || spec,
        allowBuilds,
      });
      if (!confirmation.allowed) {
        sendJson(res, 200, declinedBody(confirmation.error));
        return;
      }
      const result = id
        ? await desktop.installCatalog(id, { allowBuilds })
        : await installPlugin(spec, { allowBuilds });
      const body = { ...normalizeInstallResult(result, spec || id), restarting: false };
      if (body.ok && !body.needsAllowBuilds) {
        body.restarting = true;
        scheduleRestart(startHarness, restartDelayMs);
      }
      sendJson(res, 200, body);
      return;
    }
    case 'remove': {
      const name = String(payload.name || '').trim();
      if (!name) {
        badRequest(res, '缺少包名');
        return;
      }
      const confirmation = await confirmForRequest(res, confirmModelAction, {
        action: 'remove',
        target: name,
        allowBuilds,
      });
      if (!confirmation.allowed) {
        sendJson(res, 200, declinedBody(confirmation.error));
        return;
      }
      const result = await desktop.removePlugin(name);
      const ok = result?.ok === true;
      if (ok) {
        scheduleRestart(startHarness, restartDelayMs);
      }
      sendJson(res, 200, { ...result, ok, restarting: ok });
      return;
    }
    case 'disable':
    case 'enable': {
      const names = Array.isArray(payload.names)
        ? payload.names
        : [payload.name];
      const confirmation = await confirmForRequest(res, confirmModelAction, {
        action,
        target: action === 'disable' && names.length > 1 ? names : names[0],
        allowBuilds,
      });
      if (!confirmation.allowed) {
        sendJson(res, 200, declinedBody(confirmation.error));
        return;
      }
      const result = action === 'disable'
        ? await desktop.disablePlugins(names)
        : await desktop.enablePlugin(names[0]);
      sendJson(res, 200, result);
      return;
    }
    default:
      badRequest(res, `unknown action: ${action || '(empty)'}`);
  }
}

/**
 * `POST /desktop/confirm` is the shared confirmation endpoint for
 * model-callable tools: a tool sends what it is about to do, the main process
 * shows a dialog, and only an explicit allow lets the caller proceed. The
 * effective level comes from the model-tool-effects registry — the request's
 * self-reported effect is advisory — and tools the registry does not know, or
 * registered tools reporting an unregistered action, are treated as `code`.
 * Run-scoped "always" grants are keyed by tool+action plus the caller's
 * optional scope (e.g. the exact set of sensitive config keys a patch writes,
 * so one grant never covers a different key set), and never apply to
 * destructive/code effects.
 */
/** @param {unknown} raw */
function normalizeConfirmScope(raw) {
  return String(raw || '').slice(0, 200)
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .sort()
    .join(',');
}

/**
 * @param {any} payload
 * @param {string} tool
 * @param {string} action
 * @param {string} level
 */
function buildConfirmRequest(payload, tool, action, level) {
  return {
    tool,
    action,
    effect: level,
    summary: String(payload?.summary || '').slice(0, 500),
    details: String(payload?.details || '').slice(0, 6000),
  };
}

async function handleDesktopConfirm(req, res, { confirmModelAction, sessionAllowed }) {
  let payload;
  try {
    payload = JSON.parse(await readBodyLimited(req, MAX_BODY_BYTES, { res }) || '{}');
  } catch {
    badRequest(res, 'invalid json');
    return;
  }
  const tool = String(payload?.tool || '').slice(0, 200);
  const effect = String(payload?.effect || '').slice(0, 40);
  if (!tool || !effect) {
    badRequest(res, 'missing tool or effect');
    return;
  }
  if (payload?.unattended === true) {
    sendJson(res, 200, declinedBody('无人值守回合禁止自动执行需要人工确认的操作'));
    return;
  }
  const action = String(payload?.action || '').slice(0, 200);
  const scope = normalizeConfirmScope(payload?.scope);
  const level = effectOf(tool, action) || 'code';
  const rememberable = !NEVER_ALWAYS_LEVELS.has(level);
  const memoryKey = `${tool} ${action} ${scope}`;
  if (rememberable && sessionAllowed.has(memoryKey)) {
    sendJson(res, 200, { ok: true });
    return;
  }
  const request = buildConfirmRequest(payload, tool, action, level);
  const confirmation = await confirmForRequest(res, confirmModelAction, request, ACTION_WORDING);
  if (confirmation.allowed && confirmation.always && rememberable) {
    sessionAllowed.add(memoryKey);
  }
  sendJson(res, 200, confirmation.allowed ? { ok: true } : declinedBody(confirmation.error));
}

/**
 * `POST /desktop/show-secret` displays a generated secret (pairing code,
 * public tunnel address) in a desktop dialog instead of returning it to the
 * model. It is serialized behind pending confirmations so dialogs never stack.
 */
async function handleShowSecret(req, res, { showSecret }) {
  let payload;
  try {
    payload = JSON.parse(await readBodyLimited(req, MAX_BODY_BYTES, { res }) || '{}');
  } catch {
    badRequest(res, 'invalid json');
    return;
  }
  const secret = String(payload?.secret || '');
  if (!secret) {
    badRequest(res, 'missing secret');
    return;
  }
  if (typeof showSecret !== 'function') {
    sendJson(res, 200, { ok: false, error: 'secret display is unavailable' });
    return;
  }
  const request = {
    tool: String(payload?.tool || '').slice(0, 200),
    title: String(payload?.title || '').slice(0, 80),
    label: String(payload?.label || '').slice(0, 200),
    secret: secret.slice(0, 4000),
    hint: String(payload?.hint || '').slice(0, 500),
  };
  const run = confirmChain.then(async () => {
    try {
      const result = await showSecret(request);
      return result === false || result?.ok === false ? { ok: false } : { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error || 'show failed') };
    }
  });
  confirmChain = run.then(() => undefined, () => undefined);
  sendJson(res, 200, await run);
}

function createHandler({ installPlugin, startHarness, desktop, restartDelayMs, confirmModelAction, showSecret }) {
  const delay = Number.isFinite(restartDelayMs) ? restartDelayMs : RESTART_DELAY_MS;
  const ops = {
    installPlugin,
    startHarness,
    restartDelayMs: delay,
    confirmModelAction,
    showSecret,
    // Run-scoped "always allow" grants, keyed "tool action scope". Created
    // with the control server instance so an app restart re-asks; never
    // populated for destructive/code effects.
    sessionAllowed: new Set(),
  };
  return async (req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://dshd.internal').pathname;
    if (pathname !== '/install' && !pathname.startsWith('/desktop/')) {
      sendJson(res, 404, { ok: false, error: 'not found' });
      return;
    }
    if (!active?.token || !constantTimeEqual(req.headers.authorization || '', `Bearer ${active.token}`)) {
      unauthorized(res);
      return;
    }
    if (req.method === 'POST' && pathname === '/install') {
      await handleInstall(req, res, ops);
      return;
    }
    if (req.method === 'POST' && pathname === '/desktop/confirm') {
      await handleDesktopConfirm(req, res, ops);
      return;
    }
    if (req.method === 'POST' && pathname === '/desktop/show-secret') {
      await handleShowSecret(req, res, ops);
      return;
    }
    if (!desktop) {
      sendJson(res, 404, { ok: false, error: 'not found' });
      return;
    }
    try {
      if (req.method === 'POST' && pathname === '/desktop/html-preview') {
        if (typeof desktop.htmlPreview !== 'function') {
          sendJson(res, 503, { error: 'HTML preview rendering service is unavailable' });
          return;
        }
        // Base64 local images are already part of the prepared page; reserve
        // room for JSON escaping while keeping this route independently bounded.
        let payload;
        try { payload = JSON.parse(await readBodyLimited(req, 52 * 1024 * 1024, { res })); }
        catch { badRequest(res, 'invalid or oversized HTML preview request'); return; }
        const cancellation = new AbortController();
        const cancel = () => cancellation.abort(new Error('HTML preview request closed.'));
        req.once('aborted', cancel);
        res.once('close', cancel);
        try {
          const value = await desktop.htmlPreview(payload, cancellation.signal);
          if (!res.destroyed) sendJson(res, 200, value);
        } finally {
          req.removeListener('aborted', cancel);
          res.removeListener('close', cancel);
        }
        return;
      }
      if (req.method === 'GET' && pathname === '/desktop/state') {
        sendJson(res, 200, await desktop.state());
        return;
      }
      if (req.method === 'POST' && pathname === '/desktop/project') {
        let payload;
        try { payload = JSON.parse(await readBodyLimited(req, MAX_BODY_BYTES, { res }) || '{}'); }
        catch { badRequest(res, 'invalid json'); return; }
        if (!payload || typeof payload !== 'object' || Array.isArray(payload) || typeof desktop.project !== 'function') {
          badRequest(res, 'Project capability is unavailable or invalid');
          return;
        }
        sendJson(res, 200, await desktop.project(payload));
        return;
      }
      if (req.method === 'GET' && pathname === '/desktop/marketplace') {
        const { searchParams } = new URL(req.url ?? '/', 'http://dshd.internal');
        sendJson(res, 200, await desktop.listMarketplace({
          q: searchParams.get('q') || '',
          refresh: searchParams.get('refresh') === '1',
        }));
        return;
      }
      if (req.method === 'POST' && pathname === '/desktop/config') {
        let payload;
        try {
          payload = JSON.parse(await readBodyLimited(req, MAX_BODY_BYTES, { res }) || '{}');
        } catch {
          badRequest(res, 'invalid json');
          return;
        }
        sendJson(res, 200, await desktop.applyConfig(payload.patch));
        return;
      }
      if (req.method === 'GET' && pathname === '/desktop/pet-settings') {
        sendJson(res, 200, await desktop.petSettings());
        return;
      }
      if (req.method === 'POST' && pathname === '/desktop/pet-settings') {
        let payload;
        try {
          payload = JSON.parse(await readBodyLimited(req, MAX_BODY_BYTES, { res }) || '{}');
        } catch {
          badRequest(res, 'invalid json');
          return;
        }
        sendJson(res, 200, await desktop.applyPetSettings(payload.patch));
        return;
      }
      if (req.method === 'POST' && pathname === '/desktop/plugin') {
        await handleDesktopPlugin(req, res, desktop, ops);
        return;
      }
      sendJson(res, 404, { ok: false, error: 'not found' });
    } catch (error) {
      serverError(res, error);
    }
  };
}

function startDesktopInstallControl(options = {}) {
  stopDesktopInstallControl();
  const token = crypto.randomBytes(32).toString('hex');
  const server = http.createServer(createHandler(options));
  const ready = new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const url = `http://127.0.0.1:${address.port}`;
      if (active) {
        active.url = url;
        active.token = token;
      }
      resolve({ url, token });
    });
  });
  active = {
    url: '',
    token,
    server,
    ready,
    restartTimer: null,
  };
  return { ready, close: stopDesktopInstallControl };
}

function stopDesktopInstallControl() {
  if (!active) {
    return;
  }
  if (active.restartTimer) {
    clearTimeout(active.restartTimer);
  }
  try {
    active.server.close();
  } catch {
    // already closed
  }
  active = null;
}

module.exports = {
  desktopInstallEnv,
  desktopInstallToken,
  desktopInstallReady,
  startDesktopInstallControl,
  stopDesktopInstallControl,
};
