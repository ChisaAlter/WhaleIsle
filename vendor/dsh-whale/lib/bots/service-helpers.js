/**
 * Pure & filesystem provisioning helpers for `service.js` (template assets,
 * package assets, new bot record builder, member/field patching, skill scan).
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
  writeAtomicFile,
  writeBotToolsConfig,
  writeHomeFile,
} from './fs-home.js';

/** @param {string} rawBase64 */
export function decodePngBase64(rawBase64) {
  const str = String(rawBase64 ?? '').trim();
  const stripped = str.startsWith('data:') ? str.slice(str.indexOf(',') + 1) : str;
  if (!stripped) throw new BotFsError('invalid_avatar', 'Avatar base64 payload is empty');
  return Buffer.from(stripped, 'base64');
}

/** @param {any} template */
function buildTemplateSetupNote(template) {
  const lines = [
    `# Setup notes for ${template.name}`,
    '',
    `Template: ${template.name} (${template.category})`,
    template.line ? `Summary: ${template.line}` : '',
    template.watches ? `- Watches: ${template.watches}` : '',
    template.does ? `- Does: ${template.does}` : '',
    template.reports ? `- Reports: ${template.reports}` : '',
  ].filter(Boolean);
  return `${lines.join('\n')}\n`;
}

/** @param {string} homeDir @param {any} bot @param {any} template @param {string[] | null} selectedSkills @param {any} workStore */
export function provisionTemplateAssets(homeDir, bot, template, selectedSkills, workStore) {
  for (const skill of resolveTemplateSkillFiles(template, selectedSkills)) {
    writeAtomicFile(path.join(homeDir, 'skills', skill.id, 'SKILL.md'), skill.content);
  }
  writeAtomicFile(path.join(homeDir, BOT_SHARED_SETUP_FILE), buildTemplateSetupNote(template));
  for (const sched of Array.isArray(template.schedules) ? template.schedules : []) {
    workStore.upsertAutomation({
      botId: bot.id,
      name: sched.name || `${template.name} schedule`,
      prompt: sched.prompt || template.does || 'Check for updates.',
      schedule: sched.rrule || sched.schedule || null,
      runsIn: 'new',
      resultsTo: sched.results || 'chat',
      enabled: false,
    });
  }
}

/** @param {string} homeDir @param {string} metaRoot @param {any} bot @param {any} pkg @param {any} workStore */
export function provisionPackageAssets(homeDir, metaRoot, bot, pkg, workStore) {
  const manifest = pkg.manifest;
  const files = pkg.files ?? {};
  const inventory = Object.keys(files).map((p) => ({ path: p, executable: false }));
  const plan = planBotFromPackage(manifest, inventory, {
    agent: 'deepseek-harness',
    toolIds: pkg.toolIds ?? manifest.tools.map((t) => t.id),
  });
  for (const entry of plan.files) {
    const body = files[entry.from];
    if (typeof body !== 'string') continue;
    const targetRel = entry.to.replace(/^\.(?:claude|agents)\/skills\//u, 'skills/');
    writeHomeFile(homeDir, targetRel, body, { botId: bot.id });
  }
  if (plan.tools.length > 0) {
    writeBotToolsConfig(homeDir, metaRoot, bot.id, {
      servers: plan.tools.map((t) => ({ name: t.name, transport: 'http', url: t.url })),
    });
  }
  for (const sched of plan.schedules) {
    workStore.upsertAutomation({
      botId: bot.id,
      name: sched.name,
      prompt: sched.prompt,
      schedule: sched.rrule,
      timezone: sched.timezone ?? null,
      runsIn: 'new',
      resultsTo: sched.results,
      enabled: false,
    });
  }
  if (plan.setupNote) {
    writeAtomicFile(path.join(homeDir, BOT_SHARED_SETUP_FILE), `${plan.setupNote}\n`);
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
