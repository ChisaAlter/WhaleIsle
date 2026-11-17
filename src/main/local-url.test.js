const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const {
  isLoopbackHttpUrl,
  isSameOriginLoopbackUrl,
  isLocalAppNavigationUrl,
  isLauncherNavigationUrl,
  rewriteLoopbackLoadUrl,
  isHttpOrHttpsUrl,
  shouldAllowPrivilegedNavigate,
  shouldAllowPrivilegedRedirect,
} = require('./local-url.js');

test('isLoopbackHttpUrl accepts exact loopback hosts including 0.0.0.0', () => {
  assert.equal(isLoopbackHttpUrl('http://127.0.0.1:3080/'), true);
  assert.equal(isLoopbackHttpUrl('http://localhost:5173/app'), true);
  assert.equal(isLoopbackHttpUrl('http://[::1]:3000/'), true);
  assert.equal(isLoopbackHttpUrl('http://0.0.0.0:5173/'), true);
  assert.equal(isLoopbackHttpUrl('https://127.0.0.1/'), true);
});

test('isLoopbackHttpUrl rejects prefix and userinfo spoofs', () => {
  assert.equal(isLoopbackHttpUrl('http://127.0.0.1.evil.example/'), false);
  assert.equal(isLoopbackHttpUrl('http://localhost.attacker.example/'), false);
  assert.equal(isLoopbackHttpUrl('http://127.0.0.1@evil.example/'), false);
  assert.equal(isLoopbackHttpUrl('http://localhost@evil.example/'), false);
  assert.equal(isLoopbackHttpUrl('http://evil@127.0.0.1/'), false);
  assert.equal(isLoopbackHttpUrl('http://user:pass@127.0.0.1:8080/'), false);
  assert.equal(isLoopbackHttpUrl('http://user:pass@localhost:5173/'), false);
  assert.equal(isLoopbackHttpUrl('https://:secret@[::1]:3000/'), false);
  assert.equal(isLoopbackHttpUrl('http://@127.0.0.1/'), true);
  assert.equal(isLoopbackHttpUrl('https://example.com'), false);
  assert.equal(isLoopbackHttpUrl('file:///tmp/x'), false);
  assert.equal(isLoopbackHttpUrl('javascript:alert(1)'), false);
});

test('isSameOriginLoopbackUrl pins scheme, host, and port', () => {
  assert.equal(isSameOriginLoopbackUrl('http://127.0.0.1:3080/chat', 'http://127.0.0.1:3080/'), true);
  assert.equal(isSameOriginLoopbackUrl('http://127.0.0.1:5173/', 'http://127.0.0.1:3080/'), false);
  assert.equal(isSameOriginLoopbackUrl('https://127.0.0.1:3080/', 'http://127.0.0.1:3080/'), false);
  assert.equal(isSameOriginLoopbackUrl('https://example.com/', 'https://127.0.0.1:3080/'), false);
  assert.equal(isSameOriginLoopbackUrl('http://evil@127.0.0.1:3080/', 'http://127.0.0.1:3080/'), false);
  assert.equal(isSameOriginLoopbackUrl('http://127.0.0.1:3080/', 'http://evil@127.0.0.1:3080/'), false);
});

test('isLocalAppNavigationUrl allows only the packaged boot.html path', () => {
  const boot = path.join(os.tmpdir(), `dsh-boot-${process.pid}`, 'boot.html');
  fs.mkdirSync(path.dirname(boot), { recursive: true });
  fs.writeFileSync(boot, '<html></html>');
  const resolveBootPath = () => boot;
  const packaged = pathToFileURL(boot).href;
  assert.equal(isLocalAppNavigationUrl(packaged, { resolveBootPath }), true);
  assert.equal(isLocalAppNavigationUrl(pathToFileURL(path.join(path.dirname(boot), 'evilboot.html')).href, { resolveBootPath }), false);
  assert.equal(isLocalAppNavigationUrl(pathToFileURL(path.join(os.tmpdir(), 'Downloads', 'boot.html')).href, { resolveBootPath }), false);
  assert.equal(isLocalAppNavigationUrl('http://127.0.0.1:3080/'), false);
  assert.equal(isLocalAppNavigationUrl('http://127.0.0.1.evil.example/'), false);
  fs.rmSync(path.dirname(boot), { recursive: true, force: true });
});

test('isLauncherNavigationUrl allows only the packaged launcher.html path', () => {
  const launcher = path.join(os.tmpdir(), `dsh-launcher-${process.pid}`, 'launcher.html');
  fs.mkdirSync(path.dirname(launcher), { recursive: true });
  fs.writeFileSync(launcher, '<html></html>');
  const resolveLauncherPath = () => launcher;
  const packaged = pathToFileURL(launcher).href;
  assert.equal(isLauncherNavigationUrl(packaged, { resolveLauncherPath }), true);
  assert.equal(isLauncherNavigationUrl(pathToFileURL(path.join(path.dirname(launcher), 'evillauncher.html')).href, { resolveLauncherPath }), false);
  assert.equal(isLauncherNavigationUrl(pathToFileURL(path.join(os.tmpdir(), 'Downloads', 'launcher.html')).href, { resolveLauncherPath }), false);
  assert.equal(isLauncherNavigationUrl('http://127.0.0.1:3080/'), false);
  fs.rmSync(path.dirname(launcher), { recursive: true, force: true });
});

test('local-url has no marketplace navigation policy', () => {
  const localUrl = require('./local-url.js');
  assert.equal(localUrl.isMarketplaceNavigationUrl, undefined);
});

test('rewriteLoopbackLoadUrl maps 0.0.0.0 to 127.0.0.1', () => {
  assert.equal(rewriteLoopbackLoadUrl('http://0.0.0.0:5173/app'), 'http://127.0.0.1:5173/app');
  assert.equal(rewriteLoopbackLoadUrl('http://127.0.0.1:5173/'), 'http://127.0.0.1:5173/');
  assert.equal(rewriteLoopbackLoadUrl('http://evil.example/'), null);
  assert.equal(rewriteLoopbackLoadUrl('http://user:pass@0.0.0.0:5173/'), null);
});

test('isHttpOrHttpsUrl rejects file and custom schemes', () => {
  assert.equal(isHttpOrHttpsUrl('https://example.com'), true);
  assert.equal(isHttpOrHttpsUrl('http://127.0.0.1/'), true);
  assert.equal(isHttpOrHttpsUrl('file:///C:/x'), false);
  assert.equal(isHttpOrHttpsUrl('javascript:alert(1)'), false);
});

test('privileged navigate allows same-document URL even when allowlist would reject', () => {
  const allowUrl = (url) => url === 'http://127.0.0.1:3080/';
  assert.equal(shouldAllowPrivilegedNavigate({
    nextUrl: 'http://127.0.0.1:3080/',
    currentUrl: 'file:///boot.html',
    allowUrl,
  }), true);
  assert.equal(shouldAllowPrivilegedNavigate({
    nextUrl: 'https://evil.example/',
    currentUrl: 'https://evil.example/',
    allowUrl,
  }), true);
  assert.equal(shouldAllowPrivilegedNavigate({
    nextUrl: 'https://evil.example/',
    currentUrl: 'http://127.0.0.1:3080/',
    allowUrl,
  }), false);
});

test('privileged redirect never uses the current-URL escape hatch', () => {
  const allowUrl = isLoopbackHttpUrl;
  assert.equal(shouldAllowPrivilegedRedirect({
    nextUrl: 'http://127.0.0.1:3080/',
    allowUrl,
  }), true);
  assert.equal(shouldAllowPrivilegedRedirect({
    nextUrl: 'https://evil.example/',
    allowUrl,
  }), false);
});

test('loopback hostnames do not authorize non-HTTP protocols', () => {
  for (const url of ['ftp://127.0.0.1/file', 'ws://localhost:3080/', 'file://localhost/tmp/boot.html']) {
    assert.equal(isLoopbackHttpUrl(url), false, url);
  }
});
