/**
 * Pure & filesystem provisioning helpers for `service.js` (template assets,
 * package assets, structured `import/shared-setup.json` contract, atomic
 * create-with-rollback helper, new bot record builder, member/field patching,
 * and skill scan).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  BOT_LIMITS,
  BOT_SHARED_SETUP_FILE,
  DEFAULT_BOT_NOTIFICATIONS,
  DEFAULT_LOOK_AROUND,
  DEFAULT_TIDY_UP,
  botTemplate,
  localizeTemplate,
  mascotAvatar,
  newBotName,
  normalizeHexColor,
  patchLookAround,
  patchTidyUp,
  planBotFromPackage,
  proposalSoul,
  randomMascotAvatar,
  resolveTemplateSkillFiles,
  starterSoul,
  validateBotName,
} from '../../src/shared/index.js';
import {
  BotFsError,
  initBotHome,
  reserveBotFolder,
  writeAtomicFile,
  writeBotToolsConfig,
  writeHomeFile,
} from './fs-home.js';

export const BOT_SHARED_SETUP_JSON_FILE = 'import/shared-setup.json';

/** @param {string} rawBase64 */
export function decodePngBase64(rawBase64) {
  const str = String(rawBase64 ?? '').trim();
  const stripped = str.startsWith('data:') ? str.slice(str.indexOf(',') + 1) : str;
  if (!stripped) throw new BotFsError('invalid_avatar', 'Avatar base64 payload is empty');
  return Buffer.from(stripped, 'base64');
}

/** @param {any} opts */
function buildTemplateFirstSteps({ firstChat, connectors, toolsToSignIn, schedulesOff, eventsSuggested, sharerNote }) {
  const firstSteps = [];
  if (firstChat) firstSteps.push(firstChat);
  if (connectors.length > 0) firstSteps.push(`Connect required integrations: ${connectors.join(', ')}.`);
  if (toolsToSignIn.length > 0) {
    const names = toolsToSignIn.map((/** @type {any} */ t) => (typeof t === 'string' ? t : t.name)).join(', ');
    firstSteps.push(`Sign in to tools: ${names}.`);
  }
  if (schedulesOff.length > 0) firstSteps.push(`Review and enable ${schedulesOff.length} paused schedule(s) once ready.`);
  if (eventsSuggested.length > 0) firstSteps.push(`Set up ${eventsSuggested.length} suggested event trigger(s) when connected.`);
  if (sharerNote) firstSteps.push(sharerNote);
  return firstSteps;
}

/** @param {any} template @param {string} [locale] */
export function buildTemplateSharedSetup(template, locale = 'zh-CN') {
  const localized = localizeTemplate(template, locale) ?? template;
  const connectors = Array.isArray(template.connectors) ? [...template.connectors] : [];
  const toolsToSignIn = Array.isArray(template.toolsToSignIn) ? [...template.toolsToSignIn] : [];
  const schedulesOff = (Array.isArray(localized.schedules) ? localized.schedules : []).map((/** @type {any} */ sched) => ({
    id: sched.id ?? null,
    name: sched.name || sched.what || `${localized.name || template.name} schedule`,
    when: sched.when ?? null,
    rrule: sched.rrule || sched.schedule || null,
    timezone: sched.timezone ?? null,
    prompt: sched.prompt || localized.does || template.does || 'Check for updates.',
    results: sched.results || 'chat',
  }));
  const eventsSuggested = (Array.isArray(localized.events) ? localized.events : []).map((/** @type {any} */ ev) => ({
    id: ev.id ?? null,
    name: ev.name || `${ev.source}:${ev.event}`,
    source: ev.source ?? null,
    event: ev.event ?? null,
    prompt: ev.prompt ?? '',
    ...(ev.textContains ? { textContains: ev.textContains } : {}),
    ...(ev.results ? { results: ev.results } : {}),
  }));
  const firstChat = localized.firstChat ?? template.firstChat ?? null;
  const sharerNote = localized.needsSetup ?? template.needsSetup ?? null;
  const firstSteps = buildTemplateFirstSteps({ firstChat, connectors, toolsToSignIn, schedulesOff, eventsSuggested, sharerNote });

  return {
    schemaVersion: 1,
    source: 'template',
    templateId: template.id ?? null,
    templateName: localized.name ?? template.name ?? null,
    category: template.category ?? null,
    firstSteps,
    connectors,
    toolsToSignIn,
    schedulesOff,
    eventsSuggested,
    firstChat,
    sharerNote,
    needsSetup: sharerNote,
  };
}

/** @param {any} manifest @param {any} plan */
export function buildPackageSharedSetup(manifest, plan) {
  const connectors = Array.isArray(plan.connectors) ? [...plan.connectors] : [];
  const toolsToSignIn = (Array.isArray(plan.tools) ? plan.tools : []).map((/** @type {any} */ t) => ({
    id: t.id,
    name: t.name,
    url: t.url,
    headerNames: Array.isArray(t.headerNames) ? [...t.headerNames] : [],
  }));
  const schedulesOff = (Array.isArray(plan.schedules) ? plan.schedules : []).map((/** @type {any} */ sched) => ({
    id: sched.id ?? null,
    name: sched.name,
    rrule: sched.rrule ?? null,
    timezone: sched.timezone ?? null,
    prompt: sched.prompt,
    results: sched.results ?? 'chat',
  }));
  const eventsSuggested = (Array.isArray(plan.eventSuggestions) ? plan.eventSuggestions : []).map((/** @type {any} */ ev) => ({
    id: ev.id ?? null,
    name: ev.name,
    source: ev.source,
    event: ev.event,
    prompt: ev.prompt,
    ...(ev.textContains ? { textContains: ev.textContains } : {}),
    ...(ev.results ? { results: ev.results } : {}),
  }));
  const sharerNote = plan.setupNote ?? manifest?.setupNote ?? null;

  const firstSteps = [];
  if (sharerNote) firstSteps.push(sharerNote);
  if (connectors.length > 0) {
    firstSteps.push(`Connect integrations: ${connectors.join(', ')}.`);
  }
  if (toolsToSignIn.length > 0) {
    firstSteps.push(`Configure credentials for ${toolsToSignIn.map((/** @type {any} */ t) => t.name).join(', ')}.`);
  }
  if (schedulesOff.length > 0) {
    firstSteps.push(`Review and enable ${schedulesOff.length} imported schedule(s).`);
  }
  if (eventsSuggested.length > 0) {
    firstSteps.push(`Review ${eventsSuggested.length} suggested event trigger(s).`);
  }

  return {
    schemaVersion: 1,
    source: 'package',
    packageName: manifest?.name ?? null,
    firstSteps,
    connectors,
    toolsToSignIn,
    schedulesOff,
    eventsSuggested,
    firstChat: null,
    sharerNote,
    needsSetup: sharerNote,
  };
}

/** @param {any} template @param {any} setup */
function buildTemplateSetupNote(template, setup) {
  const lines = [
    `# Setup notes for ${template.name}`,
    '',
    `Template: ${template.name} (${template.category})`,
    `Structured setup contract: \`${BOT_SHARED_SETUP_JSON_FILE}\``,
    template.line ? `Summary: ${template.line}` : '',
    template.watches ? `- Watches: ${template.watches}` : '',
    template.does ? `- Does: ${template.does}` : '',
    template.reports ? `- Reports: ${template.reports}` : '',
    setup.connectors.length > 0 ? `- Connectors: ${setup.connectors.join(', ')}` : '',
    setup.firstChat ? `- First chat: ${setup.firstChat}` : '',
    setup.sharerNote ? `- Needs setup: ${setup.sharerNote}` : '',
    setup.schedulesOff.length > 0
      ? `- Paused schedules (${setup.schedulesOff.length}): ${setup.schedulesOff.map((/** @type {any} */ s) => `${s.name} [${s.rrule || 'manual'}]`).join('; ')}`
      : '',
    setup.eventsSuggested.length > 0
      ? `- Suggested events (${setup.eventsSuggested.length}): ${setup.eventsSuggested.map((/** @type {any} */ e) => `${e.source}.${e.event} (${e.name})`).join('; ')}`
      : '',
  ].filter(Boolean);
  return `${lines.join('\n')}\n`;
}

/** @param {any} setup */
function buildPackageSetupNote(setup) {
  const lines = [
    `# Setup notes for ${setup.packageName || 'Imported Bot'}`,
    '',
    `Structured setup contract: \`${BOT_SHARED_SETUP_JSON_FILE}\``,
    setup.sharerNote ? `\n${setup.sharerNote}` : '',
    setup.connectors.length > 0 ? `- Connectors: ${setup.connectors.join(', ')}` : '',
    setup.toolsToSignIn.length > 0 ? `- Tools to sign in: ${setup.toolsToSignIn.map((/** @type {any} */ t) => t.name).join(', ')}` : '',
    setup.schedulesOff.length > 0 ? `- Paused schedules: ${setup.schedulesOff.map((/** @type {any} */ s) => s.name).join('; ')}` : '',
    setup.eventsSuggested.length > 0
      ? `- Suggested events: ${setup.eventsSuggested.map((/** @type {any} */ e) => `${e.source}.${e.event} (${e.name})`).join('; ')}`
      : '',
  ].filter(Boolean);
  return `${lines.join('\n')}\n`;
}

/**
 * Provision template skills, structured `import/shared-setup.json` + readable `shared-setup.md`,
 * and paused schedules in `workStore`. Returns created automation IDs and structured setup object.
 * @param {string} homeDir
 * @param {any} bot
 * @param {any} template
 * @param {string[] | null} selectedSkills
 * @param {any} workStore
 * @param {{ locale?: string }} [options]
 */
export function provisionTemplateAssets(homeDir, bot, template, selectedSkills, workStore, options = {}) {
  for (const skill of resolveTemplateSkillFiles(template, selectedSkills)) {
    writeAtomicFile(path.join(homeDir, 'skills', skill.id, 'SKILL.md'), skill.content);
  }
  const setup = buildTemplateSharedSetup(template, options.locale || 'zh-CN');
  writeAtomicFile(path.join(homeDir, BOT_SHARED_SETUP_JSON_FILE), `${JSON.stringify(setup, null, 2)}\n`);
  writeAtomicFile(path.join(homeDir, BOT_SHARED_SETUP_FILE), buildTemplateSetupNote(template, setup));

  const createdAutomationIds = [];
  for (const sched of setup.schedulesOff) {
    const saved = workStore.upsertAutomation({
      botId: bot.id,
      name: sched.name,
      prompt: sched.prompt,
      schedule: sched.rrule,
      timezone: sched.timezone ?? null,
      runsIn: 'new',
      resultsTo: sched.results || 'chat',
      enabled: false,
    });
    if (saved?.id) createdAutomationIds.push(saved.id);
  }
  return { setup, createdAutomationIds };
}

/**
 * Provision imported package files, MCP tools, structured `import/shared-setup.json` + readable
 * `shared-setup.md`, and paused schedules. Returns created automation IDs and structured setup object.
 * @param {string} homeDir
 * @param {string} metaRoot
 * @param {any} bot
 * @param {any} pkg
 * @param {any} workStore
 */
export function provisionPackageAssets(homeDir, metaRoot, bot, pkg, workStore) {
  const manifest = pkg.manifest;
  const files = pkg.files ?? {};
  const inventory = Object.keys(files).map((p) => ({ path: p, executable: false }));
  const plan = planBotFromPackage(manifest, inventory, {
    agent: 'deepseek-harness',
    toolIds: pkg.toolIds ?? manifest.tools.map((/** @type {any} */ t) => t.id),
  });
  for (const entry of plan.files) {
    const body = files[entry.from];
    if (typeof body !== 'string') continue;
    const targetRel = entry.to.replace(/^\.(?:claude|agents)\/skills\//u, 'skills/');
    writeHomeFile(homeDir, targetRel, body, { botId: bot.id });
  }
  if (plan.tools.length > 0) {
    writeBotToolsConfig(homeDir, metaRoot, bot.id, {
      servers: plan.tools.map((/** @type {any} */ t) => ({ name: t.name, transport: 'http', url: t.url })),
    });
  }
  const createdAutomationIds = [];
  for (const sched of plan.schedules) {
    const saved = workStore.upsertAutomation({
      botId: bot.id,
      name: sched.name,
      prompt: sched.prompt,
      schedule: sched.rrule,
      timezone: sched.timezone ?? null,
      runsIn: 'new',
      resultsTo: sched.results,
      enabled: false,
    });
    if (saved?.id) createdAutomationIds.push(saved.id);
  }
  const setup = buildPackageSharedSetup(manifest, plan);
  writeAtomicFile(path.join(homeDir, BOT_SHARED_SETUP_JSON_FILE), `${JSON.stringify(setup, null, 2)}\n`);
  if (plan.setupNote || setup.connectors.length > 0 || setup.toolsToSignIn.length > 0 || setup.eventsSuggested.length > 0 || setup.schedulesOff.length > 0) {
    writeAtomicFile(path.join(homeDir, BOT_SHARED_SETUP_FILE), buildPackageSetupNote(setup));
  }
  return { setup, createdAutomationIds };
}

/** @param {string} rootDir @param {string} targetDir */
function isStrictChildDir(rootDir, targetDir) {
  const resolvedRoot = path.resolve(rootDir);
  const resolvedTarget = path.resolve(targetDir);
  const a = process.platform === 'win32' ? resolvedRoot.toLowerCase() : resolvedRoot;
  const b = process.platform === 'win32' ? resolvedTarget.toLowerCase() : resolvedTarget;
  if (a === b) return false;
  const prefix = a.endsWith(path.sep) ? a : `${a}${path.sep}`;
  return b.startsWith(prefix);
}

/** @param {any} params */
function resolveTemplateForCreate(params) {
  const rawTemplateRef = params.fromTemplate ?? params.templateId ?? null;
  const templateId = typeof rawTemplateRef === 'string'
    ? rawTemplateRef
    : (rawTemplateRef?.templateId ?? null);
  const template = templateId ? botTemplate(templateId) : null;
  if (templateId && !template) {
    throw Object.assign(new Error(`Unknown bot template: ${templateId}`), { code: 'not_found' });
  }
  return template;
}

/** @param {any} ctx */
function rollbackCreatedBotAssets({ botsRoot, metaRoot, homeDir, botId, insertedBotId, createdAutomationIds, botsStore, workStore }) {
  for (const autoId of createdAutomationIds) {
    try { workStore?.deleteAutomation?.(autoId); } catch { /* Best-effort rollback. */ }
  }
  if (insertedBotId) {
    try { botsStore?.deleteBot?.(insertedBotId); } catch { /* Best-effort rollback. */ }
  }
  if (homeDir && isStrictChildDir(botsRoot, homeDir) && fs.existsSync(homeDir)) {
    try { fs.rmSync(homeDir, { recursive: true, force: true }); } catch { /* Best-effort rollback. */ }
  }
  const safeId = encodeURIComponent(botId);
  for (const metaSub of ['bot-credentials', 'linked-skills']) {
    const target = path.join(metaRoot, metaSub, safeId);
    if (isStrictChildDir(metaRoot, target) && fs.existsSync(target)) {
      try { fs.rmSync(target, { recursive: true, force: true }); } catch { /* Best-effort rollback. */ }
    }
  }
}

/**
 * Atomically create a bot from a template (or package/custom params) with automatic
 * rollback of half-created home directories, automations, tool credentials, and DB records
 * if any step fails.
 * @param {{
 *   botsRoot: string,
 *   metaRoot?: string,
 *   botsStore: any,
 *   workStore: any,
 *   sessionRuntime?: any,
 *   onBeforeCommit?: (ctx: { bot: any, homeDir: string, setup: any }) => void | Promise<void>,
 *   onAfterInsert?: (ctx: { bot: any, homeDir: string, setup: any }) => void | Promise<void>,
 *   now?: number,
 * }} deps
 * @param {any} [params]
 */
export async function createBotFromTemplateWithRollback(deps, params = {}) {
  const { botsRoot, metaRoot = path.join(botsRoot, '_meta'), botsStore, workStore, sessionRuntime } = deps;
  const now = typeof deps.now === 'number' && Number.isFinite(deps.now) ? deps.now : Date.now();
  const existing = botsStore.listBots();
  const template = resolveTemplateForCreate(params);

  const name = String(resolveNewBotName(params, template, existing));
  const { folder, homeDir } = reserveBotFolder(botsRoot, name, existing.map((/** @type {any} */ b) => b.folder));
  const botRecord = buildNewBotRecord({ params, name, folder, template, existing, now });

  /** @type {string[]} */
  const createdAutomationIds = [];
  let insertedBotId = null;
  let setup = null;

  try {
    initBotHome(homeDir, botRecord, { starterSoul: resolveInitialSoul(params, name, template) });
    if (template) {
      const selectedSkills = params.fromTemplate?.skills ?? params.selectedSkills ?? null;
      const res = provisionTemplateAssets(homeDir, botRecord, template, selectedSkills, workStore, { locale: params.locale || 'zh-CN' });
      setup = res.setup;
      createdAutomationIds.push(...res.createdAutomationIds);
    }
    if (params.fromPackage) {
      const res = provisionPackageAssets(homeDir, metaRoot, botRecord, params.fromPackage, workStore);
      setup = res.setup;
      createdAutomationIds.push(...res.createdAutomationIds);
    }
    if (typeof deps.onBeforeCommit === 'function') {
      await deps.onBeforeCommit({ bot: botRecord, homeDir, setup });
    }

    const saved = botsStore.insertBot(botRecord, now);
    insertedBotId = saved.id;
    if (typeof deps.onAfterInsert === 'function') {
      await deps.onAfterInsert({ bot: saved, homeDir, setup });
    }
    const opened = typeof sessionRuntime?.openHomeChat === 'function' ? await sessionRuntime.openHomeChat(saved.id) : null;
    return {
      bot: botsStore.getBot(saved.id) ?? saved,
      homeDir,
      setup,
      createdAutomationIds,
      sessionId: opened?.sessionId ?? null,
    };
  } catch (error) {
    rollbackCreatedBotAssets({
      botsRoot,
      metaRoot,
      homeDir,
      botId: botRecord.id,
      insertedBotId,
      createdAutomationIds,
      botsStore,
      workStore,
    });
    throw error;
  }
}

/** @param {any} params @param {any} template @param {any[]} existing */
export function resolveNewBotName(params, template, existing) {
  const requested = String(params.name ?? template?.name ?? params.fromPackage?.manifest?.name ?? '').trim();
  if (!requested) return newBotName('', existing);
  const check = validateBotName(requested, { existingBots: existing });
  if (!check.ok) throw Object.assign(new Error(check.reason), { code: check.code });
  return check.name;
}

/** @param {any} params @param {any} localized */
function buildTemplateSoulSeed(params, localized) {
  return {
    purpose: String(params.purpose ?? '').trim() || localized.summary || localized.line || '',
    watches: String(params.watches ?? '').trim() || localized.watches || '',
    does: String(params.does ?? '').trim() || localized.does || '',
    reports: String(params.reports ?? '').trim() || localized.reports || '',
  };
}

/** @param {any} params @param {string} name @param {any} template */
export function resolveInitialSoul(params, name, template) {
  if (typeof params.soul === 'string' && params.soul.trim()) return params.soul;
  if (params.fromPackage?.files?.['SOUL.md']) return params.fromPackage.files['SOUL.md'];
  const locale = params.locale || 'zh-CN';
  if (template) {
    const localized = localizeTemplate(template, locale) ?? template;
    return proposalSoul(name, buildTemplateSoulSeed(params, localized), { templateName: localized.name ?? template.name });
  }
  if (params.purpose || params.watches || params.does || params.reports) {
    return proposalSoul(name, params);
  }
  return starterSoul(name, locale);
}

/** @param {any} params @param {any} template @param {any[]} existing */
function pickInitialAvatar(params, template, existing) {
  if (params.avatar) return params.avatar;
  if (template?.mascot) return mascotAvatar(template.mascot);
  const pkgMascot = params.fromPackage?.manifest?.avatar?.mascot;
  if (pkgMascot) return mascotAvatar(pkgMascot);
  return randomMascotAvatar(existing.map((b) => b.avatar));
}

/** @param {{ params: any, name: string, folder: string, template: any, existing: any[], now: number }} args */
export function buildNewBotRecord({ params, name, folder, template, existing, now }) {
  return {
    id: crypto.randomUUID(),
    name,
    hostId: 'local',
    folder,
    agent: 'deepseek-harness',
    avatar: pickInitialAvatar(params, template, existing),
    avatarColor: params.avatarColor ? normalizeHexColor(params.avatarColor) : null,
    paused: false,
    ...(params.launch ? { launch: params.launch } : {}),
    ...(params.permissionMode ? { permissionMode: params.permissionMode } : {}),
    ...(typeof params.imDefault === 'boolean' ? { imDefault: params.imDefault } : {}),
    notifications: { ...DEFAULT_BOT_NOTIFICATIONS },
    members: [],
    skillProjects: Array.isArray(params.skillProjects)
      ? params.skillProjects.slice(0, BOT_LIMITS.maxSkillProjects)
      : [],
    chatSessionId: null,
    lookAround: { ...DEFAULT_LOOK_AROUND },
    tidyUp: { ...DEFAULT_TIDY_UP },
    itemsStale: 5,
    firstRun: true,
    ...(template ? { templateId: template.id } : {}),
    ...(params.importedFrom ? { importedFrom: params.importedFrom } : {}),
    createdAt: now,
    updatedAt: now,
  };
}

/** @param {any[]} currentMembers @param {any} patch */
export function mergeMembersPatch(currentMembers, patch) {
  let list = Array.isArray(patch.members) ? [...patch.members] : [...(currentMembers ?? [])];
  if (Array.isArray(patch.addMembers)) {
    for (const member of patch.addMembers) {
      if (!member?.id) continue;
      if (list.some((m) => m.id === member.id && (m.source ?? null) === (member.source ?? null))) continue;
      if (list.length < BOT_LIMITS.maxMembers) list.push(member);
    }
  }
  const toRemove = patch.removeMembers ?? (patch.removeMember ? [patch.removeMember] : null);
  if (Array.isArray(toRemove)) {
    const removeSet = new Set(toRemove.map((r) => (typeof r === 'string' ? r : r?.id)));
    list = list.filter((m) => !removeSet.has(m.id));
  }
  return list.slice(0, BOT_LIMITS.maxMembers);
}

/** @param {any} existing @param {any} patch @param {number} now */
export function applyBotFieldPatch(existing, patch, now) {
  const next = { ...existing };
  for (const key of ['avatar', 'paused', 'permissionMode', 'launch', 'itemsStale', 'sidebarOrder', 'connectors', 'imDefault', 'firstRun']) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) next[key] = patch[key];
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'avatarColor')) {
    next.avatarColor = patch.avatarColor ? normalizeHexColor(patch.avatarColor) : null;
  }
  if (patch.notifications && typeof patch.notifications === 'object') {
    next.notifications = { ...DEFAULT_BOT_NOTIFICATIONS, ...(existing.notifications ?? {}), ...patch.notifications };
  }
  if (patch.lookAround && typeof patch.lookAround === 'object') {
    next.lookAround = patchLookAround(existing.lookAround ?? DEFAULT_LOOK_AROUND, patch.lookAround, now);
  }
  if (patch.tidyUp && typeof patch.tidyUp === 'object') {
    next.tidyUp = patchTidyUp(existing.tidyUp ?? DEFAULT_TIDY_UP, patch.tidyUp, now);
  }
  if (patch.members || patch.addMembers || patch.removeMember || patch.removeMembers) {
    next.members = mergeMembersPatch(existing.members, patch);
  }
  if (Array.isArray(patch.skillProjects)) {
    next.skillProjects = [...new Set(patch.skillProjects.map(String).filter(Boolean))].slice(0, BOT_LIMITS.maxSkillProjects);
  }
  return next;
}

/** @param {string} projectRoot */
export function scanProjectSkillDirs(projectRoot) {
  const candidates = [
    path.join(projectRoot, 'skills'),
    path.join(projectRoot, '.claude', 'skills'),
    path.join(projectRoot, '.agents', 'skills'),
  ];
  const skills = [];
  const seen = new Set();
  for (const root of candidates) {
    if (!fs.existsSync(root)) continue;
    try {
      for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory() || seen.has(entry.name)) continue;
        if (!fs.existsSync(path.join(root, entry.name, 'SKILL.md'))) continue;
        seen.add(entry.name);
        skills.push({ name: entry.name, dir: path.join(root, entry.name) });
      }
    } catch {
      // Ignore unreadable project directory.
    }
  }
  return skills;
}
