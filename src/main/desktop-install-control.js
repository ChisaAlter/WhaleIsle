'use strict';

const http = require('http');
const crypto = require('crypto');

const { isValidGithubSpec, normalizeAllowBuilds } = require('../host/install-dsh-plugin-client.js');

const RESTART_DELAY_MS = 500;
const MAX_BODY_BYTES = 64 * 1024;

let active = null;

function desktopInstallEnv() {
  if (!active?.url || !active?.token) {
    return {};
  }
  return {
    DSH_DESKTOP_INSTALL_URL: active.url,
    DSH_DESKTOP_INSTALL_TOKEN: active.token,
  };
}

function desktopInstallReady() {
  return active?.ready || Promise.resolve();
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('request too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
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
      Promise.resolve(startHarness()).catch(() => {});
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

async function handleInstall(req, res, { installPlugin, startHarness, restartDelayMs }) {
  let payload;
  try {
    payload = JSON.parse(await readBody(req) || '{}');
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
async function handleDesktopPlugin(req, res, desktop, { installPlugin, startHarness, restartDelayMs }) {
  let payload;
  try {
    payload = JSON.parse(await readBody(req) || '{}');
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

function createHandler({ installPlugin, startHarness, desktop, restartDelayMs }) {
  const delay = Number.isFinite(restartDelayMs) ? restartDelayMs : RESTART_DELAY_MS;
  const ops = { installPlugin, startHarness, restartDelayMs: delay };
  return async (req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://dshd.internal').pathname;
    if (pathname !== '/install' && !pathname.startsWith('/desktop/')) {
      sendJson(res, 404, { ok: false, error: 'not found' });
      return;
    }
    const expected = `Bearer ${active?.token || ''}`;
    if (!active?.token || req.headers.authorization !== expected) {
      unauthorized(res);
      return;
    }
    if (req.method === 'POST' && pathname === '/install') {
      await handleInstall(req, res, ops);
      return;
    }
    if (!desktop) {
      sendJson(res, 404, { ok: false, error: 'not found' });
      return;
    }
    try {
      if (req.method === 'GET' && pathname === '/desktop/state') {
        sendJson(res, 200, await desktop.state());
        return;
      }
      if (req.method === 'POST' && pathname === '/desktop/project') {
        let payload;
        try { payload = JSON.parse(await readBody(req) || '{}'); }
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
          payload = JSON.parse(await readBody(req) || '{}');
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
          payload = JSON.parse(await readBody(req) || '{}');
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
  RESTART_DELAY_MS,
  desktopInstallEnv,
  desktopInstallReady,
  startDesktopInstallControl,
  stopDesktopInstallControl,
};
