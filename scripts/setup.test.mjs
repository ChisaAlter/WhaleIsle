import test from 'node:test';
import assert from 'node:assert/strict';
import { assertNodeVersion } from './lib/node-version.mjs';

test('assertNodeVersion accepts versions inside the engines range', () => {
  assert.equal(assertNodeVersion('24.9.0', '>=24.9.0'), '>=24.9.0');
  assert.equal(assertNodeVersion('24.21.0', '>=24.9.0'), '>=24.9.0');
  assert.equal(assertNodeVersion('v25.0.1', '>=24.9.0'), '>=24.9.0');
});

test('assertNodeVersion reports an actionable Chinese error for old Node', () => {
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
});

test('assertNodeVersion fails loudly on an unparseable engines range', () => {
  assert.throws(() => assertNodeVersion('24.21.0', ''), /无法解析/);
  assert.throws(() => assertNodeVersion('24.21.0', undefined), /无法解析/);
  assert.throws(() => assertNodeVersion('24.21.0', '^24.9.0'), /无法解析.*\^24\.9\.0/);
});
