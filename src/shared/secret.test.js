'use strict';

// node:test coverage for the shared credential/process primitives (#433):
// constantTimeEqual, readBodyLimited, passSecretToChild.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const { EventEmitter } = require('node:events');
const { constantTimeEqual, readBodyLimited, passSecretToChild } = require('./secret');

test('constantTimeEqual accepts equal strings and Buffers', () => {
  assert.equal(constantTimeEqual('abc', 'abc'), true);
  assert.equal(constantTimeEqual(Buffer.from('abc'), 'abc'), true);
  assert.equal(constantTimeEqual('abc', Buffer.from('abc')), true);
  assert.equal(constantTimeEqual(Buffer.from('abc'), Buffer.from('abc')), true);
  assert.equal(constantTimeEqual('', ''), true);
  assert.equal(constantTimeEqual('中文🐋', '中文🐋'), true);
});

test('constantTimeEqual returns false for differing values or lengths, without throwing', () => {
  assert.equal(constantTimeEqual('abcd', 'ab'), false);
  assert.equal(constantTimeEqual('abc', 'abd'), false);
  assert.equal(constantTimeEqual('', 'a'), false);
  assert.equal(constantTimeEqual('a', ''), false);
  assert.equal(constantTimeEqual('Bearer t', 'Bearer T'), false);
});

test('constantTimeEqual returns false for non-string/non-Buffer inputs', () => {
  for (const value of [undefined, null, 0, 1, true, {}, [], Symbol('x'), new Uint8Array([97])]) {
    assert.equal(constantTimeEqual(value, 'abc'), false, String(value));
    assert.equal(constantTimeEqual('abc', value), false, String(value));
    assert.equal(constantTimeEqual(value, value), false, String(value));
  }
});

function fakeRequest() {
  const req = new EventEmitter();
  return req;
}

test('readBodyLimited resolves utf8 text within the limit', async () => {
  const req = fakeRequest();
  const body = readBodyLimited(req, 16);
  req.emit('data', Buffer.from('hello'));
  req.emit('data', Buffer.from(' world'));
  req.emit('end');
  assert.equal(await body, 'hello world');
});

test('readBodyLimited resolves a Buffer with options.buffer', async () => {
  const req = fakeRequest();
  const body = readBodyLimited(req, 16, { buffer: true });
  req.emit('data', Buffer.from('raw'));
  req.emit('end');
  assert.ok(Buffer.isBuffer(await body));
  assert.equal((await body).toString('utf8'), 'raw');
});

test('readBodyLimited rejects BODY_TOO_LARGE and stops reading', async () => {
  const req = fakeRequest();
  const body = readBodyLimited(req, 4);
  req.emit('data', Buffer.from('12345'));
  await assert.rejects(body, (error) => {
    assert.equal(error.code, 'BODY_TOO_LARGE');
    return true;
  });
  // 超限后监听器已全部摘除：继续到的数据与 end 都不再触发累积或重复结算。
  assert.equal(req.listenerCount('data'), 0);
  req.emit('data', Buffer.from('more'));
  req.emit('end');
});

test('readBodyLimited rejects when the connection closes mid-request', async () => {
  const req = fakeRequest();
  const body = readBodyLimited(req, 16);
  req.emit('data', Buffer.from('partial'));
  req.emit('close');
  await assert.rejects(body, (error) => {
    assert.equal(error.code, 'BODY_READ_FAILED');
    return true;
  });
});

test('readBodyLimited propagates a stream error', async () => {
  const req = fakeRequest();
  const body = readBodyLimited(req, 16);
  const failure = new Error('boom');
  req.emit('error', failure);
  await assert.rejects(body, (error) => error === failure);
});

test('readBodyLimited tolerates close-after-end on a real stream', async () => {
  const req = new EventEmitter();
  const body = readBodyLimited(req, 8);
  req.emit('data', Buffer.from('done'));
  req.emit('end');
  req.emit('close');
  assert.equal(await body, 'done');
});

test('readBodyLimited reads a real request over HTTP and stops at the cap', async (t) => {
  const server = http.createServer((req, res) => {
    readBodyLimited(req, 8, { res }).then(
      (raw) => res.end(`ok:${raw}`),
      (error) => res.end(`err:${error.code}`),
    );
  });
  t.after(() => server.close());
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const post = (payload) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method: 'POST' }, (res) => {
      let text = '';
      res.on('data', (chunk) => { text += chunk; });
      res.once('end', () => resolve(text));
    });
    req.on('error', reject);
    req.end(payload);
  });
  assert.equal(await post('tiny'), 'ok:tiny');
  assert.equal(await post('this is way over eight bytes'), 'err:BODY_TOO_LARGE');
});

// —— 真实 socket 回归（#433 第三轮）：超限后连接必须真的被处置 ——
// 服务端模式（options.res）回完 413 由 Node 按 Connection: close 关连接；
// 无 res 模式直接 req.destroy() 掐掉 socket。两种都不能让连接挂着继续收数据。

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
}

/** 裸 socket 超限请求；repeat=false 保持请求未结束但不继续洪泛写入。 */
function overflowRaw(port, requestHead, pumpBody, repeat = true) {
  const socket = net.connect(port, '127.0.0.1');
  const started = Date.now();
  let received = '';
  const closed = new Promise((resolve) => {
    socket.on('data', (chunk) => { received += chunk; });
    socket.once('close', () => resolve({ received, elapsedMs: Date.now() - started }));
    socket.on('error', () => {});
  });
  // Start only after connect: a busy runner must not queue an arbitrary flood
  // before the server has even accepted the test connection.
  socket.once('connect', () => socket.write(requestHead + pumpBody()));
  const pump = setInterval(() => {
    if (repeat && !socket.connecting && !socket.destroyed) socket.write(pumpBody());
  }, 5);
  return { socket, pump, closed };
}

test('readBodyLimited with options.res answers 413 before the request ends and closes promptly', { timeout: 5000 }, async (t) => {
  const server = http.createServer(async (req, res) => {
    try {
      await readBodyLimited(req, 4096, { res });
      res.end('ok');
    } catch {
      res.writeHead(413);
      res.end('too large');
    }
  });
  t.after(() => server.close());
  await listen(server);
  const port = server.address().port;
  const { socket, pump, closed } = overflowRaw(
    port,
    'POST / HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\n\r\n',
    // One complete chunk exceeds the limit, with no terminal chunk. A client
    // that continues flooding after rejection can receive a TCP reset on
    // Windows; response delivery and flood termination are separate checks.
    () => `1001\r\n${'a'.repeat(0x1001)}\r\n`,
    false,
  );
  t.after(() => { clearInterval(pump); socket.destroy(); });
  const { received, elapsedMs } = await closed;
  clearInterval(pump);
  assert.match(received, /^HTTP\/1\.1 413 /);
  assert.match(received, /connection: close/i);
  assert.ok(elapsedMs < 1000, `connection took ${elapsedMs}ms to close`);
});

test('readBodyLimited with options.res terminates a continuously overflowing upload', { timeout: 5000 }, async (t) => {
  let rejected = false;
  let responseFinished = false;
  const server = http.createServer(async (req, res) => {
    res.once('finish', () => { responseFinished = true; });
    try {
      await readBodyLimited(req, 4096, { res });
      res.end('unexpected');
    } catch (error) {
      rejected = error.code === 'BODY_TOO_LARGE';
      res.writeHead(413);
      res.end('too large');
    }
  });
  t.after(() => server.close());
  await listen(server);
  const { socket, pump, closed } = overflowRaw(
    server.address().port,
    'POST / HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\n\r\n',
    () => `4000\r\n${'a'.repeat(0x4000)}\r\n`,
  );
  t.after(() => { clearInterval(pump); socket.destroy(); });
  const { elapsedMs } = await closed;
  clearInterval(pump);
  assert.equal(rejected, true);
  assert.equal(responseFinished, true, 'server must finish its rejection response');
  assert.ok(elapsedMs < 1000, `connection took ${elapsedMs}ms to close`);
});

test('readBodyLimited without options.res destroys the socket on overflow', async (t) => {
  const server = http.createServer(async (req, res) => {
    try {
      await readBodyLimited(req, 4096);
      res.end('ok');
    } catch {
      // socket 已被销毁，这个 413 写不出去——正是要验证的行为。
      res.writeHead(413);
      res.end('too large');
    }
  });
  t.after(() => server.close());
  await listen(server);
  const port = server.address().port;
  const { socket, pump, closed } = overflowRaw(
    port,
    'POST / HTTP/1.1\r\nHost: x\r\nContent-Length: 20000\r\n\r\n',
    () => 'a'.repeat(0x4000),
  );
  t.after(() => { clearInterval(pump); socket.destroy(); });
  const { received, elapsedMs } = await closed;
  clearInterval(pump);
  assert.ok(elapsedMs < 1000, `connection took ${elapsedMs}ms to close`);
  assert.doesNotMatch(received, /^HTTP\/1\.1 413 /);
});

test('readBodyLimited leaves keep-alive reuse intact for in-limit requests', async (t) => {
  const server = http.createServer(async (req, res) => {
    try {
      const raw = await readBodyLimited(req, 4096, { res });
      res.end(`ok:${raw.length}`);
    } catch {
      res.writeHead(413);
      res.end('too large');
    }
  });
  t.after(() => server.close());
  await listen(server);
  const port = server.address().port;
  const agent = new http.Agent({ keepAlive: true });
  t.after(() => agent.destroy());
  const post = () => new Promise((resolve, reject) => {
    const request = http.request({ host: '127.0.0.1', port, method: 'POST', agent }, (res) => {
      let text = '';
      res.on('data', (chunk) => { text += chunk; });
      res.once('end', () => resolve({ text, reused: request.reusedSocket }));
    });
    request.on('error', reject);
    request.end('tiny');
  });
  const first = await post();
  assert.equal(first.text, 'ok:4');
  const second = await post();
  assert.equal(second.text, 'ok:4');
  assert.equal(second.reused, true);
});

test('passSecretToChild writes one control line on stdin', () => {
  const writes = [];
  const child = { stdin: { write: (line) => { writes.push(line); return true; } } };
  assert.equal(passSecretToChild(child, 'git-tunnel-token', 's3cr3t'), true);
  assert.deepEqual(writes, ['git-tunnel-token s3cr3t\n']);
});

test('passSecretToChild refuses newline-bearing name or value', () => {
  const child = { stdin: { write: () => true } };
  assert.throws(() => passSecretToChild(child, 'git-tunnel-token', 'a\nstop'), /换行/);
  assert.throws(() => passSecretToChild(child, 'git-tunnel-token\nstop', 'v'), /换行/);
  assert.throws(() => passSecretToChild(child, '', 'v'), /名称/);
  assert.throws(() => passSecretToChild({ stdin: null }, 'n', 'v'), TypeError);
});
