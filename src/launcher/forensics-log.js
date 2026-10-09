'use strict';

// Slim-launcher boot evidence: the spawned external runtime is detached and
// its stdio would otherwise be discarded, so a plugin-caused startup crash
// left no attributable lines for collectForensics. attachBootLog pipes child
// stdout/stderr into one bounded file that keeps the TAIL — the crash lines
// live at the end — and every fs failure degrades to a no-op so logging can
// never take the spawn path down. readBootLogTail feeds the forensics corpus
// in launcher-service.
const fs = require('fs');
const path = require('path');

const MAX_BYTES = 512 * 1024;
const ROTATE_KEEP_BYTES = Math.floor(MAX_BYTES / 2);
const TAIL_LINES = 200;
const WRITE_HIGH_WATER_BYTES = 256 * 1024;
const WRITE_LOW_WATER_BYTES = 64 * 1024;
const writers = new Map();

function noop() {}

function bootLogPath(stateDir) {
  return path.join(stateDir, 'logs', 'last-external-boot.log');
}

// Drop the oldest half once over cap, restarting on a line boundary so the
// kept tail stays parseable evidence instead of a mid-token fragment.
async function rotateTail(file, fsp) {
  const buf = await fsp.readFile(file);
  let tail = buf.subarray(Math.max(0, buf.length - ROTATE_KEEP_BYTES));
  const newline = tail.indexOf(0x0a);
  if (newline >= 0 && newline < tail.length - 1) {
    tail = tail.subarray(newline + 1);
  }
  await fsp.writeFile(file, tail);
  return tail.length;
}

function attachBootLog(child, file, deps = {}) {
  const fsp = (deps.fs || fs).promises;
  if (!file) {
    return { write: noop, line: noop, flush: async () => ({ ok: true }) };
  }
  let size = 0;
  let queuedBytes = 0;
  let lastError = null;
  let paused = false;
  let closed = false;
  let resolveClosed;
  const whenClosed = new Promise((resolve) => { resolveClosed = resolve; });
  const streams = [child && child.stdout, child && child.stderr].filter(Boolean);
  const failed = (error) => { lastError = error; };
  let pending = Promise.resolve().then(async () => {
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, '');
  }).catch(failed);
  const flowControl = () => {
    if (!paused && queuedBytes >= WRITE_HIGH_WATER_BYTES) {
      paused = true;
      for (const stream of streams) stream.pause?.();
    } else if (paused && queuedBytes <= WRITE_LOW_WATER_BYTES) {
      paused = false;
      for (const stream of streams) stream.resume?.();
    }
  };
  const write = (chunk) => {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    queuedBytes += buf.length;
    flowControl();
    pending = pending.then(async () => {
      await fsp.appendFile(file, buf);
      size += buf.length;
      if (size > MAX_BYTES) {
        size = await rotateTail(file, fsp);
      }
    }).catch(failed).finally(() => {
      queuedBytes -= buf.length;
      flowControl();
    });
    return pending;
  };
  const line = (text) => {
    write(`\n[${new Date().toISOString()}] ${String(text)}\n`);
  };
  const flush = async () => {
    // A child can exit with unread bytes still held by our backpressure.
    // Its close event follows stdio drainage; a healthy detached runtime must
    // not be awaited here because it deliberately continues running.
    if (!closed && (child?.exitCode != null || child?.signalCode != null)) await whenClosed;
    await pending;
    // Logging remains best effort; callers can observe a write error without
    // replacing the runtime's actual launch verdict with a logging failure.
    return lastError ? { ok: false, error: lastError } : { ok: true };
  };
  const writer = { write, line, flush };
  writers.set(file, writer);
  child?.once?.('close', () => {
    closed = true;
    resolveClosed();
    void flush().then(() => {
      if (writers.get(file) === writer) writers.delete(file);
    });
  });
  for (const stream of streams) {
    if (stream && typeof stream.on === 'function') {
      stream.on('data', write);
      stream.on('error', noop);
      // Preserve detached-spawn semantics: the pipes must not pin the
      // launcher's event loop open any more than the child handle does.
      if (typeof stream.unref === 'function') {
        stream.unref();
      }
    }
  }
  return writer;
}

/**
 * Last `options.maxLines` non-empty lines for the forensics corpus, or []
 * when the file is missing/unreadable (no external boot has happened yet).
 */
function readBootLogTail(file, options = {}, deps = {}) {
  const fsm = deps.fs || fs;
  const maxLines = options.maxLines ?? TAIL_LINES;
  try {
    const text = fsm.readFileSync(file, 'utf8');
    return text
      .split('\n')
      .map((row) => row.replace(/\r$/, ''))
      .filter((row) => row.trim().length > 0)
      .slice(-maxLines);
  } catch {
    return [];
  }
}

async function readBootLogTailAsync(file, options = {}, deps = {}) {
  const fsp = (deps.fs || fs).promises;
  try {
    await writers.get(file)?.flush();
    const text = await fsp.readFile(file, 'utf8');
    return text.split('\n').map((row) => row.replace(/\r$/, ''))
      .filter((row) => row.trim().length > 0).slice(-(options.maxLines ?? TAIL_LINES));
  } catch {
    return [];
  }
}

async function flushBootLogs() {
  return Promise.all([...writers.values()].map((writer) => writer.flush()));
}

module.exports = {
  MAX_BYTES,
  TAIL_LINES,
  bootLogPath,
  attachBootLog,
  readBootLogTail,
  readBootLogTailAsync,
  flushBootLogs,
};
