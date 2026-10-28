'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');

// Every installer re-compresses deepseek-harness.tar as one LZMA2 stream, and
// electron-updater can only reuse the compressed bytes before the first
// difference. Copy-time mtimes made every tar header differ between builds,
// so each update re-downloaded the whole ~90 MB runtime. Content-derived
// mtimes and a stable-first entry order keep the third-party store (most of
// the bytes) identical from release to release.

// 2001-01-01; derived times stay within twenty years after it, never in the future.
const TIME_BASE = 978307200;
const TIME_SPAN = 630720000;
const STABLE_FIRST = 'node_modules';

/** Same bytes, same mtime; changed bytes get a new one, so mtime-keyed caches still refresh. */
function contentTime(file) {
  const digest = createHash('sha1').update(fs.readFileSync(file)).digest();
  return TIME_BASE + (digest.readUInt32BE(0) % TIME_SPAN);
}

/** Depth-first, byte-sorted entries ('./'-prefixed, '/'-separated), directories before their children. */
function runtimeArchiveEntries(root) {
  const stable = [];
  const rest = [];
  const walk = (dir, rel) => {
    const names = fs.readdirSync(dir).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    for (const name of names) {
      const entry = rel ? `${rel}/${name}` : name;
      const target = entry === STABLE_FIRST || entry.startsWith(`${STABLE_FIRST}/`) ? stable : rest;
      target.push(`./${entry}`);
      if (fs.lstatSync(path.join(dir, name)).isDirectory()) walk(path.join(dir, name), entry);
    }
  };
  walk(root, '');
  return [...stable, ...rest];
}

function normalizeRuntimeTimes(root, entries) {
  for (const entry of entries) {
    const file = path.join(root, entry);
    const stat = fs.lstatSync(file);
    const time = stat.isFile() ? contentTime(file) : TIME_BASE;
    fs.utimesSync(file, time, time);
  }
}

/** Write `archive` from the contents of `root` with a reproducible layout. */
function writeRuntimeArchive(root, archive, { tar = 'tar', exec = execFileSync, log = console.log } = {}) {
  const entries = runtimeArchiveEntries(root);
  // bsdtar reads -T names in the system code page; keep the plain layout
  // rather than risk mangled names.
  if (entries.some(entry => /[^\x20-\x7e]/.test(entry))) {
    log('运行时含非 ASCII 路径，按目录顺序打包（增量更新复用较少）');
    exec(tar, ['-cf', archive, '-C', root, '.'], { stdio: 'inherit', env: { ...process.env, COPYFILE_DISABLE: '1' } });
    return;
  }
  normalizeRuntimeTimes(root, entries);
  const list = `${archive}.entries`;
  fs.writeFileSync(list, `${entries.join('\n')}\n`);
  try {
    exec(tar, ['-cf', archive, '--no-recursion', '-T', list], {
      cwd: root,
      stdio: 'inherit',
      env: { ...process.env, COPYFILE_DISABLE: '1' },
    });
  } finally {
    fs.rmSync(list, { force: true });
  }
}

module.exports = { runtimeArchiveEntries, normalizeRuntimeTimes, writeRuntimeArchive, contentTime };
