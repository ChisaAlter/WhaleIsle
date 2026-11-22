/**
 * Isolated temporary storage lifecycle, boundary validation, child environment scrubbing,
 * and post-run `dsh-pruned-results` residue hygiene for the Eval Harness.
 * @module scripts/eval-harness/temp-env
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createUniqueDir } from '../../src/shared/fs-safe.js';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const DSH_CLI_BIN = path.join(REPO_ROOT, 'vendor', 'deepseek-harness', 'apps', 'cli', 'lib', 'bin.js');
export const WHALE_UI_HOST = path.join(REPO_ROOT, 'src', 'renderer', 'whale-ui', 'host.cjs');
export const PLACEHOLDER_API_KEY_ENV = 'MAGPIE_API_KEY';

const PRUNED_RESULTS_DIRNAME = 'dsh-pruned-results';
const REMOVE_RETRY_OPTIONS = { recursive: true, force: true, maxRetries: 6, retryDelay: 50 };

/**
 * Resolve path with realpath when present, falling back to `path.resolve`.
 * @param {string} target
 * @returns {string}
 */
function resolveCanonical(target) {
  const abs = path.resolve(target);
  try {
    return fs.realpathSync(abs);
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException | undefined} */ (error)?.code === 'ENOENT') {
      return abs;
    }
    throw error;
  }
}

/**
 * Normalize path comparison for case-insensitive Windows volumes.
 * @param {string} value
 * @returns {string}
 */
function normalizeCase(value) {
  return process.platform === 'win32' ? value.toLowerCase() : value;
}

/**
 * Return true when `candidate` equals `parent` or resides strictly beneath `parent`.
 * @param {string} parent
 * @param {string} candidate
 * @returns {boolean}
 */
function isSameOrInside(parent, candidate) {
  const rel = path.relative(normalizeCase(parent), normalizeCase(candidate));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Safely inspect `lstatSync` without throwing on ENOENT.
 * @param {string} target
 * @returns {fs.Stats | null}
 */
function lstatOrNull(target) {
  try {
    return fs.lstatSync(target);
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException | undefined} */ (error)?.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

/**
 * Ensure an explicit `--temp-root` neither targets/encloses protected directories nor sits inside the repo.
 * @param {string} absPath
 */
function assertSafeExplicitTempRoot(absPath) {
  const resolved = resolveCanonical(absPath);
  const driveRoot = path.parse(resolved).root;
  const protectedAncestors = [
    driveRoot,
    resolveCanonical(os.tmpdir()),
    resolveCanonical(os.homedir()),
    resolveCanonical(REPO_ROOT),
  ];
  for (const protectedPath of protectedAncestors) {
    if (isSameOrInside(resolved, protectedPath)) {
      throw new Error(`Refusing --temp-root "${absPath}": overlaps protected directory "${protectedPath}"`);
    }
  }
  const repoCanonical = resolveCanonical(REPO_ROOT);
  if (isSameOrInside(repoCanonical, resolved)) {
    throw new Error(`Refusing --temp-root "${absPath}": temporary root must stay outside repository`);
  }

  const existing = lstatOrNull(absPath);
  if (existing !== null) {
    if (existing.isSymbolicLink() || !existing.isDirectory()) {
      throw new Error(`Refusing --temp-root "${absPath}": target must be a real directory`);
    }
    const entries = fs.readdirSync(absPath);
    if (entries.length > 0) {
      throw new Error(`Refusing --temp-root "${absPath}": directory already exists and is not empty`);
    }
  }
}

/**
 * Enumerate unique existing temp-parent directories that may receive `dsh-pruned-results`.
 * @returns {string[]}
 */
function candidateTempParents() {
  const raw = [os.tmpdir(), process.env.TEMP, process.env.TMP].filter(
    /** @returns {value is string} */
    value => typeof value === 'string' && value.trim().length > 0,
  );
  const seen = new Set();
  /** @type {string[]} */
  const unique = [];
  for (const dir of raw) {
    const canon = resolveCanonical(dir);
    const key = normalizeCase(canon);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(canon);
  }
  return unique;
}

/**
 * @typedef {{ parent: string, dirPath: string, existedBefore: boolean, entriesBefore: Set<string> }} PrunedSnapshot
 */

/**
 * Capture pre-run state of any `<tmp>/dsh-pruned-results` directory so cleanup removes only run-owned items.
 * @returns {PrunedSnapshot[]}
 */
function snapshotPrunedResults() {
  return candidateTempParents().map((parent) => {
    const dirPath = path.join(parent, PRUNED_RESULTS_DIRNAME);
    const stat = lstatOrNull(dirPath);
    if (stat === null || stat.isSymbolicLink() || !stat.isDirectory()) {
      return { parent, dirPath, existedBefore: false, entriesBefore: new Set() };
    }
    const entriesBefore = new Set(fs.readdirSync(dirPath));
    return { parent, dirPath, existedBefore: true, entriesBefore };
  });
}

/**
 * Remove only entries inside `dsh-pruned-results` introduced after `snapshot`, plus the directory itself
 * if this run created it.
 * @param {readonly PrunedSnapshot[]} snapshots
 */
function cleanupPrunedResults(snapshots) {
  for (const snap of snapshots) {
    const current = lstatOrNull(snap.dirPath);
    if (current === null || current.isSymbolicLink() || !current.isDirectory()) continue;
    const resolvedParent = resolveCanonical(snap.parent);
    const resolvedDir = resolveCanonical(snap.dirPath);
    if (!isSameOrInside(resolvedParent, resolvedDir) || normalizeCase(resolvedDir) === normalizeCase(resolvedParent)) {
      continue;
    }
    const afterEntries = fs.readdirSync(snap.dirPath);
    for (const entry of afterEntries) {
      if (snap.entriesBefore.has(entry)) continue;
      const entryPath = path.join(snap.dirPath, entry);
      const entryStat = lstatOrNull(entryPath);
      if (entryStat === null) continue;
      if (entryStat.isSymbolicLink()) {
        fs.unlinkSync(entryPath);
        continue;
      }
      const resolvedEntry = resolveCanonical(entryPath);
      if (isSameOrInside(resolvedDir, resolvedEntry)) {
        fs.rmSync(entryPath, REMOVE_RETRY_OPTIONS);
      }
    }
    if (!snap.existedBefore && fs.readdirSync(snap.dirPath).length === 0) {
      fs.rmSync(snap.dirPath, REMOVE_RETRY_OPTIONS);
    }
  }
}

/**
 * @typedef {object} OwnedEvalEnvironment
 * @property {string} tempRoot
 * @property {string} workspaceRoot
 * @property {string} dshHome
 * @property {boolean} keepTemp
 * @property {() => void} cleanup
 */

/**
 * Create an isolated temporary root for one harness run, enforce resolved boundary invariants,
 * and run `fn` inside `try/finally` so temporary directories are reclaimed on success or failure.
 * @template T
 * @param {{ tempRoot?: string, keepTemp?: boolean }} options
 * @param {(env: OwnedEvalEnvironment) => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function withEvalTempEnvironment(options, fn) {
  const keepTemp = Boolean(options.keepTemp);
  const prunedBefore = snapshotPrunedResults();
  /** @type {string} */
  let rootDir;
  /** @type {string} */
  let expectedBoundaryParent;

  if (options.tempRoot !== undefined) {
    const abs = path.resolve(options.tempRoot);
    assertSafeExplicitTempRoot(abs);
    fs.mkdirSync(abs, { recursive: true });
    rootDir = abs;
    expectedBoundaryParent = resolveCanonical(path.dirname(abs));
  } else {
    expectedBoundaryParent = resolveCanonical(os.tmpdir());
    rootDir = createUniqueDir(expectedBoundaryParent, 'whaleisle-eval-');
  }

  const createdStat = fs.lstatSync(rootDir);
  const rootCanonical = resolveCanonical(rootDir);
  const workspaceRoot = path.join(rootDir, 'workspaces');
  const dshHome = path.join(rootDir, 'dsh-home');
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.mkdirSync(dshHome, { recursive: true });

  const cleanup = () => {
    if (keepTemp) return;
    cleanupPrunedResults(prunedBefore);
    const current = lstatOrNull(rootDir);
    if (current === null || current.isSymbolicLink() || !current.isDirectory()) return;
    if (current.dev !== createdStat.dev || current.ino !== createdStat.ino) return;
    const resolvedNow = resolveCanonical(rootDir);
    if (!isSameOrInside(expectedBoundaryParent, resolvedNow) || !isSameOrInside(rootCanonical, resolvedNow)) {
      return;
    }
    fs.rmSync(rootDir, REMOVE_RETRY_OPTIONS);
  };

  try {
    return await fn({
      tempRoot: rootDir,
      workspaceRoot,
      dshHome,
      keepTemp,
      cleanup,
    });
  } finally {
    cleanup();
  }
}

/**
 * Build a clean environment for spawned `dsh` processes with proxy overrides removed
 * and only an isolated `DSH_HOME`, `DSH_AGENTS_HOME`, plus non-sensitive placeholder key set.
 * @param {{ dshHome: string, extraEnv?: Record<string, string | undefined> }} options
 * @returns {NodeJS.ProcessEnv}
 */
export function buildIsolatedDshEnv({ dshHome, extraEnv = {} }) {
  /** @type {NodeJS.ProcessEnv} */
  const env = { ...process.env };
  const strippedVars = [
    'HTTP_PROXY',
    'HTTPS_PROXY',
    'ALL_PROXY',
    'NO_PROXY',
    'http_proxy',
    'https_proxy',
    'all_proxy',
    'no_proxy',
    'ELECTRON_RUN_AS_NODE',
    'DEEPSEEK_API_KEY',
    'OPENAI_API_KEY',
    'ANTHROPIC_API_KEY',
  ];
  for (const key of strippedVars) {
    delete env[key];
  }
  env.DSH_HOME = dshHome;
  env.DSH_AGENTS_HOME = path.join(dshHome, 'agents');
  env.DSH_TELEMETRY_DISABLED = '1';
  env.NODE_DISABLE_COMPILE_CACHE = '1';
  env[PLACEHOLDER_API_KEY_ENV] = 'magpie-local-dummy';
  for (const [key, value] of Object.entries(extraEnv)) {
    if (value === undefined) {
      delete env[key];
    } else {
      env[key] = value;
    }
  }
  return env;
}
