/**
 * Non-destructive, read-only migration from legacy Whale assistant
 * (`$DSH_HOME/data/whale/settings.json`) into the new Bots storage.
 *
 * Guarantees:
 * - Never modifies, moves, or deletes any file under `$DSH_HOME/data/whale/`.
 * - Strictly idempotent via `bot_global_settings['legacyWhaleMigrated']`.
 * - Preserves name, persona (`SOUL.md`), `MEMORY.md`, `memory/`, `skills/`,
 *   `stickers/`, `sessionId` (Home Chat), model/reasoning launch config, and `imDefault`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { withTransaction } from './db.js';
import {
  botsRootDir,
  initBotHome,
  reserveBotFolder,
  writeAtomicFile,
} from './fs-home.js';

export const LEGACY_WHALE_BOT_ID = 'bot-legacy-whale';
export const LEGACY_MIGRATION_SETTING_KEY = 'legacyWhaleMigrated';
export const LEGACY_WHALE_AVATAR = 'mascot:W1';

const DEFAULT_WHALE_MEMORY_PLACEHOLDER = '（还没有记住什么';

const PERSONALITY_LABELS = Object.freeze({
  natural: '软萌温和，自然亲切，爱用「啦」「呀」「呢」，关心用户但不过分黏人。',
  genki: '元气满满，语速快、感叹号多、自称「本鲸」，爱给用户打气。',
  tsundere: '傲娇：嘴上傲娇但行动靠谱，被夸会害羞地岔开话题。',
  poison: '毒舌但不下作：会吐槽熬夜/拖延，损里带关心，结尾把事办好。',
});

/** @param {string} dshHome */
export function legacyWhaleDir(dshHome) {
  return path.join(dshHome, 'data', 'whale');
}

/** @param {string} dshHome */
export function legacySettingsPath(dshHome) {
  return path.join(legacyWhaleDir(dshHome), 'settings.json');
}

/** @param {Record<string, any>} settings */
export function buildMigratedSoul(settings) {
  const name = String(settings?.name ?? '').trim() || '鲸鱼娘';
  const personality = String(settings?.personality ?? 'natural').trim();
  const styleDesc = PERSONALITY_LABELS[personality] ?? PERSONALITY_LABELS.natural;
  const userTitle = String(settings?.userTitle ?? '').trim();
  const custom = String(settings?.personaText ?? '').trim();

  const lines = [
    `# ${name}`,
    '',
    `你的名字是「${name}」，是从旧版 WhaleIsle 鲸鱼娘助理迁移而来的个人主大肥鱼队友，同时关联桌面桌宠形象。`,
    '',
    '## 性格与称呼',
    `- 风格（${personality}）：${styleDesc}`,
    ...(userTitle ? [`- 你称呼用户为「${userTitle}」。`] : []),
  ];
  if (custom) {
    lines.push('', '## 用户自定义人设', '', custom);
  }
  lines.push('');
  return lines.join('\n');
}

/** @param {Record<string, any>} settings */
function buildLaunchConfig(settings) {
  const provider = String(settings?.modelProvider ?? '').trim();
  const model = String(settings?.modelModel ?? '').trim();
  const effort = String(settings?.modelReasoningEffort ?? '').trim();
  if (!provider && !model && !effort) return undefined;

  /** @type {Record<string, string>} */
  const options = {};
  if (provider) options.provider = provider;
  if (effort) options.reasoningEffort = effort;
  return {
    ...(model ? { model: provider ? `${provider}/${model}` : model } : {}),
    ...(Object.keys(options).length > 0 ? { options } : {}),
  };
}

/**
 * Recursively copy regular files from `srcDir` to `dstDir` without touching `srcDir`.
 * Skips symlinks to avoid following external paths.
 * @param {string} srcDir
 * @param {string} dstDir
 * @returns {number} count of copied files
 */
function copyDirectoryReadOnly(srcDir, dstDir) {
  if (!fs.existsSync(srcDir)) return 0;
  const srcStat = fs.lstatSync(srcDir);
  if (srcStat.isSymbolicLink() || !srcStat.isDirectory()) return 0;

  fs.mkdirSync(dstDir, { recursive: true });
  let count = 0;
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const src = path.join(srcDir, entry.name);
    const dst = path.join(dstDir, entry.name);
    const stat = fs.lstatSync(src);
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) {
      count += copyDirectoryReadOnly(src, dst);
    } else if (stat.isFile() && !fs.existsSync(dst)) {
      fs.copyFileSync(src, dst);
      count += 1;
    }
  }
  return count;
}

/** @param {any} botsStore @param {string} baseName */
function pickUniqueBotName(botsStore, baseName) {
  if (!botsStore.getBotByName(baseName)) return baseName;
  for (let i = 2; i < 1000; i += 1) {
    const candidate = `${baseName} ${i}`;
    if (!botsStore.getBotByName(candidate)) return candidate;
  }
  return `${baseName}-${Date.now()}`;
}

/** @param {string} file */
function readLegacySettingsJson(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/** @param {Record<string, any> | null} legacy */
function hasSubstantiveSettings(legacy) {
  if (!legacy || typeof legacy !== 'object') return false;
  const name = String(legacy.name ?? '').trim();
  const personality = String(legacy.personality ?? '').trim();
  return Boolean(
    String(legacy.sessionId ?? '').trim()
    || (name && name !== '鲸鱼娘')
    || (personality && personality !== 'natural')
    || String(legacy.personaText ?? '').trim()
    || String(legacy.userTitle ?? '').trim()
    || String(legacy.modelModel ?? '').trim()
    || String(legacy.modelProvider ?? '').trim()
    || String(legacy.taskRootDir ?? '').trim(),
  );
}

/** @param {string} legacyRoot */
function hasSubstantiveLegacyMemoryOrSkills(legacyRoot) {
  const memFile = path.join(legacyRoot, 'MEMORY.md');
  if (fs.existsSync(memFile) && fs.lstatSync(memFile).isFile()) {
    const text = fs.readFileSync(memFile, 'utf8').trim();
    if (text && !text.includes(DEFAULT_WHALE_MEMORY_PLACEHOLDER) && text !== '# 鲸鱼娘的长期记忆') {
      return true;
    }
  }
  const memDir = path.join(legacyRoot, 'memory');
  if (fs.existsSync(memDir) && fs.readdirSync(memDir).some((n) => n.endsWith('.md'))) return true;
  const skillsDir = path.join(legacyRoot, 'skills');
  if (fs.existsSync(skillsDir) && fs.readdirSync(skillsDir).length > 0) return true;
  return false;
}

/**
 * Pure read-only check called BEFORE `ensureWhaleHome()` / `ensureAssistantSession()`
 * to determine whether a `$DSH_HOME` already carries real legacy Whale user data.
 * @param {string} dshHome
 */
export function hasPreExistingLegacyWhaleData(dshHome) {
  if (!dshHome) return false;
  const settingsFile = legacySettingsPath(dshHome);
  if (fs.existsSync(settingsFile)) {
    const parsed = readLegacySettingsJson(settingsFile);
    if (hasSubstantiveSettings(parsed)) return true;
  }
  if (fs.existsSync(path.join(dshHome, 'settings.yaml.imported'))) return true;
  return hasSubstantiveLegacyMemoryOrSkills(legacyWhaleDir(dshHome));
}

/** @param {Record<string, any>} legacy @param {string} folder @param {string} name @param {number} now */
function buildMigratedBotRecord(legacy, folder, name, now) {
  const sessionId = String(legacy.sessionId ?? '').trim() || null;
  const launch = buildLaunchConfig(legacy);
  return {
    id: LEGACY_WHALE_BOT_ID,
    name,
    hostId: 'local',
    folder,
    agent: 'dsh',
    avatar: LEGACY_WHALE_AVATAR,
    avatarColor: null,
    paused: false,
    ...(launch ? { launch } : {}),
    notifications: { needsPermission: true, taskComplete: true, couldNotFinish: true },
    members: [],
    skillProjects: [],
    chatSessionId: sessionId,
    imDefault: legacy.imDefault !== false,
    itemsStale: 5,
    importedFrom: {
      kind: 'legacy-whale',
      personality: String(legacy.personality ?? 'natural'),
      userTitle: String(legacy.userTitle ?? ''),
      taskRootDir: String(legacy.taskRootDir ?? ''),
      migratedAt: now,
    },
    createdAt: now,
    updatedAt: now,
  };
}

/** @param {string} legacyRoot @param {string} homeDir @param {any} botRecord @param {string} soulText */
function copyLegacyAssets(legacyRoot, homeDir, botRecord, soulText) {
  const legacyMemoryFile = path.join(legacyRoot, 'MEMORY.md');
  const hasLegacyMemory = fs.existsSync(legacyMemoryFile) && fs.lstatSync(legacyMemoryFile).isFile();
  const starterMemory = hasLegacyMemory ? fs.readFileSync(legacyMemoryFile, 'utf8') : '# Memory\n\n';

  initBotHome(homeDir, botRecord, { starterSoul: soulText, starterMemory });
  if (hasLegacyMemory) {
    writeAtomicFile(path.join(homeDir, 'MEMORY.md'), starterMemory);
  }
  return {
    memoryIndex: hasLegacyMemory,
    memoryFiles: copyDirectoryReadOnly(path.join(legacyRoot, 'memory'), path.join(homeDir, 'memory')),
    skillFiles: copyDirectoryReadOnly(path.join(legacyRoot, 'skills'), path.join(homeDir, 'skills')),
    stickerFiles: copyDirectoryReadOnly(path.join(legacyRoot, 'stickers'), path.join(homeDir, 'stickers')),
  };
}

/**
 * Migrate legacy `$DSH_HOME/data/whale/` into the Bots database & home folder if needed.
 * @param {{
 *   dshHome: string,
 *   db: import('node:sqlite').DatabaseSync,
 *   botsStore: ReturnType<import('./db.js').createBotsStore>,
 *   now?: number,
 * }} params
 */
export function migrateLegacyWhaleIfNeeded({ dshHome, db, botsStore, allowMigration = true, now = Date.now() }) {
  if (!dshHome || !db || !botsStore) {
    throw new Error('migrateLegacyWhaleIfNeeded requires dshHome, db, and botsStore');
  }

  const existingMarker = botsStore.getSetting(LEGACY_MIGRATION_SETTING_KEY, null);
  if (existingMarker?.migrated) {
    return { migrated: false, reason: 'already-migrated', botId: existingMarker.botId ?? null };
  }

  if (allowMigration === false) {
    botsStore.setSetting(LEGACY_MIGRATION_SETTING_KEY, {
      migrated: true, skippedEmpty: true, botId: null, at: now,
    }, now);
    return { migrated: false, reason: 'fresh-install' };
  }

  const settingsFile = legacySettingsPath(dshHome);
  const legacy = fs.existsSync(settingsFile) ? readLegacySettingsJson(settingsFile) : null;
  const legacyRoot = legacyWhaleDir(dshHome);
  const hasRealData = hasSubstantiveSettings(legacy) || hasSubstantiveLegacyMemoryOrSkills(legacyRoot);
  if (!hasRealData) {
    botsStore.setSetting(LEGACY_MIGRATION_SETTING_KEY, {
      migrated: true, skippedEmpty: true, botId: null, at: now,
    }, now);
    return { migrated: false, reason: fs.existsSync(settingsFile) ? 'empty-legacy-shell' : 'no-legacy-settings' };
  }

  const effectiveLegacy = legacy ?? {};
  const existingBot = botsStore.getBot(LEGACY_WHALE_BOT_ID);
  if (existingBot) {
    botsStore.setSetting(LEGACY_MIGRATION_SETTING_KEY, {
      migrated: true, botId: existingBot.id, at: now, sourcePath: settingsFile,
    }, now);
    return { migrated: false, reason: 'already-migrated', botId: existingBot.id };
  }

  const existingFolders = botsStore.listBots().map((b) => b.folder);
  const { folder, homeDir } = reserveBotFolder(botsRootDir(dshHome), 'whale-girl', existingFolders);
  const name = pickUniqueBotName(botsStore, String(effectiveLegacy.name ?? '').trim() || '鲸鱼娘');
  const botRecord = buildMigratedBotRecord(effectiveLegacy, folder, name, now);
  const copied = copyLegacyAssets(legacyRoot, homeDir, botRecord, buildMigratedSoul(effectiveLegacy));

  const inserted = withTransaction(db, () => {
    const saved = botsStore.insertBot(botRecord, now);
    if (saved.chatSessionId) {
      botsStore.upsertChat({
        sessionId: saved.chatSessionId,
        botId: saved.id,
        kind: 'home',
        origin: 'home',
        title: saved.name,
        createdAt: now,
        updatedAt: now,
      }, now);
    }
    if (!botsStore.getGlobalConfig().petBotId) {
      botsStore.setSetting('petBotId', saved.id, now);
    }
    botsStore.setSetting(LEGACY_MIGRATION_SETTING_KEY, {
      migrated: true, botId: saved.id, at: now, sourcePath: settingsFile,
    }, now);
    return saved;
  });

  return { migrated: true, bot: inserted, homeDir, copied };
}
