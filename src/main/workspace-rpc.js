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

/**
 * @param {string} baseUrl
 * @param {string} method
 * @param {Record<string, unknown>} args
 * @param {typeof fetch} [fetchImpl]
 * @param {{ cookie?: string, signal?: AbortSignal }} [options]
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
  /** @type {RequestInit} */
  const init = {
    method: 'POST',
    headers,
    body: JSON.stringify({
      type: 'client-request',
      rpcId,
      method,
      payload: { args: args && typeof args === 'object' && !Array.isArray(args) ? args : {} },
    }),
  };
  if (options.signal) {
    init.signal = options.signal;
  }
  const response = await fetchImpl(rpcEndpoint(baseUrl, method), init);
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
