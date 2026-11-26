import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertNodeVersion } from './lib/node-version.mjs';
import { harnessInstallReason, officialBuildReason, pnpmInstallEnv } from './prestart-ensure.mjs';

test('assertNodeVersion accepts versions inside the engines range', () => {
  assert.equal(assertNodeVersion('24.9.0', '>=24.9.0'), '>=24.9.0');
  assert.equal(assertNodeVersion('24.21.0', '>=24.9.0'), '>=24.9.0');
  assert.equal(assertNodeVersion('v25.0.1', '>=24.9.0'), '>=24.9.0');
  assert.equal(assertNodeVersion('24.22.3', '^24.22.3 || >=26.13.1'), '^24.22.3 || >=26.13.1');
  assert.equal(assertNodeVersion('24.25.0', '^24.22.3 || >=26.13.1'), '^24.22.3 || >=26.13.1');
  assert.equal(assertNodeVersion('26.13.1', '^24.22.3 || >=26.13.1'), '^24.22.3 || >=26.13.1');
  assert.equal(assertNodeVersion('v27.0.0', '^24.22.3 || >=26.13.1'), '^24.22.3 || >=26.13.1');
});

test('assertNodeVersion reports an actionable Chinese error for old or unsupported Node', () => {
  assert.throws(
    () => assertNodeVersion('22.14.0', '>=24.9.0'),
    (error) => {
      assert.match(error.message, /当前 Node 版本 v22\.14\.0/);
      assert.match(error.message, /engines 要求（>=24\.9\.0）/);
      assert.match(error.message, /nvm/);
      return true;
    },
  );
  assert.throws(() => assertNodeVersion('24.9.0', '>=24.9.1'), /v24\.9\.0 不满足/);
  assert.throws(() => assertNodeVersion('24.20.0', '^24.22.3 || >=26.13.1'), /v24\.20\.0 不满足/);
  assert.throws(() => assertNodeVersion('24.22.2', '^24.22.3 || >=26.13.1'), /v24\.22\.2 不满足/);
  assert.throws(() => assertNodeVersion('25.0.0', '^24.22.3 || >=26.13.1'), /v25\.0\.0 不满足/);
  assert.throws(() => assertNodeVersion('26.13.0', '^24.22.3 || >=26.13.1'), /v26\.13\.0 不满足/);
});

test('assertNodeVersion fails loudly on an unparseable engines range', () => {
  assert.throws(() => assertNodeVersion('24.22.3', ''), /无法解析/);
  assert.throws(() => assertNodeVersion('24.22.3', undefined), /无法解析/);
  assert.throws(() => assertNodeVersion('24.22.3', '~24.22.3'), /无法解析.*~24\.22\.3/);
  assert.throws(() => assertNodeVersion('24.22.3', '^24.22.3 || '), /无法解析/);
});

function makeHarnessFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-harness-ready-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const harnessDir = path.join(root, 'harness');
  const pkgTarget = path.join(harnessDir, 'packages', 'core', 'tools');
  fs.mkdirSync(pkgTarget, { recursive: true });
  fs.writeFileSync(path.join(pkgTarget, 'package.json'), '{"name":"@deepseek-ai/dsh-tools"}\n');
  fs.mkdirSync(path.join(harnessDir, 'node_modules', 'pnpm', 'bin'), { recursive: true });
  fs.writeFileSync(path.join(harnessDir, 'node_modules', 'pnpm', 'bin', 'pnpm.mjs'), '');
  fs.mkdirSync(path.join(harnessDir, 'node_modules', '.pnpm'), { recursive: true });
  fs.mkdirSync(path.join(harnessDir, 'apps', 'cli', 'node_modules', '@deepseek-ai'), { recursive: true });
  fs.writeFileSync(path.join(harnessDir, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n');
  fs.writeFileSync(path.join(harnessDir, 'node_modules', '.pnpm', 'lock.yaml'), 'lockfileVersion: 9.0\n');
  fs.symlinkSync(
    pkgTarget,
    path.join(harnessDir, 'apps', 'cli', 'node_modules', '@deepseek-ai', 'dsh-tools'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  return { root, harnessDir };
}

test('harnessInstallReason detects lockfile drift and foreign/dangling workspace junctions', (t) => {
  const { root, harnessDir } = makeHarnessFixture(t);
  assert.equal(harnessInstallReason(harnessDir), '');

  fs.writeFileSync(path.join(harnessDir, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n# updated\n');
  assert.match(harnessInstallReason(harnessDir), /pnpm-lock\.yaml differs/);

  fs.writeFileSync(path.join(harnessDir, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n');
  assert.equal(harnessInstallReason(harnessDir), '');

  const foreignTarget = path.join(root, 'other-worktree', 'tools');
  fs.mkdirSync(foreignTarget, { recursive: true });
  const linkPath = path.join(harnessDir, 'apps', 'cli', 'node_modules', '@deepseek-ai', 'foreign-pkg');
  fs.symlinkSync(foreignTarget, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
  assert.match(harnessInstallReason(harnessDir), /outside current harness checkout/);

  fs.rmSync(foreignTarget, { recursive: true, force: true });
  assert.match(harnessInstallReason(harnessDir), /dangling workspace link/);
});

test('officialBuildReason detects stale version/commit metadata', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-build-reason-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const harnessDir = path.join(root, 'harness');
  fs.mkdirSync(path.join(harnessDir, '.dsh-build'), { recursive: true });
  fs.writeFileSync(path.join(harnessDir, 'package.json'), JSON.stringify({ version: '0.2.3-alpha.2' }));
  assert.match(await officialBuildReason(harnessDir, root), /missing/);

  fs.writeFileSync(
    path.join(harnessDir, '.dsh-build', 'client-build-environment.json'),
    JSON.stringify({
      environment: {
        DSH_CLIENT_BUILD_PROFILE: 'official',
        DSH_CLIENT_TITLE: 'Whale Isle',
        DSH_CLIENT_COMMIT_HASH: 'abc1234',
        DSH_CLIENT_VERSION: '0.2.2-rc.2',
      },
    }),
  );
  assert.match(await officialBuildReason(harnessDir, root), /DSH_CLIENT_VERSION|DSH_CLIENT_COMMIT_HASH/);
});

test('pnpmInstallEnv sets CI=true and removes LEFTHOOK', () => {
  const env = pnpmInstallEnv({ PATH: 'x', LEFTHOOK: '1' });
  assert.equal(env.CI, 'true');
  assert.equal('LEFTHOOK' in env, false);
});
