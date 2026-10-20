'use strict';

const fs = require('fs');
const path = require('path');

/** Resolve the pnpm distribution carried by the desktop or its source checkout. */
function resolvePnpmEntry() {
  const root = path.join(__dirname, '..', '..');
  return [
    path.join(process.resourcesPath || '', 'pnpm', 'bin', 'pnpm.mjs'),
    path.join(root, 'node_modules', 'pnpm', 'bin', 'pnpm.mjs'),
    path.join(root, 'vendor', 'deepseek-harness', 'node_modules', 'pnpm', 'bin', 'pnpm.mjs'),
  ].find(file => fs.existsSync(file)) || null;
}

/** Supply the installed CLI with Node and pnpm without a Windows batch script. */
function desktopCliArgs(cli, args) {
  const pnpm = resolvePnpmEntry();
  if (!pnpm) throw new Error('未找到桌面内置 pnpm。源码运行请安装项目依赖；安装包请重新安装当前版本。');
  const runner = path.join(__dirname, 'dsh-cli-runner.mjs')
    .replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`);
  return [runner, cli, pnpm, ...args];
}

module.exports = { resolvePnpmEntry, desktopCliArgs };
