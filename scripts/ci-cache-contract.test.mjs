import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';

const root = path.resolve(import.meta.dirname, '..');

function readYaml(relPath) {
  return parse(fs.readFileSync(path.join(root, relPath), 'utf8'));
}

test('setup-whale composite action enforces release isolation, out-of-workspace paths and lockfile keys', () => {
  const action = readYaml('.github/actions/setup-whale/action.yml');
  const steps = action.runs?.steps ?? [];
  const cacheSteps = steps.filter((step) => String(step.uses || '').startsWith('actions/cache@'));
  assert.equal(cacheSteps.length, 5);

  const stagesCache = cacheSteps.find((step) => step.name === 'Cache deepseek-harness stage artifacts');
  assert.ok(stagesCache, 'dsh-stages cache step must exist');
  assert.match(stagesCache.if, /inputs\.is-release\s*!=\s*'true'/);

  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const packagedPatterns = [...(pkg.build?.files ?? []), ...(pkg.build?.extraResources ?? [])]
    .map((entry) => (typeof entry === 'string' ? entry : entry?.from || ''))
    .filter(Boolean);

  for (const step of cacheSteps) {
    const key = String(step.with?.key || '');
    assert.match(key, /\$\{\{\s*runner\.os\s*\}\}/, `${step.name} key must include runner.os`);
    assert.match(key, /\$\{\{\s*runner\.arch\s*\}\}/, `${step.name} key must include runner.arch`);
    assert.match(key, /hashFiles\(/, `${step.name} key must include hashFiles(...)`);

    const paths = String(step.with?.path || '').trim().split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    for (const cachePath of paths) {
      if (!cachePath.startsWith('vendor/deepseek-harness/')) {
        const outsideWorkspace = cachePath.startsWith('${{ runner.temp }}/../');
        if (!outsideWorkspace) {
          assert.equal(cachePath, 'build/office-runtime-cache');
          assert.equal(
            packagedPatterns.some((pattern) => pattern === 'build/office-runtime-cache' || pattern.startsWith('build/office-runtime-cache/')),
            false,
            `${cachePath} must not be matched by electron-builder packaging patterns`,
          );
        }
      }
    }
  }

  const envStep = steps.find((step) => step.name === 'Configure cache environment and PR build scope');
  assert.ok(envStep, 'Configure cache environment step must exist');
  const envRun = String(envStep.run || '');
  assert.match(envRun, /DSH_CLIENT_COMMIT_HASH/);
  assert.match(envRun, /isPr && !harnessChanged && !isRelease/);
});

test('workflows wire setup-whale and mark macos release builds with is-release true', () => {
  const testWf = readYaml('.github/workflows/test.yml');
  for (const jobName of ['tools', 'web', 'windows', 'macos', 'linux-tests', 'macos-tests']) {
    const job = testWf.jobs[jobName];
    const setupStep = (job.steps || []).find((step) => step.uses === './.github/actions/setup-whale');
    assert.ok(setupStep, `test.yml job ${jobName} must use ./.github/actions/setup-whale`);
    if (jobName === 'macos') {
      assert.equal(setupStep.with['is-release'], 'true');
    }
  }

  const flakyWf = readYaml('.github/workflows/flaky.yml');
  const flakySetup = (flakyWf.jobs['repeated-tests'].steps || []).find((step) => step.uses === './.github/actions/setup-whale');
  assert.ok(flakySetup, 'flaky.yml must use ./.github/actions/setup-whale');

  const macDiagWf = readYaml('.github/workflows/release-macos-diagnostic.yml');
  const macDiagSetup = (macDiagWf.jobs['packaged-chrome'].steps || []).find((step) => step.uses === './.github/actions/setup-whale');
  assert.ok(macDiagSetup, 'release-macos-diagnostic.yml must use ./.github/actions/setup-whale');
  assert.equal(macDiagSetup.with['is-release'], 'true');
});
