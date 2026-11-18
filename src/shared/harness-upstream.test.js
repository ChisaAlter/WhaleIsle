'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  parsePin,
  readPin,
  writePin,
  assertFullSha,
  peelToCommit,
  readNpmVersion,
  assertRc5Witness,
  RC5_SHA,
  SQUASH_WITNESS,
} = require('./harness-upstream');

const RC5_PIN = {
  repo: 'https://github.com/deepseek-ai/deepseek-harness.git',
  ref: '47f943859bef60e4160492346772ded9b24f765a',
  sha: '47f943859bef60e4160492346772ded9b24f765a',
  npm: '0.1.0-rc.5',
};

// Keep git fixtures hermetic: no global insteadOf rewrites or system config.
process.env.GIT_CONFIG_GLOBAL = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-git-isolation-')), 'gitconfig');
fs.writeFileSync(process.env.GIT_CONFIG_GLOBAL, '');
// 模块级隔离目录由文件级钩子回收（#478）。
test.after(() => fs.rmSync(path.dirname(process.env.GIT_CONFIG_GLOBAL), { recursive: true, force: true }));
process.env.GIT_CONFIG_NOSYSTEM = '1';

function git(args, options) {
  return spawnSync('git', args, { encoding: 'utf8', shell: false, ...options });
}

test('parsePin accepts the rc.5 pin and rejects a short sha', () => {
  const pin = parsePin(JSON.stringify(RC5_PIN));
  assert.equal(pin.npm, '0.1.0-rc.5');
  assert.throws(() => parsePin(JSON.stringify({
    ...RC5_PIN,
    ref: 'master',
    sha: '47f9438',
  })), /40/);
});

test('parsePin rejects extra keys and a missing npm field', () => {
  assert.throws(() => parsePin(JSON.stringify({ ...RC5_PIN, extra: true })), /extra/);
  const missing = { repo: RC5_PIN.repo, ref: RC5_PIN.ref, sha: RC5_PIN.sha };
  assert.throws(() => parsePin(JSON.stringify(missing)), /npm/);
});

test('assertFullSha returns a 40-character sha and rejects anything else', () => {
  const sha = '99f6f02fecdb7dff40c3fbc9470f5907c29f74ca';
  assert.equal(assertFullSha(sha), sha);
  assert.throws(() => assertFullSha('99f6f02'), /40/);
});

test('writePin writes JSON with a trailing newline and readPin round-trips', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pin-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'vendor'));
  writePin(root, RC5_PIN);
  assert.deepEqual(readPin(root), RC5_PIN);
  const text = fs.readFileSync(path.join(root, 'vendor', 'harness-upstream.json'), 'utf8');
  assert.equal(text.endsWith('\n'), true);
  assert.equal(text, `${JSON.stringify(RC5_PIN, null, 2)}\n`);
});

test('peelToCommit and readNpmVersion read a real git commit', (t) => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'pin-git-'));
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  git(['init'], { cwd: repo });
  git(['config', 'user.email', 'test@example.com'], { cwd: repo });
  git(['config', 'user.name', 'test'], { cwd: repo });
  fs.mkdirSync(path.join(repo, 'apps', 'cli'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'apps', 'cli', 'package.json'), `${JSON.stringify({ version: '0.1.0-rc.7' })}\n`);
  git(['add', '.'], { cwd: repo });
  git(['commit', '-m', 'cli'], { cwd: repo });
  const sha = git(['rev-parse', 'HEAD'], { cwd: repo }).stdout.trim();
  const run = (args, options) => git(args, { cwd: repo, ...options });
  assert.equal(peelToCommit(run, 'HEAD'), sha);
  assert.equal(readNpmVersion(run, sha), '0.1.0-rc.7');
});

test('assertRc5Witness checks the squash tree only for the rc.5 pin', () => {
  const trees = {
    [`${RC5_SHA}^{tree}`]: 'same-tree',
    [`${SQUASH_WITNESS}^{tree}`]: 'same-tree',
  };
  const gitFn = (args) => {
    const spec = args[1];
    return { status: 0, stdout: `${trees[spec]}\n`, stderr: '' };
  };
  assert.doesNotThrow(() => assertRc5Witness(gitFn, RC5_PIN));
  assert.doesNotThrow(() => assertRc5Witness(gitFn, {
    ...RC5_PIN,
    sha: '99f6f02fecdb7dff40c3fbc9470f5907c29f74ca',
    ref: 'dsh-v0.1.0-rc.7',
    npm: '0.1.0-rc.7',
  }));
  const mismatch = (args) => ({
    status: 0,
    stdout: args[1] === `${RC5_SHA}^{tree}` ? 'aaa\n' : 'bbb\n',
    stderr: '',
  });
  assert.throws(() => assertRc5Witness(mismatch, RC5_PIN), /witness|tree/i);
});
