'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

test('GPU recovery failures reach the existing app log without crashing the event handler', () => {
  const app = new EventEmitter();
  const logs = [];
  const module = { exports: {} };
  const stubs = {
    electron: { app },
    './config': {}, './window': {}, './devtools-shortcut': {},
    './desktop-live2d': { getLive2dPet: () => ({ recreateWindow() { throw new Error('synthetic recovery failure'); } }) },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'app-events.js'), 'utf8'), {
    require: id => stubs[id], module,
  });
  module.exports.registerAppEvents({ state: {}, showForeground() {}, log: text => logs.push(text) });
  app.emit('gpu-process-crashed');
  app.emit('child-process-gone', {}, { type: 'GPU' });
  assert.equal(logs.length, 2);
  for (const message of logs) {
    assert.match(message, /synthetic recovery failure/);
    assert.match(message, /关闭再启用桌宠/);
  }
});
