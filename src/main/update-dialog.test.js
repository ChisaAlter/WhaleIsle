const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');

const css = fs.readFileSync(path.join(__dirname, '../renderer/update-dialog.css'), 'utf8');
const renderer = fs.readFileSync(path.join(__dirname, '../renderer/update-dialog.js'), 'utf8');
const main = fs.readFileSync(path.join(__dirname, 'update-dialog.js'), 'utf8');

test('dialog scrim follows the shell silhouette radius instead of painting square corners', () => {
  // The overlay covers the parent's bounds exactly; a square scrim paints the
  // transparent corner gaps, and over dark wallpaper the rounded edge goes
  // unreadable — the shell looks square on that side.
  assert.match(css, /body::before\s*\{[^}]*border-radius:\s*20px/);
});

test('maximized parents lose the scrim radius entirely', () => {
  assert.match(css, /html\[data-window-maximized\]\s*body::before\s*\{[^}]*border-radius:\s*0/);
});

test('view payload carries the effective maximized state and the renderer applies it', () => {
  assert.match(main, /maximized:\s*isEffectivelyMaximized\(parent\)/);
  assert.match(renderer, /toggleAttribute\('data-window-maximized', Boolean\(state\.maximized\)\)/);
});

test('the maximized flag re-syncs while the dialog stays open on parent geometry changes', () => {
  assert.match(main, /parent\.on\('resize',\s*syncMaximized\)/);
  assert.match(main, /parent\.on\('moved',\s*syncMaximized\)/);
});

test('stale-revision pushes still update the scrim radius', () => {
  assert.match(renderer, /state\.revision <= view\.revision\) \{\s*applyWindowState\(state\); return;/);
});

function dialogFixture() {
  const handlers = new Map();
  const window = new EventEmitter();
  const parent = new EventEmitter();
  parent.isDestroyed = () => false;
  window.isDestroyed = () => false;
  window.destroy = () => {};
  window.loadURL = async () => {};
  window.webContents = new EventEmitter();
  window.webContents.mainFrame = { url: 'file:///update-dialog.html' };
  window.webContents.send = () => {};
  const context = vm.createContext({
    module: { exports: {} }, setTimeout, clearTimeout,
    require: (name) => name === 'electron'
      ? { ipcMain: { handle: (channel, fn) => handlers.set(channel, fn), removeHandler: (channel) => handlers.delete(channel) } }
      : { currentTheme: () => ({ scheme: 'light' }), isEffectivelyMaximized: () => false },
  });
  vm.runInContext(main, context);
  const { ShellConfirmDialog, UPDATE_DIALOG_IPC } = context.module.exports;
  const dialog = new ShellConfirmDialog('preload', 'file:///update-dialog.html', { create: () => window });
  const event = { sender: window.webContents, senderFrame: window.webContents.mainFrame };
  return { dialog, parent, respond: (...args) => handlers.get(UPDATE_DIALOG_IPC.respond)(event, ...args) };
}

test('accepted download mode is validated against the main-owned available choices', async () => {
  const f = dialogFixture();
  const answer = f.dialog.show(f.parent, {
    buttons: ['下载并更新', '稍后'], cancelId: 1,
    downloadMethods: [{ id: 'delta', disabledReason: '旧安装器缓存缺失' }, { id: 'full' }],
  });
  assert.throws(() => f.respond(1, 0, 'delta'), /unavailable download method/);
  assert.throws(() => f.respond(1, 0, 'invalid'), /unavailable download method/);
  assert.throws(() => f.respond(1, 0), /unavailable download method/);
  f.respond(1, 0, 'full');
  assert.equal(JSON.stringify(await answer), JSON.stringify({ response: 0, downloadMode: 'full' }));
  f.dialog.dispose();
});

test('both available download choices survive confirmation and cancellation never selects a mode', async () => {
  for (const mode of ['delta', 'full']) {
    const f = dialogFixture();
    const answer = f.dialog.show(f.parent, {
      buttons: ['下载并更新', '稍后'], cancelId: 1,
      downloadMethods: [{ id: 'delta' }, { id: 'full' }],
    });
    f.respond(1, 0, mode);
    assert.equal((await answer).downloadMode, mode);
    const cancelled = f.dialog.show(f.parent, {
      buttons: ['下载并更新', '稍后'], cancelId: 1,
      downloadMethods: [{ id: 'delta' }, { id: 'full' }],
    });
    assert.throws(() => f.respond(1, 0, mode), /stale response/);
    f.respond(2, 1, mode);
    assert.equal(JSON.stringify(await cancelled), JSON.stringify({ response: 1 }));
    f.dialog.dispose();
  }
});
