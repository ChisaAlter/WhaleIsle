'use strict';

/** Visible when `dsh web` is not listening / origin not yet known. */
const HARNESS_DOWN_MESSAGE = '桌面端未启动';

const HOST_RPC_METHODS = new Set([
  'host.describe', 'host.listDirectory', 'host.createDirectory',
  'session.list', 'session.search', 'session.create', 'session.history', 'session.projections',
  'session.models', 'session.selectModel', 'session.rename', 'session.fork', 'session.prompt',
  'session.attachment', 'session.updateQueue', 'session.cancel', 'session.delete',
  'subagent.list', 'subagent.history', 'subagent.prompt', 'subagent.interrupt',
  'workspace.list', 'workspace.create', 'workspace.rename', 'workspace.delete',
  'workspace.insertBefore', 'workspace.insertSessionBefore',
  'workspace.archiveSession', 'workspace.unarchiveSession',
  'skill.list', 'agentPreset.list', 'llm.models', 'llm.providers',
  'workspaceFiles.list', 'workspaceFiles.read', 'workspaceFiles.stat', 'workspaceFiles.readImage',
  'mcpServers.list', 'mcpServers.upsert', 'mcpServers.delete', 'mcpServers.setEnabled',
  'mcpServers.retry', 'mcpServers.test', 'mcpServers.authorize',
  'skillInventory.list', 'skillInventory.get', 'skillInventory.create', 'skillInventory.update',
  'skillInventory.delete', 'skillInventory.setInvocation', 'skillInventory.searchHub', 'skillInventory.installHub',
  'pluginInventory.list', 'pluginManager.listPlugins', 'pluginManager.listBundles',
  'pluginManager.registries', 'pluginManager.inspect', 'pluginManager.setPluginEnabled',
  'pluginManager.setBundleEnabled', 'pluginManager.installBundle', 'pluginManager.removeBundle',
  'pluginManager.cancelInstall', 'pluginManager.waitForInstall',
  'settings.describe', 'settings.update', 'settings.replace', 'settings.mutate',
  'credentials.describe', 'credentials.set', 'credentials.unset',
  'account.getState', 'account.getProfile', 'account.getBalance', 'account.getUnnotifiedBonuses',
  'account.ackBonusNotified', 'account.hasRunningAccountTasks', 'account.cancelSignIn',
  'account.signOut', 'account.startSignIn', 'account.completeSignIn',
  'commands/list', 'commands/execute',
  'dshBots.rpc',
]);

/** Safe read/review/reply subset allowed over Mobile E2EE -> loopback `/dsh-bots/rpc`. */
const DSH_BOTS_RPC_METHODS = new Set([
  'bots.list', 'bots.roster', 'bots.activity',
  'bots.items.list', 'bots.items.detail', 'bots.items.show',
  'bots.items.owner.list', 'bots.items.owner.show', 'bots.items.owner.opened',
  'bots.items.ownerComment', 'bots.items.ownerStatus', 'bots.items.ownerSnooze',
  'bots.items.owner.comment', 'bots.items.owner.status', 'bots.items.owner.snooze',
  'bots.access.list', 'bots.access.decide',
  'bots.groups.list', 'bots.groups.messages', 'bots.groups.read',
  'bots.groups.send', 'bots.groups.approvePlan',
  'bots.budget.get', 'bots.budget.usage',
  'bots.decisions.read',
]);

/** @type {Record<string, string>} */
const DSH_BOTS_RPC_WIRE_ALIAS = {
  'bots.items.detail': 'bots.items.owner.show',
  'bots.items.ownerComment': 'bots.items.owner.comment',
  'bots.items.ownerStatus': 'bots.items.owner.status',
  'bots.items.ownerSnooze': 'bots.items.owner.snooze',
  'bots.groups.messages': 'bots.groups.read',
};

/**
 * @param {unknown} method
 * @returns {boolean}
 */
function isAllowedDshBotsMethod(method) {
  return typeof method === 'string' && DSH_BOTS_RPC_METHODS.has(method);
}

/**
 * @param {string} method
 * @returns {string}
 */
function resolveDshBotsWireMethod(method) {
  return DSH_BOTS_RPC_WIRE_ALIAS[method] || method;
}

/**
 * @param {unknown} method
 * @returns {boolean}
 */
function isAllowedHostMethod(method) {
  return typeof method === 'string' && HOST_RPC_METHODS.has(method);
}

/** Chunks are redundant once assistant/message exists; 30k of them blow the 30s E2EE RPC. */
const HISTORY_DROP_TYPES = new Set(['assistant/chunk']);
const CATALOG_PROJECTIONS = new Set(['title', 'sessionListMetadata']);

/**
 * @param {unknown} entry
 * @returns {string}
 */
function historyEventType(entry) {
  if (!entry || typeof entry !== 'object') return '';
  const record = /** @type {{ event?: unknown, type?: unknown }} */ (entry);
  const event = record.event && typeof record.event === 'object'
    ? /** @type {{ type?: unknown }} */ (record.event) : null;
  if (typeof event?.type === 'string') return event.type;
  if (typeof record.type === 'string') return record.type;
  return '';
}

/**
 * @param {unknown} method
 * @param {unknown} value
 * @returns {unknown}
 */
function slimHostRpcValue(method, value) {
  const record = value && typeof value === 'object' ? /** @type {Record<string, unknown>} */ (value) : null;
  if (method === 'session.list' && record && Array.isArray(record.items)) {
    return {
      ...record,
      items: record.items.map((item) => {
        const projections = item?.projections;
        if (!projections?.values || typeof projections.values !== 'object') return item;
        return {
          ...item,
          projections: {
            ...projections,
            // Session details are fetched by history when the row is opened.
            // Sending them for every row exhausts the relay deadline on weak links.
            values: Object.fromEntries(Object.entries(projections.values)
              .filter(([key]) => CATALOG_PROJECTIONS.has(key))),
          },
        };
      }),
    };
  }
  if (method !== 'session.history' && method !== 'subagent.history') return value;
  if (!record || !Array.isArray(record.events)) return value;
  return {
    ...record,
    events: record.events.filter((entry) => !HISTORY_DROP_TYPES.has(historyEventType(entry))),
  };
}

/**
 * @param {unknown} origin
 * @returns {string}
 */
function assertLoopbackHarnessOrigin(origin) {
  const raw = typeof origin === 'string' ? origin.trim() : '';
  if (!raw) {
    throw Object.assign(new Error(HARNESS_DOWN_MESSAGE), { code: 'harness-down' });
  }
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw Object.assign(new Error(HARNESS_DOWN_MESSAGE), { code: 'harness-down' });
  }
  if (parsed.protocol !== 'http:') {
    throw new Error('Harness origin must be loopback http');
  }
  const host = parsed.hostname.toLowerCase();
  if (host !== '127.0.0.1' && host !== 'localhost') {
    throw new Error('Harness origin must be loopback http');
  }
  return parsed.origin;
}

function mintRpcId() {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** @type {Record<string, string>} */
const HOST_RPC_ALIAS = {
  'session.history': 'session/page',
  'session.models': 'session/modelCatalog',
  'host.listDirectory': 'directoryPicker/list',
  'host.createDirectory': 'directoryPicker/createDirectory',
  'agentPreset.list': 'agentPresets/list',
};

/** SPA names use dots (`session.list`); 0.1.2 Host Connection is `/api/session/list`. */
/**
 * @param {unknown} method
 * @returns {{ path: string, wireMethod: string }}
 */
function hostRpcTarget(method) {
  const aliased = typeof method === 'string' ? HOST_RPC_ALIAS[method] : undefined;
  if (aliased) return { path: `/api/${aliased}`, wireMethod: aliased };
  const raw = String(method || '');
  const wireMethod = raw.includes('/') ? raw : raw.replaceAll('.', '/');
  return { path: `/api/${wireMethod}`, wireMethod };
}

/** 0.1.2 Typert wire names. `session.list` is `_request` because the Host method is `list(_request, signal)`. */
/** @type {Record<string, string>} */
const HOST_RPC_ARG_WIRE = {
  'session.list': '_request', 'host.describe': '_request',
  'session.search': 'request', 'session.create': 'request', 'session.selectModel': 'request',
  'session.rename': 'request', 'session.fork': 'request', 'session.delete': 'request',
  'session.prompt': 'request', 'session.attachment': 'request', 'session.updateQueue': 'request',
  'session.cancel': 'request', 'session.history': 'request', 'session.projections': 'request',
  'workspace.list': 'request', 'workspace.create': 'request', 'workspace.rename': 'request',
  'workspace.delete': 'request', 'workspace.insertBefore': 'request', 'workspace.insertSessionBefore': 'request',
  'workspace.archiveSession': 'request', 'workspace.unarchiveSession': 'request',
  'mcpServers.upsert': 'request', 'mcpServers.delete': 'request', 'mcpServers.setEnabled': 'request',
  'mcpServers.retry': 'request', 'mcpServers.test': 'request', 'mcpServers.authorize': 'request',
  'skillInventory.list': 'request', 'skillInventory.get': 'request', 'skillInventory.create': 'request',
  'skillInventory.update': 'request', 'skillInventory.delete': 'request',
  'skillInventory.setInvocation': 'request', 'skillInventory.searchHub': 'request', 'skillInventory.installHub': 'request',
};

const REMOTE_STREAM_MUX_PATH = '/api/remote.mux';
const WORKSPACE_FOLLOW_TIMEOUT_MS = 8_000;

/**
 * @param {unknown} payload
 * @returns {Record<string, unknown>}
 */
function spaHistoryRequest(payload) {
  const record = payload && typeof payload === 'object'
    ? /** @type {Record<string, unknown>} */ (payload) : {};
  /** @type {Record<string, unknown>} */
  let address = { kind: 'session', sessionId: record.sessionId };
  if (record.address != null) {
    const supplied = /** @type {Record<string, unknown>} */ (record.address);
    if (supplied.kind === 'session' && typeof supplied.sessionId === 'string' && supplied.sessionId) {
      address = { kind: 'session', sessionId: supplied.sessionId };
    } else if (supplied.kind === 'subagent' && typeof supplied.parentSessionId === 'string' && supplied.parentSessionId
        && typeof supplied.childSessionId === 'string' && supplied.childSessionId
        && typeof supplied.mode === 'string' && ['one-shot', 'continuable', 'unknown'].includes(supplied.mode)) {
      address = { kind: 'subagent', parentSessionId: supplied.parentSessionId, childSessionId: supplied.childSessionId, mode: supplied.mode };
    } else {
      throw new Error('无效的会话历史地址');
    }
  }
  /** @type {Record<string, unknown>} */
  const request = { address };
  if (Number.isInteger(record.throughSeq)) request.throughSeq = record.throughSeq;
  if (Number.isInteger(record.beforeSeq)) request.beforeSeq = record.beforeSeq;
  if (Number.isInteger(record.maxMessages)) request.maxMessages = record.maxMessages;
  return request;
}

/**
 * @param {unknown} payload
 * @returns {Record<string, unknown>}
 */
function spaPromptRequest(payload) {
  const record = payload && typeof payload === 'object'
    ? /** @type {Record<string, unknown>} */ (payload) : {};
  return {
    requestId: record.requestId || mintRpcId(),
    sessionId: record.sessionId,
    mode: record.mode || 'queue',
    content: Array.isArray(record.content) ? record.content : [],
  };
}

/**
 * @param {unknown} method
 * @param {unknown} payload
 * @returns {Record<string, unknown>}
 */
function hostRpcPayload(method, payload) {
  const record = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? /** @type {Record<string, unknown>} */ (payload) : null;
  if (
    record
    && Object.keys(record).length === 1
    && record.args
    && typeof record.args === 'object'
    && !Array.isArray(record.args)
  ) {
    return record;
  }
  if (method === 'session.models') return { args: {} };
  if (method === 'session.history') return { args: { request: spaHistoryRequest(payload) } };
  if (method === 'session.prompt') return { args: { request: spaPromptRequest(payload) } };
  const args = record || {};
  const wire = typeof method === 'string' ? HOST_RPC_ARG_WIRE[method] : undefined;
  if (!wire || Object.prototype.hasOwnProperty.call(args, wire)) {
    return { args };
  }
  return { args: { [wire]: args } };
}

/**
 * @param {unknown} method
 * @param {unknown} value
 * @returns {unknown}
 */
function adaptHostValue(method, value) {
  const record = value && typeof value === 'object' ? /** @type {Record<string, unknown>} */ (value) : null;
  if (method === 'session.history' && record && Array.isArray(record.records)) {
    return {
      events: record.records,
      hasMore: record.hasMore === true,
      projections: record.projections,
    };
  }
  if (method === 'session.models' && record) {
    return { ...record, current: record.current || record.default || null };
  }
  if (method === 'host.createDirectory' && typeof value === 'string' && value) {
    return { path: value };
  }
  return value;
}

/**
 * @param {unknown} raw
 * @returns {string}
 */
function sanitizeHarnessCookie(raw) {
  const first = String(raw || '').split(/\r|\n/)[0].trim();
  if (!first) return '';
  const pair = first.split(';')[0].trim();
  const eq = pair.indexOf('=');
  if (eq <= 0) return '';
  return pair;
}

/**
 * @param {unknown} origin
 * @returns {string}
 */
function remoteMuxUrl(origin) {
  const originUrl = new URL(assertLoopbackHarnessOrigin(origin));
  const target = new URL(REMOTE_STREAM_MUX_PATH, `${originUrl.origin}/`);
  if (target.origin !== originUrl.origin) {
    throw new Error('Harness origin must be loopback http');
  }
  target.protocol = 'ws:';
  return target.href;
}

/**
 * @param {unknown} data
 * @returns {string}
 */
function textFromWsData(data) {
  if (typeof data === 'string') return data;
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(data)) return data.toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('utf8');
  }
  return String(data ?? '');
}

/**
 * @param {unknown} value
 * @returns {Record<string, unknown> | null}
 */
function workspaceListFromFollowFrame(value) {
  if (!value || typeof value !== 'object') return null;
  const record = /** @type {Record<string, unknown>} */ (value);
  const baseline = record.type === 'baseline' && record.value && typeof record.value === 'object'
    ? /** @type {Record<string, unknown>} */ (record.value)
    : (Array.isArray(record.items) ? record : null);
  if (!baseline || !Array.isArray(baseline.items)) return null;
  return {
    items: baseline.items,
    archivedSessionIds: Array.isArray(baseline.archivedSessionIds) ? baseline.archivedSessionIds : [],
    // Host scratch cwd for no-directory Sessions: the phone applies the same
    // membership-or-scratch listing rule as the desktop sidebar.
    scratchCwd: typeof baseline.scratchCwd === 'string' ? baseline.scratchCwd : '',
  };
}

/**
 * Minimal WebSocket surface used below (browser WebSocket and the `ws`
 * package both satisfy it).
 * @typedef {Object} MuxSocket
 * @property {number} readyState
 * @property {(data: string) => void} send
 * @property {() => void} close
 * @property {(type: string, listener: (event: unknown) => void) => void} addEventListener
 */

/**
 * @param {unknown} WebSocketImpl
 * @param {string} href
 * @param {unknown} cookie
 * @returns {MuxSocket}
 */
function openRemoteMuxSocket(WebSocketImpl, href, cookie) {
  const WS = WebSocketImpl || globalThis.WebSocket;
  if (typeof WS !== 'function') {
    throw new Error('workspace follow: WebSocket unavailable');
  }
  const SocketCtor = /** @type {new (url: string, options?: { headers?: Record<string, string> }) => MuxSocket} */ (WS);
  const pair = sanitizeHarnessCookie(cookie);
  /** @type {{ headers: Record<string, string> }} */
  const options = { headers: {} };
  if (pair) options.headers.Cookie = pair;
  // Node / undici: a non-array 2nd argument is options (Cookie on upgrade).
  return new SocketCtor(href, options);
}

/**
 * @param {object} options
 * @param {string} options.origin
 * @param {string | null | undefined} [options.cookie]
 * @param {string} options.endpoint
 * @param {unknown} [options.payload]
 * @param {unknown} [options.WebSocketImpl]
 * @param {AbortSignal} [options.signal]
 * @param {number} [options.timeoutMs]
 * @returns {Promise<unknown>}
 */
function takeFirstRemoteMuxItem({
  origin,
  cookie,
  endpoint,
  payload,
  WebSocketImpl,
  signal,
  timeoutMs = WORKSPACE_FOLLOW_TIMEOUT_MS,
}) {
  const href = remoteMuxUrl(origin);
  const streamId = mintRpcId();
  const socket = openRemoteMuxSocket(WebSocketImpl, href, cookie);
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      finish(new Error('workspace follow timeout'));
    }, timeoutMs);

    /**
     * @param {Error | null} [error]
     * @param {unknown} [value]
     */
    function finish(error, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      try {
        if (socket.readyState === 1) {
          socket.send(JSON.stringify({ type: 'cancel', streamId }));
        }
        socket.close();
      } catch {
        /* ignore teardown */
      }
      if (error) reject(error);
      else resolve(value);
    }

    function onAbort() {
      const reason = signal && signal.reason;
      finish(reason instanceof Error ? reason : new Error('workspace follow aborted'));
    }

    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }

    socket.addEventListener('open', () => {
      try {
        socket.send(JSON.stringify({
          type: 'open',
          streamId,
          endpoint,
          payload: payload && typeof payload === 'object' ? payload : { args: {} },
        }));
      } catch (error) {
        finish(error instanceof Error ? error : new Error('workspace follow open failed'));
      }
    });

    socket.addEventListener('message', (event) => {
      let frame;
      try {
        const data = event && /** @type {{ data?: unknown }} */ (event).data;
        frame = JSON.parse(textFromWsData(data));
      } catch {
        return;
      }
      if (!frame || frame.streamId !== streamId) return;
      if (frame.type === 'item') {
        finish(null, frame.value);
        return;
      }
      if (frame.type === 'error') {
        finish(new Error(frame.error && frame.error.message ? frame.error.message : 'workspace follow error'));
        return;
      }
      if (frame.type === 'end') {
        finish(new Error('workspace follow ended without baseline'));
      }
    });

    socket.addEventListener('error', (event) => {
      const detail = event ? /** @type {{ message?: unknown }} */ (event).message : '';
      const text = detail ? String(detail) : '';
      finish(new Error(text ? `workspace follow socket error: ${text}` : 'workspace follow socket error'));
    });
    socket.addEventListener('close', (event) => {
      if (settled) return;
      const info = event ? /** @type {{ code?: unknown, reason?: unknown }} */ (event) : null;
      const code = info && info.code != null ? String(info.code) : '';
      const reason = info && info.reason ? String(info.reason) : '';
      finish(new Error(`workspace follow closed${code !== '' ? ` ${code}` : ''}${reason ? ` ${reason}` : ''}`));
    });
  });
}

/**
 * @param {URL} originUrl
 * @param {unknown} cookie
 * @returns {Record<string, string>}
 */
function loopbackHeaders(originUrl, cookie) {
  /** @type {Record<string, string>} */
  const headers = {
    'content-type': 'application/json',
    accept: 'application/json',
    'accept-encoding': 'identity',
    host: `${originUrl.hostname}:${originUrl.port || (originUrl.protocol === 'https:' ? '443' : '80')}`,
  };
  const pair = sanitizeHarnessCookie(cookie);
  if (pair) headers.Cookie = pair;
  return headers;
}

/**
 * @param {object} options
 * @param {string} options.origin
 * @param {string} options.path
 * @param {unknown} options.body
 * @param {string | null | undefined} [options.cookie]
 * @param {unknown} [options.fetchImpl]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<unknown>}
 */
async function postHarnessJson({ origin, path, body, cookie, fetchImpl, signal }) {
  const originUrl = new URL(assertLoopbackHarnessOrigin(origin));
  const target = new URL(path, `${originUrl.origin}/`);
  if (target.origin !== originUrl.origin) {
    throw new Error('Harness origin must be loopback http');
  }
  const fetchFn = /** @type {typeof fetch} */ (fetchImpl || globalThis.fetch);
  const response = await fetchFn(target.href, {
    method: 'POST',
    headers: loopbackHeaders(originUrl, cookie),
    body: JSON.stringify(body),
    signal: signal ?? null,
    redirect: 'manual',
  });
  const text = await response.text();
  if (!response.ok) {
    throw Object.assign(new Error(`host HTTP ${response.status}`), {
      status: response.status,
      body: text,
    });
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('host returned non-JSON');
  }
}

/**
 * Forward a whitelisted `dshBots.rpc` call to loopback `POST /dsh-bots/rpc`.
 * Rejects any non-whitelisted bot RPC method before touching the network.
 * @param {object} options
 * @param {string} options.origin
 * @param {unknown} [options.payload]
 * @param {string | null | undefined} [options.cookie]
 * @param {unknown} [options.fetchImpl]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<{ ok: boolean, rpcId: string, value?: unknown, error?: unknown }>}
 */
async function forwardDshBotsRpc({ origin, payload, cookie, fetchImpl, signal }) {
  const raw = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? /** @type {Record<string, unknown>} */ (payload) : {};
  const args = raw.args && typeof raw.args === 'object' && !Array.isArray(raw.args)
    ? /** @type {Record<string, unknown>} */ (raw.args) : raw;
  const botMethod = typeof args.method === 'string' ? args.method.trim() : '';
  if (!isAllowedDshBotsMethod(botMethod)) {
    throw new Error(`dshBots 方法不允许转发：${botMethod || '(empty)'}`);
  }
  const params = args.params && typeof args.params === 'object' && !Array.isArray(args.params)
    ? args.params : {};
  const rpcId = mintRpcId();
  const full = /** @type {{ ok?: unknown, result?: unknown, error?: unknown } | undefined} */ (
    await postHarnessJson({
      origin,
      path: '/dsh-bots/rpc',
      cookie,
      body: { method: resolveDshBotsWireMethod(botMethod), params },
      fetchImpl,
      signal,
    })
  );
  if (full?.ok !== true) {
    return { ok: false, rpcId, error: full?.error || { code: 'internal', message: 'dshBots request failed' } };
  }
  return { ok: true, rpcId, value: full.result };
}

/**
 * @param {object} options
 * @param {string} options.origin
 * @param {unknown} options.method
 * @param {unknown} [options.payload]
 * @param {string | null | undefined} [options.cookie]
 * @param {unknown} [options.fetchImpl]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<unknown> | null}
 */
function tryForwardSpecialHostRpc({ origin, method, payload, cookie, fetchImpl, signal }) {
  if (method === 'dshBots.rpc') {
    return forwardDshBotsRpc({ origin, payload, cookie, fetchImpl, signal });
  }
  if (method === 'workspaceFiles.readImage') {
    const { forwardWorkspaceImage } = require('./dshd-workspace-image.js');
    const wrapped = hostRpcPayload(method, payload ?? {});
    return forwardWorkspaceImage({ origin,
      payload: /** @type {{ workspaceFileScopeId?: unknown, path?: unknown }} */ (wrapped.args),
      cookie, fetchImpl: /** @type {typeof fetch | undefined} */ (fetchImpl), signal });
  }
  if (method === 'account.completeSignIn') {
    const { completeAccountSignIn } = require('./dshd-account-callback.js');
    const wrapped = hostRpcPayload(method, payload ?? {});
    return completeAccountSignIn({ origin,
      payload: /** @type {{ code?: unknown, state?: unknown }} */ (wrapped.args),
      fetchImpl: /** @type {typeof fetch | undefined} */ (fetchImpl), signal });
  }
  return null;
}

/**
 * @param {object} options
 * @param {string} options.origin
 * @param {unknown} options.method
 * @param {unknown} [options.payload]
 * @param {string | null | undefined} [options.cookie]
 * @param {unknown} [options.fetchImpl]
 * @param {AbortSignal} [options.signal]
 * @param {unknown} [options.WebSocketImpl]
 * @returns {Promise<unknown>}
 */
async function forwardHostRpc({ origin, method, payload, cookie, fetchImpl, signal, WebSocketImpl }) {
  if (!isAllowedHostMethod(method)) {
    throw new Error(`host 方法不允许转发：${method}`);
  }
  const special = tryForwardSpecialHostRpc({ origin, method, payload, cookie, fetchImpl, signal });
  if (special) return special;
  const rpcId = mintRpcId();
  const target = hostRpcTarget(method);
  /** @type {{ type?: unknown, rpcId?: unknown, result?: unknown } | undefined} */
  let full;
  try {
    full = /** @type {{ type?: unknown, rpcId?: unknown, result?: unknown }} */ (await postHarnessJson({
      origin,
      path: target.path,
      cookie,
      body: {
        type: 'client-request',
        rpcId,
        method: target.wireMethod,
        payload: hostRpcPayload(method, payload ?? {}),
      },
      fetchImpl,
      signal,
    }));
  } catch (error) {
    const status = error && typeof error === 'object'
      ? /** @type {{ status?: unknown }} */ (error).status : undefined;
    if (method === 'workspace.list' && status === 404) {
      const frame = await takeFirstRemoteMuxItem({
        origin,
        cookie,
        endpoint: 'workspace/follow',
        payload: { args: {} },
        WebSocketImpl,
        signal,
      });
      const value = workspaceListFromFollowFrame(frame);
      if (!value) {
        throw new Error('workspace follow missing baseline');
      }
      return { ok: true, rpcId, value };
    }
    throw error;
  }
  if (full?.type !== 'server-response') {
    throw new Error(`unexpected response type for ${method}`);
  }
  if (full.rpcId && full.rpcId !== rpcId) {
    throw new Error(`rpcId mismatch for ${method}`);
  }
  const result = full.result && typeof full.result === 'object'
    ? /** @type {{ ok?: unknown, error?: unknown, value?: unknown }} */ (full.result) : null;
  if (result?.ok !== true) {
    return {
      ok: false,
      rpcId,
      error: result?.error || { code: 'internal', message: 'request failed' },
    };
  }
  return {
    ok: true,
    rpcId,
    value: slimHostRpcValue(method, adaptHostValue(method, result.value)),
  };
}

/**
 * @param {object} options
 * @param {string} options.origin
 * @param {unknown} options.rpcId
 * @param {unknown} [options.value]
 * @param {string | null | undefined} [options.cookie]
 * @param {unknown} [options.fetchImpl]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<unknown>}
 */
async function forwardHostRespond({ origin, rpcId, value, cookie, fetchImpl, signal }) {
  if (typeof rpcId !== 'string' || !rpcId) {
    throw new Error('respond 缺少 rpcId');
  }
  if (rpcId.startsWith('remote-event:')) {
    const identity = JSON.parse(rpcId.slice('remote-event:'.length));
    const outcome = value && typeof value === 'object'
      ? /** @type {{ outcome?: unknown }} */ (value).outcome : undefined;
    if (!(typeof outcome === 'string' && ['allowed-once', 'rejected'].includes(outcome))) {
      throw new Error('approval outcome 无效');
    }
    return forwardRemoteEventResult({ origin, cookie, fetchImpl, signal, clientId: identity.clientId, eventId: identity.eventId,
      outcome: { kind: 'result', value: outcome } });
  }
  return postHarnessJson({
    origin,
    path: '/api/respond',
    cookie,
    body: {
      type: 'client-response',
      rpcId,
      result: { ok: true, value },
    },
    fetchImpl,
    signal,
  });
}

/**
 * @param {object} options
 * @param {string} options.origin
 * @param {string | null | undefined} [options.cookie]
 * @param {unknown} options.clientId
 * @param {unknown} options.eventId
 * @param {unknown} options.outcome
 * @param {unknown} [options.fetchImpl]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<unknown>}
 */
async function forwardRemoteEventResult({ origin, cookie, clientId, eventId, outcome, fetchImpl, signal }) {
  if (typeof clientId !== 'string' || !clientId || typeof eventId !== 'string' || !eventId) {
    throw new Error('Remote event 缺少关联 id');
  }
  const rpcId = mintRpcId();
  const full = /** @type {{ type?: unknown, rpcId?: unknown, result?: unknown } | undefined} */ (
    await postHarnessJson({ origin, cookie, fetchImpl, signal, path: '/api/$events/result',
      body: { type: 'client-request', rpcId, method: '$events/result', payload: { args: { clientId, eventId, outcome } } } }));
  const result = full?.result && typeof full.result === 'object'
    ? /** @type {{ ok?: unknown, error?: unknown }} */ (full.result) : null;
  const resultError = result?.error && typeof result.error === 'object'
    ? /** @type {{ message?: unknown }} */ (result.error) : null;
  if (full?.type !== 'server-response' || full.rpcId !== rpcId || result?.ok !== true) {
    throw new Error(/** @type {string | undefined} */ (resultError?.message) || 'Remote event 回复失败');
  }
  return full;
}

module.exports = {
  HARNESS_DOWN_MESSAGE, HOST_RPC_METHODS, DSH_BOTS_RPC_METHODS,
  isAllowedHostMethod, isAllowedDshBotsMethod, resolveDshBotsWireMethod,
  assertLoopbackHarnessOrigin, hostRpcTarget, hostRpcPayload, sanitizeHarnessCookie,
  forwardHostRpc, forwardDshBotsRpc, forwardHostRespond, forwardRemoteEventResult, slimHostRpcValue,
};
