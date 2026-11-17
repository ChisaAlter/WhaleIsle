#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { atomicWriteFileSync, withOwnedTempDir } from '../src/shared/fs-safe.js';
import { killProcessTree, spawnTreeOptions } from '../src/shared/process-tree.js';
import { electronSpawnEnv, initGitWorkspace, reservePort, writeSmokeConfig } from './smoke-workspace.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** @typedef {{schemaVersion?: number, ok: boolean, error?: string, startupMs?: number, restartMs?: number, mainThreadLagMs?: number, peakWorkingSetMiB?: number, platform?: string, arch?: string, revision?: string | null, measuredAt?: string}} RuntimeReport */
/** @typedef {'startupMs' | 'restartMs' | 'mainThreadLagMs' | 'peakWorkingSetMiB'} Metric */
/** @typedef {{metric: Metric, value: number, limit: number, exceeded: boolean, delta: number | null}} Assessment */
/** @type {Record<Metric, number>} */
const BUDGETS = JSON.parse(readFileSync(new URL('./desktop-runtime-budgets.json', import.meta.url), 'utf8'));
/** @type {Metric[]} */
const METRICS = ['startupMs', 'restartMs', 'mainThreadLagMs', 'peakWorkingSetMiB'];

/** @param {RuntimeReport} report
 * @param {Record<Metric, number>} [budgets]
 * @param {RuntimeReport | null} [previous]
 * @returns {Assessment[]}
 */
export function assess(report, budgets = BUDGETS, previous = null) {
  if (report.ok !== true) throw new Error(report.error || 'Runtime measurement did not complete');
  return METRICS.map(metric => {
    const value = report[metric];
    const limit = budgets[metric];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || !Number.isFinite(limit) || limit <= 0) {
      throw new Error(`Invalid metric or budget: ${metric}`);
    }
    const prior = previous?.ok === true && previous.platform === report.platform && previous.arch === report.arch
      ? previous[metric] : null;
    return { metric, value, limit, exceeded: value > limit,
      delta: typeof prior === 'number' && Number.isFinite(prior) ? value - prior : null };
  });
}

/** @param {RuntimeReport} report @param {Assessment[]} rows */
export function summary(report, rows) {
  return [`# Desktop runtime: ${report.platform}/${report.arch}`, '',
    `Revision: ${report.revision || 'prepared snapshot (see sourceHashes in report.json)'}; ${report.measuredAt}`, '',
    'Fresh process and isolated profile; filesystem/OS caches are not flushed. Startup ends at the assembled workbench. Restart uses shell:restart and ends at the workbench. Main-thread lag is the maximum delay of a 25 ms timer across both phases. Memory is the sampled peak sum of Electron process working sets; it excludes the separate Harness Node process.', '',
    '| Metric | Observed | Investigation budget | Change from comparable previous run | Result |',
    '| --- | ---: | ---: | ---: | --- |',
    ...rows.map(row => `| ${row.metric} | ${row.value.toFixed(2)} | ${row.limit} | ${row.delta === null ? 'unavailable' : row.delta.toFixed(2)} | ${row.exceeded ? 'OVER BUDGET' : 'within budget'} |`), '',
    'Budgets trigger investigation, not timing assertions in ordinary tests. A single maximum does not establish a leak or a latency percentile.', ''].join('\n');
}

/** @param {NodeJS.ProcessEnv} base */
export function measurementEnv(base) {
  const env = { ...base };
  delete env.ELECTRON_RUN_AS_NODE;
  for (const key of Object.keys(env)) {
    if (key === 'DSH_SMOKE' || key.startsWith('DSH_QA') || key === 'DSH_REMOTE_PHONE_HOST' || key === 'DSH_THEME_SMOKE') delete env[key];
  }
  return env;
}

/** @param {string} out @param {string | null} previousPath @param {string} [sourceRoot] */
async function run(out, previousPath, sourceRoot = ROOT) {
  if (!out || existsSync(out)) throw new Error('--out must name a new result directory');
  mkdirSync(out, { recursive: true });
  const reportPath = path.join(out, 'report.json');
  const measuredFiles = ['src/main/index.js', 'src/main/harness-controller.js', 'src/main/app-lifecycle.js'];
  const hashes = () => Object.fromEntries(measuredFiles
    .map(file => [file, createHash('sha256').update(readFileSync(path.join(sourceRoot, file))).digest('hex')]));
  const sourceHashes = hashes();
  await withOwnedTempDir('whale-runtime-perf-', async scratch => {
    const userData = path.join(scratch, 'user-data');
    const workspace = path.join(scratch, 'workspace');
    mkdirSync(userData); mkdirSync(workspace);
    initGitWorkspace(workspace);
    writeSmokeConfig(userData, workspace, await reservePort());
    const executable = process.env.ELECTRON_PATH || createRequire(import.meta.url)('electron');
    const child = spawn(executable, [path.join(ROOT, 'scripts/lib/desktop-runtime-perf.cjs'),
      `--source-root=${sourceRoot}`, `--perf-report=${reportPath}`, `--user-data-dir=${userData}`, '--no-first-run'], {
      cwd: sourceRoot, ...spawnTreeOptions(), env: measurementEnv(electronSpawnEnv()), stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', chunk => { output = (output + chunk).slice(-200000); });
    child.stderr.on('data', chunk => { output = (output + chunk).slice(-200000); });
    const closed = once(child, 'close');
    const timer = setTimeout(() => { if (child.pid) void killProcessTree(child.pid).catch(error => console.error(error.message)); }, 300000);
    try {
      const [code, signal] = await closed;
      if (code !== 0 || signal) throw new Error(`Electron measurement failed: exit=${code}, signal=${signal}`);
      if (!existsSync(reportPath)) throw new Error('Electron did not write its runtime report');
    } finally {
      clearTimeout(timer);
      if (child.exitCode === null && child.signalCode === null && child.pid) {
        await killProcessTree(child.pid);
        await closed;
      }
      atomicWriteFileSync(path.join(out, 'runtime.log'), output);
    }
  });
  if (JSON.stringify(sourceHashes) !== JSON.stringify(hashes())) throw new Error('Measured lifecycle source changed during the run');
  const git = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: sourceRoot, encoding: 'utf8' });
  const report = { ...JSON.parse(readFileSync(reportPath, 'utf8')), platform: process.platform, arch: process.arch,
    revision: git.status === 0 ? git.stdout.trim() : null, sourceHashes, measuredAt: new Date().toISOString() };
  const previous = previousPath ? JSON.parse(readFileSync(previousPath, 'utf8')) : null;
  const rows = assess(report, BUDGETS, previous);
  report.budgets = BUDGETS; report.assessment = rows;
  atomicWriteFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  const markdown = summary(report, rows);
  atomicWriteFileSync(path.join(out, 'summary.md'), markdown);
  console.log(markdown);
  for (const row of rows.filter(row => row.exceeded)) {
    console.log(`::warning title=Desktop performance budget::${row.metric}: ${row.value.toFixed(2)} > ${row.limit}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const out = args.indexOf('--out');
  const previous = args.indexOf('--previous');
  const source = args.indexOf('--source-root');
  if (args.some((arg, index) => index % 2 === 0 && !['--out', '--previous', '--source-root'].includes(arg)) || args.length % 2 || out < 0) {
    console.error('Usage: node scripts/measure-desktop-runtime.mjs --out <new directory> [--previous <report.json>] [--source-root <prepared checkout>]');
    process.exitCode = 1;
  } else {
    await run(path.resolve(args[out + 1]), previous < 0 ? null : path.resolve(args[previous + 1]), source < 0 ? ROOT : path.resolve(args[source + 1])).catch(error => {
      console.error(error.stack || error.message); process.exitCode = 1;
    });
  }
}
