import assert from 'node:assert/strict';
import test from 'node:test';
import { synchronizeWhaleUiDependencies, whaleUiInstallEnvironment } from './whale-ui-dependencies.mjs';

const manifest = {
  dependencies: { echarts: '6.1.0', katex: '0.18.2', mermaid: '11.16.1', react: '19.2.3' },
  devDependencies: { esbuild: '0.28.2', '@types/react': '19.2.2' },
};
const versions = () => new Map(Object.entries({ ...manifest.dependencies, ...manifest.devDependencies }));

function synchronize(installed, install) {
  return synchronizeWhaleUiDependencies({ manifest, installedVersion: name => installed.get(name), install });
}

test('upgraded ECharts, KaTeX and Mermaid pins replace stale installed versions and require rebuilding', () => {
  const installed = versions();
  installed.set('echarts', '5.6.0');
  installed.set('katex', '0.16.47');
  installed.set('mermaid', '11.16.0');
  let installs = 0;
  const changed = synchronize(installed, () => {
    installs++;
    for (const [name, version] of versions()) installed.set(name, version);
  });
  assert.equal(installs, 1);
  assert.equal(changed, true);
  assert.deepEqual(installed, versions());
});

test('current dependency and build-tool versions skip installation', () => {
  const changed = synchronize(versions(), () => assert.fail('Current dependencies must not be reinstalled.'));
  assert.equal(changed, false);
});

for (const name of ['react', 'esbuild', '@types/react']) {
  test(`a missing ${name} dependency requires installation`, () => {
    const installed = versions();
    installed.delete(name);
    let installs = 0;
    assert.equal(synchronize(installed, () => { installs++; installed.set(name, versions().get(name)); }), true);
    assert.equal(installs, 1);
  });
}

test('a stale build-tool version also requires installation', () => {
  const installed = versions();
  installed.set('esbuild', '0.27.0');
  assert.equal(synchronize(installed, () => installed.set('esbuild', '0.28.2')), true);
});

test('successful install status with stale versions still stops the build', () => {
  const installed = versions();
  installed.set('mermaid', '11.16.0');
  assert.throws(() => synchronize(installed, () => {}), /after installation: mermaid@11\.16\.1/);
});

test('failed installation propagates without treating dependencies as current', () => {
  const installed = versions();
  installed.delete('react');
  const failure = new Error('Frozen lockfile install failed.');
  assert.throws(() => synchronize(installed, () => { throw failure; }), error => error === failure);
});

test('non-interactive installation receives CI=true without changing the parent environment', () => {
  const environment = { PATH: 'tools', CI: 'false', CUSTOM: 'preserved' };
  assert.deepEqual(whaleUiInstallEnvironment(environment, false), { PATH: 'tools', CI: 'true', CUSTOM: 'preserved' });
  assert.equal(environment.CI, 'false');
  assert.deepEqual(whaleUiInstallEnvironment({ PATH: 'tools' }, false), { PATH: 'tools', CI: 'true' });
});

test('interactive installation preserves the inherited CI setting in a new environment object', () => {
  const environment = { PATH: 'tools', CI: 'false' };
  const result = whaleUiInstallEnvironment(environment, true);
  assert.deepEqual(result, environment);
  assert.notEqual(result, environment);
});
