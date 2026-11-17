'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('reapplying integrated chrome gives the DOM helper a fresh lexical scope and returns the probe result', () => {
  const source = fs.readFileSync(path.join(__dirname, 'chrome.js'), 'utf8');
  const declaration = source.slice(source.indexOf('const injectScript = ['), source.indexOf('let ipcBound'));
  const script = vm.runInNewContext(declaration + '\ninjectScript;', {
    __dirname, path,
    fs: { readFileSync(file, encoding) {
      return file.endsWith('harness-chrome-inject.js')
        ? '(() => ({ready: typeof window.whaleDom.h === "function"}))()'
        : fs.readFileSync(file, encoding);
    } },
  });
  const page = vm.createContext({ window: {} });
  for (let i = 0; i < 3; i++) {
    const result = vm.runInContext(script, page);
    assert.equal(result.ready, true);
  }
});
