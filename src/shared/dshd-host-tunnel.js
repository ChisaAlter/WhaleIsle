'use strict';

/** Visible when `dsh web` is not listening / origin not yet known. */
const HARNESS_DOWN_MESSAGE = '桌面端未启动';

const HOST_RPC_METHODS = new Set([
  'host.describe',
  'host.listDirectory',
  'host.createDirectory',
  'session.list',
  'session.search',
  'session.create',
  'session.history',
  'session.projections',
  'session.models',
  'session.selectModel',
  'session.rename',
  'session.fork',
  'session.prompt',
  'session.attachment',
  'session.updateQueue',
  'session.cancel',
  'session.delete',
  'subagent.list',
  'subagent.history',
  'subagent.prompt',
  'subagent.interrupt',
  'workspace.list',
  'workspace.create',
  'workspace.rename',
  'workspace.delete',
  'workspace.insertBefore',
  'workspace.insertSessionBefore',
  'workspace.archiveSession',
  'workspace.unarchiveSession',
  'skill.list',
  'agentPreset.list',
  'llm.models',
  'llm.providers',
  'commands/list',
  'commands/execute',
]);

function isAllowedHostMethod(method) {
  return typeof method === 'string' && HOST_RPC_METHODS.has(method);
}

/** Chunks are redundant once assistant/message exists; 30k of them blow the 30s E2EE RPC. */
const HISTORY_DROP_TYPES = new Set(['assistant/chunk']);
const CATALOG_PROJECTIONS = new Set(['title', 'sessionListMetadata']);

function historyEventType(entry) {
  if (!entry || typeof entry !== 'object') return '';
  if (entry.event && typeof entry.event.type === 'string') return entry.event.type;
  if (typeof entry.type === 'string') return entry.type;
  return '';
}

function slimHostRpcValue(method, value) {
  if (method === 'session.list' && value && Array.isArray(value.items)) {
    return {
      ...value,
      items: value.items.map((item) => {
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
  if (!value || typeof value !== 'object' || !Array.isArray(value.events)) return value;
  return {
    ...value,
    events: value.events.filter((entry) => !HISTORY_DROP_TYPES.has(historyEventType(entry))),
  };
}

function assertLoopbackHarnessOrigin(origin) {
  const raw = typeof origin === 'string' ? origin.trim() : '';
  if (!raw) {
    const error = new Error(HARNESS_DOWN_MESSAGE);
    error.code = 'harness-down';
    throw error;
  }
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    const error = new Error(HARNESS_DOWN_MESSAGE);
    error.code = 'harness-down';
    throw error;
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

const HOST_RPC_ALIAS = {
  'session.history': 'session/page',
  'session.models': 'session/modelCatalog',
  'host.listDirectory': 'directoryPicker/list',
  'host.createDirectory': 'directoryPicker/createDirectory',
  'agentPreset.list': 'agentPresets/list',
};

/** SPA names use dots (`session.list`); 0.1.2 Host Connection is `/api/session/list`. */
function hostRpcTarget(method) {
  const aliased = HOST_RPC_ALIAS[method];
  if (aliased) return { path: `/api/${aliased}`, wireMethod: aliased };
  const raw = String(method || '');
  const wireMethod = raw.includes('/') ? raw : raw.replaceAll('.', '/');
  return { path: `/api/${wireMethod}`, wireMethod };
}

/** 0.1.2 Typert wire names. `session.list` is `_request` because the Host method is `list(_request, signal)`. */
const HOST_RPC_ARG_WIRE = {
  'session.list': '_request',
  'session.search': 'request',
  'session.create': 'request',
  'session.selectModel': 'request',
  'session.rename': 'request',
  'session.fork': 'request',
  'session.delete': 'request',
  'session.prompt': 'request',
  'session.attachment': 'request',
  'session.updateQueue': 'request',
  'session.cancel': 'request',
  'session.history': 'request',
  'session.projections': 'request',
  'workspace.list': 'request',
  'workspace.create': 'request',
  'workspace.rename': 'request',
  'workspace.delete': 'request',
  'workspace.insertBefore': 'request',
  'workspace.insertSessionBefore': 'request',
  'workspace.archiveSession': 'request',
  'workspace.unarchiveSession': 'request',
  'host.describe': '_request',
};

const REMOTE_STREAM_MUX_PATH = '/api/remote.mux';
const WORKSPACE_FOLLOW_TIMEOUT_MS = 8_000;

function spaHistoryRequest(payload) {
  const request = {
    address: { kind: 'session', sessionId: payload?.sessionId },
    throughSeq: Number.isInteger(payload?.throughSeq) ? payload.throughSeq : 1_000_000_000,
  };
  if (Number.isInteger(payload?.beforeSeq)) request.beforeSeq = payload.beforeSeq;
  if (Number.isInteger(payload?.maxMessages)) request.maxMessages = payload.maxMessages;
  return request;
}

function spaPromptRequest(payload) {
  return {
    requestId: payload?.requestId || mintRpcId(),
    sessionId: payload?.sessionId,
    mode: payload?.mode || 'queue',
    content: Array.isArray(payload?.content) ? payload.content : [],
  };
}

function hostRpcPayload(method, payload) {
  if (
    payload
    && typeof payload === 'object'
    && !Array.isArray(payload)
    && Object.keys(payload).length === 1
    && payload.args
    && typeof payload.args === 'object'
    && !Array.isArray(payload.args)
  ) {
    return payload;
  }
  if (method === 'session.models') return { args: {} };
  if (method === 'session.history') return { args: { request: spaHistoryRequest(payload) } };
  if (method === 'session.prompt') return { args: { request: spaPromptRequest(payload) } };
  const args = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  const wire = HOST_RPC_ARG_WIRE[method];
  if (!wire || Object.prototype.hasOwnProperty.call(args, wire)) {
    return { args };
  }
  return { args: { [wire]: args } };
}

function adaptHostValue(method, value) {
  if (method === 'session.history' && value && Array.isArray(value.records)) {
    return {
      events: value.records,
      hasMore: value.hasMore === true,
      projections: value.projections,
    };
  }
  if (method === 'session.models' && value && typeof value === 'object') {
    return { ...value, current: value.current || value.default || null };
  }
  if (method === 'host.createDirectory' && typeof value === 'string' && value) {
    return { path: value };
  }
  return value;
}

function cursorFromPageError(message) {
  const match = /past cursor (-?\d+)/.exec(String(message || ''));
  return match ? Number(match[1]) : null;
}

function sanitizeHarnessCookie(raw) {
  const first = String(raw || '').split(/\r|\n/)[0].trim();
  if (!first) return '';
  const pair = first.split(';')[0].trim();
  const eq = pair.indexOf('=');
  if (eq <= 0) return '';
  return pair;
}

function remoteMuxUrl(origin) {
  const originUrl = new URL(assertLoopbackHarnessOrigin(origin));
  const target = new URL(REMOTE_STREAM_MUX_PATH, `${originUrl.origin}/`);
  if (target.origin !== originUrl.origin) {
    throw new Error('Harness origin must be loopback http');
  }
  target.protocol = 'ws:';
  return target.href;
}

function textFromWsData(data) {
  if (typeof data === 'string') return data;
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(data)) return data.toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('utf8');
  }
  return String(data ?? '');
}

function workspaceListFromFollowFrame(value) {
  if (!value || typeof value !== 'object') return null;
  const baseline = value.type === 'baseline' && value.value && typeof value.value === 'object'
    ? value.value
    : (Array.isArray(value.items) ? value : null);
  if (!baseline || !Array.isArray(baseline.items)) return null;
  return {
    items: baseline.items,
    archivedSessionIds: Array.isArray(baseline.archivedSessionIds) ? baseline.archivedSessionIds : [],
    // Host scratch cwd for no-directory Sessions: the phone applies the same
    // membership-or-scratch listing rule as the desktop sidebar.
    scratchCwd: typeof baseline.scratchCwd === 'string' ? baseline.scratchCwd : '',
  };
}

function openRemoteMuxSocket(WebSocketImpl, href, cookie) {
  const WS = WebSocketImpl || globalThis.WebSocket;
  if (typeof WS !== 'function') {
    throw new Error('workspace follow: WebSocket unavailable');
  }
  const pair = sanitizeHarnessCookie(cookie);
  const options = { headers: {} };
  if (pair) options.headers.Cookie = pair;
  // Node / undici: a non-array 2nd argument is options (Cookie on upgrade).
  return new WS(href, options);
}

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
        frame = JSON.parse(textFromWsData(event && event.data));
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
      const detail = event && event.message ? event.message : '';
      finish(new Error(detail ? `workspace follow socket error: ${detail}` : 'workspace follow socket error'));
    });
    socket.addEventListener('close', (event) => {
      if (settled) return;
      const code = event && event.code != null ? event.code : '';
      const reason = event && event.reason ? event.reason : '';
      finish(new Error(`workspace follow closed${code !== '' ? ` ${code}` : ''}${reason ? ` ${reason}` : ''}`));
    });
  });
}

function loopbackHeaders(originUrl, cookie) {
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

async function postHarnessJson({ origin, path, body, cookie, fetchImpl, signal }) {
  const originUrl = new URL(assertLoopbackHarnessOrigin(origin));
  const target = new URL(path, `${originUrl.origin}/`);
  if (target.origin !== originUrl.origin) {
    throw new Error('Harness origin must be loopback http');
  }
  const fetchFn = fetchImpl || globalThis.fetch;
  const response = await fetchFn(target.href, {
    method: 'POST',
    headers: loopbackHeaders(originUrl, cookie),
    body: JSON.stringify(body),
    signal,
    redirect: 'manual',
  });
  const text = await response.text();
  if (!response.ok) {
    const error = new Error(`host HTTP ${response.status}`);
    error.status = response.status;
    error.body = text;
    throw error;
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('host returned non-JSON');
  }
}

async function forwardHostRpc({ origin, method, payload, cookie, fetchImpl, signal, WebSocketImpl }) {
  if (!isAllowedHostMethod(method)) {
    throw new Error(`host 方法不允许转发：${method}`);
  }
  const rpcId = mintRpcId();
  const target = hostRpcTarget(method);
  let full;
  try {
    full = await postHarnessJson({
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
    });
  } catch (error) {
    if (method === 'workspace.list' && error && error.status === 404) {
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
  if (!full.result || full.result.ok !== true) {
    const cursor = method === 'session.history'
      ? cursorFromPageError(full.result?.error?.message)
      : null;
    if (cursor !== null && !Number.isInteger(payload?.throughSeq)) {
      return forwardHostRpc({
        origin,
        method,
        payload: { ...(payload || {}), throughSeq: cursor },
        cookie,
        fetchImpl,
        signal,
      });
    }
    return {
      ok: false,
      rpcId,
      error: full.result?.error || { code: 'internal', message: 'request failed' },
    };
  }
  return {
    ok: true,
    rpcId,
    value: slimHostRpcValue(method, adaptHostValue(method, full.result.value)),
  };
}

async function forwardHostRespond({ origin, rpcId, value, cookie, fetchImpl, signal }) {
  if (typeof rpcId !== 'string' || !rpcId) {
    throw new Error('respond 缺少 rpcId');
  }
  if (rpcId.startsWith('remote-event:')) {
    const identity = JSON.parse(rpcId.slice('remote-event:'.length));
    if (!['allowed-once', 'rejected'].includes(value?.outcome)) throw new Error('approval outcome 无效');
    return forwardRemoteEventResult({ origin, cookie, fetchImpl, signal, clientId: identity.clientId, eventId: identity.eventId,
      outcome: { kind: 'result', value: value.outcome } });
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

async function forwardRemoteEventResult({ origin, cookie, clientId, eventId, outcome, fetchImpl, signal }) {
  if (typeof clientId !== 'string' || !clientId || typeof eventId !== 'string' || !eventId) {
    throw new Error('Remote event 缺少关联 id');
  }
  const rpcId = mintRpcId();
  const full = await postHarnessJson({ origin, cookie, fetchImpl, signal, path: '/api/$events/result',
    body: { type: 'client-request', rpcId, method: '$events/result', payload: { args: { clientId, eventId, outcome } } } });
  if (full?.type !== 'server-response' || full.rpcId !== rpcId || full.result?.ok !== true) {
    throw new Error(full?.result?.error?.message || 'Remote event 回复失败');
  }
  return full;
}

module.exports = {
  HARNESS_DOWN_MESSAGE,
  HOST_RPC_METHODS,
  REMOTE_STREAM_MUX_PATH,
  isAllowedHostMethod,
  assertLoopbackHarnessOrigin,
  hostRpcTarget,
  hostRpcPayload,
  sanitizeHarnessCookie,
  workspaceListFromFollowFrame,
  forwardHostRpc,
  forwardHostRespond,
  forwardRemoteEventResult,
  slimHostRpcValue,
};
