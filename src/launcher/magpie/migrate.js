'use strict';

const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { atomicWriteFileSync, renameWithRetrySync, safeRemoveSync } = require('../../shared/fs-safe');
const { detachWhaleBridgeDshChannel, readDshDefaultModel } = require('./dsh-sync');

const EXCLUDED_TOP_ENTRIES = new Set([
  'gateway.key',
  'agents.json',
  'state.json',
  'component.log',
  'cache',
  'applied.json',
  'stash.json',
  'aside-account.json',
  'cursor-local.env',
]);

const SENSITIVE_FILES = new Set([
  'logins.json',
  'plugin-auth.json',
  'sync.json',
  'redact.key',
  'qoder.json',
  'stepfun-auth.json',
  'kiro-auth-token.json',
  'usage-computer.json',
]);

const KEEP_EXISTING_TARGET_FILES = new Set([
  'settings.json',
  'sync.json',
  'redact.key',
  'plugins.yml',
]);

/** @param {string} file */
function readJsonOrNull(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** @param {string} file */
function readTextOrEmpty(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

/**
 * Compute a deterministic fingerprint of legacy WhaleBridge data dir for idempotency.
 * @param {string} legacyDataDir
 */
function fingerprintLegacyData(legacyDataDir) {
  const hash = createHash('sha256');
  const probes = ['providers.json', 'logins.json', 'settings.json', 'usage.jsonl', 'agents.json'];
  for (const name of probes) {
    const full = path.join(legacyDataDir, name);
    try {
      const st = fs.statSync(full);
      hash.update(`${name}:${st.size}:${Math.trunc(st.mtimeMs)};`);
    } catch {
      hash.update(`${name}:missing;`);
    }
  }
  return hash.digest('hex');
}

/**
 * Detect legacy WhaleBridge installation/data under `<desktopStateDir>/components/whalebridge`.
 * @param {string} desktopStateDir
 */
function detectLegacyWhaleBridge(desktopStateDir) {
  const root = path.join(desktopStateDir, 'components', 'whalebridge');
  const dataDir = path.join(root, 'data');
  const installedFile = path.join(root, 'installed.json');
  const installed = readJsonOrNull(installedFile);
  const state = readJsonOrNull(path.join(dataDir, 'state.json'));
  const migrationState = readJsonOrNull(path.join(root, 'migration-state.json'));
  const hasData = fs.existsSync(dataDir) && [
    'providers.json', 'logins.json', 'settings.json', 'usage.jsonl', 'agents.json',
  ].some((name) => fs.existsSync(path.join(dataDir, name)));
  return {
    root,
    dataDir,
    installedFile,
    installed,
    state,
    migrationState,
    hasData,
    needsMigration: (hasData || Boolean(installed)) && !installed?.migratedToMagpieAt
      && migrationState?.stage !== 'completed',
  };
}

/** @param {string} legacyRoot */
function readMigrationState(legacyRoot) {
  return readJsonOrNull(path.join(legacyRoot, 'migration-state.json'));
}

/**
 * Rewrite absolute `home` paths inside `logins.json` and `migrations.json`
 * from `<legacyDataDir>/{grok,devin,kiro}/...` to `<targetConfigDir>/{grok,devin,kiro}/...`.
 * @param {string} rawPath
 * @param {string} legacyDataDir
 * @param {string} targetConfigDir
 * @returns {string}
 */
function rewriteAccountHomePath(rawPath, legacyDataDir, targetConfigDir) {
  if (typeof rawPath !== 'string' || !rawPath) return rawPath;
  const normSource = path.resolve(legacyDataDir).replace(/\\/g, '/').replace(/\/+$/, '');
  const normInput = rawPath.replace(/\\/g, '/');
  const matchSource = process.platform === 'win32' ? normSource.toLowerCase() : normSource;
  const matchInput = process.platform === 'win32' ? normInput.toLowerCase() : normInput;
  if (matchInput !== matchSource && !matchInput.startsWith(`${matchSource}/`)) {
    return rawPath;
  }
  const rel = normInput.slice(normSource.length).replace(/^\/+/, '');
  return path.join(targetConfigDir, ...rel.split('/'));
}

/**
 * Recursively rewrite `home` fields in parsed JSON objects (`logins.json` / `migrations.json`).
 * @param {any} node
 * @param {string} legacyDataDir
 * @param {string} targetConfigDir
 * @returns {any}
 */
function rewriteHomeFields(node, legacyDataDir, targetConfigDir) {
  if (Array.isArray(node)) {
    return node.map((item) => rewriteHomeFields(item, legacyDataDir, targetConfigDir));
  }
  if (!node || typeof node !== 'object') return node;
  /** @type {Record<string, any>} */
  const out = {};
  for (const [k, v] of Object.entries(node)) {
    if (k === 'home' && typeof v === 'string') {
      out[k] = rewriteAccountHomePath(v, legacyDataDir, targetConfigDir);
    } else {
      out[k] = rewriteHomeFields(v, legacyDataDir, targetConfigDir);
    }
  }
  return out;
}

/**
 * @param {string} srcDir
 * @param {string} destDir
 * @param {{ skipNodeModules?: boolean, legacyDataDir?: string, targetConfigDir?: string }} [options]
 */
function copyDirectoryFiltered(srcDir, destDir, options = {}) {
  if (!fs.existsSync(srcDir)) return;
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    if (entry.name.endsWith('.lock') || EXCLUDED_TOP_ENTRIES.has(entry.name)) {
      if (srcDir === options.legacyDataDir) continue;
    }
    if (options.skipNodeModules && entry.name === 'node_modules') continue;
    const from = path.join(srcDir, entry.name);
    const to = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyDirectoryFiltered(from, to, {
        ...options,
        skipNodeModules: entry.name === 'plugins' || options.skipNodeModules,
      });
    } else if (entry.isFile()) {
      const mode = SENSITIVE_FILES.has(entry.name) ? 0o600 : undefined;
      if ((entry.name === 'logins.json' || entry.name === 'migrations.json') && options.legacyDataDir && options.targetConfigDir) {
        const parsed = readJsonOrNull(from);
        if (parsed !== null) {
          const rewritten = rewriteHomeFields(parsed, options.legacyDataDir, options.targetConfigDir);
          atomicWriteFileSync(to, `${JSON.stringify(rewritten, null, 2)}\n`, { mode: mode ?? 0o600 });
          continue;
        }
      }
      const bytes = fs.readFileSync(from);
      atomicWriteFileSync(to, bytes, mode ? { mode } : undefined);
    }
  }
}

/**
 * Merge a single provider/group/searcher map into `base` without overwriting existing entries.
 * @param {Record<string, any>} base
 * @param {Record<string, any>} src
 * @param {string} mapKey
 * @param {string} orderKey
 */
function mergeProviderCollection(base, src, mapKey, orderKey) {
  if (!src[mapKey] || typeof src[mapKey] !== 'object') return;
  base[mapKey] = base[mapKey] && typeof base[mapKey] === 'object' ? base[mapKey] : {};
  const order = Array.isArray(base[orderKey]) ? [...base[orderKey]] : Object.keys(base[mapKey]);
  for (const [id, entry] of Object.entries(src[mapKey])) {
    let targetId = id;
    if (Object.hasOwn(base[mapKey], id)) {
      if (JSON.stringify(base[mapKey][id]) === JSON.stringify(entry)) continue;
      targetId = `${id}-whalebridge`;
      let suffix = 2;
      while (Object.hasOwn(base[mapKey], targetId)) targetId = `${id}-whalebridge-${suffix++}`;
    }
    base[mapKey][targetId] = entry;
    if (!order.includes(targetId)) order.push(targetId);
  }
  base[orderKey] = order;
}

/**
 * Merge `providers.json`: existing Magpie entries take absolute precedence;
 * colliding WhaleBridge entries are saved with `<id>-whalebridge`.
 * @param {any} target
 * @param {any} source
 */
function mergeProvidersJson(target, source) {
  const base = target && typeof target === 'object' ? structuredClone(target) : {};
  const src = source && typeof source === 'object' ? source : {};
  for (const [mapKey, orderKey] of [['providers', 'order'], ['groups', 'groupOrder'], ['searchers', 'searchOrder']]) {
    mergeProviderCollection(base, src, mapKey, orderKey);
  }
  if (Array.isArray(src.pluginLeft)) {
    const existing = Array.isArray(base.pluginLeft) ? [...base.pluginLeft] : [];
    const seen = new Set(existing.map((/** @type {any} */ item) => `${item?.package || ''}:${item?.id || ''}`));
    for (const item of src.pluginLeft) {
      const key = `${item?.package || ''}:${item?.id || ''}`;
      if (!seen.has(key)) { seen.add(key); existing.push(item); }
    }
    base.pluginLeft = existing;
  }
  return base;
}

/** @param {any} entry */
function accountFreshness(entry) {
  const candidates = [entry?.renewed, entry?.seen, entry?.updatedAt, entry?.updated_at];
  let best = 0;
  for (const raw of candidates) {
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      best = Math.max(best, raw);
    } else if (typeof raw === 'string' && raw) {
      const ms = Date.parse(raw);
      if (Number.isFinite(ms)) best = Math.max(best, ms);
    }
  }
  return best;
}

/** @param {any} entry */
function loginAccountKey(entry) {
  const agent = String(entry?.agent || entry?.provider || '').trim().toLowerCase();
  const user = String(entry?.user || entry?.email || entry?.account || entry?.id || '').trim().toLowerCase();
  return `${agent}::${user}`;
}

/**
 * @param {any[]} baseList
 * @param {any[]} srcList
 */
function mergeLoginArray(baseList, srcList) {
  const indexByKey = new Map();
  baseList.forEach((/** @type {any} */ item, /** @type {number} */ idx) => indexByKey.set(loginAccountKey(item), idx));
  for (const item of srcList) {
    const key = loginAccountKey(item);
    const idx = indexByKey.get(key);
    if (idx === undefined) {
      indexByKey.set(key, baseList.length);
      baseList.push(item);
    } else if (accountFreshness(item) > accountFreshness(baseList[idx])) {
      baseList[idx] = item;
    }
  }
  return baseList;
}

/**
 * Merge `logins.json` or `plugin-auth.json`: keep whichever entry has the newer `seen`/`renewed`
 * timestamp so an older refresh token never revokes an active session.
 * @param {any} target
 * @param {any} source
 * @param {string} legacyDataDir
 * @param {string} targetConfigDir
 */
function mergeLoginsJson(target, source, legacyDataDir, targetConfigDir) {
  const rewrittenSource = rewriteHomeFields(source, legacyDataDir, targetConfigDir);
  const baseList = Array.isArray(target) ? structuredClone(target)
    : (Array.isArray(target?.accounts) ? structuredClone(target.accounts) : null);
  const srcList = Array.isArray(rewrittenSource) ? rewrittenSource
    : (Array.isArray(rewrittenSource?.accounts) ? rewrittenSource.accounts : null);

  if (baseList && srcList) {
    const merged = mergeLoginArray(baseList, srcList);
    return Array.isArray(target) ? merged : { ...(target || {}), accounts: merged };
  }
  if (!target || typeof target !== 'object' || !rewrittenSource || typeof rewrittenSource !== 'object') {
    return target ?? rewrittenSource;
  }
  const out = structuredClone(target);
  for (const [k, v] of Object.entries(rewrittenSource)) {
    if (!Object.hasOwn(out, k) || accountFreshness(v) > accountFreshness(out[k])) out[k] = v;
  }
  return out;
}

/**
 * Merge `plugins.json` by package name without downgrading existing installed versions.
 * @param {any} target
 * @param {any} source
 */
function mergePluginsJson(target, source) {
  if (!Array.isArray(target) && target && typeof target === 'object' && source && typeof source === 'object') {
    const out = structuredClone(target);
    for (const [pkg, meta] of Object.entries(source)) {
      if (!Object.hasOwn(out, pkg)) out[pkg] = meta;
    }
    return out;
  }
  if (Array.isArray(target) && Array.isArray(source)) {
    const seen = new Set(target.map((item) => item?.name || item?.package || JSON.stringify(item)));
    const out = [...target];
    for (const item of source) {
      const key = item?.name || item?.package || JSON.stringify(item);
      if (!seen.has(key)) {
        seen.add(key);
        out.push(item);
      }
    }
    return out;
  }
  return target ?? source;
}

/** @param {Record<string, any> | null | undefined} row */
function usageFingerprint(row) {
  const r = row || {};
  const vals = ['t', 'agent', 'req', 'model', 'provider'].map((k) => r[k] || '');
  vals.push(r.in || 0, r.out || 0, r.route_id ?? r.request_id ?? r.rid ?? '');
  return JSON.stringify(vals);
}

/**
 * Deduplicate and time-sort `usage.jsonl` across target and source.
 * @param {string} targetText
 * @param {string} sourceText
 */
function mergeUsageJsonl(targetText, sourceText) {
  const entries = [];
  const seen = new Set();
  for (const raw of `${targetText}\n${sourceText}`.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    const key = usageFingerprint(parsed);
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({ t: String(parsed?.t || ''), line: JSON.stringify(parsed) });
  }
  entries.sort((a, b) => a.t.localeCompare(b.t));
  return entries.length ? `${entries.map((e) => e.line).join('\n')}\n` : '';
}

/**
 * Backup target files before mutating them, so any mid-flight failure rolls back cleanly.
 * @param {string} backupDir
 * @param {{ dshHome: string, targetConfigDir: string }} options
 */
function snapshotTargets(backupDir, { dshHome, targetConfigDir }) {
  fs.mkdirSync(backupDir, { recursive: true });
  const copies = [
    [path.join(dshHome, 'cordis.patch.yml'), path.join(backupDir, 'dsh-home-cordis.patch.yml')],
    [path.join(dshHome, 'profiles', 'web', 'cordis.patch.yml'), path.join(backupDir, 'dsh-web-cordis.patch.yml')],
    [path.join(dshHome, '.credentials.yaml'), path.join(backupDir, 'dsh-credentials.yaml')],
  ];
  for (const name of ['providers.json', 'logins.json', 'plugin-auth.json', 'plugins.json', 'migrations.json', 'usage.jsonl']) {
    copies.push([path.join(targetConfigDir, name), path.join(backupDir, 'magpie', name)]);
  }
  const recorded = [];
  for (const [src, dst] of copies) {
    const existed = fs.existsSync(src);
    if (existed) {
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(src, dst);
    }
    recorded.push({ src, dst, existed });
  }
  atomicWriteFileSync(path.join(backupDir, 'manifest.json'), `${JSON.stringify(recorded, null, 2)}\n`);
  return recorded;
}

/** @param {Array<{ src: string, dst: string, existed: boolean }>} recorded */
function restoreSnapshot(recorded) {
  for (const item of recorded) {
    if (item.existed) {
      fs.mkdirSync(path.dirname(item.src), { recursive: true });
      fs.copyFileSync(item.dst, item.src);
    } else {
      safeRemoveSync(item.src);
    }
  }
}

/**
 * Merge or cold-copy legacy WhaleBridge data directory into `targetConfigDir`.
 * @param {{ legacyDataDir: string, targetConfigDir: string, externalRunning?: boolean }} options
 */
function migrateDataDirectory({ legacyDataDir, targetConfigDir, externalRunning = false }) {
  if (!fs.existsSync(legacyDataDir)) {
    return { mode: 'empty', dataMergeSkipped: '', notice: '' };
  }
  if (!fs.existsSync(targetConfigDir) || fs.readdirSync(targetConfigDir).length === 0) {
    const staging = path.join(path.dirname(targetConfigDir), `.magpie-migrate-${process.pid}-${Date.now()}`);
    try {
      copyDirectoryFiltered(legacyDataDir, staging, {
        skipNodeModules: true,
        legacyDataDir,
        targetConfigDir,
      });
      safeRemoveSync(targetConfigDir);
      renameWithRetrySync(staging, targetConfigDir);
    } finally {
      safeRemoveSync(staging);
    }
    return { mode: 'cold', dataMergeSkipped: '', notice: '' };
  }
  if (externalRunning) {
    return {
      mode: 'skipped-external-running',
      dataMergeSkipped: 'external-running',
      notice: '检测到本机已有 Magpie 正在运行，已跳过自动配置合并以防覆盖运行态文件；旧鲸桥数据已原样保留。',
    };
  }
  mergeIntoExistingConfigDir(legacyDataDir, targetConfigDir);
  return { mode: 'merged', dataMergeSkipped: '', notice: '' };
}

/**
 * @param {string} legacyDataDir
 * @param {string} targetConfigDir
 */
function mergeIntoExistingConfigDir(legacyDataDir, targetConfigDir) {
  const srcProviders = readJsonOrNull(path.join(legacyDataDir, 'providers.json'));
  if (srcProviders) {
    const merged = mergeProvidersJson(readJsonOrNull(path.join(targetConfigDir, 'providers.json')), srcProviders);
    atomicWriteFileSync(path.join(targetConfigDir, 'providers.json'), `${JSON.stringify(merged, null, 2)}\n`);
  }
  for (const loginFile of ['logins.json', 'plugin-auth.json']) {
    const src = readJsonOrNull(path.join(legacyDataDir, loginFile));
    if (src) {
      const merged = mergeLoginsJson(readJsonOrNull(path.join(targetConfigDir, loginFile)), src, legacyDataDir, targetConfigDir);
      atomicWriteFileSync(path.join(targetConfigDir, loginFile), `${JSON.stringify(merged, null, 2)}\n`, { mode: 0o600 });
    }
  }
  const srcPlugins = readJsonOrNull(path.join(legacyDataDir, 'plugins.json'));
  if (srcPlugins) {
    const merged = mergePluginsJson(readJsonOrNull(path.join(targetConfigDir, 'plugins.json')), srcPlugins);
    atomicWriteFileSync(path.join(targetConfigDir, 'plugins.json'), `${JSON.stringify(merged, null, 2)}\n`);
  }
  const srcUsage = readTextOrEmpty(path.join(legacyDataDir, 'usage.jsonl'));
  if (srcUsage) {
    const merged = mergeUsageJsonl(readTextOrEmpty(path.join(targetConfigDir, 'usage.jsonl')), srcUsage);
    if (merged) atomicWriteFileSync(path.join(targetConfigDir, 'usage.jsonl'), merged);
  }
  for (const accountDir of ['claude-accounts', 'grok', 'devin', 'kiro', 'icons']) {
    const srcSub = path.join(legacyDataDir, accountDir);
    if (fs.existsSync(srcSub) && !fs.existsSync(path.join(targetConfigDir, accountDir))) {
      copyDirectoryFiltered(srcSub, path.join(targetConfigDir, accountDir), { legacyDataDir, targetConfigDir });
    }
  }
  for (const entry of fs.readdirSync(legacyDataDir, { withFileTypes: true })) {
    if (!entry.isFile() || EXCLUDED_TOP_ENTRIES.has(entry.name) || KEEP_EXISTING_TARGET_FILES.has(entry.name)) continue;
    if (['providers.json', 'logins.json', 'plugin-auth.json', 'plugins.json', 'usage.jsonl'].includes(entry.name)) continue;
    if (entry.name.endsWith('.lock')) continue;
    const dst = path.join(targetConfigDir, entry.name);
    if (!fs.existsSync(dst)) {
      const mode = SENSITIVE_FILES.has(entry.name) ? 0o600 : undefined;
      atomicWriteFileSync(dst, fs.readFileSync(path.join(legacyDataDir, entry.name)), mode ? { mode } : undefined);
    }
  }
}

/**
 * Disconnect legacy WhaleBridge using its own binary if available, else clean DSH channel directly.
 * @param {{ legacyRoot: string, legacyInstalled: any, legacyDataDir: string, dshHome: string, runTool?: Function }} options
 */
async function disconnectLegacyBridge({ legacyRoot, legacyInstalled, legacyDataDir, dshHome, runTool }) {
  const version = legacyInstalled?.version;
  const exe = version ? path.join(legacyRoot, 'versions', version, 'WhaleBridge-win32-x64.exe') : '';
  if (exe && fs.existsSync(exe) && typeof runTool === 'function') {
    /** @type {Record<string, string | undefined>} */
    const env = {
      ...process.env,
      LAUNCHER_COMPONENT_ID: 'whalebridge',
      LAUNCHER_COMPONENT_DATA_DIR: legacyDataDir,
      WHALEBRIDGE_DSH_HOME: dshHome,
    };
    delete env.ELECTRON_RUN_AS_NODE;
    await runTool(exe, ['whalebridge-disconnect'], { env, windowsHide: true, timeout: 15_000 });
  }
  detachWhaleBridgeDshChannel(dshHome);
}

/**
 * End-to-end idempotent, rollback-safe migration from legacy WhaleBridge to official Magpie.
 * @param {{
 *   desktopStateDir: string,
 *   dshHome: string,
 *   targetConfigDir: string,
 *   externalRunning?: boolean,
 *   stopLegacyBridge?: (legacy: any) => Promise<void>,
 *   runTool?: Function,
 * }} options
 */
async function migrateWhaleBridgeToMagpie(options) {
  const legacy = detectLegacyWhaleBridge(options.desktopStateDir);
  if (!legacy.needsMigration) {
    return { migrated: false, reason: 'nothing-to-migrate' };
  }
  const stateFile = path.join(legacy.root, 'migration-state.json');
  const fingerprint = fingerprintLegacyData(legacy.dataDir);
  const existing = readJsonOrNull(stateFile);
  if (existing?.stage === 'completed' && existing?.fingerprint === fingerprint) {
    return { migrated: false, reason: 'already-migrated', state: existing };
  }

  const backupDir = path.join(legacy.root, `migration-backup-${Date.now()}`);
  const writeStage = (/** @type {string} */ stage, extra = {}) => {
    atomicWriteFileSync(stateFile, `${JSON.stringify({
      stage,
      fingerprint,
      backupDir,
      updatedAt: new Date().toISOString(),
      ...extra,
    }, null, 2)}\n`);
  };

  if (typeof options.stopLegacyBridge === 'function') {
    await options.stopLegacyBridge(legacy);
  }

  const recorded = snapshotTargets(backupDir, {
    dshHome: options.dshHome,
    targetConfigDir: options.targetConfigDir,
  });
  const previousDefault = readDshDefaultModel(options.dshHome);
  const agentsSnapshot = readJsonOrNull(path.join(legacy.dataDir, 'agents.json'));
  writeStage('backed_up', { previousDefault, externalAgents: agentsSnapshot || null });

  try {
    const dataResult = migrateDataDirectory({
      legacyDataDir: legacy.dataDir,
      targetConfigDir: options.targetConfigDir,
      externalRunning: options.externalRunning,
    });
    writeStage('data_migrated', { dataMode: dataResult.mode, dataMergeSkipped: dataResult.dataMergeSkipped });

    await disconnectLegacyBridge({
      legacyRoot: legacy.root,
      legacyInstalled: legacy.installed,
      legacyDataDir: legacy.dataDir,
      dshHome: options.dshHome,
      runTool: options.runTool,
    });
    writeStage('agents_disconnected');

    if (legacy.installed && fs.existsSync(legacy.installedFile)) {
      atomicWriteFileSync(legacy.installedFile, `${JSON.stringify({
        ...legacy.installed,
        migratedToMagpieAt: new Date().toISOString(),
      }, null, 2)}\n`);
    }
    const result = {
      migrated: true,
      dataMode: dataResult.mode,
      dataMergeSkipped: dataResult.dataMergeSkipped,
      notice: dataResult.notice,
      previousDefault,
      externalAgents: Array.isArray(agentsSnapshot) ? agentsSnapshot : (agentsSnapshot?.agents || []),
      backupDir,
    };
    writeStage('completed', result);
    return result;
  } catch (error) {
    restoreSnapshot(recorded);
    writeStage('rolled_back', { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

module.exports = {
  detectLegacyWhaleBridge,
  readMigrationState,
  rewriteAccountHomePath,
  mergeProvidersJson,
  mergeLoginsJson,
  mergeUsageJsonl,
  migrateWhaleBridgeToMagpie,
};
