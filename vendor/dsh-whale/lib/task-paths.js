/**
 * Isolated task-root resolution and path-escape guard for Whale task cards
 * and whale_new_session. Mirrors the anchor policy in workspace-authority.js
 * and the realpath/symlink discipline in dsh-project/lib/files.js.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { whaleHomeDir } from './preset.js';

/** @param {string} value */
const identity = (value) => (process.platform === 'win32' ? value.toLowerCase() : value);

/**
 * @param {string} root
 * @param {string} target
 */
export function within(root, target) {
  const rel = path.relative(identity(root), identity(target));
  return rel === '' || (!path.isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${path.sep}`));
}

/** @param {string} dir */
function isFilesystemRoot(dir) {
  const resolved = path.resolve(dir);
  return path.parse(resolved).root === resolved;
}

/** @param {string} candidate */
function canonicalIfExists(candidate) {
  try {
    return fs.realpathSync.native(path.resolve(candidate));
  } catch {
    return '';
  }
}

/** @param {string} declared */
function canonicalPath(declared) {
  const missing = [];
  let cursor = declared;
  while (true) {
    try {
      const real = fs.realpathSync.native(cursor);
      return missing.length ? path.join(real, ...missing.reverse()) : real;
    } catch (/** @type {any} */ error) {
      if (error?.code !== 'ENOENT') throw error;
      const parent = path.dirname(cursor);
      if (parent === cursor) return declared;
      missing.push(path.basename(cursor));
      cursor = parent;
    }
  }
}

/** @param {string} userHome */
function systemDataAnchors(userHome) {
  const raw = [];
  if (userHome) {
    if (process.platform === 'darwin') {
      raw.push(path.join(userHome, 'Library'), path.join(userHome, 'Library', 'Application Support'));
    }
    raw.push(path.join(userHome, '.config'), path.join(userHome, '.ssh'));
  }
  for (const key of ['APPDATA', 'LOCALAPPDATA', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME']) {
    const value = process.env[key];
    if (typeof value === 'string' && value.trim()) raw.push(value);
  }
  return raw.flatMap((entry) => {
    const resolved = path.resolve(entry);
    const real = canonicalIfExists(resolved);
    return real && identity(real) !== identity(resolved) ? [resolved, real] : [resolved];
  });
}

/** @param {string} dshHome */
function dshHomeAnchors(dshHome) {
  if (!dshHome) return { inside: [], ancestorOnly: [] };
  const resolved = path.resolve(dshHome);
  const real = canonicalIfExists(resolved);
  const inside = [resolved, ...(real && identity(real) !== identity(resolved) ? [real] : [])];
  const whale = path.resolve(whaleHomeDir(dshHome));
  const whaleReal = canonicalIfExists(whale);
  inside.push(whale);
  if (whaleReal && identity(whaleReal) !== identity(whale)) inside.push(whaleReal);
  const ancestorOnly = [];
  // When running under Electron userData/dsh-home, also refuse userData itself
  // and its ancestors without blocking sibling test temp dirs.
  if (path.basename(resolved).toLowerCase() === 'dsh-home') {
    const userData = path.dirname(resolved);
    ancestorOnly.push(userData);
    const userDataReal = canonicalIfExists(userData);
    if (userDataReal) ancestorOnly.push(userDataReal);
  }
  return { inside, ancestorOnly };
}

/**
 * @param {string} candidate
 * @param {string} dshHome
 */
function checkForbidden(candidate, dshHome) {
  if (isFilesystemRoot(candidate)) return 'root';
  const rawHome = os.homedir();
  const homes = rawHome ? [path.resolve(rawHome), canonicalIfExists(rawHome)].filter(Boolean) : [];
  if (homes.some((anchor) => within(candidate, anchor))) return 'home';
  const sshDirs = homes.map((anchor) => path.join(anchor, '.ssh'));
  if (sshDirs.some((ssh) => within(ssh, candidate))) return 'system-data';
  const sys = systemDataAnchors(rawHome);
  if (sys.some((anchor) => within(candidate, anchor))) return 'system-data';
  const { inside, ancestorOnly } = dshHomeAnchors(dshHome);
  if (inside.some((anchor) => within(candidate, anchor) || within(anchor, candidate))) return 'dsh-home';
  if (ancestorOnly.some((anchor) => within(candidate, anchor))) return 'app-data';
  return '';
}

/** @type {Record<string, string>} */
const REFUSAL_MESSAGE = {
  empty: '任务工作目录不能为空。',
  invalid: '任务工作目录必须是有效的绝对路径。',
  symlink: '任务工作目录不能是符号链接或目录联接。',
  missing: '任务工作目录不存在。',
  'not-directory': '任务工作目录必须是一个文件夹。',
  root: '任务工作目录不能指向磁盘根目录。',
  home: '任务工作目录不能指向用户主目录或其上级目录。',
  'system-data': '任务工作目录不能指向系统配置或凭据目录。',
  'dsh-home': '任务工作目录不能指向 Harness 数据目录或鲸鱼娘家目录（data/whale）。',
  'app-data': '任务工作目录不能指向应用数据目录或其上级目录。',
};

/**
 * Return '' when `raw` is a safe task working directory, or a machine-readable
 * refusal reason otherwise.
 * @param {unknown} raw
 */
export function taskCwdRefusal(raw, { dshHome = process.env.DSH_HOME || '', requireExisting = false } = {}) {
  if (typeof raw !== 'string' || !raw.trim()) return 'empty';
  const trimmed = raw.trim();
  if (trimmed.includes('\0') || !path.isAbsolute(trimmed)) return 'invalid';
  const declared = path.resolve(trimmed);
  let real;
  try {
    const info = fs.lstatSync(declared);
    if (info.isSymbolicLink()) return 'symlink';
    if (!info.isDirectory()) return 'not-directory';
    real = fs.realpathSync.native(declared);
  } catch (/** @type {any} */ error) {
    if (error?.code !== 'ENOENT') return 'invalid';
    if (requireExisting) return 'missing';
    try {
      real = canonicalPath(declared);
    } catch {
      return 'invalid';
    }
  }
  return checkForbidden(declared, dshHome) || checkForbidden(real, dshHome);
}

/**
 * Validate a task working directory and return the accepted path or throw.
 * @param {unknown} raw
 * @param {{ dshHome?: string, requireExisting?: boolean }} [options]
 */
export function validateTaskCwd(raw, options = {}) {
  const refusal = taskCwdRefusal(raw, options);
  if (refusal) {
    throw new Error(REFUSAL_MESSAGE[refusal] || `任务工作目录不可用（${refusal}）。`);
  }
  const trimmed = String(raw).trim();
  const hasTraversal = /(?:^|[\\/])\.\.(?:$|[\\/])/u.test(trimmed);
  return hasTraversal ? path.resolve(trimmed) : trimmed;
}

/** Default user-visible isolated root for task cards, completely outside data/whale/. */
export function defaultTaskRootDir(dshHome = process.env.DSH_HOME || '') {
  const userHome = os.homedir();
  const candidate = userHome
    ? path.join(userHome, 'Documents', 'WhaleIsle-Tasks')
    : path.join(os.tmpdir(), 'WhaleIsle-Tasks');
  if (!taskCwdRefusal(candidate, { dshHome, requireExisting: false })) return candidate;
  return path.join(os.tmpdir(), 'WhaleIsle-Tasks');
}

/**
 * Effective task root: configured custom taskRootDir (if valid), else defaultTaskRootDir.
 * @param {any} settings
 */
export function resolvedTaskRootDir(settings, dshHome = process.env.DSH_HOME || '') {
  const configured = typeof settings?.taskRootDir === 'string' ? settings.taskRootDir.trim() : '';
  if (configured && !taskCwdRefusal(configured, { dshHome, requireExisting: false })) {
    return configured;
  }
  return defaultTaskRootDir(dshHome);
}

/**
 * Ensure a validated task directory exists without following a symlinked target.
 * @param {unknown} raw
 */
export function ensureSafeTaskDir(raw, { dshHome = process.env.DSH_HOME || '' } = {}) {
  const cwd = validateTaskCwd(raw, { dshHome, requireExisting: false });
  const resolved = path.resolve(cwd);
  if (!fs.existsSync(resolved)) {
    fs.mkdirSync(resolved, { recursive: true });
  }
  const after = taskCwdRefusal(resolved, { dshHome, requireExisting: true });
  if (after) {
    throw new Error(REFUSAL_MESSAGE[after] || `任务工作目录不可用（${after}）。`);
  }
  return cwd;
}
