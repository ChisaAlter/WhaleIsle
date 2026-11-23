'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const {
  resolveHarnessPeerDirectories,
  stageDesktopPluginRuntimeAsync,
} = require('./desktop-plugin-runtime');
const { missingDeclaredEntries, missingRuntimeFiles } = require('./plugin-runtime-files');
const { webProfileDir } = require('./plugins');
const { atomicWriteFileIfChanged } = require('../shared/fs-safe');

const DSH_PROJECT_PACKAGE = 'dsh-project';
const DSH_PROJECT_ALIASES = [DSH_PROJECT_PACKAGE];
const DSH_PROJECT_OVERLAY_FILENAME = 'desktop-project.patch.yml';
const DSH_PROJECT_ENTRIES = ['package.json', 'lib', 'icon.svg', 'cordis.patch.yml', 'README.md'];
const DSH_PROJECT_LINKED_ENTRIES = ['client', 'locale'];

/** Resolve peers from the same CLI/bundle instances that compose Harness. */
function projectPeerDirectories(harnessRoot, manifest) {
  return resolveHarnessPeerDirectories(harnessRoot, manifest, { label: 'Project' });
}

// Project is on by default and can be disabled from Settings › Interface. Hidden
// means not mounted: its data on disk is kept. WHALE_PROJECT=1 mounts it for
// development regardless of the setting.
function projectAvailable(env = process.env, config = {}) {
  return env.WHALE_PROJECT === '1' || config?.projectEnabled !== false;
}

/**
 * Mount Project without changing the user patch or the configured Team service.
 * Project enables the native Team on its own root; ordinary conversations retain their selection.
 */
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
  const { runtimeDir } = await stageDesktopPluginRuntimeAsync({
    packageName: DSH_PROJECT_PACKAGE,
    sourceDir,
    profileDir,
    harnessRoot: options.harnessRoot,
    manifest,
    entries: DSH_PROJECT_ENTRIES,
    linkedEntries: DSH_PROJECT_LINKED_ENTRIES,
    label: 'Project',
  });
  const added = !fs.existsSync(overlayFile);
  await fs.promises.mkdir(path.dirname(overlayFile), { recursive: true });
  const contents = [
    '# Desktop-owned optional Project overlay.',
    '# The user cordis.patch.yml is never changed by this overlay.',
    '- insert:',
    '    - id: dsh-project',
    `      name: ${JSON.stringify(pathToFileURL(path.join(runtimeDir, 'lib', 'index.js')).href)}`,
    '',
  ].join('\n');
  await atomicWriteFileIfChanged(overlayFile, contents, { encoding: 'utf8' });
  return { ok: true, sourceDir, runtimeDir, overlayFile, added };
}

module.exports = { DSH_PROJECT_ALIASES, ensureDesktopDshProject, projectAvailable, projectPeerDirectories };
