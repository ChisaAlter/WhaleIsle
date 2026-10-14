const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const {
  loadWorkspaceAuthority,
  hasGitDirSegment,
  hasGitMetadataTarget,
  isPathInside,
} = require('./workspace-authority');

const MAX_READ_BYTES = 1024 * 1024;
const MAX_WRITE_BYTES = 1024 * 1024;

const IMAGE_MIME = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  avif: 'image/avif',
};

let workspaceAuthority = null;

/** Test seam: pin the trust root (node:test runs outside Electron). */
function setWorkspaceAuthority(authority) {
  workspaceAuthority = authority;
}

function authority() {
  if (workspaceAuthority === null) {
    workspaceAuthority = loadWorkspaceAuthority({ allowScratchCwd: true });
  }
  return workspaceAuthority;
}

function asCwd(cwd) {
  return authority().resolveAuthorizedCwd(cwd);
}

function resolveInside(cwd, relativePath) {
  return authority().resolveInside(cwd, relativePath);
}

function fail(message, code) {
  return { ok: false, message, ...(code ? { code } : {}) };
}

/**
 * Canonicalize a path that `resolveInside` already accepted, immediately
 * before the privileged effect. `resolveInside` returns the *lexical* target,
 * so a directory can be replaced by a link between that check and the read or
 * write that follows (check-then-use). Resolving to the real path and testing
 * containment and `.git` again while `resolveInside`'s anchors are verified
 * against the swapped-in link rather than against the name that was requested.
 *
 * A not-yet-existing target is rebuilt from its deepest existing ancestor's
 * canonical path, so a missing file still surfaces its own ENOENT instead of
 * this helper's refusal.
 *
 * Returns the canonical path, or null when it is no longer inside an
 * authorized root or lands in `.git`. This narrows the race; it does not make
 * the sequence atomic, so it is not a substitute for the authority check.
 * @param {string} cwd - the authorized cwd the caller resolved against.
 * @param {string} target - the lexical target `resolveInside` returned.
 * @returns {Promise<string | null>}
 */
async function canonicalInside(cwd, target, authorityForRead = authority()) {
  const base = authorityForRead.resolveAuthorizedCwd(cwd);
  if (!base) return null;
  let node = target;
  const tail = [];
  let real = null;
  while (true) {
    try {
      // Use the same resolver as authorization, including Windows logical
      // paths for package-virtualized AppData files.
      real = fs.realpathSync(node);
      break;
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') return null;
      // An existing node whose realpath cannot be resolved is a dangling link
      // (or an unreadable entry), not a path component that is merely absent.
      // Folding it into `tail` would hand the caller a path that still follows
      // the link at the moment of the write.
      if (await nodeExists(node)) return null;
      const parent = path.dirname(node);
      if (parent === node) return null;
      tail.unshift(path.basename(node));
      node = parent;
    }
  }
  if (!isPathInside(base, real)) return null;
  if (hasGitDirSegment(path.relative(base, real)) || hasGitMetadataTarget(real)) return null;
  return tail.length === 0 ? real : path.join(real, ...tail);
}

async function nodeExists(target) {
  try {
    await fs.promises.lstat(target);
    return true;
  } catch {
    return false;
  }
}

function entryRelativePath(relativePath, name) {
  const base = relativePath.replace(/\\/g, '/').replace(/\/+$/, '');
  return base ? `${base}/${name}` : name;
}

/**
 * Classify a directory's entries with one `git check-ignore --stdin -z` batch
 * (one spawn per listed directory instead of one per entry).
 * @param {string} cwd - workspace root git runs in.
 * @param {string[]} relPaths - entry paths relative to cwd.
 * @returns {Promise<{ ignored: Set<string>, gitMissing: boolean }>} ignored
 * paths, or an empty set with `gitMissing` when git is absent or fails
 * (every entry is then listed, matching the previous per-entry fallback).
 */
function gitIgnoredSet(cwd, relPaths) {
  return new Promise((resolve) => {
    if (relPaths.length === 0) {
      resolve({ ignored: new Set(), gitMissing: false });
      return;
    }
    const child = spawn('git', ['-C', cwd, 'check-ignore', '--no-index', '--stdin', '-z'], {
      windowsHide: true,
    });
    const chunks = [];
    let settled = false;
    child.on('error', () => {
      settled = true;
      resolve({ ignored: new Set(), gitMissing: true });
    });
    child.stdout.on('data', (chunk) => chunks.push(chunk));
    child.on('close', (code) => {
      if (settled) return;
      // check-ignore exits 0 when some paths are ignored and 1 when none are;
      // anything else (128: not a repo error, bad input) falls back to unfiltered.
      if (code !== 0 && code !== 1) {
        resolve({ ignored: new Set(), gitMissing: true });
        return;
      }
      const out = Buffer.concat(chunks).toString('utf8');
      resolve({
        ignored: new Set(out.split('\0').filter((part) => part.length > 0)),
        gitMissing: false,
      });
    });
    // EPIPE when git exits before consuming stdin; close settles the promise.
    child.stdin.on('error', () => {});
    child.stdin.end(`${relPaths.join('\0')}\0`);
  });
}

async function listDir(cwd, relativePath) {
  const target = resolveInside(cwd, relativePath);
  if (!target) return fail('Path is outside the workspace.', 'workspace/outside');
  const realTarget = await canonicalInside(cwd, target);
  if (!realTarget) return fail('Path is outside the workspace.', 'workspace/outside');
  let names;
  try {
    names = await fs.promises.readdir(realTarget, { withFileTypes: true });
  } catch (error) {
    return fail(error.message || 'Could not list directory.');
  }
  const candidates = names.filter((entry) => entry.name !== '.git');
  const relPaths = candidates.map((entry) => entryRelativePath(relativePath, entry.name));
  const { ignored, gitMissing } = await gitIgnoredSet(cwd, relPaths);
  const entries = [];
  for (let index = 0; index < candidates.length; index += 1) {
    if (!gitMissing && ignored.has(relPaths[index])) continue;
    entries.push({
      name: candidates[index].name,
      kind: candidates[index].isDirectory() ? 'directory' : 'file',
    });
  }
  entries.sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === 'directory' ? -1 : 1;
    return left.name.localeCompare(right.name);
  });
  return { ok: true, entries };
}

function looksBinary(buf) {
  const n = Math.min(buf.length, 8192);
  for (let i = 0; i < n; i += 1) {
    if (buf[i] === 0) return true;
  }
  return false;
}

async function readFileUsing(authorityForRead, cwd, relativePath) {
  if (typeof relativePath !== 'string' || relativePath.trim() === '') {
    return fail('File path is required.');
  }
  const target = authorityForRead.resolveInside(cwd, relativePath);
  if (!target) return fail('Path is outside the workspace.');
  const realTarget = await canonicalInside(cwd, target, authorityForRead);
  if (!realTarget) return fail('Path is outside the workspace.');
  let stat;
  try {
    stat = await fs.promises.stat(realTarget);
  } catch (error) {
    return fail(error.message || 'Could not read file.');
  }
  if (!stat.isFile()) return fail('Not a file.');
  const truncated = stat.size > MAX_READ_BYTES;
  let buf;
  try {
    if (truncated) {
      const handle = await fs.promises.open(realTarget, 'r');
      try {
        const slice = Buffer.alloc(MAX_READ_BYTES);
        const { bytesRead } = await handle.read(slice, 0, MAX_READ_BYTES, 0);
        buf = slice.subarray(0, bytesRead);
      } finally {
        await handle.close();
      }
    } else {
      buf = await fs.promises.readFile(realTarget);
    }
  } catch (error) {
    return fail(error.message || 'Could not read file.');
  }
  if (looksBinary(buf)) {
    return { ok: true, binary: true, text: '', truncated };
  }
  return { ok: true, binary: false, text: buf.toString('utf8'), truncated };
}

/**
 * Main-process preview reader. The injected authority can include the
 * Host-owned scratch cwd without widening the ordinary filesystem IPC.
 * @param {{ resolveAuthorizedCwd: Function, resolveInside: Function }} authorityForRead
 */
function createWorkspaceFileReader(authorityForRead) {
  if (!authorityForRead || typeof authorityForRead.resolveAuthorizedCwd !== 'function') {
    throw new TypeError('workspace file reader requires a workspace authority');
  }
  return {
    readFile(cwd, relativePath) {
      return readFileUsing(authorityForRead, cwd, relativePath);
    },
  };
}

async function readFile(cwd, relativePath) {
  return readFileUsing(authority(), cwd, relativePath);
}

async function readFileMedia(cwd, relativePath) {
  if (typeof relativePath !== 'string' || relativePath.trim() === '') {
    return fail('File path is required.');
  }
  const ext = path.extname(relativePath).slice(1).toLowerCase();
  const mime = IMAGE_MIME[ext];
  if (!mime) return fail('Not an image file.');
  const target = resolveInside(cwd, relativePath);
  if (!target) return fail('Path is outside the workspace.');
  const realTarget = await canonicalInside(cwd, target);
  if (!realTarget) return fail('Path is outside the workspace.');
  let stat;
  try {
    stat = await fs.promises.stat(realTarget);
  } catch (error) {
    return fail(error.message || 'Could not read file.');
  }
  if (!stat.isFile()) return fail('Not a file.');
  const truncated = stat.size > MAX_READ_BYTES;
  let buf;
  try {
    if (truncated) {
      const handle = await fs.promises.open(realTarget, 'r');
      try {
        const slice = Buffer.alloc(MAX_READ_BYTES);
        const { bytesRead } = await handle.read(slice, 0, MAX_READ_BYTES, 0);
        buf = slice.subarray(0, bytesRead);
      } finally {
        await handle.close();
      }
    } else {
      buf = await fs.promises.readFile(realTarget);
    }
  } catch (error) {
    return fail(error.message || 'Could not read file.');
  }
  return { ok: true, mime, base64: buf.toString('base64'), truncated };
}

/**
 * True when any path segment is `.git` (case-insensitive: Windows/macOS
 * filesystems resolve `.GIT` to the same node). listDir already hides `.git`;
 * writes must not reach it either (L-4) — a save into `.git/hooks/…` or
 * `.git/config` escalates to code execution on the next git invocation, and
 * overwriting a `.git` gitlink file corrupts worktrees/submodules.
 *
 * Kept separate from the authority check so the refusal carries a specific
 * message; `resolveInside` enforces the same rule as a backstop, including for
 * links with innocuous names that resolve into `.git`.
 */
function touchesGitDir(relativePath) {
  return hasGitDirSegment(relativePath);
}

async function writeFile(cwd, relativePath, text) {
  if (typeof relativePath !== 'string' || relativePath.trim() === '') {
    return fail('File path is required.');
  }
  if (typeof text !== 'string') return fail('File text is required.');
  if (Buffer.byteLength(text, 'utf8') > MAX_WRITE_BYTES) {
    return fail('File is too large to save from this panel.');
  }
  if (touchesGitDir(relativePath)) {
    return fail('Saving inside .git is not allowed.');
  }
  const target = resolveInside(cwd, relativePath);
  if (!target) return fail('Path is outside the workspace.');
  try {
    const stat = await fs.promises.stat(target);
    if (!stat.isFile()) return fail('Not a file.');
  } catch (error) {
    if (error.code !== 'ENOENT') {
      return fail(error.message || 'Could not write file.');
    }
  }
  try {
    const parent = path.dirname(target);
    await fs.promises.mkdir(parent, { recursive: true });
    // Re-check after the await: the chain can be swapped for a link between
    // `resolveInside` and here (check-then-use). Validate the complete
    // destination — final component included — and write to that canonical
    // path so a dangling or outside-resolving link cannot receive the bytes.
    const realTarget = await canonicalInside(cwd, target);
    if (!realTarget) return fail('Path is outside the workspace.');
    await fs.promises.writeFile(realTarget, text, 'utf8');
  } catch (error) {
    return fail(error.message || 'Could not write file.');
  }
  return { ok: true };
}

module.exports = {
  listDir,
  readFile,
  createWorkspaceFileReader,
  readFileMedia,
  writeFile,
  createWorkspaceFileReader,
  setWorkspaceAuthority,
  MAX_WRITE_BYTES,
};
