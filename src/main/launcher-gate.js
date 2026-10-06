'use strict';

const fs = require('fs');
const path = require('path');

// Local copy of the blocked predicate so the gate can honor an unreadable
// journal the same way the service/index admission paths do (fail closed),
// without taking a hard require on data-import here.
function journalIsBlockedImpl(journal) {
  return Boolean(journal) && (journal.phase === 'blocked' || journal.unreadable === true);
}

function lastDesktopStartPath(userDataDir) {
  return path.join(userDataDir, 'last-desktop-start.json');
}

function readLastDesktopStart(userDataDir) {
  try {
    const raw = JSON.parse(fs.readFileSync(lastDesktopStartPath(userDataDir), 'utf8'));
    return {
      ok: raw.ok === true ? true : raw.ok === false ? false : null,
      at: typeof raw.at === 'string' ? raw.at : '',
      error: typeof raw.error === 'string' ? raw.error : '',
      // Bounded kernel-log tail captured at the failure instant — the slim
      // launcher's only window into plugin loader errors, since a packaged
      // runtime's console does not reliably reach a piped stderr.
      logTail: Array.isArray(raw.logTail) ? raw.logTail.filter((l) => typeof l === 'string') : [],
    };
  } catch {
    return { ok: null, at: '', error: '', logTail: [] };
  }
}

const LAST_START_LOG_TAIL = 80;

// dsh.logs rows are objects ({message}/{line}) in the kernel but sometimes
// plain strings — normalize to a flat string tail for last-desktop-start.json.
function kernelLogTail(dsh, limit = LAST_START_LOG_TAIL) {
  const rows = typeof dsh?.currentStartLogs === 'function'
    ? dsh.currentStartLogs()
    : (Array.isArray(dsh?.logs) ? dsh.logs : []);
  return rows
    .slice(-limit)
    .map((row) => (typeof row === 'string' ? row : row?.message || row?.line || String(row)));
}

function writeLastDesktopStart(userDataDir, payload) {
  fs.mkdirSync(userDataDir, { recursive: true });
  const file = lastDesktopStartPath(userDataDir);
  const tmp = `${file}.tmp`;
  const logTail = Array.isArray(payload.logTail)
    ? payload.logTail.slice(-LAST_START_LOG_TAIL).map((l) => String(l).slice(0, 240))
    : [];
  fs.writeFileSync(tmp, `${JSON.stringify({
    ok: payload.ok === true,
    at: payload.at || new Date().toISOString(),
    error: payload.error || '',
    logTail,
  }, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

/**
 * Record a full desktop start outcome into last-desktop-start.json.
 * Every start path (launcher, boot retry, menu/tray restart, plugin align)
 * must go through one writer so a stale `{ ok:false }` can never keep holding
 * the next cold start at the launcher after the desktop actually recovered.
 */
async function recordLastDesktopStart(userDataDir, work, evidence) {
  try {
    const value = await work();
    writeLastDesktopStart(userDataDir, { ok: true });
    return value;
  } catch (error) {
    writeLastDesktopStart(userDataDir, {
      ok: false,
      error: error && error.message ? error.message : String(error),
      logTail: typeof evidence === 'function' ? evidence() : [],
    });
    throw error;
  }
}

function shouldPromptUpdate({ askOnUpdate, check }) {
  return askOnUpdate !== false && check && check.status === 'available';
}

/**
 * Single source of truth for "skip user plugins is sticky for this build".
 * A recovery marker written by another app version is stale, not active.
 * Owner shape: { pluginRecovery, appVersion } (HarnessController or snapshot).
 */
function stickySkipActive(owner) {
  const recovery = owner && owner.pluginRecovery;
  if (!recovery || !recovery.skipUserPlugins) {
    return false;
  }
  return recovery.appVersion === owner.appVersion;
}

function shouldAutoStartDesktop({
  autoStartDesktop,
  holdForImport,
  updateFlowHold,
  lastStartFailed,
}) {
  if (autoStartDesktop === false) return false;
  if (holdForImport) return false;
  if (updateFlowHold) return false;
  if (lastStartFailed) return false;
  return true;
}

function shouldCloseLauncher({ desktopReady, quitAfterStart }) {
  return desktopReady === true && quitAfterStart !== false;
}

/** Launcher may close only after a confirmed healthy full start. */
function shouldCloseLauncherAfterDesktopStart({
  desktopReady,
  quitAfterStart,
  stickySkip,
  recoveryLaunch,
  lastStartOk,
}) {
  if (!shouldCloseLauncher({ desktopReady, quitAfterStart })) {
    return false;
  }
  if (stickySkip || recoveryLaunch) {
    return false;
  }
  return lastStartOk === true;
}

/** Hint shown when an accepted update did not end with the app quitting. */
function updateStayHint(check, outcome) {
  if (outcome?.manualInstall === true) {
    const message = outcome.message || '已打开安装映像，请将 Whale Isle 拖入 Applications 完成更新';
    return { ...check, message, hint: `${message}。完成后重新打开应用。` };
  }
  if (outcome && outcome.launched === true) {
    const message = '安装器已启动（当前为源码运行，应用不会自动退出）';
    return { ...check, message, hint: `${message}。` };
  }
  if (outcome && outcome.openedPage === true) {
    const message = '该版本没有安装包资产，已打开发布页';
    return { ...check, message, hint: `${message}。仍可启动桌面端。` };
  }
  const message = (outcome && outcome.message) || '更新未完成，可稍后重试或手动启动桌面端';
  return {
    ...check,
    status: 'error',
    message,
    hint: `更新未完成：${message}。仍可启动桌面端。`,
  };
}

/**
 * An update result that arrived after auto-start. It is kept in-process (no
 * disk format, no cross-launch state) so the ask can still happen the next time
 * the user actually opens the launcher in this process.
 */
let parkedUpdateCheck = null;

function parkUpdateCheck(check) {
  if (!check || check.status !== 'available') {
    return;
  }
  parkedUpdateCheck = check;
}

function takeParkedUpdateCheck() {
  const check = parkedUpdateCheck;
  parkedUpdateCheck = null;
  return check;
}

function peekParkedUpdateCheck() {
  return parkedUpdateCheck;
}

function resetParkedUpdateCheck() {
  parkedUpdateCheck = null;
}

/**
 * The one place a parked (late) update result is turned into an ask.
 *
 * `shell:launcher-status` is polled by a pre-created, possibly *hidden*
 * launcher window; consuming the parked result there lost it before the user
 * ever saw the window (and a second status poll could no longer show it).
 * The drainer only consumes while the launcher is genuinely visible and not
 * quitting, and it is re-entrant-safe: the same parked result can never be
 * asked twice, because the first drain takes it.
 *
 * @param {{
 *   readConfig: () => object,
 *   isVisible: () => boolean,
 *   isQuitting: () => boolean,
 *   isCurrentGeneration?: (generation: unknown) => boolean,
 *   present: (check: object, context: { generation: unknown }) => Promise<object | void>,
 *   log?: (message: string) => void,
 * }} deps
 */
function createParkedUpdateDrainer({
  readConfig,
  isVisible,
  isQuitting,
  isCurrentGeneration = () => true,
  present,
  log = () => {},
}) {
  let inFlight = null;

  return {
    async drain({ generation } = {}) {
      if (inFlight) return inFlight;
      if (isQuitting()) return { drained: false, reason: 'quitting' };
      if (!isVisible()) return { drained: false, reason: 'hidden' };
      if (!isCurrentGeneration(generation)) return { drained: false, reason: 'stale' };
      const check = peekParkedUpdateCheck();
      if (!check) return { drained: false, reason: 'none' };
      if (!shouldPromptUpdate({ askOnUpdate: readConfig()?.askOnUpdate, check })) {
        // The setting is off (or the check has nothing to prompt about):
        // consume it silently so it cannot resurface on a later open.
        takeParkedUpdateCheck();
        return { drained: false, reason: 'not-promptable' };
      }
      inFlight = (async () => {
        const taken = takeParkedUpdateCheck();
        if (taken !== check) {
          // A newer check replaced this one between peek and take.
          return { drained: false, reason: 'superseded' };
        }
        // Re-check the world after every await boundary in `present`.
        if (isQuitting() || !isCurrentGeneration(generation) || !isVisible()) {
          // Put the result back rather than dropping it: the user hid the
          // launcher (or a newer window replaced it) but may open it again.
          // Never clobber a newer parked check that arrived meanwhile.
          if (!peekParkedUpdateCheck()) parkUpdateCheck(taken);
          return { drained: false, reason: 'abandoned', check: taken };
        }
        try {
          const outcome = await present(taken, { generation });
          if (outcome?.abandoned === true) {
            if (!peekParkedUpdateCheck()) parkUpdateCheck(taken);
            return { drained: false, reason: 'abandoned', check: taken, outcome };
          }
          return { drained: true, check: taken, outcome };
        } catch (error) {
          log(`更新提示失败：${error && error.message ? error.message : String(error)}`);
          return { drained: false, reason: 'error', check: taken };
        }
      })().finally(() => {
        inFlight = null;
      });
      return inFlight;
    },
    isDraining: () => inFlight !== null,
  };
}

/**
 * The update ask itself: confirm, then download/verify/launch. Shared by the
 * cold-start gate and the "late result" drain so both keep one contract —
 * the ask never sits on an invisible window, and only packaged + installer
 * waits for the app to quit.
 */
async function presentUpdateAsk({
  config,
  isPackaged,
  check,
  confirmUpdate,
  installUpdate,
  openLauncher,
  sendToLauncher,
  alreadyVisible = false,
  shouldContinue = () => true,
}) {
  if (!shouldPromptUpdate({ askOnUpdate: config.askOnUpdate, check })) {
    return { updateFlowHold: false, installer: false };
  }
  if (!alreadyVisible) {
    await openLauncher();
  }
  if (!(await confirmUpdate(check))) {
    return { updateFlowHold: false, installer: false };
  }
  // The window may have been closed, the app may be quitting, or an install
  // may have started while the confirm dialog was open. Never carry the flow
  // past an await boundary on a stale decision.
  if (!shouldContinue()) {
    return { updateFlowHold: false, installer: false, abandoned: true };
  }
  try {
    const outcome = await installUpdate((payload) => {
      sendToLauncher('shell:update-progress', payload);
    }, check);
    // Slim-package runtime installs finish in-place (no quit): report success
    // as a hint instead of the self-update "installer launched" contract.
    if (outcome && outcome.status === 'installed') {
      sendToLauncher('shell:launcher-hint', {
        check: {
          ...check,
          status: 'installed',
          hint: `已安装 ${(outcome.installed && outcome.installed.version) || check.latest || ''}，可启动桌面端。`,
        },
      });
      return { updateFlowHold: true, installer: false };
    }
    if (outcome && outcome.launched === true && isPackaged) {
      return { updateFlowHold: true, installer: true };
    }
    sendToLauncher('shell:launcher-hint', { check: updateStayHint(check, outcome) });
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    sendToLauncher('shell:launcher-hint', {
      check: {
        ...check,
        status: 'error',
        message,
        hint: `更新下载失败：${message}。仍可启动桌面端。`,
      },
    });
  }
  return { updateFlowHold: true, installer: false };
}

/**
 * Cold-start gate orchestration. All effects are injected so the flow is
 * unit-testable; src/main/index.js supplies the Electron-bound deps.
 *
 * Contract (feature card `desktop-launcher`):
 * - The online update check runs concurrently with the local start decision and
 *   never delays auto-start. A late result only ever writes a launcher hint; it
 *   never opens/focuses the launcher and never starts the desktop a second time.
 * - The update ask and download progress sit on a visible launcher window,
 *   never on the hidden pre-created one.
 * - An accepted update that fails (download/checksum), only opened the
 *   releases page, or launched the installer from a source run falls back to
 *   the launcher home so「启动桌面端」still works — no hidden window-less
 *   process is ever left behind. Only packaged + installer-launched waits for
 *   the app to quit.
 */
async function runColdStartGate({
  config,
  userDataDir,
  isPackaged,
  checkUpdate,
  confirmUpdate,
  installUpdate,
  openLauncher,
  sendToLauncher,
  recoverInterruptedImport,
  readImportJournal,
  journalIsBlocked,
  startDesktop,
  drainParkedUpdateCheck = async () => {},
  log = () => {},
}) {
  // Start the network check without awaiting it: it must overlap the local
  // start decision instead of preceding it.
  const updateCheck = (async () => {
    try {
      return await checkUpdate();
    } catch (error) {
      return { status: 'error', message: error && error.message ? error.message : String(error) };
    }
  })();

  let importRecovery = { recovered: false, removedTmp: [] };
  try {
    importRecovery = recoverInterruptedImport() || importRecovery;
  } catch (error) {
    log(`导入日志恢复失败：${error && error.message ? error.message : String(error)}`, 'error');
    // A recovery exception must fail closed: hold at the launcher instead of
    // risking an auto-start over unknown transaction state.
    importRecovery.blocked = true;
  }
  // Persistent unresolved recovery holds the launcher on every start path —
  // including direct starts that bypass the shallow import probe — and it
  // does not clear just because a valid session already exists.
  const recoveryBlocked = importRecovery.blocked === true
    || (typeof readImportJournal === 'function'
      && (journalIsBlocked || journalIsBlockedImpl)(readImportJournal(userDataDir)));
  // Optional source data is not a startup blocker. Only an interrupted
  // import or unresolved transaction may take over the cold-start route.
  const holdForImport = importRecovery.recovered === true
    || recoveryBlocked;
  const lastStartFailed = readLastDesktopStart(userDataDir).ok === false;
  const stayAtLauncher = holdForImport || lastStartFailed;
  const autoStart = shouldAutoStartDesktop({
    autoStartDesktop: config.autoStartDesktop,
    holdForImport,
    updateFlowHold: false,
    lastStartFailed,
  });
  if (holdForImport) {
    sendToLauncher('shell:show-tab', { tab: 'import' });
  }
  if (importRecovery.recovered === true) {
    sendToLauncher('shell:launcher-hint', {
      importResume: { removedTmp: (importRecovery.removedTmp || []).length },
    });
  }
  if (!holdForImport && (lastStartFailed || !autoStart)) {
    sendToLauncher('shell:show-tab', { tab: 'home' });
  }

  if (!autoStart) {
    // Local rules already require the launcher, so the update ask can still run
    // in a visible window — but the window opens first either way.
    await openLauncher();
  }

  if (autoStart) {
    let desktopResult;
    let desktopThrew = false;
    try {
      desktopResult = await startDesktop();
    } catch (error) {
      desktopThrew = true;
      const message = error && error.message ? error.message : String(error);
      log(`桌面启动失败：${message}`, 'error');
      desktopResult = { ok: false, error: message };
    }
    const desktopFailed = desktopResult?.ok === false;
    if (desktopFailed) {
      await openLauncher();
      sendToLauncher('shell:show-tab', { tab: 'home' });
      if (desktopThrew) {
        sendToLauncher('shell:desktop-failed', { error: desktopResult.error || '桌面启动失败' });
      }
    }
    // Late result: hint only, and park it so the ask happens the next time the
    // user actually opens the launcher. Never re-open the launcher here (that
    // would steal focus from the desktop the user asked for) and never start a
    // second time.
    void updateCheck.then(async (check) => {
      parkUpdateCheck(check);
      sendToLauncher('shell:launcher-hint', { check });
      if (desktopFailed && check?.status === 'available') {
        await drainParkedUpdateCheck();
      }
    }).catch((error) => {
      log(`迟到更新处理失败：${error && error.message ? error.message : String(error)}`, 'error');
    });
    return {
      outcome: desktopFailed ? 'launcher' : 'desktop',
      updateFlowHold: false,
      holdForImport,
      lastStartFailed: desktopFailed || lastStartFailed,
    };
  }

  const check = await updateCheck;
  sendToLauncher('shell:launcher-hint', { check });

  const asked = await presentUpdateAsk({
    config,
    isPackaged,
    check,
    confirmUpdate,
    installUpdate,
    openLauncher,
    sendToLauncher,
    // The launcher is already on screen whenever auto-start did not proceed.
    alreadyVisible: !autoStart,
  });
  const updateFlowHold = asked.updateFlowHold;
  if (asked.installer) {
    // update.js schedules app.quit() once the installer is up; the launcher
    // stays visible until the process exits.
    return {
      outcome: 'installer', updateFlowHold, holdForImport: false, lastStartFailed: false,
    };
  }

  if (!stayAtLauncher && updateFlowHold) {
    sendToLauncher('shell:show-tab', { tab: 'home' });
  }
  return {
    outcome: 'launcher', updateFlowHold, holdForImport, lastStartFailed,
  };
}

module.exports = {
  lastDesktopStartPath,
  readLastDesktopStart,
  writeLastDesktopStart,
  kernelLogTail,
  recordLastDesktopStart,
  shouldPromptUpdate,
  stickySkipActive,
  shouldAutoStartDesktop,
  shouldCloseLauncher,
  shouldCloseLauncherAfterDesktopStart,
  runColdStartGate,
  parkUpdateCheck,
  takeParkedUpdateCheck,
  peekParkedUpdateCheck,
  resetParkedUpdateCheck,
  createParkedUpdateDrainer,
  presentUpdateAsk,
};
