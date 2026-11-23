'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const MAIN_DIR = __dirname;

/**
 * Every session partition must install permission handlers. A partition
 * without handlers inherits Electron's default grants; each entry maps the
 * partition name (or template prefix) to the module that owns its
 * setPermissionRequestHandler / setPermissionCheckHandler calls.
 */
const PARTITION_PERMISSION_OWNERS = new Map([
  ['persist:magpie', 'magpie-window.js'],
  ['persist:dshd-preview-', 'preview-session.js'],
  ['persist:dsh-platform-', 'platform-view.js'],
  ['dsh-platform-', 'platform-view.js'],
  ['dshd-html-preview-', 'html-preview.js'],
  ['dsh-sidebar-browser-', 'browser-guests.js'],
]);

const PARTITION_PATTERNS = [
  /\bpartition\s*[:=]\s*'([^'\n]+)'/g,
  /\bpartition\s*[:=]\s*"([^"\n]+)"/g,
  /\bpartition\s*[:=]\s*`([^`$\n]+)\$\{/g,
  /\bfromPartition\(\s*'([^'\n]+)'/g,
  /\bfromPartition\(\s*"([^"\n]+)"/g,
  /\bfromPartition\(\s*`([^`$\n]+)\$\{/g,
  /'(persist:[^'\n]+)'/g,
  /"(persist:[^"\n]+)"/g,
  /`(persist:[^`$\n]+)`/g,
  /`(persist:[^`$\n]*)\$\{/g,
];

function listMainSources(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listMainSources(full));
    } else if (entry.name.endsWith('.js') && !entry.name.endsWith('.test.js')) {
      files.push(full);
    }
  }
  return files;
}

function scanPartitions() {
  const found = new Map();
  for (const file of listMainSources(MAIN_DIR)) {
    const source = fs.readFileSync(file, 'utf8');
    for (const pattern of PARTITION_PATTERNS) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(source)) !== null) {
        const name = match[1];
        if (!found.has(name)) found.set(name, []);
        found.get(name).push(path.basename(file));
      }
    }
  }
  return found;
}

test('every session partition registers permission handlers through a mapped module', () => {
  const found = scanPartitions();
  const unmapped = [...found.keys()].filter((name) => !PARTITION_PERMISSION_OWNERS.has(name));
  assert.deepEqual(unmapped, [],
    `发现未登记的会话分区：${unmapped.map((name) => `${name} (${found.get(name).join(', ')})`).join('; ')}。`
      + '新增会话分区必须在 src/main/session-permissions.test.js 的 PARTITION_PERMISSION_OWNERS 中登记负责安装权限处理的模块文件，'
      + '并在该模块调用 setPermissionRequestHandler 与 setPermissionCheckHandler。');
});

test('each permission owner module installs both handlers', () => {
  for (const [partition, file] of PARTITION_PERMISSION_OWNERS) {
    const source = fs.readFileSync(path.join(MAIN_DIR, file), 'utf8');
    assert.ok(source.includes('setPermissionRequestHandler'),
      `${partition}: ${file} 未调用 setPermissionRequestHandler`);
    assert.ok(source.includes('setPermissionCheckHandler'),
      `${partition}: ${file} 未调用 setPermissionCheckHandler`);
  }
});
