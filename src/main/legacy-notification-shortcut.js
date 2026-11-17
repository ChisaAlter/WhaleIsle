'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const DESKTOP_APP_ID = 'ai.deepseek.harness.gui';
const SHCNE_DELETE = 2;
const SHCNF_PATHW_FLUSH = 0x1005;
const SHELL_NOTIFICATION_DEADLINE_MS = 500;
let shellChangeNotify;

function windowsShortcutApi() {
  if (!shellChangeNotify) {
    shellChangeNotify = require('koffi').load('shell32.dll')
      .func('void __stdcall SHChangeNotify(long eventId, uint flags, str16 oldPath, str16 newPath)');
  }
  return shellChangeNotify;
}

function canonicalWindowsPath(value) {
  if (typeof value !== 'string' || !/^[a-z]:\\/i.test(value) || /[<>"|?*\x00-\x1f]/.test(value)
      || value.slice(2).includes(':') || path.win32.normalize(value) !== value) return false;
  return value.slice(3).split('\\').every(part => part && !/[. ]$/.test(part));
}

/** Retire the old Shell entry after its bytes are backed up, within the startup budget. */
async function notifyShortcutMoved(oldPath, newPath, { platform = process.platform, loadApi = windowsShortcutApi } = {}) {
  if (platform !== 'win32' || !canonicalWindowsPath(oldPath) || !canonicalWindowsPath(newPath)
      || oldPath.toLowerCase() === newPath.toLowerCase()) return false;
  let deadline;
  try {
    return await new Promise(resolve => {
      const finish = success => {
        clearTimeout(deadline);
        resolve(success);
      };
      // FLUSH waits for event delivery, not a correct taskbar image. The startup
      // budget does not cancel the native call; late callbacks cannot change it.
      deadline = setTimeout(() => finish(false), SHELL_NOTIFICATION_DEADLINE_MS);
      loadApi().async(SHCNE_DELETE, SHCNF_PATHW_FLUSH, oldPath, null, error => finish(!error));
    });
  } catch {
    clearTimeout(deadline);
    return false;
  }
}

/** Match only the raw Electron notification shortcut carrying our desktop identity. */
function isLegacyNotificationShortcut(details) {
  return Boolean(details && details.appUserModelId === DESKTOP_APP_ID
    && details.args === '' && details.iconIndex === 0
    && canonicalWindowsPath(details.target)
    && path.win32.basename(details.target).toLowerCase() === 'electron.exe'
    && (details.icon === '' || (canonicalWindowsPath(details.icon)
      && details.icon.toLowerCase() === details.target.toLowerCase())));
}

function unchangedFile(before, after) {
  return after.isFile() && !after.isSymbolicLink() && before.dev === after.dev
    && before.ino === after.ino && before.size === after.size && before.mtimeMs === after.mtimeMs;
}

/**
 * Remove the one obsolete notification identity from Shell discovery by moving
 * its original bytes into a unique app-owned backup. Never scan or alter pins,
 * installed shortcuts, other Electron apps, or user-customized links.
 * Inspection or backup failure preserves the source. Shell delivery failure
 * keeps the completed backup and must not prevent the desktop from starting.
 */
async function migrateLegacyNotificationShortcut({
  platform = process.platform, isPackaged = false, launcher = false,
  appDataDir, userDataDir, readShortcutLink, io = fs, createBackupId = randomUUID,
  notifyShortcutMoved: notifyMoved = notifyShortcutMoved,
} = {}) {
  if (platform !== 'win32' || !isPackaged || launcher) return { status: 'not-applicable' };
  if (!canonicalWindowsPath(appDataDir) || !canonicalWindowsPath(userDataDir)
      || typeof readShortcutLink !== 'function') return { status: 'failed', reason: 'invalid-input' };
  const shortcut = path.win32.join(appDataDir, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Electron.lnk');
  let backupDirectory;
  let stage = 'read';
  try {
    let original;
    try { original = await io.lstat(shortcut); }
    catch (error) { if (error.code === 'ENOENT') return { status: 'absent' }; throw error; }
    if (!original.isFile() || original.isSymbolicLink()) return { status: 'preserved', reason: 'not-regular-file' };
    const details = readShortcutLink(shortcut);
    if (!isLegacyNotificationShortcut(details)) return { status: 'preserved', reason: 'different-shortcut' };
    let target;
    try { target = await io.lstat(details.target); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    // A deleted source checkout can leave the same obsolete Shell identity.
    // Existing executable links and redirected targets still fail closed.
    if (target) {
      if (!target.isFile() || target.isSymbolicLink()) return { status: 'preserved', reason: 'different-target' };
      const targetReal = await io.realpath(details.target);
      if (!canonicalWindowsPath(targetReal) || targetReal.toLowerCase() !== details.target.toLowerCase()) {
        return { status: 'preserved', reason: 'different-target' };
      }
    }

    stage = 'backup';
    const userDataReal = await io.realpath(userDataDir);
    const backupRoot = path.win32.join(userDataDir, 'legacy-system-shortcuts');
    await io.mkdir(backupRoot, { recursive: true });
    const rootInfo = await io.lstat(backupRoot);
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) return { status: 'failed', reason: 'unsafe-backup-directory' };
    const rootReal = await io.realpath(backupRoot);
    if (rootReal.toLowerCase() !== path.win32.join(userDataReal, 'legacy-system-shortcuts').toLowerCase()) {
      return { status: 'failed', reason: 'unsafe-backup-directory' };
    }
    const id = createBackupId();
    if (typeof id !== 'string' || !/^[a-z0-9-]+$/i.test(id)) return { status: 'failed', reason: 'invalid-backup-id' };
    const candidateDirectory = path.win32.join(backupRoot, id);
    // Exclusive mkdir prevents replacing an earlier backup, including on POSIX test hosts.
    await io.mkdir(candidateDirectory);
    backupDirectory = candidateDirectory;
    const current = await io.lstat(shortcut);
    if (!unchangedFile(original, current) || !isLegacyNotificationShortcut(readShortcutLink(shortcut))) {
      await io.rmdir(backupDirectory);
      backupDirectory = undefined;
      return { status: 'preserved', reason: 'shortcut-changed' };
    }
    stage = 'move';
    const backupPath = path.win32.join(backupDirectory, 'Electron.lnk.backup');
    await io.rename(shortcut, backupPath);
    let shellNotified = false;
    try { shellNotified = await notifyMoved(shortcut, backupPath); } catch { /* The backup is already safe. */ }
    return { status: 'migrated', backupPath, shellNotified: shellNotified === true };
  } catch {
    if (backupDirectory) await io.rmdir(backupDirectory).catch(() => { /* The migration returns its stage failure below; the empty backup directory may already be absent. */ });
    return { status: 'failed', reason: `${stage}-failed` };
  }
}

module.exports = { isLegacyNotificationShortcut, migrateLegacyNotificationShortcut, notifyShortcutMoved };
