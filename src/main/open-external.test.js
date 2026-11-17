'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

function loadOpenExternal(opened) {
  const electronPath = require.resolve('electron');
  const previous = require.cache[electronPath];
  require.cache[electronPath] = {
    id: electronPath,
    filename: electronPath,
    loaded: true,
    exports: { shell: { openExternal: async (url) => { opened.push(url); } } },
  };
  delete require.cache[require.resolve('./open-external.js')];
  const mod = require('./open-external.js');
  return {
    ...mod,
    restore() {
      if (previous) require.cache[electronPath] = previous;
      else delete require.cache[electronPath];
      delete require.cache[require.resolve('./open-external.js')];
    },
  };
}

test('openExternalHttp hands only http(s) URLs to the shell', async () => {
  const opened = [];
  const mod = loadOpenExternal(opened);
  try {
    assert.equal(await mod.openExternalHttp('https://example.com/docs'), true);
    assert.equal(await mod.openExternalHttp('http://127.0.0.1:8080/app'), true);
    for (const url of [
      'file:///etc/passwd',
      'ms-settings:appsfeatures',
      'mailto:someone@example.com',
      'javascript:alert(1)',
      'data:text/html,<p>x</p>',
      'not a url',
      '',
      42,
      null,
      undefined,
      {},
    ]) {
      assert.equal(await mod.openExternalHttp(url), false, String(url));
    }
    assert.deepEqual(opened, ['https://example.com/docs', 'http://127.0.0.1:8080/app']);
  } finally {
    mod.restore();
  }
});

test('openExternalFixedTarget opens only exact allowlisted OS targets', async () => {
  const opened = [];
  const mod = loadOpenExternal(opened);
  try {
    assert.equal(await mod.openExternalFixedTarget('ms-settings:appsfeatures'), true);
    for (const url of [
      'ms-settings:',
      'ms-settings:appsfeaturesx',
      'MS-SETTINGS:APPSFEATURES',
      ' ms-settings:appsfeatures',
      'ms-settings:appsfeatures ',
      'file:///C:/Windows',
      'https://example.com/',
      42,
      null,
      {},
    ]) {
      assert.equal(await mod.openExternalFixedTarget(url), false, String(url));
    }
    assert.deepEqual(opened, ['ms-settings:appsfeatures']);
  } finally {
    mod.restore();
  }
});
