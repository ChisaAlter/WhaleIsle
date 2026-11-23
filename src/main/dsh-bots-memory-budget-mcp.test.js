'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const BOTS_LIB = path.join(REPO_ROOT, 'vendor', 'dsh-whale', 'lib', 'bots');
const SHARED_INDEX = path.join(REPO_ROOT, 'vendor', 'dsh-whale', 'src', 'shared', 'index.js');

const importEsm = (absPath) => import(pathToFileURL(absPath).href);

function makeTempHome(t, prefix = 'whale-bots-w2b-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

async function createTestHarness(t) {
  const dshHome = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-bots-w2b-'));
  const [
    dbMod,
    fsHome,
    itemsMod,
    workMod,
    memMod,
    budgetMod,
    mcpMod,
    tidyMod,
    promptMod,
    sessionMod,
    mailMod,
    serviceMod,
    shareMod,
    shared,
  ] = await Promise.all([
    importEsm(path.join(BOTS_LIB, 'db.js')),
    importEsm(path.join(BOTS_LIB, 'fs-home.js')),
    importEsm(path.join(BOTS_LIB, 'items-store.js')),
    importEsm(path.join(BOTS_LIB, 'work-store.js')),
    importEsm(path.join(BOTS_LIB, 'memory-service.js')),
    importEsm(path.join(BOTS_LIB, 'budget-service.js')),
    importEsm(path.join(BOTS_LIB, 'mcp-manager.js')),
    importEsm(path.join(BOTS_LIB, 'tidy-up-service.js')),
    importEsm(path.join(BOTS_LIB, 'prompt-engine.js')),
    importEsm(path.join(BOTS_LIB, 'session-runtime.js')),
    importEsm(path.join(BOTS_LIB, 'mail-reconciler.js')),
    importEsm(path.join(BOTS_LIB, 'service.js')),
    importEsm(path.join(BOTS_LIB, 'share-import-service.js')),
    importEsm(SHARED_INDEX),
  ]);

  const dbHandle = dbMod.openBotsDatabase({ dshHome });
  t.after(() => {
    try { dbHandle.close(); } finally {
      fs.rmSync(dshHome, { recursive: true, force: true });
    }
  });

  const { db, bots: botsStore } = dbHandle;
  const itemsStore = itemsMod.createItemsStore(db);
  const workStore = workMod.createWorkStore(db);
  const metaRoot = fsHome.botMetaDir(dshHome);
  const memoryService = memMod.createMemoryService({ metaRoot, db });
  const emitted = [];
  const eventBus = {
    emit: (payload) => emitted.push(payload),
    clientCount: () => 0,
  };

  function seedBot(overrides = {}) {
    const id = overrides.id || 'bot-alpha';
    const name = overrides.name || 'Alpha Captain';
    const folder = overrides.folder || fsHome.botFolderName(name);
    const homeDir = path.join(fsHome.botsRootDir(dshHome), folder);
    const bot = {
      id,
      name,
      hostId: 'local',
      folder,
      agent: 'deepseek-harness',
      avatar: 'mascot:W1',
      paused: false,
      notifications: { needsPermission: true, taskComplete: true, couldNotFinish: true },
      members: [],
      skillProjects: [],
      chatSessionId: overrides.chatSessionId ?? `bot-home-${id}`,
      lookAround: { on: true, every: 'every-4h', weekdaysOnly: true, focus: '' },
      tidyUp: { on: true, every: 'night' },
      itemsStale: 5,
      firstRun: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...overrides,
    };
    fsHome.initBotHome(homeDir, bot);
    botsStore.insertBot(bot);
    return { bot, homeDir };
  }

  return {
    dshHome,
    metaRoot,
    db,
    botsStore,
    itemsStore,
    workStore,
    memoryService,
    eventBus,
    emitted,
    seedBot,
    mods: {
      fsHome,
      memMod,
      budgetMod,
      mcpMod,
      tidyMod,
      promptMod,
      sessionMod,
      mailMod,
      serviceMod,
      shareMod,
      shared,
    },
  };
}

test('memory-service: FTS5 incremental search across bot/team/project scopes, BM25 × time decay, daily log & flush', async (t) => {
  const h = await createTestHarness(t);
  const { bot, homeDir } = h.seedBot();
  const now = Date.parse('2026-11-20T10:00:00Z');

  // Add an older fact and a newer fact mentioning "deployment"
  h.memoryService.addFact({
    botId: bot.id,
    homeDir,
    text: 'Production deployment uses canary rollout on Tuesdays',
    date: '2026-06-01',
    at: now,
  });
  h.memoryService.addFact({
    botId: bot.id,
    homeDir,
    text: 'Production deployment uses automated canary verification',
    date: '2026-11-18',
    at: now,
  });

  // Write team shared memory and project memory
  h.memoryService.writeTeamMemory('group-fleet', '# Team\n- 2026-11-19 Shared deployment window is off-peak UTC+8\n', { at: now });
  const teamRead = h.memoryService.readTeamMemory('group-fleet');
  assert.ok(teamRead.content.includes('Shared deployment window'));

  h.memoryService.indexProjectMemory({
    projectId: 'proj-whale',
    content: '- 2026-11-19 Project deployment script lives in scripts/release.mjs\n',
    at: now,
  });

  // Bot-only search: newer fact must outrank older fact due to time decay
  const botHits = h.memoryService.searchMemory({
    botId: bot.id,
    query: 'deployment canary',
    scope: 'bot',
    at: now,
  });
  assert.equal(botHits.length, 2);
  assert.equal(botHits[0].factDate, '2026-11-18');
  assert.ok(botHits[0].score > botHits[1].score);
  assert.ok(botHits[0].decay > botHits[1].decay);

  // Combined 3-tier scope search
  const allHits = h.memoryService.searchMemory({
    botId: bot.id,
    groupId: 'group-fleet',
    projectId: 'proj-whale',
    query: 'deployment',
    at: now,
  });
  const scopes = new Set(allHits.map((r) => r.scope));
  assert.deepEqual([...scopes].sort(), ['bot', 'project', 'team']);

  // Daily log & pre-compaction flush preserve MEMORY.md sovereignty and redact secrets
  const daily = h.memoryService.appendDailyLog({
    botId: bot.id,
    homeDir,
    text: 'Checked release pipeline latency',
    date: '2026-11-20',
    at: now,
  });
  assert.equal(daily.relPath, 'memory/2026-11-20.md');
  assert.ok(h.memoryService.readDailyLog({ homeDir, date: '2026-11-20' }).content.includes('Checked release pipeline latency'));

  const beforeMem = fs.readFileSync(path.join(homeDir, 'MEMORY.md'), 'utf8');
  const flushed = h.memoryService.flushBeforeCompaction({
    botId: bot.id,
    homeDir,
    date: '2026-11-20',
    facts: [
      'Checked release pipeline latency', // duplicate of daily log, should be skipped
      'Use sk-proj-secret1234567890abcdef never in logs',
      'Worker worktrees cleaned after verification',
    ],
    at: now,
  });
  assert.equal(flushed.flushedCount, 2);
  assert.equal(fs.readFileSync(path.join(homeDir, 'MEMORY.md'), 'utf8'), beforeMem);
  const dailyText = h.memoryService.readDailyLog({ homeDir, date: '2026-11-20' }).content;
  assert.ok(dailyText.includes('[REDACTED]'));
  assert.ok(!dailyText.includes('sk-proj-secret1234567890abcdef'));

  // Flushed daily log entries are searchable via FTS5
  const dailyHits = h.memoryService.searchMemory({ botId: bot.id, query: 'worktrees cleaned', scope: 'bot', at: now });
  assert.equal(dailyHits.length, 1);
  assert.equal(dailyHits[0].sourceFile, 'memory/2026-11-20.md');

  // Forget removes from MEMORY.md AND updates FTS5 incrementally
  h.memoryService.forgetFact({ botId: bot.id, homeDir, fact: 'Production deployment uses canary rollout on Tuesdays', at: now });
  const afterForget = h.memoryService.searchMemory({ botId: bot.id, query: 'Tuesdays', scope: 'bot', at: now });
  assert.equal(afterForget.length, 0);
});

test('tidy-up-service: unified launch route, reflection proposals (>=2 -> needs_you, SOUL untouched), off-peak scheduler', async (t) => {
  const h = await createTestHarness(t);
  const { bot, homeDir } = h.seedBot({
    launch: { provider: 'deepseek', model: 'deepseek-reasoner', reasoningEffort: 'high' },
  });
  const soulBefore = h.mods.fsHome.readSoul(homeDir).text;
  h.memoryService.addFact({ botId: bot.id, homeDir, text: 'Always run npm test before PR', date: '2026-11-18' });

  let capturedRoute = null;
  let capturedPrompt = '';
  const budgetService = h.mods.budgetMod.createBudgetService({ workStore: h.workStore, botsStore: h.botsStore, itemsStore: h.itemsStore });

  const tidy = h.mods.tidyMod.createTidyUpService({
    ctx: null,
    dshHome: h.dshHome,
    botsStore: h.botsStore,
    memoryService: h.memoryService,
    sessionRuntime: { listModels: async () => ({ default: { provider: 'fallback', model: 'm-default' } }) },
    eventBus: h.eventBus,
    itemsStore: h.itemsStore,
    budgetService,
    runModel: async (_b, prompt, route) => {
      capturedPrompt = prompt;
      capturedRoute = route;
      return [
        'BEGIN MEMORY.md',
        '# Memory',
        '',
        '- 2026-11-18 Always run npm test before PR',
        'END MEMORY.md',
        'BEGIN PROPOSAL',
        'Title: 汇报前必须附带测试命令输出',
        'Occurrences: 3',
        'Suggested Rule: 每次声称完成前必须附带真实测试命令与退出码。',
        '- 2026-11-15 用户纠错：缺少测试输出',
        '- 2026-11-17 用户纠错：仅口头说已完成',
        '- 2026-11-18 用户纠错：要求贴命令结果',
        'END PROPOSAL',
        'BEGIN PROPOSAL',
        'Title: 单次偶发偏好不应触发',
        'Occurrences: 1',
        'Suggested Rule: 仅一次出现不应生成提案。',
        'END PROPOSAL',
      ].join('\n');
    },
  });
  t.after(() => tidy.close());

  // 1. Unified flat launch route resolved properly
  const res = await tidy.runNow(bot.id, Date.parse('2026-11-20T14:00:00Z'));
  assert.equal(res.ok, true);
  assert.deepEqual(capturedRoute, { provider: 'deepseek', model: 'deepseek-reasoner', reasoningEffort: 'high' });
  assert.ok(capturedPrompt.includes('BEGIN PROPOSAL'));
  assert.equal(res.proposals.length, 2);
  assert.equal(res.proposalItems.length, 1);
  assert.equal(res.proposalItems[0].status, 'needs_you');
  assert.ok(res.proposalItems[0].title.includes('汇报前必须附带测试命令输出'));

  // SOUL.md MUST NEVER be silently rewritten
  assert.equal(h.mods.fsHome.readSoul(homeDir).text, soulBefore);

  // 2. Scheduler prefers Beijing off-peak window
  // Mon 2026-11-23 10:00 Beijing = 02:00 UTC (PEAK)
  const peakMon = Date.parse('2026-11-23T02:00:00Z');
  const peakTick = await tidy.tickScheduler(peakMon);
  assert.equal(peakTick.skipped, true);
  assert.equal(peakTick.reason, 'peak_window');

  // Mon 2026-11-23 21:00 Beijing = 13:00 UTC (OFF-PEAK)
  const offPeakMon = Date.parse('2026-11-23T13:00:00Z');
  const offPeakTick = await tidy.tickScheduler(offPeakMon);
  assert.equal(offPeakTick.skipped, false);
  assert.equal(offPeakTick.ran.length, 1);
  assert.equal(offPeakTick.ran[0].ok, true);

  // startScheduler / stopScheduler lifecycle
  assert.equal(tidy.startScheduler(60_000).running, true);
  assert.equal(tidy.getStatus(bot.id).schedulerRunning, true);
  assert.equal(tidy.stopScheduler().running, false);
});

test('mcp-manager: per-bot config validation, missing credential detection, inline secret detection, and probe health', async (t) => {
  const h = await createTestHarness(t);
  const { bot, homeDir } = h.seedBot();

  // Save a healthy server with credential stripped into _meta/bot-credentials
  h.mods.fsHome.writeBotToolsConfig(homeDir, h.metaRoot, bot.id, {
    servers: [
      { name: 'github-mcp', transport: 'http', url: 'https://mcp.github.example/sse', headers: { Authorization: 'Bearer tok-valid' } },
      { name: 'broken-url', transport: 'http', url: 'ftp://invalid.example' },
      { name: 'missing-cred', transport: 'http', url: 'https://mcp.linear.example', credential: 'cred_nonexistent' },
    ],
  });

  const mcp = h.mods.mcpMod.createMcpManager({
    dshHome: h.dshHome,
    botsStore: h.botsStore,
    probeServer: async (srv, creds) => {
      if (srv.name === 'github-mcp') {
        assert.equal(creds?.headers?.Authorization, 'Bearer tok-valid');
        return { ok: false, code: 'connection_failed', message: 'ECONNREFUSED 127.0.0.1:9999' };
      }
      return { ok: true };
    },
  });
  t.after(() => mcp.close());

  const initialProblems = mcp.listBotToolsProblems(bot.id);
  const codes = initialProblems.problems.map((p) => p.code).sort();
  assert.deepEqual(codes, ['invalid_url', 'missing_credential']);

  const synced = await mcp.syncBotMcps(bot.id);
  assert.equal(synced.errorCount, 3);
  const gh = synced.servers.find((s) => s.name === 'github-mcp');
  assert.equal(gh.status, 'error');
  assert.equal(gh.problems[0].code, 'connection_failed');

  // Inline plaintext sensitive header written directly to bot-tools.json is flagged
  fs.writeFileSync(
    path.join(homeDir, '.whale', 'bot-tools.json'),
    JSON.stringify({ servers: [{ name: 'leaky', transport: 'http', url: 'https://mcp.ok', headers: { 'X-API-Key': 'raw-secret' } }] }),
    'utf8',
  );
  const leakCheck = mcp.listBotToolsProblems(bot.id);
  assert.ok(leakCheck.problems.some((p) => p.code === 'inline_credentials_detected'));
});

test('budget-service: Beijing peak/off-peak windows, usage aggregation, cache hit rate, exceed circuit-breaker & off_peak_only', async (t) => {
  const h = await createTestHarness(t);
  const { bot } = h.seedBot();
  const { isPeakNow, isOffPeakNow, nextPeakSwitchMs, createBudgetService } = h.mods.budgetMod;

  // Mon 2026-11-23 10:30 Beijing (02:30 UTC) -> PEAK, next switch at 12:00 Beijing (04:00 UTC)
  const monMorningPeak = Date.parse('2026-11-23T02:30:00Z');
  assert.equal(isPeakNow(monMorningPeak), true);
  assert.equal(isOffPeakNow(monMorningPeak), false);
  assert.equal(nextPeakSwitchMs(monMorningPeak), Date.parse('2026-11-23T04:00:00Z'));

  // Mon 2026-11-23 12:30 Beijing (04:30 UTC) -> OFF-PEAK lunch break, next switch at 14:00 Beijing (06:00 UTC)
  const monLunch = Date.parse('2026-11-23T04:30:00Z');
  assert.equal(isOffPeakNow(monLunch), true);
  assert.equal(nextPeakSwitchMs(monLunch), Date.parse('2026-11-23T06:00:00Z'));

  // Mon 2026-11-23 15:00 Beijing (07:00 UTC) -> PEAK
  assert.equal(isPeakNow(Date.parse('2026-11-23T07:00:00Z')), true);
  // Saturday 2026-11-21 10:00 Beijing (02:00 UTC) -> OFF-PEAK
  assert.equal(isOffPeakNow(Date.parse('2026-11-21T02:00:00Z')), true);

  const budget = createBudgetService({
    workStore: h.workStore,
    botsStore: h.botsStore,
    itemsStore: h.itemsStore,
    eventBus: h.eventBus,
  });

  budget.setBudget(bot.id, { dailyLimitUsd: 1.0, offPeakOnly: true, pauseOnExceed: true, alertThresholdPct: 80 });

  // During peak, background task is deferred to next off-peak boundary
  const bgPeak = budget.checkExecutionAllowed(bot.id, { isBackground: true, at: monMorningPeak });
  assert.equal(bgPeak.allowed, false);
  assert.equal(bgPeak.reason, 'off_peak_only');
  assert.equal(bgPeak.deferUntilMs, Date.parse('2026-11-23T04:00:00Z'));

  // During off-peak, background task is allowed
  const bgOffPeak = budget.checkExecutionAllowed(bot.id, { isBackground: true, at: monLunch });
  assert.equal(bgOffPeak.allowed, true);

  // Record usage across peak & off-peak and verify cacheHitRate + circuit-breaker
  budget.recordUsage({
    botId: bot.id,
    sourceKind: 'bot_chats',
    inputTokens: 200,
    cacheReadTokens: 800,
    outputTokens: 100,
    costUsd: 0.6,
  }, monMorningPeak);
  budget.recordUsage({
    botId: bot.id,
    sourceKind: 'bot_work',
    inputTokens: 100,
    cacheReadTokens: 100,
    outputTokens: 50,
    costUsd: 0.5,
  }, monLunch);

  const summary = budget.getBudgetSummary(bot.id, { at: monLunch });
  assert.equal(Number(summary.today.costUsd.toFixed(2)), 1.1);
  assert.equal(Number(summary.today.peakCostUsd.toFixed(2)), 0.6);
  assert.equal(Number(summary.today.offPeakCostUsd.toFixed(2)), 0.5);
  assert.equal(summary.today.cacheHitRate, 0.75); // 900 / 1200
  assert.equal(summary.exceeded, true);

  const blocked = budget.checkExecutionAllowed(bot.id, { isBackground: false, at: monLunch });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.reason, 'budget_exceeded');
  assert.ok(blocked.needsYouItem);
  assert.equal(blocked.needsYouItem.status, 'needs_you');

  // Calling again deduplicates the needs_you item for the same UTC day
  const blockedAgain = budget.checkExecutionAllowed(bot.id, { isBackground: false, at: monLunch });
  assert.equal(blockedAgain.needsYouItem.uid, blocked.needsYouItem.uid);
});

test('prompt-engine: linkedSkills/CREW.md/plan.md injection, Worker inheritance, pet outbox fix, snapshots & diff', async (t) => {
  const h = await createTestHarness(t);
  const { bot, homeDir } = h.seedBot();

  // Write CREW.md, plan.md, and link a project skill
  h.mods.fsHome.writeCrewMd(homeDir, '# Crew\n- Reviewer owns PR checks\n', { botId: bot.id });
  h.mods.fsHome.writePlanMd(homeDir, '# Plan\n- Milestone 1: FTS5 + Budget\n', { botId: bot.id });

  const projDir = makeTempHome(t, 'whale-proj-skills-');
  const skillDir = path.join(projDir, 'skills', 'repo-audit');
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '---\nname: repo-audit\n---\nCheck repo.\n', 'utf8');
  h.mods.fsHome.syncLinkedSkills(h.metaRoot, bot.id, [path.join(projDir, 'skills')]);

  const linked = h.mods.promptMod.listLinkedSkills(h.metaRoot, bot.id);
  assert.deepEqual(linked.map((s) => s.name), ['repo-audit']);

  const runtime = {
    dshHome: h.dshHome,
    botsStore: h.botsStore,
    workStore: h.workStore,
    memoryService: h.memoryService,
    eventBus: { clientCount: () => 0 },
  };
  const inspected = h.mods.promptMod.inspectPrompt(runtime, bot.id);
  assert.ok(inspected.live.identityPrompt.includes('## CREW.md (Read-Only)'));
  assert.ok(inspected.live.identityPrompt.includes('## plan.md (Read-Only)'));
  assert.ok(inspected.live.identityPrompt.includes('## Linked Project Skills'));
  assert.ok(inspected.live.identityPrompt.includes('- repo-audit'));
  assert.ok(inspected.live.identityPrompt.includes('实证交付'));
  assert.ok(inspected.live.identityPrompt.includes('禁猜接口'));

  // Worker session inherits CREW.md and plan.md read-only without Captain-only tools
  h.workStore.adoptCrewSession({ sessionId: 'crew-sess-1', botId: bot.id, title: 'Worker 1' });
  const resolvedWorker = h.mods.promptMod.resolveBotForSession(runtime, { session: { id: 'crew-sess-1' } });
  assert.equal(resolvedWorker.isWorker, true);
  const workerPrompt = h.mods.promptMod.buildWorkerContextPrompt(bot, homeDir);
  assert.ok(workerPrompt.includes('## CREW.md (Read-Only)'));
  assert.ok(workerPrompt.includes('## plan.md (Read-Only)'));
  assert.ok(!workerPrompt.includes('bot_reply'));

  // Pet outbox bubble fix: notify when completed & desktop NOT foreground, suppress when foreground
  const sentBg = h.mods.promptMod.maybeNotifyPetOutbox(runtime, bot, '构建完成，3 个测试全绿。', 'completed');
  assert.equal(sentBg, true);
  const outboxPath = path.join(h.dshHome, 'data', 'whale', 'pet-outbox.jsonl');
  assert.ok(fs.existsSync(outboxPath));
  assert.ok(fs.readFileSync(outboxPath, 'utf8').includes('构建完成'));

  const sentFg = h.mods.promptMod.maybeNotifyPetOutbox(
    { ...runtime, eventBus: { clientCount: () => 2 } },
    bot,
    '前台时不应发桌宠气泡',
    'completed',
  );
  assert.equal(sentFg, false);

  // Rolling 10-entry prompt snapshots + diff
  for (let i = 0; i < 12; i += 1) {
    h.mods.promptMod.recordPromptSnapshot(h.metaRoot, bot.id, {
      sessionId: bot.chatSessionId,
      identityPrompt: `Line shared\nVersion ${i}`,
      memoryPrompt: `Fact ${i}`,
      toolsUsed: i === 11 ? ['bot_memory_search', 'bot_decision_append'] : ['bot_memory_search'],
      capturedAt: 1000 + i * 100,
    });
  }
  const afterSnaps = h.mods.promptMod.inspectPrompt(runtime, bot.id);
  assert.equal(afterSnaps.snapshots.length, 10);
  const diff = h.mods.promptMod.diffPromptSnapshots(h.metaRoot, bot.id);
  assert.equal(diff.fromIdx, 8);
  assert.equal(diff.toIdx, 9);
  assert.ok(diff.addedLines.includes('Version 11'));
  assert.ok(diff.removedLines.includes('Version 10'));
  assert.deepEqual(diff.toolsAdded, ['bot_decision_append']);
});

test('session-runtime: resolveBotLaunchRoute, permissionMode passthrough, and budgetService gate', async (t) => {
  const h = await createTestHarness(t);
  const { bot } = h.seedBot({
    permissionMode: 'workspace-write',
    launch: { provider: 'deepseek', model: 'deepseek-chat', reasoningEffort: 'medium' },
  });

  const createdCalls = [];
  const selectedModels = [];
  const controller = {
    list: async () => [],
    create: async (args) => { createdCalls.push(args); },
    selectModel: async (args) => { selectedModels.push(args); },
    prompt: async () => {},
    runTurnForTest: async (_sid, text) => ({ ok: true, reply: `echo:${text}` }),
  };

  const budgetService = h.mods.budgetMod.createBudgetService({ workStore: h.workStore, botsStore: h.botsStore });
  const sr = h.mods.sessionMod.createSessionRuntime({
    ctx: null,
    dshHome: h.dshHome,
    botsStore: h.botsStore,
    itemsStore: h.itemsStore,
    workStore: h.workStore,
    eventBus: h.eventBus,
    budgetService,
    getController: () => controller,
  });
  t.after(() => sr.close());

  await sr.openHomeChat(bot.id);
  assert.equal(createdCalls.length, 1);
  assert.equal(createdCalls[0].permissionMode, 'workspace-write');
  assert.equal(selectedModels.length, 1);
  assert.deepEqual(
    { provider: selectedModels[0].provider, model: selectedModels[0].model, reasoningEffort: selectedModels[0].reasoningEffort },
    { provider: 'deepseek', model: 'deepseek-chat', reasoningEffort: 'medium' },
  );

  // Exceed budget and verify runSingleTurn & startSideChat are blocked
  budgetService.setBudget(bot.id, { dailyLimitUsd: 0.1, pauseOnExceed: true });
  budgetService.recordUsage({ botId: bot.id, costUsd: 0.2 });

  const turnRes = await sr.runSingleTurn(bot.chatSessionId, 'Hello', { botId: bot.id });
  assert.equal(turnRes.ok, false);
  assert.equal(turnRes.code, 'budget_exceeded');

  const sideRes = await sr.startSideChat(bot.id, { title: 'Blocked Side Chat' });
  assert.equal(sideRes.ok, false);
  assert.equal(sideRes.code, 'budget_exceeded');
});

test('mail-reconciler: atomic owedMail consumption, idempotency, concurrency guard, and failure retention', async (t) => {
  const h = await createTestHarness(t);
  const { bot } = h.seedBot();

  const added = h.itemsStore.add({
    ownerBotId: bot.id,
    chatId: bot.chatSessionId,
    source: { kind: 'chat', sessionId: bot.chatSessionId },
    title: 'Ship Wave 2',
    status: 'needs_you',
    ask: { questions: [{ prompt: 'Proceed?', options: [{ label: 'Yes' }] }] },
  }, { kind: 'bot', botId: bot.id, chatId: bot.chatSessionId });

  h.itemsStore.ownerComment(added.item.uid, { text: 'Approved, go ahead!' });
  assert.equal(h.itemsStore.owedMail().length, 1);

  const wakes = [];
  let shouldFail = true;
  const reconciler = h.mods.mailMod.createMailReconciler({
    itemsStore: h.itemsStore,
    botsStore: h.botsStore,
    sessionRuntime: {},
    eventBus: h.eventBus,
    wakeBot: async (payload) => {
      wakes.push(payload);
      if (shouldFail) return { ok: false, error: 'transient_error' };
      return { ok: true };
    },
  });

  // Failed wake keeps mail owed for retry
  const firstAttempt = await reconciler.reconcileOwedMail();
  assert.equal(firstAttempt.failedGroups, 1);
  assert.equal(firstAttempt.markedEvents, 0);
  assert.equal(h.itemsStore.owedMail().length, 1);

  // Succeeding wake atomically marks mail sent; concurrent calls do not double-wake
  shouldFail = false;
  const [r1, r2] = await Promise.all([
    reconciler.reconcileOwedMail(),
    reconciler.reconcileOwedMail(),
  ]);
  assert.equal(r1.reconciledGroups, 1);
  assert.equal(r2.reconciledGroups, 1);
  assert.equal(wakes.length, 2); // 1 failed + 1 succeeded (NOT 3!)
  assert.equal(h.itemsStore.owedMail().length, 0);

  // Subsequent run is a clean no-op
  const third = await reconciler.reconcileOwedMail();
  assert.equal(third.reconciledGroups, 0);
  assert.equal(wakes.length, 2);
});

test('service.js crew_adoptions & decisions TSV wrappers', async (t) => {
  const h = await createTestHarness(t);
  const { bot } = h.seedBot();
  const botsService = h.mods.serviceMod.createBotsService({
    dshHome: h.dshHome,
    botsStore: h.botsStore,
    itemsStore: h.itemsStore,
    workStore: h.workStore,
    memoryService: h.memoryService,
    sessionRuntime: { listModels: async () => ({ default: null, groups: [] }), listChats: () => [], computeBotSummary: (b) => b },
    eventBus: h.eventBus,
  });

  const adopted = botsService.adoptSession(bot.id, { sessionId: 'sess-normal-1', cwd: '/repo', title: 'Fixer', role: 'worker' });
  assert.equal(adopted.ok, true);
  assert.equal(adopted.adoption.status, 'active');

  const listed = botsService.listCrewAdoptions({ botId: bot.id });
  assert.equal(listed.adoptions.length, 1);
  assert.equal(listed.adoptions[0].sessionId, 'sess-normal-1');

  const released = botsService.releaseCrewSession('sess-normal-1');
  assert.equal(released.ok, true);
  assert.equal(released.adoption.status, 'released');

  botsService.decisionsAppend(bot.id, 'item-42', {
    actor: 'bot',
    phase: 'verify',
    decision: 'verify-passed',
    evidence: 'node --test exit 0',
    notes: 'All green',
  });
  const tsv = botsService.decisionsRead(bot.id, 'item-42');
  assert.equal(tsv.rows.length, 1);
  assert.equal(tsv.rows[0].decision, 'verify-passed');
  assert.equal(tsv.rows[0].evidence, 'node --test exit 0');
});

test('share-import-service: hard credential blocking on export/import, forced disabled automations, selective memoryIndices', async (t) => {
  const h = await createTestHarness(t);
  const { bot, homeDir } = h.seedBot();
  const sr = h.mods.sessionMod.createSessionRuntime({
    ctx: null,
    dshHome: h.dshHome,
    botsStore: h.botsStore,
    itemsStore: h.itemsStore,
    workStore: h.workStore,
    eventBus: h.eventBus,
    getController: () => null,
  });
  t.after(() => sr.close());
  const botsService = h.mods.serviceMod.createBotsService({
    dshHome: h.dshHome,
    botsStore: h.botsStore,
    itemsStore: h.itemsStore,
    workStore: h.workStore,
    memoryService: h.memoryService,
    sessionRuntime: sr,
    eventBus: h.eventBus,
  });
  const share = h.mods.shareMod.createShareImportService({
    dshHome: h.dshHome,
    userHomeDir: makeTempHome(t, 'whale-user-home-'),
    botsStore: h.botsStore,
    workStore: h.workStore,
    botsService,
  });

  // 1. Export rejects plaintext secret in SOUL.md
  h.mods.fsHome.writeSoul(homeDir, '# Leaky\nUse token ghp_1234567890abcdefghij to push.\n', { botId: bot.id });
  assert.throws(() => share.prepareShare(bot.id), (err) => err?.code === 'secret_detected');

  // Clean SOUL exports cleanly
  h.mods.fsHome.writeSoul(homeDir, '# Clean Captain\nCoordinates releases safely.\n', { botId: bot.id });
  h.workStore.upsertAutomation({
    botId: bot.id,
    name: 'Daily Sync',
    prompt: 'Summarize open PRs.',
    schedule: '0 9 * * 1-5',
    enabled: true,
  });
  const exported = share.prepareShare(bot.id);
  assert.ok(exported.packageJson.includes('Clean Captain'));

  // 2. Import rejects package containing plaintext secret
  const evilPkg = {
    manifest: exported.manifest,
    files: { 'SOUL.md': '# Evil\nBearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload\n' },
  };
  await assert.rejects(() => share.executeImport({ packageJson: evilPkg, skipKickoff: true }), (err) => err?.code === 'secret_detected');

  // 3. Clean package import forces ALL automations to enabled: false and respects memoryIndices
  const cleanPkg = {
    manifest: exported.manifest,
    files: {
      ...exported.files,
      'MEMORY.md': '# Memory\n\n- 2026-11-01 Fact zero\n- 2026-11-02 Fact one\n- 2026-11-03 Fact two\n',
    },
    automations: [{ name: 'Sneaky Auto', prompt: 'Ping channel', schedule: '*/5 * * * *', enabled: true }],
  };
  const imported = await share.executeImport({
    packageJson: cleanPkg,
    name: 'Imported Captain',
    memoryIndices: [0, 2],
    skipKickoff: true,
  });
  assert.equal(imported.ok, true);
  const autos = h.workStore.listAutomations({ botId: imported.bot.id });
  assert.ok(autos.length >= 2);
  assert.ok(autos.every((a) => a.enabled === false), 'All imported automations must be forced enabled: false');

  const importedMem = fs.readFileSync(path.join(h.mods.fsHome.botsRootDir(h.dshHome), imported.bot.folder, 'MEMORY.md'), 'utf8');
  assert.ok(importedMem.includes('Fact zero'));
  assert.ok(!importedMem.includes('Fact one'));
  assert.ok(importedMem.includes('Fact two'));
});

test('shared builtin skills & captain templates: upgraded status-brief, 4 new skills, 3 captain templates, backward compatible', async () => {
  const shared = await importEsm(SHARED_INDEX);

  // Backward compatibility with existing assertions
  assert.equal(shared.BOT_TEMPLATES.length, 24);
  assert.equal(shared.BOT_BUILTIN_SKILL_IDS.length, 13);

  // Upgraded status-brief includes ketchup + unslop
  const brief = shared.getBuiltinSkill('status-brief');
  assert.ok(brief.toLowerCase().includes('ketchup'));
  assert.ok(brief.toLowerCase().includes('unslop'));

  // 4 new built-in skills exist with frontmatter
  for (const skillId of ['context-recall', 'decision-trail', 'review-and-reflect', 'interrogate-lite']) {
    assert.equal(shared.isBuiltinSkillId(skillId), true);
    const body = shared.getBuiltinSkill(skillId);
    assert.ok(body && body.startsWith('---'), `${skillId} must start with frontmatter`);
  }
  assert.equal(shared.ALL_BOT_BUILTIN_SKILL_IDS.length, 17);

  // 3 ready-to-use Captain/Steward templates resolve cleanly
  assert.equal(shared.BOT_TEMPLATES_CAPTAIN.length, 3);
  assert.equal(shared.BOT_ALL_TEMPLATES.length, 27);
  for (const id of ['engineering-captain', 'ops-steward', 'chief-of-staff']) {
    const tpl = shared.botTemplate(id);
    assert.ok(tpl, `Captain template ${id} must resolve via botTemplate`);
    assert.ok(tpl.titleZh && tpl.summaryZh && tpl.firstMessageZh);
    const files = shared.resolveTemplateSkillFiles(tpl);
    assert.equal(files.length, tpl.skills.length);
  }
  assert.ok(shared.searchTemplates('大总管').some((t) => t.id === 'engineering-captain'));
});
