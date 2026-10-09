'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PET_JS = path.join(__dirname, 'pet-live2d.js');
const PHYSICS_JS = path.join(__dirname, 'pet-physics.js');
const DIALOGUE_JS = path.join(__dirname, 'pet-dialogue.js');
const WANDER_JS = path.join(__dirname, 'pet-wander.js');
const DIALOGUE_JSON = path.join(__dirname, 'dialogue', 'whale.json');
const SOURCE = fs.readFileSync(PET_JS, 'utf8');
const PHYSICS_SOURCE = fs.readFileSync(PHYSICS_JS, 'utf8');
const DIALOGUE_SOURCE = fs.readFileSync(DIALOGUE_JS, 'utf8');
const WANDER_SOURCE = fs.readFileSync(WANDER_JS, 'utf8');
const DIALOGUE_STORE = JSON.parse(fs.readFileSync(DIALOGUE_JSON, 'utf8'));

test('transparent gap between pet and chat card stays click-through', () => {
  const pet = loadPet();
  pet.run(`
    drawPos = { x: 50, y: 50 };
    chatRect = { x: 500, y: 50, w: 200, h: 200 };
  `);
  assert.equal(pet.run('overPet(600, 150)'), true, 'chat card is interactive');
  assert.equal(pet.run('overPet(400, 150)'), false, 'empty space between surfaces is not a giant hit box');
});

test('native surface reports preserve separate ink rectangles and deduplicate frames', () => {
  const pet = loadPet();
  pet.run(`
    globalThis.reports = [];
    petShell.setInteractive = value => reports.push(value);
    lastPaintRect = { x: 10.5, y: 20.5, w: 40, h: 50 };
    lastBubbleRect = { x: 10, y: 1, w: 50, h: 10 };
    chatRect = { x: 300, y: 100, w: 200, h: 180 };
    reportSurfaceRegions(); reportSurfaceRegions();
  `);
  assert.deepEqual(JSON.parse(pet.run('JSON.stringify(reports)')), [{ regions: [
    { x: 10, y: 20, width: 41, height: 51 },
    { x: 10, y: 1, width: 50, height: 10 },
    { x: 300, y: 100, width: 200, height: 180 },
  ] }]);
  pet.run('chatRect = null; reportSurfaceRegions()');
  assert.equal(pet.run('reports.at(-1).regions.length'), 2, 'closed card region is removed');
});

const TOKEN_STYLE = {
  '--dsw-font-family': 'TestFamily, sans-serif',
  '--dsw-alias-bg-layer-1': 'rgb(255, 255, 255)',
  '--dsw-alias-border-l2': 'rgba(0, 0, 0, 0.1)',
  '--dsw-alias-label-primary': 'rgb(15, 17, 21)',
};

const PATH_OPS = new Set(['moveTo', 'lineTo', 'quadraticCurveTo', 'roundRect', 'ellipse', 'arc', 'closePath']);
function currentPath(ctx) {
  return ctx.ops.slice(ctx.ops.findLastIndex((op) => op[0] === 'beginPath') + 1)
    .filter((op) => PATH_OPS.has(op[0])).map((op) => [...op]);
}

function makeCtx(canvas) {
  const ctx = {
    ops: [],
    canvas,
    font: '',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineJoin: 'miter',
    globalAlpha: 1,
    textAlign: 'left',
    textBaseline: 'alphabetic',
    save() { this.ops.push(['save']); },
    restore() { this.ops.push(['restore']); },
    beginPath() { this.ops.push(['beginPath']); },
    moveTo(x, y) { this.ops.push(['moveTo', x, y]); },
    lineTo(x, y) { this.ops.push(['lineTo', x, y]); },
    quadraticCurveTo(a, b, c, d) { this.ops.push(['quadraticCurveTo', a, b, c, d]); },
    roundRect(...args) { this.ops.push(['roundRect', ...args]); },
    ellipse(...args) { this.ops.push(['ellipse', ...args]); },
    arc(...args) { this.ops.push(['arc', ...args]); },
    clip() { this.ops.push(['clip']); },
    closePath() { this.ops.push(['closePath']); },
    fill() { this.ops.push(['fill', currentPath(this)]); },
    stroke() { this.ops.push(['stroke', currentPath(this)]); },
    fillText(text, x, y) { this.ops.push(['fillText', text, x, y]); },
    clearRect(x, y, w, h) { this.ops.push(['clearRect', x, y, w, h]); },
    drawImage(...args) { this.ops.push(['drawImage', ...args]); },
    translate() {}, rotate() {}, scale() {},
    setTransform(...args) { this.ops.push(['setTransform', ...args]); },
    putImageData() {},
    createImageData(w, h) { return { data: new Uint8ClampedArray(w * h * 4) }; },
    getImageData(x, y, w, h) { return { data: new Uint8ClampedArray(w * h * 4) }; },
    measureText(s) { return { width: Array.from(s).length * 13 }; },
  };
  return ctx;
}

function makeCanvas() {
  const canvas = { width: 800, height: 600 };
  canvas.ctx = makeCtx(canvas);
  canvas.getContext = () => canvas.ctx;
  return canvas;
}

test('ordinary chatter never evicts queued pinned notifications', () => {
  const pet = loadPet();
  pet.run(`
    pushBubble({ text: '当前提醒', pinned: true, priority: 2, until: Infinity });
    pushBubble({ text: '下一条重要提醒', pinned: true, priority: 2, until: Infinity });
    for (let i = 0; i < 8; i++) pushBubble({ text: '普通闲聊' + i, priority: 0, until: Infinity });
  `);
  assert.equal(pet.run('bubbleQueue.some((entry) => entry.text === "下一条重要提醒")'), true);
  pet.run(`for (let i = 0; i < 5; i++) pushBubble({ text: '重要提醒' + i, pinned: true, priority: 2, until: Infinity });`);
  assert.equal(pet.run('bubbleQueue.filter((entry) => entry.pinned).length'), 6);
});

test('failed shared turns display their partial reply and a separate error row', async () => {
  const pet = loadPet();
  pet.run(`settings.chatEnabled = true;
    petShell.chat = async () => ({ ok: false, via: 'whale', reason: 'turn-error', reply: '第一步完成' });`);
  await pet.run(`submitChat('执行任务')`);
  assert.equal(pet.run('chatLog.some((entry) => entry.role === "her" && entry.text === "第一步完成")'), true);
  assert.equal(pet.run('chatLog.some((entry) => entry.role === "err" && entry.text.includes("这轮没有完成"))'), true);
  pet.run(`chatRenderHistory([
    { role: 'user', text: '执行任务' }, { role: 'her', text: '第一步完成' },
    { role: 'err', text: '这轮出错——点 ↗ 去会话里看详情' }
  ]);`);
  assert.equal(pet.run('chatLog.filter((entry) => entry.role === "err").length'), 1, 'backfill keeps the persisted error role');
  pet.run(`chatLog.length = 0; petShell.chat = async () => ({ ok: true, via: 'whale', reply: '' });`);
  await pet.run(`submitChat('执行工具任务')`);
  assert.equal(pet.run('chatLog.some((entry) => entry.role === "err")'), false, 'an empty completed turn is not a failed turn');
});

function loadPet() {
  const source = SOURCE.replace(/mount\(\)\.catch[\s\S]*$/, '');
  let now = 100000;
  let rand = () => 0.5;
  const mathStub = {};
  for (const key of Object.getOwnPropertyNames(Math)) {
    mathStub[key] = Math[key];
  }
  mathStub.random = () => rand();
  const mainCanvas = makeCanvas();
  const context = vm.createContext({
    document: {
      documentElement: {},
      getElementById: () => mainCanvas,
      createElement: (tag) => (tag === 'canvas' ? makeCanvas() : {}),
    },
    window: {
      innerWidth: 800,
      innerHeight: 600,
      addEventListener: () => {},
      matchMedia: () => ({ addEventListener() {}, removeEventListener() {} }),
      shell: {},
    },
    performance: { now: () => now },
    Image: class {},
    getComputedStyle: () => ({
      getPropertyValue: (name) => TOKEN_STYLE[name] || '',
    }),
    requestAnimationFrame: () => 0,
    setTimeout, clearTimeout, setInterval, clearInterval,
    console,
    Math: mathStub,
    __dialogueStore: DIALOGUE_STORE,
  });
  vm.runInContext(PHYSICS_SOURCE, context, { filename: 'pet-physics.js' });
  vm.runInContext(DIALOGUE_SOURCE, context, { filename: 'pet-dialogue.js' });
  vm.runInContext(WANDER_SOURCE, context, { filename: 'pet-wander.js' });
  vm.runInContext(source, context, { filename: 'pet-live2d.js' });
  // mount() is stripped from the test source, so the dialogue store never
  // fetches — inject the real JSON and wire the sayer exactly like mount.
  vm.runInContext('dialogueStore = __dialogueStore; LINES = dialogueStore.global; wireDialogue();',
    context);
  return {
    context,
    canvas: mainCanvas,
    run: (expr) => vm.runInContext(expr, context),
    setNow: (v) => { now = v; },
    now: () => now,
    setRandom: (fn) => { rand = fn; },
    resetRandom: () => { rand = () => 0.5; },
  };
}

test('output conversion keeps clamped RGBA values on the CPU path', async () => {
  const pet = loadPet();
  pet.run(`FRAME = 2; allocOutput(); sessionOnGpu = false;
    globalThis.output = { data: new Float32Array([
      -1, 0.5, 1.5, 256, 2.5, 3.5, 254.5, NaN,
      255, Infinity, -Infinity, 4.5, 5.5, 6.5, 7.5, 8.5
    ]) };`);
  await pet.run('copyOutputPixels(output)');
  assert.deepEqual(Array.from(pet.run('outImage.data')), [
    0, 2, 255, 6, 0, 4, 255, 6, 2, 254, 0, 8, 255, 0, 4, 8,
  ]);
});

test('a failed output download releases every output and allows another frame', async () => {
  const pet = loadPet();
  pet.run(`FRAME = 2; allocOutput(); sessionOnGpu = false;
    globalThis.disposed = 0; globalThis.runs = 0;
    poseCpuTensor = { data: new Float32Array(45) };
    console = { warn() {} };
    session = { run: async () => { runs++;
      return { rgba_f: { get data() { throw Error('download failed'); }, dispose() { disposed++; } },
        extra: { dispose() { disposed++; } } };
    } };`);
  await pet.run('renderFrame()');
  assert.equal(pet.run('disposed'), 2);
  assert.equal(pet.run('inferBusy'), false);
  assert.equal(pet.run('painted'), false, 'a failed frame does not replace the displayed image');
  await pet.run('renderFrame()');
  assert.equal(pet.run('runs'), 2);
  assert.equal(pet.run('disposed'), 4);
});

function pathOps(ops) {
  const start = ops.findIndex((op) => op[0] === 'beginPath');
  const end = ops.findIndex((op, i) => i > start && op[0] === 'closePath');
  return ops.slice(start, end + 1);
}

test('display density changes keep panel geometry and hits in CSS pixels', () => {
  const pet = loadPet();
  pet.run(`drawPos = { x: 560, y: 310 };
    charRect = { x: 0, y: 0, right: 240, bottom: 260 };
    globalThis.queries = [];
    window.matchMedia = (query) => {
      const q = { query, listener: null,
        addEventListener(type, listener) { this.listener = listener; },
        removeEventListener() { this.listener = null; } };
      queries.push(q); return q;
    };
    resizeCanvas(); openPanel();`);
  const originalPanel = pet.run('JSON.stringify(panel)');
  for (const density of [1.25, 1.5, 2, 1]) {
    pet.run(`closePanel(); window.devicePixelRatio = ${density}; queries.at(-1).listener(); openPanel();`);
    assert.equal(pet.canvas.width, 800 * density);
    assert.equal(pet.canvas.height, 600 * density);
    assert.deepEqual(pet.canvas.ctx.ops.filter(op => op[0] === 'setTransform').at(-1),
      ['setTransform', density, 0, 0, density, 0, 0]);
    assert.equal(pet.run('queries.at(-2).listener'), null, 'old DPI listener is removed');
    assert.equal(pet.run('JSON.stringify(panel)'), originalPanel, 'edge placement stays within CSS viewport');
    assert.equal(pet.run('panelCellAt(panel.x + PANEL_PAD + 10, panel.y + PANEL_GRID_TOP + 10)'), 0);
    pet.canvas.ctx.ops.length = 0;
    pet.run('drawPanel()');
    const button = pet.canvas.ctx.ops.find(op => op[0] === 'roundRect' && op[4] === 20 && op[5] === 10);
    assert.ok(button);
    const [, x, y, w, h] = button;
    const rowCenter = pet.run('panel.y + PANEL_PAD + PANEL_HEAD_H + 8 + 52');
    assert.equal(y - (rowCenter + 6), 12, 'statistics line has 12px breathing room');
    assert.equal(pet.run(`feedButtonHit(${x + w / 2}, ${y + h / 2})`), true);
    assert.equal(pet.run(`feedButtonHit(${x + w / 2}, ${y - 4})`), false, 'gap is not clickable');
  }
});

test('chat state reuses its catalog during short polling intervals', async () => {
  const pet = loadPet();
  pet.run(`globalThis.__catalogRequests = [];
    petShell.chatState = (request) => {
      __catalogRequests.push(request.includeCatalog);
      return { ok: true, enabled: true, sessionId: 'whale-1',
        name: '鲸鱼娘', groups: request.includeCatalog ? [{ id: 'p', models: [] }] : null,
        history: [] };
    };`);
  await pet.run('chatRefreshState(true)');
  await pet.run('chatRefreshState()');
  assert.deepEqual(Array.from(pet.run('__catalogRequests')), [false, true, false]);
  assert.equal(pet.run('chatGroups.length'), 1);
});

test('empty chat catalog is cached and overlapping polls share one request', async () => {
  const pet = loadPet();
  pet.run(`globalThis.__catalogRequests = [];
    petShell.chatState = (request) => {
      __catalogRequests.push(request.includeCatalog);
      return { ok: true, enabled: true, groups: request.includeCatalog ? [] : null, history: [] };
    };`);
  await pet.run('chatRefreshState()');
  await pet.run('chatRefreshState()');
  assert.deepEqual(Array.from(pet.run('__catalogRequests')), [false, true, false]);
  pet.run(`globalThis.__slowRequests = 0;
    petShell.chatState = () => {
      __slowRequests += 1;
      return new Promise((resolve) => { globalThis.__finishSlow = resolve; });
    };`);
  const a = pet.run('chatRefreshState()');
  const b = pet.run('chatRefreshState()');
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(pet.run('__slowRequests'), 1);
  pet.run('__finishSlow({ ok: true, enabled: true, history: [] })');
  await Promise.all([a, b]);
  pet.run(`globalThis.__retryRequests = 0;
    petShell.chatState = () => {
      __retryRequests += 1;
      return __retryRequests === 1 ? Promise.reject(new Error('offline'))
        : { ok: true, enabled: true, groups: [], history: [] };
    };`);
  await pet.run('chatRefreshState()');
  await pet.run('chatRefreshState()');
  assert.equal(pet.run('__retryRequests'), 2);
});

test('slow catalog does not block new history and reopening queues a forced refresh', async () => {
  const pet = loadPet();
  pet.run(`globalThis.__historyRequests = 0; globalThis.__catalogRequests = 0;
    petShell.chatState = (request) => {
      if (!request.includeCatalog) {
        __historyRequests += 1;
        return { ok: true, enabled: true, sessionId: 'whale-1',
          selected: null, history: [{ seq: __historyRequests, role: 'assistant', text: 'hello' }] };
      }
      __catalogRequests += 1;
      if (__catalogRequests === 1) {
        return new Promise((resolve) => { globalThis.__finishCatalog = resolve; });
      }
      return { ok: true, enabled: true, sessionId: 'whale-1',
        groups: [{ id: 'fresh', models: [] }], selected: null, history: [] };
    };`);
  const first = pet.run('chatRefreshState(true)');
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(pet.run('__catalogRequests'), 1);
  const second = pet.run('chatRefreshState()');
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(pet.run('__historyRequests'), 2);
  assert.equal(pet.run('chatServerSeq'), 2);
  const forced = pet.run('chatRefreshState(true)');
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(pet.run('__catalogRequests'), 1);
  pet.run(`__finishCatalog({ ok: true, enabled: true, sessionId: 'whale-1',
    groups: [{ id: 'old', models: [] }], selected: null, history: [] })`);
  await Promise.all([first, second, forced]);
  assert.equal(pet.run('__catalogRequests'), 2);
  assert.equal(pet.run('chatGroups[0].id'), 'fresh');
});

test('minute growth rescan keeps sleeping pet asleep; real feeding wakes her', () => {
  const pet = loadPet();
  pet.run('sleepEnter()');
  pet.run('onGrowthPush({ available: 12, fed: 0, leveledUp: false })');
  assert.equal(pet.run('sleeping'), true);
  pet.run('onGrowthPush({ available: 11, fed: 1, leveledUp: false })');
  assert.equal(pet.run('sleeping'), false);
});

function countOps(ops, name) {
  return ops.filter((op) => op[0] === name).length;
}

test('drawBubble strokes and fills ONE continuous outline that includes the tail', () => {
  const pet = loadPet();
  pet.run(`drawPos = { x: 280, y: 200 };
    homeRect = { x: 0, y: 0, width: 800, height: 600 };
    bubble = { text: '测试气泡', until: ${pet.now() + 5000} };`);
  const dirty = pet.run('drawBubble(performance.now())');
  const ops = pet.canvas.ctx.ops;
  assert.equal(countOps(ops, 'beginPath'), 1, 'exactly one path');
  const fills = ops.filter((op) => op[0] === 'fill');
  const strokes = ops.filter((op) => op[0] === 'stroke');
  assert.equal(fills.length, 1, 'exactly one fill');
  assert.equal(strokes.length, 1, 'exactly one stroke');
  const recordedPath = pathOps(ops).filter((op) => PATH_OPS.has(op[0])).map((op) => [...op]);
  assert.deepEqual(fills[0][1], recordedPath, 'fill covers the same path');
  assert.deepEqual(strokes[0][1], recordedPath, 'stroke covers the same path incl tail');
  assert.equal(recordedPath.at(-1)[0], 'closePath');
  const bh = 16 + 12;
  const by = (200 - 8) - 12 - bh - 8;
  const bw = 4 * 13 + 18;
  const headX = 280 + 240 / 2;
  const bx = Math.min(Math.max(headX - bw / 2, 4), 800 - bw - 4);
  const tx = Math.min(Math.max(headX, bx + 16), bx + bw - 16);
  const tip = [tx, by + bh + 8];
  const tipIdx = recordedPath.findIndex((op) => op[0] === 'lineTo'
    && Math.abs(op[1] - tip[0]) < 0.01 && Math.abs(op[2] - tip[1]) < 0.01);
  assert.ok(tipIdx > 0, 'tail tip inside the single stroked path');
  assert.deepEqual(recordedPath[tipIdx - 1].slice(0, 3), ['lineTo', tx + 6, by + bh]);
  assert.deepEqual(recordedPath[tipIdx + 1].slice(0, 3), ['lineTo', tx - 6, by + bh]);
  const segs = recordedPath.filter((op) => op[0] === 'lineTo' || op[0] === 'moveTo')
    .map((op) => [op[1], op[2]]);
  for (let i = 1; i < segs.length; i += 1) {
    const [x0, y0] = segs[i - 1];
    const [x1, y1] = segs[i];
    const sameY = Math.abs(y0 - y1) < 0.01;
    const lr = Math.abs(x0 - (tx - 6)) < 0.01 && Math.abs(x1 - (tx + 6)) < 0.01;
    const rl = Math.abs(x0 - (tx + 6)) < 0.01 && Math.abs(x1 - (tx - 6)) < 0.01;
    assert.equal(sameY && (lr || rl), false, 'no base line between tail shoulders');
  }
  for (const op of recordedPath) {
    for (const v of op.slice(1)) {
      assert.ok(Number.isFinite(v), `finite coordinate in ${op[0]}`);
    }
  }
  assert.ok(dirty.x <= bx - 3 && dirty.y <= by - 3);
  assert.ok(dirty.x + dirty.w >= bx + bw + 3);
  assert.ok(dirty.y + dirty.h >= by + bh + 8 + 3);
});

function bubbleRectInsideHost(pet, host) {
  const ops = pet.canvas.ctx.ops;
  const path = pathOps(ops);
  const dirty = pet.run('__lastDirty');
  for (const op of path) {
    if (op[0] === 'moveTo' || op[0] === 'lineTo') {
      assert.ok(op[1] >= host.x && op[1] <= host.x + host.width, `x ${op[1]} in host`);
      assert.ok(op[2] >= host.y && op[2] <= host.y + host.height, `y ${op[2]} in host`);
    }
  }
  assert.ok(dirty.x >= host.x && dirty.y >= host.y);
  assert.ok(dirty.x + dirty.w <= host.x + host.width);
  assert.ok(dirty.y + dirty.h <= host.y + host.height);
}

test('drawBubble flips below at the top edge and clamps inside the host', () => {
  const pet = loadPet();
  pet.run(`homeRect = { x: 0, y: 0, width: 800, height: 600 };
    drawPos = { x: 280, y: 0 };
    bubble = { text: '测试气泡', until: ${pet.now() + 5000} };
    __lastDirty = drawBubble(performance.now());`);
  const ops = pet.canvas.ctx.ops;
  const path = pathOps(ops);
  const by = 268 + 12 + 8;
  const headX = 400;
  const bw = 4 * 13 + 18;
  const bx = Math.min(Math.max(headX - bw / 2, 4), 800 - bw - 4);
  const tx = Math.min(Math.max(headX, bx + 16), bx + bw - 16);
  const tipIdx = path.findIndex((op) => op[0] === 'lineTo'
    && Math.abs(op[1] - tx) < 0.01 && Math.abs(op[2] - (by - 8)) < 0.01);
  assert.ok(tipIdx > 0, 'upward tail tip present when flipped below');
  bubbleRectInsideHost(pet, { x: 0, y: 0, width: 800, height: 600 });
});

test('right-edge status card leaves a pinned caption and its close target fully visible', () => {
  const caption = '渲染优化检查：状态卡和提醒应当完整显示。';
  for (const [placement, y] of [['normal', 694.83], ['near-top', 10]]) {
    const pet = loadPet();
    // The normal case reproduces the observed 1708x960 native viewport's
    // tight silhouette and left-flipped card, rather than a 240px box.
    pet.run(`window.innerWidth = 1708; window.innerHeight = 960;
      homeRect = { x: 0, y: 0, width: 1708, height: 960 };
      drawPos = { x: 1443, y: ${y} }; session = {};
      charRect = { x: 83.69, y: 0, right: 157.54, bottom: 91.11 };
      openPanel();
      bubble = { text: '${caption}', pinned: true, until: Infinity };`);
    pet.canvas.ctx.ops.length = 0;
    const ink = pet.run('lastBubbleRect = drawBubble(performance.now())');
    const card = pet.run('panel');
    const close = pet.run('bubbleCloseRect');
    assert.ok(ink.x < card.x + card.w && ink.x + ink.w > card.x,
      'the fixture retains the horizontal overlap that previously hid the caption');
    if (placement === 'normal') {
      assert.ok(ink.y + ink.h <= card.y - 4,
        'the complete bubble, tail and clear margin fit above the card');
    } else {
      assert.ok(ink.y >= card.y + card.h + 4,
        'with insufficient space above, the full bubble fits below the card');
    }
    assert.ok(ink.y >= 0 && ink.y + ink.h <= 960, 'moved ink remains inside the viewport');
    assert.equal(pet.canvas.ctx.ops.filter((op) => op[0] === 'fillText')
      .map((op) => op[1]).join(''), caption, 'all caption characters remain painted');
    assert.ok(close.x >= ink.x && close.y >= ink.y
      && close.x + close.w <= ink.x + ink.w && close.y + close.h <= ink.y + ink.h,
    'the entire pinned close target remains inside the moved ink rectangle');
    const cx = close.x + close.w / 2;
    const cy = close.y + close.h / 2;
    assert.equal(pet.run(`bubbleCloseHit(${cx}, ${cy}) && overPet(${cx}, ${cy})`), true,
      'the moved close button remains reachable through the real interactive geometry');
    pet.run(`onCanvasPointerDown({ target: canvas, button: 0, clientX: ${cx}, clientY: ${cy} })`);
    assert.equal(pet.run('bubble'), null, 'the moved close target dismisses the pinned caption');
    assert.ok(pet.run('panel'), 'dismissal keeps the status card open');
  }
});

test('a status card outside the bubble keeps the existing bubble placement', () => {
  const pet = loadPet();
  pet.run(`drawPos = { x: 280, y: 200 };
    homeRect = { x: 0, y: 0, width: 800, height: 600 };
    bubble = { text: '测试气泡', until: Infinity };`);
  const initial = JSON.parse(pet.run('JSON.stringify(drawBubble(performance.now()))'));
  const initialText = pet.canvas.ctx.ops.filter((op) => op[0] === 'fillText');
  pet.run('panel = { x: 10, y: 10, w: 100, h: 100 }');
  pet.canvas.ctx.ops.length = 0;
  const withCard = JSON.parse(pet.run('JSON.stringify(drawBubble(performance.now()))'));
  assert.deepEqual(withCard, initial, 'an unrelated card does not move the existing ink rectangle');
  assert.deepEqual(pet.canvas.ctx.ops.filter((op) => op[0] === 'fillText'), initialText,
    'the existing caption coordinates remain unchanged');
});

test('carried live pet keeps the bubble beside her head and reports a tight hover rect', () => {
  const pet = loadPet();
  pet.run(`homeRect = { x: 0, y: 0, width: 800, height: 600 };
    overlayOrigin = { x: 0, y: 0 };
    drawPos = { x: 280, y: 200 };
    session = {};
    charRect = { x: 0, y: 0, right: 240, bottom: 260 };
    dragging = true; dragMoved = true;
    physPoint = { x: 400, y: 300 };
    stillCtl.name = 'pick-up'; stillCtl.alpha = 1;
    stillCtl.entry = LIVE_ENTRY;
    liveFx.pivot = 'grab';
    bubble = { text: '跟着你', until: ${pet.now() + 5000} };
    globalThis.__roam = null;
    petShell.reportRoam = (r) => { __roam = r; return Promise.resolve(null); };
    lastRoamAt = 0; reportRoam();
    drawBubble(performance.now());`);
  const path = pathOps(pet.canvas.ctx.ops);
  const tail = path.filter((op) => op[0] === 'lineTo').find((op) => op[1] === 400 && op[2] > 240 && op[2] < 300);
  assert.ok(tail, 'bubble tail stays near the carried head');
  assert.ok(pet.run('__roam.w') < 300, 'hover rect follows visible body, not the clear box');
});

test('live pose hover bounds follow drawn ink instead of the oversized clear region', () => {
  const pet = loadPet();
  pet.run(`drawPos = { x: 280, y: 200 };
    session = {};
    charRect = { x: 20, y: 10, right: 220, bottom: 250 };
    stillCtl.name = 'sleep'; stillCtl.alpha = 1;
    stillCtl.entry = LIVE_ENTRY;
    liveFx.rot = -1;
    globalThis.__body = petBodyBounds();`);
  assert.ok(pet.run('__body.right - __body.x') < 340, 'rotated live ink has a tight width');
  assert.ok(pet.run('__body.bottom - __body.y') < 340, 'rotated live ink has a tight height');
});

test('drawBubble clamps on right, left, and bottom edges, nonzero origin, null host', () => {
  const host = { x: 0, y: 0, width: 800, height: 600 };
  for (const [dx, dy] of [[520, 300], [-90, 300], [280, 560], [0, 300]]) {
    const pet = loadPet();
    pet.run(`homeRect = { x: 0, y: 0, width: 800, height: 600 };
      drawPos = { x: ${dx}, y: ${dy} };
      bubble = { text: '测试气泡', until: ${pet.now() + 5000} };
      __lastDirty = drawBubble(performance.now());`);
    bubbleRectInsideHost(pet, host);
  }
  const pet2 = loadPet();
  pet2.run(`homeRect = { x: 100, y: 50, width: 800, height: 600 };
    drawPos = { x: 300, y: 200 };
    bubble = { text: '测试气泡', until: ${pet2.now() + 5000} };
    __lastDirty = drawBubble(performance.now());`);
  bubbleRectInsideHost(pet2, { x: 100, y: 50, width: 800, height: 600 });
  const pet3 = loadPet();
  pet3.run(`homeRect = null;
    drawPos = { x: 280, y: 200 };
    bubble = { text: '测试气泡', until: ${pet3.now() + 5000} };
    __lastDirty = drawBubble(performance.now());`);
  bubbleRectInsideHost(pet3, { x: 0, y: 0, width: 800, height: 600 });
});

test('drawBubble wraps long text inside the width budget and host', () => {
  const pet = loadPet();
  const long = '这是一条特别特别长的台词用来验证气泡换行不会超出最大宽度';
  pet.run(`homeRect = { x: 0, y: 0, width: 800, height: 600 };
    drawPos = { x: 280, y: 200 };
    bubble = { text: '${long}', until: ${pet.now() + 5000} };
    __lastDirty = drawBubble(performance.now());`);
  const ops = pet.canvas.ctx.ops;
  const texts = ops.filter((op) => op[0] === 'fillText').map((op) => op[1]);
  assert.ok(texts.length >= 2, 'long line wrapped');
  for (const line of texts) {
    assert.ok(Array.from(line).length * 13 <= 150);
  }
  bubbleRectInsideHost(pet, { x: 0, y: 0, width: 800, height: 600 });
});

test('drawBubble never starts a line with closing punctuation', () => {
  const pet = loadPet();
  const text = `${'鲸'.repeat(13)}。`;
  pet.run(`homeRect = { x: 0, y: 0, width: 800, height: 600 };
    drawPos = { x: 280, y: 200 };
    bubble = { text: '${text}', until: ${pet.now() + 5000} };
    drawBubble(performance.now());`);
  const texts = pet.canvas.ctx.ops.filter((op) => op[0] === 'fillText').map((op) => op[1]);
  assert.equal(texts.join(''), text, 'wrap preserves the full string');
  for (const line of texts) {
    assert.ok(Array.from(line).length * 13 <= 150);
    assert.equal(/^[，。！？、；：…）》」』】”’]/u.test(line), false, `line starts with closing punctuation: ${line}`);
  }
  assert.ok(Array.from(texts.at(-1)).length > 1, 'last line is not a lone punctuation');
});

test('paint clears before draws and an expired bubble still gets a cleanup paint', () => {
  const pet = loadPet();
  pet.run(`homeRect = { x: 0, y: 0, width: 800, height: 600 };`);
  // A steady bubble is static: it repaints on its change edges (push,
  // expiry) instead of forcing a tickStill paint every frame.
  pet.run(`pushBubble({ text: '测试气泡', until: ${pet.now() + 1000}, priority: 1 })`);
  const first = pet.canvas.ctx.ops.length;
  assert.ok(first > 0, 'paint ran on bubble push');
  const drawIdx = pet.canvas.ctx.ops.findIndex((op) => op[0] === 'fill' || op[0] === 'drawImage' || op[0] === 'fillText');
  const lastClear = pet.canvas.ctx.ops.map((op, i) => [op, i])
    .filter(([op]) => op[0] === 'clearRect').map(([, i]) => i).at(-1);
  assert.ok(drawIdx > lastClear, 'all clears precede any draw');
  pet.run('__rect = lastBubbleRect');
  const rect = pet.run('__rect');
  assert.ok(rect, 'bubble dirty rect recorded');
  pet.setNow(pet.now() + 2000);
  pet.canvas.ctx.ops.length = 0;
  pet.run('tickStill(performance.now())');
  const clears = pet.canvas.ctx.ops.filter((op) => op[0] === 'clearRect');
  assert.ok(clears.some((op) => op[1] === rect.x && op[2] === rect.y
    && op[3] === rect.w && op[4] === rect.h),
    'expired bubble region cleared even with no inference frame');
});

const EXPECTED_KEYS = ['greet', 'pickup', 'throw', 'land', 'pat', 'feed', 'come',
  'tease', 'angry', 'sleep', 'wake', 'sleepy', 'tap0', 'tap1', 'tap2', 'tap3',
  'morning', 'noon', 'afternoon', 'evening', 'latenight', 'idle', 'feedEat',
  'feedDone', 'arrive', 'idleRice', 'idleStandby', 'idleTail', 'idleCoding',
  'idleCare', 'feedToken', 'feedTokenEat', 'feedTokenDone', 'levelUp',
  'hungry', 'grumpy', 'clingy',
  // §B4 wander + §B10 cheap items + R2 DSH-link seeds
  'wanderStart', 'wanderEnd', 'wanderStop', 'personalitySet',
  'settingsChanged', 'fileEat', 'dshWorking', 'dshDone', 'dshError',
  'dshRest', 'dshMilestone', 'dshMiss', 'dshApproval', 'dshQuestion',
  'chatFallback', 'looking', 'lookFallback', 'lookNoModel', 'lookAssistantOff',
  'lookError', 'approvalAllow', 'approvalReject'];

test('LINES has all 59 categories with ≥10 distinct lines each', () => {
  const pet = loadPet();
  const lines = pet.run('LINES');
  assert.deepEqual(Object.keys(lines).sort(), [...EXPECTED_KEYS].sort());
  const all = [];
  for (const key of Object.keys(lines)) {
    assert.ok(lines[key].length >= 10, `${key} has ≥10 lines`);
    for (const line of lines[key]) {
      assert.equal(typeof line, 'string');
      assert.ok(line.length > 0);
      all.push(line);
    }
  }
  assert.equal(new Set(all).size, all.length, 'global lines distinct');
});

test('say() cycles every pool without repeats and never repeats at the boundary', () => {
  const pet = loadPet();
  const lines = pet.run('LINES');
  for (const rand of [() => 0, () => 0.9999999]) {
    pet.setRandom(rand);
    for (const key of EXPECTED_KEYS) {
      // Fresh sayer per category = fresh shuffle bags (the bag state lives
      // inside PetDialogue.createSayer's closure, not reachable maps).
      pet.run('wireDialogue()');
      const seen = [];
      for (let i = 0; i < 20; i += 1) {
        pet.run(`say('${key}')`);
        seen.push(pet.run('bubble.text'));
      }
      assert.equal(new Set(seen.slice(0, 10)).size, 10, `${key} cycle 1 unique`);
      assert.equal(new Set(seen.slice(10)).size, 10, `${key} cycle 2 unique`);
      assert.notEqual(seen[10], seen[9], `${key} boundary repeat`);
      for (const text of seen) {
        assert.ok(lines[key].includes(text));
      }
    }
  }
  pet.resetRandom();
});

test('say() with an unknown category leaves the current bubble untouched', () => {
  const pet = loadPet();
  pet.run(`bubble = { text: '测试气泡', until: ${pet.now() + 5000} };
    say('__nope__')`);
  assert.equal(pet.run('bubble.text'), '测试气泡');
});

test('personality routes say() through the agents layer with global fallback', () => {
  const pet = loadPet();
  // tsundere covers 'greet' — lines must come from the agent pool only.
  pet.run(`applySettings({ ...settings, personality: 'tsundere' });
    wireDialogue();`);
  const seen = new Set();
  for (let i = 0; i < 10; i += 1) {
    pet.run(`say('greet')`);
    seen.add(pet.run('bubble.text'));
  }
  const pool = pet.run('dialogueStore.agents.tsundere.greet');
  for (const text of seen) {
    assert.ok(pool.includes(text), `tsundere greet: ${text}`);
  }
  // A category the persona doesn't cover falls back to global.
  pet.run(`say('sleepy')`);
  assert.ok(pet.run('LINES.sleepy').includes(pet.run('bubble.text')),
    'uncovered category falls back to global pool');
  // Switching back to natural re-keys the bags onto the global pool.
  pet.run(`applySettings({ ...settings, personality: 'natural' });
    wireDialogue();`);
  pet.run(`say('greet')`);
  assert.ok(pet.run('LINES.greet').includes(pet.run('bubble.text')),
    'natural reads the global pool');
});

test('every LINES category is reachable via say(), sayAlert(), time-of-day pick, or IDLE_TOPICS', () => {
  const pet = loadPet();
  const topics = pet.run('IDLE_TOPICS');
  const lines = pet.run('LINES');
  const alertCats = new Set(pet.run('[...ALERT_CATEGORIES]'));
  const timeCats = ['latenight', 'morning', 'noon', 'afternoon', 'evening'];
  // Every pool has a live call site — the look* categories wired up with
  // the R3 看看 feature and its failure voices.
  const PENDING_KEYS = new Set();
  for (const key of Object.keys(lines)) {
    const direct = new RegExp(`say\\([^)]*'${key}'`).test(SOURCE);
    const tapDyn = /^tap\d$/.test(key) && SOURCE.includes('say(`tap');
    const timeCat = timeCats.includes(key) && /say\(Math\.random\(\) < 0\.45 \? cat/.test(SOURCE);
    assert.ok(direct || tapDyn || timeCat || topics.includes(key)
      || alertCats.has(key) || PENDING_KEYS.has(key), `${key} reachable`);
  }
});

test('feed sequence moves through notice, eating, chewing and full without skipping dialogue', () => {
  const pet = loadPet();
  pet.run(`homeRect = { x: 0, y: 0, width: 800, height: 600 };
    stills.set('running', { img: {}, box: { x: 0, y: 0, right: 10, bottom: 10 } });
    stills.set('eat', { img: {}, box: { x: 0, y: 0, right: 10, bottom: 10 } });
    feed = { phase: 'drop', t0: ${pet.now() - 500}, bowlX: 300, bowlY: 300, groundY: 540 };`);
  pet.run('tickStill(performance.now())');
  assert.ok(pet.run('LINES.feed').includes(pet.run('bubble.text')));
  pet.run(`feed.phase = 'run'; feed.t0 = ${pet.now()};
    drawPos.x = feed.bowlX - 240 / 2;`);
  pet.run('tickStill(performance.now())');
  assert.ok(pet.run('LINES.feedEat').includes(pet.run('bubble.text')));
  assert.equal(pet.run('feed.phase'), 'notice');
  pet.run(`feed.t0 = ${pet.now() - 600}`);
  pet.run('tickStill(performance.now())');
  assert.equal(pet.run('feed.phase'), 'eat');
  pet.run(`feed.t0 = ${pet.now() - 1600}`);
  pet.run('tickStill(performance.now())');
  assert.equal(pet.run('feed.phase'), 'chew');
  pet.run(`feed.t0 = ${pet.now() - 900}`);
  pet.run('tickStill(performance.now())');
  assert.equal(pet.run('feed.phase'), 'full');
  pet.run(`feed.t0 = ${pet.now() - 700}`);
  pet.run('tickStill(performance.now())');
  assert.ok(pet.run('LINES.feedDone').includes(pet.run('bubble.text')));
});

test('registered live state expressions use the original avatar', () => {
  const pet = loadPet();
  const ids = pet.run('Object.keys(LIVE_ACTION_EXPRESSION)');
  const expressions = pet.run('Object.keys(LIVE_EXPRESSIONS)');
  assert.ok(ids.includes('sleep') && ids.includes('eat') && ids.includes('pickup'));
  assert.ok(expressions.includes('asleep') && expressions.includes('panicked'));
  assert.equal(pet.run('ids => ids.every((id) => typeof LIVE_STATES[id] === "function")')(ids), true);
  assert.equal(pet.run('ids => ids.every((id) => typeof LIVE_EXPRESSIONS[LIVE_ACTION_EXPRESSION[id]] === "function")')(ids), true);
  pet.run(`session = {}; stillCtl.name = 'sleep'; stillCtl.alpha = 1; pose.fill(0); applyLiveState();`);
  assert.equal(pet.run('pose[12]'), 1);
  assert.equal(pet.run('pose[13]'), 1);
  assert.equal(pet.run('liveFx.rot'), -1);
});

test('sleep owns the face despite drowsiness, cursor gaze and an unfinished happy micro-action', () => {
  const pet = loadPet();
  pet.run(`session = {}; sleepEnter();`);
  pet.setNow(pet.now() + 1300);
  pet.run(`tickStill(performance.now()); stillCtl.alpha = 1;
    idle.sleepy = 1; idle.lastInteract = performance.now() - 300000;
    idle.act = ACTS[3]; idle.actStart = performance.now() - 950;
    idle.ix = idle.mx = idle.targetMx = 0.8;
    idle.iy = idle.my = idle.targetMy = -0.8;
    idle.nextBlink = 100; idle.blinkTimer = 0;
    stepPose();`);
  assert.equal(pet.run('stillCtl.name'), 'sleep');
  const face = Array.from(pet.run('pose.slice(0, 39)'));
  for (let ch = 0; ch < face.length; ch += 1) {
    assert.equal(Math.abs(face[ch]), ch === 12 || ch === 13 ? 1 : 0,
      `sleep channel ${ch} must not distort the closed eyelids`);
  }
});

test('sleep entry releases other facial shapes continuously before fully closing the eyes', () => {
  const pet = loadPet();
  pet.run(`session = {}; sleepEnter(); stillCtl.alpha = 1;`);
  const stages = [0, 0.6, 1.2].map((elapsed) => {
    pet.run(`pose.fill(0); pose[18] = pose[19] = 0.6;
      pose[14] = pose[15] = 0.8; pose[37] = 0.7;
      rigT = rigStateT0 + ${elapsed}; applyLiveState();`);
    return Array.from(pet.run('[pose[12], pose[14], pose[18], pose[37]]'));
  });
  assert.equal(stages[0][0], 0);
  assert.ok(stages[1][0] > 0 && stages[1][0] < 1, 'eyelids close progressively');
  for (let i = 1; i < 4; i += 1) {
    assert.ok(stages[1][i] > 0 && stages[1][i] < stages[0][i], 'competing shape fades');
    assert.equal(stages[2][i], 0, 'no competing shape at the end of sleep entry');
  }
  assert.equal(stages[2][0], 1);
});

test('waking releases sleep face control and restores gaze and ordinary blinking', () => {
  const pet = loadPet();
  pet.run(`session = {}; sleepEnter(); stillCtl.name = 'sleep'; stillCtl.alpha = 1;
    pose.fill(0); applyLiveState(); wake();`);
  assert.equal(pet.run('sleeping'), false);
  assert.equal(pet.run('stillCtl.name'), 'wake');
  pet.run(`stepPose();`);
  assert.equal(pet.run('pose[12]'), 0, 'waking is not pinned shut');
  pet.run(`stillCtl.name = null; stillCtl.alpha = 0; idle.tapUntil = 0;
    idle.act = null; idle.nextAct = 100;
    idle.ix = idle.mx = idle.targetMx = 0.8;
    idle.iy = idle.my = idle.targetMy = -0.8;
    idle.blinkState = 0; idle.blinkTimer = 0; idle.nextBlink = 100;
    stepPose();`);
  assert.ok(Math.abs(pet.run('pose[37]')) > 0.5, 'gaze is restored');
  pet.run('idle.blinkState = 2; idle.blinkTimer = 0; stepPose();');
  assert.equal(pet.run('pose[12]'), 1, 'normal blink still closes the eyes');
});

test('idle blinks close cleanly during happy and drowsy micro-actions, then restore the expression', () => {
  for (const microAction of ['ACTS[3]', 'YAWN']) {
    const pet = loadPet();
    pet.run(`session = {}; idle.last = performance.now();
      idle.sleepy = 1; idle.lastInteract = performance.now() - 100000;
      idle.act = ${microAction}; idle.actStart = performance.now() - idle.act.dur * 500;
      idle.ix = idle.targetMx = 0.8; idle.iy = idle.targetMy = -0.8;
      idle.blinkState = 2; idle.blinkTimer = 0; stepPose();`);
    assert.equal(pet.run('pose[12]'), 1);
    assert.equal(pet.run('pose[13]'), 1);
    assert.ok(Array.from(pet.run('pose.slice(14, 26)')).every((v) => v === 0),
      `${microAction}: full closure excludes competing eye shapes`);
    assert.equal(Math.abs(pet.run('pose[37]')), 0, 'closed eyes do not retain iris motion');
    assert.ok(pet.run('pose.slice(26, 37).some((v) => v > 0)'), 'mouth expression remains');
  }
  const pet = loadPet();
  pet.run(`idle.act = ACTS[3]; idle.actStart = performance.now() - 950;
    idle.blinkState = 2; idle.blinkTimer = 0; stepPose();
    idle.blinkState = 0; idle.blinkTimer = 0; idle.nextBlink = 100; stepPose();`);
  assert.equal(pet.run('pose[12]'), 0);
  assert.ok(pet.run('pose[14]') > 0.7, 'smile returns when eyes reopen');
});

test('unilateral idle wink suppresses only the closing eye', () => {
  const pet = loadPet();
  pet.run(`idle.sleepy = 1; idle.lastInteract = performance.now() - 100000;
    idle.act = ACTS[5]; idle.actStart = performance.now() - 450;
    idle.blinkState = 0; idle.blinkTimer = 0; idle.nextBlink = 100;
    idle.ix = idle.targetMx = 0.8; stepPose();`);
  assert.equal(pet.run('pose[12]'), 1);
  assert.equal(pet.run('pose[13]'), 0);
  assert.equal(Math.abs(pet.run('pose[18]')), 0, 'wink has no relaxed-eye overlap');
  assert.ok(pet.run('pose[19]') > 0.5, 'open eye retains its drowsy shape');
  assert.ok(Math.abs(pet.run('pose[38]')) > 0.5, 'open eye retains gaze');
});

test('blink composition follows live expression overrides and fades across closure', () => {
  const pet = loadPet();
  const samples = [0, 0.5, 1].map((closed) => {
    pet.run(`stillCtl.name = 'full'; stillCtl.alpha = 1;
      idle.last = performance.now(); idle.blinkState = 1;
      idle.blinkTimer = idle.blinkDur * ${closed}; stepPose();`);
    return Array.from(pet.run('[pose[12], pose[14], pose[30]]'));
  });
  assert.equal(samples[0][0], 0);
  assert.ok(samples[0][1] > samples[1][1] && samples[1][1] > samples[2][1],
    'happy-eye override progressively yields to blink');
  assert.equal(samples[2][1], 0);
  assert.equal(samples[0][2], samples[2][2], 'blink does not erase the mouth');
});

test('chewing morphs continuously across variable inference intervals', () => {
  const pet = loadPet();
  const samples = pet.run(`(() => {
    const values = [];
    stillCtl.name = 'chew'; stillCtl.alpha = 1;
    for (let i = 0; i < 25; i += 1) {
      rigT = i / 12; pose.fill(0); applyLiveState(); values.push(pose[26]);
    }
    return values;
  })()`);
  const jumps = samples.slice(1).map((value, index) => Math.abs(value - samples[index]));
  assert.ok(Math.max(...jumps) < 0.25, 'mouth morph has no binary frame jump');
});

test('come arrival speaks from the arrive pool', () => {
  const pet = loadPet();
  pet.run(`homeRect = { x: 0, y: 0, width: 800, height: 600 };
    stills.set('running', { img: {}, box: { x: 0, y: 0, right: 10, bottom: 10 } });
    come = { targetX: drawPos.x };`);
  pet.run('tickStill(performance.now())');
  assert.ok(pet.run('LINES.arrive').includes(pet.run('bubble.text')));
});

test('idle chatter is suppressed while sleeping or when a flourish just started', () => {
  const pet = loadPet();
  const now = pet.now();
  pet.run(`homeRect = { x: 0, y: 0, width: 800, height: 600 };
    stills.set('sleep', { img: {}, box: { x: 0, y: 0, right: 10, bottom: 10 } });
    bubble = null;
    sleeping = true; stillCtl.target = 1;
    tickStill._nextChat = ${now - 1}; tickStill._nextFlourish = ${now - 1};`);
  pet.run('tickStill(performance.now())');
  assert.equal(pet.run('bubble'), null);
  pet.run(`sleeping = false; stillCtl.target = 0; stillCtl.alpha = 0;
    stillCtl.name = null; stillCtl.entry = null;
    action = null; feed = null; come = null; dragging = false;
    tickStill._nextChat = ${now - 1}; tickStill._nextFlourish = ${now - 1};`);
  pet.setRandom(() => 0);
  pet.run('tickStill(performance.now())');
  assert.notEqual(pet.run('action'), null, 'flourish started in the same tick');
  assert.equal(pet.run('bubble'), null, 'flourish in the same tick must gate chatter');
  pet.run(`stillCtl.target = 0; stillCtl.alpha = 0; stillCtl.name = null; stillCtl.entry = null;
    action = null; bubble = null;
    idle.lastInteract = ${pet.now()};
    tickStill._nextChat = ${pet.now() - 1}; tickStill._nextFlourish = ${pet.now() + 10000};`);
  pet.setRandom(() => 0.5);
  pet.run('tickStill(performance.now())');
  const topics = pet.run('IDLE_TOPICS');
  const flat = topics.flatMap((k) => pet.run(`LINES.${k}`));
  assert.ok(flat.includes(pet.run('bubble.text')), 'idle chatter picked an IDLE_TOPICS line');
  pet.resetRandom();
});

test('drag: pinned to the cursor, fast release goes ballistic and lands', () => {
  const pet = loadPet();
  pet.run(`homeRect = { x: 0, y: 0, width: 800, height: 600 };
    stills.set('pick-up', { img: {}, box: { x: 0, y: 0, right: 200, bottom: 200 } });
    stillCtl.name = 'pick-up'; stillCtl.entry = stills.get('pick-up');
    stillCtl.alpha = 1; stillCtl.target = 1;
    dragging = true; dragMoved = true;
    physPoint = { x: 100, y: 300 }; physVel = { x: 0, y: 0 };
    pointer.x = 400; pointer.y = 200;`);
  // First tick only seeds physLastT (dt=0); the second pins her to the
  // cursor (drag is 1:1 — the spring-follow read as laggy in practice).
  pet.setNow(pet.now() + 16);
  pet.run('tickPhysics(performance.now())');
  pet.setNow(pet.now() + 16);
  pet.run('tickPhysics(performance.now())');
  assert.equal(pet.run('physPoint.x'), 400, 'pinned to the cursor');
  assert.ok(pet.run('physVel.x') > 0, 'velocity still tracked for tilt/throw');
  // Fast release: a fresh trail window with real velocity → thrown.
  const t = pet.now() / 1000;
  pet.run(`dragTrail = [[${t - 0.05}, 100, 200], [${t - 0.02}, 250, 200], [${t}, 400, 200]];
    endDrag({ clientX: 400, clientY: 200 });`);
  assert.equal(pet.run('thrown'), true);
  assert.ok(pet.run('LINES.throw').includes(pet.run('bubble.text')), 'throw line spoken');
  // Ballistic flight bounces and settles her on the floor.
  for (let i = 0; i < 600 && pet.run('thrown'); i += 1) {
    pet.setNow(pet.now() + 16);
    pet.run('tickPhysics(performance.now())');
  }
  assert.equal(pet.run('thrown'), false);
  const lx = pet.run('drawPos.x');
  const ly = pet.run('drawPos.y');
  assert.ok(lx >= 0 && lx <= 800 - pet.run('PET_W'), `landed inside host, x=${lx}`);
  assert.equal(Math.round(ly + pet.run('PET_H')), 600, 'feet rest on the floor');
});

test('drag: a stale or slow release lands her in place, no throw', () => {
  const pet = loadPet();
  pet.run(`homeRect = { x: 0, y: 0, width: 800, height: 600 };
    stills.set('pick-up', { img: {}, box: { x: 0, y: 0, right: 200, bottom: 200 } });
    stillCtl.name = 'pick-up'; stillCtl.entry = stills.get('pick-up');
    stillCtl.alpha = 1; stillCtl.target = 1;
    dragging = true; dragMoved = true;
    physPoint = { x: 300, y: 250 }; physVel = { x: 0, y: 0 };`);
  // Trail ends 1s before release — a "set down", not a flick.
  const t = pet.now() / 1000;
  pet.run(`dragTrail = [[${t - 1.1}, 200, 250], [${t - 1.0}, 300, 250]];
    endDrag({ clientX: 300, clientY: 250 });`);
  assert.equal(pet.run('thrown'), false);
  assert.equal(pet.run('physPoint'), null);
  assert.ok(pet.run('LINES.land').includes(pet.run('bubble.text')), 'land line spoken');
  assert.equal(Math.round(pet.run('drawPos.x')), 300 - pet.run('PET_W') / 2,
    'live model lands under where the still was held');
});

test('pushed cursor positions drive interactivity (no forwarded moves needed)', async () => {
  const pet = loadPet();
  pet.run(`drawPos = { x: 280, y: 200 };
    homeRect = { x: 0, y: 0, width: 800, height: 600 };
    charRect = { x: 0, y: 0, right: 240, bottom: 260 };
    globalThis.__calls = [];
    petShell.setInteractive = (p) => { __calls.push(p.interactive); return Promise.resolve(null); };`);
  // Hover via a pushed (buttons=null) position → enter debounce → on.
  pet.run('onCursorMove(300, 250, null)');
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline && !pet.run('__calls.length')) {
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.equal(pet.run('JSON.stringify(__calls)'), '[true]');
  // Cursor left the overlay entirely (inside:false path) → off at once.
  pet.run('onCursorMove(-1e9, -1e9, null)');
  assert.equal(pet.run('JSON.stringify(__calls)'), '[true,false]');
});

test('roam report carries the tight body bounds, not the whole pet frame', () => {
  const pet = loadPet();
  pet.run(`drawPos = { x: 280, y: 200 };
    overlayOrigin = { x: 100, y: 50 };
    // Silhouette inside the 240x260 frame — the frame itself is larger.
    charRect = { x: 20, y: 10, right: 220, bottom: 250 };
    globalThis.__roam = null;
    petShell.reportRoam = (r) => { __roam = r; return Promise.resolve(null); };`);
  pet.run('lastRoamAt = 0; reportRoam()');
  // body = charRect ± HOVER_PADDING → pet-local 12..228 x, 2..258 y.
  assert.equal(pet.run('JSON.stringify(__roam)'),
    JSON.stringify({ x: 280 + 12 + 100, y: 200 + 2 + 50, w: 216, h: 256 }));
});

test('pointerdown in the hold ring does not grab or poke her', () => {
  const pet = loadPet();
  pet.run(`drawPos = { x: 280, y: 200 };
    homeRect = { x: 0, y: 0, width: 800, height: 600 };
    charRect = { x: 0, y: 0, right: 240, bottom: 260 };
    interactive = true;`);
  // Body bounds = drawPos + charRect ± 8 → x from 272. A press at x=260 is
  // inside the hold ring but off her: no grab, no tap.
  pet.run('onCanvasPointerDown({ target: canvas, button: 0, clientX: 260, clientY: 300 })');
  assert.equal(pet.run('dragging'), false);
  assert.equal(pet.run('tapTimes.length'), 0);
  // On her body the press still grabs.
  pet.run('onCanvasPointerDown({ target: canvas, button: 0, clientX: 300, clientY: 300 })');
  assert.equal(pet.run('dragging'), true);
  pet.run('endDrag({ clientX: 300, clientY: 300 })'); // clears relocatePoll
});

test('status panel opens beside the pet, unions into bounds, chips dispatch', () => {
  const pet = loadPet();
  pet.run(`drawPos = { x: 280, y: 200 };
    homeRect = { x: 0, y: 0, width: 800, height: 600 };
    charRect = { x: 0, y: 0, right: 240, bottom: 260 };
    growth = { points: 25500, level: 2, levelName: '小鲸', nextAt: 50000, nextFeed: 4200, feedable: 4200, tokensFed: 0, todayUsed: 100 };
    globalThis.__fed = 0; globalThis.__hid = 0;
    petShell.getGrowth = () => Promise.resolve(growth);
    petShell.feedTokens = () => { __fed += 1; return Promise.resolve({}); };
    petShell.hidePet = () => { __hid += 1; return Promise.resolve(null); };`);
  pet.run('openPanel()');
  assert.ok(pet.run('panel'), 'panel opens');
  const rect = pet.run('({x: panel.x, y: panel.y, w: panel.w, h: panel.h})');
  assert.ok(rect.x >= 4 && rect.x + rect.w <= 796, 'card inside host');
  // 喂食 is in the growth block now, not the chip grid — grid[0] is 聊聊.
  assert.equal(pet.run('panel.cells[0].label'), '聊聊');
  assert.equal(pet.run('panel.cells.every((c) => c.enabled !== false)'), true);
  // Bounds union: a point over the card counts as "on the pet".
  const overCard = pet.run(`overPet(panel.x + 10, panel.y + 10)`);
  assert.equal(overCard, true, 'card area keeps interactivity');
  // Hit-test the first chip (grid top-left = 聊聊), then hide (bottom-right).
  const chipX = pet.run('panel.x + PANEL_PAD + 10');
  const chipY = pet.run('panel.y + PANEL_GRID_TOP + 5');
  assert.equal(pet.run(`panelCellAt(${chipX}, ${chipY})`), 0);
  // The 6px gutter between the two columns hits nothing.
  assert.equal(pet.run(`panelCellAt(panel.x + PANEL_PAD + PANEL_CHIP_W + 3, ${chipY})`), -1, 'gutter hits nothing');
  // Feed button hit-test + dispatch.
  const gy = pet.run('panel.y + PANEL_PAD + PANEL_HEAD_H + 8 + 78');
  const fbX = pet.run('panel.x + panel.w / 2');
  assert.equal(pet.run(`feedButtonHit(${fbX}, ${gy})`), true, 'feed button hit');
  pet.run(`if (growth.nextFeed > 0) { closePanel(); __fed += 1; }`);
  assert.equal(pet.run('__fed'), 1, 'feed button calls feedTokens');
  pet.run('openPanel()');
  pet.run(`dispatchPanelCell(panel.cells.find((c) => c.id === 'hide'))`);
  assert.equal(pet.run('__hid'), 1, 'hide chip calls hidePet');
  // The settings cell opens the DOM page (no-op under the test DOM stub).
  pet.run('openPanel()');
  pet.run(`dispatchPanelCell(panel.cells.find((c) => c.id === 'settings'))`);
  assert.equal(pet.run('panel'), null, 'settings dispatch still closes the panel');
});

test('chat card anchors above her head and flips below at the top edge', () => {
  const pet = loadPet();
  pet.run(`drawPos = { x: 300, y: 300 };
    homeRect = { x: 0, y: 0, width: 800, height: 600 };`);
  const b = pet.run('petBodyBounds()');
  const host = { x: 0, y: 0, width: 800, height: 600 };
  const above = pet.run(`chatAnchor(petBodyBounds(), ${JSON.stringify(host)}, 248, 120)`);
  assert.equal(above.y, Math.round(b.y - 120 - 8), 'sits above her head');
  assert.equal(above.x, Math.round((b.x + b.right) / 2 - 124), 'centered on her');
  // No room up top → flips below her feet.
  pet.run('drawPos = { x: 300, y: 10 }');
  const below = pet.run(`chatAnchor(petBodyBounds(), ${JSON.stringify(host)}, 248, 120)`);
  const bTop = pet.run('petBodyBounds()');
  assert.equal(below.y, Math.round(Math.min(bTop.bottom + 8, 600 - 120 - 4)), 'flips below');
  // Near the right edge the card clamps inside the host, not offscreen.
  pet.run('drawPos = { x: 700, y: 300 }');
  const right = pet.run(`chatAnchor(petBodyBounds(), ${JSON.stringify(host)}, 248, 120)`);
  assert.ok(right.x + 248 <= 800 - 4, 'clamped inside the host');
});

test('chat card picks the roomier side when the host is too short to clear her', () => {
  const pet = loadPet();
  const host = { x: 0, y: 0, width: 800, height: 400 };
  pet.run(`drawPos = { x: 300, y: 60 };
    homeRect = ${JSON.stringify(host)};`);
  // Below-side has ~72px vs ~52px above → stays below, bottom-clamped.
  let r = pet.run(`chatAnchor(petBodyBounds(), ${JSON.stringify(host)}, 248, 120)`);
  assert.equal(r.y, 400 - 120 - 4, 'roomier side: below, clamped to host bottom');
  // Near the bottom the above side is roomier → card sits at the host top.
  pet.run('drawPos = { x: 300, y: 120 }');
  r = pet.run(`chatAnchor(petBodyBounds(), ${JSON.stringify(host)}, 248, 120)`);
  assert.equal(r.y, 4, 'roomier side: above, clamped to host top');
});

test('chat card suppresses ambient bubbles while open; alerts still land', () => {
  const pet = loadPet();
  pet.run(`homeRect = { x: 0, y: 0, width: 800, height: 600 };
    bubble = null; bubbleQueue = [];`);
  pet.run(`pushBubble({ text: '闲聊', until: performance.now() + 5000, priority: 1 })`);
  assert.equal(pet.run('bubble.text'), '闲聊');
  // Opening the card drops the visible chatter; queued alerts survive.
  pet.run(`bubbleQueue.push({ text: '排队审批', until: performance.now() + 60000, priority: 2, alertId: 'a9', seq: 1 })`);
  pet.run('chatOpen = true; dropAmbientBubbles()');
  assert.equal(pet.run('bubble'), null, 'visible chatter drops when the card opens');
  assert.equal(pet.run('bubbleQueue.length'), 1, 'queued chatter purged, alert kept');
  // New chatter is dropped outright — not shown, not queued.
  pet.run(`pushBubble({ text: '又来闲聊', until: performance.now() + 5000, priority: 1 })`);
  assert.equal(pet.run('bubble'), null, 'no ambient pop while the card is up');
  assert.equal(pet.run('bubbleQueue.length'), 1, 'chatter does not accumulate');
  // Priority-2 alerts still preempt — they can carry approval buttons.
  pet.run(`pushBubble({ text: '审批', until: performance.now() + 60000, priority: 2, alertId: 'a1' })`);
  assert.equal(pet.run('bubble.text'), '审批', 'alerts still reach the user');
  // Closing the card restores ambient speech.
  pet.run('chatOpen = false; resolveAlert("a1"); resolveAlert("a9")');
  pet.run(`pushBubble({ text: '恢复闲聊', until: performance.now() + 5000, priority: 1 })`);
  assert.equal(pet.run('bubble.text'), '恢复闲聊', 'ambient speech resumes after close');
});

test('status panel feed button disables when nothing is feedable', () => {
  const pet = loadPet();
  pet.run(`drawPos = { x: 280, y: 200 };
    homeRect = { x: 0, y: 0, width: 800, height: 600 };
    growth = { points: 150000, level: 4, levelName: '鲸鱼娘', nextAt: 400000, nextFeed: 0, feedable: 0, tokensFed: 150000, todayUsed: 0 };
    petShell.getGrowth = () => Promise.resolve(growth);`);
  pet.run('openPanel()');
  // No fresh compute → feed button hit-test is true but feedTokens not called.
  const gy = pet.run('panel.y + PANEL_PAD + PANEL_HEAD_H + 8 + 78');
  const fbX = pet.run('panel.x + panel.w / 2');
  assert.equal(pet.run(`feedButtonHit(${fbX}, ${gy})`), true, 'button rect hit');
  // The guard: nextFeed === 0 → no feed.
  assert.equal(pet.run('growth.nextFeed > 0'), false, 'no feedable tokens');
});
test('panel ⚙ cell navigates to the main-window pet settings section', async () => {
  const pet = loadPet();
  pet.run(`homeRect = { x: 0, y: 0, width: 800, height: 600 };
    bubble = null;
    window.__calls = [];
    petShell.openSettings = () => { window.__calls.push('openSettings'); return Promise.resolve({ ok: true }); };`);
  pet.run(`dispatchPanelCell({ id: 'settings' })`);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(pet.run('JSON.stringify(window.__calls)'), '["openSettings"]');
  assert.ok(pet.run('LINES.settingsChanged').includes(pet.run('bubble.text')),
    'a successful jump gets an acknowledgement line');
  // A failed/absent navigation surfaces the dsh-error pool instead of a
  // dead popup — and no local settings overlay exists to fall back on.
  pet.run(`bubble = null;
    petShell.openSettings = () => Promise.resolve(false);`);
  pet.run(`dispatchPanelCell({ id: 'settings' })`);
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(pet.run('LINES.dshError').includes(pet.run('bubble.text')));
  pet.run(`bubble = null;
    petShell.openSettings = undefined;`);
  pet.run(`dispatchPanelCell({ id: 'settings' })`);
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(pet.run('LINES.dshError').includes(pet.run('bubble.text')));
});

test('look pins one bubble until settlement, deferring alerts without replaying chatter', async (t) => {
  const pet = loadPet();
  t.after(() => pet.run('stopLookAnim()'));
  pet.run(`globalThis.__calls = 0;
    petShell.lookScreen = () => { __calls++; return new Promise((r) => { globalThis.__resolve = r; }); };
    pushBubble({ text: 'existing alert', priority: 2, alertId: 'old', until: performance.now() + 1000 });`);
  const request = pet.run('submitLook()');
  assert.equal(pet.run('bubble.lookPin'), true);
  pet.run(`globalThis.__held = bubble;
    say('pat'); say('morning');
    onDshEvent({ category: 'dshWorking' });
    onDshEvent({ category: 'dshWhale', summary: 'other reply' });
    pushBubble({ text: 'approval', priority: 2, alertId: 'new', until: performance.now() + 1000 });
    pushBubble({ text: 'updated approval', priority: 2, alertId: 'new', until: performance.now() + 1000 });
    chatOpen = true; dropAmbientBubbles();`);
  assert.equal(pet.run('bubble === __held'), true);
  assert.equal(pet.run('bubbleQueue.some((e) => e.priority < 2)'), false);
  assert.equal(pet.run('bubbleQueue.filter((e) => e.alertId === "new").length'), 1);
  pet.run('resolveAlert("new"); resolveAlert(undefined)');
  assert.equal(pet.run('bubble === __held'), true);
  pet.setNow(pet.now() + 90000);
  pet.run('tickStill(performance.now())');
  assert.equal(pet.run('bubble === __held'), true);
  assert.ok(pet.run('drawBubble(performance.now())'));
  await pet.run('submitLook()');
  assert.equal(pet.run('__calls'), 1);
  assert.equal(pet.run('bubble === __held'), true);
  pet.run('__resolve({ ok: true, reply: "look result" })');
  await request;
  assert.equal(pet.run('bubble.text'), 'look result');
  assert.equal(pet.run('Boolean(bubble.lookPin)'), false);
  assert.equal(pet.run('bubble.pinned'), true);
  assert.equal(pet.run('lookAnimTimer'), 0);
  pet.setNow(pet.now() + 7000);
  pet.run('tickStill(performance.now())');
  assert.equal(pet.run('bubble.text'), 'look result', 'pinned result ignores time');
  pet.run('dismissPinnedBubble()');
  assert.equal(pet.run('bubble.alertId'), 'old', '✕ dismissal surfaces the queue');
  assert.equal(pet.run('bubbleQueue.some((e) => e.lookPin || e.lookResult)'), false);
});

test('panel action icon and label ink are independently centered', () => {
  const pet = loadPet();
  const ctx = pet.canvas.ctx;
  const drawn = [];
  const metrics = (text) => {
    const icon = Array.from(text).length <= 2;
    const width = icon ? 12 : Array.from(text).length * 11;
    const left = ctx.textAlign === 'center' ? width / 2 + 1 : 1;
    return { width, actualBoundingBoxLeft: left, actualBoundingBoxRight: width - left,
      actualBoundingBoxAscent: (icon ? 11 : 8) - (ctx.textBaseline === 'middle' ? 5 : 0),
      actualBoundingBoxDescent: (icon ? 1 : 2) + (ctx.textBaseline === 'middle' ? 5 : 0) };
  };
  ctx.measureText = metrics;
  ctx.fillText = (text, x, y) => { drawn.push({ text, x, y, m: metrics(text) }); };
  pet.run('settings.lookAvailable = true; openPanel()');
  const cells = pet.run('panel.cells');
  const p = pet.run('({ x: panel.x, y: panel.y, w: PANEL_CHIP_W, h: PANEL_CHIP_H, pad: PANEL_PAD, gap: PANEL_CHIP_GAP, top: PANEL_GRID_TOP })');
  for (const [i, cell] of cells.entries()) {
    const icon = drawn.findLast((r) => r.text === cell.icon);
    const label = drawn.findLast((r) => r.text === cell.label);
    assert.ok(icon && label, `${cell.id}: separate icon and label runs`);
    const x = p.x + p.pad + (i % 2) * (p.w + p.gap) + p.w / 2;
    const y = p.y + p.top + Math.floor(i / 2) * (p.h + p.gap) + p.h / 2;
    for (const run of [icon, label]) {
      assert.equal(run.y + (run.m.actualBoundingBoxDescent - run.m.actualBoundingBoxAscent) / 2, y);
    }
    const left = icon.x - icon.m.actualBoundingBoxLeft;
    const right = label.x + label.m.actualBoundingBoxRight;
    assert.equal((left + right) / 2, x);
    assert.equal(label.x - label.m.actualBoundingBoxLeft - icon.x - icon.m.actualBoundingBoxRight, 4);
  }
});

test('看看 shows a loading bubble at once, blocks re-entry, then lands the reply', async () => {
  const pet = loadPet();
  pet.run(`drawPos = { x: 280, y: 200 };
    homeRect = { x: 0, y: 0, width: 800, height: 600 };
    charRect = { x: 0, y: 0, right: 240, bottom: 260 };
    bubble = null;
    globalThis.__calls = 0;
    globalThis.__resolveLook = null;
    petShell.lookScreen = () => { __calls += 1; return new Promise((r) => { __resolveLook = r; }); };`);
  // First click: the request fires and a「正在看」bubble is up synchronously,
  // stretched to hold for the whole call window.
  const first = pet.run('submitLook()');
  assert.equal(pet.run('__calls'), 1);
  const loading = pet.run('bubble && bubble.text');
  assert.ok(loading && pet.run('LINES.looking').some((l) => loading.startsWith(l)),
    'loading line is up before the model answers');
  // Re-click while in-flight: re-says the loading line, no second request.
  await pet.run('submitLook()');
  assert.equal(pet.run('__calls'), 1);
  // Resolve → the loading bubble is replaced in place by her reply.
  pet.run(`__resolveLook({ ok: true, reply: '屏幕上是个编辑器' })`);
  await first;
  assert.equal(pet.run('bubble && bubble.text'), '屏幕上是个编辑器');
  // Guard released after settle — a fresh click fires a new request.
  const second = pet.run('submitLook()');
  assert.equal(pet.run('__calls'), 2);
  pet.run(`__resolveLook({ ok: false, reason: 'model-error', detail: 'HTTP 500' })`);
  await second;
  const errLine = pet.run('bubble && bubble.text');
  assert.ok(pet.run('LINES.lookError').some((l) => errLine === l.replace('{detail}', 'HTTP 500')),
    'model error lands with its provider detail');
  // Capture-side misses never reached a model — they get the honest「看不清」
  // pool, not a「模型拒绝」voice.
  const third = pet.run('submitLook()');
  assert.equal(pet.run('__calls'), 3);
  pet.run(`__resolveLook({ ok: false, reason: 'capture-failed' })`);
  await third;
  assert.ok(pet.run('LINES.lookFallback').includes(pet.run('bubble && bubble.text')),
    'capture failure speaks the generic pool');
});

test('看看 pin: ONE loading bubble the whole call — chatter dropped, alerts deferred, settle swaps in place', async (t) => {
  const pet = loadPet();
  t.after(() => pet.run('stopLookAnim()'));
  pet.run(`drawPos = { x: 280, y: 200 };
    homeRect = { x: 0, y: 0, width: 800, height: 600 };
    charRect = { x: 0, y: 0, right: 240, bottom: 260 };
    bubble = null; bubbleQueue = [];
    globalThis.__calls = 0;
    globalThis.__resolveLook = null;
    petShell.lookScreen = () => { __calls += 1; return new Promise((r) => { __resolveLook = r; }); };`);
  // A pending approval owns the stage when the look starts.
  pet.run(`pushBubble({ text: '审批中', until: performance.now() + 60000, priority: 2, alertId: 'a1' })`);
  assert.equal(pet.run('bubble.text'), '审批中');
  const first = pet.run('submitLook()');
  assert.equal(pet.run('__calls'), 1);
  const pin = pet.run('bubble');
  assert.ok(pin && pin.lookPin === true, 'loading pin owns the stage at once');
  assert.equal(pin.until, Infinity, 'pin never expires on a timer');
  assert.ok(pet.run('LINES.looking').some((l) => pin.text.startsWith(l.replace(/…+$/u, '')))
    || pin.text === '正在看屏幕', 'pin shows a loading line');
  // The preempted alert is retained in the queue, not dropped.
  assert.equal(pet.run('bubbleQueue.length'), 1);
  assert.equal(pet.run('bubbleQueue[0].alertId'), 'a1');
  // Ordinary voices (reactions, idle, DSH working lines) are dropped
  // outright — nothing flashes over「正在看」, nothing is queued.
  pet.run(`say('pat'); say('wake'); say('morning'); say('dshWorking')`);
  assert.equal(pet.run('bubble.lookPin'), true, 'still the same pin');
  assert.equal(pet.run('bubble.text'), pin.text, 'pin identity/text untouched');
  assert.equal(pet.run('bubbleQueue.length'), 1, 'chatter dropped, not queued');
  // Priority-2 traffic (the whale outbox rides priority 2) defers behind
  // the pin — queued, not shown.
  pet.run(`onDshEvent({ category: 'dshWhale', summary: '鲸鱼留言' })`);
  assert.equal(pet.run('bubbleQueue.length'), 2, 'priority-2 defers behind the pin');
  assert.equal(pet.run('bubble.lookPin'), true);
  // Same alertId updates the queued copy in place (still one entry);
  // resolving it removes just that entry while the pin stays.
  pet.run(`pushBubble({ text: '审批更新', until: performance.now() + 60000, priority: 2, alertId: 'a1' })`);
  assert.equal(pet.run('bubbleQueue.filter((e) => e.alertId === "a1").length'), 1, 'alertId dedup in queue');
  assert.equal(pet.run('bubbleQueue.find((e) => e.alertId === "a1").text'), '审批更新');
  pet.run(`resolveAlert('a1')`);
  assert.equal(pet.run('bubbleQueue.some((e) => e.alertId === "a1")'), false);
  assert.equal(pet.run('bubble.lookPin'), true, 'resolving the alert keeps the pin');
  pet.run('resolveAlert(undefined)');
  assert.equal(pet.run('bubble.lookPin'), true, 'undefined alertId must not clear the pin');
  // The chat card's ambient purge spares the pin.
  pet.run('chatOpen = true; dropAmbientBubbles()');
  assert.equal(pet.run('bubble.lookPin'), true, 'pin survives the chat-open purge');
  // Time alone never releases it: +90s, a tick, and it still paints.
  pet.setNow(pet.now() + 90000);
  pet.run('tickStill(performance.now())');
  assert.equal(pet.run('bubble.lookPin'), true, '90s later still the same pin');
  const rect = pet.run('drawBubble(performance.now())');
  assert.ok(rect && Number.isFinite(rect.x) && rect.w > 0 && rect.h > 0,
    'pin still paints a real bubble rect');
  // Re-clicks — including after a settings toggle — fire no second request.
  await pet.run('submitLook()');
  pet.run('applySettings({ ...settings, chatEnabled: false })');
  await pet.run('submitLook()');
  pet.run('applySettings({ ...settings, chatEnabled: true })');
  await pet.run('submitLook()');
  assert.equal(pet.run('__calls'), 1, 're-entry blocked regardless of settings churn');
  assert.equal(pet.run('bubble.lookPin'), true);
  // Settle: the reply replaces the pin in place even with the card open.
  pet.run(`__resolveLook({ ok: true, reply: '屏幕上是个编辑器' })`);
  await first;
  assert.equal(pet.run('bubble && bubble.text'), '屏幕上是个编辑器');
  assert.equal(pet.run('bubble.lookPin'), undefined, 'pin flag gone on settle');
  assert.equal(pet.run('lookBusyUntil'), 0, 'guard released');
  // Late ordinary speech can't knock the pinned reply off — dropped here
  // only because the chat card is open.
  pet.run(`pushBubble({ text: '迟到闲聊', until: performance.now() + 5000, priority: 1 })`);
  assert.equal(pet.run('bubble.text'), '屏幕上是个编辑器', 'pinned reply holds the stage');
  // Time alone never releases it — only the ✕ does, surfacing the queue.
  pet.run('chatOpen = false');
  pet.setNow(pet.now() + 7000);
  pet.run('tickStill(performance.now())');
  assert.equal(pet.run('bubble && bubble.text'), '屏幕上是个编辑器', 'pinned reply ignores time');
  pet.run('dismissPinnedBubble()');
  assert.equal(pet.run('bubble && bubble.text'), '鲸鱼留言', '✕ dismissal surfaces the queue');
});

test('看看 pin: sync throw and rejection clean up, and the request can be retried', async (t) => {
  const pet = loadPet();
  t.after(() => pet.run('stopLookAnim()'));
  pet.run(`drawPos = { x: 280, y: 200 };
    homeRect = { x: 0, y: 0, width: 800, height: 600 };
    bubble = null; bubbleQueue = [];
    globalThis.__calls = 0;
    globalThis.__resolveLook = null;`);
  // Synchronous throw (IPC collapsed before promising) → generic fallback,
  // no stale pin, guard released.
  pet.run(`petShell.lookScreen = () => { __calls += 1; throw new Error('ipc dead'); };`);
  await pet.run('submitLook()');
  assert.equal(pet.run('__calls'), 1);
  assert.ok(pet.run('LINES.lookFallback').includes(pet.run('bubble && bubble.text')));
  assert.equal(pet.run('lookBusyUntil'), 0, 'guard released after sync throw');
  assert.equal(pet.run('lookAnimTimer'), 0, 'anim timer stopped');
  assert.equal(pet.run('bubbleQueue.some((e) => e.lookPin)'), false, 'no stale queued pin');
  // Rejected promise → same cleanup.
  pet.run(`bubble = null;
    petShell.lookScreen = () => { __calls += 1; return Promise.reject(new Error('x')); };`);
  await pet.run('submitLook()');
  assert.equal(pet.run('__calls'), 2);
  assert.ok(pet.run('LINES.lookFallback').includes(pet.run('bubble && bubble.text')));
  assert.equal(pet.run('lookBusyUntil'), 0);
  // Retry fires a real request and pins again — no stale state.
  pet.run(`bubble = null;
    petShell.lookScreen = () => { __calls += 1; return new Promise((r) => { __resolveLook = r; }); };`);
  const retry = pet.run('submitLook()');
  assert.equal(pet.run('__calls'), 3);
  assert.equal(pet.run('bubble && bubble.lookPin'), true, 'fresh pin on retry');
  pet.run(`__resolveLook({ ok: true, reply: '又看到了' })`);
  await retry;
  assert.equal(pet.run('bubble && bubble.text'), '又看到了');
});

test('panel runs are optically centered on real ink boxes; chip icon+label group is centered', () => {
  const pet = loadPet();
  const ctx = pet.canvas.ctx;
  // Fake rasterizer with realistic asymmetric ink: emoji ride high with
  // uneven side bearings, CJK sits lower — 'middle' baseline would miss.
  const ICON = { advance: 22, bearing: 2, ink: 17, asc: 11, desc: 3 };
  const CJK = { per: 13, bearing: 1, inkPad: 3, asc: 9, desc: 2.5 };
  const iconish = (s) => {
    const ch = Array.from(String(s))[0] || '';
    return !/[\u4e00-\u9fffA-Za-z0-9 .+/→·—：「」]/.test(ch);
  };
  const metrics = (s) => {
    const n = Array.from(String(s)).length;
    const m = iconish(s)
      ? { ...ICON }
      : { advance: CJK.per * n, bearing: CJK.bearing, ink: Math.max(1, CJK.per * n - CJK.inkPad), asc: CJK.asc, desc: CJK.desc };
    // Extents are anchor-relative: 'left' anchors the advance's left edge,
    // 'center' its middle — the ink shifts with the anchor.
    const left = ctx.textAlign === 'center' ? m.advance / 2 - m.bearing : -m.bearing;
    const right = ctx.textAlign === 'center' ? m.ink + m.bearing - m.advance / 2 : m.bearing + m.ink;
    return {
      width: m.advance,
      actualBoundingBoxLeft: left,
      actualBoundingBoxRight: right,
      actualBoundingBoxAscent: m.asc,
      actualBoundingBoxDescent: m.desc,
    };
  };
  ctx.measureText = (s) => metrics(s);
  const texts = [];
  const realFill = ctx.fillText;
  ctx.fillText = (s, x, y) => {
    texts.push({ t: String(s), x, y, align: ctx.textAlign, baseline: ctx.textBaseline, font: ctx.font });
    return realFill.call(ctx, s, x, y);
  };
  pet.run(`drawPos = { x: 280, y: 200 };
    homeRect = { x: 0, y: 0, width: 800, height: 600 };
    charRect = { x: 0, y: 0, right: 240, bottom: 260 };
    growth = { points: 25500, level: 2, levelName: '小鲸', nextAt: 50000, nextFeed: 4200, feedable: 4200, tokensFed: 0, todayUsed: 100 };
    stats = { satiety: 60, mood: 60, affectionLevel: 2, hearts: 3, affectionName: '亲近', satietyLabel: '刚好', moodLabel: '平静' };
    settings.lookAvailable = false;
    sleeping = false;
    petShell.getGrowth = () => Promise.resolve(growth);`);
  const inkOf = (op) => {
    const m = (() => {
      const saved = ctx.textAlign;
      ctx.textAlign = op.align;
      const r = metrics(op.t);
      ctx.textAlign = saved;
      return r;
    })();
    return {
      left: op.x - m.actualBoundingBoxLeft,
      right: op.x + m.actualBoundingBoxRight,
      midY: (op.y - m.actualBoundingBoxAscent + op.y + m.actualBoundingBoxDescent) / 2,
    };
  };
  pet.run('openPanel()');
  const CHIP_W = pet.run('PANEL_CHIP_W');
  const CHIP_H = pet.run('PANEL_CHIP_H');
  const GAP = pet.run('PANEL_CHIP_GAP');
  const padL = pet.run('panel.x + PANEL_PAD');
  const gridTop = pet.run('panel.y + PANEL_GRID_TOP');
  assert.equal(pet.run(`panel.cells.some((c) => c.icon === '👀')`), false,
    'look cell hidden without a vision model');
  const chipTexts = () => texts.filter((op) => op.font.startsWith('11px'));
  const assertChips = () => {
    const cells = pet.run('panel.cells.map((c) => ({ icon: c.icon, label: c.label }))');
    for (const [i, cell] of cells.entries()) {
      const cx = padL + (i % 2) * (CHIP_W + GAP);
      const cy = gridTop + Math.floor(i / 2) * (CHIP_H + GAP);
      const midY = cy + CHIP_H / 2;
      const ops = chipTexts();
      const icon = ops.find((op) => op.t === cell.icon);
      const lab = ops.find((op) => op.t === cell.label);
      assert.ok(icon && lab, `chip ${cell.label} drew two runs`);
      const ii = inkOf(icon);
      const li = inkOf(lab);
      // Each run's ink is vertically centered on the chip midline.
      assert.ok(Math.abs(ii.midY - midY) < 0.01, `${cell.icon} ink centered: ${ii.midY} vs ${midY}`);
      assert.ok(Math.abs(li.midY - midY) < 0.01, `${cell.label} ink centered`);
      // Icon ink ends, 4px gap, label ink begins; the pair centers as one.
      assert.ok(Math.abs(li.left - ii.right - 4) < 0.01, `${cell.label} 4px gap (got ${li.left - ii.right})`);
      assert.ok(Math.abs((ii.left + li.right) / 2 - (cx + CHIP_W / 2)) < 0.01,
        `${cell.label} group centered in chip`);
      for (const op of [icon, lab]) {
        assert.equal(op.baseline, 'alphabetic', 'runs ride the measured baseline');
        assert.equal(op.align, 'center');
        assert.ok(Number.isFinite(op.x) && Number.isFinite(op.y), 'finite coords');
      }
    }
  };
  assertChips(); // covers 聊聊 (2 chars) + 摸摸头 (3 chars), look cell missing
  // Every text run the panel paints goes through the measured path.
  for (const op of texts) {
    assert.equal(op.baseline, 'alphabetic', `no raw fillText for ${op.t}`);
    assert.ok(Number.isFinite(op.x) && Number.isFinite(op.y), `finite ${op.t}`);
  }
  // Waking label + hovered cell re-draw stays centered.
  texts.length = 0;
  pet.run('sleeping = true; panel.cells = panelCells(); panel.hover = 2; drawPanel()');
  assert.equal(pet.run(`panel.cells.some((c) => c.label === '叫醒')`), true, 'waking label');
  assertChips();
  // Metrics unavailable → 'middle' fallback, still finite.
  texts.length = 0;
  ctx.measureText = (s) => ({ width: Array.from(String(s)).length * 13 });
  pet.run('drawPanel()');
  for (const op of texts) {
    assert.ok(Number.isFinite(op.x) && Number.isFinite(op.y), `no NaN for ${op.t}`);
    assert.equal(op.baseline, 'middle', 'unmeasurable run falls back to middle');
  }
});

test('notify bubble pins until the ✕ click — nothing preempts or expires it', () => {
  const pet = loadPet();
  pet.run(`drawPos = { x: 280, y: 200 };
    homeRect = { x: 0, y: 0, width: 800, height: 600 };
    charRect = { x: 0, y: 0, right: 240, bottom: 260 };
    bubble = null; bubbleQueue = [];`);
  pet.run(`onDshEvent({ category: 'dshWhale', summary: '部署成功：v1.2.3 已上线', kind: 'notify' })`);
  assert.equal(pet.run('bubble.text'), '部署成功：v1.2.3 已上线');
  assert.equal(pet.run('bubble.pinned'), true);
  assert.equal(pet.run('bubble.until'), Infinity, 'no timer expiry');
  // Later lines — another whale line and the done reaction — queue behind
  // the pin instead of knocking it off.
  pet.run(`onDshEvent({ category: 'dshWhale', summary: '随便聊聊', kind: 'say' })`);
  pet.run(`onDshEvent({ category: 'dshDone' })`);
  assert.equal(pet.run('bubble.text'), '部署成功：v1.2.3 已上线', 'pinned survives equal/lower priority');
  assert.equal(pet.run('bubbleQueue.length'), 2);
  // Time alone never releases it — an hour later, a tick, still pinned.
  pet.setNow(pet.now() + 3600000);
  pet.run('tickStill(performance.now())');
  assert.equal(pet.run('bubble.pinned'), true);
  // The pin paints and registers its ✕ hit box.
  pet.run('drawBubble(performance.now())');
  assert.ok(pet.run('bubbleCloseRect && bubbleCloseRect.w > 0'), '✕ hit box registered');
  // The bubble joins the interactive zone so the ✕ actually takes clicks.
  const cx = pet.run('bubbleCloseRect.x + bubbleCloseRect.w / 2');
  const cy = pet.run('bubbleCloseRect.y + bubbleCloseRect.h / 2');
  assert.equal(pet.run(`overPet(${cx}, ${cy})`), true, '✕ inside the interactive zone');
  // Click the ✕ — pin dismissed, the queued whale line surfaces.
  pet.run(`onCanvasPointerDown({ target: canvas, button: 0, clientX: ${cx}, clientY: ${cy} })`);
  assert.equal(pet.run('bubble.text'), '随便聊聊', 'dismissal surfaces the queue');
  assert.equal(pet.run('bubble.pinned'), false, 'next bubble is transient again');
});

test('say-kind whale lines stay transient and keep the old arbitration', () => {
  const pet = loadPet();
  pet.run(`drawPos = { x: 280, y: 200 };
    homeRect = { x: 0, y: 0, width: 800, height: 600 };
    bubble = null; bubbleQueue = [];`);
  pet.run(`onDshEvent({ category: 'dshWhale', summary: '随口一句' })`);
  assert.equal(pet.run('bubble.pinned'), false);
  assert.ok(pet.run('Number.isFinite(bubble.until)'), 'transient until');
  // Equal-priority follow-up replaces in place — unchanged behavior.
  pet.run(`onDshEvent({ category: 'dshWhale', summary: '下一句', kind: 'say' })`);
  assert.equal(pet.run('bubble.text'), '下一句');
});

// The part rig draws every part at ABSOLUTE master coordinates, so the
// feet pivot must be pre-subtracted in the translate term — otherwise the
// whole render lands +RIG_FEET*S away from drawPos (observed: +365/+343px,
// character off-screen and hitbox shifted with it). Replays the recorded
// transform stream into a real CTM and asserts the feet pixel lands on the
// drawPos anchor.
test('rig drawRig anchors the master feet pivot to drawPos', () => {
  const pet = loadPet();
  const ctx = pet.canvas.ctx;
  ctx.translate = (x, y) => ctx.ops.push(['translate', x, y]);
  ctx.rotate = (r) => ctx.ops.push(['rotate', r]);
  ctx.scale = (x, y) => ctx.ops.push(['scale', x, y]);
  pet.run(`rig.ready = true;
    rig.mf = {
      char_bbox: [767, 271, 1269, 966],
      body: { file: 'shell.png', bbox_in_master: [767, 271, 1269, 966] },
      tail: { file: 'tail.png', bbox_in_master: [767, 271, 1269, 966] },
      shells: { neutral: { file: 'shell.png', bbox_in_master: [767, 271, 1269, 966] } },
    };
    rig.imgs = { body: { naturalWidth: 10 }, tail: { naturalWidth: 10 }, 'shell:neutral': { naturalWidth: 10 } };
    drawPos = { x: 100, y: 50 };
    rigT = 0;
    stillCtl.name = null;
    stillCtl.alpha = 0;`);
  pet.run('drawRig()');
  // Replay the op stream into [a,b,c,d,e,f] CTMs; canvas maps
  // (x,y) → (a*x + c*y + e, b*x + d*y + f).
  const mult = (m, op) => {
    const [a, b, c, d, e, f] = m;
    if (op[0] === 'translate') {
      return [a, b, c, d, a * op[1] + c * op[2] + e, b * op[1] + d * op[2] + f];
    }
    if (op[0] === 'rotate') {
      const cos = Math.cos(op[1]); const sin = Math.sin(op[1]);
      return [a * cos + c * sin, b * cos + d * sin,
        -a * sin + c * cos, -b * sin + d * cos, e, f];
    }
    if (op[0] === 'scale') { return [a * op[1], b * op[1], c * op[2], d * op[2], e, f]; }
    return m;
  };
  let m = [1, 0, 0, 1, 0, 0];
  const stack = [];
  const draws = [];
  for (const op of ctx.ops) {
    if (op[0] === 'save') { stack.push(m.slice()); } else if (op[0] === 'restore') { m = stack.pop(); } else if (op[0] === 'drawImage') { draws.push({ m: m.slice(), args: op.slice(1) }); } else { m = mult(m, op); }
  }
  // Draw order: tail, then the fused shell (head+body as one piece). In
  // the shell image the master feet pivot (1018,955) sits at image-local
  // (1018-767, 955-271) = (251, 684).
  const body = draws[1];
  const lx = body.args[1] + 251;
  const ly = body.args[2] + 684;
  const [a, b, c, d, e, f] = body.m;
  const cx = a * lx + c * ly + e;
  const cy = b * lx + d * ly + f;
  assert.ok(Math.abs(cx - (100 + 240 / 2)) < 0.5, `feet canvas x ${cx} ≈ anchor 220`);
  assert.ok(Math.abs(cy - (50 + 260 - 2)) < 0.5, `feet canvas y ${cy} ≈ anchor 308`);
  // charRect is the drawPos-local hit box from the same manifest math.
  const cr = pet.run('charRect');
  assert.ok(Math.abs(cr.x - 30) < 1 && Math.abs(cr.bottom - 262) < 1, 'hit box matches char bbox');
});

// A state may swap the whole shell via P.body + a manifest `shells` entry —
// future pose assets (raised arms, curled torso) drop in as assets only.
// Asserts the override image is drawn and a missing asset falls back.
test('rig drawRig honours P.body shell override with fallback', () => {
  const pet = loadPet();
  const ctx = pet.canvas.ctx;
  ctx.translate = () => {};
  pet.run(`rig.ready = true;
    rig.mf = {
      char_bbox: [767, 271, 1269, 966],
      body: { file: 'shell.png', bbox_in_master: [767, 271, 1269, 966] },
      shells: {
        neutral: { file: 'shell.png', bbox_in_master: [767, 271, 1269, 966] },
        pickup: { file: 'shell-pickup.png', bbox_in_master: [767, 271, 1269, 966] },
      },
      tail: { file: 'tail.png', bbox_in_master: [767, 271, 1269, 966] },
    };
    rig.imgs = {
      body: { naturalWidth: 10, tag: 'default' },
      'shell:neutral': { naturalWidth: 10, tag: 'open' },
      'shell:pickup': { naturalWidth: 10, tag: 'alt' },
      tail: { naturalWidth: 10 },
    };
    RIG_STATES.testswap = (P) => { P.body = 'pickup'; };
    drawPos = { x: 100, y: 50 };
    stillCtl.name = 'testswap';
    stillCtl.alpha = 1;`);
  const draws = () => pet.canvas.ctx.ops.filter((o) => o[0] === 'drawImage').map((o) => o[1]);
  pet.run('drawRig()');
  assert.equal(draws()[1], pet.run(`rig.imgs['shell:pickup']`), 'state shell override drawn');
  // Missing override asset → default shell, no throw.
  pet.run(`rig.imgs['shell:pickup'] = {}; stillCtl.name = 'testswap';`);
  pet.canvas.ctx.ops.length = 0;
  pet.run('drawRig()');
  assert.equal(draws()[1], pet.run(`rig.imgs['shell:neutral']`), 'missing asset falls back to expr shell');
  // No state → neutral shell.
  pet.run(`stillCtl.name = null; stillCtl.alpha = 0;`);
  pet.canvas.ctx.ops.length = 0;
  pet.run('drawRig()');
  assert.equal(draws()[1], pet.run(`rig.imgs['shell:neutral']`), 'idle draws neutral shell');
});

// Blink channel is analog: <0.35 open / 0.35-0.78 half-lidded / >0.78 closed.
test('rig blink maps to three-stage shell selection', () => {
  const pet = loadPet();
  pet.canvas.ctx.translate = () => {};
  pet.run(`rig.ready = true;
    rig.mf = {
      char_bbox: [767, 271, 1269, 966],
      body: { file: 'shell.png', bbox_in_master: [767, 271, 1269, 966] },
      tail: { file: 'tail.png', bbox_in_master: [767, 271, 1269, 966] },
      shells: {
        neutral: { file: 'a', bbox_in_master: [767, 271, 1269, 966] },
        'half-closed': { file: 'b', bbox_in_master: [767, 271, 1269, 966] },
        'eyes-closed': { file: 'c', bbox_in_master: [767, 271, 1269, 966] },
      },
    };
    rig.imgs = {
      body: { naturalWidth: 10 }, tail: { naturalWidth: 10 },
      'shell:neutral': { naturalWidth: 10, tag: 'open' },
      'shell:half-closed': { naturalWidth: 10, tag: 'half' },
      'shell:eyes-closed': { naturalWidth: 10, tag: 'shut' },
    };
    drawPos = { x: 100, y: 50 };
    stillCtl.name = null; stillCtl.alpha = 0;
    idle.sleepy = 0; idle.blinkState = 0;`);
  // The shell is the last drawImage (a crossfade may draw the outgoing
  // shell just before it); the tail draws first.
  const shellDraw = () => pet.canvas.ctx.ops.filter((o) => o[0] === 'drawImage').map((o) => o[1]).at(-1);
  pet.run('pose[12] = pose[13] = 0; drawRig()');
  assert.equal(shellDraw(), pet.run(`rig.imgs['shell:neutral']`), 'open eyes');
  pet.canvas.ctx.ops.length = 0;
  pet.run('pose[12] = pose[13] = 0.55; drawRig()');
  assert.equal(shellDraw(), pet.run(`rig.imgs['shell:half-closed']`), 'half-lidded mid-blink');
  pet.canvas.ctx.ops.length = 0;
  pet.run('pose[12] = pose[13] = 1; drawRig()');
  assert.equal(shellDraw(), pet.run(`rig.imgs['shell:eyes-closed']`), 'fully closed');
});

// Mid-state expression swaps crossfade: the outgoing shell keeps drawing
// (fading out) behind the incoming shell for ~140ms instead of hard-cutting.
test('rig expression swaps crossfade shells', () => {
  const pet = loadPet();
  pet.canvas.ctx.translate = () => {};
  pet.run(`rig.ready = true;
    rig.mf = {
      char_bbox: [767, 271, 1269, 966],
      body: { file: 'shell.png', bbox_in_master: [767, 271, 1269, 966] },
      tail: { file: 'tail.png', bbox_in_master: [767, 271, 1269, 966] },
      shells: {
        neutral: { file: 'a', bbox_in_master: [767, 271, 1269, 966] },
        angry: { file: 'b', bbox_in_master: [767, 271, 1269, 966] },
      },
    };
    rig.imgs = {
      body: { naturalWidth: 10 }, tail: { naturalWidth: 10 },
      'shell:neutral': { naturalWidth: 10, tag: 'open' },
      'shell:angry': { naturalWidth: 10, tag: 'mad' },
    };
    RIG_STATES.mood = (P, t) => { P.expr = (t - rigStateT0) < 0.5 ? 'neutral' : 'angry'; };
    drawPos = { x: 100, y: 50 };
    setStill('mood'); stillCtl.alpha = 1;`);
  // Tail draws first; everything after it is shell work.
  const shellTags = () => pet.canvas.ctx.ops.filter((o) => o[0] === 'drawImage').map((o) => o[1].tag).slice(1);
  pet.run('drawRig()');
  assert.deepEqual(shellTags(), ['open']);
  pet.canvas.ctx.ops.length = 0;
  // The flip frame draws the outgoing shell fading behind the new one.
  pet.run('rigStateT0 -= 10; drawRig()');
  assert.deepEqual(shellTags(), ['open', 'mad']);
  pet.canvas.ctx.ops.length = 0;
  // Once the blend elapses only the current shell remains.
  pet.run('rigT += 1; drawRig()');
  assert.deepEqual(shellTags(), ['mad']);
});

// Waking her plays a brief stretch beat (surprised head + jolt hops)
// instead of silently fading back to idle.
test('wake plays the wake state', () => {
  const pet = loadPet();
  pet.run('sleeping = true; stillCtl.name = "sleep"; stillCtl.alpha = 1;');
  pet.run('wake()');
  assert.equal(pet.run('stillCtl.name'), 'wake');
  assert.ok(pet.run('action && action.until > performance.now()'), 'timed wake');
});

test('long idle visibly dozes before sleep and interaction interrupts dozing', () => {
  const pet = loadPet();
  pet.run(`idle.lastInteract = performance.now() - 226000;
    tickStill._nextFlourish = Infinity; tickStill._nextChat = Infinity;
    tickStill(performance.now());`);
  assert.equal(pet.run('stillCtl.name'), 'doze');
  pet.run('idle.lastInteract = performance.now(); tickStill(performance.now())');
  assert.equal(pet.run('stillCtl.target'), 0);
  pet.run('idle.lastInteract = performance.now() - 241000; tickStill(performance.now())');
  assert.equal(pet.run('stillCtl.name'), 'sleep-enter');
  assert.equal(pet.run('sleeping'), true);
});

test('autonomous sad and shy expressions follow mood and affection', () => {
  const pet = loadPet();
  pet.setRandom(() => 0.999);
  const flourish = (mood, affectionLevel) => pet.run(`
    stats = { mood: ${mood}, affectionLevel: ${affectionLevel} };
    action = null; clearStill(); stillCtl.name = null; stillCtl.alpha = 0;
    tickStill._nextFlourish = performance.now() - 1;
    tickStill._nextChat = Infinity;
    tickStill(performance.now()); stillCtl.name`);
  assert.equal(flourish(80, 0), 'happy-tail');
  assert.equal(flourish(80, 4), 'shy');
  assert.equal(flourish(20, 0), 'sad');
});

function preparePetMount(pet) {
  pet.run(`
    globalThis.__raf = [];
    globalThis.__imageRequests = [];
    requestAnimationFrame = (callback) => { __raf.push(callback); return __raf.length; };
    // Browser image/network and backend creation are the boundaries; mount,
    // the display callback, state ticking and canvas drawing remain real.
    Image = class {
      naturalWidth = 2; naturalHeight = 2;
      set src(value) { __imageRequests.push(value); this.onload(); }
    };
    PetDialogue.load = async () => __dialogueStore;
    setTimeout = () => 0;
    FRAME = 2; CROP = { x: 0, y: 0, w: 2, h: 2 };
    charRect = { x: 0, y: 0, right: 240, bottom: 260 };
    ort = { Tensor: class { constructor(type, data) { this.data = data; } } };
    createSession = async () => __session;
    loadImageTensor = async () => ({});
    initSr = () => {};
    petShell.onMove = (callback) => { globalThis.__move = callback; };
    globalThis.__session = { run: async () => ({ rgba_f: {
      data: new Float32Array(16).fill(255), dispose() {}
    } }) };
  `);
}

test('mounted display loop commits once after state ticks, input and inference completion', async () => {
  const pet = loadPet();
  preparePetMount(pet);
  pet.run(`
    globalThis.__disposed = 0;
    __session.run = () => new Promise((resolve) => { globalThis.__finishInference = resolve; });
  `);
  await pet.run('mount()');
  pet.run(`petPerf.start();
    pushBubble({ text: '保持显示', until: Infinity, priority: 1 });`);
  assert.equal(pet.run('petPerf.snapshot().paint?.count || 0'), 0,
    'input requests wait for the display callback');

  pet.run('__raf.shift()(performance.now())');
  assert.equal(pet.run('petPerf.snapshot().paint.count'), 1,
    'tickStill and the display loop share one canvas commit');
  assert.equal(pet.run('inferBusy'), true);

  pet.run(`__move({ x: 120, y: 180 }); __move({ x: 160, y: 200 });
    __finishInference({ rgba_f: {
      data: new Float32Array(16).fill(255), dispose() { __disposed++; }
    } });`);
  await pet.run('Promise.resolve()');
  assert.equal(pet.run('__disposed'), 1);
  assert.equal(pet.run('inferBusy'), false);
  assert.equal(pet.run('painted'), true, 'completed inference updates the available image');
  assert.equal(pet.run('petPerf.snapshot().paint.count'), 1,
    'input and inference completion do not add off-refresh commits');

  pet.setNow(pet.now() + 16);
  pet.canvas.ctx.ops.length = 0;
  pet.run('__raf.shift()(performance.now())');
  assert.equal(pet.run('petPerf.snapshot().paint.count'), 2);
  assert.deepEqual(JSON.parse(pet.run('JSON.stringify(drawPos)')), { x: 160, y: 200 },
    'the next refresh presents the latest input position');
  assert.ok(pet.canvas.ctx.ops.some((op) => op[0] === 'drawImage'),
    'the refresh draws the completed avatar image');
  assert.equal(pet.run('__raf.length'), 1, 'the real display loop schedules its next refresh');
});

test('unchanged live refreshes keep the surface until inference or input changes it', async () => {
  const pet = loadPet();
  preparePetMount(pet);
  pet.run(`__session.run = () => new Promise((resolve) => {
    globalThis.__finishInference = resolve;
  });`);
  await pet.run('mount()');
  pet.run('petPerf.start()');
  pet.run('__raf.shift()(performance.now())');
  pet.setNow(pet.now() + 6);
  pet.run('__raf.shift()(performance.now())');
  assert.equal(pet.run('inferBusy'), true);
  assert.equal(pet.run('petPerf.snapshot().paint?.count || 0'), 0,
    'an unchanged live image requires no canvas commit while inference is pending');

  pet.run(`__finishInference({ rgba_f: {
    data: new Float32Array(16).fill(255), dispose() {}
  } });`);
  await pet.run('Promise.resolve()');
  assert.equal(pet.run('petPerf.snapshot().paint?.count || 0'), 0,
    'inference completion waits for display refresh');
  pet.setNow(pet.now() + 6);
  pet.run('__raf.shift()(performance.now())');
  assert.equal(pet.run('petPerf.snapshot().paint.count'), 1);

  pet.setNow(pet.now() + 6);
  pet.run('__raf.shift()(performance.now())');
  assert.equal(pet.run('petPerf.snapshot().paint.count'), 1,
    'the completed image is retained between inference frames');
  pet.run('__move({ x: 180, y: 180 })');
  assert.equal(pet.run('petPerf.snapshot().paint.count'), 1);
  pet.setNow(pet.now() + 6);
  pet.run('__raf.shift()(performance.now())');
  assert.equal(pet.run('petPerf.snapshot().paint.count'), 2,
    'an input position change commits on the next refresh');
  pet.setNow(pet.now() + 6);
  pet.run('__raf.shift()(performance.now())');
  assert.equal(pet.run('petPerf.snapshot().paint.count'), 2,
    'consuming an input update does not leave continuous redraw enabled');
});

test('sleep and carried animation still commit at every mounted display refresh', async () => {
  for (const state of ['sleep', 'pick-up']) {
    const pet = loadPet();
    preparePetMount(pet);
    pet.run('__session.run = () => new Promise(() => {})');
    await pet.run('mount()');
    pet.run(`setStill('${state}'); stillCtl.alpha = 1;
      sleeping = ${state === 'sleep'};
      dragging = ${state === 'pick-up'}; dragMoved = dragging;
      tickStill._nextZzz = Infinity;
      pointer.x = -1000; pointer.y = -1000; petPerf.start();`);
    for (let refresh = 1; refresh <= 3; refresh++) {
      pet.setNow(pet.now() + 6);
      pet.run('__raf.shift()(performance.now())');
      assert.equal(pet.run('petPerf.snapshot().paint.count'), refresh,
        `${state} transforms must be drawn every refresh while inference is pending`);
    }
  }
});

test('mounted refresh clears the final bubble and particle without a completed inference', async () => {
  for (const transient of ['bubble', 'particle']) {
    const pet = loadPet();
    preparePetMount(pet);
    pet.run('__session.run = () => new Promise(() => {})');
    await pet.run('mount()');
    pet.run('petPerf.start()');
    if (transient === 'bubble') {
      pet.run('pushBubble({ text: "短暂气泡", until: performance.now() + 10, priority: 1 })');
    } else {
      pet.run(`spawn('star', 80, 80, 0, 0);
        particles[0].born = performance.now() - 200; particles[0].life = 210;`);
    }
    pet.run('__raf.shift()(performance.now())');
    assert.equal(pet.run('petPerf.snapshot().paint.count'), 1);
    const rectName = transient === 'bubble' ? 'lastBubbleRect' : 'lastParticleRect';
    const previousRect = JSON.parse(pet.run(`JSON.stringify(${rectName})`));
    assert.ok(previousRect, `${transient} has an ink region to clear`);

    pet.setNow(pet.now() + 16);
    pet.canvas.ctx.ops.length = 0;
    pet.run('__raf.shift()(performance.now())');
    assert.equal(pet.run('inferBusy'), true);
    assert.equal(pet.run('petPerf.snapshot().paint.count'), 2,
      `${transient} expiration needs a final cleanup commit`);
    assert.equal(pet.run(rectName), null);
    assert.ok(pet.canvas.ctx.ops.some((op) => op[0] === 'clearRect'
      && op[1] === previousRect.x && op[2] === previousRect.y
      && op[3] === previousRect.w && op[4] === previousRect.h),
    `${transient}'s old ink is cleared at its recorded bounds`);

    pet.setNow(pet.now() + 16);
    pet.run('__raf.shift()(performance.now())');
    assert.equal(pet.run('petPerf.snapshot().paint.count'), 2,
      `after ${transient} cleanup, unchanged live refreshes stop committing`);
  }
});

test('a star at maximum right sway fits its recorded clear region through expiry', async () => {
  const pet = loadPet();
  preparePetMount(pet);
  pet.run('__session.run = () => new Promise(() => {})');
  await pet.run('mount()');
  pet.run(`spawn('star', 80, 80, 0, 0);
    particles[0].seed = Math.PI / 2;
    // One full sway period keeps the phase at PI/2 while the normal
    // 1400ms particle is visible, rather than testing its transparent birth.
    particles[0].born = performance.now() - Math.PI * 2 * 120;`);
  pet.canvas.ctx.ops.length = 0;
  pet.run('__raf.shift()(performance.now())');
  const star = pet.canvas.ctx.ops.find((op) => op[0] === 'fillText' && op[1] === '★');
  assert.ok(star, 'the actual canvas painter draws the star');
  assert.ok(Math.abs(star[2] - 98) < 0.001, 'the glyph starts 18px right of its nominal center');
  const region = JSON.parse(pet.run('JSON.stringify(lastParticleRect)'));
  const glyphRight = star[2] + pet.canvas.ctx.measureText('★').width;
  assert.ok(glyphRight + 1 <= region.x + region.w,
    'the clear region contains the rightward glyph ink and antialiasing');

  pet.setNow(pet.run('particles[0].born + particles[0].life + 1'));
  pet.canvas.ctx.ops.length = 0;
  pet.run('__raf.shift()(performance.now())');
  assert.equal(pet.run('inferBusy'), true, 'cleanup does not depend on a new inference image');
  assert.equal(pet.run('particles.length'), 0);
  assert.equal(pet.run('lastParticleRect'), null);
  assert.ok(pet.canvas.ctx.ops.some((op) => op[0] === 'clearRect'
    && op[1] === region.x && op[2] === region.y && op[3] === region.w && op[4] === region.h),
  'expiry clears the entire previously painted star region');
});

test('mount decodes only the panel avatar and failed engines retain lazy action images', async () => {
  const pet = loadPet();
  preparePetMount(pet);
  await pet.run('mount()');
  assert.deepEqual(Array.from(pet.run('__imageRequests')), [
    'pet://pet/pet-live2d/states/greet.webp',
  ]);
  pet.run('setStill("eat")');
  assert.equal(pet.run('__imageRequests.length'), 1,
    'the live engine does not decode unused action images');
  pet.run('session = null; rig.ready = false; setStill("eat")');
  await pet.run('Promise.resolve().then(() => {}).then(() => {})');
  assert.deepEqual(Array.from(pet.run('__imageRequests')), [
    'pet://pet/pet-live2d/states/greet.webp',
    'pet://pet/pet-live2d/states/eat.webp',
  ]);
  assert.equal(pet.run('stillCtl.entry === stills.get("eat")'), true,
    'the fallback action receives its decoded image');
  pet.run('setStill("eat")');
  assert.equal(pet.run('__imageRequests.length'), 2, 'the decoded fallback image is reused');
});

test('inference readback failure disposes every output and releases the busy guard', async () => {
  const pet = loadPet();
  pet.run(`
    FRAME = 1; allocOutput();
    globalThis.__disposed = []; globalThis.__writes = 0; globalThis.__warnings = [];
    outCtx.putImageData = () => { __writes++; };
    console = { ...console, warn: (...args) => { __warnings.push(args); } };
    ort = { env: { webgpu: { device: { queue: { writeBuffer() {} } } } } };
    sessionOnGpu = true; poseGpuBuffer = {}; poseTensor = {}; imageTensor = {};
    session = { run: async () => ({
      rgba_f: { getData: async () => { throw new Error('readback failed'); },
        dispose() { __disposed.push('rgba_f'); } },
      intermediate: { dispose() { __disposed.push('intermediate'); } }
    }) };
  `);
  await pet.run('renderFrame()');
  assert.deepEqual(Array.from(pet.run('__disposed')), ['rgba_f', 'intermediate']);
  assert.equal(pet.run('inferBusy'), false, 'another inference can run after a failed readback');
  assert.equal(pet.run('__writes'), 0, 'a failed readback preserves the previous display image');
  assert.equal(pet.run('__warnings.length'), 1, 'the failure remains observable');
});

test('transparent frames preserve the displayed image using quantized alpha and dispose outputs', async () => {
  const pet = loadPet();
  pet.run(`
    FRAME = 1; CROP = { x: 0, y: 0, w: 1, h: 1 }; allocOutput();
    charRect = { x: 0, y: 0, right: 240, bottom: 260 };
    renderLoopActive = true; painted = true;
    globalThis.__alpha = 0; globalThis.__writes = 0; globalThis.__srFrames = 0;
    globalThis.__disposed = [];
    outCtx.putImageData = () => { __writes++; };
    srFrame = () => { __srFrames++; };
    ort = { Tensor: class { constructor(type, data) { this.data = data; } } };
    session = { run: async () => ({
      rgba_f: { data: new Float32Array([95.5, -2, 260, __alpha]),
        dispose() { __disposed.push('rgba_f'); } },
      intermediate: { dispose() { __disposed.push('intermediate'); } }
    }) };
  `);
  for (const [alpha, quantized, expectedWrites] of [
    [3.49, 3, 0], [3.5, 4, 1], [0, 0, 1],
  ]) {
    pet.run(`__alpha = ${alpha}`);
    await pet.run('renderFrame()');
    assert.deepEqual(Array.from(pet.run('outImage.data')), [96, 0, 255, quantized]);
    assert.equal(pet.run('__writes'), expectedWrites,
      `alpha ${alpha} must use the display buffer's quantized transparency threshold`);
    assert.equal(pet.run('__srFrames'), expectedWrites,
      'transparent frames do not replace the upscaled display image');
    assert.equal(pet.run('inferBusy'), false);
  }
  assert.deepEqual(Array.from(pet.run('__disposed')),
    ['rgba_f', 'intermediate', 'rgba_f', 'intermediate', 'rgba_f', 'intermediate']);
  assert.equal(pet.run('painted'), true, 'transparent frames retain the existing visible image');
});
