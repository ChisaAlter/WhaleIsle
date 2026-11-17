import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeFixture } from './lib/fixture.mjs';
import { mutate, runCampaign } from './mutation-critical.mjs';

const fixtures = (t, body = 'assert.equal(value, 1);') => makeFixture(t, {
  'policy.js': 'module.exports = 1;\n',
  'policy.test.cjs': `const test = require('node:test'); const assert = require('node:assert/strict'); const value = require('./policy.js'); test('policy', () => { ${body} });`,
});
const temps = () => readdirSync(tmpdir()).filter(name => name.startsWith('whale-mutation-')).sort();

test('mutation locations fail closed when the source no longer matches uniquely', () => {
  assert.throws(() => mutate('guard guard', ['bad', 'guard', 'allow']), /found 2/);
  assert.throws(() => mutate('new policy', ['bad', 'guard', 'allow']), /found 0/);
});

test('campaign uses existing tests, reports survivors and preserves the source', async (t) => {
  const root = fixtures(t);
  const before = temps();
  const output = join(root, 'report.json');
  const results = await runCampaign([{ file: 'policy.js', test: 'policy.test.cjs', mutations: [
    ['fault', 'exports = 1', 'exports = 2'],
    ['equivalent', 'exports = 1', 'exports = (1)'],
  ] }], { root, output });
  assert.deepEqual(results.map(row => row.outcome), ['detected', 'survived']);
  assert.deepEqual(results[0].failingTests, ['policy']);
  assert.equal(readFileSync(join(root, 'policy.js'), 'utf8'), 'module.exports = 1;\n');
  assert.equal(JSON.parse(readFileSync(output, 'utf8')).results.length, 2);
  assert.deepEqual(temps(), before, 'the owned environment was reclaimed');
});

test('a failing baseline aborts rather than crediting mutations and reclaims its environment', async (t) => {
  const root = fixtures(t, 'assert.equal(value, 2);');
  const before = temps();
  const output = join(root, 'report.json');
  await assert.rejects(() => runCampaign([{ file: 'policy.js', test: 'policy.test.cjs', mutations: [] }], { root, output }), /Baseline failed/);
  assert.equal(existsSync(output), false);
  assert.deepEqual(temps(), before);
});

test('syntax-invalid mutations are errors rather than detected policy faults', async (t) => {
  const root = fixtures(t);
  const before = temps();
  await assert.rejects(() => runCampaign([{ file: 'policy.js', test: 'policy.test.cjs', mutations: [
    ['syntax', 'exports = 1', 'exports = ('],
  ] }], { root }), /invalid mutation/);
  assert.deepEqual(temps(), before);
});

test('a mutant that crashes the process is an infrastructure error and cleans up', async (t) => {
  const root = fixtures(t);
  const before = temps();
  await assert.rejects(() => runCampaign([{ file: 'policy.js', test: 'policy.test.cjs', mutations: [
    ['crash', 'module.exports = 1;', 'process.exit(2);'],
  ] }], { root }), /test infrastructure failure/);
  assert.deepEqual(temps(), before);
});

test('a timed-out mutation is not credited and its environment is reclaimed', async (t) => {
  const root = fixtures(t);
  const before = temps();
  await assert.rejects(() => runCampaign([{ file: 'policy.js', test: 'policy.test.cjs', mutations: [
    ['hang', 'module.exports = 1;', 'while (true) {}'],
  ] }], { root, timeoutMs: 2000 }), /test infrastructure failure/);
  assert.deepEqual(temps(), before);
});
