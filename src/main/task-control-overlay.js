'use strict';

const fs = require('fs');
const path = require('path');
const { ensureDirectoryLink } = require('./desktop-plugin-link');
const { missingDeclaredEntries, missingRuntimeFiles } = require('./plugin-runtime-files');
const { webProfileDir } = require('./plugins');

/** npm package name (also the profile node_modules junction name). */
const TASK_CONTROL_PACKAGE = 'dsh-task-control';
/** Loader insert id — matches the plugin's own cordis.patch.yml. */
const TASK_CONTROL_INSERT_ID = 'dsh-task-control';
/** Forensics / disable-list aliases (task control is desktop built-in: the
 * aliases are stripped from the disable list, never honored). */
const TASK_CONTROL_ALIASES = [TASK_CONTROL_PACKAGE, TASK_CONTROL_INSERT_ID];
const TASK_CONTROL_OVERLAY_FILENAME = 'desktop-task-control.patch.yml';

function defaultSourceDir() {
  try {
    const { projectRoot } = require('./paths');
    return path.join(projectRoot(), 'vendor', 'dsh-task-control');
  } catch {
    return path.join(__dirname, '..', '..', 'vendor', 'dsh-task-control');
  }
}

function linkIntoProfileModules(sourceDir, profileDir) {
  const linked = path.join(profileDir, 'node_modules', TASK_CONTROL_PACKAGE);
  ensureDirectoryLink(sourceDir, linked);
}

/**
 * Wire the desktop-owned `dsh-task-control` Host plugin: a `--patch` overlay
 * (`desktop-plugins/dsh-task-control/desktop-task-control.patch.yml`) carries
 * the package-name insert, and a profile node_modules junction to vendor
 * makes the name resolvable. Task protection is required on EVERY start
 * (full and skip) because quit/update
 * admission is not a user option. Missing vendor files fail the start as
 * desktop runtime damage.
 *
 * @param {{ sourceDir?: string, profileDir?: string }} [options]
 */
function ensureDesktopTaskControl(options = {}) {
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

  const destDir = path.join(profileDir, 'desktop-plugins', 'dsh-task-control');
  const overlayFile = path.join(destDir, TASK_CONTROL_OVERLAY_FILENAME);
  const existed = fs.existsSync(overlayFile);

  linkIntoProfileModules(sourceDir, profileDir);

  fs.mkdirSync(destDir, { recursive: true });
  const overlayContents = [
    '# Desktop-managed overlay passed to EVERY start (full and skip) via',
    '# --patch: the task-control insert is required for quit/update protection.',
    '# Regenerated on every start; do not edit.',
    '- insert:',
    `    - id: ${TASK_CONTROL_INSERT_ID}`,
    `      name: ${JSON.stringify(TASK_CONTROL_PACKAGE)}`,
    '',
  ].join('\n');
  const tmp = `${overlayFile}.tmp`;
  fs.writeFileSync(tmp, overlayContents, 'utf8');
  fs.renameSync(tmp, overlayFile);
  return {
    ok: true,
    added: !existed,
    sourceDir,
    overlayFile,
  };
}

function withoutTaskControlAliases(list) {
  const blocked = new Set(TASK_CONTROL_ALIASES);
  return (Array.isArray(list) ? list : []).filter((name) => !blocked.has(String(name || '').trim()));
}

module.exports = {
  TASK_CONTROL_PACKAGE,
  TASK_CONTROL_ALIASES,
  TASK_CONTROL_INSERT_ID,
  TASK_CONTROL_OVERLAY_FILENAME,
  withoutTaskControlAliases,
  ensureDesktopTaskControl,
};
