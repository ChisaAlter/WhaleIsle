'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { RUNNER_PATH } = require('./dshd-remote');

const tempDirs = [];
test.after(() => {
  while (tempDirs.length) fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
});

function writeStubServerExport({ startDelayMs = 0, throwOnDisconnect = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-runner-ctl-stub-'));
  tempDirs.push(dir);
  const file = path.join(dir, 'exports.mjs');
  fs.writeFileSync(file, [
    'import fs from "node:fs";',
    'export function createRootLogger() {',
    '  const logger = { info() {}, warn() {}, error() {}, child() { return logger; } };',
    '  return logger;',
    '}',
    'export async function createChisaCodeDaemon(config) {',
    '  return {',
    '    async start() {',
    `      if (${startDelayMs} > 0) await new Promise((r) => setTimeout(r, ${startDelayMs}));`,
    '    },',
    '    async stop() {},',
    '    async disconnectDevice(deviceId) {',
    '      if (config.logFile) fs.appendFileSync(config.logFile, deviceId + "\\n");',
    `      if (${throwOnDisconnect}) throw new Error("disconnect-boom");`,
    '      return 2;',
    '    },',
    '  };',
    '}',
    '',
  ].join('\n'));
  return { dir, file };
}

function spawnControlRunner(t, options = {}) {
  const { dir, file } = writeStubServerExport(options);
  const logFile = path.join(dir, 'disconnect-calls.log');
  const launchFile = path.join(dir, 'daemon-launch.json');
  fs.writeFileSync(launchFile, JSON.stringify({
    serverExport: file,
    daemonConfig: { listen: '127.0.0.1:16801', chisacodeHome: dir, logFile },
  }));

  const child = spawn(process.execPath, [RUNNER_PATH, launchFile], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const lines = [];
  let buf = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buf += chunk;
    let nl = buf.indexOf('\n');
    while (nl !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) {
        try { lines.push(JSON.parse(line)); } catch { lines.push({ raw: line }); }
      }
      nl = buf.indexOf('\n');
    }
  });
  const exit = new Promise((resolve) => {
    child.once('exit', (code, signal) => resolve({ code, signal }));
    child.once('error', () => resolve({ code: null, signal: null }));
  });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      try { child.kill('SIGKILL'); } catch { /* exited */ }
      await exit;
    }
  });
  const waitFor = (predicate, timeoutMs = 10_000) => new Promise((resolve, reject) => {
    const started = Date.now();
    const poll = () => {
      const hit = lines.find(predicate);
      if (hit) { resolve(hit); return; }
      if (Date.now() - started >= timeoutMs) {
        reject(new Error(`Timed out waiting for record. Received: ${JSON.stringify(lines)}`));
        return;
      }
      setTimeout(poll, 20);
    };
    poll();
  });
  return { child, lines, logFile, waitFor, exit };
}

test('a) queues revoke-device sent while daemon.start() is delayed and ACKs before/with ready', async (t) => {
  const runner = spawnControlRunner(t, { startDelayMs: 500 });
  runner.child.stdin.write('revoke-device dev_A req1\n');
  const ack = await runner.waitFor((r) => r.msg === 'dshd_daemon_device_revoked' && r.requestId === 'req1');
  await runner.waitFor((r) => r.msg === 'dshd_daemon_ready');
  assert.equal(ack.deviceId, 'dev_A');
  assert.equal(ack.disconnected, 2);
  const readyIdx = runner.lines.findIndex((r) => r.msg === 'dshd_daemon_ready');
  const ackIdx = runner.lines.findIndex((r) => r.msg === 'dshd_daemon_device_revoked' && r.requestId === 'req1');
  assert.ok(ackIdx >= 0 && ackIdx < readyIdx, 'queued revocation must flush before dshd_daemon_ready');
  assert.match(fs.readFileSync(runner.logFile, 'utf8'), /^dev_A/m);
});

test('b) processes 100 KB complete line followed by revoke-device in the same chunk without truncation', async (t) => {
  const runner = spawnControlRunner(t);
  await runner.waitFor((r) => r.msg === 'dshd_daemon_ready');
  const bigCookieLine = `harness-cookie ${'x'.repeat(100 * 1024)}\nrevoke-device dev_B req2\n`;
  runner.child.stdin.write(bigCookieLine);
  const ack = await runner.waitFor((r) => r.msg === 'dshd_daemon_device_revoked' && r.requestId === 'req2');
  assert.equal(ack.deviceId, 'dev_B');
  assert.equal(runner.lines.some((r) => r.msg === 'dshd_daemon_control_line_rejected'), false);
});

test('c) rejects oversized unterminated fragment (>64 KB) and recovers for next line', async (t) => {
  const runner = spawnControlRunner(t);
  await runner.waitFor((r) => r.msg === 'dshd_daemon_ready');
  runner.child.stdin.write('harness-cookie ' + 'z'.repeat(70 * 1024));
  const rejected = await runner.waitFor((r) => r.msg === 'dshd_daemon_control_line_rejected');
  assert.equal(rejected.reason, 'too-long');
  runner.child.stdin.write('\nrevoke-device dev_C req3\n');
  const ack = await runner.waitFor((r) => r.msg === 'dshd_daemon_device_revoked' && r.requestId === 'req3');
  assert.equal(ack.deviceId, 'dev_C');
});

test('d) emits dshd_daemon_revoke_error with requestId when disconnectDevice rejects', async (t) => {
  const runner = spawnControlRunner(t, { throwOnDisconnect: true });
  await runner.waitFor((r) => r.msg === 'dshd_daemon_ready');
  runner.child.stdin.write('revoke-device dev_D req4\n');
  const errLine = await runner.waitFor((r) => r.msg === 'dshd_daemon_revoke_error' && r.requestId === 'req4');
  assert.equal(errLine.deviceId, 'dev_D');
  assert.match(errLine.error, /disconnect-boom/);
});
