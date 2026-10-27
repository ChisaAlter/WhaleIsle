'use strict';

/**
 * Update evidence journal: JSONL milestones outside the installation
 * directory so update decisions correlate across restarts. Ported from
 * upstream apps/desktop/update-journal.ts; no raw diagnostics or URLs.
 */

const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ERROR_CODES = ['ETIMEDOUT', 'ENOSPC', 'ERR_INTERNET_DISCONNECTED', 'ERR_CONNECTION_RESET',
  'ERR_CONNECTION_CLOSED', 'ERR_NAME_NOT_RESOLVED', 'ERR_UPDATER_INVALID_SIGNATURE', 'ERR_UPDATER_CHECKSUM_MISMATCH',
  'ERR_UPDATER_CHECKSUM_FETCH_FAILED', 'ERR_UPDATER_CHECKSUM_ENTRY_MISSING', 'ERR_UPDATER_DIFFERENTIAL_FAILED',
  'ERR_UPDATER_CANCELLED', 'ERR_UPDATER_INVALID_RANGE', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH',
  ...[400, 401, 403, 404, 408, 429, 500, 502, 503, 504].map(status => `HTTP_ERROR_${status}`)];

const ACTIONS = new Set(['started', 'workspace-ready', 'workspace-failed',
  'check-requested', 'download-requested', 'install-confirmed', 'quit-requested']);

/** Whitelist one update state for disk; no free text or unexpected fields. */
function updateJournalState(state) {
  const out = {
    phase: state.phase,
    ...(state.version !== undefined ? { targetVersion: state.version } : {}),
    ...(state.phase === 'downloading' && state.percent !== undefined ? { percent: Math.floor(state.percent) } : {}),
    ...(['github', 'cnb'].includes(state.route) ? { route: state.route } : {}),
    ...(['full', 'delta'].includes(state.downloadMode) ? { downloadMode: state.downloadMode } : {}),
    ...(['checksum', 'transfer', 'verification', 'installation'].includes(state.stage) ? { stage: state.stage } : {}),
    ...(state.phase === 'error' ? {
      failedOperation: state.failedOperation,
      errorCode: ERROR_CODES.find((code) => String(state.message ?? '').includes(code)) ?? 'UNCLASSIFIED',
    } : {}),
  };
  return out;
}

/** Process-owned JSONL evidence; each append flushes before returning. */
class UpdateJournal {
  constructor(directory, version) {
    if (!path.isAbsolute(directory)) throw new Error('update journal: directory must be absolute');
    fs.mkdirSync(directory, { recursive: true });
    this.path = path.join(directory, `${Date.now()}-${randomUUID()}.jsonl`);
    this.version = version;
    this.sequence = 0;
    this.previousState = undefined;
    fs.writeFileSync(this.path, '', { flag: 'wx', mode: 0o600 });
    this.action('started');
  }

  /** Append a fixed action; failures propagate. */
  action(action) {
    if (!ACTIONS.has(action)) throw new Error(`update journal: unknown action ${String(action)}`);
    this.append({ event: action });
  }

  /** Retain state changes and integer progress without raw errors or URLs. */
  state(state) {
    const fields = updateJournalState(state);
    const encoded = JSON.stringify(fields);
    if (encoded === this.previousState) return;
    this.append({ event: 'state', ...fields });
    this.previousState = encoded;
  }

  append(fields) {
    fs.appendFileSync(this.path, `${JSON.stringify({ schemaVersion: 1, sequence: this.sequence++,
      time: new Date().toISOString(), pid: process.pid, version: this.version, ...fields })}\n`, { flush: true });
  }
}

module.exports = { UpdateJournal, updateJournalState };
