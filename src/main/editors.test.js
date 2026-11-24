const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createWorkspaceAuthority } = require('./workspace-authority');
const {
  EDITORS,
  listAvailableEditors,
  openInEditor,
  showItemInFolder,
  openWithSystemDefault,
  setWorkspaceAuthority,
} = require('./editors.js');

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-editors-'));
  setWorkspaceAuthority(createWorkspaceAuthority({ workspace: dir }));
  return dir;
}

/** Match native authority spelling, including macOS aliases and Windows DOS short names. */
function canonical(p) {
  return fs.realpathSync.native(path.resolve(p));
}

function fakeExecFile(available) {
  return (file, args, _opts, cb) => {
    const candidate = file === 'where.exe' ? args[0] : String(args[1] || '');
    const found = available.some((command) => candidate.includes(command));
    cb(found ? null : Object.assign(new Error('not found'), { code: 1 }));
  };
}

test('EDITORS copies ids, labels, commands, baseArgs, and launchStyle', () => {
  const vscode = EDITORS.find((editor) => editor.id === 'vscode');
  const zed = EDITORS.find((editor) => editor.id === 'zed');
  const idea = EDITORS.find((editor) => editor.id === 'idea');
  const kiro = EDITORS.find((editor) => editor.id === 'kiro');
  const fileManager = EDITORS.find((editor) => editor.id === 'file-manager');
  assert.deepEqual(vscode, { id: 'vscode', label: 'VS Code', commands: ['code'], launchStyle: 'goto' });
  assert.deepEqual(zed, {
    id: 'zed',
    label: 'Zed',
    commands: ['zed', 'zeditor'],
    launchStyle: 'direct-path',
  });
  assert.equal(idea.launchStyle, 'line-column');
  assert.deepEqual(kiro.baseArgs, ['ide']);
  assert.equal(fileManager.commands, null);
});

test('listAvailableEditors skips file-manager and keeps commands on PATH', async () => {
  const listed = await listAvailableEditors({
    execFile: fakeExecFile(['code', 'idea']),
    platform: 'win32',
  });
  assert.equal(listed.some((editor) => editor.id === 'file-manager'), false);
  assert.equal(listed.some((editor) => editor.id === 'vscode'), true);
  assert.equal(listed.some((editor) => editor.id === 'idea'), true);
  assert.equal(listed.some((editor) => editor.id === 'cursor'), false);
  assert.equal(listed.find((editor) => editor.id === 'vscode').label, 'VS Code');
});

test('openInEditor vscode spawns code --goto with a fake spawn', async () => {
  const cwd = makeTempDir();
  try {
    fs.writeFileSync(path.join(cwd, 'app.ts'), '');
    const spawned = [];
    const result = await openInEditor(
      { editor: 'vscode', cwd, relativePath: 'app.ts', line: 12, column: 4 },
      {
        spawn(command, args) {
          spawned.push({ command, args });
          return { unref() {} };
        },
        execFile: fakeExecFile(['code']),
        platform: 'win32',
      },
    );
    assert.equal(result.ok, true);
    assert.equal(spawned.length, 1);
    assert.equal(spawned[0].command, 'code');
    assert.deepEqual(spawned[0].args, ['--goto', `${path.join(canonical(cwd), 'app.ts')}:12:4`]);
  } finally {
    setWorkspaceAuthority(null);
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('openInEditor returns ok false when the command is missing', async () => {
  const cwd = makeTempDir();
  try {
    fs.writeFileSync(path.join(cwd, 'app.ts'), '');
    const spawned = [];
    const result = await openInEditor(
      { editor: 'vscode', cwd, relativePath: 'app.ts', line: 1 },
      {
        spawn(command, args) {
          spawned.push({ command, args });
          return { unref() {} };
        },
        execFile: fakeExecFile([]),
        platform: 'win32',
      },
    );
    assert.equal(result.ok, false);
    assert.equal(typeof result.message, 'string');
    assert.equal(spawned.length, 0);
  } finally {
    setWorkspaceAuthority(null);
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('showItemInFolder is called with the absolute path', () => {
  const shown = [];
  const absolutePath = path.join(os.tmpdir(), 'shown.ts');
  const result = showItemInFolder(absolutePath, {
    shell: { showItemInFolder: (target) => shown.push(target) },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(shown, [absolutePath]);
});

test('openWithSystemDefault uses resolveInside and shell.openPath, not git openWorkspacePath', async () => {
  const cwd = makeTempDir();
  try {
    fs.writeFileSync(path.join(cwd, 'note.md'), 'hi\n');
    const opened = [];
    const result = await openWithSystemDefault(
      { cwd, relativePath: 'note.md' },
      {
        shell: {
          async openPath(target) {
            opened.push(target);
            return '';
          },
        },
      },
    );
    assert.equal(result.ok, true);
    assert.deepEqual(opened, [path.join(canonical(cwd), 'note.md')]);
    const escaped = await openWithSystemDefault(
      { cwd, relativePath: '../outside.txt' },
      { shell: { async openPath() { return ''; } } },
    );
    assert.equal(escaped.ok, false);
  } finally {
    setWorkspaceAuthority(null);
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('openInEditor safely handles Windows .cmd/.bat wrappers and async spawn errors', async () => {
  const { EventEmitter } = require('node:events');
  const cwd = makeTempDir();
  try {
    const weirdFile = 'a & calc %PATH%.ts';
    fs.writeFileSync(path.join(cwd, weirdFile), '');
    const spawned = [];
    const spawnErrors = [];
    const res = await openInEditor(
      { editor: 'vscode', cwd, relativePath: weirdFile, line: 3, column: 2 },
      {
        platform: 'win32',
        env: { ComSpec: 'C:\\Windows\\System32\\cmd.exe' },
        execFile: (file, _args, _opts, cb) => {
          assert.equal(file, 'where.exe');
          cb(null, 'C:\\Program Files\\VS Code\\bin\\code\r\nC:\\Program Files\\VS Code\\bin\\code.cmd\r\n');
        },
        spawn(command, args, options) {
          spawned.push({ command, args, options });
          const emitter = new EventEmitter();
          emitter.unref = () => {};
          process.nextTick(() => emitter.emit('error', Object.assign(new Error('ENOENT'), { code: 'ENOENT' })));
          return emitter;
        },
        onSpawnError(error) {
          spawnErrors.push(error.message);
        },
      },
    );
    assert.equal(res.ok, true);
    assert.equal(spawned.length, 1);
    assert.equal(spawned[0].command, 'C:\\Windows\\System32\\cmd.exe');
    assert.equal(spawned[0].options.windowsVerbatimArguments, true);
    assert.equal(spawned[0].options.env.DSHD_EDITOR_CMD, 'C:\\Program Files\\VS Code\\bin\\code.cmd');
    assert.equal(spawned[0].options.env.DSHD_EDITOR_ARG_0, '--goto');
    assert.match(spawned[0].options.env.DSHD_EDITOR_ARG_1, /a & calc %PATH%\.ts:3:2$/);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(spawnErrors, ['ENOENT']);
  } finally {
    setWorkspaceAuthority(null);
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});
