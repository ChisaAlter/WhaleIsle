'use strict';

// IPC contract registry (#436, P3-1).
//
// One authoritative row per (channel, direction): the channel name, its kind
// (`invoke` = renderer->main ipcMain.handle, `send` = renderer->main
// ipcMain.on/send/sendSync, `event` = main->renderer webContents.send push),
// the surfaces allowed to use it, and the argument validation. The main
// process mounts channels through src/main/ipc-register.js, which resolves
// kind/roles/validate from this table; modules only supply the handler and —
// for rows marked `authorize: 'channel-owned'` — a module-local ownership/
// frame authorize. Sandboxed preloads cannot require this file, so
// src/shared/ipc-contract.test.js cross-checks every literal channel used by
// each preload against the rows below.
//
// roles uses the IPC_ROLES surface names (boot/harness/launcher) for
// role-authorized rows and the preload surface name for window-owned rows
// (welcome, update-dialog, update-center, file-preview, pet, pet-live2d,
// platform, whalebridge).

const { IPC_ROLES } = require('../main/ipc-authorization');
const {
  noArgs,
  isPlainObject,
  requiredObject,
  optionalObject,
  requiredString,
  optionalString,
} = require('../main/ipc-register');

const SURFACES = Object.freeze({
  BOOT: IPC_ROLES.BOOT,
  HARNESS: IPC_ROLES.HARNESS,
  LAUNCHER: IPC_ROLES.LAUNCHER,
  PET: 'pet',
  PET_LIVE2D: 'pet-live2d',
  WELCOME: 'welcome',
  UPDATE_DIALOG: 'update-dialog',
  UPDATE_CENTER: 'update-center',
  FILE_PREVIEW: 'file-preview',
  PLATFORM: 'platform',
  WHALEBRIDGE: 'whalebridge',
  PREVIEW_GUEST: 'preview-guest',
  APPROVAL_POPUP: 'approval-popup',
});

const BOOT_ONLY = [SURFACES.BOOT];
const HARNESS_ONLY = [SURFACES.HARNESS];
const LAUNCHER_ONLY = [SURFACES.LAUNCHER];
const ALL_SURFACES = [SURFACES.BOOT, SURFACES.HARNESS, SURFACES.LAUNCHER];
const BOOT_HARNESS = [SURFACES.BOOT, SURFACES.HARNESS];
const HARNESS_LAUNCHER = [SURFACES.HARNESS, SURFACES.LAUNCHER];
const UPDATE_SURFACES = HARNESS_LAUNCHER;
const UPDATE_CENTER_ONLY = [SURFACES.UPDATE_CENTER];
const CENTER_CALLERS = [...HARNESS_LAUNCHER, SURFACES.UPDATE_CENTER];
const CENTER_BROADCAST = CENTER_CALLERS;
const THEME_SURFACES = [
  SURFACES.BOOT, SURFACES.HARNESS, SURFACES.LAUNCHER, SURFACES.PET,
  SURFACES.FILE_PREVIEW, SURFACES.UPDATE_DIALOG, SURFACES.UPDATE_CENTER,
  SURFACES.APPROVAL_POPUP,
];

/**
 * @typedef {Object} IpcContractRow
 * @property {string} channel
 * @property {'invoke' | 'send' | 'event'} kind
 * @property {string[]} roles
 * @property {string} [authorize]
 * @property {string} [transport]
 * @property {(args: unknown[], auth?: unknown) => unknown[]} [validate]
 * @property {boolean} [pending]
 */

const OWNED = 'channel-owned';

/** @type {(value: unknown) => string | undefined} */
const asString = (value) => (typeof value === 'string' ? value : undefined);
/** @type {(value: unknown) => Record<string, unknown> | undefined} */
const asObject = (value) => (isPlainObject(value) ? value : undefined);
/** @type {(args: unknown[]) => unknown[]} */
const stringArg = (args) => [asString(args[0])];
/** @type {(args: unknown[]) => unknown[]} */
const stringPair = (args) => [asString(args[0]), asString(args[1])];
/** @type {(args: unknown[]) => unknown[]} */
const stringTriple = (args) => [asString(args[0]), asString(args[1]), asString(args[2])];
/** @type {(args: unknown[]) => unknown[]} */
const objectArg = (args) => [asObject(args[0])];
/** @type {(args: unknown[]) => unknown[]} */
const stringObjectPair = (args) => [asString(args[0]), asObject(args[1])];
/** @type {(args: unknown[]) => unknown[]} */
const firstArg = (args) => [args[0]];
/** @type {(args: unknown[]) => unknown[]} */
const firstTwoArgs = (args) => [args[0], args[1]];
/** @type {(args: unknown[]) => unknown[]} */
const firstThreeArgs = (args) => [args[0], args[1], args[2]];
/** @type {(args: unknown[]) => unknown[]} */
const nameList = (args) => [Array.isArray(args[0]) ? args[0] : undefined];
/** @type {(args: unknown[]) => unknown[]} */
const stringOrObjectArg = (args) => [
  typeof args[0] === 'string' || isPlainObject(args[0]) ? args[0] : undefined,
];
/** @type {(args: unknown[], auth: unknown) => unknown[]} */
const authOnly = (_args, auth) => [auth];
// Channel-owned authorize results ride into the handler as the first argument.
/** @type {(tail: (args: unknown[]) => unknown[]) => (args: unknown[], auth: unknown) => unknown[]} */
const prependAuth = (tail) => (args, auth) => [auth, ...tail(args)];

/** @type {Readonly<IpcContractRow[]>} */
const IPC_CONTRACT = Object.freeze([
  // --- Shared chrome surface: window controls, theme, rendering profile ----
  { channel: 'shell:window', kind: 'send', roles: ALL_SURFACES, authorize: OWNED,
    validate: prependAuth(stringArg) },
  { channel: 'shell:window-state', kind: 'invoke', roles: ALL_SURFACES, authorize: OWNED,
    validate: authOnly },
  { channel: 'shell:window-state', kind: 'event',
    roles: [...ALL_SURFACES, SURFACES.UPDATE_CENTER] },
  { channel: 'shell:theme', kind: 'event', roles: THEME_SURFACES },
  { channel: 'shell:chrome-metrics', kind: 'send', roles: HARNESS_ONLY, authorize: OWNED,
    validate: prependAuth(objectArg) },
  { channel: 'shell:get-render-mode', kind: 'invoke', roles: ALL_SURFACES, validate: noArgs },
  { channel: 'shell:set-render-mode', kind: 'invoke', roles: HARNESS_ONLY,
    validate(args) {
      const [minimal] = args;
      if (typeof minimal !== 'boolean') {
        throw new TypeError('Rendering mode must be a boolean');
      }
      return [minimal];
    } },
  { channel: 'shell:claim-minimal-suggestion', kind: 'invoke', roles: HARNESS_ONLY, validate: noArgs },
  { channel: 'shell:render-mode', kind: 'event', roles: ALL_SURFACES },
  { channel: 'shell:render-resume', kind: 'event', roles: ALL_SURFACES },
  { channel: 'shell:native-theme', kind: 'send', roles: HARNESS_ONLY, authorize: OWNED,
    validate: prependAuth(firstArg) },
  { channel: 'shell:window-material', kind: 'send', roles: HARNESS_ONLY, authorize: OWNED,
    validate: prependAuth(stringArg) },

  // --- Boot page -----------------------------------------------------------
  { channel: 'shell:get-state', kind: 'invoke', roles: BOOT_ONLY, validate: noArgs },
  { channel: 'shell:restart', kind: 'invoke', roles: BOOT_ONLY, validate: noArgs },
  { channel: 'shell:cancel-restart', kind: 'invoke', roles: BOOT_ONLY, validate: noArgs },
  { channel: 'shell:save-boot-log', kind: 'invoke', roles: BOOT_ONLY, validate: noArgs },
  { channel: 'shell:state', kind: 'event', roles: BOOT_ONLY },
  { channel: 'shell:log', kind: 'event', roles: BOOT_ONLY },
  { channel: 'shell:plugin-boot', kind: 'event', roles: BOOT_ONLY },

  // --- Config / shared -----------------------------------------------------
  { channel: 'shell:get-config', kind: 'invoke', roles: ALL_SURFACES, validate: noArgs },
  { channel: 'shell:save-config', kind: 'invoke', roles: HARNESS_ONLY, validate: requiredObject },
  { channel: 'shell:open-external', kind: 'invoke', roles: HARNESS_ONLY, validate: requiredString },
  { channel: 'shell:open-launcher', kind: 'invoke', roles: BOOT_HARNESS, validate: noArgs },
  // The boot page never binds a retry entry — its restart rides
  // shell:restart — so only harness and launcher senders may call this.
  { channel: 'shell:retry-full-plugins', kind: 'invoke', roles: HARNESS_LAUNCHER, validate: noArgs },

  // --- Harness: OpenUI / workspace / misc ----------------------------------
  { channel: 'shell:openui-viewer', kind: 'invoke', roles: HARNESS_ONLY, validate: noArgs },
  { channel: 'shell:openui-api', kind: 'invoke', roles: HARNESS_ONLY, validate: requiredObject },
  { channel: 'shell:openui-bundle', kind: 'invoke', roles: HARNESS_ONLY, validate: requiredObject },
  { channel: 'shell:pick-workspace-directory', kind: 'invoke', roles: HARNESS_ONLY,
    validate: optionalObject },
  { channel: 'shell:open-settings', kind: 'invoke', roles: HARNESS_ONLY, validate: optionalString },
  { channel: 'shell:open-session', kind: 'event', roles: HARNESS_ONLY },
  { channel: 'shell:reload-page', kind: 'invoke', roles: HARNESS_ONLY, validate: noArgs },
  { channel: 'shell:live2d-pet-settings', kind: 'invoke', roles: HARNESS_ONLY, validate: objectArg },
  { channel: 'shell:open-dsh-home', kind: 'invoke', roles: HARNESS_ONLY, validate: noArgs },

  // --- Updates --------------------------------------------------------------
  { channel: 'shell:check-update', kind: 'invoke', roles: UPDATE_SURFACES, validate: noArgs },
  { channel: 'shell:install-update', kind: 'invoke', roles: UPDATE_SURFACES, validate: noArgs },
  { channel: 'shell:update-progress', kind: 'event', roles: UPDATE_SURFACES },
  { channel: 'shell:updates-status', kind: 'invoke', roles: HARNESS_ONLY, validate: noArgs },
  { channel: 'shell:updates-open', kind: 'invoke', roles: HARNESS_ONLY, validate: noArgs },
  { channel: 'shell:updates-changed', kind: 'event', roles: HARNESS_ONLY },

  // --- Update center (overlay window or shared surfaces) ---------------------
  { channel: 'shell:update-center-state', kind: 'invoke', roles: CENTER_CALLERS,
    authorize: OWNED, validate: noArgs },
  { channel: 'shell:update-center-command', kind: 'invoke', roles: CENTER_CALLERS,
    authorize: OWNED, validate: firstTwoArgs },
  { channel: 'shell:update-center-open', kind: 'invoke', roles: CENTER_CALLERS,
    authorize: OWNED, validate: authOnly },
  // Only the overlay's own window may close it; boot/harness/launcher
  // preloads bind no close entry.
  { channel: 'shell:update-center-close', kind: 'invoke', roles: UPDATE_CENTER_ONLY,
    authorize: OWNED, validate: noArgs },
  { channel: 'shell:update-center', kind: 'event', roles: CENTER_BROADCAST },

  // --- Launcher window -------------------------------------------------------
  { channel: 'shell:launcher-status', kind: 'invoke', roles: LAUNCHER_ONLY, validate: noArgs },
  { channel: 'shell:save-launcher-config', kind: 'invoke', roles: LAUNCHER_ONLY,
    validate: optionalObject },
  { channel: 'shell:scan-import', kind: 'invoke', roles: LAUNCHER_ONLY, validate: optionalObject },
  { channel: 'shell:pick-import-source', kind: 'invoke', roles: LAUNCHER_ONLY, validate: noArgs },
  { channel: 'shell:pick-skill-dir', kind: 'invoke', roles: LAUNCHER_ONLY, validate: noArgs },
  { channel: 'shell:run-import', kind: 'invoke', roles: LAUNCHER_ONLY, validate: optionalObject },
  { channel: 'shell:cancel-import', kind: 'invoke', roles: LAUNCHER_ONLY, validate: optionalObject },
  { channel: 'shell:import-progress', kind: 'event', roles: LAUNCHER_ONLY },
  { channel: 'shell:list-releases', kind: 'invoke', roles: LAUNCHER_ONLY, validate: noArgs },
  { channel: 'shell:install-release', kind: 'invoke', roles: LAUNCHER_ONLY, validate: requiredString },
  { channel: 'shell:uninstall-app', kind: 'invoke', roles: LAUNCHER_ONLY, validate: noArgs },
  { channel: 'shell:install-runtime', kind: 'invoke', roles: LAUNCHER_ONLY, validate: optionalObject },
  { channel: 'shell:cancel-runtime-install', kind: 'invoke', roles: LAUNCHER_ONLY, validate: noArgs },
  { channel: 'shell:stop-desktop', kind: 'invoke', roles: LAUNCHER_ONLY, validate: noArgs },
  { channel: 'shell:start-desktop', kind: 'invoke', roles: LAUNCHER_ONLY, validate: noArgs },
  { channel: 'shell:start-desktop-skipped', kind: 'invoke', roles: LAUNCHER_ONLY, validate: noArgs },
  { channel: 'shell:plugin-forensics', kind: 'invoke', roles: LAUNCHER_ONLY, validate: noArgs },
  { channel: 'shell:disable-plugins', kind: 'invoke', roles: LAUNCHER_ONLY, validate: nameList },
  { channel: 'shell:disable-suspects-and-start', kind: 'invoke', roles: LAUNCHER_ONLY,
    validate: nameList },
  { channel: 'shell:disable-plugin', kind: 'invoke', roles: LAUNCHER_ONLY, validate: requiredString },
  { channel: 'shell:enable-plugin', kind: 'invoke', roles: LAUNCHER_ONLY, validate: requiredString },
  { channel: 'shell:remove-plugin', kind: 'invoke', roles: LAUNCHER_ONLY, validate: requiredString },
  { channel: 'shell:install-delta', kind: 'invoke', roles: LAUNCHER_ONLY, validate: stringArg },
  { channel: 'shell:components-list', kind: 'invoke', roles: LAUNCHER_ONLY, validate: optionalObject },
  { channel: 'shell:components-install', kind: 'invoke', roles: LAUNCHER_ONLY,
    validate: stringOrObjectArg },
  { channel: 'shell:components-start', kind: 'invoke', roles: LAUNCHER_ONLY,
    validate: stringOrObjectArg },
  { channel: 'shell:components-stop', kind: 'invoke', roles: LAUNCHER_ONLY,
    validate: stringOrObjectArg },
  { channel: 'shell:components-update', kind: 'invoke', roles: LAUNCHER_ONLY,
    validate: stringOrObjectArg },
  { channel: 'shell:components-rollback', kind: 'invoke', roles: LAUNCHER_ONLY,
    validate: stringOrObjectArg },
  { channel: 'shell:components-uninstall', kind: 'invoke', roles: LAUNCHER_ONLY,
    validate: stringOrObjectArg },
  { channel: 'shell:components-uninstall-info', kind: 'invoke', roles: LAUNCHER_ONLY,
    validate: stringOrObjectArg },
  { channel: 'shell:components-open', kind: 'invoke', roles: LAUNCHER_ONLY,
    validate: stringOrObjectArg },
  { channel: 'shell:components-progress', kind: 'event', roles: LAUNCHER_ONLY },
  { channel: 'shell:app-confirm:response', kind: 'invoke', roles: LAUNCHER_ONLY,
    validate: objectArg },
  { channel: 'shell:app-confirm', kind: 'event', roles: LAUNCHER_ONLY },
  { channel: 'shell:show-tab', kind: 'event', roles: LAUNCHER_ONLY },
  { channel: 'shell:desktop-failed', kind: 'event', roles: LAUNCHER_ONLY },
  { channel: 'shell:desktop-ready', kind: 'event', roles: LAUNCHER_ONLY },
  { channel: 'shell:launcher-hint', kind: 'event', roles: LAUNCHER_ONLY },

  // --- Marketplace / plugins (harness) ----------------------------------------
  { channel: 'shell:list-marketplace', kind: 'invoke', roles: HARNESS_ONLY, validate: optionalObject },
  { channel: 'shell:refresh-marketplace', kind: 'invoke', roles: HARNESS_ONLY,
    validate: optionalObject },
  { channel: 'shell:list-wallpaper-catalog', kind: 'invoke', roles: HARNESS_ONLY,
    validate: optionalObject },
  { channel: 'shell:download-wallpaper', kind: 'invoke', roles: HARNESS_ONLY, validate: stringArg },
  { channel: 'shell:list-installed-plugins', kind: 'invoke', roles: HARNESS_ONLY, validate: noArgs },
  { channel: 'shell:marketplace-state', kind: 'invoke', roles: HARNESS_ONLY, validate: noArgs },
  { channel: 'shell:marketplace-details', kind: 'invoke', roles: HARNESS_ONLY,
    validate: stringObjectPair },
  { channel: 'shell:marketplace-favorite', kind: 'invoke', roles: HARNESS_ONLY,
    validate: /** @type {(args: unknown[]) => unknown[]} */ (args) => [asString(args[0]), args[1]] },
  { channel: 'shell:check-marketplace-updates', kind: 'invoke', roles: HARNESS_ONLY,
    validate: optionalObject },
  { channel: 'shell:install-plugin', kind: 'invoke', roles: HARNESS_ONLY,
    validate: /** @type {(args: unknown[]) => unknown[]} */ (args) => [
      typeof args[0] === 'string' || isPlainObject(args[0]) ? args[0] : undefined,
      asObject(args[1]),
    ] },
  { channel: 'shell:install-marketplace-plugin', kind: 'invoke', roles: HARNESS_ONLY,
    validate: stringObjectPair },
  { channel: 'shell:update-marketplace-plugin', kind: 'invoke', roles: HARNESS_ONLY,
    validate: stringObjectPair },
  { channel: 'shell:update-marketplace-plugins', kind: 'invoke', roles: HARNESS_ONLY,
    validate: nameList },
  { channel: 'shell:uninstall-plugin', kind: 'invoke', roles: HARNESS_ONLY, validate: stringArg },
  { channel: 'shell:open-marketplace', kind: 'invoke', roles: HARNESS_ONLY, validate: noArgs },
  { channel: 'shell:plugin-progress', kind: 'event', roles: UPDATE_SURFACES },

  // --- Git (harness) ------------------------------------------------------------
  { channel: 'shell:git-status', kind: 'invoke', roles: HARNESS_ONLY, validate: stringArg },
  { channel: 'shell:git-fetch-status', kind: 'invoke', roles: HARNESS_ONLY, validate: stringArg },
  { channel: 'shell:git-pull-request', kind: 'invoke', roles: HARNESS_ONLY, validate: stringArg },
  { channel: 'shell:git-init', kind: 'invoke', roles: HARNESS_ONLY, validate: stringArg },
  { channel: 'shell:git-diff', kind: 'invoke', roles: HARNESS_ONLY, validate: stringObjectPair },
  { channel: 'shell:git-check-large-files', kind: 'invoke', roles: HARNESS_ONLY, validate: stringArg },
  { channel: 'shell:git-commit', kind: 'invoke', roles: HARNESS_ONLY,
    validate: /** @type {(args: unknown[]) => unknown[]} */ (args) => [
      asString(args[0]),
      asString(args[1]),
      Array.isArray(args[2]) ? args[2] : undefined,
      args[3],
      asObject(args[4]),
    ] },
  { channel: 'shell:git-push', kind: 'invoke', roles: HARNESS_ONLY,
    validate: /** @type {(args: unknown[]) => unknown[]} */ (args) => [asString(args[0]), args[1]] },
  { channel: 'shell:git-pull', kind: 'invoke', roles: HARNESS_ONLY,
    validate: /** @type {(args: unknown[]) => unknown[]} */ (args) => [asString(args[0]), args[1]] },
  { channel: 'shell:git-create-change-request', kind: 'invoke', roles: HARNESS_ONLY,
    validate: /** @type {(args: unknown[]) => unknown[]} */ (args) => [asString(args[0]), asObject(args[1]), args[2]] },
  { channel: 'shell:git-publish', kind: 'invoke', roles: HARNESS_ONLY,
    validate: /** @type {(args: unknown[]) => unknown[]} */ (args) => [asString(args[0]), asObject(args[1]), args[2]] },
  { channel: 'shell:open-workspace-path', kind: 'invoke', roles: HARNESS_ONLY, validate: stringPair },
  { channel: 'shell:git-stage', kind: 'invoke', roles: HARNESS_ONLY, validate: stringPair },
  { channel: 'shell:git-unstage', kind: 'invoke', roles: HARNESS_ONLY, validate: stringPair },
  { channel: 'shell:git-discard', kind: 'invoke', roles: HARNESS_ONLY, validate: stringPair },
  { channel: 'shell:git-status-entries', kind: 'invoke', roles: HARNESS_ONLY, validate: stringArg },
  { channel: 'shell:git-branch-list', kind: 'invoke', roles: HARNESS_ONLY, validate: stringArg },
  { channel: 'shell:git-switch-branch', kind: 'invoke', roles: HARNESS_ONLY, validate: stringPair },
  { channel: 'shell:git-create-branch', kind: 'invoke', roles: HARNESS_ONLY, validate: stringPair },
  { channel: 'shell:git-progress', kind: 'event', roles: HARNESS_ONLY },
  { channel: 'shell:git-workspaces-changed', kind: 'event', roles: HARNESS_ONLY },

  // --- Workspace files / editors (harness) --------------------------------------
  { channel: 'shell:list-dir', kind: 'invoke', roles: HARNESS_ONLY, validate: stringPair },
  { channel: 'shell:read-file', kind: 'invoke', roles: HARNESS_ONLY, validate: stringPair },
  { channel: 'shell:read-file-media', kind: 'invoke', roles: HARNESS_ONLY, validate: stringPair },
  { channel: 'shell:write-file', kind: 'invoke', roles: HARNESS_ONLY, validate: stringTriple },
  { channel: 'shell:list-editors', kind: 'invoke', roles: HARNESS_ONLY, validate: noArgs },
  { channel: 'shell:open-in-editor', kind: 'invoke', roles: HARNESS_ONLY, validate: requiredObject },
  { channel: 'shell:show-item-in-folder', kind: 'invoke', roles: HARNESS_ONLY, validate: stringPair },
  { channel: 'shell:open-with-default', kind: 'invoke', roles: HARNESS_ONLY, validate: stringPair },

  // --- Remote access (harness) ----------------------------------------------------
  { channel: 'shell:get-remote', kind: 'invoke', roles: HARNESS_ONLY, validate: noArgs },
  { channel: 'shell:save-remote', kind: 'invoke', roles: HARNESS_ONLY, validate: objectArg },
  { channel: 'shell:rotate-remote-token', kind: 'invoke', roles: HARNESS_ONLY, validate: noArgs },
  { channel: 'shell:revoke-remote-pairing-link', kind: 'invoke', roles: HARNESS_ONLY,
    validate: noArgs },
  { channel: 'shell:unbind-remote-device', kind: 'invoke', roles: HARNESS_ONLY, validate: stringArg },
  { channel: 'shell:rename-remote-device', kind: 'invoke', roles: HARNESS_ONLY, validate: stringPair },

  // --- PTY (harness-owned per sender) ----------------------------------------------
  { channel: 'shell:pty-can-create', kind: 'invoke', roles: HARNESS_ONLY, authorize: OWNED,
    /** @param {unknown[]} args */
    validate(args) {
      const [cwd] = args;
      if (cwd !== undefined && typeof cwd !== 'string') {
        throw new TypeError('pty cwd must be a string');
      }
      return [cwd];
    } },
  { channel: 'shell:pty-create', kind: 'invoke', roles: HARNESS_ONLY, authorize: OWNED,
    validate: prependAuth(objectArg) },
  { channel: 'shell:pty-write', kind: 'invoke', roles: HARNESS_ONLY, authorize: OWNED,
    validate: prependAuth((args) => [asString(args[0]), args[1]]) },
  { channel: 'shell:pty-ack', kind: 'invoke', roles: HARNESS_ONLY, authorize: OWNED,
    validate: prependAuth((args) => [asString(args[0]), args[1]]) },
  { channel: 'shell:pty-resize', kind: 'invoke', roles: HARNESS_ONLY, authorize: OWNED,
    validate: prependAuth((args) => [asString(args[0]), args[1], args[2]]) },
  { channel: 'shell:pty-kill', kind: 'invoke', roles: HARNESS_ONLY, authorize: OWNED,
    validate: prependAuth(stringArg) },
  { channel: 'shell:pty-data', kind: 'event', roles: HARNESS_ONLY },
  { channel: 'shell:pty-exit', kind: 'event', roles: HARNESS_ONLY },

  // --- Guest preview (harness-owned per sender) --------------------------------------
  { channel: 'shell:preview-open', kind: 'invoke', roles: HARNESS_ONLY, authorize: OWNED,
    validate: prependAuth(objectArg) },
  { channel: 'shell:preview-navigate', kind: 'invoke', roles: HARNESS_ONLY, authorize: OWNED,
    validate: stringPair },
  { channel: 'shell:preview-back', kind: 'invoke', roles: HARNESS_ONLY, authorize: OWNED,
    validate: stringArg },
  { channel: 'shell:preview-forward', kind: 'invoke', roles: HARNESS_ONLY, authorize: OWNED,
    validate: stringArg },
  { channel: 'shell:preview-reload', kind: 'invoke', roles: HARNESS_ONLY, authorize: OWNED,
    validate: stringArg },
  { channel: 'shell:preview-hard-reload', kind: 'invoke', roles: HARNESS_ONLY, authorize: OWNED,
    validate: stringArg },
  { channel: 'shell:preview-stop', kind: 'invoke', roles: HARNESS_ONLY, authorize: OWNED,
    validate: stringArg },
  { channel: 'shell:preview-zoom-in', kind: 'invoke', roles: HARNESS_ONLY, authorize: OWNED,
    validate: stringArg },
  { channel: 'shell:preview-zoom-out', kind: 'invoke', roles: HARNESS_ONLY, authorize: OWNED,
    validate: stringArg },
  { channel: 'shell:preview-zoom-reset', kind: 'invoke', roles: HARNESS_ONLY, authorize: OWNED,
    validate: stringArg },
  { channel: 'shell:preview-color-scheme', kind: 'invoke', roles: HARNESS_ONLY, authorize: OWNED,
    validate: /** @type {(args: unknown[]) => unknown[]} */ (args) => [asString(args[0]), args[1]] },
  { channel: 'shell:preview-clear-cookies', kind: 'invoke', roles: HARNESS_ONLY, authorize: OWNED,
    validate: noArgs },
  { channel: 'shell:preview-clear-cache', kind: 'invoke', roles: HARNESS_ONLY, authorize: OWNED,
    validate: noArgs },
  { channel: 'shell:preview-capture-screenshot', kind: 'invoke', roles: HARNESS_ONLY,
    authorize: OWNED, validate: stringArg },
  { channel: 'shell:preview-pick-element', kind: 'invoke', roles: HARNESS_ONLY, authorize: OWNED,
    validate: stringArg },
  { channel: 'shell:preview-cancel-pick', kind: 'invoke', roles: HARNESS_ONLY, authorize: OWNED,
    validate: stringArg },
  { channel: 'shell:preview-annotation-theme', kind: 'invoke', roles: HARNESS_ONLY,
    authorize: OWNED, validate: /** @type {(args: unknown[]) => unknown[]} */ (args) => [asString(args[0]), args[1]] },
  { channel: 'shell:preview-open-pip', kind: 'invoke', roles: HARNESS_ONLY, authorize: OWNED,
    validate: prependAuth(stringArg) },
  { channel: 'shell:preview-close-pip', kind: 'invoke', roles: HARNESS_ONLY, authorize: OWNED,
    validate: noArgs },
  { channel: 'shell:preview-start-recording', kind: 'invoke', roles: HARNESS_ONLY,
    authorize: OWNED, validate: stringArg },
  { channel: 'shell:preview-stop-recording', kind: 'invoke', roles: HARNESS_ONLY,
    authorize: OWNED, validate: stringArg },
  { channel: 'shell:preview-save-recording', kind: 'invoke', roles: HARNESS_ONLY,
    authorize: OWNED, validate: /** @type {(args: unknown[]) => unknown[]} */ (args) => [asString(args[0]), args[1]] },
  { channel: 'shell:preview-reveal-artifact', kind: 'invoke', roles: HARNESS_ONLY,
    authorize: OWNED, validate: stringArg },
  { channel: 'shell:preview-copy-artifact', kind: 'invoke', roles: HARNESS_ONLY,
    authorize: OWNED, validate: stringArg },
  { channel: 'shell:preview-state', kind: 'invoke', roles: HARNESS_ONLY, authorize: OWNED,
    validate: stringArg },
  { channel: 'shell:preview-devtools', kind: 'invoke', roles: HARNESS_ONLY, authorize: OWNED,
    validate: stringArg },
  { channel: 'shell:preview-discover', kind: 'invoke', roles: HARNESS_ONLY, authorize: OWNED,
    validate: noArgs },
  { channel: 'shell:preview-resize', kind: 'invoke', roles: HARNESS_ONLY, authorize: OWNED,
    validate: stringObjectPair },
  { channel: 'shell:preview-hide', kind: 'invoke', roles: HARNESS_ONLY, authorize: OWNED,
    validate: stringArg },
  { channel: 'shell:preview-show', kind: 'invoke', roles: HARNESS_ONLY, authorize: OWNED,
    validate: stringObjectPair },
  { channel: 'shell:preview-close', kind: 'invoke', roles: HARNESS_ONLY, authorize: OWNED,
    validate: stringArg },
  { channel: 'shell:preview-workspace-file', kind: 'invoke', roles: HARNESS_ONLY,
    authorize: OWNED, validate: prependAuth(objectArg) },
  { channel: 'shell:preview-open-file-window', kind: 'invoke', roles: HARNESS_ONLY,
    authorize: OWNED, validate: prependAuth(objectArg) },
  { channel: 'shell:preview-state-change', kind: 'event', roles: HARNESS_ONLY },
  { channel: 'shell:preview-recording-frame', kind: 'event', roles: HARNESS_ONLY },
  { channel: 'shell:open-preview-url', kind: 'event', roles: HARNESS_ONLY },

  // --- Keyboard shortcuts (harness-owned per sender) ----------------------------------
  { channel: 'shell:shortcuts-get', kind: 'invoke', roles: HARNESS_ONLY, authorize: OWNED,
    validate: /** @type {(args: unknown[]) => unknown[]} */ (args) => [args[0], typeof args[1] === 'string' ? args[1] : null] },
  { channel: 'shell:shortcuts-edit', kind: 'invoke', roles: HARNESS_ONLY, authorize: OWNED,
    validate: firstTwoArgs },
  { channel: 'shell:shortcuts-recording', kind: 'invoke', roles: HARNESS_ONLY, authorize: OWNED,
    validate: prependAuth(firstArg) },
  { channel: 'shell:shortcuts-close-window', kind: 'invoke', roles: HARNESS_ONLY,
    authorize: OWNED, validate: firstArg },
  { channel: 'shell:shortcuts-input', kind: 'event', roles: HARNESS_ONLY },
  { channel: 'shell:shortcuts-changed', kind: 'event', roles: HARNESS_ONLY },

  // --- Browser guest windows (harness-owned per sender) -------------------------------
  { channel: 'shell:browser-acquire', kind: 'invoke', roles: HARNESS_ONLY, authorize: OWNED,
    validate: prependAuth(firstArg) },
  { channel: 'shell:browser-release', kind: 'invoke', roles: HARNESS_ONLY, authorize: OWNED,
    validate: prependAuth(firstArg) },
  { channel: 'shell:browser-open-requested', kind: 'event', roles: HARNESS_ONLY },

  // --- Embedded platform doc (own contents.ipc surface + harness callers) --------------
  // `dsh-platform:bootstrap` rides ipcRenderer.sendSync, which hits ipcMain.on;
  // ownership is re-checked inside platformView.bootstrap itself.
  { channel: 'dsh-platform:bootstrap', kind: 'send', roles: [SURFACES.PLATFORM],
    authorize: OWNED, validate: noArgs },
  { channel: 'dsh-platform:open', kind: 'invoke', roles: HARNESS_ONLY, authorize: OWNED,
    validate: prependAuth(firstTwoArgs) },
  { channel: 'dsh-platform:bounds', kind: 'invoke', roles: HARNESS_ONLY, authorize: OWNED,
    validate: firstArg },
  { channel: 'dsh-platform:close', kind: 'invoke', roles: HARNESS_ONLY, authorize: OWNED,
    validate: noArgs },
  { channel: 'dsh-platform:locale-changed', kind: 'event', roles: [SURFACES.PLATFORM] },

  // --- File preview window ------------------------------------------------------------
  { channel: 'shell:file-preview-state', kind: 'invoke', roles: [SURFACES.FILE_PREVIEW],
    authorize: OWNED, validate: noArgs },

  // --- Welcome window ------------------------------------------------------------------
  // `dsh-welcome:locale` rides ipcRenderer.sendSync, which hits ipcMain.on;
  // the sandboxed preload pulls its window-owned copy table at bootstrap.
  { channel: 'dsh-welcome:locale', kind: 'send', roles: [SURFACES.WELCOME],
    authorize: OWNED, validate: noArgs },
  { channel: 'dsh-welcome:take-notice', kind: 'invoke', roles: [SURFACES.WELCOME],
    authorize: OWNED, validate: noArgs },
  { channel: 'dsh-welcome:save-api-key', kind: 'invoke', roles: [SURFACES.WELCOME],
    authorize: OWNED, validate: stringArg },
  { channel: 'dsh-welcome:skip', kind: 'invoke', roles: [SURFACES.WELCOME],
    authorize: OWNED, validate: noArgs },
  { channel: 'dsh-welcome:start', kind: 'invoke', roles: [SURFACES.WELCOME],
    authorize: OWNED, validate: noArgs },
  { channel: 'dsh-welcome:cancel', kind: 'invoke', roles: [SURFACES.WELCOME],
    authorize: OWNED, validate: stringArg },
  { channel: 'dsh-welcome:copy-link', kind: 'invoke', roles: [SURFACES.WELCOME],
    authorize: OWNED, validate: stringArg },
  { channel: 'dsh-welcome:state', kind: 'event', roles: [SURFACES.WELCOME] },

  // --- Update dialog (confirmation window) ----------------------------------------------
  { channel: 'dsh-update-dialog:status', kind: 'invoke', roles: [SURFACES.UPDATE_DIALOG],
    authorize: OWNED, validate: noArgs },
  { channel: 'dsh-update-dialog:respond', kind: 'invoke', roles: [SURFACES.UPDATE_DIALOG],
    authorize: OWNED, validate: firstThreeArgs },
  { channel: 'dsh-update-dialog:changed', kind: 'event', roles: [SURFACES.UPDATE_DIALOG] },

  // --- Desktop pet (classic) -------------------------------------------------------------
  { channel: 'shell:pet-state', kind: 'invoke', roles: [SURFACES.PET], authorize: OWNED,
    validate: noArgs },
  { channel: 'shell:pet-drag-commit', kind: 'invoke', roles: [SURFACES.PET], authorize: OWNED,
    validate: firstArg },
  { channel: 'shell:pet-menu', kind: 'invoke', roles: [SURFACES.PET], authorize: OWNED,
    validate: noArgs },
  { channel: 'shell:pet-state', kind: 'event', roles: [SURFACES.PET] },

  // --- Live2D pet overlay -------------------------------------------------------------------
  { channel: 'shell:live2d-interactive', kind: 'invoke', roles: [SURFACES.PET_LIVE2D],
    authorize: OWNED, validate: objectArg },
  { channel: 'shell:live2d-care', kind: 'invoke', roles: [SURFACES.PET_LIVE2D],
    authorize: OWNED, validate: objectArg },
  { channel: 'shell:live2d-drag-start', kind: 'invoke', roles: [SURFACES.PET_LIVE2D],
    authorize: OWNED, validate: noArgs },
  { channel: 'shell:live2d-drag-move', kind: 'invoke', roles: [SURFACES.PET_LIVE2D],
    authorize: OWNED, validate: objectArg },
  { channel: 'shell:live2d-drag-commit', kind: 'invoke', roles: [SURFACES.PET_LIVE2D],
    authorize: OWNED, validate: objectArg },
  { channel: 'shell:live2d-relocate', kind: 'invoke', roles: [SURFACES.PET_LIVE2D],
    authorize: OWNED, validate: noArgs },
  { channel: 'shell:live2d-hide', kind: 'invoke', roles: [SURFACES.PET_LIVE2D],
    authorize: OWNED, validate: noArgs },
  { channel: 'shell:live2d-growth', kind: 'invoke', roles: [SURFACES.PET_LIVE2D],
    authorize: OWNED, validate: noArgs },
  { channel: 'shell:live2d-feed', kind: 'invoke', roles: [SURFACES.PET_LIVE2D],
    authorize: OWNED, validate: objectArg },
  { channel: 'shell:live2d-settings-get', kind: 'invoke', roles: [SURFACES.PET_LIVE2D],
    authorize: OWNED, validate: noArgs },
  { channel: 'shell:live2d-roam', kind: 'invoke', roles: [SURFACES.PET_LIVE2D],
    authorize: OWNED, validate: objectArg },
  { channel: 'shell:live2d-file-eat', kind: 'invoke', roles: [SURFACES.PET_LIVE2D],
    authorize: OWNED, validate: objectArg },
  { channel: 'shell:live2d-open-settings', kind: 'invoke', roles: [SURFACES.PET_LIVE2D],
    authorize: OWNED, validate: noArgs },
  { channel: 'shell:live2d-chat', kind: 'invoke', roles: [SURFACES.PET_LIVE2D],
    authorize: OWNED, validate: objectArg },
  { channel: 'shell:live2d-chat-state', kind: 'invoke', roles: [SURFACES.PET_LIVE2D],
    authorize: OWNED, validate: objectArg },
  { channel: 'shell:live2d-chat-select-model', kind: 'invoke', roles: [SURFACES.PET_LIVE2D],
    authorize: OWNED, validate: objectArg },
  { channel: 'shell:live2d-open-whale', kind: 'invoke', roles: [SURFACES.PET_LIVE2D],
    authorize: OWNED, validate: noArgs },
  { channel: 'shell:live2d-chat-focus', kind: 'invoke', roles: [SURFACES.PET_LIVE2D],
    authorize: OWNED, validate: objectArg },
  { channel: 'shell:live2d-look', kind: 'invoke', roles: [SURFACES.PET_LIVE2D],
    authorize: OWNED, validate: noArgs },
  { channel: 'shell:live2d-move', kind: 'event', roles: [SURFACES.PET_LIVE2D] },
  { channel: 'shell:live2d-layout', kind: 'event', roles: [SURFACES.PET_LIVE2D] },
  { channel: 'shell:live2d-cursor', kind: 'event', roles: [SURFACES.PET_LIVE2D] },
  { channel: 'shell:live2d-growth', kind: 'event', roles: [SURFACES.PET_LIVE2D] },
  { channel: 'shell:live2d-settings', kind: 'event', roles: [SURFACES.PET_LIVE2D] },
  { channel: 'shell:live2d-dsh', kind: 'event', roles: [SURFACES.PET_LIVE2D] },
  // Preload already exposes these; the main-side tailer/respond handler lands in a
  // follow-up, so they are declared but `pending` (not yet registered).
  { channel: 'shell:live2d-respond', kind: 'invoke', roles: [SURFACES.PET_LIVE2D],
    authorize: OWNED, validate: objectArg, pending: true },
  { channel: 'shell:live2d-alert', kind: 'event', roles: [SURFACES.PET_LIVE2D], pending: true },

  // --- Preview guest protocol (webview contents.ipc / webContents transport) -----------------
  // Main pushes pick/annotation/PiP frames into the preview guest contents;
  // the guest reports the picked element back over its own contents.ipc —
  // neither rides ipcMain nor a shell preload.
  { channel: 'dshd-preview-start-pick', kind: 'event', roles: [SURFACES.PREVIEW_GUEST] },
  { channel: 'dshd-preview-cancel-pick', kind: 'event', roles: [SURFACES.PREVIEW_GUEST] },
  { channel: 'dshd-preview-annotation-captured', kind: 'event', roles: [SURFACES.PREVIEW_GUEST] },
  { channel: 'dshd-preview-annotation-theme', kind: 'event', roles: [SURFACES.PREVIEW_GUEST] },
  { channel: 'dshd-preview-pip-frame', kind: 'event', roles: [SURFACES.PREVIEW_GUEST] },
  { channel: 'dshd-preview-element-picked', kind: 'send', roles: [SURFACES.PREVIEW_GUEST],
    transport: 'webContents' },

  // --- WhaleBridge windows (own contents.ipc transport, not registerIpc) ---------------------
  { channel: 'whalebridge:window', kind: 'send', roles: [SURFACES.WHALEBRIDGE],
    transport: 'webContents' },
  { channel: 'whalebridge:window-state', kind: 'invoke', roles: [SURFACES.WHALEBRIDGE],
    transport: 'webContents' },
  { channel: 'whalebridge:window-state', kind: 'event', roles: [SURFACES.WHALEBRIDGE] },

  // --- Minimized approval popup window ------------------------------------------------------
  { channel: 'shell:approval-popup-state', kind: 'invoke', roles: [SURFACES.APPROVAL_POPUP],
    authorize: OWNED, validate: noArgs },
  { channel: 'shell:approval-popup-decide', kind: 'invoke', roles: [SURFACES.APPROVAL_POPUP],
    authorize: OWNED, validate: requiredObject },
  { channel: 'shell:approval-popup-select', kind: 'send', roles: [SURFACES.APPROVAL_POPUP],
    authorize: OWNED, validate: requiredObject },
  { channel: 'shell:approval-popup-open-session', kind: 'invoke', roles: [SURFACES.APPROVAL_POPUP],
    authorize: OWNED, validate: requiredObject },
  { channel: 'shell:approval-popup-dismiss', kind: 'send', roles: [SURFACES.APPROVAL_POPUP],
    authorize: OWNED, validate: noArgs },
  { channel: 'shell:approval-popup-changed', kind: 'event', roles: [SURFACES.APPROVAL_POPUP] },
]);

module.exports = {
  IPC_CONTRACT,
  IPC_SURFACES: SURFACES,
};
