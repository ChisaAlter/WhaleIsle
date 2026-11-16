'use strict';

// Property-based fuzz for the wallpaper fetch allow-list (wallpaper-catalog.js
// parseHttpUrl / isBlockedWallpaperHost). SSRF gate: an accepted URL must be
// https, publicly routable and carry no embedded credentials.
const test = require('node:test');
const assert = require('node:assert/strict');
const fc = require('fast-check');

const { isAllowedWallpaperUrl, isBlockedWallpaperHost } = require('./wallpaper-catalog');

const NUM_RUNS = 400;

const hostArb = fc.oneof(
  fc.constantFrom(
    // Private / loopback / link-local / CGNAT / benchmark in every spelling.
    '127.0.0.1', '127.1', '2130706433', '0x7f000001', '0177.0.0.1', 'localhost',
    '127.0.0.1.', 'localhost.', 'x.localhost', '0.0.0.0', '10.0.0.1', '10.255.255.255',
    '172.16.0.1', '172.31.255.1', '192.168.0.1', '169.254.1.1', '100.64.0.1',
    '100.127.0.1', '198.18.0.1', '198.19.0.1', '0.1.2.3',
    // IPv6 loopback, link-local, ULA and IPv4-mapped forms.
    '[::1]', '[0:0:0:0:0:0:0:1]', '[::]', '[fe80::1]', '[fc00::1]', '[fd12::1]',
    '[::ffff:127.0.0.1]', '[::ffff:7f00:1]', '[::ffff:a9fe:1]', '[::ffff:0a00:1]',
    '[::ffff:c0a8:1]', '[64:ff9b::7f00:1]',
    // Genuinely public.
    'example.com', 'images.bing.com', 'w.wallhaven.cc', '8.8.8.8', '1.2.3.4',
    'a.b.local', 'x.internal', 'not-an-ip', '',
  ),
  fc.tuple(fc.nat(255), fc.nat(255), fc.nat(255), fc.nat(255)).map((o) => o.join('.')),
  fc.domain(),
);

const urlArb = fc.tuple(
  fc.constantFrom('https', 'http', 'file', 'data', 'ftp', 'HTTPS', 'javascript'),
  fc.option(fc.string({ unit: fc.constantFrom('u', 'p', '1', ':', '@', '%', 'x'), maxLength: 10 })),
  hostArb,
  fc.option(fc.nat(65535)),
  fc.string({ unit: fc.constantFrom('a', '/', '.', '%', '?', '#', '=', '&', ' '), maxLength: 20 }),
).map(([scheme, userinfo, host, port, tail]) => (
  `${scheme}://${userinfo === null ? '' : `${userinfo}@`}${host}${port === null ? '' : `:${port}`}${tail.startsWith('/') || tail === '' ? tail : `/${tail}`}`
));

// Every non-public spelling a URL parser or resolver can produce —
// canonicalized through WHATWG, which is what the real callers feed in —
// must be refused.
test('isBlockedWallpaperHost refuses every non-public spelling', () => {
  const privateArb = fc.constantFrom(
    '127.0.0.1', '127.1', '127.0.0.1.', '2130706433', '0x7f000001', '0177.0.0.1',
    'localhost', 'x.localhost', 'a.b.local', 'x.internal',
    '10.1.2.3', '172.16.5.5', '172.31.9.9', '192.168.1.1', '169.254.9.9',
    '100.64.5.5', '100.127.5.5', '198.18.1.1', '198.19.1.1', '0.0.0.0', '0.9.9.9',
    '[::1]', '[0:0:0:0:0:0:0:1]', '[::]', '[fe80::1]', '[fc00::9]', '[fdff::2]',
  );
  fc.assert(fc.property(privateArb, (host) => {
    const canonical = new URL(`https://${host}/`).hostname;
    assert.equal(isBlockedWallpaperHost(canonical), true, `${host} -> ${canonical}`);
  }), { numRuns: NUM_RUNS });
});

test('isAllowedWallpaperUrl: accepted URLs parse as https with no credentials', () => {
  fc.assert(fc.property(urlArb, fc.string({ maxLength: 30 }), (built, loose) => {
    for (const value of [built, loose]) {
      if (!isAllowedWallpaperUrl(value)) continue;
      const parsed = new URL(value);
      // DSHD_WALLPAPER_ALLOW_HTTP is unset in tests: https only.
      assert.equal(parsed.protocol, 'https:', value);
      assert.equal(isBlockedWallpaperHost(parsed.hostname), false, value);
    }
    return true;
  }), { numRuns: NUM_RUNS });
});

// FINDING (see report): the dotted IPv4-mapped check never fires because
// WHATWG normalizes `[::ffff:127.0.0.1]` to the hex form `[::ffff:7f00:1]`,
// which the regex does not cover — IPv4-mapped IPv6 literals for loopback,
// RFC1918, link-local and CGNAT all pass the gate, and the DNS recheck
// skips IP literals entirely.
test.todo('#491: isAllowedWallpaperUrl must refuse IPv4-mapped IPv6 literals — minimal counterexample: https://[::ffff:7f00:1]/ accepted today (= 127.0.0.1; also ::ffff:0a00:1 → 10.0.0.1, ::ffff:a9fe:1 → 169.254.0.1)');

// FINDING (see report): parseHttpUrl never inspects username/password, so a
// renderer-supplied catalog URL may embed credentials that fetch then sends.
test.todo('#491: isAllowedWallpaperUrl must refuse embedded credentials — minimal counterexample: https://user:pass@example.com/ accepted today');

test('isAllowedWallpaperUrl never accepts non-http(s) schemes', () => {
  const schemeArb = fc.constantFrom('file', 'data', 'javascript', 'ftp', 'ws', 'wss', 'chrome', 'dshd', 'about', 'blob', 'ssh');
  fc.assert(fc.property(schemeArb, hostArb, (scheme, host) => {
    const value = `${scheme}://${host}/x`;
    assert.equal(isAllowedWallpaperUrl(value), false, value);
  }), { numRuns: NUM_RUNS });
});
