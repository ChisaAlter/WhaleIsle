const fs = require('fs');
const path = require('path');
const { isDeepStrictEqual } = require('node:util');
const { app, safeStorage } = require('electron');
const { projectRoot } = require('./paths');
const { DEFAULT_CLOSE_TO_TRAY } = require('./close-behavior');
const { normalizeRelayHostToken } = require('../shared/relay-auth');
const { normalizeRelayOrigin } = require('../shared/lan');
const { normalizeRemotePatch } = require('./remote-patch');
const { normalizeGrowthState } = require('./pet-growth');
const { normalizeStats } = require('./pet-stats');
const petSettings = require('./pet-settings');
const { PRODUCT_NAME, LEGACY_PRODUCT_NAME } = require('../shared/product-identity');

const REMOTE_FEATURE_ENABLED = true;

const DEFAULTS = {
  workspace: '',
  host: '127.0.0.1',
  port: 3080,
  apiKey: '',
  baseUrl: '',
  dshBin: '',
  nodeBin: '',
  closeToTray: DEFAULT_CLOSE_TO_TRAY,
  openAtLogin: false,
  openDevTools: false,
  theme: 'deepseek',
  locale: 'zh',
  githubToken: '',
  remoteEnabled: false,
  remotePort: 6767,
  remoteToken: '',
  remoteMode: 'relay',
  remoteBindAddress: '127.0.0.1',
  remoteLanTls: false,
  remoteRelayUrl: '',
  remoteRelayEndpoint: '',
  remoteRelayUseTls: false,
  remoteAppBaseUrl: '',
  remoteRelayToken: '',
  harnessAutoRestart: true,
  harnessRestartMaxAttempts: 3,
  harnessRestartBaseDelayMs: 1000,
  pluginRecovery: {
    skipUserPlugins: false,
    reason: '',
    at: '',
    appVersion: '',
  },
  quitAfterStart: true,
  autoStartDesktop: true,
  askOnUpdate: true,
  // Download route for the managed DSHD runtime ('' = user has not picked yet;
  // enum mirrors src/launcher/release-source.js ROUTES keys).
  downloadRoute: '',
  disabledPlugins: [],
  dshbotEnabled: false,
  // Built-in assistant is available on first launch; persisted opt-outs win.
  whaleAssistantEnabled: true,
  // Remote workspaces (SSH) — on by default; toggling restarts Harness so
  // the dsh-remote overlay composes or drops on the next start. Distinct
  // from `remoteEnabled`, which gates the phone/LAN remote pairing daemon.
  remoteWorkspaceEnabled: true,
  pet: {
    enabled: true,
    xRatio: 0.82,
    yRatio: 0.72,
    petId: '',
  },
  live2dPet: {
    enabled: false,
    x: null,
    y: null,
    growth: { points: 0, tokensFed: 0, tokensSeen: 0 },
    stats: { satiety: 70, mood: 70, affection: 0, lastTick: 0, care: {} },
    settings: petSettings.defaultSettings(),
    dsh: petSettings.defaultDshState(),
    fileEaten: { total: 0, history: [] },
    assistantSessionId: '',
  },
};

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function clampRatio(value, fallback) {
  const ratio = Number(value);
  return Number.isFinite(ratio) ? Math.min(1, Math.max(0, ratio)) : fallback;
}

function normalizePetState(value) {
  const source = isPlainObject(value) ? value : {};
  return {
    enabled: source.enabled !== false,
    xRatio: clampRatio(source.xRatio, DEFAULTS.pet.xRatio),
    yRatio: clampRatio(source.yRatio, DEFAULTS.pet.yRatio),
    petId: typeof source.petId === 'string' ? source.petId : '',
  };
}

function normalizePetStateInConfig(config) {
  return {
    ...config,
    pet: normalizePetState(config?.pet),
  };
}

function normalizeLive2dPetState(value) {
  const source = isPlainObject(value) ? value : {};
  return {
    enabled: source.enabled === true,
    x: Number.isFinite(source.x) ? Math.round(source.x) : null,
    y: Number.isFinite(source.y) ? Math.round(source.y) : null,
    growth: normalizeGrowthState(source.growth),
    stats: normalizeStats(source.stats),
    settings: petSettings.normalizeSettings(source.settings),
    dsh: petSettings.normalizeDshState(source.dsh),
    fileEaten: petSettings.normalizeFileEaten(source.fileEaten),
    assistantSessionId: typeof source.assistantSessionId === 'string'
      ? source.assistantSessionId : '',
  };
}

function normalizeLive2dPetStateInConfig(config) {
  return {
    ...config,
    live2dPet: normalizeLive2dPetState(config?.live2dPet),
  };
}

function normalizeRendererConfigPatch(patch) {
  if (!isPlainObject(patch)) {
    throw new TypeError('Config patch must be an object');
  }
  const next = {};
  for (const [key, value] of Object.entries(patch)) {
    if (['closeToTray', 'openAtLogin', 'openDevTools', 'harnessAutoRestart', 'autoStartDesktop', 'dshbotEnabled', 'whaleAssistantEnabled', 'remoteWorkspaceEnabled'].includes(key)) {
      if (typeof value !== 'boolean') {
        throw new TypeError(`${key} must be a boolean`);
      }
      next[key] = value;
      continue;
    }
    if (key === 'harnessRestartMaxAttempts') {
      if (!Number.isInteger(value) || value < 1 || value > 10) {
        throw new TypeError(`${key} must be an integer from 1 to 10`);
      }
      next[key] = value;
      continue;
    }
    if (key === 'harnessRestartBaseDelayMs') {
      if (!Number.isInteger(value) || value < 500 || value > 30_000) {
        throw new TypeError(`${key} must be an integer from 500 to 30000`);
      }
      next[key] = value;
      continue;
    }
    if (key === 'locale') {
      if (value !== 'zh' && value !== 'en') {
        throw new TypeError('locale must be zh or en');
      }
      next.locale = value;
      continue;
    }
    if (key === 'theme') {
      if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value)) {
        throw new TypeError('theme must be a valid theme id');
      }
      next.theme = value;
      continue;
    }
    if (key === 'githubToken') {
      if (typeof value !== 'string' || value.length > 512 || /[\r\n\0]/.test(value)) {
        throw new TypeError('githubToken must be a valid string');
      }
      next.githubToken = value.trim();
      continue;
    }
    throw new Error(`Config field is not renderer-writable: ${key}`);
  }
  return next;
}

/**
 * Bind addresses the remote gateway may listen on: loopback default (127.0.0.1),
 * the all-interfaces wildcard (0.0.0.0 when explicitly set), or one dotted-quad
 * IPv4. Anything else falls back to the default so a corrupt config can never
 * widen or break the listener.
 */
function normalizeRemoteBindAddress(value) {
  const raw = String(value || '').trim();
  if (raw === '0.0.0.0') {
    return raw;
  }
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(raw)) {
    return DEFAULTS.remoteBindAddress;
  }
  const octets = raw.split('.').map((part) => Number(part));
  return octets.every((part) => part >= 0 && part <= 255) ? raw : DEFAULTS.remoteBindAddress;
}

function normalizeRemoteConfig(config) {
  const next = { ...config };
  next.remoteEnabled = REMOTE_FEATURE_ENABLED && next.remoteEnabled === true;
  // ChisaCode Away uses host:port endpoints. Empty → desktop built-in relay.
  const {
    DEFAULT_PUBLIC_APP_BASE_URL,
    DEFAULT_RELAY_ENDPOINT,
    DEFAULT_RELAY_USE_TLS,
    LEGACY_DEFAULT_PUBLIC_APP_BASE_URL,
    LEGACY_DEFAULT_RELAY_ENDPOINT,
    normalizePublicAppBaseUrl,
    normalizeRelayEndpoint,
  } = require('../shared/lan');
  const relayCandidate = typeof next.remoteRelayUrl === 'string'
    ? next.remoteRelayUrl
    : (next.remoteRelayEndpoint || '');
  const normalizedEndpoint = normalizeRelayEndpoint(relayCandidate);
  const useBuiltInRelay = !normalizedEndpoint || normalizedEndpoint === LEGACY_DEFAULT_RELAY_ENDPOINT;
  const endpoint = useBuiltInRelay ? DEFAULT_RELAY_ENDPOINT : normalizedEndpoint;
  next.remoteRelayEndpoint = endpoint;
  next.remoteRelayUrl = endpoint;
  next.remoteRelayUseTls = useBuiltInRelay ? DEFAULT_RELAY_USE_TLS : next.remoteRelayUseTls === true;
  // Empty stays empty — never backfill the relay origin as an SPA landing host.
  const appBaseUrl = normalizePublicAppBaseUrl(next.remoteAppBaseUrl, {
    relayEndpoint: endpoint,
  });
  next.remoteAppBaseUrl = appBaseUrl === LEGACY_DEFAULT_PUBLIC_APP_BASE_URL
    || appBaseUrl === DEFAULT_PUBLIC_APP_BASE_URL
    ? ''
    : appBaseUrl;
  // Legacy host token is ignored for product pairing; keep field for migration clears.
  next.remoteRelayToken = normalizeRelayHostToken(next.remoteRelayToken);
  next.remoteMode = next.remoteMode === 'lan' ? 'lan' : 'relay';
  const remotePort = Number(next.remotePort);
  next.remotePort = Number.isInteger(remotePort) && remotePort >= 1024 && remotePort <= 65535
    ? remotePort
    : DEFAULTS.remotePort;
  next.remoteBindAddress = normalizeRemoteBindAddress(next.remoteBindAddress);
  next.remoteLanTls = next.remoteLanTls === true;
  return next;
}

function normalizeHarnessRecovery(config) {
  const next = { ...config };
  next.harnessAutoRestart = typeof next.harnessAutoRestart === 'boolean'
    ? next.harnessAutoRestart
    : DEFAULTS.harnessAutoRestart;
  const maxAttempts = Number(next.harnessRestartMaxAttempts);
  next.harnessRestartMaxAttempts = Number.isInteger(maxAttempts) && maxAttempts >= 1 && maxAttempts <= 10
    ? maxAttempts
    : DEFAULTS.harnessRestartMaxAttempts;
  const baseDelayMs = Number(next.harnessRestartBaseDelayMs);
  next.harnessRestartBaseDelayMs = Number.isInteger(baseDelayMs) && baseDelayMs >= 500 && baseDelayMs <= 30_000
    ? baseDelayMs
    : DEFAULTS.harnessRestartBaseDelayMs;
  return next;
}

function normalizePluginRecovery(config) {
  const value = isPlainObject(config.pluginRecovery) ? config.pluginRecovery : {};
  return {
    ...config,
    pluginRecovery: {
      skipUserPlugins: value.skipUserPlugins === true,
      reason: typeof value.reason === 'string' ? value.reason.slice(0, 500) : '',
      at: typeof value.at === 'string' ? value.at.slice(0, 80) : '',
      appVersion: typeof value.appVersion === 'string' ? value.appVersion.slice(0, 80) : '',
    },
  };
}

function normalizeDisabledPlugins(list) {
  const { withoutDshImAliases } = require('./dsh-im-desktop');
  const { withoutDshbotAliases } = require('./dshbot-desktop');
  const { withoutDshWhaleAliases } = require('./dsh-whale-desktop');
  const { withoutDshRemoteAliases } = require('./dsh-remote-desktop');
  const { withoutUsagePanelAliases } = require('./usage-panel-preset');
  const { withoutTaskControlAliases } = require('./task-control-overlay');
  return [...new Set(withoutTaskControlAliases(withoutDshWhaleAliases(withoutDshbotAliases(withoutDshRemoteAliases(withoutUsagePanelAliases(withoutDshImAliases(
    (Array.isArray(list) ? list : [])
      .map((name) => String(name || '').trim())
      .filter(Boolean),
  )))))))];
}

function normalizeLauncherSettings(config) {
  return {
    ...config,
    quitAfterStart: config.quitAfterStart !== false,
    autoStartDesktop: config.autoStartDesktop !== false,
    askOnUpdate: config.askOnUpdate !== false,
    downloadRoute: config.downloadRoute === 'gitee' ? 'cnb' : ['github', 'cnb'].includes(config.downloadRoute) ? config.downloadRoute : '',
    disabledPlugins: normalizeDisabledPlugins(config.disabledPlugins),
  };
}

function normalizeLauncherConfigPatch(patch) {
  if (!isPlainObject(patch)) {
    throw new TypeError('Config patch must be an object');
  }
  const next = {};
  for (const [key, value] of Object.entries(patch)) {
    if (['quitAfterStart', 'autoStartDesktop', 'askOnUpdate', 'closeToTray'].includes(key)) {
      if (typeof value !== 'boolean') {
        throw new TypeError(`${key} must be a boolean`);
      }
      next[key] = value;
      continue;
    }
    if (key === 'downloadRoute') {
      if (!['', 'github', 'cnb'].includes(value)) {
        throw new TypeError('downloadRoute must be "", "github" or "cnb"');
      }
      next[key] = value;
      continue;
    }
    if (key === 'components') {
      // Lane-owned namespace (launcher components platform): renderer writes
      // whole object blobs; the components module validates the inner shape.
      if (!isPlainObject(value) || JSON.stringify(value).length > 65536) {
        throw new TypeError('components must be a plain object under 64KiB');
      }
      next[key] = value;
      continue;
    }
    throw new Error(`Config field is not launcher-writable: ${key}`);
  }
  return next;
}

function configPath() {
  return path.join(app.getPath('userData'), 'config.json');
}

function credentialsPath() {
  return path.join(app.getPath('userData'), 'credentials.json');
}

function readJson(file, fallback) {
  try {
    return { ...fallback, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch {
    return { ...fallback };
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

/** Envelope marker for OS-keychain-encrypted credentials.json. */
const CREDENTIALS_ENVELOPE_VERSION = 'safeStorage-v1';

/**
 * The injectable safeStorage face (tests replace it; plain Node has none).
 * Encryption is used only when the OS keychain is actually available —
 * otherwise reads and writes stay plaintext so no platform loses credentials.
 */
let safeStorageImpl = safeStorage;

function setSafeStorageForTests(impl) {
  safeStorageImpl = impl === undefined ? safeStorage : impl;
}

function canEncryptCredentials() {
  try {
    return Boolean(safeStorageImpl
      && typeof safeStorageImpl.isEncryptionAvailable === 'function'
      && safeStorageImpl.isEncryptionAvailable()
      && typeof safeStorageImpl.encryptString === 'function'
      && typeof safeStorageImpl.decryptString === 'function');
  } catch {
    return false;
  }
}

function isEncryptedCredentialsFile(raw) {
  return Boolean(raw)
    && typeof raw === 'object'
    && raw.version === CREDENTIALS_ENVELOPE_VERSION
    && typeof raw.payload === 'string';
}

/**
 * Read credentials.json, decrypting the safeStorage envelope when present.
 * A legacy plaintext file that can now be encrypted is migrated in place
 * (one-time rewrite) so secrets do not stay on disk in the clear.
 */
function readCredentials() {
  const file = credentialsPath();
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return { creds: {}, needsWrite: true };
  }
  if (isEncryptedCredentialsFile(raw)) {
    if (!canEncryptCredentials()) {
      return { creds: {}, needsWrite: true };
    }
    try {
      const json = safeStorageImpl.decryptString(Buffer.from(raw.payload, 'base64'));
      const parsed = JSON.parse(json);
      return { creds: parsed && typeof parsed === 'object' ? parsed : {}, needsWrite: false };
    } catch {
      return { creds: {}, needsWrite: true };
    }
  }
  const plain = raw && typeof raw === 'object' ? raw : {};
  let needsWrite = false;
  if (canEncryptCredentials()) {
    try {
      writeCredentials(plain);
    } catch {
      // Migration is best-effort; the plaintext copy stays readable.
      needsWrite = true;
    }
  }
  return { creds: plain, needsWrite };
}

/**
 * User-visible credential storage mode for About / diagnostics:
 * `encrypted` when safeStorage (OS keychain) protects credentials.json,
 * `plaintext` on platforms where it falls back to a clear-text file
 * (e.g. Linux without an unlocked keyring).
 */
function credentialStorageMode() {
  return canEncryptCredentials() ? 'encrypted' : 'plaintext';
}

/** Persist credentials, encrypted via safeStorage whenever the OS allows. */
function writeCredentials(data) {
  const file = credentialsPath();
  if (!canEncryptCredentials()) {
    writeJson(file, data);
    return;
  }
  const payload = safeStorageImpl.encryptString(JSON.stringify(data)).toString('base64');
  writeJson(file, { version: CREDENTIALS_ENVELOPE_VERSION, payload });
}

function isUnsafeWorkspace(dir) {
  if (!app.isPackaged || !dir) {
    return false;
  }
  const resources = path.normalize(process.resourcesPath);
  const resolved = path.normalize(dir);
  return resolved === resources || resolved.startsWith(`${resources}${path.sep}`);
}

function defaultWorkspace() {
  if (app.isPackaged) {
    const documents = app.getPath('documents');
    const legacy = path.join(documents, LEGACY_PRODUCT_NAME);
    return fs.existsSync(legacy) ? legacy : path.join(documents, PRODUCT_NAME);
  }
  return projectRoot();
}

function readConfigLayers() {
  const stored = readJson(configPath(), {});
  const { creds, needsWrite } = readCredentials();
  let config = {
    ...DEFAULTS,
    ...stored,
    apiKey: typeof creds.apiKey === 'string' ? creds.apiKey : stored.apiKey || '',
    baseUrl: typeof creds.baseUrl === 'string' ? creds.baseUrl : stored.baseUrl || '',
    githubToken: typeof creds.githubToken === 'string' ? creds.githubToken : stored.githubToken || '',
    remoteToken: typeof creds.remoteToken === 'string' ? creds.remoteToken : stored.remoteToken || '',
    remoteRelayToken: typeof creds.remoteRelayToken === 'string' ? creds.remoteRelayToken : '',
    remoteDevices: Array.isArray(creds.remoteDevices) ? creds.remoteDevices : [],
  };
  config = normalizeLauncherSettings(
    normalizePetStateInConfig(normalizeLive2dPetStateInConfig(normalizeRemoteConfig(normalizePluginRecovery(normalizeHarnessRecovery(config))))),
  );
  if (!config.workspace || isUnsafeWorkspace(config.workspace)) {
    config.workspace = defaultWorkspace();
  }
  if (config.locale !== 'en' && config.locale !== 'zh') {
    config.locale = DEFAULTS.locale;
  }
  delete config.pluginSubagent;
  delete config.pluginGenUi;
  return { config, stored, creds, credentialsNeedWrite: needsWrite };
}

function loadConfig() {
  return readConfigLayers().config;
}

/**
 * Monotonic revision for the on-disk config. A start reads one snapshot and
 * must not silently mix it with values written by a Settings save that lands
 * in the middle of the start (port, disabled list, built-in plugin toggles).
 */
let configRevisionValue = 0;

function configRevision() {
  return configRevisionValue;
}

/**
 * One consistent config read: the parsed values plus the revision they belong
 * to. Long-running work keeps the object and compares the revision later.
 */
function readConfigSnapshot() {
  const revision = configRevisionValue;
  return { config: loadConfig(), revision };
}

function saveConfig(next) {
  const { config: current, stored, creds, credentialsNeedWrite } = readConfigLayers();
  const merged = normalizeLauncherSettings(
    normalizePetStateInConfig(normalizeLive2dPetStateInConfig(normalizeRemoteConfig(normalizePluginRecovery(normalizeHarnessRecovery({ ...current, ...next }))))),
  );
  if (merged.githubToken === '********') {
    merged.githubToken = current.githubToken;
  }
  if (merged.apiKey === '********') {
    merged.apiKey = current.apiKey;
  }
  merged.locale = merged.locale === 'en' ? 'en' : 'zh';
  delete merged.pluginSubagent;
  delete merged.pluginGenUi;
  const { apiKey, baseUrl, githubToken, remoteToken, remoteRelayToken, remoteDevices, ...publicLayer } = merged;
  if (!isDeepStrictEqual(stored, publicLayer)) {
    writeJson(configPath(), publicLayer);
  }
  const credentials = {
    apiKey: apiKey || '',
    baseUrl: baseUrl || '',
    githubToken: githubToken || '',
    remoteToken: remoteToken || '',
    remoteRelayToken: remoteRelayToken || '',
    remoteDevices: Array.isArray(remoteDevices) ? remoteDevices : [],
  };
  if (credentialsNeedWrite || !isDeepStrictEqual(creds, credentials)) {
    writeCredentials(credentials);
  }
  configRevisionValue += 1;
  return merged;
}

function publicConfig(config) {
  return {
    ...config,
    pet: normalizePetState(config?.pet),
    live2dPet: normalizeLive2dPetState(config?.live2dPet),
    apiKey: config.apiKey ? '********' : '',
    githubToken: config.githubToken ? '********' : '',
    hasApiKey: Boolean(config.apiKey),
    hasGithubToken: Boolean(config.githubToken),
    remoteEnabled: Boolean(config.remoteEnabled),
    remoteAvailable: REMOTE_FEATURE_ENABLED,
    remotePort: Number(config.remotePort) || DEFAULTS.remotePort,
    remoteMode: config.remoteMode === 'lan' ? 'lan' : 'relay',
    remoteBindAddress: normalizeRemoteBindAddress(config.remoteBindAddress),
    remoteLanTls: config.remoteLanTls === true,
    remoteRelayUrl: config.remoteRelayUrl || '',
    remoteToken: '',
    remoteRelayToken: '',
    remoteDevices: [],
  };
}

function parkRemoteSnapshot(snap) {
  const base = snap && typeof snap === 'object' ? snap : {};
  return {
    ...base,
    available: false,
    enabled: false,
    listening: false,
    urls: [],
    token: '',
  };
}

function readDisabledPlugins(options = {}) {
  if (Array.isArray(options.disabledPlugins)) {
    return options.disabledPlugins;
  }
  try {
    if (!app?.getPath) {
      return [];
    }
    return loadConfig().disabledPlugins || [];
  } catch {
    return [];
  }
}

module.exports = {
  DEFAULTS,
  REMOTE_FEATURE_ENABLED,
  loadConfig,
  readConfigSnapshot,
  configRevision,
  saveConfig,
  publicConfig,
  parkRemoteSnapshot,
  defaultWorkspace,
  configPath,
  credentialsPath,
  credentialStorageMode,
  setSafeStorageForTests,
  readDisabledPlugins,
  normalizeHarnessRecovery,
  normalizePluginRecovery,
  normalizeRendererConfigPatch,
  normalizeLauncherConfigPatch,
  normalizePetState,
  normalizeRemotePatch,
  normalizeRelayOrigin,
  normalizeRemoteBindAddress,
  normalizeRemoteConfig,
};
