import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { createUniqueDir } from '../src/shared/fs-safe.js';
import { readBodyLimited } from '../src/shared/secret.js';
import { LIVE_TASKS, OFFLINE_TASKS, parseEvalArgs } from './eval-harness/cli.mjs';
import { runGitHunkOfflineCheck, runOfflineSuite } from './eval-harness/offline-checks.mjs';
import { startMeteringProxy } from './eval-harness/proxy.mjs';
import { buildReport, formatScorecard, writeReportFile } from './eval-harness/report.mjs';
import { buildIsolatedDshEnv, REPO_ROOT, withEvalTempEnvironment } from './eval-harness/temp-env.mjs';

const execFileAsync = promisify(execFile);
const DSH_FS_LOCAL_LIB = path.join(REPO_ROOT, 'vendor', 'deepseek-harness', 'packages', 'fs', 'fs-local', 'lib', 'index.js');

/**
 * Allocate an isolated test scratch directory outside the repo and clean it afterwards.
 * @param {(dir: string) => Promise<void>} fn
 */
async function withTestScratch(fn) {
  const dir = createUniqueDir(os.tmpdir(), 'eval-harness-test-');
  try {
    await fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
}

test('parseEvalArgs parses defaults, live options, and validates errors', () => {
  const def = parseEvalArgs([]);
  assert.equal(def.mode, 'offline');
  assert.deepEqual(def.tasks, [...OFFLINE_TASKS]);
  assert.equal(def.keepTemp, false);

  const live = parseEvalArgs([
    '--mode', 'live',
    '--base-url=http://127.0.0.1:3425/',
    '--model', 'devin/deepseek-v4-1-flash-1017',
    '--tasks', 'glob-bare,math-e2e',
    '--out', 'report.json',
    '--temp-root', 'C:/tmp/eval-x',
    '--keep-temp',
    '--timeout-ms', '45000',
  ]);
  assert.equal(live.mode, 'live');
  assert.equal(live.baseUrl, 'http://127.0.0.1:3425');
  assert.equal(live.model, 'devin/deepseek-v4-1-flash-1017');
  assert.deepEqual(live.tasks, ['glob-bare', 'math-e2e']);
  assert.equal(live.out, 'report.json');
  assert.equal(live.keepTemp, true);
  assert.equal(live.timeoutMs, 45_000);

  assert.equal(parseEvalArgs(['--mode', 'live', '--help']).tasks.length, LIVE_TASKS.length);
  assert.throws(() => parseEvalArgs(['--mode', 'live', '--model', 'm']), /--base-url is required/u);
  assert.throws(() => parseEvalArgs(['--mode', 'live', '--base-url', 'http://127.0.0.1:1']), /--model is required/u);
  assert.throws(() => parseEvalArgs(['--mode', 'invalid']), /Invalid --mode/u);
  assert.throws(() => parseEvalArgs(['--tasks', 'non-existent']), /Unknown offline task/u);
  assert.throws(() => parseEvalArgs(['--timeout-ms', '0']), /positive integer/u);
  assert.throws(() => parseEvalArgs(['--bogus']), /Unknown option/u);
});

test('buildReport, formatScorecard, and writeReportFile summarize passRate and write JSON', async () => {
  await withTestScratch(async (scratch) => {
    const report = buildReport({
      mode: 'live',
      model: 'test-model',
      durationMs: 1234.6,
      results: [
        {
          name: 'glob-bare',
          pass: true,
          durationMs: 420,
          metrics: {
            step1Bytes: 4096,
            step1PromptTokens: 900,
            totalPromptTokens: 1500,
            totalCompletionTokens: 120,
            httpRequests: 2,
          },
        },
        {
          name: 'math-e2e',
          pass: false,
          durationMs: 800,
          error: 'assertion failed',
        },
      ],
    });
    assert.equal(report.passedCount, 1);
    assert.equal(report.totalCount, 2);
    assert.equal(report.passRate, 0.5);

    const card = formatScorecard(report);
    assert.match(card, /WhaleIsle Eval Harness \(live\) \| model=test-model/u);
    assert.match(card, /glob-bare\s+PASS\s+420ms\s+step1=4096B p1=900 in=1500 out=120 http=2/u);
    assert.match(card, /Passed: 1\/2 \(50\.0%\)/u);

    const outPath = path.join(scratch, 'nested', 'score.json');
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    writeReportFile(outPath, report);
    const saved = JSON.parse(fs.readFileSync(outPath, 'utf8'));
    assert.equal(saved.passRate, 0.5);
    assert.equal(saved.results.length, 2);
  });
});

test('withEvalTempEnvironment reclaims temp root on success and failure, honors --keep-temp, and rejects unsafe roots', async () => {
  await withTestScratch(async (scratch) => {
    const passRoot = path.join(scratch, 'pass-root');
    await withEvalTempEnvironment({ tempRoot: passRoot }, async (env) => {
      assert.equal(fs.existsSync(env.tempRoot), true);
      fs.writeFileSync(path.join(env.workspaceRoot, 'artifact.txt'), 'temp\n', 'utf8');
    });
    assert.equal(fs.existsSync(passRoot), false, 'temp root must be removed after normal return');

    const failRoot = path.join(scratch, 'fail-root');
    await assert.rejects(
      () => withEvalTempEnvironment({ tempRoot: failRoot }, async (env) => {
        fs.writeFileSync(path.join(env.dshHome, 'cfg.yml'), '[]\n', 'utf8');
        throw new Error('simulated failure');
      }),
      /simulated failure/u,
    );
    assert.equal(fs.existsSync(failRoot), false, 'temp root must be removed even when callback throws');

    const keptRoot = path.join(scratch, 'kept-root');
    await withEvalTempEnvironment({ tempRoot: keptRoot, keepTemp: true }, async (env) => {
      fs.writeFileSync(path.join(env.workspaceRoot, 'keep.txt'), 'retained\n', 'utf8');
    });
    assert.equal(fs.existsSync(keptRoot), true, '--keep-temp must retain temp root');

    await assert.rejects(
      () => withEvalTempEnvironment({ tempRoot: os.tmpdir() }, async () => {}),
      /overlaps protected directory/u,
    );
    await assert.rejects(
      () => withEvalTempEnvironment({ tempRoot: path.join(REPO_ROOT, 'scripts') }, async () => {}),
      /must stay outside repository/u,
    );

    const nonEmpty = path.join(scratch, 'non-empty');
    fs.mkdirSync(nonEmpty);
    fs.writeFileSync(path.join(nonEmpty, 'user.txt'), 'keep me\n', 'utf8');
    await assert.rejects(
      () => withEvalTempEnvironment({ tempRoot: nonEmpty }, async () => {}),
      /not empty/u,
    );
    assert.equal(fs.existsSync(path.join(nonEmpty, 'user.txt')), true);
  });
});

test('buildIsolatedDshEnv strips ambient proxies and injects isolated DSH_HOME', () => {
  const originalProxy = process.env.HTTP_PROXY;
  process.env.HTTP_PROXY = 'http://127.0.0.1:9999';
  try {
    const env = buildIsolatedDshEnv({ dshHome: '/tmp/eval-home' });
    assert.equal(env.HTTP_PROXY, undefined);
    assert.equal(env.HTTPS_PROXY, undefined);
    assert.equal(env.ALL_PROXY, undefined);
    assert.equal(env.DSH_HOME, '/tmp/eval-home');
    assert.equal(env.DSH_AGENTS_HOME, path.join('/tmp/eval-home', 'agents'));
    assert.equal(env.DSH_TELEMETRY_DISABLED, '1');
    assert.equal(Boolean(env.MAGPIE_API_KEY), true);
  } finally {
    if (originalProxy === undefined) delete process.env.HTTP_PROXY;
    else process.env.HTTP_PROXY = originalProxy;
  }
});

test('startMeteringProxy captures step1 tool payload, auxiliary calls, and SSE token usage', async () => {
  let reqCount = 0;
  const mockUpstream = http.createServer(async (req, res) => {
    await readBodyLimited(req, 1024 * 1024, { res });
    reqCount += 1;
    if (reqCount === 1) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        choices: [{ finish_reason: 'stop', message: { content: 'title' } }],
        usage: { prompt_tokens: 50, completion_tokens: 5 },
      }));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('data: {"choices":[{"finish_reason":"length","delta":{"content":"1 2 3"}}]}\n\n');
    res.write('data: {"usage":{"prompt_tokens":1200,"completion_tokens":55}}\n\n');
    res.write('data: [DONE]\n\n');
    res.end();
  });

  await new Promise(resolve => mockUpstream.listen(0, '127.0.0.1', () => resolve(undefined)));
  const addr = mockUpstream.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  const proxy = await startMeteringProxy(`http://127.0.0.1:${port}/v1`);

  try {
    await fetch(`${proxy.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'm', messages: [{ role: 'user', content: 'title?' }] }),
    });

    const step1Body = JSON.stringify({
      model: 'm',
      messages: [{ role: 'developer', content: 'system instructions' }],
      tools: [{ type: 'function', function: { name: 'whale_ui_guide' } }, { type: 'function', function: { name: 'render_ui' } }],
    });
    const res = await fetch(`${proxy.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: step1Body,
    });
    await res.text();

    const m = proxy.snapshotMetrics();
    assert.equal(m.httpRequests, 2);
    assert.equal(m.mainHttpRequests, 1);
    assert.equal(m.step1Bytes, Buffer.byteLength(step1Body, 'utf8'));
    assert.equal(m.step1PromptTokens, 1200);
    assert.equal(m.totalPromptTokens, 1250);
    assert.equal(m.totalCompletionTokens, 60);
    assert.equal(m.step1SystemRole, 'developer');
    assert.equal(m.step1ToolCount, 2);
    assert.deepEqual(m.step1Tools, ['whale_ui_guide', 'render_ui']);
    assert.deepEqual(m.finishReasons, ['stop', 'length']);
  } finally {
    await proxy.close();
    await new Promise(resolve => mockUpstream.close(() => resolve(undefined)));
  }
});

test('runOfflineSuite runs injected checks, captures failures, and git-hunk check passes', async () => {
  await withEvalTempEnvironment({}, async (env) => {
    const customResults = await runOfflineSuite({
      tasks: ['ok-task', 'bad-task'],
      workDir: env.workspaceRoot,
      runners: {
        'ok-task': async () => ({ verified: true }),
        'bad-task': async () => {
          throw new Error('intentional mismatch');
        },
      },
    });
    assert.equal(customResults[0]?.pass, true);
    assert.equal(customResults[1]?.pass, false);
    assert.match(customResults[1]?.error ?? '', /intentional mismatch/u);

    const gitHunkRes = await runGitHunkOfflineCheck(env.workspaceRoot);
    assert.deepEqual(gitHunkRes, {
      stagedOnlyFirstHunk: true,
      unstagedBackToClean: true,
      rejectedBadPatch: true,
    });
  });
});

test('offline CLI runs end-to-end when Harness libs are built and leaves zero temp residue', async (t) => {
  if (!fs.existsSync(DSH_FS_LOCAL_LIB)) {
    t.skip('vendor/deepseek-harness libs not built (setup:harness skipped in tools lane)');
    return;
  }
  await withTestScratch(async (scratch) => {
    const evalTemp = path.join(scratch, 'cli-eval-temp');
    const outFile = path.join(scratch, 'offline-report.json');
    const { stdout } = await execFileAsync(
      process.execPath,
      ['scripts/eval-harness.mjs', '--mode', 'offline', '--temp-root', evalTemp, '--out', outFile],
      { cwd: REPO_ROOT, encoding: 'utf8' },
    );
    assert.match(stdout, /Passed: 8\/8 \(100\.0%\)/u);
    assert.equal(fs.existsSync(evalTemp), false, 'CLI --temp-root must be removed upon completion');
    const parsed = JSON.parse(fs.readFileSync(outFile, 'utf8'));
    assert.equal(parsed.passedCount, 8);
    assert.equal(parsed.totalCount, 8);
  });
});
