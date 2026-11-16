import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  materializeRuntimeCopies,
  planRuntimeClosure,
  readManifest,
  resolveInstalledPackage,
} from './dshd-remote-runtime.mjs';

function writePackage(dir, manifest) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(manifest));
}

// A fake lockfile-installed workspace: packages/ holds the workspace members,
// node_modules/ holds what `npm ci` laid down from package-lock.json, including
// one nested version conflict and scope symlinks back into packages/.
function workspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dshd-runtime-plan-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const packagesDir = path.join(root, 'packages');
  const nodeModules = path.join(root, 'node_modules');
  fs.mkdirSync(nodeModules, { recursive: true });
  fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify({
    name: 'dshd-runtime-fixture',
    lockfileVersion: 3,
    packages: {},
  }));
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
    devDependencies: { 'dev-only': '^1.0.0' },
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
  writePackage(path.join(nodeModules, 'dev-only'), { name: 'dev-only', version: '1.0.0' });
  writePackage(path.join(nodeModules, 'better-sqlite3'), {
    name: 'better-sqlite3',
    version: '1.0.0',
    dependencies: { 'sqlite-trans': '^1.0.0' },
  });
  writePackage(path.join(nodeModules, 'sqlite-trans'), { name: 'sqlite-trans', version: '1.0.0' });
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

test('the closure covers dependencies, transitives and non-optional peers but not dev or optional deps', t => {
  const { root } = workspace(t);
  const plan = planRuntimeClosure({ workspaceRoot: root, seeds: ['server'], forcedDependencies: ['better-sqlite3'] });
  assert.deepEqual(
    plan.copies.map(({ target }) => target),
    [
      '@scope/dep',
      'better-sqlite3',
      'dep-a',
      'dep-a/node_modules/shared',
      'peer-pkg',
      'shared',
      'sqlite-trans',
    ],
  );
  for (const excluded of ['dev-only', 'opt-only', 'opt-extra', 'peer-opt']) {
    assert.ok(
      !plan.copies.some(({ target }) => target === excluded),
      `${excluded} must stay out of the production closure`,
    );
  }
});

test('forcedDependencies pull in optional roots together with their transitives', t => {
  const { root } = workspace(t);
  const unforced = planRuntimeClosure({ workspaceRoot: root, seeds: ['server'] });
  assert.ok(!unforced.copies.some(({ target }) => target === 'better-sqlite3'));
  const forced = planRuntimeClosure({ workspaceRoot: root, seeds: ['server'], forcedDependencies: ['better-sqlite3'] });
  const targets = forced.copies.map(({ target }) => target);
  assert.ok(targets.includes('better-sqlite3'));
  assert.ok(targets.includes('sqlite-trans'));
});

test('workspace members land in workspacePackages and are never plain copies', t => {
  const { root, packagesDir } = workspace(t);
  const plan = planRuntimeClosure({ workspaceRoot: root, seeds: ['server'] });
  assert.deepEqual(
    plan.workspacePackages.map(({ name }) => name).sort(),
    ['@acme/helper', '@acme/protocol', '@acme/server'],
  );
  assert.ok(plan.workspacePackages.every(({ dir }) => dir.startsWith(packagesDir)));
  assert.ok(!plan.copies.some(({ target }) => target.split('/')[0] === '@acme'));
});

test('nested version conflicts keep the node_modules nesting npm chose', t => {
  const { root } = workspace(t);
  const plan = planRuntimeClosure({ workspaceRoot: root, seeds: ['server'] });
  const top = plan.copies.find(({ target }) => target === 'shared');
  const nested = plan.copies.find(({ target }) => target === 'dep-a/node_modules/shared');
  assert.equal(readManifest(top.source).version, '1.0.0');
  assert.equal(readManifest(nested.source).version, '2.0.0');
});

test('scoped packages produce scoped runtime targets', t => {
  const { root, nodeModules } = workspace(t);
  const plan = planRuntimeClosure({ workspaceRoot: root, seeds: ['server'] });
  const scoped = plan.copies.find(({ target }) => target === '@scope/dep');
  assert.equal(scoped.source, path.join(nodeModules, '@scope', 'dep'));
});

test('materializeRuntimeCopies lands scoped and nested targets in the runtime tree', t => {
  const { root, nodeModules } = workspace(t);
  const plan = planRuntimeClosure({ workspaceRoot: root, seeds: ['server'], forcedDependencies: ['better-sqlite3'] });
  const out = path.join(root, 'runtime', 'node_modules');
  materializeRuntimeCopies(plan.copies, out);
  assert.equal(readManifest(path.join(out, 'dep-a', 'node_modules', 'shared')).version, '2.0.0');
  assert.equal(readManifest(path.join(out, 'shared')).version, '1.0.0');
  assert.equal(readManifest(path.join(out, '@scope', 'dep')).version, '1.0.0');
  assert.equal(fs.existsSync(path.join(out, 'opt-only')), false);
  assert.equal(fs.existsSync(path.join(out, 'peer-opt')), false);
  assert.equal(fs.existsSync(path.join(out, 'dev-only')), false);
  assert.equal(fs.existsSync(path.join(nodeModules, 'peer-opt', 'package.json')), true);
});

test('a declared dependency missing from the lockfile-installed tree fails the plan', t => {
  const { root, packagesDir } = workspace(t);
  const manifest = JSON.parse(fs.readFileSync(path.join(packagesDir, 'server', 'package.json'), 'utf8'));
  manifest.dependencies['ghost-dep'] = '^9.9.9';
  fs.writeFileSync(path.join(packagesDir, 'server', 'package.json'), JSON.stringify(manifest));
  assert.throws(() => planRuntimeClosure({ workspaceRoot: root, seeds: ['server'] }), /ghost-dep.*not installed/);
});

test('a forced dependency missing from the installed tree fails the plan', t => {
  const { root } = workspace(t);
  assert.throws(
    () => planRuntimeClosure({ workspaceRoot: root, seeds: ['server'], forcedDependencies: ['ghost-forced'] }),
    /forced runtime dependency ghost-forced is not installed/,
  );
});
