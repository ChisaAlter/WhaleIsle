'use strict';

const { randomUUID } = require('node:crypto');
const { assertLoopbackHarnessOrigin, sanitizeHarnessCookie } = require('./dshd-host-tunnel.js');

const IMAGE_MAX_BYTES = 2 * 1024 * 1024;
const RESPONSE_MAX_BYTES = IMAGE_MAX_BYTES + 64 * 1024;

function imageMediaType(data) {
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (data.length >= 3 && data[0] === 255 && data[1] === 216 && data[2] === 255) return 'image/jpeg';
  if (data.length >= 6 && ['GIF87a', 'GIF89a'].includes(data.toString('ascii', 0, 6))) return 'image/gif';
  if (data.length >= 12 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (data.length >= 14 && data.toString('ascii', 0, 2) === 'BM') return 'image/bmp';
  throw new Error('此文件不是支持的 PNG、JPEG、GIF、WebP 或 BMP 图片');
}

async function limitedResponse(response) {
  const declared = Number(response.headers.get('content-length'));
  if (declared > RESPONSE_MAX_BYTES) throw new Error('图片响应超过 2 MiB 上限');
  if (!response.body) throw new Error('图片响应为空');
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > RESPONSE_MAX_BYTES) throw new Error('图片响应超过 2 MiB 上限');
      chunks.push(Buffer.from(value));
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  return new Response(Buffer.concat(chunks, length), { headers: response.headers });
}

/** Transfer one bounded raster preview through the ordinary Session-scoped file service. */
async function forwardWorkspaceImage({ origin, payload, cookie, fetchImpl = globalThis.fetch, signal }) {
  if (!payload || typeof payload.workspaceFileScopeId !== 'string' || !payload.workspaceFileScopeId
      || typeof payload.path !== 'string' || !payload.path.trim()) {
    throw new Error('图片预览缺少会话或文件路径');
  }
  const originUrl = new URL(assertLoopbackHarnessOrigin(origin));
  const rpcId = randomUUID();
  const headers = { 'content-type': 'application/json', accept: 'multipart/form-data, application/json',
    'accept-encoding': 'identity', host: originUrl.host };
  const pair = sanitizeHarnessCookie(cookie);
  if (pair) headers.Cookie = pair;
  const response = await fetchImpl(new URL('/api/workspaceFiles/readBytes', originUrl).href, {
    method: 'POST', headers, signal, redirect: 'manual',
    body: JSON.stringify({ type: 'client-request', rpcId, method: 'workspaceFiles/readBytes',
      payload: { args: { workspaceFileScopeId: payload.workspaceFileScopeId, path: payload.path,
        options: { range: { offset: 0, length: IMAGE_MAX_BYTES } } } } }),
  });
  if (!response.ok) throw new Error(`图片预览 HTTP ${response.status}`);
  const bounded = await limitedResponse(response);
  const mediaType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
  if (mediaType === 'application/json') {
    const full = await bounded.json();
    if (full?.type !== 'server-response' || full.rpcId !== rpcId || full.result?.ok !== false) {
      throw new Error('无效的图片响应');
    }
    return { ok: false, rpcId, error: full.result.error };
  }
  if (mediaType !== 'multipart/form-data') throw new Error('无效的图片响应类型');
  const form = await bounded.formData();
  const metadata = form.getAll('metadata');
  if (metadata.length !== 1 || typeof metadata[0] !== 'string' || metadata[0].length > 16 * 1024) {
    throw new Error('无效的图片响应元数据');
  }
  const full = JSON.parse(metadata[0]);
  const attachment = full?.attachments?.[0];
  const value = full?.result?.value;
  if (full?.type !== 'server-response' || full.rpcId !== rpcId || full.result?.ok !== true
      || full.attachments.length !== 1 || attachment?.codec !== 'bytes'
      || !Array.isArray(attachment.path) || attachment.path.length !== 1 || attachment.path[0] !== 'data'
      || typeof attachment.part !== 'string' || attachment.part === 'metadata'
      || value?.data !== null || value.offset !== 0 || typeof value.absolutePath !== 'string') {
    throw new Error('无效的图片响应元数据');
  }
  const fields = [...form.keys()];
  const parts = form.getAll(attachment.part);
  if (fields.length !== 2 || parts.length !== 1 || !(parts[0] instanceof Blob)) throw new Error('无效的图片响应字段');
  if (!value.eof || !Number.isSafeInteger(value.bytes) || value.bytes < 1 || value.bytes > IMAGE_MAX_BYTES
      || parts[0].size !== value.bytes) throw new Error('图片超过 2 MiB 上限或文件在读取时发生变化');
  const data = Buffer.from(await parts[0].arrayBuffer());
  signal?.throwIfAborted();
  return { ok: true, rpcId, value: { absolutePath: value.absolutePath, version: value.version, bytes: data.length,
    mediaType: imageMediaType(data), data: data.toString('base64') } };
}

module.exports = { IMAGE_MAX_BYTES, forwardWorkspaceImage };
