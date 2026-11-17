import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { withOwnedTempDir } from '../src/shared/fs-safe.js';
import { hashFileSet } from './check-vendor-provenance.mjs';
import {
  checkGeneratedArtifacts,
  recordArtifact,
  registryPath,
} from './check-generated.mjs';

function git(rootDir, args) {
  const result = spawnSync('git', args, { cwd: rootDir, encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`);
}

/**
 * Build a temp repository fixture. `files` maps relative path → content;
 * `artifacts` becomes scripts/generated-artifacts.json. Every file is
 * git-committed so the tracked-file checks see a realistic tree.
 */
async function withRepo(files, artifacts, fn) {
  return withOwnedTempDir('generated-artifacts-test-', async (tmp) => {
    for (const [rel, content] of Object.entries(files)) {
      const file = path.join(tmp, rel);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content);
    }
    fs.mkdirSync(path.join(tmp, 'scripts'), { recursive: true });
    fs.writeFileSync(
      registryPath(tmp),
      `${JSON.stringify({ version: 1, artifacts }, null, 2)}\n`,
    );
    git(tmp, ['init', '-q']);
    git(tmp, ['add', '-A']);
    return fn(tmp);
  });
}

const BUILDER = `import fs from 'node:fs';
fs.mkdirSync('out', { recursive: true });
fs.writeFileSync('out/bundle.js', '// built\\n' + fs.readFileSync('src/in.js', 'utf8'));
`;

const REBUILD_FILES = {
  'src/in.js': 'export const v = 1;\n',
  'scripts/build.mjs': BUILDER,
  'out/bundle.js': '// built\nexport const v = 1;\n',
};

function rebuildEntry() {
  return {
    kind: 'rebuild',
    origin: 'fixture',
    rebuildCommand: 'node scripts/build.mjs',
    rebuild: {
      inputs: ['scripts/build.mjs', 'src'],
      commands: [['scripts/build.mjs']],
      outputs: ['out/bundle.js'],
    },
  };
}

function hashedEntry(rootDir) {
  return {
    kind: 'hashed',
    origin: 'fixture',
    rebuildCommand: 'node scripts/build.mjs',
    hashed: {
      sources: ['src'],
      artifacts: ['out/bundle.js'],
      sourceHash: hashFileSet(rootDir, ['src']).digest,
      artifactHash: hashFileSet(rootDir, ['out/bundle.js']).digest,
    },
    // recordCommands intentionally omitted: --record must also work when the
    // registry only documents a manual rebuild.
  };
}

test('rebuild entries pass on a matching artifact and fail on staleness', async () => {
  await withRepo(REBUILD_FILES, { 'out/bundle.js': rebuildEntry() }, async (rootDir) => {
    assert.deepEqual(await checkGeneratedArtifacts(rootDir), []);
    fs.writeFileSync(path.join(rootDir, 'src/in.js'), 'export const v = 2;\n');
    const problems = await checkGeneratedArtifacts(rootDir);
    assert.ok(problems.some((p) => p.includes('does not match a clean rebuild')));
    assert.ok(problems.some((p) => p.includes('node scripts/build.mjs')));
  });
});

test('rebuild entries fail when the committed artifact was hand-edited', async () => {
  await withRepo(REBUILD_FILES, { 'out/bundle.js': rebuildEntry() }, async (rootDir) => {
    fs.writeFileSync(path.join(rootDir, 'out/bundle.js'), '// tampered\n');
    const problems = await checkGeneratedArtifacts(rootDir);
    assert.ok(problems.some((p) => p.includes('does not match a clean rebuild')));
  });
});

test('hashed entries flag artifact edits and source drift, and --record refreshes', async () => {
  let rootDir;
  await withRepo(REBUILD_FILES, {}, async (dir) => {
    rootDir = dir;
    const artifacts = { 'out/bundle.js': hashedEntry(dir) };
    fs.writeFileSync(registryPath(dir), `${JSON.stringify({ version: 1, artifacts }, null, 2)}\n`);
    assert.deepEqual(await checkGeneratedArtifacts(dir), []);

    fs.writeFileSync(path.join(dir, 'out/bundle.js'), '// tampered\n');
    let problems = await checkGeneratedArtifacts(dir);
    assert.ok(problems.some((p) => p.includes('artifact set changed without a source change')));
    fs.writeFileSync(path.join(dir, 'out/bundle.js'), '// built\nexport const v = 1;\n');

    fs.writeFileSync(path.join(dir, 'src/in.js'), 'export const v = 2;\n');
    problems = await checkGeneratedArtifacts(dir);
    assert.ok(problems.some((p) => p.includes('source set changed but artifacts were not rebuilt')));

    // Rebuild the artifact, then --record refreshes both hashes.
    fs.writeFileSync(path.join(dir, 'out/bundle.js'), '// built\nexport const v = 2;\n');
    await recordArtifact(dir, 'out/bundle.js');
    assert.deepEqual(await checkGeneratedArtifacts(dir), []);
  });
  assert.ok(rootDir);
});

test('artifacts entries are hash-locked and re-recordable', async () => {
  const files = { 'dist/blob.bin': 'payload\n' };
  const entryFor = (rootDir) => ({
    kind: 'artifacts',
    origin: 'fixture',
    rebuildCommand: 'copy the blob',
    artifacts: {
      paths: ['dist/blob.bin'],
      artifactHash: hashFileSet(rootDir, ['dist/blob.bin']).digest,
    },
  });
  await withRepo(files, {}, async (dir) => {
    const artifacts = { 'dist/blob.bin': entryFor(dir) };
    fs.writeFileSync(registryPath(dir), `${JSON.stringify({ version: 1, artifacts }, null, 2)}\n`);
    assert.deepEqual(await checkGeneratedArtifacts(dir), []);

    fs.writeFileSync(path.join(dir, 'dist/blob.bin'), 'changed\n');
    const problems = await checkGeneratedArtifacts(dir);
    assert.ok(problems.some((p) => p.includes('does not match the record')));

    await recordArtifact(dir, 'dist/blob.bin');
    assert.deepEqual(await checkGeneratedArtifacts(dir), []);
  });
});

test('schema problems and untracked artifacts are reported', async () => {
  await withRepo({ 'out/bundle.js': 'x\n' }, {
    'out/bundle.js': { kind: 'rebuild', origin: 'x', rebuildCommand: 'x' },
    'ghost/file.js': {
      kind: 'artifacts',
      origin: 'x',
      rebuildCommand: 'x',
      artifacts: { paths: ['ghost/file.js'], artifactHash: 'x' },
    },
  }, async (dir) => {
    const problems = await checkGeneratedArtifacts(dir);
    assert.ok(problems.some((p) => p.includes('requires rebuild.commands and rebuild.outputs')));
    assert.ok(problems.some((p) => p.includes('"ghost/file.js" has no tracked files')));
  });
  // A file present on disk but never committed cannot pass as an artifact.
  await withRepo({}, {
    'out/loose.js': {
      kind: 'artifacts',
      origin: 'x',
      rebuildCommand: 'x',
      artifacts: { paths: ['out/loose.js'], artifactHash: 'x' },
    },
  }, async (dir) => {
    fs.mkdirSync(path.join(dir, 'out'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'out/loose.js'), 'y\n');
    const problems = await checkGeneratedArtifacts(dir);
    assert.ok(problems.some((p) => p.includes('not git-tracked')));
  });
});

test('the tracked-file sweep rejects unregistered bundles', async () => {
  await withRepo({ 'lib/app.bundle.js': 'x\n' }, {}, async (dir) => {
    const problems = await checkGeneratedArtifacts(dir);
    assert.ok(problems.some((p) => p.includes('"lib/app.bundle.js" is not registered')));
  });
});
