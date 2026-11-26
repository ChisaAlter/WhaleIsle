const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { spawnTreeOptions } = require('../shared/process-tree');
const { invalidateReadContext } = require('./git-read-context');
const {
  runGit,
  asCwd,
  safeRefName,
  fail,
  ok,
  gitChildEnv,
  gitFailureMessage,
  killProcessTree,
  resolveInsideWorkspace,
  GIT_TIMEOUT_MS,
  GIT_MAX_OUTPUT_BYTES,
} = require('./git-exec');

const MAX_UNTRACKED_BYTES = 256 * 1024;
const MAX_PATCH_BYTES = 8 * 1024 * 1024;
const GIT_UNAVAILABLE = 'Git is unavailable. Install Git for Windows: run "winget install Git.Git" or download https://git-scm.com/download/win';

const GIT_C_ESCAPES = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13 };

/**
 * Decode a Git C-quoted path body (inside surrounding double quotes), including
 * UTF-8 octal byte escapes such as `\344\270\255`.
 * @param {string} inner
 * @returns {string}
 */
function decodeGitCQuotedBody(inner) {
  /** @type {number[]} */
  const bytes = [];
  for (let i = 0; i < inner.length; i += 1) {
    if (inner[i] === '\\' && i + 1 < inner.length) {
      const oct = /^[0-7]{3}/.exec(inner.slice(i + 1, i + 4));
      if (oct) {
        bytes.push(Number.parseInt(oct[0], 8));
        i += 3;
        continue;
      }
      const next = inner[i + 1];
      if (Object.prototype.hasOwnProperty.call(GIT_C_ESCAPES, next)) {
        bytes.push(GIT_C_ESCAPES[/** @type {keyof typeof GIT_C_ESCAPES} */ (next)]);
      } else {
        for (const b of Buffer.from(next, 'utf8')) bytes.push(b);
      }
      i += 1;
      continue;
    }
    for (const b of Buffer.from(inner[i], 'utf8')) bytes.push(b);
  }
  return Buffer.from(bytes).toString('utf8');
}

function unquoteGitPath(spec) {
  const trimmed = String(spec || '').split('\t')[0].trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
    return decodeGitCQuotedBody(trimmed.slice(1, -1));
  }
  return trimmed;
}

function stripAbPrefix(spec) {
  if (spec.startsWith('a/') || spec.startsWith('b/')) return spec.slice(2);
  return spec;
}

function parseDiffGitArgs(rest) {
  const tokens = [];
  let i = 0;
  while (i < rest.length) {
    while (rest[i] === ' ') i += 1;
    if (i >= rest.length) break;
    if (rest[i] === '"') {
      let j = i + 1;
      while (j < rest.length) {
        if (rest[j] === '\\' && j + 1 < rest.length) {
          j += 2;
          continue;
        }
        if (rest[j] === '"') break;
        j += 1;
      }
      tokens.push(decodeGitCQuotedBody(rest.slice(i + 1, j)));
      i = j < rest.length ? j + 1 : j;
      continue;
    }
    const space = rest.indexOf(' ', i);
    if (space < 0) {
      tokens.push(rest.slice(i));
      break;
    }
    tokens.push(rest.slice(i, space));
    i = space;
  }
  return tokens;
}

function pathFromDiffGit(line) {
  const tokens = parseDiffGitArgs(line.slice('diff --git '.length));
  const dst = tokens[1] || tokens[0] || '';
  return stripAbPrefix(dst);
}

function pathFromPlusMinus(spec) {
  const cleaned = unquoteGitPath(spec);
  if (cleaned === '' || cleaned === '/dev/null') return null;
  return stripAbPrefix(cleaned);
}

function parseUnifiedDiff(text) {
  const files = [];
  let current = null;
  let hunk = null;
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      if (current) files.push(current);
      current = { path: pathFromDiffGit(line), status: 'modified', hunks: [] };
      hunk = null;
      continue;
    }
    if (!current) continue;
    if (line.startsWith('new file mode')) {
      current.status = 'added';
      continue;
    }
    if (line.startsWith('deleted file mode')) {
      current.status = 'deleted';
      continue;
    }
    if (line.startsWith('rename from ')) {
      current.status = 'renamed';
      current.oldPath = line.slice('rename from '.length);
      continue;
    }
    if (hunk === null && line.startsWith('+++ ')) {
      const next = pathFromPlusMinus(line.slice(4));
      if (next !== null) current.path = next;
      continue;
    }
    if (hunk === null && line.startsWith('--- ')) {
      const next = pathFromPlusMinus(line.slice(4));
      if (next !== null && !current.path) current.path = next;
      continue;
    }
    if (line.startsWith('@@')) {
      hunk = { header: line, lines: [] };
      current.hunks.push(hunk);
      continue;
    }
    if (!hunk) continue;
    if (line.startsWith('+')) hunk.lines.push({ kind: 'add', text: line.slice(1) });
    else if (line.startsWith('-')) hunk.lines.push({ kind: 'del', text: line.slice(1) });
    else if (line.startsWith('\\')) hunk.lines.push({ kind: 'eof', text: line.slice(1).trim() });
    else if (line.startsWith(' ')) hunk.lines.push({ kind: 'context', text: line.slice(1) });
  }
  if (current) files.push(current);
  return files;
}

const BINARY_PREFIX_BYTES = 8192;

/**
 * @param {string} target
 * @returns {boolean}
 */
function hasBinaryNullByte(target) {
  const fd = fs.openSync(target, 'r');
  try {
    const probe = Buffer.allocUnsafe(BINARY_PREFIX_BYTES);
    const read = fs.readSync(fd, probe, 0, BINARY_PREFIX_BYTES, 0);
    return probe.subarray(0, read).includes(0);
  } finally {
    fs.closeSync(fd);
  }
}

function hasGitSegment(/** @type {string} */ relativePath) {
  return relativePath.split(/[\\/]+/).some((/** @type {string} */ seg) => seg.toLowerCase() === '.git');
}

function untrackedAsDiff(root, rel) {
  if (typeof rel !== 'string' || rel.trim() === '' || rel.includes('\0')) return null;
  if (!isSafePatchTarget(root, rel)) return null;
  const target = resolveInsideWorkspace(root, rel);
  if (!target) return null;
  let stat;
  try {
    stat = fs.lstatSync(target);
  } catch {
    return null;
  }
  if (stat.isSymbolicLink() || !stat.isFile()) return null;
  let realRoot;
  let realTarget;
  try {
    realRoot = fs.realpathSync(root);
    realTarget = fs.realpathSync(target);
  } catch {
    return null;
  }
  const relReal = path.relative(realRoot, realTarget);
  if (relReal === '' || relReal === '..' || relReal.startsWith(`..${path.sep}`) || path.isAbsolute(relReal)) {
    return null;
  }
  if (hasGitSegment(relReal)) return null;
  if (stat.size > MAX_UNTRACKED_BYTES) {
    return hasBinaryNullByte(realTarget)
      ? { path: rel, status: 'added', binary: true, hunks: [] }
      : { path: rel, status: 'added', tooLarge: true, hunks: [] };
  }
  const buf = fs.readFileSync(realTarget);
  if (buf.includes(0)) {
    return { path: rel, status: 'added', binary: true, hunks: [] };
  }
  const body = buf.toString('utf8').replace(/\r\n/g, '\n');
  const rows = body.split('\n');
  if (rows.length > 0 && rows[rows.length - 1] === '') rows.pop();
  return {
    path: rel,
    status: 'added',
    hunks: [{
      header: `@@ -0,0 +1,${rows.length} @@`,
      lines: rows.map((text) => ({ kind: 'add', text })),
    }],
  };
}

/**
 * Validate and normalize a workspace-relative diff path target.
 * @param {string} root
 * @param {unknown} rawPath
 * @returns {string | null}
 */
function normalizeSafeDiffPath(root, rawPath) {
  if (typeof rawPath !== 'string' || rawPath.trim() === '' || rawPath.includes('\0')) {
    return null;
  }
  if (!isSafePatchTarget(root, rawPath)) return null;
  const target = resolveInsideWorkspace(root, rawPath);
  if (!target) return null;
  const rel = path.relative(root, target).replaceAll('\\', '/');
  if (!rel || !isSafePatchTarget(root, rel)) return null;
  return rel;
}

/**
 * Validate and normalize `gitDiff` options.
 * @param {string} root
 * @param {{ baseRef?: unknown, path?: unknown, staged?: unknown } | null | undefined} options
 * @returns {{ requested: string | null, targetPath: string | null, staged: boolean | undefined } | null}
 */
function resolveDiffOptions(root, options) {
  const rawBase = options?.baseRef;
  if (rawBase !== undefined && typeof rawBase !== 'string') return null;
  const requested = typeof rawBase === 'string' ? safeRefName(rawBase) : null;
  if (typeof rawBase === 'string' && rawBase.trim() !== '' && !requested) {
    return null;
  }

  let targetPath = null;
  if (options?.path !== undefined) {
    targetPath = normalizeSafeDiffPath(root, options.path);
    if (!targetPath) return null;
  }

  const staged = options?.staged;
  if (staged !== undefined && typeof staged !== 'boolean') return null;

  return { requested, targetPath, staged };
}

/**
 * @param {string[]} baseArgs
 * @param {string | null} targetPath
 * @returns {string[]}
 */
function buildDiffArgs(baseArgs, targetPath) {
  if (!targetPath) return baseArgs;
  return ['--literal-pathspecs', ...baseArgs, '--', targetPath];
}

/**
 * @param {string} root
 * @param {Array<{ path: string }>} files
 * @param {string | null} targetPath
 */
async function appendUntrackedDiffs(root, files, targetPath) {
  const lsArgs = targetPath
    ? ['--literal-pathspecs', 'ls-files', '--others', '--exclude-standard', '-z', '--', targetPath]
    : ['ls-files', '--others', '--exclude-standard', '-z'];
  const untracked = await runGit(root, lsArgs);
  if (untracked.code !== 0 || !untracked.stdout) return;
  for (const rel of untracked.stdout.split('\0').filter(Boolean)) {
    if (targetPath && rel !== targetPath) continue;
    if (files.some((file) => file.path === rel)) continue;
    const added = untrackedAsDiff(root, rel);
    if (added) files.push(added);
  }
}

async function gitDiff(cwd, options) {
  const root = asCwd(cwd);
  if (!root) return null;
  const inside = await runGit(root, ['rev-parse', '--is-inside-work-tree']);
  if (inside.missing || inside.code !== 0 || inside.stdout.trim() !== 'true') return null;

  const resolved = resolveDiffOptions(root, options);
  if (!resolved) return null;
  const { requested, targetPath, staged } = resolved;

  const files = [];
  let truncated = false;
  if (requested) {
    const args = buildDiffArgs(['diff', `${requested}...HEAD`, '--no-color', '--no-ext-diff', '--find-renames'], targetPath);
    const diff = await runGit(root, args);
    if (diff.missing || diff.code !== 0) return null;
    truncated = Boolean(diff.truncated);
    files.push(...parseUnifiedDiff(diff.stdout));
    return truncated ? { files, truncated: true, baseRef: requested } : { files, baseRef: requested };
  }

  if (staged === true) {
    const args = buildDiffArgs(['diff', '--cached', '--no-color', '--no-ext-diff', '--find-renames'], targetPath);
    const diff = await runGit(root, args);
    if (diff.missing || diff.code !== 0) return null;
    truncated = Boolean(diff.truncated);
    files.push(...parseUnifiedDiff(diff.stdout));
    return truncated ? { files, truncated: true } : { files };
  }

  if (staged === false) {
    const args = buildDiffArgs(['diff', '--no-color', '--no-ext-diff', '--find-renames'], targetPath);
    const diff = await runGit(root, args);
    if (diff.missing || diff.code !== 0) return null;
    truncated = Boolean(diff.truncated);
    files.push(...parseUnifiedDiff(diff.stdout));
    await appendUntrackedDiffs(root, files, targetPath);
    return truncated ? { files, truncated: true } : { files };
  }

  const head = await runGit(root, ['rev-parse', '--verify', '--quiet', 'HEAD']);
  if (head.code === 0) {
    const args = buildDiffArgs(['diff', 'HEAD', '--no-color', '--no-ext-diff', '--find-renames'], targetPath);
    const diff = await runGit(root, args);
    if (diff.missing || diff.code !== 0) return null;
    truncated = Boolean(diff.truncated);
    files.push(...parseUnifiedDiff(diff.stdout));
  } else {
    const stagedDiff = await runGit(root, buildDiffArgs(['diff', '--cached', '--no-color', '--no-ext-diff'], targetPath));
    const unstagedDiff = await runGit(root, buildDiffArgs(['diff', '--no-color', '--no-ext-diff'], targetPath));
    if (stagedDiff.missing || unstagedDiff.missing || (stagedDiff.code !== 0 && unstagedDiff.code !== 0)) return null;
    truncated = Boolean(stagedDiff.truncated || unstagedDiff.truncated);
    files.push(...parseUnifiedDiff(stagedDiff.stdout), ...parseUnifiedDiff(unstagedDiff.stdout));
  }

  await appendUntrackedDiffs(root, files, targetPath);
  return truncated ? { files, truncated: true } : { files };
}

/**
 * @param {string} rel
 * @returns {boolean}
 */
function isNtfsReservedPatchPath(rel) {
  const normalized = String(rel || '').replaceAll('\\', '/');
  return normalized.split('/').some((part) => {
    const stem = part.replace(/[. ]+$/g, '').split('.')[0];
    return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(stem);
  });
}

/**
 * @param {string} root
 * @param {string} rel
 * @returns {boolean}
 */
function isSafePatchTarget(root, rel) {
  if (!rel || path.isAbsolute(rel) || rel.startsWith('/') || rel.startsWith('\\') || /^[A-Za-z]:/.test(rel)) {
    return false;
  }
  const parts = rel.replaceAll('\\', '/').split('/');
  if (parts.some((seg) => seg === '' || seg === '.' || seg === '..' || seg.toLowerCase() === '.git')) {
    return false;
  }
  if (isNtfsReservedPatchPath(rel)) return false;
  return resolveInsideWorkspace(root, rel) !== null;
}

/**
 * @param {string} line
 * @returns {string[]}
 */
function extractDiffGitTargets(line) {
  const rest = line.slice('diff --git '.length);
  if (!rest.includes('"') && rest.startsWith('a/')) {
    if (rest.length > 4 && (rest.length - 1) % 2 === 0) {
      const sym = (rest.length - 1) / 2;
      if (rest[sym] === ' ' && rest.slice(sym + 1, sym + 3) === 'b/' && rest.slice(2, sym) === rest.slice(sym + 3)) {
        const same = rest.slice(2, sym);
        return [same, same];
      }
    }
    const mid = rest.indexOf(' b/');
    if (mid > 2 && !rest.includes(' b/', mid + 3)) {
      return [rest.slice(2, mid), rest.slice(mid + 3)];
    }
  }
  return parseDiffGitArgs(rest).map(stripAbPrefix);
}

/**
 * @param {string} line
 * @returns {{ oldRemain: number, newRemain: number } | null}
 */
function parseHunkCounts(line) {
  const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
  if (!match) return null;
  return {
    oldRemain: match[2] === undefined ? 1 : Number(match[2]),
    newRemain: match[4] === undefined ? 1 : Number(match[4]),
  };
}

/**
 * @param {{ oldRemain: number, newRemain: number }} remain
 * @param {string} line
 * @returns {boolean}
 */
function consumeHunkLine(remain, line) {
  if (remain.oldRemain <= 0 && remain.newRemain <= 0) return false;
  if (line === '' || line.startsWith(' ')) {
    remain.oldRemain -= 1;
    remain.newRemain -= 1;
    return true;
  }
  if (line.startsWith('-')) {
    remain.oldRemain -= 1;
    return true;
  }
  if (line.startsWith('+')) {
    remain.newRemain -= 1;
    return true;
  }
  return line.startsWith('\\');
}

/**
 * @param {string} line
 * @returns {{ targets: string[], meta: boolean, header: boolean } | null}
 */
function collectHeaderInfo(line) {
  if (line.startsWith('diff --git ')) {
    return { targets: extractDiffGitTargets(line), meta: false, header: true };
  }
  if (line.startsWith('--- ') || line.startsWith('+++ ')) {
    const parsed = pathFromPlusMinus(line.slice(4));
    return { targets: parsed === null ? [] : [parsed], meta: false, header: true };
  }
  for (const prefix of ['rename from ', 'rename to ', 'copy from ', 'copy to ']) {
    if (line.startsWith(prefix)) {
      const cleaned = unquoteGitPath(line.slice(prefix.length));
      return { targets: cleaned ? [stripAbPrefix(cleaned)] : [], meta: true, header: true };
    }
  }
  if (line.startsWith('new file mode ') || line.startsWith('deleted file mode ')) {
    return { targets: [], meta: true, header: false };
  }
  return null;
}

/**
 * @param {string} root
 * @param {unknown} patchText
 * @returns {{ ok: true, payload: string } | { ok: false, message: string }}
 */
function validatePatchText(root, patchText) {
  if (typeof patchText !== 'string' || patchText.trim().length === 0) {
    return { ok: false, message: 'Patch text must be a non-empty string.' };
  }
  if (patchText.includes('\0')) {
    return { ok: false, message: 'Patch text must not contain NUL bytes.' };
  }
  if (Buffer.byteLength(patchText, 'utf8') > MAX_PATCH_BYTES) {
    return { ok: false, message: 'Patch exceeds the maximum allowed size.' };
  }
  const lines = patchText.replace(/\r\n/g, '\n').split('\n');
  const remain = { oldRemain: 0, newRemain: 0 };
  /** @type {string[]} */
  const targets = [];
  let sawHeader = false;
  let sawMeta = false;
  let sawHunk = false;
  for (const line of lines) {
    if (consumeHunkLine(remain, line)) continue;
    const counts = parseHunkCounts(line);
    if (counts) {
      remain.oldRemain = counts.oldRemain;
      remain.newRemain = counts.newRemain;
      sawHunk = true;
      continue;
    }
    const info = collectHeaderInfo(line);
    if (!info) continue;
    if (info.header) sawHeader = true;
    if (info.meta) sawMeta = true;
    targets.push(...info.targets);
  }
  if (!sawHeader || (!sawHunk && !sawMeta) || targets.length === 0) {
    return { ok: false, message: 'Patch is missing a valid diff header or hunk.' };
  }
  if (targets.some((rel) => !isSafePatchTarget(root, rel))) {
    return { ok: false, message: 'Path is outside the workspace.' };
  }
  return { ok: true, payload: patchText.endsWith('\n') ? patchText : `${patchText}\n` };
}

/** @returns {string | null} */
function probeGitFallback() {
  const dirs = [process.env.ProgramFiles, process.env['ProgramFiles(x86)']]
    .filter((dir) => typeof dir === 'string' && dir.length > 0)
    .map((dir) => [String(dir)]);
  if (process.env.LOCALAPPDATA) dirs.push([process.env.LOCALAPPDATA, 'Programs']);
  for (const parts of dirs) {
    const candidate = path.join(...parts, 'Git', 'cmd', 'git.exe');
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * @param {string} command
 * @param {string} cwd
 * @param {string[]} args
 * @param {string} inputText
 * @returns {Promise<{ code: number, stdout: string, stderr: string, missing: boolean, timedOut: boolean, truncated: boolean }>}
 */
function runGitStdin(command, cwd, args, inputText) {
  return new Promise((resolve) => {
    let settled = false;
    /** @type {ReturnType<typeof setTimeout>} */
    let timer;
    /** @param {{ code: number, stdout: string, stderr: string, missing: boolean, timedOut: boolean, truncated: boolean }} result */
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const child = spawn(command, args, {
      cwd,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: gitChildEnv(),
      ...spawnTreeOptions(),
    });
    /** @type {Buffer[]} */
    const stdoutChunks = [];
    /** @type {Buffer[]} */
    const stderrChunks = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let truncated = false;
    const decode = () => ({
      stdout: Buffer.concat(stdoutChunks).toString('utf8'),
      stderr: Buffer.concat(stderrChunks).toString('utf8'),
    });
    timer = setTimeout(() => {
      killProcessTree(child);
      finish({
        code: -1,
        stdout: decode().stdout,
        stderr: 'git command timed out',
        missing: false,
        timedOut: true,
        truncated,
      });
    }, GIT_TIMEOUT_MS);
    /**
     * @param {Buffer[]} chunks
     * @param {() => number} getBytes
     * @param {(next: number) => void} setBytes
     */
    const collect = (chunks, getBytes, setBytes) => (/** @type {Buffer} */ chunk) => {
      const next = getBytes() + chunk.length;
      if (next > GIT_MAX_OUTPUT_BYTES) {
        const remain = Math.max(0, GIT_MAX_OUTPUT_BYTES - getBytes());
        if (remain > 0) chunks.push(chunk.subarray(0, remain));
        setBytes(GIT_MAX_OUTPUT_BYTES);
        if (!truncated) {
          truncated = true;
          killProcessTree(child);
        }
        return;
      }
      setBytes(next);
      chunks.push(chunk);
    };
    child.stdout.on('data', collect(stdoutChunks, () => stdoutBytes, (n) => { stdoutBytes = n; }));
    child.stderr.on('data', collect(stderrChunks, () => stderrBytes, (n) => { stderrBytes = n; }));
    child.stdin.on('error', () => {
      // Child exited before consuming all stdin; error/close listeners settle the outcome.
    });
    child.stdin.end(Buffer.from(inputText, 'utf8'));
    child.on('error', (error) => {
      const decoded = decode();
      const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
      finish({
        code: -1,
        stdout: decoded.stdout,
        stderr: error.message,
        missing: code === 'ENOENT',
        timedOut: false,
        truncated,
      });
    });
    child.on('close', (code) => {
      const decoded = decode();
      finish({
        code: code ?? 1,
        stdout: decoded.stdout,
        stderr: decoded.stderr,
        missing: false,
        timedOut: false,
        truncated,
      });
    });
  });
}

/**
 * @param {unknown} cwd
 * @param {unknown} patchText
 * @param {boolean} reverse
 * @returns {Promise<{ ok: boolean, message?: string }>}
 */
async function applyIndexPatch(cwd, patchText, reverse) {
  const root = asCwd(cwd);
  if (!root) return fail('Git status is unavailable.');
  const validated = validatePatchText(root, patchText);
  if (!('payload' in validated)) return fail(validated.message);
  const args = reverse
    ? ['apply', '--cached', '--unidiff-zero', '-R', '-']
    : ['apply', '--cached', '--unidiff-zero', '-'];
  // Index writes can mutate staging before exiting non-zero; drop memoized reads up front.
  invalidateReadContext(root);
  let result = await runGitStdin('git', root, args, validated.payload);
  if (result.missing) {
    const fallback = probeGitFallback();
    if (fallback) result = await runGitStdin(fallback, root, args, validated.payload);
  }
  if (result.missing) return fail(GIT_UNAVAILABLE);
  if (result.timedOut) return fail('Git command timed out.');
  if (result.code !== 0) return fail(gitFailureMessage(result, 'git apply failed.'));
  return ok();
}

/**
 * Stage a unified diff patch into the Git index without modifying the working tree.
 * @param {unknown} cwd
 * @param {unknown} patchText
 * @returns {Promise<{ ok: boolean, message?: string }>}
 */
async function gitStagePatch(cwd, patchText) {
  return applyIndexPatch(cwd, patchText, false);
}

/**
 * Unstage a unified diff patch from the Git index without modifying the working tree.
 * @param {unknown} cwd
 * @param {unknown} patchText
 * @returns {Promise<{ ok: boolean, message?: string }>}
 */
async function gitUnstagePatch(cwd, patchText) {
  return applyIndexPatch(cwd, patchText, true);
}

module.exports = {
  unquoteGitPath,
  parseUnifiedDiff,
  gitDiff,
  gitStagePatch,
  gitUnstagePatch,
  untrackedAsDiff,
};
