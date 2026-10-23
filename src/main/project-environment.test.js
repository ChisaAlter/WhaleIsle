'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createProjectEnvironment } = require('./project-environment');
const { createWorkspaceAuthority, readProjectExecutionPaths, readProjectRegisteredPaths } = require('./workspace-authority');
const { runGit } = require('./git-exec');

async function fixture(t, isGit = true) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-project-environment-'));
  const source = path.join(directory, 'source'), home = path.join(directory, 'home');
  fs.mkdirSync(source); fs.mkdirSync(home);
  t.after(() => {
    assert.ok(path.resolve(directory).startsWith(path.join(os.tmpdir(), 'whale-project-environment-')));
    fs.rmSync(directory, { force: true, recursive: true });
  });
  const git = async (cwd, args) => {
    const result = await runGit(cwd, args); assert.equal(result.code, 0, result.stderr); return result.stdout.trim();
  };
  fs.writeFileSync(path.join(source, 'file.txt'), 'baseline\n');
  if (isGit) {
    await git(source, ['init', '-b', 'main']); await git(source, ['config', 'user.name', 'Project Fixture']);
    await git(source, ['config', 'user.email', 'project-fixture@example.invalid']);
    await git(source, ['config', 'core.autocrlf', 'false']);
    await git(source, ['add', 'file.txt']); await git(source, ['commit', '-m', 'baseline']);
  }
  const authority = createWorkspaceAuthority({ workspace: source });
  return { directory, source, home, git, authority, environment: createProjectEnvironment({ home, authority }) };
}

test('a selected Project directory gains authority from its own persisted registration, without a Workspace row', async t => {
  const { directory, home } = await fixture(t, false);
  const selected = path.join(directory, 'new-project'); fs.mkdirSync(selected);
  const authority = createWorkspaceAuthority({ workspace: '', listRegisteredWorkspaces: () => readProjectRegisteredPaths(home) });
  const environment = createProjectEnvironment({ home, authority });
  const choice = await environment.dispatch({ action: 'select-directory', workingDirectory: selected });
  assert.equal(authority.resolveAuthorizedCwd(selected), null, 'selection alone grants no ongoing file access');
  fs.mkdirSync(path.join(home, 'storages'));
  const row = { lifecycle: 'ready', canonicalWorkingDirectory: choice.canonicalPath, directoryIdentity: choice.identity };
  const save = () => fs.writeFileSync(path.join(home, 'storages', 'whale_project_local.json'), JSON.stringify({ unit: { name: 'whale_project_local', version: 1 }, tables: { state: { catalog: { projects: [row] } } } }));
  save();
  assert.equal(environment.canonicalize(selected).canonicalPath, choice.canonicalPath);
  assert.equal(fs.existsSync(path.join(home, 'storages', 'workspace.json')), false);
  row.directoryIdentity = 'changed'; save();
  assert.throws(() => environment.canonicalize(selected), /未获授权/);
  await assert.rejects(environment.dispatch({ action: 'select-directory', workingDirectory: path.parse(selected).root }), /不能作为/);
});

test('a folder that cannot host a Project is refused with its reason, before and at creation', async t => {
  const { directory, home } = await fixture(t, false);
  const { setDesktopDshHome, clearDesktopDshHome } = require('../shared/dsh-home');
  const userData = path.join(directory, 'user-data'), config = path.join(directory, 'xdg-config'), ordinary = path.join(directory, 'repo'), file = path.join(directory, 'note.txt');
  for (const dir of [path.join(userData, 'dsh-home'), config, ordinary]) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, 'x');
  const previousConfig = process.env.XDG_CONFIG_HOME;
  setDesktopDshHome(path.join(userData, 'dsh-home')); process.env.XDG_CONFIG_HOME = config;
  t.after(() => { clearDesktopDshHome(); if (previousConfig === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = previousConfig; });
  const environment = createProjectEnvironment({ home, authority: createWorkspaceAuthority({ workspace: '' }) });
  const check = workingDirectory => environment.dispatch({ action: 'check-directory', workingDirectory });
  assert.deepEqual(await check(ordinary), { ok: true, allowed: true });
  for (const [target, reason, message] of [
    [path.parse(ordinary).root, 'root', /磁盘根目录/],
    [os.homedir(), 'home', /用户主目录/],
    [config, 'system-data', /系统配置目录/],
    [userData, 'app-data', /鲸屿自己的数据目录/],
    [path.join(userData, 'dsh-home'), 'app-data', /鲸屿自己的数据目录/],
    [file, 'not-directory', /不是文件夹/],
    [path.join(directory, 'absent'), 'missing', /找不到/],
  ]) {
    assert.deepEqual(await check(target), { ok: true, allowed: false, reason }, target);
    await assert.rejects(environment.dispatch({ action: 'select-directory', workingDirectory: target }), error => message.test(error.message) && error.code === `project/directory-${reason}`);
  }
  assert.deepEqual(await check('relative/path'), { ok: true, allowed: false, reason: 'missing' });
});

test('explicit real Git worktrees preserve dirty user data and retain committed branches after cleanup', async t => {
  const { source, home, git, environment } = await fixture(t);
  fs.writeFileSync(path.join(source, 'file.txt'), 'user draft\n');
  fs.writeFileSync(path.join(source, 'user-untracked.txt'), 'user material');
  const payload = { projectId: 'project-one', workstreamId: 'stream-one', workingDirectory: source, mode: 'worktree', baseCommit: 'main' };
  const [workspace, repeated] = await Promise.all([environment.dispatch({ action: 'prepare-workspace', ...payload }), environment.dispatch({ action: 'prepare-workspace', ...payload })]);
  assert.equal(workspace.receipt, repeated.receipt);
  assert.equal((await environment.prepareWorkspace(payload)).receipt, workspace.receipt);
  assert.equal(workspace.ownership, 'project');
  assert.equal(fs.readFileSync(path.join(source, 'file.txt'), 'utf8'), 'user draft\n');
  assert.equal(fs.readFileSync(path.join(workspace.canonicalPath, 'file.txt'), 'utf8'), 'baseline\n');
  assert.equal(await git(source, ['branch', '--show-current']), 'main');
  assert.deepEqual(readProjectExecutionPaths(home), [workspace.canonicalPath]);
  assert.equal(fs.existsSync(path.join(home, 'storages', 'workspace.json')), false);
  fs.writeFileSync(path.join(workspace.canonicalPath, 'file.txt'), 'worker result\n');
  const snapshot = await environment.snapshot({ projectId: payload.projectId, workstreamId: payload.workstreamId, workspace });
  assert.equal(snapshot.dirty, true); assert.equal(snapshot.files[0].path, 'file.txt');
  assert.match(snapshot.files[0].sha256, /^[a-f0-9]{64}$/); assert.match(snapshot.diff, /worker result/);
  await assert.rejects(environment.cleanupWorkspace(payload.projectId, payload.workstreamId, workspace), /未提交/);
  await git(workspace.canonicalPath, ['add', 'file.txt']); await git(workspace.canonicalPath, ['commit', '-m', 'worker result']);
  const resultCommit = await git(workspace.canonicalPath, ['rev-parse', 'HEAD']);
  const cleaned = await environment.cleanupWorkspace(payload.projectId, payload.workstreamId, workspace);
  assert.equal(cleaned.branchRetained, workspace.branch); assert.equal(fs.existsSync(workspace.canonicalPath), false);
  assert.deepEqual(readProjectExecutionPaths(home), []);
  assert.equal(await git(source, ['rev-parse', workspace.branch]), resultCommit);
  assert.equal(fs.readFileSync(path.join(source, 'user-untracked.txt'), 'utf8'), 'user material');
  await assert.rejects(environment.prepareWorkspace(payload), /清理/);
});

test('real Git Project worktrees check out tracked long paths without changing repository configuration', async t => {
  const { source, git, environment } = await fixture(t);
  const relativeFile = path.join('nested-source-'.repeat(4), 'nested-module-'.repeat(4), 'tracked-result.txt');
  const original = path.join(source, relativeFile), bytes = Buffer.from('Real tracked long-path content\n第二行\n', 'utf8');
  fs.mkdirSync(path.dirname(original), { recursive: true }); fs.writeFileSync(original, bytes);
  await git(source, ['-c', 'core.longpaths=true', 'add', '--', relativeFile]);
  await git(source, ['commit', '-m', 'tracked long relative path']);
  const configFile = path.join(source, '.git', 'config'), config = fs.readFileSync(configFile);
  const payload = { projectId: `project-${'p'.repeat(36)}`, workstreamId: `work-${'w'.repeat(36)}`, workingDirectory: source, mode: 'worktree' };
  const workspace = await environment.prepareWorkspace(payload), checkedOut = path.join(workspace.canonicalPath, relativeFile);
  assert.ok(checkedOut.length > 260, 'the actual checkout exceeds the legacy Windows full-path limit');
  assert.ok(checkedOut.split(/[\\/]/).every(part => part.length < 255), 'no path segment exceeds the filesystem component limit');
  assert.deepEqual(fs.readFileSync(checkedOut), bytes);
  assert.equal(workspace.ownership, 'project');
  assert.equal(await git(workspace.canonicalPath, ['rev-parse', 'HEAD']), workspace.baseCommit);
  const clean = await environment.snapshot({ projectId: payload.projectId, workstreamId: payload.workstreamId, workspace });
  assert.equal(clean.dirty, false); assert.deepEqual(clean.files, []); assert.equal(clean.diff, '', 'tracked long paths are not falsely reported as deletions');
  fs.writeFileSync(checkedOut, Buffer.concat([bytes, Buffer.from('Actual change\n')]));
  const changed = await environment.snapshot({ projectId: payload.projectId, workstreamId: payload.workstreamId, workspace });
  assert.equal(changed.dirty, true); assert.equal(changed.files.length, 1); assert.equal(changed.files[0].path, relativeFile.replaceAll('\\', '/'));
  assert.match(changed.diff, /Actual change/); assert.equal(changed.files[0].sha256, require('node:crypto').createHash('sha256').update(fs.readFileSync(checkedOut)).digest('hex'));
  assert.deepEqual(fs.readFileSync(configFile), config, 'checkout and subsequent inspections do not persist core.longpaths in shared config');
  assert.deepEqual(fs.readFileSync(original), bytes);
});

test('cleanup preserves ignored files even when Git reports no ordinary changes', async t => {
  const { source, git, environment } = await fixture(t);
  fs.writeFileSync(path.join(source, '.gitignore'), '*.secret\n');
  await git(source, ['add', '.gitignore']); await git(source, ['commit', '-m', 'ignore local material']);
  const workspace = await environment.prepareWorkspace({ projectId: 'ignored-project', workstreamId: 'ignored-work', workingDirectory: source, mode: 'worktree' });
  const material = path.join(workspace.canonicalPath, 'user.secret'); fs.writeFileSync(material, 'preserve me');
  assert.equal((await environment.checkWorkspace('ignored-project', 'ignored-work', workspace)).dirty, false);
  await assert.rejects(environment.cleanupWorkspace('ignored-project', 'ignored-work', workspace), /忽略/);
  assert.equal(fs.readFileSync(material, 'utf8'), 'preserve me');
});

test('pre-existing temporary receipt hardlinks do not overwrite user material', async t => {
  const { source, home, environment } = await fixture(t, false);
  const folder = path.join(home, 'projects', 'linked-project', 'internal', 'desktop-workspaces'); fs.mkdirSync(folder, { recursive: true });
  const material = path.join(source, 'material.txt'); fs.writeFileSync(material, 'preserve me');
  fs.linkSync(material, path.join(folder, 'linked-work.json.tmp'));
  await environment.prepareWorkspace({ projectId: 'linked-project', workstreamId: 'linked-work', workingDirectory: source });
  assert.equal(fs.readFileSync(material, 'utf8'), 'preserve me');
});

test('default existing mode binds non-Git directories without Git initialization or shell execution', async t => {
  const { source, home, environment } = await fixture(t, false);
  const payload = { projectId: 'nongit-project', workstreamId: 'nongit-stream', workingDirectory: source, setup: { command: 'exit 99' } };
  const workspace = await environment.prepareWorkspace(payload);
  assert.equal(workspace.mode, 'existing'); assert.equal(workspace.ownership, 'user');
  assert.equal(workspace.canonicalPath, fs.realpathSync.native(source)); assert.equal(workspace.branch, null);
  assert.equal(fs.existsSync(path.join(source, '.git')), false);
  const snapshot = await environment.snapshot({ projectId: payload.projectId, workstreamId: payload.workstreamId, workspace });
  assert.equal(snapshot.isGit, false); assert.equal(snapshot.dirty, null); assert.equal(snapshot.fingerprint, null);
  await assert.rejects(environment.cleanupWorkspace(payload.projectId, payload.workstreamId), /用户选择/);
  await assert.rejects(environment.prepareWorkspace({ ...payload, workstreamId: 'parallel', mode: 'worktree' }), /有效提交/);
  for (const action of ['run-script', 'services', 'stop-services']) await assert.rejects(environment.dispatch({ action, ...payload }), /不支持/);
  assert.equal(fs.readFileSync(path.join(source, 'file.txt'), 'utf8'), 'baseline\n');
  assert.equal(fs.existsSync(path.join(home, 'project-worktrees')), false);
});

test('directory aliases share identity, while linked Project roots cannot create or delete outside content', async t => {
  const { source, home, directory, environment } = await fixture(t);
  const alias = path.join(directory, 'source-alias'); fs.symlinkSync(source, alias, process.platform === 'win32' ? 'junction' : 'dir');
  assert.deepEqual(environment.canonicalize(alias), environment.canonicalize(source));
  await assert.rejects(environment.prepareWorkspace({ projectId: '../outside', workstreamId: 'stream', workingDirectory: source, mode: 'worktree' }), /projectId/);
  const outside = path.join(directory, 'outside'); fs.mkdirSync(outside); fs.writeFileSync(path.join(outside, 'sentinel'), 'preserve');
  fs.symlinkSync(outside, path.join(home, 'project-worktrees'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(environment.prepareWorkspace({ projectId: 'project-three', workstreamId: 'stream', workingDirectory: source, mode: 'worktree' }), /链接替换/);
  assert.deepEqual(fs.readdirSync(outside), ['sentinel']); fs.unlinkSync(path.join(home, 'project-worktrees'));
  fs.symlinkSync(outside, path.join(home, 'projects'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(environment.prepareWorkspace({ projectId: 'project-three', workstreamId: 'stream', workingDirectory: source }), /链接替换/);
  assert.deepEqual(fs.readdirSync(outside), ['sentinel']); assert.deepEqual(readProjectExecutionPaths(home), []);
});

test('recovered bindings reject changed branch or receipt and keep user directories intact', async t => {
  const { source, home, git, authority, environment } = await fixture(t);
  const payload = { projectId: 'existing-project', workstreamId: 'stream', workingDirectory: source };
  const workspace = await environment.prepareWorkspace(payload);
  const recovered = createProjectEnvironment({ home, authority });
  assert.equal((await recovered.checkWorkspace(payload.projectId, payload.workstreamId, workspace)).receipt, workspace.receipt);
  await assert.rejects(recovered.checkWorkspace(payload.projectId, payload.workstreamId, { ...workspace, receipt: 'wrong' }), /回执不一致/);
  await git(source, ['checkout', '-b', 'user-changed']);
  await assert.rejects(recovered.checkWorkspace(payload.projectId, payload.workstreamId), /分支已变化/);
  await assert.rejects(recovered.prepareWorkspace(payload), /分支已变化/);
  assert.equal(await git(source, ['branch', '--show-current']), 'user-changed');
  assert.equal(fs.readFileSync(path.join(source, 'file.txt'), 'utf8'), 'baseline\n');
});

test('open-path authorizes only docs or a bound working directory and rejects internal files and junction escapes', async t => {
  const { source, home, directory, authority } = await fixture(t);
  const opened = [], environment = createProjectEnvironment({ home, authority, openPath: async file => { opened.push(file); return ''; } });
  const projectId = 'open-project', workstreamId = 'open-stream';
  const workspace = await environment.prepareWorkspace({ projectId, workstreamId, workingDirectory: source });
  await environment.openPath({ projectId, workstreamId, workspace, path: workspace.canonicalPath });
  assert.deepEqual(opened, [workspace.canonicalPath]);
  const docs = path.join(home, 'projects', projectId, 'docs'); fs.mkdirSync(docs);
  const report = path.join(docs, 'result.txt'); fs.writeFileSync(report, 'result');
  await environment.openPath({ projectId, path: report }); assert.equal(opened[1], fs.realpathSync.native(report));
  await assert.rejects(environment.openPath({ projectId, path: path.join(source, 'file.txt') }), /不属于/);
  await assert.rejects(environment.openPath({ projectId, workstreamId, path: home }), /不属于/);
  const internal = path.join(home, 'projects', projectId, 'internal', 'private.txt'); fs.writeFileSync(internal, 'private');
  await assert.rejects(environment.openPath({ projectId, path: internal }), /不属于/);
  const outside = path.join(directory, 'outside-open'); fs.mkdirSync(outside); fs.writeFileSync(path.join(outside, 'private.txt'), 'private');
  fs.symlinkSync(outside, path.join(docs, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(environment.openPath({ projectId, path: path.join(docs, 'escape', 'private.txt') }), /不属于/);
  assert.equal(opened.length, 2);
});

test('optional exact PR observations preserve closed state and checks on the actual head', async t => {
  const { source, home, authority } = await fixture(t);
  const sha = 'b'.repeat(40); let requested;
  const environment = createProjectEnvironment({ home, authority, run: async (_command, args) => {
    requested = args; return { code: 0, stdout: JSON.stringify({ number: 7, url: 'https://github.com/example/project/pull/7', state: 'CLOSED', isDraft: false, headRefOid: sha, reviewDecision: 'CHANGES_REQUESTED', statusCheckRollup: [{ name: 'CI', status: 'COMPLETED', conclusion: 'CANCELLED' }] }) };
  } });
  const result = await environment.dispatch({ action: 'pull-request', workingDirectory: source, repository: 'example/project', number: 7 });
  assert.equal(result.state, 'closed'); assert.equal(result.headCommit, sha); assert.equal(result.checks[0].conclusion, 'CANCELLED');
  assert.deepEqual(requested.slice(0, 5), ['pr', 'view', '7', '--repo', 'example/project']);
  await assert.rejects(environment.dispatch({ action: 'pull-request', workingDirectory: source, repository: '../elsewhere', number: 7 }), /PR 身份/);
});

test('requirement changes use a private index, exclude earlier edits, revert cleanly and refuse conflicting reverts', async t => {
  const { source, git, environment } = await fixture(t);
  fs.writeFileSync(path.join(source, 'earlier.txt'), 'user work before the requirement\n');
  await git(source, ['add', 'earlier.txt']);
  const statusBefore = await git(source, ['status', '--porcelain']), stagedBefore = await git(source, ['diff', '--cached', '--name-only']);
  const start = await environment.dispatch({ action: 'baseline', workingDirectory: source });
  assert.equal(start.isGit, true); assert.match(start.tree, /^[a-f0-9]{40,64}$/);
  assert.equal(await git(source, ['status', '--porcelain']), statusBefore, 'capturing a baseline leaves the user index and files untouched');
  assert.equal(await git(source, ['diff', '--cached', '--name-only']), stagedBefore);

  fs.writeFileSync(path.join(source, 'file.txt'), 'changed by the requirement\n');
  fs.writeFileSync(path.join(source, 'added.txt'), 'new file\n');
  const delivered = await environment.dispatch({ action: 'changes', workingDirectory: source, base: start.tree, diff: true });
  assert.deepEqual(delivered.files.map(file => [file.path, file.status, file.added, file.removed]), [['added.txt', 'A', 1, 0], ['file.txt', 'M', 1, 1]]);
  assert.match(delivered.diff, /\+changed by the requirement/); assert.doesNotMatch(delivered.diff, /earlier\.txt/);
  const again = await environment.dispatch({ action: 'changes', workingDirectory: source, base: start.tree, end: delivered.end });
  assert.equal(again.end, delivered.end);

  const checked = await environment.dispatch({ action: 'revert', workingDirectory: source, base: start.tree, end: delivered.end, checkOnly: true });
  assert.deepEqual(checked, { ok: true, applied: false });
  assert.equal(fs.readFileSync(path.join(source, 'file.txt'), 'utf8'), 'changed by the requirement\n', 'preflight does not apply the patch');
  assert.equal(fs.readFileSync(path.join(source, 'added.txt'), 'utf8'), 'new file\n');
  assert.equal(await git(source, ['diff', '--cached', '--name-only']), stagedBefore);

  const reverted = await environment.dispatch({ action: 'revert', workingDirectory: source, base: start.tree, end: delivered.end });
  assert.equal(reverted.applied, true);
  assert.equal(fs.readFileSync(path.join(source, 'file.txt'), 'utf8'), 'baseline\n');
  assert.equal(fs.existsSync(path.join(source, 'added.txt')), false);
  assert.equal(fs.readFileSync(path.join(source, 'earlier.txt'), 'utf8'), 'user work before the requirement\n', 'earlier user work survives the revert');

  const second = await environment.dispatch({ action: 'baseline', workingDirectory: source });
  fs.writeFileSync(path.join(source, 'file.txt'), 'requirement edit\n');
  const end = (await environment.dispatch({ action: 'changes', workingDirectory: source, base: second.tree })).end;
  fs.writeFileSync(path.join(source, 'file.txt'), 'user edit after delivery\n');
  const conflict = await environment.dispatch({ action: 'revert', workingDirectory: source, base: second.tree, end });
  assert.equal(conflict.applied, false); assert.equal(conflict.conflict, true); assert.ok(conflict.message);
  const preflightConflict = await environment.dispatch({ action: 'revert', workingDirectory: source, base: second.tree, end, checkOnly: true });
  assert.equal(preflightConflict.applied, false); assert.equal(preflightConflict.conflict, true);
  assert.equal(fs.readFileSync(path.join(source, 'file.txt'), 'utf8'), 'user edit after delivery\n', 'a conflicting revert changes nothing');
  await assert.rejects(environment.dispatch({ action: 'revert', workingDirectory: source, base: 'not-a-tree', end }), /无效的改动记录/);
});

test('requirement baselines report non-Git directories without failing', async t => {
  const { source, environment } = await fixture(t, false);
  assert.deepEqual(await environment.dispatch({ action: 'baseline', workingDirectory: source }), { ok: true, isGit: false });
});

test('requirement capture refuses junction escapes before writing Git objects or changing the user index', async t => {
  const { source, directory, home, authority, git } = await fixture(t);
  const environment = createProjectEnvironment({ home, authority, runGit: (cwd, args, limits) => {
    assert.ok(!args.includes('status'), 'requirement tracking must authorize paths before any status scan');
    return runGit(cwd, args, limits);
  } });
  const scope = path.join(source, 'project[1]'), outside = path.join(directory, 'outside-snapshot');
  fs.mkdirSync(scope); fs.mkdirSync(outside);
  fs.writeFileSync(path.join(scope, 'local.txt'), 'authorized project content\n');
  fs.writeFileSync(path.join(outside, 'external.txt'), 'outside the selected project\n');
  fs.writeFileSync(path.join(outside, '.gitignore'), '*\n');
  const start = await environment.baseline({ workingDirectory: scope });
  fs.symlinkSync(outside, path.join(scope, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  const objects = await git(source, ['cat-file', '--batch-all-objects', '--batch-check=%(objectname) %(objecttype)']);
  const index = fs.readFileSync(path.join(source, '.git', 'index'));
  const refs = await git(source, ['for-each-ref', '--format=%(refname) %(objectname)']);

  await assert.rejects(environment.baseline({ workingDirectory: scope }), /需求快照路径超出授权工作目录.*linked/);
  await assert.rejects(environment.changes({ workingDirectory: scope, base: start.tree }), /需求快照路径超出授权工作目录.*linked/);
  assert.equal(await git(source, ['cat-file', '--batch-all-objects', '--batch-check=%(objectname) %(objecttype)']), objects,
    'rejected captures do not even add an unreferenced external blob');
  assert.deepEqual(fs.readFileSync(path.join(source, '.git', 'index')), index);
  assert.equal(await git(source, ['for-each-ref', '--format=%(refname) %(objectname)']), refs);
  assert.equal(fs.readFileSync(path.join(outside, 'external.txt'), 'utf8'), 'outside the selected project\n');
  assert.equal(fs.readFileSync(path.join(scope, 'local.txt'), 'utf8'), 'authorized project content\n');
});

test('requirement capture also validates tracked files after their parent is replaced by a junction', async t => {
  const { source, directory, git, environment } = await fixture(t);
  const tracked = path.join(source, 'tracked'), outside = path.join(directory, 'outside-tracked');
  fs.mkdirSync(tracked); fs.mkdirSync(outside);
  fs.writeFileSync(path.join(tracked, 'file.txt'), 'tracked local content\n');
  fs.writeFileSync(path.join(outside, 'file.txt'), 'external replacement content\n');
  await git(source, ['add', 'tracked/file.txt']);
  await git(source, ['commit', '-m', 'tracked directory']);
  fs.renameSync(tracked, path.join(source, 'saved-tracked'));
  fs.symlinkSync(outside, tracked, process.platform === 'win32' ? 'junction' : 'dir');
  await git(source, ['read-tree', '--empty']);
  await git(source, ['read-tree', 'HEAD']);
  const index = fs.readFileSync(path.join(source, '.git', 'index'));
  const objects = await git(source, ['cat-file', '--batch-all-objects', '--batch-check=%(objectname) %(objecttype)']);

  await assert.rejects(environment.baseline({ workingDirectory: source }), /需求快照路径超出授权工作目录.*tracked/);
  assert.equal(await git(source, ['cat-file', '--batch-all-objects', '--batch-check=%(objectname) %(objecttype)']), objects);
  assert.deepEqual(fs.readFileSync(path.join(source, '.git', 'index')), index, 'read-only repository inspection does not refresh the user index');
  assert.equal(fs.readFileSync(path.join(source, 'saved-tracked', 'file.txt'), 'utf8'), 'tracked local content\n');
  assert.equal(fs.readFileSync(path.join(outside, 'file.txt'), 'utf8'), 'external replacement content\n');
});

test('requirement capture keeps in-directory links and Git-ignored external junctions usable', async t => {
  const { source, directory, git, environment } = await fixture(t);
  const inside = path.join(source, 'inside'), outside = path.join(directory, 'ignored-outside');
  fs.mkdirSync(inside); fs.mkdirSync(outside);
  fs.writeFileSync(path.join(inside, 'result.txt'), 'authorized linked content\n');
  fs.writeFileSync(path.join(outside, 'ignored.txt'), 'excluded from capture\n');
  fs.writeFileSync(path.join(source, '.gitignore'), 'ignored-link\n');
  fs.symlinkSync(inside, path.join(source, 'inside-link'), process.platform === 'win32' ? 'junction' : 'dir');
  fs.symlinkSync(outside, path.join(source, 'ignored-link'), process.platform === 'win32' ? 'junction' : 'dir');
  const status = await git(source, ['status', '--porcelain']);

  const start = await environment.baseline({ workingDirectory: source });
  const entries = await git(source, ['ls-tree', '-r', start.tree]);
  assert.match(entries, /inside\/result\.txt/);
  assert.match(entries, process.platform === 'win32' ? /inside-link\/result\.txt/ : /120000 blob [a-f0-9]+\tinside-link/);
  assert.doesNotMatch(entries, /ignored-link|ignored\.txt/);
  assert.equal(await git(source, ['status', '--porcelain']), status);
});

test('requirement revert refuses a delivered path redirected outside the project after capture', async t => {
  const { source, directory, environment } = await fixture(t);
  const target = path.join(source, 'linked'), outside = path.join(directory, 'outside-revert');
  fs.mkdirSync(target); fs.mkdirSync(outside);
  fs.writeFileSync(path.join(target, 'result.txt'), 'before the requirement\n');
  const start = await environment.baseline({ workingDirectory: source });
  fs.writeFileSync(path.join(target, 'result.txt'), 'delivered requirement\n');
  const delivered = await environment.changes({ workingDirectory: source, base: start.tree });
  fs.renameSync(target, path.join(source, 'saved-local'));
  fs.writeFileSync(path.join(outside, 'result.txt'), 'delivered requirement\n');
  fs.writeFileSync(path.join(outside, '.gitattributes'), '*.txt -diff\n');
  fs.symlinkSync(outside, target, process.platform === 'win32' ? 'junction' : 'dir');

  await assert.rejects(environment.changes({ workingDirectory: source, base: start.tree, end: delivered.end, diff: true }), /需求快照路径超出授权工作目录.*linked/);
  for (const checkOnly of [true, false]) {
    await assert.rejects(environment.revert({ workingDirectory: source, base: start.tree, end: delivered.end, checkOnly }), /需求快照路径超出授权工作目录.*linked/);
  }
  assert.equal(fs.readFileSync(path.join(outside, 'result.txt'), 'utf8'), 'delivered requirement\n');
  assert.equal(fs.readFileSync(path.join(source, 'saved-local', 'result.txt'), 'utf8'), 'delivered requirement\n');
});

test('saved requirement changes retain ordinary repository ancestor attributes for a Project subdirectory', async t => {
  const { source, environment } = await fixture(t);
  const scope = path.join(source, 'app'); fs.mkdirSync(scope);
  fs.writeFileSync(path.join(source, '.gitattributes'), '*.txt -diff\n');
  fs.writeFileSync(path.join(scope, 'result.txt'), 'before the requirement\n');
  const start = await environment.baseline({ workingDirectory: scope });
  fs.writeFileSync(path.join(scope, 'result.txt'), 'delivered requirement\n');
  const delivered = await environment.changes({ workingDirectory: scope, base: start.tree });
  const saved = await environment.changes({ workingDirectory: scope, base: start.tree, end: delivered.end, diff: true });
  assert.deepEqual(saved.files.map(file => [file.path, file.binary]), [['app/result.txt', true]]);
  assert.match(saved.diff, /Binary files/);
  assert.equal((await environment.revert({ workingDirectory: scope, base: start.tree, end: delivered.end })).applied, true);
  assert.equal(fs.readFileSync(path.join(scope, 'result.txt'), 'utf8'), 'before the requirement\n');
});

test('requirement tracking uses the registered workstream directory and rejects a mismatched receipt', async t => {
  const { source, home, authority, environment: preparing } = await fixture(t);
  const payload = { projectId: 'snapshot-project', workstreamId: 'snapshot-stream', workingDirectory: source, mode: 'worktree' };
  const workspace = await preparing.prepareWorkspace(payload);
  const environment = createProjectEnvironment({ home, authority, runGit: (cwd, args, limits) => {
    assert.ok(!args.includes('status'), 'tracking a registered workspace must use metadata-only receipt checks');
    return runGit(cwd, args, limits);
  } });
  const scoped = { projectId: payload.projectId, workstreamId: payload.workstreamId, workspace, workingDirectory: source };
  const start = await environment.baseline(scoped);
  fs.writeFileSync(path.join(workspace.canonicalPath, 'file.txt'), 'registered member result\n');
  const end = await environment.changes({ ...scoped, base: start.tree, diff: true });
  assert.deepEqual(end.files.map(file => file.path), ['file.txt']);
  assert.match(end.diff, /registered member result/);
  assert.equal(fs.readFileSync(path.join(source, 'file.txt'), 'utf8'), 'baseline\n');
  await assert.rejects(environment.baseline({ ...scoped, workspace: { ...workspace, receipt: 'wrong' } }), /回执不一致/);
  await assert.rejects(environment.revert({ ...scoped, workspace: { ...workspace, receipt: 'wrong' }, base: start.tree, end: end.end }), /回执不一致/);
  assert.equal((await environment.revert({ ...scoped, base: start.tree, end: end.end, checkOnly: true })).applied, false);
  assert.equal(fs.readFileSync(path.join(workspace.canonicalPath, 'file.txt'), 'utf8'), 'registered member result\n');
  assert.equal((await environment.revert({ ...scoped, base: start.tree, end: end.end })).applied, true);
  assert.equal(fs.readFileSync(path.join(workspace.canonicalPath, 'file.txt'), 'utf8'), 'baseline\n');
});
