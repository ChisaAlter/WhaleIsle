'use strict';

/**
 * Shared profile/config mutation core for the two surfaces that flip plugins
 * or renderer-writable settings: the launcher/harness IPC handlers in
 * ipc.js and the loopback desktop-control channel (desktop-install-control)
 * that in-Harness plugins such as dsh-whale call. The module-level align
 * chain below serializes disable/enable writes with their Harness restart
 * across BOTH surfaces, so a second caller cannot join a restart that
 * started before its write landed.
 */

const { loadConfig, saveConfig, normalizeRendererConfigPatch } = require('./config');
const {
  applyDisabledBundles,
  setBundleEnabled,
  OFFICIAL_TEMPLATE_BUNDLES,
} = require('./plugins');
const { DSH_IM_ALIASES } = require('./dsh-im-desktop');
const { DSHBOT_ALIASES } = require('./dshbot-desktop');
const { DSH_MARKET_ALIASES } = require('./dsh-market-desktop');
const { DSH_WHALE_ALIASES } = require('./dsh-whale-desktop');
const { DSH_REMOTE_ALIASES } = require('./dsh-remote-desktop');
const { USAGE_PANEL_ALIASES } = require('./usage-panel-preset');
const { isPresetPlugin } = require('./plugin-forensics');
const importGuard = require('./import-guard');

/**
 * Every profile/config mutation that writes the destination trees shares the
 * one maintenance slot with import/start/install. When another operation
 * holds it (an import mid-copy, a runtime install, a start), refuse rather
 * than race a write through a half-replaced directory. The caller surfaces
 * `maintenance-in-progress` as a normal operation error.
 */

/**
 * Persistent recovery admission: a blocked import journal must refuse the
 * write BEFORE any configuration is mutated — rejecting a later restart
 * after the config already landed is not equivalent to refusing the
 * mutation. The desktop (which owns the userData path) injects the probe via
 * {@link configureProfileOps}; without a probe this check is inert.
 */
let journalBlockedProbe = null;

function configureProfileOps({ journalBlocked } = {}) {
  if (typeof journalBlocked === 'function') {
    journalBlockedProbe = journalBlocked;
  }
}

/** Reason the last {@link acquireMaintenance} returned null. */
let lastAcquireRefusal = null;

/** 'import-recovery-blocked' | 'maintenance-in-progress' | null */
function acquireRefusalReason() {
  return lastAcquireRefusal;
}

/**
 * Acquire the maintenance slot for a profile mutation, returning the owner
 * token (or null when held). The caller releases via `release(token)` on the
 * synchronous path, or hands the token to `holdThrough` so ownership survives
 * until the deferred align work settles.
 */
function acquireMaintenance(kind) {
  lastAcquireRefusal = null;
  if (journalBlockedProbe && journalBlockedProbe()) {
    // Unknown or blocked recovery state fails closed: refuse the mutation
    // BEFORE it is written — rejecting a later restart after config already
    // landed is not equivalent to refusing the mutation. Surfaced as a
    // null-token refusal; `acquireRefusalReason()` distinguishes it from
    // ordinary slot occupancy for the caller's error payload.
    lastAcquireRefusal = 'import-recovery-blocked';
    return null;
  }
  const token = importGuard.acquireMaintenance(kind, { surface: 'profile-ops' });
  if (!token) lastAcquireRefusal = 'maintenance-in-progress';
  return token;
}
function releaseMaintenance(token) {
  importGuard.releaseMaintenance(token);
}
/** Release `token` once `promise` settles; returns the same promise. */
function holdThrough(token, promise) {
  return Promise.resolve(promise).finally(() => releaseMaintenance(token));
}

const HARNESS_DOWN_AFTER_DISABLE = '插件禁用名单已写入，但 Harness 没有重新起来。请从现有入口重启。';
const HARNESS_DOWN_AFTER_ENABLE = '插件启用已写入，但 Harness 没有重新起来。请从现有入口重启。';

function uniqueNames(names) {
  return [...new Set((Array.isArray(names) ? names : [])
    .map((name) => String(name || '').trim())
    .filter(Boolean))];
}

function pluginDisableGuardError(name) {
  if (OFFICIAL_TEMPLATE_BUNDLES.has(name)) {
    return 'official-template';
  }
  if (DSH_IM_ALIASES.includes(name)
    || DSH_MARKET_ALIASES.includes(name)
    || DSHBOT_ALIASES.includes(name)
    || DSH_WHALE_ALIASES.includes(name)
    || DSH_REMOTE_ALIASES.includes(name)
    || USAGE_PANEL_ALIASES.includes(name)) {
    return 'desktop-builtin';
  }
  return null;
}

/** Removal guards mirror the launcher's remove-plugin channel. */
function pluginRemoveGuardError(name) {
  if (isPresetPlugin(name) || OFFICIAL_TEMPLATE_BUNDLES.has(name)) {
    return 'preset';
  }
  return null;
}

function dshKernelState(dsh) {
  if (!dsh) {
    return '';
  }
  if (typeof dsh.state === 'string' && dsh.state) {
    return dsh.state;
  }
  if (typeof dsh.snapshot === 'function') {
    return dsh.snapshot().state || '';
  }
  return '';
}

function kernelNeedsAlign(dsh) {
  const state = dshKernelState(dsh);
  return state === 'ready' || state === 'starting' || state === 'error';
}

function kernelIsRunning(dsh) {
  const state = dshKernelState(dsh);
  return state !== 'idle' && state !== '';
}

let profileAlignChain = Promise.resolve();

function enqueueProfileAlign(work) {
  const run = profileAlignChain.then(work, work);
  profileAlignChain = run.catch(() => {});
  return run;
}

/**
 * Realign Harness after a profile mutation. `ownerToken` is the maintenance
 * token this operation acquired — it is forwarded to the restart boundary so
 * the nested restart is recognized as THIS operation delegating to itself
 * (owner-aware delegation), not refused as a foreign caller. A resolved
 * refusal ({proceeded:false}) is reported truthfully, not read as success.
 */
async function alignHarnessAfterProfileChange(startHarness, downError, ownerToken) {
  if (typeof startHarness !== 'function') {
    return { harnessRestarted: false, error: downError };
  }
  try {
    const outcome = await startHarness(ownerToken);
    // The restart may resolve a refusal rather than reject — e.g. the task
    // protection funnel cancelled, or a foreign maintenance owner blocked it.
    // A resolved non-proceed is not a successful restart.
    if (outcome && (outcome.proceeded === false || outcome.ok === false)) {
      return { harnessRestarted: false, error: outcome.error || outcome.code || downError };
    }
    return { harnessRestarted: true };
  } catch {
    return { harnessRestarted: false, error: downError };
  }
}

/**
 * Disable user plugins: union into disabledPlugins, rewrite the profile
 * bundle list, then realign Harness when a kernel is live or a start is
 * explicitly requested. Mirrors the
 * launcher's shell:disable-plugins / shell:disable-plugin handlers.
 */
async function disablePlugins(names, { dsh, startHarness, configIO, startWhenIdle = false } = {}) {
  const token = acquireMaintenance('plugin-disable');
  if (!token) {
    return { ok: false, error: acquireRefusalReason() || 'maintenance-in-progress', owner: importGuard.maintenanceOwner()?.kind };
  }
  // Exception-safe ownership: any synchronous throw between acquisition and
  // the deferred-align handoff must release the slot, or a config/bundle
  // failure would leave the global owner held until the process restarts.
  // `transferred` flips once ownership moves into the align promise so the
  // catch does not release a token the align legitimately still holds.
  let transferred = false;
  try {
  const list = uniqueNames(names);
  if (!list.length) {
    releaseMaintenance(token);
    return { ok: false, error: 'missing-names' };
  }
  for (const raw of list) {
    const guardError = pluginDisableGuardError(raw);
    if (guardError) {
      releaseMaintenance(token);
      return { ok: false, error: guardError, name: raw };
    }
  }
  // configIO lets the slim launcher retarget disabledPlugins at the managed
  // runtime's config.json — the desktop is the process that honors the list.
  const io = configIO || { load: loadConfig, save: saveConfig };
  const config = io.load();
  const disabled = [...new Set([...(config.disabledPlugins || []), ...list])];
  applyDisabledBundles(disabled);
  io.save({ disabledPlugins: disabled });
  if (!startWhenIdle && !kernelNeedsAlign(dsh)) {
    releaseMaintenance(token);
    return { ok: true, harnessRestarted: false };
  }
  // The deferred align restart is part of this mutation — ownership must
  // outlive the synchronous return and release only once it settles.
  transferred = true;
  return holdThrough(token, enqueueProfileAlign(async () => {
    const align = await alignHarnessAfterProfileChange(startHarness, HARNESS_DOWN_AFTER_DISABLE, token);
    return { ok: true, ...align };
  }));
  } catch (error) {
    if (!transferred) {
      releaseMaintenance(token);
    }
    throw error;
  }
}

/**
 * Re-enable one plugin: drop it from disabledPlugins, put its bundle back
 * (when still a dependency), then realign. Mirrors shell:enable-plugin —
 * including the quirk that the disabled-list write commits even when the
 * bundle re-add reports a failure.
 */
async function enablePlugin(name, { dsh, startHarness, configIO } = {}) {
  const token = acquireMaintenance('plugin-enable');
  if (!token) {
    return { ok: false, error: acquireRefusalReason() || 'maintenance-in-progress', owner: importGuard.maintenanceOwner()?.kind };
  }
  let transferred = false;
  try {
  const raw = String(name || '').trim();
  if (!raw) {
    releaseMaintenance(token);
    return { ok: false, error: 'missing-name' };
  }
  const io = configIO || { load: loadConfig, save: saveConfig };
  const disabled = (io.load().disabledPlugins || []).filter((item) => item !== raw);
  const enabled = setBundleEnabled(raw, true);
  applyDisabledBundles(disabled);
  io.save({ disabledPlugins: disabled });
  if (enabled.ok === false) {
    releaseMaintenance(token);
    return { ok: false, ...enabled, harnessRestarted: false };
  }
  if (!kernelNeedsAlign(dsh)) {
    releaseMaintenance(token);
    return { ok: true, ...enabled, harnessRestarted: false };
  }
  transferred = true;
  return holdThrough(token, enqueueProfileAlign(async () => {
    const align = await alignHarnessAfterProfileChange(startHarness, HARNESS_DOWN_AFTER_ENABLE, token);
    return { ok: true, ...enabled, ...align };
  }));
  } catch (error) {
    if (!transferred) {
      releaseMaintenance(token);
    }
    throw error;
  }
}

/**
 * Apply a renderer-writable config patch with the same normalization and
 * side effects as shell:save-config: login item, theme apply, Harness
 * restart-policy refresh, and a deferred profile-align restart when a
 * built-in plugin toggle changed. Returns the saved config.
 */
function applyRendererConfigPatch(patch, { app, applyAppTheme, harness, startHarness, log } = {}) {
  // A config write mutates the destination the import journal protects.
  // Acquire the slot for the synchronous write; when the patch also triggers
  // a deferred align restart, hold ownership until that work settles.
  const token = acquireMaintenance('config-patch');
  if (!token) {
    const reason = acquireRefusalReason() || 'maintenance-in-progress';
    throw Object.assign(new Error(reason), { code: reason, owner: importGuard.maintenanceOwner()?.kind });
  }
  let transferred = false;
  try {
  const safePatch = normalizeRendererConfigPatch(patch || {});
  const next = saveConfig(safePatch);
  if (app && typeof app.setLoginItemSettings === 'function') {
    app.setLoginItemSettings({ openAtLogin: Boolean(next.openAtLogin) });
  }
  if (Object.prototype.hasOwnProperty.call(safePatch, 'theme') && typeof applyAppTheme === 'function') {
    applyAppTheme();
  }
  if (harness && [
    'harnessAutoRestart',
    'harnessRestartMaxAttempts',
    'harnessRestartBaseDelayMs',
  ].some((key) => Object.prototype.hasOwnProperty.call(safePatch, key))) {
    harness.refreshPolicy();
  }
  if (
    harness
    && typeof startHarness === 'function'
    && (Object.prototype.hasOwnProperty.call(safePatch, 'dshbotEnabled')
      || Object.prototype.hasOwnProperty.call(safePatch, 'whaleAssistantEnabled')
      || Object.prototype.hasOwnProperty.call(safePatch, 'remoteWorkspaceEnabled'))
  ) {
    // The Bots / whale-assistant / remote-workspace toggles change which overlays the next
    // start composes: return the saved config first, then restart Harness
    // off-thread.
    setImmediate(() => {
      void holdThrough(token, enqueueProfileAlign(() => alignHarnessAfterProfileChange(startHarness, 'built-in plugin toggle restart failed', token)))
        .then((result) => {
          if (result && result.harnessRestarted !== true && typeof log === 'function') {
            log(`切换内置插件后重启 Harness 失败：${result.error || 'unknown'}`);
          }
        })
        .catch(() => {});
    });
    // Ownership transfers to the deferred align; do not release it here.
    transferred = true;
    return next;
  }
  releaseMaintenance(token);
  return next;
  } catch (error) {
    if (!transferred) {
      releaseMaintenance(token);
    }
    throw error;
  }
}

module.exports = {
  HARNESS_DOWN_AFTER_DISABLE,
  HARNESS_DOWN_AFTER_ENABLE,
  pluginDisableGuardError,
  pluginRemoveGuardError,
  dshKernelState,
  kernelNeedsAlign,
  kernelIsRunning,
  enqueueProfileAlign,
  alignHarnessAfterProfileChange,
  disablePlugins,
  enablePlugin,
  applyRendererConfigPatch,
  configureProfileOps,
};
