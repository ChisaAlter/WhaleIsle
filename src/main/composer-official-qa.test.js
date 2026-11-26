'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  COMPOSER_OFFICIAL_CASES,
  SESSIONS_INJECT_TRIPWIRE,
  assertComposerOfficialQaResult,
  remoteHasError,
  summarizeRemoteQaDetail,
  pairingUrlAndPort,
} = require('./composer-official-qa');

test('composer official cases cover the plan claims', () => {
  const ids = COMPOSER_OFFICIAL_CASES.map((c) => c.id);
  assert.ok(ids.includes('case.mention.writesMarkdown'));
  assert.ok(ids.includes('case.mention.noSessionsCrash'));
  assert.ok(ids.includes('case.preview.addToChat'));
  assert.ok(ids.includes('case.dollar.noLocalSkillMenu'));
  assert.ok(ids.includes('case.at.noDesktopPathSource'));
  assert.ok(ids.includes('case.terminal.addToChat'));
  assert.ok(ids.includes('case.remote.available'));
  assert.ok(ids.includes('case.remote.listening'));
  assert.ok(ids.includes('case.remote.spa'));
  assert.ok(ids.includes('case.remote.pairingSpa'));
  assert.match(
    require('node:fs').readFileSync(require('node:path').join(__dirname, 'composer-official-qa.js'), 'utf8'),
    /parked: no pairing SPA/,
  );
  assert.equal(new Set(ids).size, ids.length);
});

test('sessions inject tripwire matches the live crash text', () => {
  assert.match(
    'Uncaught Error: cannot get property "sessions" without inject',
    SESSIONS_INJECT_TRIPWIRE,
  );
  assert.doesNotMatch('Uncaught TypeError: something else', SESSIONS_INJECT_TRIPWIRE);
});

test('assertComposerOfficialQaResult rejects missing or failed cases', () => {
  assert.throws(
    () => assertComposerOfficialQaResult({ ok: false, failed: ['case.mention.writesMarkdown'], steps: [] }),
    /case\.mention\.writesMarkdown/,
  );
  const steps = COMPOSER_OFFICIAL_CASES
    .filter((c) => c.id !== 'case.remote.listening')
    .map((c) => ({ name: c.id, ok: true, detail: '' }));
  assert.throws(
    () => assertComposerOfficialQaResult({ ok: true, failed: [], steps }),
    /case\.remote\.listening/,
  );
  assert.doesNotThrow(() => assertComposerOfficialQaResult({
    ok: true,
    failed: [],
    steps: COMPOSER_OFFICIAL_CASES.map((c) => ({ name: c.id, ok: true, detail: '' })),
  }));
});

test('remoteHasError treats an empty string as no error', () => {
  assert.equal(remoteHasError({ error: '' }), false);
  assert.equal(remoteHasError({ error: '   ' }), false);
  assert.equal(remoteHasError({ error: 'boom' }), true);
  assert.equal(remoteHasError({ error: null }), false);
  assert.equal(remoteHasError(null), false);
});

test('summarizeRemoteQaDetail keeps status and strips pairing secrets', () => {
  const detail = summarizeRemoteQaDetail({
    available: true,
    enabled: true,
    listening: true,
    port: 3180,
    token: 'secret-token-value',
    mode: 'lan',
    error: '',
    urls: [{
      address: '10.0.0.4',
      url: 'http://10.0.0.4:3180/',
      pairingUrl: 'http://10.0.0.4:3180/#offer=secret-token-value',
    }],
  });
  assert.match(detail, /available=true/);
  assert.match(detail, /listening=true/);
  assert.match(detail, /tokenPresent=true/);
  assert.doesNotMatch(detail, /secret-token-value/);
  assert.doesNotMatch(detail, /pairingUrl/);
  assert.doesNotMatch(detail, /#offer=/);
});

test('composer official QA types into the Lexical composer input', () => {
  const source = fs.readFileSync(path.join(__dirname, 'composer-official-qa.js'), 'utf8');
  assert.match(source, /dshComposerReady/);
  assert.match(source, /typeIntoComposer/);
  assert.match(source, /clickNewSession/);
  assert.match(source, /dshComposerText/);
  assert.match(source, /L1 to L\\d\+ `note\\.md`/);
});

test('composer official QA module is wired into the main process smoke path', () => {
  const smoke = fs.readFileSync(path.join(__dirname, 'smoke', 'index.js'), 'utf8');
  assert.match(smoke, /runComposerOfficialQa/);
  assert.match(smoke, /DSH_QA_COMPOSER/);
  const source = fs.readFileSync(path.join(__dirname, 'composer-official-qa.js'), 'utf8');
  assert.match(source, /summarizeRemoteQaDetail\(remoteSnap\)/);
  assert.doesNotMatch(source, /JSON\.stringify\(remoteSnap\)/);
  assert.doesNotMatch(source, /return root && dshFind\(/);
  assert.match(source, /REMOTE_FEATURE_ENABLED/);
});

test('pairingUrlAndPort preserves mobile web server port instead of daemon port', () => {
  assert.equal(
    pairingUrlAndPort({
      port: 6767,
      urls: [{ pairingUrl: 'http://192.168.1.25:3180/#offer=abc123' }],
    }),
    'http://127.0.0.1:3180/#offer=abc123',
  );
  assert.equal(pairingUrlAndPort({ port: 6767, urls: [{ pairingUrl: 'http://192.168.1.25:3180/' }] }), '');
  assert.equal(pairingUrlAndPort(null), '');
});
