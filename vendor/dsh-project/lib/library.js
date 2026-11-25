/**
 * Project Library manager under `$DSH_HOME/projects/<projectId>/library.json`.
 *
 * Manages two bounded lists:
 * - `references`: user-linked reference files/documents (pointers only, never copied).
 * - `artifacts`: task deliverables recorded explicitly via `projects_update_task`
 *   or collected automatically from task worktree diffs when settling into `review`.
 */
import { mkdir, readFile, realpath, stat } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { basename, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { withinPath } from '../../dsh-shared/lib/path-guard.mjs';
import { safeReadStoreFileSync } from './files.js';
import { httpError, newId, text } from './schema.js';
import { writeFileAtomic } from './store.js';

export const LIBRARY_FILE = 'library.json';
const MAX_REFERENCES = 100;
const MAX_ARTIFACTS = 300;
const MAX_TITLE = 180;
const MAX_NOTE = 500;
const MAX_LIBRARY_INDEX_CHARS = 2_400;

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico']);
const DOC_EXTS = new Set(['.md', '.mdx', '.txt', '.rst', '.adoc', '.pdf']);
const HTML_EXTS = new Set(['.html', '.htm']);
const DATA_EXTS = new Set(['.json', '.yaml', '.yml', '.toml', '.csv', '.tsv', '.xml', '.sql']);
const CODE_EXTS = new Set([
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.go', '.rs', '.java', '.kt',
  '.c', '.cc', '.cpp', '.h', '.hpp', '.cs', '.rb', '.php', '.sh', '.ps1', '.css', '.scss',
]);

function pathKey(p) {
  return process.platform === 'win32' ? String(p).toLowerCase() : String(p);
}

function hasUnsafeFileSyntax(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return true;
  if (/[\0\r\n]/.test(raw)) return true;
  if (/^(?:\\\\|\/\/)/.test(raw)) return true;
  if (process.platform === 'win32') {
    const afterDrive = raw.replace(/^[A-Za-z]:/, '');
    if (afterDrive.includes(':')) return true;
    const segments = afterDrive.split(/[\\/]+/).filter(Boolean);
    if (segments.some((segment) => segment !== '.' && segment !== '..' && /[. ]$/.test(segment))) {
      return true;
    }
  }
  return false;
}

function hasGitSegment(filePath) {
  return String(filePath || '')
    .split(/[\\/]+/)
    .some((segment) => segment.toLowerCase() === '.git');
}

export function inferArtifactKind(filePath) {
  const ext = extname(String(filePath || '')).toLowerCase();
  if (DOC_EXTS.has(ext)) return 'document';
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (HTML_EXTS.has(ext)) return 'html';
  if (DATA_EXTS.has(ext)) return 'data';
  if (CODE_EXTS.has(ext)) return 'code';
  return 'file';
}

function normalizeArtifactKind(value, filePath) {
  const allowed = new Set(['document', 'image', 'html', 'data', 'code', 'file']);
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return allowed.has(raw) ? raw : inferArtifactKind(filePath);
}

function computeRelativeDisplay(canonicalFile, baseDir) {
  if (!baseDir) return basename(canonicalFile);
  try {
    const rel = relative(resolve(baseDir), canonicalFile);
    if (rel && !rel.startsWith('..') && !isAbsolute(rel)) {
      return rel.split(sep).join('/');
    }
  } catch {
    // Fall back to basename.
  }
  return basename(canonicalFile);
}

async function sensitiveRefRoots(dshHome) {
  const candidates = [];
  const home = homedir();
  if (home) {
    candidates.push(join(home, '.ssh'), join(home, '.gnupg'), join(home, '.aws'), join(home, '.config'));
    if (process.platform === 'darwin') {
      candidates.push(join(home, 'Library', 'Keychains'));
    }
  }
  for (const key of ['APPDATA', 'LOCALAPPDATA']) {
    const val = process.env[key];
    if (typeof val === 'string' && val.trim()) candidates.push(val);
  }
  const out = [];
  for (const candidate of candidates) {
    try {
      out.push(await realpath(resolve(candidate)));
    } catch {
      // Missing anchor cannot be hit.
    }
  }
  let realDshHome = '';
  if (dshHome) {
    realDshHome = await realpath(resolve(dshHome)).catch(() => '');
  }
  const realTmp = await realpath(resolve(tmpdir())).catch(() => '');
  return { roots: out, realDshHome, realTmp };
}

function normalizeLibraryDoc(raw) {
  const references = Array.isArray(raw?.references)
    ? raw.references
        .filter((entry) => entry && typeof entry.path === 'string' && entry.path.trim())
        .slice(0, MAX_REFERENCES)
        .map((entry) => ({
          id: typeof entry.id === 'string' && entry.id.trim() ? entry.id.trim() : newId('ref'),
          path: text(entry.path.trim(), 1024),
          relativePath: text(entry.relativePath || basename(entry.path), 512),
          title: text(entry.title || basename(entry.path), MAX_TITLE).trim() || basename(entry.path),
          note: text(entry.note, MAX_NOTE).trim(),
          addedAt: Number(entry.addedAt) || Date.now(),
        }))
    : [];
  const artifacts = Array.isArray(raw?.artifacts)
    ? raw.artifacts
        .filter((entry) => entry && typeof entry.path === 'string' && entry.path.trim() && typeof entry.taskId === 'string' && entry.taskId.trim())
        .slice(-MAX_ARTIFACTS)
        .map((entry) => ({
          id: typeof entry.id === 'string' && entry.id.trim() ? entry.id.trim() : newId('art'),
          taskId: text(entry.taskId.trim(), 64),
          taskTitle: text(entry.taskTitle, 200).trim(),
          path: text(entry.path.trim(), 1024),
          relativePath: text(entry.relativePath || basename(entry.path), 512),
          title: text(entry.title || basename(entry.path), MAX_TITLE).trim() || basename(entry.path),
          kind: normalizeArtifactKind(entry.kind, entry.path),
          source: entry.source === 'worktree' ? 'worktree' : 'explicit',
          createdAt: Number(entry.createdAt) || Date.now(),
          updatedAt: Number(entry.updatedAt) || Number(entry.createdAt) || Date.now(),
        }))
    : [];
  return { version: 1, references, artifacts };
}

export function createLibraryManager(store) {
  const libraryFile = (projectId) => join(store.projectDir(projectId), LIBRARY_FILE);

  async function readRawDoc(projectId) {
    try {
      const raw = await readFile(libraryFile(projectId), 'utf8');
      return normalizeLibraryDoc(JSON.parse(raw));
    } catch (error) {
      if (error?.code === 'ENOENT') return { version: 1, references: [], artifacts: [] };
      return { version: 1, references: [], artifacts: [] };
    }
  }

  async function writeRawDoc(projectId, doc) {
    await mkdir(store.projectDir(projectId), { recursive: true });
    await writeFileAtomic(libraryFile(projectId), `${JSON.stringify(doc, null, 2)}\n`);
    return doc;
  }

  async function hydrateLibrary(project, doc) {
    const taskTitleById = new Map((project?.tasks || []).map((task) => [task.id, task.title]));
    const workspace = typeof project?.workspace === 'string' ? project.workspace.trim() : '';

    const references = await Promise.all(
      doc.references.map(async (ref) => {
        let exists = false;
        let size = 0;
        try {
          const info = await stat(ref.path);
          if (info.isFile()) {
            exists = true;
            size = info.size;
          }
        } catch {
          exists = false;
        }
        return {
          ...ref,
          relativePath: ref.relativePath || computeRelativeDisplay(ref.path, workspace),
          exists,
          size,
        };
      }),
    );

    const artifacts = doc.artifacts
      .map((art) => ({
        ...art,
        taskTitle: taskTitleById.get(art.taskId) || art.taskTitle || '',
      }))
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

    return { references, artifacts };
  }

  async function readLibrary(project) {
    const doc = await readRawDoc(project.id);
    return hydrateLibrary(project, doc);
  }

  async function validateReferencePath(project, rawPath) {
    const trimmed = text(rawPath, 1024).trim();
    if (!trimmed) throw httpError(400, 'path_required');
    if (hasUnsafeFileSyntax(trimmed)) {
      throw httpError(400, '不支持网络共享路径、设备路径或含异常字符的文件路径。', { code: 'invalid_reference_path' });
    }
    const workspace = typeof project?.workspace === 'string' ? project.workspace.trim() : '';
    const candidate = isAbsolute(trimmed)
      ? resolve(trimmed)
      : workspace
        ? resolve(workspace, trimmed)
        : '';
    if (!candidate) {
      throw httpError(400, '未设置项目工作区时，参考资料必须使用绝对路径。', { code: 'invalid_reference_path' });
    }
    let canonical;
    let info;
    try {
      canonical = await realpath(candidate);
      info = await stat(canonical);
    } catch {
      throw httpError(404, `找不到参考文件：${trimmed}`, { code: 'reference_not_found' });
    }
    if (!info.isFile()) {
      throw httpError(400, '参考资料只能添加文件，不支持直接添加目录。', { code: 'invalid_reference_path' });
    }
    if (hasGitSegment(canonical)) {
      throw httpError(403, '禁止添加 .git 目录下的内部文件。', { code: 'forbidden_reference_path' });
    }

    const realWorkspace = workspace ? await realpath(workspace).catch(() => '') : '';
    const insideWorkspace = Boolean(realWorkspace && withinPath(realWorkspace, canonical));
    if (!insideWorkspace) {
      const { roots, realDshHome, realTmp } = await sensitiveRefRoots(store.getHome());
      if (realDshHome && withinPath(realDshHome, canonical)) {
        const allowedMemory = join(store.projectDir(project.id), 'memory');
        const allowedDocs = join(store.projectDir(project.id), 'docs');
        const realMemory = await realpath(allowedMemory).catch(() => '');
        const realDocs = await realpath(allowedDocs).catch(() => '');
        const inOwnSafeDir = (realMemory && withinPath(realMemory, canonical))
          || (realDocs && withinPath(realDocs, canonical));
        if (!inOwnSafeDir) {
          throw httpError(403, '禁止将鲸屿内部数据文件添加为项目参考资料。', { code: 'forbidden_reference_path' });
        }
      }
      const inSystemTmp = Boolean(realTmp && withinPath(realTmp, canonical));
      if (!inSystemTmp && roots.some((root) => withinPath(root, canonical))) {
        throw httpError(403, '禁止将系统配置或密钥目录下的文件添加为项目参考资料。', { code: 'forbidden_reference_path' });
      }
    }

    return {
      canonical,
      size: info.size,
      relativePath: computeRelativeDisplay(canonical, realWorkspace || workspace),
    };
  }

  async function addReference(project, input = {}) {
    const validated = await validateReferencePath(project, input?.path);
    const title = text(input?.title, MAX_TITLE).trim() || basename(validated.canonical);
    const note = text(input?.note, MAX_NOTE).trim();

    const outcome = await store.withProjectLock(project.id, async () => {
      const doc = await readRawDoc(project.id);
      const wantedKey = pathKey(validated.canonical);
      const existing = doc.references.find((entry) => pathKey(entry.path) === wantedKey);
      let record;
      if (existing) {
        if (input?.title !== undefined && title) existing.title = title;
        if (input?.note !== undefined) existing.note = note;
        existing.relativePath = validated.relativePath;
        record = existing;
      } else {
        if (doc.references.length >= MAX_REFERENCES) {
          throw httpError(409, `项目参考资料已达上限（${MAX_REFERENCES} 条）。`);
        }
        record = {
          id: newId('ref'),
          path: validated.canonical,
          relativePath: validated.relativePath,
          title,
          note,
          addedAt: Date.now(),
        };
        doc.references.unshift(record);
      }
      await writeRawDoc(project.id, doc);
      const hydrated = await hydrateLibrary(project, doc);
      const hydratedRecord = hydrated.references.find((entry) => entry.id === record.id) || {
        ...record,
        exists: true,
        size: validated.size,
      };
      return { reference: hydratedRecord, references: hydrated.references };
    });

    store.emitChange({ type: 'library.updated', projectId: project.id });
    return outcome;
  }

  async function removeReference(project, refId) {
    const id = text(refId, 64).trim();
    if (!id) throw httpError(400, 'refId_required');

    const outcome = await store.withProjectLock(project.id, async () => {
      const doc = await readRawDoc(project.id);
      const idx = doc.references.findIndex((entry) => entry.id === id);
      if (idx < 0) throw httpError(404, 'reference_not_found');
      doc.references.splice(idx, 1);
      await writeRawDoc(project.id, doc);
      const hydrated = await hydrateLibrary(project, doc);
      return { deleted: true, refId: id, references: hydrated.references };
    });

    store.emitChange({ type: 'library.updated', projectId: project.id });
    return outcome;
  }

  async function resolveArtifactCandidate(project, task, rawPath) {
    const trimmed = text(rawPath, 1024).trim();
    if (!trimmed || hasUnsafeFileSyntax(trimmed) || hasGitSegment(trimmed)) return null;
    const baseRoot = (typeof task?.worktreePath === 'string' && task.worktreePath.trim())
      || (typeof project?.workspace === 'string' && project.workspace.trim())
      || '';
    if (!baseRoot) return null;
    const candidate = isAbsolute(trimmed) ? resolve(trimmed) : resolve(baseRoot, trimmed);
    let realBase;
    let canonical;
    try {
      realBase = await realpath(baseRoot);
      canonical = await realpath(candidate);
      const info = await stat(canonical);
      if (!info.isFile()) return null;
    } catch {
      return null;
    }
    if (!withinPath(realBase, canonical) || hasGitSegment(canonical)) return null;
    return {
      canonical,
      relativePath: computeRelativeDisplay(canonical, realBase),
    };
  }

  async function recordTaskArtifacts(project, task, items = [], { source = 'explicit', replaceSource = false } = {}) {
    if (!project?.id || !task?.id) return [];
    const list = Array.isArray(items) ? items : [];
    const resolved = [];
    const seenKeys = new Set();

    for (const raw of list.slice(0, 50)) {
      const rawPath = typeof raw === 'string' ? raw : raw?.path;
      const target = await resolveArtifactCandidate(project, task, rawPath);
      if (!target) continue;
      const key = pathKey(target.canonical);
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      const title = text(typeof raw === 'object' ? raw?.title : '', MAX_TITLE).trim() || basename(target.canonical);
      const kind = normalizeArtifactKind(typeof raw === 'object' ? raw?.kind : '', target.canonical);
      resolved.push({
        path: target.canonical,
        relativePath: target.relativePath,
        title,
        kind,
      });
    }

    if (resolved.length === 0 && !replaceSource) return [];

    const changed = await store.withProjectLock(project.id, async () => {
      const doc = await readRawDoc(project.id);
      const now = Date.now();
      let mutated = false;

      if (replaceSource) {
        const beforeCount = doc.artifacts.length;
        const incomingKeys = new Set(resolved.map((item) => pathKey(item.path)));
        doc.artifacts = doc.artifacts.filter(
          (entry) => !(entry.taskId === task.id && entry.source === source && !incomingKeys.has(pathKey(entry.path))),
        );
        if (doc.artifacts.length !== beforeCount) mutated = true;
      }

      for (const item of resolved) {
        const wantedKey = pathKey(item.path);
        const existing = doc.artifacts.find(
          (entry) => entry.taskId === task.id && pathKey(entry.path) === wantedKey,
        );
        if (existing) {
          existing.taskTitle = text(task.title, 200).trim() || existing.taskTitle;
          existing.relativePath = item.relativePath;
          if (source === 'explicit' || !existing.title) existing.title = item.title;
          existing.kind = item.kind;
          if (source === 'explicit') existing.source = 'explicit';
          existing.updatedAt = now;
          mutated = true;
        } else {
          doc.artifacts.push({
            id: newId('art'),
            taskId: task.id,
            taskTitle: text(task.title, 200).trim(),
            path: item.path,
            relativePath: item.relativePath,
            title: item.title,
            kind: item.kind,
            source,
            createdAt: now,
            updatedAt: now,
          });
          mutated = true;
        }
      }

      if (doc.artifacts.length > MAX_ARTIFACTS) {
        doc.artifacts = doc.artifacts.slice(-MAX_ARTIFACTS);
      }

      if (mutated) {
        await writeRawDoc(project.id, doc);
      }
      return { mutated, items: resolved };
    });

    if (changed.mutated) {
      store.emitChange({ type: 'library.updated', projectId: project.id });
    }
    return changed.items;
  }

  async function collectWorktreeArtifacts(project, task, diffFiles = []) {
    if (!Array.isArray(diffFiles)) return [];
    const nonDeleted = diffFiles
      .filter((entry) => entry && entry.path && String(entry.status || '').toUpperCase() !== 'D')
      .map((entry) => ({ path: entry.path, title: basename(entry.path) }));
    return recordTaskArtifacts(project, task, nonDeleted, {
      source: 'worktree',
      replaceSource: true,
    });
  }

  async function removeTaskArtifacts(projectId, taskId) {
    let mutated = false;
    await store.withProjectLock(projectId, async () => {
      const doc = await readRawDoc(projectId);
      const before = doc.artifacts.length;
      doc.artifacts = doc.artifacts.filter((entry) => entry.taskId !== taskId);
      if (doc.artifacts.length !== before) {
        await writeRawDoc(projectId, doc);
        mutated = true;
      }
    });
    if (mutated) store.emitChange({ type: 'library.updated', projectId });
  }

  async function isRegisteredLibraryFile(projectId, canonicalTarget) {
    const doc = await readRawDoc(projectId);
    const wanted = pathKey(canonicalTarget);
    return doc.references.some((entry) => pathKey(entry.path) === wanted)
      || doc.artifacts.some((entry) => pathKey(entry.path) === wanted);
  }

  function libraryIndexSync(projectId) {
    try {
      const raw = safeReadStoreFileSync(store.projectDir(projectId), LIBRARY_FILE, 65536);
      if (!raw) return '';
      const doc = normalizeLibraryDoc(JSON.parse(raw));
      if (doc.references.length === 0 && doc.artifacts.length === 0) return '';
      const lines = [];
      if (doc.references.length > 0) {
        lines.push(`References (${doc.references.length}):`);
        for (const ref of doc.references.slice(0, 15)) {
          const note = ref.note ? ` — ${ref.note}` : '';
          lines.push(`- ${ref.title} (${ref.relativePath})${note}`);
        }
        if (doc.references.length > 15) lines.push(`- …and ${doc.references.length - 15} more reference(s).`);
      }
      if (doc.artifacts.length > 0) {
        const recent = [...doc.artifacts].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 15);
        lines.push(`Task artifacts (${doc.artifacts.length}):`);
        for (const art of recent) {
          const from = art.taskTitle ? ` [from: ${art.taskTitle}]` : '';
          lines.push(`- ${art.relativePath}${from}`);
        }
        if (doc.artifacts.length > 15) lines.push(`- …and ${doc.artifacts.length - 15} more artifact(s).`);
      }
      const joined = lines.join('\n');
      return joined.length > MAX_LIBRARY_INDEX_CHARS
        ? `${joined.slice(0, MAX_LIBRARY_INDEX_CHARS).trimEnd()}…`
        : joined;
    } catch {
      return '';
    }
  }

  return {
    libraryFile,
    readLibrary,
    addReference,
    removeReference,
    recordTaskArtifacts,
    collectWorktreeArtifacts,
    removeTaskArtifacts,
    isRegisteredLibraryFile,
    libraryIndexSync,
  };
}
