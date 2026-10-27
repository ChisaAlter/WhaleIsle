'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { UpdateJournal, updateJournalState } = require('./update-journal');

test('journal writes flushed JSONL milestones and dedupes identical states', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dshd-journal-'));
  const journal = new UpdateJournal(dir, '0.3.3');
  journal.action('check-requested');
  journal.state({ phase: 'available', version: '0.4.0' });
  journal.state({ phase: 'available', version: '0.4.0' }); // duplicate: no record
  journal.state({ phase: 'downloading', version: '0.4.0', percent: 42.7 });
  journal.action('install-confirmed');

  const lines = fs.readFileSync(journal.path, 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(lines[0].event, 'started');
  assert.equal(lines[1].event, 'check-requested');
  const states = lines.filter((l) => l.event === 'state');
  assert.equal(states.length, 2);
  assert.deepEqual(states[0].targetVersion, '0.4.0');
  assert.equal(states[1].percent, 42);
  assert.equal(lines.at(-1).event, 'install-confirmed');
  assert.equal(lines[0].version, '0.3.3');
});

test('journal rejects unknown actions and relative dirs', () => {
  assert.throws(() => new UpdateJournal('relative/dir', '0.3.3'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dshd-journal-'));
  const journal = new UpdateJournal(dir, '0.3.3');
  assert.throws(() => journal.action('free-text'));
});

test('updateJournalState whitelists fields and classifies error codes', () => {
  assert.deepEqual(updateJournalState({ phase: 'error', failedOperation: 'download', message: 'net::ERR_CONNECTION_RESET', extra: 'secret' }), {
    phase: 'error',
    failedOperation: 'download',
    errorCode: 'ERR_CONNECTION_RESET',
  });
  assert.deepEqual(updateJournalState({ phase: 'error', failedOperation: 'check', message: 'welp' }), {
    phase: 'error',
    failedOperation: 'check',
    errorCode: 'UNCLASSIFIED',
  });
});

test('recovery diagnostics distinguish checksum, transfer and cancellation without recording private data', () => {
  for (const [stage, code] of [['checksum', 'HTTP_ERROR_503'], ['checksum', 'ETIMEDOUT'],
    ['checksum', 'ERR_UPDATER_CHECKSUM_ENTRY_MISSING'], ['transfer', 'ERR_UPDATER_DIFFERENTIAL_FAILED'],
    ['transfer', 'ERR_UPDATER_INVALID_RANGE'], ['verification', 'ERR_UPDATER_CHECKSUM_MISMATCH'], ['verification', 'ERR_UPDATER_CANCELLED']]) {
    const state = updateJournalState({ phase: 'error', failedOperation: 'download', route: 'cnb',
      downloadMode: 'delta', stage, message: `${code} https://secret.test?token=private`, token: 'private' });
    assert.deepEqual(state, { phase: 'error', failedOperation: 'download', errorCode: code,
      route: 'cnb', downloadMode: 'delta', stage });
    assert.doesNotMatch(JSON.stringify(state), /private|https:/);
  }
  assert.deepEqual(updateJournalState({ phase: 'checking', route: 'unknown', stage: 'secret', downloadMode: 'unknown' }),
    { phase: 'checking' });
});
