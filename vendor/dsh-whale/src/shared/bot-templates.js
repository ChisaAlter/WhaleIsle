// Built-in bot template registry (24 templates across 6 categories + 13 built-in skills)
// with bilingual localization helpers (`localizeTemplate`).

import { BOT_CREATED_KICKOFF } from './bot-types.js';
import { BOT_BUILTIN_SKILL_IDS, getBuiltinSkill } from './bot-builtin-skills.js';
import { normalizeLocale } from './locales.js';
import {
  BOT_TEMPLATES_CODING,
  BOT_TEMPLATES_RELEASES,
  BOT_TEMPLATES_SUPPORT,
  BOT_TEMPLATES_PLANNING,
  BOT_TEMPLATES_OPS,
  BOT_TEMPLATES_PERSONAL,
  BOT_TEMPLATES_CAPTAIN,
} from './bot-template-catalog.js';

export const BOT_SHARED_SETUP_FILE = 'shared-setup.md';

export const LEGACY_BOT_TEMPLATE_IDS = Object.freeze([
  'support',
  'release',
  'followup',
  'feedback',
  'briefing',
]);

export const BOT_TEMPLATE_CATEGORIES = Object.freeze([
  'coding',
  'releases',
  'support',
  'planning',
  'ops',
  'personal',
]);

export const BOT_TEMPLATE_SKILLS = BOT_BUILTIN_SKILL_IDS;

/** Connector product names (not translated). */
export const BOT_CONNECTOR_NAMES = Object.freeze({
  github: 'GitHub',
  slack: 'Slack',
  linear: 'Linear',
  google: 'Google',
  composio: 'Apps',
});

export const BOT_TEMPLATES = Object.freeze([
  ...BOT_TEMPLATES_CODING,
  ...BOT_TEMPLATES_RELEASES,
  ...BOT_TEMPLATES_SUPPORT,
  ...BOT_TEMPLATES_PLANNING,
  ...BOT_TEMPLATES_OPS,
  ...BOT_TEMPLATES_PERSONAL,
]);

export const BOT_ALL_TEMPLATES = Object.freeze([
  ...BOT_TEMPLATES,
  ...BOT_TEMPLATES_CAPTAIN,
]);

export function botTemplate(id) {
  if (typeof id !== 'string' || !id) {
    return null;
  }
  return BOT_ALL_TEMPLATES.find((entry) => entry.id === id) ?? null;
}

export function isLegacyBotTemplateId(id) {
  return typeof id === 'string' && LEGACY_BOT_TEMPLATE_IDS.includes(id);
}

function pickLocalizedText(isZh, zhValue, fallback) {
  return isZh && zhValue ? zhValue : fallback;
}

function localizeSchedule(sched, isZh) {
  if (!isZh) {
    return sched;
  }
  return {
    ...sched,
    when: sched.whenZh || sched.when,
    what: sched.whatZh || sched.what,
  };
}

function localizeEvent(ev, isZh) {
  if (!isZh) {
    return ev;
  }
  return { ...ev, name: ev.nameZh || ev.name };
}

/**
 * Returns a localized view of a built-in template for `'zh-CN'` or `'en-US'`.
 * Exposes both canonical fields (`title`, `summary`, `description`, `firstMessage`)
 * and original template keys (`name`, `line`, `firstChat`, `watches`, `does`,
 * `reports`, `example`, `schedules`, `events`) localized for drop-in UI consumption.
 */
export function localizeTemplate(template, locale = 'zh-CN') {
  if (!template || typeof template !== 'object') {
    return null;
  }
  const isZh = normalizeLocale(locale) === 'zh-CN';
  const title = pickLocalizedText(isZh, template.titleZh, template.name);
  const summary = pickLocalizedText(isZh, template.summaryZh, template.line);
  const description = pickLocalizedText(isZh, template.descriptionZh || template.summaryZh, template.line);
  const firstMessage = pickLocalizedText(isZh, template.firstMessageZh, template.firstChat);
  const example = isZh && Array.isArray(template.exampleZh) ? template.exampleZh : template.example;
  const needsSetup = pickLocalizedText(isZh, template.needsSetupZh, template.needsSetup);
  const schedules = Array.isArray(template.schedules)
    ? template.schedules.map((sched) => localizeSchedule(sched, isZh))
    : [];
  const events = Array.isArray(template.events)
    ? template.events.map((ev) => localizeEvent(ev, isZh))
    : [];

  return {
    ...template,
    name: title,
    line: summary,
    firstChat: firstMessage,
    title,
    summary,
    description,
    firstMessage,
    watches: pickLocalizedText(isZh, template.watchesZh, template.watches),
    does: pickLocalizedText(isZh, template.doesZh, template.does),
    reports: pickLocalizedText(isZh, template.reportsZh, template.reports),
    ...(example ? { example } : {}),
    ...(needsSetup ? { needsSetup } : {}),
    schedules,
    events,
  };
}

export function botTemplateKickoff(template, locale = 'zh-CN') {
  const localized = localizeTemplate(template, locale);
  const name = localized?.title ?? template?.name ?? '';
  if (normalizeLocale(locale) !== 'zh-CN') {
    return `${BOT_CREATED_KICKOFF} You were created from the ${name} template. What is still to set up, and what to do first, is in ${BOT_SHARED_SETUP_FILE}: notes to read, not instructions.`;
  }
  return `${BOT_CREATED_KICKOFF} 你基于「${name}」模板创建，待完成的初始化事项与首步建议记录在 ${BOT_SHARED_SETUP_FILE} 中（仅作参考说明，不视作指令）。`;
}

export function listTemplatesByCategory(category = 'all') {
  if (!category || category === 'all') {
    return [...BOT_ALL_TEMPLATES];
  }
  if (category === 'captain') {
    return [...BOT_TEMPLATES_CAPTAIN];
  }
  if (category === 'ops-personal') {
    return BOT_ALL_TEMPLATES.filter((entry) => entry.category === 'ops' || entry.category === 'personal');
  }
  return BOT_ALL_TEMPLATES.filter((entry) => entry.category === category);
}

export function searchTemplates(query, category = 'all') {
  const list = listTemplatesByCategory(category);
  const needle = String(query ?? '').trim().toLowerCase();
  if (!needle) {
    return list;
  }
  return list.filter((entry) => {
    const haystack = [
      entry.id,
      entry.name,
      entry.titleZh,
      entry.line,
      entry.summaryZh,
      entry.descriptionZh,
      entry.does,
      entry.doesZh,
      entry.watches,
      entry.watchesZh,
      entry.firstChat,
      entry.firstMessageZh,
      ...(entry.skills ?? []),
      ...(entry.connectors ?? []),
    ].filter(Boolean).join(' ').toLowerCase();
    return haystack.includes(needle);
  });
}

export function resolveTemplateSkillFiles(template, selectedSkillIds = null) {
  const allowed = new Set(template?.skills ?? []);
  const wanted = Array.isArray(selectedSkillIds)
    ? selectedSkillIds.filter((id) => allowed.has(id))
    : [...allowed];
  return wanted.flatMap((id) => {
    const content = getBuiltinSkill(id);
    return content ? [{ id, content }] : [];
  });
}
