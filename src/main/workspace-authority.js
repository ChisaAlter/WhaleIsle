const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { getDesktopDshHome, tryGetDesktopDshHome } = require('../shared/dsh-home');

/**
 * Workspace authority: the trust roots for desktop capabilities that touch
 * the filesystem (git, PTY, file browse/read). Every renderer-supplied cwd
 * must resolve inside the configured boot workspace, an explicit extra root
 * (for example the Host-owned no-workspace scratch cwd), or a workspace the
 * running harness has persisted under `$DSH_HOME/storages/workspace.json`.
 * Those registered roots may be siblings of the boot folder (a user-opened
 * project). A plugin that writes a filesystem root (`C:\`, `/`) into that
 * file does not expand the allowlist to the whole volume.
 * @param {{
 *   workspace?: string,
 *   extraWorkspaces?: unknown,
 *   listRegisteredWorkspaces?: () => unknown,
 * }} options - boot workspace plus optional extra roots.
 */
function createWorkspaceAuthority({
  workspace = '',
  extraWorkspaces = [],
  listRegisteredWorkspaces,
} = {}) {
  function bootRoot() {
    return typeof workspace === 'string' && workspace.trim() !== ''
      ? path.resolve(workspace)
      : null;
  }

  /**
   * The configured boot filesystem root (null when none is configured).
   * Extra harness-registered roots are not this value; use
   * {@link authorizedRoots} for the live allowlist.
   */
  function authorizedRoot() {
    return bootRoot();
  }

  /** Live allowlist: boot workspace plus every extra / registered root. */
  function authorizedRoots() {
    return collectRoots([bootRoot(), ...listExtras()]);
  }

  function listExtras() {
    const extras = Array.isArray(extraWorkspaces) ? extraWorkspaces : [];
    const listed = typeof listRegisteredWorkspaces === 'function'
      ? safeListedWorkspaces(listRegisteredWorkspaces)
      : [];
    return [...extras, ...listed];
  }

  /**
   * Accept a renderer-supplied cwd only when its real path is an authorized
   * root or one of that root's real subdirectories. Rejects nonexistent
   * paths, files, `..`/absolute escapes, and symlinks that resolve outside
   * every root.
   * @param {unknown} candidate - the renderer-supplied cwd.
   * @returns {string | null} the canonical real authorized cwd, or null.
   */
  function resolveAuthorizedCwd(candidate) {
    if (typeof candidate !== 'string' || candidate.trim() === '') {
      return null;
    }
    const resolved = path.resolve(candidate);
    // Use the same native canonical spelling as async file operations (DOS 8.3 on Windows).
    let real;
    try {
      if (!fs.statSync(resolved).isDirectory()) return null;
      real = fs.realpathSync.native(resolved);
    } catch {
      return null;
    }
    for (const root of authorizedRoots()) {
      if (!containedIn(root, real)) continue;
      // The `.git` rule is anchored to the trusted root, never to the caller's
      // chosen base. Without this, `writeFile(cwd, 'hooks/pre-commit')` with
      // cwd = <root>/.git produces a relative path that no longer contains the
      // segment, and the metadata directory becomes writable again.
      if (hasGitDirSegment(path.relative(root, real))) continue;
      return real;
    }
    return null;
  }

  /**
   * Resolve a relative path inside an authorized cwd, refusing traversal and
   * symlink escapes: the deepest existing node on the target chain must stay
   * inside the base after realpath normalization. Symlinks that stay inside
   * the workspace (pnpm store links) keep working.
   *
   * Paths that spell or *land in* a `.git` directory are refused here so every
   * caller (files, git, editors, preview) shares one rule. The spelled form is
   * not enough: a link with an innocent name (`notes` -> `.git`) resolves into
   * the repository metadata, and a save there escalates to code execution
   * through hooks. See `hasGitDirSegment`.
   * @param {unknown} cwd - the renderer-supplied cwd (authorized first).
   * @param {unknown} relativePath - path relative to the cwd.
   * @returns {string | null} the canonical target, or null.
   */
  function resolveInside(cwd, relativePath) {
    const base = resolveAuthorizedCwd(cwd);
    if (base === null) return null;
    const rel = typeof relativePath === 'string' ? relativePath : '';
    const target = path.resolve(base, rel);
    const fromBase = path.relative(base, target);
    if (escapesBase(fromBase)) return null;
    if (hasGitDirSegment(fromBase)) return null;
    let node = target;
    while (true) {
      const nodeReal = realPathOrNull(node);
      if (nodeReal !== null) {
        if (!containedIn(base, nodeReal)) return null;
        // Canonical form: catches `.git` reached through a link whose own name
        // is innocuous, and `.GIT` on case-insensitive filesystems.
        if (hasGitDirSegment(path.relative(base, nodeReal))) return null;
        return target;
      }
      // realpath failed. Only a genuinely absent node may be folded into a
      // not-yet-existing path: an existing link whose destination cannot be
      // resolved is a dangling link, and a later write would follow it to a
      // destination this check never authorized.
      if (!isAbsentNode(node)) return null;
      const parent = path.dirname(node);
      if (parent === node) return null;
      node = parent;
    }
  }

  return { authorizedRoot, authorizedRoots, resolveAuthorizedCwd, resolveInside };
}

function safeListedWorkspaces(listRegisteredWorkspaces) {
  try {
    const listed = listRegisteredWorkspaces();
    return Array.isArray(listed) ? listed : [];
  } catch {
    return [];
  }
}

function collectRoots(candidates) {
  const seen = new Set();
  const roots = [];
  for (const raw of candidates) {
    if (typeof raw !== 'string' || raw.trim() === '') continue;
    const resolved = path.resolve(raw);
    try {
      if (!fs.statSync(resolved).isDirectory()) continue;
    } catch {
      continue;
    }
    // Roots and checked cwds must live on the same path plane: a lexical root
    // (e.g. macOS /var/...) never contains the realpathSync'd candidate
    // (/private/var/...), so every accepted root is canonicalized here.
    let real;
    try {
      real = fs.realpathSync.native(resolved);
    } catch {
      continue;
    }
    const key = identityKey(real);
    if (seen.has(key)) continue;
    seen.add(key);
    roots.push(real);
  }
  return roots;
}

function identityKey(resolved) {
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

/**
 * Canonical real path of a maybe-missing node, or null when it does not
 * exist (ENOENT and friends).
 * @param {string} target - the node to resolve.
 * @returns {string | null} the realpath, or null.
 */
function realPathOrNull(target) {
  try {
    return fs.realpathSync.native(target);
  } catch {
    return null;
  }
}

/**
 * True when `node` genuinely does not exist. `realpath` also fails for a
 * dangling link (and for unreadable nodes), which must not be mistaken for an
 * absent path component.
 * @param {string} node
 * @returns {boolean}
 */
function isAbsentNode(node) {
  try {
    fs.lstatSync(node);
    return false;
  } catch (error) {
    return error.code === 'ENOENT' || error.code === 'ENOTDIR';
  }
}

function containedIn(root, candidate) {
  const fromRoot = path.relative(root, candidate);
  return !escapesBase(fromRoot);
}

/**
 * `path.relative()` reports a path outside the base either as absolute (other
 * drive/UNC) or as a string starting with `..`. A bare `startsWith('..')`
 * over-rejects real names: a child literally called `..notes` (or `..cache`
 * under a subdirectory) yields exactly that relative form. Only `..` itself and
 * a `..<separator>` prefix are actual traversal.
 */
function escapesBase(fromBase) {
  if (path.isAbsolute(fromBase)) return true;
  return fromBase === '..' || fromBase.startsWith(`..${path.sep}`);
}

/**
 * True when `candidate` is `root` itself or one of its descendants. Both are
 * resolved first, so this is a lexical containment test; callers that accept
 * untrusted input must realpath first (see {@link createWorkspaceAuthority}).
 *
 * Use this instead of `relative(root, candidate).startsWith('..')`, which
 * over-rejects real names such as `..notes`.
 * @param {string} root
 * @param {string} candidate
 * @returns {boolean}
 */
function isPathInside(root, candidate) {
  const fromRoot = path.relative(path.resolve(root), path.resolve(candidate));
  return !escapesBase(fromRoot);
}

/**
 * True when any segment of a relative path is `.git` (case-insensitive, both
 * separator styles). A `.git` directory holds hooks, config, and refs: writing
 * there runs attacker-chosen code on the next git invocation, so the desktop
 * surface never addresses it. Names that merely start with `.git` (`.gitignore`,
 * `.github`, `git.txt`) are ordinary files and stay reachable.
 * @param {string} relativePath
 * @returns {boolean}
 */
function hasGitDirSegment(relativePath) {
  return String(relativePath)
    .split(/[\\/]+/)
    .some((segment) => segment.toLowerCase() === '.git');
}

function dshHome() {
  return getDesktopDshHome();
}

/**
 * Host-owned cwd used by sessions that are not attached to a Workspace.
 * @param {string} [homeDir] - harness home; defaults to the desktop DSH home.
 * @returns {string} the no-workspace scratch directory.
 */
function scratchWorkspacePath(homeDir = dshHome()) {
  return path.join(homeDir, 'no-workspace');
}

/**
 * Paths persisted by `dsh-workspace` under `$DSH_HOME/storages/workspace.json`.
 * Missing, unreadable, or malformed files yield an empty list rather than
 * disabling the boot workspace.
 * @param {string} [homeDir] - harness home; defaults to the desktop DSH home.
 * @returns {string[]} registered workspace paths.
 */
function readHarnessRegisteredWorkspacePaths(homeDir = dshHome()) {
  const file = path.join(homeDir, 'storages', 'workspace.json');
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  let document;
  try {
    document = JSON.parse(text);
  } catch {
    return [];
  }
  if (typeof document !== 'object' || document === null) return [];
  const unit = document.unit;
  if (typeof unit !== 'object' || unit === null || unit.name !== 'workspace') {
    return [];
  }
  const tables = document.tables;
  if (typeof tables !== 'object' || tables === null) return [];
  const records = tables.workspaces;
  if (typeof records !== 'object' || records === null || Array.isArray(records)) {
    return [];
  }
  const paths = [];
  for (const record of Object.values(records)) {
    if (typeof record !== 'object' || record === null) continue;
    if (typeof record.path === 'string' && record.path.trim() !== '') {
      paths.push(record.path);
    }
  }
  return paths;
}

/**
 * App-created worktrees are execution directories, not user Workspace rows.
 * Only exact ready receipts beneath the desktop home add a root; neither the
 * Project store nor a receipt-supplied arbitrary path becomes authorized.
 */
function readProjectExecutionPaths(homeDir = dshHome()) {
  const paths = [];
  let realHome;
  try { realHome = fs.realpathSync.native(homeDir); } catch { return paths; }
  const safePath = (...parts) => {
    let current = realHome;
    for (const part of parts) {
      current = path.join(current, part);
      try {
        if (fs.lstatSync(current).isSymbolicLink()
          || identityKey(fs.realpathSync.native(current)) !== identityKey(current)) return null;
      } catch { return null; }
    }
    return current;
  };
  const projects = safePath('projects');
  if (!projects) return paths;
  let projectIds;
  try { projectIds = fs.readdirSync(projects); } catch { return paths; }
  for (const projectId of projectIds) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,100}$/.test(projectId)) continue;
    const bindings = safePath('projects', projectId, 'internal', 'desktop-workspaces');
    if (!bindings) continue;
    let files;
    try { files = fs.readdirSync(bindings); } catch { continue; }
    for (const filename of files) {
      const workstreamId = filename.replace(/\.json$/, '');
      if (filename !== `${workstreamId}.json` || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,100}$/.test(workstreamId)) continue;
      const file = safePath('projects', projectId, 'internal', 'desktop-workspaces', filename);
      const cwd = safePath('project-worktrees', projectId, workstreamId);
      if (!file || !cwd) continue;
      try {
        const record = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (record.projectId !== projectId || record.workstreamId !== workstreamId
          || record.ownership !== 'project' || record.mode !== 'worktree' || record.state !== 'ready'
          || typeof record.receipt !== 'string' || !record.receipt
          || typeof record.canonicalPath !== 'string'
          || identityKey(record.canonicalPath) !== identityKey(cwd)
          || record.directoryIdentity !== identityKey(cwd) || !fs.statSync(cwd).isDirectory()) continue;
        paths.push(cwd);
      } catch { /* An unavailable or invalid receipt grants no authority. */ }
    }
  }
  return paths;
}

/**
 * True when `dir` is a volume root (`C:\`, `/`). Registering that path would
 * authorize every file on the volume for Git/FS/PTY.
 * @param {string} dir
 * @returns {boolean}
 */
function isFilesystemRoot(dir) {
  const resolved = path.resolve(dir);
  return path.parse(resolved).root === resolved;
}

/**
 * Sensitive anchors that a plugin-writable trust root must never equal or
 * contain: the user home (SSH keys, credentials), the per-user config trees
 * (`%APPDATA%`, `Application Support`, `~/.config`), and the desktop
 * userData/dsh-home (this app's own config, tokens, sessions).
 * @returns {string[]} canonical anchor paths that exist on this machine.
 */
function highRiskAnchorPaths() {
  const candidates = [];
  const home = os.homedir();
  if (home) {
    candidates.push(home);
    if (process.platform === 'darwin') {
      candidates.push(path.join(home, 'Library'), path.join(home, 'Library', 'Application Support'));
    }
    candidates.push(path.join(home, '.config'), path.join(home, '.ssh'));
  }
  for (const key of ['APPDATA', 'LOCALAPPDATA', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME']) {
    const value = process.env[key];
    if (typeof value === 'string' && value.trim() !== '') candidates.push(value);
  }
  const desktopHome = tryGetDesktopDshHome();
  if (desktopHome) {
    candidates.push(desktopHome, path.dirname(desktopHome));
  }
  const anchors = [];
  for (const candidate of candidates) {
    const real = realPathOrNull(path.resolve(candidate));
    if (real !== null) anchors.push(real);
  }
  return anchors;
}

/**
 * True when trusting `real` as a workspace root would expose a high-risk
 * anchor: the root equals an anchor or is one of its ancestors (the anchor
 * lives inside the root). Ordinary project folders — including siblings of
 * the boot workspace under Documents or any dev directory — contain none of
 * the anchors and stay accepted.
 * @param {string} real - canonical registered root.
 * @param {string[]} [anchors] - injectable for tests.
 * @returns {boolean}
 */
function isHighRiskWorkspaceRoot(real, anchors = highRiskAnchorPaths()) {
  return anchors.some((anchor) => containedIn(real, anchor));
}

/**
 * Harness `workspace.json` is plugin-writable. Keep user-opened project
 * folders (including siblings of the boot workspace); drop volume roots and
 * high-risk ancestors (user home, `%APPDATA%` / Application Support,
 * userData / desktop dsh-home).
 * @param {unknown[]} listed
 * @returns {string[]}
 */
function filterRegisteredWorkspaceRoots(listed) {
  const rows = Array.isArray(listed) ? listed : [];
  const anchors = highRiskAnchorPaths();
  return rows.filter((raw) => {
    if (typeof raw !== 'string' || raw.trim() === '') return false;
    try {
      const real = fs.realpathSync.native(path.resolve(raw));
      return !isFilesystemRoot(real) && !isHighRiskWorkspaceRoot(real, anchors);
    } catch {
      return false;
    }
  });
}

/**
 * Lazy production authority bound to the configured boot workspace plus the
 * harness-registered workspace paths. PTY callers may also opt into the
 * Host-owned no-workspace scratch directory; filesystem and Git callers keep
 * the stricter default. Outside Electron (node:test) without an injected
 * authority this yields a null root, which disables the capability rather
 * than crashing the test process.
 * @param {{ allowScratchCwd?: boolean }} [options]
 */
function loadWorkspaceAuthority(options = {}) {
  try {
    const { loadConfig } = require('./config');
    return createWorkspaceAuthority({
      workspace: loadConfig().workspace,
      extraWorkspaces: options.allowScratchCwd ? [scratchWorkspacePath()] : [],
      listRegisteredWorkspaces: () => [
        ...filterRegisteredWorkspaceRoots(readHarnessRegisteredWorkspacePaths()),
        ...readProjectExecutionPaths(),
      ],
    });
  } catch {
    return createWorkspaceAuthority({ workspace: '' });
  }
}

module.exports = {
  createWorkspaceAuthority,
  loadWorkspaceAuthority,
  readHarnessRegisteredWorkspacePaths,
  readProjectExecutionPaths,
  filterRegisteredWorkspaceRoots,
  isHighRiskWorkspaceRoot,
  highRiskAnchorPaths,
  scratchWorkspacePath,
  hasGitDirSegment,
  isPathInside,
};
