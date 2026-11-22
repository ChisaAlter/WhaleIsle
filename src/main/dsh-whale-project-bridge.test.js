'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
require('../../scripts/lib/harness-peer-hook.cjs');

const { storeInternalSecrets, INTERNAL_SECRETS_KEY } = require('../shared/secret');
const {
  startDesktopInstallControl,
  stopDesktopInstallControl,
} = require('./desktop-install-control');

const ROOT = path.resolve(__dirname, '../..');
const toUrl = (rel) => pathToFileURL(path.join(rootOrRoot(ROOT), rel)).href;

function rootOrRoot(dir) {
  return dir;
}

function makeExec({
  sessionId = 'whale-resident',
  rpcId = 'web-1',
  sourceKind = 'user',
  speaker = undefined,
  eventsOverride = null,
  callId = 'call-bridge-1',
  aborted = false,
} = {}) {
  const ac = new AbortController();
  if (aborted) ac.abort(new Error('stopped'));
  const events = eventsOverride ?? [
    { type: 'turn/start', seq: 1, data: { turn: 1 } },
    {
      type: 'user/message',
      seq: 2,
      data: {
        id: 'msg-1',
        source: {
          kind: sourceKind,
          rpcId,
          ...(speaker ? { speaker } : {}),
        },
        content: [{ type: 'text', text: 'turn' }],
      },
    },
  ];
  return {
    callId,
    signal: ac.signal,
    agent: {
      id: sessionId,
      session: {
        snapshotEvents: () => events,
      },
    },
  };
}

function makeToolsHarness(projectsService) {
  const registered = new Map();
  const ctx = {
    tools: {
      register(def) {
        registered.set(def.name, def);
        return () => registered.delete(def.name);
      },
    },
    get(key) {
      if (key === 'projects') return projectsService;
      return undefined;
    },
  };
  return { ctx, registered };
}

let savedControlEnv = null;

test.afterEach(() => {
  stopDesktopInstallControl();
  if (savedControlEnv) {
    if (savedControlEnv.url === undefined) delete process.env.DSH_DESKTOP_INSTALL_URL;
    else process.env.DSH_DESKTOP_INSTALL_URL = savedControlEnv.url;
    globalThis[INTERNAL_SECRETS_KEY] = savedControlEnv.store;
    savedControlEnv = null;
  }
});

async function setupConfirmServer(handler) {
  savedControlEnv ??= {
    url: process.env.DSH_DESKTOP_INSTALL_URL,
    store: globalThis[INTERNAL_SECRETS_KEY],
  };
  const control = startDesktopInstallControl({
    confirmModelAction: handler,
    showSecret: async () => false,
    installPlugin: async () => ({ ok: true, spec: 'test' }),
    startHarness: () => {},
  });
  const { url, token } = await control.ready;
  process.env.DSH_DESKTOP_INSTALL_URL = url;
  storeInternalSecrets([['DSH_DESKTOP_INSTALL_TOKEN', token]]);
  return control;
}

test('whale_list_projects and whale_inspect_project handle normal data, unavailability, and taint/non-owner guards', async () => {
  const { registerProjectBridgeTools } = await import(toUrl('vendor/dsh-whale/lib/project-bridge-tools.js'));

  // 1. Degraded when Project service is absent.
  const missingHarness = makeToolsHarness(null);
  registerProjectBridgeTools(missingHarness.ctx, { getSelfId: () => 'whale-resident' });
  const listWhenDown = await missingHarness.registered.get('whale_list_projects').execute({}, makeExec());
  assert.equal(listWhenDown.ok, true);
  assert.equal(listWhenDown.available, false);
  assert.deepEqual(listWhenDown.projects, []);

  const inspectWhenDown = await missingHarness.registered.get('whale_inspect_project').execute(
    { projectId: 'p1' },
    makeExec(),
  );
  assert.equal(inspectWhenDown.ok, false);
  assert.equal(inspectWhenDown.available, false);
  assert.equal(inspectWhenDown.found, false);

  // 2. Normal read operations with real summary/detail delegation.
  const stubProject = {
    projectId: 'p1',
    title: 'Repo Alpha',
    canonicalWorkingDirectory: 'C:\\repo\\alpha',
    lifecycle: 'ready',
    archiving: false,
    coordinatorSessionId: 'coord-1',
    activity: { state: 'idle' },
    notesPreview: '# Notes',
  };
  const okHarness = makeToolsHarness({
    available: true,
    listBridgeSummaries: () => ({ available: true, projects: [stubProject] }),
    inspectBridgeProject: ({ projectId, cwd }) => (
      projectId === 'p1' || cwd === 'C:\\repo\\alpha'
        ? { available: true, found: true, project: stubProject }
        : { available: true, found: false, project: null, error: '未找到匹配的 Project。' }
    ),
  });
  registerProjectBridgeTools(okHarness.ctx, { getSelfId: () => 'whale-resident' });

  const listed = await okHarness.registered.get('whale_list_projects').execute({}, makeExec());
  assert.equal(listed.ok, true);
  assert.equal(listed.available, true);
  assert.equal(listed.projects.length, 1);
  assert.equal(listed.projects[0].projectId, 'p1');

  const inspected = await okHarness.registered.get('whale_inspect_project').execute({ cwd: 'C:\\repo\\alpha' }, makeExec());
  assert.equal(inspected.ok, true);
  assert.equal(inspected.found, true);
  assert.equal(inspected.project.coordinatorSessionId, 'coord-1');

  // 3. Tainted session & non-owner IM refused.
  const taintedExec = makeExec({
    rpcId: 'feishu-owner-private-1',
    eventsOverride: [
      { type: 'turn/start', seq: 1, data: { turn: 1 } },
      { type: 'user/message', seq: 2, data: { id: 'g1', source: { kind: 'dsh-im:inbound', speaker: { role: 'guest' } } } },
    ],
  });
  const taintedList = await okHarness.registered.get('whale_list_projects').execute({}, taintedExec);
  assert.equal(taintedList.ok, false);
  assert.match(taintedList.detail, /隔离/);

  const nonOwnerExec = makeExec({
    sourceKind: 'dsh-im:inbound',
    rpcId: 'feishu-guest-private-1',
    speaker: { role: 'guest' },
  });
  const nonOwnerInspect = await okHarness.registered.get('whale_inspect_project').execute({ projectId: 'p1' }, nonOwnerExec);
  assert.equal(nonOwnerInspect.ok, false);
  assert.match(nonOwnerInspect.detail, /非主人|隔离/);
});

test('whale_handoff_to_project enforces precheck before confirm, desktop confirm gate, origin guards, and idempotency', async () => {
  const { registerProjectBridgeTools } = await import(toUrl('vendor/dsh-whale/lib/project-bridge-tools.js'));

  const handoffCalls = [];
  const confirmCalls = [];
  let confirmDecision = true;
  await setupConfirmServer(async (payload) => {
    confirmCalls.push(payload);
    return confirmDecision;
  });

  const projectsMap = {
    pReady: {
      projectId: 'pReady',
      title: 'Repo Beta',
      canonicalWorkingDirectory: 'C:\\repo\\beta',
      lifecycle: 'ready',
      archiving: false,
      coordinatorSessionId: 'coord-beta',
      activity: { state: 'idle' },
    },
    pArchived: {
      projectId: 'pArchived',
      title: 'Repo Old',
      canonicalWorkingDirectory: 'C:\\repo\\old',
      lifecycle: 'archived',
      archiving: false,
      coordinatorSessionId: 'coord-old',
      activity: { state: 'idle' },
    },
  };

  const serviceStub = {
    available: true,
    inspectBridgeProject: ({ projectId }) => {
      const p = projectsMap[projectId];
      return p
        ? { available: true, found: true, project: p }
        : { available: true, found: false, project: null, error: '未找到匹配的 Project。' };
    },
    acceptAuthorizedHandoff: async (input) => {
      handoffCalls.push(input);
      return {
        accepted: true,
        deduplicated: handoffCalls.length > 1,
        projectId: input.projectId,
        coordinatorSessionId: projectsMap[input.projectId].coordinatorSessionId,
        handoffId: input.handoffId,
        messageId: 'msg-delivered-1',
      };
    },
  };

  const { ctx, registered } = makeToolsHarness(serviceStub);
  registerProjectBridgeTools(ctx, { getSelfId: () => 'whale-resident' });
  const tool = registered.get('whale_handoff_to_project');

  // A. Origin/taint/abort guards must block BEFORE confirm.
  for (const [label, badExec] of [
    ['aborted', makeExec({ aborted: true })],
    ['pulse', makeExec({ sourceKind: 'schedule', rpcId: 'whale-pulse-1' })],
    ['im-owner', makeExec({ sourceKind: 'dsh-im:inbound', rpcId: 'feishu-owner-private-a1b2' })],
    ['im-non-owner', makeExec({ sourceKind: 'dsh-im:inbound', rpcId: 'feishu-guest-group-a1b2', speaker: { role: 'guest', chat: 'group' } })],
    ['foreign', makeExec({ sessionId: 'other-session' })],
    ['tainted', makeExec({
      eventsOverride: [
        { type: 'user/message', seq: 1, data: { source: { speaker: { role: 'guest' } } } },
        { type: 'turn/start', seq: 2, data: { turn: 2 } },
        { type: 'user/message', seq: 3, data: { source: { kind: 'user', rpcId: 'web-2' } } },
      ],
    })],
  ]) {
    const blocked = await tool.execute({ projectId: 'pReady', goal: 'Refactor auth' }, badExec);
    assert.equal(blocked.ok, false, `expected ${label} to fail`);
    assert.equal(confirmCalls.length, 0, `${label} must not trigger confirm`);
    assert.equal(handoffCalls.length, 0, `${label} must not deliver`);
  }

  // B. Precheck & arg validation failures must NOT trigger confirm.
  const missingProject = await tool.execute({ projectId: 'pMissing', goal: 'Fix bug' }, makeExec());
  assert.equal(missingProject.ok, false);
  const archivedProject = await tool.execute({ projectId: 'pArchived', goal: 'Fix bug' }, makeExec());
  assert.equal(archivedProject.ok, false);
  const badWritePath = await tool.execute({
    projectId: 'pReady',
    goal: 'Update docs',
    scopeCeiling: 'docs',
    writePaths: ['src/index.js'],
  }, makeExec());
  assert.equal(badWritePath.ok, false);
  const readonlyWrite = await tool.execute({
    projectId: 'pReady',
    goal: 'Inspect',
    scopeCeiling: 'readonly',
    writePaths: ['README.md'],
  }, makeExec());
  assert.equal(readonlyWrite.ok, false);
  assert.equal(confirmCalls.length, 0);
  assert.equal(handoffCalls.length, 0);

  // C. Declined desktop confirmation refuses and never delivers.
  confirmDecision = false;
  const declined = await tool.execute({
    projectId: 'pReady',
    goal: 'Add test coverage',
    scopeCeiling: 'development',
    writePaths: ['tests/unit.test.js'],
  }, makeExec());
  assert.equal(declined.ok, false);
  assert.equal(confirmCalls.length, 1);
  assert.equal(confirmCalls[0].tool, 'whale_handoff_to_project');
  assert.equal(confirmCalls[0].action, 'handoff');
  assert.equal(confirmCalls[0].effect, 'code');
  assert.equal(handoffCalls.length, 0);

  // D. Allowed desktop confirmation delivers with confirmedByDesktop=true and handoffId.
  confirmDecision = true;
  const accepted = await tool.execute({
    projectId: 'pReady',
    title: 'Unit tests',
    goal: 'Add test coverage',
    scopeCeiling: 'development',
    writePaths: ['tests/unit.test.js'],
    constraints: ['No breaking changes'],
    conditions: ['All tests pass'],
  }, makeExec({ callId: 'handoff-uniq-1' }));
  assert.equal(accepted.ok, true);
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.deduplicated, false);
  assert.equal(accepted.projectId, 'pReady');
  assert.equal(accepted.coordinatorSessionId, 'coord-beta');
  assert.equal(accepted.handoffId, 'handoff-uniq-1');
  assert.equal(handoffCalls.length, 1);
  assert.equal(handoffCalls[0].confirmedByDesktop, true);

  // E. Retry with same callId surfaces deduplicated: true.
  const retried = await tool.execute({
    projectId: 'pReady',
    goal: 'Add test coverage',
    scopeCeiling: 'development',
  }, makeExec({ callId: 'handoff-uniq-1' }));
  assert.equal(retried.ok, true);
  assert.equal(retried.deduplicated, true);
});

test('real ProjectService.acceptAuthorizedHandoff enforces confirmedByDesktop, validates scope, delivers user message, and deduplicates', async (t) => {
  const { ProjectService } = await import(toUrl('vendor/dsh-project/tests/harness-runtime.mjs'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-bridge-real-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const repoDir = path.join(dir, 'repo');
  fs.mkdirSync(repoDir, { recursive: true });

  const leadEvents = [];
  const lead = {
    id: 'coord-real',
    status: 'idle',
    session: {
      id: 'coord-real',
      snapshotEvents: () => leadEvents,
    },
    cancel() {},
    async whenIdle() {},
    async followup(message) {
      leadEvents.push({ seq: leadEvents.length, type: 'user/message', data: message });
    },
  };
  const ctx = {
    agents: new Map([['coord-real', lead]]),
    sessionPersistence: { stat: async () => ({ id: 'coord-real' }) },
    sessionController: { resolveAgent: async (id) => ({ agent: id === 'coord-real' ? lead : null }) },
    sessions: { flush: async () => true },
    subagents: { registerContinuationPolicy: () => () => {} },
    get: () => undefined,
  };
  const service = new ProjectService(ctx, { home: dir, desktop: async () => ({ ok: true }) });
  t.after(() => service.dispose());

  const project = await service.createProject({
    name: 'Real Repo',
    goal: 'Maintain real repo',
    workspace: repoDir,
  });
  await service.updateProject(project.id, { coordinatorSessionId: 'coord-real' });
  await service.memory.writeMemoryFile(project.id, {
    name: 'status',
    description: 'Project status notes',
    text: '# Project Notes\nStatus good.\n',
  });

  const summary = service.listBridgeSummaries();
  assert.equal(summary.available, true);
  assert.equal(summary.projects.length, 1);
  assert.equal(summary.projects[0].projectId, project.id);

  const detail = service.inspectBridgeProject({ cwd: repoDir });
  assert.equal(detail.found, true);
  assert.match(detail.project.notesPreview, /Project status notes/);

  // Fail closed when confirmedByDesktop !== true.
  await assert.rejects(
    () => service.acceptAuthorizedHandoff({
      projectId: project.id,
      goal: 'Bypass check',
      confirmedByDesktop: false,
    }),
    /确认/,
  );

  // Valid handoff delivers a user/message with source.kind === 'user'.
  const delivered = await service.acceptAuthorizedHandoff({
    projectId: project.id,
    title: 'Harden parser',
    goal: 'Audit parser edge cases and report findings',
    scopeCeiling: 'docs',
    writePaths: ['docs/audit.md'],
    constraints: ['Keep API intact'],
    conditions: ['Cite concrete files'],
    confirmedByDesktop: true,
    handoffId: 'real-handoff-1',
    sourceSessionId: 'whale-resident',
  });
  assert.equal(delivered.accepted, true);
  assert.equal(delivered.deduplicated, false);
  assert.equal(leadEvents.length, 1);
  assert.equal(leadEvents[0].data.source.kind, 'user');
  assert.equal(leadEvents[0].data.source.handoffId, 'real-handoff-1');
  const deliveredText = leadEvents[0].data.content.map((b) => b.text).join('\n');
  assert.match(deliveredText, /scopeCeiling: docs/);
  assert.match(deliveredText, /docs\/audit\.md/);
  assert.match(deliveredText, /projects_add_task/);

  // Duplicate handoffId deduplicates without appending a second message.
  const duplicate = await service.acceptAuthorizedHandoff({
    projectId: project.id,
    goal: 'Audit parser edge cases and report findings',
    scopeCeiling: 'docs',
    writePaths: ['docs/audit.md'],
    confirmedByDesktop: true,
    handoffId: 'real-handoff-1',
  });
  assert.equal(duplicate.accepted, true);
  assert.equal(duplicate.deduplicated, true);
  assert.equal(leadEvents.length, 1);
});
