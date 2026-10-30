'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const CLIENT = path.join(__dirname, '..', '..', 'vendor', 'dsh-pad', 'lib', 'client.js');
const LAYOUT_KEY = 'dsh-pad:layout';
// Revealed desktop viewport; the default ball sits on the right edge at 42% height.
const VIEWPORT = { width: 1441, height: 912 };
const DEFAULT_BALL = { left: 1441 - 28 - 17, top: Math.round(912 * 0.42 - 14) };

// Just enough React for one render of the dock: effects never run, state keeps
// its initial value, and elements stay plain objects that the test can walk.
function reactStub() {
  const element = (type, props, ...children) => ({ type, props: { ...props, children } });
  const react = {
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useRef: (current) => ({ current }),
    useMemo: (compute) => compute(),
    useEffect() {},
    useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
    createElement: element,
    Component: class { constructor(props) { this.props = props; } },
    Fragment: Symbol('Fragment'),
  };
  const jsx = (type, props) => ({ type, props });
  return { react, jsxRuntime: { jsx, jsxs: jsx, Fragment: react.Fragment } };
}

/**
 * Start the shipped pad client the way the desktop does: Harness boots in a
 * 0×0 view and only receives its real size when the boot page reveals it.
 */
function startPad(storedLayout) {
  const storage = new Map();
  if (storedLayout !== undefined) storage.set(LAYOUT_KEY, JSON.stringify(storedLayout));
  let factory;
  const window = {
    innerWidth: 0,
    innerHeight: 0,
    addEventListener() {},
    removeEventListener() {},
    __ModuleLoader__: { load: (entry) => { factory = entry.factory; } },
  };
  const localStorage = {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => { storage.set(key, String(value)); },
    removeItem: (key) => { storage.delete(key); },
  };
  vm.runInContext(fs.readFileSync(CLIENT, 'utf8'), vm.createContext({ window, localStorage, console }));
  const { react, jsxRuntime } = reactStub();
  const pad = factory((name) => ({ react, 'react/jsx-runtime': jsxRuntime })[name]);

  const overlays = [];
  pad.apply({
    locale: { register: () => () => {} },
    effect() {},
    slots: {
      inject: (_name, register) => register(),
      register: (meta, render) => { overlays.push({ meta, render }); return () => {}; },
    },
  });
  const overlay = overlays.find((entry) => entry.meta.id === 'dsh-pad');
  assert.ok(overlay, 'pad registers its shell overlay');
  const Dock = overlay.render({ t: (key) => key }).props.children[0].type;
  return { window, Dock };
}

function ballStyle(node) {
  if (node === null || typeof node !== 'object') return undefined;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = ballStyle(child);
      if (found) return found;
    }
    return undefined;
  }
  if (node.props?.id === 'dshpad-ball') return node.props.style;
  return ballStyle(node.props?.children);
}

function renderBall(storedLayout) {
  const { window, Dock } = startPad(storedLayout);
  window.innerWidth = VIEWPORT.width;
  window.innerHeight = VIEWPORT.height;
  const style = ballStyle(Dock({ t: (key) => key }));
  assert.ok(style, 'dock renders the floating ball');
  return { left: style.left, top: style.top };
}

test('a fresh profile places the ball at its default edge once the desktop is revealed', () => {
  assert.deepEqual(renderBall(), DEFAULT_BALL);
});

test('a saved ball position survives the 0×0 boot view', () => {
  assert.deepEqual(renderBall({ ball: { x: 17, y: 600 } }), { left: 17, top: 600 });
});

test('the corner left behind by earlier boots falls back to the default position', () => {
  assert.deepEqual(renderBall({ ball: { x: 1, y: 1 }, expanded: false }), DEFAULT_BALL);
});

test('a saved ball outside the revealed viewport is still kept fully visible', () => {
  assert.deepEqual(renderBall({ ball: { x: 3000, y: 3000 } }), { left: 1441 - 28 - 1, top: 912 - 28 - 1 });
});
