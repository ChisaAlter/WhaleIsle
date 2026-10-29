const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { generateCommitMessage, generatePrContent } = require('./git-generate');
const { createTrace2Monitor } = require('./git-trace2');
const {
  asCwd,
  fail,
  ok,
  run,
  runGit,
  resetGitExecutableProbe,
  gitFailureMessage,
  withTruncationMarker,
  inferHookName,
  resolveInsideWorkspace,
  isPathInside,
  safeRefName,
  COMMIT_TIMEOUT_MS,
  PREPARED_COMMIT_PATCH_MAX_OUTPUT_BYTES,
  RANGE_DIFF_PATCH_MAX_OUTPUT_BYTES,
  setWorkspaceAuthority,
  gitChildEnv,
  sanitizeProgressText,
  isGitAdviceLine,
  GIT_TIMEOUT_MS,
  FETCH_TIMEOUT_MS,
  GH_TIMEOUT_MS,
  GIT_MAX_OUTPUT_BYTES,
  runGitUncached,
} = require('./git-exec');
const {
  normalizeGitRemoteUrl,
  parseGitHubRepositoryNameWithOwner,
  providerFromRemoteUrl,
  listRemoteNames,
  resolvePrimaryRemoteName,
  selectProviderContext,
  changeRequestTerms,
  defaultRefName,
  resolveBaseBranchForNoUpstream,
  computeAheadCountAgainstBase,
  resolveCurrentUpstream,
  resolvePushRemoteName,
  resolvePublishBranchName,
} = require('./git-remotes');
const {
  lookupOpenPullRequest,
  readPullRequest,
  resolveBranchHeadContext,
  rememberLastKnownPr,
  resolveLastKnownPr,
  matchesBranchHeadContext,
  parseGhPullRequestRow,
  setLookupOpenPullRequest,
  resetLastKnownPrCache,
} = require('./git-pullrequest');
const { fetchForStatus, resetFetchCooldowns } = require('./git-fetch');
const {
  createGitReadContext,
  armReadContext,
  acquireReadContext,
  touchReadContext,
  invalidateReadContext,
} = require('./git-read-context');
const { parseUnifiedDiff, gitDiff } = require('./git-diff');
const { readPrTemplate, resolvePrBaseBranch, setGhDefaultBranchResolver } = require('./git-templates');

/**
 * GitHub's hard per-file limit. A file must exceed this to be rejected, so a
 * file of exactly this size is not a problem: the check is `>`.
 */
const LARGE_FILE_WARNING_BYTES = 100 * 1024 * 1024;

/**
 * Surfaced when git cannot be spawned from PATH or a well-known install dir.
 * Carries install guidance so the error card is actionable, not a dead end.
 */
const GIT_UNAVAILABLE = 'Git is unavailable. Install Git for Windows: run "winget install Git.Git" or download https://git-scm.com/download/win';

/**
 * Git-for-Windows `core.protectNTFS` rejects these device names in any path
 * component, including `NUL.txt` and trailing dots/spaces.
 * @param {unknown} rel
 * @returns {boolean}
 */
function isNtfsReservedGitPath(rel) {
  const normalized = String(rel || '').replaceAll('\\', '/');
  if (!normalized) return false;
  return normalized.split('/').some((part) => {
    const stem = part.replace(/[. ]+$/g, '').split('.')[0];
    return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(stem);
  });
}

function emptyWorkingTree() {
  return { files: [], insertions: 0, deletions: 0 };
}

function notARepoStatus() {
  return {
    isRepo: false,
    refName: null,
    hasWorkingTreeChanges: false,
    workingTree: emptyWorkingTree(),
    hasUpstream: false,
    aheadCount: 0,
    behindCount: 0,
    aheadOfDefaultCount: 0,
    aheadUnreliable: false,
    pr: null,
    isDefaultRef: false,
    hasPrimaryRemote: false,
  };
}

function parseBranchAb(value) {
  const match = /^\+(\d+)\s+-(\d+)$/.exec(String(value || '').trim());
  if (!match) return { ahead: 0, behind: 0 };
  return { ahead: Number(match[1]), behind: Number(match[2]) };
}

function parsePorcelainV2Path(line) {
  if (line.startsWith('? ') || line.startsWith('! ')) {
    const simple = line.slice(2).trim();
    return simple.length > 0 ? simple : null;
  }
  if (!(line.startsWith('1 ') || line.startsWith('2 ') || line.startsWith('u '))) {
    return null;
  }
  const tabIndex = line.indexOf('\t');
  if (tabIndex >= 0) {
    const fromTab = line.slice(tabIndex + 1);
    const [filePath] = fromTab.split('\t');
    return filePath?.trim().length ? filePath.trim() : null;
  }
  const parts = line.trim().split(/\s+/g);
  const filePath = parts.at(-1) ?? '';
  return filePath.length > 0 ? filePath : null;
}

function isUnbornHeadStderr(stderr) {
  const lower = String(stderr || '').toLowerCase();
  return lower.includes('unknown revision') && lower.includes('path not in the working tree');
}

function parseNumstatEntries(stdout) {
  const entries = [];
  for (const line of String(stdout || '').split(/\r?\n/g)) {
    if (line.trim().length === 0) continue;
    const [addedRaw, deletedRaw, ...pathParts] = line.split('\t');
    const rawPath = pathParts.length > 1
      ? (pathParts.at(-1) ?? '').trim()
      : pathParts.join('\t').trim();
    if (rawPath.length === 0) continue;
    const added = addedRaw === '-' ? 0 : Number.parseInt(addedRaw ?? '0', 10);
    const deleted = deletedRaw === '-' ? 0 : Number.parseInt(deletedRaw ?? '0', 10);
    const renameArrowIndex = rawPath.indexOf(' => ');
    const normalizedPath = renameArrowIndex >= 0
      ? rawPath.slice(renameArrowIndex + ' => '.length).trim()
      : rawPath;
    entries.push({
      path: normalizedPath.length > 0 ? normalizedPath : rawPath,
      insertions: Number.isFinite(added) ? added : 0,
      deletions: Number.isFinite(deleted) ? deleted : 0,
    });
  }
  return entries;
}

function mergeNumstatMaps(rows) {
  const map = new Map();
  for (const entry of rows) {
    const existing = map.get(entry.path) ?? { insertions: 0, deletions: 0 };
    existing.insertions += entry.insertions;
    existing.deletions += entry.deletions;
    map.set(entry.path, existing);
  }
  return Array.from(map.entries()).map(([filePath, stat]) => ({
    path: filePath,
    insertions: stat.insertions,
    deletions: stat.deletions,
  }));
}

async function readWorkingTreeNumstat(root, run = runGit) {
  const head = await run(root, ['diff', 'HEAD', '--numstat']);
  if (head.code === 0) return parseNumstatEntries(head.stdout);
  if (isUnbornHeadStderr(head.stderr)) {
    const unstaged = await run(root, ['diff', '--numstat']);
    const staged = await run(root, ['diff', '--cached', '--numstat']);
    return mergeNumstatMaps([
      ...parseNumstatEntries(staged.stdout),
      ...parseNumstatEntries(unstaged.stdout),
    ]);
  }
  return parseNumstatEntries(head.stdout);
}

function buildWorkingTree(numstatEntries, porcelainPaths) {
  const fileStatMap = new Map();
  let insertions = 0;
  let deletions = 0;
  for (const entry of numstatEntries) {
    if (isNtfsReservedGitPath(entry.path)) continue;
    fileStatMap.set(entry.path, { insertions: entry.insertions, deletions: entry.deletions });
  }
  const files = Array.from(fileStatMap.entries()).map(([filePath, stat]) => {
    insertions += stat.insertions;
    deletions += stat.deletions;
    return { path: filePath, insertions: stat.insertions, deletions: stat.deletions };
  });
  for (const filePath of porcelainPaths) {
    if (fileStatMap.has(filePath) || isNtfsReservedGitPath(filePath)) continue;
    files.push({ path: filePath, insertions: 0, deletions: 0 });
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { files, insertions, deletions };
}

/**
 * The read seam of one refresh. `gitStatus` owns the context; the sibling
 * `gitFetchForStatus` / `gitReadPullRequest` calls of that same refresh acquire
 * it by (owner, worktree) and read through `context.run`.
 *
 * The defaults keep every non-refresh caller on a plain uncached spawn, so a
 * helper can never pick up another refresh's memory.
 */
const uncachedRun = (cwd, args, limits) => runGitUncached(cwd, args, limits);

/**
 * Run one refresh inside a fresh context.
 * @param {{ owner?: string | number }} [options]
 * @param {string} root resolved worktree root
 * @param {(context: object) => Promise<any>} work
 */
async function withReadContext(root, work, options = {}) {
  // A new refresh supersedes any context this owner left behind.
  invalidateReadContext(root);
  const context = armReadContext(options.owner, root, { runGitImpl: runGitUncached });
  try {
    const result = await work(context);
    context.setStatus(result);
    // A slow status walk must not expire its own sibling calls' window.
    touchReadContext(options.owner, root, context);
    return result;
  } catch (error) {
    invalidateReadContext(root);
    throw error;
  }
}

/**
 * Wrap a mutating git operation: run it, then drop this worktree's read
 * context so the next read can never answer from pre-write memory. The
 * invalidation runs on failure too — a partially applied write must not leave
 * a memo that claims the old state.
 * @template T
 * @param {string} root
 * @param {() => Promise<T>} work
 * @returns {Promise<T>}
 */
async function withWriteInvalidation(root, work) {
  try {
    return await work();
  } finally {
    invalidateReadContext(root);
  }
}

async function gitStatus(cwd, owner) {
  const root = asCwd(cwd);
  if (!root) return null;
  return statusForRoot(root, owner);
}

/**
 * The status walk for an already-authorized worktree root.
 *
 * `asCwd` re-stats the candidate and re-reads the registered-workspace list on
 * every call. Refresh internals already hold a canonical root, so they come
 * through here instead of paying that authorization cost again.
 * @param {string} root canonical authorized worktree root
 * @param {string | number} [owner]
 */
async function statusForRoot(root, owner) {
  // Every status call opens a new refresh: arm a fresh context so a reuse
  // window can never serve a previous refresh's answer, then let the sibling
  // fetch/PR calls of this same refresh reuse it.
  return withReadContext(root, context => readGitStatus(root, context.run), { owner });
}

/** The unmemoized status walk; `gitStatus` owns the context lifetime. */
async function readGitStatus(root, run = runGit) {
  const inside = await run(root, ['rev-parse', '--is-inside-work-tree']);
  if (inside.missing || inside.code !== 0 || inside.stdout.trim() !== 'true') {
    return notARepoStatus();
  }

  const porcelain = await run(root, ['status', '--porcelain=v2', '--branch']);
  if (porcelain.code !== 0) return null;
  let refName = null;
  let upstreamRef = null;
  let aheadCount = 0;
  let behindCount = 0;
  let sawAheadBehind = false;
  let hasWorkingTreeChanges = false;
  const changedFilesWithoutNumstat = new Set();
  for (const line of porcelain.stdout.split(/\r?\n/g)) {
    if (line.startsWith('# branch.head ')) {
      const value = line.slice('# branch.head '.length).trim();
      refName = value.startsWith('(') ? null : value;
      continue;
    }
    if (line.startsWith('# branch.upstream ')) {
      const value = line.slice('# branch.upstream '.length).trim();
      upstreamRef = value.length > 0 ? value : null;
      continue;
    }
    if (line.startsWith('# branch.ab ')) {
      const parsed = parseBranchAb(line.slice('# branch.ab '.length).trim());
      aheadCount = parsed.ahead;
      behindCount = parsed.behind;
      sawAheadBehind = true;
      continue;
    }
    if (line.trim().length > 0 && !line.startsWith('#')) {
      const filePath = parsePorcelainV2Path(line);
      if (filePath && isNtfsReservedGitPath(filePath)) continue;
      hasWorkingTreeChanges = true;
      if (filePath) changedFilesWithoutNumstat.add(filePath);
    }
  }

  const remotes = await run(root, ['remote']);
  const remoteNames = remotes.code === 0
    ? remotes.stdout.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)
    : [];
  const hasPrimaryRemote = remoteNames.includes('origin');
  const defaultRef = await defaultRefName(root, hasPrimaryRemote, run);
  const isDefaultRef = refName !== null && (
    refName === defaultRef || (defaultRef === null && (refName === 'main' || refName === 'master'))
  );
  // Porcelain v2 omits `# branch.ab` when the listed upstream is gone.
  const hasUsableUpstream = upstreamRef !== null && sawAheadBehind;
  const vsDefault = refName && (!isDefaultRef || !hasUsableUpstream)
    ? await computeAheadCountAgainstBase(root, refName, run)
    : { count: 0, unreliable: false };
  if (!hasUsableUpstream && refName) {
    aheadCount = vsDefault.count;
    behindCount = 0;
  }
  const aheadOfDefaultCount = isDefaultRef ? 0 : vsDefault.count;
  const selected = await selectProviderContext(root, run);
  const sourceControlProvider = selected?.provider;
  const numstatEntries = await readWorkingTreeNumstat(root, run);

  return {
    refName,
    hasWorkingTreeChanges,
    workingTree: buildWorkingTree(numstatEntries, changedFilesWithoutNumstat),
    hasUpstream: hasUsableUpstream,
    aheadCount,
    behindCount,
    aheadOfDefaultCount,
    aheadUnreliable: vsDefault.unreliable,
    pr: null,
    ...(sourceControlProvider ? { sourceControlProvider } : {}),
    isDefaultRef,
    hasPrimaryRemote,
    isRepo: true,
  };
}

/**
 * Initialize a git work tree at an authorized cwd that is not already one.
 * @param {unknown} cwd
 * @returns {Promise<{ ok: boolean, message?: string }>}
 */
async function gitInit(cwd) {
  const root = asCwd(cwd);
  if (!root) return fail('Git status is unavailable.');
  const inside = await runGit(root, ['rev-parse', '--is-inside-work-tree']);
  if (inside.code === 0 && inside.stdout.trim() === 'true') return ok();
  // Revoke before the write: a `git init` that fails halfway still moved the
  // on-disk state, so no reader may keep answering from the pre-write memo.
  invalidateReadContext(root);
  const inited = await runGit(root, ['init', '-b', 'main']);
  if (inited.missing) return fail(GIT_UNAVAILABLE);
  if (inited.timedOut) return fail('Git command timed out.');
  if (inited.code !== 0) return fail(inited.stderr.trim() || 'git init failed.');
  return ok();
}

/**
 * Build a commit subject from changed paths when staged context is absent.
 * @param {{ path: string }[]} files
 * @returns {string}
 */
function summarizeCommitMessage(files) {
  if (!Array.isArray(files) || files.length === 0) return 'Update project files';
  const first = files[0].path;
  if (files.length === 1) return `Update ${first}`;
  return `Update ${first} and ${files.length - 1} other files`;
}

function sanitizeFeatureBranchName(raw) {
  const normalized = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/['"`]/g, '')
    .replace(/^[./\s_-]+|[./\s_-]+$/g, '');
  const fragment = normalized
    .replace(/[^a-z0-9/_-]+/g, '-')
    .replace(/\/+/g, '/')
    .replace(/-+/g, '-')
    .replace(/^[./_-]+|[./_-]+$/g, '')
    .slice(0, 64)
    .replace(/[./_-]+$/g, '');
  const sanitized = fragment.length > 0 ? fragment : 'update';
  if (sanitized.includes('/')) {
    return sanitized.startsWith('feature/') ? sanitized : `feature/${sanitized}`;
  }
  return `feature/${sanitized}`;
}

function uniqueFeatureBranchName(existingNames, preferred) {
  const resolvedBase = sanitizeFeatureBranchName(preferred || 'update');
  const taken = new Set((existingNames || []).map((name) => String(name).toLowerCase()));
  if (!taken.has(resolvedBase)) return resolvedBase;
  let suffix = 2;
  while (taken.has(`${resolvedBase}-${suffix}`)) suffix += 1;
  return `${resolvedBase}-${suffix}`;
}

async function prepareCommitContext(root, filePaths) {
  const selected = Array.isArray(filePaths)
    ? filePaths.map((item) => String(item || '')).filter(Boolean)
    : [];
  let rels;
  if (selected.length > 0) {
    rels = [];
    for (const item of selected) {
      const { rel } = resolveGitPath(root, item);
      if (!rel) return { error: 'Path is outside the workspace.' };
      if (!isNtfsReservedGitPath(rel)) rels.push(rel);
    }
    if (rels.length === 0) return { skipped: true };
    await runGit(root, ['reset']);
  }

  let add = selected.length > 0
    ? await runGit(root, ['--literal-pathspecs', 'add', '-A', '--', ...rels])
    : await runGit(root, ['add', '-A']);
  if (add.missing) return { error: GIT_UNAVAILABLE };
  if (add.timedOut) return { error: 'Git command timed out.' };
  let stagedSummary = await runGit(root, ['diff', '--cached', '--name-status']);
  if (stagedSummary.timedOut) return { error: 'Git command timed out.' };
  let summary = stagedSummary.stdout.trim();
  if (!summary && selected.length === 0) {
    const listed = await gitStatusEntries(root);
    const fallback = (listed.ok ? listed.entries || [] : [])
      .map((entry) => entry.path)
      .filter((filePath) => filePath && !isNtfsReservedGitPath(filePath));
    if (fallback.length === 0) {
      if (!listed.ok && add.code !== 0) return { error: gitFailureMessage(add, 'git add failed.') };
      return { skipped: true };
    }
    add = await runGit(root, ['--literal-pathspecs', 'add', '-A', '--', ...fallback]);
    if (add.missing) return { error: GIT_UNAVAILABLE };
    if (add.timedOut) return { error: 'Git command timed out.' };
    stagedSummary = await runGit(root, ['diff', '--cached', '--name-status']);
    if (stagedSummary.timedOut) return { error: 'Git command timed out.' };
    summary = stagedSummary.stdout.trim();
  }
  if (add.code !== 0) return { error: gitFailureMessage(add, 'git add failed.') };
  if (!summary) return { skipped: true };
  const stagedPatch = await runGit(root, ['diff', '--no-ext-diff', '--cached', '--patch', '--minimal'], {
    maxBytes: PREPARED_COMMIT_PATCH_MAX_OUTPUT_BYTES,
  });
  return {
    stagedSummary: summary,
    stagedPatch: withTruncationMarker(stagedPatch.stdout, stagedPatch.truncated),
  };
}

async function runGitWithProgress(cwd, args, emit, limits = {}) {
  const monitor = createTrace2Monitor((event) => {
    if (event.kind === 'started') {
      emit({ kind: 'hook', hookName: event.hookName, title: `Running ${event.hookName}...` });
    }
    if (event.kind === 'finished') {
      emit({
        kind: 'hook_finished',
        hookName: event.hookName,
        title: `Finished ${event.hookName}`,
        text: event.exitCode === 0 || event.exitCode == null
          ? `${event.hookName} finished`
          : `${event.hookName} exited ${event.exitCode}`,
      });
    }
  });
  try {
    const result = await runGit(cwd, args, {
      ...limits,
      env: { ...monitor.env, ...(limits.env || {}) },
      onLine: (line) => {
        monitor.poll();
        const hook = inferHookName(line);
        if (hook) emit({ kind: 'hook', hookName: hook, title: `Running ${hook}...`, text: line });
        else emit({ kind: 'line', text: line });
      },
    });
    monitor.flush();
    return result;
  } finally {
    monitor.close();
  }
}

async function readHeadSha(cwd) {
  const head = await runGit(cwd, ['rev-parse', 'HEAD']);
  return head.code === 0 ? head.stdout.trim() : '';
}

/**
 * Current branch name, or null on detached/unborn HEAD. Cheap enough to run
 * inside a refresh context instead of recomputing the whole status walk.
 * @param {string} cwd
 * @returns {Promise<string | null>}
 */
async function readCurrentBranch(cwd, run = runGit) {
  const head = await run(cwd, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  if (head.code !== 0) return null;
  const name = head.stdout.trim();
  return name.length > 0 ? name : null;
}

/**
 * First line is the subject; remaining lines are the body.
 * @param {unknown} raw
 * @returns {{ subject: string, body: string } | null}
 */
function parseCustomCommitMessage(raw) {
  const normalized = String(raw || '').replace(/\r\n/g, '\n').trim();
  if (!normalized) return null;
  const [firstLine, ...rest] = normalized.split('\n');
  const subject = (firstLine || '').trim();
  if (!subject) return null;
  return { subject, body: rest.join('\n').trim() };
}

/** `git commit -m subject` plus optional `-m body`. */
function commitArgs(message) {
  const parsed = parseCustomCommitMessage(message);
  if (!parsed) return ['commit', '-m', 'Update'];
  if (!parsed.body) return ['commit', '-m', parsed.subject];
  return ['commit', '-m', parsed.subject, '-m', parsed.body];
}

async function gitCommit(cwd, message, filePaths, onProgress, options = {}) {
  const emit = typeof onProgress === 'function' ? onProgress : () => {};
  const root = asCwd(cwd);
  if (!root) return fail('Git status is unavailable.');
  const prepared = await prepareCommitContext(root, filePaths);
  if (prepared.error) return fail(prepared.error);
  if (prepared.skipped) {
    if (options.featureBranch) {
      return fail('Cannot create a feature branch because there are no changes to commit.');
    }
    return ok({ skipped: true, status: 'skipped' });
  }

  const custom = parseCustomCommitMessage(message);
  const hasCustom = custom !== null;
  // Keep custom messages verbatim; sanitize only model/heuristic output.
  let suggestion = hasCustom
    ? {
      subject: custom.subject,
      body: custom.body,
      ...(options.featureBranch ? { branch: sanitizeFeatureBranchName(custom.subject) } : {}),
    }
    : null;

  const resolveGenerated = async () => {
    const recent = await runGit(root, ['log', '-n', '8', '--pretty=%s']);
    return generateCommitMessage({
      stagedSummary: prepared.stagedSummary,
      stagedPatch: prepared.stagedPatch,
      includeBranch: Boolean(options.featureBranch),
      recentSubjects: recent.code === 0 ? recent.stdout.trim() : '',
    });
  };

  if (options.featureBranch) {
    emit({ kind: 'phase', title: 'Preparing feature ref...' });
    if (!hasCustom) {
      suggestion = await resolveGenerated();
      if (suggestion.error) return fail(suggestion.error);
    }
    const listed = await gitBranchList(root);
    if (!listed.ok) return fail(listed.message || 'git branch list failed.');
    const nextRef = uniqueFeatureBranchName(
      (listed.branches || []).map((ref) => ref.name),
      suggestion.branch || suggestion.subject,
    );
    const created = await gitCreateBranch(root, nextRef);
    if (!created.ok) return fail(created.message || 'git checkout -b failed.');
  } else if (!hasCustom) {
    emit({ kind: 'phase', title: 'Generating commit message...' });
    suggestion = await resolveGenerated();
    if (suggestion.error) return fail(suggestion.error);
  }

  emit({ kind: 'phase', title: 'Committing...' });
  const text = suggestion.body
    ? `${suggestion.subject}\n\n${suggestion.body}`
    : suggestion.subject;
  // A commit (or its hooks) may have moved the index/HEAD even when it exits
  // non-zero, so drop the refresh memo before the write, not only after it.
  invalidateReadContext(root);
  const commit = await runGitWithProgress(root, commitArgs(text), emit, {
    timeoutMs: COMMIT_TIMEOUT_MS,
  });
  if (commit.timedOut) return fail('Git command timed out.');
  if (commit.code !== 0) return fail(gitFailureMessage(commit, 'git commit failed.'));
  const commitSha = await readHeadSha(root);
  return ok({
    status: 'created',
    commitSha,
    subject: suggestion.subject,
    body: suggestion.body,
    suggestedBranch: sanitizeFeatureBranchName(suggestion.branch || suggestion.subject),
  });
}

/**
 * Refresh remotes then return local porcelain status. Titlebar polls stay on `gitStatus`.
 * @param {unknown} cwd
 * @returns {Promise<object | null>}
 */
async function gitFetchForStatus(cwd, owner) {
  const root = asCwd(cwd);
  if (!root) return null;
  const context = acquireReadContext(owner, root);
  if (!context) {
    await fetchForStatus(root, uncachedRun);
    return statusForRoot(root, owner);
  }
  const fetched = await fetchForStatus(root, context.run);
  if (context.isRevoked()) {
    // A concurrent fresh status call superseded this refresh mid-fetch. Its
    // memo is gone, so rebuild the snapshot on a fresh context rather than
    // reading half-revoked entries.
    return statusForRoot(root, owner);
  }
  // A fetch that outlived the 2s idle window still belongs to this refresh.
  touchReadContext(owner, root, context);
  if (!fetched || fetched.fetched !== true) {
    // Fetch was skipped inside its cooldown, so nothing it could affect has
    // moved: reuse the status this refresh already computed instead of walking
    // porcelain and numstat a second time.
    return context.getStatus() ?? readGitStatus(root, context.run);
  }
  // A real fetch moved remote-tracking refs, so anything derived from them
  // (branch.ab, rev-list/show-ref/symbolic-ref) must not come from memory.
  // The working-tree diff stays memoized: a fetch cannot change it.
  context.forget((args) => args[0] !== 'diff');
  const refreshed = await readGitStatus(root, context.run);
  // Keep the refresh's snapshot current: the PR sibling reads this branch name.
  context.setStatus(refreshed);
  touchReadContext(owner, root, context);
  return refreshed;
}

/**
 * Look up the open GitHub PR for HEAD. Kept off the status poll so focus refresh stays local.
 * Transient `gh` failures keep the last successful badge for this branch.
 * @param {unknown} cwd
 * @returns {Promise<{ ok: boolean, pr?: object | null, message?: string }>}
 */
async function gitReadPullRequest(cwd, owner) {
  const root = asCwd(cwd);
  if (!root) return fail('Git status is unavailable.');
  // The refresh's status call already resolved the branch (and armed its read
  // context). Only the branch name is needed here — the PR lookup must not walk
  // the whole status path a third time.
  let context = acquireReadContext(owner, root);
  // The status call of this same refresh already resolved the branch; only
  // fall back to a real status walk when there is no armed context.
  const status = context ? context.getStatus() : await statusForRoot(root, owner);
  if (!context) {
    // `gitStatus` just armed a context for this owner; pick it up so the PR
    // lookup reuses the same child processes instead of spawning its own.
    context = acquireReadContext(owner, root);
  }
  const refName = context && !context.getStatus()
    ? await readCurrentBranch(root, context.run)
    : status?.refName;
  if (!refName) return ok({ pr: null });
  const branchKey = `${root}\u0000${refName}`;
  // `gh` must not run through the git read context.
  const readRun = context ? context.run : uncachedRun;
  const looked = await lookupOpenPullRequest(root, refName, readRun);
  const headContext = looked.headContext || await resolveBranchHeadContext(root, refName, readRun);
  const current = {
    upstreamRef: headContext.upstreamRef,
    headBranch: headContext.headBranch,
    remoteName: headContext.remoteName,
    headRemoteUrlKey: headContext.headRemoteUrlKey,
    targetRepositoryUrlKey: headContext.targetRepositoryUrlKey,
  };
  if (looked.failed) {
    return ok({ pr: resolveLastKnownPr(branchKey, current) });
  }
  rememberLastKnownPr(branchKey, { pr: looked.pr, ...current });
  return ok({ pr: looked.pr });
}

async function ensurePrimaryRemoteHead(root, fallbackBranch) {
  try {
    const primary = await resolvePrimaryRemoteName(root);
    if (!primary) return;
    const headRef = `refs/remotes/${primary}/HEAD`;
    const existing = await runGit(root, ['symbolic-ref', '--quiet', headRef]);
    if (existing.code === 0) {
      const target = existing.stdout.trim();
      if (target) {
        const hasTarget = await runGit(root, ['show-ref', '--verify', '--quiet', target]);
        if (hasTarget.code === 0) return;
      }
    }
    const auto = await runGit(root, ['remote', 'set-head', primary, '--auto']);
    if (auto.code === 0) {
      const after = await runGit(root, ['symbolic-ref', '--quiet', headRef]);
      if (after.code === 0) {
        const target = after.stdout.trim();
        if (target) {
          const hasTarget = await runGit(root, ['show-ref', '--verify', '--quiet', target]);
          if (hasTarget.code === 0) return;
        }
      }
    }
    const name = typeof fallbackBranch === 'string' ? fallbackBranch.trim() : '';
    if (!name) return;
    await runGit(root, ['remote', 'set-head', primary, name]);
  } catch {
    // Best-effort: missing origin/HEAD only affects default-ref CTA, not the push.
  }
}

async function gitPush(cwd, onProgress) {
  const emit = typeof onProgress === 'function' ? onProgress : () => {};
  emit({ kind: 'phase', title: 'Pushing...' });
  const root = asCwd(cwd);
  if (!root) return fail('Git status is unavailable.');
  await fetchForStatus(root);
  const status = await gitStatus(cwd);
  if (!status?.refName) return fail('Cannot push from detached HEAD.');
  const done = async (result) => {
    if (result.ok) await ensurePrimaryRemoteHead(root, status.refName);
    return result;
  };
  const hasNoLocalDelta = status.aheadCount === 0 && status.behindCount === 0;
  if (hasNoLocalDelta && !status.aheadUnreliable) {
    if (status.hasUpstream) {
      return done(ok({ skipped: true, status: 'skipped', branch: status.refName }));
    }
    // No-upstream skip uses resolveBaseBranchForNoUpstream (gh-merge-base included).
    const comparableBase = await resolveBaseBranchForNoUpstream(root, status.refName);
    if (comparableBase) {
      const remote = await resolvePushRemoteName(root, status.refName);
      if (!remote) {
        return done(ok({ skipped: true, status: 'skipped', branch: status.refName }));
      }
      const remoteRef = await runGit(root, [
        'show-ref',
        '--verify',
        '--quiet',
        `refs/remotes/${remote}/${status.refName}`,
      ]);
      if (remoteRef.code === 0) {
        return done(ok({ skipped: true, status: 'skipped', branch: status.refName }));
      }
    }
  }
  const limits = { timeoutMs: COMMIT_TIMEOUT_MS };
  let pushed;
  let upstreamBranch = null;
  // A push may update tracking refs before failing (partial refspec, rejected
  // updates); drop the memo up front so no reader survives a failed push.
  invalidateReadContext(root);
  if (status.hasUpstream) {
    const upstream = await resolveCurrentUpstream(root);
    upstreamBranch = upstream?.upstreamRef || null;
    pushed = upstream
      ? await runGitWithProgress(root, ['push', upstream.remoteName, `HEAD:refs/heads/${upstream.branchName}`], emit, limits)
      : await runGitWithProgress(root, ['push'], emit, limits);
  } else {
    const remote = await resolvePushRemoteName(root, status.refName);
    if (!remote) return fail('Cannot push because no git remote is configured for this repository.');
    const publishBranch = await resolvePublishBranchName(root, status.refName);
    upstreamBranch = `${remote}/${publishBranch}`;
    pushed = await runGitWithProgress(root, ['push', '-u', remote, `HEAD:refs/heads/${publishBranch}`], emit, limits);
  }
  if (pushed.missing) return fail(GIT_UNAVAILABLE);
  if (pushed.timedOut) return fail('Git command timed out.');
  if (pushed.code !== 0) return fail(gitFailureMessage(pushed, 'git push failed.'));
  return done(ok({
    status: 'pushed',
    branch: status.refName,
    upstreamBranch,
    commitSha: await readHeadSha(root),
  }));
}

async function gitPull(cwd, onProgress) {
  const emit = typeof onProgress === 'function' ? onProgress : () => {};
  emit({ kind: 'phase', title: 'Pulling...' });
  const root = asCwd(cwd);
  if (!root) return fail('Git status is unavailable.');
  return withWriteInvalidation(root, async () => {
    await fetchForStatus(root, uncachedRun);
    const status = await gitStatus(cwd);
    if (!status?.refName) return fail('Cannot pull from detached HEAD.');
    if (!status.hasUpstream) {
      return fail('Current branch has no upstream configured. Push with upstream first.');
    }
    const beforeSha = await readHeadSha(root);
    // The pull (and its merge hooks) may move HEAD before reporting failure.
    invalidateReadContext(root);
    const pulled = await runGitWithProgress(root, ['pull', '--ff-only'], emit, {
      timeoutMs: COMMIT_TIMEOUT_MS,
    });
    if (pulled.missing) return fail(GIT_UNAVAILABLE);
    if (pulled.timedOut) return fail('Git command timed out.');
    if (pulled.code !== 0) return fail(gitFailureMessage(pulled, 'git pull failed.'));
    const afterSha = await readHeadSha(root);
    const upstream = await resolveCurrentUpstream(root);
    const pullStatus = beforeSha && beforeSha === afterSha ? 'up_to_date' : 'pulled';
    return ok({
      status: pullStatus,
      refName: status.refName,
      upstreamRef: upstream?.upstreamRef || null,
    });
  });
}

/**
 * Preferred `--head` for `gh pr create` (fork → `owner:branch`).
 * @param {string} cwd
 * @param {string} refName
 * @param {object} [targetRepository]
 * @returns {Promise<string>}
 */
async function resolvePreferredHeadSelector(cwd, refName, targetRepository) {
  const ctx = await resolveBranchHeadContext(cwd, refName, targetRepository);
  return ctx.preferredHeadSelector;
}

async function collectRangeContext(cwd, range) {
  const [commitSummary, diffSummary, diffPatch] = await Promise.all([
    runGit(cwd, ['log', '--oneline', range]),
    runGit(cwd, ['diff', '--stat', range]),
    runGit(cwd, ['diff', '--no-ext-diff', '--patch', '--minimal', range], {
      maxBytes: RANGE_DIFF_PATCH_MAX_OUTPUT_BYTES,
    }),
  ]);
  return {
    commitSummary: commitSummary.stdout.trim(),
    diffSummary: diffSummary.stdout.trim(),
    diffPatch: withTruncationMarker(diffPatch.stdout, diffPatch.truncated),
  };
}

async function rangeHasCommits(cwd, range) {
  const listed = await runGit(cwd, ['rev-list', '--count', range]);
  if (listed.code !== 0) return false;
  const count = Number(listed.stdout.trim());
  return Number.isFinite(count) && count > 0;
}

async function readRangeContext(cwd) {
  const remote = await resolvePrimaryRemoteName(cwd);
  const candidates = [];
  if (remote) {
    const symbolic = await runGit(cwd, ['rev-parse', '--verify', '--quiet', `${remote}/HEAD`]);
    if (symbolic.code === 0) candidates.push(`${remote}/HEAD`);
    const defaultRef = await defaultRefName(cwd, true);
    if (defaultRef) candidates.push(`${remote}/${defaultRef}`);
  }
  const localDefault = await defaultRefName(cwd, false);
  if (localDefault) candidates.push(localDefault);

  for (const base of candidates) {
    const range = `${base}..HEAD`;
    if (await rangeHasCommits(cwd, range)) {
      return { ...(await collectRangeContext(cwd, range)), baseRef: base };
    }
  }

  const counted = await runGit(cwd, ['rev-list', '--count', 'HEAD']);
  const total = Number(counted.stdout.trim());
  const depth = Number.isFinite(total) && total > 1 ? Math.min(20, total - 1) : 0;
  if (depth > 0) {
    return { ...(await collectRangeContext(cwd, `HEAD~${depth}..HEAD`)), baseRef: `HEAD~${depth}` };
  }
  return { ...(await collectRangeContext(cwd, 'HEAD')), baseRef: 'HEAD' };
}

async function gitCreateChangeRequest(cwd, input, onProgress) {
  const emit = typeof onProgress === 'function' ? onProgress : () => {};
  const root = asCwd(cwd);
  if (!root) return fail('Git status is unavailable.');
  const status = await gitStatus(cwd);
  const terms = changeRequestTerms(status?.sourceControlProvider);
  emit({ kind: 'phase', title: `Preparing ${terms.shortLabel}...` });
  if (!status?.refName) return fail('Cannot create a pull request from detached HEAD.');
  const providerKind = status.sourceControlProvider?.kind;
  if (providerKind !== 'github') {
    return fail(
      `Creating a ${terms.singular} for ${status.sourceControlProvider?.name || providerKind || 'this remote'} is not supported yet (requires GitHub via gh).`,
    );
  }
  if (status.hasWorkingTreeChanges) {
    return fail('Commit local changes before creating a PR.');
  }
  if (!status.hasUpstream) {
    return fail('Current branch has not been pushed. Push before creating a PR.');
  }
  const existingLookup = await lookupOpenPullRequest(root, status.refName);
  const targetRepository = existingLookup.targetRepository;
  const headContext = existingLookup.headContext
    || await resolveBranchHeadContext(root, status.refName, targetRepository);
  const branchKey = `${root}\u0000${status.refName}`;
  // Last-known is status-badge only. Do not remember null (poisons the badge
  // after a successful create when a later list flakes).
  if (existingLookup.failed) {
    return fail('Could not look up existing pull requests (gh failed). Try again.');
  }
  if (existingLookup.pr) {
    rememberLastKnownPr(branchKey, {
      pr: existingLookup.pr,
      upstreamRef: headContext.upstreamRef,
      headBranch: headContext.headBranch,
      remoteName: headContext.remoteName,
      headRemoteUrlKey: headContext.headRemoteUrlKey,
      targetRepositoryUrlKey: headContext.targetRepositoryUrlKey,
    });
  }
  const existing = existingLookup.pr;
  if (existing && existing.state === 'open' && existing.url) {
    return ok({
      status: 'opened_existing',
      url: existing.url,
      number: existing.number,
      title: existing.title,
      skipped: true,
    });
  }

  const preserveProvided = Boolean(input?.preserveProvided);
  const providedTitle = typeof input?.title === 'string' ? input.title.trim() : '';
  const providedBody = typeof input?.body === 'string' ? input.body : '';
  let title = '';
  let body = '';
  // Resolve once and reuse for range copy + `gh pr create --base`.
  const baseBranch = await resolvePrBaseBranch(root, status.refName, Boolean(status.hasPrimaryRemote), targetRepository);
  if (preserveProvided && providedTitle) {
    title = providedTitle;
    body = providedBody;
  } else {
    emit({ kind: 'phase', title: `Generating ${terms.shortLabel} content...` });
    let remote = await resolvePrimaryRemoteName(root);
    if (targetRepository) {
      remote = null;
      for (const name of await listRemoteNames(root)) {
        const url = await runGit(root, ['remote', 'get-url', name]);
        if (url.code === 0 && normalizeGitRemoteUrl(url.stdout) === normalizeGitRemoteUrl(targetRepository.url)) {
          remote = name;
          break;
        }
      }
      if (!remote || (await runGit(root, ['rev-parse', '--verify', '--quiet', `refs/remotes/${remote}/${baseBranch}`])).code !== 0) {
        return fail('Fetch the pull request target branch before generating PR content.');
      }
    }
    const baseRangeRef = remote
      ? ((await runGit(root, ['rev-parse', '--verify', '--quiet', `${remote}/${baseBranch}`])).code === 0
        ? `${remote}/${baseBranch}`
        : baseBranch)
      : baseBranch;
    const range = await collectRangeContext(root, `${baseRangeRef}..HEAD`);
    const generated = await generatePrContent({
      ...range,
      fallbackTitle: status.refName || 'Change',
      changeRequestTemplate: await readPrTemplate(root, baseRangeRef),
    });
    if (generated.error) return fail(generated.error);
    title = generated.title;
    body = generated.body;
  }
  if (!title) return fail('Change request title is required.');
  if (!targetRepository) return fail('Could not resolve the pull request target repository.');

  emit({ kind: 'phase', title: `Creating ${terms.singular}...` });
  const bodyFile = path.join(os.tmpdir(), `dshd-pr-body-${process.pid}-${Date.now()}.md`);
  fs.writeFileSync(bodyFile, body);
  let created;
  try {
    const headSelector = headContext.preferredHeadSelector;
    const prArgs = ['pr', 'create', '--repo', targetRepository.url, '--title', title, '--body-file', bodyFile, '--head', headSelector];
    // Always pass --base when resolved (never omit when base === head name).
    if (baseBranch) prArgs.push('--base', baseBranch);
    created = await run('gh', prArgs, root, {
      timeoutMs: COMMIT_TIMEOUT_MS,
    });
  } finally {
    try {
      fs.unlinkSync(bodyFile);
    } catch {
      // Temp PR body is best-effort cleanup after gh exits.
    }
  }
  if (created.missing) return fail('gh is unavailable.');
  if (created.code !== 0) return fail(created.stderr.trim() || created.stdout.trim() || 'gh pr create failed.');
  const viewed = await readPullRequest(root, status.refName, targetRepository);
  const url = viewed?.url || created.stdout.trim().split(/\r?\n/).filter(Boolean).at(-1);
  // Only remember a real lookup row — do not invent number:0 when list flakes.
  if (viewed?.url && typeof viewed.number === 'number' && viewed.number > 0) {
    rememberLastKnownPr(branchKey, {
      pr: viewed,
      upstreamRef: headContext.upstreamRef,
      headBranch: headContext.headBranch,
      remoteName: headContext.remoteName,
      headRemoteUrlKey: headContext.headRemoteUrlKey,
      targetRepositoryUrlKey: headContext.targetRepositoryUrlKey,
    });
  }
  return ok({
    status: 'created',
    url,
    number: viewed?.number,
    title: viewed?.title || title,
  });
}

async function gitPublishRepository(cwd, input, onProgress) {
  const emit = typeof onProgress === 'function' ? onProgress : () => {};
  const root = asCwd(cwd);
  if (!root) return fail('Git status is unavailable.');
  const remotes = await listRemoteNames(root);
  // CTA offers Publish when origin is missing; allow other remotes (e.g. upstream only).
  if (remotes.includes('origin')) return fail('This repository already has an origin remote.');
  const remoteUrl = typeof input?.remoteUrl === 'string' ? input.remoteUrl.trim() : '';
  const name = typeof input?.name === 'string' && input.name.trim()
    ? input.name.trim()
    : path.basename(root);
  const visibility = input?.visibility === 'public' ? 'public' : 'private';
  emit({ kind: 'phase', title: 'Publishing repository...' });
  const headProbe = await runGit(root, ['rev-parse', '--verify', 'HEAD']);
  const hasCommits = headProbe.code === 0;
  if (remoteUrl) {
    // An `origin` that appears before the add reports failure still changed
    // the remote config; drop the memo before the write.
    invalidateReadContext(root);
    const added = await runGit(root, ['remote', 'add', 'origin', remoteUrl]);
    if (added.code !== 0) return fail(gitFailureMessage(added, 'git remote add failed.'));
    // Empty repo → remote_added without push (avoids opaque HEAD refspec failure).
    if (!hasCommits) return ok({ status: 'remote_added', remoteName: 'origin', url: remoteUrl });
    const pushed = await gitPush(root, onProgress);
    if (!pushed.ok) return pushed;
    return { ...pushed, url: remoteUrl, remoteName: 'origin' };
  }
  const createArgs = [
    'repo', 'create', name,
    visibility === 'private' ? '--private' : '--public',
    '--source=.',
    '--remote=origin',
    // Non-TTY Electron cannot answer gh's confirm prompt; --yes skips it.
    '--yes',
  ];
  if (hasCommits) createArgs.push('--push');
  // `gh repo create --remote=origin` writes the remote as part of its work.
  invalidateReadContext(root);
  const created = await run('gh', createArgs, root, { timeoutMs: COMMIT_TIMEOUT_MS });
  if (created.missing) return fail('gh is unavailable.');
  if (created.code !== 0) return fail(created.stderr.trim() || created.stdout.trim() || 'gh repo create failed.');
  const urlLine = created.stdout.trim().split(/\r?\n/).filter(Boolean).at(-1);
  return ok({
    status: hasCommits ? 'created' : 'remote_added',
    url: urlLine,
    remoteName: 'origin',
  });
}

async function openWorkspacePath(cwd, relativePath) {
  const target = resolveInsideWorkspace(cwd, relativePath);
  if (!target) return fail('Path is outside the workspace.');
  try {
    const { shell } = require('electron');
    const error = await shell.openPath(target);
    return error ? fail(error) : ok();
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'Unable to open file');
  }
}

/**
 * Parse `git status --porcelain=v1 -z`. Rename/copy origin fields are skipped.
 * @param {string} stdout
 * @returns {{ path: string, xy: string }[]}
 */
function parsePorcelainZ(stdout) {
  const entries = [];
  const parts = String(stdout || '').split('\0');
  let i = 0;
  while (i < parts.length) {
    const rec = parts[i];
    i += 1;
    if (!rec || rec.length < 3) continue;
    const xy = rec.slice(0, 2);
    let filePath = rec.slice(3);
    if (xy.includes('R') || xy.includes('C')) {
      const dest = parts[i] || filePath;
      i += 1;
      filePath = dest;
    }
    entries.push({ path: filePath, xy });
  }
  return entries;
}

function resolveGitPath(cwd, relativePath) {
  const root = asCwd(cwd);
  if (!root) return { root: null, rel: null };
  const target = resolveInsideWorkspace(cwd, relativePath);
  if (!target) return { root, rel: null };
  const rel = path.relative(root, target).replaceAll('\\', '/');
  // `!isPathInside(...)` rather than `rel.startsWith('..')`: a real child named
  // `..notes` produces exactly that prefix and must stay addressable. Failures
  // already collapse to a null rel above, so only containment is decided here.
  if (!rel || !isPathInside(root, target)) return { root, rel: null };
  return { root, rel };
}

async function gitPathOp(cwd, relativePath, args, failVerb) {
  const { root, rel } = resolveGitPath(cwd, relativePath);
  if (!root) return fail('Git status is unavailable.');
  if (!rel) return fail('Path is outside the workspace.');
  // `git add`/`reset`/`checkout`/`clean` can touch the index or working tree
  // before exiting non-zero; invalidate up front so failure is fail-closed.
  invalidateReadContext(root);
  const result = await runGit(root, [...args, '--', rel]);
  if (result.missing) return fail(GIT_UNAVAILABLE);
  if (result.timedOut) return fail('Git command timed out.');
  if (result.code !== 0) return fail(result.stderr.trim() || result.stdout.trim() || failVerb);
  return ok();
}

async function gitStage(cwd, relativePath) {
  return gitPathOp(cwd, relativePath, ['add'], 'git add failed.');
}

async function gitUnstage(cwd, relativePath) {
  return gitPathOp(cwd, relativePath, ['reset', '-q'], 'git reset failed.');
}

async function gitDiscard(cwd, relativePath) {
  const { root, rel } = resolveGitPath(cwd, relativePath);
  if (!root) return fail('Git status is unavailable.');
  if (!rel) return fail('Path is outside the workspace.');
  const listed = await gitStatusEntries(cwd);
  const xy = listed.ok
    ? (listed.entries || []).find((entry) => entry.path === rel || entry.path === `${rel}/`)?.xy
    : undefined;
  if (xy === '??') {
    let directory = false;
    try {
      directory = fs.statSync(path.join(root, rel)).isDirectory();
    } catch {
      return fail('Path is missing.');
    }
    return gitPathOp(cwd, relativePath, directory ? ['clean', '-fd'] : ['clean', '-f'], 'git clean failed.');
  }
  return gitPathOp(cwd, relativePath, ['checkout'], 'git checkout failed.');
}

async function gitStatusEntries(cwd) {
  const root = asCwd(cwd);
  if (!root) return fail('Git status is unavailable.');
  const listed = await runGit(root, ['status', '--porcelain=v1', '-z']);
  if (listed.missing) return fail(GIT_UNAVAILABLE);
  if (listed.timedOut) return fail('Git command timed out.');
  if (listed.code !== 0) return fail(listed.stderr.trim() || 'git status failed.');
  return ok({ entries: parsePorcelainZ(listed.stdout) });
}

async function gitBranchList(cwd) {
  const root = asCwd(cwd);
  if (!root) return fail('Git status is unavailable.');
  const listed = await runGit(root, [
    'for-each-ref',
    '--format=%(refname:short)%09%(HEAD)%09%(refname)',
    'refs/heads',
    'refs/remotes',
  ]);
  if (listed.missing) return fail(GIT_UNAVAILABLE);
  if (listed.timedOut) return fail('Git command timed out.');
  if (listed.code !== 0) return fail(listed.stderr.trim() || 'git branch list failed.');
  const branches = [];
  for (const line of listed.stdout.split('\n')) {
    const [short, headMark, full] = line.split('\t');
    if (!short || !full) continue;
    const isRemote = full.startsWith('refs/remotes/');
    if (isRemote && full.endsWith('/HEAD')) continue;
    branches.push({
      name: short,
      isRemote,
      isCurrent: headMark === '*',
      remoteName: isRemote ? short.split('/')[0] : undefined,
      // `gitSwitchBranch` passes this name through `safeRefName`, whose
      // injection whitelist is narrower than what git itself allows (Unicode,
      // `@`, `+`, ...). Flag rows the picker must disable instead of listing a
      // branch the switch IPC would then reject.
      ...(safeRefName(short) === null ? { switchable: false } : {}),
    });
  }
  const sym = await runGit(root, ['symbolic-ref', '-q', '--short', 'refs/remotes/origin/HEAD']);
  const defaultRef = sym.code === 0 ? sym.stdout.trim() : null;
  if (defaultRef) {
    const target = branches.find(item => item.name === defaultRef);
    if (target) target.isDefault = true;
  }
  return ok({ branches, defaultRef });
}

/**
 * Rejection for a ref name outside `safeRefName`'s injection whitelist. Names
 * git itself accepts (Unicode, `@`, `+`, ...) can hit this; the whitelist
 * stays narrow on purpose, and `gitBranchList` flags such rows `switchable:
 * false` so the picker disables them instead of surfacing this failure.
 */
const UNSUPPORTED_REF_NAME_MESSAGE =
  'Branch name contains characters the desktop cannot pass to git safely.';

/**
 * Check this workspace out onto `ref`.
 * `--ignore-other-worktrees` is required: Git otherwise refuses a branch
 * already checked out in another worktree (ChisaCode, Cursor, etc.), and the
 * titlebar picker means "switch this folder", not "move the other tree".
 * A remote-tracking row without a local branch (`origin/feature-x`) checks
 * out through `--track`, which creates the local tracking branch instead of
 * detaching HEAD at the remote ref.
 * @param {unknown} cwd
 * @param {unknown} ref
 */
async function gitSwitchBranch(cwd, ref) {
  const root = asCwd(cwd);
  const name = safeRefName(ref);
  if (!root) return fail('Git status is unavailable.');
  if (!name) return fail(UNSUPPORTED_REF_NAME_MESSAGE);
  const args = ['checkout', '--ignore-other-worktrees'];
  const localRef = await runGit(root, ['show-ref', '--verify', '--quiet', `refs/heads/${name}`]);
  if (localRef.code !== 0) {
    const remoteRef = await runGit(root, ['show-ref', '--verify', '--quiet', `refs/remotes/${name}`]);
    if (remoteRef.code === 0) args.push('--track');
  }
  // A checkout that fails after writing the index or a partly detached HEAD
  // must not leave the old memo serving pre-checkout answers.
  invalidateReadContext(root);
  const result = await runGit(root, [...args, name]);
  if (result.missing) return fail(GIT_UNAVAILABLE);
  if (result.timedOut) return fail('Git command timed out.');
  if (result.code !== 0) return fail(result.stderr.trim() || result.stdout.trim() || 'git checkout failed.');
  const head = await runGit(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
  return ok({ refName: head.code === 0 ? head.stdout.trim() : name });
}

async function gitCreateBranch(cwd, name) {
  const root = asCwd(cwd);
  const branch = safeRefName(name);
  if (!root) return fail('Git status is unavailable.');
  if (!branch) return fail(UNSUPPORTED_REF_NAME_MESSAGE);
  invalidateReadContext(root);
  const result = await runGit(root, ['checkout', '-b', branch]);
  if (result.missing) return fail(GIT_UNAVAILABLE);
  if (result.timedOut) return fail('Git command timed out.');
  if (result.code !== 0) return fail(result.stderr.trim() || result.stdout.trim() || 'git checkout -b failed.');
  return ok({ refName: branch });
}

/**
 * Working-tree files `git add -A` would stage that exceed GitHub's per-file
 * limit. Path metadata only: nothing is staged, and symlinks are skipped
 * rather than followed, so a link cannot report its target's size. Ignored
 * paths never reach this list — `git status` omits them unless asked.
 * @param {unknown} cwd
 * @returns {Promise<{ ok: boolean, message?: string, files?: Array<{ path: string, size: number }> }>}
 */
async function gitCheckLargeFiles(cwd) {
  const root = asCwd(cwd);
  if (!root) return fail('Git status is unavailable.');
  // `--porcelain` prints paths relative to the repository root even when the
  // cwd is a subdirectory. `--show-prefix` reports where the cwd sits inside
  // that root, so the root is derived lexically from the already-authorized
  // cwd rather than trusted from a second source. When that root is itself
  // authorized the whole repository is scanned, matching `git add -A` from a
  // subdirectory (it stages the whole tree); otherwise the scan stays inside
  // the authorized cwd and paths above it are skipped.
  const prefix = await runGit(root, ['rev-parse', '--show-prefix']);
  const cwdPrefix = prefix.code === 0
    ? prefix.stdout.trim().replaceAll('\\', '/').replace(/^\/+|\/+$/g, '')
    : '';
  const cwdDepth = cwdPrefix ? cwdPrefix.split('/').length : 0;
  // `asCwd` canonicalizes, so an unauthorized ancestor yields null and the
  // scan falls back to the cwd subtree (dropping the prefix from each path).
  const repoRoot = cwdDepth > 0 ? asCwd(path.resolve(root, ...Array(cwdDepth).fill('..'))) : root;
  const scanRoot = repoRoot ?? root;
  const useRepoPaths = repoRoot !== null;
  const listed = await runGit(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  if (listed.missing) return fail(GIT_UNAVAILABLE);
  if (listed.timedOut) return fail('Git command timed out.');
  if (listed.code !== 0) return fail(gitFailureMessage(listed, 'git status failed.'));
  // The path list was cut short, so "no large files" would be a lie.
  if (listed.truncated) return fail('Too many changed files to check for large files.');
  const files = [];
  for (const entry of parsePorcelainZ(listed.stdout)) {
    // A rename/copy record lists the destination first; that is the path
    // `git add -A` stages, while its origin is already gone from disk.
    const repoPath = entry.path;
    if (!repoPath || isNtfsReservedGitPath(repoPath)) continue;
    // Without an authorized repository root, only the cwd subtree is in scope.
    if (!useRepoPaths && !repoPath.startsWith(`${cwdPrefix}/`)) continue;
    const filePath = useRepoPaths ? repoPath : repoPath.slice(cwdPrefix.length + 1);
    if (!filePath) continue;
    const target = resolveInsideWorkspace(scanRoot, filePath);
    if (!target) continue;
    try {
      const stat = fs.lstatSync(target);
      if (stat.isFile() && stat.size > LARGE_FILE_WARNING_BYTES) {
        // Report the repository-relative path git itself uses, so the client
        // can match it against status.workingTree files.
        files.push({ path: repoPath, size: stat.size });
      }
    } catch {
      // Vanished between `git status` and here, or unreadable: nothing to warn about.
    }
  }
  files.sort((left, right) => left.path.localeCompare(right.path));
  return ok({ files });
}

module.exports = {
  gitStatus,
  gitFetchForStatus,
  gitReadPullRequest,
  gitInit,
  gitDiff,
  gitCommit,
  gitPush,
  gitPull,
  gitCreateChangeRequest,
  gitPublishRepository,
  openWorkspacePath,
  gitStage,
  gitUnstage,
  gitDiscard,
  gitStatusEntries,
  gitBranchList,
  gitSwitchBranch,
  gitCreateBranch,
  gitCheckLargeFiles,
  summarizeCommitMessage,
  sanitizeFeatureBranchName,
  uniqueFeatureBranchName,
  readPrTemplate,
  readRangeContext,
  parseGitHubRepositoryNameWithOwner,
  normalizeGitRemoteUrl,
  providerFromRemoteUrl,
  selectProviderContext,
  resolvePreferredHeadSelector,
  resolveBranchHeadContext,
  matchesBranchHeadContext,
  parseGhPullRequestRow,
  resolveBaseBranchForNoUpstream,
  resolvePrBaseBranch,
  setGhDefaultBranchResolver,
  setLookupOpenPullRequest,
  resetLastKnownPrCache,
  rememberLastKnownPr,
  resolveLastKnownPr,
  commitArgs,
  parseCustomCommitMessage,
  sanitizeProgressText,
  isGitAdviceLine,
  gitFailureMessage,
  inferHookName,
  parsePorcelainZ,
  isNtfsReservedGitPath,
  parseUnifiedDiff,
  run,
  gitChildEnv,
  resetGitExecutableProbe,
  resolveCurrentUpstream,
  resolvePushRemoteName,
  setWorkspaceAuthority,
  resetFetchCooldowns,
  GIT_TIMEOUT_MS,
  COMMIT_TIMEOUT_MS,
  FETCH_TIMEOUT_MS,
  GH_TIMEOUT_MS,
  GIT_MAX_OUTPUT_BYTES,
};
