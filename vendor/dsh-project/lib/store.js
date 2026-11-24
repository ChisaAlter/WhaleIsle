/**
 * Concurrency-safe project store under `$DSH_HOME/projects/<projectId>/project.json`.
 *
 * - Per-project serial write queue (`createSerialQueue`) eliminates read-modify-write
 *   races between concurrent `subagent/end` callbacks, tool mutations, and HTTP PATCHes.
 * - Atomic `0o600` fsync + Windows-retryable rename prevents torn files.
 * - Synchronous load-time index priming feeds synchronous `systemPrompt.section`
 *   assembly and synchronous `inspect()` / bridge summary reads.
 * - Event bus notifies SSE subscribers on every project/task/memory mutation.
 */
import { randomBytes } from 'node:crypto';
import { readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { chmod, lstat, mkdir, open, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createSerialQueue } from '../../dsh-shared/lib/managed-task-runtime.mjs';
import { renameWithRetry, within } from './files.js';
import {
  PROJECT_ID_RE,
  httpError,
  normalizeProject,
  workerIsLive,
} from './schema.js';

export function resolveDshHome(overrideHome = '') {
  const explicit = typeof overrideHome === 'string' ? overrideHome.trim() : '';
  if (explicit) return explicit;
  return process.env.DSH_HOME || process.env.DSHD_HOME || join(process.env.HOME || homedir(), '.dsh');
}

/**
 * Replace `file` atomically: write sibling `0o600`, fsync, then rename with
 * Windows transient sharing-violation retry (`renameWithRetry`).
 */
export async function writeFileAtomic(file, contents) {
  const temporary = `${file}.${randomBytes(4).toString('hex')}.tmp`;
  const handle = await open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(contents, 'utf8');
    await handle.sync();
  } catch (error) {
    await handle.close().catch(() => { /* Preserve original write/sync error. */ });
    await rm(temporary, { force: true }).catch(() => { /* Best-effort temp file cleanup on write error. */ });
    throw error;
  }
  await handle.close();
  try {
    await renameWithRetry(temporary, file);
  } catch (error) {
    if (error?.code !== 'EXDEV') {
      await rm(temporary, { force: true }).catch(() => { /* Best-effort temp file cleanup on rename error. */ });
      throw error;
    }
    await rm(temporary, { force: true }).catch(() => { /* Temp sibling is being replaced by direct EXDEV write. */ });
    await writeFile(file, contents, { encoding: 'utf8', mode: 0o600 });
    await chmod(file, 0o600).catch(() => { /* POSIX mode bits may be unsupported on non-POSIX filesystems. */ });
  }
}

export async function pathExists(targetPath) {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function statOrNull(targetPath) {
  try {
    return await stat(targetPath);
  } catch {
    return null;
  }
}

export async function isDirectory(targetPath) {
  if (!targetPath) return false;
  try {
    return (await stat(targetPath)).isDirectory();
  } catch {
    return false;
  }
}

export function createProjectStore({ home = '' } = {}) {
  const getHome = () => resolveDshHome(home);
  const rootDir = () => join(getHome(), 'projects');
  const worktreesRootDir = () => join(getHome(), 'project-worktrees');
  const projectDir = (id) => join(rootDir(), id);
  const projectFile = (id) => join(projectDir(id), 'project.json');

  /** @type {Map<string, ReturnType<typeof createSerialQueue>>} */
  const projectQueues = new Map();
  /** @type {Map<string, string>} coordinatorSessionId -> projectId */
  const coordinatorSessions = new Map();
  /** @type {Map<string, { projectId: string, taskId: string }>} childSessionId -> task owner */
  const workerSessions = new Map();
  /** @type {Map<string, any>} */
  const projectsCache = new Map();
  /** @type {Set<(event: any) => void>} */
  const listeners = new Set();

  function clearProjectIndices(projectId) {
    for (const [sessionId, ownerId] of coordinatorSessions) {
      if (ownerId === projectId) coordinatorSessions.delete(sessionId);
    }
    for (const [sessionId, info] of workerSessions) {
      if (info.projectId === projectId) workerSessions.delete(sessionId);
    }
  }

  function rememberProject(project) {
    const snapshot = structuredClone(project);
    projectsCache.set(project.id, snapshot);
    clearProjectIndices(project.id);
    const sessionId = typeof project.coordinatorSessionId === 'string'
      ? project.coordinatorSessionId.trim()
      : '';
    if (sessionId) {
      coordinatorSessions.set(sessionId, project.id);
    }
    for (const task of project.tasks || []) {
      const childId = typeof task?.childSessionId === 'string' ? task.childSessionId.trim() : '';
      if (childId) {
        workerSessions.set(childId, { projectId: project.id, taskId: task.id });
      }
    }
  }

  function writeFileAtomicSync(file, contents) {
    const temporary = `${file}.${randomBytes(4).toString('hex')}.tmp`;
    try {
      writeFileSync(temporary, contents, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      renameSync(temporary, file);
    } catch (error) {
      try { unlinkSync(temporary); } catch { /* Best-effort temp cleanup. */ }
      if (error?.code === 'EXDEV') {
        writeFileSync(file, contents, { encoding: 'utf8', mode: 0o600 });
        return;
      }
      throw error;
    }
  }

  function recoverInterruptedTasks(project) {
    const now = Date.now();
    let changed = false;
    for (const task of project.tasks || []) {
      if (!task || task.finishedAt) continue;
      if (task.status === 'running') {
        task.status = 'blocked';
        task.stopReason = 'interrupted_by_restart';
        task.finishedAt = now;
        task.updatedAt = now;
        changed = true;
      } else if (workerIsLive(task)) {
        // E.g. resolved while running before a restart; settle finishedAt so it stops holding a slot.
        task.finishedAt = task.updatedAt || now;
        changed = true;
      }
    }
    if (changed) project.updatedAt = now;
    return changed;
  }

  function primeSync() {
    coordinatorSessions.clear();
    workerSessions.clear();
    projectsCache.clear();
    let entries;
    try {
      entries = readdirSync(rootDir(), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || !PROJECT_ID_RE.test(entry.name)) continue;
      try {
        const file = projectFile(entry.name);
        const raw = readFileSync(file, 'utf8');
        const project = normalizeProject(JSON.parse(raw));
        if (recoverInterruptedTasks(project)) {
          try {
            writeFileAtomicSync(file, `${JSON.stringify(project, null, 2)}\n`);
          } catch {
            // Keep recovered state in memory even if disk write fails on startup.
          }
        }
        rememberProject(project);
      } catch {
        // Ignore half-written or foreign directories.
      }
    }
  }

  function emitChange({ type, projectId = '', taskId = '', ts = Date.now(), ...extra }) {
    const event = {
      ...extra,
      type: String(type || 'update'),
      ...(projectId ? { projectId: String(projectId) } : {}),
      ...(taskId ? { taskId: String(taskId) } : {}),
      ts: Number(ts) || Date.now(),
    };
    for (const listener of [...listeners]) {
      try {
        listener(event);
      } catch {
        // One broken subscriber must not affect others.
      }
    }
    return event;
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') return () => {};
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  function queueFor(projectId) {
    const key = String(projectId || '');
    let queue = projectQueues.get(key);
    if (!queue) {
      queue = createSerialQueue();
      projectQueues.set(key, queue);
    }
    return queue;
  }

  /**
   * Run a read-modify-write mutation exclusively for one project.
   * Different projects execute concurrently; operations on the same project
   * serialize cleanly without losing updates.
   */
  function withProjectLock(projectId, fn) {
    return queueFor(projectId).run(fn);
  }

  async function readProject(id) {
    const key = String(id || '');
    if (!PROJECT_ID_RE.test(key)) throw httpError(404, 'project_not_found');
    let raw;
    try {
      raw = await readFile(projectFile(key), 'utf8');
    } catch {
      throw httpError(404, 'project_not_found');
    }
    let project;
    try {
      project = normalizeProject(JSON.parse(raw));
    } catch {
      throw httpError(500, 'project_unreadable');
    }
    rememberProject(project);
    return project;
  }

  async function writeProject(project) {
    const normalized = normalizeProject(project);
    await mkdir(projectDir(normalized.id), { recursive: true });
    await writeFileAtomic(projectFile(normalized.id), `${JSON.stringify(normalized, null, 2)}\n`);
    rememberProject(normalized);
    return normalized;
  }

  async function listProjects() {
    let entries;
    try {
      entries = await readdir(rootDir(), { withFileTypes: true });
    } catch {
      projectsCache.clear();
      return [];
    }
    const projects = [];
    const seen = new Set();
    for (const entry of entries) {
      if (!entry.isDirectory() || !PROJECT_ID_RE.test(entry.name)) continue;
      try {
        const project = await readProject(entry.name);
        projects.push(project);
        seen.add(project.id);
      } catch {
        // Ignore foreign or corrupt directories.
      }
    }
    for (const cachedId of [...projectsCache.keys()]) {
      if (!seen.has(cachedId)) {
        projectsCache.delete(cachedId);
        clearProjectIndices(cachedId);
      }
    }
    projects.sort((left, right) => right.updatedAt - left.updatedAt);
    return projects;
  }

  async function deleteProjectDir(id) {
    const key = String(id || '');
    if (!PROJECT_ID_RE.test(key)) throw httpError(404, 'project_not_found');
    const root = resolve(rootDir());
    const target = resolve(projectDir(key));
    if (!within(root, target) || target === root) {
      throw httpError(400, 'invalid_project_path');
    }
    let info;
    try {
      info = await lstat(target);
    } catch (error) {
      if (error?.code === 'ENOENT') {
        projectsCache.delete(key);
        clearProjectIndices(key);
        projectQueues.delete(key);
        return false;
      }
      throw error;
    }
    if (info.isSymbolicLink()) {
      throw httpError(400, 'project_dir_symlink');
    }
    const realRoot = await realpath(root);
    const realTarget = await realpath(target);
    if (!within(realRoot, realTarget) || realTarget === realRoot) {
      throw httpError(400, 'invalid_project_path');
    }
    await rm(realTarget, { recursive: true, force: true });
    projectsCache.delete(key);
    clearProjectIndices(key);
    projectQueues.delete(key);
    return true;
  }

  function getCachedProjects() {
    return [...projectsCache.values()]
      .map((item) => structuredClone(item))
      .sort((left, right) => right.updatedAt - left.updatedAt);
  }

  function getCachedProject(id) {
    const item = projectsCache.get(String(id || ''));
    return item ? structuredClone(item) : null;
  }

  function getCoordinatorInfo(sessionId) {
    if (typeof sessionId !== 'string' || !sessionId) return null;
    const projectId = coordinatorSessions.get(sessionId);
    if (!projectId) return null;
    return getCachedProject(projectId);
  }

  function getWorkerInfo(sessionId) {
    if (typeof sessionId !== 'string' || !sessionId) return null;
    const ref = workerSessions.get(sessionId);
    if (!ref) return null;
    const project = getCachedProject(ref.projectId);
    if (!project) return null;
    const task = (project.tasks || []).find((candidate) => candidate.id === ref.taskId) || null;
    return { projectId: ref.projectId, taskId: ref.taskId, project, task };
  }

  return {
    getHome,
    rootDir,
    worktreesRootDir,
    projectDir,
    projectFile,
    primeSync,
    emitChange,
    subscribe,
    withProjectLock,
    readProject,
    writeProject,
    deleteProjectDir,
    listProjects,
    getCachedProjects,
    getCachedProject,
    getCoordinatorInfo,
    getWorkerInfo,
  };
}
