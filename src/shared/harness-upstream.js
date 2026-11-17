'use strict';

const fs = require('node:fs');
const path = require('node:path');

/** @typedef {{ repo: string, ref: string, sha: string, npm: string }} HarnessPin */

const PIN_RELATIVE = 'vendor/harness-upstream.json';
const DEFAULT_REPO = 'https://github.com/deepseek-ai/deepseek-harness.git';
const RC5_SHA = '47f943859bef60e4160492346772ded9b24f765a';
const SQUASH_WITNESS = 'd2df50d17fdca6547e14264efc2cf4fc526e9a7a';
const FULL_SHA = /^[0-9a-f]{40}$/;
const PIN_KEYS = ['repo', 'ref', 'sha', 'npm'];

/**
 * @param {unknown} value
 * @returns {string}
 */
function assertFullSha(value) {
  if (typeof value !== 'string' || !FULL_SHA.test(value)) {
    throw new Error(`pin sha must be a 40-character lowercase hex commit, got ${JSON.stringify(value)}`);
  }
  return value;
}

/**
 * @param {string} text
 * @returns {HarnessPin}
 */
function parsePin(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`pin is not JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('pin must be a JSON object');
  }
  const keys = Object.keys(parsed);
  const extra = keys.filter((key) => !PIN_KEYS.includes(key));
  if (extra.length > 0) {
    throw new Error(`pin has extra keys: ${extra.join(', ')}`);
  }
  for (const key of PIN_KEYS) {
    if (!(key in parsed)) {
      throw new Error(`pin is missing ${key}`);
    }
    if (typeof parsed[key] !== 'string' || parsed[key].trim() === '') {
      throw new Error(`pin ${key} must be a non-empty string`);
    }
  }
  assertFullSha(parsed.sha);
  return {
    repo: parsed.repo,
    ref: parsed.ref,
    sha: parsed.sha,
    npm: parsed.npm,
  };
}

/**
 * @param {string} rootDir
 * @param {typeof fs} [io]
 * @returns {HarnessPin}
 */
function readPin(rootDir, io = fs) {
  return parsePin(io.readFileSync(path.join(rootDir, PIN_RELATIVE), 'utf8'));
}

/**
 * @param {string} rootDir
 * @param {HarnessPin} pin
 * @param {typeof import('node:fs')} [io]
 */
function writePin(rootDir, pin, io = fs) {
  const valid = parsePin(JSON.stringify(pin));
  const dest = path.join(rootDir, PIN_RELATIVE);
  io.mkdirSync(path.dirname(dest), { recursive: true });
  const body = `${JSON.stringify(valid, null, 2)}\n`;
  const tmp = `${dest}.${process.pid}.tmp`;
  io.writeFileSync(tmp, body);
  io.renameSync(tmp, dest);
}

/**
 * @param {(args: string[], options?: object) => { status: number, stdout: string, stderr: string }} git
 * @param {string} spec
 * @returns {string}
 */
function peelToCommit(git, spec) {
  const result = git(['rev-parse', `${spec}^{commit}`]);
  if (result.status !== 0) {
    throw new Error(`cannot peel ${spec} to a commit: ${result.stderr || result.stdout}`);
  }
  return assertFullSha(result.stdout.trim());
}

/**
 * @param {(args: string[], options?: object) => { status: number, stdout: string, stderr: string }} git
 * @param {string} commitSha
 * @returns {string}
 */
function readNpmVersion(git, commitSha) {
  const result = git(['show', `${assertFullSha(commitSha)}:apps/cli/package.json`]);
  if (result.status !== 0) {
    throw new Error(`cannot read apps/cli/package.json from ${commitSha}: ${result.stderr || result.stdout}`);
  }
  const pkg = JSON.parse(result.stdout);
  if (typeof pkg.version !== 'string' || pkg.version.trim() === '') {
    throw new Error(`apps/cli/package.json at ${commitSha} has no version`);
  }
  return pkg.version;
}

/**
 * @param {(args: string[], options?: object) => { status: number, stdout: string, stderr: string }} git
 * @param {HarnessPin} pin
 */
function assertRc5Witness(git, pin) {
  if (pin.sha !== RC5_SHA) {
    return;
  }
  const pinTree = git(['rev-parse', `${pin.sha}^{tree}`]);
  const witnessTree = git(['rev-parse', `${SQUASH_WITNESS}^{tree}`]);
  if (pinTree.status !== 0 || witnessTree.status !== 0) {
    throw new Error(`cannot read rc.5 witness trees: ${pinTree.stderr || witnessTree.stderr}`);
  }
  if (pinTree.stdout.trim() !== witnessTree.stdout.trim()) {
    throw new Error(`rc.5 pin tree does not match squash witness ${SQUASH_WITNESS}`);
  }
}

module.exports = {
  DEFAULT_REPO,
  RC5_SHA,
  SQUASH_WITNESS,
  parsePin,
  readPin,
  writePin,
  assertFullSha,
  peelToCommit,
  readNpmVersion,
  assertRc5Witness,
};
