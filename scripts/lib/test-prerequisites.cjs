'use strict';

/**
 * Shared prerequisite detection for behavior tests.
 *
 * `node --test` cases exercise real artifacts: the built Harness workspace,
 * vendored plugin runtimes, an Electron binary or a packaged app. A checkout
 * with only `npm ci` lacks them, and the affected cases died inside module
 * resolution — indistinguishable from real failures. Each detector returns
 * `{ ok: true }` (optionally carrying the found path) or
 * `{ ok: false, reason }`, where reason names the missing piece and the
 * command that restores it. requirePrerequisite() turns a missing
 * prerequisite into t.skip(reason); with WHALE_REQUIRE_TEST_PREREQS=1 — which
 * CI sets on every `npm test` job — it fails the case instead, so a genuinely
 * absent artifact can never hide behind a skip.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const HARNESS_ROOT = path.join(ROOT, 'vendor', 'deepseek-harness');
const SETUP_COMMAND = 'npm run setup';

const READY = Object.freeze({ ok: true });

/** `WHALE_REQUIRE_TEST_PREREQS=1` makes a missing prerequisite fail tests. */
function prerequisitesRequired(env = process.env) {
  return env.WHALE_REQUIRE_TEST_PREREQS === '1';
}

function absentEntries(root, entries, existsSync) {
  return entries.filter(entry => !existsSync(path.join(root, entry)));
}

function missing(what, entries, command) {
  return { ok: false, reason: `${what}缺失：${entries.join('、')}，先运行 ${command}` };
}

/**
 * Harness workspace dependencies (`pnpm install` inside
 * vendor/deepseek-harness). Bare specifiers from apps/cli and packages/*
 * resolve through these node_modules trees.
 */
function harnessDependencies({ harnessRoot = HARNESS_ROOT, existsSync = fs.existsSync } = {}) {
  const absent = absentEntries(harnessRoot, ['node_modules', 'apps/cli/node_modules'], existsSync);
  return absent.length ? missing('Harness 依赖', absent.map(entry => `vendor/deepseek-harness/${entry}`), SETUP_COMMAND) : READY;
}

/**
 * Harness build output (`pnpm run build:official`): the CLI's lib plus extra
 * package entries the caller imports, relative to the harness root.
 */
function harnessBuild({ entries = [], harnessRoot = HARNESS_ROOT, existsSync = fs.existsSync } = {}) {
  const absent = absentEntries(harnessRoot, ['apps/cli/lib/bin.js', ...entries], existsSync);
  return absent.length ? missing('Harness 构建产物', absent.map(entry => `vendor/deepseek-harness/${entry}`), SETUP_COMMAND) : READY;
}

/** Dependencies and build output together — what composition tests need. */
function harnessWorkspace(options = {}) {
  return allPrerequisites(harnessDependencies(options), harnessBuild(options));
}

/**
 * A vendored plugin's runtime: built entries (lib/dist) and its node_modules,
 * relative to vendor/<name>. `command` names the step that restores them.
 */
function vendorPluginArtifacts(name, entries, { command = SETUP_COMMAND, vendorRoot = path.join(ROOT, 'vendor'), existsSync = fs.existsSync } = {}) {
  const absent = absentEntries(path.join(vendorRoot, name), entries, existsSync);
  return absent.length ? missing(`vendor/${name} 依赖或构建产物`, absent.map(entry => `vendor/${name}/${entry}`), command) : READY;
}

/** Real Electron executable for fixture-driven renderer tests. */
function electronBinary({ root = ROOT, env = process.env, platform = process.platform, existsSync = fs.existsSync } = {}) {
  const dist = path.join('node_modules', 'electron', 'dist');
  const relative = platform === 'win32' ? path.join(dist, 'electron.exe')
    : platform === 'darwin' ? path.join(dist, 'Electron.app', 'Contents', 'MacOS', 'Electron')
    : path.join(dist, 'electron');
  const binary = [env.ELECTRON_PATH, path.join(root, relative)].find(candidate => candidate && existsSync(candidate));
  return binary ? { ok: true, binary } : missing('真实 Electron 二进制', [relative], 'node node_modules/electron/install.js');
}

/** electron-builder output of `npm run dist`/`npm run pack` for this platform. */
function packagedExecutable({ root = ROOT, platform = process.platform, productName, existsSync = fs.existsSync, readFileSync = fs.readFileSync } = {}) {
  const name = productName ?? JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).productName;
  const dist = path.join(root, 'dist');
  const candidates = platform === 'win32' ? [path.join(dist, 'win-unpacked', `${name}.exe`)]
    : platform === 'darwin' ? ['mac-arm64', 'mac-universal', 'mac'].map(output => path.join(dist, output, `${name}.app`, 'Contents', 'MacOS', name))
    : [];
  const binary = candidates.find(candidate => existsSync(candidate));
  return binary ? { ok: true, binary } : missing('打包产物', [path.join('dist', platform === 'win32' ? 'win-unpacked' : platform === 'darwin' ? 'mac*' : '')], 'npm run dist');
}

/** First failing check, or READY — a test can name every prerequisite once. */
function allPrerequisites(...checks) {
  return checks.find(check => check && check.ok === false) ?? READY;
}

/**
 * Gate one case on a check. Returns true when the prerequisite holds so the
 * caller proceeds; otherwise marks the test skipped with the reason (or fails
 * it when WHALE_REQUIRE_TEST_PREREQS=1) and returns false — callers `return`.
 */
function requirePrerequisite(t, check, reason, { env = process.env } = {}) {
  const ok = typeof check === 'boolean' ? check : check.ok;
  if (ok) return true;
  const message = reason ?? check.reason;
  if (prerequisitesRequired(env)) {
    assert.fail(`测试前提未满足（WHALE_REQUIRE_TEST_PREREQS=1）：${message}`);
  }
  t.skip(message);
  return false;
}

/**
 * `{ skip }` option form for cases that skip through test options today. In
 * required mode it returns false and the case body must still call
 * requirePrerequisite() so the missing prerequisite fails it with the reason.
 */
function prerequisiteSkip(check, { env = process.env } = {}) {
  return check.ok || prerequisitesRequired(env) ? false : check.reason;
}

/**
 * Wrap node:test's `test` for files whose every case needs the same
 * prerequisite — when it is missing, each registered case reports the reason
 * (skip, or failure in required mode) instead of executing its body, keeping
 * per-case counts in both modes.
 */
function gateTests(test, check, { env = process.env } = {}) {
  if (check.ok) return test;
  const gated = (...args) => {
    const index = args.findIndex(arg => typeof arg === 'function');
    const body = t => requirePrerequisite(t, false, check.reason, { env });
    if (index === -1) return test(...args, body);
    args[index] = body;
    return test(...args);
  };
  return Object.setPrototypeOf(gated, test);
}

module.exports = {
  harnessDependencies,
  harnessBuild,
  harnessWorkspace,
  vendorPluginArtifacts,
  electronBinary,
  packagedExecutable,
  allPrerequisites,
  prerequisitesRequired,
  requirePrerequisite,
  prerequisiteSkip,
  gateTests,
};
