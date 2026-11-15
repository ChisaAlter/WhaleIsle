'use strict';

const fs = require('fs');
const path = require('path');
const { linkInfo, directoryLinkMatches, ensureDirectoryLink } = require('./desktop-plugin-link');
const { missingRuntimeFiles } = require('./plugin-runtime-files');
const { webProfileDir, stripBlockFromFile } = require('./plugins');
const { atomicWriteFileSync } = require('../shared/fs-safe');

/** npm package name (also used for market/forensics aliases). */
const USAGE_PANEL_PACKAGE = 'dsh-usage-panel';
/** Legacy managed-block markers earlier desktop versions wrote into the
 * user-owned cordis.patch.yml; ensure only strips them (migration). */
const USAGE_PANEL_BEGIN = '# --- dshd-gui-usage-panel ---';
const USAGE_PANEL_END = '# --- end dshd-gui-usage-panel ---';
/** Forensics / config / IPC aliases (usage-panel is desktop built-in: the
 * aliases are stripped from the disable list, never honored). */
const USAGE_PANEL_ALIASES = [USAGE_PANEL_PACKAGE];
const USAGE_PANEL_OVERLAY_FILENAME = 'desktop-usage-panel.patch.yml';

function defaultSourceDir() {
  try {
    const { projectRoot } = require('./paths');
    return path.join(projectRoot(), 'vendor', USAGE_PANEL_PACKAGE);
  } catch {
    return path.join(__dirname, '..', '..', 'vendor', USAGE_PANEL_PACKAGE);
  }
}

function pathExists(target) {
  return Boolean(linkInfo(target));
}

/** The `name` field of a directory's package.json, or null. */
function readPackageName(dir) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    return typeof pkg.name === 'string' && pkg.name.trim() ? pkg.name.trim() : null;
  } catch {
    return null;
  }
}

/**
 * A real directory that is one of *our* usage-panel copies (the pre-link
 * profile bundle). The package name is the evidence: a directory holding
 * unrelated user content must never be mistaken for a managed copy.
 */
function isManagedUsagePanelCopy(dir) {
  let st;
  try {
    st = fs.lstatSync(dir);
  } catch {
    return false;
  }
  if (st.isSymbolicLink() || !st.isDirectory()) return false;
  return readPackageName(dir) === USAGE_PANEL_PACKAGE;
}

/**
 * The steady-state `desktop-plugins/dsh-usage-panel` directory: it holds only
 * the desktop-managed overlay (plus an interrupted `.tmp`), no user files.
 * Anything else at that path is unknown content and must fail closed.
 */
function isManagedOverlayDir(dir) {
  let st;
  try {
    st = fs.lstatSync(dir);
  } catch {
    return false;
  }
  if (st.isSymbolicLink() || !st.isDirectory()) return false;
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return false;
  }
  if (entries.length === 0) return true;
  const allowed = new Set([USAGE_PANEL_OVERLAY_FILENAME, `${USAGE_PANEL_OVERLAY_FILENAME}.tmp`]);
  return entries.every((name) => allowed.has(name));
}

/** Unique sibling path for a quarantined copy (no overwrite, no delete). */
function backupPathFor(target) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  let candidate = `${target}.managed-backup-${stamp}`;
  let suffix = 1;
  while (pathExists(candidate)) {
    candidate = `${target}.managed-backup-${stamp}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

/**
 * Move a stale managed copy aside with a rename in the same parent directory.
 *
 * `fs.rmSync(..., { recursive: true })` on the start path deleted a ~6k-file
 * bundle with no way back and no evidence left on disk. A same-directory
 * rename is O(1) and keeps the previous state recoverable, so a failed
 * link/overlay write can restore exactly what was there before.
 * @returns {{ from: string, to: string } | null}
 */
function quarantineManagedCopy(target) {
  if (!isManagedUsagePanelCopy(target)) return null;
  const to = backupPathFor(target);
  fs.renameSync(target, to);
  return { from: target, to };
}

function restoreQuarantinedCopy(entry) {
  if (!entry) return;
  if (!pathExists(entry.to) || pathExists(entry.from)) return;
  try {
    fs.renameSync(entry.to, entry.from);
  } catch {
    // Best effort: the backup stays on disk as the traceable record.
  }
}

/** Leftover backup for `target` when the target itself vanished. */
function findLeftoverBackup(target) {
  const parent = path.dirname(target);
  const prefix = `${path.basename(target)}.managed-backup-`;
  let entries;
  try {
    entries = fs.readdirSync(parent);
  } catch {
    return null;
  }
  const matches = entries.filter((name) => name.startsWith(prefix)).sort();
  return matches.length > 0 ? path.join(parent, matches[matches.length - 1]) : null;
}

/**
 * Point the profile's `node_modules/dsh-usage-panel` at the vendor (or
 * packaged resources) runtime. The panel is desktop built-in code with no
 * writable state in its own directory — billing JSON lives in the
 * `dsh_usage_panel_billing` storage domain — so the profile does not need a
 * second copy of the ~6k-file bundle.
 *
 * The previous implementation maintained that copy on every start. Even
 * after the synchronous `fs.cpSync` was replaced with an incremental async
 * copy, the steady state was still a full-tree stat walk (~12k stats for
 * ~6k files) measured at ~1.1 s per start, and it ran before `dsh` spawn.
 * Relinking is a single syscall and only happens when the target moved.
 *
 * A pre-link profile bundle is *quarantined*, not deleted: the copy is renamed
 * beside itself, and the rename is undone if the link cannot be created.
 * Unknown content stops the operation instead of being destroyed.
 * @param {string} sourceDir
 * @param {string} target
 * @returns {{ relinked: boolean, quarantine: { from: string, to: string } | null }}
 */
function linkToTarget(sourceDir, target) {
  if (directoryLinkMatches(sourceDir, target)) return { relinked: false, quarantine: null };
  fs.mkdirSync(path.dirname(target), { recursive: true });

  // A crash between "quarantine" and "link" leaves the backup and no target;
  // put the last known-good copy back before deciding anything else.
  if (!pathExists(target)) {
    const leftover = findLeftoverBackup(target);
    if (leftover) restoreQuarantinedCopy({ from: target, to: leftover });
  }

  let quarantine = null;
  if (pathExists(target)) {
    if (isManagedUsagePanelCopy(target)) {
      quarantine = quarantineManagedCopy(target);
    }
  }
  try {
    const relinked = ensureDirectoryLink(sourceDir, target);
    return { relinked, quarantine };
  } catch (error) {
    restoreQuarantinedCopy(quarantine);
    throw error;
  }
}

/**
 * Junction/symlink profile node_modules → runtime so require() and
 * package-name resolution stay coherent with the file:// cordis insert.
 * @param {string} sourceDir
 * @param {string} profileDir
 */
function linkIntoProfileModules(sourceDir, profileDir) {
  const linked = path.join(profileDir, 'node_modules', USAGE_PANEL_PACKAGE);
  return linkToTarget(sourceDir, linked);
}

function withoutUsagePanelAliases(list) {
  const blocked = new Set(USAGE_PANEL_ALIASES);
  return (Array.isArray(list) ? list : [])
    .filter((name) => !blocked.has(String(name || '').trim()));
}

/**
 * Wire the desktop-built-in usage-panel from vendor (or packaged resources):
 * a desktop-owned `--patch` overlay
 * (`desktop-plugins/dsh-usage-panel/desktop-usage-panel.patch.yml`) carries the
 * package-name insert, and both `desktop-plugins/dsh-usage-panel` and
 * `node_modules/dsh-usage-panel` are junctions to that same runtime directory
 * so the name is resolvable through either path. The overlay rides EVERY
 * start (full and skip) — usage-panel is
 * desktop built-in Settings → 用量统计, not a user plugin, so the disable
 * list never applies (config normalization strips the aliases). The
 * profile's `cordis.patch.yml` is user-owned: this function only strips the
 * managed block earlier desktop versions wrote there and never writes one
 * back; the strip and the overlay write happen in the same call before every
 * spawn so no start can compose both copies (the CLI's `insert` does not
 * dedupe by id).
 *
 * @param {{ sourceDir?: string, profileDir?: string }} [options]
 * @returns {{
 *   ok: boolean,
 *   added?: boolean,
 *   destDir?: string|null,
 *   sourceDir?: string,
 *   overlayFile?: string,
 *   error?: string,
 * }}
 */
async function ensureDesktopUsagePanel(options = {}) {
  const sourceDir = options.sourceDir || defaultSourceDir();
  if (!fs.existsSync(path.join(sourceDir, 'package.json'))) {
    return { ok: false, added: false, error: 'missing-source:package.json' };
  }
  const profileDir = options.profileDir || webProfileDir();
  const patchFile = path.join(profileDir, 'cordis.patch.yml');
  // Migration: earlier desktop versions upserted a managed block into the
  // user-owned cordis.patch.yml. Strip it on every start regardless of the
  // outcome below — a stale copy composed next to the overlay double-mounts.
  stripBlockFromFile(patchFile, USAGE_PANEL_BEGIN, USAGE_PANEL_END);

  const missing = missingRuntimeFiles(sourceDir);
  if (missing.length) {
    // Broken vendor runtime is desktop damage — caller must fail the start
    // (skip cannot fix it); never pretend success with a stale mount.
    return {
      ok: false,
      added: false,
      error: `missing-source:node_modules:${missing.join(',')}`,
    };
  }

  const destDir = path.join(profileDir, 'desktop-plugins', USAGE_PANEL_PACKAGE);
  // `desktop-plugins/<pkg>` used to hold the whole ~6k-file copy; it now holds
  // only the overlay. A stale managed copy is quarantined (renamed beside
  // itself), never recursively deleted on the start path: the old bundle stays
  // recoverable and a failed link/overlay write can restore it.
  if (pathExists(destDir) && !isManagedUsagePanelCopy(destDir) && !isManagedOverlayDir(destDir)) {
    let linkLike = false;
    try {
      linkLike = fs.lstatSync(destDir).isSymbolicLink();
    } catch {
      linkLike = false;
    }
    if (!linkLike) {
      // Unknown content at our overlay path: writing the overlay here would
      // hijack a directory we do not own, and deleting it would be worse.
      return {
        ok: false,
        added: false,
        error: 'refusing to replace unknown content at desktop-plugins/dsh-usage-panel',
      };
    }
  }
  const hadManagedCopy = isManagedUsagePanelCopy(destDir);
  const destQuarantine = quarantineManagedCopy(destDir);
  let linked;
  let overlayWritten = false;
  try {
    fs.mkdirSync(destDir, { recursive: true });
    const linkedPath = path.join(profileDir, 'node_modules', USAGE_PANEL_PACKAGE);
    const hadLink = fs.existsSync(path.join(linkedPath, 'package.json'));
    linked = linkIntoProfileModules(sourceDir, profileDir);

    const overlayFile = path.join(destDir, USAGE_PANEL_OVERLAY_FILENAME);
    const overlayContents = [
      '# Desktop-managed overlay passed to EVERY start (full and skip) via',
      '# --patch: only the built-in usage-panel insert, never the profile user',
      '# layer. Regenerated on every start; do not edit.',
      '- insert:',
      '    - id: usage-stats',
      `      name: ${JSON.stringify(USAGE_PANEL_PACKAGE)}`,
      '',
    ].join('\n');
    const existing = fs.existsSync(overlayFile) ? fs.readFileSync(overlayFile, 'utf8') : '';
    if (existing !== overlayContents) {
      atomicWriteFileSync(overlayFile, overlayContents, { encoding: 'utf8' });
      overlayWritten = true;
    }
    return {
      ok: true,
      // `added` drives the "已接入桌面内置用量统计" log line: report a change on
      // first wiring, when the link target moved, or when a legacy copy was
      // replaced. A steady-state start that only re-verifies the link is not a
      // change.
      added: !hadLink || linked.relinked || hadManagedCopy,
      destDir,
      sourceDir,
      overlayFile,
      ...(destQuarantine ? { quarantinedCopy: destQuarantine.to } : {}),
    };
  } catch (error) {
    // Put the previous state back: the link is ours to remove, and the
    // quarantined bundle (if any) is renamed back into place.
    try {
      const linkedPath = path.join(profileDir, 'node_modules', USAGE_PANEL_PACKAGE);
      const createdLink = linked?.relinked === true;
      if (createdLink && pathExists(linkedPath) && fs.lstatSync(linkedPath).isSymbolicLink()) {
        fs.unlinkSync(linkedPath);
      }
    } catch {
      // Best effort; the overlay/quarantine restore below still runs.
    }
    if (destQuarantine) {
      // Drop the partial replacement directory, then put the old bundle back.
      try {
        fs.rmSync(destDir, { recursive: true, force: true });
      } catch {
        // Best effort.
      }
      restoreQuarantinedCopy(destQuarantine);
    } else if (overlayWritten) {
      // No previous bundle: remove only the overlay we just wrote.
      try {
        fs.rmSync(path.join(destDir, USAGE_PANEL_OVERLAY_FILENAME), { force: true });
      } catch {
        // Best effort.
      }
    }
    throw error;
  }
}

/** @deprecated Use ensureDesktopUsagePanel — kept as alias for harness wiring. */
function ensureUsagePanelPlugin(options) {
  return ensureDesktopUsagePanel(options);
}

module.exports = {
  USAGE_PANEL_PACKAGE,
  USAGE_PANEL_BEGIN,
  USAGE_PANEL_END,
  USAGE_PANEL_ALIASES,
  withoutUsagePanelAliases,
  ensureDesktopUsagePanel,
  ensureUsagePanelPlugin,
};
