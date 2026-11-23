/**
 * Git worktree isolation, per-bot worker concurrency guard, verification command
 * runner, and safe worktree teardown for coding workers dispatched by Bots.
 */
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { BOT_WORKER_MAX_CONCURRENCY } from '../../src/shared/bot-types.js';
import { appendDecisionTsv, resolveWorktreePath } from './fs-home.js';

const execFileAsync = promisify(execFile);

const GIT_TIMEOUT_MS = 20_000;
const VERIFY_DEFAULT_TIMEOUT_MS = 120_000;
const MAX_CAPTURE_BYTES = 64 * 1024;
const EVIDENCE_TAIL_CHARS = 1600;

export { BOT_WORKER_MAX_CONCURRENCY };

/** @param {string} root @param {string} target */
function isWithinBoundary(root, target) {
  const normRoot = process.platform === 'win32' ? root.toLowerCase() : root;
  const normTarget = process.platform === 'win32' ? target.toLowerCase() : target;
  if (normTarget === normRoot) return true;
  const prefix = normRoot.endsWith(path.sep) ? normRoot : `${normRoot}${path.sep}`;
  return normTarget.startsWith(prefix);
}

/** @param {string[]} args @param {{ cwd: string, timeoutMs?: number }} opts */
async function defaultExecGit(args, { cwd, timeoutMs = GIT_TIMEOUT_MS }) {
  const { stdout, stderr } = await execFileAsync('git', args, {
    cwd,
    timeout: timeoutMs,
    windowsHide: true,
    maxBuffer: 2 * 1024 * 1024,
  });
  return { stdout: String(stdout ?? ''), stderr: String(stderr ?? '') };
}

/**
 * Detect whether `cwd` resides inside a Git repository and resolve its root & HEAD.
 * @param {string} cwd
 * @param {{ execGit?: typeof defaultExecGit }} [options]
 */
export async function detectGitRepository(cwd, options = {}) {
  const resolved = path.resolve(String(cwd ?? ''));
  if (!resolved || !fs.existsSync(resolved)) {
    return { isGitRepo: false, repoRoot: null, branch: null, headSha: null };
  }
  const execGit = typeof options.execGit === 'function' ? options.execGit : defaultExecGit;
  try {
    const top = await execGit(['rev-parse', '--show-toplevel'], { cwd: resolved });
    const repoRoot = top.stdout.trim();
    if (!repoRoot) return { isGitRepo: false, repoRoot: null, branch: null, headSha: null };
    let headSha = null;
    let branch = null;
    try {
      const sha = await execGit(['rev-parse', 'HEAD'], { cwd: repoRoot });
      headSha = sha.stdout.trim() || null;
    } catch {
      // Unborn repository (no commits yet) cannot create a worktree from HEAD.
      headSha = null;
    }
    try {
      const br = await execGit(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repoRoot });
      branch = br.stdout.trim() || null;
    } catch {
      branch = null;
    }
    return { isGitRepo: true, repoRoot: path.resolve(repoRoot), branch, headSha };
  } catch {
    return { isGitRepo: false, repoRoot: null, branch: null, headSha: null };
  }
}

/**
 * Check whether `botId` is within its concurrent active worker limit.
 * @param {any} workStore
 * @param {string} botId
 * @param {{ maxConcurrency?: number }} [options]
 */
export function checkWorkerConcurrency(workStore, botId, options = {}) {
  const maxConcurrency = Math.max(1, Number(options.maxConcurrency) || BOT_WORKER_MAX_CONCURRENCY);
  /** @type {Array<any>} */
  const openRows = workStore?.listWork?.({ botId, openOnly: true, limit: 100 }) ?? [];
  const activeDispatches = openRows.map((/** @type {any} */ row) => row.dispatchId);
  return {
    allowed: openRows.length < maxConcurrency,
    activeCount: openRows.length,
    maxConcurrency,
    activeDispatches,
  };
}

/**
 * Create a detached Git worktree under `<metaRoot>/worktrees/<dispatchId>`.
 * @param {{
 *   repoRoot: string,
 *   metaRoot: string,
 *   dispatchId: string,
 *   baseRef?: string,
 *   execGit?: typeof defaultExecGit,
 * }} params
 */
export async function createIsolatedWorktree(params) {
  const { repoRoot, metaRoot, dispatchId, baseRef = 'HEAD' } = params;
  const execGit = typeof params.execGit === 'function' ? params.execGit : defaultExecGit;
  const worktreePath = resolveWorktreePath(metaRoot, dispatchId);
  fs.mkdirSync(path.dirname(worktreePath), { recursive: true });
  await execGit(['worktree', 'add', '--detach', worktreePath, baseRef], { cwd: repoRoot });
  return { worktreePath, repoRoot, dispatchId, baseRef, created: true };
}

/**
 * Safely remove an isolated worktree strictly inside `<metaRoot>/worktrees/`.
 * Unlinks symlinks without following them outside the boundary.
 * @param {{
 *   repoRoot?: string | null,
 *   metaRoot: string,
 *   dispatchId: string,
 *   worktreePath?: string | null,
 *   execGit?: typeof defaultExecGit,
 * }} params
 */
export async function removeIsolatedWorktree(params) {
  const { repoRoot = null, metaRoot, dispatchId } = params;
  const execGit = typeof params.execGit === 'function' ? params.execGit : defaultExecGit;
  const expectedPath = resolveWorktreePath(metaRoot, dispatchId);
  const targetPath = params.worktreePath ? path.resolve(params.worktreePath) : expectedPath;
  const worktreesRoot = path.resolve(metaRoot, 'worktrees');

  if (!isWithinBoundary(worktreesRoot, targetPath) || targetPath === worktreesRoot) {
    throw Object.assign(new Error(`Refusing to remove worktree outside boundary: ${targetPath}`), {
      code: 'path_traversal',
    });
  }

  let gitRemoved = false;
  if (repoRoot && fs.existsSync(repoRoot)) {
    try {
      await execGit(['worktree', 'remove', '--force', targetPath], { cwd: repoRoot });
      gitRemoved = true;
    } catch {
      // Fall back to direct boundary-checked removal + prune below.
    }
    try {
      await execGit(['worktree', 'prune'], { cwd: repoRoot });
    } catch {
      // Best-effort prune when repo metadata is already clean.
    }
  }

  if (fs.existsSync(targetPath)) {
    const stat = fs.lstatSync(targetPath);
    if (stat.isSymbolicLink()) {
      fs.unlinkSync(targetPath);
    } else {
      fs.rmSync(targetPath, { recursive: true, force: true });
    }
  }

  return { removed: !fs.existsSync(targetPath), gitRemoved, worktreePath: targetPath };
}

/** @param {string[]} chunks @param {Buffer} chunk @param {{ bytes: number }} state */
function pushCappedChunk(chunks, chunk, state) {
  if (state.bytes >= MAX_CAPTURE_BYTES) return;
  const remaining = MAX_CAPTURE_BYTES - state.bytes;
  const slice = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk;
  chunks.push(slice.toString('utf8'));
  state.bytes += slice.length;
}

/** @param {any} custom @param {number} startedAt */
function normalizeCustomVerify(custom, startedAt) {
  const exitCode = Number.isInteger(custom?.exitCode) ? custom.exitCode : (custom?.ok ? 0 : 1);
  const stdout = String(custom?.stdout ?? '');
  const stderr = String(custom?.stderr ?? '');
  const combined = [stdout.trim(), stderr.trim()].filter(Boolean).join('\n');
  return {
    ok: Boolean(custom?.ok ?? exitCode === 0),
    exitCode,
    stdout,
    stderr,
    tail: combined.slice(-EVIDENCE_TAIL_CHARS),
    timedOut: Boolean(custom?.timedOut),
    durationMs: Number.isFinite(custom?.durationMs) ? custom.durationMs : Date.now() - startedAt,
  };
}

/**
 * Execute an empirical verification shell command inside `cwd` with timeout and capped output.
 * @param {string} verifyCmd
 * @param {{ cwd: string, timeoutMs?: number, execCommand?: (cmd: string, opts: { cwd: string, timeoutMs: number }) => Promise<any> }} options
 */
export async function runVerifyCommand(verifyCmd, options) {
  const cmd = String(verifyCmd ?? '').trim();
  const cwd = path.resolve(String(options?.cwd ?? ''));
  const timeoutMs = Math.max(1000, Number(options?.timeoutMs) || VERIFY_DEFAULT_TIMEOUT_MS);
  const startedAt = Date.now();

  if (typeof options?.execCommand === 'function') {
    return normalizeCustomVerify(await options.execCommand(cmd, { cwd, timeoutMs }), startedAt);
  }

  return new Promise((resolve) => {
    const child = spawn(cmd, { cwd, shell: true, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    /** @type {string[]} */
    const outChunks = [];
    /** @type {string[]} */
    const errChunks = [];
    const outState = { bytes: 0 };
    const errState = { bytes: 0 };
    let timedOut = false;
    let settled = false;

    /** @param {number | null} exitCode @param {unknown} [spawnError] */
    const finish = (exitCode, spawnError = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const stdout = outChunks.join('');
      const errRaw = errChunks.join('');
      const stderr = spawnError ? `${errRaw}\n${String(/** @type {any} */ (spawnError)?.message ?? spawnError)}`.trim() : errRaw;
      const combined = [stdout.trim(), stderr.trim()].filter(Boolean).join('\n');
      resolve({
        ok: !timedOut && !spawnError && exitCode === 0,
        exitCode: Number.isInteger(exitCode) ? exitCode : 1,
        stdout,
        stderr,
        tail: combined.slice(-EVIDENCE_TAIL_CHARS),
        timedOut,
        durationMs: Date.now() - startedAt,
      });
    };

    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill(); } catch { /* Best-effort kill on verify timeout. */ }
      finish(124);
    }, timeoutMs);
    timer.unref?.();

    child.stdout?.on('data', (chunk) => pushCappedChunk(outChunks, chunk, outState));
    child.stderr?.on('data', (chunk) => pushCappedChunk(errChunks, chunk, errState));
    child.on('error', (err) => finish(1, err));
    child.on('close', (code) => finish(code ?? 1));
  });
}

/** @param {any} args @param {string} effectiveCwd */
function formatWorkerPrompt(args, effectiveCwd) {
  const sections = [String(args.prompt ?? '').trim()];
  if (args.doneMeans) sections.push(`## Done Means\n${String(args.doneMeans).trim()}`);
  if (args.verifyCmd) sections.push(`## Verification Command\n\`${String(args.verifyCmd).trim()}\``);
  sections.push(`## Working Directory\n\`${effectiveCwd}\``);
  return sections.join('\n\n');
}

/** @param {any} params */
function recordWorkerItemOutcome(params) {
  const { runtime, caller, homeDir, itemUid, dispatchId, verifyCmd, verify, turn, passed, doneMeans } = params;
  if (!itemUid) return null;
  const turnOk = turn?.ok !== false;
  const evidence = verify
    ? `cmd=${verifyCmd} exit=${verify.exitCode} ${verify.tail || '(no output)'}`
    : (turnOk ? String(turn?.reply || 'worker turn completed').slice(0, 400) : `turn_error=${turn?.error || 'worker_turn_failed'}`);
  const entry = appendDecisionTsv(homeDir, itemUid, {
    actor: `worker:${dispatchId}`,
    phase: verifyCmd ? 'verify' : 'execute',
    decision: passed ? 'verified' : 'failed',
    evidence: evidence.slice(0, 500),
    notes: doneMeans ? String(doneMeans).slice(0, 300) : '',
  }, { botId: caller.bot.id }).entry;

  const actor = { kind: 'bot', botId: caller.bot.id, chatId: caller.sessionId };
  if (!passed) {
    const comment = verify
      ? `Worker 实证校验失败（exitCode=${verify.exitCode}，命令：\`${verifyCmd}\`）：\n${verify.tail || '(无输出)'}`
      : `Worker 执行失败：${turn?.error || 'worker_turn_failed'}`;
    runtime.itemsStore.set(itemUid, { status: 'needs_you', comment }, actor);
  } else {
    const comment = verify
      ? `Worker 实证校验通过（exitCode=0，命令：\`${verifyCmd}\`）。`
      : `Worker 已完成执行（dispatchId=${dispatchId}）。`;
    runtime.itemsStore.comment(itemUid, { text: comment }, actor);
  }
  return entry;
}

/** @param {any} params @param {string} msg */
function escalateWorkerException(params, msg) {
  const { runtime, caller, homeDir, itemUid, dispatchId, verifyCmd, onError } = params;
  if (!itemUid) return;
  try {
    appendDecisionTsv(homeDir, itemUid, {
      actor: `worker:${dispatchId}`,
      phase: verifyCmd ? 'verify' : 'execute',
      decision: 'failed',
      evidence: `exception=${msg.slice(0, 400)}`,
      notes: '',
    }, { botId: caller.bot.id });
    runtime.itemsStore.set(itemUid, {
      status: 'needs_you',
      comment: `Worker 异常中止（dispatchId=${dispatchId}）：${msg}`,
    }, { kind: 'bot', botId: caller.bot.id, chatId: caller.sessionId });
  } catch (innerErr) {
    onError?.('bot_work_start:escalate', innerErr, { dispatchId, itemUid });
  }
}

/**
 * Run a dispatched coding worker turn, empirically verify with `verifyCmd` when set,
 * append `decisions/<itemUid>.tsv`, escalate linked Work Item to `needs_you` on failure,
 * and reclaim any isolated worktree in `finally`.
 * @param {{
 *   runtime: any,
 *   caller: { bot: any, sessionId: string },
 *   homeDir: string,
 *   worktreeRunner: ReturnType<typeof createWorktreeRunner>,
 *   dispatchId: string,
 *   sessionId: string,
 *   effectiveCwd: string,
 *   isolatedWorktree: boolean,
 *   itemUid: string | null,
 *   args: any,
 *   onError?: (tag: string, err: unknown, meta?: Record<string, any>) => void,
 * }} params
 */
export async function executeDispatchedWorker(params) {
  const { runtime, caller, homeDir, worktreeRunner, dispatchId, sessionId, effectiveCwd, isolatedWorktree, itemUid, args, onError } = params;
  const verifyCmd = args.verifyCmd ? String(args.verifyCmd).trim() : '';
  const workerPrompt = formatWorkerPrompt(args, effectiveCwd);

  try {
    const turn = await runtime.sessionRuntime.runSingleTurn(sessionId, workerPrompt);
    const turnOk = turn?.ok !== false;
    const verify = turnOk && verifyCmd
      ? await worktreeRunner.verifyWorkerResult(verifyCmd, { cwd: effectiveCwd })
      : null;
    const passed = turnOk && (!verify || verify.ok);
    const exitCode = verify ? verify.exitCode : (turnOk ? 0 : 1);
    const decisionEntry = recordWorkerItemOutcome({
      runtime, caller, homeDir, itemUid, dispatchId, verifyCmd, verify, turn, passed, doneMeans: args.doneMeans,
    });
    runtime.workStore.closeWorkByDispatch?.(dispatchId, { reason: passed ? 'task_gone' : 'start_failed' });
    return { ok: passed, exitCode, turn, verify, decisionEntry, dispatchId, sessionId };
  } catch (error) {
    const msg = String(/** @type {any} */ (error)?.message ?? error);
    onError?.('bot_work_start', error, { dispatchId, sessionId, itemUid });
    runtime.workStore.closeWorkByDispatch?.(dispatchId, { reason: 'start_failed' });
    escalateWorkerException({ runtime, caller, homeDir, itemUid, dispatchId, verifyCmd, onError }, msg);
    return { ok: false, exitCode: 1, error: msg, dispatchId, sessionId };
  } finally {
    if (isolatedWorktree && args.keepWorktree !== true) {
      try {
        await worktreeRunner.cleanupWorktree(dispatchId);
      } catch (cleanupErr) {
        onError?.('bot_work_start:cleanup', cleanupErr, { dispatchId });
      }
    }
    runtime.eventBus.emit({ botIds: [caller.bot.id], kinds: ['workers', 'items', 'chats'] });
  }
}

/**
 * Create a stateful worktree & verification runner bound to `_meta` and `workStore`.
 * @param {{
 *   metaRoot: string,
 *   workStore?: any,
 *   maxConcurrency?: number,
 *   execGit?: typeof defaultExecGit,
 *   execCommand?: (cmd: string, opts: { cwd: string, timeoutMs: number }) => Promise<any>,
 * }} deps
 */
export function createWorktreeRunner(deps) {
  const { metaRoot, workStore = null, maxConcurrency = BOT_WORKER_MAX_CONCURRENCY, execGit, execCommand } = deps ?? {};
  if (!metaRoot) throw new Error('createWorktreeRunner requires metaRoot');
  /** @type {Map<string, { repoRoot: string | null, worktreePath: string }>} */
  const activeWorktrees = new Map();

  /** @param {string} botId */
  function checkConcurrency(botId) {
    return checkWorkerConcurrency(workStore, botId, { maxConcurrency });
  }

  /**
   * Enforce concurrency and prepare either an isolated Git worktree or direct project `cwd`.
   * @param {{ botId: string, cwd: string, dispatchId: string, useWorktree?: boolean }} params
   */
  async function prepareWorkerCwd({ botId, cwd, dispatchId, useWorktree = true }) {
    const quota = checkConcurrency(botId);
    if (!quota.allowed) {
      throw Object.assign(
        new Error(`Worker concurrency limit reached (${quota.activeCount}/${quota.maxConcurrency}) for bot ${botId}`),
        { code: 'worker_concurrency_exceeded', data: quota },
      );
    }
    const resolvedCwd = path.resolve(String(cwd ?? ''));
    const repo = await detectGitRepository(resolvedCwd, { execGit });
    const shouldIsolate = useWorktree !== false && repo.isGitRepo && Boolean(repo.repoRoot) && Boolean(repo.headSha);
    if (!shouldIsolate || !repo.repoRoot || !repo.headSha) {
      return {
        cwd: resolvedCwd,
        originalCwd: resolvedCwd,
        isolatedWorktree: false,
        isGitRepo: repo.isGitRepo,
        repoRoot: repo.repoRoot,
        worktreePath: null,
      };
    }
    const created = await createIsolatedWorktree({
      repoRoot: repo.repoRoot,
      metaRoot,
      dispatchId,
      baseRef: repo.headSha,
      execGit,
    });
    activeWorktrees.set(dispatchId, { repoRoot: repo.repoRoot, worktreePath: created.worktreePath });
    return {
      cwd: created.worktreePath,
      originalCwd: resolvedCwd,
      isolatedWorktree: true,
      isGitRepo: true,
      repoRoot: repo.repoRoot,
      worktreePath: created.worktreePath,
    };
  }

  /** @param {string} dispatchId */
  async function cleanupWorktree(dispatchId) {
    const tracked = activeWorktrees.get(dispatchId);
    activeWorktrees.delete(dispatchId);
    if (!tracked) return { removed: false, reason: 'not_tracked' };
    return removeIsolatedWorktree({
      repoRoot: tracked.repoRoot,
      metaRoot,
      dispatchId,
      worktreePath: tracked.worktreePath,
      execGit,
    });
  }

  async function cleanupAll() {
    const ids = [...activeWorktrees.keys()];
    const results = [];
    for (const id of ids) {
      results.push({ dispatchId: id, ...(await cleanupWorktree(id)) });
    }
    return results;
  }

  /** @param {string} verifyCmd @param {{ cwd: string, timeoutMs?: number }} opts */
  function verifyWorkerResult(verifyCmd, opts) {
    return runVerifyCommand(verifyCmd, { ...opts, execCommand });
  }

  return {
    /** @param {string} cwd */
    detectGitRepository: (cwd) => detectGitRepository(cwd, { execGit }),
    checkConcurrency,
    prepareWorkerCwd,
    verifyWorkerResult,
    cleanupWorktree,
    cleanupAll,
    listActiveWorktrees: () => [...activeWorktrees.entries()].map(([dispatchId, info]) => ({ dispatchId, ...info })),
  };
}
