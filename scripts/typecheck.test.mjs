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

test('tsconfig 自身带行列号的配置诊断（如 TS5101）同样作为配置级错误失败，不能被范围过滤吞掉', (t) => {
  const { project, baseline } = fixture(t, {
    'tsconfig.json': JSON.stringify({
      compilerOptions: { allowJs: true, checkJs: true, strict: true, noEmit: true, types: [], baseUrl: '.' },
      files: ['a.js'],
    }),
    'a.js': CLEAN_JS,
  });
  const result = run(project, baseline);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout + result.stderr, /配置级错误/);
  assert.match(result.stdout + result.stderr, /TS5101/);
});

test('extends 继承链上的父 tsconfig 配置错误与语法错误同样作为配置级错误失败', (t) => {
  const root = makeFixture(t, {
    'root.json': JSON.stringify({ compilerOptions: { bogusOption: true } }),
    'sub/mid.json': JSON.stringify({
      extends: '../root.json',
      compilerOptions: { allowJs: true, checkJs: true, strict: true, noEmit: true, types: [] },
    }),
    'sub/tsconfig.json': JSON.stringify({ extends: './mid', files: ['a.js'] }),
    'sub/a.js': CLEAN_JS,
  });
  const baseline = join(root, 'baseline.json');
  writeFileSync(baseline, JSON.stringify({ version: 1, errors: {} }));
  const badOpt = run(join(root, 'sub/tsconfig.json'), baseline);
  assert.notEqual(badOpt.status, 0);
  assert.match(badOpt.stdout + badOpt.stderr, /配置级错误/);
  assert.match(badOpt.stdout + badOpt.stderr, /TS5023/);

  const syntaxRoot = makeFixture(t, {
    'base.json': '{ "compilerOptions": { "strict": true, } bad',
    'tsconfig.json': JSON.stringify({
      extends: './base.json',
      compilerOptions: { allowJs: true, checkJs: true, strict: true, noEmit: true, types: [] },
      files: ['a.js'],
    }),
    'a.js': CLEAN_JS,
  });
  const syntaxBaseline = join(syntaxRoot, 'baseline.json');
  writeFileSync(syntaxBaseline, JSON.stringify({ version: 1, errors: {} }));
  const badSyntax = run(join(syntaxRoot, 'tsconfig.json'), syntaxBaseline);
  assert.notEqual(badSyntax.status, 0);
  assert.match(badSyntax.stdout + badSyntax.stderr, /配置级错误/);
  assert.match(badSyntax.stdout + badSyntax.stderr, /TS1005/);

  const rootSyntax = makeFixture(t, {
    'tsconfig.json': '{ "compilerOptions": { "allowJs": true } bad',
    'a.js': CLEAN_JS,
  });
  const rootSyntaxBaseline = join(rootSyntax, 'baseline.json');
  writeFileSync(rootSyntaxBaseline, JSON.stringify({ version: 1, errors: {} }));
  const badRoot = run(join(rootSyntax, 'tsconfig.json'), rootSyntaxBaseline);
  assert.notEqual(badRoot.status, 0);
  assert.match(badRoot.stdout + badRoot.stderr, /配置级错误/);
  assert.match(badRoot.stdout + badRoot.stderr, /TS1005/);
});

test('--project 指向目录时解析目录下的 tsconfig.json，不吞掉配置错误和源码诊断', (t) => {
  const cfgRoot = makeFixture(t, {
    'sub/tsconfig.json': JSON.stringify({
      compilerOptions: { allowJs: true, checkJs: true, strict: true, noEmit: true, types: [], baseUrl: '.' },
      files: ['a.js'],
    }),
    'sub/a.js': CLEAN_JS,
  });
  const cfgBaseline = join(cfgRoot, 'baseline.json');
  writeFileSync(cfgBaseline, JSON.stringify({ version: 1, errors: {} }));
  const cfgResult = run(join(cfgRoot, 'sub'), cfgBaseline);
  assert.notEqual(cfgResult.status, 0);
  assert.match(cfgResult.stdout + cfgResult.stderr, /配置级错误/);
  assert.match(cfgResult.stdout + cfgResult.stderr, /TS5101/);

  const srcRoot = makeFixture(t, {
    'sub/tsconfig.json': JSON.stringify({
      compilerOptions: { allowJs: true, checkJs: true, strict: true, noEmit: true, types: [] },
      files: ['a.js'],
    }),
    'sub/a.js': ERROR_JS,
  });
  const srcBaseline = join(srcRoot, 'baseline.json');
  writeFileSync(srcBaseline, JSON.stringify({ version: 1, errors: {} }));
  const srcResult = run(join(srcRoot, 'sub'), srcBaseline);
  assert.notEqual(srcResult.status, 0);
  assert.match(srcResult.stdout + srcResult.stderr, /新诊断/);
  assert.match(srcResult.stdout + srcResult.stderr, /TS7006/);
});

test('absolute repo paths in messages are replaced so the baseline is portable', () => {
  const root = '/abs/repo';
  const text = `src/main/a.js(1,1): error TS2322: Type 'typeof import("/abs/repo/src/main/b")' is not assignable to type 'never'.`;
  const { counts } = parseDiagnostics(text, root);
  const messages = [...counts.get('src/main/a.js').get('TS2322').keys()];
  assert.deepEqual(messages, [`Type 'typeof import("<root>/src/main/b")' is not assignable to type 'never'.`]);
});

test('truncated type counts are normalized so unrelated additions do not look new', () => {
  const text = `src/main/a.js(1,1): error TS2339: Property 'x' does not exist on type '{ a: string; ... 45 more ...; z: string; }'.`;
  const { counts } = parseDiagnostics(text, '/abs/repo');
  assert.deepEqual([...counts.get('src/main/a.js').get('TS2339').keys()], [`Property 'x' does not exist on type '{ a: string; ... <n> more ...; z: string; }'.`]);
});

test('node_modules paths in messages normalize to <node_modules> regardless of checkout layout', () => {
  // worktree 的 node_modules 常是指向别处的符号链接，同一诊断在不同环境
  // 出现的绝对路径不同；归一后折叠为同一条。
  const text = [
    "scripts/a.js(1,1): error TS7016: Could not find a declaration file for module 'semver'. '/work/repo/node_modules/semver/index.js' implicitly has an 'any' type.",
    "scripts/a.js(2,1): error TS7016: Could not find a declaration file for module 'semver'. '/opt/shared/real/node_modules/semver/index.js' implicitly has an 'any' type.",
    "scripts/a.js(3,1): error TS7016: Could not find a declaration file for module 'semver'. 'C:\\ci\\repo\\node_modules\\semver\\index.js' implicitly has an 'any' type.",
  ].join('\n');
  const { counts } = parseDiagnostics(text, '/work/repo');
  const byMessage = counts.get('scripts/a.js').get('TS7016');
  const messages = [...byMessage.keys()];
  assert.deepEqual(messages, ["Could not find a declaration file for module 'semver'. '<node_modules>/semver/index.js' implicitly has an 'any' type."]);
  assert.equal(byMessage.get(messages[0]), 3);
});

test('diagnostics on files pulled in via import but outside tsconfig scope are not counted', (t) => {
  const { project, baseline } = fixture(t, {
    'tsconfig.json': JSON.stringify({
      compilerOptions: { allowJs: true, checkJs: true, strict: true, noEmit: true, types: [] },
      files: ['a.js'],
    }),
    // out.js 有隐式 any 诊断，但它不在 files/include 里（只是被 import
    // 拉进程序），不计入总数——否则构建产物、node_modules 是否存在会
    // 改变基线结果。
    'a.js': "import './out.js';\nexport const ok = 1;\n",
    'out.js': ERROR_JS,
  });
  const result = run(project, baseline);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /诊断共 0 条/);
});

test('classic page programs resolve their own shared globals and keep the two pages separate', async () => {
  const { default: ts } = await import('typescript');
  for (const [page, file, symbol, other] of [
    ['pet', 'pet-live2d-animation.js', 'ctx2d', 'launcher-home.js'],
    ['launcher', 'launcher-home.js', '$', 'pet-live2d-animation.js'],
  ]) {
    const project = fileURLToPath(new URL(`../tsconfig.check.${page}.json`, import.meta.url));
    const parsed = ts.parseJsonConfigFileContent(ts.readConfigFile(project, ts.sys.readFile).config, ts.sys, fileURLToPath(new URL('../', import.meta.url)));
    const program = ts.createProgram(parsed.fileNames, parsed.options);
    const source = program.getSourceFiles().find(s => s.fileName.endsWith('/' + file));
    assert.ok(source);
    assert.ok(!program.getSourceFiles().some(s => s.fileName.endsWith('/' + other)));
    const missing = program.getSemanticDiagnostics(source).filter(d => [2304, 2592].includes(d.code) && ts.flattenDiagnosticMessageText(d.messageText, '\n').includes(`'${symbol}'`));
    assert.deepEqual(missing, [], `${page} must see its own page's shared ${symbol}`);
  }
});
