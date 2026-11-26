'use strict';

function noopProgress() {}

/**
 * @typedef {(git: { [key: string]: (...args: unknown[]) => unknown }, cwd: unknown, body: { [key: string]: unknown }) => unknown} GitTunnelHandler
 */

/** @type {Record<string, GitTunnelHandler>} */
const GIT_TUNNEL_HANDLERS = {
  'git-status': (git, cwd) => git.gitStatus(cwd),
  'git-fetch-status': (git, cwd) => git.gitFetchForStatus(cwd),
  'git-pull-request': (git, cwd) => git.gitReadPullRequest(cwd),
  'git-init': (git, cwd) => git.gitInit(cwd),
  'git-diff': (git, cwd, body) => git.gitDiff(cwd, body.options || body),
  'git-commit': (git, cwd, body) => git.gitCommit(
    cwd,
    body.message,
    body.filePaths,
    typeof body.onProgress === 'function' ? body.onProgress : noopProgress,
    body.options || {},
  ),
  'git-push': (git, cwd) => git.gitPush(cwd, noopProgress),
  'git-pull': (git, cwd) => git.gitPull(cwd, noopProgress),
  'git-create-change-request': (git, cwd, body) => git.gitCreateChangeRequest(cwd, body.input || body, noopProgress),
  'git-publish': (git, cwd, body) => git.gitPublishRepository(cwd, body.input || body, noopProgress),
  'git-status-entries': (git, cwd) => git.gitStatusEntries(cwd),
  'git-branch-list': (git, cwd) => git.gitBranchList(cwd),
  'git-switch-branch': (git, cwd, body) => git.gitSwitchBranch(cwd, body.ref),
  'git-create-branch': (git, cwd, body) => git.gitCreateBranch(cwd, body.name),
  // Hunk-level patch staging only; full git-stage/git-unstage/git-discard remain excluded.
  'git-stage-patch': (git, cwd, body) => git.gitStagePatch(cwd, body.patchText),
  'git-unstage-patch': (git, cwd, body) => git.gitUnstagePatch(cwd, body.patchText),
};

const GIT_TUNNEL_ACTIONS = new Set(Object.keys(GIT_TUNNEL_HANDLERS));

/** @param {unknown} action */
function isAllowedGitAction(action) {
  return typeof action === 'string' && GIT_TUNNEL_ACTIONS.has(action);
}

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
  const handler = GIT_TUNNEL_HANDLERS[/** @type {string} */ (action)];
  if (typeof handler !== 'function') {
    throw new Error(`git 操作不允许转发：${action}`);
  }
  const body = /** @type {{ [key: string]: unknown }} */ (payload && typeof payload === 'object' ? payload : {});
  return handler(git, cwd, body);
}

module.exports = {
  GIT_TUNNEL_ACTIONS,
  isAllowedGitAction,
  dispatchGitTunnel,
};
