/**
 * Bot Sharing (`BotPackageV1` export/review) and External Bot Discovery/Import
 * (`~/.orca/bots/`, `~/.openclaw/`, `~/.hermes/`, `$DSH_HOME/data/whale/`).
 *
 * Security invariants:
 * - Hard-blocks export and package import whenever plaintext credentials/tokens
 *   are detected (`code: 'secret_detected'`), never silently passing secrets.
 * - Forces all imported automations/schedules to `enabled: false` so external
 *   packages can never auto-execute on import.
 * - Supports selective memory import via `memoryIndices`.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  BOT_PACKAGE_MANIFEST_PATH,
  BOT_PACKAGE_SCHEMA_VERSION,
  BOT_PACKAGE_SOUL_PATH,
  parseBotPackage,
  planBotFromPackage,
  redactBotText,
  soulDescription,
} from '../../src/shared/index.js';
import {
  botsRootDir,
  readBotToolsConfig,
  readSoul,
  writeAtomicFile,
} from './fs-home.js';
import { parseMemoryLine } from './memory-service.js';

const PART_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u;

const CREDENTIAL_RULES = Object.freeze([
  { name: 'openai_or_anthropic_key', re: /\bsk-(?:proj-|ant-|live-|test-)?[A-Za-z0-9_-]{12,}\b/u },
  { name: 'github_token', re: /\bgh[pousr]_[A-Za-z0-9]{16,}\b/u },
  { name: 'slack_token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/u },
  { name: 'google_api_key', re: /\bAIza[0-9A-Za-z_-]{20,}\b/u },
  { name: 'aws_access_key', re: /\bAKIA[0-9A-Z]{16}\b/u },
  { name: 'bearer_token', re: /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}\b/iu },
  { name: 'private_key_block', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/u },
  {
    name: 'generic_secret_assignment',
    re: /\b(?:api[_-]?key|secret|password|passwd|access[_-]?token|auth[_-]?token|private[_-]?key|client[_-]?secret)\s*[:=]\s*['"]?(?!\[REDACTED\])[^\s'"]{6,}['"]?/iu,
  },
  { name: 'url_query_credential', re: /[?&](?:token|access_token|api_key|secret|password)=[^\s&]{6,}/iu },
]);

/**
 * Scan a single text string for plaintext credentials/tokens.
 * Never returns the raw secret value.
 * @param {string} text
 * @param {string} source
 */
export function scanTextForSecrets(text, source) {
  const str = String(text ?? '');
  if (!str) return [];
  const findings = [];
  for (const rule of CREDENTIAL_RULES) {
    if (rule.re.test(str)) {
      findings.push({ source, rule: rule.name });
    }
  }
  return findings;
}

/**
 * Scan a map of files and extra named text fields for plaintext secrets.
 * @param {Record<string, string>} files
 * @param {Array<[string, string]>} [extraTexts]
 */
export function scanPackageForSecrets(files = {}, extraTexts = []) {
  const findings = [];
  for (const [filePath, body] of Object.entries(files ?? {})) {
    if (typeof body !== 'string') continue;
    findings.push(...scanTextForSecrets(body, filePath));
  }
  for (const [label, body] of extraTexts ?? []) {
    if (typeof body !== 'string') continue;
    findings.push(...scanTextForSecrets(body, label));
  }
  return findings;
}

/** @param {Record<string, string>} files @param {Array<[string, string]>} [extraTexts] @param {string} [contextLabel] */
function assertNoPlaintextSecrets(files, extraTexts = [], contextLabel = 'Bot package') {
  const findings = scanPackageForSecrets(files, extraTexts);
  if (findings.length > 0) {
    const summary = [...new Set(findings.map((f) => `${f.source} (${f.rule})`))].join(', ');
    throw Object.assign(
      new Error(`${contextLabel} rejected: plaintext credential/secret detected in ${summary}`),
      { code: 'secret_detected', data: { findings } },
    );
  }
}

/**
 * Filter facts from a `MEMORY.md` string by 0-based fact indices.
 * @param {string} memoryRaw
 * @param {number[]} memoryIndices
 */
export function filterMemoryByIndices(memoryRaw, memoryIndices) {
  const indexSet = new Set(
    (Array.isArray(memoryIndices) ? memoryIndices : [])
      .map((n) => Number(n))
      .filter((n) => Number.isInteger(n) && n >= 0),
  );
  const lines = String(memoryRaw ?? '').replace(/\r\n/gu, '\n').split('\n');
  const selectedFacts = [];
  let factIdx = 0;
  for (const line of lines) {
    const parsed = parseMemoryLine(line);
    if (!parsed.isFact) continue;
    if (indexSet.has(factIdx)) selectedFacts.push(line);
    factIdx += 1;
  }
  return selectedFacts.length > 0 ? `# Memory\n\n${selectedFacts.join('\n')}\n` : '# Memory\n\n';
}

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

/** @param {string} dir @param {string} rel */
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

/** @param {string} dir @param {string} sourceKind @param {string} fallbackName */
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

/** @param {string} homeDir @param {any} options */
function collectRawSkillsAndTopics(homeDir, options) {
  /** @type {Array<{ slug: string, raw: string }>} */
  const rawSkills = [];
  const skillsDir = path.join(homeDir, 'skills');
  if (options.includeSkills !== false && fs.existsSync(skillsDir)) {
    for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const skillMd = safeReadFile(path.join(skillsDir, entry.name), 'SKILL.md');
      if (skillMd) rawSkills.push({ slug: toPartSlug(entry.name), raw: skillMd });
    }
  }
  /** @type {Array<{ slug: string, raw: string }>} */
  const rawTopics = [];
  const memDir = path.join(homeDir, 'memory');
  if (options.includeMemoryTopics === true && fs.existsSync(memDir)) {
    for (const name of fs.readdirSync(memDir)) {
      if (!name.endsWith('.md') || name === 'archive.md') continue;
      const raw = safeReadFile(memDir, name);
      if (raw) rawTopics.push({ slug: toPartSlug(name.slice(0, -3)), raw });
    }
  }
  return { rawSkills, rawTopics };
}

/** @param {string} homeDir @param {any} workStore @param {string} botId @param {any} options */
function collectShareExportPayload(homeDir, workStore, botId, options) {
  const soulRaw = readSoul(homeDir).text;
  const { rawSkills, rawTopics } = collectRawSkillsAndTopics(homeDir, options);
  const toolsCfg = readBotToolsConfig(homeDir);
  const rawSchedules = workStore.listAutomations({ botId })
    .filter((a) => !a.once && a.schedule)
    .slice(0, 32);

  /** @type {Record<string, string>} */
  const rawFilesToScan = { [BOT_PACKAGE_SOUL_PATH]: soulRaw };
  for (const s of rawSkills) rawFilesToScan[`skills/${s.slug}/SKILL.md`] = s.raw;
  for (const t of rawTopics) rawFilesToScan[`memory/${t.slug}.md`] = t.raw;

  /** @type {Array<[string, string]>} */
  const rawExtrasToScan = [];
  for (const [idx, s] of (toolsCfg.servers ?? []).entries()) {
    if (typeof s?.url === 'string') rawExtrasToScan.push([`tools[${idx}].url`, s.url]);
    if (s?.headers && typeof s.headers === 'object') {
      rawExtrasToScan.push([`tools[${idx}].headers`, JSON.stringify(s.headers)]);
    }
  }
  for (const [idx, a] of rawSchedules.entries()) {
    rawExtrasToScan.push([`schedules[${idx}].prompt`, String(a.prompt ?? '')]);
  }
  return { soulRaw, rawSkills, rawTopics, toolsCfg, rawSchedules, rawFilesToScan, rawExtrasToScan };
}
/** @param {any} rawObj @param {any} manifest @param {Record<string, string>} filesObj */
function collectPackageTextsForSecretScan(rawObj, manifest, filesObj) {
  /** @type {Array<[string, string]>} */
  const extra = [];
  if (typeof manifest?.purpose === 'string') extra.push(['manifest.purpose', manifest.purpose]);
  for (const [idx, s] of (manifest?.schedules ?? []).entries()) {
    if (typeof s?.prompt === 'string') extra.push([`manifest.schedules[${idx}].prompt`, s.prompt]);
  }
  for (const [idx, t] of (manifest?.tools ?? []).entries()) {
    if (typeof t?.url === 'string') extra.push([`manifest.tools[${idx}].url`, t.url]);
  }
  for (const [idx, a] of (Array.isArray(rawObj?.automations) ? rawObj.automations : []).entries()) {
    if (typeof a?.prompt === 'string') extra.push([`automations[${idx}].prompt`, a.prompt]);
  }
  return { files: filesObj, extra };
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

  /** @param {string} botId */
  function disableAllBotAutomations(botId) {
    const list = workStore.listAutomations({ botId });
    for (const auto of list) {
      if (auto.enabled) {
        workStore.updateAutomationRunState(auto.id, { enabled: false });
      }
    }
  }

  /** @param {string} botId @param {any} automations */
  function importExtraAutomationsDisabled(botId, automations) {
    if (!Array.isArray(automations)) return;
    for (const auto of automations) {
      if (!auto || typeof auto !== 'object') continue;
      const cleanedPrompt = redactBotText(String(auto.prompt ?? '')).text;
      workStore.upsertAutomation({
        botId,
        name: String(auto.name || 'Imported automation').slice(0, 200),
        prompt: cleanedPrompt || 'Review updates.',
        schedule: auto.schedule ?? auto.rrule ?? null,
        timezone: auto.timezone ?? null,
        triggers: Array.isArray(auto.triggers) ? auto.triggers : undefined,
        runsIn: auto.runsIn || 'new',
        resultsTo: auto.resultsTo || auto.results || 'chat',
        enabled: false,
      });
    }
  }

  function prepareShare(botId, options = {}) {
    const bot = requireBot(botId);
    const homeDir = path.join(botsRootDir(dshHome), bot.folder);
    const {
      soulRaw,
      rawSkills,
      rawTopics,
      toolsCfg,
      rawSchedules,
      rawFilesToScan,
      rawExtrasToScan,
    } = collectShareExportPayload(homeDir, workStore, bot.id, options);

    // Hard-block export if any plaintext credentials/tokens are present.
    assertNoPlaintextSecrets(rawFilesToScan, rawExtrasToScan, 'Bot share export');

    const soulClean = redactBotText(soulRaw);
    let redactedCount = soulClean.leftOut;
    /** @type {Record<string, string>} */
    const files = { [BOT_PACKAGE_SOUL_PATH]: soulClean.text };
    const skills = [];
    const memoryTopics = [];

    for (const item of rawSkills) {
      const cleaned = redactBotText(item.raw);
      redactedCount += cleaned.leftOut;
      skills.push({ name: item.slug });
      files[`skills/${item.slug}/SKILL.md`] = cleaned.text;
    }
    for (const item of rawTopics) {
      const cleaned = redactBotText(item.raw);
      redactedCount += cleaned.leftOut;
      memoryTopics.push({ topic: item.slug });
      files[`memory/${item.slug}.md`] = cleaned.text;
    }

    const tools = (toolsCfg.servers ?? [])
      .filter((s) => typeof s.url === 'string' && /^https?:\/\//i.test(s.url))
      .slice(0, 32)
      .map((s, idx) => ({
        id: `tool-${idx + 1}`,
        name: toPartSlug(s.name || `tool-${idx + 1}`),
        url: s.url,
        headerNames: [],
      }));

    const schedules = rawSchedules.map((a, idx) => {
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
    return {
      manifestPath: BOT_PACKAGE_MANIFEST_PATH,
      manifest: validated.bot,
      files,
      redactedCount,
      packageJson: JSON.stringify({ manifest: validated.bot, files }, null, 2),
    };
  }

  function reviewPackage(rawInput) {
    const parsedObj = typeof rawInput === 'string' ? JSON.parse(rawInput) : rawInput;
    const manifestObj = parsedObj?.manifest ?? parsedObj;
    const filesObj = parsedObj?.files && typeof parsedObj.files === 'object' ? parsedObj.files : {};
    const scanTarget = collectPackageTextsForSecretScan(parsedObj, manifestObj, filesObj);
    assertNoPlaintextSecrets(scanTarget.files, scanTarget.extra, 'Bot package review');

    const { bot, droppedKeys } = parseBotPackage(manifestObj);
    const inventory = Object.keys(filesObj)
      .filter((p) => p !== 'MEMORY.md')
      .map((p) => ({ path: p, executable: false }));
    const plan = planBotFromPackage(bot, inventory, { agent: 'deepseek-harness', toolIds: bot.tools.map((t) => t.id) });
    return {
      ok: true,
      manifest: bot,
      droppedKeys,
      fileCount: Object.keys(filesObj).length,
      plan,
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
    const filesObj = { ...(rawObj?.files && typeof rawObj.files === 'object' ? rawObj.files : {}) };
    let manifest = reviewed.manifest;

    if (Array.isArray(params.memoryIndices)) {
      const idxSet = new Set(params.memoryIndices.map(Number));
      const keptTopics = (manifest.memory ?? []).filter((/** @type {any} */ _m, /** @type {number} */ i) => idxSet.has(i));
      const keptTopicNames = new Set(keptTopics.map((/** @type {any} */ m) => `memory/${m.topic}.md`));
      for (const key of Object.keys(filesObj)) {
        if (key.startsWith('memory/') && !keptTopicNames.has(key)) delete filesObj[key];
      }
      manifest = { ...manifest, memory: keptTopics };
    }

    const memoryFileRaw = typeof filesObj['MEMORY.md'] === 'string' ? filesObj['MEMORY.md'] : null;
    delete filesObj['MEMORY.md'];

    const created = await botsService.createBot({
      name: params.name || manifest.name,
      fromPackage: { manifest, files: filesObj, toolIds: params.selectedToolIds },
      skipKickoff: params.skipKickoff,
    });

    if (memoryFileRaw !== null) {
      const destHome = path.join(botsRootDir(dshHome), created.bot.folder);
      const selectedMem = Array.isArray(params.memoryIndices)
        ? filterMemoryByIndices(memoryFileRaw, params.memoryIndices)
        : memoryFileRaw;
      writeAtomicFile(path.join(destHome, 'MEMORY.md'), redactBotText(selectedMem).text);
    }

    importExtraAutomationsDisabled(created.bot.id, rawObj?.automations);
    disableAllBotAutomations(created.bot.id);
    return { ok: true, bot: created.bot, sourceKind: 'package' };
  }

  /** @param {Record<string, any>} [params] */
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
      skipKickoff: params.skipKickoff,
    });
    const destHome = path.join(botsRootDir(dshHome), created.bot.folder);
    if (memoryRaw && params.includeMemory !== false) {
      const memoryBody = Array.isArray(params.memoryIndices)
        ? filterMemoryByIndices(memoryRaw, params.memoryIndices)
        : memoryRaw;
      writeAtomicFile(path.join(destHome, 'MEMORY.md'), redactBotText(memoryBody).text);
    }
    copyImportedSkills(matched.path, destHome);
    importExtraAutomationsDisabled(created.bot.id, params.automations);
    disableAllBotAutomations(created.bot.id);
    return { ok: true, bot: created.bot, sourceKind: matched.sourceKind };
  }

  return {
    prepareShare,
    reviewPackage,
    scanImportSources,
    executeImport,
  };
}
