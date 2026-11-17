// 逐行镜像 mobile/android :protocol git/GitQuick.kt GitQuickResolver。
// action 标签保持英文（Feature 卡不变式）。测试用例与 GitQuickShellTest.kt 同表。

function quick(label, disabled, kind, action = null, hint = '') {
  return { label, disabled, kind, action, hint };
}

function resolveGitQuick(status, busy) {
  if (busy) return quick('Commit', true, 'show_hint', null, 'Git 操作进行中。');
  const hasBranch = status.refName != null;
  const hasChanges = status.hasWorkingTreeChanges;
  const hasOpenPr = status.pr?.state === 'open';
  const isAhead = status.aheadCount > 0;
  const isBehind = status.behindCount > 0;
  const isDiverged = isAhead && isBehind;
  if (!hasBranch) return quick('Commit', true, 'show_hint', null, '请先创建并检出分支。');
  if (hasChanges) {
    if (!status.hasUpstream && !status.hasPrimaryRemote) {
      return quick('Commit', false, 'run_action', 'commit');
    }
    if (hasOpenPr || status.isDefaultRef) {
      return quick('Commit & push', false, 'run_action', 'commit_push');
    }
    return quick('Commit, push & PR', false, 'run_action', 'commit_push_pr');
  }
  if (!status.hasUpstream) {
    if (!status.hasPrimaryRemote) return quick('Publish repository', false, 'open_publish');
    return quick('Push', false, 'run_action', 'push');
  }
  if (isDiverged) return quick('Sync branch', true, 'show_hint', null, '分支已分叉，请先变基或合并。');
  if (isBehind) return quick('Pull', false, 'run_pull');
  if (isAhead) {
    if (hasOpenPr || status.isDefaultRef) return quick('Push', false, 'run_action', 'push');
    return quick('Push & create PR', false, 'run_action', 'create_pr');
  }
  if (hasOpenPr && status.hasUpstream) return quick('View PR', false, 'open_pr');
  return quick('Commit', true, 'show_hint', null, '分支已是最新，无需操作。');
}

function gitPillLabel(status, authError) {
  if (authError) return 'Git';
  if (typeof status.refName === 'string') return status.refName;
  return 'Initialize Git';
}

export { resolveGitQuick, gitPillLabel };
