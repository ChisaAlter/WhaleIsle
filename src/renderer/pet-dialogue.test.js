'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const PetDialogue = require('./pet-dialogue.js');
const JSON_PATH = path.join(__dirname, 'dialogue', 'whale.json');

const EXPECTED_KEYS = ['greet', 'pickup', 'throw', 'land', 'pat', 'feed', 'come',
  'tease', 'angry', 'sleep', 'wake', 'sleepy', 'tap0', 'tap1', 'tap2', 'tap3',
  'morning', 'noon', 'afternoon', 'evening', 'latenight', 'idle', 'feedEat',
  'feedDone', 'arrive', 'idleRice', 'idleStandby', 'idleTail', 'idleCoding',
  'idleCare', 'feedToken', 'feedTokenEat', 'feedTokenDone', 'levelUp',
  'hungry', 'grumpy', 'clingy',
  // §B4 wander + §B10 cheap items + R2 DSH-link seeds
  'wanderStart', 'wanderEnd', 'wanderStop', 'personalitySet',
  'settingsChanged', 'settingsOpened', 'fileEat', 'dshWorking', 'dshDone', 'dshError',
  'dshRest', 'dshMilestone', 'dshMiss', 'dshApproval', 'dshQuestion',
  'chatFallback', 'looking', 'lookFallback', 'lookNoModel', 'lookAssistantOff',
  'lookError', 'approvalAllow', 'approvalReject'];

function readPreset() {
  return JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
}

function withFetchStub(impl, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      if (original === undefined) {
        delete globalThis.fetch;
      } else {
        globalThis.fetch = original;
      }
    });
}

// ── data file ──

test('whale.json keeps rich reaction pools, factual feedback categories and ≥1000 unique total', () => {
  const data = readPreset();
  assert.equal(data._meta.mode, 'whale');
  assert.equal(data._meta.version, 1);
  assert.deepEqual(Object.keys(data.global).sort(), [...EXPECTED_KEYS].sort());
  const all = [];
  for (const key of Object.keys(data.global)) {
    if (key === 'settingsOpened') assert.deepEqual(data.global[key], ['已打开桌宠设置。']);
    else assert.ok(data.global[key].length >= 10, `${key} reaction pool has ≥10 lines`);
    for (const line of data.global[key]) {
      assert.equal(typeof line, 'string');
      assert.ok(line.length > 0);
      all.push(line);
    }
  }
  // R2 quota: the library carries ≥1000 unique lines across global + the
  // three personality pools. Uniqueness is checked on the normalized text
  // (template slots stripped) so "{file}吃掉了"/"{file}吞了" still count as
  // distinct while an accidental copy-paste does not.
  const normalized = (s) => s.replace(/\{[a-z]+\}/g, '').replace(/[\s，。！？~…、·]/g, '');
  const normSet = new Set(all.map(normalized));
  assert.equal(normSet.size, all.length, 'global lines have near-duplicates');
  // Persona layers: genki/tsundere/poison cover a seed of categories; every
  // agent line must be a distinct string and non-empty. 'natural' (软萌) is
  // the global pool — it must NOT appear under agents.
  assert.deepEqual(Object.keys(data.agents).sort(), ['genki', 'poison', 'tsundere']);
  const agentAll = [];
  for (const [agent, cats] of Object.entries(data.agents)) {
    for (const [cat, lines] of Object.entries(cats)) {
      assert.ok(data.global[cat], `${agent}.${cat} has a global fallback`);
      for (const line of lines) {
        assert.equal(typeof line, 'string');
        assert.ok(line.length > 0 && line.length <= PetDialogue.MAX_LINE_CHARS);
        agentAll.push(line);
      }
    }
  }
  const everything = all.concat(agentAll);
  const normSetAll = new Set(everything.map(normalized));
  assert.equal(normSetAll.size, everything.length, 'near-duplicate lines across pools');
  assert.ok(everything.length >= 1000, `dialogue library ≥1000 lines (got ${everything.length})`);
  assert.deepEqual([...data.idleTopics].sort(),
    ['idle', 'idleCare', 'idleCoding', 'idleRice', 'idleStandby', 'idleTail'].sort());
  assert.deepEqual(data.timeOfDay, {
    latenight: [23, 6], morning: [6, 11], noon: [11, 14],
    afternoon: [14, 18], evening: [18, 23],
  });
});

test('settingsOpened acknowledges the actual navigation with one factual line', () => {
  const data = readPreset();
  assert.deepEqual(data.global.settingsOpened, ['已打开桌宠设置。']);
  const say = PetDialogue.createSayer(data);
  assert.equal(say('settingsOpened'), '已打开桌宠设置。');
});

test('whale.json lines respect the length cap and carry no template slots', () => {
  const data = readPreset();
  // Template categories: {field} placeholders are filled by the say() call
  // site (file name, token milestone, approval summary). Everywhere else
  // built-in lines are literal — {field} belongs to user overrides.
  const TEMPLATE_KEYS = new Set(['fileEat', 'dshMilestone', 'dshApproval',
    'dshQuestion', 'dshRest', 'dshMiss', 'lookError']);
  let checked = 0;
  for (const key of Object.keys(data.global)) {
    for (const line of data.global[key]) {
      assert.ok(line.length <= PetDialogue.MAX_LINE_CHARS, `${key} line too long`);
      if (!TEMPLATE_KEYS.has(key)) {
        assert.ok(!/\{[^}]*\}/.test(line), `${key} unexpected placeholder: ${line}`);
      }
      checked += 1;
    }
  }
  assert.ok(checked >= 590);
});

// ── load() ──

test('load() fetches, validates and returns the store', async () => {
  const data = readPreset();
  await withFetchStub(async (url) => {
    assert.ok(url.endsWith('dialogue/whale.json'), `url ${url}`);
    return { ok: true, json: async () => data };
  }, async () => {
    const store = await PetDialogue.load('pet://pet/');
    assert.ok(store.global.greet.length >= 10);
    assert.deepEqual(Object.keys(store.global).sort(), [...EXPECTED_KEYS].sort());
    assert.equal(PetDialogue.getStore(), store, 'store is cached for getStore()');
    const say = PetDialogue.createSayer(store);
    const line = say('greet');
    assert.ok(data.global.greet.includes(line));
  });
});

test('load() with a plain relative base url builds a relative url', async () => {
  const data = readPreset();
  await withFetchStub(async (url) => {
    assert.equal(url, './dialogue/whale.json');
    return { ok: true, json: async () => data };
  }, async () => {
    const store = await PetDialogue.load('./');
    assert.deepEqual(Object.keys(store.global).sort(), [...EXPECTED_KEYS].sort());
  });
});

test('load() failure keeps an empty store and say() no-ops safely', async () => {
  for (const impl of [
    async () => { throw new Error('network down'); },
    async () => ({ ok: false, status: 404, json: async () => ({}) }),
    async () => ({ ok: true, json: async () => { throw new SyntaxError('bad json'); } }),
    async () => ({ ok: true, json: async () => 'not an object' }),
  ]) {
    await withFetchStub(impl, async () => {
      const store = await PetDialogue.load('pet://pet/');
      assert.deepEqual(store.global, {});
      const say = PetDialogue.createSayer(store);
      assert.equal(say('greet'), null);
      assert.equal(say('anything'), null);
    });
  }
});

// ── shuffle-bag sayer ──

function makeStore(lines) {
  return { global: { demo: lines }, agents: {} };
}

test('sayer cycles a full bag uniquely and never repeats at the boundary', () => {
  const lines = Array.from({ length: 10 }, (_, i) => `line-${i}`);
  for (const rand of [() => 0, () => 0.9999999]) {
    const say = PetDialogue.createSayer(makeStore(lines), rand);
    const seen = [];
    for (let i = 0; i < 20; i += 1) {
      seen.push(say('demo'));
    }
    assert.equal(new Set(seen.slice(0, 10)).size, 10, 'cycle 1 unique');
    assert.equal(new Set(seen.slice(10)).size, 10, 'cycle 2 unique');
    assert.notEqual(seen[10], seen[9], 'boundary repeat');
    for (const text of seen) {
      assert.ok(lines.includes(text));
    }
  }
});

test('sayer reshuffle swap prevents repeat when the new top equals last-said', () => {
  // Three-line pool, scripted rng:
  //   cycle 1 shuffle j=2,k=0 then j=1,k=1 -> bag [2,1,0], pops 0,1,2.
  //   cycle 2 shuffle j=2,k=2 then j=1,k=0 -> bag [1,0,2], whose next-to-pop
  //   index (2) equals lastSaid (2) -> swap far ends -> [2,0,1], pops 1 first.
  // Without the swap the fourth line would repeat 'l2'.
  const seq = [0, 0.6, 0.99, 0];
  let i = 0;
  const say = PetDialogue.createSayer(makeStore(['l0', 'l1', 'l2']), () => seq[i++ % seq.length]);
  const seen = [say('demo'), say('demo'), say('demo'), say('demo')];
  assert.deepEqual(seen.slice(0, 3), ['l0', 'l1', 'l2']);
  assert.equal(seen[3], 'l1', 'boundary swap applied (not l2 again)');
  // Two-line pool alternating under a constant rng — every reshuffle either
  // starts clear of lastSaid or gets swapped; adjacent says never repeat.
  const alt = PetDialogue.createSayer(makeStore(['alpha', 'beta']), () => 0);
  const run = [];
  for (let k = 0; k < 8; k += 1) {
    run.push(alt('demo'));
  }
  for (let k = 1; k < run.length; k += 1) {
    assert.notEqual(run[k], run[k - 1], `repeat at position ${k}`);
  }
  // And across the real data under a few rng shapes.
  const data = readPreset();
  for (const rand of [() => 0, () => 0.5, () => 0.9999999]) {
    for (const cat of ['greet', 'idleCoding', 'latenight']) {
      const s = PetDialogue.createSayer(data, rand);
      const got = [];
      for (let k = 0; k < 21; k += 1) {
        got.push(s(cat));
      }
      assert.equal(new Set(got.slice(0, 10)).size, 10, `${cat} cycle unique`);
      for (let k = 1; k < got.length; k += 1) {
        assert.notEqual(got[k], got[k - 1], `${cat} repeat at ${k}`);
      }
    }
  }
});

test('sayer returns null for unknown or empty categories', () => {
  const say = PetDialogue.createSayer({ global: { empty: [] }, agents: {} });
  assert.equal(say('nope'), null);
  assert.equal(say('empty'), null);
});

test('sayer renders lines through renderTemplate and accepts a store getter', () => {
  let store = { global: {}, agents: {} };
  const say = PetDialogue.createSayer(() => store, () => 0.5);
  assert.equal(say('demo'), null, 'empty store before load');
  store = { global: { demo: ['你好{who}'] }, agents: {} };
  assert.equal(say('demo'), '你好{who}', 'unknown placeholder verbatim');
  assert.equal(say('demo', { who: '鱼片' }), '你好鱼片', 'values render');
});

// ── renderTemplate ──

test('renderTemplate resolves plain, nested and indexed fields', () => {
  const values = { name: '小鲸鱼', user: { fish: '鱼片' }, list: ['a', 'b'] };
  assert.equal(PetDialogue.renderTemplate('你好{name}！', values), '你好小鲸鱼！');
  assert.equal(PetDialogue.renderTemplate('{user.fish}在吗', values), '鱼片在吗');
  assert.equal(PetDialogue.renderTemplate('{list[0]}-{list[1]}', values), 'a-b');
  assert.equal(
    PetDialogue.renderTemplate('{a.b[0].c}', { a: { b: [{ c: '深' }] } }), '深');
  assert.equal(
    PetDialogue.renderTemplate("{row['key-name']}", { row: { 'key-name': 'v' } }), 'v');
});

test('renderTemplate surfaces payload fields at top level', () => {
  const values = { payload: { event: '投喂', n: 2 } };
  assert.equal(PetDialogue.renderTemplate('{event}x{n}', values), '投喂x2');
  assert.equal(PetDialogue.renderTemplate('{payload.n}', values), '2');
  assert.equal(PetDialogue.renderTemplate('{data.event}', values), '投喂');
  // explicit top-level key wins over payload surfacing
  assert.equal(
    PetDialogue.renderTemplate('{n}', { n: 9, payload: { n: 2 } }), '9');
});

test('renderTemplate keeps unknown and malformed placeholders verbatim', () => {
  const values = { name: 'x' };
  assert.equal(PetDialogue.renderTemplate('{missing}', values), '{missing}');
  assert.equal(PetDialogue.renderTemplate('{name.sub}', values), '{name.sub}');
  assert.equal(PetDialogue.renderTemplate('{name[9]}', { name: ['a'] }), '{name[9]}');
  assert.equal(PetDialogue.renderTemplate('{name[0]}', { name: 'abc' }), '{name[0]}');
  assert.equal(PetDialogue.renderTemplate('{1abc}', values), '{1abc}');
  assert.equal(PetDialogue.renderTemplate('{a..b}', values), '{a..b}');
  assert.equal(PetDialogue.renderTemplate('{a b}', values), '{a b}');
  assert.equal(PetDialogue.renderTemplate('{}', values), '{}');
  assert.equal(PetDialogue.renderTemplate('unclosed {name', values), 'unclosed {name');
  assert.equal(PetDialogue.renderTemplate('lone } brace', values), 'lone } brace');
  assert.equal(PetDialogue.renderTemplate('{name', values), '{name');
});

test('renderTemplate escapes doubled braces and honours conversions/specs', () => {
  assert.equal(PetDialogue.renderTemplate('{{name}}', { name: 'x' }), '{name}');
  assert.equal(PetDialogue.renderTemplate("{'it'}", {}), "{'it'}"); // quoted root not a valid path start -> verbatim... actually root starts with quote -> malformed
  assert.equal(PetDialogue.renderTemplate('{s!r}', { s: 'hi' }), "'hi'");
  assert.equal(PetDialogue.renderTemplate('{n:>4}', { n: 7 }), '   7');
  assert.equal(PetDialogue.renderTemplate('{n:<4}|', { n: 7 }), '7   |');
  assert.equal(PetDialogue.renderTemplate('{n:04}', { n: 7 }), '0007');
  assert.equal(PetDialogue.renderTemplate('{x:.2f}', { x: 1.5 }), '1.50');
  assert.equal(PetDialogue.renderTemplate('{x:+d}', { x: 5 }), '+5');
});

test('renderTemplate autohide hides missing/empty roots and cleans up', () => {
  const hide = new Set(['task']);
  assert.equal(
    PetDialogue.renderTemplate('小鱼片{task}你好', {}, hide), '小鱼片你好');
  assert.equal(
    PetDialogue.renderTemplate('小鱼片{task}你好', { task: '' }, hide), '小鱼片你好');
  assert.equal(
    PetDialogue.renderTemplate('小鱼片{task}你好', { task: null }, hide), '小鱼片你好');
  assert.equal(
    PetDialogue.renderTemplate('A  {task}  B', {}, hide), 'A B', 'double spaces collapse');
  assert.equal(
    PetDialogue.renderTemplate('进度（{task}）完毕', {}, hide), '进度完毕',
    'empty （） shell dropped');
  assert.equal(
    PetDialogue.renderTemplate('值 ({task}) 完', {}, hide), '值 完',
    'empty () shell dropped');
  assert.equal(
    PetDialogue.renderTemplate('  {task}  前后  ', {}, hide), '前后', 'trim');
  // autohide also hides sub-path misses under the root (reference cleanup
  // only drops （）/() shells — square brackets remain)
  assert.equal(
    PetDialogue.renderTemplate('[{task.name}]', { task: {} }, hide), '[]');
  // non-autohide unknown stays verbatim next to hidden field
  assert.equal(
    PetDialogue.renderTemplate('{task} {other}', {}, hide), '{other}');
  // a present autohide value renders normally
  assert.equal(
    PetDialogue.renderTemplate('做{task}吧', { task: '饭' }, hide), '做饭吧');
});

test('renderTemplate rejects proto-pollution roots even when present as data', () => {
  const values = JSON.parse('{"__proto__":{"x":1},"constructor":{"x":2},"prototype":{"x":3}}');
  assert.equal(PetDialogue.renderTemplate('{__proto__.x}', values), '{__proto__.x}');
  assert.equal(PetDialogue.renderTemplate('{constructor.x}', values), '{constructor.x}');
  assert.equal(PetDialogue.renderTemplate('{prototype.x}', values), '{prototype.x}');
  // also unreachable via the implicit prototype chain
  assert.equal(PetDialogue.renderTemplate('{constructor}', {}), '{constructor}');
  // autohide still applies to a forbidden root (hidden, not verbatim)
  assert.equal(
    PetDialogue.renderTemplate('a{__proto__}b', values, new Set(['__proto__'])), 'ab');
});

// ── phraseForAgent ──

test('phraseForAgent resolves agent layer then global then undefined', () => {
  const store = {
    global: { greet: ['g'], feed: ['gf'] },
    agents: { a1: { greet: ['a1g'] } },
  };
  assert.deepEqual(PetDialogue.phraseForAgent(store, 'a1', 'greet'), ['a1g']);
  assert.deepEqual(PetDialogue.phraseForAgent(store, 'a1', 'feed'), ['gf'], 'agent falls back to global');
  assert.deepEqual(PetDialogue.phraseForAgent(store, '', 'greet'), ['g'], 'empty agent skips agents layer');
  assert.deepEqual(PetDialogue.phraseForAgent(store, 'ghost', 'greet'), ['g']);
  assert.equal(PetDialogue.phraseForAgent(store, 'a1', 'nope'), undefined);
  assert.equal(PetDialogue.phraseForAgent(store, '', 'nope'), undefined);
  assert.equal(PetDialogue.phraseForAgent(null, '', 'x'), undefined);
  // flat legacy map behaves as the global layer
  assert.deepEqual(PetDialogue.phraseForAgent({ greet: ['f'] }, '', 'greet'), ['f']);
  // {global: ...} present but key missing -> undefined (no flat probing)
  assert.equal(PetDialogue.phraseForAgent({ global: { a: ['1'] } }, '', 'b'), undefined);
});

// ── loadUserOverrides ──

test('loadUserOverrides replaces categories, keeps others, merges agents', async () => {
  const data = readPreset();
  await withFetchStub(async () => ({ ok: true, json: async () => data }), async () => {
    const store = await PetDialogue.load('pet://pet/');
    const merged = PetDialogue.loadUserOverrides({
      global: {
        greet: ['用户台词甲'],
        customCat: ['自定义类目'],
      },
      agents: {
        agent7: { greet: ['特工问候', '特工问候二'] },
      },
    });
    assert.equal(merged, store);
    assert.deepEqual(store.global.greet, ['用户台词甲'], 'user array replaces builtin');
    assert.ok(store.global.pickup.length >= 10, 'untouched category intact');
    assert.deepEqual(store.global.customCat, ['自定义类目'], 'unknown category allowed');
    assert.deepEqual(store.agents.agent7.greet, ['特工问候', '特工问候二']);
    assert.equal(PetDialogue.phraseForAgent(store, 'agent7', 'greet')[0], '特工问候');
    assert.equal(PetDialogue.phraseForAgent(store, '', 'greet')[0], '用户台词甲');
  });
});

test('loadUserOverrides sanitizes: strings only, trimmed, <=240 chars, <=8 variants', async () => {
  const data = readPreset();
  await withFetchStub(async () => ({ ok: true, json: async () => data }), async () => {
    await PetDialogue.load('pet://pet/');
    const long = '长'.repeat(300);
    const store = PetDialogue.loadUserOverrides({
      global: {
        greet: [long, '  有效  ', '', null, 42, undefined, 'ok'],
        twelve: Array.from({ length: 12 }, (_, i) => `v${i}`),
        allBad: [null, '', 7],
        notList: 42,
        asString: '单行字符串',
      },
    });
    assert.equal(store.global.greet.length, 3, 'non-strings/empty dropped');
    assert.equal(store.global.greet[0].length, 240, 'truncated to 240');
    assert.equal(store.global.greet[1], '有效', 'trimmed');
    assert.equal(store.global.greet[2], 'ok');
    assert.equal(store.global.twelve.length, 8, 'capped at 8 variants');
    assert.equal(store.global.allBad, undefined, 'category dropped when nothing usable');
    assert.equal(store.global.notList, undefined);
    assert.deepEqual(store.global.asString, ['单行字符串'], 'bare string wraps to array');
  });
});

test('loadUserOverrides accepts a flat map as the global layer', async () => {
  const data = readPreset();
  await withFetchStub(async () => ({ ok: true, json: async () => data }), async () => {
    await PetDialogue.load('pet://pet/');
    const store = PetDialogue.loadUserOverrides({ greet: ['扁平覆盖'] });
    assert.deepEqual(store.global.greet, ['扁平覆盖']);
  });
});

// ── categoryForHour ──

test('categoryForHour maps the extracted time-of-day ranges incl wrap', () => {
  const ranges = readPreset().timeOfDay;
  assert.equal(PetDialogue.categoryForHour(0, ranges), 'latenight');
  assert.equal(PetDialogue.categoryForHour(5, ranges), 'latenight');
  assert.equal(PetDialogue.categoryForHour(6, ranges), 'morning');
  assert.equal(PetDialogue.categoryForHour(10, ranges), 'morning');
  assert.equal(PetDialogue.categoryForHour(11, ranges), 'noon');
  assert.equal(PetDialogue.categoryForHour(13, ranges), 'noon');
  assert.equal(PetDialogue.categoryForHour(14, ranges), 'afternoon');
  assert.equal(PetDialogue.categoryForHour(17, ranges), 'afternoon');
  assert.equal(PetDialogue.categoryForHour(18, ranges), 'evening');
  assert.equal(PetDialogue.categoryForHour(22, ranges), 'evening');
  assert.equal(PetDialogue.categoryForHour(23, ranges), 'latenight');
});

test('sayer picks real categories end-to-end after load()', async () => {
  const data = readPreset();
  await withFetchStub(async () => ({ ok: true, json: async () => data }), async () => {
    await PetDialogue.load('pet://pet/');
    const say = PetDialogue.createSayer(() => PetDialogue.getStore(), () => 0.5);
    for (const cat of EXPECTED_KEYS) {
      const line = say(cat);
      assert.ok(data.global[cat].includes(line), `${cat} -> ${line}`);
    }
  });
});
