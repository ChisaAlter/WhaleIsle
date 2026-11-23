/**
 * Per-topic shared project memory manager under `$DSH_HOME/projects/<projectId>/memory/`.
 * Delegates pure formatting/indexing/search helpers to `./memory-format.js`.
 */
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createSerialQueue } from '../../dsh-shared/lib/managed-task-runtime.mjs';
import {
  MEMORY_INDEX_DESCRIPTION,
  MEMORY_INDEX_FILE,
  MEMORY_INDEX_READ_ONLY,
  archiveSummary,
  compactionNote,
  compareMemoryFiles,
  findMemoryFile,
  isMemoryIndexName,
  legacyMemoryDate,
  memoryDescription,
  memoryDescriptionLine,
  memoryIndex,
  memoryNameOf,
  memoryNameOrThrow,
  memorySlug,
  memoryTotal,
  memoryTypeOf,
  memoryWarning,
  nextMemoryModified,
  parseMemoryFile,
  planFileArchive,
  renderMemoryIndexFile,
  searchMemory,
  serializeMemoryFile,
  splitLegacyMemory,
  uniqueMemoryName,
} from './memory-format.js';
import {
  MAX_MEMORY,
  MEMORY_BUDGET,
  MEMORY_INDEX_TOOL_LIMIT,
  MEMORY_TARGET_RATIO,
  httpError,
  memoryBudgetOf,
  messageOf,
} from './schema.js';
import { pathExists, statOrNull, writeFileAtomic } from './store.js';

export {
  MEMORY_INDEX_DESCRIPTION,
  MEMORY_INDEX_FILE,
  MEMORY_INDEX_READ_ONLY,
  isMemoryIndexName,
  memoryIndex,
  memoryNameOf,
  memoryNameOrThrow,
  memorySlug,
  renderMemoryIndexFile,
  searchMemory,
};

async function moveFile(from, to) {
  try {
    await rename(from, to);
  } catch (error) {
    if (error?.code !== 'EXDEV') throw error;
    await writeFile(to, await readFile(from));
    await rm(from, { force: true });
  }
}

export function createMemoryManager(store) {
  const memoryDir = (id) => join(store.projectDir(id), 'memory');
  const memoryIndexFile = (id) => join(memoryDir(id), MEMORY_INDEX_FILE);
  const memoryArchiveDir = (id) => join(memoryDir(id), 'archive');
  const legacyMemoryFile = (id) => join(store.projectDir(id), 'memory.md');
  const legacyArchiveFile = (id) => join(store.projectDir(id), 'memory-archive.md');
  const legacyBackupFile = (id) => join(store.projectDir(id), 'memory.bak.md');

  const fileLocks = new Map();
  const indexLocks = new Map();
  const compacting = new Set();

  function withFileLock(projectId, name, run) {
    const key = `${projectId}\u0000${name}`;
    let queue = fileLocks.get(key);
    if (!queue) {
      queue = createSerialQueue();
      fileLocks.set(key, queue);
    }
    return queue.run(run);
  }

  function withIndexLock(projectId, run) {
    const key = String(projectId);
    let queue = indexLocks.get(key);
    if (!queue) {
      queue = createSerialQueue();
      indexLocks.set(key, queue);
    }
    return queue.run(run);
  }

  async function listMemoryFiles(id, dir = memoryDir(id)) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return [];
    }
    const candidates = entries.filter(
      (entry) =>
        entry.isFile()
        && /\.md$/i.test(entry.name)
        && entry.name.toLowerCase() !== MEMORY_INDEX_FILE.toLowerCase(),
    );
    const files = await Promise.all(
      candidates.map(async (entry) => {
        const filePath = join(dir, entry.name);
        const fileName = entry.name.replace(/\.md$/i, '');
        let raw;
        try {
          raw = await readFile(filePath, 'utf8');
        } catch {
          return null;
        }
        const file = parseMemoryFile(raw, { name: fileName, path: filePath });
        if (!file.modified) {
          const info = await statOrNull(filePath);
          file.modified = new Date(info ? info.mtimeMs : Date.now()).toISOString();
        }
        return file;
      }),
    );
    return files.filter(Boolean).sort(compareMemoryFiles);
  }

  async function listArchiveFiles(id) {
    return listMemoryFiles(id, memoryArchiveDir(id));
  }

  async function regenerateIndex(id) {
    return withIndexLock(id, async () => {
      const files = await listMemoryFiles(id);
      await mkdir(memoryDir(id), { recursive: true });
      await writeFileAtomic(memoryIndexFile(id), renderMemoryIndexFile(files));
      return files;
    });
  }

  async function uniqueArchivePath(id, name) {
    const dir = memoryArchiveDir(id);
    const base = memorySlug(name) || 'memory';
    let candidate = join(dir, `${base}.md`);
    if (!(await pathExists(candidate))) return candidate;
    const stamp = Date.now().toString(36);
    candidate = join(dir, `${base}-${stamp}.md`);
    let index = 2;
    while (await pathExists(candidate)) {
      candidate = join(dir, `${base}-${stamp}-${index}.md`);
      index += 1;
    }
    return candidate;
  }

  async function migrateLegacyMemory(id, raw) {
    await mkdir(memoryDir(id), { recursive: true });
    await mkdir(memoryArchiveDir(id), { recursive: true });
    const blocks = splitLegacyMemory(raw);
    const info = await statOrNull(legacyMemoryFile(id));
    const fallback = info ? info.mtimeMs : Date.now();
    const used = new Set();
    const files = [];
    blocks.forEach((block, index) => {
      const title = block.title || '';
      const name = uniqueMemoryName(used, title ? memorySlug(title) : 'preamble');
      used.add(name);
      const date = legacyMemoryDate(title);
      const base = date ? Date.parse(`${date}T00:00:00.000Z`) : fallback;
      const modified = new Date(base + index * 1_000).toISOString();
      const body = title ? `# ${title}\n\n${block.body}`.trimEnd() : block.body;
      files.push({
        name,
        fileName: name,
        description: memoryDescription(block.body) || memoryDescription(title) || name,
        type: 'reference',
        modified,
        body,
        chars: body.length,
        path: join(memoryDir(id), `${name}.md`),
      });
    });
    for (const file of files) await writeFileAtomic(file.path, serializeMemoryFile(file));
    if (await pathExists(legacyArchiveFile(id))) {
      await moveFile(legacyArchiveFile(id), await uniqueArchivePath(id, 'legacy-memory-archive'));
    }
    try {
      await rename(legacyMemoryFile(id), legacyBackupFile(id));
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    await regenerateIndex(id);
    return { files: files.length, chars: memoryTotal(files) };
  }

  async function ensureMemoryMigrated(id) {
    let raw;
    try {
      raw = await readFile(legacyMemoryFile(id), 'utf8');
    } catch {
      return false;
    }
    await migrateLegacyMemory(id, raw);
    return true;
  }

  async function readMemoryFiles(id) {
    await ensureMemoryMigrated(id);
    const files = await listMemoryFiles(id);
    if (files.length > 0 && !(await pathExists(memoryIndexFile(id)))) {
      try {
        await regenerateIndex(id);
      } catch {
        // Non-fatal on read path.
      }
    }
    return files;
  }

  async function readMemoryFile(id, name) {
    const live = findMemoryFile(await readMemoryFiles(id), name);
    if (live) return { file: live, archived: false };
    const archived = findMemoryFile(await listArchiveFiles(id), name);
    return archived ? { file: archived, archived: true } : null;
  }

  async function readMemoryIndexFile(id) {
    const filePath = memoryIndexFile(id);
    const info = await statOrNull(filePath);
    if (!info) return null;
    let bodyText;
    try {
      bodyText = await readFile(filePath, 'utf8');
    } catch {
      return null;
    }
    return {
      name: MEMORY_INDEX_FILE,
      description: MEMORY_INDEX_DESCRIPTION,
      type: 'index',
      modified: new Date(info.mtimeMs).toISOString(),
      size: bodyText.length,
      readOnly: true,
      isIndex: true,
      text: bodyText,
    };
  }

  async function writeMemoryFileUnlocked(id, input, knownFiles) {
    const files = knownFiles || (await readMemoryFiles(id));
    const existing = files.find((file) => file.name === input.name);
    const raw = String(input.text ?? '');
    const truncated = raw.length > MAX_MEMORY;
    const body = (truncated ? raw.slice(0, MAX_MEMORY) : raw).replace(/\n+$/, '');
    const description =
      memoryDescriptionLine(input.description)
      || existing?.description
      || memoryDescription(body)
      || input.name;
    const file = {
      name: input.name,
      fileName: input.name,
      description,
      type: memoryTypeOf(input.type || existing?.type),
      modified: nextMemoryModified(files),
      body,
      chars: body.length,
      path: join(memoryDir(id), `${input.name}.md`),
    };
    await mkdir(memoryDir(id), { recursive: true });
    await writeFileAtomic(file.path, serializeMemoryFile(file));
    const latest = await regenerateIndex(id);
    store.emitChange({ type: 'memory.updated', projectId: id });
    return { file, total: memoryTotal(latest), count: latest.length, truncated };
  }

  async function writeMemoryFile(id, input) {
    const name = memoryNameOrThrow(input?.name);
    return withFileLock(id, name, () => writeMemoryFileUnlocked(id, { ...input, name }));
  }

  async function appendMemoryFile(id, input) {
    const name = memoryNameOrThrow(input?.name);
    return withFileLock(id, name, async () => {
      const files = await readMemoryFiles(id);
      const existing = files.find((file) => file.name === name);
      const addition = String(input?.text ?? '').trim();
      const body = existing && existing.body ? `${existing.body}\n\n${addition}` : addition;
      return writeMemoryFileUnlocked(id, { ...input, name, text: body }, files);
    });
  }

  async function deleteMemoryFile(id, rawName) {
    if (isMemoryIndexName(rawName)) throw httpError(400, MEMORY_INDEX_READ_ONLY);
    const wanted = memoryNameOf(rawName);
    if (!wanted) throw httpError(400, `"${rawName}" is not a valid memory file name`);
    return withFileLock(id, wanted, async () => {
      const files = await readMemoryFiles(id);
      const file = files.find((candidate) => candidate.name === wanted || candidate.fileName === wanted);
      if (!file) {
        throw httpError(
          404,
          `No memory file matches "${rawName}". Files: ${files.map((candidate) => candidate.name).join(' | ') || '(none)'}.`,
        );
      }
      await rm(file.path, { force: true });
      const latest = await regenerateIndex(id);
      store.emitChange({ type: 'memory.deleted', projectId: id });
      return { file, total: memoryTotal(latest), count: latest.length };
    });
  }

  async function rollbackMovedFiles(id, moved) {
    for (const { file, target } of [...moved].reverse()) {
      try {
        await moveFile(target, file.path);
      } catch {
        // Archive still holds the file.
      }
    }
    if (moved.length > 0) {
      try {
        await regenerateIndex(id);
      } catch {
        // Next mutation regenerates index.
      }
    }
  }

  async function compactMemory(projectId) {
    const id = String(projectId);
    if (compacting.has(id)) return { skipped: 'in_flight' };
    compacting.add(id);
    const moved = [];
    let before = 0;
    let budget = MEMORY_BUDGET;
    try {
      const project = await store.readProject(id);
      budget = memoryBudgetOf(project);
      const files = await readMemoryFiles(id);
      before = memoryTotal(files);
      if (before <= budget) return { skipped: 'under_budget', before, after: before, budget };
      const target = Math.max(1, Math.floor(budget * MEMORY_TARGET_RATIO));
      const plan = planFileArchive(files, target);
      if (!plan) return { skipped: 'nothing_to_archive', before, after: before, budget };
      await mkdir(memoryArchiveDir(id), { recursive: true });
      for (const file of plan.moved) {
        const destination = await uniqueArchivePath(id, file.name);
        await moveFile(file.path, destination);
        moved.push({ file, target: destination });
      }
      const check = await regenerateIndex(id);
      const stillLive = plan.moved.filter((file) =>
        check.some((candidate) => candidate.fileName === file.fileName),
      );
      if (stillLive.length > 0) {
        throw new Error(
          `the moved file(s) are still in the live memory: ${stillLive.map((file) => file.name).join(', ')}`,
        );
      }
      const after = memoryTotal(check);
      const record = { at: Date.now(), before, after, archived: plan.moved.length };
      await store.withProjectLock(id, async () => {
        const latest = await store.readProject(id);
        latest.lastCompaction = record;
        latest.updatedAt = Date.now();
        await store.writeProject(latest);
      });
      store.emitChange({ type: 'memory.compacted', projectId: id });
      return { skipped: null, ...record, budget };
    } catch (error) {
      await rollbackMovedFiles(id, moved);
      return { skipped: 'error', before, after: before, budget, reason: messageOf(error) };
    } finally {
      compacting.delete(id);
    }
  }

  async function afterMemoryWrite(project, written) {
    const budget = memoryBudgetOf(project);
    const warning = memoryWarning(
      { length: written.total, truncated: written.truncated, name: written.file.name },
      budget,
    );
    if (written.total <= budget) return warning;
    if (project.autoCompact === false) {
      return `${warning} Auto-compaction is off for this project, so the memory stays over budget.`;
    }
    try {
      return `${warning}${compactionNote(await compactMemory(project.id))}`;
    } catch (error) {
      return `${warning} Auto-compaction failed (${messageOf(error)}); the memory is unchanged.`;
    }
  }

  async function memoryPayload(project, files) {
    const index = await readMemoryIndexFile(project.id);
    return {
      files: files.map((file) => ({
        name: file.name,
        description: file.description,
        type: file.type,
        modified: file.modified,
        size: file.chars,
        stale: file.stale === true,
      })),
      indexFile: index
        ? {
            name: index.name,
            description: index.description,
            type: index.type,
            modified: index.modified,
            size: index.size,
            readOnly: true,
            isIndex: true,
          }
        : null,
      total: memoryTotal(files),
      budget: memoryBudgetOf(project),
    };
  }

  async function memoryIndexForTool(project) {
    const files = await readMemoryFiles(project.id);
    const live = memoryIndex(files, MEMORY_INDEX_TOOL_LIMIT, { listStale: true });
    const archived = archiveSummary(await listArchiveFiles(project.id));
    return archived ? `${live}\n\n${archived}` : live;
  }

  return {
    memoryDir,
    memoryIndexFile,
    memoryArchiveDir,
    readMemoryFiles,
    readMemoryFile,
    readMemoryIndexFile,
    listArchiveFiles,
    writeMemoryFile,
    appendMemoryFile,
    deleteMemoryFile,
    compactMemory,
    afterMemoryWrite,
    memoryPayload,
    memoryIndexForTool,
  };
}
