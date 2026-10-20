import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const bundled = await build({ entryPoints: [path.join(root, 'language/index.ts')], bundle: true, write: false, format: 'cjs', platform: 'node', target: 'node22', packages: 'external', logLevel: 'silent' });
const Module = require('node:module');
const mod = new Module(path.join(root, 'tests/language-runtime.generated.cjs'));
mod.filename = path.join(root, 'tests/language-runtime.generated.cjs');
mod.paths = Module._nodeModulePaths(root);
mod._compile(bundled.outputFiles[0].text, mod.filename);
const core = mod.exports;
const { z } = require('zod/v4');
const Col = core.defineComponent({ name: 'Col', description: 'Column', props: z.object({ children: z.array(z.any()) }), component: null });
const Text = core.defineComponent({ name: 'Text', description: 'Text', props: z.object({ value: z.any() }), component: null });
const NumberOnly = core.defineComponent({ name: 'NumberOnly', description: 'Number', props: z.object({ count: z.number(), mode: z.enum(['small', 'large']).optional(), union: z.union([z.string(), z.number()]).optional() }), component: null });
const Copy = core.defineAction({ name: 'Copy', params: z.object({ text: z.string() }) });
const library = core.createLibrary({ root: 'Col', components: [Col, Text, NumberOnly], actions: [Copy] });
const parser = core.createParser(library.toJSONSchema(), 'Col');

test('Unicode identifiers and quoted arbitrary object keys round-trip through owned TS', () => {
  const result = parser.parse('root = Col([Text(财务), Text($金额.收入)])\n财务 = {收入:1,成本:2,"space key":3,"true":4,"__proto__":5}\n$金额 = {收入:7}');
  assert.deepEqual(result.meta.errors, []);
  assert.deepEqual(result.root.props.children[0].props.value, { 收入: 1, 成本: 2, 'space key': 3, true: 4, ['__proto__']: 5 });
  const serialized = core.jsonToOpenUI(result.root, library, { stateDeclarations: result.stateDeclarations });
  assert.match(serialized, /"收入": 1/);
  const reparsed = parser.parse(serialized);
  assert.deepEqual(reparsed.meta.errors, []);
  assert.deepEqual(reparsed.root, result.root);
});

test('stream preview and settled incomplete/unresolved diagnostics differ', () => {
  const stream = core.createStreamingParser(library.toJSONSchema(), 'Col');
  const preview = stream.set('root = Col([Text("unfinished', false);
  assert.equal(preview.meta.incomplete, true);
  assert.ok(!preview.meta.errors.some(error => error.code === 'incomplete-input'));
  const finished = stream.getResult(true);
  assert.ok(finished.meta.errors.some(error => error.code === 'incomplete-input'));
  const missing = stream.set('root = Col([ready, missing])\nready = Text("Ready")', true);
  assert.ok(missing.root);
  assert.ok(missing.meta.errors.some(error => error.code === 'unresolved-reference' && error.statementId === 'missing'));
  assert.ok(parser.parse('').meta.errors.some(error => error.code === 'no-root'));
});

test('nonliteral state defaults are diagnosed, never stored as AST', () => {
  const result = parser.parse('root = Col([Text($n)])\n$n = 1 + 2');
  assert.equal(result.stateDeclarations.$n, null);
  assert.ok(result.meta.errors.some(error => error.code === 'invalid-state-default' && error.statementId === '$n'));
});

test('bounded AST depth and reference expansion fail with structured budget diagnostics', () => {
  const deep = parser.parse('root = Col([Text(' + '['.repeat(100) + '1' + ']'.repeat(100) + ')])');
  assert.ok(deep.meta.errors.some(error => error.code === 'budget-exceeded'));
  const chain = ['root = Col([n14])', 'n0 = Text("leaf")'];
  for (let i = 1; i <= 14; i++) chain.push(`n${i} = Col([n${i - 1},n${i - 1}])`);
  const expanded = parser.parse(chain.join('\n'));
  assert.equal(expanded.root, null);
  assert.ok(expanded.meta.errors.some(error => error.code === 'budget-exceeded'));
});

test('nested runtime collection evaluation shares a bounded step budget', () => {
  const ast = core.parseExpression(core.tokenize('@Each($items,"x",@Each($items,"y",x+y))'));
  assert.throws(() => core.evaluate(ast, { getState: () => Array.from({ length: 200 }, (_, i) => i), resolveRef: () => null }), error => error.code === 'budget-exceeded' && error.phase === 'evaluation');
});

test('store rejects bounded oversize updates atomically and preserves pristine defaults', () => {
  const store = core.createStore();
  store.initialize({ $n: 1 }, {});
  store.set('$n', 2);
  assert.throws(() => store.set('$large', 'x'.repeat(core.DEFAULT_LIMITS.stateChars + 1)), /budget exceeded/);
  assert.equal(store.get('$n'), 2);
  assert.equal(store.get('$large'), undefined);
  assert.throws(() => store.initialize({}, Object.fromEntries(Array.from({ length: 1001 }, (_, i) => [`$k${i}`, i]))), /state keys/);
  assert.equal(Object.keys(store.getSnapshot()).length, 1);
  store.set('$n', 1, { pristine: true });
  store.initialize({ $n: 3 }, {});
  assert.equal(store.get('$n'), 3);
});

test('runtime schema validation catches dynamic number and enum mismatches', () => {
  const result = parser.parse('root = Col([NumberOnly($count,$mode,$union)])\n$count = "wrong"\n$mode = "bad"\n$union = false');
  assert.deepEqual(result.meta.errors, []);
  const store = core.createStore(); store.initialize(result.stateDeclarations, {});
  const errors = [];
  const evaluated = core.evaluateRoot(result, { library, store, errors, ctx: { getState: store.get, resolveRef: () => null } });
  assert.ok(evaluated);
  assert.ok(errors.some(error => error.code === 'type-mismatch' && error.path === '/count'));
  assert.ok(errors.some(error => error.code === 'type-mismatch' && error.path === '/mode'));
  assert.ok(errors.some(error => error.code === 'type-mismatch' && error.path === '/union'));
});

test('reactive assignments preserve explicit null values', () => {
  const value = core.evaluate({ k: 'StateRef', n: '$value' }, { getState: () => 42, resolveRef: () => null, extraScope: { $value: null } });
  assert.equal(value, null);
  const field = core.resolveStateField('n', 3, null, null, () => null, () => {});
  assert.equal(field.value, null);
  const schema = z.string(); core.markReactive(schema);
  assert.equal(core.isReactiveSchema(schema.optional()), true);
  assert.equal(core.isReactiveSchema(schema.nullable().default('first')), true);
});

test('custom and built-in action arguments remain lazy until each step resolves', () => {
  const plan = core.evaluate(core.parseExpression(core.tokenize('Action([@Set($n,$n+1),@Copy($n+""),@ToAssistant($n+"",{value:$n})])')), { getState: () => 1, resolveRef: () => null, actions: library.toJSONSchema().actions });
  let n = 4;
  const ctx = { getState: () => n, resolveRef: () => null, actions: library.toJSONSchema().actions };
  const set = core.resolveActionStep(plan.steps[0], ctx);
  n = core.evaluate(set.valueAST, ctx);
  const copy = core.resolveActionStep(plan.steps[1], ctx);
  assert.equal(copy.params.text, '5');
  const assistant = core.resolveActionStep(plan.steps[2], ctx);
  assert.equal(assistant.message, '5');
  assert.deepEqual(assistant.context, { value: 5 });
});
