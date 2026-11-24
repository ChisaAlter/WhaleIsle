'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ensureDesktopDshPad, DSH_PAD_RUNTIME_ALIAS } = require('./dsh-pad-desktop');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-pad-mount-'));
  t.after(() => {
    assert.ok(path.resolve(root).startsWith(path.join(os.tmpdir(), 'whale-pad-mount-')));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const sourceDir = path.join(root, 'vendor', 'dsh-pad');
  const profileDir = path.join(root, 'home', 'profiles', 'web');
  fs.mkdirSync(path.join(sourceDir, 'lib'), { recursive: true });
  fs.mkdirSync(profileDir, { recursive: true });
  fs.writeFileSync(path.join(sourceDir, 'package.json'), JSON.stringify({ name: 'dsh-pad', type: 'module',
    exports: { '.': './lib/index.js', './client': './lib/client.js' } }));
  fs.writeFileSync(path.join(sourceDir, 'lib', 'index.js'), 'export function apply() {}\n');
  fs.writeFileSync(path.join(sourceDir, 'lib', 'client.js'), 'export function apply() {}\n');
  fs.writeFileSync(path.join(sourceDir, 'cordis.patch.yml'), '- insert:\n    - id: dsh-pad\n      name: dsh-pad\n');
  return { root, sourceDir, profileDir };
}

test('pad mount is persistent, uses the shipped runtime, and preserves user patch and panel data', t => {
  const { root, sourceDir, profileDir } = fixture(t);
  const userPatch = '# user preferences\n- id: custom\n  disabled: true\n';
  fs.writeFileSync(path.join(profileDir, 'cordis.patch.yml'), userPatch);
  const data = path.join(root, 'home', 'dsh-pad', 'panels.json');
  fs.mkdirSync(path.dirname(data), { recursive: true });
  fs.writeFileSync(data, '{"panels":[{"id":"existing"}]}');
  const first = ensureDesktopDshPad({ sourceDir, profileDir });
  assert.equal(first.ok, true);
  assert.equal(first.added, true);
  assert.equal(fs.realpathSync(path.join(profileDir, 'node_modules', DSH_PAD_RUNTIME_ALIAS)), fs.realpathSync(sourceDir));
  assert.equal(fs.existsSync(path.join(sourceDir, 'node_modules')), false);
  const overlay = fs.readFileSync(first.overlayFile, 'utf8');
  assert.equal(overlay.split('- id: dsh-pad').length - 1, 1);
  assert.ok(overlay.includes(JSON.stringify(require('node:url').pathToFileURL(path.join(sourceDir, 'lib', 'index.js')).href)));
  assert.match(overlay, /updateCheck: false/);
  assert.doesNotMatch(overlay, /autoApprove/);
  const before = fs.statSync(first.overlayFile).mtimeMs;
  assert.equal(ensureDesktopDshPad({ sourceDir, profileDir }).added, false);
  assert.equal(fs.statSync(first.overlayFile).mtimeMs, before);
  assert.equal(fs.readFileSync(path.join(profileDir, 'cordis.patch.yml'), 'utf8'), userPatch);
  assert.equal(fs.readFileSync(data, 'utf8'), '{"panels":[{"id":"existing"}]}');
});

test('missing host or client bundles and invalid package identity prevent default mount', t => {
  for (const name of ['lib/index.js', 'lib/client.js', 'cordis.patch.yml']) {
    const { sourceDir, profileDir } = fixture(t);
    fs.unlinkSync(path.join(sourceDir, name));
    const result = ensureDesktopDshPad({ sourceDir, profileDir });
    assert.equal(result.ok, false);
    assert.ok(result.error.includes(name));
    assert.equal(fs.existsSync(path.join(profileDir, 'desktop-plugins')), false);
  }
  const { sourceDir, profileDir } = fixture(t);
  fs.writeFileSync(path.join(sourceDir, 'package.json'), '{"name":"unrelated"}');
  assert.match(ensureDesktopDshPad({ sourceDir, profileDir }).error, /package.json:name/);
});

test('existing user bundle and custom configuration are untouched while recovery uses a separate runtime', t => {
  const { root, sourceDir, profileDir } = fixture(t);
  const profileFile = path.join(profileDir, 'package.json');
  const profile = JSON.stringify({ dependencies: { 'dsh-pad': 'link:/user/pad' },
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', 'dsh-pad'] } } });
  const patch = '- id: dsh-pad\n  config:\n    dataFile: /user/custom-panels.json\n    agentRefresh: false\n    minIntervalSec: 30\n';
  fs.writeFileSync(profileFile, profile);
  fs.writeFileSync(path.join(profileDir, 'cordis.patch.yml'), patch);
  const target = path.join(profileDir, 'node_modules', 'dsh-pad');
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, 'sentinel.txt'), 'user installation');
  const normal = ensureDesktopDshPad({ sourceDir, profileDir });
  assert.equal(normal.userProvided, true);
  assert.equal(normal.overlayFile, undefined);
  const recovery = ensureDesktopDshPad({ sourceDir, profileDir, skipUserPlugins: true });
  assert.equal(recovery.ok, true);
  assert.ok(recovery.overlayFile);
  assert.equal(fs.readFileSync(profileFile, 'utf8'), profile);
  assert.equal(fs.readFileSync(path.join(profileDir, 'cordis.patch.yml'), 'utf8'), patch);
  assert.equal(fs.readFileSync(path.join(target, 'sentinel.txt'), 'utf8'), 'user installation');
  const localSource = path.join(root, 'local-source'); fs.mkdirSync(localSource);
  fs.unlinkSync(path.join(target, 'sentinel.txt')); fs.rmdirSync(target);
  fs.symlinkSync(localSource, target, process.platform === 'win32' ? 'junction' : 'dir');
  ensureDesktopDshPad({ sourceDir, profileDir, skipUserPlugins: true });
  assert.equal(fs.realpathSync(target), fs.realpathSync(localSource));
});

test('explicit user disable prevents re-enabling the default pad', t => {
  const { sourceDir, profileDir } = fixture(t);
  assert.equal(ensureDesktopDshPad({ sourceDir, profileDir, disabledPlugins: ['dsh-pad'] }).disabled, true);
  fs.writeFileSync(path.join(profileDir, 'package.json'), JSON.stringify({ dependencies: { 'dsh-pad': '1.0.0' }, dsh: { profile: { bundles: [] } } }));
  assert.equal(ensureDesktopDshPad({ sourceDir, profileDir }).disabled, true);
  assert.equal(fs.existsSync(path.join(profileDir, 'desktop-plugins')), false);
});

test('vendored pad runtime and license are included in desktop resources', () => {
  const root = path.join(__dirname, '..', '..');
  const sourceDir = path.join(root, 'vendor', 'dsh-pad');
  const manifest = JSON.parse(fs.readFileSync(path.join(sourceDir, 'package.json'), 'utf8'));
  assert.equal(manifest.version, '0.3.1');
  assert.ok(manifest.peerDependencies['@deepseek-ai/dsh-tools']);
  assert.ok(manifest.peerDependencies['@deepseek-ai/dsh-llm']);
  assert.equal(fs.existsSync(path.join(sourceDir, 'LICENSE')), true);
  const { assertVendoredPluginRuntimeDeps } = require('../../scripts/after-pack');
  assert.doesNotThrow(() => assertVendoredPluginRuntimeDeps(root, 'dsh-pad'));
  const desktop = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.ok(desktop.build.extraResources.find(resource => resource.from === 'vendor').filter.includes('dsh-pad/**'));
});

test('Audit regression [P2]: dsh-pad HTTP source with {{env:...}} interpolation uses redirect: manual to prevent credential leakage', async (t) => {
  const http = require('node:http');
  const { registerHooks } = require('node:module');
  const { pathToFileURL } = require('node:url');
  const { resolveHarnessPeerPath } = require('../../scripts/lib/harness-peer-hook.cjs');
  const { storeInternalSecrets, INTERNAL_SECRETS_KEY } = require('../shared/secret');

  const hook = registerHooks({
    resolve(specifier, context, nextResolve) {
      if ((context.parentURL || '').includes('/vendor/dsh-pad/') && specifier.startsWith('@deepseek-ai/')) {
        const target = resolveHarnessPeerPath(specifier);
        if (target) return { url: pathToFileURL(target).href, shortCircuit: true };
      }
      return nextResolve(specifier, context);
    },
  });

  const padPath = path.resolve(__dirname, '../../vendor/dsh-pad/lib/index.js');
  const { registerTools } = await import(pathToFileURL(padPath).href);

  const prevUrl = process.env.DSH_DESKTOP_INSTALL_URL;
  const prevSecret = process.env.PAD_TEST_SECRET;
  const prevSecretsStore = globalThis[INTERNAL_SECRETS_KEY];

  let leakedRequests = 0;
  const targetServer = http.createServer((req, res) => {
    if (req.url?.startsWith('/start')) {
      res.writeHead(302, { location: '/leaked' });
      res.end();
      return;
    }
    if (req.url?.startsWith('/leaked')) {
      leakedRequests += 1;
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('leaked-ok');
      return;
    }
    res.writeHead(404);
    res.end();
  });
  const confirmServer = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  });

  await new Promise((r) => targetServer.listen(0, '127.0.0.1', r));
  await new Promise((r) => confirmServer.listen(0, '127.0.0.1', r));

  t.after(async () => {
    hook.deregister();
    await new Promise((r) => targetServer.close(r));
    await new Promise((r) => confirmServer.close(r));
    if (prevUrl === undefined) delete process.env.DSH_DESKTOP_INSTALL_URL; else process.env.DSH_DESKTOP_INSTALL_URL = prevUrl;
    if (prevSecret === undefined) delete process.env.PAD_TEST_SECRET; else process.env.PAD_TEST_SECRET = prevSecret;
    if (prevSecretsStore === undefined) delete globalThis[INTERNAL_SECRETS_KEY]; else globalThis[INTERNAL_SECRETS_KEY] = prevSecretsStore;
  });

  process.env.DSH_DESKTOP_INSTALL_URL = `http://127.0.0.1:${confirmServer.address().port}`;
  process.env.PAD_TEST_SECRET = 'super-secret-value';
  storeInternalSecrets([['DSH_DESKTOP_INSTALL_TOKEN', 'pad-confirm-token']]);

  const tools = new Map();
  const mockCtx = {
    effect(fn) { fn(); },
    tools: { register(def) { tools.set(def.name, def); return () => tools.delete(def.name); } },
  };
  registerTools({
    ctx: mockCtx,
    store: { list: () => [] },
    hub: {},
    refresher: null,
    limits: { minIntervalSec: 5, minAgentMinutes: 5 },
    autoApprove: true,
    resolveSecret: async (name) => process.env[name],
  });

  const testSourceTool = tools.get('pad_test_source');
  assert.ok(testSourceTool);
  const baseUrl = `http://127.0.0.1:${targetServer.address().port}`;
  const resWithSecret = await testSourceTool.execute({
    source: {
      id: 's1',
      kind: 'http',
      url: `${baseUrl}/start`,
      headers: { authorization: 'Bearer {{env:PAD_TEST_SECRET}}' },
      parse: 'text',
      intervalSec: 10,
      timeoutMs: 5000,
    },
  }, { signal: new AbortController().signal });
  assert.match(resWithSecret, /HTTP 302/);
  assert.equal(leakedRequests, 0, 'HTTP source with {{env:...}} must NOT follow 3xx redirects');
});
