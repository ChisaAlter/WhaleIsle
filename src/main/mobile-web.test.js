const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  resolveMobileWebRoot,
  resolveSpaAsset,
} = require('./mobile-web');

test('resolveSpaAsset blocks traversal and missing test files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-spa-'));
  fs.writeFileSync(path.join(root, 'index.html'), '<html>手机远程</html>');
  fs.writeFileSync(path.join(root, 'app.js'), 'window.DSH_MOBILE = true;');
  try {
    assert.equal(resolveSpaAsset(root, '/').file, path.join(root, 'index.html'));
    assert.equal(resolveSpaAsset(root, '/app.js').type, 'text/javascript; charset=utf-8');
    assert.equal(resolveSpaAsset(root, '/../package.json'), null);
    assert.equal(resolveSpaAsset(root, '/missing.js'), null);
    assert.equal(resolveSpaAsset(root, '/chat').file, path.join(root, 'index.html'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('resolveMobileWebRoot points at mobile/web', () => {
  const root = resolveMobileWebRoot();
  assert.match(root.replace(/\\/g, '/'), /mobile\/web$/);
});

test('SPA paths decode exactly once, including literal percent filenames', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-spa-'));
  try {
    for (const name of ['报告.js', 'my app.js', 'a%20b.js', 'a%name.js']) {
      fs.writeFileSync(path.join(root, name), 'asset');
      assert.equal(resolveSpaAsset(root, `/${encodeURIComponent(name)}`).file, path.join(root, name));
    }
    assert.equal(resolveSpaAsset(root, '/%252e%252e%252fpackage.json'), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('mobile app boots offer v2 through DaemonClient instead of retired HTTP login', () => {
  const root = resolveMobileWebRoot();
  const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  const connect = fs.readFileSync(path.join(root, 'app/connect.js'), 'utf8');
  assert.match(app, /import \{ connect, connectSaved \} from '\.\/app\/connect\.js\?[^']+'/);
  assert.match(connect, /pairFromOfferUrl\(api, offerUrl, \{ signal \}\)/);
  assert.match(app, /connect\(window\.location\.href\)/);
  assert.doesNotMatch(app + connect, /loginWithOffer/);
  assert.doesNotMatch(app + connect, /offerFromHash/);
});
