'use strict';

/**
 * Wire the desktop-owned `dsh-platform-session` Host plugin + the
 * `desktopPlatform: 'win32'` identity override on the mounted
 * deepseek-account row — mirrors ensureDesktopTaskControl: a `--patch`
 * overlay carries both rows on every start (full and skip), and a profile
 * node_modules junction makes the package name resolvable.
 */

const fs = require('fs');
const path = require('path');
const { ensureDirectoryLink } = require('./desktop-plugin-link');
const { missingDeclaredEntries, missingRuntimeFiles } = require('./plugin-runtime-files');
const { webProfileDir } = require('./plugins');
const { atomicWriteFileSync } = require('../shared/fs-safe');

const PLATFORM_PACKAGE = 'dsh-platform-session';
const PLATFORM_INSERT_ID = 'dsh-platform-session';
const PLATFORM_ALIASES = [PLATFORM_PACKAGE, PLATFORM_INSERT_ID];
const PLATFORM_OVERLAY_FILENAME = 'desktop-platform-session.patch.yml';

function defaultSourceDir() {
  try {
    const { projectRoot } = require('./paths');
    return path.join(projectRoot(), 'vendor', 'dsh-platform-session');
  } catch {
    return path.join(__dirname, '..', '..', 'vendor', 'dsh-platform-session');
  }
}

function linkIntoProfileModules(sourceDir, profileDir) {
  const linked = path.join(profileDir, 'node_modules', PLATFORM_PACKAGE);
  ensureDirectoryLink(sourceDir, linked);
}

/** @param {{ sourceDir?: string, profileDir?: string }} [options] */
function ensureDesktopPlatformSession(options = {}) {
  const sourceDir = options.sourceDir || defaultSourceDir();
  const profileDir = options.profileDir || webProfileDir();
  const pkgFile = path.join(sourceDir, 'package.json');
  if (!fs.existsSync(pkgFile)) {
    return { ok: false, added: false, sourceDir: null, error: 'missing-source:package.json' };
  }
  let manifest = null;
  try {
    manifest = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
  } catch {
    // An unreadable manifest cannot declare entries; reported below.
  }
  const missingEntries = manifest ? missingDeclaredEntries(sourceDir, manifest) : ['package.json'];
  const missingDeps = missingRuntimeFiles(sourceDir);
  if (missingEntries.length || missingDeps.length) {
    return {
      ok: false,
      added: false,
      sourceDir,
      error: `missing-source:${[...missingEntries, ...missingDeps].join(',')}`,
    };
  }

  const destDir = path.join(profileDir, 'desktop-plugins', PLATFORM_PACKAGE);
  const overlayFile = path.join(destDir, PLATFORM_OVERLAY_FILENAME);
  const existed = fs.existsSync(overlayFile);

  linkIntoProfileModules(sourceDir, profileDir);

  fs.mkdirSync(destDir, { recursive: true });
  // Two rows, one overlay: (1) replace the mounted account row's config so
  // desktopPlatform reports 'win32' — the web profile's own expression gates
  // it to null; (2) insert the loopback publisher. Config is replaced
  // wholesale by patch semantics; the upstream row only ever set this field.
  const overlayContents = [
    '# Desktop-managed overlay passed to EVERY start (full and skip) via',
    '# --patch: embedded Platform documents (usage/top-up) need both the',
    '# desktopPlatform identity on the account row and the session route.',
    '# Regenerated on every start; do not edit.',
    '- id: deepseek-account',
    '  config:',
    "    desktopPlatform: 'win32'",
    '',
    '- insert:',
    `    - id: ${PLATFORM_INSERT_ID}`,
    `      name: ${JSON.stringify(PLATFORM_PACKAGE)}`,
    '',
  ].join('\n');
  atomicWriteFileSync(overlayFile, overlayContents, { encoding: 'utf8' });
  return {
    ok: true,
    added: !existed,
    sourceDir,
    overlayFile,
  };
}

function withoutPlatformAliases(list) {
  const blocked = new Set(PLATFORM_ALIASES);
  return (Array.isArray(list) ? list : []).filter((name) => !blocked.has(String(name || '').trim()));
}

module.exports = {
  PLATFORM_PACKAGE,
  PLATFORM_ALIASES,
  PLATFORM_INSERT_ID,
  PLATFORM_OVERLAY_FILENAME,
  withoutPlatformAliases,
  ensureDesktopPlatformSession,
};
