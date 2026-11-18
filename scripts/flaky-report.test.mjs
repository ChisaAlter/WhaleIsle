import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeRounds,
  decodeXmlEntities,
  parseJunitResults,
  renderMarkdown,
  sortRoundLogs,
  testGlobs,
} from './flaky-report.mjs';

// 夹具按 Node 24 junit reporter 的真实形态书写：<testcase> 叶子带
// classname/file 属性；失败用例体内有 <failure>，跳过用例体内有
// <skipped/>；统计写成 <!-- tests N --> 注释，必须被剥掉而不是当文本解析。
const ROUND1 = `<?xml version="1.0" encoding="utf-8"?>
<testsuites>
	<testsuite name="root" tests="4" failures="1" skipped="1" timestamp="2026-11-16T00:00:00.000Z" hostname="ci">
		<testcase name="stable pass" time="0.001000" classname="test" file="/repo/src/main/foo.test.js"/>
		<testcase name="wobbly case" time="0.002000" classname="test" file="/repo/src/main/foo.test.js"/>
		<testcase name="always broken" time="0.003000" classname="test" file="/repo/src/main/bar.test.js" failure="expected 1 to equal 2">
			<failure type="testFailure" message="expected 1 to equal 2">AssertionError: expected 1 to equal 2</failure>
		</testcase>
		<testcase name="env gated" time="0.000000" classname="test" file="/repo/src/main/bar.test.js">
			<skipped type="skipped" message="missing artifact"/>
		</testcase>
	</testsuite>
	<!-- tests 4 -->
	<!-- pass 2 -->
	<!-- fail 1 -->
	<!-- skipped 1 -->
</testsuites>
`;

const ROUND2 = `<?xml version="1.0" encoding="utf-8"?>
<testsuites>
	<testsuite name="root" tests="4" failures="2" skipped="1" timestamp="2026-11-16T01:00:00.000Z" hostname="ci">
		<testcase name="stable pass" time="0.001000" classname="test" file="/repo/src/main/foo.test.js"/>
		<testcase name="wobbly case" time="0.002100" classname="test" file="/repo/src/main/foo.test.js" failure="socket hang up">
			<failure type="testFailure" message="socket hang up">Error: socket hang up</failure>
		</testcase>
		<testcase name="always broken" time="0.003000" classname="test" file="/repo/src/main/bar.test.js" failure="expected 1 to equal 2">
			<failure type="testFailure" message="expected 1 to equal 2">AssertionError: expected 1 to equal 2</failure>
		</testcase>
		<testcase name="env gated" time="0.000000" classname="test" file="/repo/src/main/bar.test.js">
			<skipped type="skipped" message="missing artifact"/>
		</testcase>
	</testsuite>
	<!-- tests 4 -->
	<!-- pass 1 -->
	<!-- fail 2 -->
	<!-- skipped 1 -->
</testsuites>
`;

const key = (file, name, classname = 'test') => file + '\0' + classname + '\0' + name;

test('parseJunitResults reads statuses, files and failure messages', () => {
  const results = parseJunitResults(ROUND2);
  const at = name => results.get(key('/repo/src/main/foo.test.js', name));
  assert.equal(at('stable pass').status, 'pass');
  assert.equal(at('wobbly case').status, 'fail');
  assert.equal(at('wobbly case').message, 'socket hang up');
  const bar = results.get(key('/repo/src/main/bar.test.js', 'env gated'));
  assert.equal(bar.status, 'skip');
  assert.equal(results.size, 4);
});

test('analyzeRounds separates flaky, persistent and clean cases', () => {
  const { flaky, failed, totalRounds } = analyzeRounds([parseJunitResults(ROUND1), parseJunitResults(ROUND2)]);
  assert.equal(totalRounds, 2);
  assert.equal(flaky.length, 1);
  assert.equal(flaky[0].name, 'wobbly case');
  assert.deepEqual(flaky[0].failedRounds, [2]);
  assert.equal(flaky[0].statuses[0], 'pass');
  assert.equal(failed.length, 1);
  assert.equal(failed[0].name, 'always broken');
  assert.deepEqual(failed[0].failedRounds, [1, 2]);
});

test('skipped rounds never count as pass or fail', () => {
  const run = statuses => statuses.map(status => new Map([[key('f', 'c'), { file: 'f', classname: 'test', name: 'c', status, message: '' }]]));
  // skip + fail：从未通过，不算间歇。
  const { flaky, failed } = analyzeRounds(run(['skip', 'fail', 'skip']));
  assert.equal(flaky.length, 0);
  assert.equal(failed.length, 1);
  assert.deepEqual(failed[0].failedRounds, [2]);
  // skip + pass：没有失败，不进清单。
  const clean = analyzeRounds(run(['skip', 'pass', 'pass']));
  assert.equal(clean.flaky.length, 0);
  assert.equal(clean.failed.length, 0);
  // 只在某一轮出现过的失败也算：absent 不抵销 fail。
  const partial = analyzeRounds([new Map(), parseJunitResults(ROUND2)]);
  assert.equal(partial.flaky.length, 0);
  assert.equal(partial.failed.some(row => row.name === 'wobbly case'), true);
});

test('renderMarkdown lists flaky cases with failed-round counts', () => {
  const analysis = analyzeRounds([parseJunitResults(ROUND1), parseJunitResults(ROUND2), parseJunitResults(ROUND1)]);
  const markdown = renderMarkdown(analysis, { cwd: '/repo' });
  assert.match(markdown, /3 轮/);
  assert.match(markdown, /src\/main\/foo\.test\.js/);
  assert.match(markdown, /wobbly case/);
  assert.match(markdown, /2 \/ 3/);
  assert.match(markdown, /always broken/);
  assert.match(markdown, /1, 2, 3 \/ 3/);
  const allPass = '<testsuites><testcase name="ok" time="0" classname="test" file="/repo/x.test.js"/></testsuites>';
  const clean = renderMarkdown(analyzeRounds([parseJunitResults(allPass), parseJunitResults(allPass)]));
  assert.match(clean, /未发现不稳定用例/);
});

test('decodeXmlEntities restores attribute escapes without double decoding', () => {
  assert.equal(decodeXmlEntities('a &amp; b &lt; c &quot;d&quot;'), 'a & b < c "d"');
  assert.equal(decodeXmlEntities('&#45;45 &#10; &#x41;'), '-45 \n A');
  assert.equal(decodeXmlEntities('&amp;lt;'), '&lt;');
});

test('parseJunitResults decodes escaped names and attributes', () => {
  const xml = '<testsuites><testcase name="a &amp; &#45; b" time="0" classname="test" file="/repo/x.test.js" failure="boom&#10;trace"><failure type="t" message="boom&#10;trace"/></testcase></testsuites>';
  const row = parseJunitResults(xml).get(key('/repo/x.test.js', 'a & - b'));
  assert.equal(row.status, 'fail');
  assert.equal(row.message, 'boom');
});

test('sortRoundLogs orders by the last digit run in the basename', () => {
  const sorted = sortRoundLogs(['logs/round-10.xml', 'logs/round-2.xml', 'logs/round-1.xml']);
  assert.deepEqual(sorted, ['logs/round-1.xml', 'logs/round-2.xml', 'logs/round-10.xml']);
});

test('testGlobs derives the npm test glob list', () => {
  const real = testGlobs();
  assert.ok(real.length > 0);
  assert.ok(real.every(glob => !glob.startsWith('-')));
  assert.deepEqual(testGlobs({ scripts: { test: 'node scripts/run-tests.mjs "a/**/*.test.js" "b/*.test.mjs"' } }), ['a/**/*.test.js', 'b/*.test.mjs']);
  assert.deepEqual(testGlobs({ scripts: { test: 'node --test "a/**/*.test.js" "b/*.test.mjs"' } }), ['a/**/*.test.js', 'b/*.test.mjs']);
  assert.throws(() => testGlobs({ scripts: { test: 'vitest run' } }), /run-tests\.mjs/);
  assert.throws(() => testGlobs({ scripts: { test: 'node scripts/run-tests.mjs' } }), /glob/);
});

// Exercise the actual Node reporter, not only hand-written XML fixtures.
test('collector preserves real nested suite results and process failure', async () => {
  const { mkdtempSync, readFileSync, rmSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { collectRound } = await import('./flaky-report.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'whale-flaky-reporter-'));
  const testContext = process.env.NODE_TEST_CONTEXT;
  delete process.env.NODE_TEST_CONTEXT;
  try {
    const fixture = join(dir, 'case.test.mjs');
    const output = join(dir, 'result.xml');
    writeFileSync(fixture, `import { describe, it } from 'node:test';
      describe('outer', () => {
        it('pass', () => {});
        it('fail', () => { throw new Error('failure marker'); });
        it.skip('skip', () => {});
      });`);
    assert.equal(collectRound(output, [fixture]), 1);
    const rows = [...parseJunitResults(readFileSync(output, 'utf8')).values()];
    assert.equal(rows.find(row => row.name === 'pass').status, 'pass');
    assert.equal(rows.find(row => row.name === 'fail').status, 'fail');
    assert.equal(rows.find(row => row.name === 'skip').status, 'skip');
    assert.match(rows.find(row => row.name === 'fail').message, /failure marker/);
    assert.equal(collectRound(join(dir, 'missing.xml'), [join(dir, 'missing.test.mjs')]), 1);
  } finally {
    if (testContext !== undefined) process.env.NODE_TEST_CONTEXT = testContext;
    rmSync(dir, { recursive: true, force: true });
  }
});
