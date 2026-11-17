'use strict';

// renderReleases is exercised on the real page scripts over the fake DOM the
// kit parses from launcher.html: mount() stamps real nodes on the release
// list, the installed card takes text, and row listeners bind through the
// shipped markup. innerHTML is serialized back from the node tree so the
// assertions keep comparing the same markup contract.

const assert = require('node:assert/strict');
const test = require('node:test');
const kit = require('./launcher-test-kit.cjs');

const { context, document: doc } = kit.loadLauncherPage({ api: {} });
const renderReleases = context.renderReleases;
const el = (id) => doc.getElementById(id);

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
  const html = el('release-list').innerHTML;
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
  const html = el('release-list').innerHTML;
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
  assert.match(el('ver-badge').textContent, /发现新版本 v0\.3\.3/);
  const cta = el('ver-cta').innerHTML;
  assert.match(cta, /增量更新/);
  assert.match(cta, /完全下载/);
  // The newest row stays collapsed by default; its detail expands in place.
  const html = el('release-list').innerHTML;
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
  const badgeEl = el('ver-badge');
  assert.equal(badgeEl.textContent, '已是最新');
  assert.equal(badgeEl.hidden, false);
  assert.equal(el('ver-label').textContent, '本机版本');
  assert.equal(el('ver-num').textContent, 'v0.3.3');
  assert.match(el('release-list').innerHTML, /已安装/);
  assert.equal(el('ver-cta').innerHTML, '');
});

test('a running directory build keeps the registered installation version distinct', () => {
  renderReleases({
    status: 'ok', current: '0.3.5',
    installed: { version: '0.3.4', registeredInstall: true, installPath: 'C:\\软件\\Whale Isle' },
    releases: [{ tag: 'v0.3.5', version: '0.3.5', current: true, installable: true }],
  });
  assert.equal(el('ver-label').textContent, '当前运行');
  assert.equal(el('ver-num').textContent, 'v0.3.5');
  assert.equal(el('ver-now-sub').textContent, '本机安装 v0.3.4 · 安装位置 C:\\软件\\Whale Isle');
  const html = el('release-list').innerHTML;
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
  assert.equal(el('ver-now-sub').textContent, '运行位置 C:\\QA\\win-unpacked');
  assert.doesNotMatch(el('release-list').innerHTML, /已安装/);
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
  const html = el('release-list').innerHTML;
  assert.doesNotMatch(html, /data-delta-tag/);
  assert.doesNotMatch(html, /增量更新/);
});

test('renderReleases preserves the full release notes as readable text', () => {
  renderReleases({
    status: 'ok', installed: { version: '0.3.3' },
    releases: [{ tag: 'v0.3.5', version: '0.3.5', newer: true, installable: true,
      notes: '# Whale Isle 0.3.5\n\n- **完整说明**：' + '较长的更新内容。'.repeat(180) + '\n\n最后一项：[阅读详情](release-notes.en.md)' }],
  });
  const html = el('release-list').innerHTML;
  assert.match(html, /最后一项：阅读详情/);
  assert.match(html, /完整说明/);
  assert.doesNotMatch(html, /# Whale|\*\*|release-notes\.en\.md/);
});
