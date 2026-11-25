const nodeTest = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { readFileSync } = require('node:fs');
const { createRequire } = require('node:module');
const { dirname, join, resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
const {
  gateTests, harnessWorkspace,
} = require('../../scripts/lib/test-prerequisites.cjs');

const root = resolve(__dirname, '../..');
const harness = join(root, 'vendor/deepseek-harness');
// Anchors resolve workspace package entries, so every case needs the built Harness.
const HARNESS = harnessWorkspace();
const test = gateTests(nodeTest, HARNESS);
const cli = createRequire(join(harness, 'apps/cli/package.json'));
const anchors = [];
if (HARNESS.ok) {
  anchors.push(cli, ...['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'].map(name => createRequire(cli.resolve(`${name}/package.json`))));
  anchors.push(createRequire(anchors[1].resolve('@deepseek-ai/dsh-storage-domain/package.json')));
}
function resolveHarness(name) {
  for (const anchor of anchors) {
    try { return anchor.resolve(name); }
    catch (error) { if (!['MODULE_NOT_FOUND', 'ERR_PACKAGE_PATH_NOT_EXPORTED'].includes(error.code)) throw error; }
  }
  throw new Error(`Missing built Harness dependency ${name}`);
}
const moduleOf = name => import(pathToFileURL(resolveHarness(name)).href);
const ssh = {
  id: 'dsh-remote',
  name: pathToFileURL(join(root, 'vendor', 'dsh-remote', 'lib/index.js')).href,
};

test('SSH declares 0.2.3-alpha.2 support while retaining verified earlier runtimes', async () => {
  const { evaluatePluginCompatibility, getDshRuntimeVersion } = await moduleOf('@deepseek-ai/dsh-app-boot');
  assert.equal(getDshRuntimeVersion(), '0.2.3-alpha.2');
  const manifest = JSON.parse(readFileSync(join(root, 'vendor', ssh.id, 'package.json'), 'utf8'));
  assert.equal(evaluatePluginCompatibility(manifest), undefined, 'SSH is admitted without exemptions');
  for (const version of ['0.2.1-alpha.1', '0.2.1-alpha.3', '0.2.1-rc.2', '0.2.1-rc.4', '0.2.2-rc.1', '0.2.2-rc.2']) {
    assert.equal(evaluatePluginCompatibility(manifest, {}, version), undefined, `SSH keeps support for ${version}`);
  }
  for (const version of ['0.2.1-alpha.4', '0.2.1-rc.3', '0.2.1-rc.5', '0.2.1', '0.2.2-rc.3', '0.2.2', '0.2.3-alpha.1', '0.2.3-alpha.3', '0.2.3']) {
    assert.ok(evaluatePluginCompatibility(manifest, {}, version), `SSH does not assume compatibility with ${version}`);
  }
  const old = structuredClone(manifest);
  for (const [peer, range] of Object.entries(old.peerDependencies)) if (peer.startsWith('@deepseek-ai/dsh-')) old.peerDependencies[peer] = range.replace(' || 0.2.3-alpha.2', '');
  assert.ok(evaluatePluginCompatibility(old), 'previous SSH metadata reproduces the 0.2.3-alpha.2 rejection');
});

test('real 0.2.3-alpha.2 profile preflight and Loader expose SSH tools to native Sessions', { timeout: 60000 }, async () => {
  const { boot, loadOverlayPatches, bundlePatchPaths, prepareProfileEntries, PluginPackages, createRuntimeResolution } = await moduleOf('@deepseek-ai/dsh-app-boot');
  const { provideCmdline } = await moduleOf('@deepseek-ai/dsh-cmdline');
  const { ToolCallId } = await moduleOf('@deepseek-ai/dsh-llm');
  const { disposeProfileApplication } = await import(pathToFileURL(join(harness, 'apps/cli/lib/profile-boot.js')).href);
  await fs.mkdir(join(harness, 'apps/cli/.tmp'), { recursive: true });
  const home = await fs.mkdtemp(join(harness, 'apps/cli/.tmp/plugin-rc2-'));
  const directory = join(home, 'files');
  await fs.mkdir(directory);
  await fs.writeFile(join(home, 'cordis.yml'), '[]\n');
  const web = dirname(cli.resolve('@deepseek-ai/dsh-web-app/package.json'));
  const webManifest = JSON.parse(readFileSync(join(web, 'package.json'), 'utf8'));
  const profileContext = { name: 'plugin-rc2', dir: home, patchPath: join(home, 'cordis.patch.yml'), installAnchor: join(home, 'package.json'), cwd: directory, home, startedBundles: [], overlayPaths: [], telemetryDisabledEnv: '1' };
  const patches = [
    ...loadOverlayPatches('plugin-rc2', join(harness, 'packages/bundle/base/cordis.patch.yml')),
    ...bundlePatchPaths(web, webManifest.dsh.bundle).flatMap(file => loadOverlayPatches('plugin-rc2', file)),
    { id: 'storage-json', config: { root: join(home, 'storages') } },
    { id: 'session-persistence-jsonl', config: { root: join(home, 'sessions') } },
    { id: 'mcp-servers-file', config: { path: join(home, 'mcp-servers.yaml'), watch: false } },
    { id: 'spill-local', config: { root: join(home, 'spill'), cleanupPeriodDays: 0 } },
    { id: 'agent-default-model', config: { provider: 'no-network', model: 'no-calls' } },
    { id: 'agent-preset-registry', config: { default: 'standard' } },
    ...['harness-dev-context', 'webserver', 'hmr', 'web-runtime', 'session-telemetry-otel', 'modules', 'connection', 'session-log-download', 'open-in-app', 'client-hmr', 'directory-picker'].map(id => ({ id, disabled: true })),
    { insert: [ssh] },
  ];
  const previous = Object.fromEntries(['DSH_HOME', 'DSHD_HOME', 'DSH_TELEMETRY_DISABLED'].map(key => [key, process.env[key]]));
  Object.assign(process.env, { DSH_HOME: home, DSHD_HOME: home, DSH_TELEMETRY_DISABLED: '1' });
  let ctx;
  try {
    const resolution = await createRuntimeResolution({ installAnchor: join(harness, 'apps/cli/package.json'), home });
    ctx = await boot('plugin-rc2', join(home, 'cordis.yml'), patches, async ctx => {
      await ctx.plugin(PluginPackages, { resolution });
      ctx.provide('profileContext', profileContext);
      const [admitted] = prepareProfileEntries(ctx, [ssh], pathToFileURL(`${home}/`).href);
      assert.notEqual(admitted.disabled, true, 'SSH passes native profile preflight');
      ctx.provide('connection', { fetch: { register: () => () => {} }, rpc: { intercept: () => () => {} } });
      provideCmdline(ctx, { args: [], exit: () => {} });
      ctx.loader.internal = { version: 'v2', async import(name) { return name.startsWith('file:') ? import(name) : import(pathToFileURL(resolveHarness(name)).href); } };
    });
    const entry = [...ctx.loader.entries()].find(row => row.options.id === ssh.id);
    assert.ok(entry?.fiber, 'SSH must import and activate before checking its tools');
    assert.equal(entry.fiber.state, 2, 'SSH must be active');
    const created = await ctx.sessionController.create({ requestId: 'rc2-native-create', cwd: directory });
    const first = ctx.agents.get(created.sessionId);
    assert.ok(first, 'Session creation publishes an actual live Agent');
    const names = ctx.tools.schemas(first).map(tool => tool.name);
    assert.equal(names.filter(name => name.startsWith('rw_')).length, 20);
    assert.ok(ctx.commands.list(first).some(command => command.name === 'remote'));
    let calls = 0;
    const call = async (agent, name, args) => (await ctx.tools.execute({
      calls: [{ type: 'tool-call', id: ToolCallId(`rc2-${++calls}`), name, arguments: JSON.stringify(args) }],
      agent,
      signal: new AbortController().signal,
    })).results[0].result;
    const info = await call(first, 'rw_info', {});
    assert.equal(info.isError, false, JSON.stringify(info));
    assert.match(info.value.text, /this session is LOCAL/);
    const denied = await call(first, 'rw_read_file', { path: '/must-not-connect' });
    assert.equal(denied.isError, true, 'a local Session cannot silently use an active SSH target');
  } finally {
    await disposeProfileApplication(ctx);
    for (const [key, value] of Object.entries(previous)) value === undefined ? delete process.env[key] : process.env[key] = value;
    await fs.rm(home, { recursive: true, force: true });
  }
});
