const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { createWorkspaceAuthority } = require('./workspace-authority');
const { createWorkspacePreviewController } = require('./preview-workspace.js');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-preview-ws-'));
}

function controllerFor(cwd) {
  return createWorkspacePreviewController({
    authority: createWorkspaceAuthority({ workspace: cwd }),
  });
}

function request(url, { method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method, headers }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('fileUrl serves an authorized html file under a token prefix', async () => {
  const cwd = makeTempDir();
  const preview = controllerFor(cwd);
  try {
    fs.writeFileSync(path.join(cwd, 'index.html'), '<h1>ok</h1>');
    const opened = await preview.fileUrl({ cwd, relativePath: 'index.html' });
    assert.equal(opened.ok, true);
    const parsed = new URL(opened.url);
    assert.equal(parsed.hostname, '127.0.0.1');
    assert.match(parsed.pathname, /^\/[A-Za-z0-9_-]{16,}\/index\.html$/);
    const page = await request(opened.url);
    assert.equal(page.status, 200);
    assert.equal(page.body, '<h1>ok</h1>');
    assert.equal(page.headers['x-content-type-options'], 'nosniff');
    assert.equal(page.headers['content-security-policy'], 'sandbox');
    assert.match(page.headers['content-type'], /text\/html/);
  } finally {
    await preview.close();
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('fileUrl serves an authorized pdf as application/pdf', async () => {
  const cwd = makeTempDir();
  const preview = controllerFor(cwd);
  try {
    fs.writeFileSync(path.join(cwd, 'doc.pdf'), '%PDF-1.4');
    const opened = await preview.fileUrl({ cwd, relativePath: 'doc.pdf' });
    assert.equal(opened.ok, true);
    const parsed = new URL(opened.url);
    assert.equal(parsed.hostname, '127.0.0.1');
    assert.match(parsed.pathname, /^\/[A-Za-z0-9_-]{16,}\/doc\.pdf$/);
    const page = await request(opened.url);
    assert.equal(page.status, 200);
    assert.equal(page.body, '%PDF-1.4');
    assert.equal(page.headers['content-type'], 'application/pdf');
  } finally {
    await preview.close();
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('token URLs round-trip Unicode, spaces, percent signs, and nested resource names', async () => {
  const cwd = makeTempDir();
  const preview = controllerFor(cwd);
  try {
    fs.mkdirSync(path.join(cwd, '中文 目录'));
    for (const name of ['报告.html', 'my report.html', 'my%20report.html', '中文 目录/资源%.css']) {
      fs.writeFileSync(path.join(cwd, name), `contents:${name}`);
      const opened = await preview.fileUrl({ cwd, relativePath: name });
      assert.equal(opened.ok, true);
      const page = await request(opened.url);
      assert.equal(page.status, 200, name);
      assert.equal(page.body, `contents:${name}`);
    }
  } finally {
    await preview.close();
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('media responses support one byte range for Chromium playback', async () => {
  const cwd = makeTempDir();
  const preview = controllerFor(cwd);
  try {
    fs.writeFileSync(path.join(cwd, 'clip.mp4'), Buffer.from('0123456789'));
    const opened = await preview.fileUrl({ cwd, relativePath: 'clip.mp4' });
    const partial = await request(opened.url, { headers: { Range: 'bytes=2-5' } });
    assert.equal(partial.status, 206);
    assert.equal(partial.body, '2345');
    assert.equal(partial.headers['content-type'], 'video/mp4');
    assert.equal(partial.headers['content-range'], 'bytes 2-5/10');
    assert.equal(partial.headers['accept-ranges'], 'bytes');
    const invalid = await request(opened.url, { headers: { Range: 'bytes=20-30' } });
    assert.equal(invalid.status, 416);
    assert.equal(invalid.headers['content-range'], 'bytes */10');
  } finally {
    await preview.close();
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('serves a large binary with Content-Length and rejects an oversized text document with 413', async () => {
  const cwd = makeTempDir();
  const preview = controllerFor(cwd);
  try {
    // Above the 8 MiB text cap but under the 64 MiB binary cap.
    const big = Buffer.alloc(8 * 1024 * 1024 + 1, 0x61);
    fs.writeFileSync(path.join(cwd, 'huge.html'), big);
    fs.writeFileSync(path.join(cwd, 'huge.bin'), big);
    const html = await preview.fileUrl({ cwd, relativePath: 'huge.html' });
    const tooLarge = await request(html.url);
    assert.equal(tooLarge.status, 413);
    const bin = await preview.fileUrl({ cwd, relativePath: 'huge.bin' });
    const streamed = await request(bin.url);
    assert.equal(streamed.status, 200);
    assert.equal(streamed.headers['content-length'], String(big.length));
    assert.equal(streamed.headers['content-type'], 'application/octet-stream');
    assert.equal(Buffer.byteLength(streamed.body), big.length);
  } finally {
    await preview.close();
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('a file deleted between token mint and GET is 404', async () => {
  const cwd = makeTempDir();
  const preview = controllerFor(cwd);
  try {
    fs.writeFileSync(path.join(cwd, 'gone.html'), '<h1>bye</h1>');
    const opened = await preview.fileUrl({ cwd, relativePath: 'gone.html' });
    fs.rmSync(path.join(cwd, 'gone.html'));
    const missing = await request(opened.url);
    assert.equal(missing.status, 404);
  } finally {
    await preview.close();
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('GET without the token prefix is 404', async () => {
  const cwd = makeTempDir();
  const preview = controllerFor(cwd);
  try {
    fs.writeFileSync(path.join(cwd, 'index.html'), '<h1>ok</h1>');
    const opened = await preview.fileUrl({ cwd, relativePath: 'index.html' });
    const parsed = new URL(opened.url);
    const bare = await request(`http://127.0.0.1:${parsed.port}/index.html`);
    assert.equal(bare.status, 404);
  } finally {
    await preview.close();
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('parent-directory and encoded traversal GETs are 404', async () => {
  const cwd = makeTempDir();
  const preview = controllerFor(cwd);
  try {
    fs.writeFileSync(path.join(cwd, 'index.html'), '<h1>ok</h1>');
    const opened = await preview.fileUrl({ cwd, relativePath: 'index.html' });
    const parsed = new URL(opened.url);
    const token = parsed.pathname.split('/')[1];
    const parent = await request(`http://127.0.0.1:${parsed.port}/${token}/../index.html`);
    assert.equal(parent.status, 404);
    const encoded = await request(`http://127.0.0.1:${parsed.port}/${token}/%2e%2e%2findex.html`);
    assert.equal(encoded.status, 404);
    for (const unsafe of ['%2e%2e%5cindex.html', '%2egit/config', '%00index.html']) {
      assert.equal((await request(`http://127.0.0.1:${parsed.port}/${token}/${unsafe}`)).status, 404);
    }
    assert.equal((await request(`http://127.0.0.1:${parsed.port}/${token}/%`)).status, 400);
  } finally {
    await preview.close();
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('a directory path is refused and GET of a directory is 403', async () => {
  const cwd = makeTempDir();
  const preview = controllerFor(cwd);
  try {
    fs.mkdirSync(path.join(cwd, 'site'));
    fs.writeFileSync(path.join(cwd, 'site', 'index.html'), '<h1>nope</h1>');
    const opened = await preview.fileUrl({ cwd, relativePath: 'site' });
    assert.equal(opened.ok, false);
    const file = await preview.fileUrl({ cwd, relativePath: 'site/index.html' });
    const parsed = new URL(file.url);
    const token = parsed.pathname.split('/')[1];
    assert.equal((await request(`http://127.0.0.1:${parsed.port}/${token}/site`)).status, 404);
    fs.rmSync(path.join(cwd, 'site', 'index.html'));
    fs.mkdirSync(path.join(cwd, 'site', 'index.html'));
    const listed = await request(file.url);
    assert.equal(listed.status, 403);
  } finally {
    await preview.close();
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('POST is 405 and a non-loopback Host is rejected', async () => {
  const cwd = makeTempDir();
  const preview = controllerFor(cwd);
  try {
    fs.writeFileSync(path.join(cwd, 'index.html'), '<h1>ok</h1>');
    const opened = await preview.fileUrl({ cwd, relativePath: 'index.html' });
    const posted = await request(opened.url, { method: 'POST' });
    assert.equal(posted.status, 405);
    const rebound = await request(opened.url, { headers: { Host: 'evil.example' } });
    assert.equal(rebound.status, 400);
  } finally {
    await preview.close();
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('fileUrl refuses a cwd outside the authorized workspace', async () => {
  const cwd = makeTempDir();
  const outsider = makeTempDir();
  const preview = controllerFor(cwd);
  try {
    fs.writeFileSync(path.join(outsider, 'secret.html'), 'nope');
    const opened = await preview.fileUrl({ cwd: outsider, relativePath: 'secret.html' });
    assert.equal(opened.ok, false);
  } finally {
    await preview.close();
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(outsider, { recursive: true, force: true });
  }
});

test('fileUrl scopes each token to a single file and sandboxes HTML/SVG responses', async (t) => {
  const workspace = makeTempDir();
  const scratch = makeTempDir();
  const outside = makeTempDir();
  const preview = createWorkspacePreviewController({
    authority: createWorkspaceAuthority({ workspace, extraWorkspaces: [scratch] }),
  });
  try {
    fs.writeFileSync(path.join(scratch, 'index.html'), '<link rel="stylesheet" href="site.css"><img src="pixel.png">');
    fs.writeFileSync(path.join(scratch, 'icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    fs.writeFileSync(path.join(scratch, 'site.css'), 'body { color: red; }');
    fs.writeFileSync(path.join(scratch, 'pixel.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    fs.writeFileSync(path.join(scratch, '.env'), 'SECRET=1');
    fs.mkdirSync(path.join(scratch, '.git'));
    fs.writeFileSync(path.join(scratch, '.git', 'config'), 'secret');
    fs.writeFileSync(path.join(outside, 'secret.html'), 'leaked');
    const opened = await preview.fileUrl({ cwd: scratch, relativePath: 'index.html' });
    assert.equal(opened.ok, true);
    const parsed = new URL(opened.url);
    const token = parsed.pathname.split('/')[1];
    const htmlRes = await request(opened.url);
    assert.equal(htmlRes.status, 200);
    assert.equal(htmlRes.headers['content-security-policy'], 'sandbox');
    assert.equal(htmlRes.body.includes('site.css'), true);
    // Single-file token must not read sibling files in the same workspace.
    assert.equal((await request(`http://127.0.0.1:${parsed.port}/${token}/site.css`)).status, 404);
    assert.equal((await request(`http://127.0.0.1:${parsed.port}/${token}/pixel.png`)).status, 404);
    assert.equal((await request(`http://127.0.0.1:${parsed.port}/${token}/.env`)).status, 404);
    const cssOpened = await preview.fileUrl({ cwd: scratch, relativePath: 'site.css' });
    assert.equal(cssOpened.ok, true);
    assert.notEqual(new URL(cssOpened.url).pathname.split('/')[1], token);
    const cssRes = await request(cssOpened.url);
    assert.equal(cssRes.status, 200);
    assert.equal(cssRes.headers['content-security-policy'], undefined);
    const svgOpened = await preview.fileUrl({ cwd: scratch, relativePath: 'icon.svg' });
    const svgRes = await request(svgOpened.url);
    assert.equal(svgRes.status, 200);
    assert.equal(svgRes.headers['content-security-policy'], 'sandbox');
    assert.equal((await request(`http://127.0.0.1:${parsed.port}/${token}/../index.html`)).status, 404);
    assert.equal((await request(`http://127.0.0.1:${parsed.port}/${token}/%2e%2e%2findex.html`)).status, 404);
    assert.equal((await request(`http://127.0.0.1:${parsed.port}/${token}/.git/config`)).status, 404);
    assert.equal((await preview.fileUrl({ cwd: scratch, relativePath: '.git/config' })).ok, false);
    assert.equal((await preview.fileUrl({ cwd: path.dirname(scratch), relativePath: 'index.html' })).ok, false);
    const link = path.join(scratch, 'escape.html');
    try {
      fs.symlinkSync(path.join(outside, 'secret.html'), link);
      assert.equal((await preview.fileUrl({ cwd: scratch, relativePath: 'escape.html' })).ok, false);
    } catch (error) {
      if (error.code !== 'EPERM' && error.code !== 'ENOTSUP') throw error;
      t.diagnostic('symlink creation is not permitted on this host');
    }
  } finally {
    await preview.close();
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('close stops the listener', async () => {
  const cwd = makeTempDir();
  const preview = controllerFor(cwd);
  try {
    fs.writeFileSync(path.join(cwd, 'index.html'), '<h1>ok</h1>');
    const opened = await preview.fileUrl({ cwd, relativePath: 'index.html' });
    await preview.close();
    await assert.rejects(() => request(opened.url), { code: 'ECONNREFUSED' });
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('a symlink that escapes the workspace is not served', async (t) => {
  const cwd = makeTempDir();
  const outside = makeTempDir();
  const preview = controllerFor(cwd);
  try {
    fs.writeFileSync(path.join(outside, 'secret.html'), 'leaked');
    const link = path.join(cwd, 'escape.html');
    try {
      fs.symlinkSync(path.join(outside, 'secret.html'), link);
    } catch (error) {
      if (error.code === 'EPERM' || error.code === 'ENOTSUP') {
        t.skip('symlink creation is not permitted on this host');
        return;
      }
      throw error;
    }
    const opened = await preview.fileUrl({ cwd, relativePath: 'escape.html' });
    assert.equal(opened.ok, false);
  } finally {
    await preview.close();
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});
