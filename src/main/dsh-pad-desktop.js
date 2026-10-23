'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { ensureDirectoryLink } = require('./desktop-plugin-link');
const { missingDeclaredEntries, missingRuntimeFiles } = require('./plugin-runtime-files');
const { webProfileDir } = require('./plugins');

const DSH_PAD_PACKAGE = 'dsh-pad';
const DSH_PAD_RUNTIME_ALIAS = 'whaleisle-desktop-pad';
const DSH_PAD_OVERLAY_FILENAME = 'desktop-dsh-pad.patch.yml';

/**
 * Load the shipped pad by default without replacing a user's pad installation.
 * Full starts retain an existing pad bundle and its profile/home configuration;
 * recovery starts use the shipped runtime through a separate package link.
 * Desktop releases own the shipped copy's updates. Panel data remains under DSH_HOME.
 * @param {{ sourceDir?: string, profileDir?: string, skipUserPlugins?: boolean, disabledPlugins?: string[] }} [options]
 */
function ensureDesktopDshPad(options = {}) {
  const sourceDir = options.sourceDir || path.join(require('./paths').projectRoot(), 'vendor', DSH_PAD_PACKAGE);
  const profileDir = options.profileDir || webProfileDir();
  const profileFile = path.join(profileDir, 'package.json');
  const profile = fs.existsSync(profileFile) ? JSON.parse(fs.readFileSync(profileFile, 'utf8')) : {};
  const bundles = profile.dsh?.profile?.bundles || [];
  const userBundle = bundles.includes(DSH_PAD_PACKAGE);
  const userDependency = Object.hasOwn(profile.dependencies || {}, DSH_PAD_PACKAGE);
  if ((options.disabledPlugins || []).includes(DSH_PAD_PACKAGE) || (userDependency && !userBundle)) {
    return { ok: true, disabled: true };
  }
  if (userBundle && !options.skipUserPlugins) return { ok: true, userProvided: true };

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(sourceDir, 'package.json'), 'utf8'));
  } catch (error) {
    return { ok: false, sourceDir, error: `missing-source:package.json (${error.message})` };
  }
  const missing = [...missingDeclaredEntries(sourceDir, manifest), ...missingRuntimeFiles(sourceDir)];
  if (!fs.existsSync(path.join(sourceDir, 'cordis.patch.yml'))) missing.push('cordis.patch.yml');
  if (manifest.name !== DSH_PAD_PACKAGE) missing.push('package.json:name');
  if (missing.length) return { ok: false, sourceDir, error: `missing-source:${missing.join(',')}` };

  // The separate alias leaves both physical user installs and development links intact.
  // Harness's linked-root resolver supplies this runtime's peers from the active installation.
  ensureDirectoryLink(sourceDir, path.join(profileDir, 'node_modules', DSH_PAD_RUNTIME_ALIAS));
  const overlayFile = path.join(profileDir, 'desktop-plugins', DSH_PAD_PACKAGE, DSH_PAD_OVERLAY_FILENAME);
  const contents = [
    '# Desktop-owned pad, loaded by default and on recovery starts.',
    '# Plugin updates are supplied by desktop releases.',
    '- insert:',
    `    - id: ${DSH_PAD_PACKAGE}`,
    `      name: ${JSON.stringify(pathToFileURL(path.join(sourceDir, 'lib', 'index.js')).href)}`,
    '      config:',
    '        updateCheck: false',
    '',
  ].join('\n');
  const added = !fs.existsSync(overlayFile);
  if (added || fs.readFileSync(overlayFile, 'utf8') !== contents) {
    fs.mkdirSync(path.dirname(overlayFile), { recursive: true });
    fs.writeFileSync(`${overlayFile}.tmp`, contents, 'utf8');
    fs.renameSync(`${overlayFile}.tmp`, overlayFile);
  }
  return { ok: true, added, sourceDir, overlayFile };
}

module.exports = { DSH_PAD_PACKAGE, DSH_PAD_RUNTIME_ALIAS, DSH_PAD_OVERLAY_FILENAME, ensureDesktopDshPad };
