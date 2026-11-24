/**
 * `bot_work_start` execution helper: validates `cwd` safety boundary and `verifyCmd`,
 * enforces desktop human confirmation (highlighting non-Git direct write & verifyCmd),
 * prepares isolated worktree when possible, and runs the coding worker lifecycle.
 */
import crypto from 'node:crypto';
import path from 'node:path';
import { BOT_WORKER_PRESET_ID } from '../preset.js';
import { botMetaDir } from './fs-home.js';
import { BOT_OWNER_WORK } from './session-runtime.js';
import {
  executeDispatchedWorker,
  parseAndValidateVerifyCommand,
  validateWorkerCwd,
} from './worktree-runner.js';

/** @param {string} detail */
const okOut = (detail) => ({ ok: true, detail });
/** @param {string} detail */
const errOut = (detail) => ({ ok: false, detail });

/** @param {any} runtime @param {any} caller @param {any} args @param {any} worktreeRunner @param {string} safeCwd @param {string} verifyCmd @param {any} exec @param {(req: any, exec: any) => Promise<any>} requireConfirm */
async function confirmWorkStart(runtime, caller, args, worktreeRunner, safeCwd, verifyCmd, exec, requireConfirm) {
  const repo = typeof worktreeRunner.detectGitRepository === 'function'
    ? await worktreeRunner.detectGitRepository(safeCwd).catch(() => ({ isGitRepo: false, repoRoot: null, headSha: null }))
    : { isGitRepo: false, repoRoot: null, headSha: null };
  const willIsolate = args.useWorktree !== false && repo.isGitRepo && Boolean(repo.repoRoot) && Boolean(repo.headSha);
  const modeLabel = willIsolate
    ? '隔离 Git Worktree'
    : '非隔离直写原目录（非 Git 仓库或无提交 HEAD，将直接修改原目录）';
  const prompt = String(args.prompt ?? '').trim();
  return requireConfirm({
    tool: 'bot_work_start',
    action: 'start',
    effect: 'code',
    summary: `${caller.bot.name} 请求派发编码 Worker（${modeLabel}）`,
    details: [
      `工作目录: ${safeCwd}`,
      `运行模式: ${modeLabel}`,
      ...(verifyCmd ? [`验证命令: ${verifyCmd}`] : []),
      `任务说明: ${prompt.slice(0, 300)}`,
    ].join('\n').slice(0, 600),
  }, exec);
}

/**
 * @param {any} runtime
 * @param {any} worktreeRunner
 * @param {any} args
 * @returns {{ ok: false, error: string } | { ok: true, cwd: string, safeCwd: string, verifyCmd: string }}
 */
function validateWorkStartInputs(runtime, worktreeRunner, args) {
  const cwd = String(args.cwd ?? '').trim();
  const prompt = String(args.prompt ?? '').trim();
  if (!cwd || !prompt) return { ok: false, error: 'cwd and prompt are required.' };

  let safeCwd;
  try {
    safeCwd = typeof worktreeRunner.validateWorkerCwd === 'function'
      ? worktreeRunner.validateWorkerCwd(cwd)
      : validateWorkerCwd(cwd, { metaRoot: botMetaDir(runtime.dshHome) });
  } catch (error) {
    return { ok: false, error: String(/** @type {any} */ (error)?.message ?? error) };
  }

  const verifyCmd = args.verifyCmd ? String(args.verifyCmd).trim() : '';
  if (verifyCmd) {
    const verifyCheck = parseAndValidateVerifyCommand(verifyCmd);
    if (!verifyCheck.ok) return { ok: false, error: verifyCheck.error || 'Invalid verifyCmd.' };
  }
  return { ok: true, cwd, safeCwd: String(safeCwd), verifyCmd };
}

/**
 * @param {any} runtime
 * @param {any} caller
 * @param {any} args
 * @param {any} worktreeRunner
 * @param {any} prepared
 * @param {string} dispatchId
 * @param {any} reportToolAsyncError
 * @returns {Promise<{ ok: true, started: any } | { ok: false, error: string }>}
 */
async function startWorkerSideSession(runtime, caller, args, worktreeRunner, prepared, dispatchId, reportToolAsyncError) {
  try {
    return {
      ok: true,
      started: await runtime.sessionRuntime.startSideChat(caller.bot.id, {
        title: args.title || `Worker · ${path.basename(args.cwd)}`,
        kind: 'worker', origin: 'work', owner: BOT_OWNER_WORK,
        preset: BOT_WORKER_PRESET_ID, cwd: prepared.cwd,
      }),
    };
  } catch (error) {
    if (prepared.isolatedWorktree) {
      await worktreeRunner.cleanupWorktree(dispatchId).then(undefined, (/** @type {unknown} */ e) => {
        reportToolAsyncError(runtime, 'bot_work_start:rollback', e, { dispatchId });
      });
    }
    return { ok: false, error: `Failed to start worker session: ${String(/** @type {any} */ (error)?.message ?? error)}` };
  }
}

/** @param {any} runtime @param {any} caller @param {any} args @param {any} deps */
export async function executeWorkStart(runtime, caller, args, deps) {
  const { options, exec, requireConfirm, resolveWorktreeRunner, resolveItemUid, botHomeDir, reportToolAsyncError } = deps;
  const worktreeRunner = resolveWorktreeRunner(runtime, options);
  const validated = validateWorkStartInputs(runtime, worktreeRunner, args);
  if (!validated.ok) return errOut(validated.error);

  const refused = await confirmWorkStart(
    runtime, caller, args, worktreeRunner, validated.safeCwd, validated.verifyCmd, exec, requireConfirm,
  );
  if (refused) return refused;

  const dispatchId = `disp-${crypto.randomUUID().slice(0, 12)}`;
  const taskId = `task-${crypto.randomUUID().slice(0, 12)}`;
  let prepared;
  try {
    prepared = await worktreeRunner.prepareWorkerCwd({
      botId: caller.bot.id, cwd: validated.safeCwd, dispatchId, useWorktree: args.useWorktree !== false,
    });
  } catch (error) {
    return errOut(String(/** @type {any} */ (error)?.message ?? error));
  }

  const sessionRes = await startWorkerSideSession(runtime, caller, args, worktreeRunner, prepared, dispatchId, reportToolAsyncError);
  if (!sessionRes.ok) return errOut(sessionRes.error);
  const started = sessionRes.started;

  const work = runtime.workStore.startWork({
    botId: caller.bot.id, source: 'app', externalId: caller.sessionId, taskId, dispatchId,
  });
  const itemUid = args.itemUid ? resolveItemUid(runtime.itemsStore, args.itemUid) : null;
  if (itemUid) {
    runtime.itemsStore.linkStartedWorker(itemUid, dispatchId, { chatId: caller.sessionId, botId: caller.bot.id });
  }
  runtime.eventBus.emit({ botIds: [caller.bot.id], kinds: ['workers', 'items', 'chats'] });

  const lifecycle = executeDispatchedWorker({
    runtime, caller, homeDir: botHomeDir(runtime, caller.bot), worktreeRunner, dispatchId,
    sessionId: started.sessionId, effectiveCwd: prepared.cwd, isolatedWorktree: prepared.isolatedWorktree,
    itemUid, args, onError: (tag, err, meta) => reportToolAsyncError(runtime, tag, err, meta),
  });

  if (args.awaitCompletion === true) {
    const outcome = await lifecycle;
    return okOut(JSON.stringify({
      work, sessionId: started.sessionId, dispatchId, preset: BOT_WORKER_PRESET_ID,
      cwd: prepared.cwd, isolatedWorktree: prepared.isolatedWorktree,
      completed: true, passed: outcome.ok, exitCode: outcome.exitCode,
      verify: outcome.verify ?? null, decisionEntry: outcome.decisionEntry ?? null,
    }));
  }
  lifecycle.then(undefined, (/** @type {unknown} */ err) => reportToolAsyncError(runtime, 'bot_work_start:lifecycle', err, { dispatchId }));
  return okOut(JSON.stringify({
    work, sessionId: started.sessionId, dispatchId, preset: BOT_WORKER_PRESET_ID,
    cwd: prepared.cwd, isolatedWorktree: prepared.isolatedWorktree,
  }));
}
