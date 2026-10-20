const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { readFileSync } = require('node:fs');
const { createRequire } = require('node:module');
const { dirname, join, resolve } = require('node:path');
const { pathToFileURL } = require('node:url');

const root = resolve(__dirname, '../..');
const harness = join(root, 'vendor/deepseek-harness');
const cli = createRequire(join(harness, 'apps/cli/package.json'));
const anchors = [cli, ...['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'].map(name => createRequire(cli.resolve(`${name}/package.json`)))];
anchors.push(createRequire(anchors[1].resolve('@deepseek-ai/dsh-storage-domain/package.json')));
function resolveHarness(name) {
  for (const anchor of anchors) {
    try { return anchor.resolve(name); }
    catch (error) { if (!['MODULE_NOT_FOUND', 'ERR_PACKAGE_PATH_NOT_EXPORTED'].includes(error.code)) throw error; }
  }
  throw new Error(`Missing built Harness dependency ${name}`);
}
const moduleOf = name => import(pathToFileURL(resolveHarness(name)).href);
const plugins = ['dsh-remote', 'dsh-with-chatgpt'].map(name => ({
  name,
  manifest: JSON.parse(readFileSync(join(root, 'vendor', name, 'package.json'), 'utf8')),
  entry: pathToFileURL(join(root, 'vendor', name, 'lib/index.js')).href,
}));

test('SSH and ChatGPT declare rc.2 support while retaining verified earlier runtimes', async () => {
  const { evaluatePluginCompatibility, getDshRuntimeVersion } = await moduleOf('@deepseek-ai/dsh-app-boot');
  assert.equal(getDshRuntimeVersion(), '0.2.1-rc.2');
  for (const { name, manifest } of plugins) {
    assert.equal(evaluatePluginCompatibility(manifest), undefined, `${name} is admitted without exemptions`);
    for (const version of ['0.2.1-alpha.1', '0.2.1-alpha.3']) {
      assert.equal(evaluatePluginCompatibility(manifest, {}, version), undefined, `${name} keeps support for ${version}`);
    }
    for (const version of ['0.2.1-alpha.4', '0.2.1-rc.3', '0.2.1']) {
      assert.ok(evaluatePluginCompatibility(manifest, {}, version), `${name} does not assume compatibility with ${version}`);
    }
    const old = structuredClone(manifest);
    for (const [peer, range] of Object.entries(old.peerDependencies)) if (peer.startsWith('@deepseek-ai/dsh-')) old.peerDependencies[peer] = range.replace(' || 0.2.1-rc.2', '');
    assert.ok(evaluatePluginCompatibility(old), `${name}'s previous metadata reproduces the rc.2 rejection`);
  }
});

test('real rc.2 profile preflight and Loader expose SSH tools and the optional ChatGPT skill to native Sessions', { timeout: 60000 }, async () => {
  const { boot, loadOverlayPatches, bundlePatchPaths, prepareProfileEntries } = await moduleOf('@deepseek-ai/dsh-app-boot');
  const { provideCmdline } = await moduleOf('@deepseek-ai/dsh-cmdline');
  const { ToolCallId } = await moduleOf('@deepseek-ai/dsh-llm');
  const { disposeProfileApplication } = await import(pathToFileURL(join(harness, 'apps/cli/lib/profile-boot.js')).href);
  await fs.mkdir(join(root, '.tmp'), { recursive: true });
  const home = await fs.mkdtemp(join(root, '.tmp/plugin-rc2-'));
  const directory = join(home, 'files');
  await fs.mkdir(directory);
  await fs.writeFile(join(home, 'cordis.yml'), '[]\n');
  const web = dirname(cli.resolve('@deepseek-ai/dsh-web-app/package.json'));
  const webManifest = JSON.parse(readFileSync(join(web, 'package.json'), 'utf8'));
  const profileContext = { name: 'plugin-rc2', dir: home, patchPath: join(home, 'cordis.patch.yml'), installAnchor: join(home, 'package.json'), cwd: directory, home, startedBundles: [], overlays: [], telemetryDisabledEnv: '1' };
  const patches = [
    ...loadOverlayPatches('plugin-rc2', join(harness, 'packages/bundle/base/cordis.patch.yml')),
    ...bundlePatchPaths(web, webManifest.dsh.bundle).flatMap(file => loadOverlayPatches('plugin-rc2', file)),
    { id: 'storage-json', config: { root: join(home, 'storages') } },
    { id: 'session-persistence-jsonl', config: { root: join(home, 'sessions') } },
    { id: 'mcp-servers-file', config: { path: join(home, 'mcp-servers.yaml'), watch: false } },
    { id: 'agent-default-model', config: { provider: 'no-network', model: 'no-calls' } },
    { id: 'agent-preset-registry', config: { default: 'standard' } },
    ...['plugin-manager', 'harness-dev-context', 'webserver', 'hmr', 'web-runtime', 'session-telemetry-otel', 'modules', 'connection', 'session-log-download', 'open-in-app', 'client-hmr', 'directory-picker'].map(id => ({ id, disabled: true })),
    { insert: plugins.map(({ name, entry }) => ({ id: name, name: entry, ...(name === 'dsh-with-chatgpt' ? { config: { stateDir: join(home, 'chatgpt'), headless: true } } : {}) })) },
  ];
  const previous = Object.fromEntries(['DSH_HOME', 'DSHD_HOME', 'DSH_TELEMETRY_DISABLED'].map(key => [key, process.env[key]]));
  Object.assign(process.env, { DSH_HOME: home, DSHD_HOME: home, DSH_TELEMETRY_DISABLED: '1' });
  let ctx;
  try {
    ctx = await boot('plugin-rc2', join(home, 'cordis.yml'), patches, ctx => {
      ctx.provide('profileContext', profileContext);
      const admitted = prepareProfileEntries(ctx, plugins.map(({ name, entry }) => ({ id: name, name: entry })), pathToFileURL(`${home}/`).href);
      assert.ok(admitted.every(row => row.disabled !== true), 'neither actual package is disabled by native profile preflight');
      ctx.provide('connection', { fetch: { register: () => () => {} }, rpc: { intercept: () => () => {} } });
      provideCmdline(ctx, { args: [], exit: () => {} });
      ctx.loader.internal = { version: 'v2', async import(name) { return name.startsWith('file:') ? import(name) : import(pathToFileURL(resolveHarness(name)).href); } };
    });
    for (const { name } of plugins) {
      const entry = [...ctx.loader.entries()].find(row => row.options.id === name);
      assert.ok(entry?.fiber, `${name} must import and activate before checking its tools`);
      assert.equal(entry.fiber.state, 2, `${name} must be active`);
    }
    const created = await ctx.sessionController.create({ requestId: 'rc2-native-create', cwd: directory });
    const first = ctx.agents.get(created.sessionId);
    assert.ok(first, 'Session creation publishes an actual live Agent');
    const names = ctx.tools.schemas(first).map(tool => tool.name);
    assert.equal(names.filter(name => name.startsWith('rw_')).length, 20);
    assert.deepEqual(names.filter(name => name.startsWith('chatgpt_')).sort(), ['chatgpt_browser', 'chatgpt_checkpoint', 'chatgpt_connection', 'chatgpt_record']);
    assert.ok((await ctx.skills.get('dsh-with-chatgpt', { cwd: directory })).content.includes('ChatGPT plans and reviews'));
    assert.ok(ctx.commands.list(first).some(command => command.name === 'remote'));
    let calls = 0;
    const call = (agent, name, args) => ctx.tools.execute({ callId: ToolCallId(`rc2-${++calls}`), agent, name, arguments: args, signal: new AbortController().signal });
    const info = await call(first, 'rw_info', {});
    assert.equal(info.isError, false, JSON.stringify(info));
    assert.match(info.value.text, /this session is LOCAL/);
    const denied = await call(first, 'rw_read_file', { path: '/must-not-connect' });
    assert.equal(denied.isError, true, 'a local Session cannot silently use an active SSH target');
    const saved = await call(first, 'chatgpt_checkpoint', { action: 'set', state: 'EXECUTING', goal: 'Native rc.2 compatibility check' });
    assert.equal(saved.isError, false, JSON.stringify(saved));
    const secondSession = await ctx.sessionController.create({ requestId: 'rc2-second-create', cwd: directory });
    const second = ctx.agents.get(secondSession.sessionId);
    const empty = await call(second, 'chatgpt_checkpoint', { action: 'get' });
    assert.equal(empty.isError, false, JSON.stringify(empty));
    assert.equal(empty.value.data.session, null, 'another native Session cannot borrow the checkpoint');
  } finally {
    await disposeProfileApplication(ctx);
    for (const [key, value] of Object.entries(previous)) value === undefined ? delete process.env[key] : process.env[key] = value;
    await fs.rm(home, { recursive: true, force: true });
  }
});
