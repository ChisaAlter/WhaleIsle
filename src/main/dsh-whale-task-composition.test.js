'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createRequire } = require('node:module');
const { tmpdir } = require('node:os');
const { pathToFileURL } = require('node:url');
const root = path.resolve('.');
const harness = path.join(root, 'vendor/deepseek-harness');
const cli = createRequire(path.join(harness, 'apps/cli/package.json'));
const anchors = [cli, createRequire(cli.resolve('@deepseek-ai/dsh-base/package.json')), createRequire(cli.resolve('@deepseek-ai/dsh-web-app/package.json'))];
const resolve = name => { for (const anchor of anchors) try { return anchor.resolve(name); } catch {} throw new Error(name); };
const load = name => import(pathToFileURL(resolve(name)).href);
const call = (id, name, args) => [{ type: 'block-start', index: 0, blockType: 'tool-call' }, { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: JSON.stringify(args) }, { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: JSON.stringify(args) } }, { type: 'finish', reason: { kind: 'tool-calls' } }];

test('real Loader, storage, native Agent and tools finish a source-bound task without external I/O', async t => {
  const { boot, loadOverlayPatches, bundlePatchPaths } = await load('@deepseek-ai/dsh-app-boot');
  const { LlmAdapter } = await load('@deepseek-ai/dsh-llm');
  const { provideCmdline } = await load('@deepseek-ai/dsh-cmdline');
  const Whale = await import(pathToFileURL(path.join(root, 'vendor/dsh-whale/lib/index.js')).href);
  // Keep fixture paths canonical on Windows, where tmpdir() may use an 8.3
  // alias while the product resolves inputs through fs.realpath().
  const tempRoot = await fs.realpath(tmpdir());
  const home = await fs.mkdtemp(path.join(tempRoot, 'whale-task-composition-'));
  const prior = process.env.DSH_HOME; process.env.DSH_HOME = home;
  let ctx;
  t.after(async () => { await ctx?.get('whaleTasks')?.close(); await ctx?.fiber.dispose(); process.env.DSH_HOME = prior;
    assert.ok(home.startsWith(path.join(tempRoot, 'whale-task-composition-'))); await fs.rm(home, { recursive: true, force: true }); });
  const config = path.join(home, 'cordis.yml'); await fs.writeFile(config, '[]\n');
  const web = path.dirname(cli.resolve('@deepseek-ai/dsh-web-app/package.json'));
  const manifest = JSON.parse(await fs.readFile(path.join(web, 'package.json'), 'utf8'));
  const patches = [...loadOverlayPatches('whale-task-test', path.join(harness, 'packages/bundle/base/cordis.patch.yml')),
    ...bundlePatchPaths(web, manifest.dsh.bundle).flatMap(file => loadOverlayPatches('whale-task-test', file)),
    { id: 'storage-json', config: { root: path.join(home, 'storages') } }, { id: 'session-persistence-jsonl', config: { root: path.join(home, 'sessions') } },
    { id: 'mcp-servers-file', config: { path: path.join(home, 'mcp.yaml'), watch: false } },
    { id: 'agent-default-model', config: { provider: 'scripted', model: 'reader' } },
    ...['webserver', 'hmr', 'web-runtime', 'session-telemetry-otel', 'modules', 'connection', 'session-log-download', 'open-in-app', 'client-hmr', 'directory-picker'].map(id => ({ id, disabled: true })),
    { insert: [{ id: 'directory-picker-test', name: '@deepseek-ai/dsh-host-directory-picker-browse' }] }];
  ctx = await boot('whale-task-test', config, patches, context => {
    provideCmdline(context, { args: [], exit() {} });
    context.provide('connection', { fetch: { register: () => () => {} }, rpc: { intercept: () => () => {} } });
    context.loader.internal = { version: 'v2', import: name => name.startsWith('file:') ? import(name) : load(name) };
  });
  const requests = [];
  class Model extends LlmAdapter {
    stages = new Map();
    async resolveModel(provider, model) { return { provider, id: model, name: model }; }
    async *stream(options) {
      requests.push(options);
      const task = options.tools.some(tool => tool.name === 'task_report');
      assert.equal(task, true, 'only a background reader is driven');
      assert.deepEqual(options.tools.map(tool => tool.name).sort(), ['task_read_input', 'task_report', 'task_search_inputs']);
      assert.equal(JSON.stringify(options).includes('B_PRIVATE_MEMORY'), false);
      const first = options.messages.find(message => message.source?.kind === 'dsh-whale:task');
      const key = first.id; const stage = this.stages.get(key) ?? 0; this.stages.set(key, stage + 1);
      if (!stage) yield* call('denied-input', 'task_read_input', { inputId: 'input-unapproved' });
      else if (stage === 1) yield* call('denied-shell', 'pwsh', { command: 'throw "must never run"' });
      else if (stage === 2) yield* call('read-input', 'task_read_input', { inputId: 'input-1' });
      else yield* call('submit-result', 'task_report', { summary: 'Verified input A says hello.', evidence: ['input-1'], coveredCriteria: ['给出有来源引用的资料摘要'], unmet: [], outcome: 'completed' });
    }
  }
  ctx.llm.registerAdapter(['scripted'], new Model());
  const TaskControl = await import(pathToFileURL(path.join(root, 'vendor/dsh-task-control/lib/index.js')).href);
  await ctx.plugin(TaskControl);
  const resident = await ctx.sessionController.create({ sessionId: 'resident', cwd: home, agentPreset: 'standard' });
  const liveResident = ctx.agents.get(resident.sessionId);
  liveResident.session.append('user/message', { id: 'private-B', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'B_PRIVATE_MEMORY' }] }, { surfaceOp: 'append' });
  await fs.mkdir(path.join(home, 'data/whale'), { recursive: true });
  await fs.writeFile(path.join(home, 'data/whale/settings.json'), JSON.stringify({ sessionId: resident.sessionId, imDefault: true }));
  const routes = [];
  ctx.provide('webServer', { register(route) { routes.push(route); return () => {}; } });
  ctx.loader.internal = { version: 'v2', import: name => name === 'dsh-whale/tools'
    ? import(pathToFileURL(path.join(root, 'vendor/dsh-whale/lib/tools.js')).href)
    : name.startsWith('file:') ? import(name) : load(name) };
  await ctx.plugin(Whale);
  const started = Date.now();
  while (!ctx.get('whaleTasks')?.available) {
    if (Date.now() - started > 10000) throw new Error(ctx.get('whaleTasks')?.error || 'Task host did not activate');
    await new Promise(done => setTimeout(done, 10));
  }
  const service = ctx.get('whaleTasks'); assert.ok(service?.available);
  assert.ok(routes.some(route => route.path === '/dsh-whale'));
  const file = path.join(path.dirname(home), `${path.basename(home)}-input.txt`); await fs.writeFile(file, 'hello from input A');
  t.after(() => fs.unlink(file));
  const origin = { eventId: 'explicit-source', sessionId: 'resident', messageId: 'human-1', rpcId: '', kind: 'desktop', actor: 'desktop-owner', files: [], text: `/task ${JSON.stringify({ goal: 'Summarize A', files: [file] })}` };
  await service.recordInbound(origin, origin.text);
  const task = await service.accept(origin); await service.run(task.id);
  const final = service.store.get(task.id);
  assert.equal(final.state, 'completed', JSON.stringify({ error: final.error, execution: final.execution, requests: requests.map(r => ({ tools: r.tools.map(t => t.name), messages: r.messages.filter(m => m.role === 'tool') })) }));
  assert.equal(final.result.summary, 'Verified input A says hello.');
  assert.equal(final.effects[0].state, 'sent', final.effects[0].error);
  assert.equal(requests.length, 4);
  const toolResults = requests.flatMap(request => request.messages.filter(message => message.role === 'tool'));
  assert.ok(toolResults.some(message => JSON.stringify(message).includes('资料未获授权')));
  assert.ok(toolResults.some(message => message.toolCallId === 'denied-shell' && message.isError && JSON.stringify(message).includes('不允许这个工具')));
  assert.equal(final.effects[0].content.includes('B_PRIVATE_MEMORY'), false);
  const historical = await ctx.sessionController.resolveAgent(final.execution.sessionId); assert.ok(historical.agent);
  historical.agent.followup({ id: 'unapproved-restart', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'Resume outside the task service' }] });
  await historical.agent.whenIdle(); assert.equal(requests.length, 4, 'opening an old task cannot drive a new model request');
  const saved = await fs.readFile(path.join(home, 'storages/whale_tasks.json'), 'utf8'); assert.match(saved, /Verified input A/);
});
