/** Project-owned knowledge and exports never widen access through a filesystem link. */
import fs from 'node:fs/promises';
import { createReadStream, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export function identifier(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(value)) throw new Error('Invalid Project resource identity.');
  return value;
}
export function within(root, target) {
  const rel = relative(root, target);
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`));
}
const identity = path => process.platform === 'win32' ? path.toLowerCase() : path;
/** Canonical lexical comparison key that treats Windows drive/path casing and slash styles as identical. */
export function comparablePath(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  return identity(resolve(trimmed));
}
/** Windows paths are case-insensitive; realpath may return a different case than the declared path. */
export function samePath(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (!a.trim() || !b.trim()) return a.trim() === b.trim();
  return comparablePath(a) === comparablePath(b);
}
const gitMetadata = relativePath => relativePath.split(/[\\/]+/).some(part => part.toLowerCase() === '.git');

/**
 * Synchronously read a plain file directly inside a Project store directory,
 * refusing symlinks, realpath escapes, non-files and oversized files.
 * Returns null when the root or file is absent (ENOENT).
 */
export function safeReadStoreFileSync(root, filename, maxBytes = 64 * 1024) {
  if (typeof root !== 'string' || !root.trim()) return null;
  const declaredRoot = resolve(root);
  let canonicalRoot;
  try {
    const rootInfo = lstatSync(declaredRoot);
    if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) throw new Error('Project store directory was replaced with a link or non-directory.');
    canonicalRoot = realpathSync(declaredRoot);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
  if (!samePath(canonicalRoot, declaredRoot)) throw new Error('Project store directory points outside its registered identity.');
  const target = join(canonicalRoot, filename);
  if (!within(canonicalRoot, target) || gitMetadata(relative(canonicalRoot, target))) {
    throw new Error(`Project store file "${filename}" escapes its authorized directory.`);
  }
  let info;
  try { info = lstatSync(target); }
  catch (error) { if (error?.code === 'ENOENT') return null; throw error; }
  if (info.isSymbolicLink() || !info.isFile()) {
    throw new Error(`Project store file "${filename}" was replaced with a link or non-file.`);
  }
  const actual = realpathSync(target);
  if (!samePath(actual, target) || !within(canonicalRoot, actual)) {
    throw new Error(`Project store file "${filename}" resolves outside its authorized directory.`);
  }
  if (info.size > maxBytes) {
    throw new Error(`Project store file "${filename}" exceeds the ${maxBytes}-byte limit.`);
  }
  return readFileSync(actual, 'utf8');
}

/** References in domain records are already canonical; a replacement root cannot widen them. */
export async function checkedRoot(root) {
  const declared = resolve(root), actual = await fs.realpath(declared);
  if (identity(actual) !== identity(declared) || !(await fs.stat(actual)).isDirectory()) throw new Error('An authorized directory was moved or replaced with a link.');
  return actual;
}

async function ownedDirectory(parent, component) {
  const folder = join(parent, identifier(component));
  let info;
  try { info = await fs.lstat(folder); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!info) {
    try { await fs.mkdir(folder); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    info = await fs.lstat(folder);
  }
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('Project directory was replaced with a link or a file.');
  const actual = await fs.realpath(folder);
  if (identity(actual) !== identity(folder) || !within(parent, actual)) throw new Error('Project directory points outside its registered identity.');
  return actual;
}
export async function projectDirectory(home, projectId) {
  await fs.mkdir(home, { recursive: true });
  const canonicalHome = await fs.realpath(home);
  return ownedDirectory(await ownedDirectory(canonicalHome, 'projects'), projectId);
}

/** Create only checked Project-owned directory components; never traverse a junction. */
export async function safeProjectSubdirectory(home, projectId, ...components) {
  let current = await projectDirectory(home, projectId);
  for (const component of components) current = await ownedDirectory(current, component);
  return current;
}
// Windows refuses rename over a destination still held by another handle —
// a concurrent reader, indexer or antivirus scan — and reports the transient
// failure as EPERM/EACCES/EBUSY. This retry contract mirrors
// src/shared/fs-safe.js#renameWithRetry: the plugin runtime is copied into
// profiles by src/main/dsh-project-desktop.js (copyRuntime), so this file
// cannot import that one. src/shared/fs-safe.test.js pins both copies.
const RENAME_RETRYABLE_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);
const RENAME_RETRY_BUDGET_MS = 2000;
const RENAME_RETRY_DELAY_MS = 25;

export async function renameWithRetry(from, to, options = {}) {
  const rename = options.rename ?? fs.rename;
  const wait = options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const platform = options.platform ?? process.platform;
  const deadline = Date.now() + (options.budgetMs ?? RENAME_RETRY_BUDGET_MS);
  let delayMs = RENAME_RETRY_DELAY_MS;
  for (;;) {
    try { return await rename(from, to); }
    catch (error) {
      if (platform !== 'win32' || !RENAME_RETRYABLE_CODES.has(error?.code) || Date.now() >= deadline) throw error;
      await wait(delayMs);
      delayMs = Math.min(delayMs * 2, 250);
    }
  }
}
export async function atomicText(path, text, options = {}) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  let renamed = false;
  try {
    await fs.writeFile(temporary, text, { flag: 'wx', mode: 0o600 });
    await renameWithRetry(temporary, path, options);
    renamed = true;
  } finally {
    if (!renamed) await fs.unlink(temporary).catch(() => { /* Preserve the original write failure when the temporary file is already absent. */ });
  }
}
export async function checkedFile(path, roots) {
  const actual = await fs.realpath(resolve(path));
  const allowed = (await Promise.all(roots.map(async root => {
    try { return await checkedRoot(root); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }))).filter(Boolean);
  if (!allowed.some(root => within(root, actual) && !gitMetadata(relative(root, actual)))) throw new Error('Artifact is outside this task’s authorized directories.');
  const stat = await fs.stat(actual);
  if (!stat.isFile()) throw new Error('Artifact is not a file.');
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(actual)) hash.update(chunk);
  return { path: actual, size: stat.size, type: 'file', sha256: hash.digest('hex') };
}
// A live owner refreshes the lock's mtime; a stale lock whose PID was reused by another program is recoverable.
const WRITER_HEARTBEAT_MS = 30_000, WRITER_STALE_MS = 5 * 60_000;
export async function acquireWriter(home, generation) {
  await fs.mkdir(home, { recursive: true });
  const path = join(await fs.realpath(home), 'project-writer.lock');
  const value = { pid: process.pid, generation };
  try { await fs.writeFile(path, JSON.stringify(value), { flag: 'wx', mode: 0o600 }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    // Serialize the finite dead-owner repair too: two cold Hosts must not both
    // move the lock after reading the same dead PID and then admit two writers.
    const recoveryPath = `${path}.recovery`;
    try { await fs.writeFile(recoveryPath, JSON.stringify(value), { flag: 'wx', mode: 0o600 }); }
    catch (recovery) {
      if (recovery.code === 'EEXIST') throw new Error('Project writer recovery is already owned or needs inspection.');
      throw recovery;
    }
    try {
      if ((await fs.lstat(path)).isSymbolicLink()) throw new Error('Project writer lock was replaced with a link.');
      const previous = JSON.parse(await fs.readFile(path, 'utf8'));
      if (!Number.isInteger(previous.pid) || previous.pid < 1 || typeof previous.generation !== 'string'
        || !/^[a-zA-Z0-9_-]{1,100}$/.test(previous.generation)) throw new Error('Project writer lock needs inspection.');
      let alive = true;
      try { process.kill(previous.pid, 0); } catch (probe) { if (probe.code === 'ESRCH') alive = false; else throw probe; }
      if (alive && Date.now() - (await fs.stat(path)).mtimeMs <= WRITER_STALE_MS) throw new Error('Another Host owns this profile’s Project writer.');
      await renameWithRetry(path, `${path}.interrupted-${previous.generation}`);
      await fs.writeFile(path, JSON.stringify(value), { flag: 'wx', mode: 0o600 });
    } finally {
      const owner = JSON.parse(await fs.readFile(recoveryPath, 'utf8'));
      if (owner.pid === process.pid && owner.generation === generation) await fs.unlink(recoveryPath);
    }
  }
  const owned = async () => {
    try { const current = JSON.parse(await fs.readFile(path, 'utf8')); return current.generation === generation && current.pid === process.pid; }
    catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  };
  const heartbeat = setInterval(() => {
    void owned().then(mine => { if (mine) { const now = new Date(); return fs.utimes(path, now, now); } clearInterval(heartbeat); }).catch((error) => { console.warn('[vendor/dsh-project/lib/files.js] background operation failed', error); });
  }, WRITER_HEARTBEAT_MS);
  heartbeat.unref?.();
  return async () => {
    clearInterval(heartbeat);
    if (await owned()) await fs.unlink(path).catch(error => { if (error.code !== 'ENOENT') throw error; });
  };
}
