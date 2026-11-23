import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ProjectService } from './harness-runtime.mjs';
import { runGit } from '../lib/worktree.js';

function makeTempDir(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

async function initGitRepo(dir) {
  await runGit(dir, ['init', '-b', 'main']);
  await runGit(dir, ['config', 'user.email', 'test@whaleisle.local']);
  await runGit(dir, ['config', 'user.name', 'WhaleIsle Test']);
  fs.writeFileSync(path.join(dir, 'README.md'), '# Repo\nInitial line\n', 'utf8');
  await runGit(dir, ['add', 'README.md']);
  await runGit(dir, ['commit', '-m', 'Initial commit']);
}

test('worktree isolation degrades gracefully on missing or non-git workspaces', async (t) => {
  const home = makeTempDir(t, 'dsh-proj-wt-home-');
  const plainDir = makeTempDir(t, 'dsh-proj-wt-plain-');

  const activations = [];
  const service = new ProjectService(
    {
      get: (k) => (k === 'subagents'
        ? {
            async startActivation(opts) {
              activations.push(opts);
              return { childId: `c-${activations.length}`, name: `w-${activations.length}` };
            },
          }
        : undefined),
    },
    { home },
  );
  t.after(() => service.dispose());

  // 1. Non-git directory degrades cleanly
  const p1 = await service.createProject({
    name: 'PlainFolder',
    workspace: plainDir,
    autonomy: 'auto',
    worktreeIsolation: true,
  });
  const { task: t1 } = await service.addTask(p1.id, { title: 'Run in plain dir' });
  const msg1 = await service.dispatchTask(p1.id, t1.id, { agent: { id: 'coord' } });
  assert.match(msg1, /not_a_git_repository/);
  const loaded1 = await service.readProject(p1.id);
  assert.equal(loaded1.tasks[0].worktreeDegraded, 'not_a_git_repository');
  assert.equal(activations[0].cwd, plainDir);

  // 2. Missing workspace degrades cleanly
  const p2 = await service.createProject({
    name: 'NoFolder',
    workspace: '',
    autonomy: 'auto',
    worktreeIsolation: true,
  });
  const { task: t2 } = await service.addTask(p2.id, { title: 'No workspace' });
  const msg2 = await service.dispatchTask(p2.id, t2.id, { agent: { id: 'coord' } });
  assert.match(msg2, /workspace_missing/);
});

test('real git repo: worktree isolation under $DSH_HOME/project-worktrees, diff inspection, safe merge, conflict abort, and cleanup', async (t) => {
  const home = makeTempDir(t, 'dsh-proj-wt-real-home-');
  const repoDir = makeTempDir(t, 'dsh-proj-wt-repo-');
  await initGitRepo(repoDir);

  const activations = [];
  const service = new ProjectService(
    {
      get: (k) => (k === 'subagents'
        ? {
            async startActivation(opts) {
              activations.push(opts);
              return { childId: `wt-worker-${activations.length}`, name: `wt-${activations.length}` };
            },
          }
        : undefined),
    },
    { home },
  );
  t.after(() => service.dispose());

  const project = await service.createProject({
    name: 'GitProject',
    workspace: repoDir,
    autonomy: 'auto',
    worktreeIsolation: true,
  });

  // 1. Dispatch task -> creates worktree outside repo without modifying .gitignore
  const { task: t1 } = await service.addTask(project.id, { title: 'Add feature A' });
  await service.dispatchTask(project.id, t1.id, { agent: { id: 'coord' } });

  const loaded = await service.readProject(project.id);
  const row1 = loaded.tasks.find((x) => x.id === t1.id);
  assert.equal(row1.branch, `project/${t1.id}`);
  assert.ok(row1.worktreePath.startsWith(path.join(home, 'project-worktrees')));
  assert.ok(fs.existsSync(row1.worktreePath));

  // Main repo working tree stays completely clean (no .worktrees pollution!)
  const mainStatus = await runGit(repoDir, ['status', '--porcelain']);
  assert.equal(mainStatus.stdout, '');

  // 2. Modify tracked file and create untracked file in worktree -> getTaskDiff sees both!
  fs.writeFileSync(path.join(row1.worktreePath, 'README.md'), '# Repo\nInitial line\nFeature A\n', 'utf8');
  fs.writeFileSync(path.join(row1.worktreePath, 'feature-a.txt'), 'hello feature A\n', 'utf8');

  const diffBeforeCommit = await service.getTaskDiff(project.id, t1.id);
  assert.equal(diffBeforeCommit.available, true);
  assert.equal(diffBeforeCommit.branch, `project/${t1.id}`);
  assert.equal(diffBeforeCommit.files.length, 2);
  assert.ok(diffBeforeCommit.files.some((f) => f.path === 'README.md' && f.additions === 1));
  assert.ok(diffBeforeCommit.files.some((f) => f.path === 'feature-a.txt' && f.status === 'A'));
  assert.match(diffBeforeCommit.diff, /\+Feature A/);
  assert.match(diffBeforeCommit.diff, /\+hello feature A/);

  // 3. Merge refuses when worktree has uncommitted changes (409 dirtyWorktree)
  await assert.rejects(
    () => service.mergeTaskWorktree(project.id, t1.id),
    (err) => err.status === 409 && err.dirtyWorktree === true,
  );

  // Commit worktree changes
  await runGit(row1.worktreePath, ['add', '-A']);
  await runGit(row1.worktreePath, ['commit', '-m', 'Implement feature A']);

  // Diff still shows committed changes relative to baseCommit!
  const diffAfterCommit = await service.getTaskDiff(project.id, t1.id);
  assert.equal(diffAfterCommit.files.length, 2);

  // 4. Merge refuses when main workspace is dirty (409 dirtyWorkspace)
  const dirtyFile = path.join(repoDir, 'scratch.tmp');
  fs.writeFileSync(dirtyFile, 'uncommitted work', 'utf8');
  await assert.rejects(
    () => service.mergeTaskWorktree(project.id, t1.id),
    (err) => err.status === 409 && err.dirtyWorkspace === true,
  );
  fs.rmSync(dirtyFile, { force: true });

  // 5. Clean merge succeeds and brings changes into main!
  const merged = await service.mergeTaskWorktree(project.id, t1.id);
  assert.equal(merged.merged, true);
  assert.equal(merged.alreadyMerged, false);
  assert.equal(merged.targetBranch, 'main');
  assert.ok(fs.existsSync(path.join(repoDir, 'feature-a.txt')));
  assert.match(fs.readFileSync(path.join(repoDir, 'README.md'), 'utf8'), /Feature A/);

  // Re-merging reports alreadyMerged: true
  const remerged = await service.mergeTaskWorktree(project.id, t1.id);
  assert.equal(remerged.merged, true);
  assert.equal(remerged.alreadyMerged, true);

  // 6. Conflict test: task 2 conflicts with main -> merge aborts cleanly (409 conflict)
  const { task: t2 } = await service.addTask(project.id, { title: 'Conflicting edit' });
  await service.dispatchTask(project.id, t2.id, { agent: { id: 'coord' } });
  const row2 = (await service.readProject(project.id)).tasks.find((x) => x.id === t2.id);

  // Edit README.md in worktree AND differently on main
  fs.writeFileSync(path.join(row2.worktreePath, 'README.md'), '# Repo\nWorktree version\n', 'utf8');
  await runGit(row2.worktreePath, ['add', 'README.md']);
  await runGit(row2.worktreePath, ['commit', '-m', 'Worktree edit']);

  fs.writeFileSync(path.join(repoDir, 'README.md'), '# Repo\nMain version\n', 'utf8');
  await runGit(repoDir, ['add', 'README.md']);
  await runGit(repoDir, ['commit', '-m', 'Main edit']);

  await assert.rejects(
    () => service.mergeTaskWorktree(project.id, t2.id),
    (err) => err.status === 409 && err.conflict === true,
  );
  // Main repo must remain completely clean after aborted conflict!
  assert.equal((await runGit(repoDir, ['status', '--porcelain'])).stdout, '');

  // 7. Cleanup removes worktree and branch even when dirty
  fs.writeFileSync(path.join(row2.worktreePath, 'dirty.txt'), 'unsaved', 'utf8');
  const cleaned = await service.cleanupTaskWorktree(project.id, t2.id);
  assert.equal(cleaned.cleaned, true);
  assert.equal(cleaned.worktree.removed, true);
  assert.equal(cleaned.worktree.branchDeleted, true);
  assert.ok(!fs.existsSync(row2.worktreePath));

  // 8. Archiving project cleans up remaining task worktrees
  const archived = await service.updateProject(project.id, { archived: true });
  assert.equal(archived.worktrees.failed.length, 0);
  assert.equal(archived.worktrees.removed.length, 1);
  assert.ok(!fs.existsSync(row1.worktreePath));
});
