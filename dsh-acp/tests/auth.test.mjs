import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AgentAuthManager } from '../lib/agent-auth.js';
import { probeAcpAgent } from '../lib/acp-session.js';
import { initAgentRuntime, runtimeBundle, configureRuntimeHost } from '../lib/agent-runtime.js';

const releaseRuntime = configureRuntimeHost({});
after(releaseRuntime);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, message, timeoutMs = 6000) {
  for (const end = Date.now() + timeoutMs;;) {
    const result = await check();
    if (result) return result;
    if (Date.now() >= end) assert.fail(message);
    await delay(20);
  }
}
function callsFor(agent) {
  return fs.readFileSync(agent.env.ACP_TEST_LOG, 'utf8').trim().split('\n').map(JSON.parse);
}
async function processesGone(calls) {
  const pids = [...new Set(calls.map(call => call.pid))];
  await until(() => pids.every(pid => {
    try { process.kill(pid, 0); return false; } catch (error) { if (error.code === 'ESRCH') return true; throw error; }
  }), 'Owned authentication subprocesses must exit');
}

test('registry probe returns discovered models and completed authentication invalidates account status immediately', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-auth-status-'));
  const previousHome = process.env.DSH_HOME;
  process.env.DSH_HOME = root;
  const agent = { id: 'codebuddy-fixture', name: 'Registry fixture', enabled: true,
    registrySource: 'local', command: process.execPath,
    args: [fileURLToPath(new URL('./agent-fixture.cjs', import.meta.url))],
    env: { ACP_TEST_MODEL_CATALOG: '1', ACP_TEST_AUTH: '1', ACP_TEST_LOG: path.join(root, 'rpc.jsonl') } };
  const changes = [];
  const manager = new AgentAuthManager({ onAuthChanged: (id, authenticated) => changes.push({ id, authenticated }) });
  try {
    await initAgentRuntime();
    const probe = await probeAcpAgent({}, agent, root);
    assert.equal(probe.ok, true, probe.error);
    assert.deepEqual(probe.models.map(model => model.id), ['default', 'live-model']);
    assert.deepEqual(probe.authMethods.map(method => method.id), ['fixture-login']);
    const before = await manager.getAgentAccountStatus(agent);
    assert.equal(before.authenticated, false);
    assert.equal((await manager.getAgentAccountStatus(agent)).checkedAt, before.checkedAt, 'old unauthenticated status is cached');
    await manager.startLogin(agent, { methodId: 'fixture-login', forceNewToken: true });
    for (const deadline = Date.now() + 5000; manager.getFlowState(agent.id)?.phase !== 'succeeded';) {
      if (Date.now() > deadline) assert.fail('Scripted real ACP login did not complete');
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    // This is the client's normal non-forced catalog poll, not a manual refresh.
    const after = await manager.getAgentAccountStatus(agent);
    assert.equal(after.authenticated, true);
    assert.ok(after.checkedAt > before.checkedAt);
    assert.deepEqual(changes, [{ id: agent.id, authenticated: true }]);
    const calls = fs.readFileSync(agent.env.ACP_TEST_LOG, 'utf8').trim().split('\n').map(JSON.parse);
    assert.ok(calls.some(call => call.method === 'authenticate'));
    assert.ok(calls.some(call => call.method === 'session/new'));

    const entry = manager.entries.get(agent.id);
    await manager.authenticationChanged(agent.id, entry.authState, false);
    assert.equal((await manager.getAgentAccountStatus(agent)).authenticated, false, 'sign-out also expires the cached signed-in status');

    // Reproduce an account request already enriching version info when login
    // completes; it must not restore false after onChanged invalidates cache.
    let began, release;
    const started = new Promise(resolve => { began = resolve; });
    const held = new Promise(resolve => { release = resolve; });
    t.mock.method(runtimeBundle().catalog, 'inspect', async () => { began(); await held; return { version: '1' }; });
    manager.clearAccountStatus(agent.id);
    const pending = manager.getAgentAccountStatus(agent);
    await started;
    await manager.authenticationChanged(agent.id, entry.authState, true);
    release();
    assert.equal((await pending).authenticated, true);
    assert.equal((await manager.getAgentAccountStatus(agent)).authenticated, true);
  } finally {
    for (const entry of manager.entries.values()) await entry.api?.dispose();
    if (previousHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previousHome;
    fs.rmSync(root, { recursive: true });
  }
});

test('normal login confirms usable native credentials without destructive authenticate', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-auth-existing-'));
  const previousHome = process.env.DSH_HOME; process.env.DSH_HOME = root;
  const agent = { id: 'unknown-existing', name: 'Unknown existing account', enabled: true, command: process.execPath,
    args: [fileURLToPath(new URL('./agent-fixture.cjs', import.meta.url))],
    env: { ACP_TEST_AUTH: '1', ACP_TEST_LOG: path.join(root, 'rpc.jsonl') } };
  const manager = new AgentAuthManager({});
  try {
    assert.equal((await manager.getAgentAccountStatus(agent)).authenticated, false);
    await manager.startLogin(agent, { methodId: 'fixture-login' });
    await until(() => manager.getFlowState(agent.id)?.phase === 'succeeded', 'Existing account verification must settle');
    assert.equal((await manager.getAgentAccountStatus(agent)).authenticated, true);
    const calls = callsFor(agent);
    assert.ok(calls.some(call => call.method === 'session/new'));
    assert.equal(calls.some(call => call.method === 'authenticate'), false, 'A host marker miss must not log the native account out');
    await processesGone(calls);
  } finally {
    await manager.dispose();
    if (previousHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previousHome;
    fs.rmSync(root, { recursive: true });
  }
});

test('required browser login publishes the private handoff and settles, fails or cancels with subprocess release', async (t) => {
  for (const outcome of ['success', 'fail', 'hang']) await t.test(outcome, async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-auth-browser-'));
    const previousHome = process.env.DSH_HOME; process.env.DSH_HOME = root;
    const agent = { id: `unknown-browser-${outcome}`, name: 'Unknown browser account', enabled: true, command: process.execPath,
      args: [fileURLToPath(new URL('./agent-fixture.cjs', import.meta.url))], env: { ACP_TEST_AUTH: '1', ACP_TEST_AUTH_REQUIRED: '1',
        ACP_TEST_AUTH_OUTCOME: outcome, ACP_TEST_AUTH_URL: 'https://example.com/auth', ACP_TEST_LOG: path.join(root, 'rpc.jsonl') } };
    const manager = new AgentAuthManager({});
    try {
      await manager.startLogin(agent, { methodId: 'fixture-login' });
      const waiting = await until(() => { const s = manager.getFlowState(agent.id); return s?.phase === 'waiting' && s; }, 'Browser handoff must leave starting');
      assert.deepEqual(waiting.interaction, { type: 'browser', id: 'agent-browser-handoff', url: 'https://example.com/auth', requiresConsent: false });
      if (outcome === 'hang') await manager.cancelLogin(agent.id);
      const expected = outcome === 'success' ? 'succeeded' : outcome === 'fail' ? 'failed' : 'cancelled';
      const state = await until(() => { const s = manager.getFlowState(agent.id); return s?.phase === expected && s; }, 'Browser login must reach an actionable terminal state');
      assert.equal(state.interaction, null); assert.equal(state.authorizationUrl, null); assert.equal(state.expiresAt, null);
      if (outcome === 'fail') assert.match(state.message, /Fixture browser authorization was cancelled/);
      assert.equal((await manager.getAgentAccountStatus(agent)).authenticated, outcome === 'success');
      const methods = callsFor(agent).filter(call => call.method === 'authenticate' || call.method === 'session/new').map(call => call.method);
      assert.deepEqual(methods, outcome === 'success' ? ['session/new', 'authenticate', 'session/new'] : ['session/new', 'authenticate']);
      await processesGone(callsFor(agent));
    } finally {
      await manager.dispose();
      if (previousHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previousHome;
      fs.rmSync(root, { recursive: true });
    }
  });
});

test('native startup failure is reported without attempting a destructive login', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-auth-network-'));
  const previousHome = process.env.DSH_HOME; process.env.DSH_HOME = root;
  const control = path.join(root, 'network-unavailable'); fs.writeFileSync(control, 'fail');
  const agent = { id: 'unknown-network', name: 'Unknown network account', enabled: true, command: process.execPath,
    args: [fileURLToPath(new URL('./agent-fixture.cjs', import.meta.url))],
    env: { ACP_TEST_AUTH: '1', ACP_TEST_STARTUP_CONTROL: control, ACP_TEST_LOG: path.join(root, 'rpc.jsonl'),
      ACP_TEST_ERROR_DETAILS: 'OAuth token refresh failed: ProxyError; password=fixture-password; https://example.com/token?code=fixture-code' } };
  const manager = new AgentAuthManager({});
  try {
    await manager.startLogin(agent, { methodId: 'fixture-login' });
    const state = await until(() => { const s = manager.getFlowState(agent.id); return s?.phase === 'failed' && s; }, 'Network error must settle');
    assert.match(state.message, /Could not verify.*OAuth token refresh failed: ProxyError/s);
    assert.doesNotMatch(state.message, /fixture-password|fixture-code/);
    assert.equal(callsFor(agent).some(call => call.method === 'authenticate'), false);
    assert.equal((await manager.getAgentAccountStatus(agent)).authenticated, false);
    await processesGone(callsFor(agent));
  } finally {
    await manager.dispose();
    if (previousHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previousHome;
    fs.rmSync(root, { recursive: true });
  }
});

test('auth timeout interrupts an unanswered native authenticate and releases its owned process', async () => {
  await initAgentRuntime();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-auth-timeout-'));
  const { effect: { Effect, Scope, Exit, Stream, Fiber, run }, providers: { ProviderAuthFlow, AcpSessionRuntime } } = runtimeBundle();
  const scope = await run(Scope.make());
  const log = path.join(root, 'rpc.jsonl');
  let state;
  let subscription;
  try {
    const controller = await run(ProviderAuthFlow.make({
      instanceId: 'timeout-fixture', credentialBinding: { owner: 'provider', key: 'timeout-fixture' }, timeoutMs: 2000,
      methods: Effect.succeed([{ id: 'fixture-login', name: 'Sign in' }]), logout: Effect.void,
      authenticate: (_, context) => Effect.gen(function* () {
        const runtime = yield* AcpSessionRuntime.make({
          spawn: { command: process.execPath, args: [fileURLToPath(new URL('./agent-fixture.cjs', import.meta.url))], env: { ...process.env, ACP_TEST_AUTH: '1', ACP_TEST_AUTH_OUTCOME: 'hang', ACP_TEST_LOG: log } }, cwd: root,
        });
        yield* context.setInteraction({ type: 'browser', id: 'timeout', url: 'https://example.com/auth', requiresConsent: false });
        yield* runtime.authenticate('fixture-login');
      }),
    }).pipe(Effect.provideService(Scope.Scope, scope)));
    subscription = await run(Stream.runForEach(controller.subscribe('test'), next => Effect.sync(() => { state = next; })).pipe(Effect.forkIn(scope)));
    await run(controller.start('test'));
    await until(() => state?.phase === 'failed', 'Timeout must not leave a pending flow', 12000);
    assert.equal(state.message, 'Sign-in expired. Start again.');
    assert.equal(state.interaction, null); assert.equal(state.expiresAt, null);
    const calls = fs.readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse);
    assert.ok(calls.some(call => call.method === 'authenticate'), 'Exercise the actual unanswered ACP request');
    await processesGone(calls);
    assert.equal(await run(controller.isChangingCredentials), false);
  } finally {
    if (subscription) await run(Fiber.interrupt(subscription));
    await run(Scope.close(scope, Exit.void));
    fs.rmSync(root, { recursive: true });
  }
});
