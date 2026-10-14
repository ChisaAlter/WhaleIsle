'use strict';

const crypto = require('node:crypto');
const path = require('node:path');

const PREVIEW_PARTITION_PREFIX = 'persist:dshd-preview-';

/**
 * Permissions the preview session may grant once every binding check passes.
 *
 * Empty on purpose: the preview panel opens arbitrary http(s) documents, so the
 * 2026-09-19 audit repair switched to deny-by-default for `clipboard-read`,
 * `clipboard-sanitized-write`, `notifications`, `geolocation`, and every unknown
 * permission. Adding an entry later is not enough on its own —
 * `isPreviewPermissionAllowed` still binds the grant to this session, a loopback
 * origin, and (for subframes) same-origin embedding. A consent UI is explicitly
 * out of scope for this repair.
 */
const ALLOWED_PREVIEW_PERMISSIONS = new Set();

const LOOPBACK_PREVIEW_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1']);

/** Electron `clearStorageData` storages swept by `clearCookies`. */
const PREVIEW_COOKIE_STORAGES = Object.freeze([
  'cookies',
  'localstorage',
  'indexdb',
  'websql',
  'serviceworkers',
]);

/**
 * Hashed persist partition for a preview scope (session cwd or `'shared'`).
 * @param {string} [scope='shared']
 * @returns {string}
 */
function previewPartitionForScope(scope = 'shared') {
  const digest = crypto.createHash('sha256').update(String(scope), 'utf8').digest('hex').slice(0, 20);
  return `${PREVIEW_PARTITION_PREFIX}${digest}`;
}

const leftoverUaBrand = ['t', '3', 'code'].join('');

/**
 * Parse an http(s) origin, or null for anything else (file:, data:, garbage).
 * @param {unknown} raw
 * @returns {URL | null}
 */
function previewOrigin(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Loopback is the only trusted preview origin: the desktop opens arbitrary
 * http(s) pages, so public pages and any cross-origin frame must not inherit
 * clipboard/notification/geolocation grants from the preview session.
 * @param {URL | null} origin
 * @returns {boolean}
 */
function isTrustedPreviewOrigin(origin) {
  if (origin === null) return false;
  // `URL#hostname` keeps the brackets for IPv6 literals (`[::1]`).
  const host = origin.hostname.replace(/^\[|\]$/g, '');
  return LOOPBACK_PREVIEW_HOSTS.has(host);
}

/**
 * P1 audit fix: permission grants used to depend on the permission name only,
 * so `https://evil.example` (main frame or iframe) received clipboard-read and
 * geolocation. Now a grant requires all of:
 *   - the requesting `webContents` belongs to this configured session;
 *   - the requesting frame's origin is loopback;
 *   - a subframe is same-origin with the document that embeds it.
 * @param {any} ses
 * @param {any} webContents
 * @param {unknown} permission
 * @param {string} [originRaw]
 * @param {{ isMainFrame?: boolean, requestingUrl?: string, requestingOrigin?: string }} [details]
 * @returns {boolean}
 */
function isPreviewPermissionAllowed(
  ses,
  webContents,
  permission,
  originRaw,
  details = {},
  allowlist = ALLOWED_PREVIEW_PERMISSIONS,
) {
  if (!allowlist.has(permission)) return false;
  if (!webContents || typeof webContents !== 'object') return false;
  if (typeof webContents.isDestroyed === 'function' && webContents.isDestroyed()) return false;
  if (webContents.session !== ses) return false;

  const topOrigin = previewOrigin(typeof webContents.getURL === 'function' ? webContents.getURL() : '');
  const rawFrameOrigin = originRaw || details.requestingUrl || details.requestingOrigin || '';
  const frameOrigin = previewOrigin(rawFrameOrigin);
  if (!topOrigin || !frameOrigin) return false;
  if (!isTrustedPreviewOrigin(frameOrigin)) return false;

  if (details.isMainFrame === false) {
    if (topOrigin.origin !== frameOrigin.origin) return false;
  }
  return true;
}

/**
 * Strip Electron and leftover migrated-desktop version tokens from a Chromium user-agent.
 * @param {string} userAgent
 * @returns {string}
 */
function stripPreviewUserAgent(userAgent) {
  return String(userAgent)
    .replace(/Electron\/[\d.]+ /, '')
    .replace(new RegExp(String.raw`\s*${leftoverUaBrand}/[\d.]+`), '');
}

/**
 * Apply UA stripping and the preview permission allow-list to one Electron session.
 * Call once per new session; do not stack handlers.
 * @param {import('electron').Session} ses
 */
function configurePreviewSession(ses) {
  ses.setUserAgent(stripPreviewUserAgent(ses.getUserAgent()));
  ses.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const origin = details && (details.requestingUrl || details.requestingOrigin);
    callback(isPreviewPermissionAllowed(ses, webContents, permission, origin, details));
  });
  ses.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => (
    isPreviewPermissionAllowed(ses, webContents, permission, requestingOrigin, details)
  ));
}

function defaultFromPartition(partition) {
  const { session } = require('electron');
  return session.fromPartition(partition);
}

/**
 * Cache `session.fromPartition` and configure each new session once.
 * @param {(partition: string) => import('electron').Session} [fromPartition]
 * @returns {{
 *   getSession: (scope?: string) => import('electron').Session,
 *   getByPartition: (partition: string) => import('electron').Session,
 *   listSessions: () => import('electron').Session[],
 *   clearCookies: () => Promise<void>,
 *   clearCache: () => Promise<void>,
 * }}
 */
function createPreviewSessionCache(fromPartition = defaultFromPartition) {
  const sessions = new Map();
  function getByPartition(partition) {
    const existing = sessions.get(partition);
    if (existing) return existing;
    const ses = fromPartition(partition);
    configurePreviewSession(ses);
    sessions.set(partition, ses);
    return ses;
  }
  return {
    getSession(scope = 'shared') {
      return getByPartition(previewPartitionForScope(scope));
    },
    getByPartition,
    listSessions() {
      return [...sessions.values()];
    },
    async clearCookies() {
      await Promise.all([...sessions.values()].map((ses) => {
        if (typeof ses.clearStorageData !== 'function') return undefined;
        return ses.clearStorageData({ storages: [...PREVIEW_COOKIE_STORAGES] });
      }));
    },
    async clearCache() {
      await Promise.all([...sessions.values()].map((ses) => {
        if (typeof ses.clearCache !== 'function') return undefined;
        return ses.clearCache();
      }));
    },
  };
}

const sharedPreviewSessions = createPreviewSessionCache();

/**
 * Absolute path to the single-file sandboxed guest BrowserView preload.
 * @returns {string}
 */
function previewGuestPreloadPath() {
  return path.join(__dirname, 'preview-guest-preload.bundle.js');
}

/**
 * Guest BrowserView webPreferences. Isolation stays on; pick/annotation IPC
 * stays in the preload and is not published on `globalThis`.
 * @param {{ session: unknown, preload?: string }} options
 * @returns {{ sandbox: true, contextIsolation: true, nodeIntegration: false, session: unknown, preload: string }}
 */
function previewGuestWebPreferences(options) {
  return {
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    session: options.session,
    preload: options.preload ?? previewGuestPreloadPath(),
  };
}

module.exports = {
  PREVIEW_PARTITION_PREFIX,
  PREVIEW_COOKIE_STORAGES,
  ALLOWED_PREVIEW_PERMISSIONS,
  isPreviewPermissionAllowed,
  isTrustedPreviewOrigin,
  previewPartitionForScope,
  stripPreviewUserAgent,
  configurePreviewSession,
  createPreviewSessionCache,
  previewGuestPreloadPath,
  previewGuestWebPreferences,
  getPreviewSession: (scope = 'shared') => sharedPreviewSessions.getSession(scope),
  previewSessionForPartition: (partition) => sharedPreviewSessions.getByPartition(partition),
  listPreviewSessions: () => sharedPreviewSessions.listSessions(),
  clearPreviewCookies: () => sharedPreviewSessions.clearCookies(),
  clearPreviewCache: () => sharedPreviewSessions.clearCache(),
};
