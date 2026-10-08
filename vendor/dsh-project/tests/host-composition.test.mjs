/** Real Loader/Sessions/continuations/tools/storage; only external model and desktop I/O are scripted. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire, registerHooks } from 'node:module';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, readFile, realpath, rm, rename, symlink } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const projectPackage = resolve(dirname(fileURLToPath(import.meta.url)), '..'), harness = resolve(projectPackage, '../deepseek-harness');
const cliRequire = createRequire(join(harness, 'apps/cli/package.json'));
const anchors = [cliRequire, ...['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'].map(name => createRequire(cliRequire.resolve(`${name}/package.json`)))];
anchors.push(createRequire(anchors[1].resolve('@deepseek-ai/dsh-storage-domain/package.json')));
function resolvePackage(name) { for (const anchor of anchors) try { return anchor.resolve(name); } catch (error) { if (!['MODULE_NOT_FOUND', 'ERR_PACKAGE_PATH_NOT_EXPORTED'].includes(error.code)) throw error; } throw new Error(`Missing built Harness dependency ${name}.`); }
const projectUrl = pathToFileURL(`${projectPackage}${sep}`).href;
registerHooks({ resolve(specifier, context, next) { if (context.parentURL?.startsWith(projectUrl) && !specifier.startsWith('.') && !specifier.startsWith('node:') && !specifier.startsWith('file:')) return { url: pathToFileURL(resolvePackage(specifier)).href, shortCircuit: true }; return next(specifier, context); } });
const { boot, loadOverlayPatches, bundlePatchPaths } = await import(pathToFileURL(resolvePackage('@deepseek-ai/dsh-app-boot')).href);
const { LlmAdapter } = await import(pathToFileURL(resolvePackage('@deepseek-ai/dsh-llm')).href);
const { provideCmdline } = await import(pathToFileURL(resolvePackage('@deepseek-ai/dsh-cmdline')).href);
const { disposeProfileApplication } = await import(pathToFileURL(join(harness, 'apps/cli/lib/profile-boot.js')).href);
const { ProjectService } = await import(pathToFileURL(join(projectPackage, 'lib/service.js')).href);
const blocks = value => [{ type: 'block-start', index: 0, blockType: 'text' }, { type: 'text-delta', index: 0, text: value }, { type: 'block-end', index: 0, block: { type: 'text', text: value } }, { type: 'finish', reason: { kind: 'stop' } }];
const call = (id, name, args) => [{ type: 'block-start', index: 0, blockType: 'tool-call' }, { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: JSON.stringify(args) }, { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: JSON.stringify(args) } }, { type: 'finish', reason: { kind: 'tool-calls' } }];
const messageText = message => (message.content ?? []).filter(block => block.type === 'text').map(block => block.text).join('\n');
const signal = new AbortController().signal;
const waitFor = async (read, reason, timeout = 20000) => { const start = Date.now(); while (Date.now() - start < timeout) { const value = await read(); if (value) return value; await new Promise(done => setTimeout(done, 20)); } throw new Error(`Timed out: ${reason}`); };

class ScriptedModel extends LlmAdapter {
  requests = []; failures = []; stages = new Map(); settlementInputs = []; counter = 0; state = () => null;
  coordinatorWaiting = false; coordinatorGate = new Promise(done => { this.releaseCoordinator = done; });
  async resolveModel(provider, model) { return { provider, id: model, name: model }; }
  async *stream(options) {
    this.requests.push(options); const names = options.tools.map(tool => tool.name);
    if (names.includes('project_delegate')) {
      const input = options.messages.findLast(message => message.role === 'user' && ['user', 'subagent-settled'].includes(message.source.kind));
      const key = `coordinator:${input?.id}`, stage = this.stages.get(key) ?? 0; this.stages.set(key, stage + 1);
      const text = input ? messageText(input) : '';
      if (text.includes('PAUSE_OLD_DELEGATE')) {
        if (!stage) yield* call(`notes-${++this.counter}`, 'project_read_store', { path: 'notes.md' });
        else if (stage === 1) { this.coordinatorWaiting = true; await this.coordinatorGate; yield* call(`late-${++this.counter}`, 'project_delegate', { title: 'Stopped old request', brief: 'Must not restart', scope: 'readonly' }); }
        else yield* blocks('The old request is stopped.'); return;
      }
      const pathWork = this.state()?.workstreams.find(item => item.title === 'Path work');
      if (text.includes('MAKE_PATH_HOLD') && stage === 1) { yield* call(`expand-${++this.counter}`, 'project_delegate', { workstreamId: pathWork.id, brief: 'Unauthorized path expansion', scope: 'docs', writePaths: ['docs/first.md', 'docs/second.md'] }); return; }
      if (input?.source.kind === 'subagent-settled') {
        const appendix = input.content.find(block => block.type === 'text' && block.text.startsWith('Project recorded outcome for this native settlement'));
        assert.ok(appendix, 'the real native notice must carry the persisted Project outcome even with no closing prose');
        const facts = JSON.parse(appendix.text.split('\n')[1]); assert.equal(facts.runId, input.source.runId);
        this.settlementInputs.push({ id: input.id, source: input.source, text, facts });
        yield* blocks(`${facts.title}: ${facts.reports.map(report => report.summary).join('; ') || `Worker ended ${facts.stopReason}`}. This is a worker report, not an independent verification.`); return;
      }
      if (text.includes('READ_PENDING')) {
        if (!stage) yield* call(`notes-${++this.counter}`, 'project_read_store', { path: 'notes.md' });
        else yield* blocks('Plan work: the worker outcome is recorded; its evidence is a worker report, not an independent verification.'); return;
      }
      if (stage || text.includes('SHORT_QUESTION')) { yield* blocks('The Project conversation is ready.'); return; }
      const stream = this.state()?.workstreams.find(item => item.title === 'Plan work');
      if (text.includes('MAKE_PATH_HOLD')) yield* call(`delegate-${++this.counter}`, 'project_delegate', { title: 'Path work', brief: 'HOLD_FOR_PATH_CHANGE', scope: 'docs', writePaths: ['docs/first.md'] });
      else if (text.includes('EXTEND_DOC_PATHS')) yield* call(`delegate-${++this.counter}`, 'project_delegate', { workstreamId: pathWork.id, brief: 'WRITE_EXTRA_DOC', scope: 'docs', writePaths: ['docs/first.md', 'docs/second.md'] });
      else if (text.includes('DOCS_CODE_PATH')) yield* call(`delegate-${++this.counter}`, 'project_delegate', { title: 'Invalid docs', brief: 'Change code as docs', scope: 'docs', writePaths: ['src/forbidden.js'] });
      else if (text.includes('MAKE_DOCS')) yield* call(`delegate-${++this.counter}`, 'project_delegate', { title: 'Plan work', brief: 'WRITE_PLAN', scope: 'docs', writePaths: ['docs/plan.md'] });
      else if (text.includes('IMPLEMENT_PLAN')) yield* call(`delegate-${++this.counter}`, 'project_delegate', { workstreamId: stream.id, brief: 'DEVELOP_CONTINUE', scope: 'development' });
      else if (text.includes('HOLD_WORK')) yield* call(`delegate-${++this.counter}`, 'project_delegate', { workstreamId: stream.id, brief: 'HOLD_FOR_STOP', scope: 'development' });
      else if (text.includes('READ_ONLY')) yield* call(`delegate-${++this.counter}`, 'project_delegate', { title: 'Readonly work', brief: 'READONLY_GUARD', scope: 'readonly' });
      else yield* blocks('No worker requested.'); return;
    }
    assert.ok(names.includes('project_report'), 'worker gets its independent preset');
    const assignment = options.messages.findLast(message => message.role === 'user' && messageText(message).includes('DelegationRef:'));
    const brief = messageText(assignment), ref = /DelegationRef: ([^\n]+)/.exec(brief)?.[1], cwd = /Working directory: ([^\n]+)/.exec(brief)?.[1];
    assert.ok(ref && cwd); const stage = this.stages.get(ref) ?? 0; this.stages.set(ref, stage + 1);
    if (brief.includes('HOLD_FOR_STOP') || brief.includes('HOLD_FOR_PATH_CHANGE')) { yield { type: 'block-start', index: 0, blockType: 'text' }; await new Promise((_, reject) => { if (options.signal.aborted) reject(new Error('aborted')); else options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }); }); return; }
    if (brief.includes('READONLY_GUARD') && !stage) { yield* call(`readonly-shell-${++this.counter}`, process.platform === 'win32' ? 'pwsh' : 'bash', { command: 'echo SHOULD_NOT_EXECUTE' }); return; }
    if (brief.includes('READONLY_GUARD') && stage === 1) { yield* call(`readonly-runtime-${++this.counter}`, 'run_code', { code: 'throw new Error("ARBITRARY_RUNTIME_MUST_NOT_EXECUTE")' }); return; }
    if (brief.includes('WRITE_PLAN') && !stage) { yield* call(`denied-doc-${++this.counter}`, 'project_write_document', { path: 'forbidden.js', text: 'bad' }); return; }
    if (brief.includes('WRITE_PLAN') && stage === 1) { yield* call(`plan-${++this.counter}`, 'project_write_document', { path: 'docs/plan.md', text: '# Plan\nOnly the authorized document changed.\n' }); return; }
    if (brief.includes('WRITE_EXTRA_DOC') && !stage) { yield* call(`extra-doc-${++this.counter}`, 'project_write_document', { path: 'docs/second.md', text: '# Explicit new document scope\n' }); return; }
    if (brief.includes('DEVELOP_CONTINUE') && !stage) { yield* call(`code-${++this.counter}`, 'write', { file_path: join(cwd, 'implementation.txt'), content: 'Same worker continued with explicit development scope.\n' }); return; }
    yield* call(`report-${++this.counter}`, 'project_report', { delegationRef: ref, outcome: 'completed', summary: brief.includes('WRITE_PLAN') ? 'Plan completed' : 'Requested work completed',
      artifacts: brief.includes('WRITE_PLAN') ? [join(cwd, 'docs/plan.md')] : brief.includes('DEVELOP_CONTINUE') ? [join(cwd, 'implementation.txt')] : [], evidence: ['Scripted external adapter exercised actual Harness tools; no real-provider acceptance is claimed.'], remainingIssues: ['Real-provider and visible desktop acceptance remain outside this Host check.'] });
  }
}

async function desktopBridge(root) {
  const bindings = new Map(), requests = [];
  const server = createServer(async (req, res) => { try {
    assert.equal(req.headers.authorization, 'Bearer composition-secret'); const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const input = JSON.parse(Buffer.concat(chunks)); requests.push(input); let value;
    if (input.action === 'canonicalize') { const path = await realpath(input.workingDirectory); value = { canonicalPath: path, identity: path.toLowerCase() }; }
    else if (input.action === 'prepare-workspace') { assert.equal(input.mode, 'existing'); value = { canonicalPath: await realpath(input.workingDirectory), ownership: 'user', receipt: input.workstreamId, isGit: false }; bindings.set(input.workstreamId, value); }
    else if (input.action === 'check-workspace') { assert.deepEqual(input.workspace, bindings.get(input.workstreamId)); value = { valid: true }; }
    else if (input.action === 'snapshot') value = { isGit: false, dirty: null, fingerprint: null };
    else throw new Error(`Unexpected desktop action ${input.action}`);
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(value));
  } catch (error) { res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: error.message })); } });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  return { requests, address: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(done => server.close(done)) };
}
async function bootHost(home, model) {
  const config = join(home, 'cordis.yml'); await writeFile(config, '[]\n');
  const web = dirname(cliRequire.resolve('@deepseek-ai/dsh-web-app/package.json')), manifest = JSON.parse(readFileSync(join(web, 'package.json'), 'utf8'));
  const patches = [...loadOverlayPatches('project-composition', join(harness, 'packages/bundle/base/cordis.patch.yml')),
    ...bundlePatchPaths(web, manifest.dsh.bundle).flatMap(path => loadOverlayPatches('project-composition', path)), ...loadOverlayPatches('project-composition', join(projectPackage, 'cordis.patch.yml')),
    { id: 'storage-json', config: { root: join(home, 'storages') } }, { id: 'session-persistence-jsonl', config: { root: join(home, 'sessions') } },
    { id: 'mcp-servers-file', config: { path: join(home, 'mcp-servers.yaml'), watch: false } }, { id: 'agent-default-model', config: { provider: 'composition', model: 'project-model' } },
    { id: 'agent-preset-registry', config: { default: 'standard' } },
    // Project roles explicitly stay native even when a user's ambient mode is PTC.
    { id: 'tools', config: { mode: 'ptc' } },
    ...['webserver', 'hmr', 'web-runtime', 'session-telemetry-otel', 'modules', 'connection', 'session-log-download', 'open-in-app', 'client-hmr', 'directory-picker'].map(id => ({ id, disabled: true })),
    { insert: [{ id: 'directory-picker-browse', name: '@deepseek-ai/dsh-host-directory-picker-browse' }] }];
  const ctx = await boot('project-composition', config, patches, ctx => {
    ctx.on('tools/result', (exec, result) => { if (result.error) model.failures.push({ name: exec.name, error: result.error }); });
    ctx.provide('connection', { fetch: { register: () => () => {} }, rpc: { intercept: () => () => {} } }); provideCmdline(ctx, { args: [], exit: () => {} });
    ctx.loader.internal = { version: 'v2', async import(name) { if (name === 'dsh-project' || name.startsWith('dsh-project/')) return import(pathToFileURL(join(projectPackage, 'lib', `${name === 'dsh-project' ? 'index' : name.slice(12)}.js`)).href); return import(pathToFileURL(resolvePackage(name)).href); } };
  });
  assert.equal(ctx.get('projects')?.available, true, ctx.get('projects')?.error);
  let contextVersion = 0; ctx.systemPrompt.context({ name: 'composition:actual-dynamic-context', order: 99999, text: () => `Runtime context snapshot ${++contextVersion}; it supplies no user authorization.` });
  ctx.llm.registerAdapter(['composition'], model); model.state = () => ctx.projects.state(); return ctx;
}
test('real coordinator tools delegate, preserve worker scope/cwd, stop and recover durable outcomes', { timeout: 120000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'whale-project-v2-')), home = join(root, 'home'), directory = join(root, 'selected');
  await mkdir(home); await mkdir(directory); const bridge = await desktopBridge(root); let ctx;
  const keys = ['DSH_HOME', 'DSHD_HOME', 'DSH_DESKTOP_INSTALL_URL', 'DSH_DESKTOP_INSTALL_TOKEN', 'DSH_TELEMETRY_DISABLED'], prior = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  Object.assign(process.env, { DSH_HOME: home, DSHD_HOME: home, DSH_DESKTOP_INSTALL_URL: bridge.address, DSH_DESKTOP_INSTALL_TOKEN: 'composition-secret', DSH_TELEMETRY_DISABLED: '1' });
  try {
    const model = new ScriptedModel(); ctx = await bootHost(home, model); const host = ctx.projects;
    const created = await host.command('create', { requestId: 'create-a', workingDirectory: directory }), project = created.project;
    assert.equal(model.requests.length, 0); assert.equal(host.state().workstreams.length, 0);
    assert.equal((await host.command('create', { requestId: 'create-b', workingDirectory: directory })).project.coordinatorSessionId, project.coordinatorSessionId);
    assert.equal(ctx.agents.get(project.coordinatorSessionId).session.header.cwd, project.storageRoot);
    await assert.rejects(ctx.agentPresets.select(ctx.agents.get(project.coordinatorSessionId), 'standard'), /Project session roles/);
    assert.equal(ctx.workspaceRegistry.get(project.workspaceId).path, await realpath(directory));
    const names = ctx.tools.schemas(ctx.agents.get(project.coordinatorSessionId)).map(item => item.name);
    assert.ok(names.includes('project_delegate')); assert.equal(names.some(name => ['spawn_agent', 'spawn_teammate', 'write', 'pwsh', 'bash'].includes(name)), false);
    assert.equal(names.includes('run_code'), false);
    await assert.rejects(() => host.command('delegate', { projectId: project.id }), /actual Agent tool provenance/);
    let promptNumber = 0;
    const prompt = value => ctx.sessionController.prompt({ sessionId: project.coordinatorSessionId, requestId: `user-${++promptNumber}`, mode: 'queue', content: [{ type: 'text', text: value }] }, signal);
    await prompt('SHORT_QUESTION'); await ctx.agents.get(project.coordinatorSessionId).whenIdle(); assert.equal(host.state().workstreams.length, 0);
    await prompt('PAUSE_OLD_DELEGATE'); await waitFor(() => model.coordinatorWaiting, 'coordinator is still processing the old user request');
    await host.command('pause', { projectId: project.id }); model.releaseCoordinator(); await ctx.agents.get(project.coordinatorSessionId).whenIdle();
    assert.equal(host.state().workstreams.length, 0); assert.equal(host.project(project.id).paused, true);
    assert.ok(model.failures.some(item => item.name === 'project_delegate' && /request was stopped/.test(item.error.message)));
    await prompt('DOCS_CODE_PATH'); await ctx.agents.get(project.coordinatorSessionId).whenIdle(); assert.equal(host.state().workstreams.length, 0);
    assert.ok(model.failures.some(item => item.name === 'project_delegate' && /Documentation scope/.test(item.error.message)));
    await prompt('MAKE_DOCS');
    const plan = await waitFor(() => host.state().workstreams.find(item => item.title === 'Plan work' && item.status === 'done'), 'document worker reports and really settles');
    assert.equal(plan.delegations[0].source.text, 'MAKE_DOCS');
    assert.ok(ctx.agents.get(project.coordinatorSessionId).session.snapshotEvents().some(event => event.type === 'user/message' && event.data.source.kind === 'runtime-context'));
    assert.equal(await readFile(join(directory, 'docs/plan.md'), 'utf8'), '# Plan\nOnly the authorized document changed.\n');
    await assert.rejects(readFile(join(directory, 'forbidden.js')), { code: 'ENOENT' }); assert.ok(model.failures.some(item => item.name === 'project_write_document'));
    const workerId = plan.workerSessionId; assert.equal(host.worker(workerId).cwd, await realpath(directory));
    const completion = await waitFor(() => model.settlementInputs.find(input => input.facts.reports.some(report => report.delegationRef === plan.currentDelegationRef)), 'parent receives actual report in its one native settlement notice without reading notes');
    assert.match(completion.text, /It left no closing message/); assert.equal(completion.facts.reports[0].summary, 'Plan completed');
    assert.equal(completion.facts.reports[0].artifacts[0].path, await realpath(join(directory, 'docs/plan.md'))); assert.equal(completion.facts.currentStatus, 'done');
    const noticeRecords = ctx.agents.get(project.coordinatorSessionId).session.snapshotEvents().filter(event => event.type === 'user/message' && event.data.source.kind === 'subagent-settled' && event.data.source.runId === completion.source.runId);
    assert.equal(noticeRecords.length, 1, 'report facts enrich the same message and do not create a second notification'); assert.equal(noticeRecords[0].data.id, completion.id);
    assert.deepEqual(plan.latestReport.remainingIssues, ['Real-provider and visible desktop acceptance remain outside this Host check.']);
    const edited = await host.command('store/write', { projectId: project.id, path: 'notes.md', text: 'My own project notes.' });
    assert.equal(edited.userText, 'My own project notes.'); assert.match(edited.generatedText, /Plan work/);
    await assert.rejects(() => host.command('store/write', { projectId: project.id, path: 'notes.md', text: edited.text }), /only the user notes body/);
    await waitFor(() => !ctx.agents.get(workerId), 'native child became cold');
    await prompt('IMPLEMENT_PLAN');
    await waitFor(() => host.stream(plan.id).status === 'done' && host.stream(plan.id).latestReport?.summary === 'Requested work completed', 'scope upgrade uses same cold worker');
    assert.equal(host.stream(plan.id).workerSessionId, workerId); assert.equal(host.worker(workerId).role, 'worker');
    const notes = await host.command('store/read', { projectId: project.id, path: 'notes.md' });
    assert.equal(notes.userText, 'My own project notes.'); assert.equal(notes.text.split('<!-- whale-project:user-notes -->').length, 2);
    assert.match(await readFile(join(directory, 'implementation.txt'), 'utf8'), /Same worker continued/);
    await prompt('READ_ONLY'); const investigation = await waitFor(() => host.state().workstreams.find(item => item.title === 'Readonly work' && item.status === 'done'), 'read-only worker settles');
    assert.equal(host.worker(investigation.workerSessionId).role, 'readonly'); assert.ok(model.failures.some(item => item.error.code === 'TOOL_GUARD_DENIED' || /shell|repository write/i.test(item.error.message)));
    assert.ok(model.failures.some(item => item.name === 'run_code'));
    await prompt('MAKE_PATH_HOLD'); await ctx.agents.get(project.coordinatorSessionId).whenIdle();
    const pathWork = host.state().workstreams.find(item => item.title === 'Path work'), pathWorker = pathWork.workerSessionId;
    await waitFor(() => ctx.agents.get(pathWorker)?.status === 'running', 'document worker remains active in its original scope');
    assert.deepEqual(host.worker(pathWorker).writePaths, ['docs/first.md']);
    assert.ok(model.failures.some(item => item.name === 'project_delegate' && /Scope expansion needs a new actual user message/.test(item.error.message)));
    const oldDocRequest = model.requests.findLast(request => request.messages.some(message => message.role === 'user' && messageText(message).includes('HOLD_FOR_PATH_CHANGE')) && request.tools.some(tool => tool.name === 'project_report'));
    await prompt('EXTEND_DOC_PATHS'); await waitFor(() => host.stream(pathWork.id).status === 'done', 'new human scope drains the busy document worker and resumes its original Session');
    assert.equal(host.stream(pathWork.id).workerSessionId, pathWorker); assert.equal(oldDocRequest.signal.aborted, true);
    assert.deepEqual(host.worker(pathWorker).writePaths, ['docs/first.md', 'docs/second.md']); assert.match(await readFile(join(directory, 'docs/second.md'), 'utf8'), /Explicit new document scope/);
    await prompt('HOLD_WORK'); await waitFor(() => ctx.agents.get(workerId)?.status === 'running', 'held worker is actually running');
    await ctx.sessionController.cancel({ sessionId: project.coordinatorSessionId });
    await waitFor(() => host.worker(workerId).phase === 'idle' && host.stream(plan.id).blockedReason === 'stopped', 'main composer stop drains background worker');
    assert.equal(host.project(project.id).paused, true); assert.equal(host.stream(plan.id).status, 'blocked'); assert.equal(host.stream(plan.id).pendingSummary, true);
    // Fault boundary: a genuine report and turn/end survived, but the native
    // activation settlement did not. Recovery must not manufacture completed.
    await host.serial(() => host.write(state => { const work = state.workstreams.find(item => item.id === pathWork.id); work.settlements = []; work.status = 'running'; work.pendingSummary = false;
      const report = work.delegations.find(item => item.ref === work.currentDelegationRef).report; delete report.summarizedBy; work.latestReport = report; }));
    const beforeDispose = model.requests.length; await disposeProfileApplication(ctx); ctx = undefined; assert.equal(model.requests.length, beforeDispose);
    const restartedModel = new ScriptedModel(); ctx = await bootHost(home, restartedModel); const resumed = ctx.projects;
    assert.equal(restartedModel.requests.length, 0); assert.equal(resumed.project(project.id).coordinatorSessionId, project.coordinatorSessionId); assert.equal(resumed.stream(plan.id).workerSessionId, workerId);
    assert.equal(resumed.stream(pathWork.id).status, 'blocked'); assert.equal(resumed.stream(pathWork.id).pendingSummary, true); assert.equal(resumed.stream(pathWork.id).settlements.length, 0);
    assert.equal(resumed.stream(plan.id).pendingSummary, true); assert.match((await resumed.command('store/read', { projectId: project.id, path: 'notes.md' })).text, /no associated visible coordinator summary/);
    await ctx.sessionController.create({ sessionId: project.coordinatorSessionId, cwd: project.storageRoot });
    await ctx.sessionController.prompt({ sessionId: project.coordinatorSessionId, requestId: 'read-pending', mode: 'queue', content: [{ type: 'text', text: 'READ_PENDING' }] }, signal);
    await waitFor(() => !resumed.stream(plan.id).pendingSummary, 'real visible coordinator reply summarizes durable pending facts');
    assert.equal(resumed.stream(plan.id).workerSessionId, workerId); assert.equal(resumed.worker(workerId).stopped, true);
    assert.equal(restartedModel.requests.some(request => request.tools.some(tool => tool.name === 'project_report')), false, 'reading recovery facts never wakes an old worker');
    await ctx.sessionController.prompt({ sessionId: project.coordinatorSessionId, requestId: 'abrupt-active', mode: 'queue', content: [{ type: 'text', text: 'HOLD_WORK' }] }, signal);
    const activeRequest = await waitFor(() => restartedModel.requests.findLast(request => request.tools.some(tool => tool.name === 'project_report') && request.messages.some(message => message.role === 'user' && messageText(message).includes('HOLD_FOR_STOP'))), 'worker is really streaming before bare root unload');
    await ctx.agents.get(project.coordinatorSessionId).whenIdle();
    const beforeAbrupt = restartedModel.requests.length; await ctx.fiber.dispose(); ctx = undefined;
    assert.equal(activeRequest.signal.aborted, true); assert.equal(restartedModel.requests.length, beforeAbrupt);
    const abruptRecoveryModel = new ScriptedModel(); ctx = await bootHost(home, abruptRecoveryModel);
    assert.equal(abruptRecoveryModel.requests.length, 0); assert.equal(ctx.projects.stream(plan.id).workerSessionId, workerId);
    assert.equal(ctx.projects.stream(plan.id).status, 'blocked'); assert.equal(ctx.projects.project(project.id).paused, true);
  } finally {
    if (ctx) await ctx.fiber.dispose(); await bridge.close();
    for (const key of keys) if (prior[key] === undefined) delete process.env[key]; else process.env[key] = prior[key];
    await rm(root, { recursive: true, force: true });
  }
});

test('failed warm admission keeps occupancy, expanding stops drain every worker, and notes reject junction replacement', async () => {
  const root = await mkdtemp(join(tmpdir(), 'whale-project-boundaries-')), home = join(root, 'home'), directory = join(root, 'selected'), store = join(home, 'projects', 'project-a');
  assert.ok(resolve(root).startsWith(`${resolve(tmpdir())}${sep}whale-project-boundaries-`));
  await mkdir(directory); await mkdir(join(store, 'docs'), { recursive: true });
  let state = { revision: 0, projects: [{ id: 'project-a', title: 'Boundary', coordinatorSessionId: 'parent', canonicalWorkingDirectory: await realpath(directory), storageRoot: await realpath(store), paused: false, lifecycle: 'ready' }], workers: [], workstreams: [] };
  const cancelled = [], drained = [], agents = new Map([['parent', { id: 'parent' }]]); let releaseA;
  const gateA = new Promise(done => { releaseA = done; });
  const addWorker = suffix => {
    const id = `worker-${suffix}`, streamId = `work-${suffix}`, ref = `ref-${suffix}`;
    state.workstreams.push({ id: streamId, projectId: 'project-a', title: suffix, brief: 'Authorized continuation', workerSessionId: id, status: 'running', currentDelegationRef: ref,
      settlements: [], pendingSummary: false, delegations: [{ ref, scope: 'worker', writePaths: [], phase: 'queued', source: { messageId: `user-${suffix}` } }] });
    state.workers.push({ sessionId: id, projectId: 'project-a', workstreamId: streamId, cwd: state.projects[0].canonicalWorkingDirectory, role: 'worker', mode: 'existing', phase: 'active', directoryHeld: true, materialized: true, stopped: false, consumedDelegationRef: ref });
    const agent = { id, status: 'running', cancel() { cancelled.push(id); }, async whenIdle() { if (suffix === 'a') await gateA; agent.status = 'idle'; } }; agents.set(id, agent);
    return id;
  };
  const ctx = { agents, get: name => name === 'jobs' ? { list: () => [] } : undefined, logger: { warn() {} }, subagents: {
    registerContinuationPolicy: () => () => {}, async drainContinuableChildren(_parent, ids) { drained.push(...ids); if (ids.includes('worker-a')) await gateA; },
  } };
  const table = { get: () => state, async update(_key, change) { state = change(state); } };
  const service = new ProjectService(ctx, table, { home, desktop: async () => { throw new Error('Actual binding changed'); } });
  service.notes = async () => {};
  try {
    const a = addWorker('a'); await assert.rejects(() => service.launch('work-a'), /Actual binding changed/);
    assert.equal(agents.get(a).status, 'running'); assert.equal(service.worker(a).directoryHeld, true, 'failed check must keep a live worker directory occupied');
    await service.stop('project-a'); await waitFor(() => drained.includes(a), 'first stop reaches native drain');
    const b = addWorker('b'); await service.write(next => { next.projects[0].paused = false; });
    await service.stop('project-a'); await waitFor(() => drained.includes(b), 'a later all-stop drains the new worker while the first still waits');
    assert.ok(cancelled.includes(a) && cancelled.includes(b)); releaseA(); await Promise.all([...service.stops.values()]);
    assert.equal(service.worker(a).phase, 'idle'); assert.equal(service.worker(b).phase, 'idle');
    let releaseDirectory; const directoryGate = new Promise(done => { releaseDirectory = done; }); let reservationCalls = 0;
    service.desktop = async () => { reservationCalls++; await directoryGate; throw new Error('Owned reservation probe completed'); };
    await service.write(next => { next.projects[0].paused = false; for (const worker of next.workers) { worker.stopped = false; worker.directoryHeld = false; worker.phase = 'idle'; }
      for (const work of next.workstreams) work.delegations.find(item => item.ref === work.currentDelegationRef).phase = 'queued'; });
    const reservations = [service.launch('work-a'), service.launch('work-b')];
    await waitFor(() => reservationCalls === 1, 'one launch atomically owns the shared writable directory');
    assert.equal(service.state().workers.filter(worker => worker.directoryHeld).length, 1);
    assert.equal(service.state().workstreams.filter(work => work.delegations[0].phase === 'queued').length, 1);
    releaseDirectory(); await Promise.allSettled(reservations); assert.equal(reservationCalls, 1);
    await service.write(next => { for (const work of next.workstreams) { work.title = work.id === 'work-a' ? 'Plan' : 'Implement Plan'; work.pendingSummary = true; work.settlements = [{ runId: `native-${work.id}`, summarizedBy: '' }]; } });
    service.consumed.set('parent', { turn: 1, streams: service.state().workstreams.map(work => ({ id: work.id, runs: [`native-${work.id}`], reports: [] })) });
    const reply = text => service.assistantReply({ id: 'parent' }, { type: 'assistant/message', data: { turn: 1, interrupted: false, message: { id: `reply-${text}`, content: [{ type: 'text', text }] } } });
    await reply('Implement Plan: the result is ready.');
    assert.equal(service.stream('work-a').pendingSummary, true); assert.equal(service.stream('work-b').pendingSummary, true, 'overlapping titles cannot acknowledge either result by substring');
    await reply('Implement Plan (work-b): the result is ready.');
    assert.equal(service.stream('work-a').pendingSummary, true); assert.equal(service.stream('work-b').pendingSummary, false);
    service.notes = ProjectService.prototype.notes;
    const outside = join(root, 'outside'); await mkdir(outside); await writeFile(join(outside, 'notes.md'), 'OWNED_EXTERNAL_SENTINEL');
    await rename(store, `${store}-original`); await symlink(outside, store, process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(() => service.notes('project-a'), /replaced with a link|points outside/);
    assert.equal(await readFile(join(outside, 'notes.md'), 'utf8'), 'OWNED_EXTERNAL_SENTINEL');
  } finally { releaseA(); await Promise.all([...service.stops.values()]); service.unpolicy(); await rm(root, { recursive: true, force: true }); }
});
