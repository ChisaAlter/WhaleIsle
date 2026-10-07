/** Project-owned knowledge and exports never widen access through a filesystem link. */
import fs from 'node:fs/promises';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';

export function identifier(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(value)) throw new Error('Invalid Project resource identity.');
  return value;
}
export function within(root, target) {
  const rel = relative(root, target);
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`));
}
const identity = path => process.platform === 'win32' ? path.toLowerCase() : path;
const gitMetadata = relativePath => relativePath.split(/[\\/]+/).some(part => part.toLowerCase() === '.git');

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
export async function atomicText(path, text) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, text, { flag: 'wx', mode: 0o600 });
  await fs.rename(temporary, path);
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
      if (alive) throw new Error('Another Host owns this profile’s Project writer.');
      await fs.rename(path, `${path}.interrupted-${previous.generation}`);
      await fs.writeFile(path, JSON.stringify(value), { flag: 'wx', mode: 0o600 });
    } finally {
      const owner = JSON.parse(await fs.readFile(recoveryPath, 'utf8'));
      if (owner.pid === process.pid && owner.generation === generation) await fs.unlink(recoveryPath);
    }
  }
  return async () => {
    const current = JSON.parse(await fs.readFile(path, 'utf8'));
    if (current.generation === generation && current.pid === process.pid) await fs.unlink(path);
  };
}
