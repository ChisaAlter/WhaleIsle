'use strict';

// Property-based fuzz for isCleartextBaseUrl: the function must never let a
// cleartext http: endpoint to a non-loopback host slip through (miss), and
// must flag exactly that set.
const test = require('node:test');
const assert = require('node:assert/strict');
const fc = require('fast-check');

const { isCleartextBaseUrl } = require('./cleartext-base-url');

const NUM_RUNS = 400;

const hostArb = fc.oneof(
  fc.constantFrom(
    '127.0.0.1', 'localhost', '[::1]', '127.1', '2130706433', '0x7f000001',
    '127.0.0.1.', 'localhost.', '127.0.0.2', '0.0.0.0', '10.0.0.1', '192.168.1.1',
    'example.com', 'api.deepseek.com', 'a.localhost', 'x.local', '',
  ),
  fc.tuple(fc.nat(255), fc.nat(255), fc.nat(255), fc.nat(255)).map((o) => o.join('.')),
  fc.domain(),
);
const urlArb = fc.tuple(
  fc.constantFrom('http', 'https', 'HTTP', 'Http', 'file', 'ftp', 'ws', ' http'),
  fc.option(fc.string({ unit: fc.constantFrom('u', 'p', '1', ':', '%'), maxLength: 8 })),
  hostArb,
  fc.option(fc.nat(65535)),
  fc.string({ maxLength: 15 }),
).map(([scheme, userinfo, host, port, tail]) => (
  `${scheme}://${userinfo === null ? '' : `${userinfo}@`}${host}${port === null ? '' : `:${port}`}${tail}`
));

test('never misses a cleartext http URL to a non-loopback host', () => {
  fc.assert(fc.property(urlArb, fc.string({ maxLength: 40 }), (built, loose) => {
    for (const value of [built, loose]) {
      let parsed;
      try { parsed = new URL(typeof value === 'string' ? value.trim() : ''); } catch { continue; }
      if (parsed.protocol !== 'http:') continue;
      const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
      const loopback = host === 'localhost' || host === '127.0.0.1' || host === '::1';
      if (!loopback) {
        assert.equal(isCleartextBaseUrl(value), true, `${value} is cleartext to ${parsed.hostname}`);
      }
    }
    return true;
  }), { numRuns: NUM_RUNS });
});

test('cleartext flag implies parseable http to a non-loopback hostname', () => {
  fc.assert(fc.property(urlArb, fc.string({ maxLength: 40 }), (built, loose) => {
    for (const value of [built, loose]) {
      if (!isCleartextBaseUrl(value)) continue;
      const parsed = new URL(value.trim());
      assert.equal(parsed.protocol, 'http:', value);
      const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
      assert.ok(host !== 'localhost' && host !== '127.0.0.1' && host !== '::1', value);
    }
    return true;
  }), { numRuns: NUM_RUNS });
});
