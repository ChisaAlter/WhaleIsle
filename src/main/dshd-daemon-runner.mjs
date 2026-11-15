#!/usr/bin/env node
/**
 * DSHD remote daemon runner — child-process host for createChisaCodeDaemon
 * (Touching: remote-settings).
 *
 * Mirrors upstream chisacode desktop's daemon-manager shape: the Electron main
 * process never runs the daemon in-process; it spawns this script with
 * `ELECTRON_RUN_AS_NODE=1` and explicit piped stdio, so a daemon-side crash
 * can never take the GUI down. Differences from upstream (documented in
 * docs/superpowers/plans/2026-08-28-remote-epipe-hardening.md): the desktop
 * product binds the daemon lifecycle to the app, so the child self-terminates
 * when its stdin closes — a dead parent never leaves an orphan daemon. It is
 * spawned as a POSIX process-group leader (src/shared/process-tree.js
 * spawnTreeOptions) so the shared tree stop reaches daemon descendants; the
 * stdin-close contract is unchanged.
 *
 * Protocol (all stdout lines are JSON records with a `msg` field; the pino
 * root logger also writes JSON to stdout, so the parent parses one uniform
 * stream):
 *   - `dshd_daemon_ready`        daemon started; `listen` carries the bind
 *   - `dshd_daemon_start_failed` startup threw; process exits 1
 *   - `dshd_daemon_stopped`      graceful stop completed; process exits 0
 *   - stdin line `stop`          graceful stop request from the parent
 *   - stdin line `harness-origin|harness-cookie|git-tunnel-token …`
 *                                parent-delivered credentials (never env/argv)
 *   - stdin end/close            parent died → graceful stop
 *
 * argv[2] is the path to a launch JSON file:
 *   { serverExport: string, daemonConfig: ChisaCodeDaemonConfig, logLevel? }
 * The file never contains credentials — DEEPSEEK_* arrives via process env.
 */

import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { installDesktopRpcHooks, applyDaemonStdinLine } from './dshd-daemon-hooks.mjs';

installDesktopRpcHooks();

// A broken parent pipe must never crash the daemon host (same law as the
// desktop's stdio-guard). stdin errors are handled below as a stop signal.
for (const stream of [process.stdout, process.stderr]) {
  stream.on('error', () => {});
}

/** Control-line writer independent of pino so lifecycle lines always flush. */
function emit(record) {
  try {
    process.stdout.write(`${JSON.stringify(record)}\n`);
  } catch {
    // Parent pipe gone; nothing left to tell.
  }
}

function errorText(err) {
  if (err instanceof Error) {
    return err.stack || err.message;
  }
  return String(err);
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

let daemon = null;
let stopping = false;
let startSettled = Promise.resolve();

async function shutdown(reason) {
  if (stopping) {
    return;
  }
  stopping = true;
  // A stop can race daemon construction; wait for start to settle so the
  // half-built daemon is not abandoned with its ports still binding.
  try {
    await withTimeout(startSettled, 10_000);
  } catch {
    // Startup hang — fall through and exit anyway.
  }
  if (daemon && typeof daemon.stop === 'function') {
    try {
      await withTimeout(daemon.stop(), 5_000);
    } catch (err) {
      emit({ msg: 'dshd_daemon_stop_error', reason, error: errorText(err) });
    }
  }
  emit({ msg: 'dshd_daemon_stopped', reason });
  process.exit(0);
}

process.on('SIGTERM', () => { void shutdown('sigterm'); });
process.on('SIGINT', () => { void shutdown('sigint'); });
process.on('uncaughtException', (err) => {
  emit({ msg: 'dshd_daemon_crash', error: errorText(err) });
  process.exit(1);
});
process.on('unhandledRejection', (err) => {
  emit({ msg: 'dshd_daemon_crash', error: errorText(err) });
  process.exit(1);
});

// stdin is the cross-platform graceful-stop channel (Windows has no trappable
// SIGTERM); its close means the parent is gone and this host must not linger.
let stdinBuffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  stdinBuffer += chunk;
  let newline = stdinBuffer.indexOf('\n');
  while (newline !== -1) {
    const line = stdinBuffer.slice(0, newline).trim();
    stdinBuffer = stdinBuffer.slice(newline + 1);
    const kind = applyDaemonStdinLine(line);
    if (kind === 'stop') {
      void shutdown('stop');
    }
    newline = stdinBuffer.indexOf('\n');
  }
});
process.stdin.on('end', () => { void shutdown('stdin-closed'); });
process.stdin.on('error', () => { void shutdown('stdin-error'); });
process.stdin.resume();

let launch = null;
try {
  launch = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
} catch (err) {
  emit({ msg: 'dshd_daemon_start_failed', error: `launch file unreadable: ${errorText(err)}` });
  process.exit(1);
}

async function start() {
  const api = await import(pathToFileURL(launch.serverExport).href);
  const logger = api.createRootLogger(
    { log: { level: launch.logLevel || 'info', format: 'json' } },
    { chisacodeHome: launch.daemonConfig.chisacodeHome, file: false },
  );
  // Full daemon — createChisaCodeDaemon, not a hello-only stub.
  daemon = await api.createChisaCodeDaemon(launch.daemonConfig, logger);
  await daemon.start();
  emit({ msg: 'dshd_daemon_ready', listen: launch.daemonConfig.listen || '' });
}

const startAttempt = start();
startSettled = startAttempt.catch(() => {});
try {
  await startAttempt;
} catch (err) {
  if (!stopping) {
    emit({ msg: 'dshd_daemon_start_failed', error: errorText(err) });
    process.exit(1);
  }
}
