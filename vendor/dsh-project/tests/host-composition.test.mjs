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
const anchors = [cliRequire, ...['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@deepseek-ai/dsh-experimental-agent-team-profile'].map(name => createRequire(cliRequire.resolve(`${name}/package.json`)))];
anchors.push(createRequire(anchors[1].resolve('@deepseek-ai/dsh-storage-domain/package.json')));
function resolvePackage(name) { for (const anchor of anchors) try { return anchor.resolve(name); } catch (error) { if (!['MODULE_NOT_FOUND', 'ERR_PACKAGE_PATH_NOT_EXPORTED'].includes(error.code)) throw error; } throw new Error(`Missing built Harness dependency ${name}.`); }
const projectUrl = pathToFileURL(`${projectPackage}${sep}`).href;
registerHooks({ resolve(specifier, context, next) { if (context.parentURL?.startsWith(projectUrl) && !specifier.startsWith('.') && !specifier.startsWith('node:') && !specifier.startsWith('file:')) return { url: pathToFileURL(resolvePackage(specifier)).href, shortCircuit: true }; return next(specifier, context); } });
const { boot, loadOverlayPatches, bundlePatchPaths } = await import(pathToFileURL(resolvePackage('@deepseek-ai/dsh-app-boot')).href);
const { LlmAdapter, LlmError } = await import(pathToFileURL(resolvePackage('@deepseek-ai/dsh-llm')).href);
const { provideCmdline } = await import(pathToFileURL(resolvePackage('@deepseek-ai/dsh-cmdline')).href);
const { disposeProfileApplication } = await import(pathToFileURL(join(harness, 'apps/cli/lib/profile-boot.js')).href);
const { ProjectService } = await import(pathToFileURL(join(projectPackage, 'lib/service.js')).href);
const blocks = value => [{ type: 'block-start', index: 0, blockType: 'text' }, { type: 'text-delta', index: 0, text: value }, { type: 'block-end', index: 0, block: { type: 'text', text: value } }, { type: 'finish', reason: { kind: 'stop' } }];
const call = (id, name, args) => [{ type: 'block-start', index: 0, blockType: 'tool-call' }, { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: JSON.stringify(args) }, { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: JSON.stringify(args) } }, { type: 'finish', reason: { kind: 'tool-calls' } }];
const messageText = message => (message.content ?? []).filter(block => block.type === 'text').map(block => block.text).join('\n');
const signal = new AbortController().signal;
const scopedDocument = '鲸'.repeat(170666) + '\nA'; // Exactly 512000 UTF-8 bytes, two readable lines.
const waitFor = async (read, reason, timeout = 20000) => { const start = Date.now(); while (Date.now() - start < timeout) { const value = await read(); if (value) return value; await new Promise(done => setTimeout(done, 20)); } console.error(`Timed out: ${reason}`); throw new Error(`Timed out: ${reason}`); };

class ScriptedModel extends LlmAdapter {
  requests = []; failures = []; stages = new Map(); settlementInputs = []; counter = 0; state = () => null;
  coordinatorWaiting = false; coordinatorGate = new Promise(done => { this.releaseCoordinator = done; });
  async resolveModel(provider, model) { return { provider, id: model, name: model }; }
  async *stream(options) {
    this.requests.push(options); const names = (options.tools ?? []).map(tool => tool.name);
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
      if (text.includes('CAPACITY_HOLDER')) yield* call(`delegate-${++this.counter}`, 'project_delegate', { title: 'Capacity holder', brief: 'HOLD_FOR_STOP', scope: 'readonly' });
      else if (text.includes('CAPACITY_WAITING')) yield* call(`delegate-${++this.counter}`, 'project_delegate', { title: 'Capacity waiting', brief: 'Complete after capacity is released', scope: 'readonly' });
      else if (text.includes('PEER_RECEIVER')) yield* call(`delegate-${++this.counter}`, 'project_delegate', { title: 'Peer receiver', brief: 'WAIT_FOR_PEER_EVIDENCE', scope: 'readonly' });
      else if (text.includes('PEER_DEPENDENT')) yield* call(`delegate-${++this.counter}`, 'project_delegate', { title: 'Dependent work', brief: 'AFTER_PEER_EVIDENCE', scope: 'readonly', blockedBy: [this.state().workstreams.find(work => work.title === 'Peer receiver').id] });
      else if (text.includes('PEER_SENDER')) yield* call(`delegate-${++this.counter}`, 'project_delegate', { title: 'Peer sender', brief: 'SEND_PEER_EVIDENCE', scope: 'readonly' });
      else if (text.includes('MAKE_PATH_HOLD')) yield* call(`delegate-${++this.counter}`, 'project_delegate', { title: 'Path work', brief: 'HOLD_FOR_PATH_CHANGE', scope: 'docs', writePaths: ['docs/first.md'] });
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
    const envelope = messageText(assignment), ref = /DelegationRef: ([^\n]+)/.exec(envelope)?.[1], cwd = /Working directory: ([^\n]+)/.exec(envelope)?.[1];
    const brief = envelope.split('Current assignment and completion criteria:\n')[1]?.split('\n\n')[0] ?? envelope;
    assert.ok(ref && cwd); const stage = this.stages.get(ref) ?? 0; this.stages.set(ref, stage + 1);
    if (brief.includes('WAIT_FOR_PEER_EVIDENCE') && !options.messages.some(message => message.source?.kind === 'team-message' && message.content.some(block => block.type === 'text' && block.text === 'Verified peer finding'))) { yield* blocks('Waiting for the peer finding; no completion claim.'); return; }
    if (brief.includes('SEND_PEER_EVIDENCE') && !stage) { yield* call(`members-${++this.counter}`, 'list_agents', {}); return; }
    if (brief.includes('SEND_PEER_EVIDENCE') && stage === 1) {
      const receiver = this.state().workstreams.find(work => work.title === 'Peer receiver');
      yield* call(`peer-${++this.counter}`, 'send_message', { target: `member-${receiver.workerSessionId.replace(/^session-/, '')}`, message: 'Verified peer finding' }); return;
    }
    if (brief.includes('HOLD_FOR_STOP') || brief.includes('HOLD_FOR_PATH_CHANGE')) { yield { type: 'block-start', index: 0, blockType: 'text' }; await new Promise((_, reject) => { if (options.signal.aborted) reject(new Error('aborted')); else options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }); }); return; }
    if (brief.includes('READONLY_GUARD') && !stage) { yield* call(`readonly-shell-${++this.counter}`, process.platform === 'win32' ? 'pwsh' : 'bash', { command: 'echo SHOULD_NOT_EXECUTE' }); return; }
    if (brief.includes('READONLY_GUARD') && stage === 1) { yield* call(`readonly-runtime-${++this.counter}`, 'run_code', { code: 'throw new Error("ARBITRARY_RUNTIME_MUST_NOT_EXECUTE")' }); return; }
    if (brief.includes('WRITE_PLAN') && !stage) { yield* call(`denied-doc-${++this.counter}`, 'project_write_document', { path: 'forbidden.js', text: 'bad' }); return; }
    if (brief.includes('WRITE_PLAN') && stage === 1) { yield* call(`plan-${++this.counter}`, 'project_write_document', { path: 'docs/plan.md', text: scopedDocument }); return; }
    if (brief.includes('WRITE_PLAN') && stage === 2) { yield* call(`oversized-plan-${++this.counter}`, 'project_write_document', { path: 'docs/plan.md', text: scopedDocument + '鲸' }); return; }
    if (brief.includes('WRITE_PLAN') && stage === 3) { this.documentReadCallId = `plan-read-${++this.counter}`; yield* call(this.documentReadCallId, 'project_read', { path: 'docs/plan.md', startLine: 2, maxLines: 1 }); return; }
    if (brief.includes('WRITE_EXTRA_DOC') && !stage) { yield* call(`extra-doc-${++this.counter}`, 'project_write_document', { path: 'docs/second.md', text: '# Explicit new document scope\n' }); return; }
    if (brief.includes('DEVELOP_CONTINUE') && !stage) { yield* call(`code-${++this.counter}`, 'write', { file_path: join(cwd, 'implementation.txt'), content: 'Same worker continued with explicit development scope.\n' }); return; }
    yield* call(`report-${++this.counter}`, 'project_report', { delegationRef: ref, outcome: 'completed', summary: brief.includes('WRITE_PLAN') ? 'Plan completed' : 'Requested work completed',
      artifacts: brief.includes('WRITE_PLAN') ? [join(cwd, 'docs/plan.md')] : brief.includes('DEVELOP_CONTINUE') ? [join(cwd, 'implementation.txt')] : [], evidence: ['Scripted external adapter exercised actual Harness tools; no real-provider acceptance is claimed.'], remainingIssues: ['Real-provider and visible desktop acceptance remain outside this Host check.'] });
  }
}

/** Script only model choices; dependency admission and lifecycle remain native. */
class DependencyModel extends ScriptedModel {
  actions = new Map(); gates = new Map(); workerInputs = []; coordinatorGates = new Set();
  gate(name) {
    if (!this.gates.has(name)) {
      let release; const promise = new Promise(done => { release = done; });
      this.gates.set(name, { promise, release });
    }
    return this.gates.get(name);
  }
  async *stream(options) {
    const names = (options.tools ?? []).map(tool => tool.name);
    if (names.includes('project_delegate')) {
      const input = options.messages.findLast(message => message.role === 'user' && ['user', 'subagent-settled'].includes(message.source.kind));
      if (input?.source.kind !== 'user' || !messageText(input).startsWith('DEPENDENCY_ACTIONS:')) { yield* super.stream(options); return; }
      this.requests.push(options);
      const actions = JSON.parse(messageText(input).slice('DEPENDENCY_ACTIONS:'.length)), stage = this.actions.get(input.id) ?? 0;
      this.actions.set(input.id, stage + 1);
      if (stage >= actions.length) { yield* blocks('Dependency request processed.'); return; }
      const action = actions[stage], work = action.work && this.state().workstreams.find(item => item.title === action.work);
      if (action.awaitRunning) await waitFor(() => this.workerInputs.some(item => item.ref === this.state().workstreams.find(item => item.title === action.work)?.currentDelegationRef), 'original request reaches the real worker before dependency adjustment');
      if (action.gate) { this.coordinatorGates.add(action.gate); await this.gate(action.gate).promise; }
      const args = { title: action.title, brief: action.brief, scope: 'readonly', ...(work ? { workstreamId: work.id } : {}),
        ...(action.deps === undefined ? {} : { blockedBy: action.deps.map(title => { const dependency = this.state().workstreams.find(item => item.title === title); assert.ok(dependency, title); return dependency.id; }) }) };
      yield* call(`dependency-${++this.counter}`, 'project_delegate', args); return;
    }
    assert.ok(names.includes('project_report'));
    this.requests.push(options);
    const assignment = options.messages.findLast(message => message.role === 'user' && messageText(message).includes('DelegationRef:'));
    const envelope = messageText(assignment), ref = /DelegationRef: ([^\n]+)/.exec(envelope)?.[1];
    const brief = envelope.split('Current assignment and completion criteria:\n')[1]?.split('\n\n')[0];
    assert.ok(ref && brief);
    this.workerInputs.push({ ref, brief, signal: options.signal, work: structuredClone(this.state().workstreams) });
    if (brief.startsWith('HOLD_')) {
      await new Promise((done, reject) => {
        const abort = () => reject(new Error('scripted model cancelled'));
        if (options.signal.aborted) { abort(); return; }
        options.signal.addEventListener('abort', abort, { once: true });
        this.gate(brief).promise.then(() => { options.signal.removeEventListener('abort', abort); done(); });
      });
    }
    yield* call(`dependency-report-${++this.counter}`, 'project_report', { delegationRef: ref, outcome: 'completed', summary: brief,
      artifacts: [], evidence: ['External model scripted; native Team tools and settlement exercised.'], remainingIssues: [] });
  }
}

async function desktopBridge(root) {
  const bindings = new Map(), requests = [];
  const server = createServer(async (req, res) => { try {
    assert.equal(req.headers.authorization, 'Bearer composition-secret'); const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const input = JSON.parse(Buffer.concat(chunks)); requests.push(input); let value;
    if (input.action === 'select-directory') { const path = await realpath(input.workingDirectory); value = { canonicalPath: path, identity: path.toLowerCase() }; }
    else if (input.action === 'prepare-workspace') { assert.equal(input.mode, 'existing'); value = { canonicalPath: await realpath(input.workingDirectory), ownership: 'user', receipt: input.workstreamId, isGit: false }; bindings.set(input.workstreamId, value); }
    else if (input.action === 'check-workspace') { assert.deepEqual(input.workspace, bindings.get(input.workstreamId)); value = { valid: true }; }
    else if (input.action === 'snapshot') value = { isGit: false, dirty: null, fingerprint: null };
    else if (input.action === 'resolve-path') value = { canonicalPath: await realpath(input.path), root: bindings.get(input.workstreamId).canonicalPath };
    else throw new Error(`Unexpected desktop action ${input.action}`);
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(value));
  } catch (error) { res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: error.message })); } });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  return { requests, address: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(done => server.close(done)) };
}
async function bootHost(home, model, teamConfig) {
  const config = join(home, 'cordis.yml'); await writeFile(config, '[]\n');
  const web = dirname(cliRequire.resolve('@deepseek-ai/dsh-web-app/package.json')), manifest = JSON.parse(readFileSync(join(web, 'package.json'), 'utf8'));
  const patches = [...loadOverlayPatches('project-composition', join(harness, 'packages/bundle/base/cordis.patch.yml')),
    ...bundlePatchPaths(web, manifest.dsh.bundle).flatMap(path => loadOverlayPatches('project-composition', path)), ...loadOverlayPatches('project-composition', join(projectPackage, 'cordis.patch.yml')).map(patch => !teamConfig || !patch.insert ? patch : { ...patch, insert: [{ id: 'composition-team-limits', name: '@deepseek-ai/dsh-experimental-agent-team', config: teamConfig }, ...patch.insert] }),
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
    assert.equal(project.workspaceId, undefined, 'Project creation does not add an empty regular workspace');
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
    assert.equal(model.requests.filter(request => request.tools?.some(tool => tool.name === 'project_report')).length, 0, 'stopped Lead cannot launch a late worker');
    await prompt('DOCS_CODE_PATH'); await ctx.agents.get(project.coordinatorSessionId).whenIdle(); assert.equal(host.state().workstreams.length, 0);
    assert.ok(model.failures.some(item => item.name === 'project_delegate' && /Documentation scope/.test(item.error.message)));
    await prompt('MAKE_DOCS');
    const plan = await waitFor(() => host.state().workstreams.find(item => item.title === 'Plan work' && item.status === 'done'), 'document worker reports and really settles');
    assert.equal(plan.delegations[0].source.text, 'MAKE_DOCS');
    assert.ok(ctx.agents.get(project.coordinatorSessionId).session.snapshotEvents().some(event => event.type === 'user/message' && event.data.source.kind === 'runtime-context'));
    assert.equal(Buffer.byteLength(scopedDocument, 'utf8'), 512000);
    assert.equal(await readFile(join(directory, 'docs/plan.md'), 'utf8'), scopedDocument, 'an oversized Chinese replacement preserves the accepted document');
    assert.ok(model.failures.some(item => item.name === 'project_write_document' && /Document exceeds the write limit/.test(item.error.message)));
    const documentEvents = (await ctx.sessionController.inspect(plan.workerSessionId)).events;
    const documentRead = documentEvents.find(event => event.type === 'tool/result' && event.data.message.toolCallId === model.documentReadCallId);
    assert.ok(documentRead, 'the docs member read its boundary-size document through the scoped read tool');
    const readPage = JSON.parse(messageText(documentRead.data.message));
    assert.equal(readPage.text, 'A'); assert.equal(readPage.totalLines, 2); assert.equal(readPage.startLine, 2);
    await assert.rejects(readFile(join(directory, 'forbidden.js')), { code: 'ENOENT' }); assert.ok(model.failures.some(item => item.name === 'project_write_document'));
    assert.equal(ctx.agentTeams.getTask(ctx.agents.get(project.coordinatorSessionId), plan.id).status, 'completed');
    const materials = await host.command('store/list', { projectId: project.id });
    assert.equal(materials.results[0].report.summary, 'Plan completed'); assert.equal(materials.results[0].reportCount, 1);
    const artifactRequest = { projectId: project.id, workstreamId: plan.id, delegationRef: plan.currentDelegationRef, path: join(directory, 'docs/plan.md') };
    assert.equal((await host.command('open', artifactRequest)).modifiedSinceReport, false);
    await writeFile(artifactRequest.path, '# Plan\nChanged after the recorded result.\n');
    assert.equal((await host.command('open', artifactRequest)).modifiedSinceReport, true);
    assert.ok(ctx.agentTeams.listMembers(ctx.agents.get(project.coordinatorSessionId)).some(member => member.id === plan.workerSessionId && member.role === 'teammate'));
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
    const resultHistory = await host.command('store/results', { projectId: project.id, workstreamId: plan.id });
    assert.equal(resultHistory.total, 2); assert.deepEqual(resultHistory.items.map(report => report.summary), ['Requested work completed', 'Plan completed']);
    await assert.rejects(() => host.command('store/results', { projectId: project.id, workstreamId: plan.id, cursor: 'another-work' }), { code: 'result_cursor' });
    assert.equal(host.stream(plan.id).workerSessionId, workerId); assert.equal(host.worker(workerId).role, 'worker');
    assert.equal(ctx.agentTeams.getTask(ctx.agents.get(project.coordinatorSessionId), plan.id).description, 'DEVELOP_CONTINUE');
    const notes = await host.command('store/read', { projectId: project.id, path: 'notes.md' });
    assert.equal(notes.userText, 'My own project notes.'); assert.equal(notes.text.split('<!-- whale-project:user-notes -->').length, 2);
    assert.match(await readFile(join(directory, 'implementation.txt'), 'utf8'), /Same worker continued/);
    await ctx.agents.get(project.coordinatorSessionId).whenIdle();
    await prompt('PEER_RECEIVER');
    const receiver = await waitFor(() => host.state().workstreams.find(work => work.title === 'Peer receiver' && work.settlements.length), 'receiver settles without falsely completing');
    assert.equal(ctx.agentTeams.getTask(ctx.agents.get(project.coordinatorSessionId), receiver.id).status, 'in_progress');
    await ctx.agents.get(project.coordinatorSessionId).whenIdle();
    await prompt('PEER_DEPENDENT'); await ctx.agents.get(project.coordinatorSessionId).whenIdle();
    const dependent = host.state().workstreams.find(work => work.title === 'Dependent work');
    assert.equal(host.worker(dependent.workerSessionId).materialized, false, 'dependency waits before spawning');
    assert.deepEqual(dependent.delegations.at(-1).waitingReason, { kind: 'dependencies', workTitles: ['Peer receiver'] });
    assert.deepEqual(ctx.agentTeams.getTask(ctx.agents.get(project.coordinatorSessionId), dependent.id).blockedBy, [receiver.id]);
    await prompt('PEER_SENDER');
    await waitFor(() => [receiver.id, dependent.id].every(id => host.stream(id).status === 'done'), 'native peer message resumes receiver and unlocks dependent work');
    assert.deepEqual(host.stream(dependent.id).latestReport.prerequisites, [{ workstreamId: receiver.id, title: receiver.title,
      delegationRef: host.stream(receiver.id).currentDelegationRef, reportId: host.stream(receiver.id).latestReport.callId }]);
    assert.equal(host.stream(dependent.id).delegations.at(-1).waitingReason, undefined);
    const sender = await waitFor(() => host.state().workstreams.find(work => work.title === 'Peer sender' && work.status === 'done'), 'sender settles');
    const peer = ctx.agents.get(project.coordinatorSessionId).session.snapshotEvents().find(event => event.type === 'team/message/queued' && event.data.message.senderId === sender.workerSessionId && event.data.message.targetId === receiver.workerSessionId);
    assert.ok(peer, 'peer evidence used the native durable mailbox');
    assert.deepEqual(ctx.agentTeams.messageContext(ctx.agents.get(project.coordinatorSessionId), peer.data.message.id), { senderAssignment: sender.currentDelegationRef, targetAssignment: receiver.currentDelegationRef });
    assert.equal(model.failures.some(item => ['list_agents', 'send_message'].includes(item.name)), false);
    await prompt('READ_ONLY'); const investigation = await waitFor(() => host.state().workstreams.find(item => item.title === 'Readonly work' && item.status === 'done'), 'read-only worker settles');
    assert.equal(host.worker(investigation.workerSessionId).role, 'readonly'); assert.ok(model.failures.some(item => item.error.code === 'TOOL_GUARD_DENIED' || /shell|repository write/i.test(item.error.message)));
    assert.ok(model.failures.some(item => item.name === 'run_code'));
    await waitFor(() => !host.stream(investigation.id).pendingSummary, 'readonly result is visible before the next request'); await ctx.agents.get(project.coordinatorSessionId).whenIdle();
    await prompt('MAKE_PATH_HOLD'); await ctx.agents.get(project.coordinatorSessionId).whenIdle();
    const pathWork = host.state().workstreams.find(item => item.title === 'Path work'), pathWorker = pathWork.workerSessionId;
    await waitFor(() => ctx.agents.get(pathWorker)?.status === 'running', 'document worker remains active in its original scope');
    assert.deepEqual(host.worker(pathWorker).writePaths, ['docs/first.md']);
    assert.ok(model.failures.some(item => item.name === 'project_delegate' && /Scope expansion needs a new actual user message/.test(item.error.message)), JSON.stringify(model.failures));
    const oldDocRequest = model.requests.findLast(request => request.messages.some(message => message.role === 'user' && messageText(message).includes('HOLD_FOR_PATH_CHANGE')) && request.tools?.some(tool => tool.name === 'project_report'));
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
    assert.equal(restartedModel.requests.some(request => request.tools?.some(tool => tool.name === 'project_report')), false, 'reading recovery facts never wakes an old worker');
    await ctx.sessionController.prompt({ sessionId: project.coordinatorSessionId, requestId: 'abrupt-active', mode: 'queue', content: [{ type: 'text', text: 'HOLD_WORK' }] }, signal);
    const activeRequest = await waitFor(() => restartedModel.requests.findLast(request => request.tools?.some(tool => tool.name === 'project_report') && request.messages.some(message => message.role === 'user' && messageText(message).includes('HOLD_FOR_STOP'))), 'worker is really streaming before bare root unload');
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

test('native Team dependency changes preserve continuing identity, reject cycles and honor real stops', { timeout: 120000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'whale-project-dependencies-')), home = join(root, 'home'), directory = join(root, 'selected');
  await mkdir(home); await mkdir(directory); const bridge = await desktopBridge(root); let ctx;
  const keys = ['DSH_HOME', 'DSHD_HOME', 'DSH_DESKTOP_INSTALL_URL', 'DSH_DESKTOP_INSTALL_TOKEN'], prior = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  Object.assign(process.env, { DSH_HOME: home, DSHD_HOME: home, DSH_DESKTOP_INSTALL_URL: bridge.address, DSH_DESKTOP_INSTALL_TOKEN: 'composition-secret' });
  try {
    const model = new DependencyModel(); ctx = await bootHost(home, model); const host = ctx.projects;
    const { project } = await host.command('create', { requestId: 'dependency-project', workingDirectory: directory });
    const lead = ctx.agents.get(project.coordinatorSessionId); let request = 0;
    const prompt = (...actions) => ctx.sessionController.prompt({ sessionId: lead.id, requestId: `dependency-user-${++request}`, mode: 'queue', content: [{ type: 'text', text: `DEPENDENCY_ACTIONS:${JSON.stringify(actions)}` }] }, signal);
    const work = title => host.state().workstreams.find(item => item.title === title);
    const task = title => ctx.agentTeams.getTask(lead, work(title).id);
    const receipt = title => work(title).delegations.find(item => item.ref === work(title).currentDelegationRef);
    const done = async title => { await waitFor(() => work(title)?.status === 'done' && !work(title).pendingSummary, `${title} has its real completed settlement and visible result`); await lead.whenIdle(); };
    const stable = title => structuredClone({ ref: work(title).currentDelegationRef, report: work(title).latestReport, deps: work(title).blockedBy, task: task(title), activeRunId: host.worker(work(title).workerSessionId).activeRunId });
    await prompt({ title: 'Backend', brief: 'HOLD_BACKEND' });
    await waitFor(() => model.workerInputs.some(item => item.brief === 'HOLD_BACKEND'), 'backend is actually streaming'); await lead.whenIdle();
    await prompt({ title: 'Frontend', brief: 'FIRST_FRONTEND' }); await done('Frontend');
    const frontendId = work('Frontend').id, frontendWorker = work('Frontend').workerSessionId, frontendCwd = host.worker(frontendWorker).cwd;
    const firstReport = structuredClone(work('Frontend').latestReport), beforeSelf = stable('Frontend'), failureCount = model.failures.length;
    await prompt({ work: 'Frontend', brief: 'REJECT_SELF', deps: ['Frontend'] }); await lead.whenIdle();
    assert.deepEqual(stable('Frontend'), beforeSelf, 'self dependency leaves current result, native task and delegation untouched');
    assert.ok(model.failures.slice(failureCount).some(item => /cycle/i.test(item.error.message)));

    await prompt({ work: 'Frontend', brief: 'AFTER_BACKEND', deps: ['Backend'] }); await lead.whenIdle();
    assert.equal(receipt('Frontend').phase, 'queued'); assert.deepEqual(task('Frontend').blockedBy, [work('Backend').id]);
    assert.equal(work('Frontend').id, frontendId); assert.equal(work('Frontend').workerSessionId, frontendWorker);
    assert.equal(host.worker(frontendWorker).cwd, frontendCwd); assert.equal(model.workerInputs.some(item => item.brief === 'AFTER_BACKEND'), false);
    assert.deepEqual((await host.command('store/results', { projectId: project.id, workstreamId: frontendId })).items[0], { ...firstReport, prerequisitesChanged: false });
    await prompt({ work: 'Frontend', brief: 'OMITTED_DEPS_STILL_WAIT' }); await lead.whenIdle();
    assert.deepEqual(work('Frontend').blockedBy, [work('Backend').id]); assert.deepEqual(task('Frontend').blockedBy, [work('Backend').id]);
    assert.equal(receipt('Frontend').phase, 'queued'); assert.equal(model.workerInputs.some(item => item.brief === 'OMITTED_DEPS_STILL_WAIT'), false);

    const beforeCycle = stable('Backend'), backendInput = model.workerInputs.find(item => item.brief === 'HOLD_BACKEND'), cycleFailures = model.failures.length;
    await prompt({ work: 'Backend', brief: 'REJECT_INDIRECT_CYCLE', deps: ['Frontend'] }); await lead.whenIdle();
    assert.deepEqual(stable('Backend'), beforeCycle, 'indirect cycle cannot drain the active member or replace its requirement');
    assert.equal(backendInput.signal.aborted, false); assert.ok(model.failures.slice(cycleFailures).some(item => /cycle/i.test(item.error.message)));
    model.gate('HOLD_BACKEND').release(); await done('Backend'); await done('Frontend');
    const unlocked = model.workerInputs.find(item => item.brief === 'OMITTED_DEPS_STILL_WAIT'), observedBackend = unlocked.work.find(item => item.title === 'Backend');
    assert.equal(observedBackend.status, 'done');
    assert.ok(observedBackend.settlements.some(item => item.stopReason === 'completed' && item.delegationRefs.includes(observedBackend.currentDelegationRef)), 'a native completed settlement precedes dependent execution');
    assert.equal(task('Frontend').id, frontendId); assert.equal(work('Frontend').workerSessionId, frontendWorker);

    await prompt({ work: 'Backend', brief: 'HOLD_BACKEND_AGAIN' });
    await waitFor(() => model.workerInputs.some(item => item.brief === 'HOLD_BACKEND_AGAIN'), 'new backend requirement is still running'); await lead.whenIdle();
    await prompt({ work: 'Frontend', brief: 'WAIT_AGAIN', deps: ['Backend'] }); await lead.whenIdle();
    assert.equal(receipt('Frontend').phase, 'queued');
    await prompt({ work: 'Frontend', brief: 'CLEARED_DEPENDENCIES', deps: [] }); await done('Frontend');
    assert.deepEqual(task('Frontend').blockedBy, []); assert.deepEqual(work('Frontend').blockedBy, []);
    assert.equal(work('Frontend').workerSessionId, frontendWorker); assert.equal(host.worker(work('Backend').workerSessionId).stopped, false);
    assert.equal(ctx.agents.get(work('Backend').workerSessionId).status, 'running', 'explicit [] resumes independently of the unfinished predecessor');

    const failuresBeforeDrain = model.failures.length;
    await prompt({ title: 'Active adjustment', brief: 'HOLD_ACTIVE_ADJUSTMENT' }, { work: 'Active adjustment', brief: 'AFTER_INTERNAL_DRAIN', deps: ['Backend'], awaitRunning: true }); await lead.whenIdle();
    const adjusted = work('Active adjustment'), oldActive = model.workerInputs.find(item => item.brief === 'HOLD_ACTIVE_ADJUSTMENT');
    assert.equal(adjusted.delegations.length, 2); assert.equal(adjusted.delegations[0].source.messageId, adjusted.delegations[1].source.messageId);
    assert.equal(oldActive.signal.aborted, true); assert.equal(receipt('Active adjustment').phase, 'queued');
    assert.equal(host.worker(adjusted.workerSessionId).stopped, false); assert.deepEqual(task('Active adjustment').blockedBy, [work('Backend').id]);
    assert.equal(model.failures.length, failuresBeforeDrain, 'internal dependency drain does not convert the same actual user request into a forbidden restart');

    await prompt({ title: 'User stop cutoff', brief: 'HOLD_USER_STOP' }, { work: 'User stop cutoff', brief: 'OLD_REQUEST_MUST_NOT_RESUME', deps: ['Backend'], awaitRunning: true, gate: 'late-dependency' });
    await waitFor(() => model.coordinatorGates.has('late-dependency'), 'old user request pauses before its second actual tool call');
    const stoppedWork = work('User stop cutoff'), stoppedRef = stoppedWork.currentDelegationRef;
    await host.command('stop', { projectId: project.id, workstreamId: stoppedWork.id }); await Promise.all([...host.stops.values()]);
    model.gate('late-dependency').release(); await lead.whenIdle();
    assert.equal(work('User stop cutoff').currentDelegationRef, stoppedRef); assert.equal(work('User stop cutoff').delegations.length, 1);
    assert.equal(host.worker(stoppedWork.workerSessionId).stopped, true); assert.equal(model.workerInputs.some(item => item.brief === 'OLD_REQUEST_MUST_NOT_RESUME'), false);
    assert.ok(model.failures.some(item => /Stopped work needs|request was stopped/i.test(item.error.message)));

    // Pause after real native drain, before the internal continuation commits.
    // A separate user stop then loses its storage write but must retain cutoff.
    const originalDrain = host.drainWorker, originalWrite = host.write;
    let releaseDrain, drainReached = false;
    const drainGate = new Promise(done => { releaseDrain = done; });
    host.drainWorker = async function (project, id) {
      await originalDrain.call(this, project, id);
      if (id === work('Stop storage race')?.workerSessionId) { drainReached = true; await drainGate; }
    };
    try {
      await prompt({ title: 'Stop storage race', brief: 'HOLD_STORAGE_RACE' }, { work: 'Stop storage race', brief: 'FAILED_STOP_MUST_NOT_RESUME', deps: ['Backend'], awaitRunning: true });
      await waitFor(() => drainReached, 'internal dependency change reaches native drain boundary'); await host.tail;
      const race = work('Stop storage race'), originalRef = race.currentDelegationRef, failuresBeforeStop = model.failures.length;
      let failWrite = true;
      host.write = async function (change) { if (failWrite) { failWrite = false; throw new Error('User stop persistence fault'); } return originalWrite.call(this, change); };
      await assert.rejects(() => host.command('stop', { projectId: project.id, workstreamId: race.id }), /User stop persistence fault/);
      assert.equal(failWrite, false, 'the injected failure reached the actual stop persistence boundary'); host.write = originalWrite;
      releaseDrain(); await lead.whenIdle(); await Promise.all([...host.stops.values()]);
      assert.equal(work('Stop storage race').currentDelegationRef, originalRef); assert.equal(work('Stop storage race').delegations.length, 1);
      assert.deepEqual(work('Stop storage race').blockedBy, []); assert.deepEqual(task('Stop storage race').blockedBy, []);
      assert.equal(host.worker(race.workerSessionId).stopped, true); assert.equal(host.held.has(race.workerSessionId), true);
      assert.equal(model.workerInputs.some(item => item.brief === 'FAILED_STOP_MUST_NOT_RESUME'), false);
      assert.ok(model.failures.slice(failuresBeforeStop).some(item => /stopped while its continuation/i.test(item.error.message)), 'the failed user-stop save still rejects the internally drained old request');
    } finally { host.write = originalWrite; host.drainWorker = originalDrain; releaseDrain(); }
    await host.command('stop', { projectId: project.id }); await Promise.all([...host.stops.values()]); await lead.whenIdle();
  } finally {
    if (ctx) await ctx.fiber.dispose(); await bridge.close();
    for (const key of keys) if (prior[key] === undefined) delete process.env[key]; else process.env[key] = prior[key];
    assert.ok(resolve(root).startsWith(`${resolve(tmpdir())}${sep}whale-project-dependencies-`)); await rm(root, { recursive: true, force: true });
  }
});

test('native dependency reservation rejects an upstream continuation while its old Team task is still completed', { timeout: 120000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'whale-project-dependency-race-')), home = join(root, 'home'), directory = join(root, 'selected');
  await mkdir(home); await mkdir(directory); const bridge = await desktopBridge(root); let ctx, releaseReopen, releaseReservation;
  const keys = ['DSH_HOME', 'DSHD_HOME', 'DSH_DESKTOP_INSTALL_URL', 'DSH_DESKTOP_INSTALL_TOKEN'], prior = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  Object.assign(process.env, { DSH_HOME: home, DSHD_HOME: home, DSH_DESKTOP_INSTALL_URL: bridge.address, DSH_DESKTOP_INSTALL_TOKEN: 'composition-secret' });
  try {
    const model = new DependencyModel(); ctx = await bootHost(home, model); const host = ctx.projects;
    const { project } = await host.command('create', { requestId: 'dependency-race', workingDirectory: directory });
    const lead = ctx.agents.get(project.coordinatorSessionId); let request = 0;
    const prompt = action => ctx.sessionController.prompt({ sessionId: lead.id, requestId: `dependency-race-${++request}`, mode: 'queue', content: [{ type: 'text', text: `DEPENDENCY_ACTIONS:${JSON.stringify([action])}` }] }, signal);
    const work = title => host.state().workstreams.find(item => item.title === title);
    const receipt = title => work(title).delegations.find(item => item.ref === work(title).currentDelegationRef);
    await prompt({ title: 'Upstream A', brief: 'FIRST_A' });
    await waitFor(() => work('Upstream A')?.status === 'done' && !work('Upstream A').pendingSummary, 'A first result has a completed native settlement'); await lead.whenIdle();
    const aId = work('Upstream A').id, aWorker = work('Upstream A').workerSessionId, firstRef = work('Upstream A').currentDelegationRef;
    await prompt({ title: 'Gate G', brief: 'HOLD_GATE_G' });
    await waitFor(() => model.workerInputs.some(item => item.brief === 'HOLD_GATE_G'), 'second prerequisite is running'); await lead.whenIdle();
    await prompt({ title: 'Dependent B', brief: 'AFTER_CURRENT_A', deps: ['Upstream A', 'Gate G'] }); await lead.whenIdle();
    const bWorker = work('Dependent B').workerSessionId, bRef = work('Dependent B').currentDelegationRef;
    assert.equal(receipt('Dependent B').phase, 'queued');
    const originalEnsure = host.ensureTask, reopenGate = new Promise(done => { releaseReopen = done; }), reservationGate = new Promise(done => { releaseReservation = done; });
    let atReopen = false, atReservation = false;
    host.ensureTask = async function (stream) {
      if (stream.id === aId && stream.currentDelegationRef !== firstRef && receipt('Upstream A').phase === 'queued') { atReopen = true; await reopenGate; }
      const task = await originalEnsure.call(this, stream);
      if (stream.id === work('Dependent B').id && !atReservation) { atReservation = true; await reservationGate; }
      return task;
    };
    try {
      model.gate('HOLD_GATE_G').release();
      await waitFor(() => atReservation && work('Gate G').status === 'done', 'B admission has the old completed upstream task before its reservation');
      await prompt({ work: 'Upstream A', brief: 'HOLD_SECOND_A' });
      await waitFor(() => atReopen, 'A current delegation is durable before its native task reopens');
      const secondRef = work('Upstream A').currentDelegationRef;
      assert.notEqual(secondRef, firstRef); assert.equal(ctx.agentTeams.getTask(lead, aId).status, 'completed');
      releaseReservation();
      await waitFor(() => work('Gate G').status === 'done' && receipt('Dependent B').waitingReason?.workTitles?.join() === 'Upstream A', 'B rechecks the current Project receipt even while native A still says completed');
      assert.equal(ctx.agentTeams.getTask(lead, aId).status, 'completed', 'the native reopen remains genuinely in flight');
      assert.equal(receipt('Dependent B').phase, 'queued'); assert.equal(receipt('Dependent B').dispatchedPrerequisites, undefined);
      assert.equal(model.workerInputs.some(item => item.brief === 'AFTER_CURRENT_A'), false);
      releaseReopen();
      await waitFor(() => model.workerInputs.some(item => item.brief === 'HOLD_SECOND_A'), 'original A member consumes its real second request'); await lead.whenIdle();
      assert.equal(model.workerInputs.some(item => item.brief === 'AFTER_CURRENT_A'), false);
      model.gate('HOLD_SECOND_A').release();
      await waitFor(() => work('Dependent B').status === 'done' && !work('Dependent B').pendingSummary, 'B starts after the new A report and actual completed settlement'); await lead.whenIdle();
      const snapshot = receipt('Dependent B').prerequisites.find(item => item.workstreamId === aId);
      assert.equal(snapshot.delegationRef, secondRef); assert.equal(snapshot.reportId, receipt('Upstream A').report.callId);
      assert.deepEqual(receipt('Dependent B').report.prerequisites, receipt('Dependent B').prerequisites);
      assert.equal(work('Upstream A').workerSessionId, aWorker); assert.equal(work('Dependent B').workerSessionId, bWorker); assert.equal(work('Dependent B').currentDelegationRef, bRef);
      const bInput = model.workerInputs.find(item => item.brief === 'AFTER_CURRENT_A'), actualA = bInput.work.find(item => item.id === aId);
      assert.ok(actualA.settlements.some(item => item.delegationRefs.includes(secondRef) && item.stopReason === 'completed'));
    } finally { releaseReservation(); releaseReopen(); host.ensureTask = originalEnsure; }
  } finally {
    releaseReservation?.(); releaseReopen?.(); if (ctx) await ctx.fiber.dispose(); await bridge.close();
    for (const key of keys) if (prior[key] === undefined) delete process.env[key]; else process.env[key] = prior[key];
    assert.ok(resolve(root).startsWith(`${resolve(tmpdir())}${sep}whale-project-dependency-race-`)); await rm(root, { recursive: true, force: true });
  }
});

test('native dependency changes during workspace preparation return the same unstarted member to its queue', { timeout: 120000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'whale-project-preparation-dependency-')), home = join(root, 'home'), directory = join(root, 'selected');
  await mkdir(home); await mkdir(directory); const bridge = await desktopBridge(root); let ctx, releasePreparation;
  const keys = ['DSH_HOME', 'DSHD_HOME', 'DSH_DESKTOP_INSTALL_URL', 'DSH_DESKTOP_INSTALL_TOKEN'], prior = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  Object.assign(process.env, { DSH_HOME: home, DSHD_HOME: home, DSH_DESKTOP_INSTALL_URL: bridge.address, DSH_DESKTOP_INSTALL_TOKEN: 'composition-secret' });
  try {
    const model = new DependencyModel(); ctx = await bootHost(home, model); const host = ctx.projects;
    const { project } = await host.command('create', { requestId: 'preparation-dependency', workingDirectory: directory });
    const lead = ctx.agents.get(project.coordinatorSessionId); let request = 0;
    const prompt = action => ctx.sessionController.prompt({ sessionId: lead.id, requestId: `preparation-dependency-${++request}`, mode: 'queue', content: [{ type: 'text', text: `DEPENDENCY_ACTIONS:${JSON.stringify([action])}` }] }, signal);
    const work = title => host.state().workstreams.find(item => item.title === title);
    const receipt = title => work(title).delegations.find(item => item.ref === work(title).currentDelegationRef);
    await prompt({ title: 'A', brief: 'FIRST_PREPARATION_A' });
    await waitFor(() => work('A')?.status === 'done' && !work('A').pendingSummary, 'initial A completes'); await lead.whenIdle();
    const originalAReport = structuredClone(receipt('A').report);
    await prompt({ title: 'G', brief: 'HOLD_PREPARATION_G' });
    await waitFor(() => model.workerInputs.some(item => item.brief === 'HOLD_PREPARATION_G'), 'G is running'); await lead.whenIdle();
    await prompt({ title: 'B', brief: 'AFTER_PREPARATION_A', deps: ['A', 'G'] }); await lead.whenIdle();
    const bId = work('B').id, bWorker = work('B').workerSessionId, bRef = work('B').currentDelegationRef;
    const originalDesktop = host.desktop, preparationGate = new Promise(done => { releasePreparation = done; }); let preparing = false;
    host.desktop = async function (action, payload) {
      const result = await originalDesktop.call(this, action, payload);
      if (action === 'prepare-workspace' && payload.workstreamId === bId) { preparing = true; await preparationGate; }
      return result;
    };
    try {
      model.gate('HOLD_PREPARATION_G').release();
      await waitFor(() => preparing, 'B has reserved its old prerequisite snapshot and is preparing a real workspace');
      assert.equal(receipt('B').phase, 'preparing');
      await prompt({ work: 'A', brief: 'HOLD_PREPARATION_NEW_A' });
      await waitFor(() => model.workerInputs.some(item => item.brief === 'HOLD_PREPARATION_NEW_A'), 'A current native task is reopened and running'); await lead.whenIdle();
      const newARef = work('A').currentDelegationRef;
      releasePreparation();
      await waitFor(() => receipt('B').phase === 'queued' && receipt('B').waitingReason?.kind === 'dependencies', 'native task admission returns B to dependency waiting');
      assert.deepEqual(receipt('B').waitingReason.workTitles, ['A']); assert.equal(receipt('B').error, '');
      assert.equal(work('B').status, 'open'); assert.equal(host.worker(bWorker).error, ''); assert.equal(host.worker(bWorker).directoryHeld, false);
      assert.equal(host.worker(bWorker).materialized, false); assert.equal(host.worker(bWorker).activeRunId || '', '');
      assert.equal(await ctx.sessionPersistence.stat(bWorker), undefined, 'native task rejection occurs before creating the worker Session');
      assert.equal(model.workerInputs.some(item => item.brief === 'AFTER_PREPARATION_A'), false);
      assert.equal(lead.session.snapshotEvents().filter(event => event.type === 'team/control' && event.data.control.kind === 'cold' && event.data.control.taskId === bId).at(-1)?.data.control.cold, true);
      model.gate('HOLD_PREPARATION_NEW_A').release();
      await waitFor(() => work('B').status === 'done' && !work('B').pendingSummary, 'new A completion admits original B automatically'); await lead.whenIdle();
      assert.equal(work('B').workerSessionId, bWorker); assert.equal(work('B').currentDelegationRef, bRef); assert.equal(work('B').delegations.length, 1);
      assert.equal(receipt('B').prerequisites.find(item => item.workstreamId === work('A').id).delegationRef, newARef);
      assert.equal(model.workerInputs.filter(item => item.brief === 'AFTER_PREPARATION_A').length, 1, 'B executes only after its current prerequisite is complete');
      assert.deepEqual(work('A').delegations[0].report, originalAReport, 'waiting never rewrites completed historical reports');
    } finally { releasePreparation(); host.desktop = originalDesktop; }
  } finally {
    releasePreparation?.(); if (ctx) await ctx.fiber.dispose(); await bridge.close();
    for (const key of keys) if (prior[key] === undefined) delete process.env[key]; else process.env[key] = prior[key];
    assert.ok(resolve(root).startsWith(`${resolve(tmpdir())}${sep}whale-project-preparation-dependency-`)); await rm(root, { recursive: true, force: true });
  }
});

test('native Team capacity holds accepted work in its queue and starts it after another member drains', { timeout: 120000 }, async t => {
  for (const teamConfig of [{ maxMembers: 1 }, { maxTasks: 1 }, { maxMembers: 1, releaseBeforeQueue: true }]) await t.test(Object.keys(teamConfig)[0] + (teamConfig.releaseBeforeQueue ? ' release before queue commit' : ''), async () => {
    const root = await mkdtemp(join(tmpdir(), 'whale-project-capacity-')), home = join(root, 'home'), directory = join(root, 'selected');
    await mkdir(home); await mkdir(directory); const bridge = await desktopBridge(root); let ctx;
    const keys = ['DSH_HOME', 'DSHD_HOME', 'DSH_DESKTOP_INSTALL_URL', 'DSH_DESKTOP_INSTALL_TOKEN'], prior = Object.fromEntries(keys.map(key => [key, process.env[key]]));
    Object.assign(process.env, { DSH_HOME: home, DSHD_HOME: home, DSH_DESKTOP_INSTALL_URL: bridge.address, DSH_DESKTOP_INSTALL_TOKEN: 'composition-secret' });
    try {
      const model = new ScriptedModel(); const { releaseBeforeQueue, ...limits } = teamConfig; ctx = await bootHost(home, model, limits); const host = ctx.projects;
      let releaseFailure, failureObserved = false;
      if (releaseBeforeQueue) { const spawn = ctx.agentTeams.spawnTeammate.bind(ctx.agentTeams), gate = new Promise(done => { releaseFailure = done; }); ctx.agentTeams.spawnTeammate = async (...args) => { try { return await spawn(...args); } catch (error) { if (error.code === 'TEAM_MEMBER_LIMIT') { failureObserved = true; await gate; } throw error; } }; }
      const { project } = await host.command('create', { requestId: 'create-capacity', workingDirectory: directory });
      const prompt = text => ctx.sessionController.prompt({ sessionId: project.coordinatorSessionId, requestId: text, mode: 'queue', content: [{ type: 'text', text }] }, signal);
      await prompt('CAPACITY_HOLDER'); const holder = await waitFor(() => host.state().workstreams.find(work => work.title === 'Capacity holder' && host.worker(work.workerSessionId).activeRunId), 'first native teammate is running');
      await ctx.agents.get(project.coordinatorSessionId).whenIdle(); await prompt('CAPACITY_WAITING');
      if (releaseBeforeQueue) { await waitFor(() => failureObserved, 'native member capacity rejected before the Project queue commit'); await host.command('stop', { projectId: project.id, workstreamId: holder.id }); await Promise.all([...host.stops.values()]); releaseFailure(); }
      await ctx.agents.get(project.coordinatorSessionId).whenIdle();
      const waiting = host.state().workstreams.find(work => work.title === 'Capacity waiting'), receipt = waiting.delegations[0];
      if (!releaseBeforeQueue) { assert.equal(receipt.phase, 'queued'); assert.equal(receipt.error, ''); assert.equal(waiting.status, 'open'); assert.equal(host.worker(waiting.workerSessionId).directoryHeld, false);
        assert.deepEqual(receipt.waitingReason, { kind: 'capacity', workTitles: [], code: teamConfig.maxTasks ? 'TEAM_TASK_LIMIT' : 'TEAM_MEMBER_LIMIT' }); }
      assert.equal(model.failures.some(item => item.name === 'project_delegate'), false, 'normal capacity waiting is not a failed tool call');
      if (!releaseBeforeQueue) await host.command('stop', { projectId: project.id, workstreamId: holder.id });
      await waitFor(() => host.stream(waiting.id).status === 'done', 'queued original work starts after capacity release');
      assert.equal(host.stream(waiting.id).delegations[0].waitingReason, undefined);
      assert.equal(host.stream(waiting.id).workerSessionId, waiting.workerSessionId); assert.equal(host.stream(waiting.id).delegations.length, 1);
      assert.equal(ctx.agentTeams.getTask(ctx.agents.get(project.coordinatorSessionId), waiting.id).status, 'completed');
    } finally {
      if (ctx) await ctx.fiber.dispose(); await bridge.close();
      for (const key of keys) if (prior[key] === undefined) delete process.env[key]; else process.env[key] = prior[key];
      assert.ok(resolve(root).startsWith(`${resolve(tmpdir())}${sep}whale-project-capacity-`)); await rm(root, { recursive: true, force: true });
    }
  });
});

test('native task capacity releases a failed pre-child launch and recovers its original identity', { timeout: 120000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'whale-project-failed-capacity-')), home = join(root, 'home'), directory = join(root, 'selected'), moved = join(root, 'temporarily-moved');
  await mkdir(home); await mkdir(directory); const bridge = await desktopBridge(root); let ctx;
  const keys = ['DSH_HOME', 'DSHD_HOME', 'DSH_DESKTOP_INSTALL_URL', 'DSH_DESKTOP_INSTALL_TOKEN'], prior = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  Object.assign(process.env, { DSH_HOME: home, DSHD_HOME: home, DSH_DESKTOP_INSTALL_URL: bridge.address, DSH_DESKTOP_INSTALL_TOKEN: 'composition-secret' });
  try {
    const model = new DependencyModel(); ctx = await bootHost(home, model, { maxTasks: 1 });
    const host = ctx.projects, { project } = await host.command('create', { requestId: 'failed-capacity', workingDirectory: directory });
    let sequence = 0;
    const prompt = async action => {
      await ctx.sessionController.prompt({ sessionId: project.coordinatorSessionId, requestId: `failed-capacity-${++sequence}`, mode: 'queue',
        content: [{ type: 'text', text: `DEPENDENCY_ACTIONS:${JSON.stringify([action])}` }] }, signal);
      await ctx.agents.get(project.coordinatorSessionId).whenIdle();
    };
    await rename(directory, moved);
    await prompt({ title: 'Missing directory', brief: 'Inspect the selected directory' });
    const failed = host.state().workstreams.find(work => work.title === 'Missing directory'), workerId = failed.workerSessionId, failedRef = failed.currentDelegationRef;
    assert.equal(failed.delegations[0].phase, 'failed'); assert.match(failed.delegations[0].error, /ENOENT/);
    assert.equal(host.worker(workerId).materialized, false); assert.equal(host.worker(workerId).reservationRef, '');
    assert.equal(await ctx.sessionPersistence.stat(workerId), undefined);
    const lead = ctx.agents.get(project.coordinatorSessionId);
    assert.equal(ctx.agentTeams.getTask(lead, failed.id).status, 'pending', 'cold does not manufacture completion');
    assert.equal(lead.session.snapshotEvents().filter(event => event.type === 'team/control' && event.data.control.kind === 'cold' && event.data.control.taskId === failed.id).at(-1)?.data.control.cold, true);
    await rename(moved, directory);
    await prompt({ title: 'After failure', brief: 'Complete after the failed launch released its task slot' });
    await waitFor(() => host.state().workstreams.find(work => work.title === 'After failure')?.status === 'done', 'new native task starts with maxTasks one after pre-child failure');
    const completedId = host.state().workstreams.find(work => work.title === 'After failure').id;
    await waitFor(() => lead.session.snapshotEvents().filter(event => event.type === 'team/control' && event.data.control.kind === 'cold' && event.data.control.taskId === completedId).at(-1)?.data.control.cold === true, 'completed native task releases capacity after its Project result is recorded');
    await lead.whenIdle();
    // Reproduce the durable pre-fix record through the native management API.
    await ctx.agentTeams.setCold(lead, workerId, failed.id, false);
    await ctx.fiber.dispose(); ctx = undefined;
    const restarted = new DependencyModel(); restarted.counter = model.counter;
    ctx = await bootHost(home, restarted, { maxTasks: 1 });
    const recovered = ctx.projects;
    assert.equal(restarted.requests.length, 0, 'reconciliation does not start models');
    assert.equal(recovered.stream(failed.id).workerSessionId, workerId);
    assert.equal(recovered.stream(failed.id).currentDelegationRef, failedRef);
    assert.match(recovered.stream(failed.id).delegations[0].error, /ENOENT/);
    assert.equal(recovered.worker(workerId).stopped, true);
    assert.equal(ctx.agents.get(project.coordinatorSessionId).session.snapshotEvents().filter(event => event.type === 'team/control' && event.data.control.kind === 'cold' && event.data.control.taskId === failed.id).at(-1)?.data.control.cold, true, 'recovery releases the legacy failed native task before any model request');
    await prompt({ title: 'After restart', brief: 'Complete after recovery released the old failed task' });
    await waitFor(() => recovered.state().workstreams.find(work => work.title === 'After restart')?.status === 'done', 'legacy failed task no longer consumes the only task slot');
    await ctx.agents.get(project.coordinatorSessionId).whenIdle();
    await prompt({ work: 'Missing directory', brief: 'Continue the original task now its directory is restored' });
    await waitFor(() => recovered.stream(failed.id).status === 'done', 'explicit continuation activates the original failed task');
    assert.equal(recovered.stream(failed.id).workerSessionId, workerId);
    assert.equal(recovered.stream(failed.id).delegations[0].ref, failedRef);
    assert.equal(ctx.agentTeams.getTask(ctx.agents.get(project.coordinatorSessionId), failed.id).status, 'completed');
  } finally {
    if (ctx) await ctx.fiber.dispose(); await bridge.close();
    for (const key of keys) if (prior[key] === undefined) delete process.env[key]; else process.env[key] = prior[key];
    assert.ok(resolve(root).startsWith(`${resolve(tmpdir())}${sep}whale-project-failed-capacity-`)); await rm(root, { recursive: true, force: true });
  }
});

test('a failed native Lead summary preserves its report and ordinary user summary consumes only delivered facts', { timeout: 120000 }, async () => {
  class FailedSummaryModel extends ScriptedModel {
    failWorker = false;
    async *stream(options) {
      const input = options.messages.findLast(message => message.role === 'user' && ['user', 'subagent-settled'].includes(message.source.kind));
      if (this.failWorker && options.tools?.some(tool => tool.name === 'project_report')) {
        this.requests.push(options);
        throw new LlmError('The scripted worker failed before it could report.', 'MISSING_CREDENTIAL');
      }
      if (options.tools?.some(tool => tool.name === 'project_delegate') && input?.source.kind === 'subagent-settled') {
        this.requests.push(options);
        throw new LlmError('The scripted summary provider has no credential.', 'MISSING_CREDENTIAL');
      }
      if (options.tools?.some(tool => tool.name === 'project_delegate') && messageText(input ?? {}).includes('READ_TERMINAL')) {
        this.requests.push(options);
        const key = `terminal-summary:${input.id}`, stage = this.stages.get(key) ?? 0; this.stages.set(key, stage + 1);
        if (!stage) yield* call(`terminal-notes-${++this.counter}`, 'project_read_store', { path: 'notes.md' });
        else {
          const result = options.messages.findLast(message => message.role === 'tool');
          assert.match(messageText(result), /^\{/, messageText(result));
          const facts = JSON.parse(messageText(result)).work.find(work => work.title === 'Readonly work');
          assert.equal(facts.report, undefined); assert.ok(facts.terminal);
          yield* blocks(`Readonly work ended ${facts.terminal.stopReason}; it did not supply a report. The saved terminal remains available.`);
        }
        return;
      }
      yield* super.stream(options);
    }
  }
  const root = await mkdtemp(join(tmpdir(), 'whale-project-summary-')), home = join(root, 'home'), directory = join(root, 'selected');
  await mkdir(home); await mkdir(directory); const bridge = await desktopBridge(root); let ctx;
  const keys = ['DSH_HOME', 'DSHD_HOME', 'DSH_DESKTOP_INSTALL_URL', 'DSH_DESKTOP_INSTALL_TOKEN', 'DSH_TELEMETRY_DISABLED'], prior = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  Object.assign(process.env, { DSH_HOME: home, DSHD_HOME: home, DSH_DESKTOP_INSTALL_URL: bridge.address, DSH_DESKTOP_INSTALL_TOKEN: 'composition-secret', DSH_TELEMETRY_DISABLED: '1' });
  try {
    const model = new FailedSummaryModel(); ctx = await bootHost(home, model); const host = ctx.projects;
    const { project } = await host.command('create', { requestId: 'summary-failure', workingDirectory: directory });
    const lead = ctx.agents.get(project.coordinatorSessionId);
    const prompt = (text, requestId) => ctx.sessionController.prompt({ sessionId: lead.id, requestId, mode: 'queue', content: [{ type: 'text', text }] }, signal);
    await prompt('MAKE_DOCS', 'create-report');
    const work = await waitFor(() => host.state().workstreams.find(item => item.summaryFailure), 'real failed Lead turn records the matching current result failure');
    await lead.whenIdle(); await host.tail;
    const failure = structuredClone(host.stream(work.id).summaryFailure), report = structuredClone(host.stream(work.id).latestReport);
    const failedEnd = lead.session.snapshotEvents().find(event => event.type === 'turn/end' && event.data.turn === failure.turn);
    assert.equal(failedEnd.data.reason.kind, 'error'); assert.deepEqual(failure.error, failedEnd.data.reason.error);
    assert.equal(failure.delegationRef, report.delegationRef); assert.equal(host.stream(work.id).pendingSummary, true);
    const projection = await host.command('detail', { projectId: project.id });
    assert.equal(projection.project.activity.summaryFailed, 1); assert.equal(projection.project.activity.pendingSummary, 0);
    assert.equal(projection.project.activity.state, 'summaryFailed'); assert.deepEqual(projection.workstreams[0].summaryFailure, failure);
    const disk = JSON.parse(await readFile(join(home, 'storages', 'whale_project_local.json'), 'utf8'));
    assert.deepEqual(disk.tables.state.catalog.workstreams[0].summaryFailure, failure, 'the actual storage schema preserves the failure');
    const workerRequests = model.requests.filter(options => options.tools?.some(tool => tool.name === 'project_report')).length;
    const workerId = work.workerSessionId, refs = host.stream(work.id).delegations.map(item => item.ref);
    await prompt('READ_PENDING', 'human-retry-summary'); await lead.whenIdle(); await host.tail;
    assert.equal(host.stream(work.id).summaryFailure, undefined); assert.equal(host.stream(work.id).pendingSummary, false);
    const delivered = host.stream(work.id).latestReport;
    assert.ok(delivered.summarizedBy); assert.deepEqual({ ...delivered, summarizedBy: undefined }, { ...report, summarizedBy: undefined });
    assert.equal(host.stream(work.id).workerSessionId, workerId); assert.deepEqual(host.stream(work.id).delegations.map(item => item.ref), refs);
    assert.equal(model.requests.filter(options => options.tools?.some(tool => tool.name === 'project_report')).length, workerRequests, 'summary retry does not reopen the member');
    assert.equal(lead.session.snapshotEvents().filter(event => event.type === 'turn/end' && event.data.reason.kind === 'error').length, 1, 'failure does not schedule an automatic retry');
    model.failWorker = true;
    await prompt('READ_ONLY', 'create-no-report-failure');
    const noReport = await waitFor(() => host.state().workstreams.find(item => item.title === 'Readonly work' && item.summaryFailure), 'an actual no-report worker error and failed Lead summary remain actionable');
    await lead.whenIdle(); await host.tail;
    const current = host.stream(noReport.id), terminal = current.settlements.find(item => item.runId === current.summaryFailure.runId);
    assert.equal(current.latestReport, undefined); assert.equal(current.delegations[0].report, undefined);
    assert.ok(terminal); assert.ok(terminal.delegationRefs.includes(current.currentDelegationRef)); assert.equal(terminal.summarizedBy, '');
    const workerEvents = (await ctx.sessionController.inspect(current.workerSessionId)).events;
    assert.ok(workerEvents.some(event => event.type === 'turn/end' && event.data.reason.kind === 'error'));
    const requestsBeforeRetry = model.requests.filter(options => options.tools?.some(tool => tool.name === 'project_report')).length;
    const identity = current.workerSessionId, ref = current.currentDelegationRef;
    await prompt('READ_TERMINAL', 'human-retry-terminal'); await lead.whenIdle(); await host.tail;
    const summarized = host.stream(noReport.id);
    assert.equal(summarized.summaryFailure, undefined); assert.equal(summarized.pendingSummary, false);
    assert.equal(summarized.workerSessionId, identity); assert.equal(summarized.currentDelegationRef, ref);
    assert.ok(summarized.settlements.find(item => item.runId === terminal.runId).summarizedBy);
    assert.equal(summarized.latestReport, undefined, 'summary never fabricates a worker report');
    assert.equal(model.requests.filter(options => options.tools?.some(tool => tool.name === 'project_report')).length, requestsBeforeRetry);
  } finally {
    if (ctx) await ctx.fiber.dispose(); await bridge.close();
    for (const key of keys) if (prior[key] === undefined) delete process.env[key]; else process.env[key] = prior[key];
    assert.ok(resolve(root).startsWith(`${resolve(tmpdir())}${sep}whale-project-summary-`)); await rm(root, { recursive: true, force: true });
  }
});

test('failed warm admission keeps occupancy, expanding stops drain every worker, and notes reject junction replacement', async () => {
  const root = await mkdtemp(join(tmpdir(), 'whale-project-boundaries-')), home = join(root, 'home'), directory = join(root, 'selected'), store = join(home, 'projects', 'project-a');
  assert.ok(resolve(root).startsWith(`${resolve(tmpdir())}${sep}whale-project-boundaries-`));
  await mkdir(directory); await mkdir(join(store, 'docs'), { recursive: true });
  let state = { revision: 0, projects: [{ id: 'project-a', title: 'Boundary', coordinatorSessionId: 'parent', canonicalWorkingDirectory: await realpath(directory), storageRoot: await realpath(store), paused: false, lifecycle: 'ready', diagnostics: [] }], workers: [], workstreams: [] };
  const cancelled = [], drained = [], agents = new Map([['parent', { id: 'parent', cancel() {}, session: { snapshotEvents: () => [] } }]]); let releaseA;
  const gateA = new Promise(done => { releaseA = done; });
  const addWorker = suffix => {
    const id = `worker-${suffix}`, streamId = `work-${suffix}`, ref = `ref-${suffix}`;
    state.workstreams.push({ id: streamId, projectId: 'project-a', title: suffix, brief: 'Authorized continuation', workerSessionId: id, status: 'running', currentDelegationRef: ref,
      settlements: [], pendingSummary: false, delegations: [{ ref, scope: 'worker', writePaths: [], phase: 'queued', source: { messageId: `user-${suffix}` } }] });
    state.workers.push({ sessionId: id, projectId: 'project-a', workstreamId: streamId, cwd: state.projects[0].canonicalWorkingDirectory, role: 'worker', mode: 'existing', phase: 'active', directoryHeld: true, materialized: true, stopped: false, consumedDelegationRef: ref });
    const agent = { id, status: 'running', cancel() { cancelled.push(id); }, async whenIdle() { if (suffix === 'a') await gateA; agent.status = 'idle'; } }; agents.set(id, agent);
    return id;
  };
  const tasks = new Map();
  const ctx = { sessionPersistence: { stat: async () => ({}) }, agentTeams: { registerPolicy: () => () => {}, bindPolicy: async () => {}, cancelMessages: async () => {}, setCold: async () => {}, listTasks: () => [...tasks.values()], createTask: async (_root, input) => { if (!tasks.has(input.taskId)) tasks.set(input.taskId, { id: input.taskId, subject: input.subject, description: input.description, blockedBy: [], status: 'in_progress', ready: true }); return tasks.get(input.taskId); }, getTask: (_root, id) => tasks.get(id) }, agents, get: name => name === 'jobs' ? { list: () => [] } : undefined, logger: { warn() {} }, subagents: {
    registerContinuationPolicy: () => () => {}, async drainContinuableChildren(_parent, ids) { drained.push(...ids); if (ids.includes('worker-a')) await gateA; },
  } };
  const table = { get: () => state, async update(_key, change) { state = change(state); } };
  const service = new ProjectService(ctx, table, { home, desktop: async () => { throw new Error('Actual binding changed'); } });
  service.recovering = false; service.notes = async () => {}; service.schedule = () => {};
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
    service.held.clear(); service.projectHolds.clear(); // Simulate a newly accepted user continuation in this isolated admission fixture.
    const reservations = [service.launch('work-a'), service.launch('work-b')];
    await waitFor(() => reservationCalls === 1, 'one launch atomically owns the shared writable directory');
    assert.equal(service.state().workers.filter(worker => worker.directoryHeld).length, 1);
    assert.equal(service.state().workstreams.filter(work => work.delegations[0].phase === 'queued').length, 1);
    releaseDirectory(); await Promise.allSettled(reservations); assert.equal(reservationCalls, 1);
    await service.write(next => { for (const work of next.workstreams) { work.title = work.id === 'work-a' ? 'Plan' : 'Implement Plan'; work.pendingSummary = true; work.settlements = [{ runId: `native-${work.id}`, summarizedBy: '' }]; } });
    const parentSession = agents.get('parent').session; parentSession.id = 'parent';
    service.consume('parent', 1, service.state().workstreams.filter(work => work.id === 'work-b').map(work => ({ id: work.id, runs: [`native-${work.id}`], reports: [] })));
    const reply = text => service.assistantReply(parentSession, { type: 'assistant/message', data: { turn: 1, interrupted: false, message: { id: `reply-${text}`, content: [{ type: 'text', text }] } } });
    await reply('Implement Plan: the result is ready.');
    assert.equal(service.stream('work-a').pendingSummary, true); assert.equal(service.stream('work-b').pendingSummary, false, 'only the explicit consumed result is associated with this reply');
    await reply('Implement Plan (work-b): the result is ready.');
    assert.equal(service.stream('work-a').pendingSummary, true); assert.equal(service.stream('work-b').pendingSummary, false);
    service.notes = ProjectService.prototype.notes;
    const outside = join(root, 'outside'); await mkdir(outside); await writeFile(join(outside, 'notes.md'), 'OWNED_EXTERNAL_SENTINEL');
    await rename(store, `${store}-original`); await symlink(outside, store, process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(() => service.notes('project-a'), /replaced with a link|points outside/);
    assert.equal(await readFile(join(outside, 'notes.md'), 'utf8'), 'OWNED_EXTERNAL_SENTINEL');
  } finally { releaseA(); await Promise.all([...service.stops.values()]); service.unpolicy(); await rm(root, { recursive: true, force: true }); }
});
