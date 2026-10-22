'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const whaleModule = pathToFileURL(path.join(__dirname, '..', '..', 'vendor', 'dsh-whale', 'lib', 'index.js')).href;
const scopeModule = pathToFileURL(path.join(__dirname, '..', '..', 'vendor', 'dsh-whale', 'lib', 'scope.js')).href;
const presetModule = pathToFileURL(path.join(__dirname, '..', '..', 'vendor', 'dsh-whale', 'lib', 'preset.js')).href;

test('whale preset is an explicit current-Harness definition', async () => {
  const { whalePresetDefinition } = await import(presetModule);
  const preset = whalePresetDefinition('C:/test/dsh-home');
  assert.equal(preset.id, 'whale-girl');
  assert.ok(preset.plugins.some(row => row.name === 'dsh-whale/tools'));
  assert.ok(preset.plugins.some(row => row.id === 'skill-filesystem'
    && row.config.customSkillDirs[0].includes('data')));
});

test('whale settings persist despite desktop plugin overlay and reject stale writes', async (t) => {
  const { Config } = await import(whaleModule);
  const { createWhaleScope } = await import(scopeModule);
  for (const field of Object.values(Config.dict)) {
    assert.equal(field.meta.volatile, true);
  }
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-whale-scope-'));
  t.after(() => {
    assert.ok(path.resolve(home).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(home, { recursive: true, force: true });
  });
  fs.writeFileSync(path.join(home, 'settings.yaml.imported'), 'dsh-whale:\n  name: 小鲸\n  sessionId: session-old\n');
  const scope = createWhaleScope(home);
  const before = scope.get();
  assert.equal(before.name, '小鲸');
  assert.equal(before.sessionId, '', 'legacy session remains on disk but is not reopened');
  await scope.set({ ...before, sessionId: 'session-new' }, before);
  assert.equal(createWhaleScope(home).get().sessionId, 'session-new');
  await assert.rejects(() => scope.set({ ...before, name: 'stale' }, before), /changed during update/);
  assert.equal(scope.get().name, '小鲸');
});

test('enabled whale host registers its RPC route on its own fiber', async (t) => {
  const { apply, inject } = await import(whaleModule);
  assert.ok(inject.includes('connection'));
  assert.ok(inject.includes('webServer'));

  const routes = [];
  const effects = [];
  const presets = [];
  const disposers = [];
  t.after(() => { for (const dispose of disposers.reverse()) dispose(); });
  const ctx = {
    on: () => () => {},
    settings: { describe: () => [] },
    systemPrompt: { section() {} },
    connection: { requestRejection: () => 401 },
    webServer: { register: (route) => { routes.push(route); return () => {}; } },
    agentPresets: { register: async (definition) => { presets.push(definition); return async () => {}; } },
    sessionController: {},
    inject: (_deps, start) => { start(ctx); },
    effect: (start) => {
      effects.push(Promise.resolve(start()).then(dispose => {
        if (typeof dispose === 'function') disposers.push(dispose);
      }));
    },
  };
  apply(ctx);
  await Promise.all(effects);
  assert.equal(presets[0]?.id, 'whale-girl');
  const route = routes.find((entry) => entry.kind === 'prefix' && entry.path === '/dsh-whale');
  assert.ok(route, 'assistant/ensure must not fall through to the static 405 handler');

  const response = {
    status: 0,
    body: '',
    writeHead(status) { this.status = status; },
    end(body) { this.body = body; },
  };
  await route.handler({ method: 'POST', url: '/dsh-whale/assistant/ensure' }, response);
  assert.equal(response.status, 401, 'the named route handles the request before authentication');
});
