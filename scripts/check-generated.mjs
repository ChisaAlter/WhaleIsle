#!/usr/bin/env node
/**
 * Checked-in generated artifacts outside vendor/: registry + consistency
 * check. scripts/generated-artifacts.json registers every committed build
 * output that pack/dist ship as-is, with one of these kinds:
 *
 * - `rebuild`   — a cheap deterministic build (repo esbuild). The check copies
 *                 the declared `rebuild.inputs` into a temp directory, links
 *                 `rebuild.links`, runs `rebuild.commands` there and compares
 *                 every `rebuild.outputs` file byte-for-byte (CRLF-normalized)
 *                 with the checked-in file. A mismatch means the artifact was
 *                 hand-edited or its sources changed without a rebuild; the
 *                 failure prints the registered `rebuildCommand`.
 * - `hashed`    — sources + committed artifacts whose rebuild is real but
 *                 expensive (vendored node_modules, upstream builds). The
 *                 registry records hashes over the *tracked* source file set
 *                 and the tracked artifact file set. An artifact change
 *                 without a source change fails (hand-edit); a source change
 *                 without a hash refresh fails (run `rebuildCommand`, then
 *                 `--record`). `recordCommands` optionally automate the
 *                 in-place rebuild half of `--record`.
 * - `artifacts` — artifact-only entries whose inputs are not reproducibly
 *                 rebuildable in this repo (Electron-rastered images, vendored
 *                 upstream dist files). The registry records the artifact set
 *                 hash plus `origin`/`rebuildCommand`; a hash mismatch fails.
 *
 * Every registered artifact path must be git-tracked, and every tracked
 * `*.bundle.js`/`*.min.js` outside vendor/ and node_modules must be covered
 * by an entry — so a new checked-in bundle cannot land unregistered.
 *
 * `node scripts/check-generated.mjs` verifies all entries.
 * `node scripts/check-generated.mjs --only <name>` verifies one.
 * `node scripts/check-generated.mjs --record <name>` refreshes a
 *   registration: for `rebuild` it runs the declared commands in place; for
 *   `hashed` it runs `recordCommands` (if any) and rewrites both hashes; for
 *   `artifacts` it rewrites the artifact hash. Run the registered
 *   `rebuildCommand` first when the rebuild itself needs steps record does
 *   not perform.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { withOwnedTempDir } from '../src/shared/fs-safe.js';
import { collectFiles, contentDigest, hashFileSet, diffFileSets } from './check-vendor-provenance.mjs';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REGISTRY_REL = path.join('scripts', 'generated-artifacts.json');
const IGNORED_DIRS = new Set(['node_modules', '.git', '.tmp', 'coverage', '.codegraph']);
const KNOWN_KINDS = new Set(['rebuild', 'hashed', 'artifacts']);

export function registryPath(rootDir) {
  return path.join(rootDir, REGISTRY_REL);
}

export function loadRegistry(rootDir) {
  const file = registryPath(rootDir);
  return { file, data: JSON.parse(fs.readFileSync(file, 'utf8')) };
}

/** Tracked files under each declared path (file or directory). */
function trackedFiles(rootDir, relPaths) {
  const files = new Set();
  const missing = [];
  for (const rel of relPaths) {
    const result = spawnSync('git', ['ls-files', '-z', '--', rel], {
      cwd: rootDir,
      encoding: 'utf8',
      windowsHide: true,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(`git ls-files failed in ${rootDir}: ${(result.stderr || '').trim()}`);
    }
    const names = result.stdout.split('\0').filter(Boolean);
    if (!names.length) missing.push(rel);
    for (const name of names) files.add(name);
  }
  return { files: [...files].sort(), missing };
}

/** Hash the set of git-tracked files reachable from the declared paths. */
function hashTrackedSet(rootDir, relPaths) {
  const { files, missing } = trackedFiles(rootDir, relPaths);
  const map = new Map();
  for (const rel of files) {
    map.set(rel, contentDigest(path.join(rootDir, rel)));
  }
  const digest = crypto.createHash('sha256');
  for (const rel of [...map.keys()].sort()) {
    digest.update(`${rel}\0${map.get(rel)}\n`, 'utf8');
  }
  return { digest: digest.digest('hex'), files: map, missing };
}

function runNode(commands, cwd) {
  for (const argv of commands) {
    const result = spawnSync(process.execPath, argv, {
      cwd,
      stdio: 'pipe',
      encoding: 'utf8',
      windowsHide: true,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      const output = `${result.stderr || ''}${result.stdout || ''}`.trim();
      throw new Error(
        `build command failed in ${cwd}: node ${argv.join(' ')}\n${output.slice(-2000)}`,
      );
    }
  }
}

function staleMessage(name, entry, tail) {
  return `${tail} Rebuild with \`${entry.rebuildCommand}\`, then refresh the ` +
    `record with \`node scripts/check-generated.mjs --record ${name}\`.`;
}

async function checkRebuildEntry(name, spec, rootDir, rebuildCommand) {
  const problems = [];
  await withOwnedTempDir('generated-artifacts-', async (tmp) => {
    for (const input of spec.inputs ?? []) {
      const source = path.join(rootDir, input);
      if (!fs.existsSync(source)) {
        problems.push(`declared build input "${input}" is missing`);
        continue;
      }
      fs.cpSync(source, path.join(tmp, input), {
        recursive: true,
        filter: (src) => !IGNORED_DIRS.has(path.basename(src)),
      });
    }
    for (const link of spec.links ?? []) {
      const source = path.join(rootDir, link);
      if (!fs.existsSync(source)) {
        problems.push(`declared build input "${link}" is missing`);
        continue;
      }
      fs.symlinkSync(source, path.join(tmp, link), 'junction');
    }
    if (problems.length) return;
    try {
      runNode(spec.commands, tmp);
    } catch (error) {
      problems.push(error instanceof Error ? error.message : String(error));
      return;
    }
    for (const output of spec.outputs ?? []) {
      const current = hashFileSet(rootDir, [output]);
      if (current.missing.length) {
        problems.push(`declared artifact "${output}" is missing in the working tree`);
        continue;
      }
      const rebuilt = hashFileSet(tmp, [output]);
      if (rebuilt.missing.length) {
        problems.push(`rebuild did not produce "${output}"`);
        continue;
      }
      const diffs = diffFileSets(current.files, rebuilt.files);
      if (diffs.length) {
        problems.push(
          `"${output}" does not match a clean rebuild (hand-edited artifact or stale build):\n` +
          diffs.slice(0, 5).map((d) => `    ${d}`).join('\n') +
          `\n  regenerate with \`${rebuildCommand}\``,
        );
      }
    }
  });
  return problems;
}

function checkHashedEntry(name, entry, rootDir) {
  const spec = entry.hashed;
  const problems = [];
  let sources;
  let artifacts;
  try {
    sources = hashTrackedSet(rootDir, spec.sources ?? []);
    artifacts = hashTrackedSet(rootDir, spec.artifacts ?? []);
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)];
  }
  for (const rel of sources.missing) problems.push(`declared source "${rel}" has no tracked files`);
  for (const rel of artifacts.missing) problems.push(`declared artifact "${rel}" has no tracked files`);
  if (problems.length) return problems;
  const sourceOk = sources.digest === spec.sourceHash;
  const artifactOk = artifacts.digest === spec.artifactHash;
  if (sourceOk && artifactOk) return problems;
  if (sourceOk) {
    problems.push(staleMessage(name, entry,
      'artifact set changed without a source change — looks hand-edited; restore it or rebuild and re-record.'));
  } else if (artifactOk) {
    problems.push(staleMessage(name, entry,
      'source set changed but artifacts were not rebuilt —'));
  } else {
    problems.push(staleMessage(name, entry,
      'recorded source and artifact hashes are both stale —'));
  }
  return problems;
}

function checkArtifactsEntry(name, entry, rootDir) {
  const problems = [];
  let actual;
  try {
    actual = hashTrackedSet(rootDir, entry.artifacts.paths);
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)];
  }
  for (const rel of actual.missing) problems.push(`declared artifact path "${rel}" has no tracked files`);
  for (const rel of entry.artifacts?.sources ?? []) {
    if (!fs.existsSync(path.join(rootDir, rel))) {
      problems.push(`declared source "${rel}" is missing`);
    }
  }
  if (problems.length) return problems;
  if (actual.digest !== entry.artifacts.artifactHash) {
    problems.push(staleMessage(name, entry,
      'artifact set hash does not match the record — the files were modified without re-recording.'));
  }
  return problems;
}

function checkSchema(name, entry) {
  const problems = [];
  if (!KNOWN_KINDS.has(entry.kind)) {
    return [`unknown kind "${entry.kind}"`];
  }
  if (!entry.origin) problems.push('entry requires "origin"');
  if (!entry.rebuildCommand) problems.push('entry requires "rebuildCommand"');
  if (entry.kind === 'rebuild') {
    const spec = entry.rebuild;
    if (!spec || !Array.isArray(spec.commands) || spec.commands.length === 0 ||
        !Array.isArray(spec.outputs) || spec.outputs.length === 0) {
      problems.push('kind "rebuild" requires rebuild.commands and rebuild.outputs');
    }
  }
  if (entry.kind === 'hashed') {
    const spec = entry.hashed;
    for (const field of ['sources', 'artifacts', 'sourceHash', 'artifactHash']) {
      if (!spec?.[field]) problems.push(`kind "hashed" requires "hashed.${field}"`);
    }
  }
  if (entry.kind === 'artifacts' &&
      (!Array.isArray(entry.artifacts?.paths) || entry.artifacts.paths.length === 0 ||
        !entry.artifacts?.artifactHash)) {
    problems.push('kind "artifacts" requires "artifacts.paths" and "artifacts.artifactHash"');
  }
  return problems;
}

/** Declared artifact paths (files and directories) owned by an entry. */
function declaredArtifactPaths(entry) {
  if (entry.kind === 'rebuild') return entry.rebuild?.outputs ?? [];
  if (entry.kind === 'hashed') return entry.hashed?.artifacts ?? [];
  return entry.artifacts?.paths ?? [];
}

/** Every tracked file the entry claims as generated output. */
function ownedTrackedFiles(rootDir, entry) {
  const declared = declaredArtifactPaths(entry);
  if (!declared.length) return new Set();
  const { files } = trackedFiles(rootDir, declared);
  return new Set(files);
}

/**
 * Files that exist on disk under declared artifact paths but are not tracked,
 * and registered artifact paths that are files but not tracked at all.
 */
function trackingProblems(name, entry, rootDir, trackedSet) {
  const problems = [];
  for (const rel of declaredArtifactPaths(entry)) {
    const abs = path.join(rootDir, rel);
    if (!fs.existsSync(abs)) continue;
    if (fs.statSync(abs).isFile()) {
      if (!trackedSet.has(rel.split(path.sep).join('/'))) {
        problems.push(`registered artifact "${rel}" is not git-tracked`);
      }
      continue;
    }
    for (const file of collectFiles(rootDir, rel)) {
      if (!trackedSet.has(file)) {
        problems.push(`untracked file "${file}" inside registered artifact dir "${rel}"`);
      }
    }
  }
  return problems;
}

/** All git-tracked files in the repo. Returns null when git is unavailable. */
function allTrackedFiles(rootDir) {
  const result = spawnSync('git', ['ls-files', '-z'], {
    cwd: rootDir,
    encoding: 'utf8',
  });
  if (result.error || result.status !== 0) return null;
  return new Set(result.stdout.split('\0').filter(Boolean));
}

/** Tracked bundles outside vendor/ and node_modules must be registered. */
const GENERATED_PATTERNS = /\.(?:bundle|min)\.js$/;

function sweepProblems(rootDir, entries, trackedSet) {
  const owned = new Set();
  for (const entry of Object.values(entries)) {
    for (const file of ownedTrackedFiles(rootDir, entry)) owned.add(file);
  }
  const problems = [];
  for (const rel of trackedSet) {
    if (!GENERATED_PATTERNS.test(rel)) continue;
    if (rel.startsWith('vendor/') || rel.includes('/node_modules/')) continue;
    if (!owned.has(rel)) {
      problems.push(`tracked generated file "${rel}" is not registered in ${REGISTRY_REL.split(path.sep).join('/')}`);
    }
  }
  return problems;
}

/** Run the whole registration + consistency check. Returns problem strings. */
export async function checkGeneratedArtifacts(rootDir, { only } = {}) {
  const problems = [];
  const { data } = loadRegistry(rootDir);
  const entries = data.artifacts ?? {};
  const trackedSet = allTrackedFiles(rootDir);
  const names = only ? [only] : Object.keys(entries).sort();
  for (const name of names) {
    const entry = entries[name];
    if (!entry) {
      problems.push(`--only target "${name}" is not registered`);
      continue;
    }
    const schemaProblems = checkSchema(name, entry);
    for (const problem of schemaProblems) {
      problems.push(`${name}: ${problem}`);
    }
    if (schemaProblems.length) continue;
    if (trackedSet) {
      for (const problem of trackingProblems(name, entry, rootDir, trackedSet)) {
        problems.push(`${name}: ${problem}`);
      }
    }
    if (entry.kind === 'rebuild') {
      for (const problem of await checkRebuildEntry(name, entry.rebuild, rootDir, entry.rebuildCommand)) {
        problems.push(`${name}: ${problem}`);
      }
    } else if (entry.kind === 'hashed') {
      for (const problem of checkHashedEntry(name, entry, rootDir)) {
        problems.push(`${name}: ${problem}`);
      }
    } else {
      for (const problem of checkArtifactsEntry(name, entry, rootDir)) {
        problems.push(`${name}: ${problem}`);
      }
    }
  }
  if (trackedSet && !only) {
    problems.push(...sweepProblems(rootDir, entries, trackedSet));
  }
  return problems;
}

/** Refresh a registration the legitimate way (see the file header). */
export async function recordArtifact(rootDir, name) {
  const { file, data } = loadRegistry(rootDir);
  const entry = data.artifacts?.[name];
  if (!entry) throw new Error(`"${name}" is not registered in ${REGISTRY_REL}`);
  if (entry.kind === 'rebuild') {
    runNode(entry.rebuild.commands, rootDir);
    return { wrote: false, note: `rebuilt ${name} artifacts in place` };
  }
  if (entry.kind === 'hashed') {
    if (entry.hashed.recordCommands?.length) {
      runNode(entry.hashed.recordCommands, rootDir);
    }
    entry.hashed.sourceHash = hashTrackedSet(rootDir, entry.hashed.sources ?? []).digest;
    entry.hashed.artifactHash = hashTrackedSet(rootDir, entry.hashed.artifacts ?? []).digest;
  } else if (entry.kind === 'artifacts') {
    const result = hashTrackedSet(rootDir, entry.artifacts.paths);
    if (result.missing.length) {
      throw new Error(`cannot record ${name}: missing ${result.missing.join(', ')}`);
    }
    entry.artifacts.artifactHash = result.digest;
  } else {
    throw new Error(`"${name}" is kind "${entry.kind}" — nothing to record`);
  }
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  return { wrote: true, note: `updated ${file}` };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2);
  const recordIndex = args.indexOf('--record');
  const onlyIndex = args.indexOf('--only');
  try {
    if (recordIndex !== -1) {
      const name = args[recordIndex + 1];
      if (!name) throw new Error('--record requires a registered artifact name');
      const result = await recordArtifact(repoRoot, name);
      console.log(`[generated] ${result.note}`);
    } else {
      const problems = await checkGeneratedArtifacts(repoRoot, {
        only: onlyIndex !== -1 ? args[onlyIndex + 1] : undefined,
      });
      if (problems.length) {
        console.error(`[generated] artifact check failed (${problems.length}):`);
        for (const problem of problems) console.error(`  ${problem}`);
        process.exitCode = 1;
      } else {
        console.log('[generated] checked-in generated artifacts verified');
      }
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
