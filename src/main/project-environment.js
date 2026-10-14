'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { getDesktopDshHome } = require('../shared/dsh-home');
const { loadWorkspaceAuthority, createWorkspaceAuthority, isPathInside, filterRegisteredWorkspaceRoots } = require('./workspace-authority');
const { run, runGit, safeRefName, gitFailureMessage, GH_TIMEOUT_MS } = require('./git-exec');

const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,100}$/;
const SHA = /^[a-f0-9]{40,64}$/i;
const identifier = (value, label) => {
  if (typeof value !== 'string' || !ID.test(value)) throw new Error(`无效的 ${label}`);
  return value;
};
const identity = value => process.platform === 'win32' ? value.toLowerCase() : value;
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
function redact(value) {
  return String(value || '').replace(/(https?:\/\/)[^\s/@]+(?::[^\s/@]*)?@/gi, '$1[redacted]@')
    .replace(/([?&](?:token|key|api_key|access_token|auth|password)=)[^\s&#]+/gi, '$1[redacted]')
    .replace(/((?:authorization|password|githubToken|api[_-]?key|_authToken|access_token)["']?\s*[:=]\s*["']?)(?:Bearer\s+)?[^\s,"'}]+/gi, '$1[redacted]')
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|sk-[A-Za-z0-9_-]+)\b/g, '[redacted]');
}
function readRecord(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
function writeRecord(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  try { fs.renameSync(temporary, file); }
  finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}

/** Directory capabilities only. Worker commands and processes belong to Harness Jobs. */
function createProjectEnvironment(options = {}) {
  const executeGit = options.runGit || runGit;
  const git = (cwd, args, limits) => executeGit(cwd, [...(process.platform === 'win32' ? ['-c', 'core.longpaths=true'] : []), ...args], limits);
  const pending = new Map();
  const home = () => fs.realpathSync.native(options.home || getDesktopDshHome());
  const authority = () => options.authority || loadWorkspaceAuthority();
  function canonicalize(workingDirectory) {
    const canonicalPath = authority().resolveAuthorizedCwd(workingDirectory);
    if (!canonicalPath) throw new Error('工作目录未获授权、已移动或不存在');
    return { ok: true, canonicalPath, identity: identity(canonicalPath) };
  }
  function ownedPath(...parts) {
    let current = home();
    for (const part of parts) {
      current = path.join(current, part);
      if (!isPathInside(home(), current)) throw new Error('Project 路径越界');
      let info;
      try { info = fs.lstatSync(current); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (info && (info.isSymbolicLink() || identity(fs.realpathSync.native(current)) !== identity(current))) {
        throw new Error('Project 存储路径被链接替换');
      }
    }
    return current;
  }
  const bindingFile = (projectId, workstreamId) => ownedPath('projects', identifier(projectId, 'projectId'),
    'internal', 'desktop-workspaces', `${identifier(workstreamId, 'workstreamId')}.json`);
  function bindingFor(projectId, workstreamId) {
    const file = bindingFile(projectId, workstreamId);
    const binding = readRecord(file);
    if (!binding || binding.projectId !== projectId || binding.workstreamId !== workstreamId) throw new Error('后台工作目录未登记');
    return { file, binding };
  }
  async function command(cwd, args, limits) {
    const result = await git(cwd, args, limits);
    if (result.code !== 0 || result.truncated) throw new Error(gitFailureMessage(result, `git ${args[0]} 失败`));
    return result.stdout.trim();
  }
  async function repositoryAt(canonicalPath) {
    const detected = await git(canonicalPath, ['rev-parse', '--show-toplevel']);
    if (detected.code !== 0) return { ok: true, canonicalPath, isGit: false, repoIdentity: null,
      repositoryRoot: null, branch: null, headCommit: null, dirty: null };
    const repositoryRoot = fs.realpathSync.native(detected.stdout.trim());
    const common = await command(canonicalPath, ['rev-parse', '--git-common-dir']);
    const commonPath = fs.realpathSync.native(path.resolve(canonicalPath, common));
    const head = await git(canonicalPath, ['rev-parse', '--verify', 'HEAD^{commit}']);
    const branch = await git(canonicalPath, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
    const status = await command(canonicalPath, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
    return { ok: true, canonicalPath, isGit: true, repositoryRoot, repoIdentity: digest(identity(commonPath)),
      branch: branch.code === 0 ? branch.stdout.trim() : null, headCommit: head.code === 0 ? head.stdout.trim() : null, dirty: Boolean(status) };
  }
  const repository = workingDirectory => repositoryAt(canonicalize(workingDirectory).canonicalPath);
  async function worktreeRegistration(root, cwd) {
    const listing = await command(root, ['worktree', 'list', '--porcelain', '-z']);
    for (const block of listing.split('\0\0').filter(Boolean)) {
      const row = Object.fromEntries(block.split('\0').filter(Boolean).map(item => {
        const split = item.indexOf(' '); return split < 0 ? [item, true] : [item.slice(0, split), item.slice(split + 1)];
      }));
      if (row.worktree && identity(path.resolve(row.worktree)) === identity(cwd)) return row;
    }
    return null;
  }
  async function checkWorkspace(projectId, workstreamId, expected) {
    const { binding } = bindingFor(projectId, workstreamId);
    if (binding.state !== 'ready') throw new Error('后台工作目录尚未准备完成或已清理');
    const cwd = fs.realpathSync.native(binding.canonicalPath);
    if (!fs.statSync(cwd).isDirectory() || identity(cwd) !== binding.directoryIdentity) throw new Error('后台工作目录身份已变化');
    if (expected && (expected.canonicalPath !== binding.canonicalPath || expected.receipt !== binding.receipt)) {
      throw new Error('后台工作目录与创建回执不一致');
    }
    if (binding.ownership === 'project') {
      if (identity(cwd) !== identity(ownedPath('project-worktrees', projectId, workstreamId))) throw new Error('独立工作目录不属于该 Project');
    } else if (binding.ownership === 'user') canonicalize(cwd);
    else throw new Error('后台工作目录所有权无效');
    const current = await repositoryAt(cwd);
    if (current.repoIdentity !== binding.repoIdentity || current.branch !== binding.branch) throw new Error('工作目录的仓库或分支已变化；请先核对续接条件');
    if (binding.ownership === 'project') {
      const registered = await worktreeRegistration(binding.repositoryRoot, cwd);
      if (!registered || registered.branch !== `refs/heads/${binding.branch}`) throw new Error('Git worktree 登记已变化');
    }
    return { ok: true, ...binding, headCommit: current.headCommit, dirty: current.dirty, valid: true };
  }
  async function prepareWorkspace(payload) {
    const projectId = identifier(payload.projectId, 'projectId'), workstreamId = identifier(payload.workstreamId, 'workstreamId');
    const mode = payload.mode || 'existing';
    if (!['existing', 'worktree'].includes(mode)) throw new Error('未知执行目录模式');
    const source = canonicalize(payload.workingDirectory);
    const file = bindingFile(projectId, workstreamId), old = readRecord(file);
    if (old) {
      if (old.mode !== mode || old.sourceIdentity !== source.identity || old.requestedBase !== (payload.baseCommit || null)) {
        throw new Error('同一工作流的执行目录不能在恢复时更换');
      }
      if (old.state === 'ready') return checkWorkspace(projectId, workstreamId);
      if (old.state !== 'preparing' || old.ownership !== 'project') throw new Error('该执行目录已经清理或需要核对');
    }
    const input = await repositoryAt(source.canonicalPath);
    if (old && old.repoIdentity !== input.repoIdentity) throw new Error('创建 worktree 的原仓库身份已变化');
    let canonicalPath = input.canonicalPath, ownership = 'user', branch = input.branch, baseCommit = input.headCommit;
    if (mode === 'worktree') {
      if (!input.isGit || !input.headCommit) throw new Error('独立 worktree 需要 Git 和有效提交；此目录仍可直接串行开发');
      const chosen = payload.baseCommit || input.headCommit;
      if (!SHA.test(chosen) && !safeRefName(chosen)) throw new Error('无效的 worktree 基线');
      baseCommit = await command(input.canonicalPath, ['rev-parse', '--verify', '--end-of-options', `${chosen}^{commit}`]);
      branch = `project/${projectId}/${workstreamId}`;
      await command(input.canonicalPath, ['check-ref-format', '--branch', branch]);
      canonicalPath = ownedPath('project-worktrees', projectId, workstreamId); ownership = 'project';
    }
    const binding = old || { projectId, workstreamId, mode, sourceIdentity: source.identity, canonicalPath, requestedBase: payload.baseCommit || null,
      directoryIdentity: identity(canonicalPath), ownership, branch, baseCommit, repoIdentity: input.repoIdentity,
      repositoryRoot: input.repositoryRoot, state: 'preparing', receipt: crypto.randomUUID() };
    if (!old) writeRecord(file, binding);
    if (ownership === 'project') {
      const registered = await worktreeRegistration(input.canonicalPath, canonicalPath);
      if (registered) {
        if (registered.branch !== `refs/heads/${binding.branch}` || !fs.existsSync(canonicalPath)) throw new Error('已有 worktree 与创建意图不一致');
      } else {
        if (fs.existsSync(canonicalPath)) throw new Error('独立目录存在未知内容，不能覆盖');
        fs.mkdirSync(path.dirname(canonicalPath), { recursive: true });
        await command(input.canonicalPath, ['worktree', 'add', '-b', binding.branch, canonicalPath, binding.baseCommit]);
      }
    }
    binding.canonicalPath = fs.realpathSync.native(binding.canonicalPath);
    binding.directoryIdentity = identity(binding.canonicalPath); binding.state = 'ready';
    writeRecord(file, binding);
    return { ok: true, ...binding };
  }
  async function snapshot(payload) {
    const current = payload.workstreamId
      ? await checkWorkspace(payload.projectId, payload.workstreamId, payload.workspace)
      : await repository(payload.workingDirectory);
    if (!current.repoIdentity) return { ok: true, isGit: false, headCommit: null, branch: null, dirty: null, files: [], diff: '', fingerprint: null };
    const status = await git(current.canonicalPath, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
    if (status.code !== 0 || status.truncated) throw new Error(gitFailureMessage(status, '读取目录变化失败'));
    const entries = status.stdout.split('\0').filter(Boolean), files = [];
    const scoped = createWorkspaceAuthority({ workspace: current.canonicalPath });
    for (let i = 0; i < entries.length; i++) {
      const relativePath = entries[i].slice(3), item = { path: relativePath, status: entries[i].slice(0, 2) };
      if (/[RC]/.test(item.status)) i++;
      const target = scoped.resolveInside(current.canonicalPath, relativePath);
      if (target && fs.existsSync(target) && fs.lstatSync(target).isFile()) {
        const hash = crypto.createHash('sha256');
        for await (const chunk of fs.createReadStream(target)) hash.update(chunk);
        item.sha256 = hash.digest('hex');
      }
      files.push(item);
    }
    const diff = current.headCommit ? await git(current.canonicalPath, ['diff', 'HEAD', '--'], { maxBytes: 1024 * 1024 }) : { code: 0, stdout: '', truncated: false };
    if (diff.code !== 0) throw new Error(gitFailureMessage(diff, '读取差异失败'));
    return { ok: true, isGit: true, headCommit: current.headCommit, branch: current.branch, dirty: files.length > 0,
      files, diff: diff.stdout, truncated: Boolean(diff.truncated), fingerprint: digest(JSON.stringify({ head: current.headCommit, files })) };
  }
  async function cleanupWorkspace(projectId, workstreamId, expected) {
    const current = await checkWorkspace(projectId, workstreamId, expected);
    if (current.ownership !== 'project') throw new Error('用户选择的工作目录不能由 Project 删除');
    if (current.dirty) throw new Error('独立工作目录有未提交内容，不能清理');
    const ignored = await command(current.canonicalPath, ['ls-files', '--others', '--ignored', '--exclude-standard', '-z']);
    if (ignored) throw new Error('独立工作目录有 Git 忽略的文件，不能清理');
    const target = ownedPath('project-worktrees', projectId, workstreamId);
    await command(current.repositoryRoot, ['worktree', 'remove', '--', target]);
    const { file, binding } = bindingFor(projectId, workstreamId);
    writeRecord(file, { ...binding, state: 'removed' });
    return { ok: true, removed: true, branchRetained: current.branch };
  }
  async function openPath(payload) {
    const projectId = identifier(payload.projectId, 'projectId');
    if (typeof payload.path !== 'string' || !path.isAbsolute(payload.path)) throw new Error('打开 Project 文件需要绝对路径');
    const requested = fs.realpathSync.native(payload.path), docs = ownedPath('projects', projectId, 'docs');
    let root;
    if (isPathInside(docs, requested)) root = docs;
    else if (payload.workstreamId) root = (await checkWorkspace(projectId, payload.workstreamId, payload.workspace)).canonicalPath;
    else if (payload.workingDirectory) root = canonicalize(payload.workingDirectory).canonicalPath;
    else throw new Error('路径不属于此 Project 的 docs 或绑定目录');
    const scoped = createWorkspaceAuthority({ workspace: root });
    const checked = scoped.resolveInside(root, path.relative(root, requested));
    if (!checked || !fs.existsSync(checked)) throw new Error('路径不属于允许打开的 Project 目录');
    const canonicalPath = fs.realpathSync.native(checked);
    if (!isPathInside(fs.realpathSync.native(root), canonicalPath)) throw new Error('Project 文件链接越界');
    if (payload.action === 'resolve-path') return { ok: true, canonicalPath, root: fs.realpathSync.native(root) };
    const open = options.openPath || (target => require('electron').shell.openPath(target));
    const error = await open(canonicalPath); if (error) throw new Error(String(error));
    return { ok: true, canonicalPath };
  }
  async function pullRequest(payload) {
    const cwd = payload.workstreamId ? (await checkWorkspace(payload.projectId, payload.workstreamId, payload.workspace)).canonicalPath : canonicalize(payload.workingDirectory).canonicalPath;
    if (typeof payload.repository !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+$/.test(payload.repository)
      || ['.', '..'].includes(payload.repository.split('/')[1]) || !Number.isSafeInteger(payload.number) || payload.number < 1) throw new Error('无效的 GitHub PR 身份');
    let executable = 'gh';
    const installed = path.join(process.env.ProgramFiles || '', 'GitHub CLI', 'gh.exe');
    if (process.platform === 'win32' && fs.existsSync(installed)) executable = installed;
    const token = options.getGithubToken?.();
    const response = await (options.run || run)(executable, ['pr', 'view', String(payload.number), '--repo', payload.repository,
      '--json', 'number,title,url,state,isDraft,headRefOid,reviewDecision,statusCheckRollup,mergedAt,closedAt,updatedAt'], cwd,
    { timeoutMs: GH_TIMEOUT_MS, ...(token ? { env: { GH_TOKEN: token } } : {}) });
    if (response.code !== 0 || response.truncated) throw new Error(redact(gitFailureMessage(response, 'PR 状态暂不可用')));
    const value = JSON.parse(response.stdout);
    if (value.number !== payload.number || !SHA.test(value.headRefOid)) throw new Error('GitHub 返回的 PR 身份无效');
    return { ok: true, repository: payload.repository, number: value.number, title: value.title, url: value.url,
      state: String(value.state).toLowerCase(), isDraft: Boolean(value.isDraft), headCommit: value.headRefOid,
      reviewDecision: value.reviewDecision || null, checks: value.statusCheckRollup || [],
      mergedAt: value.mergedAt, closedAt: value.closedAt, updatedAt: value.updatedAt };
  }
  async function dispatch(payload = {}) {
    switch (payload.action) {
      // Only the authenticated Project creation command uses this selection
      // boundary. Later file/Git operations still require a persisted root.
      case 'select-directory': {
        if (typeof payload.workingDirectory !== 'string' || !path.isAbsolute(payload.workingDirectory)) throw new Error('请选择本机绝对目录');
        const canonicalPath = fs.realpathSync.native(payload.workingDirectory);
        if (!fs.statSync(canonicalPath).isDirectory() || !filterRegisteredWorkspaceRoots([canonicalPath]).length) throw new Error('此目录不能作为项目工作目录');
        return { ok: true, canonicalPath, identity: identity(canonicalPath) };
      }
      case 'canonicalize': return canonicalize(payload.workingDirectory);
      case 'repository': return repository(payload.workingDirectory);
      case 'prepare-workspace': {
        const key = `${identifier(payload.projectId, 'projectId')}/${identifier(payload.workstreamId, 'workstreamId')}`;
        const signature = digest(JSON.stringify([payload.workingDirectory, payload.mode || 'existing', payload.baseCommit]));
        if (pending.has(key)) {
          const prior = pending.get(key); if (prior.signature !== signature) throw new Error('该工作流正在准备另一执行目录');
          return prior.operation;
        }
        const operation = prepareWorkspace(payload).finally(() => pending.delete(key));
        pending.set(key, { signature, operation }); return operation;
      }
      case 'check-workspace': return checkWorkspace(payload.projectId, payload.workstreamId, payload.workspace);
      case 'snapshot': return snapshot(payload);
      case 'cleanup-workspace': return cleanupWorkspace(payload.projectId, payload.workstreamId, payload.workspace);
      case 'open-path': return openPath(payload);
      case 'resolve-path': return openPath(payload);
      case 'pull-request': return pullRequest(payload);
      default: throw new Error(`不支持的 Project 操作：${String(payload.action || '')}`);
    }
  }
  return { dispatch, canonicalize, repository, prepareWorkspace, checkWorkspace, snapshot, cleanupWorkspace, openPath };
}

module.exports = { createProjectEnvironment, redact };
