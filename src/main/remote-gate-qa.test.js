'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  REMOTE_GATE_CASES,
  REMOTE_GATE_COLD_CASES,
  REMOTE_GATE_PARKED_CASES,
  assertRemoteGateQaResult,
  pairingOffer,
  pairingTransportReady,
  clipboardOfferMatchesExpectedHost,
  pairingChromeMatchesRelay,
  pairingControlsMatchRelay,
} = require('./remote-gate-qa');

test('remote gate cases cover NEG-001 and REM-001 without pairing fetch', () => {
  const ids = REMOTE_GATE_CASES.map((c) => c.id);
  assert.ok(ids.includes('neg.available'));
  assert.ok(ids.includes('neg.notListening'));
  assert.ok(ids.includes('neg.footerPresent'));
  assert.ok(ids.includes('rem.enabledListening'));
  assert.ok(ids.includes('rem.pairingOffer'));
  assert.ok(ids.includes('rem.qrVisible'));
  assert.ok(ids.includes('rem.disabledStopped'));
  assert.ok(ids.includes('cold.openShowsQr'));
  assert.ok(ids.includes('cold.noBareOfferText'));
  assert.ok(ids.includes('cold.copyAndRotateControls'));
  assert.equal(new Set(ids).size, ids.length);
  const src = fs.readFileSync(path.join(__dirname, 'remote-gate-qa.js'), 'utf8');
  assert.doesNotMatch(src, /loadURL\(|BrowserWindow/);
  assert.match(src, /not fetched/);
  assert.match(src, /data-dsh-remote-qr/);
  assert.doesNotMatch(src, /\/二维码\|QR\|配对\//);
  assert.match(src, /mode === 'cold'/);
  assert.match(src, /REMOTE_FEATURE_ENABLED/);
  assert.match(src, /parked\.noFooter/);
});

test('cold cases are a required subset', () => {
  const ids = REMOTE_GATE_COLD_CASES.map((c) => c.id);
  assert.deepEqual(ids, ['cold.openShowsQr', 'cold.noBareOfferText', 'cold.copyAndRotateControls']);
});

test('pairingOffer only accepts hash offers', () => {
  assert.equal(pairingOffer({ urls: [{ pairingUrl: 'http://10.0.0.4:3180/#offer=abc' }] }), 'http://10.0.0.4:3180/#offer=abc');
  assert.equal(pairingOffer({ urls: [{ pairingUrl: 'http://10.0.0.4:3180/?token=abc' }] }), '');
  assert.equal(pairingOffer({ urls: [] }), '');
});

test('pairing chrome follows the live relay control socket', () => {
  assert.equal(pairingChromeMatchesRelay({ hasQr: true, hasStatus: false }, true), true);
  assert.equal(pairingChromeMatchesRelay({ hasQr: false, hasStatus: true }, false), true);
  assert.equal(pairingChromeMatchesRelay({ hasQr: true, hasStatus: true }, false), false);
  assert.equal(pairingChromeMatchesRelay({ hasQr: false, hasStatus: false }, false), false);
  assert.equal(pairingChromeMatchesRelay(null, true), false);
  assert.equal(pairingControlsMatchRelay({ copy: true, rotate: true }, true, true), true);
  assert.equal(pairingControlsMatchRelay({ copy: true, rotate: true }, true, false), false);
  assert.equal(pairingControlsMatchRelay({ copy: false, rotate: false }, false, false), true);
  assert.equal(pairingControlsMatchRelay({ copy: true, rotate: false }, false, false), false);
});

test('pairingTransportReady supports LAN direct mode without relay connection', () => {
  assert.equal(pairingTransportReady({ mode: 'lan', lanReady: true, listening: true, relayConnected: false }), true);
  assert.equal(pairingTransportReady({ mode: 'lan', lanReady: true, listening: false, relayConnected: false }), false);
  assert.equal(pairingTransportReady({ mode: 'lan', lanReady: false, listening: true, relayConnected: false }), false);
  assert.equal(pairingTransportReady({ mode: 'relay', listening: true, relayConnected: true }), true);
  assert.equal(pairingTransportReady({ mode: 'relay', listening: true, relayConnected: false }), false);
  assert.equal(pairingTransportReady(null), false);
});

test('clipboardOfferMatchesExpectedHost accepts LAN loopback match and rejects unexpected hosts', () => {
  assert.equal(
    clipboardOfferMatchesExpectedHost('http://127.0.0.1:3180/#offer=link', 'http://127.0.0.1:3180/#offer=qr'),
    true,
  );
  assert.equal(
    clipboardOfferMatchesExpectedHost('http://192.168.1.25:3180/#offer=link', 'http://192.168.1.25:3180/#offer=qr'),
    true,
  );
  assert.equal(
    clipboardOfferMatchesExpectedHost('http://127.0.0.1:3180/#offer=link', 'https://relay.example.com/#offer=qr'),
    false,
  );
  assert.equal(
    clipboardOfferMatchesExpectedHost('http://10.0.0.5:3180/#offer=link', 'http://192.168.1.25:3180/#offer=qr'),
    false,
  );
  assert.equal(clipboardOfferMatchesExpectedHost('http://127.0.0.1:3180/#offer=link', ''), false);
  assert.equal(clipboardOfferMatchesExpectedHost('http://127.0.0.1:3180/', 'http://127.0.0.1:3180/#offer=qr'), false);
});

test('assertRemoteGateQaResult accepts a parked result', () => {
  assert.doesNotThrow(() => assertRemoteGateQaResult({
    ok: true,
    parked: true,
    steps: REMOTE_GATE_PARKED_CASES.map((c) => ({ name: c.id, ok: true })),
  }));
});

test('assertRemoteGateQaResult rejects missing cases', () => {
  assert.throws(
    () => assertRemoteGateQaResult({ ok: true, steps: [{ name: 'neg.available', ok: true }] }),
    /omitted required cases/,
  );
  assert.doesNotThrow(() => assertRemoteGateQaResult({
    ok: true,
    steps: REMOTE_GATE_CASES.map((c) => ({ name: c.id, ok: true })),
  }));
});

test('remote gate QA is wired into the main smoke path', () => {
  const smoke = fs.readFileSync(path.join(__dirname, 'smoke', 'index.js'), 'utf8');
  assert.match(smoke, /DSH_QA_REMOTE/);
  assert.match(smoke, /runRemoteGateQa/);
  assert.match(smoke, /remoteGateMode/);
  const runner = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'run-remote-gate-qa.mjs'), 'utf8');
  assert.match(runner, /DSH_QA_REMOTE: 'cold'/);
  assert.match(runner, /skipped cold boot/);
  const pkg = fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8');
  assert.match(pkg, /prestart-ensure\.mjs && node scripts\/run-remote-gate-qa/);
});
