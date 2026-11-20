'use strict';

const nodeTest = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');

const { safeRemove } = require('../shared/fs-safe');
const { setDesktopDshHome, clearDesktopDshHome } = require('../shared/dsh-home');
const { TOOLS } = require('../shared/model-tool-effects');
const { storeInternalSecrets, INTERNAL_SECRETS_KEY } = require('../shared/secret');
const { startDesktopInstallControl, stopDesktopInstallControl } = require('./desktop-install-control');
const { DshManager } = require('./dsh');
const { gateTests, harnessWorkspace } = require('../../scripts/lib/test-prerequisites.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const HARNESS_DIR = path.join(ROOT, 'vendor', 'deepseek-harness');
const HARNESS = harnessWorkspace();
const harnessTest = gateTests(nodeTest, HARNESS);

const importWhale = (file) => import(pathToFileURL(path.join(ROOT, 'vendor', 'dsh-whale', 'lib', file)).href);

async function makeTempDir(t, prefix) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(async () => { await safeRemove(dir); });
  return dir;
}

function makeFakeAgent(id, events = []) {
  return {
    id,
    session: {
      header: { cwd: ROOT },
      snapshotEvents: () => events,
    },
  };
}

function activeUserEvents(rpcId = '', kind = 'user') {
  return [
    { seq: 1, type: 'turn/start', data: {} },
    { seq: 2, type: 'user/message', data: { source: { kind, rpcId } } },
  ];
}

// ---------------------------------------------------------------------------
// 1. Bidirectional SENSITIVE_CONFIG_KEYS & confirmModelAction hardening
// ---------------------------------------------------------------------------

nodeTest('SENSITIVE_CONFIG_KEYS in desktop-tools.js matches TOOLS.whale_desktop_config.keys bidirectionally', async () => {
  const { SENSITIVE_CONFIG_KEYS } = await importWhale('desktop-tools.js');
  assert.ok(SENSITIVE_CONFIG_KEYS.has('dshImEnabled'), 'dshImEnabled must require desktop confirmation');
  assert.deepEqual([...SENSITIVE_CONFIG_KEYS].sort(), [...TOOLS.whale_desktop_config.keys].sort());
});

nodeTest('all confirmable whale tools declare timeoutMs >= 250_000 to avoid 240s confirm split-brain', async () => {
  const { CONFIRM_TOOL_TIMEOUT_MS } = await importWhale('desktop-confirm.js');
  const { registerSessionTools } = await importWhale('session-tools.js');
  const { registerDesktopTools } = await importWhale('desktop-tools.js');
  const { apply: applyTools } = await importWhale('tools.js');
  assert.ok(CONFIRM_TOOL_TIMEOUT_MS >= 250_000);
  const tools = new Map();
  const ctx = {
    tools: { register: (def) => tools.set(def.name, def) },
    get: () => undefined,
    on: () => () => {},
    emit: () => {},
  };
  registerSessionTools(ctx);
  registerDesktopTools(ctx);
  applyTools(ctx);
  for (const name of [
    'whale_new_session',
    'whale_send_to_session',
    'whale_delete_session',
    'whale_update_queue',
    'whale_desktop_config',
  ]) {
    const def = tools.get(name);
    assert.ok(def, `missing tool ${name}`);
    assert.ok(def.timeoutMs >= 250_000, `${name} timeoutMs (${def.timeoutMs}) must be >= 250_000`);
  }
});

nodeTest('confirmModelAction honors exec.signal abort and fails closed for unattended pulse & non-owner IM even after always grant', async (t) => {
  const { confirmModelAction, UNATTENDED_REFUSAL_TEXT, NON_OWNER_IM_REFUSAL_TEXT } = await importWhale('desktop-confirm.js');
  const { registerDesktopTools } = await importWhale('desktop-tools.js');

  const prevUrl = process.env.DSH_DESKTOP_INSTALL_URL;
  const prevSecrets = globalThis[INTERNAL_SECRETS_KEY];
  t.after(() => {
    stopDesktopInstallControl();
    if (prevUrl === undefined) delete process.env.DSH_DESKTOP_INSTALL_URL;
    else process.env.DSH_DESKTOP_INSTALL_URL = prevUrl;
    globalThis[INTERNAL_SECRETS_KEY] = prevSecrets;
  });

  const asked = [];
  const applied = [];
  let pendingDialog = null;
  const control = startDesktopInstallControl({
    confirmModelAction: async (req) => {
      asked.push(req);
      if (req.summary === 'wait-abort') {
        pendingDialog = Promise.withResolvers();
        return pendingDialog.promise;
      }
      return 'always';
    },
    showSecret: async () => false,
    installPlugin: async () => ({ ok: true }),
    startHarness: () => {},
    desktop: { applyConfig: async (patch) => { applied.push(patch); return { ok: true }; } },
  });
  const { url, token } = await control.ready;
  process.env.DSH_DESKTOP_INSTALL_URL = url;
  storeInternalSecrets([['DSH_DESKTOP_INSTALL_TOKEN', token]]);

  // Grant 'always' on an interactive desktop turn for { dshImEnabled }.
  const tools = new Map();
  registerDesktopTools({ tools: { register: (def) => tools.set(def.name, def) } });
  const desktopExec = { agent: makeFakeAgent('resident', activeUserEvents('ui-1')), signal: new AbortController().signal };
  const okRes = await tools.get('whale_desktop_config').execute({ patch: { dshImEnabled: true } }, desktopExec);
  assert.equal(okRes.ok, true);
  assert.equal(asked.length, 1);
  assert.equal(applied.length, 1);

  // Unattended whale-pulse-* turn MUST fail closed and NOT reuse the interactive 'always' grant!
  const pulseExec = { agent: makeFakeAgent('resident', activeUserEvents('whale-pulse-123')), signal: new AbortController().signal };
  const pulseRes = await tools.get('whale_desktop_config').execute({ patch: { dshImEnabled: true } }, pulseExec);
  assert.equal(pulseRes.ok, false);
  assert.equal(pulseRes.detail, UNATTENDED_REFUSAL_TEXT);
  assert.equal(applied.length, 1);

  // Non-owner IM speaker turn MUST fail closed even with dsh-im:inbound source!
  const imGuestExec = {
    agent: makeFakeAgent('resident', activeUserEvents('feishu-guest-private-11111111-2222-3333-4444-555555555555', 'dsh-im:inbound')),
    signal: new AbortController().signal,
  };
  const imGuestRes = await tools.get('whale_desktop_config').execute({ patch: { dshImEnabled: true } }, imGuestExec);
  assert.equal(imGuestRes.ok, false);
  assert.equal(imGuestRes.detail, NON_OWNER_IM_REFUSAL_TEXT);
  assert.equal(applied.length, 1);

  // Pre-aborted signal short-circuits without hitting /desktop/confirm.
  const preAborted = new AbortController();
  preAborted.abort();
  const abortRes = await confirmModelAction({ tool: 'whale_desktop_config', action: 'patch', effect: 'external' }, preAborted.signal, desktopExec);
  assert.equal(abortRes.ok, false);
  assert.equal(abortRes.aborted, true);
  assert.equal(asked.length, 1);

  // Abort while dialog is pending cancels immediately and rejects late approval.
  const midAbort = new AbortController();
  const inFlight = confirmModelAction({
    tool: 'whale_desktop_config',
    action: 'patch',
    effect: 'external',
    scope: 'abort-scope',
    summary: 'wait-abort',
  }, midAbort.signal, desktopExec);
  while (!pendingDialog) await new Promise((r) => setTimeout(r, 5));
  midAbort.abort();
  const midRes = await inFlight;
  pendingDialog.resolve(true);
  assert.equal(midRes.ok, false);
  assert.equal(midRes.aborted, true);
});

// ---------------------------------------------------------------------------
// 2. isWhaleAssistantContext & taskRootDir / path-escape guard
// ---------------------------------------------------------------------------

nodeTest('isWhaleAssistantContext guards legacy cwd fallback with !header?.agentPreset', async () => {
  const { isWhaleAssistantContext } = await importWhale('index.js');
  const home = path.join(ROOT, 'fake-dsh-home');
  const whaleHome = path.join(home, 'data', 'whale');
  const snap = { sessionId: 'resident-1' };

  assert.equal(isWhaleAssistantContext({ agent: { id: 'task-1', session: { id: 'task-1', header: { agentPreset: 'standard', cwd: whaleHome } } } }, snap, home), false);
  assert.equal(isWhaleAssistantContext({ agent: { id: 'legacy-1', session: { id: 'legacy-1', header: { cwd: whaleHome } } } }, snap, home), true);
  assert.equal(isWhaleAssistantContext({ agent: { id: 'preset-1', session: { id: 'preset-1', header: { agentPreset: 'whale-girl', cwd: ROOT } } } }, snap, home), true);
  assert.equal(isWhaleAssistantContext({ agent: { id: 'resident-1', session: { id: 'resident-1', header: { agentPreset: 'standard', cwd: ROOT } } } }, snap, home), true);
});

nodeTest('taskRootDir defaults outside data/whale and blocks root, homedir, dsh-home, data/whale, .ssh, and symlink escape', async (t) => {
  const { defaultTaskRootDir, taskCwdRefusal, validateTaskCwd, within } = await importWhale('task-paths.js');
  const base = await makeTempDir(t, 'whale-paths-');
  const dshHome = path.join(base, 'dsh-home');
  const whaleDir = path.join(dshHome, 'data', 'whale');
  const safeWork = path.join(base, 'my-tasks', 'job-1');
  await fsp.mkdir(whaleDir, { recursive: true });
  await fsp.mkdir(safeWork, { recursive: true });

  const defRoot = defaultTaskRootDir(dshHome);
  assert.equal(within(whaleDir, defRoot), false, 'default taskRootDir must not sit inside data/whale');
  assert.equal(within(dshHome, defRoot), false, 'default taskRootDir must not sit inside dshHome');

  assert.equal(taskCwdRefusal(safeWork, { dshHome }), '');
  assert.equal(validateTaskCwd(safeWork, { dshHome }), path.resolve(safeWork));

  for (const forbidden of [
    path.parse(safeWork).root,
    os.homedir(),
    path.dirname(os.homedir()),
    dshHome,
    whaleDir,
    path.join(whaleDir, 'sub'),
    path.join(os.homedir(), '.ssh'),
  ]) {
    const refusal = taskCwdRefusal(forbidden, { dshHome });
    assert.ok(refusal, `expected refusal for ${forbidden}`);
  }

  // Symlink / junction escape into data/whale must be refused.
  const escapeLink = path.join(base, 'escape-link');
  await fsp.symlink(whaleDir, escapeLink, 'junction');
  assert.ok(taskCwdRefusal(escapeLink, { dshHome }), 'junction targeting data/whale must be refused');
  assert.ok(taskCwdRefusal(path.join(escapeLink, 'nested'), { dshHome }), 'child under junction targeting data/whale must be refused');
});

// ---------------------------------------------------------------------------
// 3. Call-origin decoupling, pulse read-only vs write, Stop guard, hasTreeWork,
//    observe.js hardening, task-service before-cancel, card-service hardening
// ---------------------------------------------------------------------------

nodeTest('whale-pulse allows read-only todo/task list, refuses writes, and Stop signal blocks mutations', async (t) => {
  const { registerTaskTools } = await importWhale('task-tools.js');
  const tools = new Map();
  const created = [];
  const fakeTodos = {
    available: true,
    scope: { get: () => ({ sessionId: 'resident' }) },
    list: () => [{ id: 'c1', title: 'Check CI' }],
    create: async (args) => { created.push(args); return { id: 'c2', ...args }; },
  };
  const fakeTasks = {
    available: true,
    scope: { get: () => ({ sessionId: 'resident' }) },
    list: () => [{ id: 't1', goal: 'Digest', state: 'completed', error: '', origin: { actor: 'desktop-owner' } }],
  };
  registerTaskTools({
    tools: { register: (def) => tools.set(def.name, def) },
    get: (k) => (k === 'whaleTodos' ? fakeTodos : k === 'whaleTasks' ? fakeTasks : undefined),
  });

  const pulseExec = { agent: makeFakeAgent('resident', activeUserEvents('whale-pulse-99')), signal: new AbortController().signal };
  const todoList = await tools.get('whale_todo_list').execute({}, pulseExec);
  assert.equal(todoList.cards.length, 1);
  const taskList = await tools.get('whale_task_list').execute({}, pulseExec);
  assert.equal(taskList.tasks.length, 1);
  await assert.rejects(() => tools.get('whale_todo_create').execute({ title: 'Sneaky' }, pulseExec), /无人值守/);
  assert.equal(created.length, 0);

  // Aborted desktop turn (user hit Stop) blocks whale_todo_create.
  const ac = new AbortController();
  ac.abort();
  const stoppedExec = { agent: makeFakeAgent('resident', activeUserEvents('ui-2')), signal: ac.signal };
  await assert.rejects(() => tools.get('whale_todo_create').execute({ title: 'Too late' }, stoppedExec), /取消/);
  assert.equal(created.length, 0);

  // Normal desktop turn accepts optional cwd.
  const workDir = await makeTempDir(t, 'whale-cwd-arg-');
  const desktopExec = { agent: makeFakeAgent('resident', activeUserEvents('ui-3')), signal: new AbortController().signal };
  const ok = await tools.get('whale_todo_create').execute({ title: 'Run audit', cwd: workDir }, desktopExec);
  assert.equal(ok.cwd, workDir);
});

nodeTest('observe.js enforces 12h stale window, no self-watch, alreadyIdle, and hasTreeWork defer', async (t) => {
  const observe = await importWhale('observe.js');
  const home = await makeTempDir(t, 'whale-observe-');
  const listeners = new Map();
  let treeBusy = true;
  const woken = [];
  const disposers = [];
  const ctx = {
    on: (ev, fn) => {
      if (!listeners.has(ev)) listeners.set(ev, new Set());
      listeners.get(ev).add(fn);
      return () => listeners.get(ev).delete(fn);
    },
    effect: (fn) => { const d = fn(); if (typeof d === 'function') disposers.push(d); },
    agents: {
      get: (id) => (id === 'idle-sess'
        ? { id, status: 'idle' }
        : id === 'busy-sess'
          ? { id, status: 'running' }
          : undefined),
    },
    get: (k) => (k === 'subagents' ? { hasTreeWork: (agent) => agent?.id === 'busy-sess' && treeBusy } : undefined),
  };
  observe.startPulse(ctx, {
    home,
    getSelfId: () => 'resident-self',
    wake: (prompt) => { woken.push(prompt); },
  });
  t.after(() => { for (const d of disposers) d(); });

  // Refuses watching own resident session.
  const selfRes = observe.addWatch({ sessionId: 'resident-self', note: 'self' });
  assert.equal(selfRes.ok, false);
  assert.equal(selfRes.error, 'cannot-watch-self');

  // Detects already idle session.
  const idleRes = observe.addWatch({ sessionId: 'idle-sess', note: 'check' });
  assert.equal(idleRes.ok, true);
  assert.equal(idleRes.alreadyIdle, true);
  observe.removeWatch('idle-sess');

  // Defers turn/end wake while hasTreeWork is true, fires once false.
  observe.addWatch({ sessionId: 'busy-sess', note: 'wait-children', once: true });
  for (const fn of listeners.get('session/event') ?? []) {
    fn({ id: 'busy-sess' }, { type: 'turn/end', data: { reason: { kind: 'completed' } } });
  }
  assert.equal(woken.length, 0, 'must defer wake while subagents have tree work');
  treeBusy = false;
  for (const fn of listeners.get('session/event') ?? []) {
    fn({ id: 'busy-sess' }, { type: 'turn/end', data: { reason: { kind: 'completed' } } });
  }
  assert.equal(woken.length, 1);

  // 12h stale schedule window discards overdue one-shot after laptop sleep instead of firing.
  const added = observe.addSchedule({ inMinutes: 1, text: 'sleep-overdue reminder' });
  assert.equal(added.ok, true);
  const wokenBefore = woken.length;
  await observe.tick(Date.now() + observe.SCHEDULE_STALE_WINDOW_MS + 180_000);
  assert.equal(woken.length, wokenBefore, 'overdue >12h schedule must be discarded instead of firing');
  const after = observe.listSchedules().find((s) => s.id === added.schedule.id);
  assert.equal(after?.enabled, false);
  assert.equal(after?.lastError, 'expired-stale');
});

nodeTest('todo-service validates model before create, honors hasTreeWork, preserves stopping->cancelled and non-empty summary, clears error on stop', async (t) => {
  const { WhaleTodos } = await importWhale('todo-service.js');
  const base = await makeTempDir(t, 'whale-todos-');
  const home = path.join(base, 'dsh-home');
  const workDir = path.join(base, 'tasks-work');
  await fsp.mkdir(path.join(home, 'data', 'whale'), { recursive: true });
  await fsp.mkdir(workDir, { recursive: true });

  const stored = new Map();
  const table = {
    entries: () => stored.entries(),
    get: (id) => stored.get(id),
    put: async (id, val) => { stored.set(id, structuredClone(val)); },
    delete: async (id) => { stored.delete(id); },
  };
  const domain = {
    table: () => table,
    flush: async () => {},
    close: async () => {},
  };
  let modelAvailable = false;
  let treeBusy = true;
  let createdSessions = 0;
  const liveAgents = new Map();
  const ctx = {
    get: (k) => {
      if (k === 'llm') return { resolveModel: async () => (modelAvailable ? { provider: 'p', id: 'm' } : null) };
      if (k === 'subagents') return { hasTreeWork: () => treeBusy };
      if (k === 'sessionQuery') {
        return {
          observeSession: async (id) => ({
            events: liveAgents.get(id)?.session?.snapshotEvents?.() ?? [],
            dispose: () => {},
          }),
        };
      }
      return undefined;
    },
    agents: { get: (id) => liveAgents.get(id) },
    sessionController: {
      modelCatalog: async () => (modelAvailable ? { default: { provider: 'p', model: 'm' } } : {}),
      create: async (req = {}) => {
        createdSessions += 1;
        const id = req.sessionId || `todo-s-${createdSessions}`;
        liveAgents.set(id, {
          id,
          status: 'running',
          session: {
            snapshotEvents: () => [
              { type: 'assistant/message', data: { content: [{ type: 'text', text: 'Non-empty summary' }] } },
              { type: 'assistant/message', data: { content: [{ type: 'text', text: '   ' }] } },
            ],
          },
          followup: () => {},
          cancel: async () => {},
          whenIdle: async () => {},
        });
        return { sessionId: id };
      },
      selectModel: async () => {},
      prompt: async () => ({ messageId: 'm1' }),
      cancel: async () => {},
      delete: async () => {},
      resolveAgent: async (id) => ({ agent: liveAgents.get(id) }),
    },
  };
  const scope = {
    get: () => ({ sessionId: 'resident', taskRootDir: workDir }),
  };

  const service = new WhaleTodos(ctx, domain, { scope, home });
  const card = await service.create({ title: 'Audit repo', cwd: workDir });

  // Model missing -> fails BEFORE sessionController.create, leaving 0 orphan sessions!
  await assert.rejects(() => service.start(card.id), /模型/);
  assert.equal(createdSessions, 0, 'must not create orphan session when model resolution fails');
  assert.equal(service.get(card.id).sessionId, '', 'failed pre-create must not record a fake sessionId');

  // Reopen, enable model, and start card.
  await service.transition(card.id, 'reopen');
  modelAvailable = true;
  const started = await service.start(card.id);
  assert.equal(started.state, 'running');
  assert.equal(createdSessions, 1);

  // assistant/message records non-empty text and ignores blank follow-up.
  await service.event({ id: started.sessionId }, { type: 'assistant/message', data: { content: [{ type: 'text', text: 'Non-empty summary' }] } });
  await service.event({ id: started.sessionId }, { type: 'assistant/message', data: { content: [{ type: 'text', text: '   ' }] } });

  // turn/end while hasTreeWork=true must NOT settle the card!
  await service.event({ id: started.sessionId }, { type: 'turn/end', data: { reason: { kind: 'completed' } } });
  assert.equal(service.get(card.id).state, 'running');

  // turn/end once hasTreeWork=false settles to review and retains last non-empty summary!
  treeBusy = false;
  await service.event({ id: started.sessionId }, { type: 'turn/end', data: { reason: { kind: 'completed' } } });
  const reviewed = service.get(card.id);
  assert.equal(reviewed.state, 'review');
  assert.equal(reviewed.summary, 'Non-empty summary');

  // Restart with stopping state -> recover preserves stopping -> cancelled and retains last non-empty summary.
  await table.put(card.id, { ...reviewed, state: 'stopping', error: 'stale err', summary: 'Keep me' });
  await service.recover();
  const cancelled = service.get(card.id);
  assert.equal(cancelled.state, 'cancelled');
  assert.equal(cancelled.summary, 'Non-empty summary');
  assert.equal(cancelled.error, '');

  // Restart + stop clears error: ''
  await table.put(card.id, { ...cancelled, state: 'running', error: 'prior error' });
  const stopped = await service.stop(card.id);
  assert.equal(stopped.error, '');

  // Closed service refuses mutations.
  await service.close();
  await assert.rejects(() => service.create({ title: 'After close', cwd: workDir }), /关闭|停止|不可用/);
});

nodeTest('task-service session/before-cancel on resident session does NOT cancel background WhaleTasks', async () => {
  const source = fs.readFileSync(path.join(ROOT, 'vendor', 'dsh-whale', 'lib', 'task-service.js'), 'utf8');
  assert.doesNotMatch(source, /session\/before-cancel[\s\S]{0,200}stop\(/);
});

nodeTest('DshManager sets DSHD_SCHEDULE_ENABLED=1 by default and omits when disabled', async (t) => {
  const fakeHome = await makeTempDir(t, 'dsh-env-');
  setDesktopDshHome(fakeHome);
  t.after(() => clearDesktopDshHome());
  const mgr = new DshManager({ host: '127.0.0.1', port: 0, logger: { info: () => {}, warn: () => {}, error: () => {} } });
  const envDefault = mgr.spawnEnv({ profileDir: ROOT });
  assert.equal(envDefault.DSHD_SCHEDULE_ENABLED, '1');
  const envFalse = mgr.spawnEnv({ profileDir: ROOT, scheduleEnabled: false });
  assert.equal(envFalse.DSHD_SCHEDULE_ENABLED, undefined);
  const envDisabledPlugin = mgr.spawnEnv({ profileDir: ROOT, disabledPlugins: ['@deepseek-ai/dsh-schedule'] });
  assert.equal(envDisabledPlugin.DSHD_SCHEDULE_ENABLED, undefined);
});

nodeTest('Proactive empty shell is removed while projectEnvironment githubToken stays intact', () => {
  assert.equal(fs.existsSync(path.join(ROOT, 'src', 'main', 'proactive')), false);
  const mainIndex = fs.readFileSync(path.join(ROOT, 'src', 'main', 'index.js'), 'utf8');
  assert.doesNotMatch(mainIndex, /proactive/i);
  assert.match(mainIndex, /githubToken/);
  const contract = fs.readFileSync(path.join(ROOT, 'src', 'shared', 'ipc-contract.js'), 'utf8');
  assert.doesNotMatch(contract, /proactive/i);
  const preload = fs.readFileSync(path.join(ROOT, 'src', 'preload', 'index.js'), 'utf8');
  assert.doesNotMatch(preload, /proactive/i);
});

// ---------------------------------------------------------------------------
// 4. Real SessionController + Loader integration test for P0 orchestration tools
// ---------------------------------------------------------------------------

harnessTest('real SessionController exercises whale_session_queue, whale_read_session, whale_search_sessions, whale_list_sessions, whale_send_to_session, and whale_new_session', async (t) => {
  const cli = createRequire(path.join(HARNESS_DIR, 'apps', 'cli', 'package.json'));
  const anchors = [
    cli,
    createRequire(cli.resolve('@deepseek-ai/dsh-base/package.json')),
    createRequire(cli.resolve('@deepseek-ai/dsh-web-app/package.json')),
  ];
  const resolvePkg = (name) => {
    for (const anchor of anchors) {
      try { return anchor.resolve(name); } catch { /* try next anchor */ }
    }
    throw new Error(name);
  };
  const loadPkg = (name) => import(pathToFileURL(resolvePkg(name)).href);

  const { boot, loadOverlayPatches, bundlePatchPaths, PluginPackages, createRuntimeResolution } = await loadPkg('@deepseek-ai/dsh-app-boot');
  const { LlmAdapter } = await loadPkg('@deepseek-ai/dsh-llm');
  const { provideCmdline } = await loadPkg('@deepseek-ai/dsh-cmdline');
  const Whale = await importWhale('index.js');

  await fsp.mkdir(path.join(HARNESS_DIR, 'apps', 'cli', '.tmp'), { recursive: true });
  const tempRoot = await fsp.realpath(path.join(HARNESS_DIR, 'apps', 'cli', '.tmp'));
  const home = await fsp.mkdtemp(path.join(tempRoot, 'whale-wave1-int-'));
  const workDir = await fsp.mkdtemp(path.join(tempRoot, 'whale-wave1-work-'));
  const prevHome = process.env.DSH_HOME;
  const prevUrl = process.env.DSH_DESKTOP_INSTALL_URL;
  const prevSecrets = globalThis[INTERNAL_SECRETS_KEY];
  process.env.DSH_HOME = home;
  let ctx;
  t.after(async () => {
    stopDesktopInstallControl();
    await ctx?.get('whaleTasks')?.close();
    await ctx?.get('whaleTodos')?.close();
    await ctx?.fiber.dispose();
    if (prevHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = prevHome;
    if (prevUrl === undefined) delete process.env.DSH_DESKTOP_INSTALL_URL; else process.env.DSH_DESKTOP_INSTALL_URL = prevUrl;
    globalThis[INTERNAL_SECRETS_KEY] = prevSecrets;
    await safeRemove(home);
    await safeRemove(workDir);
  });

  const control = startDesktopInstallControl({
    confirmModelAction: async () => true,
    showSecret: async () => false,
    installPlugin: async () => ({ ok: true }),
    startHarness: () => {},
  });
  const { url, token } = await control.ready;
  process.env.DSH_DESKTOP_INSTALL_URL = url;
  storeInternalSecrets([['DSH_DESKTOP_INSTALL_TOKEN', token]]);

  const configPath = path.join(home, 'cordis.yml');
  await fsp.writeFile(configPath, '[]\n');
  const webDir = path.dirname(cli.resolve('@deepseek-ai/dsh-web-app/package.json'));
  const manifest = JSON.parse(await fsp.readFile(path.join(webDir, 'package.json'), 'utf8'));
  const patches = [
    ...loadOverlayPatches('whale-w1', path.join(HARNESS_DIR, 'packages', 'bundle', 'base', 'cordis.patch.yml')),
    ...bundlePatchPaths(webDir, manifest.dsh.bundle).flatMap((f) => loadOverlayPatches('whale-w1', f)),
    { id: 'storage-json', config: { root: path.join(home, 'storages') } },
    { id: 'session-persistence-jsonl', config: { root: path.join(home, 'sessions') } },
    { id: 'session-query-sqlite', config: { path: path.join(home, 'session-query.sqlite'), openAt: 'first-search' } },
    { id: 'mcp-servers-file', config: { path: path.join(home, 'mcp.yaml'), watch: false } },
    { id: 'spill-local', config: { root: path.join(home, 'spill'), cleanupPeriodDays: 0 } },
    { id: 'agent-default-model', config: { provider: 'scripted', model: 'fast' } },
    ...['webserver', 'hmr', 'web-runtime', 'session-telemetry-otel', 'modules', 'connection', 'session-log-download', 'open-in-app', 'client-hmr', 'directory-picker'].map((id) => ({ id, disabled: true })),
    { insert: [{ id: 'directory-picker-test', name: '@deepseek-ai/dsh-host-directory-picker-browse' }] },
  ];
  const resolution = await createRuntimeResolution({ installAnchor: path.join(HARNESS_DIR, 'apps', 'cli', 'package.json'), home });
  ctx = await boot('whale-w1', configPath, patches, async (context) => {
    await context.plugin(PluginPackages, { resolution });
    provideCmdline(context, { args: [], exit() {} });
    context.provide('connection', { fetch: { register: () => () => {} }, rpc: { intercept: () => () => {} } });
    context.loader.internal = { version: 'v2', import: (n) => (n.startsWith('file:') ? import(n) : loadPkg(n)) };
  });

  class DummyModel extends LlmAdapter {
    calls = 0;
    async resolveModel(provider, model) { return { provider, id: model, name: model }; }
    async *stream(options) {
      this.calls += 1;
      const hasToolMsg = options.messages.some((m) => m.role === 'tool');
      const isPeer = options.messages.some((m) => JSON.stringify(m).includes('OLD_PREFIX_'));
      if (isPeer && !hasToolMsg) {
        yield { type: 'block-start', index: 0, blockType: 'tool-call' };
        yield { type: 'tool-call-delta', index: 0, id: 'tc-1', name: 'nonexistent_probe_tool', argumentsDelta: '{"probe":"arg1"}' };
        yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: 'tc-1', name: 'nonexistent_probe_tool', arguments: '{"probe":"arg1"}' } };
        yield { type: 'finish', reason: { kind: 'tool-calls' } };
        return;
      }
      const text = isPeer ? 'LATEST_TAIL_MARKER' : 'ack';
      yield { type: 'block-start', index: 0, blockType: 'text' };
      yield { type: 'text-delta', index: 0, text };
      yield { type: 'block-end', index: 0, block: { type: 'text', text } };
      yield { type: 'finish', reason: { kind: 'stop' } };
    }
  }
  ctx.llm.registerAdapter(['scripted'], new DummyModel());
  ctx.provide('webServer', { register: () => () => {} });
  ctx.loader.internal = {
    version: 'v2',
    import: (n) => (n === 'dsh-whale/tools' ? importWhale('tools.js') : n.startsWith('file:') ? import(n) : loadPkg(n)),
  };
  await ctx.plugin(Whale);
  await ctx.plugin(await importWhale('tools.js'));

  const resident = await ctx.sessionController.create({ sessionId: 'w1-resident', cwd: workDir, agentPreset: 'standard' });
  const peer = await ctx.sessionController.create({ sessionId: 'w1-peer', cwd: workDir, agentPreset: 'standard' });
  const liveResident = ctx.agents.get(resident.sessionId);
  const livePeer = ctx.agents.get(peer.sessionId);

  // Run one genuine Agent turn on peer producing real user/message, tool/call, tool/result, and assistant/message events.
  await ctx.sessionController.prompt({
    sessionId: peer.sessionId,
    requestId: 'w1-seed-1',
    mode: 'queue',
    content: [{ type: 'text', text: `OLD_PREFIX_${'x'.repeat(2000)}` }],
  }, new AbortController().signal);
  await livePeer.whenIdle();

  const exec = { agent: liveResident, signal: new AbortController().signal };
  const tool = (name) => ctx.tools.get(name);

  // whale_session_queue reads live state without crashing on deprecated baseline.queues.
  const queueRes = await tool('whale_session_queue').execute({ sessionId: peer.sessionId }, exec);
  assert.equal(queueRes.ok, true);
  assert.ok(Array.isArray(queueRes.queues));
  assert.equal(queueRes.queues.length, 1);
  assert.ok(Array.isArray(queueRes.queues[0].items));
  assert.ok(Array.isArray(queueRes.queues[0].jobs));

  // whale_read_session preserves tail and optionally expands real tool/call & tool/result details.
  const readDef = tool('whale_read_session');
  const readTail = await readDef.execute({ sessionId: peer.sessionId, maxMessages: 20, includeToolDetails: true }, exec);
  assert.equal(readTail.ok, true, JSON.stringify(readTail));
  const readText = readDef.output.render({}, readTail)[0].text;
  assert.ok(readText.includes('LATEST_TAIL_MARKER'), `tail must be preserved; got: ${readText}`);
  assert.ok(readText.includes('nonexistent_probe_tool'), `includeToolDetails must include tool/call name & summary; got: ${readText}`);
  assert.ok(readText.includes('probe'), `includeToolDetails must include tool/call arguments; got: ${readText}`);

  // whale_search_sessions finds matches inside whale-owned sessions (task-card owner).
  const todoSession = await ctx.sessionController.create({
    sessionId: 'w1-todo-owned',
    cwd: workDir,
    agentPreset: 'standard',
    presentation: { owner: 'dsh-whale:todo', title: 'Whale Owned Card' },
  });
  ctx.agents.get(todoSession.sessionId).session.append(
    'user/message',
    { id: 'u-owned', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'UNIQUE_WHALE_TODO_NEEDLE_777' }] },
    { surfaceOp: 'append' },
  );
  const searchRes = await tool('whale_search_sessions').execute({ query: 'UNIQUE_WHALE_TODO_NEEDLE_777' }, exec);
  assert.equal(searchRes.ok, true, JSON.stringify(searchRes));
  assert.ok(searchRes.items.some((item) => item.sessionId === todoSession.sessionId), `must search whale-owned sessions; got: ${JSON.stringify(searchRes)}`);

  // whale_list_sessions renders full details including state & cwd.
  const listDef = tool('whale_list_sessions');
  const listRes = await listDef.execute({}, exec);
  const rendered = listDef.output.render({}, listRes)[0].text;
  assert.ok(rendered.includes(peer.sessionId));
  assert.ok(rendered.includes(workDir));

  // whale_send_to_session refuses self-send, accepts peer with messageId.
  const selfSend = await tool('whale_send_to_session').execute({ sessionId: resident.sessionId, text: 'loop' }, exec);
  assert.equal(selfSend.ok, false);
  const peerSend = await tool('whale_send_to_session').execute({ sessionId: peer.sessionId, text: 'hello peer', mode: 'queue' }, exec);
  assert.equal(peerSend.ok, true);
  assert.ok(peerSend.messageId);

  // whale_new_session refuses hidden:true presets, forbidden cwd, and simultaneous workspaceId+cwd.
  await ctx.agentPresets.register({ id: 'internal-hidden-probe', name: 'Hidden', hidden: true, plugins: [] });
  const hiddenPreset = await tool('whale_new_session').execute({ cwd: workDir, agentPreset: 'internal-hidden-probe' }, exec);
  assert.equal(hiddenPreset.ok, false);
  const badCwd = await tool('whale_new_session').execute({ cwd: path.join(home, 'data', 'whale') }, exec);
  assert.equal(badCwd.ok, false);
  const mutualExcl = await tool('whale_new_session').execute({ cwd: workDir, workspaceId: 'ws-1' }, exec);
  assert.equal(mutualExcl.ok, false);

  // whale_recent_events emits ISO timestamp + event type.
  const recentDef = tool('whale_recent_events');
  const recentRes = await recentDef.execute({ limit: 5 }, exec);
  assert.ok(Array.isArray(recentRes.events));
});
