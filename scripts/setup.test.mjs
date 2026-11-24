import test from 'node:test';
import assert from 'node:assert/strict';
import { assertNodeVersion } from './lib/node-version.mjs';

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
