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

/** @param {string} homeDir */
function botToolsConfigPath(homeDir) {
  return path.join(homeDir, '.whale', 'bot-tools.json');
}

/** @param {string} metaRoot @param {string} botId */
function botCredentialsPath(metaRoot, botId) {
  return path.join(metaRoot, 'bot-credentials', `${safeIdSegment(botId)}.json`);
}

/** @param {string} metaRoot @param {string} botId */
export function readBotToolCredentials(metaRoot, botId) {
  const file = botCredentialsPath(metaRoot, botId);
  if (!fs.existsSync(file)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Read `<homeDir>/.whale/bot-tools.json` (credentials stay isolated in `_meta/bot-credentials`).
 * @param {string} homeDir
 */
export function readBotToolsConfig(homeDir) {
  const file = botToolsConfigPath(homeDir);
  if (!fs.existsSync(file)) return { servers: [] };
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  const servers = Array.isArray(parsed?.servers) ? parsed.servers : [];
  return { servers };
}

/**
 * Write `<homeDir>/.whale/bot-tools.json`, stripping sensitive HTTP headers into
 * `<metaRoot>/bot-credentials/<botId>.json` and leaving only `credential` IDs in bot home.
 * @param {string} homeDir
 * @param {string} metaRoot
 * @param {string} botId
 * @param {{ servers: Array<Record<string, any>> }} config
 */
export function writeBotToolsConfig(homeDir, metaRoot, botId, config) {
  assertFolderOwnedByBot(homeDir, botId);
  const inputServers = Array.isArray(config?.servers) ? config.servers : [];
  const existingCreds = readBotToolCredentials(metaRoot, botId);
  /** @type {Record<string, any>} */
  const nextCreds = {};
  const sanitizedServers = [];

  for (const server of inputServers) {
    if (!server || typeof server !== 'object') continue;
    const copy = { ...server };
    const hasHeaders = copy.headers && typeof copy.headers === 'object' && Object.keys(copy.headers).length > 0;
    if (hasHeaders) {
      const credId = typeof copy.credential === 'string' && copy.credential.trim()
        ? copy.credential.trim()
        : `cred_${sha256Hex(`${botId}:${copy.name ?? copy.url ?? crypto.randomUUID()}`).slice(0, 16)}`;
      nextCreds[credId] = { headers: { ...copy.headers } };
      delete copy.headers;
      copy.credential = credId;
    } else if (typeof copy.credential === 'string' && existingCreds[copy.credential]) {
      nextCreds[copy.credential] = existingCreds[copy.credential];
      delete copy.headers;
    }
    sanitizedServers.push(copy);
  }

  writeAtomicFile(botToolsConfigPath(homeDir), `${JSON.stringify({ servers: sanitizedServers }, null, 2)}\n`);
  const credsFile = botCredentialsPath(metaRoot, botId);
  if (Object.keys(nextCreds).length > 0) {
    writeAtomicFile(credsFile, `${JSON.stringify(nextCreds, null, 2)}\n`);
  } else if (fs.existsSync(credsFile)) {
    fs.unlinkSync(credsFile);
  }
  return { servers: sanitizedServers, credentialIds: Object.keys(nextCreds) };
}

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
