'use strict';

// Off-thread usage scanner for the live2d pet's token feeding. It lives on a
// worker thread on purpose: decoding + JSON-parsing a growing session log is
// O(log size), and on the Electron main thread the 60s rescan stalled every
// window and IPC for as long as the decode took. Magpie's usage.jsonl (tens of
// MB of JSON rows) is read here for the same reason.
//
// Loaded through asarUnpack — plain-node worker threads cannot read files
// inside app.asar (same constraint as dshd-daemon-runner). The unchanged
// file cache lives here across scans, so a steady-state tick is stat-only
// per log and only newly-written files pay a decode.
//
// Response contract: { id, ok, total, sessions, sampleTotals } — plus the
// optional `todayUsed` / `source` fields that only a Magpie answer carries.

const { parentPort } = require('node:worker_threads');
const { scanUsage } = require('./pet-growth');

const cache = new Map();

parentPort.on('message', (msg) => {
  if (!msg || msg.type !== 'scan') {
    return;
  }
  try {
    const result = scanUsage({
      sessionsDir: msg.sessionsDir || '',
      usageFile: msg.usageFile || '',
      cache,
      includeSamples: true,
    });
    parentPort.postMessage({
      id: msg.id,
      ok: true,
      total: result.total,
      sessions: result.sessions,
      sampleTotals: result.sampleTotals,
      ...(Number.isFinite(result.todayUsed) ? { todayUsed: result.todayUsed } : {}),
      ...(result.source ? { source: result.source } : {}),
    });
  } catch (err) {
    parentPort.postMessage({ id: msg.id, ok: false, error: String(err && err.message || err) });
  }
});
