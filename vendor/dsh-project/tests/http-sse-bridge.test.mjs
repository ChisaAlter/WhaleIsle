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
          admit: () => (admitRequests ? { peer: { principal: { kind: 'owner' } } } : { rejection: 403 }),
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

test('HTTP handler enforces owner principal from WebServer peer parameter (401/403/200)', async (t) => {
  const home = makeTempDir(t, 'dsh-proj-peer-home-');
  const service = new ProjectService({ get: () => undefined }, { home });
  t.after(() => service.dispose());
  const handler = createProjectsHttpHandler({ get: () => undefined }, service, { requireConnection: true });

  const callWithPeer = async (peer) => {
    const req = { method: 'GET', url: '/projects-api/projects', headers: {} };
    const headers = {};
    let body = '';
    const res = {
      statusCode: 0,
      setHeader(k, v) { headers[k.toLowerCase()] = v; },
      end(chunk) { body = String(chunk ?? ''); },
    };
    await handler(req, res, peer);
    return { status: res.statusCode, body: JSON.parse(body || '{}') };
  };

  assert.equal((await callWithPeer(undefined)).status, 401);
  assert.equal((await callWithPeer({ principal: { kind: 'viewer' } })).status, 403);
  const ok = await callWithPeer({ principal: { kind: 'owner' } });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body, { projects: [] });
});
