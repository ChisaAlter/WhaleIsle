'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { PREVIEW_PIP_FRAME_CHANNEL } = require('./preview-pip-protocol.js');

const leftoverBrand = ['t', '3', 'code'].join('');
const leftoverTools = ['t', '3', 'tools'].join('');
const leftoverCss = `--${['t', '3'].join('')}-`;
const leftoverHyphen = ['T', '3', '-'].join('');
const BRAND = new RegExp(
  [leftoverBrand, leftoverTools, leftoverCss, `data-${leftoverBrand}`, leftoverHyphen].join('|'),
  'i',
);

function loadPipPreload() {
  const listeners = new Map();
  let exposed = null;
  const ipcRenderer = {
    on(channel, listener) {
      const list = listeners.get(channel) ?? [];
      list.push(listener);
      listeners.set(channel, list);
    },
    removeListener(channel, listener) {
      const list = listeners.get(channel) ?? [];
      listeners.set(channel, list.filter((item) => item !== listener));
    },
    emit(channel, ...args) {
      for (const listener of listeners.get(channel) ?? []) listener({}, ...args);
    },
  };

  const source = fs.readFileSync(path.join(__dirname, 'preview-pip-preload.js'), 'utf8');
  vm.runInNewContext(source, {
    require(name) {
      assert.equal(name, 'electron', 'sandbox preload must not require local modules');
      return {
        contextBridge: {
          exposeInMainWorld(name, api) {
            exposed = { name, api };
          },
        },
        ipcRenderer,
      };
    },
  }, { filename: 'preview-pip-preload.js' });
  return { exposed, ipcRenderer };
}

test('pip preload and protocol omit leftover brand markers', () => {
  for (const name of ['preview-pip-preload.js', 'preview-pip-protocol.js']) {
    const source = fs.readFileSync(path.join(__dirname, name), 'utf8');
    assert.doesNotMatch(source, BRAND, name);
  }
});

test('sandboxed pip preload exposes onFrame on the protocol channel without ipcRenderer', () => {
  const { exposed, ipcRenderer } = loadPipPreload();
  assert.equal(exposed?.name, 'previewPictureInPicture');
  assert.equal(typeof exposed?.api.onFrame, 'function');
  assert.equal(exposed?.api.ipcRenderer, undefined);

  const seen = [];
  const dispose = exposed.api.onFrame((frame) => {
    seen.push(frame);
  });
  ipcRenderer.emit(PREVIEW_PIP_FRAME_CHANNEL, { data: 'abc', width: 1280, height: 720 });
  ipcRenderer.emit(PREVIEW_PIP_FRAME_CHANNEL, null);
  assert.deepEqual(seen, [{ data: 'abc', width: 1280, height: 720 }]);
  dispose();
  ipcRenderer.emit(PREVIEW_PIP_FRAME_CHANNEL, { data: 'dropped' });
  assert.equal(seen.length, 1);
});
