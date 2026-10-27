'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { forwardHostRpc } = require('./dshd-host-tunnel');
const { IMAGE_MAX_BYTES } = require('./dshd-workspace-image');

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1xkAAAAASUVORK5CYII=', 'base64');

function binaryResponse(request, bytes = png, patch = {}) {
  const form = new FormData();
  form.set('bytes-0', new Blob([bytes]));
  form.set('metadata', JSON.stringify({ type: 'server-response', rpcId: request.rpcId,
    result: { ok: true, value: { absolutePath: '/qa/image.png', version: 'v1', bytes: bytes.length,
      offset: 0, eof: true, data: null, ...patch } },
    attachments: [{ path: ['data'], codec: 'bytes', part: 'bytes-0' }] }));
  return new Response(form);
}

function read(fetchImpl, payload = { workspaceFileScopeId: 'qa-session', path: 'image.png' }) {
  return forwardHostRpc({ origin: 'http://127.0.0.1:53876', method: 'workspaceFiles.readImage',
    payload: { args: payload }, cookie: 'dsh-browser-session=qa\r\nInjected: no', fetchImpl });
}

test('image preview retains Session-scoped file permissions, binary bytes and current cookie', async () => {
  let calls = 0;
  const result = await read(async (url, options) => {
    calls++;
    assert.equal(url, 'http://127.0.0.1:53876/api/workspaceFiles/readBytes');
    assert.equal(options.headers.Cookie, 'dsh-browser-session=qa');
    assert.equal(options.headers.host, '127.0.0.1:53876');
    assert.equal(options.headers.Origin, undefined);
    assert.equal(options.redirect, 'manual');
    const request = JSON.parse(options.body);
    assert.equal(request.method, 'workspaceFiles/readBytes');
    assert.deepEqual(request.payload.args, { workspaceFileScopeId: 'qa-session', path: 'image.png',
      options: { range: { offset: 0, length: IMAGE_MAX_BYTES } } });
    return binaryResponse(request);
  });
  assert.equal(calls, 1);
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, { absolutePath: '/qa/image.png', version: 'v1', bytes: png.length,
    mediaType: 'image/png', data: png.toString('base64') });
});

test('file access failures stay actionable rather than becoming an empty preview', async () => {
  const result = await read(async (_url, options) => {
    const request = JSON.parse(options.body);
    return Response.json({ type: 'server-response', rpcId: request.rpcId,
      result: { ok: false, error: { code: 'gateway/lookup-not-found', message: 'No such Session' } } });
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'gateway/lookup-not-found');
});

test('image preview rejects a truncated range, mismatched file size and SVG', async () => {
  for (const patch of [{ eof: false }, { bytes: IMAGE_MAX_BYTES + 1 }, { bytes: png.length + 1 }]) {
    await assert.rejects(read(async (_url, options) => binaryResponse(JSON.parse(options.body), png, patch)), /2 MiB|发生变化/);
  }
  await assert.rejects(read(async (_url, options) => binaryResponse(JSON.parse(options.body), Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))), /不是支持/);
});

test('image preview rejects swapped RPC and attachment paths', async () => {
  await assert.rejects(read(async (_url, options) => binaryResponse({ ...JSON.parse(options.body), rpcId: 'other' })), /元数据/);
  await assert.rejects(read(async (_url, options) => {
    const request = JSON.parse(options.body);
    const form = new FormData();
    form.set('bytes-0', new Blob([png]));
    form.set('metadata', JSON.stringify({ type: 'server-response', rpcId: request.rpcId,
      result: { ok: true, value: { offset: 0, eof: true, absolutePath: '/qa/x', bytes: png.length, data: null } },
      attachments: [{ path: ['__proto__'], codec: 'bytes', part: 'bytes-0' }] }));
    return new Response(form);
  }), /元数据/);
});

test('streaming response limit refuses oversized bytes before decoding multipart', async () => {
  let cancelled = false;
  await assert.rejects(read(async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(IMAGE_MAX_BYTES + 65537)); },
    cancel() { cancelled = true; },
  }), { headers: { 'content-type': 'multipart/form-data; boundary=ignored' } })), /2 MiB/);
  assert.equal(cancelled, true);
});

test('missing Session or file path never sends a request', async () => {
  const fetchImpl = () => { throw new Error('unexpected fetch'); };
  await assert.rejects(read(fetchImpl, { path: 'image.png' }), /缺少/);
  await assert.rejects(read(fetchImpl, { workspaceFileScopeId: 's', path: ' ' }), /缺少/);
});
