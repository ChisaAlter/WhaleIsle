'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

// Minimal DOM for renderReleases: the function writes innerHTML on the list
// element, stamps text on the installed card, then binds listeners through
// querySelectorAll (empty here — wiring is exercised by the real page).
function fakeDocument() {
  const els = new Map();
  const el = () => ({
    innerHTML: '',
    textContent: '',
    hidden: false,
    title: '',
    className: '',
    setAttribute() {},
    querySelectorAll: () => [],
    classList: { toggle() {} },
  });
  return {
    els,
    getElementById(id) {
      if (!els.has(id)) els.set(id, el());
      return els.get(id);
    },
    querySelectorAll: () => [],
    addEventListener() {},
  };
}

global.window = {};
global.document = fakeDocument();

const { renderReleases } = require('./launcher');

test('renderReleases renders the delta button when the row carries row.delta', () => {
  renderReleases({
    status: 'ok',
    installed: { version: '0.3.2' },
    releases: [{
      tag: 'v0.3.3',
      version: '0.3.3',
      newer: true,
      installable: true,
      assetName: 'Whale-Isle-Setup-0.3.3.exe',
      delta: { name: 'Whale-Isle-delta-0.3.2-0.3.3.zip', from: '0.3.2', to: '0.3.3', size: 1200 },
    }],
  });
  const html = global.document.getElementById('release-list').innerHTML;
  assert.match(html, /data-delta-tag="v0\.3\.3"/);
  assert.match(html, /增量更新/);
  assert.match(html, /增量包/);
});

test('renderReleases falls back to payload.deltas entries shaped as an array', () => {
  renderReleases({
    status: 'ok',
    installed: { version: '0.3.2' },
    deltas: { available: [{ tag: 'v0.3.3', name: 'd.zip', size: 9 }] },
    releases: [{
      tag: 'v0.3.3',
      version: '0.3.3',
      newer: true,
      installable: true,
      assetName: 'setup.exe',
    }],
  });
  const html = global.document.getElementById('release-list').innerHTML;
  assert.match(html, /data-delta-tag="v0\.3\.3"/);
});

test('renderReleases surfaces a newer version badge and CTA on the top card', () => {
  renderReleases({
    status: 'ok',
    installed: { version: '0.3.2' },
    releases: [{
      tag: 'v0.3.3',
      version: '0.3.3',
      newer: true,
      installable: true,
      assetName: 'setup.exe',
      delta: { name: 'd.zip', size: 5 },
    }],
  });
  assert.match(global.document.getElementById('ver-badge').textContent, /发现新版本 v0\.3\.3/);
  const cta = global.document.getElementById('ver-cta').innerHTML;
  assert.match(cta, /增量更新/);
  assert.match(cta, /完全下载/);
  // The newest row stays collapsed by default; its detail expands in place.
  const html = global.document.getElementById('release-list').innerHTML;
  assert.match(html, /data-rel-toggle/);
  assert.match(html, /rel-detail/);
});

test('renderReleases shows 已是最新 and an empty CTA when nothing is newer', () => {
  renderReleases({
    status: 'ok',
    installed: { version: '0.3.3' },
    releases: [{
      tag: 'v0.3.3',
      version: '0.3.3',
      current: true,
      installable: true,
      assetName: 'setup.exe',
    }],
  });
  const badgeEl = global.document.getElementById('ver-badge');
  assert.equal(badgeEl.textContent, '已是最新');
  assert.equal(badgeEl.hidden, false);
  assert.equal(global.document.getElementById('ver-label').textContent, '本机版本');
  assert.equal(global.document.getElementById('ver-num').textContent, 'v0.3.3');
  assert.match(global.document.getElementById('release-list').innerHTML, /已安装/);
  assert.equal(global.document.getElementById('ver-cta').innerHTML, '');
});

test('a running directory build keeps the registered installation version distinct', () => {
  renderReleases({
    status: 'ok', current: '0.3.5',
    installed: { version: '0.3.4', registeredInstall: true, installPath: 'C:\\软件\\Whale Isle' },
    releases: [{ tag: 'v0.3.5', version: '0.3.5', current: true, installable: true }],
  });
  assert.equal(global.document.getElementById('ver-label').textContent, '当前运行');
  assert.equal(global.document.getElementById('ver-num').textContent, 'v0.3.5');
  assert.equal(global.document.getElementById('ver-now-sub').textContent, '本机安装 v0.3.4 · 安装位置 C:\\软件\\Whale Isle');
  const html = global.document.getElementById('release-list').innerHTML;
  assert.match(html, /运行中/);
  assert.match(html, /当前正在运行此版本/);
  assert.doesNotMatch(html, /已安装/);
});

test('an unregistered directory build identifies its path as the running location', () => {
  renderReleases({
    status: 'ok', current: '0.3.5',
    installed: { version: '0.3.5', registeredInstall: false, installPath: 'C:\\QA\\win-unpacked' },
    releases: [{ tag: 'v0.3.5', version: '0.3.5', current: true, installable: true }],
  });
  assert.equal(global.document.getElementById('ver-now-sub').textContent, '运行位置 C:\\QA\\win-unpacked');
  assert.doesNotMatch(global.document.getElementById('release-list').innerHTML, /已安装/);
});

test('renderReleases renders no delta button without delta evidence', () => {
  renderReleases({
    status: 'ok',
    installed: { version: '0.3.2' },
    releases: [{
      tag: 'v0.3.3',
      version: '0.3.3',
      newer: true,
      installable: true,
      assetName: 'setup.exe',
    }],
  });
  const html = global.document.getElementById('release-list').innerHTML;
  assert.doesNotMatch(html, /data-delta-tag/);
  assert.doesNotMatch(html, /增量更新/);
});

test('renderReleases preserves the full release notes as readable text', () => {
  renderReleases({
    status: 'ok', installed: { version: '0.3.3' },
    releases: [{ tag: 'v0.3.5', version: '0.3.5', newer: true, installable: true,
      notes: '# Whale Isle 0.3.5\n\n- **完整说明**：' + '较长的更新内容。'.repeat(180) + '\n\n最后一项：[阅读详情](release-notes.en.md)' }],
  });
  const html = global.document.getElementById('release-list').innerHTML;
  assert.match(html, /最后一项：阅读详情/);
  assert.match(html, /完整说明/);
  assert.doesNotMatch(html, /# Whale|\*\*|release-notes\.en\.md/);
});
