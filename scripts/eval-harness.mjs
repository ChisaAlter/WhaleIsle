#!/usr/bin/env node
/**
 * Permanent offline/live maturity evaluation harness CLI for WhaleIsle & DeepSeek Harness.
 * @module scripts/eval-harness
 */

import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { formatUsage, parseEvalArgs } from './eval-harness/cli.mjs';
import { runLiveSuite } from './eval-harness/live-tasks.mjs';
import { runOfflineSuite } from './eval-harness/offline-checks.mjs';
import { startMeteringProxy } from './eval-harness/proxy.mjs';
import { buildReport, formatScorecard, writeReportFile } from './eval-harness/report.mjs';
import { withEvalTempEnvironment } from './eval-harness/temp-env.mjs';

/**
 * Execute one complete evaluation harness invocation and optionally write `--out`.
 * @param {readonly string[]} argv
 * @param {{
 *   stdout?: (text: string) => void,
 *   stderr?: (text: string) => void,
 * }} [io]
 * @returns {Promise<{ exitCode: number, report?: import('./eval-harness/report.mjs').EvalReport }>}
 */
export async function runEvalHarness(argv, io = {}) {
  const stdout = io.stdout ?? (text => console.log(text));
  const stderr = io.stderr ?? (text => console.error(text));

  /** @type {import('./eval-harness/cli.mjs').EvalCliOptions} */
  let options;
  try {
    options = parseEvalArgs(argv);
  } catch (error) {
    stderr(error instanceof Error ? error.message : String(error));
    return { exitCode: 2 };
  }

  if (options.help) {
    stdout(formatUsage());
    return { exitCode: 0 };
  }

  const started = performance.now();
  const results = await withEvalTempEnvironment(
    { tempRoot: options.tempRoot, keepTemp: options.keepTemp },
    async (tempEnv) => {
      if (options.mode === 'offline') {
        return runOfflineSuite({ tasks: options.tasks, workDir: tempEnv.workspaceRoot });
      }
      if (!options.baseUrl || !options.model) {
        throw new Error('Live mode requires both --base-url and --model');
      }
      const proxy = await startMeteringProxy(options.baseUrl);
      try {
        return await runLiveSuite({
          tasks: options.tasks,
          tempRoot: tempEnv.tempRoot,
          workspaceRoot: tempEnv.workspaceRoot,
          dshHome: tempEnv.dshHome,
          proxy,
          model: options.model,
          timeoutMs: options.timeoutMs,
        });
      } finally {
        await proxy.close();
      }
    },
  );

  const report = buildReport({
    mode: options.mode,
    model: options.model,
    durationMs: performance.now() - started,
    results,
  });

  if (options.out) {
    writeReportFile(options.out, report);
  }
  stdout(formatScorecard(report));
  const allPassed = report.passedCount === report.totalCount;
  return { exitCode: allPassed ? 0 : 1, report };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runEvalHarness(process.argv.slice(2)).then(
    (outcome) => {
      process.exitCode = outcome.exitCode;
    },
    (error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    },
  );
}
