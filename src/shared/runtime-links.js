'use strict';

const fs = require('node:fs');
const path = require('node:path');

const RUNTIME_LINKS = '.dsh-runtime-links.json';

function inside(root, relative) {
  if (typeof relative !== 'string' || !relative || relative.includes('\\')
      || relative.split('/').some(part => !part || part === '.' || part === '..')
      || path.isAbsolute(relative) || /^[a-z]:/i.test(relative)) {
    throw new Error(`Invalid runtime link path: ${relative}`);
  }
  const full = path.resolve(root, relative);
  if (!full.startsWith(path.resolve(root) + path.sep)) throw new Error(`Runtime link escapes root: ${relative}`);
  return full;
}

function readRuntimeLinks(root) {
  const file = path.join(root, RUNTIME_LINKS);
  if (!fs.existsSync(file)) return [];
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  return validateRuntimeLinks(root, manifest);
}

function validateRuntimeLinks(root, manifest) {
  if (manifest.version !== 1 || !Array.isArray(manifest.links)) throw new Error('Invalid runtime link manifest');
  const seen = new Set();
  return manifest.links.map(link => {
    const from = inside(root, link.path);
    const target = inside(root, link.target);
    if (seen.has(from) || from === target) throw new Error(`Conflicting runtime link: ${link.path}`);
    seen.add(from);
    return { from, target };
  });
}

function materializeRuntimeLinks(root, { targetRoot = root } = {}) {
  const links = readRuntimeLinks(root);
  const rootReal = fs.realpathSync(root);
  for (const { from, target } of links) {
    const targetReal = fs.realpathSync(target);
    if (!targetReal.startsWith(rootReal + path.sep) || !fs.statSync(targetReal).isDirectory()) {
      throw new Error(`Invalid runtime link target: ${target}`);
    }
    // Never follow a parent supplied as a junction to somewhere outside this extract.
    let parent = path.dirname(from);
    while (!fs.existsSync(parent)) parent = path.dirname(parent);
    const parentReal = fs.realpathSync(parent);
    if (parentReal !== rootReal && !parentReal.startsWith(rootReal + path.sep)) {
      throw new Error(`Runtime link parent escapes root: ${from}`);
    }
    let info;
    try { info = fs.lstatSync(from); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (info) {
      if (!info.isSymbolicLink()) throw new Error(`Runtime link would replace a directory: ${from}`);
      let current;
      try { current = fs.realpathSync(from); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (current === targetReal) continue;
      fs.unlinkSync(from);
    }
    fs.mkdirSync(path.dirname(from), { recursive: true });
    // NSIS prepares links in staging for the final installation location.
    // The validated source target exists here; the final target exists after directory promotion.
    const installedTarget = path.resolve(targetRoot, path.relative(rootReal, targetReal));
    fs.symlinkSync(process.platform === 'win32' ? installedTarget : path.relative(fs.realpathSync(path.dirname(from)), installedTarget),
      from, process.platform === 'win32' ? 'junction' : 'dir');
  }
  return links.length;
}

function removeRuntimeLinks(root) {
  const links = readRuntimeLinks(root);
  for (const { from } of links.reverse()) {
    let info;
    try { info = fs.lstatSync(from); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!info) continue;
    if (!info.isSymbolicLink()) throw new Error(`Runtime archive link is not a link: ${from}`);
    fs.unlinkSync(from);
  }
}

function checkCancelled(signal) {
  if (signal?.aborted) throw Object.assign(new Error('已取消运行时准备'), { code: 'DSH_CANCELLED' });
}

async function readRuntimeLinksAsync(root, signal) {
  checkCancelled(signal);
  let contents;
  try { contents = await fs.promises.readFile(path.join(root, RUNTIME_LINKS), 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  checkCancelled(signal);
  return validateRuntimeLinks(root, JSON.parse(contents));
}

async function lstatIfPresent(file) {
  try { return await fs.promises.lstat(file); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}

// Startup must not run the build-time synchronous filesystem loop on Electron's
// UI thread. Await actual I/O (not just a Promise around the synchronous API).
async function materializeRuntimeLinksAsync(root, { signal, onProgress = () => {} } = {}) {
  const links = await readRuntimeLinksAsync(root, signal);
  onProgress(0, links.length);
  if (!links.length) { checkCancelled(signal); return 0; }
  const rootReal = await fs.promises.realpath(root);
  let completed = 0;
  for (const { from, target } of links) {
    checkCancelled(signal);
    const targetReal = await fs.promises.realpath(target);
    if (!targetReal.startsWith(rootReal + path.sep) || !(await fs.promises.stat(targetReal)).isDirectory()) {
      throw new Error(`Invalid runtime link target: ${target}`);
    }
    let parent = path.dirname(from);
    while (!(await lstatIfPresent(parent))) {
      checkCancelled(signal);
      const next = path.dirname(parent);
      if (next === parent) throw new Error(`Missing runtime link parent: ${from}`);
      parent = next;
    }
    const parentReal = await fs.promises.realpath(parent);
    if (parentReal !== rootReal && !parentReal.startsWith(rootReal + path.sep)) {
      throw new Error(`Runtime link parent escapes root: ${from}`);
    }
    const info = await lstatIfPresent(from);
    let current;
    if (info) {
      if (!info.isSymbolicLink()) throw new Error(`Runtime link would replace a directory: ${from}`);
      try { current = await fs.promises.realpath(from); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    checkCancelled(signal);
    if (current !== targetReal) {
      if (info) await fs.promises.unlink(from);
      checkCancelled(signal);
      await fs.promises.mkdir(path.dirname(from), { recursive: true });
      const linkTarget = process.platform === 'win32' ? targetReal
        : path.relative(await fs.promises.realpath(path.dirname(from)), targetReal);
      checkCancelled(signal);
      await fs.promises.symlink(linkTarget, from, process.platform === 'win32' ? 'junction' : 'dir');
    }
    checkCancelled(signal);
    onProgress(++completed, links.length);
  }
  return links.length;
}

async function removeRuntimeLinksAsync(root, { signal, onProgress = () => {} } = {}) {
  const links = await readRuntimeLinksAsync(root, signal);
  onProgress(0, links.length);
  if (!links.length) { checkCancelled(signal); return; }
  const rootReal = await fs.promises.realpath(root);
  let completed = 0;
  for (const { from } of links.reverse()) {
    checkCancelled(signal);
    const info = await lstatIfPresent(from);
    if (info) {
      if (!info.isSymbolicLink()) throw new Error(`Runtime archive link is not a link: ${from}`);
      const parentReal = await fs.promises.realpath(path.dirname(from));
      if (parentReal !== rootReal && !parentReal.startsWith(rootReal + path.sep)) {
        throw new Error(`Runtime link parent escapes root: ${from}`);
      }
      checkCancelled(signal);
      await fs.promises.unlink(from);
    }
    checkCancelled(signal);
    onProgress(++completed, links.length);
  }
}

module.exports = { RUNTIME_LINKS, materializeRuntimeLinks, removeRuntimeLinks,
  materializeRuntimeLinksAsync, removeRuntimeLinksAsync };
