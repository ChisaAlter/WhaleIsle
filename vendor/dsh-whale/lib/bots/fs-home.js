/**
 * Filesystem manager for Bot Homes (`$DSH_HOME/data/bots/<folder>/`) and
 * isolated host metadata (`$DSH_HOME/data/bots/_meta/`).
 *
 * Enforces:
 * - Windows reserved device names & slug normalization
 * - `bot.json` ownership lock (`bot_folder_not_owned`)
 * - Atomic temp-file + rename writes
 * - `SOUL.md` optimistic concurrency via SHA-256 signature (`changed-on-disk`)
 * - PNG IHDR validation for avatars (square, 512..2000px, <= 2 MiB)
 * - Strict path traversal & symlink escape prevention
 * - Linked project skills via Windows junctions / POSIX dir symlinks
 * - Per-bot MCP tools credential stripping into `_meta/bot-credentials/`
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { computeBotToolsVersion, createBotToolsConfigOps } from './fs-tools-config.js';

export { computeBotToolsVersion };

export const AVATAR_MIN_PX = 512;
export const AVATAR_MAX_PX = 2000;
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
export const FOLDER_MAX_LEN = 40;
export const DEFAULT_READ_MAX_BYTES = 1024 * 1024;

const WINDOWS_RESERVED_RE = /^(con|prn|aux|nul|com\d|lpt\d)$/iu;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const SKILL_NAME_RE = /^[A-Za-z0-9._-]{1,80}$/u;

export class BotFsError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {Record<string, any>} [data]
   */
  constructor(code, message, data = undefined) {
    super(message);
    this.name = 'BotFsError';
    this.code = code;
    if (data !== undefined) this.data = data;
  }
}

/** @param {string} dshHome */
export function botsRootDir(dshHome) {
  if (!dshHome) throw new BotFsError('invalid_argument', 'dshHome is required');
  return path.join(dshHome, 'data', 'bots');
}

/** @param {string} dshHome */
export function botMetaDir(dshHome) {
  return path.join(botsRootDir(dshHome), '_meta');
}

/** @param {string | Buffer} content */
export function sha256Hex(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/** @param {string} botId */
function safeIdSegment(botId) {
  const clean = encodeURIComponent(String(botId ?? '').trim());
  if (!clean || clean === '.' || clean === '..') {
    throw new BotFsError('invalid_argument', 'Invalid botId for filesystem path');
  }
  return clean;
}

/**
 * Normalize a bot display name into a safe folder slug.
 * @param {string} name
 */
export function botFolderName(name) {
  let slug = String(name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, FOLDER_MAX_LEN)
    .replace(/-+$/gu, '');
  if (!slug) slug = 'bot';
  if (WINDOWS_RESERVED_RE.test(slug) || slug === '_meta') {
    slug = `${slug}-bot`;
  }
  return slug;
}

/**
 * Reserve a unique folder under `botsRoot` and create it atomically.
 * @param {string} botsRoot
 * @param {string} name
 * @param {Iterable<string>} [existingFolders]
 */
export function reserveBotFolder(botsRoot, name, existingFolders = []) {
  fs.mkdirSync(botsRoot, { recursive: true });
  const taken = new Set(['_meta']);
  for (const folder of existingFolders) taken.add(String(folder).toLowerCase());

  const base = botFolderName(name);
  for (let suffix = 1; suffix < 10000; suffix += 1) {
    const candidate = suffix === 1 ? base : `${base.slice(0, FOLDER_MAX_LEN - String(suffix).length - 1)}-${suffix}`;
    if (taken.has(candidate.toLowerCase())) continue;
    const homeDir = path.join(botsRoot, candidate);
    try {
      fs.mkdirSync(homeDir);
      return { folder: candidate, homeDir };
    } catch (error) {
      if (error?.code === 'EEXIST') {
        taken.add(candidate.toLowerCase());
        continue;
      }
      throw error;
    }
  }
  throw new BotFsError('invalid_argument', `Unable to reserve folder for bot name: ${name}`);
}

/**
 * Atomic temp-file write + rename inside the same directory.
 * @param {string} filePath
 * @param {string | Buffer} content
 */
export function writeAtomicFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    if (Buffer.isBuffer(content)) {
      fs.writeFileSync(tmp, content);
    } else {
      fs.writeFileSync(tmp, content, 'utf8');
    }
    fs.renameSync(tmp, filePath);
  } finally {
    if (fs.existsSync(tmp)) {
      try {
        fs.unlinkSync(tmp);
      } catch {
        // Ignore best-effort cleanup failure if rename already moved or locked temp file.
      }
    }
  }
}

/**
 * Verify that `homeDir` is either uninitialized or owned by `botId` via `bot.json`.
 * @param {string} homeDir
 * @param {string} botId
 */
export function assertFolderOwnedByBot(homeDir, botId) {
  if (!botId) throw new BotFsError('invalid_argument', 'botId is required for ownership check');
  const metaPath = path.join(homeDir, 'bot.json');
  if (!fs.existsSync(metaPath)) return;
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  } catch {
    throw new BotFsError('bot_folder_not_owned', `Unreadable bot.json in ${homeDir}`, { homeDir, botId });
  }
  if (!parsed || typeof parsed !== 'object' || (parsed.id && parsed.id !== botId)) {
    throw new BotFsError(
      'bot_folder_not_owned',
      `Folder ${homeDir} is owned by another bot (${String(parsed?.id ?? 'unknown')})`,
      { homeDir, expectedBotId: botId, actualBotId: parsed?.id ?? null },
    );
  }
}

/** @param {any} bot */
function buildBotJson(bot) {
  const payload = {
    id: bot.id,
    name: bot.name,
    agent: bot.agent ?? 'dsh',
    avatar: bot.avatar ?? null,
    ...(bot.avatarColor !== undefined ? { avatarColor: bot.avatarColor } : {}),
    members: Array.isArray(bot.members) ? bot.members : [],
    ...(Array.isArray(bot.skillProjects) && bot.skillProjects.length > 0
      ? { skillProjects: bot.skillProjects }
      : {}),
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}

/** @param {any} bot */
export function renderAgentsMd(bot) {
  const displayName = String(bot?.name ?? 'Bot').trim() || 'Bot';
  return [
    `# ${displayName}`,
    '',
    'This folder is your home directory managed by WhaleIsle.',
    '',
    '- `SOUL.md` — Your persona and standing instructions. Only update it when the owner asks.',
    '- `MEMORY.md` — Long-term memory (one dated fact per bullet line). Never delete lines directly; always use `bot_memory_forget` or the system will restore removed facts after your turn.',
    '- `memory/` — Detailed topic notes (`memory/<topic>.md`) and `memory/archive.md`.',
    '- `AGENTS.md`, `CLAUDE.md`, and `bot.json` are managed by WhaleIsle and overwritten when settings change.',
    '',
  ].join('\n');
}

/**
 * Write managed files (`bot.json`, `AGENTS.md`, `CLAUDE.md`) only when contents changed.
 * @param {string} homeDir
 * @param {any} bot
 */
export function writeManagedFiles(homeDir, bot) {
  assertFolderOwnedByBot(homeDir, bot.id);
  fs.mkdirSync(homeDir, { recursive: true });
  const files = [
    ['bot.json', buildBotJson(bot)],
    ['AGENTS.md', renderAgentsMd(bot)],
    ['CLAUDE.md', '@AGENTS.md\n'],
  ];
  const changed = [];
  for (const [name, body] of files) {
    const target = path.join(homeDir, name);
    if (fs.existsSync(target) && fs.readFileSync(target, 'utf8') === body) continue;
    writeAtomicFile(target, body);
    changed.push(name);
  }
  return { changed };
}

/**
 * Initialize a bot's home directory without overwriting existing `SOUL.md` or `MEMORY.md`.
 * @param {string} homeDir
 * @param {any} bot
 * @param {{ starterSoul?: string, starterMemory?: string }} [options]
 */
export function initBotHome(homeDir, bot, options = {}) {
  fs.mkdirSync(path.join(homeDir, 'memory'), { recursive: true });
  const { changed } = writeManagedFiles(homeDir, bot);
  const soulPath = path.join(homeDir, 'SOUL.md');
  if (!fs.existsSync(soulPath)) {
    const defaultSoul = options.starterSoul ?? `# ${bot.name}\n\nYou are ${bot.name}, a helpful assistant.\n`;
    writeAtomicFile(soulPath, defaultSoul);
    changed.push('SOUL.md');
  }
  const memoryPath = path.join(homeDir, 'MEMORY.md');
  if (!fs.existsSync(memoryPath)) {
    const defaultMemory = options.starterMemory ?? '# Memory\n\n';
    writeAtomicFile(memoryPath, defaultMemory);
    changed.push('MEMORY.md');
  }
  return { homeDir, changed };
}

/** @param {string} homeDir */
export function readSoul(homeDir) {
  const soulPath = path.join(homeDir, 'SOUL.md');
  const text = fs.existsSync(soulPath) ? fs.readFileSync(soulPath, 'utf8') : '';
  return { text, signature: sha256Hex(text) };
}

/**
 * Write `SOUL.md` with optional optimistic signature check (`changed-on-disk`).
 * @param {string} homeDir
 * @param {string} text
 * @param {{ expectedSignature?: string, botId?: string }} [options]
 */
export function writeSoul(homeDir, text, options = {}) {
  if (typeof text !== 'string') {
    throw new BotFsError('invalid_argument', 'SOUL.md content must be a string');
  }
  if (options.botId) assertFolderOwnedByBot(homeDir, options.botId);
  const current = readSoul(homeDir);
  if (options.expectedSignature !== undefined && options.expectedSignature !== null) {
    if (current.signature !== options.expectedSignature) {
      throw new BotFsError('changed-on-disk', 'SOUL.md was modified on disk since it was last read', {
        expectedSignature: options.expectedSignature,
        actualSignature: current.signature,
      });
    }
  }
  const soulPath = path.join(homeDir, 'SOUL.md');
  writeAtomicFile(soulPath, text);
  return { text, signature: sha256Hex(text) };
}

/**
 * Parse width and height from a PNG IHDR chunk.
 * @param {Buffer} buffer
 */
export function parsePngDimensions(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 24) return null;
  if (!buffer.subarray(0, 8).equals(PNG_MAGIC)) return null;
  if (buffer.subarray(12, 16).toString('ascii') !== 'IHDR') return null;
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  return { width, height };
}

/**
 * Validate and save `avatar.png` inside `homeDir`.
 * @param {string} homeDir
 * @param {Buffer} buffer
 * @param {{ botId?: string }} [options]
 */
export function saveAvatar(homeDir, buffer, options = {}) {
  if (!Buffer.isBuffer(buffer)) {
    throw new BotFsError('invalid_avatar', 'Avatar must be a PNG Buffer');
  }
  if (buffer.length > AVATAR_MAX_BYTES) {
    throw new BotFsError('invalid_avatar', `Avatar exceeds ${AVATAR_MAX_BYTES} bytes`);
  }
  const dims = parsePngDimensions(buffer);
  if (!dims) {
    throw new BotFsError('invalid_avatar', 'Avatar must be a valid PNG image');
  }
  if (dims.width !== dims.height) {
    throw new BotFsError('invalid_avatar', `Avatar must be square (got ${dims.width}x${dims.height})`);
  }
  if (dims.width < AVATAR_MIN_PX || dims.width > AVATAR_MAX_PX) {
    throw new BotFsError(
      'invalid_avatar',
      `Avatar dimensions must be between ${AVATAR_MIN_PX} and ${AVATAR_MAX_PX}px (got ${dims.width}px)`,
    );
  }
  if (options.botId) assertFolderOwnedByBot(homeDir, options.botId);
  const target = path.join(homeDir, 'avatar.png');
  writeAtomicFile(target, buffer);
  const digest = sha256Hex(buffer);
  return {
    avatar: `upload:${digest.slice(0, 16)}`,
    sha256: digest,
    width: dims.width,
    height: dims.height,
    bytes: buffer.length,
  };
}

/** @param {string} homeDir */
export function readAvatar(homeDir) {
  const target = path.join(homeDir, 'avatar.png');
  if (!fs.existsSync(target)) return null;
  const buffer = fs.readFileSync(target);
  return {
    buffer,
    sha256: sha256Hex(buffer),
    dataUrl: `data:image/png;base64,${buffer.toString('base64')}`,
  };
}

/** @param {string} root @param {string} target */
function isWithinBoundary(root, target) {
  const normRoot = process.platform === 'win32' ? root.toLowerCase() : root;
  const normTarget = process.platform === 'win32' ? target.toLowerCase() : target;
  if (normTarget === normRoot) return true;
  const prefix = normRoot.endsWith(path.sep) ? normRoot : `${normRoot}${path.sep}`;
  return normTarget.startsWith(prefix);
}

/**
 * Resolve a relative path inside `homeDir`, rejecting path traversal and symlink escapes.
 * @param {string} homeDir
 * @param {string} relPath
 * @param {{ allowRoot?: boolean }} [options]
 */
export function resolveSafeHomePath(homeDir, relPath, options = {}) {
  if (typeof relPath !== 'string') {
    throw new BotFsError('path_traversal', 'Relative path must be a string');
  }
  if (relPath.includes('\0') || path.isAbsolute(relPath)) {
    throw new BotFsError('path_traversal', `Path is not allowed: ${relPath}`);
  }
  const normalizedRel = relPath.trim();
  if (!normalizedRel && !options.allowRoot) {
    throw new BotFsError('path_traversal', 'Relative path cannot be empty');
  }

  const realHome = fs.realpathSync(homeDir);
  const candidate = path.resolve(realHome, normalizedRel);
  if (!isWithinBoundary(realHome, candidate)) {
    throw new BotFsError('path_traversal', `Path escapes bot home: ${relPath}`);
  }

  // Walk up to the nearest existing ancestor to catch symlink escapes before write/read.
  let probe = candidate;
  while (!fs.existsSync(probe)) {
    const parent = path.dirname(probe);
    if (parent === probe) break;
    probe = parent;
  }
  if (fs.existsSync(probe)) {
    const realProbe = fs.realpathSync(probe);
    if (!isWithinBoundary(realHome, realProbe)) {
      throw new BotFsError('path_traversal', `Symlink target escapes bot home: ${relPath}`);
    }
  }
  return candidate;
}

/** @param {string} homeDir @param {string} [subDir] */
export function listHomeFiles(homeDir, subDir = '') {
  const targetDir = resolveSafeHomePath(homeDir, subDir, { allowRoot: true });
  if (!fs.existsSync(targetDir)) return [];
  const entries = fs.readdirSync(targetDir, { withFileTypes: true });
  return entries
    .map((entry) => {
      const full = path.join(targetDir, entry.name);
      const stat = fs.lstatSync(full);
      return {
        name: entry.name,
        relativePath: subDir ? `${subDir.replace(/\\/gu, '/')}/${entry.name}` : entry.name,
        kind: stat.isSymbolicLink() ? 'symlink' : (stat.isDirectory() ? 'directory' : 'file'),
        size: stat.isFile() ? stat.size : 0,
        mtimeMs: stat.mtimeMs,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** @param {string} homeDir @param {string} relPath @param {{ maxBytes?: number }} [options] */
export function readHomeFile(homeDir, relPath, options = {}) {
  const full = resolveSafeHomePath(homeDir, relPath);
  if (!fs.existsSync(full)) {
    throw new BotFsError('not_found', `File not found: ${relPath}`);
  }
  const stat = fs.statSync(full);
  const maxBytes = options.maxBytes ?? DEFAULT_READ_MAX_BYTES;
  if (!stat.isFile()) {
    throw new BotFsError('invalid_argument', `Not a file: ${relPath}`);
  }
  if (stat.size > maxBytes) {
    throw new BotFsError('invalid_argument', `File exceeds ${maxBytes} bytes: ${relPath}`);
  }
  return fs.readFileSync(full, 'utf8');
}

/** @param {string} homeDir @param {string} relPath @param {string} content @param {{ botId?: string }} [options] */
export function writeHomeFile(homeDir, relPath, content, options = {}) {
  if (typeof content !== 'string') {
    throw new BotFsError('invalid_argument', 'File content must be a string');
  }
  if (options.botId) assertFolderOwnedByBot(homeDir, options.botId);
  const full = resolveSafeHomePath(homeDir, relPath);
  writeAtomicFile(full, content);
  return { path: full, bytes: Buffer.byteLength(content, 'utf8') };
}

/** @param {Array<string | { name: string, dir: string }>} skillSources */
function collectLinkedSkillTargets(skillSources) {
  /** @type {Map<string, string>} */
  const desired = new Map();
  for (const source of skillSources ?? []) {
    if (typeof source === 'string') {
      if (!fs.existsSync(source)) continue;
      for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
        if (!entry.isDirectory() || !SKILL_NAME_RE.test(entry.name)) continue;
        const skillDir = path.join(source, entry.name);
        if (!fs.existsSync(path.join(skillDir, 'SKILL.md'))) continue;
        if (!desired.has(entry.name)) desired.set(entry.name, fs.realpathSync(skillDir));
      }
    } else if (source && typeof source === 'object' && SKILL_NAME_RE.test(String(source.name ?? ''))) {
      const target = String(source.dir ?? '');
      if (target && fs.existsSync(target) && !desired.has(source.name)) {
        desired.set(source.name, fs.realpathSync(target));
      }
    }
  }
  return desired;
}

/** @param {string} linkPath */
function removeLinkOnly(linkPath) {
  const stat = fs.lstatSync(linkPath);
  if (stat.isSymbolicLink()) {
    fs.unlinkSync(linkPath);
  } else if (stat.isDirectory()) {
    fs.rmSync(linkPath, { recursive: true, force: true });
  } else {
    fs.unlinkSync(linkPath);
  }
}

/** @param {string} root @param {Map<string, string>} desired */
function reconcileLinkRoot(root, desired) {
  fs.mkdirSync(root, { recursive: true });
  const linkType = process.platform === 'win32' ? 'junction' : 'dir';

  for (const entry of fs.readdirSync(root)) {
    const full = path.join(root, entry);
    const wantedTarget = desired.get(entry);
    if (!wantedTarget) {
      removeLinkOnly(full);
      continue;
    }
    try {
      const resolved = fs.realpathSync(full);
      if (isWithinBoundary(wantedTarget, resolved) && isWithinBoundary(resolved, wantedTarget)) {
        continue;
      }
    } catch {
      // Broken link will be recreated below.
    }
    removeLinkOnly(full);
  }

  for (const [name, target] of desired.entries()) {
    const linkPath = path.join(root, name);
    if (fs.existsSync(linkPath)) continue;
    fs.symlinkSync(target, linkPath, linkType);
  }
}

/**
 * Sync linked project skills into `_meta/bot-linked-skills/<botId>/{skills,.claude/skills}`.
 * @param {string} metaRoot
 * @param {string} botId
 * @param {Array<string | { name: string, dir: string }>} skillSources
 */
export function syncLinkedSkills(metaRoot, botId, skillSources = []) {
  const base = path.join(metaRoot, 'bot-linked-skills', safeIdSegment(botId));
  const roots = [path.join(base, 'skills'), path.join(base, '.claude', 'skills')];
  const desired = collectLinkedSkillTargets(skillSources);
  for (const root of roots) {
    reconcileLinkRoot(root, desired);
  }
  return {
    roots,
    linked: [...desired.entries()].map(([name, target]) => ({ name, target })),
  };
}

const botToolsConfigOps = createBotToolsConfigOps({
  BotFsError,
  writeAtomicFile,
  assertFolderOwnedByBot,
});

export const {
  readBotToolCredentials,
  readBotToolsConfig,
  writeBotToolsConfig,
} = botToolsConfigOps;

/**
 * Delete a bot home directory ONLY when `deleteFolder: true` AND ownership matches `botId`.
 * By default (`deleteFolder: false`), preserves the directory untouched.
 * @param {string} homeDir
 * @param {string} botId
 * @param {{ deleteFolder?: boolean }} [options]
 */
export function deleteBotHome(homeDir, botId, options = {}) {
  if (options.deleteFolder !== true) {
    return { deleted: false, preserved: true };
  }
  if (!fs.existsSync(homeDir)) {
    return { deleted: false, preserved: false };
  }
  const stat = fs.lstatSync(homeDir);
  if (stat.isSymbolicLink()) {
    throw new BotFsError('path_traversal', 'Refusing to recursively delete a symlinked bot home');
  }
  assertFolderOwnedByBot(homeDir, botId);
  fs.rmSync(homeDir, { recursive: true, force: true });
  return { deleted: true, preserved: false };
}

export const DECISIONS_TSV_HEADER = 'ts\tactor\tphase\tdecision\tevidence\tnotes';
const SAFE_SEGMENT_RE = /^[A-Za-z0-9._-]{1,128}$/u;
const DAILY_DATE_RE = /^\d{4}-\d{2}-\d{2}$/u;

/** @param {unknown} raw @param {string} label */
function safeSegment(raw, label) {
  const clean = typeof raw === 'string' ? raw.trim() : '';
  if (!clean || clean === '.' || clean === '..' || !SAFE_SEGMENT_RE.test(clean)) {
    throw new BotFsError('path_traversal', `Invalid ${label}: ${String(raw)}`);
  }
  return clean;
}

/** @param {unknown} value */
const sanitizeTsvCell = (value) => String(value ?? '').replace(/[\t\r\n]+/gu, ' ').trim();

/** @param {string} homeDir @param {string} itemUid */
export function resolveDecisionTsvPath(homeDir, itemUid) {
  return resolveSafeHomePath(homeDir, `decisions/${safeSegment(itemUid, 'itemUid')}.tsv`);
}

/** @param {any} row @param {number} now */
function buildDecisionEntry(row, now) {
  const src = row && typeof row === 'object' ? row : {};
  const hasTs = src.ts !== undefined && src.ts !== null && String(src.ts).trim().length > 0;
  return {
    ts: hasTs ? sanitizeTsvCell(src.ts) : new Date(now).toISOString(),
    actor: sanitizeTsvCell(src.actor || 'bot'),
    phase: sanitizeTsvCell(src.phase || ''),
    decision: sanitizeTsvCell(src.decision || ''),
    evidence: sanitizeTsvCell(src.evidence || ''),
    notes: sanitizeTsvCell(src.notes || ''),
  };
}

/**
 * Append one decision row to `<homeDir>/decisions/<itemUid>.tsv`.
 * @param {string} homeDir
 * @param {string} itemUid
 * @param {{ ts?: number | string, actor?: string, phase?: string, decision?: string, evidence?: string, notes?: string }} row
 * @param {{ botId?: string, now?: number }} [options]
 */
export function appendDecisionTsv(homeDir, itemUid, row, options = {}) {
  if (options.botId) assertFolderOwnedByBot(homeDir, options.botId);
  const filePath = resolveDecisionTsvPath(homeDir, itemUid);
  const entry = buildDecisionEntry(row, options.now ?? Date.now());
  const line = [entry.ts, entry.actor, entry.phase, entry.decision, entry.evidence, entry.notes].join('\t');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const needsHeader = !fs.existsSync(filePath) || fs.statSync(filePath).size === 0;
  fs.appendFileSync(filePath, `${needsHeader ? `${DECISIONS_TSV_HEADER}\n` : ''}${line}\n`, 'utf8');
  return { path: filePath, entry };
}

/** @param {string} homeDir @param {string} itemUid */
export function readDecisionTsv(homeDir, itemUid) {
  const filePath = resolveDecisionTsvPath(homeDir, itemUid);
  if (!fs.existsSync(filePath)) return { path: filePath, header: DECISIONS_TSV_HEADER, rows: [] };
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/u).filter((l) => l.trim().length > 0);
  const body = lines[0] === DECISIONS_TSV_HEADER ? lines.slice(1) : lines;
  const rows = body.map((line) => {
    const [ts = '', actor = '', phase = '', decision = '', evidence = '', notes = ''] = line.split('\t');
    return { ts, actor, phase, decision, evidence, notes };
  });
  return { path: filePath, header: DECISIONS_TSV_HEADER, rows };
}

/** @param {string} homeDir @param {string} relPath */
function readOptionalHomeFile(homeDir, relPath) {
  const full = resolveSafeHomePath(homeDir, relPath);
  return fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : '';
}

/** @param {string} homeDir */
export const readCrewMd = (homeDir) => readOptionalHomeFile(homeDir, 'CREW.md');
/** @param {string} homeDir @param {string} content @param {{ botId?: string }} [options] */
export const writeCrewMd = (homeDir, content, options = {}) => writeHomeFile(homeDir, 'CREW.md', content, options);
/** @param {string} homeDir */
export const readPlanMd = (homeDir) => readOptionalHomeFile(homeDir, 'plan.md');
/** @param {string} homeDir @param {string} content @param {{ botId?: string }} [options] */
export const writePlanMd = (homeDir, content, options = {}) => writeHomeFile(homeDir, 'plan.md', content, options);

/** @param {Date | string | number} [dateOrIso] */
export function dailyMemoryRelPath(dateOrIso = new Date()) {
  if (typeof dateOrIso === 'string') {
    const clean = dateOrIso.trim();
    if (!DAILY_DATE_RE.test(clean)) throw new BotFsError('invalid_argument', `Invalid daily memory date: ${dateOrIso}`);
    return `memory/${clean}.md`;
  }
  const d = dateOrIso instanceof Date ? dateOrIso : new Date(dateOrIso);
  if (Number.isNaN(d.getTime())) throw new BotFsError('invalid_argument', 'Invalid daily memory date');
  return `memory/${d.toISOString().slice(0, 10)}.md`;
}

/** @param {string} homeDir @param {Date | string | number} [dateOrIso] */
export const resolveDailyMemoryPath = (homeDir, dateOrIso = new Date()) => resolveSafeHomePath(homeDir, dailyMemoryRelPath(dateOrIso));
/** @param {string} homeDir @param {Date | string | number} [dateOrIso] */
export const readDailyMemory = (homeDir, dateOrIso = new Date()) => readOptionalHomeFile(homeDir, dailyMemoryRelPath(dateOrIso));
/** @param {string} homeDir @param {string} line @param {{ date?: Date | string | number, botId?: string }} [options] */
export function appendDailyMemory(homeDir, line, options = {}) {
  if (options.botId) assertFolderOwnedByBot(homeDir, options.botId);
  const clean = String(line ?? '').replace(/[\r\n]+/gu, ' ').trim();
  if (!clean) throw new BotFsError('invalid_argument', 'Daily memory line cannot be empty');
  const filePath = resolveDailyMemoryPath(homeDir, options.date ?? new Date());
  const bullet = clean.startsWith('- ') ? clean : `- ${clean}`;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${bullet}\n`, 'utf8');
  return { path: filePath, line: bullet };
}
/** @param {string} metaRoot @param {string} relPath */
export function resolveSafeMetaPath(metaRoot, relPath) {
  if (!metaRoot) throw new BotFsError('invalid_argument', 'metaRoot is required');
  fs.mkdirSync(metaRoot, { recursive: true });
  return resolveSafeHomePath(metaRoot, relPath);
}
/** @param {string} file @param {any} fallback */
function readJsonSafe(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) ?? fallback; } catch { return fallback; }
}
/** @param {string} metaRoot @param {string} groupId */
export const teamMemoryPath = (metaRoot, groupId) => resolveSafeMetaPath(metaRoot, `team-memory/${safeSegment(groupId, 'groupId')}.md`);
/** @param {string} metaRoot @param {string} groupId */
export const readTeamMemory = (metaRoot, groupId) => {
  const filePath = teamMemoryPath(metaRoot, groupId);
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
};
/** @param {string} metaRoot @param {string} groupId @param {string} content */
export function writeTeamMemory(metaRoot, groupId, content) {
  if (typeof content !== 'string') throw new BotFsError('invalid_argument', 'Team memory content must be a string');
  const filePath = teamMemoryPath(metaRoot, groupId);
  writeAtomicFile(filePath, content);
  return { path: filePath, bytes: Buffer.byteLength(content, 'utf8') };
}
/** @param {string} metaRoot */
export const webhookCredentialsPath = (metaRoot) => resolveSafeMetaPath(metaRoot, 'bot-credentials/webhooks.json');
/** @param {string} metaRoot */
export function readWebhookCredentials(metaRoot) {
  const parsed = readJsonSafe(webhookCredentialsPath(metaRoot), {});
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
}
/** @param {string} metaRoot @param {Record<string, any>} data */
export function writeWebhookCredentials(metaRoot, data) {
  const filePath = webhookCredentialsPath(metaRoot);
  const payload = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  writeAtomicFile(filePath, `${JSON.stringify(payload, null, 2)}\n`);
  return { path: filePath, count: Object.keys(payload).length };
}
/** @param {string} metaRoot */
export const imRoutesPath = (metaRoot) => resolveSafeMetaPath(metaRoot, 'im-routes.json');
/** @param {string} metaRoot */
export function readImRoutes(metaRoot) {
  const parsed = readJsonSafe(imRoutesPath(metaRoot), null);
  return parsed && typeof parsed === 'object' ? parsed : { version: 1, routes: {}, updatedAt: 0 };
}
/** @param {string} metaRoot @param {Record<string, any>} routesDoc */
export function writeImRoutes(metaRoot, routesDoc) {
  const filePath = imRoutesPath(metaRoot);
  const payload = { version: 1, routes: {}, updatedAt: Date.now(), ...(routesDoc ?? {}) };
  writeAtomicFile(filePath, `${JSON.stringify(payload, null, 2)}\n`);
  return { path: filePath, routes: payload };
}
/** @param {string} metaRoot @param {string} botId */
export const promptSnapshotsPath = (metaRoot, botId) => resolveSafeMetaPath(metaRoot, `bot-prompt-snapshots/${safeIdSegment(botId)}.json`);
/** @param {string} metaRoot @param {string} botId */
export function readPromptSnapshots(metaRoot, botId) {
  const parsed = readJsonSafe(promptSnapshotsPath(metaRoot, botId), []);
  return Array.isArray(parsed) ? parsed : [];
}
/** @param {string} metaRoot @param {string} botId @param {Array<any>} snapshots @param {{ maxEntries?: number }} [options] */
export function writePromptSnapshots(metaRoot, botId, snapshots, options = {}) {
  const maxEntries = Math.max(1, Number(options.maxEntries) || 10);
  const list = Array.isArray(snapshots) ? snapshots.slice(-maxEntries) : [];
  const filePath = promptSnapshotsPath(metaRoot, botId);
  writeAtomicFile(filePath, `${JSON.stringify(list, null, 2)}\n`);
  return { path: filePath, count: list.length };
}
/** @param {string} metaRoot @param {string} dispatchId */
export const resolveWorktreePath = (metaRoot, dispatchId) => resolveSafeMetaPath(metaRoot, `worktrees/${safeSegment(dispatchId, 'dispatchId')}`);
