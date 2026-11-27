import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildElectronArgs, buildChildEnv } = require('./run-electron.js');

test('buildElectronArgs places --remote-debugging-port and --inspect before app entry dot', () => {
  assert.deepEqual(buildElectronArgs([]), ['.']);
  assert.deepEqual(
    buildElectronArgs(['--remote-debugging-port=9223', '--inspect=127.0.0.1:9229', '--foo']),
    ['--remote-debugging-port=9223', '--inspect=127.0.0.1:9229', '.', '--foo'],
  );
  assert.deepEqual(buildElectronArgs(['--smoke-mode']), ['.', '--smoke-mode']);
});

test('buildChildEnv strips ELECTRON_RUN_AS_NODE without mutating parent env', () => {
  const source = { PATH: 'ok', ELECTRON_RUN_AS_NODE: '1' };
  const cleaned = buildChildEnv(source);
  assert.equal('ELECTRON_RUN_AS_NODE' in cleaned, false);
  assert.equal(cleaned.PATH, 'ok');
  assert.equal(source.ELECTRON_RUN_AS_NODE, '1');
});
