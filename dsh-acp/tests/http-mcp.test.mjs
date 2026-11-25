import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { apply } from '../lib/index.js';
import { saveAgentsConfig } from '../lib/presets.js';
import { createWhaleIsleMcp } from '../lib/mcp-server.js';
import { allowDesktopConfirm } from './confirm-stub.mjs';

const tempDir = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

async function mountHttpPlugin({ requestRejection, storeFile }) {
  const routes = [];
  const cleanups = [];
  const server = http.createServer((req, res) => {
    const route = routes.find((r) => req.url.startsWith(r.path));
    if (route) void route.handler(req, res);
    else { res.writeHead(404); res.end('no route'); }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const ctx = {
    connection: requestRejection === undefined ? {} : { requestRejection },
    llm: { registerAdapter: () => () => {} },
    webServer: {
      getOrigin: () => origin,
      register: (route) => {
        routes.push(route);
        return () => { const i = routes.indexOf(route); if (i >= 0) routes.splice(i, 1); };
      },
    },
    on: () => () => {},
    inject: () => {},
    effect: (fn) => {
      const cleanup = fn();
      if (typeof cleanup === 'function') cleanups.push(cleanup);
    },
  };
  apply(ctx, { storeFile });
  return {
    origin,
    port: server.address().port,
    async dispose() {
      for (const fn of cleanups.reverse()) await fn();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

function rawRequest({ port, method = 'POST', path: reqPath, headers = {}, body = '' }) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: reqPath, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

test('HTTP /dsh-acp-agents/* enforces fail-closed requestRejection, body limits, content-type, path validation, and MCP pre-body Host/Origin/Bearer checks', async () => {
  const root = tempDir('acp-http-guard-');
  const storeFile = path.join(root, 'agents.json');
  saveAgentsConfig([], storeFile);

  // 1) Missing ctx.connection.requestRejection fails closed with 503 on non-MCP endpoints
  const noAuthHost = await mountHttpPlugin({ requestRejection: undefined, storeFile });
  try {
    const res = await rawRequest({
      port: noAuthHost.port,
      path: '/dsh-acp-agents/catalog',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: '1', method: 'catalog', payload: {} }),
    });
    assert.equal(res.status, 503);
  } finally {
    await noAuthHost.dispose();
  }

  // 2) Full HTTP boundary matrix with active requestRejection
  let rejectCode = undefined;
  const host = await mountHttpPlugin({ requestRejection: () => rejectCode, storeFile });
  try {
    // requestRejection 401/403 enforced
    rejectCode = 403;
    assert.equal(
      (await rawRequest({
        port: host.port,
        path: '/dsh-acp-agents/catalog',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      })).status,
      403,
    );
    rejectCode = undefined;

    // Method & path traversal guards -> 404
    assert.equal((await rawRequest({ port: host.port, method: 'GET', path: '/dsh-acp-agents/catalog' })).status, 404);
    assert.equal((await rawRequest({ port: host.port, path: '/dsh-acp-agents/../etc/passwd', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 404);
    assert.equal((await rawRequest({ port: host.port, path: '/dsh-acp-agents/bad%20name', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 404);

    // Content-Type guard -> 415
    assert.equal((await rawRequest({ port: host.port, path: '/dsh-acp-agents/catalog', headers: { 'content-type': 'text/plain' }, body: '{}' })).status, 415);

    // Invalid JSON -> 400
    assert.equal((await rawRequest({ port: host.port, path: '/dsh-acp-agents/catalog', headers: { 'content-type': 'application/json' }, body: '{bad' })).status, 400);

    // Declared Content-Length > 2 MiB -> 413
    const oversized = 'x'.repeat(2 * 1024 * 1024 + 10);
    const overRes = await rawRequest({
      port: host.port,
      path: '/dsh-acp-agents/catalog',
      headers: { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(oversized)) },
      body: oversized,
    }).catch((err) => ({ status: err.code === 'ECONNRESET' ? 413 : 0 }));
    assert.equal(overRes.status, 413);

    // Invalid client-request envelope -> ok: false
    const badEnv = await rawRequest({
      port: host.port,
      path: '/dsh-acp-agents/catalog',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: '1', method: 'other', payload: {} }),
    });
    assert.equal(badEnv.status, 200);
    assert.equal(JSON.parse(badEnv.text).result.ok, false);

    // MCP endpoint: bad Host header rejected before body read
    const badHost = await rawRequest({
      port: host.port,
      path: '/dsh-acp-agents/mcp',
      headers: { host: 'evil.example:80', 'content-type': 'application/json', authorization: 'Bearer invalid' },
      body: '{invalid-json-never-parsed',
    });
    assert.equal(badHost.status, 403);

    // MCP endpoint: non-loopback Origin rejected
    const badOrigin = await rawRequest({
      port: host.port,
      path: '/dsh-acp-agents/mcp',
      headers: { origin: 'https://evil.example', 'content-type': 'application/json', authorization: 'Bearer invalid' },
      body: '{}',
    });
    assert.equal(badOrigin.status, 403);

    // MCP endpoint: missing / invalid Bearer rejected with 401 before body JSON parsing
    const badAuth = await rawRequest({
      port: host.port,
      path: '/dsh-acp-agents/mcp',
      headers: { 'content-type': 'application/json', authorization: 'Bearer forged-token' },
      body: '{not-json-proving-pre-body-auth',
    });
    assert.equal(badAuth.status, 401);
  } finally {
    await host.dispose();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('MCP server enforces token liveness, modelInvocable skill guards, whaleisle_present workspace containment, open-turn gating, and send_message followup confirm', async (t) => {
  const root = tempDir('acp-mcp-matrix-');
  const workspace = path.join(root, 'workspace');
  const outside = path.join(root, 'outside');
  fs.mkdirSync(workspace, { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  const okFile = path.join(workspace, 'report.md');
  const secretFile = path.join(outside, 'secret.txt');
  fs.writeFileSync(okFile, '# Report');
  fs.writeFileSync(secretFile, 'top-secret');
  const linkDir = path.join(workspace, 'ext-link');
  fs.symlinkSync(outside, linkDir, process.platform === 'win32' ? 'junction' : 'dir');

  let fakeNow = 1_000_000;
  let openTurn = true;
  const presentedEvents = [];
  const dshSession = {
    id: 'parent-1',
    header: { cwd: workspace },
    snapshotEvents: () => (openTurn ? [{ type: 'turn/start', seq: 1 }] : [{ type: 'turn/start', seq: 1 }, { type: 'turn/end', seq: 2 }]),
    append: (type, data) => presentedEvents.push({ type, data }),
  };
  const parentAgent = {
    id: 'parent-1',
    options: { provider: 'acp:alpha' },
    session: dshSession,
  };
  const skillsCatalog = [
    { name: 'public-skill', description: 'Public', source: 'local', content: 'Use me', invocation: { modelInvocable: true } },
    { name: 'hidden-skill', description: 'Hidden', source: 'local', content: 'Secret', invocation: { modelInvocable: false } },
  ];
  let followups = 0;
  let delegates = 0;
  const completedTask = { taskId: 'task-done', childId: 'child-1', parentId: 'parent-1', endedAt: 123, agentName: 'Beta', model: 'm' };
  const runningTask = { taskId: 'task-run', childId: 'child-2', parentId: 'parent-1', endedAt: undefined, agentName: 'Beta', model: 'm' };

  const ctx = {
    agents: new Map([[parentAgent.id, parentAgent]]),
    skills: {
      list: async () => skillsCatalog,
      get: async (name) => skillsCatalog.find((s) => s.name === name),
    },
    fs: {
      lstat: async (p, { cwd }) => {
        const full = path.resolve(cwd, p);
        try {
          const st = fs.lstatSync(full);
          return { type: st.isSymbolicLink() ? 'symlink' : st.isFile() ? 'file' : 'directory' };
        } catch {
          return undefined;
        }
      },
      resolve: async (p, { cwd }) => path.resolve(cwd, p),
      stat: async (target) => {
        try {
          const st = fs.statSync(target);
          return { type: st.isFile() ? 'file' : 'directory' };
        } catch {
          return undefined;
        }
      },
      processPath: (target) => target,
    },
    sessionProjections: {
      stateOf: () => ({ openTurnStartSeq: openTurn ? 1 : null, lastTurn: 1 }),
    },
    subagents: {
      resolveName: async (_p, id) => id,
      sendMessage: async () => 'msg-native',
    },
    get(name) { return this[name]; },
  };

  const mcp = createWhaleIsleMcp({
    ctx,
    listAgents: () => [{ id: 'beta' }],
    preflightDelegate: (args) => {
      if (args.client_request_id === 'already-done') return { existingTask: completedTask, resolvedCwd: workspace, effectiveModel: 'default' };
      if (args.agent !== 'beta') throw new Error('Agent not enabled');
      return { resolvedCwd: workspace, effectiveModel: 'default' };
    },
    delegate: async (args) => {
      if (args.client_request_id === 'already-done') return { childId: 'child-1', taskId: 'task-done', recovered: true };
      delegates += 1;
      return { childId: 'child-new', taskId: 'task-new' };
    },
    tasks: {
      latest: (_pid, cid) => (cid === 'child-1' ? completedTask : cid === 'child-2' ? runningTask : undefined),
      get: (_pid, tid) => (tid === 'task-done' ? completedTask : runningTask),
      snapshot: async () => ({ subagentId: 'child-1', taskId: 'task-done', status: 'completed', output: [] }),
      followup: async () => { followups += 1; return 'msg-followup'; },
      cancel: async () => ({ subagentId: 'child-2', taskId: 'task-run', status: 'cancelled', output: [] }),
    },
    livenessWindowMs: 5_000,
    now: () => fakeNow,
  });

  try {
    const token = mcp.issueToken({ cwd: workspace, agentName: 'Alpha', dshSession });
    assert.ok(mcp.sessionFor(token));
    const ac = new AbortController();
    mcp.bindSession(token, dshSession, ac.signal, 'acp:alpha');

    // Non-object arguments rejected with JSON-RPC -32602
    const badArgs = await mcp.dispatch({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'acp_agents', arguments: ['bad'] } }, mcp.sessionFor(token));
    assert.equal(badArgs.body.error.code, -32602);

    // Skills: list filters hidden-skill; get rejects hidden-skill
    const skillList = await mcp.dispatch({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'whaleisle_skill_list', arguments: {} } }, mcp.sessionFor(token));
    assert.deepEqual(skillList.body.result.structuredContent.skills.map((s) => s.name), ['public-skill']);
    const hiddenGet = await mcp.dispatch({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'whaleisle_skill_get', arguments: { name: 'hidden-skill' } } }, mcp.sessionFor(token));
    assert.equal(hiddenGet.body.result.isError, true);

    // whaleisle_present: blocks outside file (existing or non-existent) & symlink escape with generic error, allows in-workspace file
    const missingOutside = path.join(outside, 'does-not-exist.txt');
    const outsideErrs = [];
    for (const badPath of [secretFile, missingOutside, path.join(linkDir, 'secret.txt')]) {
      const denied = await mcp.dispatch({
        jsonrpc: '2.0', id: 4, method: 'tools/call',
        params: { name: 'whaleisle_present', arguments: { files: [{ path: badPath }] } },
      }, mcp.sessionFor(token));
      assert.equal(denied.body.result.isError, true, `must deny ${badPath}`);
      assert.match(denied.body.result.content[0].text, /path must be inside the session workspace/i);
      outsideErrs.push(denied.body.result.content[0].text);
    }
    assert.doesNotMatch(outsideErrs[2], /outside/, 'symlink rejection must not leak resolved realpath outside workspace');
    const okPresent = await mcp.dispatch({
      jsonrpc: '2.0', id: 5, method: 'tools/call',
      params: { name: 'whaleisle_present', arguments: { files: [{ path: 'report.md', description: 'Summary' }] } },
    }, mcp.sessionFor(token));
    assert.equal(okPresent.body.result.isError, undefined);
    assert.equal(presentedEvents.length, 1);

    // acp_delegate preflight: invalid agent & idempotent hit both skip desktop confirmation (no stub installed yet)
    const invalidDel = await mcp.dispatch({
      jsonrpc: '2.0', id: 6, method: 'tools/call',
      params: { name: 'acp_delegate', arguments: { agent: 'unknown', prompt: 'hi' } },
    }, mcp.sessionFor(token));
    assert.equal(invalidDel.body.result.isError, true);
    assert.match(invalidDel.body.result.content[0].text, /not enabled/);

    const idemDel = await mcp.dispatch({
      jsonrpc: '2.0', id: 7, method: 'tools/call',
      params: { name: 'acp_delegate', arguments: { agent: 'beta', prompt: 'hi', client_request_id: 'already-done' } },
    }, mcp.sessionFor(token));
    assert.equal(idemDel.body.result.isError, false);
    assert.equal(delegates, 0);

    // send_message to completed external ACP child requires desktop confirmation (fails closed without confirm stub)
    const deniedFollowup = await mcp.dispatch({
      jsonrpc: '2.0', id: 8, method: 'tools/call',
      params: { name: 'send_message', arguments: { agent_id: 'child-1', message: 'new work' } },
    }, mcp.sessionFor(token));
    assert.equal(deniedFollowup.body.result.isError, true);
    assert.equal(followups, 0);

    // send_message to currently running child does not require desktop confirmation
    const liveFollowup = await mcp.dispatch({
      jsonrpc: '2.0', id: 9, method: 'tools/call',
      params: { name: 'send_message', arguments: { agent_id: 'child-2', message: 'coordinate' } },
    }, mcp.sessionFor(token));
    assert.equal(liveFollowup.body.result.isError, undefined);
    assert.equal(followups, 1);

    // With desktop confirm allowed, completed child followup succeeds
    await allowDesktopConfirm(t);
    const allowedFollowup = await mcp.dispatch({
      jsonrpc: '2.0', id: 10, method: 'tools/call',
      params: { name: 'send_message', arguments: { agent_id: 'child-1', message: 'approved new work' } },
    }, mcp.sessionFor(token));
    assert.equal(allowedFollowup.body.result.isError, undefined);
    assert.equal(followups, 2);

    // Closed turn blocks all control/write tools
    openTurn = false;
    for (const [toolName, toolArgs] of [
      ['acp_delegate', { agent: 'beta', prompt: 'x' }],
      ['acp_cancel', { task_id: 'task-run' }],
      ['send_message', { agent_id: 'child-2', message: 'x' }],
      ['interrupt_agent', { agent_id: 'child-2' }],
      ['whaleisle_present', { files: [{ path: 'report.md' }] }],
    ]) {
      const closedRes = await mcp.dispatch({
        jsonrpc: '2.0', id: 11, method: 'tools/call',
        params: { name: toolName, arguments: toolArgs },
      }, mcp.sessionFor(token));
      assert.equal(closedRes.body.result.isError, true, `${toolName} must be rejected after turn/end`);
    }

    // Token liveness window expiry
    fakeNow += 6_000;
    assert.equal(mcp.sessionFor(token), null, 'expired token must be evicted and rejected');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
