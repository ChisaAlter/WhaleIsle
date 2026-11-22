/**
 * Local loopback HTTP metering proxy forwarding requests to `--base-url` while capturing
 * token usage, payload sizes, step-1 system role/tool inventory, and finish reasons
 * without recording or exposing credentials.
 * @module scripts/eval-harness/proxy
 */

import http from 'node:http';
import https from 'node:https';
import { readBodyLimited } from '../../src/shared/secret.js';

const MAX_PROXY_BODY_BYTES = 16 * 1024 * 1024;
const MAX_RESPONSE_INSPECT_BYTES = 8 * 1024 * 1024;

/**
 * @typedef {object} MeteringMetrics
 * @property {number} httpRequests
 * @property {number} mainHttpRequests
 * @property {number | null} step1Bytes
 * @property {number | null} step1PromptTokens
 * @property {number} totalPromptTokens
 * @property {number} totalCompletionTokens
 * @property {string | null} step1SystemRole
 * @property {number | null} step1ToolCount
 * @property {string[]} step1Tools
 * @property {string[]} finishReasons
 */

/**
 * Safely parse JSON without throwing on malformed or partial chunks.
 * @param {string} text
 * @returns {Record<string, unknown> | null}
 */
function safeParseJsonObject(text) {
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return /** @type {Record<string, unknown>} */ (parsed);
    }
    return null;
  } catch (error) {
    // Malformed upstream or streaming line fragments do not interrupt proxy forwarding.
    void error;
    return null;
  }
}

/**
 * Extract tool names from OpenAI Chat Completions, Responses, or Anthropic tool specs.
 * @param {unknown} rawTools
 * @returns {string[]}
 */
function extractToolNames(rawTools) {
  if (!Array.isArray(rawTools)) return [];
  /** @type {string[]} */
  const names = [];
  for (const item of rawTools) {
    if (typeof item !== 'object' || item === null) continue;
    const rec = /** @type {Record<string, unknown>} */ (item);
    if (typeof rec.name === 'string') {
      names.push(rec.name);
      continue;
    }
    if (typeof rec.function === 'object' && rec.function !== null) {
      const fnName = /** @type {Record<string, unknown>} */ (rec.function).name;
      if (typeof fnName === 'string') names.push(fnName);
    }
  }
  return names;
}

/**
 * Detect system/developer prompt placement in step-1 payload.
 * @param {Record<string, unknown>} payload
 * @returns {string | null}
 */
function extractSystemRole(payload) {
  if (Array.isArray(payload.messages) && payload.messages.length > 0) {
    const first = payload.messages[0];
    if (typeof first === 'object' && first !== null) {
      const role = /** @type {Record<string, unknown>} */ (first).role;
      if (typeof role === 'string') return role;
    }
  }
  if (typeof payload.instructions === 'string') return 'instructions';
  if (payload.system !== undefined) return 'anthropic-system';
  return null;
}

/**
 * Extract numeric usage tokens from OpenAI Chat/Responses or Anthropic payloads.
 * @param {Record<string, unknown>} obj
 * @returns {{ promptTokens: number, completionTokens: number }}
 */
function extractUsageFromEvent(obj) {
  const responseObj = typeof obj.response === 'object' && obj.response !== null
    ? /** @type {Record<string, unknown>} */ (obj.response)
    : null;
  const usageSource = obj.usage ?? responseObj?.usage;
  if (typeof usageSource !== 'object' || usageSource === null) {
    return { promptTokens: 0, completionTokens: 0 };
  }
  const usage = /** @type {Record<string, unknown>} */ (usageSource);
  const rawPrompt = typeof usage.prompt_tokens === 'number'
    ? usage.prompt_tokens
    : typeof usage.input_tokens === 'number'
      ? usage.input_tokens
      : 0;
  const rawCompletion = typeof usage.completion_tokens === 'number'
    ? usage.completion_tokens
    : typeof usage.output_tokens === 'number'
      ? usage.output_tokens
      : 0;
  return { promptTokens: rawPrompt, completionTokens: rawCompletion };
}

/**
 * Extract finish reason from a JSON response or SSE chunk.
 * @param {Record<string, unknown>} obj
 * @returns {string | null}
 */
function extractFinishReason(obj) {
  if (Array.isArray(obj.choices) && obj.choices.length > 0) {
    const first = obj.choices[0];
    if (typeof first === 'object' && first !== null) {
      const reason = /** @type {Record<string, unknown>} */ (first).finish_reason;
      if (typeof reason === 'string') return reason;
    }
  }
  if (typeof obj.delta === 'object' && obj.delta !== null) {
    const stopReason = /** @type {Record<string, unknown>} */ (obj.delta).stop_reason;
    if (typeof stopReason === 'string') return stopReason;
  }
  if (typeof obj.stop_reason === 'string') return obj.stop_reason;
  return null;
}

/**
 * Parse accumulated JSON or SSE response body for token counts and finish reasons.
 * @param {string} rawText
 * @returns {{ promptTokens: number, completionTokens: number, finishReason: string | null }}
 */
function inspectResponseBody(rawText) {
  const trimmed = rawText.trim();
  if (!trimmed) return { promptTokens: 0, completionTokens: 0, finishReason: null };
  if (trimmed.startsWith('{')) {
    const parsed = safeParseJsonObject(trimmed);
    if (!parsed) return { promptTokens: 0, completionTokens: 0, finishReason: null };
    const usage = extractUsageFromEvent(parsed);
    return { ...usage, finishReason: extractFinishReason(parsed) };
  }
  let promptTokens = 0;
  let completionTokens = 0;
  /** @type {string | null} */
  let finishReason = null;
  for (const line of trimmed.split(/\r?\n/u)) {
    if (!line.startsWith('data:')) continue;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') continue;
    const parsed = safeParseJsonObject(data);
    if (!parsed) continue;
    const usage = extractUsageFromEvent(parsed);
    if (usage.promptTokens > promptTokens) promptTokens = usage.promptTokens;
    if (usage.completionTokens > completionTokens) completionTokens = usage.completionTokens;
    const reason = extractFinishReason(parsed);
    if (reason) finishReason = reason;
  }
  return { promptTokens, completionTokens, finishReason };
}

/**
 * Combine upstream target base URL and incoming path without duplicating trailing `/v1`.
 * @param {URL} upstreamBase
 * @param {string} incomingPath
 * @returns {URL}
 */
function buildForwardUrl(upstreamBase, incomingPath) {
  const basePath = upstreamBase.pathname.replace(/\/+$/u, '');
  let pathPart = incomingPath.startsWith('/') ? incomingPath : `/${incomingPath}`;
  if (basePath.endsWith('/v1') && (pathPart === '/v1' || pathPart.startsWith('/v1/'))) {
    pathPart = pathPart.slice(3) || '/';
  }
  const url = new URL(upstreamBase.toString());
  const parsedIncoming = new URL(pathPart, 'http://proxy.invalid');
  url.pathname = `${basePath}${parsedIncoming.pathname}` || '/';
  url.search = parsedIncoming.search;
  return url;
}

/**
 * Strip hop-by-hop headers before forwarding upstream.
 * @param {http.IncomingHttpHeaders} incoming
 * @param {string} targetHost
 * @param {number} bodyLength
 * @returns {Record<string, string | string[]>}
 */
function buildForwardHeaders(incoming, targetHost, bodyLength) {
  /** @type {Record<string, string | string[]>} */
  const out = {};
  for (const [key, value] of Object.entries(incoming)) {
    if (value === undefined) continue;
    const lower = key.toLowerCase();
    if (lower === 'host' || lower === 'connection' || lower === 'content-length') continue;
    out[key] = value;
  }
  out.host = targetHost;
  if (bodyLength > 0) {
    out['content-length'] = String(bodyLength);
  }
  return out;
}

/**
 * Create a mutable metering accumulator and bind per-request capture.
 * @returns {{
 *   recordRequest: (requestBytes: number, bodyText: string) => { isMain: boolean, isStep1: boolean },
 *   recordResponse: (rawResponseText: string, isStep1: boolean) => void,
 *   snapshot: () => MeteringMetrics,
 * }}
 */
function createMetricsState() {
  let httpRequests = 0;
  let mainHttpRequests = 0;
  /** @type {number | null} */
  let step1Bytes = null;
  /** @type {number | null} */
  let step1PromptTokens = null;
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  /** @type {string | null} */
  let step1SystemRole = null;
  /** @type {number | null} */
  let step1ToolCount = null;
  /** @type {string[]} */
  let step1Tools = [];
  /** @type {string[]} */
  const finishReasons = [];

  return {
    recordRequest(requestBytes, bodyText) {
      httpRequests += 1;
      const parsed = safeParseJsonObject(bodyText);
      const tools = parsed ? extractToolNames(parsed.tools) : [];
      const hasMessages = Boolean(parsed && (Array.isArray(parsed.messages) || parsed.input !== undefined));
      const isMain = hasMessages && tools.length > 0;
      if (isMain) mainHttpRequests += 1;
      const isStep1 = isMain && step1Bytes === null;
      if (isStep1 && parsed) {
        step1Bytes = requestBytes;
        step1ToolCount = tools.length;
        step1Tools = tools;
        step1SystemRole = extractSystemRole(parsed);
      }
      return { isMain, isStep1 };
    },
    recordResponse(rawResponseText, isStep1) {
      const parsed = inspectResponseBody(rawResponseText);
      totalPromptTokens += parsed.promptTokens;
      totalCompletionTokens += parsed.completionTokens;
      if (isStep1 && parsed.promptTokens > 0) {
        step1PromptTokens = parsed.promptTokens;
      }
      if (parsed.finishReason) {
        finishReasons.push(parsed.finishReason);
      }
    },
    snapshot() {
      return {
        httpRequests,
        mainHttpRequests,
        step1Bytes,
        step1PromptTokens,
        totalPromptTokens,
        totalCompletionTokens,
        step1SystemRole,
        step1ToolCount,
        step1Tools: [...step1Tools],
        finishReasons: [...finishReasons],
      };
    },
  };
}

/**
 * Forward one request through `http`/`https` without inheriting ambient proxy settings.
 * @param {URL} targetUrl
 * @param {string} method
 * @param {Record<string, string | string[]>} headers
 * @param {Buffer} bodyBuf
 * @param {http.ServerResponse} clientRes
 * @param {(responseText: string) => void} onComplete
 */
function forwardUpstream(targetUrl, method, headers, bodyBuf, clientRes, onComplete) {
  const transport = targetUrl.protocol === 'https:' ? https : http;
  const upstreamReq = transport.request(
    targetUrl,
    { method, headers },
    (upstreamRes) => {
      clientRes.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
      /** @type {Buffer[]} */
      const captured = [];
      let capturedBytes = 0;
      upstreamRes.on('data', (chunk) => {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        if (capturedBytes + buf.byteLength <= MAX_RESPONSE_INSPECT_BYTES) {
          captured.push(buf);
          capturedBytes += buf.byteLength;
        }
        clientRes.write(buf);
      });
      upstreamRes.on('end', () => {
        clientRes.end();
        onComplete(Buffer.concat(captured).toString('utf8'));
      });
      upstreamRes.on('error', (error) => {
        if (!clientRes.headersSent) clientRes.writeHead(502);
        if (!clientRes.writableEnded) clientRes.end(String(error));
        onComplete('');
      });
    },
  );
  upstreamReq.on('error', (error) => {
    if (!clientRes.headersSent) {
      clientRes.writeHead(502, { 'content-type': 'application/json' });
    }
    if (!clientRes.writableEnded) {
      clientRes.end(JSON.stringify({ error: { message: error.message } }));
    }
    onComplete('');
  });
  if (bodyBuf.byteLength > 0) upstreamReq.write(bodyBuf);
  upstreamReq.end();
}

/**
 * Start a localhost HTTP metering proxy forwarding requests to `targetBaseUrl`.
 * @param {string} targetBaseUrl
 * @returns {Promise<{
 *   url: string,
 *   snapshotMetrics: () => MeteringMetrics,
 *   resetMetrics: () => void,
 *   close: () => Promise<void>,
 * }>}
 */
export async function startMeteringProxy(targetBaseUrl) {
  const upstreamBase = new URL(targetBaseUrl);
  let state = createMetricsState();

  const server = http.createServer(async (req, res) => {
    /** @type {Buffer} */
    let bodyBuf;
    try {
      const read = await readBodyLimited(req, MAX_PROXY_BODY_BYTES, { buffer: true, res });
      bodyBuf = Buffer.isBuffer(read) ? read : Buffer.from(read);
    } catch (error) {
      if (!res.headersSent) {
        const status = /** @type {{ code?: string } | undefined} */ (error)?.code === 'BODY_TOO_LARGE' ? 413 : 400;
        res.writeHead(status, { connection: 'close' });
      }
      if (!res.writableEnded) res.end();
      return;
    }
    const targetUrl = buildForwardUrl(upstreamBase, req.url ?? '/');
    const headers = buildForwardHeaders(req.headers, upstreamBase.host, bodyBuf.byteLength);
    const meta = state.recordRequest(bodyBuf.byteLength, bodyBuf.toString('utf8'));
    forwardUpstream(targetUrl, req.method ?? 'POST', headers, bodyBuf, res, (responseText) => {
      state.recordResponse(responseText, meta.isStep1);
    });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve(undefined);
    });
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('Failed to bind metering proxy on loopback');
  }
  const url = `http://127.0.0.1:${address.port}`;

  return {
    url,
    snapshotMetrics: () => state.snapshot(),
    resetMetrics: () => {
      state = createMetricsState();
    },
    close: () => new Promise((resolve) => {
      server.closeAllConnections?.();
      server.close(() => resolve());
    }),
  };
}
