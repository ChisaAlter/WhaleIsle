import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  materializeRuntimeCopies,
  planRuntimeClosure,
  resolveInstalledPackage,
} from './lib/dshd-remote-runtime.mjs';

function writePackage(dir, manifest) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(manifest));
}

function workspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dshd-runtime-plan-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const packagesDir = path.join(root, 'packages');
  const nodeModules = path.join(root, 'node_modules');
  writePackage(path.join(packagesDir, 'server'), {
    name: '@acme/server',
    version: '1.0.0',
    dependencies: {
      '@acme/helper': '1.0.0',
      '@acme/protocol': '1.0.0',
      'dep-a': '^1.0.0',
      shared: '^1.0.0',
    },
    optionalDependencies: { 'opt-extra': '^1.0.0' },
  });
  writePackage(path.join(packagesDir, 'protocol'), {
    name: '@acme/protocol',
    version: '1.0.0',
    dependencies: { shared: '^1.0.0' },
  });
  writePackage(path.join(packagesDir, 'helper'), { name: '@acme/helper', version: '1.0.0' });
  writePackage(path.join(nodeModules, 'dep-a'), {
    name: 'dep-a',
    version: '1.0.0',
    dependencies: { '@scope/dep': '^1.0.0', shared: '^2.0.0' },
    optionalDependencies: { 'opt-only': '^1.0.0' },
    peerDependencies: { 'peer-pkg': '^1.0.0', 'peer-opt': '^1.0.0' },
    peerDependenciesMeta: { 'peer-opt': { optional: true } },
  });
  writePackage(path.join(nodeModules, 'dep-a', 'node_modules', 'shared'), { name: 'shared', version: '2.0.0' });
  writePackage(path.join(nodeModules, 'shared'), { name: 'shared', version: '1.0.0' });
  writePackage(path.join(nodeModules, '@scope', 'dep'), { name: '@scope/dep', version: '1.0.0' });
  writePackage(path.join(nodeModules, 'peer-pkg'), { name: 'peer-pkg', version: '1.0.0' });
  writePackage(path.join(nodeModules, 'peer-opt'), { name: 'peer-opt', version: '1.0.0' });
  writePackage(path.join(nodeModules, 'opt-only'), { name: 'opt-only', version: '1.0.0' });
  writePackage(path.join(nodeModules, 'opt-extra'), { name: 'opt-extra', version: '1.0.0' });
  writePackage(path.join(nodeModules, 'better-sqlite3'), { name: 'better-sqlite3', version: '1.0.0' });
  for (const name of ['protocol', 'helper']) {
    fs.mkdirSync(path.join(nodeModules, '@acme'), { recursive: true });
    fs.symlinkSync(path.join(packagesDir, name), path.join(nodeModules, '@acme', name), 'junction');
  }
  return { root, packagesDir, nodeModules };
}

test('resolveInstalledPackage walks node_modules upward and stops at the workspace boundary', t => {
  const { root, nodeModules } = workspace(t);
  const depA = path.join(nodeModules, 'dep-a');
  assert.equal(resolveInstalledPackage(depA, 'shared', root), path.join(depA, 'node_modules', 'shared'));
  assert.equal(resolveInstalledPackage(path.join(depA, 'node_modules', 'shared'), 'peer-pkg', root), path.join(nodeModules, 'peer-pkg'));
  assert.equal(resolveInstalledPackage(root, 'not-installed', root), null);
});

test('the runtime closure pins workspace members, nested versions and forced deps, and skips optionals', t => {
  const { root, packagesDir, nodeModules } = workspace(t);
  const plan = planRuntimeClosure({ workspaceRoot: root, seeds: ['server'], forcedDependencies: ['better-sqlite3'] });
  assert.deepEqual(
    plan.workspacePackages.map(({ name }) => name).sort(),
    ['@acme/helper', '@acme/protocol', '@acme/server'],
  );
  assert.ok(plan.workspacePackages.every(({ dir }) => dir.startsWith(packagesDir)));
  const targets = plan.copies.map(({ target }) => target);
  assert.deepEqual(targets, ['@scope/dep', 'better-sqlite3', 'dep-a', 'dep-a/node_modules/shared', 'peer-pkg', 'shared']);
  assert.ok(!targets.some(target => /^(opt-only|peer-opt|opt-extra)$/.test(target)));
  const nested = plan.copies.find(({ target }) => target === 'dep-a/node_modules/shared');
  assert.equal(JSON.parse(fs.readFileSync(path.join(nested.source, 'package.json'), 'utf8')).version, '2.0.0');
});

test('materialized copies land at the same positions npm resolved them', t => {
  const { root, nodeModules } = workspace(t);
  const plan = planRuntimeClosure({ workspaceRoot: root, seeds: ['server'], forcedDependencies: ['better-sqlite3'] });
  const out = path.join(root, 'runtime', 'node_modules');
  materializeRuntimeCopies(plan.copies, out);
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(out, 'dep-a', 'node_modules', 'shared', 'package.json'), 'utf8')).version,
    '2.0.0',
  );
  assert.equal(JSON.parse(fs.readFileSync(path.join(out, 'shared', 'package.json'), 'utf8')).version, '1.0.0');
  assert.equal(JSON.parse(fs.readFileSync(path.join(out, '@scope', 'dep', 'package.json'), 'utf8')).version, '1.0.0');
  assert.equal(fs.existsSync(path.join(out, 'opt-only')), false);
  assert.equal(fs.existsSync(path.join(out, 'peer-opt')), false);
  assert.equal(fs.existsSync(path.join(nodeModules, 'peer-opt', 'package.json')), true);
});

test('a declared dependency missing from the lockfile-installed tree fails the plan', t => {
  const { root, packagesDir } = workspace(t);
  const manifest = JSON.parse(fs.readFileSync(path.join(packagesDir, 'server', 'package.json'), 'utf8'));
  manifest.dependencies['ghost-dep'] = '^9.9.9';
  fs.writeFileSync(path.join(packagesDir, 'server', 'package.json'), JSON.stringify(manifest));
  assert.throws(() => planRuntimeClosure({ workspaceRoot: root, seeds: ['server'] }), /ghost-dep.*not installed/);
});
