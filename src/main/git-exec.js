const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { spawnTreeOptions, killProcessTree: stopTree } = require('../shared/process-tree');
const { createCachedWorkspaceAuthority, isPathInside } = require('./workspace-authority');

const authorityCache = createCachedWorkspaceAuthority();

/** Test seam: pin the trust root (node:test runs outside Electron). */
function setWorkspaceAuthority(authority) {
  authorityCache.set(authority);
}

/**
 * Authorize a renderer-supplied cwd against the boot workspace and every
 * harness-registered workspace root.
 * @param {unknown} cwd
 * @returns {string | null}
 */
function resolveAuthorizedCwd(cwd) {
  return authorityCache.get().resolveAuthorizedCwd(cwd);
}

function asCwd(cwd) {
  return resolveAuthorizedCwd(cwd);
}

/** Resolve a renderer-supplied relative path inside its authorized workspace root. */
function resolveInsideWorkspace(cwd, relativePath) {
  return authorityCache.get().resolveInside(cwd, relativePath);
}

/** Wall-clock limit for status/list/read git children. */
const GIT_TIMEOUT_MS = 60_000;
/** Commit timeout: leftover / husky / pre-push may run for minutes. */
const COMMIT_TIMEOUT_MS = 10 * 60_000;
/** Background fetch must not stall the titlebar. */
const FETCH_TIMEOUT_MS = 5_000;
/** Timeout for `gh repo view` / `gh pr list`. */
const GH_TIMEOUT_MS = 30_000;
/** Retained stdout cap; overflow kills the child and sets truncated. */
const GIT_MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
/** Prepared-commit patch cap. */
const PREPARED_COMMIT_PATCH_MAX_OUTPUT_BYTES = 49_000;
/** Range-diff patch cap. */
const RANGE_DIFF_PATCH_MAX_OUTPUT_BYTES = 59_000;
const OUTPUT_TRUNCATED_MARKER = '\n\n[truncated]';

function withTruncationMarker(text, truncated) {
  const raw = String(text || '');
  if (!truncated) return raw;
  return raw.endsWith('[truncated]') ? raw : `${raw}${OUTPUT_TRUNCATED_MARKER}`;
}

/**
 * Env for a git child. Uses the full `process.env` (no
 * `GIT_CEILING_DIRECTORIES`) and strips Electron npm_config_* so leftover
 * / npx do not inherit `electron-skip-binary-download`.
 * @returns {NodeJS.ProcessEnv}
 */
function gitChildEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^npm_config_electron/i.test(key)) delete env[key];
  }
  // Electron / IDE parents may set a ceiling that hides the workspace repo.
  delete env.GIT_CEILING_DIRECTORIES;
  env.GIT_TERMINAL_PROMPT = '0';
  env.GIT_ASKPASS = '';
  env.GCM_INTERACTIVE = 'never';
  env.SSH_ASKPASS = '';
  env.SSH_ASKPASS_REQUIRE = 'never';
  env.LC_ALL = 'C';
  return env;
}

/**
 * Kill a spawned git/gh child's process tree via src/shared/process-tree.js.
 * git routinely has live descendants (hooks, ssh, credential helpers) that
 * would otherwise survive a timeout or output-overflow kill and keep holding
 * index locks; children spawn detached so the shared stop reaches the group.
 * Fire-and-forget: callers report the timeout/overflow immediately while the
 * shared stop confirms or escalates in the background. A failed tree stop
 * still SIGTERMs the direct child so the git process itself never survives.
 * @param {import('node:child_process').ChildProcess} child
 * @param {{ platform?: NodeJS.Platform, stopTree?: typeof stopTree }} [options] test seams.
 */
function killProcessTree(child, { platform = process.platform, stopTree: stop = stopTree } = {}) {
  if (typeof child.pid === 'number') {
    Promise.resolve()
      .then(() => stop(child.pid, { platform }))
      .then((stopped) => { if (!stopped) child.kill(); })
      .catch(() => { child.kill(); });
    return;
  }
  child.kill();
}

function run(command, args, cwd, limits = {}) {
  const timeoutMs = limits.timeoutMs ?? GIT_TIMEOUT_MS;
  const maxBytes = limits.maxBytes ?? GIT_MAX_OUTPUT_BYTES;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const child = spawn(command, args, {
      cwd,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...gitChildEnv(), ...(limits.env || {}) },
      // POSIX group leader so the tree stop reaches hooks/helpers too.
      ...spawnTreeOptions(),
    });
    const stdoutChunks = [];
    const stderrChunks = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let truncated = false;
    /** Decode once at a settle point so multibyte sequences split across
     *  chunk boundaries never produce replacement characters. */
    const decode = () => ({
      stdout: Buffer.concat(stdoutChunks).toString('utf8'),
      stderr: Buffer.concat(stderrChunks).toString('utf8'),
    });
    const timer = setTimeout(() => {
      killProcessTree(child);
      finish({
        code: -1,
        stdout: decode().stdout,
        stderr: 'git command timed out',
        missing: false,
        timedOut: true,
        truncated,
      });
    }, timeoutMs);
    const onLine = typeof limits.onLine === 'function' ? limits.onLine : null;
    let lineBuf = '';
    const pushLines = (chunk) => {
      if (!onLine) return;
      lineBuf += chunk.toString('utf8');
      const parts = lineBuf.split(/\r?\n/);
      lineBuf = parts.pop() ?? '';
      for (const line of parts) {
        const clean = sanitizeProgressText(line);
        if (clean) onLine(clean);
      }
    };
    child.stdout.on('data', (chunk) => {
      const next = stdoutBytes + chunk.length;
      if (next > maxBytes) {
        const remain = Math.max(0, maxBytes - stdoutBytes);
        if (remain > 0) stdoutChunks.push(chunk.subarray(0, remain));
        stdoutBytes = maxBytes;
        truncated = true;
        killProcessTree(child);
        return;
      }
      stdoutBytes = next;
      stdoutChunks.push(chunk);
      pushLines(chunk);
    });
    child.stderr.on('data', (chunk) => {
      // Bound stderr the same way as stdout.
      const next = stderrBytes + chunk.length;
      if (next > maxBytes) {
        const remain = Math.max(0, maxBytes - stderrBytes);
        if (remain > 0) stderrChunks.push(chunk.subarray(0, remain));
        stderrBytes = maxBytes;
        truncated = true;
        killProcessTree(child);
        return;
      }
      stderrBytes = next;
      stderrChunks.push(chunk);
      pushLines(chunk);
    });
    child.on('error', (error) => {
      const decoded = decode();
      finish({
        code: -1,
        stdout: decoded.stdout,
        stderr: error.message,
        missing: error.code === 'ENOENT',
        timedOut: false,
        truncated,
      });
    });
    child.on('close', (code) => {
      if (onLine && lineBuf) {
        const clean = sanitizeProgressText(lineBuf);
        if (clean) onLine(clean);
        lineBuf = '';
      }
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
 * The single git spawn primitive.
 *
 * Read memoization is deliberately *explicit*: `git.js` threads a read
 * context's `run` seam through the helpers of one refresh. Because no helper
 * resolves a cache implicitly, a write can never be answered from memory and a
 * stale context cannot leak into an unrelated call chain.
 */
/**
 * Well-known Git for Windows install dirs probed when PATH resolution fails.
 * A long-lived parent (Explorer, terminal) keeps the PATH snapshot it started
 * with, so Git installed mid-session stays invisible to spawned children even
 * though it exists on disk.
 */
function gitProbeCandidates() {
  const roots = [process.env.ProgramFiles, process.env['ProgramFiles(x86)']]
    .filter(Boolean)
    .map((dir) => [dir]);
  if (process.env.LOCALAPPDATA) roots.push([process.env.LOCALAPPDATA, 'Programs']);
  return roots.map((parts) => path.join(...parts, 'Git', 'cmd', 'git.exe'));
}

/** Absolute git path confirmed by a fallback probe; null until one hits. */
let probedGitExe = null;

/**
 * Probe the well-known Git install dirs after PATH spawn failed. Returns the
 * cached/absolute path on success, null when none exist.
 */
function probeGitExecutable() {
  if (probedGitExe) return probedGitExe;
  for (const candidate of gitProbeCandidates()) {
    if (fs.existsSync(candidate)) {
      probedGitExe = candidate;
      return candidate;
    }
  }
  return null;
}

/** Test seam: drop the cached fallback path so spawn counting stays clean. */
function resetGitExecutableProbe() {
  probedGitExe = null;
}

async function runGitUncached(cwd, args, limits) {
  const result = await run(probedGitExe || 'git', args, cwd, limits);
  if (!result.missing) return result;
  probedGitExe = null; // PATH spawn failed or a cached fallback path vanished
  const fallback = probeGitExecutable();
  return fallback ? run(fallback, args, cwd, limits) : result;
}

function runGit(cwd, args, limits) {
  return runGitUncached(cwd, args, limits);
}

function isCrlfAdviceLine(line) {
  return /LF will be replaced by CRLF|CRLF will be replaced by LF|warning: in the working copy of /i.test(line);
}

function isGitAdviceLine(line) {
  return isCrlfAdviceLine(line) || /^hint:/i.test(line);
}

/**
 * Build the IPC failure dump from a git child.
 * Drops autocrlf warnings. Keeps `hint:` and every other retained line so the
 * titlebar error card can headline one line and expand the rest.
 * @param {{ stderr?: string, stdout?: string }} result
 * @param {string} fallback
 * @returns {string}
 */
function gitFailureMessage(result, fallback) {
  const lines = `${result.stderr || ''}\n${result.stdout || ''}`
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((line) => !isCrlfAdviceLine(line));
  return lines.length > 0 ? lines.join('\n') : fallback;
}

function sanitizeProgressText(line) {
  const clean = String(line || '').replace(/\u001B\[[0-9;]*[A-Za-z]/g, '').trim();
  if (!clean || isGitAdviceLine(clean)) return '';
  return clean.length > 500 ? `${clean.slice(0, 499)}…` : clean;
}

function inferHookName(line) {
  if (/pre-push/i.test(line)) return 'pre-push';
  if (/pre-commit|lefthook|husky/i.test(line)) return 'pre-commit';
  return null;
}

function fail(message) {
  return { ok: false, message };
}

function ok(extra = {}) {
  return { ok: true, ...extra };
}

/** Ref names git accepts on the command line; blocks option-like and traversal-ish values. */
const REF_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

function safeRefName(ref) {
  const name = String(ref || '').trim();
  if (!name || !REF_NAME_PATTERN.test(name)) return null;
  if (name.includes('..') || name.endsWith('.lock') || name.endsWith('/')) return null;
  return name;
}

module.exports = {
  killProcessTree,
  setWorkspaceAuthority,
  resolveAuthorizedCwd,
  asCwd,
  resolveInsideWorkspace,
  isPathInside,
  GIT_TIMEOUT_MS,
  COMMIT_TIMEOUT_MS,
  FETCH_TIMEOUT_MS,
  GH_TIMEOUT_MS,
  GIT_MAX_OUTPUT_BYTES,
  PREPARED_COMMIT_PATCH_MAX_OUTPUT_BYTES,
  RANGE_DIFF_PATCH_MAX_OUTPUT_BYTES,
  withTruncationMarker,
  gitChildEnv,
  resetGitExecutableProbe,
  run,
  runGit,
  runGitUncached,
  isGitAdviceLine,
  gitFailureMessage,
  sanitizeProgressText,
  inferHookName,
  fail,
  ok,
  safeRefName,
};
