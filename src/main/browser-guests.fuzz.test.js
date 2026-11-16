'use strict';

// Property-based fuzz for BrowserGuests.allowedNavigation — the policy that
// gates webview guest navigations, redirects and window.open requests:
// http(s) only, no embedded credentials, never the harness Host origin.
const test = require('node:test');
const assert = require('node:assert/strict');
const fc = require('fast-check');

const { BrowserGuests } = require('./browser-guests');

const NUM_RUNS = 400;
const HOST = 'http://127.0.0.1:8137';

const schemeArb = fc.constantFrom(
  'http', 'https', 'file', 'javascript', 'data', 'vbscript', 'ftp', 'ws', 'wss',
  'about', 'blob', 'chrome', 'devtools', 'dshd', 'HTTP', 'HtTpS',
);
const hostArb = fc.oneof(
  fc.constantFrom(
    '127.0.0.1', 'localhost', '[::1]', 'example.com', 'evil.test', 'a.localhost',
    '127.0.0.1.', 'localhost.', '127.0.0.2', '10.0.0.1', '0.0.0.0', '',
  ),
  fc.tuple(fc.nat(255), fc.nat(255), fc.nat(255), fc.nat(255)).map((o) => o.join('.')),
  fc.domain(),
);
const urlArb = fc.tuple(
  schemeArb,
  fc.option(fc.string({ unit: fc.constantFrom('u', 'p', 'a', '1', ':', '%'), maxLength: 10 })),
  hostArb,
  fc.option(fc.constantFrom(80, 443, 8137, 1, 65535, 3000)),
  fc.string({ unit: fc.constantFrom('a', '/', '.', '?', '#', '=', '&', '@', '%'), maxLength: 16 }),
).map(([scheme, userinfo, host, port, tail]) => (
  `${scheme}://${userinfo === null ? '' : `${userinfo}@`}${host}${port === null ? '' : `:${port}`}${tail.startsWith('/') || tail === '' ? tail : `/${tail}`}`
));

function guests() {
  return new BrowserGuests(() => HOST);
}

test('allowedNavigation: accepted URLs are http(s), credential-free and off the Host origin', () => {
  const g = guests();
  fc.assert(fc.property(urlArb, fc.string({ maxLength: 40 }), (built, loose) => {
    for (const value of [built, loose]) {
      if (!g.allowedNavigation(value)) continue;
      const parsed = new URL(value);
      assert.ok(parsed.protocol === 'http:' || parsed.protocol === 'https:', value);
      assert.equal(parsed.username, '', value);
      assert.equal(parsed.password, '', value);
      assert.equal(g.isApplicationHost(parsed), false, value);
    }
    return true;
  }), { numRuns: NUM_RUNS });
});

test('allowedNavigation: the Host origin itself is always refused', () => {
  const g = guests();
  const nearHost = fc.tuple(
    fc.constantFrom('127.0.0.1', 'localhost', '[::1]', '127.0.0.1.', 'localhost.'),
    fc.constantFrom(8137, 8138, 80),
  ).map(([host, port]) => `http://${host}:${port}/x`);
  fc.assert(fc.property(nearHost, (value) => {
    if (!g.allowedNavigation(value)) return true;
    const parsed = new URL(value);
    assert.ok(
      parsed.port !== '8137'
        || !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname),
      `${value} reached the Host origin`,
    );
    return true;
  }), { numRuns: NUM_RUNS });
});

test('allowedNavigation: dangerous and opaque schemes are always refused', () => {
  const g = guests();
  const schemeArb2 = fc.constantFrom(
    'javascript', 'file', 'data', 'vbscript', 'chrome', 'devtools', 'about',
    'blob', 'ssh', 'dshd', 'filesystem',
  );
  fc.assert(fc.property(schemeArb2, fc.string({ maxLength: 30 }), (scheme, tail) => {
    assert.equal(g.allowedNavigation(`${scheme}:${tail}`), false);
    assert.equal(g.allowedNavigation(`${scheme}://${tail}`), false);
  }), { numRuns: NUM_RUNS });
});
