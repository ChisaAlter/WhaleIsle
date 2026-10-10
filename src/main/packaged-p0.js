'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { readRuntimeArchiveIdentity } = require('../shared/harness-runtime-identity');
const { readRuntimeLinks } = require('../shared/runtime-links');
const { harnessHasGhosttyAssets } = require('../shared/ghostty-assets');

const PACKAGED_P0_STEPS = Object.freeze([
  'packaged.sibling.exists',
  'packaged.git.branchList',
  'packaged.pty.create',
  'packaged.ghostty.wasm',
  'packaged.boot.noOpen',
  'packaged.runtime.stamp',
]);

const GHOSTTY_WASM_PATH = '/plugins/@deepseek-ai/dsh-client-ui-user-terminal/assets/ghostty-vt.wasm';
const NO_OPEN_ERROR = "unknown option '--no-open'";

function runtimeStampPath(userData, appVersion) {
  return path.join(String(userData || ''), 'runtime', String(appVersion || ''), '.dshd-runtime.json');
}

/** Verify the runtime actually selected by the packaged application. */
async function verifyPackagedRuntime({ resourcesPath, runtimeRoot, userData, appVersion, expectedPin, expectedArchiveIdentity }) {
  const vendor = path.join(resourcesPath, 'vendor');
  const archive = path.join(vendor, 'deepseek-harness.tar');
  const manifest = await readRuntimeArchiveIdentity(archive);
  if (!manifest) throw new Error('Missing packaged runtime archive identity');
  if (expectedArchiveIdentity && (manifest.archiveBytes !== expectedArchiveIdentity.archiveBytes
      || manifest.archiveSha256 !== expectedArchiveIdentity.archiveSha256)) {
    throw new Error('Packaged runtime archive identity mismatch');
  }
  const pin = JSON.parse(fs.readFileSync(path.join(vendor, 'harness-upstream.json'), 'utf8'));
  if (!/^[0-9a-f]{40}$/.test(pin.sha) || typeof pin.npm !== 'string' || !pin.npm
      || (expectedPin && (pin.sha !== expectedPin.sha || pin.npm !== expectedPin.npm))) {
    throw new Error('Packaged runtime pin mismatch');
  }
  const identity = { sha: pin.sha, npm: pin.npm, archiveBytes: manifest.archiveBytes, archiveSha256: manifest.archiveSha256 };
  const installed = path.join(vendor, 'deepseek-harness');
  const extracted = path.dirname(runtimeStampPath(userData, appVersion));
  const mode = !fs.existsSync(archive) ? 'installed' : 'extracted';
  const expectedRoot = mode === 'installed' ? installed : extracted;
  const selectedRoot = fs.realpathSync(runtimeRoot);
  if (selectedRoot !== fs.realpathSync(expectedRoot)) throw new Error('Selected runtime root mismatch');
  if (mode === 'extracted') {
    if (fs.statSync(archive).size !== identity.archiveBytes) throw new Error('Packaged runtime archive size mismatch');
    const stamp = JSON.parse(fs.readFileSync(path.join(runtimeRoot, '.dshd-runtime.json'), 'utf8'));
    for (const key of Object.keys(identity)) {
      if (stamp[key] !== identity[key]) throw new Error(`Runtime stamp mismatch: ${key}`);
    }
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(runtimeRoot, 'package.json'), 'utf8'));
  if (pkg.version !== pin.npm) throw new Error('Selected runtime package version mismatch');
  for (const entry of ['apps/cli/lib/bin.js', 'apps/web/dist/index.html', '.dsh-runtime-links.json']) {
    if (!fs.statSync(path.join(runtimeRoot, entry)).isFile()) throw new Error(`Incomplete selected runtime: ${entry}`);
  }
  if (!harnessHasGhosttyAssets(runtimeRoot)) throw new Error('Selected runtime lacks Ghostty assets');
  for (const { from, target } of readRuntimeLinks(runtimeRoot)) {
    const targetRoot = fs.realpathSync(target);
    if (!targetRoot.startsWith(selectedRoot + path.sep) || !fs.lstatSync(from).isSymbolicLink()
        || fs.realpathSync(from) !== targetRoot) {
      throw new Error('Selected runtime dependency link mismatch');
    }
  }
  return { mode, root: selectedRoot, identity };
}

function record(steps, name, ok, detail) {
  steps.push({
    name,
    ok: Boolean(ok),
    detail: detail == null ? '' : String(detail).slice(0, 400),
  });
}

function siblingExists(siblingPath) {
  if (typeof siblingPath !== 'string' || siblingPath.trim() === '') {
    return false;
  }
  try {
    return fs.statSync(siblingPath).isDirectory();
  } catch {
    return false;
  }
}

function currentBranch(listed) {
  if (!listed || listed.ok !== true || !Array.isArray(listed.branches)) {
    return null;
  }
  return listed.branches.find((row) => row && row.isCurrent) || null;
}

function logsHaveNoOpenError(logs) {
  return (Array.isArray(logs) ? logs : []).some((line) => String(line).includes(NO_OPEN_ERROR));
}

function resolveGitBranchList(deps) {
  if (typeof deps.gitBranchList === 'function') {
    return deps.gitBranchList;
  }
  return require('./git').gitBranchList;
}

/**
 * Packaged-path P0: sibling workspace Git/PTY, Ghostty wasm, selected runtime identity,
 * and no stale `--no-open` boot failure.
 * @param {{
 *   siblingPath?: string,
 *   gitBranchList?: (cwd: string) => Promise<{ ok?: boolean, branches?: unknown[], message?: string }>,
 *   pty?: { create: Function, kill?: Function },
 *   fetch?: typeof fetch,
 *   host?: string,
 *   port?: number,
 *   userData?: string,
 *   appVersion?: string,
 *   resourcesPath?: string,
 *   runtimeRoot?: string,
 *   bootLogs?: unknown[],
 *   existsSync?: (file: string) => boolean,
 * }} deps
 * @returns {Promise<{ ok: boolean, steps: { name: string, ok: boolean, detail: string }[] }>}
 */
async function runPackagedP0(deps = {}) {
  const steps = [];
  const siblingPath = typeof deps.siblingPath === 'string' ? deps.siblingPath : '';
  const exists = siblingExists(siblingPath);
  record(steps, 'packaged.sibling.exists', exists, exists ? siblingPath : `missing sibling: ${siblingPath || '(empty)'}`);

  const gitBranchList = resolveGitBranchList(deps);
  let gitOk = false;
  let gitDetail = '';
  try {
    const listed = await gitBranchList(siblingPath);
    const current = currentBranch(listed);
    gitOk = Boolean(current);
    gitDetail = gitOk
      ? `current=${current.name}`
      : (listed && listed.message ? String(listed.message) : 'gitBranchList not ok / no current branch');
  } catch (error) {
    gitDetail = String(error && error.message ? error.message : error);
  }
  record(steps, 'packaged.git.branchList', gitOk, gitDetail);

  const pty = deps.pty;
  let ptyOk = false;
  let ptyDetail = '';
  let created = null;
  try {
    if (!pty || typeof pty.create !== 'function') {
      throw new Error('ptyCreate requires a project cwd');
    }
    created = await pty.create({ cwd: siblingPath, cols: 80, rows: 24 });
    ptyOk = Boolean(created && created.id);
    ptyDetail = ptyOk ? `created:${created.id}` : 'pty create returned no id';
  } catch (error) {
    ptyDetail = String(error && error.message ? error.message : error);
  } finally {
    if (created && created.id && pty && typeof pty.kill === 'function') {
      await Promise.resolve(pty.kill(created.id)).catch(() => {});
    }
  }
  record(steps, 'packaged.pty.create', ptyOk, ptyDetail);

  const host = deps.host || '127.0.0.1';
  const port = Number(deps.port);
  const fetchImpl = typeof deps.fetch === 'function' ? deps.fetch : fetch;
  let wasmOk = false;
  let wasmDetail = '';
  const wasmUrl = `http://${host}:${port}${GHOSTTY_WASM_PATH}`;
  try {
    const response = await fetchImpl(wasmUrl, { signal: AbortSignal.timeout(15_000) });
    const status = Number(response && response.status);
    wasmOk = status === 200;
    wasmDetail = `${Number.isFinite(status) ? status : 'no-status'} ${wasmUrl}`;
  } catch (error) {
    wasmDetail = String(error && error.message ? error.message : error);
  }
  record(steps, 'packaged.ghostty.wasm', wasmOk, wasmDetail);

  const noOpenBad = logsHaveNoOpenError(deps.bootLogs);
  record(steps, 'packaged.boot.noOpen', !noOpenBad, noOpenBad ? NO_OPEN_ERROR : 'ok');

  const stampPath = runtimeStampPath(deps.userData, deps.appVersion);
  const existsSync = typeof deps.existsSync === 'function' ? deps.existsSync : fs.existsSync;
  let runtime = null;
  let stampOk = Boolean(stampPath) && existsSync(stampPath);
  let stampDetail = stampOk ? stampPath : `missing stamp: ${stampPath}`;
  if (deps.resourcesPath || deps.runtimeRoot) {
    try {
      runtime = await verifyPackagedRuntime(deps);
      stampOk = true;
      stampDetail = `${runtime.mode}: ${runtime.root}`;
    } catch (error) {
      stampOk = false;
      stampDetail = error.message;
    }
  }
  record(steps, 'packaged.runtime.stamp', stampOk, stampDetail);

  return { ok: steps.every((row) => row.ok), steps, runtime };
}

module.exports = {
  PACKAGED_P0_STEPS,
  GHOSTTY_WASM_PATH,
  NO_OPEN_ERROR,
  runtimeStampPath,
  verifyPackagedRuntime,
  runPackagedP0,
};
