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

test('the eight-row analysis reference graph materializes once per expression without enlarging budgets', () => {
  // Reduced from the emitted store comparison: four KPIs reuse the same range and row expressions.
  const program = `root = Col([${Array.from({ length: 18 }, () => 'Text([combRev,combProfit,combMargin,combAOV])').join(',')}])
$he = true
$jn = true
$fw = "第 1 周"
$ew = "第 4 周"
fwNum = $fw == "第 1 周" ? 1 : ($fw == "第 2 周" ? 2 : ($fw == "第 3 周" ? 3 : 4))
ewNum = $ew == "第 1 周" ? 1 : ($ew == "第 2 周" ? 2 : ($ew == "第 3 周" ? 3 : 4))
start = @Min([fwNum, ewNum])
end = @Max([fwNum, ewNum])
data = [{w:1,s:"H",r:12000,c:8400,o:200},{w:1,s:"J",r:10000,c:7600,o:160},{w:2,s:"H",r:13500,c:9200,o:225},{w:2,s:"J",r:11000,c:8000,o:175},{w:3,s:"H",r:12800,c:9000,o:205},{w:3,s:"J",r:15000,c:10200,o:230},{w:4,s:"H",r:16000,c:11000,o:250},{w:4,s:"J",r:14500,c:10000,o:220}]
rangeRows = @Filter(@Filter(data,"w",">=",start),"w","<=",end)
rowsH = @Filter(rangeRows,"s","==","H")
rowsJ = @Filter(rangeRows,"s","==","J")
revH = @Sum(rowsH.r)
costH = @Sum(rowsH.c)
profitH = revH - costH
ordersH = @Sum(rowsH.o)
revJ = @Sum(rowsJ.r)
costJ = @Sum(rowsJ.c)
profitJ = revJ - costJ
ordersJ = @Sum(rowsJ.o)
combRev = ($he ? revH : 0) + ($jn ? revJ : 0)
combProfit = ($he ? profitH : 0) + ($jn ? profitJ : 0)
combOrders = ($he ? ordersH : 0) + ($jn ? ordersJ : 0)
combMargin = combRev > 0 ? combProfit / combRev * 100 : 0
combAOV = combOrders > 0 ? combRev / combOrders : 0`;
  const result = parser.parse(program);
  assert.deepEqual(result.meta.errors, []);
  assert.deepEqual(result.meta.orphaned, []);
  const store = core.createStore(); store.initialize(result.stateDeclarations, {});
  const evalContext = { library, store, ctx: { getState: store.get, resolveRef: () => null } };
  const evaluated = core.evaluateRoot(result, evalContext);
  assert.equal(evaluated.props.children.length, 18);
  for (const child of evaluated.props.children) assert.deepEqual(child.props.value, [104800, 31400, 31400 / 104800 * 100, 104800 / 1665]);
  store.set('$he', false); store.set('$fw', '第 3 周');
  const changed = core.evaluateRoot(result, evalContext);
  for (const child of changed.props.children) assert.deepEqual(child.props.value, [29500, 9300, 9300 / 29500 * 100, 29500 / 450]);
});

test('shared expression normalization preserves component value lowering, lexical Each scopes and cycles', () => {
  const mixed = parser.parse('root = Col([Text($show ? panel : panel),panel])\npanel = Text("child")\n$show = true');
  assert.deepEqual(mixed.meta.errors, []);
  assert.equal(mixed.root.props.children[1].typeName, 'Text');
  assert.equal(mixed.root.props.children[1].statementId, 'panel');
  const scoped = parser.parse('root = Col([Text(item),Text(@Each([1,2],"item",item+shared)),Text(@Each([3,4],"item",item+shared))])\nitem = 100\nshared = $n+1\n$n = 4');
  assert.deepEqual(scoped.meta.errors, []);
  assert.deepEqual(scoped.meta.orphaned, []);
  const store = core.createStore(); store.initialize(scoped.stateDeclarations, {});
  const output = core.evaluateRoot(scoped, { library, store, ctx: { getState: store.get, resolveRef: () => null } });
  assert.deepEqual(output.props.children.map(child => child.props.value), [100, [6,7], [8,9]]);
  const circular = parser.parse('root = Col([Text(a),Text(a)])\na = b+1\nb = a+1');
  assert.ok(circular.meta.errors.some(error => error.code === 'unresolved-reference'));
  const stream = core.createStreamingParser(library.toJSONSchema(), 'Col');
  stream.set('root = Col([Text(a),Text(a)])\na = $n+1\n$n = 1', true);
  const replaced = stream.set('root = Col([Text(a),Text(a)])\na = $n+2\n$n = 1', true);
  store.initialize(replaced.stateDeclarations, {});
  assert.deepEqual(core.evaluateRoot(replaced, { library, store, ctx: { getState: store.get, resolveRef: () => null } }).props.children.map(child => child.props.value), [3,3]);
});

test('shared expressions keep random calls per consumer and do not evaluate inactive runtime branches', () => {
  let draws = 0;
  const Draw = core.defineFunction({ name: 'Random', description: 'Count random evaluations', params: z.object({}), returns: z.number(), fn: () => ++draws });
  const localLibrary = core.createLibrary({ root: 'Col', components: [Col, Text], functions: [Draw] });
  const result = core.createParser(localLibrary.toJSONSchema(), 'Col').parse('root = Col([Text(draw),Text(draw),Text($active?draw:0)])\ndraw = @Random()\n$active = false');
  assert.deepEqual(result.meta.errors, []);
  const store = core.createStore(); store.initialize(result.stateDeclarations, {});
  const functions = { Random: { ...localLibrary.toJSONSchema().functions.Random, fn: Draw.fn } };
  const evaluated = core.evaluateRoot(result, { library: localLibrary, store, ctx: { getState: store.get, resolveRef: () => null, functions } });
  assert.deepEqual(evaluated.props.children.map(child => child.props.value), [1,2,0]);
  assert.equal(draws, 2);
});

test('repeated eight-row aggregates and nested Each retain a single bounded calculation pass', () => {
  // Reduced from the first rejected analysis: every output reuses enriched rows and per-store changes.
  const result = parser.parse(`root = Col([${Array.from({ length: 16 }, () => 'Text([@Sum(rows.revenue),@Sum(rows.cost),stats])').join(',')}])
$start = 1
$end = 4
$he = true
$jn = true
records = [{week:1,store:"H",revenue:12000,cost:8400},{week:1,store:"J",revenue:10000,cost:7600},{week:2,store:"H",revenue:13500,cost:9200},{week:2,store:"J",revenue:11000,cost:8000},{week:3,store:"H",revenue:12800,cost:9000},{week:3,store:"J",revenue:15000,cost:10200},{week:4,store:"H",revenue:16000,cost:11000},{week:4,store:"J",revenue:14500,cost:10000}]
enriched = @Each(records,"r",{week:r.week,store:r.store,revenue:r.revenue,cost:r.cost,profit:r.revenue-r.cost,margin:(r.revenue-r.cost)/r.revenue*100,selected:r.store=="H"?$he:$jn})
rows = @Sort(@Filter(@Filter(@Filter(enriched,"week",">=",$start),"week","<=",$end),"selected","==",true),"week","asc")
changes = @Each(@Filter(rows,"week",">",$start),"r",{store:r.store,profit:r.profit,rate:r.revenue/@First(@Filter(@Filter(rows,"store","==",r.store),"week","==",r.week-1)).revenue-1})
stats = @Each(["H","J"],"s",{store:s,revenue:@Sum(@Filter(rows,"store","==",s).revenue),cost:@Sum(@Filter(rows,"store","==",s).cost),rates:@Filter(changes,"store","==",s).rate})`);
  assert.deepEqual(result.meta.errors, []);
  const store = core.createStore(); store.initialize(result.stateDeclarations, {});
  const reads = {}, ctx = { getState: name => { reads[name] = (reads[name] ?? 0) + 1; return store.get(name); }, resolveRef: () => null };
  let evaluated = core.evaluateRoot(result, { library, store, ctx });
  for (const child of evaluated.props.children) {
    assert.deepEqual(child.props.value.slice(0, 2), [104800,73400]);
    assert.deepEqual(child.props.value[2].map(row => [row.store,row.revenue,row.cost]), [['H',54300,37600],['J',50500,35800]]);
    assert.equal(child.props.value[2][0].rates.length, 3);
  }
  assert.ok(reads.$he <= 2 && reads.$jn <= 2, JSON.stringify(reads));
  store.set('$he', false); store.set('$start', 3);
  evaluated = core.evaluateRoot(result, { library, store, ctx });
  for (const child of evaluated.props.children) assert.deepEqual(child.props.value.slice(0, 2), [29500,20200]);
  const shadowed = core.parseExpression(core.tokenize('@Each([1,2],"x",@Each([x,x+1],"x",x))'));
  assert.deepEqual(core.evaluate(shadowed, ctx), [[1,2],[2,3]]);
});

test('only opted-in pure functions reuse results; volatile calls, mutations and diagnostics remain observable', () => {
  let pureCalls = 0, reads = 0, state = 4;
  const pure = core.defineFunction({ name: 'Square', description: 'Pure calculation', pure: true, params: z.object({ n: z.number() }), returns: z.number(), fn: ({n}) => { pureCalls++; return n*n; } });
  const effect = core.defineFunction({ name: 'Effect', description: 'Effect with no purity opt-in', params: z.object({}), returns: z.number(), fn: () => ++state });
  const failure = core.defineFunction({ name: 'Failure', description: 'Reports failures', pure: true, params: z.object({ n: z.number() }), returns: z.number(), fn: () => { throw new Error('expected failure'); } });
  const wrong = core.defineFunction({ name: 'WrongReturn', description: 'Invalid return', pure: true, params: z.object({ n: z.number() }), returns: z.number(), fn: () => 'invalid' });
  const mutate = core.defineFunction({ name: 'Mutate', description: 'Mutate argument', params: z.object({ items: z.array(z.number()) }), returns: z.number(), fn: ({items}) => { items[0]++; return items[0]; } });
  const local = core.createLibrary({ root: 'Col', components: [Col, Text], functions: [pure,effect,failure,wrong,mutate] }), schema = local.toJSONSchema();
  assert.equal(schema.functions.Square.pure, true); assert.equal(schema.functions.Effect.pure, undefined);
  const functions = Object.fromEntries(Object.entries(local.functions).map(([name,def]) => [name,{...schema.functions[name],fn:def.fn}]));
  const ctx = { getState: () => { reads++; return state; }, resolveRef: () => null, functions };
  const source = core.createParser(schema,'Col').parse('root = Col([Text(square),Text(square),Text(effect),Text(square)])\nsquare=@Square($n)\neffect=@Effect()\n$n=4');
  let output = core.evaluateRoot(source,{library:local,store:null,ctx});
  assert.deepEqual(output.props.children.map(child=>child.props.value),[16,16,5,25]);
  assert.equal(pureCalls,2); assert.equal(reads,2);
  output = core.evaluateRoot(source,{library:local,store:null,ctx});
  assert.deepEqual(output.props.children.map(child=>child.props.value),[25,25,6,36]);
  assert.equal(pureCalls,4);
  const mutated = core.createParser(schema,'Col').parse('root=Col([Text(@Mutate(values)),Text(@Mutate(values)),Text(values)])\nvalues=[$n+0]');
  assert.deepEqual(core.evaluateRoot(mutated,{library:local,store:null,ctx}).props.children.map(child=>child.props.value),[7,7,[6]]);
  const invalid = core.createParser(schema,'Col').parse('root=Col([Text(failed+1),Text(failed+1),Text(wrong),Text(wrong)])\nfailed=@Failure($n)\nwrong=@WrongReturn($n)');
  const errors=[]; core.evaluateRoot(invalid,{library:local,store:null,ctx,errors});
  assert.equal(errors.length,4); assert.equal(errors.filter(e=>e.message.includes('expected failure')).length,2);
  const counters = { Random:0, Pick:0, Shuffle:0, Now:0, Today:0 };
  const volatile = Object.keys(counters).map(name=>core.defineFunction({name,description:'Volatile',params:z.object({}),returns:z.number(),fn:()=>++counters[name]}));
  const randomLibrary=core.createLibrary({root:'Col',components:[Col,Text],functions:volatile}), randomSchema=randomLibrary.toJSONSchema();
  const randomSource=core.createParser(randomSchema,'Col').parse('root=Col([Text([draw,draw,pick,pick,shuffle,shuffle,now,now,today,today])])\ndraw=@Random()+10\npick=@Pick()\nshuffle=@Shuffle()\nnow=@Now()\ntoday=@Today()');
  const randomCtx={...ctx,functions:Object.fromEntries(volatile.map(def=>[def.name,{...randomSchema.functions[def.name],fn:def.fn}]))};
  for(let i=0;i<2;i++)core.evaluateRoot(randomSource,{library:randomLibrary,store:null,ctx:randomCtx});
  assert.deepEqual(counters,{Random:4,Pick:4,Shuffle:4,Now:4,Today:4});
  const extra = core.parseExpression(core.tokenize('$value+1'));
  assert.equal(core.evaluate(extra,{...ctx,extraScope:{$value:2}}),3);
  assert.equal(core.evaluate(extra,{...ctx,extraScope:{$value:8}}),9);
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
