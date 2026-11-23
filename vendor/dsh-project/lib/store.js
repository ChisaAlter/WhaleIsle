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
import { readFileSync, readdirSync } from 'node:fs';
import { chmod, mkdir, open, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createSerialQueue } from '../../dsh-shared/lib/managed-task-runtime.mjs';
import { renameWithRetry } from './files.js';
import {
  PROJECT_ID_RE,
  httpError,
  normalizeProject,
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
  /** @type {Map<string, { id: string, name: string, autonomy: string, paused: boolean, workspace: string }>} */
  const coordinatorSessions = new Map();
  /** @type {Map<string, any>} */
  const projectsCache = new Map();
  /** @type {Set<(event: any) => void>} */
  const listeners = new Set();

  function rememberProject(project) {
    const snapshot = structuredClone(project);
    projectsCache.set(project.id, snapshot);
    for (const [sessionId, remembered] of coordinatorSessions) {
      if (remembered.id === project.id) coordinatorSessions.delete(sessionId);
    }
    const sessionId = typeof project.coordinatorSessionId === 'string'
      ? project.coordinatorSessionId.trim()
      : '';
    if (!sessionId) return;
    coordinatorSessions.set(sessionId, {
      id: project.id,
      name: project.name,
      autonomy: project.autonomy,
      paused: project.paused === true,
      workspace: project.workspace || '',
    });
  }

  function primeSync() {
    coordinatorSessions.clear();
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
        const raw = readFileSync(projectFile(entry.name), 'utf8');
        const project = normalizeProject(JSON.parse(raw));
        rememberProject(project);
      } catch {
        // Ignore half-written or foreign directories.
      }
    }
  }

  function emitChange({ type, projectId = '', taskId = '', ts = Date.now() }) {
    const event = {
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
        for (const [sid, info] of coordinatorSessions) {
          if (info.id === cachedId) coordinatorSessions.delete(sid);
        }
      }
    }
    projects.sort((left, right) => right.updatedAt - left.updatedAt);
    return projects;
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
    return coordinatorSessions.get(sessionId) || null;
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
    listProjects,
    getCachedProjects,
    getCachedProject,
    getCoordinatorInfo,
  };
}
