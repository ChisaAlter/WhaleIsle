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
