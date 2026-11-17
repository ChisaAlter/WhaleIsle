import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeFixture } from './lib/fixture.mjs';
import { parseDiagnostics, diffCounts, objectToCounts, countsToObject } from './typecheck.mjs';

const SCRIPT = fileURLToPath(new URL('./typecheck.mjs', import.meta.url));
const CLEAN_JS = '/** @param {number} a */\nfunction f(a) { return a + 1 }\n';
const ERROR_JS = 'function f(a) { return a + 1 }\n';
const TSCONFIG = JSON.stringify({
  compilerOptions: { allowJs: true, checkJs: true, strict: true, noEmit: true, types: [] },
  files: ['a.js', 'b.js'],
});

function run(project, baseline, extra = []) {
  return spawnSync(process.execPath, [SCRIPT, '--project', project, '--baseline', baseline, ...extra], {
    encoding: 'utf8',
  });
}

function fixture(t, files) {
  const root = makeFixture(t, files);
  return { project: join(root, 'tsconfig.json'), baseline: join(root, 'baseline.json') };
}

test('解析 tsc 诊断成文件+错误码+消息计数，配置级错误单独归类', () => {
  const text = [
    'src/a.js(3,10): error TS7006: Parameter \'x\' implicitly has an \'any\' type.',
    'src/a.js(4,10): error TS7006: Parameter \'x\' implicitly has an \'any\' type.',
    'src\\b.js(1,1): error TS2304: Cannot find name \'y\'.',
    'error TS5058: The specified path does not exist.',
    '  continuation line is ignored',
  ].join('\n');
  const { counts, globals } = parseDiagnostics(text);
  assert.equal(counts.get('src/a.js').get('TS7006').get("Parameter 'x' implicitly has an 'any' type."), 2);
  assert.equal(counts.get('src/b.js').get('TS2304').get("Cannot find name 'y'."), 1);
  assert.deepEqual(globals, ['TS5058: The specified path does not exist.']);
});

test('diff 区分新增与减少，双向都视为偏差', () => {
  const { counts: current } = parseDiagnostics(
    'a.js(1,1): error TS7006: Parameter \'x\' implicitly has an \'any\' type.\n'
  );
  const baseline = objectToCounts(countsToObject(parseDiagnostics(
    'a.js(1,1): error TS7006: Parameter \'x\' implicitly has an \'any\' type.\n' +
    'b.js(2,2): error TS2304: Cannot find name \'y\'.\n'
  ).counts));
  const { newer, fewer } = diffCounts(current, baseline);
  assert.deepEqual(newer, []);
  assert.equal(fewer.length, 1);
  assert.match(fewer[0], /b\.js TS2304 x1->0/);
  assert.deepEqual(diffCounts(baseline, current).newer.length, 1);
});

test('update-baseline 生成基线后默认运行通过；新增错误失败', (t) => {
  const { project, baseline } = fixture(t, { 'tsconfig.json': TSCONFIG, 'a.js': CLEAN_JS, 'b.js': ERROR_JS });
  let result = run(project, baseline);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout + result.stderr, /新诊断/);

  result = run(project, baseline, ['--update-baseline']);
  assert.equal(result.status, 0);
  assert.ok(existsSync(baseline));
  const saved = JSON.parse(readFileSync(baseline, 'utf8'));
  assert.equal(saved.errors['b.js'].TS7006["Parameter 'a' implicitly has an 'any' type."], 1);

  result = run(project, baseline);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('修复后计数低于基线同样失败，提示收紧基线', (t) => {
  const root = makeFixture(t, { 'tsconfig.json': TSCONFIG, 'a.js': CLEAN_JS, 'b.js': ERROR_JS });
  const project = join(root, 'tsconfig.json');
  const baseline = join(root, 'baseline.json');
  assert.equal(run(project, baseline, ['--update-baseline']).status, 0);

  writeFileSync(join(root, 'b.js'), CLEAN_JS);
  const result = run(project, baseline);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout + result.stderr, /--update-baseline 收紧基线/);
});

test('tsconfig 缺失等配置级错误直接失败', (t) => {
  const root = makeFixture(t, { 'a.js': CLEAN_JS });
  const result = run(join(root, 'missing.json'), join(root, 'baseline.json'));
  assert.notEqual(result.status, 0);
  assert.match(result.stdout + result.stderr, /配置级错误|未产生诊断/);
});

test('absolute repo paths in messages are replaced so the baseline is portable', () => {
  const root = '/abs/repo';
  const text = `src/main/a.js(1,1): error TS2322: Type 'typeof import("/abs/repo/src/main/b")' is not assignable to type 'never'.`;
  const { counts } = parseDiagnostics(text, root);
  const messages = [...counts.get('src/main/a.js').get('TS2322').keys()];
  assert.deepEqual(messages, [`Type 'typeof import("<root>/src/main/b")' is not assignable to type 'never'.`]);
});
