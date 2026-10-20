/** Real Loader/Sessions/continuations/tools/storage; only external model and desktop I/O are scripted. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, readFile, realpath, rm, rename, symlink } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { projectPackage, harness, cliRequire, resolvePackage, ProjectService } from './harness-runtime.mjs';
const { boot, loadOverlayPatches, bundlePatchPaths, composeEntries } = await import(pathToFileURL(resolvePackage('@deepseek-ai/dsh-app-boot')).href);
const { LlmAdapter, LlmError } = await import(pathToFileURL(resolvePackage('@deepseek-ai/dsh-llm')).href);
const { provideCmdline } = await import(pathToFileURL(resolvePackage('@deepseek-ai/dsh-cmdline')).href);
const { disposeProfileApplication } = await import(pathToFileURL(join(harness, 'apps/cli/lib/profile-boot.js')).href);
const { FiberState } = await import(pathToFileURL(resolvePackage('@deepseek-ai/cordis')).href);
const { default: TeamService } = await import(pathToFileURL(resolvePackage('@deepseek-ai/dsh-experimental-agent-team')).href);
const teamUi = await import(pathToFileURL(resolvePackage('@deepseek-ai/dsh-experimental-client-ui-agent-team')).href);
const { ensureDesktopDshProject } = cliRequire(join(projectPackage, '../../src/main/dsh-project-desktop.js'));
const blocks = value => [{ type: 'block-start', index: 0, blockType: 'text' }, { type: 'text-delta', index: 0, text: value }, { type: 'block-end', index: 0, block: { type: 'text', text: value } }, { type: 'finish', reason: { kind: 'stop' } }];
const call = (id, name, args) => [{ type: 'block-start', index: 0, blockType: 'tool-call' }, { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: JSON.stringify(args) }, { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: JSON.stringify(args) } }, { type: 'finish', reason: { kind: 'tool-calls' } }];
const messageText = message => (message.content ?? []).filter(block => block.type === 'text').map(block => block.text).join('\n');
const signal = new AbortController().signal;
const scopedDocument = '鲸'.repeat(170666) + '\nA'; // Exactly 512000 UTF-8 bytes, two readable lines.
const waitFor = async (read, reason, timeout = 20000) => { const start = Date.now(); while (Date.now() - start < timeout) { const value = await read(); if (value) return value; await new Promise(done => setTimeout(done, 20)); } console.error(`Timed out: ${reason}`); throw new Error(`Timed out: ${reason}`); };
const toolFacts = options => JSON.parse(messageText(options.messages.findLast(message => message.role === 'tool')));
const handover = (request, summary, outcome = 'partial', remainingIssues = ['Real-provider and visible desktop acceptance remain outside this Host check.']) => ({
  requestId: request.id, requestRevision: request.revision, summary, outcome, evidence: ['Actual native tools, reports and settlement in this Host composition.'], remainingIssues,
  reportRefs: request.requiredWork.filter(item => item.reportId && item.stopReason).map(({ workstreamId, delegationRef, reportId }) => ({ workstreamId, delegationRef, reportId })),
  terminalRefs: request.requiredWork.filter(item => !item.reportId && item.stopReason).map(({ workstreamId, delegationRef, runId }) => ({ workstreamId, delegationRef, runId })),
});

class ScriptedModel extends LlmAdapter {
  requests = []; failures = []; stages = new Map(); settlementInputs = []; counter = 0; state = () => null;
  sharedInputs = new Set(); sharedDeclarations = new Map(); workflowId;
  workflow() { return this.state()?.requests.find(row => row.id === this.workflowId) ?? this.state()?.requests.find(row => row.queue?.state === 'active' && !row.queue.released); }
  pendingHandovers = new Map();
  coordinatorWaiting = false; coordinatorGate = new Promise(done => { this.releaseCoordinator = done; });
  async resolveModel(provider, model) { return { provider, id: model, name: model }; }
  async *stream(options) {
    this.requests.push(options); const names = (options.tools ?? []).map(tool => tool.name);
    if (names.includes('project_delegate')) {
      const input = options.messages.findLast(message => message.role === 'user' && ['user', 'subagent-settled'].includes(message.source.kind));
      const key = `coordinator:${input?.id}`, rawStage = this.stages.get(key) ?? 0; this.stages.set(key, rawStage + 1);
      const text = input ? messageText(input) : '';
      const sharedAction = input?.source.kind === 'user' && /^(MAKE_DOCS|IMPLEMENT_PLAN|HOLD_WORK|PEER_RECEIVER|PEER_DEPENDENT|PEER_SENDER|READ_ONLY|MAKE_PATH_HOLD|EXTEND_DOC_PATHS|CAPACITY_HOLDER|CAPACITY_WAITING)$/.test(text);
      if (sharedAction && !rawStage) {
        this.sharedInputs.add(input.id); const row = this.workflow();
        const scope = ['MAKE_DOCS', 'MAKE_PATH_HOLD', 'EXTEND_DOC_PATHS'].includes(text) ? 'docs' : ['IMPLEMENT_PLAN', 'HOLD_WORK'].includes(text) ? 'development' : 'readonly';
        const paths = text === 'MAKE_DOCS' ? ['docs/plan.md'] : text === 'MAKE_PATH_HOLD' ? ['docs/first.md'] : text === 'EXTEND_DOC_PATHS' ? ['docs/first.md', 'docs/second.md'] : [];
        const version = row?.versions.find(item => item.revision === row.revision), revise = !row || this.state().projects.some(project => project.paused)
          || version.scope !== ({ development: 'worker' }[scope] ?? scope) || JSON.stringify(version.writePaths) !== JSON.stringify(paths)
          || text === 'HOLD_WORK' && this.state().workstreams.some(work => work.title === 'Plan work' && this.state().workers.find(worker => worker.sessionId === work.workerSessionId)?.stopped);
        this.sharedDeclarations.set(input.id, revise);
        yield* call(`workflow-request-${++this.counter}`, 'project_request', { ...(revise && row ? { requestId: row.id } : {}), title: revise ? 'Native workflow' : `Discuss workflow instruction ${this.counter}`, disposition: revise ? 'queued' : 'discussing',
          goal: `Continue the same whole native workflow, preserving correct prior work. Current human instruction: ${text}.`,
          conditions: ['Complete the currently requested stage and report its real evidence'], constraints: ['Preserve existing correct work and the original directory'], scopeCeiling: scope, writePaths: paths }); return;
      }
      if (sharedAction && rawStage === 1 && this.sharedDeclarations.get(input.id)) this.workflowId = toolFacts(options).id;
      const stage = rawStage - (this.sharedInputs.has(input?.id) ? 1 : 0);
      const delegate = (id, args) => { const row = this.workflow(); return call(id, 'project_delegate', { ...args, ...(row ? { requestId: row.id, requestRevision: row.revision } : {}) }); };
      if (text.includes('PAUSE_OLD_DELEGATE')) {
        if (!stage) yield* call(`notes-${++this.counter}`, 'project_read_store', { path: 'notes.md' });
        else if (stage === 1) { this.coordinatorWaiting = true; await this.coordinatorGate; yield* call(`late-${++this.counter}`, 'project_delegate', { title: 'Stopped old request', brief: 'Must not restart', scope: 'readonly' }); }
        else yield* blocks('The old request is stopped.'); return;
      }
      const pathWork = this.state()?.workstreams.find(item => item.title === 'Path work');
      if (text.includes('MAKE_PATH_HOLD') && stage === 1) { yield* delegate(`expand-${++this.counter}`, { workstreamId: pathWork.id, brief: 'Unauthorized path expansion', scope: 'docs', writePaths: ['docs/first.md', 'docs/second.md'] }); return; }
      if (input?.source.kind === 'subagent-settled') {
        const appendix = input.content.find(block => block.type === 'text' && block.text.startsWith('Project recorded outcome for this native settlement'));
        assert.ok(appendix, 'the real native notice must carry the persisted Project outcome even with no closing prose');
        const facts = JSON.parse(appendix.text.split('\n')[1]); assert.equal(facts.runId, input.source.runId);
        if (!stage) {
          this.settlementInputs.push({ id: input.id, source: input.source, text, facts });
          yield* call(`outcome-notes-${++this.counter}`, 'project_read_store', { path: 'notes.md', requestId: facts.request.id }); return;
        }
        if (stage === 1) {
          const request = toolFacts(options).requests.find(item => item.id === facts.request.id); assert.ok(request);
          const declaration = handover(request, `${facts.title}: native results are available.`);
          declaration.reportRefs = declaration.reportRefs.filter(reference => !this.state().workstreams.find(work => work.id === reference.workstreamId).delegations.find(receipt => receipt.ref === reference.delegationRef).report.summarizedBy);
          declaration.terminalRefs = declaration.terminalRefs.filter(reference => !this.state().workstreams.find(work => work.id === reference.workstreamId).settlements.find(terminal => terminal.runId === reference.runId).summarizedBy);
          yield* call(`handover-${++this.counter}`, 'project_deliver', declaration); return;
        }
        yield* blocks(`${facts.title}: ${facts.reports.map(report => report.summary).join('; ') || `Worker ended ${facts.stopReason}`}. This is a worker report, not an independent verification.`); return;
      }
      if (text.includes('READ_PENDING')) {
        if (!stage) yield* call(`notes-${++this.counter}`, 'project_read_store', { path: 'notes.md' });
        else if (!this.pendingHandovers.get(input.id)?.declared) {
          const facts = toolFacts(options), work = facts.work.find(item => item.title === 'Plan work');
          const saved = this.pendingHandovers.get(input.id) ?? { request: facts.requests.find(item => item.id === work.request.id), reports: new Map(), terminals: new Map() };
          assert.ok(saved.request); this.pendingHandovers.set(input.id, saved);
          for (const item of [{ report: work.report, terminal: work.terminal }, ...(facts.history?.items ?? [])]) {
            if (item.report) saved.reports.set(item.report.delegationRef, { workstreamId: work.id, delegationRef: item.report.delegationRef, reportId: item.report.callId });
            if (item.terminal) for (const delegationRef of item.terminal.delegationRefs) saved.terminals.set(delegationRef, { workstreamId: work.id, delegationRef, runId: item.terminal.runId });
          }
          if (!facts.history || facts.history.nextCursor) yield* call(`history-${++this.counter}`, 'project_read_store', { path: 'notes.md', workstreamId: work.id, ...(facts.history?.nextCursor ? { cursor: facts.history.nextCursor } : {}) });
          else {
            saved.declared = true;
            yield* call(`retry-handover-${++this.counter}`, 'project_deliver', { ...handover(saved.request, 'Plan work: saved results and unresolved work are preserved.'),
              reportRefs: [...saved.reports.values()], terminalRefs: [...saved.terminals.values()].filter(item => !saved.reports.has(item.delegationRef)) });
          }
        } else yield* blocks('Plan work: the worker outcome is recorded; its evidence is a worker report, not an independent verification.'); return;
      }
      if (stage || text.includes('SHORT_QUESTION')) { yield* blocks('The Project conversation is ready.'); return; }
      const stream = this.state()?.workstreams.find(item => item.title === 'Plan work');
      if (text.includes('CAPACITY_HOLDER')) yield* delegate(`delegate-${++this.counter}`, { title: 'Capacity holder', brief: 'HOLD_FOR_STOP', scope: 'readonly' });
      else if (text.includes('CAPACITY_WAITING')) yield* delegate(`delegate-${++this.counter}`, { title: 'Capacity waiting', brief: 'Complete after capacity is released', scope: 'readonly' });
      else if (text.includes('PEER_RECEIVER')) yield* delegate(`delegate-${++this.counter}`, { title: 'Peer receiver', brief: 'WAIT_FOR_PEER_EVIDENCE', scope: 'readonly' });
      else if (text.includes('PEER_DEPENDENT')) yield* delegate(`delegate-${++this.counter}`, { title: 'Dependent work', brief: 'AFTER_PEER_EVIDENCE', scope: 'readonly', blockedBy: [this.state().workstreams.find(work => work.title === 'Peer receiver').id] });
      else if (text.includes('PEER_SENDER')) yield* delegate(`delegate-${++this.counter}`, { title: 'Peer sender', brief: 'SEND_PEER_EVIDENCE', scope: 'readonly' });
      else if (text.includes('MAKE_PATH_HOLD')) yield* delegate(`delegate-${++this.counter}`, { title: 'Path work', brief: 'HOLD_FOR_PATH_CHANGE', scope: 'docs', writePaths: ['docs/first.md'] });
      else if (text.includes('EXTEND_DOC_PATHS')) yield* delegate(`delegate-${++this.counter}`, { workstreamId: pathWork.id, brief: 'WRITE_EXTRA_DOC', scope: 'docs', writePaths: ['docs/first.md', 'docs/second.md'] });
      else if (text.includes('DOCS_CODE_PATH')) yield* call(`delegate-${++this.counter}`, 'project_delegate', { title: 'Invalid docs', brief: 'Change code as docs', scope: 'docs', writePaths: ['src/forbidden.js'] });
      else if (text.includes('MAKE_DOCS')) yield* delegate(`delegate-${++this.counter}`, { title: 'Plan work', brief: 'WRITE_PLAN', scope: 'docs', writePaths: ['docs/plan.md'] });
      else if (text.includes('IMPLEMENT_PLAN')) yield* delegate(`delegate-${++this.counter}`, { workstreamId: stream.id, brief: 'DEVELOP_CONTINUE', scope: 'development' });
      else if (text.includes('HOLD_WORK')) yield* delegate(`delegate-${++this.counter}`, { workstreamId: stream.id, brief: 'HOLD_FOR_STOP', scope: 'development' });
      else if (text.includes('READ_ONLY')) yield* delegate(`delegate-${++this.counter}`, { title: 'Readonly work', brief: 'READONLY_GUARD', scope: 'readonly' });
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
  dependencyDeclarations = new Map();
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
      const actions = JSON.parse(messageText(input).slice('DEPENDENCY_ACTIONS:'.length)), rawStage = this.actions.get(input.id) ?? 0;
      this.actions.set(input.id, rawStage + 1);
      if (!rawStage) {
        const row = this.workflow(), revise = !row || this.state().projects.some(project => project.paused) || actions.some(action => action.work && this.state().workstreams.some(work => work.title === action.work && this.state().workers.find(worker => worker.sessionId === work.workerSessionId)?.stopped));
        this.dependencyDeclarations.set(input.id, revise);
        yield* call(`dependency-request-${++this.counter}`, 'project_request', { ...(revise && row ? { requestId: row.id } : {}),
          title: revise ? 'Dependency workflow' : `Discuss dependency instruction ${this.counter}`, disposition: revise ? 'queued' : 'discussing',
          goal: revise ? 'Complete this continuing readonly dependency workflow, including parallel prerequisite stages and later dependency adjustments.' : `The user requested these stages within the existing workflow: ${actions.map(item => item.title ?? item.work).join(', ')}.`,
          constraints: ['Keep the original members and completed evidence'], conditions: ['Complete the requested stages according to their current dependencies'], scopeCeiling: 'readonly' }); return;
      }
      if (rawStage === 1 && this.dependencyDeclarations.get(input.id)) this.workflowId = toolFacts(options).id;
      const stage = rawStage - 1;
      if (stage >= actions.length) { yield* blocks('Dependency request processed.'); return; }
      const action = actions[stage], work = action.work && this.state().workstreams.find(item => item.title === action.work);
      if (action.awaitRunning) await waitFor(() => this.workerInputs.some(item => item.ref === this.state().workstreams.find(item => item.title === action.work)?.currentDelegationRef), 'original request reaches the real worker before dependency adjustment');
      if (action.gate) { this.coordinatorGates.add(action.gate); await this.gate(action.gate).promise; }
      const row = this.workflow(), args = { requestId: row.id, requestRevision: row.revision, title: action.title, brief: action.brief, scope: 'readonly', ...(work ? { workstreamId: work.id } : {}),
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

/** Script only user/model decisions; queue admission, notices and deliveries remain native. */
class QueueModel extends DependencyModel {
  holdTitles = new Set(); isolateTitles = new Set(); deliveryBarriers = new Set(); barriersReached = new Set(); queueInputs = []; workerAborts = []; streamErrors = [];
  async barrier(name, signal) {
    this.barriersReached.add(name);
    await new Promise((done, reject) => {
      const abort = () => reject(new Error('scripted queue model cancelled'));
      if (signal?.aborted) { abort(); return; }
      signal?.addEventListener('abort', abort, { once: true });
      this.gate(name).promise.then(() => { signal?.removeEventListener('abort', abort); done(); });
    });
  }
  row(title) { const row = this.state().requests.find(item => item.title === title); assert.ok(row, title); return row; }
  delegate(row) {
    const work = this.state().workstreams.find(item => item.delegations.at(-1).source.requestId === row.id);
    return { requestId: row.id, requestRevision: row.revision, ...(work ? { workstreamId: work.id } : { title: `${row.title} work`, ...(this.isolateTitles.has(row.title) ? { isolate: true } : {}) }), brief: `QUEUE_WORK:${row.title}`, scope: 'development' };
  }
  async *stream(options) {
    try { yield* this.queueStream(options); }
    catch (error) { if (!options.signal.aborted) this.streamErrors.push(error); throw error; }
  }
  async *queueStream(options) {
    this.requests.push(options);
    const names = (options.tools ?? []).map(tool => tool.name);
    if (!names.length) { yield* blocks('Queued project development'); return; }
    if (names.includes('project_request')) {
      const input = options.messages.findLast(message => message.role === 'user' && (['user', 'subagent-settled'].includes(message.source.kind)
        || message.source.kind === 'whale-project:queue'));
      assert.ok(input); const key = `queue:${input.id}`, stage = this.actions.get(key) ?? 0; this.actions.set(key, stage + 1);
      if (input.source.kind === 'user') {
        assert.ok(messageText(input).startsWith('QUEUE_ACTIONS:'));
        const actions = JSON.parse(messageText(input).slice('QUEUE_ACTIONS:'.length)), action = actions[stage];
        if (!action) { yield* blocks('The requested discussion and queue changes are recorded in this same Project conversation.'); return; }
        if (action.type === 'request' || action.type === 'revise') {
          yield* call(`queue-request-${++this.counter}`, 'project_request', { ...(action.type === 'revise' ? { requestId: this.row(action.title).id } : {}),
            title: action.title, goal: action.goal ?? `Develop ${action.title}, save its result to ${action.title}.txt and read it back.`,
            constraints: ['Preserve seed.txt and the existing project directory.'], conditions: [`${action.title}.txt contains the accepted requirement title and revision`, 'Read back the actual saved file'],
            scopeCeiling: 'development', ...(action.disposition ? { disposition: action.disposition } : {}) }); return;
        }
        const row = this.row(action.title);
        if (action.type === 'delegate') { yield* call(`queue-delegate-${++this.counter}`, 'project_delegate', this.delegate(row)); return; }
        assert.equal(action.type, 'queue');
        yield* call(`queue-change-${++this.counter}`, 'project_queue', { requestId: row.id, requestRevision: row.revision, action: action.action,
          ...(action.before ? { beforeRequestId: this.row(action.before).id } : {}) }); return;
      }
      if (input.source.kind === 'whale-project:queue') {
        const recorded = JSON.parse(messageText(input).split('\n')[1]), row = this.row(recorded.title);
        assert.equal(recorded.id, row.id); assert.equal(recorded.revision, row.revision); assert.equal(recorded.scopeCeiling, 'worker');
        if (!stage) { this.queueInputs.push({ id: input.id, requestId: row.id, revision: row.revision, title: row.title });
          yield* call(`queue-activation-read-${++this.counter}`, 'project_read_store', { path: 'notes.md', requestId: row.id }); return; }
        if (stage === 1) { yield* call(`queue-activation-delegate-${++this.counter}`, 'project_delegate', this.delegate(row)); return; }
        yield* blocks(`${row.title} is now developing under its saved scope and completion conditions.`); return;
      }
      const appendix = input.content.find(block => block.type === 'text' && block.text.startsWith('Project recorded outcome for this native settlement'));
      assert.ok(appendix); const facts = JSON.parse(appendix.text.split('\n')[1]), row = this.state().requests.find(item => item.id === facts.request.id); assert.ok(row);
      if (row.queue.state === 'cancelled') { yield* blocks(`${row.title} was cancelled; its old settlement cannot restart it.`); return; }
      if (!stage) { yield* call(`queue-result-read-${++this.counter}`, 'project_read_store', { path: 'notes.md', requestId: row.id }); return; }
      if (stage === 1) {
        if (this.deliveryBarriers.has(row.title)) await this.barrier(`before-delivery:${row.title}`, options.signal);
        const view = toolFacts(options).requests.find(item => item.id === row.id); assert.ok(view);
        yield* call(`queue-delivery-${++this.counter}`, 'project_deliver', handover(view, `${row.title}: the actual file was written and read back.`, 'completed', [])); return;
      }
      if (stage === 2 && this.deliveryBarriers.has(row.title)) await this.barrier(`before-reply:${row.title}`, options.signal);
      yield* blocks(`${row.title} is delivered with its actual saved file and readback evidence.`); return;
    }
    assert.ok(names.includes('project_report'));
    const assignment = options.messages.findLast(message => message.role === 'user' && messageText(message).includes('DelegationRef:'));
    const envelope = messageText(assignment), ref = /DelegationRef: ([^\n]+)/.exec(envelope)?.[1], cwd = /Working directory: ([^\n]+)/.exec(envelope)?.[1];
    const brief = envelope.split('Current assignment and completion criteria:\n')[1]?.split('\n\n')[0];
    const accepted = JSON.parse(envelope.split('Requirement context (the accepted whole goal; execute only the current assigned stage):\n')[1].split('\n')[0]);
    const context = { ...accepted, title: brief?.slice('QUEUE_WORK:'.length), revision: accepted.requestRevision };
    assert.ok(ref && cwd); assert.equal(brief, `QUEUE_WORK:${context.title}`);
    const stage = this.stages.get(ref) ?? 0; this.stages.set(ref, stage + 1);
    if (!stage) { this.workerInputs.push({ ref, cwd, brief, context, source: assignment.source, signal: options.signal });
      yield* call(`queue-seed-read-${++this.counter}`, 'project_read', { path: 'seed.txt' }); return; }
    if (stage === 1) {
      if (this.holdTitles.has(context.title)) try { await this.barrier(`worker:${context.title}`, options.signal); }
      catch (error) { this.workerAborts.push({ ref, title: context.title }); throw error; }
      yield* call(`queue-native-write-${++this.counter}`, 'write', { file_path: join(cwd, `${context.title}.txt`), content: `${context.title} revision ${context.revision}\n` }); return;
    }
    if (stage === 2) { yield* call(`queue-native-readback-${++this.counter}`, 'project_read', { path: `${context.title}.txt` }); return; }
    const actual = toolFacts(options); assert.equal(actual.text, `${context.title} revision ${context.revision}\n`);
    yield* call(`queue-native-report-${++this.counter}`, 'project_report', { delegationRef: ref, outcome: 'completed', summary: `Saved and read back ${context.title} revision ${context.revision}.`,
      artifacts: [join(cwd, `${context.title}.txt`)], evidence: [JSON.stringify(actual)], remainingIssues: [] });
  }
}

/** Script goal/stage choices while the real Host owns provenance, permissions and handover. */
class RequirementModel extends ScriptedModel {
  goals = new Map(); workerInputs = []; priorReports = []; deliveryWaiting = false; batchWaiting = false;
  visualizeResults = false;
  handoverViews = new Map();
  deliveryGate = new Promise(done => { this.releaseDelivery = done; });
  batchGate = new Promise(done => { this.releaseBatch = done; });
  async *stream(options) {
    this.requests.push(options);
    const coordinator = options.tools?.some(tool => tool.name === 'project_request');
    const input = options.messages.findLast(message => message.role === 'user' && ['user', 'subagent-settled'].includes(message.source.kind));
    if (coordinator) {
      const key = `goal:${input.id}`, stage = this.stages.get(key) ?? 0; this.stages.set(key, stage + 1);
      const text = messageText(input);
      if (text === 'HOLD_LEAD_FOR_BATCH') { this.batchWaiting = true; await this.batchGate; yield* blocks('Ready for the queued inputs.'); return; }
      if (text === 'RETRY_PARTIAL_HANDOVER') {
        if (!stage) yield* call(`partial-read-${++this.counter}`, 'project_read_store', { path: 'notes.md' });
        else if (stage === 1) {
          const view = toolFacts(options).requests.find(item => item.title === 'Repair goal');
          const declaration = handover(view, 'Saved development results are available; external acceptance remains unverified.');
          declaration.reportRefs.unshift(...this.priorReports);
          yield* call(`partial-retry-${++this.counter}`, 'project_deliver', declaration);
        } else yield* blocks('The saved results have been handed over with their unverified external acceptance explicitly retained.');
        return;
      }
      if (input.source.kind === 'subagent-settled') {
        const appendix = input.content.find(block => block.type === 'text' && block.text.startsWith('Project recorded outcome for this native settlement'));
        assert.ok(appendix); const facts = JSON.parse(appendix.text.split('\n')[1]);
        const work = this.state().workstreams.find(item => item.id === facts.workstreamId), receipt = work.delegations.find(item => item.runId === facts.runId);
        const request = this.state().requests.find(item => item.id === receipt.source.requestId);
        if (!stage) { yield* call(`goal-read-${++this.counter}`, 'project_read_store', { path: 'notes.md', requestId: request.id }); return; }
        if (receipt.brief === 'GOAL_INSPECT' && request.title === 'Repair goal') {
          if (stage === 1) {
            const view = toolFacts(options).requests.find(item => item.id === request.id); assert.ok(view.requiredWork[0].reportId);
            this.priorReports = handover(view, 'Investigation evidence').reportRefs;
            yield* call(`goal-repair-${++this.counter}`, 'project_delegate', { requestId: view.id, requestRevision: view.revision, workstreamId: work.id, brief: 'GOAL_IMPLEMENT', scope: 'development' });
          } else yield* blocks('Investigation finished; the authorized repair is continuing.');
          return;
        }
        if (request.title === 'Readonly goal') {
          if (stage === 1) yield* call(`forbidden-stage-${++this.counter}`, 'project_delegate', { requestId: request.id, requestRevision: request.revision, workstreamId: work.id, brief: 'GOAL_IMPLEMENT', scope: 'development' });
          else if (stage === 2) yield* call(`forbidden-notice-revision-${++this.counter}`, 'project_request', { requestId: request.id, title: request.title, goal: 'Unauthorized repair', conditions: ['Write 42'], scopeCeiling: 'development' });
          else yield* blocks('The readonly investigation cannot authorize a repair.');
          return;
        }
        const visualize = this.visualizeResults && receipt.brief === 'GOAL_IMPLEMENT';
        if (visualize && stage === 1) {
          this.handoverViews.set(input.id, toolFacts(options).requests.find(item => item.id === request.id));
          assert.ok(options.tools.some(tool => tool.name === 'html_render'), 'the real Lead receives the enabled publisher without gaining repository tools');
          yield* call(`goal-page-${++this.counter}`, 'html_render', { html: '<!doctype html><html><body><h1>Recorded answer</h1><p>The saved value changed from 41 to 42.</p></body></html>', title: 'Repair evidence', height: 180 }); return;
        }
        if (stage === (visualize ? 2 : 1)) {
          const view = visualize ? this.handoverViews.get(input.id) : toolFacts(options).requests.find(item => item.id === request.id);
          const declaration = handover(view, `${request.title}: assigned work and readback are complete.`, 'completed', []);
          if (request.title === 'Repair goal') declaration.reportRefs.unshift(...this.priorReports);
          yield* call(`goal-deliver-${++this.counter}`, 'project_deliver', declaration); return;
        }
        if (request.title === 'Repair goal') { this.deliveryWaiting = true; await this.deliveryGate; }
        if (options.messages.findLast(message => message.role === 'tool')?.isError) { yield* blocks('The handover tool failed; saved worker results remain available, but no final delivery was committed.'); return; }
        yield* blocks(`${request.title}: the actual result is available. The file was read back and the saved stage evidence is attached.`); return;
      }
      const title = text === 'GOAL_REPAIR' ? 'Repair goal' : text === 'GOAL_READONLY' ? 'Readonly goal' : text === 'GOAL_SAME_INPUT' ? 'Frozen goal' : text === 'GOAL_B' ? 'Goal B' : 'Batch goal';
      if (!stage) {
        yield* call(`goal-request-${++this.counter}`, 'project_request', { title, goal: title === 'Repair goal' ? 'Read answer.txt, change its value from 41 to 42 and verify the saved value.' : 'Inspect the existing answer without changing the directory.',
          constraints: ['Keep this directory and its existing files.'], conditions: title === 'Repair goal' ? ['answer.txt contains exactly 42 followed by a newline', 'Read back the saved value'] : ['Report the observed value'], scopeCeiling: title === 'Repair goal' ? 'development' : 'readonly' }); return;
      }
      if (stage === 1) {
        const request = toolFacts(options); this.goals.set(title, request);
        if (text === 'GOAL_SAME_INPUT') {
          yield* call(`forbidden-human-revision-${++this.counter}`, 'project_request', { requestId: request.id, title, goal: 'Change the answer', conditions: ['Write 42'], scopeCeiling: 'development' }); return;
        }
        if (title === 'Batch goal') { yield* blocks('Both queued inputs are recorded in their original order.'); return; }
        const existing = title === 'Goal B' && this.state().workstreams.find(item => item.title === 'Repair work');
        yield* call(`goal-inspect-${++this.counter}`, 'project_delegate', { requestId: request.id, requestRevision: request.revision,
          ...(existing ? { workstreamId: existing.id } : { title: title === 'Repair goal' ? 'Repair work' : 'Readonly work' }), brief: 'GOAL_INSPECT', scope: 'readonly' }); return;
      }
      yield* blocks('The accepted goal is being handled within its recorded scope.'); return;
    }
    assert.ok(options.tools?.some(tool => tool.name === 'project_report'));
    const assignment = options.messages.findLast(message => message.role === 'user' && messageText(message).includes('DelegationRef:'));
    const envelope = messageText(assignment), ref = /DelegationRef: ([^\n]+)/.exec(envelope)?.[1], cwd = /Working directory: ([^\n]+)/.exec(envelope)?.[1];
    const brief = envelope.split('Current assignment and completion criteria:\n')[1]?.split('\n\n')[0];
    const context = JSON.parse(envelope.split('Requirement context (the accepted whole goal; execute only the current assigned stage):\n')[1].split('\n')[0]);
    assert.ok(ref && cwd); const stage = this.stages.get(ref) ?? 0; this.stages.set(ref, stage + 1);
    if (!stage) this.workerInputs.push({ ref, cwd, brief, context, source: assignment.source });
    if (!stage) {
      yield* (brief === 'GOAL_IMPLEMENT' ? call(`goal-native-read-${++this.counter}`, 'read', { file_path: join(cwd, 'answer.txt') })
        : call(`goal-inspect-read-${++this.counter}`, 'project_read', { path: 'answer.txt' })); return;
    }
    if (brief === 'GOAL_IMPLEMENT' && stage === 1) { yield* call(`goal-write-${++this.counter}`, 'write', { file_path: join(cwd, 'answer.txt'), content: '42\n' }); return; }
    if (brief === 'GOAL_IMPLEMENT' && stage === 2) { yield* call(`goal-readback-${++this.counter}`, 'project_read', { path: 'answer.txt' }); return; }
    const readback = toolFacts(options); assert.match(readback.text, brief === 'GOAL_IMPLEMENT' ? /^42\n$/ : /^(41|42)\n$/);
    yield* call(`goal-report-${++this.counter}`, 'project_report', { delegationRef: ref, outcome: 'completed', summary: brief === 'GOAL_IMPLEMENT' ? 'Saved value 42 and read it back.' : 'Read the existing value without changing it.',
      artifacts: brief === 'GOAL_IMPLEMENT' ? [join(cwd, 'answer.txt')] : [], evidence: [JSON.stringify(readback)], remainingIssues: [] });
  }
}

class ReplacementModel extends ScriptedModel {
  stoppedRequestWaiting = false; failedTerminal;
  stoppedRequestGate = new Promise(done => { this.releaseStoppedRequest = done; });
  async *stream(options) {
    this.requests.push(options);
    if (options.tools?.some(tool => tool.name === 'project_request')) {
      const input = options.messages.findLast(message => message.role === 'user' && ['user', 'subagent-settled'].includes(message.source.kind));
      const key = `replacement:${input.id}`, stage = this.stages.get(key) ?? 0; this.stages.set(key, stage + 1);
      if (input.source.kind === 'subagent-settled') {
        const appendix = input.content.find(block => block.type === 'text' && block.text.startsWith('Project recorded outcome for this native settlement'));
        const facts = JSON.parse(appendix.text.split('\n')[1]), work = this.state().workstreams.find(item => item.id === facts.workstreamId);
        const receipt = work.delegations.find(item => item.runId === facts.runId);
        if (receipt.brief === 'STOP_REPLACEMENT') { yield* blocks('The user stopped this work.'); return; }
        if (!stage || receipt.brief !== 'FAIL_NATIVE_REPLACEMENT' && stage === 2) {
          yield* call(`replacement-read-${++this.counter}`, 'project_read_store', { path: 'notes.md', requestId: receipt.source.requestId }); return;
        }
        if (receipt.brief === 'FAIL_NATIVE_REPLACEMENT') {
          if (stage === 1) {
            const observed = toolFacts(options).work.find(item => item.id === work.id); assert.equal(observed.terminal.stopReason, 'error');
            this.failedTerminal = { workstreamId: work.id, delegationRef: receipt.ref, runId: observed.terminal.runId };
            yield* call(`necessary-replacement-${++this.counter}`, 'project_delegate', { requestId: receipt.source.requestId, requestRevision: receipt.source.requestRevision,
              title: 'Replacement investigation', brief: 'READ_REPLACEMENT', scope: 'readonly', replacesWorkstreamId: work.id,
              replacementReason: 'The original native run failed with MISSING_CREDENTIAL before producing its report; a replacement must complete the same readonly goal.' });
          } else yield* blocks('A necessary replacement is continuing the original readonly goal; the failure remains recorded.');
          return;
        }
        if (stage === 1) {
          yield* call(`unnecessary-replacement-${++this.counter}`, 'project_delegate', { requestId: receipt.source.requestId, requestRevision: receipt.source.requestRevision,
            title: 'Forbidden normal replacement', brief: 'READ_REPLACEMENT', scope: 'readonly', replacesWorkstreamId: work.id, replacementReason: 'No failure; this must be rejected.' }); return;
        }
        if (stage === 3) {
          const view = toolFacts(options).requests.find(item => item.id === receipt.source.requestId);
          yield* call(`replacement-delivery-${++this.counter}`, 'project_deliver', { ...handover(view, 'The replacement read the actual answer; original failures remain in history.', 'completed', []), terminalRefs: [this.failedTerminal] }); return;
        }
        yield* blocks('The readonly goal is delivered using the replacement report. The original failure and its explanation remain available.'); return;
      }
      const text = messageText(input), stopped = text === 'STOP_REPLACEMENT', missing = text === 'REPLACE_MISSING_SESSION', resumed = text === 'RESUME_FAILED_REPLACEMENT';
      const request = this.state().requests.find(item => item.title === (stopped ? 'Stopped replacement goal' : 'Replacement goal'));
      if (!stage) {
        yield* call(`replacement-goal-${++this.counter}`, 'project_request', { ...(missing || resumed ? { requestId: request.id } : {}),
          title: stopped ? 'Stopped replacement goal' : 'Replacement goal', goal: 'Read answer.txt without changing it.', conditions: ['Report the actual saved value'], scopeCeiling: 'readonly' }); return;
      }
      if (stage === 1) {
        const view = toolFacts(options), old = missing ? this.state().workstreams.findLast(item => item.replaces) : resumed ? this.state().workstreams.find(item => item.title === 'Failed original') : undefined;
        yield* call(`replacement-initial-${++this.counter}`, 'project_delegate', { requestId: view.id, requestRevision: view.revision,
          title: stopped ? 'Stopped original' : missing ? 'Missing Session replacement' : resumed ? 'Resumed failure replacement' : 'Failed original', brief: stopped ? 'STOP_REPLACEMENT' : missing || resumed ? 'READ_REPLACEMENT' : 'FAIL_NATIVE_REPLACEMENT', scope: 'readonly',
          ...(old ? { replacesWorkstreamId: old.id, replacementReason: missing ? 'The user explicitly asked to continue after the original Session was confirmed missing.' : 'A new actual user request resumes the failed readonly goal after the user stop.' } : {}) }); return;
      }
      if (stopped && stage === 2) {
        this.stoppedRequestWaiting = true; await this.stoppedRequestGate;
        const work = this.state().workstreams.find(item => item.title === 'Stopped original');
        yield* call(`stopped-replacement-${++this.counter}`, 'project_delegate', { requestId: request.id, requestRevision: request.revision, title: 'Forbidden stop replacement',
          brief: 'READ_REPLACEMENT', scope: 'readonly', replacesWorkstreamId: work.id, replacementReason: 'Try to bypass the actual user stop without a new human request.' }); return;
      }
      yield* blocks('The requirement remains within its actual authorization.'); return;
    }
    const assignment = options.messages.findLast(message => message.role === 'user' && messageText(message).includes('DelegationRef:'));
    const envelope = messageText(assignment), ref = /DelegationRef: ([^\n]+)/.exec(envelope)[1];
    const brief = envelope.split('Current assignment and completion criteria:\n')[1].split('\n\n')[0];
    if (brief === 'FAIL_NATIVE_REPLACEMENT') throw new LlmError('Original member cannot execute this run.', 'MISSING_CREDENTIAL');
    if (brief === 'STOP_REPLACEMENT') {
      await new Promise((_, reject) => { if (options.signal.aborted) reject(new Error('stopped')); else options.signal.addEventListener('abort', () => reject(new Error('stopped')), { once: true }); }); return;
    }
    const stage = this.stages.get(ref) ?? 0; this.stages.set(ref, stage + 1);
    if (!stage) { yield* call(`replacement-file-${++this.counter}`, 'project_read', { path: 'answer.txt' }); return; }
    const actual = toolFacts(options); assert.equal(actual.text, '41\n');
    yield* call(`replacement-report-${++this.counter}`, 'project_report', { delegationRef: ref, outcome: 'completed', summary: 'The saved answer is 41.', evidence: [JSON.stringify(actual)], artifacts: [], remainingIssues: [] });
  }
}

async function desktopBridge(root, handlers = {}) {
  const bindings = new Map(), requests = [];
  const server = createServer(async (req, res) => { try {
    assert.equal(req.headers.authorization, 'Bearer composition-secret'); const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const input = JSON.parse(Buffer.concat(chunks)); requests.push(input); let value;
    if (input.action === 'prepare-workspace') { if (handlers[input.action]) value = await handlers[input.action](input); else { assert.equal(input.mode, 'existing'); value = { canonicalPath: await realpath(input.workingDirectory), ownership: 'user', receipt: input.workstreamId, isGit: false }; } bindings.set(input.workstreamId, value); }
    else if (handlers[input.action]) value = await handlers[input.action](input);
    else if (input.action === 'select-directory') { const path = await realpath(input.workingDirectory); value = { canonicalPath: path, identity: path.toLowerCase() }; }
    else if (input.action === 'check-workspace') { assert.deepEqual(input.workspace, bindings.get(input.workstreamId)); value = { valid: true }; }
    else if (input.action === 'snapshot') value = { isGit: false, dirty: null, fingerprint: null };
    else if (input.action === 'baseline') value = { isGit: false };
    else if (input.action === 'resolve-path') value = { canonicalPath: await realpath(input.path), root: bindings.get(input.workstreamId).canonicalPath };
    else throw new Error(`Unexpected desktop action ${input.action}`);
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(value));
  } catch (error) { res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: error.message })); } });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  return { requests, address: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(done => server.close(done)) };
}
async function bootHost(home, model, teamConfig, allowUnavailable = false, visualRepliesEnabled = false, composition = {}) {
  const config = join(home, 'cordis.yml'); await writeFile(config, '[]\n');
  const web = dirname(cliRequire.resolve('@deepseek-ai/dsh-web-app/package.json')), manifest = JSON.parse(readFileSync(join(web, 'package.json'), 'utf8'));
  const patches = [...loadOverlayPatches('project-composition', join(harness, 'packages/bundle/base/cordis.patch.yml')),
    ...bundlePatchPaths(web, manifest.dsh.bundle).flatMap(path => loadOverlayPatches('project-composition', path)),
    ...composition.optionalTeams ? loadOverlayPatches('project-composition', join(harness, 'packages/experimental/agent-team-profile/cordis.patch.yml'))
      : teamConfig ? [{ insert: [{ id: 'agent-team', name: '@deepseek-ai/dsh-experimental-agent-team', config: teamConfig }] }] : [],
    ...composition.userPatch ? loadOverlayPatches('project-composition', composition.userPatch) : [],
    ...composition.project === false ? [] : loadOverlayPatches('project-composition', composition.overlayFile ?? join(projectPackage, 'cordis.patch.yml')),
    { id: 'storage-json', config: { root: join(home, 'storages') } }, { id: 'session-persistence-jsonl', config: { root: join(home, 'sessions') } },
    { id: 'mcp-servers-file', config: { path: join(home, 'mcp-servers.yaml'), watch: false } }, { id: 'agent-default-model', config: { provider: 'composition', model: 'project-model' } },
    { id: 'agent-preset-registry', config: { default: 'standard' } },
    ...visualRepliesEnabled ? [{ id: 'visual-replies', config: { enabled: true } }] : [],
    // Project roles explicitly stay native even when a user's ambient mode is PTC.
    { id: 'tools', config: { mode: 'ptc' } },
    ...['webserver', 'hmr', 'web-runtime', 'session-telemetry-otel', 'modules', 'connection', 'session-log-download', 'open-in-app', 'client-hmr', 'directory-picker'].map(id => ({ id, disabled: true })),
    { insert: [{ id: 'directory-picker-browse', name: '@deepseek-ai/dsh-host-directory-picker-browse' }] }];
  const ctx = await boot('project-composition', config, patches, ctx => {
    ctx.on('tools/result', (exec, result) => { if (result.error) model.failures.push({ name: exec.name, error: result.error }); });
    ctx.provide('connection', { fetch: { register: () => () => {} }, rpc: { intercept: () => () => {} } }); provideCmdline(ctx, { args: [], exit: () => {} });
    ctx.loader.internal = { version: 'v2', async import(name) {
      if (name === '@deepseek-ai/dsh-experimental-agent-team' && composition.beforeTeamImport) await composition.beforeTeamImport(ctx);
      if (name === 'dsh-project' || name.startsWith('dsh-project/')) return import(pathToFileURL(join(projectPackage, 'lib', `${name === 'dsh-project' ? 'index' : name.slice(12)}.js`)).href);
      if (name.startsWith('file:')) return import(name);
      return import(pathToFileURL(resolvePackage(name)).href);
    } };
  });
  if (composition.project === false) assert.equal(ctx.get('projects'), undefined);
  else assert.equal(ctx.get('projects')?.available, !allowUnavailable, ctx.get('projects')?.error);
  let contextVersion = 0; ctx.systemPrompt.context({ name: 'composition:actual-dynamic-context', order: 99999, text: () => `Runtime context snapshot ${++contextVersion}; it supplies no user authorization.` });
  ctx.llm.registerAdapter(['composition'], model); model.state = () => ctx.get('projects')?.state(); return ctx;
}
test('Project and the optional Agent Teams bundle compose one Team service and one Team UI', () => {
  const web = dirname(cliRequire.resolve('@deepseek-ai/dsh-web-app/package.json')), manifest = JSON.parse(readFileSync(join(web, 'package.json'), 'utf8'));
  const layers = [join(harness, 'packages/bundle/base/cordis.patch.yml'), ...bundlePatchPaths(web, manifest.dsh.bundle),
    join(harness, 'packages/experimental/agent-team-profile/cordis.patch.yml'), join(projectPackage, 'cordis.patch.yml')].map(path => loadOverlayPatches('project-composition', path));
  const active = rows => rows.flatMap(row => row.disabled === true ? [] : row.group && Array.isArray(row.config) ? [row, ...active(row.config)] : [row]);
  const rows = active(composeEntries(layers));
  for (const name of ['@deepseek-ai/dsh-experimental-agent-team', '@deepseek-ai/dsh-experimental-client-ui-agent-team']) {
    assert.deepEqual(rows.filter(row => row.name === name).map(row => row.id), [name === '@deepseek-ai/dsh-experimental-agent-team' ? 'agent-team' : 'dsh-project-team-ui']);
  }
  assert.ok(rows.some(row => row.id === 'tool-agent-team'), 'Agent Teams tools stay mounted on the shared service');
});

class TeamLimitModel extends LlmAdapter {
  requests = []; failures = [];
  async resolveModel(provider, model) { return { provider, id: model, name: model }; }
  async *stream(options) { this.requests.push(options); yield* blocks('Team member ready.'); }
}

function assertTeamComposition(ctx, expected, project, optionalTeams) {
  const activeFibers = plugin => [...(ctx.registry.get(plugin)?.fibers ?? [])].filter(fiber => fiber.state === FiberState.ACTIVE);
  assert.equal(activeFibers(TeamService).length, expected ? 1 : 0, 'exactly one live TeamService provider');
  assert.equal(activeFibers(teamUi).length, project || optionalTeams ? 1 : 0, 'exactly one live Team UI plugin');
  assert.equal([...ctx.loader.entries()].filter(entry => entry.options.name === '@deepseek-ai/dsh-experimental-client-ui-agent-team' && !entry.disabled).length, project || optionalTeams ? 1 : 0);
  if (!expected) { assert.equal(ctx.get('agentTeams'), undefined); return; }
  assert.deepEqual(ctx.agentTeams.config, expected, 'the actual shared service retains every effective limit');
  if (project) assert.equal(ctx.projects.teams.config, ctx.agentTeams.config, 'Project consumes the configured provider instance');
  if (optionalTeams) {
    const tool = [...ctx.loader.entries()].find(entry => entry.options.id === 'tool-agent-team');
    assert.equal(tool.fiber.state, FiberState.ACTIVE, 'optional Team tools remain active on the shared provider');
  }
}

async function assertTeamLimits(ctx, expected, id) {
  const lead = await ctx.agentLoop.create(id, { provider: 'composition', model: 'project-model' });
  let first;
  for (let index = 0; index < expected.maxMembers; index++) {
    const result = await ctx.agentTeams.spawnTeammate(lead, { name: `member-${index}`, description: `Capacity member ${index}`,
      prompt: [{ type: 'text', text: 'Observe Team capacity.' }], context: 'fresh', provider: 'spawn', signal });
    first ??= result.member.name;
  }
  await waitFor(() => ctx.agentTeams.listMembers(lead).every(member => member.status === 'inactive'), 'capacity members settle through the actual continuable runtime');
  assert.equal(ctx.agentTeams.listMembers(lead).length, expected.maxMembers + 1, 'the configured teammate limit excludes the Lead');
  await assert.rejects(ctx.agentTeams.spawnTeammate(lead, { name: 'over-capacity', description: 'Must be rejected before creation',
    prompt: [{ type: 'text', text: 'Must not run.' }], context: 'fresh', provider: 'spawn', signal }), { code: 'TEAM_MEMBER_LIMIT' });
  assert.equal(ctx.agentTeams.listMembers(lead).length, expected.maxMembers + 1, 'rejection does not add a member');
  await assert.rejects(ctx.agentTeams.sendMessage(lead, { target: first, content: [{ type: 'text', text: '鲸'.repeat(expected.maxMessageBytes) }], signal }), { code: 'TEAM_MESSAGE_TOO_LARGE' });
  if (expected.maxTasks <= 4) {
    for (let index = 0; index < expected.maxTasks; index++) await ctx.agentTeams.createTask(lead, { subject: `Task ${index}`, description: 'Configured task capacity.' });
    await assert.rejects(ctx.agentTeams.createTask(lead, { subject: 'Overflow task', description: 'Must not be created.' }), { code: 'TEAM_TASK_LIMIT' });
  }
  assert.equal(await ctx.sessions.flush(lead.session), true);
}

test('real Loader preserves Team limits through cold restart and Project toggle without duplicate providers or UI', { timeout: 180000 }, async t => {
  const defaults = { maxMembers: 8, maxTasks: 256, maxMessageBytes: 65536, disposalTimeoutMs: 5000 };
  for (const scenario of [
    { name: 'optional bundle defaults and delayed provider import', optionalTeams: true, expected: defaults, delayImport: true },
    { name: 'user limits with desktop overlay', optionalTeams: true, desktop: true, expected: { maxMembers: 2, maxTasks: 3, maxMessageBytes: 1024, disposalTimeoutMs: 750 } },
    { name: 'Project alone with desktop overlay', optionalTeams: false, desktop: true, expected: { ...defaults, maxMembers: 16 } },
  ]) await t.test(scenario.name, async () => {
    const root = await mkdtemp(join(tmpdir(), 'whale-project-team-config-')), home = join(root, 'home'), directory = join(root, 'selected');
    await mkdir(home); await mkdir(directory); const bridge = await desktopBridge(root); let ctx, mounted, projectId;
    const userPatch = join(home, 'cordis.patch.yml'), userText = scenario.optionalTeams && scenario.desktop
      ? '- id: agent-team\n  config:\n    maxMembers: !!js 1 + 1\n    maxTasks: 3\n    maxMessageBytes: 1024\n    disposalTimeoutMs: 750\n' : '[]\n';
    await writeFile(userPatch, userText);
    const keys = ['DSH_HOME', 'DSHD_HOME', 'DSH_DESKTOP_INSTALL_URL', 'DSH_DESKTOP_INSTALL_TOKEN', 'DSH_TELEMETRY_DISABLED'], prior = Object.fromEntries(keys.map(key => [key, process.env[key]]));
    Object.assign(process.env, { DSH_HOME: home, DSHD_HOME: home, DSH_DESKTOP_INSTALL_URL: bridge.address, DSH_DESKTOP_INSTALL_TOKEN: 'composition-secret', DSH_TELEMETRY_DISABLED: '1' });
    try {
      for (const [index, stage] of ['initial', 'cold-restart', 'Project-disabled', 'Project-restored'].entries()) {
        const project = stage !== 'Project-disabled', model = new TeamLimitModel();
        if (scenario.desktop) {
          mounted = await ensureDesktopDshProject({ sourceDir: projectPackage, harnessRoot: harness, profileDir: home, enabled: project });
          assert.equal(mounted.ok, true);
          if (project) assert.ok(mounted.overlayFile);
        }
        let delayed = false;
        ctx = await bootHost(home, model, undefined, false, false, { optionalTeams: scenario.optionalTeams, project, userPatch,
          ...(scenario.desktop && project ? { overlayFile: mounted.overlayFile } : {}),
          ...(scenario.delayImport && project ? { beforeTeamImport: async loading => {
            await waitFor(() => [...loading.registry.values()].flatMap(runtime => [...runtime.fibers]).some(fiber => fiber.runtime?.name === 'whale-project' && fiber.state === FiberState.LOADING), 'Project starts before the configured Team module import finishes');
            delayed = true;
          } } : {}),
        });
        assert.equal(model.requests.length, 0, 'boot, restart and toggle start no model work');
        if (scenario.delayImport && project) assert.equal(delayed, true);
        const expected = project || scenario.optionalTeams ? scenario.expected : undefined;
        assertTeamComposition(ctx, expected, project, scenario.optionalTeams);
        if (project) {
          if (!projectId) projectId = (await ctx.projects.command('create', { requestId: 'team-config-create', workingDirectory: directory })).project.id;
          assert.deepEqual(ctx.projects.state().projects.map(row => row.id), [projectId], 'the same Project survives restart and disable/enable');
        }
        if (project && scenario.optionalTeams && stage === 'initial') {
          const entries = [...ctx.loader.entries()], provider = entries.find(entry => entry.options.id === 'agent-team');
          await provider.fiber.restart();
          await waitFor(() => ctx.get('projects')?.available && ctx.projects.teams.config === ctx.agentTeams.config, 'Project follows the configured provider restart');
          assertTeamComposition(ctx, expected, true, true);
          const teamConfig = ctx.agentTeams.config, projectEntry = entries.find(entry => entry.options.id === 'dsh-project');
          await projectEntry.update({ disabled: true }); await projectEntry.fiber.await();
          assert.equal(ctx.get('projects'), undefined);
          assert.equal(ctx.agentTeams.config, teamConfig, 'live Project disable retains the optional provider instance');
          assertTeamComposition(ctx, expected, false, true);
          await projectEntry.update({ disabled: false }); await ctx.loader.await();
          assert.equal(ctx.projects.available, true, ctx.projects.error);
          assert.equal(ctx.agentTeams.config, teamConfig, 'live Project re-enable reuses the optional provider');
          assertTeamComposition(ctx, expected, true, true);
          assert.equal(model.requests.length, 0, 'live provider restart and Project toggle start no model work');
        }
        if (expected) await assertTeamLimits(ctx, expected, `session-team-config-${index}`);
        assert.equal(await readFile(userPatch, 'utf8'), userText, 'desktop composition never edits the user patch');
        await disposeProfileApplication(ctx); ctx = undefined;
      }
    } finally {
      if (ctx) await disposeProfileApplication(ctx); await bridge.close();
      for (const key of keys) if (prior[key] === undefined) delete process.env[key]; else process.env[key] = prior[key];
      assert.ok(resolve(root).startsWith(`${resolve(tmpdir())}${sep}whale-project-team-config-`)); await rm(root, { recursive: true, force: true });
    }
  });
});

test('native requirement queue keeps discussion separate, preserves edits and order, and relays only a durable whole delivery', { timeout: 120000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'whale-project-native-queue-')), home = join(root, 'home'), directory = join(root, 'selected');
  await mkdir(home); await mkdir(directory); await writeFile(join(directory, 'seed.txt'), 'preserved\n');
  const bridge = await desktopBridge(root), model = new QueueModel(); model.holdTitles = new Set(['A', 'B']); model.deliveryBarriers.add('A'); let ctx;
  const keys = ['DSH_HOME', 'DSHD_HOME', 'DSH_DESKTOP_INSTALL_URL', 'DSH_DESKTOP_INSTALL_TOKEN', 'DSH_TELEMETRY_DISABLED'], prior = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  Object.assign(process.env, { DSH_HOME: home, DSHD_HOME: home, DSH_DESKTOP_INSTALL_URL: bridge.address, DSH_DESKTOP_INSTALL_TOKEN: 'composition-secret', DSH_TELEMETRY_DISABLED: '1' });
  try {
    ctx = await bootHost(home, model); const host = ctx.projects;
    const { project } = await host.command('create', { requestId: 'native-queue-create', workingDirectory: directory }), lead = ctx.agents.get(project.coordinatorSessionId);
    let promptNumber = 0;
    const prompt = async actions => { await ctx.sessionController.prompt({ sessionId: lead.id, requestId: `native-queue-human-${++promptNumber}`, mode: 'queue', content: [{ type: 'text', text: `QUEUE_ACTIONS:${JSON.stringify(actions)}` }] }, signal); await lead.whenIdle(); };
    const request = title => host.state().requests.find(row => row.title === title), work = title => host.state().workstreams.find(row => row.title === `${title} work`);
    const delivered = title => host.state().deliveries.find(row => row.requestId === request(title)?.id && row.status === 'delivered');
    await prompt([{ type: 'request', title: 'A', disposition: 'queued' }, { type: 'delegate', title: 'A' }]);
    await waitFor(() => model.barriersReached.has('worker:A'), 'A actually reads the repository and remains in its background worker');
    const a = structuredClone(request('A'));
    await prompt([{ type: 'request', title: 'B', disposition: 'discussing' }, { type: 'delegate', title: 'B' },
      { type: 'request', title: 'C', disposition: 'queued' }, { type: 'delegate', title: 'C' }, { type: 'request', title: 'D', disposition: 'queued' }]);
    assert.equal(request('B').queue.state, 'discussing'); assert.deepEqual(host.queue.pending(project.id).map(row => row.title), ['C', 'D']);
    assert.deepEqual(model.failures.map(item => item.name), ['project_delegate', 'project_delegate']);
    for (const failure of model.failures) assert.match(failure.error.message, /Only the current active requirement may write/);
    assert.deepEqual(host.state().workstreams.map(row => row.title), ['A work'], 'neither tentative nor approved waiting requirements can prestart development; queued ones may only investigate read-only');
    assert.deepEqual(request('A'), a, 'discussing B and approving C/D never revise A or its authorization');
    await prompt([{ type: 'queue', title: 'B', action: 'enqueue', before: 'C' }]);
    assert.deepEqual(host.queue.pending(project.id).map(row => row.title), ['B', 'C', 'D']);
    await prompt([{ type: 'request', title: 'E', disposition: 'discussing' }, { type: 'revise', title: 'B', goal: 'Develop the revised B, preserve seed.txt, save B.txt and verify its actual contents.' }]);
    assert.equal(request('B').revision, 2); assert.equal(host.queue.view(request('B')).position, 1);
    assert.deepEqual(host.queue.pending(project.id).map(row => row.title), ['B', 'C', 'D'], 'editing an approved goal preserves its exact waiting position');
    await prompt([{ type: 'queue', title: 'D', action: 'move', before: 'B' }]);
    assert.deepEqual(host.queue.pending(project.id).map(row => row.title), ['D', 'B', 'C']);
    await prompt([{ type: 'queue', title: 'D', action: 'cancel' }]);
    assert.deepEqual(host.queue.pending(project.id).map(row => row.title), ['B', 'C']); assert.equal(request('D').queue.state, 'cancelled');
    model.gate('worker:A').release();
    await waitFor(() => model.barriersReached.has('before-delivery:A'), 'native A report and settlement reach the Lead before its handover declaration');
    assert.equal(work('A').status, 'done'); assert.ok(work('A').latestReport); assert.equal(work('A').settlements.length, 1);
    assert.equal(delivered('A'), undefined); assert.equal(host.queue.active(project.id).id, request('A').id); assert.equal(model.queueInputs.length, 0); assert.equal(work('B'), undefined);
    model.gate('before-delivery:A').release();
    await waitFor(() => model.barriersReached.has('before-reply:A'), 'A delivery draft exists while its final native reply is still held');
    assert.equal(host.state().deliveries.find(row => row.requestId === request('A').id).status, 'draft');
    assert.equal(host.queue.active(project.id).id, request('A').id); assert.equal(model.queueInputs.length, 0); assert.equal(work('B'), undefined, 'a successful declaration alone cannot advance the queue');
    model.gate('before-reply:A').release();
    await waitFor(() => { assert.deepEqual(model.streamErrors, []); assert.equal(model.failures.length, 2, JSON.stringify(model.failures)); return model.barriersReached.has('worker:B'); }, 'durable completed A hands off to the actual revised B worker automatically');
    assert.equal(delivered('A').outcome, 'completed'); assert.equal(host.queue.active(project.id).id, request('B').id);
    assert.equal(model.workerInputs.find(item => item.context.title === 'B').context.revision, 2); assert.equal(work('C'), undefined);
    model.gate('worker:B').release();
    await waitFor(() => delivered('C'), 'B actual write/readback/delivery automatically hands off to C and C delivers'); await lead.whenIdle(); await host.tail;
    assert.equal(await ctx.sessions.flush(lead.session), true);
    for (const title of ['A', 'B', 'C']) assert.equal(await readFile(join(directory, `${title}.txt`), 'utf8'), `${title} revision ${title === 'B' ? 2 : 1}\n`);
    assert.equal(await readFile(join(directory, 'seed.txt'), 'utf8'), 'preserved\n'); assert.equal(work('D'), undefined); assert.equal(work('E'), undefined);
    assert.deepEqual(model.queueInputs.map(item => item.title), ['B', 'C']); assert.equal(new Set(model.queueInputs.map(item => item.id)).size, 2);
    const notices = lead.session.snapshotEvents().filter(event => event.type === 'user/message' && event.data.source.kind === 'whale-project:queue');
    assert.deepEqual(notices.map(event => event.data.id), model.queueInputs.map(item => item.id), 'each saved activation produces one exact producer-owned native notice in the original Lead');
    assert.deepEqual(host.queue.pending(project.id), []); assert.equal(host.queue.active(project.id), undefined);
    assert.equal((await host.requirements.listCards(project.id, { kind: 'completed' })).items.length, 3);
    assert.equal((await host.requirements.listCards(project.id, { kind: 'cancelled' })).items[0].id, request('D').id);
    assert.equal(model.failures.length, 2, 'only the two deliberate attempts to prestart discussed/queued work failed'); assert.deepEqual(model.streamErrors, []);
  } finally {
    for (const gate of model.gates.values()) gate.release(); if (ctx) await ctx.fiber.dispose(); await bridge.close();
    for (const key of keys) if (prior[key] === undefined) delete process.env[key]; else process.env[key] = prior[key];
    assert.ok(resolve(root).startsWith(`${resolve(tmpdir())}${sep}whale-project-native-queue-`)); await rm(root, { recursive: true, force: true });
  }
});

test('native delivery tracking waits for actual workspace snapshots and excludes another Project writer during revert', { timeout: 120000 }, async () => {
  // Plain data fixtures stand in for desktop-owned directories: no Git repository,
  // branch or worktree is created. Real Host tools write and read the data.
  const root = await mkdtemp(join(tmpdir(), 'whale-project-native-tracking-')), home = join(root, 'home'), directory = join(root, 'selected'), isolated = join(root, 'isolated-data'), child = join(isolated, 'nested-data');
  await mkdir(home); await mkdir(directory); await mkdir(isolated); await mkdir(child);
  for (const cwd of [directory, isolated, child]) await writeFile(join(cwd, 'seed.txt'), 'preserved\n');
  let releaseCapture, captureStarted = false, ctx;
  const captureGate = new Promise(resolve => { releaseCapture = resolve; }), model = new QueueModel();
  model.isolateTitles.add('A'); model.holdTitles = new Set(['B', 'Foreign']);
  const bridge = await desktopBridge(root, {
    'prepare-workspace': async input => ({ canonicalPath: await realpath(input.mode === 'worktree' ? isolated : input.workingDirectory), ownership: input.mode === 'worktree' ? 'project' : 'user', receipt: input.workstreamId, isGit: true }),
    baseline: () => ({ isGit: true, tree: 'a'.repeat(40) }),
    changes: async input => {
      const title = input.workingDirectory === await realpath(isolated) ? 'A' : 'B';
      assert.equal(await readFile(join(input.workingDirectory, `${title}.txt`), 'utf8'), `${title} revision 1\n`);
      if (title === 'A' && !input.end) { captureStarted = true; await captureGate; }
      return { end: title === 'A' ? 'b'.repeat(40) : 'c'.repeat(40), files: [{ path: `${title}.txt`, status: 'A', added: 1, removed: 0 }], diff: `diff --git a/${title}.txt b/${title}.txt\nnew file mode 100644\n--- /dev/null\n+++ b/${title}.txt\n@@ -0,0 +1 @@\n+${title} revision 1\n` };
    },
    revert: async input => {
      assert.equal(input.workingDirectory, await realpath(isolated));
      assert.ok(input.workspace.receipt && input.workstreamId);
      if (!input.checkOnly) await rm(join(isolated, 'A.txt'));
      return { ok: true, applied: !input.checkOnly };
    },
  });
  const keys = ['DSH_HOME', 'DSHD_HOME', 'DSH_DESKTOP_INSTALL_URL', 'DSH_DESKTOP_INSTALL_TOKEN', 'DSH_TELEMETRY_DISABLED'], prior = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  Object.assign(process.env, { DSH_HOME: home, DSHD_HOME: home, DSH_DESKTOP_INSTALL_URL: bridge.address, DSH_DESKTOP_INSTALL_TOKEN: 'composition-secret', DSH_TELEMETRY_DISABLED: '1' });
  try {
    ctx = await bootHost(home, model); const host = ctx.projects;
    const { project } = await host.command('create', { requestId: 'tracking-primary', workingDirectory: directory }), lead = ctx.agents.get(project.coordinatorSessionId);
    const prompt = (sessionId, requestId, actions) => ctx.sessionController.prompt({ sessionId, requestId, mode: 'queue', content: [{ type: 'text', text: `QUEUE_ACTIONS:${JSON.stringify(actions)}` }] }, signal);
    await prompt(lead.id, 'tracking-human', [{ type: 'request', title: 'A' }, { type: 'delegate', title: 'A' }, { type: 'request', title: 'B', disposition: 'discussing' }]);
    await waitFor(() => { assert.deepEqual(model.streamErrors, []); return captureStarted; }, 'the native completed A reply reaches its delayed end snapshot');
    const a = () => host.state().requests.find(row => row.title === 'A'), b = () => host.state().requests.find(row => row.title === 'B');
    const enqueue = host.command('requests/queue', { projectId: project.id, requestId: b().id, requestRevision: 1, action: 'enqueue' });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(host.state().deliveries.find(row => row.requestId === a().id).status, 'draft');
    assert.equal(host.queue.active(project.id)?.id, a().id); assert.equal(model.workerInputs.some(input => input.context.title === 'B'), false);
    assert.equal(a().changes.workspaces[0].workingDirectory, await realpath(isolated), 'baseline is in the assigned member cwd, not the bound root');
    releaseCapture(); await enqueue;
    await waitFor(() => model.barriersReached.has('worker:B'), 'B starts only after A end tree is saved');
    assert.equal(a().changes.workspaces[0].end, 'b'.repeat(40));
    assert.equal(model.workerInputs.find(input => input.context.title === 'A').cwd, await realpath(isolated));
    const diff = await host.command('requests/changes', { projectId: project.id, requestId: a().id });
    assert.equal(diff.workspaces[0].workingDirectory, await realpath(isolated)); assert.equal(diff.files[0].path, 'A.txt');
    model.gate('worker:B').release();
    await waitFor(() => host.state().deliveries.some(row => row.title === 'B' && row.status === 'delivered'), 'ordinary B writes, reads back and completes');
    const { project: foreign } = await host.command('create', { requestId: 'tracking-overlap', workingDirectory: child });
    await prompt(foreign.coordinatorSessionId, 'tracking-foreign-human', [{ type: 'request', title: 'Foreign' }, { type: 'delegate', title: 'Foreign' }]);
    await waitFor(() => model.barriersReached.has('worker:Foreign'), 'another Project holds a child-directory writer');
    await assert.rejects(host.command('requests/revert', { projectId: project.id, requestId: a().id }), { code: 'busy' });
    assert.equal(bridge.requests.filter(input => input.action === 'revert').length, 0);
    await host.command('stop', { projectId: foreign.id });
    await waitFor(() => !host.queue.busy(project.id) && !host.directoryInUse(isolated), 'the delivered primary work and stopped foreign member release all actual activity');
    await host.command('requests/revert', { projectId: project.id, requestId: a().id });
    await assert.rejects(readFile(join(isolated, 'A.txt')), { code: 'ENOENT' });
    assert.equal(await readFile(join(directory, 'B.txt'), 'utf8'), 'B revision 1\n');
    assert.equal(await readFile(join(directory, 'seed.txt'), 'utf8'), 'preserved\n');
    assert.ok(a().changes.revertedAt); assert.deepEqual(model.failures, []); assert.deepEqual(model.streamErrors, []);
    assert.deepEqual(bridge.requests.filter(input => input.action === 'baseline').map(input => input.workingDirectory).slice(0, 2), [await realpath(isolated), await realpath(directory)]);
  } finally {
    releaseCapture(); for (const gate of model.gates.values()) gate.release(); if (ctx) await ctx.fiber.dispose(); await bridge.close();
    for (const key of keys) if (prior[key] === undefined) delete process.env[key]; else process.env[key] = prior[key];
    assert.ok(resolve(root).startsWith(`${resolve(tmpdir())}${sep}whale-project-native-tracking-`)); await rm(root, { recursive: true, force: true });
  }
});

test('native requirement cancellation drains its active member before the next requirement and cannot revive a late result', { timeout: 120000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'whale-project-native-queue-cancel-')), home = join(root, 'home'), directory = join(root, 'selected');
  await mkdir(home); await mkdir(directory); await writeFile(join(directory, 'seed.txt'), 'preserved\n');
  const bridge = await desktopBridge(root), model = new QueueModel(); model.holdTitles = new Set(['A', 'B']); let ctx, releaseDrain = () => {};
  const keys = ['DSH_HOME', 'DSHD_HOME', 'DSH_DESKTOP_INSTALL_URL', 'DSH_DESKTOP_INSTALL_TOKEN'], prior = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  Object.assign(process.env, { DSH_HOME: home, DSHD_HOME: home, DSH_DESKTOP_INSTALL_URL: bridge.address, DSH_DESKTOP_INSTALL_TOKEN: 'composition-secret' });
  try {
    ctx = await bootHost(home, model); const host = ctx.projects;
    const { project } = await host.command('create', { requestId: 'native-queue-cancel-create', workingDirectory: directory }), lead = ctx.agents.get(project.coordinatorSessionId);
    let promptNumber = 0;
    const prompt = actions => ctx.sessionController.prompt({ sessionId: lead.id, requestId: `native-queue-cancel-human-${++promptNumber}`, mode: 'queue', content: [{ type: 'text', text: `QUEUE_ACTIONS:${JSON.stringify(actions)}` }] }, signal);
    await prompt([{ type: 'request', title: 'A', disposition: 'queued' }, { type: 'delegate', title: 'A' }]); await lead.whenIdle();
    await waitFor(() => model.barriersReached.has('worker:A'), 'A native worker is active before cancellation');
    await prompt([{ type: 'request', title: 'B', disposition: 'queued' }]); await lead.whenIdle();
    const a = host.state().workstreams[0], aId = a.workerSessionId, oldRef = a.currentDelegationRef, drain = host.drainWorker;
    const drainGate = new Promise(done => { releaseDrain = done; }); let draining = false;
    host.drainWorker = async function (owner, id) { if (id === aId) { draining = true; await drainGate; } return drain.call(this, owner, id); };
    try {
      await prompt([{ type: 'queue', title: 'A', action: 'cancel' }]);
      await waitFor(() => draining && model.workerAborts.some(item => item.ref === oldRef), 'active cancellation aborts A but its native drain is still pending'); await host.tail;
      assert.equal(host.state().requests.find(row => row.title === 'A').queue.state, 'cancelled'); assert.equal(host.worker(aId).phase, 'stopping');
      assert.equal(model.workerInputs.some(item => item.context.title === 'B'), false); assert.equal(model.queueInputs.length, 0);
      assert.equal(host.state().workstreams.length, 1, 'B cannot be arranged while cancelled A still owns stopping activity');
      releaseDrain();
      await waitFor(() => { assert.deepEqual(model.streamErrors, []); assert.deepEqual(model.failures, []); return model.barriersReached.has('worker:B'); }, 'completed native drain activates B automatically'); await lead.whenIdle();
    } finally { releaseDrain(); host.drainWorker = drain; }
    const stopped = host.worker(aId);
    assert.equal(stopped.phase, 'idle'); assert.equal(stopped.activeRunId, ''); assert.equal(stopped.directoryHeld, false); assert.deepEqual(host.jobs(aId), []);
    model.gate('worker:A').release(); await host.queue.pump(project.id); await host.tail;
    assert.equal(host.stream(a.id).currentDelegationRef, oldRef); assert.equal(host.stream(a.id).latestReport, undefined);
    assert.equal(host.state().deliveries.some(row => row.requestId === a.delegations[0].source.requestId), false);
    await assert.rejects(readFile(join(directory, 'A.txt')), { code: 'ENOENT' });
    model.gate('worker:B').release();
    await waitFor(() => host.state().deliveries.some(row => row.status === 'delivered' && row.title === 'B'), 'B completes normally after active A cancellation'); await lead.whenIdle(); await host.tail;
    assert.deepEqual(model.queueInputs.map(item => item.title), ['B']); assert.equal(await readFile(join(directory, 'B.txt'), 'utf8'), 'B revision 1\n');
    assert.equal(host.state().requests.find(row => row.title === 'A').queue.state, 'cancelled'); assert.deepEqual(model.failures, []);
  } finally {
    releaseDrain(); for (const gate of model.gates.values()) gate.release(); if (ctx) await ctx.fiber.dispose(); await bridge.close();
    for (const key of keys) if (prior[key] === undefined) delete process.env[key]; else process.env[key] = prior[key];
    assert.ok(resolve(root).startsWith(`${resolve(tmpdir())}${sep}whale-project-native-queue-cancel-`)); await rm(root, { recursive: true, force: true });
  }
});

test('native requirement queue survives cold restart without model calls and explicit resume keeps its original member and goal authority', { timeout: 120000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'whale-project-native-queue-restart-')), home = join(root, 'home'), directory = join(root, 'selected');
  await mkdir(home); await mkdir(directory); await writeFile(join(directory, 'seed.txt'), 'preserved\n');
  const bridge = await desktopBridge(root), model = new QueueModel(); model.holdTitles.add('A'); let ctx, restarted;
  const keys = ['DSH_HOME', 'DSHD_HOME', 'DSH_DESKTOP_INSTALL_URL', 'DSH_DESKTOP_INSTALL_TOKEN'], prior = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  Object.assign(process.env, { DSH_HOME: home, DSHD_HOME: home, DSH_DESKTOP_INSTALL_URL: bridge.address, DSH_DESKTOP_INSTALL_TOKEN: 'composition-secret' });
  try {
    ctx = await bootHost(home, model); let host = ctx.projects;
    const { project } = await host.command('create', { requestId: 'native-queue-restart-create', workingDirectory: directory }), lead = ctx.agents.get(project.coordinatorSessionId);
    let promptNumber = 0;
    const prompt = actions => ctx.sessionController.prompt({ sessionId: project.coordinatorSessionId, requestId: `native-queue-restart-human-${++promptNumber}`, mode: 'queue', content: [{ type: 'text', text: `QUEUE_ACTIONS:${JSON.stringify(actions)}` }] }, signal);
    await prompt([{ type: 'request', title: 'A', disposition: 'queued' }, { type: 'delegate', title: 'A' }]); await lead.whenIdle();
    await waitFor(() => model.barriersReached.has('worker:A'), 'A is genuinely active before application interruption');
    await prompt([{ type: 'request', title: 'B', disposition: 'queued' }, { type: 'request', title: 'C', disposition: 'discussing' }, { type: 'request', title: 'D', disposition: 'queued' }, { type: 'queue', title: 'D', action: 'cancel' }]); await lead.whenIdle(); await host.tail;
    const original = structuredClone(host.state().requests), a = structuredClone(host.state().workstreams[0]), originalWorker = a.workerSessionId;
    assert.equal(await ctx.sessions.flush(lead.session), true); await ctx.fiber.dispose(); ctx = undefined;
    restarted = new QueueModel(); restarted.counter = model.counter; ctx = await bootHost(home, restarted); host = ctx.projects;
    assert.equal(restarted.requests.length, 0); assert.equal(host.project(project.id).coordinatorSessionId, lead.id); assert.equal(host.project(project.id).paused, true);
    assert.deepEqual(host.state().requests.map(row => ({ id: row.id, revision: row.revision, versions: row.versions, queue: row.queue })), original.map(row => ({ id: row.id, revision: row.revision, versions: row.versions, queue: row.queue })));
    assert.equal(host.stream(a.id).workerSessionId, originalWorker); assert.equal(host.worker(originalWorker).stopped, true);
    assert.deepEqual(host.queue.pending(project.id).map(row => row.title), ['B']);
    await host.command('detail', { projectId: project.id }); await host.queue.pump(project.id); assert.equal(restarted.requests.length, 0, 'reading and scheduling a recovered Project cannot silently resume work');
    await prompt([{ type: 'queue', title: 'A', action: 'resume' }]);
    await waitFor(() => { assert.deepEqual(restarted.streamErrors, []); assert.deepEqual(restarted.failures, []); return host.state().deliveries.some(row => row.status === 'delivered' && row.title === 'B'); }, 'explicit continuation resumes the original A worker, delivers A and automatically develops B');
    const restoredLead = ctx.agents.get(project.coordinatorSessionId); await restoredLead.whenIdle(); await host.tail;
    const resumed = host.stream(a.id), second = resumed.delegations.at(-1), aRequest = host.state().requests.find(row => row.title === 'A');
    assert.equal(resumed.workerSessionId, originalWorker); assert.equal(resumed.delegations.length, 2); assert.notEqual(second.ref, a.currentDelegationRef);
    assert.equal(aRequest.revision, 1); assert.deepEqual(aRequest.versions, original.find(row => row.title === 'A').versions, 'resume continues frozen goal authorization without manufacturing a human revision');
    assert.equal(second.source.messageId, a.delegations[0].source.messageId); assert.equal(second.source.authorizationCallId, a.delegations[0].source.authorizationCallId);
    assert.equal(second.source.continuationMessageId, restarted.queueInputs.find(item => item.title === 'A').id);
    assert.deepEqual(restarted.queueInputs.map(item => item.title), ['A', 'B']); assert.equal(restarted.workerInputs.filter(item => item.context.title === 'A').length, 1);
    assert.equal(host.state().workstreams.some(row => ['C work', 'D work'].includes(row.title)), false);
    assert.equal(await readFile(join(directory, 'A.txt'), 'utf8'), 'A revision 1\n'); assert.equal(await readFile(join(directory, 'B.txt'), 'utf8'), 'B revision 1\n'); assert.deepEqual(restarted.failures, []);
  } finally {
    for (const current of [model, restarted].filter(Boolean)) for (const gate of current.gates.values()) gate.release(); if (ctx) await ctx.fiber.dispose(); await bridge.close();
    for (const key of keys) if (prior[key] === undefined) delete process.env[key]; else process.env[key] = prior[key];
    assert.ok(resolve(root).startsWith(`${resolve(tmpdir())}${sep}whale-project-native-queue-restart-`)); await rm(root, { recursive: true, force: true });
  }
});

test('both shipped catalogs migrate before admission while durable authority, history and original identities remain intact', { timeout: 240000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'whale-project-catalog-migration-')), home = join(root, 'home'), directory = join(root, 'selected');
  await mkdir(home); await mkdir(directory); await writeFile(join(directory, 'answer.txt'), '41\n');
  const bridge = await desktopBridge(root), model = new RequirementModel(); let ctx;
  const keys = ['DSH_HOME', 'DSHD_HOME', 'DSH_DESKTOP_INSTALL_URL', 'DSH_DESKTOP_INSTALL_TOKEN', 'DSH_TELEMETRY_DISABLED'], prior = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  Object.assign(process.env, { DSH_HOME: home, DSHD_HOME: home, DSH_DESKTOP_INSTALL_URL: bridge.address, DSH_DESKTOP_INSTALL_TOKEN: 'composition-secret', DSH_TELEMETRY_DISABLED: '1' });
  const catalogFile = join(home, 'storages', 'whale_project_local.json');
  try {
    ctx = await bootHost(home, model); const host = ctx.projects;
    const { project } = await host.command('create', { requestId: 'catalog-original-create', workingDirectory: directory }), lead = ctx.agents.get(project.coordinatorSessionId);
    await ctx.sessionController.prompt({ sessionId: lead.id, requestId: 'catalog-real-goal', mode: 'queue', content: [{ type: 'text', text: 'GOAL_REPAIR' }] }, signal);
    await waitFor(() => model.deliveryWaiting, 'actual goal stages reach declaration before its final reply'); model.releaseDelivery();
    await waitFor(() => host.state().deliveries.some(row => row.status === 'delivered'), 'actual durable final reply commits the native handover');
    await lead.whenIdle(); await host.tail;
    assert.deepEqual(model.failures, []); assert.equal(await ctx.sessions.flush(lead.session), true);
    const events = structuredClone(lead.session.snapshotEvents());
    await disposeProfileApplication(ctx); ctx = undefined;
    const envelope = JSON.parse(await readFile(catalogFile, 'utf8')), original = structuredClone(envelope.tables.state.catalog);
    const inputs = source => (source.messageIds ?? [source.messageId]).map(messageId => {
      const event = events.find(event => event.type === 'user/message' && event.data.id === messageId && event.data.source.kind === 'user'); assert.ok(event);
      return { messageId, text: messageText(event.data) };
    });
    const published = () => {
      const catalog = structuredClone(original); catalog.version = 1;
      catalog.requests = original.requests.map(row => ({ id: row.id, projectId: row.projectId, currentVersion: row.revision, updatedAt: row.updatedAt,
        versions: row.versions.map(version => ({ version: version.revision, goal: version.goal, criteria: version.conditions, constraints: version.constraints,
          authorization: version.scope, writePaths: version.writePaths, inputs: inputs(version.source), callId: version.source.authorizationCallId,
          requiredWork: original.workstreams.flatMap(work => { const receipt = work.delegations.findLast(receipt => receipt.source.requestId === row.id && receipt.source.requestRevision <= version.revision); return receipt ? [{ workstreamId: work.id, delegationRef: receipt.ref }] : []; }), at: version.at })) }));
      for (const work of catalog.workstreams) for (const receipt of work.delegations) {
        const source = receipt.source; receipt.requestId = source.requestId; receipt.requestVersion = source.requestRevision;
        receipt.source = { sessionId: source.sessionId, messageId: source.messageId, callId: source.callId, text: source.text, inputs: inputs(source), requestId: source.requestId, requestVersion: source.requestRevision };
      }
      catalog.deliveries = original.deliveries.map(row => {
        const references = row.reportRefs.map(reference => {
          const work = original.workstreams.find(work => work.id === reference.workstreamId), receipt = work.delegations.find(receipt => receipt.ref === reference.delegationRef);
          return { ...reference, runId: receipt.runId };
        });
        for (const reference of row.terminalRefs ?? []) if (!references.some(item => item.workstreamId === reference.workstreamId && item.delegationRef === reference.delegationRef)) references.push(reference);
        const basisHeads = [...new Set(references.map(reference => reference.workstreamId))].map(id => {
          const work = original.workstreams.find(work => work.id === id), receipt = work.delegations.find(receipt => receipt.ref === work.currentDelegationRef);
          return { workstreamId: id, delegationRef: receipt.ref, runId: receipt.runId, reportId: receipt.report.callId };
        });
        return { id: row.id, projectId: row.projectId, requestId: row.requestId, requestVersion: row.requestRevision, outcome: row.outcome, summary: row.summary,
          evidence: row.evidence, remainingIssues: row.remainingIssues, references, requiredWork: row.requiredDelegations.map(({ workstreamId, delegationRef }) => ({ workstreamId, delegationRef })),
          basisHeads, basisAlreadyChanged: false, sessionId: row.sessionId, turn: row.turn, callId: row.declaredCallId,
          callSeq: events.find(event => event.type === 'tool/call' && event.data.callId === row.declaredCallId).seq, messageId: row.replyMessageId, committedAt: row.at, at: row.at };
      });
      return catalog;
    };
    const writeCatalog = async catalog => { const document = structuredClone(envelope); document.tables.state.catalog = catalog; await writeFile(catalogFile, `${JSON.stringify(document, null, 2)}\n`); };
    const emptyIdentity = () => {
      const saved = structuredClone(original), id = saved.requests[0].id;
      saved.projects.forEach(project => { project.paused = true; });
      const row = saved.requests[0]; row.id = '';
      for (const version of row.versions) if (version.source?.requestId === id) version.source.requestId = '';
      for (const work of saved.workstreams) {
        for (const receipt of work.delegations) if (receipt.source.requestId === id) receipt.source.requestId = '';
        if (work.replaces?.requestId === id) work.replaces.requestId = '';
      }
      for (const delivery of saved.deliveries) if (delivery.requestId === id) delivery.requestId = '';
      return saved;
    };
    await t.test('empty-v2-identity-restores-persists-and-reopens-without-model-execution', async () => {
      await writeCatalog(emptyIdentity());
      let restarted = new RequirementModel(); ctx = await bootHost(home, restarted);
      const restored = ctx.projects.state(), row = restored.requests[0], source = original.requests[0].versions[0].source;
      assert.equal(row.id, original.requests[0].id);
      assert.deepEqual(row.identityRecovery, { originalId: '', sessionId: source.sessionId, callId: source.callId });
      assert.deepEqual(row.versions, original.requests[0].versions, 'original authorization is preserved exactly');
      assert.deepEqual(restored.workstreams.map(work => work.delegations), original.workstreams.map(work => work.delegations));
      assert.deepEqual(restored.deliveries, original.deliveries);
      assert.ok(restored.projects.every(project => project.paused)); assert.equal(restarted.requests.length, 0);
      assert.equal((await ctx.projects.command('list')).available, true);
      const disk = JSON.parse(await readFile(catalogFile, 'utf8')).tables.state.catalog;
      assert.deepEqual(disk.requests[0], row, 'normal recovery commits the restored identity through the real storage domain');
      await disposeProfileApplication(ctx); ctx = undefined;
      restarted = new RequirementModel(); ctx = await bootHost(home, restarted);
      assert.deepEqual(ctx.projects.state().requests[0], row); assert.equal(restarted.requests.length, 0);
      assert.ok(ctx.projects.state().projects.every(project => project.paused));
      const handle = await ctx.sessionPersistence.open(lead.id, 'read');
      try { assert.deepEqual((await handle.read()).events.slice(0, events.length), events, 'identity recovery never rewrites native Session history'); }
      finally { await handle.close(); }
      await disposeProfileApplication(ctx); ctx = undefined;
    });
    await t.test('ambiguous-empty-v2-reference-remains-unavailable-with-the-original-catalog-intact', async () => {
      const saved = emptyIdentity(); saved.workstreams[0].delegations[0].source.authorizationCallId = 'unrelated-original-authorization';
      await writeCatalog(saved); const bytes = await readFile(catalogFile, 'utf8'), restarted = new RequirementModel();
      ctx = await bootHost(home, restarted, undefined, true);
      assert.equal(ctx.projects.error, 'Project catalog needs review: An empty requirement reference cannot be matched to its original version and authorization. Original records were not changed.');
      const listing = await ctx.projects.command('list'); assert.equal(listing.available, false); assert.equal(listing.error, ctx.projects.error);
      assert.equal(restarted.requests.length, 0); assert.equal(await readFile(catalogFile, 'utf8'), bytes);
      await disposeProfileApplication(ctx); ctx = undefined;
    });
    for (const kind of ['final-v1', 'published-v1', 'missing-declaration', 'mismatched-call-id', 'missing-authority']) await t.test(kind, async () => {
      const saved = kind === 'final-v1' ? { ...structuredClone(original), version: 1 } : published();
      if (kind === 'missing-declaration') saved.deliveries[0].callSeq = -1;
      if (kind === 'mismatched-call-id') saved.deliveries[0].callId = 'unproven-declaration-with-real-seq';
      if (kind === 'missing-authority') saved.requests[0].versions[0].callId = 'unproven-original-authorization';
      const before = structuredClone(saved); await writeCatalog(saved);
      const restarted = new RequirementModel(); ctx = await bootHost(home, restarted); const service = ctx.projects, state = service.state();
      assert.equal(state.version, 2); assert.equal(restarted.requests.length, 0, 'migration and cold recovery never execute a model');
      assert.deepEqual(saved, before, 'conversion never mutates its original catalog');
      assert.deepEqual(state.projects.map(row => [row.id, row.coordinatorSessionId, row.canonicalWorkingDirectory]), original.projects.map(row => [row.id, row.coordinatorSessionId, row.canonicalWorkingDirectory]));
      assert.deepEqual(state.workstreams.map(row => [row.id, row.workerSessionId, row.delegations.map(receipt => [receipt.ref, receipt.runId, receipt.report?.callId])]), original.workstreams.map(row => [row.id, row.workerSessionId, row.delegations.map(receipt => [receipt.ref, receipt.runId, receipt.report?.callId])]));
      assert.deepEqual(state.requests.map(row => row.id), original.requests.map(row => row.id)); assert.deepEqual(state.deliveries.map(row => row.id), original.deliveries.map(row => row.id));
      const delivery = service.requirements.deliveries(project.id).items[0], detail = await service.command('detail', { projectId: project.id });
      assert.equal(delivery.summary, original.deliveries[0].summary); assert.equal(delivery.replyMessageId, original.deliveries[0].replyMessageId);
      assert.deepEqual(delivery.reportRefs, original.deliveries[0].reportRefs); assert.equal(detail.project.paused, true);
      if (kind === 'mismatched-call-id') assert.equal(delivery.declaredCallId, before.deliveries[0].callId, 'migration preserves the unproven declaration identity rather than borrowing a successful call at its sequence');
      if (kind === 'final-v1' || kind === 'published-v1') {
        assert.equal(delivery.status, 'delivered'); assert.equal(delivery.applicable, true); assert.equal(detail.project.activity.state, 'done');
        if (kind === 'published-v1') assert.deepEqual(state.deliveries[0].imported035.references, before.deliveries[0].references);
      } else {
        assert.equal(delivery.status, 'historical'); assert.equal(delivery.applicable, false); assert.ok(delivery.error); assert.notEqual(detail.project.activity.state, 'done');
        if (kind === 'missing-authority') {
          const current = detail.project.currentRequests[0]; assert.ok(current.authorityError); assert.equal(detail.project.activity.state, 'blocked');
          assert.throws(() => service.requirements.validate({ ...state.deliveries[0], status: 'draft' }), { code: 'request_authority' });
        }
      }
      const handle = await ctx.sessionPersistence.open(lead.id, 'read');
      try { assert.deepEqual((await handle.read()).events.slice(0, events.length), events, 'the native conversation prefix is never rewritten by catalog migration'); }
      finally { await handle.close(); }
      const disk = JSON.parse(await readFile(catalogFile, 'utf8')); assert.equal(disk.unit.version, 1); assert.equal(disk.tables.state.catalog.version, 2);
      await disposeProfileApplication(ctx); ctx = undefined;
    });
    const invalid = published(); invalid.workstreams[0].delegations[0].requestId = 'foreign-request'; await writeCatalog(invalid);
    const beforeFailedMigration = await readFile(catalogFile, 'utf8'); ctx = await bootHost(home, new RequirementModel(), undefined, true);
    assert.match(ctx.projects.error, /conflicting requirement identities/);
    assert.equal((await ctx.projects.command('list')).available, false);
    assert.equal(await readFile(catalogFile, 'utf8'), beforeFailedMigration, 'a rejected conversion cannot publish an empty or partially migrated catalog');
  } finally {
    model.releaseDelivery(); model.releaseBatch(); if (ctx) await ctx.fiber.dispose(); await bridge.close();
    for (const key of keys) if (prior[key] === undefined) delete process.env[key]; else process.env[key] = prior[key];
    assert.ok(root.startsWith(join(tmpdir(), 'whale-project-catalog-migration-'))); await rm(root, { recursive: true, force: true });
  }
});

test('native replacement admission observes a user stop during original Session stat and requires fresh human continuation', { timeout: 120000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'whale-project-replacement-stop-')), home = join(root, 'home'), directory = join(root, 'selected');
  await mkdir(home); await mkdir(directory); await writeFile(join(directory, 'answer.txt'), '41\n');
  const bridge = await desktopBridge(root), model = new ReplacementModel(); let ctx, originalStat, releaseStat;
  let gated = false, checkedSession; const statGate = new Promise(done => { releaseStat = done; });
  const keys = ['DSH_HOME', 'DSHD_HOME', 'DSH_DESKTOP_INSTALL_URL', 'DSH_DESKTOP_INSTALL_TOKEN', 'DSH_TELEMETRY_DISABLED'], prior = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  Object.assign(process.env, { DSH_HOME: home, DSHD_HOME: home, DSH_DESKTOP_INSTALL_URL: bridge.address, DSH_DESKTOP_INSTALL_TOKEN: 'composition-secret', DSH_TELEMETRY_DISABLED: '1' });
  try {
    ctx = await bootHost(home, model); const host = ctx.projects;
    originalStat = ctx.sessionPersistence.stat.bind(ctx.sessionPersistence);
    ctx.sessionPersistence.stat = async (...args) => {
      const failed = host.state().workstreams.find(item => item.title === 'Failed original');
      if (!gated && failed?.workerSessionId === args[0] && failed.settlements.some(item => item.stopReason === 'error')) {
        gated = true; checkedSession = args[0]; await statGate;
      }
      return originalStat(...args);
    };
    const { project } = await host.command('create', { requestId: 'replacement-stop-create', workingDirectory: directory }), lead = ctx.agents.get(project.coordinatorSessionId);
    await ctx.sessionController.prompt({ sessionId: lead.id, requestId: 'replacement-stop-initial', mode: 'queue', content: [{ type: 'text', text: 'BEGIN_REPLACEMENT' }] }, signal);
    await waitFor(() => gated, 'real failed member replacement is awaiting its original persisted Session stat');
    const failed = host.state().workstreams.find(item => item.title === 'Failed original'), source = failed.delegations[0].source;
    assert.equal(checkedSession, failed.workerSessionId); assert.equal(host.state().workstreams.length, 1);
    assert.equal(failed.settlements[0].stopReason, 'error'); assert.ok(await originalStat(checkedSession));
    const generation = host.workerStops.get(checkedSession)?.generation ?? 0;
    const stopping = host.command('stop', { projectId: project.id, workstreamId: failed.id });
    await waitFor(() => (host.workerStops.get(checkedSession)?.generation ?? 0) > generation, 'UI-equivalent stop establishes its cutoff before the queued persistence write');
    assert.equal(host.workerStops.get(checkedSession).sourceMessageId, source.messageId);
    assert.ok(host.held.has(checkedSession)); assert.equal(host.state().workstreams.length, 1);
    releaseStat(); await stopping;
    await waitFor(() => model.failures.some(item => item.name === 'project_delegate' && /stopped while its replacement was being prepared/.test(item.error.message)), 'old replacement admission rejects the concurrent user stop');
    await lead.whenIdle(); await host.tail;
    assert.equal(host.state().workstreams.length, 1); assert.equal(host.state().workers.length, 1); assert.equal(host.state().deliveries.length, 0);
    assert.equal(host.worker(checkedSession).stopped, true); assert.equal(host.worker(checkedSession).directoryHeld, false);
    assert.equal(model.requests.filter(item => item.tools?.some(tool => tool.name === 'project_report')).length, 1, 'the rejected replacement never starts a new worker model');
    await ctx.sessionController.prompt({ sessionId: lead.id, requestId: 'replacement-stop-fresh-human', mode: 'queue', content: [{ type: 'text', text: 'RESUME_FAILED_REPLACEMENT' }] }, signal);
    try { await waitFor(() => host.state().deliveries.some(item => item.status === 'delivered' && item.requestRevision === 2), 'new actual human revision permits the justified readonly replacement'); }
    catch (error) {
      console.error('Replacement continuation evidence:', JSON.stringify({ failures: model.failures, requests: host.state().requests, deliveries: host.state().deliveries,
        work: host.state().workstreams.map(work => ({ id: work.id, title: work.title, status: work.status, blockedReason: work.blockedReason, delegations: work.delegations, settlements: work.settlements })) }));
      throw error;
    }
    await lead.whenIdle(); await host.tail;
    const resumed = host.state().workstreams.find(item => item.title === 'Resumed failure replacement');
    assert.equal(host.state().workstreams.length, 2); assert.equal(resumed.replaces.workstreamId, failed.id);
    assert.notEqual(resumed.workerSessionId, checkedSession); assert.notEqual(resumed.delegations[0].source.messageId, source.messageId);
    assert.equal(resumed.delegations[0].source.requestId, source.requestId); assert.equal(resumed.delegations[0].source.requestRevision, 2);
    assert.equal(host.stream(failed.id).settlements[0].stopReason, 'error'); assert.ok(await originalStat(checkedSession));
    assert.equal(await readFile(join(directory, 'answer.txt'), 'utf8'), '41\n');
  } finally {
    releaseStat(); model.releaseStoppedRequest(); if (ctx) { if (originalStat) ctx.sessionPersistence.stat = originalStat; await ctx.fiber.dispose(); } await bridge.close();
    for (const key of keys) if (prior[key] === undefined) delete process.env[key]; else process.env[key] = prior[key];
    assert.ok(root.startsWith(join(tmpdir(), 'whale-project-replacement-stop-'))); await rm(root, { recursive: true, force: true });
  }
});

test('native failed work is explicitly replaced without erasing history or bypassing normal identity and user stops', { timeout: 120000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'whale-project-replacement-')), home = join(root, 'home'), directory = join(root, 'selected');
  await mkdir(home); await mkdir(directory); await writeFile(join(directory, 'answer.txt'), '41\n');
  const bridge = await desktopBridge(root), model = new ReplacementModel(); let ctx;
  const keys = ['DSH_HOME', 'DSHD_HOME', 'DSH_DESKTOP_INSTALL_URL', 'DSH_DESKTOP_INSTALL_TOKEN', 'DSH_TELEMETRY_DISABLED'], prior = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  Object.assign(process.env, { DSH_HOME: home, DSHD_HOME: home, DSH_DESKTOP_INSTALL_URL: bridge.address, DSH_DESKTOP_INSTALL_TOKEN: 'composition-secret', DSH_TELEMETRY_DISABLED: '1' });
  try {
    ctx = await bootHost(home, model); const host = ctx.projects;
    const { project } = await host.command('create', { requestId: 'replacement-create', workingDirectory: directory }), lead = ctx.agents.get(project.coordinatorSessionId);
    let number = 0; const prompt = text => ctx.sessionController.prompt({ sessionId: lead.id, requestId: `replacement-user-${++number}`, mode: 'queue', content: [{ type: 'text', text }] }, signal);
    await prompt('BEGIN_REPLACEMENT');
    await waitFor(() => host.state().deliveries.some(item => item.status === 'delivered'), 'actual native error leads to justified replacement report and explicit delivery');
    await lead.whenIdle(); await host.tail;
    assert.equal(host.state().workstreams.length, 2); assert.equal(host.state().workers.length, 2);
    const failed = host.state().workstreams.find(item => item.title === 'Failed original'), replacement = host.state().workstreams.find(item => item.title === 'Replacement investigation');
    const request = host.state().requests[0], failure = structuredClone(failed.settlements[0]), failedReceipt = structuredClone(failed.delegations[0]);
    assert.equal(failure.stopReason, 'error'); assert.equal(failedReceipt.report, undefined); assert.equal(request.revision, 1);
    assert.notEqual(replacement.workerSessionId, failed.workerSessionId); assert.equal(replacement.replaces.workstreamId, failed.id);
    assert.equal(replacement.replaces.delegationRef, failed.currentDelegationRef); assert.match(replacement.replaces.reason, /MISSING_CREDENTIAL/);
    assert.deepEqual(host.requirements.view(request).requiredWork.map(item => item.workstreamId), [replacement.id]);
    assert.equal(host.worker(failed.workerSessionId).activeRunId, ''); assert.equal(host.worker(failed.workerSessionId).directoryHeld, false);
    const failedEvents = (await ctx.sessionController.inspect(failed.workerSessionId)).events;
    assert.ok(failedEvents.some(event => event.type === 'turn/end' && event.data.reason.kind === 'error' && event.data.reason.error.code === 'MISSING_CREDENTIAL'));
    assert.ok(await ctx.sessionPersistence.stat(failed.workerSessionId));
    assert.equal(lead.session.snapshotEvents().filter(event => event.type === 'user/message' && event.data.source.kind === 'user').length, 1);
    assert.equal(model.failures.filter(item => item.name === 'project_delegate').length, 1);
    assert.match(model.failures[0].error.message, /normal continuation retains its member/);
    const replacementReport = structuredClone(replacement.delegations[0].report), delivered = host.state().deliveries[0];
    assert.equal(delivered.outcome, 'completed'); assert.equal(delivered.reportRefs[0].reportId, replacementReport.callId);
    const projected = (await host.command('detail', { projectId: project.id })).project;
    assert.equal(projected.activity.blocked, 0); assert.equal(projected.activity.state, 'done');
    assert.deepEqual(projected.currentTaskIds, [replacement.id]);
    assert.deepEqual(projected.currentWorkRefs, [{ requestId: request.id, requestRevision: request.revision, workstreamId: replacement.id,
      delegationRef: replacement.currentDelegationRef, runId: replacement.delegations[0].runId }]);
    assert.equal((await host.workRows(project.id)).find(row => row.work.id === failed.id).group, 'history');
    assert.equal(await readFile(join(directory, 'answer.txt'), 'utf8'), '41\n');

    // Remove only this test's drained native Session through the persistence API.
    // A new real human input must authorize replacing this confirmed missing identity.
    await ctx.sessionPersistence.flush();
    await ctx.sessionPersistence.delete(replacement.workerSessionId);
    assert.equal(await ctx.sessionPersistence.stat(replacement.workerSessionId), undefined);
    await prompt('REPLACE_MISSING_SESSION');
    await waitFor(() => host.state().deliveries.some(item => item.requestRevision === 2 && item.status === 'delivered'), 'fresh human input permits necessary replacement of the missing original Session');
    await lead.whenIdle(); await host.tail;
    const missingReplacement = host.state().workstreams.find(item => item.title === 'Missing Session replacement');
    assert.ok(missingReplacement); assert.notEqual(missingReplacement.workerSessionId, replacement.workerSessionId);
    assert.equal(missingReplacement.replaces.workstreamId, replacement.id); assert.equal(host.requirements.get(project.id, request.id).revision, 2);
    assert.deepEqual(host.requirements.view(host.requirements.get(project.id, request.id)).requiredWork.map(item => item.workstreamId), [missingReplacement.id]);
    const afterMissing = (await host.command('detail', { projectId: project.id })).project;
    assert.equal(afterMissing.activity.blocked, 0); assert.deepEqual(afterMissing.currentTaskIds, [missingReplacement.id]);
    assert.ok((await host.workRows(project.id)).filter(row => [failed.id, replacement.id].includes(row.work.id)).every(row => row.group === 'history'));
    assert.deepEqual(host.stream(replacement.id).delegations[0].report, replacementReport, 'replacement preserves the earlier actual report even when its Session is absent');
    assert.deepEqual(host.stream(failed.id).delegations[0], failedReceipt);
    assert.deepEqual({ ...host.stream(failed.id).settlements[0], summarizedBy: undefined }, { ...failure, summarizedBy: undefined });
    assert.ok(host.stream(failed.id).settlements[0].summarizedBy);

    await prompt('STOP_REPLACEMENT'); await waitFor(() => model.stoppedRequestWaiting, 'Lead still owns the original human request while its member runs');
    const stopped = host.state().workstreams.find(item => item.title === 'Stopped original');
    await waitFor(() => ctx.agents.get(stopped.workerSessionId)?.status === 'running', 'original member is actually active before user stop');
    await host.command('stop', { projectId: project.id, workstreamId: stopped.id });
    await waitFor(() => !host.worker(stopped.workerSessionId).activeRunId && !host.worker(stopped.workerSessionId).directoryHeld, 'actual user stop drains the member');
    model.releaseStoppedRequest();
    await waitFor(() => model.failures.some(item => item.name === 'project_delegate' && /stopped requirement/.test(item.error.message)), 'same original human turn cannot bypass stop through a replacement');
    await lead.whenIdle(); await host.tail;
    assert.equal(host.state().workstreams.length, 4); assert.equal(host.state().workstreams.some(item => item.title === 'Forbidden stop replacement'), false);
    assert.equal(host.worker(stopped.workerSessionId).stopped, true); assert.equal(await readFile(join(directory, 'answer.txt'), 'utf8'), '41\n');
  } finally {
    model.releaseStoppedRequest(); if (ctx) await ctx.fiber.dispose(); await bridge.close();
    for (const key of keys) if (prior[key] === undefined) delete process.env[key]; else process.env[key] = prior[key];
    assert.ok(root.startsWith(join(tmpdir(), 'whale-project-replacement-'))); await rm(root, { recursive: true, force: true });
  }
});

test('native corrected handovers retain real pages through repeated declarations and durable restart without claiming another request', { timeout: 120000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'whale-project-page-correction-')), home = join(root, 'home'), directory = join(root, 'selected');
  await mkdir(home); await mkdir(directory);
  const bridge = await desktopBridge(root), model = new class extends ScriptedModel {
    first; second;
    async *stream(options) {
      this.requests.push(options); assert.ok(options.tools.some(tool => tool.name === 'html_render'));
      const stage = this.stages.get('page-correction') ?? 0; this.stages.set('page-correction', stage + 1);
      const request = title => ({ title, goal: `Explain the ${title.toLowerCase()} using its published diagram.`, conditions: ['Publish the actual diagram and explain its recorded result'], scopeCeiling: 'readonly' });
      const publish = title => ({ html: `<!doctype html><html><body><h1>${title}</h1><p>Recorded result evidence.</p></body></html>`, title, height: 180 });
      if (!stage) { yield* call('first-page-request', 'project_request', request('First result')); return; }
      if (stage === 1) { this.first = toolFacts(options); yield* call('first-page-publication', 'html_render', publish('First diagram')); return; }
      if ([2, 3, 4].includes(stage)) { yield* call(`first-page-handover-${stage}`, 'project_deliver', handover(this.first, `First result explanation, correction ${stage}.`, 'completed', [])); return; }
      if (stage === 6) { yield* call('second-page-request', 'project_request', request('Second result')); return; }
      if (stage === 7) { this.second = toolFacts(options); yield* call('second-page-publication', 'html_render', publish('Second diagram')); return; }
      if (stage === 8) { yield* call('second-page-handover', 'project_deliver', handover(this.second, 'Second result explanation.', 'completed', [])); return; }
      yield* blocks('Both diagrams were published. The first explanation is corrected; the second result keeps its own evidence.');
    }
  }(); let ctx;
  const keys = ['DSH_HOME', 'DSHD_HOME', 'DSH_DESKTOP_INSTALL_URL', 'DSH_DESKTOP_INSTALL_TOKEN', 'DSH_TELEMETRY_DISABLED'], prior = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  Object.assign(process.env, { DSH_HOME: home, DSHD_HOME: home, DSH_DESKTOP_INSTALL_URL: bridge.address, DSH_DESKTOP_INSTALL_TOKEN: 'composition-secret', DSH_TELEMETRY_DISABLED: '1' });
  try {
    ctx = await bootHost(home, model, undefined, false, true); const host = ctx.projects;
    const { project } = await host.command('create', { requestId: 'page-correction-create', workingDirectory: directory }), lead = ctx.agents.get(project.coordinatorSessionId);
    await ctx.sessionController.prompt({ sessionId: lead.id, requestId: 'two-diagram-results', mode: 'queue', content: [{ type: 'text', text: 'Explain the first and second results with their actual diagrams; correct the first explanation if needed.' }] }, signal);
    await waitFor(() => host.state().deliveries.filter(item => item.status === 'delivered').length === 1, 'the first corrected result is durably delivered before beginning the independent second result'); await lead.whenIdle();
    const firstDelivery = structuredClone(host.state().deliveries.find(item => item.status === 'delivered'));
    await ctx.sessionController.prompt({ sessionId: lead.id, requestId: 'second-diagram-result', mode: 'queue', content: [{ type: 'text', text: 'Continue with the second result and keep the first result and its corrected diagram intact.' }] }, signal);
    await waitFor(() => host.state().deliveries.filter(item => item.status === 'delivered').length === 2, 'corrected native handovers commit their actual pages');
    await lead.whenIdle(); await host.tail;
    assert.deepEqual(model.failures, []); assert.equal(host.state().workstreams.length, 0);
    const events = lead.session.snapshotEvents(), page = title => {
      const publication = events.find(event => event.type === 'tool/result' && event.data.meta?.visualReply?.title === title);
      assert.ok(publication && !publication.data.message.isError);
      return { sessionId: lead.id, callId: publication.data.message.toolCallId,
        file: publication.data.message.content.find(block => block.type === 'file').attachment, title, height: 180 };
    };
    const firstPage = page('First diagram'), secondPage = page('Second diagram'), saved = structuredClone(host.state().deliveries);
    const firstRows = saved.filter(item => item.requestId === model.first.id), second = saved.find(item => item.requestId === model.second.id);
    assert.deepEqual(firstRows.map(item => item.status), ['obsolete', 'obsolete', 'delivered']);
    assert.ok(firstRows.every(item => item.requestRevision === model.first.revision && item.turn === firstDelivery.turn));
    assert.ok(second.turn > firstDelivery.turn, 'independent requirements execute serially in the same continuing Lead');
    assert.deepEqual(saved.find(item => item.id === firstDelivery.id), firstDelivery, 'the second requirement cannot claim or rewrite the first delivered result');
    for (const item of firstRows) assert.deepEqual(item.pages, [firstPage]);
    assert.equal(second.status, 'delivered'); assert.deepEqual(second.pages, [secondPage]);
    assert.equal(await ctx.sessions.flush(lead.session), true);
    await disposeProfileApplication(ctx); ctx = undefined;
    const restarted = new ScriptedModel(); ctx = await bootHost(home, restarted);
    assert.deepEqual(ctx.projects.state().deliveries, saved);
    assert.equal(restarted.requests.length, 0, 'durable page ownership recovery does not rerun the model or publications');
  } finally {
    if (ctx) await ctx.fiber.dispose(); await bridge.close();
    for (const key of keys) if (prior[key] === undefined) delete process.env[key]; else process.env[key] = prior[key];
    assert.ok(root.startsWith(join(tmpdir(), 'whale-project-page-correction-'))); await rm(root, { recursive: true, force: true });
  }
});

test('native goal stages continue without another human and commit exact delivery before durable restart', { timeout: 120000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'whale-project-goal-')), home = join(root, 'home'), directory = join(root, 'selected');
  await mkdir(home); await mkdir(directory); await writeFile(join(directory, 'answer.txt'), '41\n');
  const bridge = await desktopBridge(root), model = new RequirementModel(); let ctx;
  model.visualizeResults = true;
  const keys = ['DSH_HOME', 'DSHD_HOME', 'DSH_DESKTOP_INSTALL_URL', 'DSH_DESKTOP_INSTALL_TOKEN', 'DSH_TELEMETRY_DISABLED'], prior = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  Object.assign(process.env, { DSH_HOME: home, DSHD_HOME: home, DSH_DESKTOP_INSTALL_URL: bridge.address, DSH_DESKTOP_INSTALL_TOKEN: 'composition-secret', DSH_TELEMETRY_DISABLED: '1' });
  try {
    ctx = await bootHost(home, model, undefined, false, true); const host = ctx.projects;
    const { project } = await host.command('create', { requestId: 'goal-create', workingDirectory: directory }), lead = ctx.agents.get(project.coordinatorSessionId);
    assert.equal(model.requests.length, 0);
    await ctx.sessionController.prompt({ sessionId: lead.id, requestId: 'whole-goal', mode: 'queue', content: [{ type: 'text', text: 'GOAL_REPAIR' }] }, signal);
    await waitFor(() => model.deliveryWaiting, 'readonly investigation autonomously continues authorized development and declares handover');
    const request = host.state().requests.find(item => item.title === 'Repair goal'), version = request.versions[0], work = host.state().workstreams[0], workerId = work.workerSessionId;
    assert.equal(host.state().requests.length, 1); assert.equal(request.versions.length, 1); assert.equal(work.delegations.length, 2);
    assert.deepEqual(work.delegations.map(item => item.source.requestId), [request.id, request.id]);
    assert.deepEqual(work.delegations.map(item => item.source.requestRevision), [1, 1]);
    assert.deepEqual(model.workerInputs.map(item => item.brief), ['GOAL_INSPECT', 'GOAL_IMPLEMENT']);
    for (const input of model.workerInputs) {
      assert.equal(input.cwd, await realpath(directory));
      assert.deepEqual(input.context, { requestId: request.id, requestRevision: 1, goal: version.goal, constraints: version.constraints, conditions: version.conditions,
        scopeCeiling: 'worker', writePaths: [], sourceMessageIds: version.source.messageIds });
    }
    assert.equal(lead.session.snapshotEvents().filter(event => event.type === 'user/message' && event.data.source.kind === 'user').length, 1);
    assert.deepEqual(model.failures, [], 'native stage tools must succeed before any completion claim');
    assert.equal(await readFile(join(directory, 'answer.txt'), 'utf8'), '42\n');
    const draft = host.state().deliveries.find(item => item.requestId === request.id);
    assert.equal(draft.status, 'draft'); assert.equal(draft.replyMessageId, undefined); assert.equal(draft.reportRefs.length, 2);
    assert.equal(host.stream(work.id).pendingSummary, true, 'progress text and successful declaration are not a visible final delivery');
    assert.ok(host.stream(work.id).delegations.every(item => !item.report.summarizedBy));
    model.releaseDelivery();
    await waitFor(() => host.state().deliveries.find(item => item.id === draft.id)?.status === 'delivered' && !host.stream(work.id).pendingSummary, 'actual final reply commits both inspected and implemented results');
    await lead.whenIdle(); await host.tail;
    const delivered = structuredClone(host.state().deliveries.find(item => item.id === draft.id)), events = lead.session.snapshotEvents();
    const accepted = events.find(event => event.type === 'tool/result' && event.data.message.toolCallId === delivered.declaredCallId);
    const reply = events.find(event => event.type === 'assistant/message' && event.data.message.id === delivered.replyMessageId);
    assert.ok(accepted && !accepted.data.message.isError); assert.ok(reply.seq > accepted.seq); assert.equal(reply.data.turn, delivered.turn);
    assert.ok(events.some(event => event.type === 'turn/end' && event.data.turn === delivered.turn && event.data.reason.kind === 'completed'));
    const pageCall = events.find(event => event.type === 'tool/call' && event.data.name === 'html_render' && event.data.turn === delivered.turn);
    const pageResult = events.find(event => event.type === 'tool/result' && event.data.message.toolCallId === pageCall?.data.callId);
    assert.ok(pageResult && !pageResult.data.message.isError);
    assert.deepEqual(delivered.pages, [{ sessionId: lead.id, callId: pageCall.data.callId,
      file: pageResult.data.message.content.find(block => block.type === 'file').attachment, title: 'Repair evidence', height: 180 }]);
    assert.ok(host.stream(work.id).delegations.every(item => item.report.summarizedBy === delivered.replyMessageId));
    const manifestA = structuredClone(host.requirements.view(host.requirements.get(project.id, request.id)).requiredWork);
    await ctx.sessionController.prompt({ sessionId: lead.id, requestId: 'independent-goal-b', mode: 'queue', content: [{ type: 'text', text: 'GOAL_B' }] }, signal);
    await waitFor(() => host.state().deliveries.some(item => item.title === 'Goal B' && item.status === 'delivered'), 'same member completes another actual user requirement');
    await lead.whenIdle(); await host.tail;
    assert.equal(host.state().workstreams.length, 1); assert.equal(host.stream(work.id).workerSessionId, workerId);
    assert.notEqual(host.stream(work.id).currentDelegationRef, manifestA[0].delegationRef);
    assert.deepEqual(host.requirements.view(host.requirements.get(project.id, request.id)).requiredWork,
      manifestA.map(reference => ({ ...reference, currentDelegationRef: host.stream(reference.workstreamId).currentDelegationRef })),
      'the old requirement retains its exact report and receipt while exposing the member’s current assignment separately');
    assert.equal(host.requirements.applicable(delivered), true, 'a later unrelated goal cannot erase the earlier exact handover');
    assert.equal(model.workerInputs.at(-1).cwd, await realpath(directory)); assert.deepEqual(model.failures, []);
    const lastHuman = lead.session.snapshotEvents().findLast(event => event.type === 'user/message' && event.data.source.kind === 'user').data.id;
    const saved = structuredClone(host.state().deliveries);
    await disposeProfileApplication(ctx); ctx = undefined;
    const restarted = new RequirementModel(); ctx = await bootHost(home, restarted);
    assert.equal(restarted.requests.length, 0, 'loading durable handovers does not rerun any model');
    assert.deepEqual(ctx.projects.state().deliveries, saved); assert.equal(ctx.projects.stream(work.id).workerSessionId, workerId);
    assert.equal(ctx.projects.project(project.id).coordinatorSessionId, lead.id); assert.equal(await readFile(join(directory, 'answer.txt'), 'utf8'), '42\n');
    let restored = (await ctx.projects.command('detail', { projectId: project.id })).project;
    assert.equal(restored.paused, true); assert.equal(restored.holdSourceMessageId, lastHuman);
    assert.equal(ctx.projects.worker(workerId).stopped, true); assert.equal(ctx.projects.worker(workerId).holdSourceMessageId, lastHuman);
    assert.equal(restored.activity.state, 'done'); assert.deepEqual(restored.currentRequests, []);
    assert.equal(restarted.requests.length, 0, 'showing completed delivery after cold recovery does not activate a model');
    await ctx.projects.command('pause', { projectId: project.id }); await Promise.all([...ctx.projects.stops.values()]); await ctx.projects.tail;
    restored = (await ctx.projects.command('detail', { projectId: project.id })).project;
    assert.equal(restored.paused, true); assert.equal(restored.activity.state, 'done');
    assert.equal(restored.holdSourceMessageId, lastHuman); assert.equal(ctx.projects.projectHolds.get(project.id), lastHuman);
    assert.equal(restarted.requests.length, 0, 'an explicit stop preserves its cutoff without relabeling a completed goal as unfinished');
  } finally {
    model.releaseDelivery(); model.releaseBatch(); if (ctx) await ctx.fiber.dispose(); await bridge.close();
    for (const key of keys) if (prior[key] === undefined) delete process.env[key]; else process.env[key] = prior[key];
    assert.ok(root.startsWith(join(tmpdir(), 'whale-project-goal-'))); await rm(root, { recursive: true, force: true });
  }
});

test('native requirement authorization rejects notice and same-input expansion while retaining ordered human batches', { timeout: 120000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'whale-project-goal-auth-')), home = join(root, 'home'), directory = join(root, 'selected');
  await mkdir(home); await mkdir(directory); await writeFile(join(directory, 'answer.txt'), '41\n');
  const bridge = await desktopBridge(root), model = new RequirementModel(); let ctx;
  const keys = ['DSH_HOME', 'DSHD_HOME', 'DSH_DESKTOP_INSTALL_URL', 'DSH_DESKTOP_INSTALL_TOKEN', 'DSH_TELEMETRY_DISABLED'], prior = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  Object.assign(process.env, { DSH_HOME: home, DSHD_HOME: home, DSH_DESKTOP_INSTALL_URL: bridge.address, DSH_DESKTOP_INSTALL_TOKEN: 'composition-secret', DSH_TELEMETRY_DISABLED: '1' });
  try {
    ctx = await bootHost(home, model); const host = ctx.projects;
    const { project } = await host.command('create', { requestId: 'auth-create', workingDirectory: directory }), lead = ctx.agents.get(project.coordinatorSessionId);
    let number = 0; const prompt = text => ctx.sessionController.prompt({ sessionId: lead.id, requestId: `auth-${++number}`, mode: 'queue', content: [{ type: 'text', text }] }, signal);
    await prompt('GOAL_READONLY');
    await waitFor(() => model.failures.filter(item => ['project_delegate', 'project_request'].includes(item.name)).length === 2, 'real notification cannot expand stage or original authorization');
    await lead.whenIdle(); await host.tail;
    const readonly = host.state().requests.find(item => item.title === 'Readonly goal');
    assert.equal(readonly.revision, 1); assert.equal(readonly.versions[0].scope, 'readonly'); assert.equal(host.state().workstreams[0].delegations.length, 1);
    assert.equal(model.workerInputs.length, 1); assert.equal(await readFile(join(directory, 'answer.txt'), 'utf8'), '41\n');
    assert.ok(model.failures.some(item => item.name === 'project_delegate' && /exceeds the original requirement authorization/.test(item.error.message)), JSON.stringify(model.failures));
    assert.ok(model.failures.some(item => item.name === 'project_request' && /actual human input/.test(item.error.message)));
    await prompt('GOAL_SAME_INPUT');
    await waitFor(() => model.failures.some(item => item.name === 'project_request' && /original authorization remains frozen/.test(item.error.message)), 'a second request declaration cannot enlarge the same human input');
    await lead.whenIdle();
    const frozen = host.state().requests.find(item => item.title === 'Frozen goal');
    assert.equal(frozen.revision, 1); assert.equal(frozen.versions[0].scope, 'readonly'); assert.equal(model.workerInputs.length, 1);
    await prompt('HOLD_LEAD_FOR_BATCH'); await waitFor(() => model.batchWaiting, 'hold current native turn while two real user messages queue');
    for (const text of ['BATCH_FIRST: inspect the answer', 'BATCH_SECOND: preserve the existing directory']) await ctx.sessionController.prompt({ sessionId: lead.id, requestId: `auth-${++number}`, mode: 'steer', content: [{ type: 'text', text }] }, signal);
    model.releaseBatch();
    const batch = await waitFor(() => host.state().requests.find(item => item.title === 'Batch goal'), 'one native turn accepts its actual ordered input batch');
    await lead.whenIdle(); await host.tail;
    const events = lead.session.snapshotEvents(), acceptedCall = events.find(event => event.type === 'tool/call' && event.data.callId === batch.versions[0].source.callId);
    const start = events.findLast(event => event.type === 'turn/start' && event.data.turn === acceptedCall.data.turn);
    const batchEvents = events.filter(event => event.type === 'user/message' && event.data.source.kind === 'user' && event.seq > start.seq && event.seq < acceptedCall.seq);
    assert.deepEqual(batchEvents.filter(event => messageText(event.data).startsWith('BATCH_')).map(event => messageText(event.data)), ['BATCH_FIRST: inspect the answer', 'BATCH_SECOND: preserve the existing directory']);
    assert.deepEqual(batch.versions[0].source.messageIds, batchEvents.map(event => event.data.id));
    assert.equal(batch.versions[0].source.text, batchEvents.map(event => messageText(event.data)).join('\n\n'));
    assert.equal(host.state().workstreams.length, 1); assert.equal(host.state().deliveries.length, 0, 'ordinary explanations cannot manufacture delivery');
  } finally {
    model.releaseDelivery(); model.releaseBatch(); if (ctx) await ctx.fiber.dispose(); await bridge.close();
    for (const key of keys) if (prior[key] === undefined) delete process.env[key]; else process.env[key] = prior[key];
    assert.ok(root.startsWith(join(tmpdir(), 'whale-project-goal-auth-'))); await rm(root, { recursive: true, force: true });
  }
});

test('a native failed delivery tool result cannot become delivered through an explanatory final reply', { timeout: 120000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'whale-project-goal-failure-')), home = join(root, 'home'), directory = join(root, 'selected');
  await mkdir(home); await mkdir(directory); await writeFile(join(directory, 'answer.txt'), '41\n');
  const bridge = await desktopBridge(root), model = new RequirementModel(); let ctx;
  const keys = ['DSH_HOME', 'DSHD_HOME', 'DSH_DESKTOP_INSTALL_URL', 'DSH_DESKTOP_INSTALL_TOKEN', 'DSH_TELEMETRY_DISABLED'], prior = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  Object.assign(process.env, { DSH_HOME: home, DSHD_HOME: home, DSH_DESKTOP_INSTALL_URL: bridge.address, DSH_DESKTOP_INSTALL_TOKEN: 'composition-secret', DSH_TELEMETRY_DISABLED: '1' });
  try {
    ctx = await bootHost(home, model); const host = ctx.projects;
    // Exercise the real dispatch failure boundary after the tool has saved a draft.
    // Neither a fabricated Session event nor a direct commit call is involved.
    let failedDeclaration = false;
    ctx.on('tools/execute', async (exec, next) => {
      const result = await next();
      if (exec.name === 'project_deliver' && !result.error && !failedDeclaration) { failedDeclaration = true; throw new Error('Injected delivery transport failure after draft persistence'); }
      return result;
    });
    const { project } = await host.command('create', { requestId: 'failure-create', workingDirectory: directory }), lead = ctx.agents.get(project.coordinatorSessionId);
    await ctx.sessionController.prompt({ sessionId: lead.id, requestId: 'failure-goal', mode: 'queue', content: [{ type: 'text', text: 'GOAL_REPAIR' }] }, signal);
    await waitFor(() => model.deliveryWaiting, 'actual draft exists but native dispatch returned error');
    assert.ok(model.failures.some(item => item.name === 'project_deliver' && /transport failure/.test(item.error.message)));
    model.releaseDelivery(); await lead.whenIdle();
    await waitFor(() => host.state().deliveries[0]?.error, 'failed tool remains an actionable undelivered draft'); await host.tail;
    const draft = host.state().deliveries[0], events = lead.session.snapshotEvents();
    assert.equal(draft.status, 'draft'); assert.equal(draft.replyMessageId, undefined); assert.match(draft.error, /tool did not finish successfully/);
    assert.ok(events.some(event => event.type === 'tool/result' && event.data.message.toolCallId === draft.declaredCallId && event.data.message.isError));
    assert.ok(events.some(event => event.type === 'turn/end' && event.data.turn === draft.turn && event.data.reason.kind === 'completed'));
    assert.equal(host.state().workstreams[0].pendingSummary, true); assert.ok(host.state().workstreams[0].delegations.every(item => !item.report.summarizedBy));
    assert.match(host.requirements.view(host.state().requests[0]).handoverError, /tool did not finish successfully/);
    const workerCalls = model.requests.filter(item => item.tools?.some(tool => tool.name === 'project_report')).length;
    await ctx.sessionController.prompt({ sessionId: lead.id, requestId: 'retry-partial-delivery', mode: 'queue', content: [{ type: 'text', text: 'RETRY_PARTIAL_HANDOVER' }] }, signal);
    await waitFor(() => host.state().deliveries.some(item => item.status === 'delivered' && item.outcome === 'partial'), 'fresh human summary commits a partial handover after the failed draft');
    await lead.whenIdle(); await host.tail;
    const view = host.requirements.view(host.state().requests[0]), current = (await host.command('detail', { projectId: project.id })).project;
    assert.equal(view.handoverError, undefined); assert.equal(current.activity.summaryFailed, 0);
    assert.equal(current.activity.pendingDelivery, 1, 'partial delivery retains the unmet user goal');
    assert.equal(host.state().workstreams[0].pendingSummary, false);
    assert.match(host.state().deliveries.find(item => item.id === draft.id).error, /tool did not finish successfully/);
    assert.equal(model.requests.filter(item => item.tools?.some(tool => tool.name === 'project_report')).length, workerCalls, 'handover retry must not rerun the member');
  } finally {
    model.releaseDelivery(); model.releaseBatch(); if (ctx) await ctx.fiber.dispose(); await bridge.close();
    for (const key of keys) if (prior[key] === undefined) delete process.env[key]; else process.env[key] = prior[key];
    assert.ok(root.startsWith(join(tmpdir(), 'whale-project-goal-failure-'))); await rm(root, { recursive: true, force: true });
  }
});

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
    const prompt = async value => {
      await ctx.agents.get(project.coordinatorSessionId).whenIdle();
      if (!host.project(project.id).paused) await waitFor(() => host.state().workstreams.every(work => {
        const receipt = work.delegations.find(item => item.ref === work.currentDelegationRef), terminal = work.settlements.find(item => item.runId === receipt.runId);
        return receipt.report ? Boolean(receipt.report.summarizedBy) : terminal ? Boolean(terminal.summarizedBy) : true;
      }), 'the current assignment notices are summarized before the next scripted human instruction');
      return ctx.sessionController.prompt({ sessionId: project.coordinatorSessionId, requestId: `user-${++promptNumber}`, mode: 'queue', content: [{ type: 'text', text: value }] }, signal);
    };
    await prompt('SHORT_QUESTION'); await ctx.agents.get(project.coordinatorSessionId).whenIdle(); assert.equal(host.state().workstreams.length, 0);
    await prompt('PAUSE_OLD_DELEGATE'); await waitFor(() => model.coordinatorWaiting, 'coordinator is still processing the old user request');
    await host.command('pause', { projectId: project.id }); model.releaseCoordinator(); await ctx.agents.get(project.coordinatorSessionId).whenIdle();
    assert.equal(host.state().workstreams.length, 0); assert.equal(host.project(project.id).paused, true);
    assert.equal(model.requests.filter(request => request.tools?.some(tool => tool.name === 'project_report')).length, 0, 'stopped Lead cannot launch a late worker');
    await prompt('DOCS_CODE_PATH'); await ctx.agents.get(project.coordinatorSessionId).whenIdle(); assert.equal(host.state().workstreams.length, 0);
    assert.ok(model.failures.some(item => item.name === 'project_delegate' && /Declare the original scope ceiling and exact relative document paths/.test(item.error.message)), JSON.stringify(model.failures));
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
    await waitFor(() => !host.stream(plan.id).pendingSummary, 'the prior Plan settlement is visibly summarized before the next user instruction'); await ctx.agents.get(project.coordinatorSessionId).whenIdle();
    const failuresBeforePeer = model.failures.length; await prompt('PEER_RECEIVER'); await ctx.agents.get(project.coordinatorSessionId).whenIdle();
    assert.equal(model.failures.length, failuresBeforePeer, JSON.stringify(model.failures.slice(failuresBeforePeer)));
    const receiver = await waitFor(() => host.state().workstreams.find(work => work.title === 'Peer receiver' && work.settlements.length), 'receiver settles without falsely completing');
    assert.equal(ctx.agentTeams.getTask(ctx.agents.get(project.coordinatorSessionId), receiver.id).status, 'in_progress');
    await waitFor(() => !host.stream(receiver.id).pendingSummary, 'the waiting receiver terminal is summarized before changing the parallel workflow');
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
    await waitFor(() => [receiver.id, dependent.id, sender.id].every(id => !host.stream(id).pendingSummary), 'all parallel peer results have their actual visible summaries before starting the next stage'); await ctx.agents.get(project.coordinatorSessionId).whenIdle();
    await prompt('READ_ONLY'); const investigation = await waitFor(() => host.state().workstreams.find(item => item.title === 'Readonly work' && item.status === 'done'), 'read-only worker settles');
    assert.equal(host.worker(investigation.workerSessionId).role, 'readonly'); assert.ok(model.failures.some(item => item.error.code === 'TOOL_GUARD_DENIED' || /shell|repository write/i.test(item.error.message)));
    assert.ok(model.failures.some(item => item.name === 'run_code'));
    await waitFor(() => !host.stream(investigation.id).pendingSummary, 'readonly result is visible before the next request'); await ctx.agents.get(project.coordinatorSessionId).whenIdle();
    await prompt('MAKE_PATH_HOLD'); await ctx.agents.get(project.coordinatorSessionId).whenIdle();
    const pathWork = host.state().workstreams.find(item => item.title === 'Path work'), pathWorker = pathWork.workerSessionId;
    await waitFor(() => ctx.agents.get(pathWorker)?.status === 'running', 'document worker remains active in its original scope');
    assert.deepEqual(host.worker(pathWorker).writePaths, ['docs/first.md']);
    assert.ok(model.failures.some(item => item.name === 'project_delegate' && /exceeds the original requirement authorization/.test(item.error.message)), JSON.stringify(model.failures));
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
    const originalLead = await ctx.sessionController.resolveAgent(project.coordinatorSessionId);
    assert.equal(originalLead.agent?.id, project.coordinatorSessionId, 'recovery resumes the original used Session instead of creating a blank replacement');
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
    const inspect = ctx.sessionController.inspect.bind(ctx.sessionController); let failOriginalLeadOnce = true;
    ctx.sessionController.inspect = async (sessionId, ...args) => {
      if (sessionId === project.coordinatorSessionId && failOriginalLeadOnce) { failOriginalLeadOnce = false; throw new Error('Injected original coordinator preset inspection failure'); }
      return inspect(sessionId, ...args);
    };
    try {
      await ctx.projects.recover();
      assert.deepEqual(ctx.projects.project(project.id).diagnostics, ['Injected original coordinator preset inspection failure']);
      assert.equal(ctx.projects.project(project.id).paused, true); assert.equal(abruptRecoveryModel.requests.length, 0);
      await ctx.projects.recover();
      assert.deepEqual(ctx.projects.project(project.id).diagnostics, [], 'successful original-Session inspection clears the resolved diagnostic');
      assert.equal(ctx.projects.project(project.id).paused, true, 'recovery does not resume the stopped user requirement');
      assert.equal(ctx.projects.project(project.id).coordinatorSessionId, project.coordinatorSessionId);
      assert.equal(ctx.projects.stream(plan.id).workerSessionId, workerId); assert.equal(abruptRecoveryModel.requests.length, 0);
    } finally { ctx.sessionController.inspect = inspect; }
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
    const firstReport = structuredClone(work('Frontend').latestReport), firstSource = structuredClone(receipt('Frontend').source), beforeSelf = stable('Frontend'), failureCount = model.failures.length;
    await prompt({ work: 'Frontend', brief: 'REJECT_SELF', deps: ['Frontend'] }); await lead.whenIdle();
    assert.deepEqual(stable('Frontend'), beforeSelf, 'self dependency leaves current result, native task and delegation untouched');
    assert.ok(model.failures.slice(failureCount).some(item => /cycle/i.test(item.error.message)));

    await prompt({ work: 'Frontend', brief: 'AFTER_BACKEND', deps: ['Backend'] }); await lead.whenIdle();
    assert.equal(receipt('Frontend').phase, 'queued'); assert.deepEqual(task('Frontend').blockedBy, [work('Backend').id]);
    assert.equal(work('Frontend').id, frontendId); assert.equal(work('Frontend').workerSessionId, frontendWorker);
    assert.equal(host.worker(frontendWorker).cwd, frontendCwd); assert.equal(model.workerInputs.some(item => item.brief === 'AFTER_BACKEND'), false);
    const firstGoal = host.state().requests.find(row => row.id === firstSource.requestId).versions.find(version => version.revision === firstSource.requestRevision);
    assert.deepEqual((await host.command('store/results', { projectId: project.id, workstreamId: frontendId })).items[0], { ...firstReport, prerequisitesChanged: false,
      request: { id: firstSource.requestId, title: firstGoal.title, revision: firstSource.requestRevision, goal: firstGoal.goal } });
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
      // Fail only the user stop's own save, the one write that records its
      // hold: cancelling the worker also queues accounting writes, and under
      // load one of those can reach write first.
      const hold = state => state.workers.find(item => item.sessionId === race.workerSessionId)?.holdSourceMessageId;
      const marksStopped = change => { const probe = structuredClone(host.state()); change(probe); return Boolean(hold(probe)) && hold(probe) !== hold(host.state()); };
      host.write = async function (change) { if (failWrite && marksStopped(change)) { failWrite = false; throw new Error('User stop persistence fault'); } return originalWrite.call(this, change); };
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
    await waitFor(() => !recovered.state().workstreams.find(work => work.title === 'After restart').pendingSummary, 'the recovered capacity result is summarized before explicitly continuing the failed member');
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
        else if (stage === 1) {
          const result = options.messages.findLast(message => message.role === 'tool');
          assert.match(messageText(result), /^\{/, messageText(result));
          const store = JSON.parse(messageText(result)), facts = store.work.find(work => work.title === 'Readonly work');
          assert.equal(facts.report, undefined); assert.ok(facts.terminal);
          const request = store.requests.find(item => item.id === facts.request.id); assert.ok(request);
          yield* call(`terminal-handover-${++this.counter}`, 'project_deliver', handover(request, `Readonly work ended ${facts.terminal.stopReason} without a report.`, 'partial', ['The worker failed before producing the required report.']));
        } else yield* blocks('Readonly work failed without a report. Its saved terminal remains available; the requested investigation is unfinished.');
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
    await waitFor(() => !host.stream(work.id).pendingSummary, 'explicit handover reaches its native persistence checkpoint');
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
    await waitFor(() => !host.stream(noReport.id).pendingSummary, 'explicit no-report handover reaches its native persistence checkpoint');
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
  const ctx = { sessionPersistence: { stat: async () => ({}) }, sessionController: { resolveAgent: async id => ({ agent: agents.get(id) }) }, agentTeams: { registerPolicy: () => () => {}, bindPolicy: async () => {}, cancelMessages: async () => {}, setCold: async () => {}, listTasks: () => [...tasks.values()], createTask: async (_root, input) => { if (!tasks.has(input.taskId)) tasks.set(input.taskId, { id: input.taskId, subject: input.subject, description: input.description, blockedBy: [], status: 'in_progress', ready: true }); return tasks.get(input.taskId); }, getTask: (_root, id) => tasks.get(id) }, agents, get: name => name === 'jobs' ? { list: () => [] } : undefined, logger: { warn() {} }, subagents: {
    registerContinuationPolicy: () => () => {}, async drainChildren(_parent, ids) { drained.push(...ids); if (ids.includes('worker-a')) await gateA; },
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
    assert.equal(service.stream('work-a').pendingSummary, true); assert.equal(service.stream('work-b').pendingSummary, true, 'reading a result and replying does not declare a delivery');
    await reply('Implement Plan (work-b): the result is ready.');
    assert.equal(service.stream('work-a').pendingSummary, true); assert.equal(service.stream('work-b').pendingSummary, true, 'naming the work in ordinary prose still cannot replace explicit delivery');
    service.notes = ProjectService.prototype.notes;
    const outside = join(root, 'outside'); await mkdir(outside); await writeFile(join(outside, 'notes.md'), 'OWNED_EXTERNAL_SENTINEL');
    await rename(store, `${store}-original`); await symlink(outside, store, process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(() => service.notes('project-a'), /replaced with a link|points outside/);
    assert.equal(await readFile(join(outside, 'notes.md'), 'utf8'), 'OWNED_EXTERNAL_SENTINEL');
  } finally { releaseA(); await Promise.all([...service.stops.values()]); service.unpolicy(); await rm(root, { recursive: true, force: true }); }
});
