const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  createWorkspaceAuthority,
  scratchWorkspacePath,
} = require('./workspace-authority');
const { setDesktopDshHome, clearDesktopDshHome } = require('../shared/dsh-home');
const { listDir, readFile, readFileMedia, writeFile, setWorkspaceAuthority } = require('./workspace-fs.js');

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-fs-'));
  // Pin the workspace authority so cwd checks pass inside this test root.
  setWorkspaceAuthority(createWorkspaceAuthority({ workspace: dir }));
  return dir;
}

test('workspace reads keep a consistent alias and still refuse a symlink escape', async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-fs-alias-'));
  const root = path.join(parent, 'long-name');
  const alias = path.join(parent, 'short-name');
  const outside = path.join(parent, 'outside');
  fs.mkdirSync(root); fs.mkdirSync(outside);
  fs.symlinkSync(root, alias, 'junction');
  fs.symlinkSync(outside, path.join(root, 'escape'), 'junction');
  fs.writeFileSync(path.join(root, 'note.txt'), 'inside');
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'outside');
  const legacy = fs.realpathSync;
  const native = fs.realpathSync.native;
  const realRoot = native(root);
  const spelling = native(parent) + path.sep + 'short-name';
  const retainedAlias = (file, ...args) => {
    const real = native(file, ...args);
    return real === realRoot || real.startsWith(realRoot + path.sep)
      ? spelling + real.slice(realRoot.length) : real;
  };
  retainedAlias.native = native;
  fs.realpathSync = retainedAlias;
  try {
    setWorkspaceAuthority(createWorkspaceAuthority({ workspace: alias }));
    const result = await readFile(alias, 'note.txt');
    assert.equal(result.ok, true);
    assert.equal(result.text, 'inside');
    assert.equal((await readFile(alias, 'escape/secret.txt')).ok, false);
  } finally {
    fs.realpathSync = legacy;
    setWorkspaceAuthority(null);
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test('workspace reads a logically contained file when native realpath redirects it to an application cache', async () => {
  const cwd = makeTempDir();
  const target = path.join(cwd, 'page.html');
  const native = fs.realpathSync.native;
  fs.writeFileSync(target, '<h1>inside</h1>');
  const spellings = new Set([path.resolve(target).toLowerCase(), native(target).toLowerCase()]);
  let cacheChecks = 0;
  fs.realpathSync.native = (file, ...args) => {
    if (spellings.has(path.resolve(file).toLowerCase())) {
      cacheChecks++;
      return path.join(path.dirname(cwd), 'LocalCache', 'page.html');
    }
    return native(file, ...args);
  };
  try {
    const result = await readFile(cwd, 'page.html');
    assert.equal(result.ok, true);
    assert.equal(result.text, '<h1>inside</h1>');
    assert.ok(cacheChecks > 0, 'the native cache redirection was exercised for the authorized file spelling');
    assert.equal((await readFile(cwd, '../outside.html')).ok, false);
  } finally {
    fs.realpathSync.native = native;
    setWorkspaceAuthority(null);
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('logical workspace paths do not allow a short alias to Git metadata', async () => {
  const cwd = makeTempDir();
  const metadata = path.join(cwd, '.git');
  const alias = path.join(cwd, 'GIT~1');
  fs.mkdirSync(path.join(metadata, 'hooks'), { recursive: true });
  const hook = path.join(metadata, 'hooks', 'pre-commit');
  fs.writeFileSync(hook, 'original');
  if (!fs.existsSync(alias)) fs.symlinkSync(metadata, alias, 'junction');
  const legacy = fs.realpathSync;
  const retainedAlias = (file, ...args) => {
    const absolute = path.resolve(file);
    return absolute === alias || absolute.startsWith(alias + path.sep) ? absolute : legacy(file, ...args);
  };
  retainedAlias.native = legacy.native;
  fs.realpathSync = retainedAlias;
  try {
    assert.equal((await readFile(cwd, 'GIT~1/hooks/pre-commit')).ok, false);
    assert.equal((await writeFile(cwd, 'GIT~1/hooks/pre-commit', 'replacement')).ok, false);
    assert.equal(fs.readFileSync(hook, 'utf8'), 'original');
  } finally {
    fs.realpathSync = legacy;
    setWorkspaceAuthority(null);
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('listDir returns directories first and rejects path traversal', async () => {
  const cwd = makeTempDir();
  try {
    fs.mkdirSync(path.join(cwd, 'src'));
    fs.writeFileSync(path.join(cwd, 'README.md'), 'hello\n');
    const listed = await listDir(cwd, '');
    assert.equal(listed.ok, true);
    assert.deepEqual(listed.entries, [
      { name: 'src', kind: 'directory' },
      { name: 'README.md', kind: 'file' },
    ]);
    const escaped = await listDir(cwd, '..');
    assert.equal(escaped.ok, false);
    assert.equal(escaped.message, 'Path is outside the workspace.');
    assert.equal(escaped.code, 'workspace/outside');
  } finally {
    setWorkspaceAuthority(null);
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('listDir reports workspace/outside when a directory is swapped outside after authorization', async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-fs-list-swap-'));
  const cwd = path.join(parent, 'workspace');
  const victim = path.join(cwd, 'victim');
  const outside = path.join(parent, 'outside');
  fs.mkdirSync(victim, { recursive: true });
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'outside');
  const authority = createWorkspaceAuthority({ workspace: cwd });
  let swapped = false;
  setWorkspaceAuthority({
    ...authority,
    resolveInside(base, relativePath) {
      const target = authority.resolveInside(base, relativePath);
      assert.ok(target, 'fixture must be authorized before the swap');
      fs.rmdirSync(target);
      fs.symlinkSync(outside, target, process.platform === 'win32' ? 'junction' : 'dir');
      swapped = true;
      return target;
    },
  });
  try {
    const result = await listDir(cwd, 'victim');
    assert.equal(swapped, true);
    assert.equal(fs.realpathSync.native(victim), fs.realpathSync.native(outside));
    assert.deepEqual(result, {
      ok: false,
      message: 'Path is outside the workspace.',
      code: 'workspace/outside',
    });
  } finally {
    setWorkspaceAuthority(null);
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test('readFile returns utf8 text and rejects a path outside cwd', async () => {
  const cwd = makeTempDir();
  try {
    fs.writeFileSync(path.join(cwd, 'note.txt'), 'alpha\n');
    const read = await readFile(cwd, 'note.txt');
    assert.equal(read.ok, true);
    assert.equal(read.binary, false);
    assert.equal(read.text, 'alpha\n');
    const escaped = await readFile(cwd, path.join('..', 'outside.txt'));
    assert.equal(escaped.ok, false);
  } finally {
    setWorkspaceAuthority(null);
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('listDir accepts a second authorized root and rejects an outsider', async () => {
  const boot = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-fs-boot-'));
  const extra = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-fs-extra-'));
  const outsider = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-fs-out-'));
  setWorkspaceAuthority(createWorkspaceAuthority({
    workspace: boot,
    extraWorkspaces: [extra],
  }));
  try {
    fs.writeFileSync(path.join(extra, 'README.md'), 'hello\n');
    fs.writeFileSync(path.join(outsider, 'secret.txt'), 'nope\n');
    const listed = await listDir(extra, '');
    assert.equal(listed.ok, true);
    assert.deepEqual(listed.entries, [{ name: 'README.md', kind: 'file' }]);
    const blocked = await listDir(outsider, '');
    assert.equal(blocked.ok, false);
    assert.equal(blocked.message, 'Path is outside the workspace.');
  } finally {
    setWorkspaceAuthority(null);
    fs.rmSync(boot, { recursive: true, force: true });
    fs.rmSync(extra, { recursive: true, force: true });
    fs.rmSync(outsider, { recursive: true, force: true });
  }
});

/**
 * Issue #97: a session with no workspace cwd generates files under the
 * Host-owned scratch root. The document tab reads through `shell:read-file` /
 * `shell:list-dir`, which resolve through workspace-fs's *lazy production*
 * authority. That authority must include the scratch root (the preview
 * authority already does), while traversal outside it stays refused.
 */
test('workspace-fs authority (shell:read-file / shell:list-dir) accepts the scratch cwd and refuses its parent', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-fs-home-'));
  const boot = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-fs-boot-'));
  const previousConfig = require.cache[require.resolve('./config')];
  try {
    const scratch = scratchWorkspacePath(home);
    fs.mkdirSync(scratch);
    fs.writeFileSync(path.join(scratch, 'pelican-bike.html'), '<h1>ok</h1>\n');
    const outside = path.join(path.dirname(scratch), 'outside.txt');
    fs.writeFileSync(outside, 'classified\n');

    require.cache[require.resolve('./config')] = {
      id: require.resolve('./config'),
      filename: require.resolve('./config'),
      loaded: true,
      exports: { loadConfig: () => ({ workspace: boot }) },
    };
    setDesktopDshHome(home);
    // Drive the production path: no test authority is pinned, so
    // workspace-fs's own lazy authority is what answers both calls.
    setWorkspaceAuthority(null);

    const listed = await listDir(scratch, '');
    assert.equal(listed.ok, true);
    assert.deepEqual(listed.entries, [{ name: 'pelican-bike.html', kind: 'file' }]);

    const read = await readFile(scratch, 'pelican-bike.html');
    assert.equal(read.ok, true);
    assert.equal(read.text, '<h1>ok</h1>\n');

    // Negative: the scratch root is the boundary, not the whole volume/home.
    for (const rel of ['..', path.join('..', 'outside.txt'), outside]) {
      const escapedRead = await readFile(scratch, rel);
      assert.equal(escapedRead.ok, false, `readFile(${rel}) 必须被拒绝`);
      assert.equal(escapedRead.message, 'Path is outside the workspace.');
      const escapedList = await listDir(scratch, rel);
      assert.equal(escapedList.ok, false, `listDir(${rel}) 必须被拒绝`);
      assert.equal(escapedList.message, 'Path is outside the workspace.');
    }
  } finally {
    setWorkspaceAuthority(null);
    if (previousConfig) require.cache[require.resolve('./config')] = previousConfig;
    else delete require.cache[require.resolve('./config')];
    clearDesktopDshHome();
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(boot, { recursive: true, force: true });
  }
});

test('readFileMedia returns png bytes and rejects non-images and traversal', async () => {
  const cwd = makeTempDir();
  try {
    fs.writeFileSync(path.join(cwd, 'icon.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    fs.writeFileSync(path.join(cwd, 'note.ts'), 'export {}\n');
    const png = await readFileMedia(cwd, 'icon.png');
    assert.equal(png.ok, true);
    assert.equal(png.mime, 'image/png');
    assert.equal(typeof png.base64, 'string');
    const ts = await readFileMedia(cwd, 'note.ts');
    assert.equal(ts.ok, false);
    const escaped = await readFileMedia(cwd, path.join('..', 'icon.png'));
    assert.equal(escaped.ok, false);
  } finally {
    setWorkspaceAuthority(null);
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('writeFile creates missing parent directories', async () => {
  const cwd = makeTempDir();
  try {
    const written = await writeFile(cwd, 'nested/new.txt', 'hi\n');
    assert.equal(written.ok, true);
    assert.equal(fs.readFileSync(path.join(cwd, 'nested', 'new.txt'), 'utf8'), 'hi\n');
  } finally {
    setWorkspaceAuthority(null);
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('L-4: writeFile rejects every path with a .git segment, keeps .gitignore/.github writable', async () => {
  const cwd = makeTempDir();
  try {
    fs.mkdirSync(path.join(cwd, '.git'));
    fs.writeFileSync(path.join(cwd, '.git', 'config'), '[core]\n');
    const blocked = [
      '.git/config',
      '.git/hooks/pre-commit',
      'sub/.git/config', // nested repo
      '.GIT/config', // case-insensitive filesystems
      '.git\\hooks\\post-checkout', // windows separators
      'docs/../.git/config', // traversal into .git
      '.git', // gitlink file overwrite (worktrees/submodules)
    ];
    for (const rel of blocked) {
      const result = await writeFile(cwd, rel, 'pwned\n');
      assert.equal(result.ok, false, `${rel} 必须被拒绝`);
      assert.equal(result.message, 'Saving inside .git is not allowed.');
    }
    assert.equal(fs.readFileSync(path.join(cwd, '.git', 'config'), 'utf8'), '[core]\n', '.git/config 不得被改写');

    // 名称仅前缀相似的路径仍可保存（产品契约：普通 dotfile 正常编辑）。
    const gitignore = await writeFile(cwd, '.gitignore', 'dist/\n');
    assert.equal(gitignore.ok, true);
    const workflow = await writeFile(cwd, '.github/workflows/ci.yml', 'on: push\n');
    assert.equal(workflow.ok, true);
    const gitLikeName = await writeFile(cwd, 'src/git.txt', 'ok\n');
    assert.equal(gitLikeName.ok, true);
  } finally {
    setWorkspaceAuthority(null);
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('L-4b: writeFile refuses a .git reachable only through an innocuous link', async (t) => {
  const cwd = makeTempDir();
  try {
    fs.mkdirSync(path.join(cwd, '.git', 'hooks'), { recursive: true });
    fs.writeFileSync(path.join(cwd, '.git', 'hooks', 'pre-commit'), 'SENTINEL-HOOK\n');
    fs.writeFileSync(path.join(cwd, '.git', 'config'), 'SENTINEL-CONFIG\n');

    // Cover both shapes independently: a directory link to the whole .git and
    // a file link one hop into it. Each case proves its own fixture was
    // created and resolves to the intended target before asserting, so a
    // failed fixture can never pass as a successful denial.
    let dirLinked = false;
    try {
      fs.symlinkSync(
        path.join(cwd, '.git'),
        path.join(cwd, 'notes'),
        process.platform === 'win32' ? 'junction' : 'dir',
      );
      dirLinked = fs.realpathSync(path.join(cwd, 'notes')) === fs.realpathSync(path.join(cwd, '.git'));
    } catch { /* directory links unavailable on this host */ }
    let fileLinked = false;
    try {
      fs.symlinkSync(path.join(cwd, '.git', 'config'), path.join(cwd, 'config-link'));
      fileLinked = fs.realpathSync(path.join(cwd, 'config-link')) === fs.realpathSync(path.join(cwd, '.git', 'config'));
    } catch { /* file links unavailable on this host */ }
    if (!dirLinked && !fileLinked) {
      t.skip('directory and file links unavailable');
      return;
    }

    if (dirLinked) {
      for (const rel of [
        'notes/hooks/pre-commit',
        'notes/config',
        path.join('notes', '..', 'notes', 'hooks', 'pre-commit'),
      ]) {
        const result = await writeFile(cwd, rel, 'pwned\n');
        assert.equal(result.ok, false, `${rel} 必须被拒绝`);
      }
    }
    if (fileLinked) {
      const result = await writeFile(cwd, 'config-link', 'pwned\n');
      assert.equal(result.ok, false, 'config-link 必须被拒绝');
    }
    assert.equal(
      fs.readFileSync(path.join(cwd, '.git', 'hooks', 'pre-commit'), 'utf8'),
      'SENTINEL-HOOK\n',
      '.git/hooks/pre-commit 不得被改写',
    );
    assert.equal(
      fs.readFileSync(path.join(cwd, '.git', 'config'), 'utf8'),
      'SENTINEL-CONFIG\n',
      '.git/config 不得被改写',
    );
    // git metadata stays hidden from the listing too.
    const listed = await listDir(cwd, '');
    assert.equal(listed.ok, true);
    assert.equal(listed.entries.some((e) => e.name === '.git'), false);
  } finally {
    setWorkspaceAuthority(null);
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('L-4c: a link swapped in during the async write window cannot redirect a save into .git', async (t) => {
  const cwd = makeTempDir();
  try {
    fs.mkdirSync(path.join(cwd, '.git', 'hooks'), { recursive: true });
    const sentinel = path.join(cwd, '.git', 'hooks', 'pre-commit');
    fs.writeFileSync(sentinel, 'SENTINEL-HOOK\n');
    fs.mkdirSync(path.join(cwd, 'victim'));

    // Deterministic interleaving at the privileged effect: by the time the
    // implementation calls mkdir it has already passed its containment check
    // and its stat, so swapping `victim` for a link to `.git` here lands
    // squarely inside the check-then-use window rather than racing it.
    const realMkdir = fs.promises.mkdir;
    let swapped = false;
    fs.promises.mkdir = async (...args) => {
      if (!swapped) {
        fs.rmdirSync(path.join(cwd, 'victim'));
        fs.symlinkSync(
          path.join(cwd, '.git'),
          path.join(cwd, 'victim'),
          process.platform === 'win32' ? 'junction' : 'dir',
        );
        // Only mark the swap done once the replacement link actually exists;
        // otherwise a throwing fixture would be reported as a passing denial.
        swapped = true;
      }
      return realMkdir(...args);
    };

    let result;
    try {
      result = await writeFile(cwd, path.join('victim', 'target.txt'), 'pwned\n');
    } finally {
      fs.promises.mkdir = realMkdir;
    }
    if (!swapped) {
      t.skip('directory links unavailable on this host');
      return;
    }

    assert.equal(
      fs.realpathSync(path.join(cwd, 'victim')),
      fs.realpathSync(path.join(cwd, '.git')),
      'fixture swap must land on .git',
    );
    assert.equal(result.ok, false, 'the save must fail closed after the swap');
    assert.equal(
      fs.readFileSync(sentinel, 'utf8'),
      'SENTINEL-HOOK\n',
      '.git 被经链接改写',
    );
    assert.equal(fs.existsSync(path.join(cwd, '.git', 'target.txt')), false);
  } finally {
    setWorkspaceAuthority(null);
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('L-4d: writeFile refuses a dangling link instead of writing through it', async (t) => {
  const cwd = makeTempDir();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-fs-dangling-'));
  try {
    const outsideTarget = path.join(outside, 'new-file.txt');
    const gitTarget = path.join(cwd, '.git', 'new-file.txt');
    fs.mkdirSync(path.join(cwd, '.git'), { recursive: true });

    const fixtures = [];
    try {
      fs.symlinkSync(outsideTarget, path.join(cwd, 'outside-link'));
      fixtures.push({ rel: 'outside-link', target: outsideTarget });
    } catch { /* file links unavailable on this host */ }

    if (fixtures.length === 0) {
      t.skip('file links unavailable on this host');
      return;
    }

    // Prove the fixture is a link whose destination really is missing.
    for (const fixture of fixtures) {
      assert.equal(fs.lstatSync(path.join(cwd, fixture.rel)).isSymbolicLink(), true);
      assert.equal(fs.existsSync(fixture.target), false, `${fixture.target} 必须不存在`);
    }

    for (const fixture of fixtures) {
      const result = await writeFile(cwd, fixture.rel, 'pwned\n');
      assert.equal(result.ok, false, `${fixture.rel} 必须被拒绝`);
      assert.equal(fs.existsSync(fixture.target), false, `${fixture.target} 不得被创建`);
    }
    assert.equal(fs.existsSync(gitTarget), false);

    // A genuinely missing file is still a valid creation target.
    const created = await writeFile(cwd, path.join('nested', 'brand-new.txt'), 'ok\n');
    assert.equal(created.ok, true);
    assert.equal(fs.readFileSync(path.join(cwd, 'nested', 'brand-new.txt'), 'utf8'), 'ok\n');
  } finally {
    setWorkspaceAuthority(null);
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('listDir hides gitignored names when git is available', async () => {
  const cwd = makeTempDir();
  try {
    fs.writeFileSync(path.join(cwd, '.gitignore'), 'secret.txt\n');
    fs.writeFileSync(path.join(cwd, 'secret.txt'), 'nope');
    fs.writeFileSync(path.join(cwd, 'keep.txt'), 'yes');
    fs.mkdirSync(path.join(cwd, '.git'));
    const listed = await listDir(cwd, '');
    assert.equal(listed.ok, true);
    const names = listed.entries.map((e) => e.name);
    assert.equal(names.includes('.git'), false);
    assert.equal(names.includes('keep.txt'), true);
    if (names.includes('secret.txt')) {
      // git missing: ignore-file skip is best-effort; .git still hidden
    } else {
      assert.equal(names.includes('secret.txt'), false);
    }
  } finally {
    setWorkspaceAuthority(null);
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('listDir batch-classifies many entries, including names with spaces, in one pass', async () => {
  const cwd = makeTempDir();
  try {
    fs.writeFileSync(path.join(cwd, '.gitignore'), '*.log\nbuild dir/\n');
    fs.mkdirSync(path.join(cwd, 'build dir'));
    for (let index = 0; index < 30; index += 1) {
      fs.writeFileSync(path.join(cwd, `trace-${index}.log`), 'x');
      fs.writeFileSync(path.join(cwd, `src-${index}.ts`), 'x');
    }
    fs.writeFileSync(path.join(cwd, 'with space.ts'), 'x');
    const listed = await listDir(cwd, '');
    assert.equal(listed.ok, true);
    const names = listed.entries.map((e) => e.name);
    assert.equal(names.includes('with space.ts'), true);
    assert.equal(names.filter((name) => name.endsWith('.ts')).length, 31);
    if (!names.includes('trace-0.log')) {
      // git present: every ignored name is filtered by the single batch call.
      assert.equal(names.some((name) => name.endsWith('.log')), false);
      assert.equal(names.includes('build dir'), false);
    }
  } finally {
    setWorkspaceAuthority(null);
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('writeFile replaces utf8 text and rejects traversal, directories, and oversized payloads', async () => {
  const cwd = makeTempDir();
  try {
    fs.writeFileSync(path.join(cwd, 'note.txt'), 'alpha\n');
    fs.mkdirSync(path.join(cwd, 'src'));
    const written = await writeFile(cwd, 'note.txt', 'beta\n');
    assert.equal(written.ok, true);
    assert.equal(fs.readFileSync(path.join(cwd, 'note.txt'), 'utf8'), 'beta\n');
    const escaped = await writeFile(cwd, path.join('..', 'note.txt'), 'nope\n');
    assert.equal(escaped.ok, false);
    const dir = await writeFile(cwd, 'src', 'nope\n');
    assert.equal(dir.ok, false);
    const huge = await writeFile(cwd, 'note.txt', 'x'.repeat(1024 * 1024 + 1));
    assert.equal(huge.ok, false);
    const missing = await writeFile(cwd, '', 'x');
    assert.equal(missing.ok, false);
    const notText = await writeFile(cwd, 'note.txt', 1);
    assert.equal(notText.ok, false);
  } finally {
    setWorkspaceAuthority(null);
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});
