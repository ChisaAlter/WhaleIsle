'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { EventEmitter } = require('node:events');
const { once } = require('node:events');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const forensicsLog = require('./forensics-log');

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  return child;
}

test('bootLogPath points at logs/last-external-boot.log under the state dir', () => {
  const file = forensicsLog.bootLogPath(path.join('C:\\state', 'dir'));
  assert.equal(file, path.join('C:\\state', 'dir', 'logs', 'last-external-boot.log'));
});

test('attachBootLog pipes child stdout and stderr into the file', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-flog-'));
  try {
    const file = forensicsLog.bootLogPath(dir);
    const child = fakeChild();
    const log = forensicsLog.attachBootLog(child, file);
    child.stdout.emit('data', Buffer.from('cordis boot ok\n'));
    child.stderr.emit('data', "failed to apply loader entry app (@evil/plugin)\n");
    await log.flush();
    const text = fs.readFileSync(file, 'utf8');
    assert.match(text, /cordis boot ok/);
    assert.match(text, /failed to apply loader entry app \(@evil\/plugin\)/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('attachBootLog truncates a stale log so the file is one boot only', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-flog-trunc-'));
  try {
    const file = forensicsLog.bootLogPath(dir);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'previous boot evidence\n');
    const child = fakeChild();
    const log = forensicsLog.attachBootLog(child, file);
    child.stdout.emit('data', 'fresh boot\n');
    await log.flush();
    const text = fs.readFileSync(file, 'utf8');
    assert.ok(!text.includes('previous boot evidence'));
    assert.ok(text.includes('fresh boot'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('attachBootLog caps the file at MAX_BYTES and keeps the tail', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-flog-rot-'));
  try {
    const file = forensicsLog.bootLogPath(dir);
    const child = fakeChild();
    const log = forensicsLog.attachBootLog(child, file);
    // ~40 x 32KiB pushes well past the 512KiB cap several times over.
    for (let i = 0; i < 40; i += 1) {
      child.stdout.emit('data', Buffer.from(`line-${String(i).padStart(3, '0')} ${'x'.repeat(32 * 1024)}\n`));
    }
    await log.flush();
    const text = fs.readFileSync(file, 'utf8');
    assert.ok(Buffer.byteLength(text) <= forensicsLog.MAX_BYTES);
    assert.ok(text.includes('line-039'), 'newest line kept');
    assert.ok(!text.includes('line-000'), 'oldest line dropped');
    // Rotation restarts on a line boundary, not a mid-line fragment.
    assert.match(text, /^line-\d{3} /);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('attachBootLog line() writes a timestamped verdict line', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-flog-line-'));
  try {
    const file = forensicsLog.bootLogPath(dir);
    const child = fakeChild();
    const log = forensicsLog.attachBootLog(child, file);
    log.line('external runtime exited code 1');
    await log.flush();
    const text = fs.readFileSync(file, 'utf8');
    assert.match(text, /\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    assert.match(text, /external runtime exited code 1/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('attachBootLog survives a denied fs without throwing', async () => {
  const denied = Object.create(fs);
  for (const name of ['mkdirSync', 'writeFileSync', 'appendFileSync', 'readFileSync']) {
    denied[name] = () => {
      throw Object.assign(new Error('denied'), { code: 'EPERM' });
    };
  }
  Object.defineProperty(denied, 'promises', { value: Object.fromEntries(
    ['mkdir', 'writeFile', 'appendFile', 'readFile'].map((name) => [name, async () => {
      throw Object.assign(new Error('denied'), { code: 'EPERM' });
    }]),
  ) });
  const child = fakeChild();
  const log = forensicsLog.attachBootLog(child, 'C:\\denied\\boot.log', { fs: denied });
  assert.doesNotThrow(() => {
    child.stdout.emit('data', Buffer.from('crash line\n'));
    child.stderr.emit('data', Buffer.from('more\n'));
    log.line('launcher verdict: runtime-exited');
  });
  const result = await log.flush();
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'EPERM');
});

test('attachBootLog tolerates a child with no piped streams and stream errors', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-flog-nostream-'));
  try {
    const file = forensicsLog.bootLogPath(dir);
    // A spawn-rejected child shape: no stdout/stderr at all.
    const bare = new EventEmitter();
    bare.on('error', () => {});
    const log = forensicsLog.attachBootLog(bare, file);
    assert.doesNotThrow(() => bare.emit('error', new Error('ENOENT')));
    log.line('launcher verdict: spawn failed (ENOENT)');
    await log.flush();
    assert.match(fs.readFileSync(file, 'utf8'), /ENOENT/);
    // Stream-level errors must not escape either.
    const child = fakeChild();
    const nextLog = forensicsLog.attachBootLog(child, file);
    assert.doesNotThrow(() => child.stdout.emit('error', new Error('EPIPE')));
    await nextLog.flush();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('exited child flush drains backpressured stdio and retains the final crash evidence', { timeout: 10000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-flog-drain-'));
  const child = spawn(process.execPath, ['-e',
    'for(let i=0;i<48;i++)process.stdout.write("line-"+i+" "+"x".repeat(32768)+"\\n");process.stdout.write("FINAL_CRASH_EVIDENCE\\n");process.exitCode=1;',
  ], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let pauses = 0;
  const pause = child.stdout.pause.bind(child.stdout);
  child.stdout.pause = () => { pauses += 1; return pause(); };
  const delayedFs = Object.create(fs);
  Object.defineProperty(delayedFs, 'promises', { value: {
    ...fs.promises,
    appendFile: async (...args) => {
      await new Promise((resolve) => setTimeout(resolve, 2));
      return fs.promises.appendFile(...args);
    },
  } });
  try {
    const file = forensicsLog.bootLogPath(dir);
    const log = forensicsLog.attachBootLog(child, file, { fs: delayedFs });
    const [code] = await once(child, 'exit');
    assert.equal(code, 1);
    assert.equal((await log.flush()).ok, true);
    assert.ok(pauses > 0, 'slow writes exerted actual stream backpressure');
    assert.match(fs.readFileSync(file, 'utf8'), /FINAL_CRASH_EVIDENCE\n$/);
    assert.ok(fs.statSync(file).size <= forensicsLog.MAX_BYTES);
    assert.ok((await forensicsLog.readBootLogTailAsync(file)).includes('FINAL_CRASH_EVIDENCE'));
  } finally {
    if (child.exitCode === null) child.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('signal-exited child flush waits for unread stdio before returning', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-flog-signal-drain-'));
  const child = fakeChild();
  child.exitCode = null;
  child.signalCode = 'SIGTERM';
  const file = forensicsLog.bootLogPath(dir);
  const log = forensicsLog.attachBootLog(child, file);
  let complete = false;
  const pending = log.flush().then(() => { complete = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(complete, false);
  child.stdout.emit('data', Buffer.from('FINAL_SIGNAL_EVIDENCE\n'));
  child.emit('close', null, 'SIGTERM');
  await pending;
  assert.match(fs.readFileSync(file, 'utf8'), /FINAL_SIGNAL_EVIDENCE\n$/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('readBootLogTail returns the last N non-empty lines', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-flog-tail-'));
  try {
    const file = path.join(dir, 'boot.log');
    const lines = Array.from({ length: 10 }, (_, i) => `evidence-${i}`);
    fs.writeFileSync(file, `${lines.join('\r\n')}\n\n\n`);
    assert.deepEqual(
      forensicsLog.readBootLogTail(file, { maxLines: 3 }),
      ['evidence-7', 'evidence-8', 'evidence-9'],
    );
    assert.equal(forensicsLog.readBootLogTail(file).length, 10);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('readBootLogTail returns [] for a missing file', () => {
  const missing = path.join(os.tmpdir(), 'dsh-flog-none', 'boot.log');
  assert.deepEqual(forensicsLog.readBootLogTail(missing), []);
});

test('readBootLogTail returns [] when the path is unreadable', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-flog-eisdir-'));
  try {
    assert.deepEqual(forensicsLog.readBootLogTail(dir), []);
    const denied = {
      readFileSync: () => {
        throw Object.assign(new Error('denied'), { code: 'EACCES' });
      },
    };
    assert.deepEqual(forensicsLog.readBootLogTail('C:\\x\\boot.log', {}, { fs: denied }), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
