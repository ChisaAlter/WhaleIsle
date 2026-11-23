/**
 * Bot Sharing (`BotPackageV1` export/review with `scanBotText` security scanning)
 * and External Bot Discovery/Import (`~/.orca/bots/`, `~/.openclaw/`, `~/.hermes/`,
 * `$DSH_HOME/data/whale/`).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  BOT_PACKAGE_MANIFEST_PATH,
  BOT_PACKAGE_SCHEMA_VERSION,
  BOT_PACKAGE_SOUL_PATH,
  isSafeBotPackageToolUrl,
  parseBotPackage,
  planBotFromPackage,
  redactBotText,
  scanBotText,
} from '../../src/shared/bot-package.js';
import { soulDescription } from '../../src/shared/index.js';
import {
  botsRootDir,
  readBotToolsConfig,
  readSoul,
  writeAtomicFile,
} from './fs-home.js';

const PART_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u;

/** @param {string} raw */
function toPartSlug(raw) {
  const clean = String(raw ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .replace(/--+/gu, '-')
    .slice(0, 32);
  return PART_SLUG_RE.test(clean) ? clean : 'item';
}

/** @param {string} dir */
function safeReadFile(dir, rel) {
  const full = path.join(dir, rel);
  if (!fs.existsSync(full)) return null;
  try {
    const stat = fs.lstatSync(full);
    if (!stat.isFile() || stat.size > 512 * 1024) return null;
    return fs.readFileSync(full, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Run `scanBotText` across all files, prompts, and notes in a bot package.
 * @param {any} manifest
 * @param {Record<string, string>} files
 */
function scanPackageContents(manifest, files) {
  const findings = [];
  for (const [filePath, content] of Object.entries(files ?? {})) {
    if (typeof content !== 'string') continue;
    findings.push(...scanBotText(content, { file: filePath }).findings);
  }
  for (const sched of manifest?.schedules ?? []) {
    if (typeof sched?.prompt === 'string') {
      findings.push(...scanBotText(sched.prompt, { file: `schedule:${sched.id}` }).findings);
    }
  }
  for (const ev of manifest?.eventSuggestions ?? []) {
    if (typeof ev?.prompt === 'string') {
      findings.push(...scanBotText(ev.prompt, { file: `event:${ev.id}` }).findings);
    }
  }
  if (typeof manifest?.setupNote === 'string') {
    findings.push(...scanBotText(manifest.setupNote, { file: 'setupNote' }).findings);
  }
  const blocks = findings.filter((f) => f.severity === 'block');
  const warnings = findings.filter((f) => f.severity === 'warn');
  return {
    ok: blocks.length === 0,
    blocked: blocks.length > 0,
    findings,
    blocks,
    warnings,
  };
}

/** @param {string} dir @param {string} sourceKind */
function inspectBotDirectory(dir, sourceKind, fallbackName) {
  if (!fs.existsSync(dir)) return null;
  const botJsonRaw = safeReadFile(dir, 'bot.json') ?? safeReadFile(dir, 'settings.json');
  let meta = null;
  if (botJsonRaw) {
    try { meta = JSON.parse(botJsonRaw); } catch { meta = null; }
  }
  const soul = safeReadFile(dir, 'SOUL.md');
  const memory = safeReadFile(dir, 'MEMORY.md');
  const skillsDir = path.join(dir, 'skills');
  const hasSkills = fs.existsSync(skillsDir) && fs.lstatSync(skillsDir).isDirectory();
  if (!meta && !soul && !memory && !hasSkills) return null;

  const name = String(meta?.name ?? fallbackName ?? path.basename(dir)).trim() || path.basename(dir);
  const desc = soul ? soulDescription(soul) : (meta?.personaText ? String(meta.personaText).slice(0, 140) : null);
  return {
    id: `${sourceKind}:${crypto.createHash('sha256').update(path.resolve(dir)).digest('hex').slice(0, 12)}`,
    sourceKind,
    name,
    description: desc,
    path: path.resolve(dir),
    hasSoul: Boolean(soul),
    hasMemory: Boolean(memory),
    hasSkills,
    avatar: typeof meta?.avatar === 'string' ? meta.avatar : null,
  };
}

/** @param {string} rootDir @param {string} sourceKind */
function scanSubdirectories(rootDir, sourceKind) {
  if (!fs.existsSync(rootDir)) return [];
  const results = [];
  try {
    for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === '_meta') continue;
      const item = inspectBotDirectory(path.join(rootDir, entry.name), sourceKind, entry.name);
      if (item) results.push(item);
    }
  } catch {
    return results;
  }
  return results;
}

/**
 * Create the Bot Share & Import service.
 * @param {{
 *   dshHome: string,
 *   userHomeDir?: string,
 *   botsStore: any,
 *   workStore: any,
 *   botsService: any,
 * }} deps
 */
export function createShareImportService(deps) {
  const { dshHome, botsStore, workStore, botsService } = deps;
  const userHome = deps.userHomeDir || os.homedir();

  function requireBot(botId) {
    const bot = botsStore.getBot(botId);
    if (!bot) throw Object.assign(new Error(`Bot not found: ${botId}`), { code: 'bot_not_found' });
    return bot;
  }

  function prepareShare(botId, options = {}) {
    const bot = requireBot(botId);
    const homeDir = path.join(botsRootDir(dshHome), bot.folder);
    const soulRaw = readSoul(homeDir).text;
    const soulClean = redactBotText(soulRaw);
    let redactedCount = soulClean.leftOut;

    /** @type {Record<string, string>} */
    const files = { [BOT_PACKAGE_SOUL_PATH]: soulClean.text };
    const skills = [];
    const memoryTopics = [];

    const skillsDir = path.join(homeDir, 'skills');
    if (options.includeSkills !== false && fs.existsSync(skillsDir)) {
      for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const skillMd = safeReadFile(path.join(skillsDir, entry.name), 'SKILL.md');
        if (!skillMd) continue;
        const slug = toPartSlug(entry.name);
        const cleaned = redactBotText(skillMd);
        redactedCount += cleaned.leftOut;
        skills.push({ name: slug });
        files[`skills/${slug}/SKILL.md`] = cleaned.text;
      }
    }

    const memDir = path.join(homeDir, 'memory');
    if (options.includeMemoryTopics === true && fs.existsSync(memDir)) {
      for (const name of fs.readdirSync(memDir)) {
        if (!name.endsWith('.md') || name === 'archive.md') continue;
        const slug = toPartSlug(name.slice(0, -3));
        const raw = safeReadFile(memDir, name);
        if (!raw) continue;
        const cleaned = redactBotText(raw);
        redactedCount += cleaned.leftOut;
        memoryTopics.push({ topic: slug });
        files[`memory/${slug}.md`] = cleaned.text;
      }
    }

    const toolsCfg = readBotToolsConfig(homeDir);
    const tools = (toolsCfg.servers ?? [])
      .filter((s) => isSafeBotPackageToolUrl(s?.url))
      .slice(0, 32)
      .map((s, idx) => ({
        id: `tool-${idx + 1}`,
        name: toPartSlug(s.name || `tool-${idx + 1}`),
        url: s.url,
        headerNames: [],
      }));

    const schedules = workStore.listAutomations({ botId: bot.id })
      .filter((a) => !a.once && a.schedule)
      .slice(0, 32)
      .map((a, idx) => {
        const cleanedPrompt = redactBotText(a.prompt);
        redactedCount += cleanedPrompt.leftOut;
        return {
          id: `sched-${idx + 1}`,
          name: String(a.name || `Schedule ${idx + 1}`).slice(0, 200),
          prompt: cleanedPrompt.text,
          rrule: String(a.schedule).slice(0, 512),
          results: 'chat',
        };
      });

    const avatarField = typeof bot.avatar === 'string' && bot.avatar.startsWith('mascot:')
      ? { mascot: bot.avatar.slice('mascot:'.length) }
      : undefined;

    const manifest = {
      schemaVersion: BOT_PACKAGE_SCHEMA_VERSION,
      name: bot.name,
      ...(avatarField ? { avatar: avatarField } : {}),
      purpose: (soulDescription(soulClean.text) || `Shared bot ${bot.name}`).slice(0, 200),
      agentHint: 'deepseek-harness',
      skills,
      tools,
      connectors: [],
      schedules,
      eventSuggestions: [],
      memory: memoryTopics,
    };

    const validated = parseBotPackage(manifest);
    const scan = scanPackageContents(validated.bot, files);
    if (scan.blocked && /** @type {any} */ (options).allowBlocked !== true) {
      throw Object.assign(new Error('Share blocked: secret detected in exported bot files'), {
        code: 'share_blocked_secret',
        scan,
      });
    }
    return {
      manifestPath: BOT_PACKAGE_MANIFEST_PATH,
      manifest: validated.bot,
      files,
      redactedCount,
      scan,
      packageJson: JSON.stringify({ manifest: validated.bot, files }, null, 2),
    };
  }

  function reviewPackage(rawInput) {
    const parsedObj = typeof rawInput === 'string' ? JSON.parse(rawInput) : rawInput;
    const manifestObj = parsedObj?.manifest ?? parsedObj;
    const filesObj = parsedObj?.files && typeof parsedObj.files === 'object' ? parsedObj.files : {};
    const { bot, droppedKeys } = parseBotPackage(manifestObj);
    const inventory = Object.keys(filesObj).map((p) => ({ path: p, executable: false }));
    const plan = planBotFromPackage(bot, inventory, { agent: 'deepseek-harness', toolIds: bot.tools.map((t) => t.id) });
    const scan = scanPackageContents(bot, filesObj);
    return {
      ok: true,
      manifest: bot,
      droppedKeys,
      fileCount: Object.keys(filesObj).length,
      plan,
      scan,
    };
  }

  function scanImportSources() {
    const sources = [
      ...scanSubdirectories(path.join(userHome, '.orca', 'bots'), 'orca'),
      ...scanSubdirectories(path.join(userHome, '.openclaw'), 'openclaw'),
      ...scanSubdirectories(path.join(userHome, '.hermes'), 'hermes'),
    ];
    for (const single of [
      [path.join(userHome, '.openclaw'), 'openclaw', 'OpenClaw'],
      [path.join(userHome, '.hermes'), 'hermes', 'Hermes'],
      [path.join(dshHome, 'data', 'whale'), 'legacy-whale', '鲸鱼娘'],
    ]) {
      const found = inspectBotDirectory(single[0], single[1], single[2]);
      if (found && !sources.some((s) => s.path === found.path)) sources.push(found);
    }
    return sources;
  }

  function copyImportedSkills(srcPath, destHome) {
    const srcSkills = path.join(srcPath, 'skills');
    if (!fs.existsSync(srcSkills) || !fs.lstatSync(srcSkills).isDirectory()) return;
    for (const entry of fs.readdirSync(srcSkills, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const skillText = safeReadFile(path.join(srcSkills, entry.name), 'SKILL.md');
      if (skillText) writeAtomicFile(path.join(destHome, 'skills', entry.name, 'SKILL.md'), redactBotText(skillText).text);
    }
  }

  async function importFromPackage(params) {
    const rawObj = typeof params.packageJson === 'string'
      ? JSON.parse(params.packageJson)
      : (params.packageJson ?? params);
    const reviewed = reviewPackage(rawObj);
    if (reviewed.scan?.blocked && params.allowSecrets !== true) {
      throw Object.assign(new Error('Import blocked: secret detected in bot package'), {
        code: 'package_blocked_secret',
        scan: reviewed.scan,
      });
    }
    const filesObj = rawObj?.files && typeof rawObj.files === 'object' ? rawObj.files : {};
    const created = await botsService.createBot({
      name: params.name || reviewed.manifest.name,
      fromPackage: { manifest: reviewed.manifest, files: filesObj, toolIds: params.selectedToolIds },
    });
    return { ok: true, bot: created.bot, sourceKind: 'package', scan: reviewed.scan };
  }

  async function executeImport(params = {}) {
    if (params.packageJson || params.manifest) return importFromPackage(params);
    const available = scanImportSources();
    const matched = params.sourceId
      ? available.find((s) => s.id === params.sourceId)
      : (params.sourcePath ? available.find((s) => path.resolve(s.path) === path.resolve(params.sourcePath)) : null);
    if (!matched) {
      throw Object.assign(new Error('Import source not found or not allowed'), { code: 'not_found' });
    }
    const soulRaw = safeReadFile(matched.path, 'SOUL.md');
    const memoryRaw = safeReadFile(matched.path, 'MEMORY.md');
    const created = await botsService.createBot({
      name: params.name || matched.name,
      avatar: matched.avatar || undefined,
      soul: soulRaw ? redactBotText(soulRaw).text : undefined,
      importedFrom: { kind: matched.sourceKind, path: matched.path, at: Date.now() },
    });
    const destHome = path.join(botsRootDir(dshHome), created.bot.folder);
    if (memoryRaw && params.includeMemory !== false) {
      writeAtomicFile(path.join(destHome, 'MEMORY.md'), redactBotText(memoryRaw).text);
    }
    copyImportedSkills(matched.path, destHome);
    return { ok: true, bot: created.bot, sourceKind: matched.sourceKind };
  }

  return {
    prepareShare,
    reviewPackage,
    scanImportSources,
    executeImport,
  };
}
