const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  devToolsShortcutAllowed,
  isDevToolsToggleInput,
  attachDevToolsShortcut,
} = require('./devtools-shortcut');

test('devToolsShortcutAllowed: dev builds always, packaged only with openDevTools', () => {
  assert.equal(devToolsShortcutAllowed({ isPackaged: false }), true);
  assert.equal(devToolsShortcutAllowed({ isPackaged: false, openDevTools: false }), true);
  assert.equal(devToolsShortcutAllowed({ isPackaged: true }), false);
  assert.equal(devToolsShortcutAllowed({ isPackaged: true, openDevTools: false }), false);
  assert.equal(devToolsShortcutAllowed({ isPackaged: true, openDevTools: true }), true);
  assert.equal(devToolsShortcutAllowed({ isPackaged: true, openDevTools: 'yes' }), false);
});

test('isDevToolsToggleInput matches Ctrl+Shift+I and Cmd+Alt+I keyDown only', () => {
  const base = { type: 'keyDown', key: 'I', control: false, shift: false, alt: false, meta: false };
  assert.equal(isDevToolsToggleInput({ ...base, control: true, shift: true }), true);
  assert.equal(isDevToolsToggleInput({ ...base, key: 'i', control: true, shift: true }), true);
  assert.equal(isDevToolsToggleInput({ ...base, meta: true, alt: true }), true);
  // Wrong chords / keys / phases.
  assert.equal(isDevToolsToggleInput({ ...base, control: true }), false);
  assert.equal(isDevToolsToggleInput({ ...base, shift: true }), false);
  assert.equal(isDevToolsToggleInput({ ...base, control: true, shift: true, alt: true }), false);
  assert.equal(isDevToolsToggleInput({ ...base, control: true, shift: true, key: 'J' }), false);
  assert.equal(isDevToolsToggleInput({ ...base, control: true, shift: true, type: 'keyUp' }), false);
  assert.equal(isDevToolsToggleInput(null), false);
});

function fakeContents() {
  const listeners = {};
  return {
    listeners,
    on(name, handler) {
      listeners[name] = handler;
    },
    emitInput(input) {
      const event = { prevented: false, preventDefault() { this.prevented = true; } };
      listeners['before-input-event']?.(event, input);
      return event;
    },
  };
}

test('attachDevToolsShortcut toggles the resolved target only when allowed', () => {
  const contents = fakeContents();
  let allowed = false;
  const target = { toggles: 0, toggleDevTools() { this.toggles += 1; } };
  attachDevToolsShortcut(contents, {
    allowed: () => allowed,
    resolveTarget: () => target,
  });
  const chord = { type: 'keyDown', key: 'I', control: true, shift: true, alt: false, meta: false };

  const blocked = contents.emitInput(chord);
  assert.equal(target.toggles, 0);
  assert.equal(blocked.prevented, false);

  allowed = true;
  const passed = contents.emitInput(chord);
  assert.equal(target.toggles, 1);
  assert.equal(passed.prevented, true);

  // Non-matching input never resolves the target.
  contents.emitInput({ type: 'keyDown', key: 'A', control: true, shift: true });
  assert.equal(target.toggles, 1);
});

test('attachDevToolsShortcut survives a missing target', () => {
  const contents = fakeContents();
  attachDevToolsShortcut(contents, { allowed: () => true, resolveTarget: () => null });
  assert.doesNotThrow(() => {
    contents.emitInput({ type: 'keyDown', key: 'I', control: true, shift: true });
  });
});

// H-1 回归护栏：DevTools 快捷键必须保持窗口作用域 + packaged 门禁，
// 不得回退为 OS 级 globalShortcut（会在后台劫持其他应用的 Ctrl+Shift+I）。
test('H-1: index.js 不引用 globalShortcut，经 web-contents-created 挂窗口级快捷键', () => {
  // Post-#439 the event wiring lives in app-events.js; both entry files are
  // covered so globalShortcut must not return anywhere in the composition.
  const source = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8')
    + '\n' + fs.readFileSync(path.join(__dirname, 'app-events.js'), 'utf8');
  assert.doesNotMatch(source, /globalShortcut/, 'index.js 禁止再出现 OS 级全局快捷键');
  assert.match(source, /app\.on\('web-contents-created'/, '快捷键必须挂在 web-contents-created 上');
  assert.match(source, /attachDevToolsShortcut\(contents/, '必须走 devtools-shortcut 模块的窗口级实现');
  assert.match(source, /devToolsShortcutAllowed\(\{/, '必须经 packaged/openDevTools 门禁判定');
  assert.match(
    source,
    /isPackaged:\s*app\.isPackaged/,
    '门禁必须读取真实打包标志，不得写死',
  );
});
