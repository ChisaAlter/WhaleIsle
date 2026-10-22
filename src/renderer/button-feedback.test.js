'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createRequire } = require('node:module');

const root = path.resolve(__dirname, '../..');
const electron = [process.env.ELECTRON_PATH, path.join(root, 'node_modules/electron/dist/electron.exe'), path.join(root, 'node_modules/electron/dist/electron')].find(file => file && fs.existsSync(file));

test('real Electron: shared and IM button feedback scrolls complete labels without moving controls', { skip: !electron }, async t => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'button-feedback-'));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const primitives = path.join(root, 'vendor/deepseek-harness/packages/client/ui-primitives');
  const dependencies = createRequire(path.join(primitives, 'package.json'));
  await require('esbuild').build({
    entryPoints: [path.join(__dirname, 'button-feedback.fixture.tsx')],
    bundle: true, outfile: path.join(temporary, 'fixture.js'), platform: 'browser', format: 'iife', jsx: 'automatic',
    alias: {
      'react': path.dirname(dependencies.resolve('react/package.json')),
      'react-dom': path.dirname(dependencies.resolve('react-dom/package.json')),
      '@deepseek-ai/dsh-client-ui-primitives': path.join(primitives, 'src/index.ts'),
    },
    define: { 'process.env.NODE_ENV': '"production"' },
    loader: { '.woff2': 'file', '.woff': 'file', '.ttf': 'file' },
  });
  fs.writeFileSync(path.join(temporary, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="fixture.css"></head><body style="margin:0;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)"><div id="root"></div><script src="fixture.js"></script></body></html>');
  const result = await new Promise((resolve, reject) => {
    const child = spawn(electron, [path.join(__dirname, 'button-feedback.child.cjs'), temporary], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '', errors = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { errors += chunk; });
    const timer = setTimeout(() => { child.kill(); reject(new Error(`button browser fixture timed out: ${errors}\n${output}`)); }, 30000);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => {
      clearTimeout(timer);
      const record = output.split(/\r?\n/).find(line => line.startsWith('BUTTON_RESULT:'));
      if (code !== 0 || !record) return reject(new Error(`button fixture ${code}: ${errors}\n${output}`));
      resolve(JSON.parse(record.slice('BUTTON_RESULT:'.length)));
    });
  });
  assert.deepEqual(result.errors, []);
  for (const theme of result.themes) {
    for (const id of ['short', 'english', 'im', 'compact']) {
      const item = theme.busy[id];
      assert.equal(item.display, 'scrolling-label', `${id} in ${theme.theme}`);
      assert.equal(item.hidden, false);
      assert.equal(item.busy, 'true');
      assert.equal(item.disabled, true);
      assert.ok(item.distance > 0);
      assert.match(item.animation, /button-feedback-scroll$/);
      assert.equal(item.geometry.width, theme.before[id].geometry.width);
      assert.equal(item.geometry.height, theme.before[id].geometry.height);
      assert.equal(item.geometry.left, theme.before[id].geometry.left);
      assert.ok(item.viewportWidth > 1);
      assert.notEqual(item.color, 'rgba(0, 0, 0, 0)');
    }
    assert.equal(theme.busy.wide.display, 'label');
    assert.equal(theme.busy.wide.animation, 'none');
    assert.equal(theme.busy.compound.label, 'Opening settings');
    assert.equal(theme.busy.compound.hidden, false);
    assert.equal(theme.busy.icon.display, 'indicator');
    assert.equal(theme.busy.icon.label, '');
    for (const edge of theme.edges) {
      assert.ok(edge.start >= -1 && edge.start <= 1, 'the first character reaches the viewport');
      assert.ok(Math.abs(edge.end) <= 1, 'the last character reaches the viewport');
      assert.equal(edge.spinnerMoved, false);
    }
    assert.equal(theme.continuity.sameNode, true);
    assert.equal(theme.continuity.sameAnimation, true);
    assert.ok(theme.continuity.advanced, 'the real animation clock advances');
    assert.equal(theme.reduced.animation, 'none');
    assert.equal(theme.reduced.transform, 'none');
    assert.equal(theme.reduced.ariaLabel, '正在下载组件 42%');
    assert.equal(theme.result.english.display, 'scrolling-label');
    assert.equal(theme.result.english.label, 'Configuration saved');
    assert.equal(theme.result.english.spinner, false);
    assert.equal(theme.result.english.geometry.width, theme.before.english.geometry.width);
    assert.equal(theme.restored.english.display, null);
    assert.equal(theme.restored.english.disabled, false);
    assert.equal(theme.restored.english.text, 'Save');
    const references = theme.imReferences;
    assert.equal(Object.keys(references.before).length, 8, 'All IM sizing contexts are exercised');
    for (const [id, pair] of Object.entries(references.before)) {
      for (const phase of ['before', 'restored']) {
        const current = references[phase][id];
        assert.deepEqual(current.shared.geometry, current.native.geometry, `${id} ${phase} keeps the native button dimensions in ${theme.theme}`);
        assert.deepEqual(current.shared.style, current.native.style, `${id} ${phase} keeps the native button appearance in ${theme.theme}`);
        assert.equal(current.shared.type, current.native.type);
        assert.equal(current.shared.text, current.native.text);
      }
      assert.deepEqual(references.busy[id].shared.geometry, pair.shared.geometry, `${id} does not resize while busy in ${theme.theme}`);
      assert.equal(references.busy[id].shared.busy, 'true');
      assert.equal(references.busy[id].shared.disabled, true);
      assert.equal(references.restored[id].shared.disabled, false);
    }
  }
});
