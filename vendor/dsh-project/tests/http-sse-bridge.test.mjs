import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { ProjectService } from './harness-runtime.mjs';
import { createProjectsHttpHandler } from '../lib/http.js';

function makeTempDir(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

async function startTestServer(t, handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  const baseUrl = `http://127.0.0.1:${addr.port}`;
  t.after(async () => {
    handler.closeAllStreams?.();
    await new Promise((resolve) => server.close(resolve));
  });
  return baseUrl;
}

const WRITE_HEADERS = {
  'content-type': 'application/json',
  'x-projects-api': '1',
};

test('HTTP routes, connection admission, CSRF write fence, task controls, session archive guards, models, open-path, and SSE streaming', async (t) => {
  const home = makeTempDir(t, 'dsh-proj-http-home-');
  const workspace = makeTempDir(t, 'dsh-proj-http-ws-');
  const outsideDir = makeTempDir(t, 'dsh-proj-http-out-');

  let admitRequests = true;
  const archivedSessions = [];
  const restoredSessions = [];
  const openedPaths = [];
  let activeWorkerSession = '';

  const ctx = {
    get(key) {
      if (key === 'connection') {
        return {
          admit: () => (admitRequests ? { ok: true } : { rejection: 403 }),
        };
      }
      if (key === 'workspaceRegistry') {
        return {
          async archiveSession(id) {
            if (id === activeWorkerSession) {
              const err = new Error('session is active');
              err.name = 'WorkspaceActiveSessionError';
              throw err;
            }
            if (id === 'gone-session') {
              const err = new Error('unknown');
              err.name = 'WorkspaceUnknownSessionError';
              throw err;
            }
            archivedSessions.push(id);
          },
          async unarchiveSession(id) {
            restoredSessions.push(id);
          },
        };
      }
      if (key === 'llm') {
        return {
          listProviders: () => [{ id: 'deepseek' }],
          listModels: async () => [{ id: 'deepseek-reasoner', name: 'DeepSeek Reasoner' }],
          resolveModelInfo: async () => ({
            reasoning: {
              defaultEffort: 'high',
              efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }],
            },
          }),
        };
      }
      if (key === 'agentPresets') {
        return {
          list: async () => [
            { id: 'default', name: 'Default' },
            { id: 'project-coordinator', name: 'Legacy', hidden: true },
          ],
        };
      }
      if (key === 'subagents') {
        return {
          async startActivation() {
            return { childId: 'child-http-1', name: 'worker-http-1' };
          },
        };
      }
      return undefined;
    },
  };

  const service = new ProjectService(ctx, {
    home,
    desktop: async (action, payload) => {
      if (action === 'open-path') {
        openedPaths.push(payload);
        return { ok: true, canonicalPath: payload.path };
      }
      return { ok: true };
    },
  });
  t.after(() => service.dispose());

  const handler = createProjectsHttpHandler(ctx, service, { requireConnection: true });
  const baseUrl = await startTestServer(t, handler);

  // 1. Connection admission rejection
  admitRequests = false;
  const denied = await fetch(`${baseUrl}/projects-api/projects`);
  assert.equal(denied.status, 403);
  admitRequests = true;

  // 2. CSRF write fence rejects missing header or non-JSON content-type
  const noCsrf = await fetch(`${baseUrl}/projects-api/projects`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'X' }),
  });
  assert.equal(noCsrf.status, 400);
  const badCt = await fetch(`${baseUrl}/projects-api/projects`, {
    method: 'POST',
    headers: { 'content-type': 'text/plain', 'x-projects-api': '1' },
    body: JSON.stringify({ name: 'X' }),
  });
  assert.equal(badCt.status, 400);

  // 3. Connect SSE stream BEFORE mutations to verify real-time push
  const sseAbort = new AbortController();
  t.after(() => sseAbort.abort());
  const sseRes = await fetch(`${baseUrl}/projects-api/events`, { signal: sseAbort.signal });
  assert.equal(sseRes.status, 200);
  assert.match(sseRes.headers.get('content-type') || '', /text\/event-stream/);
  const reader = sseRes.body.getReader();
  const decoder = new TextDecoder();
  let sseBuffer = '';

  async function readUntil(pattern) {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      if (pattern.test(sseBuffer)) return sseBuffer;
      const { value, done } = await reader.read();
      if (done) break;
      sseBuffer += decoder.decode(value, { stream: true });
    }
    return sseBuffer;
  }

  await readUntil(/event: ready/);

  // 4. POST /projects -> 201 + SSE event: update
  const createRes = await fetch(`${baseUrl}/projects-api/projects`, {
    method: 'POST',
    headers: WRITE_HEADERS,
    body: JSON.stringify({ name: 'SSEBoard', workspace, autonomy: 'manual', concurrency: 4 }),
  });
  assert.equal(createRes.status, 201);
  const { project } = await createRes.json();
  assert.equal(project.name, 'SSEBoard');
  assert.equal(project.concurrency, 4);

  await readUntil(/project\.created/);

  // 5. POST /projects/:id/tasks is 404 (tasks created only by coordinator)
  const postTask = await fetch(`${baseUrl}/projects-api/projects/${project.id}/tasks`, {
    method: 'POST',
    headers: WRITE_HEADERS,
    body: JSON.stringify({ title: 'Forbidden' }),
  });
  assert.equal(postTask.status, 404);

  // 6. Add task via service, test approve, narrow PATCH, stop, retry
  const { task } = await service.addTask(project.id, { title: 'UI Task', brief: 'Build UI' });
  await readUntil(/task\.added/);

  // Approve is idempotent
  const approve1 = await fetch(`${baseUrl}/projects-api/projects/${project.id}/tasks/${task.id}/approve`, {
    method: 'POST',
    headers: WRITE_HEADERS,
  });
  assert.equal(approve1.status, 200);
  assert.equal((await approve1.json()).task.approved, true);

  // PATCH task rejects foreign fields and non-human statuses
  const badPatch1 = await fetch(`${baseUrl}/projects-api/projects/${project.id}/tasks/${task.id}`, {
    method: 'PATCH',
    headers: WRITE_HEADERS,
    body: JSON.stringify({ title: 'Hacked' }),
  });
  assert.equal(badPatch1.status, 400);
  const badPatch2 = await fetch(`${baseUrl}/projects-api/projects/${project.id}/tasks/${task.id}`, {
    method: 'PATCH',
    headers: WRITE_HEADERS,
    body: JSON.stringify({ status: 'running' }),
  });
  assert.equal(badPatch2.status, 400);

  // PATCH task accepts resolved <-> review
  const resolveRes = await fetch(`${baseUrl}/projects-api/projects/${project.id}/tasks/${task.id}`, {
    method: 'PATCH',
    headers: WRITE_HEADERS,
    body: JSON.stringify({ status: 'resolved' }),
  });
  assert.equal(resolveRes.status, 200);
  assert.equal((await resolveRes.json()).task.status, 'resolved');

  const unresolveRes = await fetch(`${baseUrl}/projects-api/projects/${project.id}/tasks/${task.id}`, {
    method: 'PATCH',
    headers: WRITE_HEADERS,
    body: JSON.stringify({ status: 'review' }),
  });
  assert.equal(unresolveRes.status, 200);
  assert.equal((await unresolveRes.json()).task.status, 'review');

  // Dispatch, then stop via HTTP, then retry via HTTP
  await service.dispatchTask(project.id, task.id, { agent: { id: 'coord-x' } });
  const stopRes = await fetch(`${baseUrl}/projects-api/projects/${project.id}/tasks/${task.id}/stop`, {
    method: 'POST',
    headers: WRITE_HEADERS,
  });
  assert.equal(stopRes.status, 200);
  assert.equal((await stopRes.json()).task.status, 'blocked');

  const retryRes = await fetch(`${baseUrl}/projects-api/projects/${project.id}/tasks/${task.id}/retry`, {
    method: 'POST',
    headers: WRITE_HEADERS,
  });
  assert.equal(retryRes.status, 200);
  const retryBody = await retryRes.json();
  assert.equal(retryBody.retried, true);
  assert.equal(retryBody.task.status, 'queued');

  // 7. Memory HTTP routes
  const memSave = await fetch(`${baseUrl}/projects-api/projects/${project.id}/memory`, {
    method: 'POST',
    headers: WRITE_HEADERS,
    body: JSON.stringify({ name: 'notes', description: 'Key facts', text: 'Use SSE.' }),
  });
  assert.equal(memSave.status, 200);
  const memRead = await fetch(`${baseUrl}/projects-api/projects/${project.id}/memory/notes`);
  assert.equal(memRead.status, 200);
  assert.equal((await memRead.json()).text, 'Use SSE.');

  const memIdx = await fetch(`${baseUrl}/projects-api/projects/${project.id}/memory/MEMORY.md`);
  assert.equal(memIdx.status, 200);
  assert.equal((await memIdx.json()).readOnly, true);

  const delIdx = await fetch(`${baseUrl}/projects-api/projects/${project.id}/memory/MEMORY.md`, {
    method: 'DELETE',
    headers: WRITE_HEADERS,
  });
  assert.equal(delIdx.status, 400);

  // 8. Task DELETE session action validation & archiving
  for (const forbidden of ['1', 'true', 'delete', 'remove', 'yes']) {
    const res = await fetch(`${baseUrl}/projects-api/projects/${project.id}/tasks/${task.id}?session=${forbidden}`, {
      method: 'DELETE',
      headers: WRITE_HEADERS,
    });
    assert.equal(res.status, 400, `?session=${forbidden} must return 400`);
  }

  // Running worker session archive refuses with 409 and preserves task
  activeWorkerSession = 'child-http-1';
  const activeDel = await fetch(`${baseUrl}/projects-api/projects/${project.id}/tasks/${task.id}?session=archive`, {
    method: 'DELETE',
    headers: WRITE_HEADERS,
  });
  assert.equal(activeDel.status, 409);
  activeWorkerSession = '';

  // Idle worker session archive succeeds
  const okDel = await fetch(`${baseUrl}/projects-api/projects/${project.id}/tasks/${task.id}?session=archive`, {
    method: 'DELETE',
    headers: WRITE_HEADERS,
  });
  assert.equal(okDel.status, 200);
  const okDelBody = await okDel.json();
  assert.equal(okDelBody.deleted, true);
  assert.deepEqual(okDelBody.session, { id: 'child-http-1', archived: true });
  assert.deepEqual(archivedSessions, ['child-http-1']);

  // 9. GET /models & POST /sessions/restore & POST /open-path
  const modelsRes = await fetch(`${baseUrl}/projects-api/models`);
  assert.equal(modelsRes.status, 200);
  const modelsBody = await modelsRes.json();
  assert.equal(modelsBody.enumerable, true);
  assert.equal(modelsBody.models[0].id, 'deepseek/deepseek-reasoner');
  assert.equal(modelsBody.models[0].efforts.length, 2);
  // Hidden legacy presets are filtered from user-visible preset list
  assert.deepEqual(modelsBody.presets.map((p) => p.id), ['default']);

  const restoreRes = await fetch(`${baseUrl}/projects-api/sessions/restore`, {
    method: 'POST',
    headers: WRITE_HEADERS,
    body: JSON.stringify({ sessionId: 'coord-1' }),
  });
  assert.equal(restoreRes.status, 200);
  assert.deepEqual(restoredSessions, ['coord-1']);

  const openOk = await fetch(`${baseUrl}/projects-api/open-path`, {
    method: 'POST',
    headers: WRITE_HEADERS,
    body: JSON.stringify({ projectId: project.id }),
  });
  assert.equal(openOk.status, 200);
  assert.equal(openedPaths.length, 1);

  const openOutside = await fetch(`${baseUrl}/projects-api/open-path`, {
    method: 'POST',
    headers: WRITE_HEADERS,
    body: JSON.stringify({ projectId: project.id, path: outsideDir }),
  });
  assert.equal(openOutside.status, 403);

  sseAbort.abort();
});

test('dsh-whale bridge contract: listBridgeSummaries, inspectBridgeProject, and acceptAuthorizedHandoff with deduplication', async (t) => {
  const home = makeTempDir(t, 'dsh-proj-bridge-home-');
  const repoDir = makeTempDir(t, 'dsh-proj-bridge-repo-');

  const leadEvents = [];
  const lead = {
    id: 'coord-bridge',
    session: {
      id: 'coord-bridge',
      snapshotEvents: () => leadEvents,
    },
    async followup(message) {
      leadEvents.push({ seq: leadEvents.length, type: 'user/message', data: message });
    },
  };

  const ctx = {
    agents: new Map([['coord-bridge', lead]]),
    get(key) {
      if (key === 'agents') return this.agents;
      return undefined;
    },
  };

  const service = new ProjectService(ctx, { home });
  t.after(() => service.dispose());

  const project = await service.createProject({ name: 'BridgeRepo', workspace: repoDir });
  await service.updateProject(project.id, { coordinatorSessionId: 'coord-bridge' });
  await service.memory.writeMemoryFile(project.id, { name: 'overview', text: 'Status good.' });

  const summaries = service.listBridgeSummaries();
  assert.equal(summaries.available, true);
  assert.equal(summaries.projects.length, 1);
  assert.equal(summaries.projects[0].projectId, project.id);
  assert.equal(summaries.projects[0].title, 'BridgeRepo');
  assert.equal(summaries.projects[0].lifecycle, 'ready');

  const inspected = service.inspectBridgeProject({ cwd: repoDir });
  assert.equal(inspected.found, true);
  assert.equal(inspected.project.coordinatorSessionId, 'coord-bridge');
  assert.match(inspected.project.notesPreview, /overview/);

  // Fail closed when confirmedByDesktop !== true
  await assert.rejects(
    () => service.acceptAuthorizedHandoff({ projectId: project.id, goal: 'Bypass', confirmedByDesktop: false }),
    /确认/,
  );

  // Authorized handoff delivers user message & deduplicates by handoffId
  const delivered = await service.acceptAuthorizedHandoff({
    projectId: project.id,
    title: 'Audit parser',
    goal: 'Check edge cases',
    scopeCeiling: 'docs',
    writePaths: ['docs/audit.md'],
    confirmedByDesktop: true,
    handoffId: 'handoff-1',
    sourceSessionId: 'whale-resident',
  });
  assert.equal(delivered.accepted, true);
  assert.equal(delivered.deduplicated, false);
  assert.equal(leadEvents.length, 1);

  const dup = await service.acceptAuthorizedHandoff({
    projectId: project.id,
    goal: 'Check edge cases',
    scopeCeiling: 'docs',
    confirmedByDesktop: true,
    handoffId: 'handoff-1',
  });
  assert.equal(dup.accepted, true);
  assert.equal(dup.deduplicated, true);
  assert.equal(leadEvents.length, 1);
});

test('HTTP coordinator/ensure, DELETE project, workspace validation, and bridge archived-coordinator restore', async (t) => {
  const home = makeTempDir(t, 'dsh-proj-ensure-home-');
  const workspaceDir = makeTempDir(t, 'dsh-proj-ensure-ws-');
  fs.writeFileSync(path.join(workspaceDir, 'keep.txt'), 'user source file\n');

  const createdSessions = [];
  const presentationUpdates = [];
  const archivedSessions = new Set();
  const leadEvents = [];
  const liveAgents = new Map();

  const sessionController = {
    async create(opts = {}) {
      const id = `coord-ensured-${createdSessions.length + 1}`;
      createdSessions.push({ id, opts });
      const agent = {
        id,
        session: { id, snapshotEvents: () => leadEvents },
        async followup(message) {
          leadEvents.push({ seq: leadEvents.length, type: 'user/message', data: message });
        },
      };
      liveAgents.set(id, agent);
      return { id, sessionId: id };
    },
    async inspect(id) {
      if (!liveAgents.has(id)) {
        const err = new Error('not found');
        err.name = 'ApiSessionNotFound';
        throw err;
      }
      return { id };
    },
    async setPresentation(req) {
      presentationUpdates.push(req);
      return { ok: true };
    },
  };

  const workspaceRegistry = {
    get archivedSessionIds() { return [...archivedSessions]; },
    async archiveSession(id) { archivedSessions.add(id); },
    async unarchiveSession(id) { archivedSessions.delete(id); },
  };

  const ctx = {
    connection: { admit: () => ({ ok: true }) },
    sessionController,
    workspaceRegistry,
    agents: liveAgents,
    subagents: {
      async startActivation() { return { childId: 'w-http-1', name: 'w-1' }; },
    },
    get(key) {
      return this[key];
    },
  };

  const service = new ProjectService(ctx, { home });
  t.after(() => service.dispose());

  const handler = createProjectsHttpHandler(ctx, service, { requireConnection: true });
  const server = http.createServer((req, res) => handler(req, res));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    handler.closeAllStreams();
    server.close();
  });
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  // 1. Invalid workspace (relative path & $DSH_HOME) rejected with 400 + code: 'invalid_workspace'
  const badRel = await fetch(`${baseUrl}/projects-api/projects`, {
    method: 'POST',
    headers: WRITE_HEADERS,
    body: JSON.stringify({ name: 'BadRel', workspace: 'relative/path' }),
  });
  assert.equal(badRel.status, 400);
  assert.equal((await badRel.json()).code, 'invalid_workspace');

  const badHome = await fetch(`${baseUrl}/projects-api/projects`, {
    method: 'POST',
    headers: WRITE_HEADERS,
    body: JSON.stringify({ name: 'BadHome', workspace: home }),
  });
  assert.equal(badHome.status, 400);
  assert.equal((await badHome.json()).code, 'invalid_workspace');

  // 2. Create valid project & call POST /coordinator/ensure idempotently
  const createRes = await fetch(`${baseUrl}/projects-api/projects`, {
    method: 'POST',
    headers: WRITE_HEADERS,
    body: JSON.stringify({ name: 'EnsuredProj', workspace: workspaceDir }),
  });
  assert.equal(createRes.status, 201);
  const { project } = await createRes.json();

  const ensure1 = await fetch(`${baseUrl}/projects-api/projects/${project.id}/coordinator/ensure`, {
    method: 'POST',
    headers: WRITE_HEADERS,
    body: JSON.stringify({}),
  });
  assert.equal(ensure1.status, 200);
  const ensured1Body = await ensure1.json();
  assert.equal(ensured1Body.created, true);
  assert.equal(ensured1Body.archived, false);
  assert.equal(ensured1Body.coordinatorSessionId, 'coord-ensured-1');
  assert.equal(createdSessions[0].opts.presentation.owner, 'dsh-project');
  assert.equal(createdSessions[0].opts.presentation.title, 'EnsuredProj');

  // Second ensure is idempotent (does not create a second session)
  const ensure2 = await fetch(`${baseUrl}/projects-api/projects/${project.id}/coordinator/ensure`, {
    method: 'POST',
    headers: WRITE_HEADERS,
    body: JSON.stringify({}),
  });
  const ensured2Body = await ensure2.json();
  assert.equal(ensured2Body.created, false);
  assert.equal(ensured2Body.coordinatorSessionId, 'coord-ensured-1');
  assert.equal(createdSessions.length, 1);

  // Rename syncs presentation title
  await fetch(`${baseUrl}/projects-api/projects/${project.id}`, {
    method: 'PATCH',
    headers: WRITE_HEADERS,
    body: JSON.stringify({ name: 'RenamedProj' }),
  });
  assert.equal(presentationUpdates.at(-1).presentation.title, 'RenamedProj');

  // Archived coordinator reported on ensure, and auto-restored by restore: true or bridge handoff
  await workspaceRegistry.archiveSession('coord-ensured-1');
  const ensureArchived = await fetch(`${baseUrl}/projects-api/projects/${project.id}/coordinator/ensure`, {
    method: 'POST',
    headers: WRITE_HEADERS,
    body: JSON.stringify({}),
  });
  assert.equal((await ensureArchived.json()).archived, true);

  const handoffRes = await service.acceptAuthorizedHandoff({
    projectId: project.id,
    goal: 'Auto restore archived coordinator',
    scopeCeiling: 'research',
    confirmedByDesktop: true,
    handoffId: 'handoff-restore-1',
  });
  assert.equal(handoffRes.accepted, true);
  assert.equal(archivedSessions.has('coord-ensured-1'), false);

  // Approve task returns { task, dispatched: true }
  const { task } = await service.addTask(project.id, { title: 'Approve HTTP test' });
  const approveRes = await fetch(`${baseUrl}/projects-api/projects/${project.id}/tasks/${task.id}/approve`, {
    method: 'POST',
    headers: WRITE_HEADERS,
    body: JSON.stringify({}),
  });
  assert.equal(approveRes.status, 200);
  const approveBody = await approveRes.json();
  assert.equal(approveBody.dispatched, true);
  assert.equal(approveBody.task.status, 'running');

  // 3. DELETE /projects/:id stops running task, archives sessions, deletes store dir, preserves user workspace!
  const delRes = await fetch(`${baseUrl}/projects-api/projects/${project.id}?archiveSessions=1`, {
    method: 'DELETE',
    headers: WRITE_HEADERS,
  });
  assert.equal(delRes.status, 200);
  const delBody = await delRes.json();
  assert.equal(delBody.deleted, true);
  assert.deepEqual(delBody.stoppedTasks, [task.id]);
  assert.ok(delBody.archivedSessions.includes('coord-ensured-1'));
  assert.ok(delBody.archivedSessions.includes('w-http-1'));
  assert.equal(fs.existsSync(path.join(home, 'projects', project.id)), false);
  assert.equal(fs.readFileSync(path.join(workspaceDir, 'keep.txt'), 'utf8'), 'user source file\n');
});

test('HTTP Library (references & artifacts), Memory search/pin/sourceTaskId/tokens, and open-path for library files', async (t) => {
  const home = makeTempDir(t, 'dsh-proj-lib-home-');
  const workspaceDir = makeTempDir(t, 'dsh-proj-lib-ws-');
  const outsideDocsDir = makeTempDir(t, 'dsh-proj-lib-ext-');
  const wsDoc = path.join(workspaceDir, 'docs', 'spec.md');
  const artifactFile = path.join(workspaceDir, 'dist', 'report.html');
  const extDoc = path.join(outsideDocsDir, 'external-brief.md');
  fs.mkdirSync(path.dirname(wsDoc), { recursive: true });
  fs.mkdirSync(path.dirname(artifactFile), { recursive: true });
  fs.writeFileSync(wsDoc, '# Architecture Spec\n', 'utf8');
  fs.writeFileSync(artifactFile, '<h1>Delivery Report</h1>\n', 'utf8');
  fs.writeFileSync(extDoc, '# External Reference\n', 'utf8');

  const opened = [];
  const ctx = {
    connection: { admit: () => ({ ok: true }) },
    get(key) { return this[key]; },
  };
  const service = new ProjectService(ctx, {
    home,
    desktop: async (action, payload) => {
      opened.push({ action, payload });
      return { ok: true, canonicalPath: payload?.path };
    },
  });
  t.after(() => service.dispose());

  const handler = createProjectsHttpHandler(ctx, service, { requireConnection: true });
  const server = http.createServer((req, res) => handler(req, res));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    handler.closeAllStreams();
    server.close();
  });
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const project = await service.createProject({ name: 'LibraryProj', workspace: workspaceDir });
  const { task } = await service.addTask(project.id, { title: 'Generate report' });

  // 1. Add workspace-relative & external absolute references; reject internal project.json and directory
  const addWsRef = await fetch(`${baseUrl}/projects-api/projects/${project.id}/library/references`, {
    method: 'POST',
    headers: WRITE_HEADERS,
    body: JSON.stringify({ path: 'docs/spec.md', title: '架构规格', note: '核心参考' }),
  });
  assert.equal(addWsRef.status, 201);
  const wsRefBody = await addWsRef.json();
  assert.equal(wsRefBody.reference.title, '架构规格');
  assert.equal(wsRefBody.reference.relativePath, 'docs/spec.md');

  const addExtRef = await fetch(`${baseUrl}/projects-api/projects/${project.id}/library/references`, {
    method: 'POST',
    headers: WRITE_HEADERS,
    body: JSON.stringify({ path: extDoc }),
  });
  assert.equal(addExtRef.status, 201);
  const extRefId = (await addExtRef.json()).reference.id;

  const badInternal = await fetch(`${baseUrl}/projects-api/projects/${project.id}/library/references`, {
    method: 'POST',
    headers: WRITE_HEADERS,
    body: JSON.stringify({ path: path.join(home, 'projects', project.id, 'project.json') }),
  });
  assert.equal(badInternal.status, 403);

  const badDir = await fetch(`${baseUrl}/projects-api/projects/${project.id}/library/references`, {
    method: 'POST',
    headers: WRITE_HEADERS,
    body: JSON.stringify({ path: workspaceDir }),
  });
  assert.equal(badDir.status, 400);

  // 2. Explicit task artifact recorded via service.updateTask -> appears in GET /library and GET /projects/:id
  await service.updateTask(project.id, task.id, {
    artifacts: [{ path: 'dist/report.html', title: '交付报告' }],
  });
  const libRes = await fetch(`${baseUrl}/projects-api/projects/${project.id}/library`);
  assert.equal(libRes.status, 200);
  const libBody = await libRes.json();
  assert.equal(libBody.references.length, 2);
  assert.equal(libBody.artifacts.length, 1);
  assert.equal(libBody.artifacts[0].title, '交付报告');
  assert.equal(libBody.artifacts[0].kind, 'html');
  assert.equal(libBody.artifacts[0].taskId, task.id);

  // GET /projects/:id also bundles library
  const detailRes = await fetch(`${baseUrl}/projects-api/projects/${project.id}`);
  const detailBody = await detailRes.json();
  assert.equal(detailBody.library.references.length, 2);
  assert.equal(detailBody.library.artifacts.length, 1);

  // 3. open-path authorizes registered external reference file
  const openExt = await fetch(`${baseUrl}/projects-api/open-path`, {
    method: 'POST',
    headers: WRITE_HEADERS,
    body: JSON.stringify({ projectId: project.id, path: extDoc }),
  });
  assert.equal(openExt.status, 200);
  assert.equal(opened.length, 1);

  // 4. Delete reference removes pointer ONLY and preserves disk file
  const delRef = await fetch(`${baseUrl}/projects-api/projects/${project.id}/library/references/${extRefId}`, {
    method: 'DELETE',
    headers: WRITE_HEADERS,
  });
  assert.equal(delRef.status, 200);
  assert.equal((await delRef.json()).references.length, 1);
  assert.equal(fs.existsSync(extDoc), true, 'deleting library reference must never delete disk file');

  // 5. Memory POST with sourceTaskId + PATCH pinned + GET ?q= Chinese 2-gram search + token budget
  const postMem1 = await fetch(`${baseUrl}/projects-api/projects/${project.id}/memory`, {
    method: 'POST',
    headers: WRITE_HEADERS,
    body: JSON.stringify({
      name: 'release-guide',
      description: '项目构建与发布流程记录',
      sourceTaskId: task.id,
      text: '打包前先验证签名与回滚策略，再推送更新元数据。',
    }),
  });
  assert.equal(postMem1.status, 200);
  const postMem1Body = await postMem1.json();
  assert.equal(postMem1Body.sourceTaskId, task.id);
  assert.ok(postMem1Body.estimatedTokens > 0);

  await fetch(`${baseUrl}/projects-api/projects/${project.id}/memory`, {
    method: 'POST',
    headers: WRITE_HEADERS,
    body: JSON.stringify({
      name: 'ui-tokens',
      description: '视觉令牌约定',
      text: '统一使用透明背景与发丝线。',
    }),
  });

  const pinRes = await fetch(`${baseUrl}/projects-api/projects/${project.id}/memory/release-guide`, {
    method: 'PATCH',
    headers: WRITE_HEADERS,
    body: JSON.stringify({ pinned: true }),
  });
  assert.equal(pinRes.status, 200);
  assert.equal((await pinRes.json()).file.pinned, true);

  const memListRes = await fetch(`${baseUrl}/projects-api/projects/${project.id}/memory`);
  const memListBody = await memListRes.json();
  assert.equal(memListBody.memory.hotCount, 2);
  assert.equal(memListBody.memory.pinnedCount, 1);
  assert.ok(memListBody.memory.estimatedTokens > 0);
  assert.ok(memListBody.memory.budgetTokens > 0);
  assert.equal(memListBody.memory.files[0].name, 'release-guide', 'pinned topic should sort first');

  // Chinese 2-gram query matches across non-contiguous words ("发布" + "策略")
  const searchRes = await fetch(`${baseUrl}/projects-api/projects/${project.id}/memory?q=${encodeURIComponent('发布策略')}`);
  assert.equal(searchRes.status, 200);
  const searchBody = await searchRes.json();
  assert.equal(searchBody.matches.length, 1);
  assert.equal(searchBody.matches[0].name, 'release-guide');
  assert.ok(searchBody.matches[0].score > 0);
});
