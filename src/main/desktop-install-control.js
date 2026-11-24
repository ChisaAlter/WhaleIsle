'use strict';

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { isValidGithubSpec, normalizeAllowBuilds } = require('../host/install-dsh-plugin-client.js');
const { effectOf, NEVER_ALWAYS_LEVELS, TOOLS } = require('../shared/model-tool-effects.js');
const { constantTimeEqual, readBodyLimited } = require('../shared/secret');
const { tryGetDesktopDshHome } = require('../shared/dsh-home');

const SENSITIVE_CONFIG_KEYS = new Set(TOOLS.whale_desktop_config?.keys ?? []);

const RESTART_DELAY_MS = 500;
const MAX_BODY_BYTES = 64 * 1024;
const AUDIT_TEXT_LIMIT = 1000;
const AUDIT_REDACTED = '[REDACTED]';

const AUDIT_SECRET_KEY_RE = /(?:secret|token|password|passwd|apikey|api_key|authorization|cookie|private_?key|credential)/i;
const AUDIT_SECRET_PATTERNS = [
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  /\bsk-(?:proj-|live-|test-)?[A-Za-z0-9_-]{16,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /(\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|auth[_-]?token|client[_-]?secret|webhook[_-]?secret|secret|token|password|passwd|cookie)\b\s*[:=]\s*['"]?)([^\s'",;]{6,})(['"]?)/gi,
];

/**
 * Redact credential-like strings before persisting confirmation audit records.
 * @param {string} raw
 * @returns {string}
 */
function redactAuditString(raw) {
  let out = raw;
  for (const pattern of AUDIT_SECRET_PATTERNS) {
    out = out.replace(pattern, (...args) => {
      if (args.length >= 6 && typeof args[1] === 'string' && typeof args[3] === 'string') {
        return `${args[1]}${AUDIT_REDACTED}${args[3]}`;
      }
      return AUDIT_REDACTED;
    });
  }
  return out;
}

/**
 * Recursively redact secrets from strings, arrays and plain objects.
 * @param {unknown} value
 * @param {number} [depth]
 * @returns {unknown}
 */
function redactAuditSecrets(value, depth = 0) {
  if (depth > 6 || value === null || value === undefined) return value;
  if (typeof value === 'string') return redactAuditString(value).slice(0, AUDIT_TEXT_LIMIT);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => redactAuditSecrets(item, depth + 1));
  }
  if (typeof value === 'object') {
    /** @type {Record<string, unknown>} */
    const out = {};
    for (const [key, entry] of Object.entries(value)) {
      out[key] = AUDIT_SECRET_KEY_RE.test(key)
        ? AUDIT_REDACTED
        : redactAuditSecrets(entry, depth + 1);
    }
    return out;
  }
  return redactAuditString(String(value)).slice(0, AUDIT_TEXT_LIMIT);
}

let activeAuditLogPath = '';

/**
 * Resolve `$DSH_HOME/logs/confirm-audit.jsonl` (or an explicit override path).
 * Returns empty string when DSH home is not configured.
 * @param {unknown} [overridePath]
 * @returns {string}
 */
function resolveConfirmAuditPath(overridePath) {
  const explicit = typeof overridePath === 'string' && overridePath.trim()
    ? overridePath.trim()
    : activeAuditLogPath;
  if (explicit) {
    return path.resolve(explicit);
  }
  const home = tryGetDesktopDshHome();
  if (!home) return '';
  return path.join(home, 'logs', 'confirm-audit.jsonl');
}

/**
 * Best-effort JSONL audit append for `/desktop/confirm` and `/desktop/plugin`.
 * Never throws or blocks the confirmation response path.
 * @param {Record<string, unknown>} entry
 * @param {unknown} [overridePath]
 */
function appendConfirmAudit(entry, overridePath) {
  try {
    const filePath = resolveConfirmAuditPath(overridePath);
    if (!filePath) return;
    const record = /** @type {Record<string, unknown>} */ (redactAuditSecrets({
      ts: new Date().toISOString(),
      ...entry,
    }));
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`, 'utf8');
  } catch (error) {
    console.warn('[desktop-install-control] confirm audit log write failed', error);
  }
}

/**
 * Run plugin confirmation and persist a redacted audit record.
 * @param {any} res
 * @param {any} confirmModelAction
 * @param {{ action: string, target: unknown, allowBuilds: string[] }} request
 */
async function confirmPluginAction(res, confirmModelAction, request) {
  const confirmation = await confirmForRequest(res, confirmModelAction, request);
  appendConfirmAudit({
    route: '/desktop/plugin',
    decision: confirmation.allowed ? 'allowed' : 'declined',
    allowed: confirmation.allowed,
    action: request.action,
    target: request.target,
    allowBuilds: request.allowBuilds,
    reason: confirmation.error || '',
  });
  return confirmation;
}

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
  const payload = await readJsonPayload(req, res);
  if (!payload) return;
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
  const payload = await readJsonPayload(req, res);
  if (!payload) return;
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
      const confirmation = await confirmPluginAction(res, confirmModelAction, {
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
      const confirmation = await confirmPluginAction(res, confirmModelAction, {
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
      const confirmation = await confirmPluginAction(res, confirmModelAction, {
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

/**
 * Persist an audit record for a `/desktop/confirm` decision.
 * @param {{
 *   decision: string,
 *   allowed: boolean,
 *   always?: boolean,
 *   remembered?: boolean,
 *   unattended?: boolean,
 *   tool: string,
 *   action: string,
 *   effect: string,
 *   scope: string,
 *   summary?: string,
 *   details?: string,
 *   reason?: string,
 * }} meta
 */
function recordConfirmDecision(meta) {
  appendConfirmAudit({
    route: '/desktop/confirm',
    decision: meta.decision,
    allowed: meta.allowed,
    always: Boolean(meta.always),
    remembered: Boolean(meta.remembered),
    unattended: Boolean(meta.unattended),
    tool: meta.tool,
    action: meta.action,
    effect: meta.effect,
    scope: meta.scope,
    summary: meta.summary || '',
    details: meta.details || '',
    reason: meta.reason || '',
  });
}

/**
 * Determine the normalized audit decision label for an interactive confirmation.
 * @param {{ allowed: boolean, always: boolean }} confirmation
 * @param {boolean} rememberable
 * @returns {string}
 */
function interactiveConfirmDecision(confirmation, rememberable) {
  if (!confirmation.allowed) return 'declined';
  return confirmation.always && rememberable ? 'allowed_always' : 'allowed_once';
}

/**
 * Record an audit entry from a built confirm request and decision outcome.
 * @param {{ tool: string, action: string, effect: string, summary: string, details: string }} request
 * @param {string} scope
 * @param {{ decision: string, allowed: boolean, always?: boolean, remembered?: boolean, unattended?: boolean, reason?: string }} outcome
 */
function auditConfirmOutcome(request, scope, outcome) {
  recordConfirmDecision({
    ...outcome,
    tool: request.tool,
    action: request.action,
    effect: request.effect,
    scope,
    summary: request.summary,
    details: request.details,
  });
}

async function readJsonPayload(/** @type {any} */ req, /** @type {any} */ res) {
  try {
    return JSON.parse(await readBodyLimited(req, MAX_BODY_BYTES, { res }) || '{}');
  } catch {
    badRequest(res, 'invalid json');
    return null;
  }
}

function consumeOnceGrant(/** @type {Map<string, number> | undefined} */ onceGrants, /** @type {string} */ key) {
  const count = onceGrants?.get(key) || 0;
  if (count <= 0) return false;
  if (count === 1) onceGrants?.delete(key);
  else onceGrants?.set(key, count - 1);
  return true;
}

async function confirmSensitiveConfigPatch(/** @type {any} */ res, /** @type {Record<string, unknown>} */ patch, /** @type {any} */ ops) {
  const sensitive = Object.keys(patch).filter((key) => SENSITIVE_CONFIG_KEYS.has(key)).sort();
  if (sensitive.length === 0) return true;
  const touchesCredential = sensitive.includes('githubToken');
  const action = touchesCredential ? 'patch-credentials' : 'patch';
  const effect = effectOf('whale_desktop_config', action) || (touchesCredential ? 'destructive' : 'external');
  const scope = sensitive.join(',');
  const memoryKey = `whale_desktop_config ${action} ${scope}`;
  const rememberable = !NEVER_ALWAYS_LEVELS.has(effect);
  if (rememberable && ops.sessionAllowed.has(memoryKey)) return true;
  if (consumeOnceGrant(ops.onceGrants, memoryKey)) return true;
  const request = buildConfirmRequest({
    summary: `修改敏感桌面配置：${scope}`,
    details: JSON.stringify(redactAuditSecrets(patch), null, 2),
  }, 'whale_desktop_config', action, effect);
  const confirmation = await confirmForRequest(res, ops.confirmModelAction, request, ACTION_WORDING);
  const grantedAlways = confirmation.allowed && confirmation.always && rememberable;
  if (grantedAlways) ops.sessionAllowed.add(memoryKey);
  appendConfirmAudit({
    route: '/desktop/config', decision: interactiveConfirmDecision(confirmation, rememberable),
    allowed: confirmation.allowed, always: grantedAlways, scope, keys: sensitive, reason: confirmation.error || '',
  });
  if (!confirmation.allowed) { sendJson(res, 200, declinedBody(confirmation.error)); return false; }
  return true;
}

async function handleDesktopConfig(/** @type {any} */ req, /** @type {any} */ res, /** @type {any} */ desktop, /** @type {any} */ ops) {
  const payload = await readJsonPayload(req, res);
  if (!payload) return;
  const patch = payload?.patch;
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) { badRequest(res, 'missing config patch'); return; }
  if (!(await confirmSensitiveConfigPatch(res, patch, ops))) return;
  sendJson(res, 200, await desktop.applyConfig(patch));
}

function recordConfigOnceGrant(/** @type {Map<string, number> | undefined} */ onceGrants, /** @type {string} */ tool, /** @type {string} */ action, /** @type {string} */ memoryKey) {
  if (!onceGrants || tool !== 'whale_desktop_config') return;
  if (action !== 'patch' && action !== 'patch-credentials') return;
  onceGrants.set(memoryKey, (onceGrants.get(memoryKey) || 0) + 1);
}

/** @param {any} req @param {any} res @param {any} ops */
async function handleDesktopConfirm(req, res, { confirmModelAction, sessionAllowed, onceGrants }) {
  const payload = await readJsonPayload(req, res);
  if (!payload) return;
  const tool = String(payload?.tool || '').slice(0, 200);
  const effect = String(payload?.effect || '').slice(0, 40);
  if (!tool || !effect) {
    badRequest(res, 'missing tool or effect');
    return;
  }
  const action = String(payload?.action || '').slice(0, 200);
  const scope = normalizeConfirmScope(payload?.scope);
  const level = effectOf(tool, action) || 'code';
  const request = buildConfirmRequest(payload, tool, action, level);
  if (payload?.unattended === true) {
    const reason = '无人值守回合禁止自动执行需要人工确认的操作';
    auditConfirmOutcome(request, scope, { decision: 'declined_unattended', allowed: false, unattended: true, reason });
    sendJson(res, 200, declinedBody(reason));
    return;
  }
  const rememberable = !NEVER_ALWAYS_LEVELS.has(level);
  const memoryKey = `${tool} ${action} ${scope}`;
  if (rememberable && sessionAllowed.has(memoryKey)) {
    auditConfirmOutcome(request, scope, { decision: 'allowed_remembered', allowed: true, always: true, remembered: true });
    sendJson(res, 200, { ok: true });
    return;
  }
  const confirmation = await confirmForRequest(res, confirmModelAction, request, ACTION_WORDING);
  const grantedAlways = confirmation.allowed && confirmation.always && rememberable;
  if (grantedAlways) sessionAllowed.add(memoryKey);
  else if (confirmation.allowed) recordConfigOnceGrant(onceGrants, tool, action, memoryKey);
  auditConfirmOutcome(request, scope, {
    decision: interactiveConfirmDecision(confirmation, rememberable),
    allowed: confirmation.allowed,
    always: grantedAlways,
    reason: confirmation.error,
  });
  sendJson(res, 200, confirmation.allowed ? { ok: true } : declinedBody(confirmation.error));
}

/**
 * `POST /desktop/show-secret` displays a generated secret (pairing code,
 * public tunnel address) in a desktop dialog instead of returning it to the
 * model. It is serialized behind pending confirmations so dialogs never stack.
 */
async function handleShowSecret(req, res, { showSecret }) {
  const payload = await readJsonPayload(req, res);
  if (!payload) return;
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

async function handleHtmlPreview(/** @type {any} */ req, /** @type {any} */ res, /** @type {any} */ desktop) {
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
}

async function handleDesktopProject(/** @type {any} */ req, /** @type {any} */ res, /** @type {any} */ desktop) {
  const payload = await readJsonPayload(req, res);
  if (!payload) return;
  if (typeof payload !== 'object' || Array.isArray(payload) || typeof desktop.project !== 'function') {
    badRequest(res, 'Project capability is unavailable or invalid');
    return;
  }
  sendJson(res, 200, await desktop.project(payload));
}

async function dispatchDesktopRoute(/** @type {any} */ req, /** @type {any} */ res, /** @type {string} */ pathname, /** @type {any} */ desktop, /** @type {any} */ ops) {
  if (req.method === 'POST' && pathname === '/desktop/html-preview') return handleHtmlPreview(req, res, desktop);
  if (req.method === 'GET' && pathname === '/desktop/state') return sendJson(res, 200, await desktop.state());
  if (req.method === 'POST' && pathname === '/desktop/project') return handleDesktopProject(req, res, desktop);
  if (req.method === 'GET' && pathname === '/desktop/marketplace') {
    const { searchParams } = new URL(req.url ?? '/', 'http://dshd.internal');
    return sendJson(res, 200, await desktop.listMarketplace({
      q: searchParams.get('q') || '',
      refresh: searchParams.get('refresh') === '1',
    }));
  }
  return dispatchDesktopSettingsOrPlugin(req, res, pathname, desktop, ops);
}

async function dispatchDesktopSettingsOrPlugin(/** @type {any} */ req, /** @type {any} */ res, /** @type {string} */ pathname, /** @type {any} */ desktop, /** @type {any} */ ops) {
  if (req.method === 'POST' && pathname === '/desktop/config') return handleDesktopConfig(req, res, desktop, ops);
  if (req.method === 'GET' && pathname === '/desktop/pet-settings') return sendJson(res, 200, await desktop.petSettings());
  if (req.method === 'POST' && pathname === '/desktop/pet-settings') {
    const payload = await readJsonPayload(req, res);
    if (payload) sendJson(res, 200, await desktop.applyPetSettings(payload.patch));
    return;
  }
  if (req.method === 'POST' && pathname === '/desktop/plugin') return handleDesktopPlugin(req, res, desktop, ops);
  sendJson(res, 404, { ok: false, error: 'not found' });
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
    onceGrants: new Map(),
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
    if (req.method === 'POST' && pathname === '/install') return handleInstall(req, res, ops);
    if (req.method === 'POST' && pathname === '/desktop/confirm') return handleDesktopConfirm(req, res, ops);
    if (req.method === 'POST' && pathname === '/desktop/show-secret') return handleShowSecret(req, res, ops);
    if (!desktop) {
      sendJson(res, 404, { ok: false, error: 'not found' });
      return;
    }
    try {
      await dispatchDesktopRoute(req, res, pathname, desktop, ops);
    } catch (error) {
      serverError(res, error);
    }
  };
}

function startDesktopInstallControl(options = {}) {
  stopDesktopInstallControl();
  const auditOption = /** @type {{ auditLogPath?: unknown }} */ (options).auditLogPath;
  activeAuditLogPath = typeof auditOption === 'string' && auditOption.trim()
    ? auditOption.trim()
    : '';
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
  activeAuditLogPath = '';
  if (!active) return;
  if (active.restartTimer) clearTimeout(active.restartTimer);
  try { active.server.close(); } catch { /* already closed */ }
  active = null;
}

module.exports = {
  desktopInstallEnv, desktopInstallToken, desktopInstallReady,
  startDesktopInstallControl, stopDesktopInstallControl,
  redactAuditSecrets, resolveConfirmAuditPath,
};
