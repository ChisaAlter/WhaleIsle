'use strict';

const GIT_TUNNEL_ACTIONS = new Set([
  'git-status',
  'git-fetch-status',
  'git-pull-request',
  'git-init',
  'git-diff',
  'git-commit',
  'git-push',
  'git-pull',
  'git-create-change-request',
  'git-publish',
  'git-status-entries',
  'git-branch-list',
  'git-switch-branch',
  'git-create-branch',
]);

/** @param {unknown} action */
function isAllowedGitAction(action) {
  return typeof action === 'string' && GIT_TUNNEL_ACTIONS.has(action);
}

function noopProgress() {}

/**
 * @param {{ action?: unknown, cwd?: unknown, payload?: unknown,
 *           git?: { [key: string]: (...args: unknown[]) => unknown } | null }} options
 */
async function dispatchGitTunnel({ action, cwd, payload, git }) {
  if (!isAllowedGitAction(action)) {
    throw new Error(`git 操作不允许转发：${action}`);
  }
  if (!git || typeof git !== 'object') {
    throw new Error('git 后端未安装');
  }
  const body = /** @type {{ [key: string]: unknown }} */ (payload && typeof payload === 'object' ? payload : {});
  switch (action) {
    case 'git-status':
      return git.gitStatus(cwd);
    case 'git-fetch-status':
      return git.gitFetchForStatus(cwd);
    case 'git-pull-request':
      return git.gitReadPullRequest(cwd);
    case 'git-init':
      return git.gitInit(cwd);
    case 'git-diff':
      return git.gitDiff(cwd, body.options || body);
    case 'git-commit':
      return git.gitCommit(
        cwd,
        body.message,
        body.filePaths,
        typeof body.onProgress === 'function' ? body.onProgress : noopProgress,
        body.options || {},
      );
    case 'git-push':
      return git.gitPush(cwd, noopProgress);
    case 'git-pull':
      return git.gitPull(cwd, noopProgress);
    case 'git-create-change-request':
      return git.gitCreateChangeRequest(cwd, body.input || body, noopProgress);
    case 'git-publish':
      return git.gitPublishRepository(cwd, body.input || body, noopProgress);
    case 'git-status-entries':
      return git.gitStatusEntries(cwd);
    case 'git-branch-list':
      return git.gitBranchList(cwd);
    case 'git-switch-branch':
      return git.gitSwitchBranch(cwd, body.ref);
    case 'git-create-branch':
      return git.gitCreateBranch(cwd, body.name);
    default:
      throw new Error(`git 操作不允许转发：${action}`);
  }
}

module.exports = {
  GIT_TUNNEL_ACTIONS,
  isAllowedGitAction,
  dispatchGitTunnel,
};
