#!/usr/bin/env node
/**
 * Vendor provenance and artifact-consistency check.
 *
 * vendor/provenance.json registers every vendor/ tree with one of these kinds:
 *
 * - `pinned`    — externally pinned monorepo (deepseek-harness). The pin and
 *                 its sync/verification live in harness-upstream.json and
 *                 scripts/sync-upstream.js; this check only requires the row.
 * - `source`    — hand-maintained source trees (desktop-owned or vendored
 *                 upstream source snapshots). No shipped build artifacts.
 * - `rebuild`   — source + committed build artifacts produced by a cheap
 *                 deterministic build (esbuild bundles). The check copies the
 *                 declared inputs into a temp directory, runs the declared
 *                 build commands and compares every declared output
 *                 byte-for-byte (CRLF-normalized). A mismatch means the
 *                 artifact was hand-edited or sources were not rebuilt. A tree
 *                 may additionally carry a `hashed` spec for outputs that the
 *                 deterministic toolchain does not reproduce (e.g. artifacts
 *                 last built by a vendored esbuild).
 * - `hashed`    — source + artifacts whose build is expensive or not
 *                 deterministic. provenance.json records the hash of the
 *                 source file set and of the artifact file set. An artifact
 *                 change without a source change fails (hand-edit); a source
 *                 change without a hash update fails (rebuild + --record).
 * - `artifacts` — artifact-only trees whose sources live in an external repo
 *                 (e.g. dsh-pad). provenance.json records the artifact set
 *                 hash and the external commit; a hash mismatch fails.
 *
 * `node scripts/check-vendor-provenance.mjs` verifies all trees.
 * `node scripts/check-vendor-provenance.mjs --only <dir>` verifies one.
 * `node scripts/check-vendor-provenance.mjs --record <dir>` is the only
 *   legitimate way to refresh a registration: for `rebuild`/`hashed` it runs
 *   the declared build commands inside the real tree before writing hashes;
 *   for `artifacts` it re-records the artifact set hash after a reviewed
 *   upstream resync (update `source.commit` in the same change).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { withOwnedTempDir } from '../src/shared/fs-safe.js';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const esbuildHookPath = path.join(repoRoot, 'scripts', 'plugin-build-esbuild.mjs');

// Hashing skips dependency installs and OS noise; `links` in a rebuild spec is
// the way to hand a vendored node_modules to a temp build without copying it.
const IGNORED_DIRS = new Set(['node_modules', '.git', '.tmp', 'coverage', '.codegraph']);
const IGNORED_FILES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);
const KNOWN_KINDS = new Set(['pinned', 'source', 'rebuild', 'hashed', 'artifacts']);

/** Recursively list files under `rel` of `base` as POSIX-relative paths. */
export function collectFiles(base, rel) {
  const abs = path.join(base, rel);
  const stat = fs.statSync(abs);
  if (stat.isFile()) return [rel.split(path.sep).join('/')];
  const out = [];
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const childRel = rel ? path.join(rel, entry.name) : entry.name;
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      out.push(...collectFiles(base, childRel));
    } else if (entry.isFile() && !IGNORED_FILES.has(entry.name)) {
      out.push(childRel.split(path.sep).join('/'));
    }
  }
  return out;
}

/**
 * Hash file content so checkout-platform line endings cannot flip the result:
 * files without NUL bytes are treated as text and hashed with LF endings.
 */
function contentDigest(abs) {
  const buf = fs.readFileSync(abs);
  const data = buf.includes(0)
    ? buf
    : Buffer.from(buf.toString('utf8').replaceAll('\r\n', '\n'), 'utf8');
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Hash the set of files reachable from the declared paths. `relPaths` entries
 * may be files or directories; missing entries are reported, not hashed.
 */
export function hashFileSet(pkgDir, relPaths) {
  const files = new Map();
  const missing = [];
  for (const rel of relPaths) {
    if (!fs.existsSync(path.join(pkgDir, rel))) {
      missing.push(rel);
      continue;
    }
    for (const file of collectFiles(pkgDir, rel)) {
      files.set(file, contentDigest(path.join(pkgDir, file)));
    }
  }
  const digest = crypto.createHash('sha256');
  for (const rel of [...files.keys()].sort()) {
    digest.update(`${rel}\0${files.get(rel)}\n`, 'utf8');
  }
  return { digest: digest.digest('hex'), files, missing };
}

/** Differences between the expected (vendored) and rebuilt file sets. */
function diffFileSets(expected, actual) {
  const diffs = [];
  for (const [rel, digest] of expected) {
    if (!actual.has(rel)) diffs.push(`${rel} missing after rebuild`);
    else if (actual.get(rel) !== digest) diffs.push(`${rel} content differs`);
  }
  for (const rel of actual.keys()) {
    if (!expected.has(rel)) diffs.push(`${rel} produced by rebuild but absent in vendor tree`);
  }
  return diffs.sort();
}

/** Directory names directly under vendor/ that must be registered. */
export function vendorTreeNames(vendorDir) {
  return fs.readdirSync(vendorDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/** Directory names registered in the vendor README table's first column. */
export function readmeTreeNames(readmeText) {
  const names = new Set();
  for (const line of readmeText.split(/\r?\n/)) {
    const match = line.match(/^\|\s*`([^`/\s]+)\/`\s*\|/);
    if (match) names.add(match[1]);
  }
  return names;
}

export function loadProvenance(vendorDir) {
  const file = path.join(vendorDir, 'provenance.json');
  return { file, data: JSON.parse(fs.readFileSync(file, 'utf8')) };
}

function runCommands(commands, cwd, { esbuildHook = true } = {}) {
  for (const argv of commands) {
    const args = esbuildHook
      ? ['--import', pathToFileURL(esbuildHookPath).href, ...argv]
      : [...argv];
    const result = spawnSync(process.execPath, args, {
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

async function checkRebuildTree(name, spec, pkgDir) {
  const problems = [];
  await withOwnedTempDir('vendor-provenance-', async (tmp) => {
    const staging = path.join(tmp, name);
    fs.mkdirSync(staging, { recursive: true });
    for (const input of spec.inputs ?? []) {
      const source = path.join(pkgDir, input);
      if (!fs.existsSync(source)) {
        problems.push(`declared build input "${input}" is missing`);
        continue;
      }
      fs.cpSync(source, path.join(staging, input), { recursive: true });
    }
    for (const link of spec.links ?? []) {
      const source = path.join(pkgDir, link);
      if (!fs.existsSync(source)) {
        problems.push(`declared build input "${link}" is missing`);
        continue;
      }
      fs.symlinkSync(source, path.join(staging, link), 'junction');
    }
    if (problems.length) return;
    try {
      runCommands(spec.commands, staging, { esbuildHook: spec.esbuildHook !== false });
    } catch (error) {
      problems.push(error instanceof Error ? error.message : String(error));
      return;
    }
    for (const output of spec.outputs ?? []) {
      const current = hashFileSet(pkgDir, [output]);
      if (current.missing.length) {
        problems.push(`declared artifact "${output}" is missing in the vendor tree`);
        continue;
      }
      const rebuilt = hashFileSet(staging, [output]);
      if (rebuilt.missing.length) {
        problems.push(`rebuild did not produce "${output}"`);
        continue;
      }
      const diffs = diffFileSets(current.files, rebuilt.files);
      if (diffs.length) {
        problems.push(
          `"${output}" does not match a clean rebuild (hand-edited artifact or stale build):\n` +
          diffs.slice(0, 5).map((d) => `    ${d}`).join('\n'),
        );
      }
    }
  });
  return problems;
}

function checkHashedTree(name, spec, pkgDir) {
  const problems = [];
  const sources = hashFileSet(pkgDir, spec.sources ?? []);
  const artifacts = hashFileSet(pkgDir, spec.artifacts ?? []);
  for (const rel of sources.missing) problems.push(`declared source "${rel}" is missing`);
  for (const rel of artifacts.missing) problems.push(`declared artifact "${rel}" is missing`);
  if (problems.length) return problems;
  const sourceOk = sources.digest === spec.sourceHash;
  const artifactOk = artifacts.digest === spec.artifactHash;
  if (sourceOk && artifactOk) return problems;
  if (sourceOk) {
    problems.push(
      'artifact set changed without a source change — looks hand-edited; ' +
      `restore it or rebuild and re-record with --record ${name}`,
    );
  } else if (artifactOk) {
    problems.push(
      'source set changed but artifacts were not rebuilt — run the registered ' +
      `rebuild and refresh the record with --record ${name}`,
    );
  } else {
    problems.push(
      'recorded source and artifact hashes are both stale — rebuild and ' +
      `re-record with --record ${name}`,
    );
  }
  return problems;
}

function checkArtifactsTree(name, spec, pkgDir) {
  const problems = [];
  const actual = hashFileSet(pkgDir, spec.paths ?? ['.']);
  for (const rel of actual.missing) problems.push(`declared artifact path "${rel}" is missing`);
  if (problems.length) return problems;
  if (actual.digest !== spec.artifactHash) {
    problems.push(
      'artifact set hash does not match the record — the packaged files were ' +
      'modified without resyncing from the registered upstream commit. Restore ' +
      `them or perform the resync and re-record with --record ${name}`,
    );
  }
  return problems;
}

function hashedSpecProblems(spec) {
  const problems = [];
  if (!spec || typeof spec !== 'object') return ['missing "hashed" spec'];
  for (const field of ['sources', 'artifacts', 'sourceHash', 'artifactHash']) {
    if (!spec[field]) problems.push(`"hashed" spec requires "${field}"`);
  }
  return problems;
}

function checkSchema(name, entry) {
  const problems = [];
  if (!KNOWN_KINDS.has(entry.kind)) {
    problems.push(`unknown kind "${entry.kind}"`);
    return problems;
  }
  if (entry.kind === 'rebuild') {
    const spec = entry.rebuild;
    if (!spec || !Array.isArray(spec.commands) || spec.commands.length === 0 ||
        !Array.isArray(spec.outputs) || spec.outputs.length === 0) {
      problems.push('kind "rebuild" requires rebuild.commands and rebuild.outputs');
    }
    if (entry.hashed) problems.push(...hashedSpecProblems(entry.hashed));
  }
  if (entry.kind === 'hashed') {
    problems.push(...hashedSpecProblems(entry.hashed));
    if (!Array.isArray(entry.recordCommands) || entry.recordCommands.length === 0) {
      problems.push('kind "hashed" requires "recordCommands" so --record can rebuild');
    }
  }
  if (entry.kind === 'artifacts' && !entry.artifacts?.artifactHash) {
    problems.push('kind "artifacts" requires "artifacts.artifactHash"');
  }
  return problems;
}

async function checkTree(name, entry, vendorDir) {
  const pkgDir = path.join(vendorDir, name);
  const problems = checkSchema(name, entry);
  if (problems.length) return problems;
  if (!fs.existsSync(pkgDir)) return [`registered but vendor/${name} does not exist`];
  if (entry.rebuild) problems.push(...await checkRebuildTree(name, entry.rebuild, pkgDir));
  if (entry.hashed) problems.push(...checkHashedTree(name, entry.hashed, pkgDir));
  if (entry.kind === 'artifacts') problems.push(...checkArtifactsTree(name, entry.artifacts ?? {}, pkgDir));
  return problems;
}

/** Run the whole registration + consistency check. Returns problem strings. */
export async function checkVendorProvenance(vendorDir, { only } = {}) {
  const problems = [];
  const { data } = loadProvenance(vendorDir);
  const trees = data.trees ?? {};
  const registered = Object.keys(trees).sort();
  const onDisk = vendorTreeNames(vendorDir);
  for (const name of onDisk) {
    if (!trees[name]) problems.push(`vendor/${name} is not registered in provenance.json`);
  }
  for (const name of registered) {
    if (!onDisk.includes(name)) problems.push(`provenance.json registers missing vendor/${name}`);
  }
  const readmePath = path.join(vendorDir, 'README.md');
  if (!fs.existsSync(readmePath)) {
    problems.push('vendor/README.md is missing');
  } else {
    const inReadme = readmeTreeNames(fs.readFileSync(readmePath, 'utf8'));
    for (const name of onDisk) {
      if (!inReadme.has(name)) problems.push(`vendor/${name} has no row in the README table`);
    }
    for (const name of inReadme) {
      if (!trees[name]) problems.push(`README table row "${name}/" is not in provenance.json`);
    }
  }
  const names = only ? [only] : registered;
  for (const name of names) {
    if (!trees[name]) {
      problems.push(`--only target "${name}" is not registered`);
      continue;
    }
    for (const problem of await checkTree(name, trees[name], vendorDir)) {
      problems.push(`${name}: ${problem}`);
    }
  }
  return problems;
}

/** Refresh a registration the legitimate way (see the file header). */
export async function recordTree(vendorDir, name) {
  const { file, data } = loadProvenance(vendorDir);
  const entry = data.trees?.[name];
  if (!entry) throw new Error(`vendor/${name} is not registered in provenance.json`);
  const pkgDir = path.join(vendorDir, name);
  if (entry.kind === 'rebuild' || entry.kind === 'hashed') {
    const commands = entry.recordCommands ?? entry.rebuild?.commands;
    if (!commands?.length) {
      throw new Error(`vendor/${name} declares no rebuild commands to record with`);
    }
    runCommands(commands, pkgDir, { esbuildHook: entry.esbuildHook !== false });
    if (!entry.hashed) return { wrote: false, note: `rebuilt ${name} artifacts in place` };
    entry.hashed.sourceHash = hashFileSet(pkgDir, entry.hashed.sources ?? []).digest;
    entry.hashed.artifactHash = hashFileSet(pkgDir, entry.hashed.artifacts ?? []).digest;
  } else if (entry.kind === 'artifacts') {
    const result = hashFileSet(pkgDir, entry.artifacts?.paths ?? ['.']);
    if (result.missing.length) {
      throw new Error(`cannot record ${name}: missing ${result.missing.join(', ')}`);
    }
    entry.artifacts.artifactHash = result.digest;
  } else {
    throw new Error(`vendor/${name} is kind "${entry.kind}" — nothing to record`);
  }
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  return { wrote: true, note: `updated ${file}` };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2);
  const recordIndex = args.indexOf('--record');
  const onlyIndex = args.indexOf('--only');
  const vendorDir = path.join(repoRoot, 'vendor');
  try {
    if (recordIndex !== -1) {
      const name = args[recordIndex + 1];
      if (!name) throw new Error('--record requires a vendor directory name');
      const result = await recordTree(vendorDir, name);
      console.log(`[vendor] ${result.note}`);
    } else {
      const problems = await checkVendorProvenance(vendorDir, {
        only: onlyIndex !== -1 ? args[onlyIndex + 1] : undefined,
      });
      if (problems.length) {
        console.error(`[vendor] provenance check failed (${problems.length}):`);
        for (const problem of problems) console.error(`  ${problem}`);
        process.exitCode = 1;
      } else {
        console.log('[vendor] provenance and artifact consistency verified');
      }
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
