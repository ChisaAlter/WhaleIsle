'use strict';

// Property-based fuzz for the loopback/local-app URL policies in local-url.js.
// The core invariant: the verdict must agree with WHATWG parsing — no string
// the browser resolves as loopback may be refused, none it resolves
// elsewhere may be accepted, and vice versa — except that embedded
// credentials (userinfo) are always refused.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const fc = require('fast-check');

const {
  LOOPBACK_HOSTS,
  isLoopbackHttpUrl,
  isSameOriginLoopbackUrl,
  isHttpOrHttpsUrl,
  isPackagedRendererFileUrl,
  rewriteLoopbackLoadUrl,
} = require('./local-url');
const { withOwnedTempDir } = require('../shared/fs-safe');

const NUM_RUNS = 400;

const schemeArb = fc.constantFrom('http', 'https', 'file', 'javascript', 'data', 'ftp', 'ws', 'wss', 'about', 'chrome', 'dshd', 'HtTp', 'HTTP', ' http', 'javascript ', '');
const userinfoArb = fc.option(fc.string({ unit: fc.constantFrom('u', 'p', 'a', '1', ':', '@', '%'), maxLength: 8 }));
const hostArb = fc.oneof(
  fc.constantFrom(
    '127.0.0.1', 'localhost', '[::1]', '0.0.0.0', '127.1', '127.0.1', '2130706433',
    '0x7f000001', '0177.0.0.1', '127.0.0.1.', 'localhost.', '127.0.0.2', '128.0.0.1',
    '10.0.0.1', '192.168.1.1', 'example.com', 'evil.com', 'localhost.evil.com',
    'x.localhost', 'a.local', 'internal', '[::ffff:7f00:1]', '[::ffff:127.0.0.1]',
    '[fe80::1]', '[::]', 'localhost:80', '', ' ', '1.2.3.4',
  ),
  fc.tuple(fc.nat(255), fc.nat(255), fc.nat(255), fc.nat(255)).map((o) => o.join('.')),
  fc.domain(),
);
const urlArb = fc.tuple(schemeArb, userinfoArb, hostArb, fc.nat(65535), fc.string({ maxLength: 12 }))
  .map(([scheme, userinfo, host, port, tail]) => `${scheme}://${userinfo === null ? '' : `${userinfo}@`}${host}:${port}/${tail}`);

const anyStringArb = fc.oneof(urlArb, fc.string({ maxLength: 40 }), fc.constantFrom(
  'http://127.0.0.1', 'https://localhost:8080/x', 'file:///etc/passwd', 'javascript:alert(1)',
  'HTTP://127.0.0.1.evil', 'http://127.0.0.1@evil', 'http://evil@127.0.0.1', '',
));

test('isLoopbackHttpUrl agrees with WHATWG parsing both directions, minus credentials', () => {
  fc.assert(fc.property(anyStringArb, (raw) => {
    const expected = (() => {
      if (typeof raw !== 'string' || raw.trim() === '') return false;
      let parsed;
      try { parsed = new URL(raw); } catch { return false; }
      return (parsed.protocol === 'http:' || parsed.protocol === 'https:')
        && parsed.username === '' && parsed.password === ''
        && LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase());
    })();
    assert.equal(isLoopbackHttpUrl(raw), expected, raw);
    return true;
  }), { numRuns: NUM_RUNS });
});

test('isLoopbackHttpUrl: accepted values have a canonical loopback host', () => {
  fc.assert(fc.property(anyStringArb, (raw) => {
    if (!isLoopbackHttpUrl(raw)) return true;
    const parsed = new URL(raw);
    assert.ok(['127.0.0.1', 'localhost', '[::1]', '0.0.0.0'].includes(parsed.hostname.toLowerCase()), raw);
    return true;
  }), { numRuns: NUM_RUNS });
});

// #495: userinfo pointing at loopback must be refused — `http://evil@127.0.0.1`
// carries username "evil" to the loopback endpoint, like sibling policies
// (browser-guests allowedNavigation) that reject embedded credentials.
test('isLoopbackHttpUrl refuses embedded credentials', () => {
  assert.equal(isLoopbackHttpUrl('http://evil@127.0.0.1'), false);
  assert.equal(isLoopbackHttpUrl('http://user:pass@127.0.0.1:8080/x'), false);
  assert.equal(isSameOriginLoopbackUrl('http://evil@127.0.0.1:3080/', 'http://127.0.0.1:3080/'), false);
  fc.assert(fc.property(anyStringArb, (raw) => {
    if (!isLoopbackHttpUrl(raw)) return true;
    const parsed = new URL(raw);
    assert.equal(parsed.username, '', raw);
    assert.equal(parsed.password, '', raw);
    return true;
  }), { numRuns: NUM_RUNS });
});

test('isHttpOrHttpsUrl is exactly the WHATWG http(s) set', () => {
  fc.assert(fc.property(anyStringArb, (raw) => {
    const accepted = isHttpOrHttpsUrl(raw);
    if (accepted) {
      const parsed = new URL(raw);
      assert.ok(parsed.protocol === 'http:' || parsed.protocol === 'https:', raw);
    }
    return true;
  }), { numRuns: NUM_RUNS });
});

test('isSameOriginLoopbackUrl: accepted pairs share a loopback origin', () => {
  fc.assert(fc.property(anyStringArb, anyStringArb, (a, b) => {
    if (!isSameOriginLoopbackUrl(a, b)) return true;
    assert.equal(isLoopbackHttpUrl(a), true, a);
    assert.equal(isLoopbackHttpUrl(b), true, b);
    assert.equal(new URL(String(a)).origin, new URL(String(b)).origin);
    return true;
  }), { numRuns: NUM_RUNS });
});

test('rewriteLoopbackLoadUrl stays loopback, drops 0.0.0.0, preserves port/path', () => {
  fc.assert(fc.property(anyStringArb, (raw) => {
    const out = rewriteLoopbackLoadUrl(raw);
    if (out === null) {
      assert.equal(isLoopbackHttpUrl(raw), false, raw);
      return true;
    }
    assert.equal(isLoopbackHttpUrl(out), true, `${raw} -> ${out}`);
    const before = new URL(String(raw).trim());
    const after = new URL(out);
    assert.notEqual(after.hostname.toLowerCase(), '0.0.0.0', `${raw} -> ${out}`);
    assert.equal(after.port, before.port, `${raw} -> ${out}`);
    assert.equal(after.pathname, before.pathname, `${raw} -> ${out}`);
    assert.equal(after.search, before.search, `${raw} -> ${out}`);
    return true;
  }), { numRuns: NUM_RUNS });
});

// file: URLs that resolve to the packaged renderer file — the navigation
// gate must accept exactly the real file and reject every alias.
const fileUrlArb = fc.oneof(
  fc.constantFrom('file://', 'FILE://', 'File://', 'file:', 'file:///', 'file://localhost/'),
  fc.string({ unit: fc.constantFrom('file://', '/', '\\', '%', '.', '..', 'a', 'B', '%2e', '%20', '?', '#'), maxLength: 40 }),
).map((prefix) => `${prefix}`);

test('isPackagedRendererFileUrl accepts only realpaths of the packaged file', async () => {
  await fc.assert(fc.asyncProperty(
    fc.record({
      name: fc.constantFrom('boot.html', 'BOOT.HTML', 'boot.htm', ' boot.html', 'boot.html ', 'x/../boot.html', 'sub/boot.html'),
      usePath: fc.boolean(),
      weird: fileUrlArb,
    }),
    async ({ name, usePath, weird }) => {
      await withOwnedTempDir('dshd-fuzz-nav-', async (dir) => {
        const packaged = path.join(dir, 'boot.html');
        fs.writeFileSync(packaged, 'x');
        const resolvePath = () => packaged;
        const raw = usePath
          ? `${pathToFileURL(dir).href}/${name}`
          : `${weird}${name}`;
        const accepted = isPackagedRendererFileUrl(raw, 'boot.html', { resolvePath });
        if (!accepted) return true;
        // Accepted ⇒ the URL resolves (real or normalized) to the packaged file.
        const { fileURLToPath } = require('node:url');
        const candidate = fileURLToPath(raw);
        const sameReal = (() => { try { return fs.realpathSync(candidate) === fs.realpathSync(packaged); } catch { return false; } })();
        const sameNorm = path.normalize(candidate).toLowerCase() === path.normalize(packaged).toLowerCase();
        assert.ok(sameReal || sameNorm, `${raw} accepted without resolving to ${packaged}`);
        return true;
      });
    },
  ), { numRuns: 100 });
});
