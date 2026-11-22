const { randomUUID } = require('crypto');

/** One Typert Remote segment (`workspace`, `create`). Dots are not separators. */
const RPC_SEGMENT = /^[A-Za-z0-9_$.-]+$/;

function rpcMethodPath(method) {
  const text = String(method || '');
  const segments = text.split('/');
  if (segments.length !== 2 || segments.some((segment) => !RPC_SEGMENT.test(segment))) {
    throw new Error(`RPC 方法不是 namespace/verb：${text}`);
  }
  return `/api/${segments[0]}/${segments[1]}`;
}

function rpcEndpoint(baseUrl, method) {
  const endpoint = new URL(baseUrl);
  endpoint.pathname = rpcMethodPath(method);
  endpoint.search = '';
  endpoint.hash = '';
  return endpoint.toString();
}

/** Default per-RPC timeout when callers do not supply an explicit signal/timeout. */
const DEFAULT_RPC_TIMEOUT_MS = 15_000;

function raceRpcTimeout(fetchPromise, method, timeoutMs, controller, externalSignal) {
  let timer = null;
  let timedOut = false;
  let onExternalAbort = null;
  const timeoutError = Object.assign(new Error(`RPC ${method} 超时（${timeoutMs}ms）`), { code: 'ETIMEDOUT' });
  const timeoutPromise = new Promise((_, reject) => {
    if (externalSignal) {
      if (externalSignal.aborted) controller.abort(externalSignal.reason);
      else {
        onExternalAbort = () => controller.abort(externalSignal.reason);
        externalSignal.addEventListener('abort', onExternalAbort, { once: true });
      }
    }
    if (timeoutMs > 0 && Number.isFinite(timeoutMs)) {
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort(timeoutError);
        reject(timeoutError);
      }, timeoutMs);
    }
  });
  return Promise.race([
    fetchPromise.catch((err) => {
      throw timedOut ? timeoutError : err;
    }),
    timeoutPromise,
  ]).finally(() => {
    if (timer !== null) clearTimeout(timer);
    if (externalSignal && onExternalAbort) externalSignal.removeEventListener('abort', onExternalAbort);
  });
}

/**
 * @param {string} baseUrl
 * @param {string} method
 * @param {Record<string, unknown>} args
 * @param {typeof fetch} [fetchImpl]
 * @param {{ cookie?: string, signal?: AbortSignal, timeoutMs?: number }} [options]
 */
async function rpc(baseUrl, method, args, fetchImpl = fetch, options = {}) {
  const rpcId = randomUUID();
  /** @type {Record<string, string>} */
  const headers = {
    'content-type': 'application/json',
  };
  if (options.cookie) {
    headers.Cookie = options.cookie;
  }
  const timeoutMs = typeof options.timeoutMs === 'number' ? options.timeoutMs : DEFAULT_RPC_TIMEOUT_MS;
  const controller = new AbortController();
  /** @type {RequestInit} */
  const init = {
    method: 'POST',
    headers,
    signal: controller.signal,
    body: JSON.stringify({
      type: 'client-request',
      rpcId,
      method,
      payload: { args: args && typeof args === 'object' && !Array.isArray(args) ? args : {} },
    }),
  };
  const response = await raceRpcTimeout(
    Promise.resolve().then(() => fetchImpl(rpcEndpoint(baseUrl, method), init)),
    method,
    timeoutMs,
    controller,
    options.signal,
  );
  const body = await response.text();
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error(`RPC ${method} 返回非 JSON（HTTP ${response.status}）`);
  }
  if (!response.ok) {
    throw new Error(`RPC ${method} HTTP ${response.status}: ${body.slice(0, 240)}`);
  }
  if (parsed?.type !== 'server-response' || parsed.rpcId !== rpcId || typeof parsed?.result?.ok !== 'boolean') {
    throw new Error(`RPC ${method} 返回无效响应`);
  }
  if (parsed.result.ok === false) {
    const error = parsed.result.error;
    throw new Error(error?.message || `${method} 失败`);
  }
  return parsed.result.value;
}

async function ensureWorkspace(baseUrl, workspacePath, fetchImpl = fetch, options = {}) {
  return rpc(baseUrl, 'workspace/create', { request: { path: workspacePath } }, fetchImpl, options);
}

module.exports = {
  rpc,
  rpcMethodPath,
  ensureWorkspace,
};
