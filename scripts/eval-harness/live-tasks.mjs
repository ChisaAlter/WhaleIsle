/**
 * Live Magpie evaluation tasks executing real compiled `vendor/deepseek-harness/apps/cli/lib/bin.js`
 * against the local metering proxy under an isolated `DSH_HOME` and scrubbed environment.
 * @module scripts/eval-harness/live-tasks
 */

import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { promisify } from 'node:util';
import { killProcessTree, spawnTreeOptions } from '../../src/shared/process-tree.js';
import { buildIsolatedDshEnv, DSH_CLI_BIN, WHALE_UI_HOST } from './temp-env.mjs';

const execFileAsync = promisify(execFile);

/**
 * Determine upstream adapter protocol and effective `baseURL` from target model id.
 * @param {string} proxyUrl
 * @param {string} model
 * @returns {{ api: string, baseURL: string }}
 */
function resolveProtocolConfig(proxyUrl, model) {
  if (model === 'ai-apizn-com/gpt-6.2-sol') {
    return { api: 'openai-responses', baseURL: `${proxyUrl}/v1` };
  }
  if (/^devin\/claude-(fable|opus)/u.test(model)) {
    return { api: 'anthropic-messages', baseURL: proxyUrl };
  }
  return { api: 'openai-completions', baseURL: `${proxyUrl}/v1` };
}

/**
 * Write an isolated patch overlay configuring `llm-pi-ai` and `agent-default-model` for Magpie.
 * @param {string} filePath
 * @param {{ proxyUrl: string, model: string, maxTokens?: number }} options
 */
function writeMagpiePatch(filePath, { proxyUrl, model, maxTokens = 4096 }) {
  const { api, baseURL } = resolveProtocolConfig(proxyUrl, model);
  const patch = [
    {
      id: 'llm-pi-ai',
      config: {
        providers: {
          magpie: {
            displayName: 'Magpie Eval Proxy',
            apiKeyEnv: 'MAGPIE_API_KEY',
            api,
            baseURL,
            models: [
              {
                id: model,
                name: model,
                contextWindow: 1_048_576,
                maxTokens,
                input: ['text', 'image'],
              },
            ],
          },
        },
      },
    },
    {
      id: 'agent-default-model',
      config: {
        provider: 'magpie',
        model,
      },
    },
  ];
  fs.writeFileSync(filePath, `${JSON.stringify(patch, null, 2)}\n`, 'utf8');
}

/**
 * Run `dsh` asynchronously with timeout and full process-tree termination on timeout.
 * @param {{
 *   args: string[],
 *   cwd: string,
 *   env: NodeJS.ProcessEnv,
 *   timeoutMs: number,
 * }} options
 * @returns {Promise<{ exitCode: number | null, stdout: string, stderr: string, timedOut: boolean }>}
 */
async function runDshAsync({ args, cwd, env, timeoutMs }) {
  const child = spawn(process.execPath, [DSH_CLI_BIN, ...args], {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    ...spawnTreeOptions(),
  });
  /** @type {string[]} */
  const outChunks = [];
  /** @type {string[]} */
  const errChunks = [];
  child.stdout?.on('data', chunk => outChunks.push(String(chunk)));
  child.stderr?.on('data', chunk => errChunks.push(String(chunk)));

  let timedOut = false;
  let settled = false;
  const timer = setTimeout(() => {
    if (settled) return;
    timedOut = true;
    if (child.pid !== undefined) {
      void killProcessTree(child.pid).catch((err) => {
        // Process may already have terminated right as the timeout callback fired.
        void err;
      });
    }
  }, timeoutMs);

  try {
    const exitCode = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', /** @param {number | null} code */ code => resolve(code));
    });
    settled = true;
    return { exitCode, stdout: outChunks.join(''), stderr: errChunks.join(''), timedOut };
  } finally {
    clearTimeout(timer);
    if (!settled && child.pid !== undefined) {
      await killProcessTree(child.pid).catch((err) => {
        // Best-effort process cleanup on unexpected error before exiting task scope.
        void err;
      });
    }
  }
}

/**
 * Create a git repository with an initial commit inside `repoDir`.
 * @param {string} repoDir
 */
async function initGitRepo(repoDir) {
  fs.mkdirSync(repoDir, { recursive: true });
  fs.writeFileSync(path.join(repoDir, 'README.md'), '# Eval Repo\nBASELINE_OK\n', 'utf8');
  await execFileAsync('git', ['init'], { cwd: repoDir });
  await execFileAsync('git', ['config', 'user.name', 'Eval Harness'], { cwd: repoDir });
  await execFileAsync('git', ['config', 'user.email', 'eval@example.invalid'], { cwd: repoDir });
  await execFileAsync('git', ['add', 'README.md'], { cwd: repoDir });
  await execFileAsync('git', ['commit', '-m', 'init'], { cwd: repoDir });
}

/**
 * Send one Typert RPC POST call to the running `dsh --profile web` daemon without exposing auth headers.
 * @param {string} origin
 * @param {string} sessionHeader
 * @param {string} method
 * @param {Record<string, unknown>} request
 * @returns {Promise<any>}
 */
async function callWebRpc(origin, sessionHeader, method, request) {
  const response = await fetch(`${origin}/api/${method}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin,
      cookie: sessionHeader,
    },
    body: JSON.stringify({
      type: 'client-request',
      rpcId: randomUUID(),
      method,
      payload: { args: { request } },
    }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`RPC ${method} HTTP ${response.status}: ${text.slice(0, 200)}`);
  }
  const envelope = JSON.parse(text);
  if (!envelope?.result?.ok) {
    const errMsg = envelope?.result?.error?.message ?? 'unknown RPC failure';
    throw new Error(`RPC ${method} error: ${errMsg}`);
  }
  return envelope.result.value;
}

/**
 * Launch `dsh --profile web`, authenticate a local session, and capture WhaleUI step-1 metrics.
 * @param {{ tempRoot: string, workspaceRoot: string, dshHome: string, proxyUrl: string, model: string, timeoutMs: number }} ctx
 * @returns {Promise<{ pass: boolean, details: Record<string, unknown>, error?: string }>}
 */
async function runWebWhaleUiPayload(ctx) {
  if (!fs.existsSync(WHALE_UI_HOST)) {
    return { pass: false, details: {}, error: `Missing Whale UI host bundle at ${WHALE_UI_HOST}` };
  }
  const taskWs = path.join(ctx.workspaceRoot, 'web-whaleui-payload');
  const taskHome = path.join(ctx.dshHome, 'web-whaleui-payload');
  fs.mkdirSync(taskWs, { recursive: true });
  fs.mkdirSync(taskHome, { recursive: true });
  const patchFile = path.join(taskHome, 'patch.yml');
  writeMagpiePatch(patchFile, { proxyUrl: ctx.proxyUrl, model: ctx.model });

  const env = buildIsolatedDshEnv({
    dshHome: taskHome,
    extraEnv: { DSHD_WHALE_UI_ENABLED: '1', DSHD_WHALE_UI_HOST: WHALE_UI_HOST },
  });
  const child = spawn(
    process.execPath,
    [DSH_CLI_BIN, '--profile', 'web', '--skip-user-plugins', '--patch', patchFile, '--host', '127.0.0.1', '--port', '0', '--no-open'],
    { cwd: taskWs, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, ...spawnTreeOptions() },
  );

  try {
    const launchUrl = await new Promise((resolve, reject) => {
      let stdoutAcc = '';
      let stderrAcc = '';
      const deadline = setTimeout(() => {
        reject(new Error(`Timed out waiting for dsh web URL (${stderrAcc.slice(-300)})`));
      }, Math.min(ctx.timeoutMs, 45_000));
      const cleanup = () => {
        clearTimeout(deadline);
        child.off('error', onError);
        child.off('close', onClose);
      };
      const onError = (/** @type {unknown} */ err) => {
        cleanup();
        reject(err);
      };
      const onClose = (/** @type {number | null} */ code) => {
        cleanup();
        reject(new Error(`dsh web exited early with code ${String(code)}: ${stderrAcc.slice(-300)}`));
      };
      child.on('error', onError);
      child.on('close', onClose);
      child.stdout?.on('data', (chunk) => {
        stdoutAcc += String(chunk);
        const match = stdoutAcc.match(/^dsh web:\s*(https?:\/\/\S+)/mu);
        if (match?.[1]) {
          cleanup();
          resolve(match[1]);
        }
      });
      child.stderr?.on('data', (chunk) => {
        stderrAcc += String(chunk);
      });
    });

    const authRes = await fetch(launchUrl, { redirect: 'manual' });
    const rawCookie = authRes.headers.getSetCookie()[0];
    if (!rawCookie) {
      throw new Error(`dsh web auth did not issue session header (HTTP ${authRes.status})`);
    }
    const cookiePair = rawCookie.split(';', 1)[0] ?? '';
    const origin = new URL(launchUrl).origin;

    const created = await callWebRpc(origin, cookiePair, 'session/create', { cwd: taskWs });
    const sessionId = String(created.sessionId);
    await callWebRpc(origin, cookiePair, 'session/prompt', {
      requestId: randomUUID(),
      sessionId,
      mode: 'queue',
      content: [{ type: 'text', text: 'Reply immediately with WEB_WHALEUI_OK without using tools.' }],
    });

    const deadlineAt = Date.now() + ctx.timeoutMs;
    while (Date.now() < deadlineAt) {
      const waitRes = await callWebRpc(origin, cookiePair, 'session/wait', {
        sessionId,
        timeoutMs: Math.max(5_000, Math.min(30_000, deadlineAt - Date.now())),
      });
      if (waitRes.reason === 'idle') break;
      if (waitRes.reason === 'input-required') {
        throw new Error('dsh web paused waiting for interactive input');
      }
    }
    return { pass: true, details: { sessionCreated: Boolean(sessionId) } };
  } finally {
    if (child.pid !== undefined) {
      await killProcessTree(child.pid).catch((err) => {
        // Web daemon might already have terminated cleanly.
        void err;
      });
    }
  }
}

/**
 * Evaluate `glob` in a bare non-Git directory containing `.gitignore`.
 * @param {{ workspaceRoot: string, dshHome: string, proxyUrl: string, model: string, timeoutMs: number }} ctx
 * @returns {Promise<{ pass: boolean, details: Record<string, unknown>, error?: string }>}
 */
async function runGlobBareLive(ctx) {
  const wsDir = path.join(ctx.workspaceRoot, 'glob-bare');
  const homeDir = path.join(ctx.dshHome, 'glob-bare');
  fs.mkdirSync(path.join(wsDir, 'src'), { recursive: true });
  fs.mkdirSync(path.join(wsDir, 'node_modules', 'pkg'), { recursive: true });
  fs.mkdirSync(path.join(wsDir, 'dist'), { recursive: true });
  fs.mkdirSync(homeDir, { recursive: true });
  fs.writeFileSync(path.join(wsDir, '.gitignore'), 'node_modules/\ndist/\n', 'utf8');
  fs.writeFileSync(path.join(wsDir, 'src', 'keep.txt'), 'KEEP_MARKER_99\n', 'utf8');
  fs.writeFileSync(path.join(wsDir, 'node_modules', 'pkg', 'bad.txt'), 'BAD_DEP\n', 'utf8');
  fs.writeFileSync(path.join(wsDir, 'dist', 'out.txt'), 'BAD_DIST\n', 'utf8');

  const patchFile = path.join(homeDir, 'patch.yml');
  writeMagpiePatch(patchFile, { proxyUrl: ctx.proxyUrl, model: ctx.model });
  const env = buildIsolatedDshEnv({ dshHome: homeDir });
  const res = await runDshAsync({
    args: [
      '--profile', 'headless', '--skip-user-plugins', '--patch', patchFile,
      '--permission-mode', 'danger-full-access', '--approval-policy', 'never',
      'Use the glob tool with pattern "**/*" in this directory. Output ONLY the relative file paths found by glob, one per line.',
    ],
    cwd: wsDir,
    env,
    timeoutMs: ctx.timeoutMs,
  });

  const normalized = res.stdout.replaceAll('\\', '/');
  const foundKeep = normalized.includes('src/keep.txt') || normalized.includes('keep.txt');
  const leaked = normalized.includes('node_modules') || normalized.includes('dist/out');
  const pass = !res.timedOut && res.exitCode === 0 && foundKeep && !leaked;
  return {
    pass,
    details: { exitCode: res.exitCode, foundKeep, leaked },
    ...(!pass ? { error: res.timedOut ? 'timed out' : (res.stderr.trim() || `exit=${res.exitCode}`) } : {}),
  };
}

/**
 * Evaluate end-to-end file creation and test execution for `math-e2e`.
 * @param {{ workspaceRoot: string, dshHome: string, proxyUrl: string, model: string, timeoutMs: number }} ctx
 * @returns {Promise<{ pass: boolean, details: Record<string, unknown>, error?: string }>}
 */
async function runMathE2eLive(ctx) {
  const wsDir = path.join(ctx.workspaceRoot, 'math-e2e');
  const homeDir = path.join(ctx.dshHome, 'math-e2e');
  fs.mkdirSync(wsDir, { recursive: true });
  fs.mkdirSync(homeDir, { recursive: true });

  const patchFile = path.join(homeDir, 'patch.yml');
  writeMagpiePatch(patchFile, { proxyUrl: ctx.proxyUrl, model: ctx.model });
  const env = buildIsolatedDshEnv({ dshHome: homeDir });
  const prompt = 'Create ESM file math.js exporting add(a, b) that returns a + b, and math.test.js using node:test and node:assert/strict to test add(2, 3) === 5. Run `node --test math.test.js` and finish with exact token TEST_PASS.';
  const res = await runDshAsync({
    args: [
      '--profile', 'headless', '--skip-user-plugins', '--patch', patchFile,
      '--permission-mode', 'danger-full-access', '--approval-policy', 'never',
      prompt,
    ],
    cwd: wsDir,
    env,
    timeoutMs: ctx.timeoutMs,
  });

  const filesExist = fs.existsSync(path.join(wsDir, 'math.js')) && fs.existsSync(path.join(wsDir, 'math.test.js'));
  let testPassed = false;
  if (filesExist) {
    try {
      await execFileAsync(process.execPath, ['--test', 'math.test.js'], { cwd: wsDir, timeout: 15_000 });
      testPassed = true;
    } catch (err) {
      // Captured via testPassed=false below with task pass evaluation.
      void err;
    }
  }
  const hasToken = res.stdout.includes('TEST_PASS');
  const pass = !res.timedOut && res.exitCode === 0 && testPassed && hasToken;
  return {
    pass,
    details: { exitCode: res.exitCode, filesExist, testPassed, hasToken },
    ...(!pass ? { error: res.timedOut ? 'timed out' : `exit=${res.exitCode} testPassed=${testPassed}` } : {}),
  };
}

/**
 * Evaluate automatic continuation recovery when output hits `maxTokens` (`finish_reason: "length"`).
 * @param {{ workspaceRoot: string, dshHome: string, proxyUrl: string, model: string, timeoutMs: number }} ctx
 * @returns {Promise<{ pass: boolean, details: Record<string, unknown>, error?: string }>}
 */
async function runMaxTokensContinuationLive(ctx) {
  const wsDir = path.join(ctx.workspaceRoot, 'max-tokens-continuation');
  const homeDir = path.join(ctx.dshHome, 'max-tokens-continuation');
  fs.mkdirSync(wsDir, { recursive: true });
  fs.mkdirSync(homeDir, { recursive: true });

  const patchFile = path.join(homeDir, 'patch.yml');
  writeMagpiePatch(patchFile, { proxyUrl: ctx.proxyUrl, model: ctx.model, maxTokens: 55 });
  const env = buildIsolatedDshEnv({ dshHome: homeDir });
  const res = await runDshAsync({
    args: [
      '--profile', 'headless', '--skip-user-plugins', '--patch', patchFile,
      '--permission-mode', 'danger-full-access', '--approval-policy', 'never',
      'Write the integers from 1 to 35 separated by spaces, ending with the exact marker DONE_35.',
    ],
    cwd: wsDir,
    env,
    timeoutMs: ctx.timeoutMs,
  });

  const hasDone = res.stdout.includes('DONE_35');
  const pass = !res.timedOut && (res.exitCode === 0 || hasDone);
  return {
    pass,
    details: { exitCode: res.exitCode, hasDone },
    ...(!pass ? { error: res.timedOut ? 'timed out' : `exit=${res.exitCode}` } : {}),
  };
}

/**
 * Evaluate subagent git worktree isolation and clean post-run branch/worktree cleanup.
 * @param {{ workspaceRoot: string, dshHome: string, proxyUrl: string, model: string, timeoutMs: number }} ctx
 * @returns {Promise<{ pass: boolean, details: Record<string, unknown>, error?: string }>}
 */
async function runWorktreeIsolationLive(ctx) {
  const wsDir = path.join(ctx.workspaceRoot, 'worktree-isolation');
  const homeDir = path.join(ctx.dshHome, 'worktree-isolation');
  fs.mkdirSync(homeDir, { recursive: true });
  await initGitRepo(wsDir);

  const patchFile = path.join(homeDir, 'patch.yml');
  writeMagpiePatch(patchFile, { proxyUrl: ctx.proxyUrl, model: ctx.model });
  const env = buildIsolatedDshEnv({ dshHome: homeDir });
  const res = await runDshAsync({
    args: [
      '--profile', 'headless', '--skip-user-plugins', '--patch', patchFile,
      '--permission-mode', 'danger-full-access', '--approval-policy', 'never',
      'Delegate a read-only subagent using isolation "worktree" to read README.md without editing any file and return WORKTREE_OK. After it finishes, reply with WORKTREE_ISOLATION_PASS.',
    ],
    cwd: wsDir,
    env,
    timeoutMs: ctx.timeoutMs,
  });

  const { stdout: wtOut } = await execFileAsync('git', ['worktree', 'list', '--porcelain'], { cwd: wsDir, encoding: 'utf8' });
  const worktreeCount = wtOut.split(/\r?\n/u).filter(line => line.startsWith('worktree ')).length;
  const { stdout: branchOut } = await execFileAsync('git', ['branch', '--list'], { cwd: wsDir, encoding: 'utf8' });
  const branchCount = branchOut.split(/\r?\n/u).filter(line => line.trim().length > 0).length;
  const cleanRepo = worktreeCount === 1 && branchCount === 1;
  const pass = !res.timedOut && res.exitCode === 0 && cleanRepo;
  return {
    pass,
    details: { exitCode: res.exitCode, worktreeCount, branchCount, cleanRepo },
    ...(!pass ? { error: res.timedOut ? 'timed out' : `exit=${res.exitCode} worktrees=${worktreeCount} branches=${branchCount}` } : {}),
  };
}

/**
 * Evaluate post-proxy assertions specific to each live task and enrich final task pass/fail verdict.
 * @param {string} name
 * @param {{ pass: boolean, details: Record<string, unknown>, error?: string }} outcome
 * @param {import('./proxy.mjs').MeteringMetrics} metrics
 * @returns {{ pass: boolean, error?: string, details: Record<string, unknown> }}
 */
function reconcileTaskWithMetrics(name, outcome, metrics) {
  const details = { ...outcome.details };
  if (name === 'web-whaleui-payload') {
    const hasGuide = metrics.step1Tools.includes('whale_ui_guide');
    const hasRenderUi = metrics.step1Tools.includes('render_ui');
    const hasRole = metrics.step1SystemRole === 'system' || metrics.step1SystemRole === 'developer';
    const toolCountOk = (metrics.step1ToolCount ?? 0) >= 30;
    const pass = outcome.pass && hasGuide && hasRenderUi && hasRole && toolCountOk && (metrics.step1Bytes ?? 0) > 0;
    details.step1SystemRole = metrics.step1SystemRole;
    details.step1ToolCount = metrics.step1ToolCount;
    details.hasWhaleUiTools = hasGuide && hasRenderUi;
    return {
      pass,
      details,
      ...(!pass ? { error: outcome.error ?? 'WhaleUI step-1 payload assertion failed' } : {}),
    };
  }
  if (name === 'max-tokens-continuation') {
    const sawLength = metrics.finishReasons.includes('length');
    const multiStep = metrics.mainHttpRequests >= 2;
    const pass = outcome.pass && sawLength && multiStep;
    details.finishReasons = metrics.finishReasons;
    details.mainHttpRequests = metrics.mainHttpRequests;
    return {
      pass,
      details,
      ...(!pass ? { error: outcome.error ?? `Continuation did not trigger (finishReasons=${JSON.stringify(metrics.finishReasons)}, main=${metrics.mainHttpRequests})` } : {}),
    };
  }
  return outcome;
}

/**
 * Execute the requested live tasks sequentially through the loopback metering proxy.
 * @param {{
 *   tasks: readonly string[],
 *   tempRoot: string,
 *   workspaceRoot: string,
 *   dshHome: string,
 *   proxy: Awaited<ReturnType<import('./proxy.mjs').startMeteringProxy>>,
 *   model: string,
 *   timeoutMs: number,
 * }} options
 * @returns {Promise<import('./report.mjs').EvalTaskResult[]>}
 */
export async function runLiveSuite(options) {
  if (!fs.existsSync(DSH_CLI_BIN)) {
    throw new Error(`Compiled CLI entrypoint not found at "${DSH_CLI_BIN}". Run "npm run setup:harness" first.`);
  }
  /** @type {Record<string, (ctx: any) => Promise<{ pass: boolean, details: Record<string, unknown>, error?: string }>>} */
  const handlers = {
    'web-whaleui-payload': runWebWhaleUiPayload,
    'glob-bare': runGlobBareLive,
    'math-e2e': runMathE2eLive,
    'max-tokens-continuation': runMaxTokensContinuationLive,
    'worktree-isolation': runWorktreeIsolationLive,
  };

  /** @type {import('./report.mjs').EvalTaskResult[]} */
  const results = [];
  for (const name of options.tasks) {
    options.proxy.resetMetrics();
    const started = performance.now();
    const handler = handlers[name];
    if (!handler) {
      results.push({ name, pass: false, durationMs: 0, error: `Unknown live task "${name}"` });
      continue;
    }
    try {
      const rawOutcome = await handler({
        tempRoot: options.tempRoot,
        workspaceRoot: options.workspaceRoot,
        dshHome: options.dshHome,
        proxyUrl: options.proxy.url,
        model: options.model,
        timeoutMs: options.timeoutMs,
      });
      const metrics = options.proxy.snapshotMetrics();
      const reconciled = reconcileTaskWithMetrics(name, rawOutcome, metrics);
      results.push({
        name,
        pass: reconciled.pass,
        durationMs: Math.round(performance.now() - started),
        metrics,
        details: reconciled.details,
        ...(reconciled.error ? { error: reconciled.error } : {}),
      });
    } catch (error) {
      results.push({
        name,
        pass: false,
        durationMs: Math.round(performance.now() - started),
        metrics: options.proxy.snapshotMetrics(),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return results;
}
