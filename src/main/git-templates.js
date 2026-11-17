const { run, runGit, GH_TIMEOUT_MS } = require('./git-exec');
const { defaultRefName, resolveCurrentUpstream, parseGitHubRepositoryNameWithOwner, normalizeGitRemoteUrl } = require('./git-remotes');
const { parseRepositoryNameWithOwnerFromNormalized } = require('./git-pullrequest');

const PR_TEMPLATE_FILES = [
  '.github/pull_request_template.md',
  '.github/PULL_REQUEST_TEMPLATE.md',
  'pull_request_template.md',
  'PULL_REQUEST_TEMPLATE.md',
  'docs/pull_request_template.md',
  'docs/PULL_REQUEST_TEMPLATE.md',
];
const PR_TEMPLATE_DIRECTORIES = [
  '.github/PULL_REQUEST_TEMPLATE',
  'PULL_REQUEST_TEMPLATE',
  'docs/PULL_REQUEST_TEMPLATE',
];
const PR_TEMPLATE_TREE_PATHS = [...PR_TEMPLATE_FILES, ...PR_TEMPLATE_DIRECTORIES];
const PR_TEMPLATE_MAX_BYTES = 8_000;
const PR_TEMPLATE_TREE_LIST_MAX_BYTES = 100_000;

/**
 * @param {unknown} output
 * @returns {{ objectId: string, path: string }[]}
 */
function parseTemplateTreeEntries(output) {
  const entries = [];
  for (const record of String(output || '').split('\0')) {
    if (!record) continue;
    const tab = record.indexOf('\t');
    if (tab < 0) continue;
    const [mode, type, objectId] = record.slice(0, tab).split(' ');
    if (type !== 'blob' || (mode !== '100644' && mode !== '100755') || !objectId) continue;
    if (!/^[0-9a-f]{40,64}$/i.test(objectId)) continue;
    entries.push({ objectId, path: record.slice(tab + 1) });
  }
  return entries;
}

/**
 * @param {string} cwd
 * @param {string} objectId
 * @returns {Promise<string>}
 */
async function readTemplateBlob(cwd, objectId) {
  const blob = await runGit(cwd, ['cat-file', 'blob', objectId], { maxBytes: PR_TEMPLATE_MAX_BYTES });
  if (blob.code !== 0) return '';
  const text = blob.stdout.trim();
  if (!text) return '';
  if (blob.truncated && !text.endsWith('[truncated]')) {
    return `${text.slice(0, PR_TEMPLATE_MAX_BYTES)}\n\n[truncated]`;
  }
  return text.slice(0, PR_TEMPLATE_MAX_BYTES);
}

/**
 * Read the PR template blob from the committed base tree,
 * never the working tree, so uncommitted or symlink paths cannot reach the host FS.
 * @param {string} cwd
 * @param {string} [treeish]
 * @returns {Promise<string>}
 */
async function readPrTemplate(cwd, treeish) {
  const spec = typeof treeish === 'string' && treeish.trim() ? treeish.trim() : 'HEAD';
  const listed = await runGit(
    cwd,
    ['ls-tree', '-r', '-z', '--full-tree', spec, '--', ...PR_TEMPLATE_TREE_PATHS],
    { maxBytes: PR_TEMPLATE_TREE_LIST_MAX_BYTES },
  );
  if (listed.code !== 0 || listed.truncated) return '';
  const entries = parseTemplateTreeEntries(listed.stdout);
  const byPath = new Map(entries.map((entry) => [entry.path, entry]));
  for (const rel of PR_TEMPLATE_FILES) {
    const entry = byPath.get(rel);
    if (!entry) continue;
    const blob = await readTemplateBlob(cwd, entry.objectId);
    if (blob) return blob;
  }
  for (const dirRel of PR_TEMPLATE_DIRECTORIES) {
    const prefix = `${dirRel}/`;
    const candidates = entries.filter((entry) => (
      entry.path.startsWith(prefix)
      && !entry.path.slice(prefix.length).includes('/')
      && entry.path.toLowerCase().endsWith('.md')
    ));
    if (candidates.length > 1) return '';
    if (candidates[0]) {
      const blob = await readTemplateBlob(cwd, candidates[0].objectId);
      if (blob) return blob;
    }
  }
  return '';
}

/**
 * @param {string} cwd
 * @param {string} refName
 * @param {boolean} hasPrimaryRemote
 * @param {{ url: string, defaultBranch: string } | null | undefined} targetRepository
 * @returns {Promise<string>}
 */
async function resolvePrBaseBranch(cwd, refName, hasPrimaryRemote, targetRepository) {
  const configured = await runGit(cwd, ['config', '--get', `branch.${refName}.gh-merge-base`]);
  if (configured.code === 0) {
    const value = configured.stdout.trim();
    if (value) {
      return value.startsWith('origin/') ? value.slice('origin/'.length) : value;
    }
  }
  // When upstream tracks a different branch name (same repo), use that as base.
  const upstream = await resolveCurrentUpstream(cwd);
  if (upstream?.branchName && upstream.branchName !== refName) {
    const headRemote = await runGit(cwd, ['remote', 'get-url', upstream.remoteName]);
    const originRemote = await runGit(cwd, ['remote', 'get-url', 'origin']);
    const headUrl = headRemote.code === 0 ? headRemote.stdout : '';
    const originUrl = originRemote.code === 0 ? originRemote.stdout : '';
    const headRepo = parseGitHubRepositoryNameWithOwner(headUrl)
      || parseRepositoryNameWithOwnerFromNormalized(headUrl);
    const originRepo = parseGitHubRepositoryNameWithOwner(originUrl)
      || parseRepositoryNameWithOwnerFromNormalized(originUrl);
    const isCrossRepository = targetRepository
      ? normalizeGitRemoteUrl(headUrl) !== normalizeGitRemoteUrl(targetRepository.url)
      : headRepo && originRepo
      ? headRepo.toLowerCase() !== originRepo.toLowerCase()
      : Boolean(upstream.remoteName && upstream.remoteName !== 'origin' && headRepo);
    if (!isCrossRepository) return upstream.branchName;
  }
  if (targetRepository) return targetRepository.defaultBranch;
  // Prefer the GitHub default branch before hardcoding main.
  // Prefer gh over origin/HEAD / local main|master so rename or missing remote HEAD
  // cannot pin Create PR --base to a stale git heuristic.
  const fromGh = await resolveGhDefaultBranch(cwd);
  if (fromGh) return fromGh;
  const fromGit = await defaultRefName(cwd, hasPrimaryRemote);
  return fromGit || 'main';
}

/** @type {null | ((cwd: string) => Promise<string | null>)} */
let ghDefaultBranchResolver = null;

/**
 * Test seam: replace `gh repo view` default-branch resolution.
 * @param {((cwd: string) => Promise<string | null>) | null | undefined} resolver
 */
function setGhDefaultBranchResolver(resolver) {
  ghDefaultBranchResolver = typeof resolver === 'function' ? resolver : null;
}

/**
 * GitHub CLI default branch for the current repository.
 * @param {string} cwd
 * @returns {Promise<string | null>}
 */
async function resolveGhDefaultBranch(cwd) {
  if (ghDefaultBranchResolver) return ghDefaultBranchResolver(cwd);
  const viewed = await run('gh', ['repo', 'view', '--json', 'defaultBranchRef'], cwd, {
    timeoutMs: GH_TIMEOUT_MS,
  });
  if (viewed.missing || viewed.code !== 0) return null;
  try {
    const parsed = JSON.parse(viewed.stdout);
    const name = parsed?.defaultBranchRef?.name;
    return typeof name === 'string' && name.trim() ? name.trim() : null;
  } catch {
    return null;
  }
}

module.exports = {
  readPrTemplate,
  resolvePrBaseBranch,
  setGhDefaultBranchResolver,
};
