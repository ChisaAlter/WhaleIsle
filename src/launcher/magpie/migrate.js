'use strict';

const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { atomicWriteFileSync, renameWithRetrySync, safeRemoveSync } = require('../../shared/fs-safe');
const { detachWhaleBridgeDshChannel, readDshDefaultModel } = require('./dsh-sync');
const {
  ACCOUNT_SUBDIRS, EXCLUDED_TOP_ENTRIES, isSensitiveTarget, shouldSkipEntry, snapshotTargets, restoreSnapshot,
} = require('./migration-backup');

const KEEP_EXISTING_TARGET_FILES = new Set(['settings.json', 'sync.json', 'redact.key', 'plugins.yml']);
const DATA_PROBES = [
  'providers.json', 'logins.json', 'plugin-auth.json', 'plugins.json',
  'migrations.json', 'settings.json', 'usage.jsonl', 'agents.json',
];
const DEFERRED_MERGE_IN_PROGRESS = 'deferred_data_merging';
const BLOCKED_RECONCILE_STAGES = new Set([
  'backed_up', 'data_migrated', 'agents_disconnected', 'rolled_back', 'deferred_data_merge', DEFERRED_MERGE_IN_PROGRESS,
]);
const CACHE_ONLY_TOP_ENTRIES = new Set(['catalog.json', 'logs', 'data']);
const SPECIAL_JSON_FILES = new Set([
  'providers.json', 'logins.json', 'plugin-auth.json', 'plugins.json', 'migrations.json', 'usage.jsonl',
]);

/** @param {string} file */
function readJsonOrNull(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error)?.code === 'ENOENT') return null;
    throw error;
  }
}

/** @param {string} file */
function readJsonBestEffort(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

/** @param {string} file */
function readTextOrEmpty(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error)?.code === 'ENOENT') return '';
    throw error;
  }
}

/** @param {unknown} value */
function isPlainObject(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }

/** @param {string} root @param {string} target */
function isPathInside(root, target) {
  const rel = path.relative(root, target);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/** @param {string} dir */
function tryRealpath(dir) {
  try { return fs.realpathSync(dir); } catch { return path.resolve(dir); }
}

/** @param {string} full @param {import('node:crypto').Hash} hash @param {string} label */
function hashStat(full, hash, label) {
  try { const st = fs.statSync(full); hash.update(`${label}:${st.size}:${Math.trunc(st.mtimeMs)};`); } catch { hash.update(`${label}:missing;`); }
}

/**
 * Compute a deterministic fingerprint of legacy WhaleBridge data dir & installed.json.
 * @param {string} legacyDataDir @param {string} [installedFile]
 */
function fingerprintLegacyData(legacyDataDir, installedFile) {
  const hash = createHash('sha256');
  for (const name of DATA_PROBES) hashStat(path.join(legacyDataDir, name), hash, name);
  hashStat(installedFile || path.join(path.dirname(legacyDataDir), 'installed.json'), hash, 'installed.json');
  for (const sub of ACCOUNT_SUBDIRS) {
    const subDir = path.join(legacyDataDir, sub);
    try {
      const entries = fs.readdirSync(subDir).sort();
      hash.update(`${sub}:[${entries.join(',')}];`);
      for (const item of entries) hashStat(path.join(subDir, item), hash, `${sub}/${item}`);
    } catch { hash.update(`${sub}:missing;`); }
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
  const installed = readJsonBestEffort(installedFile);
  const state = readJsonBestEffort(path.join(dataDir, 'state.json'));
  const migrationState = readJsonBestEffort(path.join(root, 'migration-state.json'));
  const hasData = fs.existsSync(dataDir) && DATA_PROBES.some((name) => fs.existsSync(path.join(dataDir, name)));
  const needsDataMerge = migrationState?.stage === 'deferred_data_merge'
    || migrationState?.stage === DEFERRED_MERGE_IN_PROGRESS
    || (migrationState?.dataMergeSkipped === 'external-running' && migrationState?.stage !== 'completed');
  const needsMigration = needsDataMerge
    || ((hasData || Boolean(installed)) && !installed?.migratedToMagpieAt && migrationState?.stage !== 'completed');
  return { root, dataDir, installedFile, installed, state, migrationState, hasData, needsDataMerge, needsMigration };
}

/** @param {string} legacyRoot */
function readMigrationState(legacyRoot) { return readJsonBestEffort(path.join(legacyRoot, 'migration-state.json')); }

/**
 * Rewrite absolute `home` paths inside `logins.json` and `migrations.json`
 * from `<legacyDataDir>/{grok,devin,kiro}/...` to `<targetConfigDir>/...`.
 * @param {string} rawPath
 * @param {string} legacyDataDir
 * @param {string} targetConfigDir
 * @returns {string}
 */
function rewriteAccountHomePath(rawPath, legacyDataDir, targetConfigDir) {
  if (typeof rawPath !== 'string' || !rawPath) return rawPath;
  const normInput = rawPath.replace(/\\/g, '/');
  const matchInput = process.platform === 'win32' ? normInput.toLowerCase() : normInput;
  for (const base of [path.resolve(legacyDataDir), tryRealpath(legacyDataDir)]) {
    const normSource = base.replace(/\\/g, '/').replace(/\/+$/, '');
    const matchSource = process.platform === 'win32' ? normSource.toLowerCase() : normSource;
    if (matchInput === matchSource || matchInput.startsWith(`${matchSource}/`)) {
      const rel = normInput.slice(normSource.length).replace(/^\/+/, '');
      return path.join(targetConfigDir, ...rel.split('/'));
    }
  }
  return rawPath;
}

/**
 * Recursively rewrite `home` fields in parsed JSON objects (`logins.json` / `migrations.json`).
 * @param {any} node @param {string} legacyDataDir @param {string} targetConfigDir @returns {any}
 */
function rewriteHomeFields(node, legacyDataDir, targetConfigDir) {
  if (Array.isArray(node)) return node.map((item) => rewriteHomeFields(item, legacyDataDir, targetConfigDir));
  if (!node || typeof node !== 'object') return node;
  /** @type {Record<string, any>} */
  const out = {};
  for (const [k, v] of Object.entries(node)) {
    out[k] = (k === 'home' && typeof v === 'string')
      ? rewriteAccountHomePath(v, legacyDataDir, targetConfigDir)
      : rewriteHomeFields(v, legacyDataDir, targetConfigDir);
  }
  return out;
}

/**
 * @param {string} srcDir
 * @param {string} destDir
 * @param {{ skipNodeModules?: boolean, legacyDataDir?: string, targetConfigDir?: string, onlyMissing?: boolean }} [options]
 */
function copyDirectoryFiltered(srcDir, destDir, options = {}) {
  if (!fs.existsSync(srcDir)) return;
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    if (shouldSkipEntry(entry, srcDir, options.legacyDataDir || '', Boolean(options.skipNodeModules))) continue;
    const from = path.join(srcDir, entry.name);
    const to = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyDirectoryFiltered(from, to, { ...options, skipNodeModules: entry.name === 'plugins' || options.skipNodeModules });
    } else if (entry.isFile()) {
      if (options.onlyMissing && fs.existsSync(to)) continue;
      const mode = isSensitiveTarget(to) ? 0o600 : undefined;
      if ((entry.name === 'logins.json' || entry.name === 'migrations.json') && options.legacyDataDir && options.targetConfigDir) {
        const parsed = readJsonOrNull(from);
        if (parsed !== null) {
          atomicWriteFileSync(to, `${JSON.stringify(rewriteHomeFields(parsed, options.legacyDataDir, options.targetConfigDir), null, 2)}\n`, { mode: mode ?? 0o600 });
          continue;
        }
      }
      atomicWriteFileSync(to, fs.readFileSync(from), mode ? { mode } : undefined);
    }
  }
}

/** @param {Record<string, any>} base @param {Record<string, any>} src @param {string} mapKey @param {string} orderKey */
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
 * @param {any} target @param {any} source
 */
function mergeProvidersJson(target, source) {
  const base = target && typeof target === 'object' ? structuredClone(target) : {};
  const src = source && typeof source === 'object' ? source : {};
  for (const [mapKey, orderKey] of [['providers', 'order'], ['groups', 'groupOrder'], ['searchers', 'searchOrder']]) {
    mergeProviderCollection(base, src, mapKey, orderKey);
  }
  if (Array.isArray(src.pluginLeft)) {
    base.pluginLeft = mergeArrayUnique(
      Array.isArray(base.pluginLeft) ? base.pluginLeft : [],
      src.pluginLeft,
      (/** @type {any} */ item) => `${item?.package || ''}:${item?.id || ''}`,
    );
  }
  return base;
}

/** @param {any} entry */
function accountFreshness(entry) {
  let best = 0;
  for (const raw of [entry?.renewed, entry?.seen, entry?.updatedAt, entry?.updated_at, entry?.expires]) {
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      best = Math.max(best, raw >= 1e9 && raw < 1e12 ? raw * 1000 : raw);
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
  const user = String(
    entry?.user || entry?.email || entry?.account || entry?.accountId || entry?.id || entry?.home || '',
  ).trim().toLowerCase();
  return `${agent}::${user}`;
}

/** @param {any[]} baseList @param {any[]} srcList */
function mergeLoginArray(baseList, srcList) {
  const indexByKey = new Map();
  baseList.forEach((item, idx) => indexByKey.set(loginAccountKey(item), idx));
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
 * Merge `logins.json` or `plugin-auth.json`: keep whichever entry has the newer timestamp.
 * @param {any} target @param {any} source @param {string} legacyDataDir @param {string} targetConfigDir
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

/** @param {any[]} baseArr @param {any[]} srcArr @param {(item: any) => string} keyFn */
function mergeArrayUnique(baseArr, srcArr, keyFn) {
  const seen = new Set(baseArr.map(keyFn));
  const out = structuredClone(baseArr);
  for (const item of srcArr) {
    const key = keyFn(item);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(structuredClone(item));
    }
  }
  return out;
}

/** @param {any} item */
function pluginEntryKey(item) {
  return item?.spec || item?.package || item?.name || JSON.stringify(item);
}

/** Recursively merge plain maps without overwriting existing target values.
 * @param {Record<string, any>} targetObj @param {Record<string, any>} srcObj */
function mergeMapTargetWins(targetObj, srcObj) {
  const out = structuredClone(targetObj);
  for (const [k, v] of Object.entries(srcObj)) {
    if (!Object.hasOwn(out, k)) out[k] = structuredClone(v);
    else if (isPlainObject(out[k]) && isPlainObject(v)) out[k] = mergeMapTargetWins(out[k], v);
  }
  return out;
}

/** @param {Record<string, any>} target @param {Record<string, any>} source */
function mergePluginListObject(target, source) {
  const out = structuredClone(target);
  if (Array.isArray(target.plugins) || Array.isArray(source.plugins)) {
    out.plugins = mergeArrayUnique(
      Array.isArray(target.plugins) ? target.plugins : [],
      Array.isArray(source.plugins) ? source.plugins : [],
      pluginEntryKey,
    );
  }
  for (const mapField of ['config', 'prefer']) {
    if (isPlainObject(target[mapField]) || isPlainObject(source[mapField])) {
      out[mapField] = mergeMapTargetWins(
        isPlainObject(target[mapField]) ? target[mapField] : {},
        isPlainObject(source[mapField]) ? source[mapField] : {},
      );
    }
  }
  for (const [k, v] of Object.entries(source)) {
    if (!Object.hasOwn(out, k)) out[k] = structuredClone(v);
  }
  return out;
}

/**
 * Merge `plugins.json` supporting real `{ plugins, config, prefer }` structure as well as legacy shapes.
 * @param {any} target @param {any} source
 */
function mergePluginsJson(target, source) {
  if (Array.isArray(target) && Array.isArray(source)) return mergeArrayUnique(target, source, pluginEntryKey);
  if (!isPlainObject(target)) return source !== undefined && source !== null ? structuredClone(source) : target;
  if (!isPlainObject(source)) return structuredClone(target);
  const hasListShape = ['plugins', 'config', 'prefer'].some((k) => target[k] !== undefined || source[k] !== undefined);
  return hasListShape ? mergePluginListObject(target, source) : mergeMapTargetWins(target, source);
}

/**
 * Merge `migrations.json` (`map[string]Migration` or legacy array).
 * @param {any} target @param {any} source
 */
function mergeMigrationsJson(target, source) {
  if (Array.isArray(target) && Array.isArray(source)) {
    return mergeArrayUnique(target, source, (item) => item?.id || item?.package || JSON.stringify(item));
  }
  if (isPlainObject(target) && isPlainObject(source)) return mergeMapTargetWins(target, source);
  return target !== null && target !== undefined ? structuredClone(target) : structuredClone(source);
}

/** @param {Record<string, any> | null | undefined} row */
function usageFingerprint(row) {
  const r = row || {};
  return JSON.stringify([
    r.t ?? r.ts ?? '', r.operation || '', r.agent || '', r.req || '',
    r.model || '', r.provider || '', r.providerAccount || '',
    r.in || 0, r.out || 0, r.cache_read || 0, r.cache_write || 0,
    r.route_id ?? r.request_id ?? r.rid ?? '', r.id ?? '',
  ]);
}

/** @param {Record<string, any>} row */
function usageTimeKey(row) {
  const raw = row?.t ?? row?.ts;
  if (typeof raw === 'number' && Number.isFinite(raw)) return { ms: raw, rawT: String(raw) };
  const rawT = String(raw || '');
  return { ms: rawT ? Date.parse(rawT) : NaN, rawT };
}

/**
 * Deduplicate and time-sort `usage.jsonl` across target and source.
 * @param {string} targetText @param {string} sourceText
 */
function mergeUsageJsonl(targetText, sourceText) {
  const entries = [];
  const seen = new Set();
  for (const raw of `${targetText}\n${sourceText}`.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    let parsed;
    try { parsed = JSON.parse(line); } catch { continue; }
    const key = usageFingerprint(parsed);
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({ ...usageTimeKey(parsed), line: JSON.stringify(parsed) });
  }
  entries.sort((a, b) => (Number.isFinite(a.ms) && Number.isFinite(b.ms) && a.ms !== b.ms
    ? a.ms - b.ms
    : a.rawT.localeCompare(b.rawT)));
  return entries.length ? `${entries.map((e) => e.line).join('\n')}\n` : '';
}

/** @param {{ legacyDataDir: string, targetConfigDir: string, externalRunning?: boolean }} options */
function migrateDataDirectory({ legacyDataDir, targetConfigDir, externalRunning = false }) {
  if (!fs.existsSync(legacyDataDir)) return { mode: 'empty', dataMergeSkipped: '', notice: '' };
  const targetExists = fs.existsSync(targetConfigDir);
  if (!targetExists || fs.readdirSync(targetConfigDir).length === 0) {
    const parent = path.dirname(targetConfigDir);
    fs.mkdirSync(parent, { recursive: true });
    const staging = path.join(parent, `.magpie-migrate-${process.pid}-${Date.now()}`);
    try {
      copyDirectoryFiltered(legacyDataDir, staging, { skipNodeModules: true, legacyDataDir, targetConfigDir });
      if (!targetExists) renameWithRetrySync(staging, targetConfigDir);
      else for (const name of fs.readdirSync(staging)) renameWithRetrySync(path.join(staging, name), path.join(targetConfigDir, name));
    } finally { safeRemoveSync(staging); }
    return { mode: 'cold', dataMergeSkipped: '', notice: '' };
  }
  if (externalRunning) {
    return {
      mode: 'skipped-external-running', dataMergeSkipped: 'external-running',
      notice: '检测到本机已有 Magpie 正在运行，已跳过自动配置合并以防覆盖运行态文件；旧鲸桥数据已原样保留。',
    };
  }
  mergeIntoExistingConfigDir(legacyDataDir, targetConfigDir);
  return { mode: 'merged', dataMergeSkipped: '', notice: '' };
}

/** @param {string} legacyDataDir @param {string} targetConfigDir @param {string} name @param {(t: any, s: any) => any} mergeFn */
function mergeJsonFile(legacyDataDir, targetConfigDir, name, mergeFn) {
  const src = readJsonOrNull(path.join(legacyDataDir, name));
  if (src === null) return;
  const dst = path.join(targetConfigDir, name);
  atomicWriteFileSync(dst, `${JSON.stringify(mergeFn(readJsonOrNull(dst), src), null, 2)}\n`);
}

/** @param {string} legacyDataDir @param {string} targetConfigDir */
function mergeIntoExistingConfigDir(legacyDataDir, targetConfigDir) {
  mergeJsonFile(legacyDataDir, targetConfigDir, 'providers.json', mergeProvidersJson);
  for (const loginFile of ['logins.json', 'plugin-auth.json']) {
    const src = readJsonOrNull(path.join(legacyDataDir, loginFile));
    if (src) {
      const merged = mergeLoginsJson(readJsonOrNull(path.join(targetConfigDir, loginFile)), src, legacyDataDir, targetConfigDir);
      atomicWriteFileSync(path.join(targetConfigDir, loginFile), `${JSON.stringify(merged, null, 2)}\n`, { mode: 0o600 });
    }
  }
  mergeJsonFile(legacyDataDir, targetConfigDir, 'plugins.json', mergePluginsJson);
  mergeJsonFile(legacyDataDir, targetConfigDir, 'migrations.json', (dstVal, srcVal) =>
    mergeMigrationsJson(dstVal, rewriteHomeFields(srcVal, legacyDataDir, targetConfigDir)));
  const srcUsage = readTextOrEmpty(path.join(legacyDataDir, 'usage.jsonl'));
  if (srcUsage) {
    const merged = mergeUsageJsonl(readTextOrEmpty(path.join(targetConfigDir, 'usage.jsonl')), srcUsage);
    if (merged) atomicWriteFileSync(path.join(targetConfigDir, 'usage.jsonl'), merged);
  }
  for (const entry of fs.readdirSync(legacyDataDir, { withFileTypes: true })) {
    if (shouldSkipEntry(entry, legacyDataDir, legacyDataDir, true)) continue;
    const src = path.join(legacyDataDir, entry.name);
    const dst = path.join(targetConfigDir, entry.name);
    if (entry.isDirectory()) {
      copyDirectoryFiltered(src, dst, { skipNodeModules: entry.name === 'plugins', legacyDataDir, targetConfigDir, onlyMissing: true });
    } else if (entry.isFile() && !SPECIAL_JSON_FILES.has(entry.name) && (!KEEP_EXISTING_TARGET_FILES.has(entry.name) || !fs.existsSync(dst)) && !fs.existsSync(dst)) {
      const mode = isSensitiveTarget(dst) ? 0o600 : undefined;
      atomicWriteFileSync(dst, fs.readFileSync(src), mode ? { mode } : undefined);
    }
  }
}

/**
 * Disconnect legacy WhaleBridge using its own binary if available, else clean DSH channel directly.
 * @param {{ legacyRoot: string, legacyInstalled: any, legacyDataDir: string, dshHome: string, runTool?: Function }} options
 * @returns {Promise<{ ranBinary: boolean }>}
 */
async function disconnectLegacyBridge({ legacyRoot, legacyInstalled, legacyDataDir, dshHome, runTool }) {
  const version = legacyInstalled?.version;
  const entryName = typeof legacyInstalled?.entry === 'string' && legacyInstalled.entry.trim()
    ? path.basename(legacyInstalled.entry.trim())
    : (process.platform === 'win32' ? 'WhaleBridge-win32-x64.exe' : 'whalebridge');
  const exe = version ? path.join(legacyRoot, 'versions', version, entryName) : '';
  let ranBinary = false;
  if (exe && fs.existsSync(exe) && typeof runTool === 'function') {
    /** @type {Record<string, string | undefined>} */
    const env = { ...process.env, LAUNCHER_COMPONENT_ID: 'whalebridge', LAUNCHER_COMPONENT_DATA_DIR: legacyDataDir, WHALEBRIDGE_DSH_HOME: dshHome };
    delete env.ELECTRON_RUN_AS_NODE;
    await runTool(exe, ['whalebridge-disconnect'], { env, windowsHide: true, timeout: 15_000 });
    ranBinary = true;
  }
  detachWhaleBridgeDshChannel(dshHome);
  return { ranBinary };
}

/** @param {any} agentsSnapshot */
function extractExternalAgents(agentsSnapshot) {
  if (Array.isArray(agentsSnapshot)) return agentsSnapshot;
  if (Array.isArray(agentsSnapshot?.agents)) return agentsSnapshot.agents;
  return isPlainObject(agentsSnapshot) ? Object.keys(agentsSnapshot) : [];
}

/** @param {any} existing */
function restorePriorMigrationBackup(existing) {
  if (!existing || !['backed_up', 'data_migrated', 'agents_disconnected'].includes(existing.stage)) return;
  if (typeof existing.backupDir !== 'string' || !existing.backupDir) return;
  const manifest = readJsonBestEffort(path.join(existing.backupDir, 'manifest.json'));
  const recorded = Array.isArray(manifest) ? manifest : manifest?.recorded;
  const createdPaths = Array.isArray(manifest?.createdPaths) ? manifest.createdPaths : [];
  if (!Array.isArray(recorded)) return;

  const skipTargetConfig = existing.dataMode === 'skipped-external-running' || existing.dataMergeSkipped === 'external-running';
  const items = skipTargetConfig ? recorded.filter((item) => item.kind === 'dsh') : recorded;
  if (items.some((item) => item.existed && (!item.dst || !fs.existsSync(item.dst)))) {
    console.warn(`Magpie 迁移恢复跳过残缺备份目录：${existing.backupDir}`);
    return;
  }
  restoreSnapshot({ recorded: items, createdPaths: skipTargetConfig ? [] : createdPaths });
}

/** @param {string} stateFile @param {string} fingerprint @param {string} backupDir */
function createStageWriter(stateFile, fingerprint, backupDir) {
  return (/** @type {string} */ stage, extra = {}) => {
    atomicWriteFileSync(stateFile, `${JSON.stringify({ stage, fingerprint, backupDir, updatedAt: new Date().toISOString(), ...extra }, null, 2)}\n`);
  };
}

/** @param {any} legacy */
function markInstalledMigrated(legacy) {
  if (legacy.installed && fs.existsSync(legacy.installedFile)) {
    atomicWriteFileSync(legacy.installedFile, `${JSON.stringify({ ...legacy.installed, migratedToMagpieAt: new Date().toISOString() }, null, 2)}\n`);
  }
}

/** @param {any} legacy @param {any} existing @param {string} targetConfigDir @param {string} stateFile @param {Record<string, any>} fields */
function beginDeferredDataMerge(legacy, existing, targetConfigDir, stateFile, fields) {
  const target = path.resolve(targetConfigDir);
  if (existing.stage === DEFERRED_MERGE_IN_PROGRESS) {
    const { backupDir, targetConfigDir: originalTarget } = existing;
    if (typeof originalTarget !== 'string' || path.relative(originalTarget, target)) {
      throw new Error(`Magpie 配置目录已变更。请恢复原配置目录后重试：${originalTarget}`);
    }
    if (typeof backupDir !== 'string' || !isPathInside(tryRealpath(legacy.root), tryRealpath(backupDir))) {
      throw new Error('Magpie 延迟迁移的备份目录无效');
    }
    const snapshot = readJsonOrNull(path.join(backupDir, 'manifest.json'));
    if (!Array.isArray(snapshot?.recorded) || !Array.isArray(snapshot.createdPaths)) {
      throw new Error(`Magpie 延迟迁移缺少可恢复的备份清单：${backupDir}`);
    }
    restoreSnapshot(snapshot);
    return { backupDir, snapshot };
  }
  const backupDir = fs.mkdtempSync(path.join(legacy.root, 'migration-backup-'));
  try {
    const snapshot = snapshotTargets(backupDir, {
      targetConfigDir: target, legacyDataDir: legacy.dataDir, legacyInstalledFile: legacy.installedFile,
    });
    createStageWriter(stateFile, fingerprintLegacyData(legacy.dataDir, legacy.installedFile), backupDir)(
      DEFERRED_MERGE_IN_PROGRESS, { ...fields, targetConfigDir: target },
    );
    return { backupDir, snapshot };
  } catch (error) {
    safeRemoveSync(backupDir);
    throw error;
  }
}

/** Complete deferred Scenario B data merge once external Magpie is no longer running.
 * @param {any} legacy @param {any} existing @param {any} options @param {string} stateFile */
function completeDeferredDataMerge(legacy, existing, options, stateFile) {
  const baseFields = {
    previousDefault: existing.previousDefault ?? null,
    externalAgents: existing.externalAgents || [],
    externalAgentsNeedCheck: Boolean(existing.externalAgentsNeedCheck),
  };
  if (options.externalRunning) {
    return {
      migrated: false, reason: 'deferred-external-running',
      dataMode: existing.dataMode || 'skipped-external-running',
      dataMergeSkipped: existing.dataMergeSkipped || 'external-running',
      notice: existing.notice || '检测到本机已有 Magpie 正在运行，已跳过自动配置合并以防覆盖运行态文件；旧鲸桥数据已原样保留。',
      ...baseFields,
    };
  }
  const fields = {
    ...baseFields, agentsDisconnected: true,
    dataMode: existing.dataMode, dataMergeSkipped: existing.dataMergeSkipped, notice: existing.notice,
  };
  const { backupDir, snapshot } = beginDeferredDataMerge(legacy, existing, options.targetConfigDir, stateFile, fields);
  try {
    const dataResult = migrateDataDirectory({ legacyDataDir: legacy.dataDir, targetConfigDir: options.targetConfigDir, externalRunning: false });
    markInstalledMigrated(legacy);
    const result = {
      migrated: true, dataMode: dataResult.mode, dataMergeSkipped: dataResult.dataMergeSkipped,
      notice: baseFields.externalAgentsNeedCheck ? existing.notice : '', ...baseFields, agentsDisconnected: true, backupDir,
    };
    createStageWriter(stateFile, fingerprintLegacyData(legacy.dataDir, legacy.installedFile), backupDir)('completed', result);
    safeRemoveSync(backupDir);
    if (existing.backupDir && existing.backupDir !== backupDir && isPathInside(tryRealpath(legacy.root), tryRealpath(existing.backupDir))) {
      safeRemoveSync(existing.backupDir);
    }
    return result;
  } catch (error) {
    try {
      restoreSnapshot(snapshot);
      createStageWriter(stateFile, fingerprintLegacyData(legacy.dataDir, legacy.installedFile), '')('deferred_data_merge', fields);
    } catch (restoreError) {
      throw new AggregateError([error, restoreError], `Magpie 延迟迁移未能回滚，已保留备份：${backupDir}`);
    }
    safeRemoveSync(backupDir);
    throw error;
  }
}

/**
 * End-to-end idempotent, rollback-safe migration from legacy WhaleBridge to official Magpie.
 * @param {{ desktopStateDir: string, dshHome: string, targetConfigDir: string, externalRunning?: boolean, stopLegacyBridge?: (legacy: any) => Promise<void>, runTool?: Function }} options
 */
async function migrateWhaleBridgeToMagpie(options) {
  const legacy = detectLegacyWhaleBridge(options.desktopStateDir);
  if (!legacy.needsMigration) return { migrated: false, reason: 'nothing-to-migrate' };
  const stateFile = path.join(legacy.root, 'migration-state.json');
  const existing = readJsonBestEffort(stateFile);
  if (existing?.stage === 'deferred_data_merge' || existing?.stage === DEFERRED_MERGE_IN_PROGRESS
      || (existing?.stage === 'agents_disconnected' && existing?.dataMergeSkipped === 'external-running')) {
    return completeDeferredDataMerge(legacy, existing, options, stateFile);
  }
  restorePriorMigrationBackup(existing);

  const backupDir = path.join(legacy.root, `migration-backup-${Date.now()}`);
  const writeStage = createStageWriter(stateFile, fingerprintLegacyData(legacy.dataDir, legacy.installedFile), backupDir);
  if (typeof options.stopLegacyBridge === 'function') await options.stopLegacyBridge(legacy);

  const snapshot = snapshotTargets(backupDir, { dshHome: options.dshHome, targetConfigDir: options.targetConfigDir, legacyDataDir: legacy.dataDir });
  const previousDefault = readDshDefaultModel(options.dshHome);
  const agentsSnapshot = readJsonBestEffort(path.join(legacy.dataDir, 'agents.json'));
  const externalAgents = extractExternalAgents(agentsSnapshot);
  writeStage('backed_up', { previousDefault, externalAgents: agentsSnapshot || null });

  let skipTargetRestore = false;
  try {
    const dataResult = migrateDataDirectory({ legacyDataDir: legacy.dataDir, targetConfigDir: options.targetConfigDir, externalRunning: options.externalRunning });
    skipTargetRestore = dataResult.mode === 'skipped-external-running';
    writeStage('data_migrated', { dataMode: dataResult.mode, dataMergeSkipped: dataResult.dataMergeSkipped });

    const disconnectRes = await disconnectLegacyBridge({ legacyRoot: legacy.root, legacyInstalled: legacy.installed, legacyDataDir: legacy.dataDir, dshHome: options.dshHome, runTool: options.runTool });
    const externalAgentsNeedCheck = !disconnectRes.ranBinary && externalAgents.length > 0;
    const notices = [dataResult.notice];
    if (externalAgentsNeedCheck) notices.push('旧版鲸桥二进制缺失，未能自动断开外部 CLI Agent；请在 Magpie 中检查并重新接管外部 Agent 配置。');
    const sharedFields = {
      dataMode: dataResult.mode, dataMergeSkipped: dataResult.dataMergeSkipped, agentsDisconnected: true,
      notice: notices.filter(Boolean).join(' '), previousDefault, externalAgents, externalAgentsNeedCheck,
    };
    writeStage('agents_disconnected', sharedFields);

    if (dataResult.dataMergeSkipped) {
      writeStage('deferred_data_merge', sharedFields);
      safeRemoveSync(backupDir);
      return { migrated: true, deferred: true, ...sharedFields, backupDir };
    }
    markInstalledMigrated(legacy);
    const result = { migrated: true, ...sharedFields, backupDir };
    createStageWriter(stateFile, fingerprintLegacyData(legacy.dataDir, legacy.installedFile), backupDir)('completed', result);
    safeRemoveSync(backupDir);
    return result;
  } catch (error) {
    restoreSnapshot(skipTargetRestore ? { recorded: snapshot.recorded.filter((item) => item.kind === 'dsh'), createdPaths: [] } : snapshot);
    writeStage('rolled_back', { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

/** @param {string} dataDir */
function hasNonTempUserData(dataDir) {
  if (!fs.existsSync(dataDir)) return false;
  return fs.readdirSync(dataDir, { withFileTypes: true }).some(
    (entry) => entry.isSymbolicLink() || (!EXCLUDED_TOP_ENTRIES.has(entry.name) && !entry.name.endsWith('.lock')),
  );
}

/** @param {string} root @param {string} resolvedDesktop @param {string} componentsDir */
function validateReconcileRoot(root, resolvedDesktop, componentsDir) {
  if (!fs.existsSync(root)) return { action: 'noop', reason: 'absent' };
  const rootLstat = fs.lstatSync(root);
  if (rootLstat.isSymbolicLink() || !rootLstat.isDirectory()) return { action: 'kept', reason: 'symlink-or-non-dir' };
  const realRoot = fs.realpathSync(root);
  if (!isPathInside(fs.realpathSync(resolvedDesktop), realRoot)) return { action: 'kept', reason: 'realpath-outside-state-dir' };
  if (fs.existsSync(componentsDir) && !isPathInside(fs.realpathSync(componentsDir), realRoot)) {
    return { action: 'kept', reason: 'realpath-outside-components' };
  }
  const topEntries = fs.readdirSync(root, { withFileTypes: true });
  if (topEntries.some((entry) => entry.isSymbolicLink())) return { action: 'kept', reason: 'contains-symlink' };
  return { topEntries };
}

/** @param {string} root @param {string} componentsDir @param {fs.Dirent[]} topEntries */
function archiveCompletedLegacyDir(root, componentsDir, topEntries) {
  for (const entry of topEntries) {
    if (entry.name === 'versions' || entry.name === 'catalog.json' || entry.name === 'logs' || entry.name.startsWith('migration-backup-')) {
      safeRemoveSync(path.join(root, entry.name));
    }
  }
  const archiveDir = path.join(componentsDir, `.archived-whalebridge-${Date.now()}`);
  fs.mkdirSync(archiveDir, { recursive: true });
  for (const name of ['data', 'installed.json', 'migration-state.json']) {
    const src = path.join(root, name);
    if (fs.existsSync(src)) renameWithRetrySync(src, path.join(archiveDir, name));
  }
  try { if (fs.readdirSync(root).length === 0) fs.rmdirSync(root); } catch { /* leave non-empty root */ }
  return { action: 'archived', reason: 'completed-migration-archived', archiveDir };
}

/** @param {string} root @param {string} componentsDir @param {fs.Dirent[]} topEntries */
function evaluateLegacyDirReconcile(root, componentsDir, topEntries) {
  const migrationState = readJsonBestEffort(path.join(root, 'migration-state.json'));
  if (migrationState && BLOCKED_RECONCILE_STAGES.has(migrationState.stage)) {
    return { action: 'kept', reason: `blocked-stage:${migrationState.stage}` };
  }
  const dataDir = path.join(root, 'data');
  const installedFile = path.join(root, 'installed.json');
  const installed = readJsonBestEffort(installedFile);
  if (topEntries.every((e) => CACHE_ONLY_TOP_ENTRIES.has(e.name)) && !hasNonTempUserData(dataDir)) {
    safeRemoveSync(root);
    return { action: 'cleaned-cache', reason: 'cache-only' };
  }
  if (migrationState?.stage !== 'completed' || migrationState?.dataMergeSkipped) {
    return { action: 'kept', reason: 'unmigrated-or-active' };
  }
  if (installed && !installed.migratedToMagpieAt) return { action: 'kept', reason: 'installed-not-marked' };
  const currentFp = fingerprintLegacyData(dataDir, installedFile);
  if (typeof migrationState.fingerprint !== 'string' || migrationState.fingerprint !== currentFp) {
    return { action: 'kept', reason: 'fingerprint-drifted' };
  }
  return archiveCompletedLegacyDir(root, componentsDir, topEntries);
}

/**
 * Safely clean up cache-only legacy WhaleBridge dir or archive completed/un-drifted migrations.
 * Never throws fatal errors; returns `{ action, reason, archiveDir? }`.
 * @param {{ legacyRoot?: string, desktopStateDir?: string }} [options]
 * @returns {Promise<{ action: string, reason: string, archiveDir?: string }>}
 */
async function reconcileLegacyWhaleBridgeDir(options = {}) {
  try {
    const { legacyRoot, desktopStateDir } = options || {};
    if (!legacyRoot && !desktopStateDir) return { action: 'noop', reason: 'missing-paths' };
    const resolvedDesktop = desktopStateDir ? path.resolve(desktopStateDir) : path.dirname(path.dirname(path.resolve(/** @type {string} */ (legacyRoot))));
    const root = legacyRoot ? path.resolve(legacyRoot) : path.join(resolvedDesktop, 'components', 'whalebridge');
    const componentsDir = path.join(resolvedDesktop, 'components');
    const gate = validateReconcileRoot(root, resolvedDesktop, componentsDir);
    if (!gate.topEntries) return /** @type {{ action: string, reason: string }} */ (gate);
    return evaluateLegacyDirReconcile(root, componentsDir, gate.topEntries);
  } catch (error) {
    return { action: 'error', reason: error instanceof Error ? error.message : String(error) };
  }
}

module.exports = {
  detectLegacyWhaleBridge, fingerprintLegacyData, readMigrationState, rewriteAccountHomePath,
  mergeProvidersJson, mergeLoginsJson, mergePluginsJson, mergeMigrationsJson, mergeUsageJsonl,
  migrateWhaleBridgeToMagpie, reconcileLegacyWhaleBridgeDir,
};
