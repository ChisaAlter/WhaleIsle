'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createWorkspaceAuthority } = require('./workspace-authority');
const { normalizePreviewFileTarget } = require('./preview-file-target');

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), prefix));
}

function authorityFor(workspace, extraWorkspaces = []) {
  return createWorkspaceAuthority({ workspace, extraWorkspaces });
}

test('absolute preview resolves an accessible directory alias and refuses its escaping symlink', () => {
  const parent = makeTempDir('dsh-preview-alias-');
  const root = path.join(parent, 'workspace');
  const alias = path.join(parent, 'alias');
  const outside = path.join(parent, 'outside');
  fs.mkdirSync(root);
  fs.mkdirSync(outside);
  fs.symlinkSync(root, alias, 'junction');
  fs.symlinkSync(outside, path.join(root, 'escape'), 'junction');
  fs.writeFileSync(path.join(root, 'note.txt'), 'inside');
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'outside');
  try {
    assert.deepEqual(
      normalizePreviewFileTarget({ absolutePath: path.join(alias, 'note.txt') }, authorityFor(alias)),
      { ok: true, cwd: fs.realpathSync(root), relativePath: 'note.txt' },
    );
    assert.equal(normalizePreviewFileTarget({ absolutePath: path.join(alias, 'escape', 'secret.txt') }, authorityFor(alias)).ok, false);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test('normalizePreviewFileTarget preserves cwd/relativePath and validates containment', () => {
  const root = makeTempDir('dsh-preview-target-');
  try {
    fs.mkdirSync(path.join(root, 'src'));
    fs.writeFileSync(path.join(root, 'src', 'main.ts'), 'export {}\n');
    const authority = authorityFor(root);
    assert.deepEqual(
      normalizePreviewFileTarget({ cwd: root, relativePath: 'src/main.ts' }, authority),
      { ok: true, cwd: root, relativePath: 'src/main.ts' },
    );
    assert.equal(
      normalizePreviewFileTarget({ cwd: root, relativePath: '../outside.ts' }, authority).ok,
      false,
    );
    assert.equal(
      normalizePreviewFileTarget({ cwd: root, relativePath: path.join(root, 'src', 'main.ts') }, authority).ok,
      false,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('normalizePreviewFileTarget resolves an absolute path against the most specific root', () => {
  const root = makeTempDir('dsh-preview-root-');
  const nested = path.join(root, 'packages');
  fs.mkdirSync(nested);
  try {
    fs.writeFileSync(path.join(nested, 'readme.md'), 'nested\n');
    const authority = authorityFor(root, [nested]);
    assert.deepEqual(
      normalizePreviewFileTarget({ absolutePath: path.join(nested, 'readme.md') }, authority),
      { ok: true, cwd: fs.realpathSync.native(nested), relativePath: 'readme.md' },
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('normalizePreviewFileTarget accepts a scratch root only when the authority opted in', () => {
  const root = makeTempDir('dsh-preview-root-');
  const scratch = makeTempDir('dsh-preview-scratch-');
  try {
    fs.writeFileSync(path.join(scratch, 'note.txt'), 'scratch\n');
    const optedIn = authorityFor(root, [scratch]);
    assert.deepEqual(
      normalizePreviewFileTarget({ absolutePath: path.join(scratch, 'note.txt') }, optedIn),
      { ok: true, cwd: fs.realpathSync.native(scratch), relativePath: 'note.txt' },
    );
    assert.equal(
      normalizePreviewFileTarget({ absolutePath: path.join(scratch, 'note.txt') }, authorityFor(root)).ok,
      false,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('normalizePreviewFileTarget canonicalizes absolute paths through symlinked directories', (t) => {
  const root = makeTempDir('dsh-preview-real-');
  const linkParent = makeTempDir('dsh-preview-link-');
  const linkedRoot = path.join(linkParent, 'workspace');
  try {
    fs.writeFileSync(path.join(root, 'readme.md'), 'linked\n');
    try {
      fs.symlinkSync(root, linkedRoot, process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error) {
      t.skip(`symlink creation is unavailable: ${error.code || error.message}`);
      return;
    }

    const authority = authorityFor(linkedRoot);
    assert.deepEqual(
      normalizePreviewFileTarget({ absolutePath: path.join(linkedRoot, 'readme.md') }, authority),
      { ok: true, cwd: fs.realpathSync.native(root), relativePath: 'readme.md' },
    );
  } finally {
    fs.rmSync(linkParent, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('normalizePreviewFileTarget rejects ambiguous, malformed, and non-file targets', () => {
  const root = makeTempDir('dsh-preview-target-');
  try {
    const authority = authorityFor(root);
    const cases = [
      null,
      {},
      { cwd: root, relativePath: 'a.ts', absolutePath: path.join(root, 'a.ts') },
      { cwd: root },
      { relativePath: 'a.ts' },
      { cwd: '', relativePath: 'a.ts' },
      { cwd: root, relativePath: '' },
      { absolutePath: '' },
      { absolutePath: 'relative.ts' },
      { absolutePath: 'file:///tmp/a.ts' },
      { absolutePath: 'https://example.com/a.ts' },
      { cwd: root, relativePath: 'https://example.com/a.ts' },
    ];
    for (const input of cases) {
      assert.equal(normalizePreviewFileTarget(input, authority).ok, false, JSON.stringify(input));
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('normalizePreviewFileTarget refuses paths outside the authorized roots', () => {
  const root = makeTempDir('dsh-preview-root-');
  const outside = makeTempDir('dsh-preview-outside-');
  try {
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'secret\n');
    const authority = authorityFor(root);
    assert.equal(
      normalizePreviewFileTarget({ absolutePath: path.join(outside, 'secret.txt') }, authority).ok,
      false,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});
