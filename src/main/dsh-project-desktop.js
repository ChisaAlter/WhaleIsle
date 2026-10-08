'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { ensureDirectoryLink } = require('./desktop-plugin-link');
const { missingDeclaredEntries, missingRuntimeFiles } = require('./plugin-runtime-files');
const { webProfileDir } = require('./plugins');

const DSH_PROJECT_PACKAGE = 'dsh-project';
const DSH_PROJECT_ALIASES = [DSH_PROJECT_PACKAGE];
const DSH_PROJECT_OVERLAY_FILENAME = 'desktop-project.patch.yml';

/** Resolve peers from the same CLI/bundle instances that compose Harness. */
function projectPeerDirectories(harnessRoot, manifest) {
  const cli = path.join(harnessRoot, 'apps', 'cli', 'package.json');
  const anchors = [cli];
  const find = (name) => {
    for (const anchor of anchors) {
      if (!fs.existsSync(anchor)) continue;
      for (const modules of createRequire(anchor).resolve.paths(name) || []) {
        const dir = path.join(modules, name);
        if (fs.existsSync(path.join(dir, 'package.json'))) return fs.realpathSync(dir);
      }
    }
    return null;
  };
  for (const bundle of ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']) {
    const dir = find(bundle); if (dir) anchors.push(path.join(dir, 'package.json'));
  }
  const directories = new Map(), remaining = new Set(Object.keys(manifest.peerDependencies || {}));
  // A schema peer such as zod is owned by storage-domain's isolated install.
  while (remaining.size) {
    let found = false;
    for (const name of remaining) {
      const dir = find(name); if (!dir) continue;
      const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
      const missing = missingDeclaredEntries(dir, pkg).filter(entry => !entry.endsWith('.ts'));
      if (missing.length) throw new Error(`Project peer ${name} has missing runtime entries: ${missing.join(',')}`);
      directories.set(name, dir); anchors.push(path.join(dir, 'package.json')); remaining.delete(name); found = true;
    }
    if (!found) throw new Error(`Project peers unavailable: ${[...remaining].join(',')}`);
  }
  return directories;
}

function ownedDirectory(parent, name) {
  const target = path.join(parent, name);
  let info; try { info = fs.lstatSync(target); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (info && (info.isSymbolicLink() || !info.isDirectory())) throw new Error(`Project runtime directory was replaced: ${target}`);
  if (!info) fs.mkdirSync(target);
  return target;
}
function copyRuntime(source, target) {
  const info = fs.lstatSync(source);
  if (info.isSymbolicLink()) throw new Error(`Project runtime source is a link: ${source}`);
  let destination; try { destination = fs.lstatSync(target); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (destination?.isSymbolicLink()) throw new Error(`Project runtime target was replaced: ${target}`);
  if (info.isDirectory()) {
    if (destination && !destination.isDirectory()) throw new Error(`Project runtime directory contains a file: ${target}`);
    if (!destination) fs.mkdirSync(target);
    for (const name of fs.readdirSync(source)) copyRuntime(path.join(source, name), path.join(target, name));
  } else {
    if (destination && !destination.isFile()) throw new Error(`Project runtime file contains a directory: ${target}`);
    fs.copyFileSync(source, target);
  }
}

/** Mount this optional feature without changing the profile's Team or user patch. */
async function ensureDesktopDshProject(options = {}) {
  const sourceDir = options.sourceDir || path.join(require('./paths').projectRoot(), 'vendor', DSH_PROJECT_PACKAGE);
  const profileDir = options.profileDir || webProfileDir();
  const overlayFile = path.join(profileDir, 'desktop-plugins', DSH_PROJECT_PACKAGE, DSH_PROJECT_OVERLAY_FILENAME);
  if (options.enabled === false || options.skipUserPlugins === true) {
    // Remove only our own overlay. The package link and Project data are retained.
    for (const folder of [path.join(profileDir, 'desktop-plugins'), path.dirname(overlayFile)]) {
      try { if (fs.lstatSync(folder).isSymbolicLink()) throw new Error(`Project overlay directory was replaced: ${folder}`); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    try { fs.unlinkSync(overlayFile); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    return { ok: true, disabled: true, sourceDir };
  }
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(path.join(sourceDir, 'package.json'), 'utf8')); }
  catch { return { ok: false, sourceDir, error: 'missing-source:package.json' }; }
  const missing = [...missingDeclaredEntries(sourceDir, manifest), ...missingRuntimeFiles(sourceDir)];
  if (missing.length) return { ok: false, sourceDir, error: `missing-source:${missing.join(',')}` };
  const peers = Object.keys(manifest.peerDependencies || {}).length
    ? projectPeerDirectories(options.harnessRoot || require('./paths').harnessRoot(), manifest) : new Map();
  fs.mkdirSync(profileDir, { recursive: true });
  const owned = ownedDirectory(ownedDirectory(fs.realpathSync.native(profileDir), 'desktop-plugins'), DSH_PROJECT_PACKAGE);
  const runtimeDir = ownedDirectory(owned, 'runtime');
  // Installed resources may be read-only. All runtime peer links live in the profile.
  for (const name of ['package.json', 'lib', 'client', 'cordis.patch.yml', 'README.md']) {
    if (fs.existsSync(path.join(sourceDir, name))) copyRuntime(path.join(sourceDir, name), path.join(runtimeDir, name));
  }
  const modules = ownedDirectory(runtimeDir, 'node_modules');
  for (const [name, dir] of peers) {
    const parts = name.split('/'), parent = parts.length === 2 ? ownedDirectory(modules, parts[0]) : modules;
    ensureDirectoryLink(dir, path.join(parent, parts.at(-1)));
  }
  ensureDirectoryLink(runtimeDir, path.join(profileDir, 'node_modules', DSH_PROJECT_PACKAGE));
  const added = !fs.existsSync(overlayFile);
  fs.mkdirSync(path.dirname(overlayFile), { recursive: true });
  const contents = [
    '# Desktop-owned optional Project overlay.',
    '# The user cordis.patch.yml is never changed by this overlay.',
    '- insert:',
    '    - id: ui-agent-team',
    '      name: "@deepseek-ai/dsh-experimental-client-ui-agent-team"',
    '    - id: dsh-project',
    '      name: "dsh-project"',
    '',
  ].join('\n');
  fs.writeFileSync(`${overlayFile}.tmp`, contents, 'utf8');
  fs.renameSync(`${overlayFile}.tmp`, overlayFile);
  return { ok: true, sourceDir, runtimeDir, overlayFile, added };
}

module.exports = { DSH_PROJECT_PACKAGE, DSH_PROJECT_ALIASES, DSH_PROJECT_OVERLAY_FILENAME, ensureDesktopDshProject, projectPeerDirectories };
