/**
 * Offline maturity check suite coordinator and desktop git-hunk partial patch test.
 * @module scripts/eval-harness/offline-checks
 */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { promisify } from 'node:util';
import gitDiffModule from '../../src/main/git-diff.js';
import gitExecModule from '../../src/main/git-exec.js';
import workspaceAuthorityModule from '../../src/main/workspace-authority.js';
import {
  runEditOfflineCheck,
  runGlobOfflineCheck,
  runGrepOfflineCheck,
  runLspDiagnosticsOfflineCheck,
  runMcpDeferredOfflineCheck,
  runSubagentWorktreeOfflineCheck,
  runWinAclOfflineCheck,
} from './offline-dsh-checks.mjs';

const execFileAsync = promisify(execFile);

/**
 * Verify `src/main/git-diff.js` `gitStagePatch` / `gitUnstagePatch` on a temporary repo
 * and verify out-of-bounds hunk rejection.
 * @param {string} workDir
 * @returns {Promise<{ stagedOnlyFirstHunk: boolean, unstagedBackToClean: boolean, rejectedBadPatch: boolean }>}
 */
export async function runGitHunkOfflineCheck(workDir) {
  const repoDir = path.join(workDir, 'git-hunk-repo');
  fs.mkdirSync(repoDir, { recursive: true });
  const initialLines = Array.from({ length: 16 }, (_, idx) => `line-${idx + 1}`).join('\n') + '\n';
  fs.writeFileSync(path.join(repoDir, 'notes.txt'), initialLines, 'utf8');

  await execFileAsync('git', ['init'], { cwd: repoDir });
  await execFileAsync('git', ['config', 'user.name', 'Eval Harness'], { cwd: repoDir });
  await execFileAsync('git', ['config', 'user.email', 'eval@example.invalid'], { cwd: repoDir });
  await execFileAsync('git', ['add', 'notes.txt'], { cwd: repoDir });
  await execFileAsync('git', ['commit', '-m', 'init'], { cwd: repoDir });

  const modifiedLines = initialLines
    .replace('line-2', 'line-2-edited')
    .replace('line-14', 'line-14-edited');
  fs.writeFileSync(path.join(repoDir, 'notes.txt'), modifiedLines, 'utf8');

  const singleHunkPatch = [
    'diff --git a/notes.txt b/notes.txt',
    '--- a/notes.txt',
    '+++ b/notes.txt',
    '@@ -1,4 +1,4 @@',
    ' line-1',
    '-line-2',
    '+line-2-edited',
    ' line-3',
    ' line-4',
    '',
  ].join('\n');

  gitExecModule.setWorkspaceAuthority(workspaceAuthorityModule.createWorkspaceAuthority({ workspace: repoDir }));
  try {
    const stageRes = await gitDiffModule.gitStagePatch(repoDir, singleHunkPatch);
    assert.equal(stageRes.ok, true, `expected partial hunk stage ok=true, got ${stageRes.message ?? ''}`);

    const { stdout: staged } = await execFileAsync('git', ['diff', '--cached', '--', 'notes.txt'], { cwd: repoDir, encoding: 'utf8' });
    const { stdout: unstaged } = await execFileAsync('git', ['diff', '--', 'notes.txt'], { cwd: repoDir, encoding: 'utf8' });
    const stagedOnlyFirstHunk = staged.includes('+line-2-edited') && !staged.includes('+line-14-edited') && unstaged.includes('+line-14-edited');
    assert.equal(stagedOnlyFirstHunk, true, 'expected only first hunk staged and second hunk remaining unstaged');

    const unstageRes = await gitDiffModule.gitUnstagePatch(repoDir, singleHunkPatch);
    assert.equal(unstageRes.ok, true, `expected partial hunk unstage ok=true, got ${unstageRes.message ?? ''}`);
    const { stdout: afterUnstage } = await execFileAsync('git', ['diff', '--cached', '--', 'notes.txt'], { cwd: repoDir, encoding: 'utf8' });
    const unstagedBackToClean = afterUnstage.trim() === '';
    assert.equal(unstagedBackToClean, true, 'expected empty staged index after gitUnstagePatch');

    const badPatch = [
      'diff --git a/../escape.txt b/../escape.txt',
      '--- a/../escape.txt',
      '+++ b/../escape.txt',
      '@@ -999,1 +999,1 @@',
      '-missing',
      '+boom',
      '',
    ].join('\n');
    const badRes = await gitDiffModule.gitStagePatch(repoDir, badPatch);
    const rejectedBadPatch = badRes.ok === false;
    assert.equal(rejectedBadPatch, true, 'expected invalid out-of-bounds patch to be rejected');

    return { stagedOnlyFirstHunk, unstagedBackToClean, rejectedBadPatch };
  } finally {
    gitExecModule.setWorkspaceAuthority(null);
  }
}

/**
 * Default offline check registry mapping task IDs to async check implementations.
 * @returns {Record<string, (workDir: string) => Promise<Record<string, unknown>>>}
 */
export function createDefaultOfflineRunners() {
  return {
    edit: workDir => runEditOfflineCheck(workDir),
    glob: workDir => runGlobOfflineCheck(workDir),
    grep: workDir => runGrepOfflineCheck(workDir),
    'git-hunk': workDir => runGitHunkOfflineCheck(workDir),
    'win-acl': workDir => runWinAclOfflineCheck(workDir),
    'mcp-deferred': () => runMcpDeferredOfflineCheck(),
    'lsp-diagnostics': () => runLspDiagnosticsOfflineCheck(),
    'subagent-worktree': workDir => runSubagentWorktreeOfflineCheck(workDir),
  };
}

/**
 * Execute requested offline checks inside `workDir` and return per-task results.
 * @param {{
 *   tasks: readonly string[],
 *   workDir: string,
 *   runners?: Record<string, (workDir: string) => Promise<Record<string, unknown>>>,
 * }} options
 * @returns {Promise<import('./report.mjs').EvalTaskResult[]>}
 */
export async function runOfflineSuite({ tasks, workDir, runners = createDefaultOfflineRunners() }) {
  /** @type {import('./report.mjs').EvalTaskResult[]} */
  const results = [];
  for (const name of tasks) {
    const runner = runners[name];
    const started = performance.now();
    if (!runner) {
      results.push({
        name,
        pass: false,
        durationMs: Math.round(performance.now() - started),
        error: `Unknown offline task "${name}"`,
      });
      continue;
    }
    try {
      const details = await runner(workDir);
      results.push({
        name,
        pass: true,
        durationMs: Math.round(performance.now() - started),
        details,
      });
    } catch (error) {
      results.push({
        name,
        pass: false,
        durationMs: Math.round(performance.now() - started),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return results;
}
