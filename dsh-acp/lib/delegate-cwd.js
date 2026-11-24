/**
 * Target `cwd` resolution and path-escape guard for `acp_delegate`.
 * Enforces an explicit, validated target directory whenever the parent session
 * is `whale-girl`, preventing external coding agents from implicitly landing
 * inside `$DSH_HOME/data/whale/`.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** @param {string} value */
const identity = (value) => (process.platform === 'win32' ? value.toLowerCase() : value);

/** @param {string} root @param {string} target */
function within(root, target) {
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

const ELECTRON_USERDATA_MARKERS = [
  'chisacode-home',
  'Local Storage',
  'Session Storage',
  'IndexedDB',
  'Partitions',
  'Network',
  'Preferences',
  'Local State',
  'Cookies',
  'Code Cache',
  'GPUCache',
  'Crashpad',
  'blob_storage',
  'WebStorage',
];

function isSensitiveUserDataSubdir(userData, candidate) {
  const tmpDir = os.tmpdir() ? path.resolve(os.tmpdir()) : '';
  const userDataInTmp = tmpDir && within(tmpDir, userData) && identity(userData) !== identity(tmpDir);
  if (!userDataInTmp) return true;
  if (ELECTRON_USERDATA_MARKERS.some((marker) => fs.existsSync(path.join(userData, marker)))) return true;
  const rel = path.relative(identity(userData), identity(candidate));
  const firstSegment = rel.split(path.sep)[0];
  return ELECTRON_USERDATA_MARKERS.some((marker) => identity(marker) === firstSegment || marker === firstSegment);
}

/** @param {string} candidate @param {string} dshHome */
function checkForbidden(candidate, dshHome) {
  if (isFilesystemRoot(candidate)) return '目标目录不能指向磁盘根目录。';
  if (dshHome) {
    const resolvedHome = path.resolve(dshHome);
    const realHome = canonicalIfExists(resolvedHome);
    const whaleDir = path.join(resolvedHome, 'data', 'whale');
    const whaleReal = canonicalIfExists(whaleDir);
    const inside = [resolvedHome, realHome, whaleDir, whaleReal].filter(Boolean);
    if (inside.some((anchor) => within(candidate, anchor) || within(anchor, candidate))) {
      return '目标目录不能指向 Harness 数据目录或鲸鱼娘家目录（data/whale）。';
    }
    if (path.basename(resolvedHome).toLowerCase() === 'dsh-home') {
      const userData = path.dirname(resolvedHome);
      const userDataReal = canonicalIfExists(userData);
      const userDatas = [userData, userDataReal].filter(Boolean);
      if (userDatas.some((anchor) => within(candidate, anchor))) {
        return '目标目录不能指向应用数据目录或其上级目录。';
      }
      if (userDatas.some((anchor) => within(anchor, candidate) && isSensitiveUserDataSubdir(anchor, candidate))) {
        return '目标目录不能指向应用数据目录或其上级目录。';
      }
    }
  }
  const rawHome = os.homedir();
  const homes = rawHome ? [path.resolve(rawHome), canonicalIfExists(rawHome)].filter(Boolean) : [];
  if (homes.some((anchor) => within(candidate, anchor))) return '目标目录不能指向用户主目录或其上级目录。';
  if (homes.some((anchor) => within(path.join(anchor, '.ssh'), candidate))) return '目标目录不能指向系统配置或凭据目录。';
  const tmpDirs = os.tmpdir() ? [path.resolve(os.tmpdir()), canonicalIfExists(os.tmpdir())].filter(Boolean) : [];
  const strictlyInsideTmp = tmpDirs.some((tmpRoot) => within(tmpRoot, candidate) && identity(candidate) !== identity(tmpRoot));
  if (systemDataAnchors(rawHome).some((anchor) => {
    if (within(candidate, anchor)) return true;
    if (!within(anchor, candidate)) return false;
    // On Windows os.tmpdir() lives inside %LOCALAPPDATA%\Temp; allow temp workdirs strictly under os.tmpdir()
    // while still blocking %LOCALAPPDATA% itself, os.tmpdir() itself, and all non-temp %LOCALAPPDATA%\* paths.
    if (strictlyInsideTmp && tmpDirs.some((tmpRoot) => within(anchor, tmpRoot) && identity(anchor) !== identity(tmpRoot))) {
      return false;
    }
    return true;
  })) return '目标目录不能指向系统配置或凭据目录。';
  return '';
}

/** @param {any} parent @param {string} [dshHome] */
export function isWhaleGirlParent(parent, dshHome = process.env.DSH_HOME || '') {
  const header = parent?.session?.header ?? {};
  if (header.agentPreset === 'whale-girl') return true;
  if (dshHome && typeof header.cwd === 'string' && header.cwd.trim()) {
    const whaleDir = path.resolve(dshHome, 'data', 'whale');
    const whaleReal = canonicalIfExists(whaleDir);
    const cwdResolved = path.resolve(header.cwd);
    const cwdReal = canonicalIfExists(cwdResolved) || cwdResolved;
    if (within(whaleDir, cwdResolved) || (whaleReal && within(whaleReal, cwdReal))) return true;
  }
  return false;
}

/**
 * Validate an explicit `cwd` passed to `acp_delegate`.
 * @param {unknown} rawCwd
 * @param {{ dshHome?: string }} [options]
 */
export function validateExplicitDelegateCwd(rawCwd, { dshHome = process.env.DSH_HOME || '' } = {}) {
  if (typeof rawCwd !== 'string' || !rawCwd.trim()) {
    throw new Error('acp_delegate 的 cwd 必须是非空的绝对路径。');
  }
  const trimmed = rawCwd.trim();
  if (trimmed.includes('\0') || !path.isAbsolute(trimmed)) {
    throw new Error('acp_delegate 的 cwd 必须是有效的绝对路径。');
  }
  const declared = path.resolve(trimmed);
  let real;
  try {
    const info = fs.lstatSync(declared);
    if (info.isSymbolicLink()) throw new Error('acp_delegate 的 cwd 不能是符号链接或目录联接。');
    if (!info.isDirectory()) throw new Error('acp_delegate 的 cwd 必须指向已存在的文件夹。');
    real = fs.realpathSync.native(declared);
  } catch (/** @type {any} */ error) {
    if (error?.code === 'ENOENT') throw new Error(`acp_delegate 目标目录不存在：${declared}`);
    if (error instanceof Error && /acp_delegate/.test(error.message)) throw error;
    throw new Error(`无法访问 acp_delegate 目标目录：${error?.message ?? error}`);
  }
  const refusal = checkForbidden(declared, dshHome) || checkForbidden(real, dshHome);
  if (refusal) throw new Error(refusal);
  return real;
}

/**
 * Resolve the effective working directory for one `acp_delegate` request.
 * @param {any} args
 * @param {any} parent
 * @param {{ dshHome?: string }} [options]
 */
export function resolveDelegationCwd(args, parent, { dshHome = process.env.DSH_HOME || '' } = {}) {
  const hasExplicit = args?.cwd !== undefined && args?.cwd !== null && String(args.cwd).trim() !== '';
  if (isWhaleGirlParent(parent, dshHome)) {
    if (!hasExplicit) {
      throw new Error('从鲸鱼娘会话调用 acp_delegate 时必须显式传入安全的目标 cwd，禁止隐式落入 data/whale/。');
    }
    return validateExplicitDelegateCwd(args.cwd, { dshHome });
  }
  if (hasExplicit) {
    return validateExplicitDelegateCwd(args.cwd, { dshHome });
  }
  return parent?.session?.header?.cwd || process.cwd();
}
