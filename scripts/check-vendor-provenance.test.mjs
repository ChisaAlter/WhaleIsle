import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { withOwnedTempDir } from '../src/shared/fs-safe.js';
import {
  checkVendorProvenance,
  recordTree,
  hashFileSet,
} from './check-vendor-provenance.mjs';

function readmeFor(names) {
  const rows = names.map((n) => `| \`${n}/\` | x | x | x | x | x | x |`).join('\n');
  return `# vendor\n\n| Tree | A | B | C | D | E | F |\n| --- | --- | --- | --- | --- | --- | --- |\n${rows}\n`;
}

/**
 * Build a temp vendor/ fixture. `trees` maps dir name → { files, entry } where
 * `files` are relative-path → content and `entry` is the provenance entry or a
 * `(pkgDir) => entry` function evaluated after the files exist (for seeding
 * hashes). Entries may be omitted to model unregistered directories.
 */
async function withVendor(trees, fn) {
  return withOwnedTempDir('vendor-provenance-test-', async (tmp) => {
    const vendorDir = path.join(tmp, 'vendor');
    fs.mkdirSync(vendorDir, { recursive: true });
    const registry = { version: 1, trees: {} };
    for (const [name, spec] of Object.entries(trees)) {
      const pkgDir = path.join(vendorDir, name);
      for (const [rel, content] of Object.entries(spec.files ?? {})) {
        const file = path.join(pkgDir, rel);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, content);
      }
      const entry = typeof spec.entry === 'function' ? spec.entry(pkgDir) : spec.entry;
      if (entry) registry.trees[name] = entry;
    }
    fs.writeFileSync(
      path.join(vendorDir, 'provenance.json'),
      `${JSON.stringify(registry, null, 2)}\n`,
    );
    fs.writeFileSync(path.join(vendorDir, 'README.md'), readmeFor(Object.keys(trees)));
    return fn(vendorDir);
  });
}

const BUILD_SCRIPT = `import fs from 'node:fs';
fs.mkdirSync('lib', { recursive: true });
fs.writeFileSync('lib/out.js', '// built\\n' + fs.readFileSync('src/in.js', 'utf8'));
`;

function hashedEntry(pkgDir) {
  return {
    kind: 'hashed',
    origin: 'fixture',
    esbuildHook: false,
    recordCommands: [['rebuild.mjs']],
    hashed: {
      sources: ['src'],
      artifacts: ['lib/out.js'],
      sourceHash: hashFileSet(pkgDir, ['src']).digest,
      artifactHash: hashFileSet(pkgDir, ['lib/out.js']).digest,
    },
  };
}

const HASHED_FILES = {
  'src/in.js': 'export const v = 1;\n',
  'lib/out.js': '// built\nexport const v = 1;\n',
  'rebuild.mjs': BUILD_SCRIPT,
};

test('an unregistered vendor directory fails and README/provenance disagreement is flagged', async () => {
  await withVendor({ ghost: { files: { 'index.js': 'x' } } }, async (vendorDir) => {
    const problems = await checkVendorProvenance(vendorDir);
    assert.ok(problems.some((p) => p.includes('vendor/ghost is not registered')));
    assert.ok(problems.some((p) => p.includes('README table row "ghost/"')));
  });
});

test('a fully consistent registration passes', async () => {
  await withVendor({
    plain: {
      files: { 'lib/index.js': '// hand maintained\n' },
      entry: { kind: 'source', origin: 'fixture-owned' },
    },
    pinned: {
      files: { 'package.json': '{}' },
      entry: { kind: 'pinned', origin: 'fixture', pin: 'pin.json' },
    },
    pad: {
      files: { 'lib/index.js': 'bundle\n', 'package.json': '{}' },
      entry: (pkgDir) => ({
        kind: 'artifacts',
        origin: 'fixture',
        artifacts: { paths: ['.'], artifactHash: hashFileSet(pkgDir, ['.']).digest },
      }),
    },
    gen: { files: HASHED_FILES, entry: hashedEntry },
    bund: {
      files: {
        'src/in.js': 'export const v = 1;\n',
        'lib/out.js': '// built\nexport const v = 1;\n',
        'build.mjs': BUILD_SCRIPT,
      },
      entry: {
        kind: 'rebuild',
        origin: 'fixture',
        rebuild: {
          inputs: ['src', 'build.mjs'],
          commands: [['build.mjs']],
          outputs: ['lib/out.js'],
          esbuildHook: false,
        },
      },
    },
  }, async (vendorDir) => {
    assert.deepEqual(await checkVendorProvenance(vendorDir), []);
  });
});

test('artifacts kind: a hand-edited packaged file fails and --record re-baselines after resync', async () => {
  await withVendor({
    pad: {
      files: { 'lib/index.js': 'bundle\n', 'package.json': '{}' },
      entry: (pkgDir) => ({
        kind: 'artifacts',
        origin: 'fixture',
        artifacts: { paths: ['.'], artifactHash: hashFileSet(pkgDir, ['.']).digest },
      }),
    },
  }, async (vendorDir) => {
    assert.deepEqual(await checkVendorProvenance(vendorDir), []);
    fs.appendFileSync(path.join(vendorDir, 'pad/lib/index.js'), '// sneaky edit\n');
    const problems = await checkVendorProvenance(vendorDir);
    assert.ok(problems.some((p) => p.includes('pad') && p.includes('artifact set hash')));
    const result = await recordTree(vendorDir, 'pad');
    assert.equal(result.wrote, true);
    assert.deepEqual(await checkVendorProvenance(vendorDir), []);
  });
});

test('hashed kind: artifact changed without source change is flagged as hand-edited', async () => {
  await withVendor({ gen: { files: HASHED_FILES, entry: hashedEntry } }, async (vendorDir) => {
    fs.writeFileSync(path.join(vendorDir, 'gen/lib/out.js'), '// built\n// tampered\n');
    const problems = await checkVendorProvenance(vendorDir);
    assert.ok(problems.some((p) => p.includes('gen') && p.includes('hand-edited')));
  });
});

test('hashed kind: source change without rebuilt artifacts fails until --record rebuilds', async () => {
  await withVendor({ gen: { files: HASHED_FILES, entry: hashedEntry } }, async (vendorDir) => {
    fs.writeFileSync(path.join(vendorDir, 'gen/src/in.js'), 'export const v = 2;\n');
    const problems = await checkVendorProvenance(vendorDir);
    assert.ok(problems.some((p) => p.includes('gen') && p.includes('not rebuilt')));
    await recordTree(vendorDir, 'gen');
    assert.equal(
      fs.readFileSync(path.join(vendorDir, 'gen/lib/out.js'), 'utf8'),
      '// built\nexport const v = 2;\n',
    );
    assert.deepEqual(await checkVendorProvenance(vendorDir), []);
  });
});

test('rebuild kind: byte-compare catches tampering and --record rebuilds in place', async () => {
  const entry = {
    kind: 'rebuild',
    origin: 'fixture',
    esbuildHook: false,
    rebuild: {
      inputs: ['src', 'build.mjs'],
      commands: [['build.mjs']],
      outputs: ['lib/out.js'],
      esbuildHook: false,
    },
  };
  await withVendor({
    bund: {
      files: {
        'src/in.js': 'export const v = 1;\n',
        'lib/out.js': '// built\nexport const v = 1;\n',
        'build.mjs': BUILD_SCRIPT,
      },
      entry,
    },
  }, async (vendorDir) => {
    assert.deepEqual(await checkVendorProvenance(vendorDir), []);
    fs.appendFileSync(path.join(vendorDir, 'bund/lib/out.js'), '// tampered\n');
    const problems = await checkVendorProvenance(vendorDir);
    assert.ok(problems.some((p) => p.includes('bund') && p.includes('clean rebuild')));
    await recordTree(vendorDir, 'bund');
    assert.equal(
      fs.readFileSync(path.join(vendorDir, 'bund/lib/out.js'), 'utf8'),
      '// built\nexport const v = 1;\n',
    );
    assert.deepEqual(await checkVendorProvenance(vendorDir), []);
  });
});
