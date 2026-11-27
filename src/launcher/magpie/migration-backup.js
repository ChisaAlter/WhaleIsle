'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { atomicWriteFileSync, safeRemoveSync } = require('../../shared/fs-safe');

const EXCLUDED_TOP_ENTRIES = new Set([
  'gateway.key', 'agents.json', 'state.json', 'component.log',
  'cache', 'applied.json', 'stash.json', 'aside-account.json', 'cursor-local.env',
]);
const SENSITIVE_FILES = new Set([
  'logins.json', 'plugin-auth.json', 'sync.json', 'redact.key',
  'qoder.json', 'stepfun-auth.json', 'kiro-auth-token.json', 'usage-computer.json',
]);

const ACCOUNT_SUBDIRS = ['claude-accounts', 'grok', 'devin', 'kiro', 'grok-homes'];

/** @param {string} filePath */
function isSensitiveTarget(filePath) {
  const base = path.basename(filePath);
  return SENSITIVE_FILES.has(base) || base === '.credentials.yaml'
    || filePath.replace(/\\/g, '/').split('/').some((p) => ACCOUNT_SUBDIRS.includes(p));
}

/** @param {fs.Dirent} entry @param {string} srcDir @param {string} legacyDataDir @param {boolean} skipNodeModules */
function shouldSkipEntry(entry, srcDir, legacyDataDir, skipNodeModules) {
  if (entry.isSymbolicLink()) return true;
  if (srcDir === legacyDataDir && (entry.name.endsWith('.lock') || EXCLUDED_TOP_ENTRIES.has(entry.name))) return true;
  return Boolean(skipNodeModules && entry.name === 'node_modules');
}

/** @param {string} dir @param {string} prefix @param {Array<{ src: string, dst: string }>} out */
function collectExistingFiles(dir, prefix, out) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const src = path.join(dir, entry.name);
    const dst = path.join(prefix, entry.name);
    if (entry.isDirectory()) collectExistingFiles(src, dst, out);
    else if (entry.isFile()) out.push({ src, dst });
  }
}

/** @param {string} srcDir @param {string} dstDir @param {string} legacyDataDir @param {boolean} skipNodeModules @param {string[]} createdPaths */
function collectCreatedPaths(srcDir, dstDir, legacyDataDir, skipNodeModules, createdPaths) {
  if (!fs.existsSync(srcDir)) return;
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    if (shouldSkipEntry(entry, srcDir, legacyDataDir, skipNodeModules)) continue;
    const src = path.join(srcDir, entry.name);
    const dst = path.join(dstDir, entry.name);
    if (!fs.existsSync(dst)) createdPaths.push(dst);
    else if (entry.isDirectory()) collectCreatedPaths(src, dst, legacyDataDir, entry.name === 'plugins' || skipNodeModules, createdPaths);
  }
}

/** @param {string} backupDir @param {{ dshHome?: string, targetConfigDir: string, legacyDataDir?: string, legacyInstalledFile?: string }} options */
function snapshotTargets(backupDir, { dshHome, targetConfigDir, legacyDataDir, legacyInstalledFile }) {
  fs.mkdirSync(backupDir, { recursive: true });
  const copies = dshHome ? [
    { src: path.join(dshHome, 'cordis.patch.yml'), dst: path.join(backupDir, 'dsh-home-cordis.patch.yml'), kind: 'dsh' },
    { src: path.join(dshHome, 'profiles', 'web', 'cordis.patch.yml'), dst: path.join(backupDir, 'dsh-web-cordis.patch.yml'), kind: 'dsh' },
    { src: path.join(dshHome, '.credentials.yaml'), dst: path.join(backupDir, 'dsh-credentials.yaml'), kind: 'dsh' },
  ] : [];
  if (legacyInstalledFile) {
    copies.push({ src: legacyInstalledFile, dst: path.join(backupDir, 'legacy-installed.json'), kind: 'legacy' });
  }
  /** @type {Array<{ src: string, dst: string }>} */
  const existingTargetFiles = [];
  collectExistingFiles(targetConfigDir, path.join(backupDir, 'magpie'), existingTargetFiles);
  for (const file of existingTargetFiles) copies.push({ ...file, kind: 'magpie' });
  const recorded = copies.map(({ src, dst, kind }) => {
    const existed = fs.existsSync(src);
    if (existed) { fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(src, dst); }
    return { src, dst, existed, kind };
  });
  /** @type {string[]} */
  const createdPaths = [];
  if (legacyDataDir && fs.existsSync(legacyDataDir)) {
    if (!fs.existsSync(targetConfigDir)) createdPaths.push(targetConfigDir);
    else collectCreatedPaths(legacyDataDir, targetConfigDir, legacyDataDir, true, createdPaths);
  }
  const manifest = { recorded, createdPaths };
  atomicWriteFileSync(path.join(backupDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

/** @param {{ recorded: Array<{ src: string, dst: string, existed: boolean }>, createdPaths?: string[] } | Array<{ src: string, dst: string, existed: boolean }>} snapshot */
function restoreSnapshot(snapshot) {
  const recorded = Array.isArray(snapshot) ? snapshot : (snapshot?.recorded || []);
  const createdPaths = Array.isArray(snapshot) ? [] : (snapshot?.createdPaths || []);
  const missing = recorded.find((item) => item.existed && (!item.dst || !fs.existsSync(item.dst)));
  if (missing) throw new Error(`Magpie 迁移回滚缺少备份文件：${missing.dst}`);
  for (const item of recorded) {
    if (!item.existed) continue;
    fs.mkdirSync(path.dirname(item.src), { recursive: true });
    try { if (fs.existsSync(item.src)) fs.chmodSync(item.src, 0o644); } catch { /* ignore */ }
    const mode = isSensitiveTarget(item.src) ? 0o600 : undefined;
    atomicWriteFileSync(item.src, fs.readFileSync(item.dst), mode ? { mode } : undefined);
  }
  for (const created of recorded.filter((item) => !item.existed).map((item) => item.src).concat(createdPaths)) {
    const result = safeRemoveSync(created);
    if (!result.ok) throw result.error;
  }
}

module.exports = { ACCOUNT_SUBDIRS, EXCLUDED_TOP_ENTRIES, isSensitiveTarget, shouldSkipEntry, snapshotTargets, restoreSnapshot };
