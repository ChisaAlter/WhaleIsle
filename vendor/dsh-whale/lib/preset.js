/**
 * Self-provisioning of the `whale-girl` agent preset and the whale home
 * directory so a packaged desktop runtime needs no manual install step.
 *
 * Two artifacts under $DSH_HOME:
 *   .agent-presets/whale-girl/   the agent-plane composition (refreshed
 *                                byte-for-byte on upgrades; the
 *                                `__WHALE_SKILLS_DIR__` placeholder is
 *                                substituted with the absolute home path)
 *   data/whale/                  her "home": AGENTS.md + MEMORY.md +
 *                                skills/ + skills-disabled/ + pet-outbox.jsonl
 *                                + watches.json + schedules.json + stickers/
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const WHALE_PRESET_ID = 'whale-girl';
export const WHALE_PRESET_COMPOSITION = 'agent.cordis.yml';
export const SKILLS_DIR_PLACEHOLDER = '__WHALE_SKILLS_DIR__';

export function whalePresetSourceDir() {
  return fileURLToPath(new URL(`../presets/${WHALE_PRESET_ID}/`, import.meta.url));
}

export function whalePresetDestDir(homeDir) {
  return path.join(homeDir, '.agent-presets', WHALE_PRESET_ID);
}

export function whaleHomeDir(homeDir) {
  return path.join(homeDir, 'data', 'whale');
}

export function whaleSkillsDir(homeDir) {
  return path.join(whaleHomeDir(homeDir), 'skills');
}

/** Current Harness registers presets explicitly; it no longer scans `.agent-presets`. */
export function whalePresetDefinition(homeDir) {
  return {
    id: WHALE_PRESET_ID,
    name: '鲸鱼娘助理',
    description: '桌面鲸鱼娘助理会话用的内置预设',
    order: 90,
    // Internal preset: usable by her own session and IM by id, never a
    // user-selectable mode in the new-task roster.
    hidden: true,
    plugins: [
      { id: 'persona', name: '@deepseek-ai/dsh-persona', config: { includeRuntimeContext: false, prefix: '' } },
      { id: 'agent-instructions', name: '@deepseek-ai/dsh-agent-instructions', config: { maxBytes: 65536 } },
      { id: 'tool-fs', name: '@deepseek-ai/dsh-tool-fs' },
      { id: 'tool-fs-search', name: '@deepseek-ai/dsh-tool-fs-search', config: { sampleOverCapGlobResults: false } },
      { id: 'skill-filesystem', name: '@deepseek-ai/dsh-skill-filesystem', config: { includeDefaultRoots: false, customSkillDirs: [whaleSkillsDir(homeDir)] } },
      { id: 'tool-skill', name: '@deepseek-ai/dsh-tool-skill' },
      { id: 'tool-ask-user', name: '@deepseek-ai/dsh-tool-ask-user' },
      { id: 'whale-tools', name: 'dsh-whale/tools' },
    ],
  };
}

export function whaleDisabledSkillsDir(homeDir) {
  return path.join(whaleHomeDir(homeDir), 'skills-disabled');
}

export function whaleOutboxFile(homeDir) {
  return path.join(whaleHomeDir(homeDir), 'pet-outbox.jsonl');
}

export function whaleStickersDir(homeDir) {
  return path.join(whaleHomeDir(homeDir), 'stickers');
}

const AGENTS_MD = `# 鲸鱼娘的家

这个目录是鲸鱼娘助理的长期住所。

- \`MEMORY.md\` —— 长期记忆：重要的用户偏好、决定、约定。读它、更新它。
- \`skills/\` —— 启用的技能（每个子目录一个 SKILL.md）。
- \`skills-disabled/\` —— 被用户关闭的技能（不加载）。
- \`pet-outbox.jsonl\` —— 写给桌面桌宠的留言队列（whale_pet_say / whale_notify 追加到这里）。
- \`stickers/\` —— 你自己的表情包库：把图片文件丢进来，whale_sticker 就会抽到它们（文件名即表情名）。
- \`usage-today.json\` —— 桌面端镜像的当日用量快照（whale_usage_today 读它，别手写）。
- \`watches.json\` —— 盯梢清单（whale_watch 维护，会话回合结束时唤醒她）。
- \`schedules.json\` —— 定时任务（whale_schedule 维护，到点把文本作为提示词唤醒她）。
`;

const MEMORY_MD = `# 鲸鱼娘的长期记忆

（还没有记住什么。值得记住的事就写在这里——用户偏好、重要的决定、约定。）
`;

const OUTBOX_LOCK_NOTE = '';

/**
 * Copy the preset into the harness home, refreshing byte-different files so
 * plugin upgrades propagate. `customSkillDirs` must hold an absolute path, so
 * the composition body gets the skills dir substituted in before comparing.
 */
export function ensureWhalePreset(homeDir, sourceDir = whalePresetSourceDir()) {
  if (!homeDir) return { ok: false, error: 'missing-home' };
  if (!fs.existsSync(path.join(sourceDir, WHALE_PRESET_COMPOSITION))) {
    return { ok: false, error: 'missing-source:preset' };
  }
  const destDir = whalePresetDestDir(homeDir);
  fs.mkdirSync(destDir, { recursive: true });
  const skillsDir = whaleSkillsDir(homeDir).replace(/\\/g, '/');
  let changed = false;
  for (const name of fs.readdirSync(sourceDir)) {
    const from = path.join(sourceDir, name);
    if (!fs.statSync(from).isFile()) continue;
    let body = fs.readFileSync(from, 'utf8');
    if (name === WHALE_PRESET_COMPOSITION) {
      body = body.split(SKILLS_DIR_PLACEHOLDER).join(skillsDir);
    }
    const to = path.join(destDir, name);
    if (fs.existsSync(to) && fs.readFileSync(to, 'utf8') === body) continue;
    const tmp = `${to}.tmp`;
    fs.writeFileSync(tmp, body, 'utf8');
    fs.renameSync(tmp, to);
    changed = true;
  }
  return { ok: true, destDir, changed };
}

/**
 * Create the whale home with seed files. Existing user files are never
 * overwritten — only missing ones are created.
 */
export function ensureWhaleHome(homeDir) {
  if (!homeDir) return { ok: false, error: 'missing-home' };
  const dir = whaleHomeDir(homeDir);
  fs.mkdirSync(whaleSkillsDir(homeDir), { recursive: true });
  fs.mkdirSync(whaleDisabledSkillsDir(homeDir), { recursive: true });
  fs.mkdirSync(whaleStickersDir(homeDir), { recursive: true });
  for (const [file, body] of [
    ['AGENTS.md', AGENTS_MD],
    ['MEMORY.md', MEMORY_MD],
  ]) {
    const target = path.join(dir, file);
    if (!fs.existsSync(target)) fs.writeFileSync(target, body, 'utf8');
  }
  const outbox = whaleOutboxFile(homeDir);
  if (!fs.existsSync(outbox)) fs.writeFileSync(outbox, OUTBOX_LOCK_NOTE, 'utf8');
  return { ok: true, dir };
}

/** List skills currently visible to the assistant (skills/ subdirs). */
export function listWhaleSkills(homeDir) {
  const list = (dir, enabled) => {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(dir, entry.name, 'SKILL.md')))
      .map((entry) => ({ name: entry.name, enabled }));
  };
  return [
    ...list(whaleSkillsDir(homeDir), true),
    ...list(whaleDisabledSkillsDir(homeDir), false),
  ].sort((a, b) => a.name.localeCompare(b.name));
}

/** Toggle a skill by moving its directory between skills/ and skills-disabled/. */
export function setWhaleSkillEnabled(homeDir, skillName, enabled) {
  const name = String(skillName ?? '').trim();
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(name)) return { ok: false, error: 'invalid-skill-name' };
  const from = enabled ? whaleDisabledSkillsDir(homeDir) : whaleSkillsDir(homeDir);
  const to = enabled ? whaleSkillsDir(homeDir) : whaleDisabledSkillsDir(homeDir);
  const src = path.join(from, name);
  const dst = path.join(to, name);
  if (!fs.existsSync(src)) {
    return fs.existsSync(dst) ? { ok: true, changed: false } : { ok: false, error: 'skill-not-found' };
  }
  fs.mkdirSync(to, { recursive: true });
  fs.renameSync(src, dst);
  return { ok: true, changed: true };
}

/**
 * Append one line to the pet outbox (plugin → desktop pet one-way bridge).
 * The desktop watcher tails this file and bubbles `text` on the Live2D pet.
 * `extra` merges extra fields into the line (sticker lines carry `path`).
 */
export function appendPetOutbox(homeDir, kind, text, extra) {
  const file = whaleOutboxFile(homeDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const line = JSON.stringify({
    kind: String(kind ?? 'say').slice(0, 32),
    text: String(text ?? '').slice(0, 512),
    ...(extra && typeof extra === 'object' ? extra : {}),
    at: Date.now(),
  });
  fs.appendFileSync(file, line + '\n', 'utf8');
}
