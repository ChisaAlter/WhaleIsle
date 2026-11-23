// Built-in skills shipped with bot templates, written into each bot's home folder.
import { BOT_BUILTIN_SKILLS_PART_A } from './bot-builtin-skills-a.js';
import { BOT_BUILTIN_SKILLS_PART_B } from './bot-builtin-skills-b.js';

export const BOT_BUILTIN_SKILL_IDS = Object.freeze([
  'pr-review-checklist',
  'bug-reproduction',
  'ci-failure-triage',
  'release-readiness',
  'release-notes-style',
  'dependency-upgrade',
  'security-checklist',
  'issue-triage',
  'feedback-themes',
  'status-brief',
  'spec-format',
  'incident-timeline',
  'workspace-hygiene',
]);

export const BOT_BUILTIN_SKILLS = Object.freeze({
  ...BOT_BUILTIN_SKILLS_PART_A,
  ...BOT_BUILTIN_SKILLS_PART_B,
});

export function isBuiltinSkillId(id) {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(BOT_BUILTIN_SKILLS, id);
}

export function getBuiltinSkill(id) {
  return isBuiltinSkillId(id) ? BOT_BUILTIN_SKILLS[id] : null;
}

export function listBuiltinSkills() {
  return BOT_BUILTIN_SKILL_IDS.map((id) => ({
    id,
    content: BOT_BUILTIN_SKILLS[id],
  }));
}
