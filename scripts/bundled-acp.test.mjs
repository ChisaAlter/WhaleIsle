import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { getFileMatchers, copyFiles } = require('app-builder-lib/out/fileMatcher');
const { ensureDesktopAcpAgents } = require('../src/main/dsh-acp-agents-desktop');
const { missingDeclaredEntries, missingRuntimeFiles } = require('../src/main/plugin-runtime-files');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const build = require('../package.json').build;

test('Electron resource copy ships a self-contained default ACP plugin, not its development tree', async t => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-bundled-acp-'));
  const profileDir = path.join(temporary, 'home', 'profiles', 'web');
  t.after(() => {
    // Unlink the profile junction before reclaiming this test's own directory.
    const link = path.join(profileDir, 'node_modules', 'dsh-acp-agents');
    if (fs.existsSync(link) && fs.lstatSync(link).isSymbolicLink()) fs.unlinkSync(link);
    assert.ok(path.resolve(temporary).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(temporary, { recursive: true, force: true });
  });
  const resources = path.join(temporary, 'resources');
  const matchers = getFileMatchers(build, 'extraResources', resources, {
    macroExpander: pattern => pattern,
    customBuildOptions: {},
    globalOutDir: path.join(root, build.directories.output),
    defaultSrc: root,
  });
  const acp = matchers.filter(matcher => matcher.from === path.join(root, 'dsh-acp'));
  assert.equal(acp.length, 1);
  const filter = acp[0].createFilter();
  for (const relative of ['artifacts/account.json', 'tools/qa-matrix/backup/profile.json',
    'tools/runtime-build/node_modules/effect/index.js', 'tests/agent-fixture.cjs',
    '.git/config', '.env', 'diagnostics/login.log']) {
    assert.equal(filter(path.join(acp[0].from, relative), { isDirectory: () => false }), false, relative);
  }
  const sourceDir = path.join(resources, 'dsh-acp');
  // Repeat the actual builder copy/desktop initialization: one payload and overlay,
  // no per-launch plugin installation or additional runtime directory.
  for (let run = 0; run < 2; run++) {
    await copyFiles(acp, null, false);
    assert.deepEqual(fs.readdirSync(sourceDir).sort(), [
      'LICENSE', 'README.md', 'THIRD_PARTY_NOTICES.md', 'client', 'cordis.patch.yml', 'lib', 'package.json',
    ].sort());
    const manifest = JSON.parse(fs.readFileSync(path.join(sourceDir, 'package.json'), 'utf8'));
    assert.equal(manifest.name, 'dsh-acp-agents');
    assert.equal(manifest.version, require('../dsh-acp/package.json').version);
    assert.deepEqual(missingDeclaredEntries(sourceDir, manifest), []);
    assert.deepEqual(missingRuntimeFiles(sourceDir), []);
    assert.equal(typeof (await import(pathToFileURL(path.join(sourceDir, 'lib/index.js')).href)).apply, 'function');
    assert.ok(fs.statSync(path.join(sourceDir, 'lib/vendor/agent-runtime.cjs')).size > 0);
    const result = ensureDesktopAcpAgents({ sourceDir, profileDir });
    assert.equal(result.ok, true);
    assert.equal(result.added, run === 0);
    assert.equal(fs.realpathSync(path.join(profileDir, 'node_modules/dsh-acp-agents')), fs.realpathSync(sourceDir));
    assert.match(fs.readFileSync(result.overlayFile, 'utf8'), /name: "dsh-acp-agents"/);
  }
  // A partial resource copy must not be mistaken for a loadable bundled plugin.
  fs.unlinkSync(path.join(sourceDir, 'client/client.js'));
  const broken = ensureDesktopAcpAgents({ sourceDir, profileDir });
  assert.equal(broken.ok, false);
  assert.match(broken.error, /missing-source:.*client\/client.js/);
});
