'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { randomUUID } = require('crypto');
const { getDesktopDshHome, tryGetDesktopDshHome } = require('../shared/dsh-home');
const { DROPPED, OFFICIAL_TEMPLATE_BUNDLES, listInstalledPlugins } = require('./plugins');
const { isValidGithubSpec, isValidPackageName } = require('../host/install-dsh-plugin-client');
const { replaceDirJournaled, commitStagedDir, recoverImportTransactions, reconcileImportTransactionsSync, overlayDir, nextOpId, parentChainIsLinkFree } = require('./import-transaction');

// Harness now persists current sessions as session.v3.jsonl(.zstd); keep the
// legacy name for older official homes and imported desktop sessions.
const SESSION_LOG = /^session(?:\.v3)?\.jsonl(?:\.zstd)?$/i;
const SESSION_PLAIN = /^session(?:\.v3)?\.jsonl$/i;
const SESSION_ZSTD = /^session(?:\.v3)?\.jsonl\.zstd$/i;
/** Harness preset/fixture sessions under official `_no-cwd/preset-*`; not user import candidates. */
const HARNESS_PRESET_SESSION_REL = /^_no-cwd\/preset-/;

function isHarnessPresetSessionRel(rel) {
  return HARNESS_PRESET_SESSION_REL.test(String(rel || ''));
}
const UNSUPPORTED_DB = /\.db$/i;
const PATH_TRAVERSAL = /(^|[\\/])\.\.([\\/]|$)/;
const LOCAL_SPEC = /^(file:|link:|workspace:)/i;
/** Registry semver spec from the official profile manifest (`1.2.3`, `^1.2.3`, `~1.2.3`). */
const REGISTRY_SEMVER_SPEC = /^[\^~]?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const MCP_FILE = 'mcp-servers.yaml';
const SKILL_DOC = 'SKILL.md';
const ZSTD_MAGIC = 0xFD2FB528;
const SETTINGS_FILE = 'settings.yaml';
const CREDENTIALS_FILE = '.credentials.yaml';
const AGENT_PRESETS_DIR = '.agent-presets';
const PRESET_COMPOSITION_FILE = 'agent.cordis.yml';
/** Official preset id charset (vendor `dsh-agent-presets` PRESET_ID). */
const PRESET_ID = /^[a-z0-9][a-z0-9-]*$/;
const AGENTS_DOC = 'AGENTS.md';
/** Pseudo settings row for the home-level AGENTS.md instructions file. */
const AGENTS_DOC_SETTING_ID = 'agents-md';
/**
 * settings.yaml sections the import may move, verbatim as whole top-level
 * blocks. Everything else in the document (shell executors, session-log
 * export, onboarding flags, …) stays desktop-owned and is never copied.
 */
const SETTINGS_SECTION_WHITELIST = ['llm-deepseek', 'llm-pi-ai', 'agent-default-model', 'vision-fallback', 'ui-theme'];
/** Sections whose `apiKeyEnv` fields reference `.credentials.yaml` refs. */
const CREDENTIAL_REF_SECTIONS = new Set(['llm-deepseek', 'llm-pi-ai']);
/** `llm-deepseek` resolves this ref when the section spells no `apiKeyEnv`. */
const DEEPSEEK_DEFAULT_CREDENTIAL_REF = 'DEEPSEEK_API_KEY';
/** Official credential ref charset (vendor `dsh-credentials` REF_PATTERN). */
const CREDENTIAL_REF_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** A column-0 `key:` line opening one top-level YAML section. */
const TOP_LEVEL_SECTION = /^([A-Za-z_][A-Za-z0-9_-]*):/;

function officialDshHome() {
  return path.join(os.homedir(), '.dsh');
}

function defaultAgentsSkillsRoot() {
  return path.join(os.homedir(), '.agents', 'skills');
}

function resolveSourceHome(sourceHome) {
  const raw = typeof sourceHome === 'string' && sourceHome.trim() ? sourceHome.trim() : officialDshHome();
  return path.resolve(raw);
}

function destHome(explicit) {
  if (typeof explicit === 'string' && explicit.trim()) {
    return path.resolve(explicit.trim());
  }
  return tryGetDesktopDshHome() || getDesktopDshHome();
}

function journalPath(userDataDir) {
  return path.join(userDataDir, 'import-journal.json');
}

function isUnsafeRel(rel) {
  return !rel || PATH_TRAVERSAL.test(rel) || path.isAbsolute(rel);
}

function isInside(root, target) {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  const rel = path.relative(resolvedRoot, resolvedTarget);
  return rel === '' || (Boolean(rel) && !rel.startsWith('..') && !path.isAbsolute(rel));
}

function* walkSessionDirectoryEntries(sessionsRoot) {
  const found = [];
  const stack = [sessionsRoot];
  while (stack.length) {
    const dir = stack.pop();
    const entries = yield dir;
    const logs = entries.filter((entry) => entry.isFile() && SESSION_LOG.test(entry.name));
    const dbs = entries.filter((entry) => entry.isFile() && UNSUPPORTED_DB.test(entry.name));
    if (logs.length) {
      const encodings = new Set(logs.map((entry) => (entry.name.endsWith('.zstd') ? 'zstd' : 'plain')));
      found.push({
        abs: dir,
        rel: path.relative(sessionsRoot, dir).split(path.sep).join('/'),
        logs: logs.map((entry) => entry.name),
        mixedEncoding: encodings.size > 1,
        unsupported: false,
      });
      continue;
    }
    if (dbs.length) {
      found.push({
        abs: dir,
        rel: path.relative(sessionsRoot, dir).split(path.sep).join('/'),
        logs: dbs.map((entry) => entry.name),
        mixedEncoding: false,
        unsupported: true,
      });
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name !== '.' && entry.name !== '..') {
        stack.push(path.join(dir, entry.name));
      }
    }
  }
  return found.sort((a, b) => a.rel.localeCompare(b.rel));
}

function walkSessionDirs(sessionsRoot) {
  const walk = walkSessionDirectoryEntries(sessionsRoot);
  let step = walk.next();
  while (!step.done) {
    let entries = [];
    try { entries = fs.readdirSync(step.value, { withFileTypes: true }); } catch {}
    step = walk.next(entries);
  }
  return step.value;
}

async function walkSessionDirsAsync(sessionsRoot) {
  const walk = walkSessionDirectoryEntries(sessionsRoot);
  let step = walk.next();
  while (!step.done) {
    let entries = [];
    try { entries = await fs.promises.readdir(step.value, { withFileTypes: true }); } catch {}
    step = walk.next(entries);
  }
  return step.value;
}

function emptySessionMeta() {
  return {
    id: '',
    cwd: '',
    title: '',
    createdAt: '',
    compressedLog: false,
  };
}

function idFromSessionRel(rel) {
  const text = String(rel || '');
  const slash = text.lastIndexOf('/');
  return slash === -1 ? text : text.slice(slash + 1);
}

/**
 * Fold one JSONL line into display meta. Last `session/title` wins.
 * @param {{ id: string, cwd: string, title: string, createdAt: string }} meta
 * @param {string} line
 */
function applySessionJsonlLine(meta, line) {
  let row;
  try {
    row = JSON.parse(line);
  } catch {
    return;
  }
  if (!row || typeof row !== 'object') {
    return;
  }
  if (row.type === 'session') {
    if (typeof row.id === 'string' && row.id) {
      meta.id = row.id;
    }
    if (typeof row.cwd === 'string' && row.cwd) {
      meta.cwd = row.cwd;
    }
    if (typeof row.createdAt === 'number' && Number.isFinite(row.createdAt)) {
      meta.createdAt = String(row.createdAt);
    } else if (typeof row.createdAt === 'string' && row.createdAt) {
      meta.createdAt = row.createdAt;
    }
    return;
  }
  if (row.type === 'session/title') {
    const title = row.data && typeof row.data.title === 'string'
      ? row.data.title
      : (typeof row.title === 'string' ? row.title : '');
    if (title.trim()) {
      meta.title = title.trim();
    }
  }
}

function foldSessionJsonlText(meta, text) {
  const chunks = String(text || '').split(/\n/);
  for (const line of chunks) {
    if (line) {
      applySessionJsonlLine(meta, line);
    }
  }
}

/**
 * Locate complete concatenated Zstandard frames (harness session layout).
 * Port of vendor scanZstdFrames; fail-soft callers catch thrown errors.
 * @param {Buffer} buffer
 * @returns {{ start: number, end: number }[]}
 */
function scanZstdFrames(buffer) {
  const frames = [];
  let offset = 0;
  while (offset < buffer.length) {
    const start = offset;
    if (buffer.length - offset < 4) {
      break;
    }
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) {
      throw new Error(`invalid zstd magic at ${offset}`);
    }
    offset += 4;
    if (offset === buffer.length) {
      break;
    }
    const descriptor = buffer.readUInt8(offset);
    offset += 1;
    if ((descriptor & 0x18) !== 0) {
      throw new Error(`reserved zstd frame-header bit at ${offset - 1}`);
    }
    const contentSizeFlag = descriptor >>> 6;
    const singleSegment = (descriptor & 0x20) !== 0;
    const checksum = (descriptor & 0x04) !== 0;
    const dictionaryFlag = descriptor & 0x03;
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag;
    const contentSizeBytes = contentSizeFlag === 0
      ? (singleSegment ? 1 : 0)
      : (1 << contentSizeFlag);
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes;
    if (buffer.length - offset < remainingHeaderBytes) {
      break;
    }
    offset += remainingHeaderBytes;
    for (;;) {
      if (buffer.length - offset < 3) {
        return frames;
      }
      const blockHeader = buffer.readUIntLE(offset, 3);
      offset += 3;
      const lastBlock = (blockHeader & 1) !== 0;
      const blockType = (blockHeader >>> 1) & 0x03;
      const blockSize = blockHeader >>> 3;
      if (blockType === 0x03) {
        throw new Error(`reserved zstd block type at ${offset - 3}`);
      }
      const payloadBytes = blockType === 0x01 ? 1 : blockSize;
      if (buffer.length - offset < payloadBytes) {
        return frames;
      }
      offset += payloadBytes;
      if (lastBlock) {
        break;
      }
    }
    if (checksum) {
      if (buffer.length - offset < 4) {
        return frames;
      }
      offset += 4;
    }
    frames.push({ start, end: offset });
  }
  return frames;
}

function readPlainSessionMeta(file) {
  const meta = emptySessionMeta();
  try {
    foldSessionJsonlText(meta, fs.readFileSync(file, 'utf8'));
  } catch {
    // corrupt or unreadable log — keep empty meta
  }
  return meta;
}

function readZstdSessionMeta(file) {
  const meta = emptySessionMeta();
  meta.compressedLog = true;
  if (typeof zlib.zstdDecompressSync !== 'function') {
    return meta;
  }
  let buffer;
  try {
    buffer = fs.readFileSync(file);
  } catch {
    return meta;
  }
  return foldZstdSessionMeta(meta, buffer);
}

function foldZstdSessionMeta(meta, buffer) {
  let frames;
  try {
    frames = scanZstdFrames(buffer);
  } catch {
    return meta;
  }
  if (!frames.length) {
    return meta;
  }
  meta.compressedLog = false;
  for (const frame of frames) {
    try {
      const text = zlib.zstdDecompressSync(buffer.subarray(frame.start, frame.end)).toString('utf8');
      foldSessionJsonlText(meta, text);
    } catch {
      // skip one bad frame; keep prior meta
    }
  }
  return meta;
}

/**
 * Read display fields from a session dir without changing the import key (`rel`).
 * Prefers plaintext `session.jsonl`; otherwise uses Node built-in zstd (no extra dep).
 * @param {{ abs: string, rel: string, logs: string[], unsupported: boolean }} row
 */
function readSessionDisplayMeta(row) {
  if (!row || row.unsupported) {
    return {
      ...emptySessionMeta(),
      id: idFromSessionRel(row && row.rel),
    };
  }
  const logs = Array.isArray(row.logs) ? row.logs : [];
  const plain = logs.find((name) => SESSION_PLAIN.test(name));
  if (plain) {
    const meta = readPlainSessionMeta(path.join(row.abs, plain));
    if (!meta.id) {
      meta.id = idFromSessionRel(row.rel);
    }
    return meta;
  }
  const zstd = logs.find((name) => SESSION_ZSTD.test(name));
  if (zstd) {
    const meta = readZstdSessionMeta(path.join(row.abs, zstd));
    if (!meta.id) {
      meta.id = idFromSessionRel(row.rel);
    }
    return meta;
  }
  return {
    ...emptySessionMeta(),
    id: idFromSessionRel(row.rel),
  };
}

async function readSessionDisplayMetaAsync(row) {
  if (!row || row.unsupported) return readSessionDisplayMeta(row);
  const logs = Array.isArray(row.logs) ? row.logs : [];
  const plain = logs.find((name) => SESSION_PLAIN.test(name));
  const zstd = plain ? undefined : logs.find((name) => SESSION_ZSTD.test(name));
  const meta = emptySessionMeta();
  if (zstd) meta.compressedLog = true;
  if (plain || (zstd && typeof zlib.zstdDecompressSync === 'function')) {
    try {
      const buffer = await fs.promises.readFile(path.join(row.abs, plain || zstd));
      if (plain) foldSessionJsonlText(meta, buffer.toString('utf8'));
      else foldZstdSessionMeta(meta, buffer);
    } catch {
      // Keep the same fail-soft metadata as the synchronous import API.
    }
  }
  if (!meta.id) meta.id = idFromSessionRel(row.rel);
  return meta;
}

/**
 * Best-effort `name` from SKILL.md YAML frontmatter.
 * @param {string} skillDir
 * @returns {string}
 */
function readSkillDisplayName(skillDir) {
  try {
    const text = fs.readFileSync(path.join(skillDir, SKILL_DOC), 'utf8');
    const fence = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!fence) {
      return '';
    }
    const match = fence[1].match(/^name:\s*(.+)\s*$/m);
    if (!match) {
      return '';
    }
    let value = match[1].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    return value.trim();
  } catch {
    return '';
  }
}

function destHasSession(destSessions, rel) {
  const target = path.join(destSessions, ...rel.split('/'));
  if (!fs.existsSync(target)) {
    return false;
  }
  try {
    return fs.readdirSync(target).some((name) => SESSION_LOG.test(name));
  } catch {
    return false;
  }
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Reinstall spec for one manifest row, or null when the row cannot be
 * reinstalled through a supported channel. Supported channels:
 * - `github:owner/repo[#ref]` specs (existing marketplace channel);
 * - registry semver specs, reinstalled as `name@<semver>` (`dsh plugin add`).
 * Anything else (tarball URLs, git+ URLs, npm aliases, dist-tags) must not
 * reach `pnpm add`, so the scan pre-marks it `unsupported`.
 * @param {string} name - manifest dependency name.
 * @param {string} spec - manifest dependency spec.
 * @returns {string | null}
 */
function pluginReinstallSpec(name, spec) {
  const value = String(spec || '').trim();
  if (isValidGithubSpec(value)) {
    return value;
  }
  if (isValidPackageName(name) && REGISTRY_SEMVER_SPEC.test(value)) {
    return `${name}@${value}`;
  }
  return null;
}

function pluginCandidates(sourceHome) {
  const manifest = readJson(path.join(sourceHome, 'profiles', 'web', 'package.json'));
  const dependencies = manifest?.dependencies && typeof manifest.dependencies === 'object'
    ? manifest.dependencies
    : {};
  const installed = new Set((listInstalledPlugins().plugins || []).map((row) => row.name));
  return Object.entries(dependencies).map(([name, spec]) => {
    const value = String(spec || '').trim();
    const reason = OFFICIAL_TEMPLATE_BUNDLES.has(name)
      ? 'template'
      : DROPPED.includes(name)
        ? 'dropped'
        : LOCAL_SPEC.test(value)
          ? 'local-spec'
          : pluginReinstallSpec(name, value) === null
            ? 'unsupported'
            : '';
    return {
      name,
      spec: value,
      skipped: Boolean(reason),
      reason,
      alreadyInstalled: installed.has(name),
    };
  });
}

function coerceYaml(value) {
  const raw = String(value ?? '').trim();
  if (!raw) {
    return '';
  }
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    const inner = raw.slice(1, -1);
    try {
      return JSON.parse(raw.startsWith('"') ? raw : `"${inner.replace(/"/g, '\\"')}"`);
    } catch {
      return inner;
    }
  }
  if (raw === 'true') {
    return true;
  }
  if (raw === 'false') {
    return false;
  }
  if (raw === 'null' || raw === '~') {
    return null;
  }
  if (/^-?\d+(\.\d+)?$/.test(raw)) {
    return Number(raw);
  }
  return raw;
}

function parseMcpServersYaml(text) {
  const servers = [];
  let current = null;
  let inHeaders = false;
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    if (!rawLine.trim() || rawLine.trim().startsWith('#')) {
      continue;
    }
    const indent = rawLine.match(/^ */)[0].length;
    const line = rawLine.trim();
    if (line === 'servers:') {
      current = null;
      inHeaders = false;
      continue;
    }
    if (line.startsWith('- ')) {
      current = {};
      servers.push(current);
      inHeaders = false;
      const rest = line.slice(2).trim();
      if (rest.includes(':')) {
        const idx = rest.indexOf(':');
        const key = rest.slice(0, idx).trim();
        const val = rest.slice(idx + 1);
        if (key === 'headers' && !String(val).trim()) {
          inHeaders = true;
          current.headers = {};
        } else {
          current[key] = coerceYaml(val);
        }
      }
      continue;
    }
    if (!current) {
      continue;
    }
    const idx = line.indexOf(':');
    if (idx === -1) {
      continue;
    }
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1);
    if (key === 'headers' && !String(val).trim()) {
      inHeaders = true;
      current.headers = {};
      continue;
    }
    if (inHeaders && indent >= 6) {
      current.headers = current.headers || {};
      current.headers[key] = coerceYaml(val);
      continue;
    }
    inHeaders = false;
    current[key] = coerceYaml(val);
  }
  return servers.filter((row) => row && row.id != null && String(row.id));
}

function readMcpServers(home) {
  return parseMcpServersYaml(readTextFile(path.join(home, MCP_FILE)) || '');
}

function dumpYamlScalar(value) {
  if (value === true || value === false) {
    return String(value);
  }
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'number') {
    return String(value);
  }
  const text = String(value);
  if (text === '' || /[:#{}[\],&*?!|>%@`]|^\s|\s$|\n/.test(text)) {
    return JSON.stringify(text);
  }
  return text;
}

function dumpMcpServersYaml(servers) {
  const lines = ['servers:'];
  for (const server of servers) {
    let first = true;
    for (const [key, value] of Object.entries(server)) {
      if (key === 'headers' && value && typeof value === 'object' && !Array.isArray(value)) {
        lines.push(`${first ? '  - ' : '    '}headers:`);
        first = false;
        for (const [headerKey, headerVal] of Object.entries(value)) {
          lines.push(`      ${headerKey}: ${dumpYamlScalar(headerVal)}`);
        }
        continue;
      }
      if (Array.isArray(value)) {
        lines.push(`${first ? '  - ' : '    '}${key}:`);
        first = false;
        for (const item of value) {
          lines.push(`      - ${dumpYamlScalar(item)}`);
        }
        continue;
      }
      if (value && typeof value === 'object') {
        continue;
      }
      lines.push(`${first ? '  - ' : '    '}${key}: ${dumpYamlScalar(value)}`);
      first = false;
    }
  }
  return `${lines.join('\n')}\n`;
}

function publicMcpRow(server, destIds) {
  const id = String(server.id);
  return {
    id,
    name: server.serverName || server.name || id,
    endpoint: server.url || server.command || '',
    enabled: server.enabled !== false,
    conflict: destIds.has(id),
  };
}

function isSkillPackage(dir) {
  try {
    return fs.existsSync(path.join(dir, SKILL_DOC));
  } catch {
    return false;
  }
}

function listSkillPackages(root, prefix) {
  const found = [];
  if (!root || !fs.existsSync(root)) {
    return found;
  }
  let stat;
  try {
    stat = fs.statSync(root);
  } catch {
    return found;
  }
  if (!stat.isDirectory()) {
    return found;
  }
  if (isSkillPackage(root)) {
    const name = path.basename(root);
    if (!name.startsWith('.')) {
      found.push({
        id: `${prefix}:${name}`,
        name,
        displayName: readSkillDisplayName(root) || name,
        destName: name,
        abs: path.resolve(root),
        source: prefix,
      });
    }
    return found;
  }
  let entries = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === '.' || entry.name === '..' || entry.name.startsWith('.')) {
      continue;
    }
    const abs = path.join(root, entry.name);
    if (!isSkillPackage(abs)) {
      continue;
    }
    found.push({
      id: `${prefix}:${entry.name}`,
      name: entry.name,
      displayName: readSkillDisplayName(abs) || entry.name,
      destName: entry.name,
      abs: path.resolve(abs),
      source: prefix,
    });
  }
  return found.sort((a, b) => a.id.localeCompare(b.id));
}

function collectSkills({ source, extraSkillDirs, agentsSkillsRoot, destSkills }) {
  const roots = [
    { prefix: 'home', dir: path.join(source, 'skills') },
    { prefix: 'agents', dir: agentsSkillsRoot || defaultAgentsSkillsRoot() },
  ];
  const extras = Array.isArray(extraSkillDirs) ? extraSkillDirs : [];
  extras.forEach((dir, index) => {
    if (typeof dir === 'string' && dir.trim()) {
      roots.push({ prefix: extras.length === 1 ? 'extra' : `extra${index}`, dir: path.resolve(dir.trim()) });
    }
  });
  const seen = new Set();
  const skills = [];
  for (const root of roots) {
    for (const row of listSkillPackages(root.dir, root.prefix)) {
      if (seen.has(row.id) || !isInside(root.dir, row.abs)) {
        continue;
      }
      seen.add(row.id);
      skills.push({
        ...row,
        conflict: destHasSkill(destSkills, row.destName),
      });
    }
  }
  // Cross-root same-destination collision: `home:foo` and `agents:foo` both
  // write `destSkills/foo`. Tag every member of a colliding group so the UI
  // can require an explicit single-source choice instead of silently
  // overwriting one root's package with another's.
  const byDest = new Map();
  for (const row of skills) {
    const key = process.platform === 'win32' ? row.destName.toLowerCase() : row.destName;
    if (!byDest.has(key)) byDest.set(key, []);
    byDest.get(key).push(row);
  }
  for (const group of byDest.values()) {
    if (group.length > 1) {
      for (const row of group) {
        row.sourceCollision = group.map((peer) => peer.id);
      }
    }
  }
  return { skills, skillRoots: roots.map((row) => path.resolve(row.dir)) };
}

function destHasSkill(destSkills, name) {
  if (!name || isUnsafeRel(name)) {
    return false;
  }
  return isSkillPackage(path.join(destSkills, name));
}

function readTextFile(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (error) {
    // Only absence is empty. Permission/I/O/path errors leave the existing
    // document unknown, so no merge may replace it with source-only data.
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

/**
 * Split one YAML document's text into raw top-level blocks so whitelisted
 * sections move verbatim — comments, nesting, and formatting inside a block
 * survive because the text is never re-rendered. Lines before the first
 * top-level key (comments, `%` directives) stay in `preamble`.
 * @param {string} text
 * @returns {{ preamble: string[], order: string[], blocks: Map<string, string[]> }}
 */
function splitTopLevelSections(text) {
  const preamble = [];
  const order = [];
  const blocks = new Map();
  let current = null;
  for (const line of String(text || '').split(/\r?\n/)) {
    const match = line.match(TOP_LEVEL_SECTION);
    if (match) {
      current = [];
      if (!blocks.has(match[1])) {
        order.push(match[1]);
      }
      blocks.set(match[1], current);
    }
    if (current) {
      current.push(line);
    } else {
      preamble.push(line);
    }
  }
  return { preamble, order, blocks };
}

function renderTopLevelSections({ preamble, order, blocks }) {
  const lines = [...preamble];
  for (const key of order) {
    const block = blocks.get(key);
    if (block) {
      lines.push(...block);
    }
  }
  const text = lines.join('\n').replace(/\n+$/, '');
  return text ? `${text}\n` : '';
}

/** Reject links (including junction ancestors) and unknown inspection state. */
function inspectPrivateImportFile(file) {
  const parent = path.dirname(path.resolve(file));
  if (!parentChainIsLinkFree(parent, path.parse(parent).root)) {
    throw new Error('unsafe-destination-parent-link');
  }
  let stat;
  try {
    stat = fs.lstatSync(file);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) {
    throw new Error('unsafe-destination-file-link');
  }
  return stat;
}

function sameImportFile(a, b) {
  return Boolean(a && b && a.dev === b.dev && a.ino === b.ino);
}

/**
 * Same-directory atomic publication: never open/truncate the live file.
 * Exclusive creation owns a random 0600 staging inode; descriptor writes do
 * not follow a preplanted temporary link. Check parents and both leaves again
 * before publication, and remove only our own staging inode on failure.
 * These path checks do not provide OS-level protection against a concurrent
 * actor changing ancestors between the final check and rename/unlink.
 */
function writeFileAtomicPrivate(file, text) {
  inspectPrivateImportFile(file);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  inspectPrivateImportFile(file);
  const tmp = `${file}.import-tmp-${randomUUID()}`;
  let fd;
  let owned;
  let created = false;
  try {
    fd = fs.openSync(tmp, 'wx', 0o600);
    created = true;
    owned = fs.fstatSync(fd);
    if (!sameImportFile(owned, inspectPrivateImportFile(tmp))) {
      throw new Error('unsafe-destination-temp-changed');
    }
    fs.writeFileSync(fd, text, 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    inspectPrivateImportFile(file);
    if (!sameImportFile(owned, inspectPrivateImportFile(tmp))) {
      throw new Error('unsafe-destination-temp-changed');
    }
    fs.renameSync(tmp, file);
    created = false;
  } catch (error) {
    try {
      if (fd !== undefined) {
        fs.closeSync(fd);
        fd = undefined;
      }
      if (created) {
        const current = inspectPrivateImportFile(tmp);
        if (current) {
          if (!sameImportFile(owned, current)) {
            throw new Error('unsafe-destination-temp-changed');
          }
          fs.unlinkSync(tmp);
        }
      }
    } catch (cleanupError) {
      throw new Error(`${error.message}; import-temp-cleanup-failed: ${cleanupError.message}`, { cause: error });
    }
    throw error;
  }
}

/**
 * Credential refs one copied section block references. `apiKeyEnv` values are
 * scalar env-var-like names; `llm-deepseek` falls back to its default ref
 * when the section spells none.
 * @param {string} sectionId
 * @param {string[]} blockLines
 * @returns {string[]}
 */
function credentialRefsOfSection(sectionId, blockLines) {
  if (!CREDENTIAL_REF_SECTIONS.has(sectionId)) {
    return [];
  }
  const refs = new Set();
  for (const line of blockLines || []) {
    const match = line.match(/^\s*apiKeyEnv:\s*(.+?)\s*(?:#.*)?$/);
    if (!match) {
      continue;
    }
    let value = match[1].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (CREDENTIAL_REF_NAME.test(value)) {
      refs.add(value);
    }
  }
  if (sectionId === 'llm-deepseek' && refs.size === 0) {
    refs.add(DEEPSEEK_DEFAULT_CREDENTIAL_REF);
  }
  return [...refs];
}

function readSettingsSections(home) {
  return splitTopLevelSections(readTextFile(path.join(home, SETTINGS_FILE)) || '');
}

/**
 * Importable settings rows: whitelisted `settings.yaml` sections present in
 * the source, plus the home-level AGENTS.md pseudo row. Rows carry only ids
 * and referenced credential ref *names*; never a secret value.
 */
function settingsCandidates(sourceHome, destTarget) {
  const source = readSettingsSections(sourceHome);
  const dest = readSettingsSections(destTarget);
  const rows = [];
  for (const id of SETTINGS_SECTION_WHITELIST) {
    if (!source.blocks.has(id)) {
      continue;
    }
    rows.push({
      id,
      conflict: dest.blocks.has(id),
      credentialRefs: credentialRefsOfSection(id, source.blocks.get(id)),
    });
  }
  if (fs.existsSync(path.join(sourceHome, AGENTS_DOC))) {
    rows.push({
      id: AGENTS_DOC_SETTING_ID,
      conflict: fs.existsSync(path.join(destTarget, AGENTS_DOC)),
      credentialRefs: [],
    });
  }
  return rows;
}

/**
 * Parse the flat `refs:` map of one `.credentials.yaml` without touching
 * `records` (OAuth state stays behind). Only single-line scalar entries are
 * importable; the raw value text (with its quoting) is kept verbatim so the
 * copy never re-renders a secret.
 * @param {string} home
 * @returns {Map<string, { raw: string, unsupported: boolean }>}
 */
function readCredentialRefs(home) {
  return parseCredentialRefs(readTextFile(path.join(home, CREDENTIALS_FILE)));
}

function parseCredentialRefs(text) {
  const refs = new Map();
  if (text === null) {
    return refs;
  }
  let inRefs = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^refs:\s*(#.*)?$/.test(line)) {
      inRefs = true;
      continue;
    }
    if (/^\S/.test(line)) {
      inRefs = false;
      continue;
    }
    if (!inRefs) {
      continue;
    }
    const match = line.match(/^ {2}([A-Za-z_][A-Za-z0-9_]*):(.*)$/);
    if (!match) {
      continue;
    }
    const rawValue = match[2];
    const trimmed = rawValue.trim();
    // Only single-line plain/quoted scalars move: an empty value (nested map),
    // a block scalar header (| / >), or an anchor/alias would copy a line
    // whose meaning depends on text this merge does not carry.
    const unsupported = trimmed === ''
      || /^[|>&*]/.test(trimmed);
    refs.set(match[1], { raw: rawValue, unsupported });
  }
  return refs;
}

/**
 * Merge selected refs into dest `.credentials.yaml` by inserting raw entry
 * lines into (or creating) its top-level `refs:` block; `records` and every
 * other line are preserved byte-for-byte. Results carry ref names only.
 * @returns {{ ref: string, status: string }[]}
 */
function importCredentialRefs({ sourceHome, destTarget, refs, overwrite }) {
  const wanted = [...new Set(refs)].filter((ref) => CREDENTIAL_REF_NAME.test(ref));
  const results = [];
  if (!wanted.length) {
    return results;
  }
  const sourceRefs = readCredentialRefs(sourceHome);
  const destFile = path.join(destTarget, CREDENTIALS_FILE);
  inspectPrivateImportFile(destFile);
  const destText = readTextFile(destFile);
  const destRefs = parseCredentialRefs(destText);
  const additions = [];
  const replacements = new Map();
  for (const ref of wanted) {
    const entry = sourceRefs.get(ref);
    if (!entry) {
      results.push({ ref, status: 'missing' });
      continue;
    }
    if (entry.unsupported) {
      results.push({ ref, status: 'unsupported' });
      continue;
    }
    if (destRefs.has(ref)) {
      if (!overwrite) {
        results.push({ ref, status: 'skipped' });
        continue;
      }
      replacements.set(ref, `  ${ref}:${entry.raw}`);
      results.push({ ref, status: 'copied' });
      continue;
    }
    additions.push(`  ${ref}:${entry.raw}`);
    results.push({ ref, status: 'copied' });
  }
  if (!additions.length && !replacements.size) {
    return results;
  }
  if (destText === null) {
    writeFileAtomicPrivate(destFile, ['version: 1', 'refs:', ...additions, ''].join('\n'));
    return results;
  }
  const lines = destText.split(/\r?\n/);
  const out = [];
  let inRefs = false;
  let refsSeen = false;
  let insertedAt = -1;
  for (const line of lines) {
    if (/^refs:\s*(#.*)?$/.test(line)) {
      inRefs = true;
      refsSeen = true;
      out.push(line);
      insertedAt = out.length;
      continue;
    }
    if (inRefs && /^\S/.test(line)) {
      inRefs = false;
    }
    if (inRefs) {
      const match = line.match(/^ {2}([A-Za-z_][A-Za-z0-9_]*):/);
      if (match && replacements.has(match[1])) {
        out.push(replacements.get(match[1]));
        insertedAt = out.length;
        continue;
      }
      out.push(line);
      insertedAt = out.length;
      continue;
    }
    out.push(line);
  }
  if (refsSeen) {
    out.splice(insertedAt, 0, ...additions);
  } else {
    while (out.length && out[out.length - 1].trim() === '') {
      out.pop();
    }
    out.push('refs:', ...additions);
  }
  const rendered = `${out.join('\n').replace(/\n+$/, '')}\n`;
  writeFileAtomicPrivate(destFile, rendered);
  return results;
}

/** Agent preset directories under the source `.agent-presets/` root. */
function presetCandidates(sourceHome, destTarget) {
  const root = path.join(sourceHome, AGENT_PRESETS_DIR);
  let entries = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const rows = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !PRESET_ID.test(entry.name)) {
      continue;
    }
    const abs = path.join(root, entry.name);
    rows.push({
      id: entry.name,
      abs,
      broken: !fs.existsSync(path.join(abs, PRESET_COMPOSITION_FILE)),
      conflict: fs.existsSync(path.join(destTarget, AGENT_PRESETS_DIR, entry.name)),
    });
  }
  return rows.sort((a, b) => a.id.localeCompare(b.id));
}

function scanImport({
  sourceHome,
  destHome: dest,
  extraSkillDirs,
  agentsSkillsRoot,
} = {}) {
  const source = resolveSourceHome(sourceHome);
  const target = destHome(dest);
  const sourceSessions = path.join(source, 'sessions');
  const destSessions = path.join(target, 'sessions');
  const sessions = walkSessionDirs(sourceSessions)
    .filter((row) => !isHarnessPresetSessionRel(row.rel))
    .map((row) => {
      const meta = readSessionDisplayMeta(row);
      return {
        ...row,
        id: meta.id,
        cwd: meta.cwd,
        title: meta.title,
        createdAt: meta.createdAt,
        compressedLog: Boolean(meta.compressedLog),
        conflict: !row.unsupported && destHasSession(destSessions, row.rel),
      };
    });
  return finishImportScan({ source, target, extraSkillDirs, agentsSkillsRoot }, sessions);
}

// The renderer scan uses asynchronous filesystem reads. Keep the synchronous
// API for callers that already own a non-interactive import snapshot.
async function scanImportAsync({ sourceHome, destHome: dest, extraSkillDirs, agentsSkillsRoot } = {}) {
  const source = resolveSourceHome(sourceHome);
  const target = destHome(dest);
  const rows = (await walkSessionDirsAsync(path.join(source, 'sessions')))
    .filter((row) => !isHarnessPresetSessionRel(row.rel));
  const sessions = new Array(rows.length);
  let nextRow = 0;
  await Promise.all(Array.from({ length: Math.min(4, rows.length) }, async () => {
    while (nextRow < rows.length) {
      const index = nextRow++;
      const row = rows[index];
      const meta = await readSessionDisplayMetaAsync(row);
      let conflict = false;
      if (!row.unsupported) {
        try {
          const entries = await fs.promises.readdir(path.join(target, 'sessions', row.rel));
          conflict = entries.some((name) => SESSION_LOG.test(name));
        } catch {}
      }
      sessions[index] = { ...row, id: meta.id, cwd: meta.cwd, title: meta.title,
        createdAt: meta.createdAt, compressedLog: Boolean(meta.compressedLog), conflict };
    }
  }));
  const scan = finishImportScan({ source, target, extraSkillDirs, agentsSkillsRoot }, sessions, false);
  scan.destEmpty = (await walkSessionDirsAsync(path.join(target, 'sessions'))).length === 0;
  return scan;
}

function finishImportScan({ source, target, extraSkillDirs, agentsSkillsRoot }, sessions, destEmpty) {
  const destSessions = path.join(target, 'sessions');
  const attachmentsDir = path.join(source, 'attachments');
  const plugins = pluginCandidates(source);
  const { skills, skillRoots } = collectSkills({
    source,
    extraSkillDirs,
    agentsSkillsRoot,
    destSkills: path.join(target, 'skills'),
  });
  const destMcpIds = new Set(readMcpServers(target).map((row) => String(row.id)));
  const mcp = readMcpServers(source).map((row) => publicMcpRow(row, destMcpIds));
  const settings = settingsCandidates(source, target);
  const presets = presetCandidates(source, target);
  const hasAttachments = fs.existsSync(attachmentsDir);
  const sourceHasData = sessions.some((row) => !row.unsupported)
    || hasAttachments
    || skills.length > 0
    || plugins.some((row) => !row.skipped)
    || mcp.length > 0
    || settings.length > 0
    || presets.some((row) => !row.broken);
  return {
    sourceHome: source,
    destHome: target,
    homeDir: os.homedir(),
    destEmpty: destEmpty === undefined ? walkSessionDirs(destSessions).length === 0 : destEmpty,
    sourceHasData,
    sessions,
    plugins,
    skills,
    mcp,
    settings,
    presets,
    skillRoots,
    extraSkillDirs: Array.isArray(extraSkillDirs) ? extraSkillDirs.filter(Boolean) : [],
    hasAttachments,
  };
}

function shouldHoldForImport(scan) {
  return Boolean(scan && scan.destEmpty && scan.sourceHasData);
}

/** Whether any directory under `sessionsRoot` holds session logs or legacy dbs (destEmpty peer). */
function hasAnySessionDir(sessionsRoot) {
  if (!fs.existsSync(sessionsRoot)) {
    return false;
  }
  const stack = [sessionsRoot];
  while (stack.length) {
    const dir = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isFile() && (SESSION_LOG.test(entry.name) || UNSUPPORTED_DB.test(entry.name))) {
        return true;
      }
      if (entry.isDirectory()) {
        stack.push(path.join(dir, entry.name));
      }
    }
  }
  return false;
}

/** Whether the source holds at least one importable (non-preset, log-backed) session. */
function hasImportableSession(sessionsRoot) {
  if (!fs.existsSync(sessionsRoot)) {
    return false;
  }
  const stack = [{ dir: sessionsRoot, rel: '' }];
  while (stack.length) {
    const { dir, rel } = stack.pop();
    if (isHarnessPresetSessionRel(rel)) {
      continue;
    }
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    if (entries.some((entry) => entry.isFile() && SESSION_LOG.test(entry.name))) {
      return true;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        stack.push({ dir: path.join(dir, entry.name), rel: rel ? `${rel}/${entry.name}` : entry.name });
      }
    }
  }
  return false;
}

function hasAnySkillPackage(root) {
  if (!root || !fs.existsSync(root)) {
    return false;
  }
  if (isSkillPackage(root)) {
    return !path.basename(root).startsWith('.');
  }
  let entries = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return false;
  }
  return entries.some((entry) => entry.isDirectory()
    && !entry.name.startsWith('.')
    && isSkillPackage(path.join(root, entry.name)));
}

/**
 * Shallow cold-start gate probe: same `destEmpty && sourceHasData` verdict as
 * `shouldHoldForImport(scanImport(...))` but every check early-exits at its
 * first hit and no session display meta is read (no jsonl parse, no zstd
 * decompress, no conflict marking). The full `scanImport` stays import-page
 * only.
 * @returns {{ destEmpty: boolean, sourceHasData: boolean, hold: boolean }}
 */
function probeImportHold({
  sourceHome,
  destHome: dest,
  extraSkillDirs,
  agentsSkillsRoot,
} = {}) {
  const source = resolveSourceHome(sourceHome);
  const target = destHome(dest);
  const destEmpty = !hasAnySessionDir(path.join(target, 'sessions'));
  if (!destEmpty) {
    return { destEmpty, sourceHasData: false, hold: false };
  }
  const skillRoots = [
    path.join(source, 'skills'),
    agentsSkillsRoot || defaultAgentsSkillsRoot(),
    ...(Array.isArray(extraSkillDirs) ? extraSkillDirs : [])
      .filter((dir) => typeof dir === 'string' && dir.trim())
      .map((dir) => path.resolve(dir.trim())),
  ];
  const sourceHasData = hasImportableSession(path.join(source, 'sessions'))
    || fs.existsSync(path.join(source, 'attachments'))
    || skillRoots.some((root) => hasAnySkillPackage(root))
    || pluginCandidates(source).some((row) => !row.skipped)
    || readMcpServers(source).length > 0
    || settingsCandidates(source, target).length > 0
    || presetCandidates(source, target).some((row) => !row.broken);
  return { destEmpty, sourceHasData, hold: destEmpty && sourceHasData };
}

function writeJournal(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

/**
 * A journal file must decode to the COMPLETE supported journal shape — not
 * merely any object with a `phase` key. Cold recovery
 * (`recoverInterruptedImport`) and manual admission (`journalIsBlocked`)
 * must agree on the SAME verdict for a file that exists on disk: a present
 * record that cannot establish recovery state is unknown state and fails
 * closed, never a "safe" read.
 *
 * Contract: object (non-array) + `phase` in SUPPORTED_JOURNAL_PHASES +
 * `destHome` string (the tree the journal governs). When the optional
 * `txnIds` inventory is present it must be an array of strings — a
 * malformed inventory cannot be interpreted safely because recovery
 * derives transaction authorization from it.
 *
 * Anything else present on disk — `null`, `[]`, `{}`,
 * `{"phase":"copying"}` without destHome, an unknown phase value, a bare
 * string/number — is a real file whose content is NOT a supported journal:
 * unknown state (fails closed), not the same thing as a missing file.
 */
const SUPPORTED_JOURNAL_PHASES = new Set(['copying', 'blocked', 'recovered', 'done']);

function isUsableJournalShape(parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return false;
  }
  if (typeof parsed.phase !== 'string' || !SUPPORTED_JOURNAL_PHASES.has(parsed.phase)) {
    return false;
  }
  if (typeof parsed.destHome !== 'string' || !parsed.destHome) {
    return false;
  }
  if ('txnIds' in parsed
      && (!Array.isArray(parsed.txnIds)
          || !parsed.txnIds.every((id) => typeof id === 'string' && id))) {
    return false;
  }
  // The destination-binding map is optional, but when present it must be a
  // well-formed opId→dest record — recovery derives per-transaction
  // destination authority from it, so a malformed map cannot be trusted.
  if ('txnDests' in parsed
      && (!parsed.txnDests || typeof parsed.txnDests !== 'object' || Array.isArray(parsed.txnDests)
          || !Object.values(parsed.txnDests).every((v) => typeof v === 'string' && v))) {
    return false;
  }
  return true;
}

function readImportJournal(userDataDir) {
  try {
    const parsed = JSON.parse(fs.readFileSync(journalPath(userDataDir), 'utf8'));
    // Valid JSON is not necessarily a valid journal: `null`, `[]`, `{}` and
    // other non-conforming shapes are present-but-unusable content — unknown
    // recovery state, surfaced as unreadable so admission and recovery both
    // refuse rather than read missing fields as "nothing pending".
    if (!isUsableJournalShape(parsed)) {
      return { unreadable: true, invalid: true, error: 'journal-not-a-journal' };
    }
    return parsed;
  } catch (error) {
    // Missing journal is absence; a present-but-unreadable/malformed journal
    // is UNKNOWN state — the caller must not treat it as "nothing pending".
    if (error && error.code === 'ENOENT') {
      return null;
    }
    return { unreadable: true, error: error && error.message ? error.message : String(error) };
  }
}

/**
 * Whether a journal read result must hold the recovery/admission boundary.
 * True for an explicit `blocked` phase AND for an unreadable/malformed
 * journal (unknown state fails closed — it may conceal pending work).
 * `null` (missing) is not blocked.
 */
function journalIsBlocked(journal) {
  return Boolean(journal) && (journal.phase === 'blocked' || journal.unreadable === true);
}

/**
 * Register an opId in the userData-owned top journal's `txnIds` list. This
 * is the importer-owned inventory recovery consults: only registered
 * transactions may be reconciled, so a payload-dropped txn file is never
 * executed. Best-effort — a registry write failure leaves the op
 * unregistered (recovery then preserves it as unknown rather than mutating).
 */
function registerTxnId(journalFile, opId, dest) {
  if (!journalFile || !opId) return;
  // Registration is a REQUIRED write-ahead step: if the inventory cannot be
  // persisted, the transaction must not begin — proceeding would mutate the
  // tree under an operation recovery cannot attribute. Surface the failure
  // as a no-mutation refusal rather than silently continuing unregistered.
  // The inventory binds each opId to its intended destination (`txnDests`):
  // an owned ID must only authorize the transaction recorded for its own
  // target, never a lookalike sidecar elsewhere in the recovery tree.
  const journal = readImportJournal(path.dirname(journalFile)) || {};
  const ids = Array.isArray(journal.txnIds) ? journal.txnIds : [];
  if (!ids.includes(opId)) ids.push(opId);
  const txnDests = (journal.txnDests && typeof journal.txnDests === 'object' && !Array.isArray(journal.txnDests))
    ? { ...journal.txnDests }
    : {};
  if (typeof dest === 'string' && dest) txnDests[opId] = dest;
  writeJournal(journalFile, { ...journal, txnIds: ids, txnDests });
}

function removeImportTmpDirs(root) {
  const removed = [];
  if (!root || !fs.existsSync(root)) {
    return removed;
  }
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const abs = path.join(dir, entry.name);
      if (entry.name.endsWith('.import-tmp')) {
        try {
          fs.rmSync(abs, { recursive: true, force: true });
          removed.push(abs);
        } catch {
          // Leftover staging dirs that cannot be removed stay harmless: the
          // next copyDirAtomic clears its own target tmp before copying.
        }
        continue;
      }
      stack.push(abs);
    }
  }
  return removed.sort();
}

function samePath(left, right) {
  const a = path.resolve(String(left || ''));
  const b = path.resolve(String(right || ''));
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/**
 * Consume a `phase: 'copying'` journal left behind by a crash mid-import:
 * remove stale `.import-tmp` staging dirs under the desktop home (sessions,
 * skills, and the attachments staging dir) and mark the journal `recovered`
 * so the launcher can tell the user to re-run the idempotent, conflict-
 * skipping import. Only the journal's own destHome is cleaned, and only when
 * it matches the resolved desktop home; official sources are never touched.
 * @param {{ userDataDir?: string, destHome?: string }} [options]
 * @returns {{ recovered: boolean, removedTmp: string[] }}
 */
function recoverInterruptedImport({ userDataDir, destHome: dest } = {}) {
  const target = destHome(dest);
  const journalDir = userDataDir || path.join(target, '..');
  const journal = readImportJournal(journalDir);
  if (!journal) {
    return { recovered: false, removedTmp: [] };
  }
  // An unreadable/malformed journal cannot prove recovery state — hold it
  // as blocked rather than treating it as nothing to recover. The shared
  // reader already normalizes every invalid shape (missing destHome,
  // unsupported phase, malformed inventory, non-object content) to
  // `{unreadable:true}` — recovery and manual admission now consume the
  // same verdict, so no second, stricter interpretation is needed here.
  if (journal.unreadable === true) {
    return { recovered: false, removedTmp: [], blocked: true };
  }
  if (!samePath(journal.destHome, target)) {
    return { recovered: false, removedTmp: [] };
  }
  // A journal already marked `blocked` persists: recovery must keep blocking
  // until the unresolved transactions reconcile, even across later launches
  // with a valid session present (no auto-start bypass).
  const alreadyBlocked = journal.phase === 'blocked';
  if (journal.phase !== 'copying' && !alreadyBlocked) {
    return { recovered: false, removedTmp: [] };
  }
  // Reconcile per-operation transaction journals: they carry the
  // authoritative state for staged/replacing/committed swaps. Legacy bare
  // `.import-tmp`/`.import-bak` dirs without a journal are preserved, not
  // deleted — they may be the only surviving copy of the user's data.
  // Importer-owned inventory: only opIds the importer itself registered in
  // the userData-owned top journal may be followed. A transaction file
  // discovered inside imported payload is preserved as `unregistered`, not
  // executed.
  // A field-less legacy journal authorizes NOTHING: matching filenames and
  // internally consistent paths establish where a record points, not who
  // created it — imported payload can carry such a record, so absent
  // ownership evidence must mean an empty authorized set, not permissive
  // discovery-based mutation. Registered IDs are additionally bound to
  // their recorded destinations via `txnDests` so an owned opId cannot
  // authorize a lookalike sidecar elsewhere in the tree.
  const allowedOpIds = new Set(Array.isArray(journal.txnIds) ? journal.txnIds : []);
  const allowedTxnDests = (journal.txnDests && typeof journal.txnDests === 'object' && !Array.isArray(journal.txnDests))
    ? journal.txnDests
    : undefined;
  const outcome = reconcileImportTransactionsSync(target, { allowedOpIds, allowedTxnDests });
  const blocked = outcome.pending.length > 0;
  // An already-`blocked` journal that still has pending transactions must
  // keep reporting unresolved recovery (recovered:false) so the gate holds;
  // reporting `recovered` again would let a later launch auto-start past the
  // preserved staging dirs. Only when pending is fully cleared does the
  // journal move to `recovered`.
  const stillUnresolved = alreadyBlocked && blocked;
  writeJournal(journalPath(journalDir), {
    ...journal,
    phase: blocked ? 'blocked' : 'recovered',
    recoveredAt: new Date().toISOString(),
    removedTmp: outcome.removedTmp,
    pendingTxns: outcome.pending,
  });
  // `recovered` reports that the recovery pass ran (journal was consumed),
  // not that everything resolved — `blocked`/`pendingTxns` carry the unsafe
  // remainder that must hold the launcher.
  return { recovered: !stillUnresolved, removedTmp: outcome.removedTmp, pendingTxns: outcome.pending, blocked };
}

function importIsCancelled(signal) {
  return Boolean(signal && signal.aborted === true);
}

/**
 * Progress sink shared by the import phases. `onProgress` receives
 * `{ phase, done, total, rel|id|name }` per completed item plus a terminal
 * `done`/`cancelled` event from runImport.
 */
function emitImportProgress(onProgress, event) {
  if (typeof onProgress === 'function') {
    onProgress(event);
  }
}

/**
 * Tag a progress event with the import operation's identity so the renderer
 * can drop events belonging to a stale/earlier run.
 */
function progressOf(opId, event) {
  return { ...event, op: opId };
}

// Async so each copy yields the event loop: large session dirs and the
// attachments tree no longer stall every main-process IPC, and a cancel
// request can be observed between items. The actual swap is a journaled
// transaction so a crash mid-replace keeps at least one intact copy.
async function copyDirAtomic(from, to, { journalFile } = {}) {
  // Write-ahead inventory: allocate the opId and register it BEFORE staging
  // or any rename — and the registration must SUCCEED before mutation.
  // A crash inside the transaction then leaves an attributable journal; a
  // failed registration is a no-mutation refusal (we do not copy under an
  // operation recovery cannot prove ownership of).
  const opId = nextOpId();
  try {
    registerTxnId(journalFile, opId, to);
  } catch (error) {
    const wrapped = new Error(`transaction-registration-failed: ${error.message || error}`);
    wrapped.needsRecovery = false;
    throw wrapped;
  }
  const result = await replaceDirJournaled(from, to, { opId });
  if (!result.ok) {
    const error = new Error(result.error || 'replace-failed');
    error.needsRecovery = result.needsRecovery === true;
    throw error;
  }
  return result;
}

/**
 * Merge `sourceDir` into the tree at `destDir` without deleting files that
 * exist only at the destination. `overwrite` controls whether a source file
 * replaces a same-path destination file; destination-only entries always
 * survive. The merge is staged and published through the same journaled
 * transaction used for plain replaces.
 */
async function mergeDirJournaled(sourceDir, destDir, { overwrite, journalFile } = {}) {
  const opId = nextOpId();
  // Register (required) before staging/commit for the same write-ahead
  // reason as copyDirAtomic — a failed registration refuses before any
  // staging filesystem operation touches the destination tree.
  try {
    registerTxnId(journalFile, opId, destDir);
  } catch (error) {
    const wrapped = new Error(`transaction-registration-failed: ${error.message || error}`);
    wrapped.needsRecovery = false;
    throw wrapped;
  }
  // The staging boundary must be validated BEFORE the first staging
  // filesystem operation, not only at commit. A destination-home parent that
  // is a junction/symlink would receive staging writes outside the permitted
  // tree during mkdir/cp/overlay — inspect the parent chain up front (an
  // inspection failure must not read as "link-free").
  {
    const destParent = path.dirname(destDir);
    let linkFree = false;
    try {
      linkFree = parentChainIsLinkFree(destParent, path.parse(path.resolve(destParent)).root);
    } catch {
      linkFree = false;
    }
    if (!linkFree) {
      const error = new Error('unsafe-destination-link');
      error.needsRecovery = false;
      throw error;
    }
  }
  const tmp = `${destDir}.import-tmp-${opId}`;
  const parent = path.dirname(destDir);
  await fs.promises.mkdir(parent, { recursive: true });
  await fs.promises.rm(tmp, { recursive: true, force: true });
  try {
    // Stage the union: destination first, then overlay source files.
    if (fs.existsSync(destDir)) {
      await fs.promises.cp(destDir, tmp, { recursive: true });
    } else {
      await fs.promises.mkdir(tmp, { recursive: true });
    }
    if (fs.existsSync(sourceDir)) {
      await overlayDir(sourceDir, tmp, { overwrite });
    }
  } catch (error) {
    await fs.promises.rm(tmp, { recursive: true, force: true });
    throw error;
  }
  const result = await commitStagedDir(tmp, destDir, { opId });
  if (!result.ok) {
    const error = new Error(result.error || 'replace-failed');
    error.needsRecovery = result.needsRecovery === true;
    throw error;
  }
}

async function importSessions({
  sourceHome,
  destHome: dest,
  selectedRels,
  overwrite = false,
  userDataDir,
  extraSkillDirs,
  agentsSkillsRoot,
  importAttachments,
  scan: providedScan,
  signal,
  onProgress,
  deferJournalDone = false,
} = {}) {
  const scan = providedScan || await scanImportAsync({ sourceHome, destHome: dest, extraSkillDirs, agentsSkillsRoot });
  const chosen = Array.isArray(selectedRels) ? selectedRels : scan.sessions.map((row) => row.rel);
  const journalFile = journalPath(userDataDir || path.join(scan.destHome, '..'));
  const results = [];
  // Initialize an explicit, versioned inventory up front. A journal that
  // carries an (initially empty) `txnIds` array enforces the importer-owned
  // transaction rule — field absence would otherwise be indistinguishable
  // from a legacy journal and disable the inventory restriction.
  writeJournal(journalFile, { phase: 'copying', sourceHome: scan.sourceHome, destHome: scan.destHome, items: [], txnIds: [] });

  const byRel = new Map(scan.sessions.map((row) => [row.rel, row]));
  let cancelled = false;
  let done = 0;
  for (const rel of chosen) {
    // Cancel between items: each copyDirAtomic is all-or-nothing, so a stop
    // here leaves no partial session and the journal stays 'copying' — the
    // next cold start's recoverInterruptedImport can clean up and the user
    // gets the resumable hint.
    if (importIsCancelled(signal)) {
      cancelled = true;
      break;
    }
    if (isUnsafeRel(rel)) {
      results.push({ rel, status: 'rejected', error: 'invalid-path' });
    } else {
      const row = byRel.get(rel);
      if (!row) {
        results.push({ rel, status: 'missing' });
      } else if (row.unsupported || row.mixedEncoding) {
        results.push({ rel, status: 'unsupported' });
      } else if (row.conflict && !overwrite) {
        results.push({ rel, status: 'skipped' });
      } else {
        try {
          await copyDirAtomic(row.abs, path.join(scan.destHome, 'sessions', ...rel.split('/')), { journalFile });
          results.push({ rel, status: 'copied' });
        } catch (error) {
          const row0 = { rel, status: 'failed', error: error.message || String(error) };
          if (error.needsRecovery === true) {
            row0.needsRecovery = true;
            results.push(row0);
            // An unresolved transaction must stop every later write, not just
            // this phase: break out of the session loop now.
            break;
          }
          results.push(row0);
        }
      }
    }
    done += 1;
    emitImportProgress(onProgress, { phase: 'sessions', done, total: chosen.length, rel });
  }

  let attachments = 'absent';
  let attachmentsNeedsRecovery = false;
  const shouldCopyAttachments = importAttachments !== false;
  const sourceAttachments = path.join(scan.sourceHome, 'attachments');
  if (!cancelled && importIsCancelled(signal)) {
    cancelled = true;
  }
  // A session transaction that already needs recovery must stop the
  // attachment phase too — checking only the cancel signal here let staging
  // and replacement continue after the destination was left unresolved.
  const sessionsNeedRecovery = results.some((row) => row.needsRecovery === true);
  if (cancelled) {
    const needsRecovery0 = attachmentsNeedsRecovery || sessionsNeedRecovery;
    return { ok: false, cancelled: true, sessions: results, attachments, journal: journalFile, needsRecovery: needsRecovery0 };
  }
  if (!sessionsNeedRecovery && shouldCopyAttachments && fs.existsSync(sourceAttachments)) {
    emitImportProgress(onProgress, { phase: 'attachments', done: 0, total: 1 });
    try {
      await mergeDirJournaled(sourceAttachments, path.join(scan.destHome, 'attachments'), { overwrite, journalFile });
      attachments = 'copied';
    } catch (error) {
      attachments = `failed:${error.message || String(error)}`;
      if (error.needsRecovery === true) attachmentsNeedsRecovery = true;
    }
    emitImportProgress(onProgress, { phase: 'attachments', done: 1, total: 1 });
  }

  const attachmentsFailed = typeof attachments === 'string' && attachments.startsWith('failed:');
  const needsRecovery = attachmentsNeedsRecovery
    || results.some((row) => row.needsRecovery === true);
  // runImport() commits the journal only after every phase lands; an
  // interrupted later phase must remain recoverable instead of looking done.
  // An unresolved transaction is reported `blocked`, never `done` — even on
  // the standalone importSessions() path used directly by callers/tests.
  if (!deferJournalDone) {
    // Preserve the importer-owned txnIds inventory through this transition —
    // rebuilding the journal without it would drop the registry precisely
    // when recovery consults it to authorize per-transaction journals.
    const priorTxnIds = (() => {
      try {
        const existing = readImportJournal(path.dirname(journalFile));
        return Array.isArray(existing?.txnIds) ? existing.txnIds : [];
      } catch {
        return [];
      }
    })();
    const priorTxnDests = (() => {
      try {
        const existing = readImportJournal(path.dirname(journalFile));
        return (existing?.txnDests && typeof existing.txnDests === 'object' && !Array.isArray(existing.txnDests))
          ? existing.txnDests
          : {};
      } catch {
        return {};
      }
    })();
    writeJournal(journalFile, {
      phase: needsRecovery ? 'blocked' : 'done',
      txnIds: priorTxnIds,
      txnDests: priorTxnDests,
      sourceHome: scan.sourceHome,
      destHome: scan.destHome,
      items: results,
      attachments,
    });
  }
  const ok = results.every((row) => row.status !== 'failed') && !attachmentsFailed;
  return { ok, sessions: results, attachments, journal: journalFile, needsRecovery };
}

async function importPlugins({
  sourceHome,
  destHome: dest,
  selectedNames,
  overwrite = false,
  installPlugin,
  extraSkillDirs,
  agentsSkillsRoot,
  scan: providedScan,
  signal,
  onProgress,
} = {}) {
  const scan = providedScan || await scanImportAsync({ sourceHome, destHome: dest, extraSkillDirs, agentsSkillsRoot });
  const chosen = new Set(
    Array.isArray(selectedNames)
      ? selectedNames
      : scan.plugins.filter((row) => !row.skipped).map((row) => row.name),
  );
  if (Array.isArray(selectedNames) && chosen.size === 0) {
    return { ok: true, plugins: [] };
  }
  const run = typeof installPlugin === 'function' ? installPlugin : null;
  const results = [];
  if (!run) {
    return { ok: false, error: 'missing-installer', plugins: results };
  }
  let done = 0;
  for (const row of scan.plugins) {
    if (!chosen.has(row.name)) {
      continue;
    }
    if (importIsCancelled(signal)) {
      break;
    }
    if (row.skipped) {
      results.push({ name: row.name, status: 'skipped', reason: row.reason });
    } else if (row.alreadyInstalled && !overwrite) {
      results.push({ name: row.name, status: 'skipped', reason: 'installed' });
    } else {
      const spec = pluginReinstallSpec(row.name, row.spec);
      if (spec === null) {
        results.push({ name: row.name, status: 'skipped', reason: 'unsupported' });
      } else {
        try {
          const installed = await run(spec);
          results.push({
            name: row.name,
            status: installed?.ok === false ? 'failed' : 'installed',
            error: installed?.error,
          });
        } catch (error) {
          results.push({ name: row.name, status: 'failed', error: error.message || String(error) });
        }
      }
    }
    done += 1;
    emitImportProgress(onProgress, { phase: 'plugins', done, total: chosen.size, name: row.name });
  }
  return { ok: results.every((row) => row.status !== 'failed'), plugins: results };
}

function destNameFromSkillId(id) {
  const text = String(id || '');
  const idx = text.indexOf(':');
  return idx === -1 ? text : text.slice(idx + 1);
}

async function importSkills({ scan, selectedIds, overwrite, signal, onProgress, journalFile }) {
  const chosen = Array.isArray(selectedIds) ? selectedIds : [];
  const byId = new Map((scan.skills || []).map((row) => [row.id, row]));
  const results = [];
  let done = 0;
  // Reject ambiguous selections before any write: two distinct source roots
  // may not target the same destName in one run regardless of `overwrite`.
  {
    const byDest = new Map();
    for (const id of chosen) {
      const row = byId.get(id);
      if (!row) continue;
      const key = process.platform === 'win32' ? row.destName.toLowerCase() : row.destName;
      if (!byDest.has(key)) byDest.set(key, []);
      byDest.get(key).push(id);
    }
    const ambiguous = [...byDest.entries()].filter(([, ids]) => new Set(ids).size > 1);
    if (ambiguous.length) {
      for (const [, ids] of ambiguous) {
        for (const id of ids) {
          results.push({ id, status: 'failed', error: 'ambiguous-destination', peers: ids });
        }
      }
      return results;
    }
  }
  for (const id of chosen) {
    if (importIsCancelled(signal)) {
      break;
    }
    const destName = destNameFromSkillId(id);
    if (isUnsafeRel(destName)) {
      results.push({ id, status: 'rejected', error: 'invalid-path' });
    } else {
      const row = byId.get(id);
      if (!row) {
        results.push({ id, status: 'missing' });
      } else if (!(scan.skillRoots || []).some((root) => isInside(root, row.abs)) || isUnsafeRel(row.destName)) {
        results.push({ id, status: 'rejected', error: 'invalid-path' });
      } else if (row.conflict && !overwrite) {
        results.push({ id, status: 'skipped' });
      } else {
        // The conflict verdict above is scan-time. Re-check the live
        // destination right before writing so a directory that appeared
        // since the scan is skipped rather than silently overwritten.
        const liveDest = path.join(scan.destHome, 'skills', row.destName);
        if (fs.existsSync(liveDest) && !overwrite) {
          results.push({ id, status: 'skipped' });
          done += 1;
          emitImportProgress(onProgress, { phase: 'skills', done, total: chosen.length, id });
          continue;
        }
        try {
          await copyDirAtomic(row.abs, path.join(scan.destHome, 'skills', row.destName), { journalFile });
          results.push({ id, status: 'copied' });
        } catch (error) {
          const rec = { id, status: 'failed', error: error.message || String(error) };
          if (error.needsRecovery === true) {
            rec.needsRecovery = true;
            results.push(rec);
            break;
          }
          results.push(rec);
        }
      }
    }
    done += 1;
    emitImportProgress(onProgress, { phase: 'skills', done, total: chosen.length, id });
  }
  results.needsRecovery = results.some((row) => row.needsRecovery === true);
  return results;
}

/**
 * Move selected whitelisted settings sections verbatim into the dest
 * `settings.yaml` (whole top-level blocks; conflict-skip by default), copy
 * the AGENTS.md pseudo row as one file, then sync the credential refs the
 * selected llm sections reference. Results and journal rows carry section
 * ids and ref names only — never a secret value.
 * @returns {{ settings: {id:string,status:string}[], credentials: {ref:string,status:string}[] }}
 */
function importSettings({ scan, selectedIds, overwrite }) {
  const chosen = Array.isArray(selectedIds) ? selectedIds : [];
  const results = [];
  const credentials = [];
  if (!chosen.length) {
    return { settings: results, credentials };
  }
  const source = readSettingsSections(scan.sourceHome);
  const destFile = path.join(scan.destHome, SETTINGS_FILE);
  inspectPrivateImportFile(destFile);
  const dest = readSettingsSections(scan.destHome);
  const wantedRefs = [];
  let changed = false;
  for (const id of chosen) {
    if (id === AGENTS_DOC_SETTING_ID) {
      const sourceDoc = path.join(scan.sourceHome, AGENTS_DOC);
      if (!fs.existsSync(sourceDoc)) {
        results.push({ id, status: 'missing' });
        continue;
      }
      const destDoc = path.join(scan.destHome, AGENTS_DOC);
      if (fs.existsSync(destDoc) && !overwrite) {
        results.push({ id, status: 'skipped' });
        continue;
      }
      try {
        writeFileAtomicPrivate(destDoc, fs.readFileSync(sourceDoc, 'utf8'));
        results.push({ id, status: 'copied' });
      } catch (error) {
        results.push({ id, status: 'failed', error: error.message || String(error) });
      }
      continue;
    }
    if (!SETTINGS_SECTION_WHITELIST.includes(id)) {
      results.push({ id, status: 'rejected', error: 'not-whitelisted' });
      continue;
    }
    const block = source.blocks.get(id);
    if (!block) {
      results.push({ id, status: 'missing' });
      continue;
    }
    if (dest.blocks.has(id) && !overwrite) {
      results.push({ id, status: 'skipped' });
      wantedRefs.push(...credentialRefsOfSection(id, block));
      continue;
    }
    if (!dest.blocks.has(id)) {
      dest.order.push(id);
    }
    dest.blocks.set(id, [...block]);
    changed = true;
    results.push({ id, status: 'copied' });
    wantedRefs.push(...credentialRefsOfSection(id, block));
  }
  if (changed) {
    try {
      writeFileAtomicPrivate(destFile, renderTopLevelSections(dest));
    } catch (error) {
      for (const row of results) {
        if (row.status === 'copied' && row.id !== AGENTS_DOC_SETTING_ID) {
          row.status = 'failed';
          row.error = error.message || String(error);
        }
      }
      return { settings: results, credentials };
    }
  }
  if (wantedRefs.length) {
    credentials.push(...importCredentialRefs({
      sourceHome: scan.sourceHome,
      destTarget: scan.destHome,
      refs: wantedRefs,
      overwrite,
    }));
  }
  return { settings: results, credentials };
}

/** Copy selected agent preset directories into dest `.agent-presets/` (conflict-skip). */
async function importPresets({ scan, selectedIds, overwrite, signal, onProgress, journalFile }) {
  const chosen = Array.isArray(selectedIds) ? selectedIds : [];
  const byId = new Map((scan.presets || []).map((row) => [row.id, row]));
  const results = [];
  let done = 0;
  for (const id of chosen) {
    if (importIsCancelled(signal)) {
      break;
    }
    if (isUnsafeRel(id) || !PRESET_ID.test(String(id || ''))) {
      results.push({ id, status: 'rejected', error: 'invalid-path' });
    } else {
      const row = byId.get(id);
      if (!row) {
        results.push({ id, status: 'missing' });
      } else if (row.broken) {
        results.push({ id, status: 'unsupported' });
      } else if (!isInside(path.join(scan.sourceHome, AGENT_PRESETS_DIR), row.abs)) {
        results.push({ id, status: 'rejected', error: 'invalid-path' });
      } else if (row.conflict && !overwrite) {
        results.push({ id, status: 'skipped' });
      } else {
        try {
          await copyDirAtomic(row.abs, path.join(scan.destHome, AGENT_PRESETS_DIR, id), { journalFile });
          results.push({ id, status: 'copied' });
        } catch (error) {
          const rec = { id, status: 'failed', error: error.message || String(error) };
          if (error.needsRecovery === true) {
            rec.needsRecovery = true;
            results.push(rec);
            break;
          }
          results.push(rec);
        }
      }
    }
    done += 1;
    emitImportProgress(onProgress, { phase: 'presets', done, total: chosen.length, id });
  }
  results.needsRecovery = results.some((row) => row.needsRecovery === true);
  return results;
}

function importMcp({ scan, selectedIds, overwrite }) {
  const chosen = Array.isArray(selectedIds) ? selectedIds : [];
  const results = [];
  if (!chosen.length) {
    return results;
  }
  const sourceServers = readMcpServers(scan.sourceHome);
  const destFile = path.join(scan.destHome, MCP_FILE);
  inspectPrivateImportFile(destFile);
  const destServers = readMcpServers(scan.destHome);
  const destById = new Map(destServers.map((row) => [String(row.id), row]));
  let changed = false;
  for (const id of chosen) {
    const record = sourceServers.find((row) => String(row.id) === String(id));
    if (!record) {
      results.push({ id, status: 'missing' });
      continue;
    }
    if (destById.has(String(id)) && !overwrite) {
      results.push({ id, status: 'skipped' });
      continue;
    }
    destById.set(String(id), record);
    changed = true;
    results.push({ id, status: 'copied' });
  }
  if (changed) {
    writeFileAtomicPrivate(destFile, dumpMcpServersYaml([...destById.values()]));
  }
  return results;
}

async function runImport(options = {}) {
  const selectedRels = Array.isArray(options.selectedRels) ? options.selectedRels : [];
  // Deduplicate the selected skill ids once, up front: the ambiguity
  // preflight AND the execution loop both consume the deduped set so a
  // repeated id cannot copy the same source twice.
  const selectedSkillIds = [...new Set(Array.isArray(options.selectedSkillIds) ? options.selectedSkillIds : [])];
  const selectedPluginNames = Array.isArray(options.selectedPluginNames) ? options.selectedPluginNames : [];
  const selectedMcpIds = Array.isArray(options.selectedMcpIds) ? options.selectedMcpIds : [];
  const selectedSettingIds = Array.isArray(options.selectedSettingIds) ? options.selectedSettingIds : [];
  const selectedPresetIds = Array.isArray(options.selectedPresetIds) ? options.selectedPresetIds : [];
  const importAttachments = options.importAttachments === true;
  const empty = selectedRels.length === 0
    && selectedSkillIds.length === 0
    && selectedPluginNames.length === 0
    && selectedMcpIds.length === 0
    && selectedSettingIds.length === 0
    && selectedPresetIds.length === 0
    && !importAttachments;
  const scan = await scanImportAsync(options);
  const journalFile = journalPath(options.userDataDir || path.join(scan.destHome, '..'));
  const signal = options.signal;
  const opId = typeof options.opId === 'string' && options.opId ? options.opId : nextOpId();
  const rawProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
  // Every progress event carries this run's identity; a renderer can drop an
  // event whose `op` does not match the operation it is currently tracking.
  const onProgress = rawProgress ? (event) => rawProgress(progressOf(opId, event)) : null;
  if (empty) {
    emitImportProgress(onProgress, { phase: 'done', done: 0, total: 0 });
    return {
      ok: true,
      empty: true,
      sessions: [],
      skills: [],
      plugins: [],
      mcp: [],
      settings: [],
      credentials: [],
      presets: [],
      attachments: 'absent',
      journal: journalFile,
      opId,
    };
  }

  // R5: preflight skill-destination ambiguity BEFORE any phase writes —
  // sessions/attachments must not land while the selected skill set would be
  // rejected. Two distinct source roots targeting the same destName are
  // ambiguous regardless of `overwrite`.
  {
    const byId0 = new Map((scan.skills || []).map((row) => [row.id, row]));
    const byDest0 = new Map();
    for (const id of new Set(selectedSkillIds)) {
      const row = byId0.get(id);
      if (!row) continue;
      const key = process.platform === 'win32' ? row.destName.toLowerCase() : row.destName;
      if (!byDest0.has(key)) byDest0.set(key, []);
      if (!byDest0.get(key).includes(id)) byDest0.get(key).push(id);
    }
    const ambiguous0 = [...byDest0.entries()].filter(([, ids]) => ids.length > 1);
    if (ambiguous0.length) {
      const skillResults = [];
      for (const [, ids] of ambiguous0) {
        for (const id of ids) {
          skillResults.push({ id, status: 'failed', error: 'ambiguous-destination', peers: ids });
        }
      }
      // No journal entry: the selection was rejected in preflight before any
      // write, so there is nothing to recover and nothing to mark done.
      return {
        ok: false,
        empty: false,
        error: 'ambiguous-destination',
        sessions: [],
        skills: skillResults,
        plugins: [],
        mcp: [],
        settings: [],
        credentials: [],
        presets: [],
        attachments: 'absent',
        journal: journalFile,
        opId,
      };
    }
  }

  // One scan feeds every phase; the importers used to rescan the source each.
  const sessions = await importSessions({
    ...options,
    scan,
    selectedRels,
    importAttachments,
    signal,
    onProgress,
    deferJournalDone: true,
  });
  // R1: a transaction that needs recovery must stop every later mutation
  // phase — continuing plugins/settings/presets after a dest tree is left
  // unresolved would write `done` over an unresolved filesystem state and
  // then bypass recovery on next launch. Latch the flag after EVERY phase so
  // a skill/preset failure stops the phases that follow it too, not only the
  // ones after sessions.
  let recoverySoFar = sessions.needsRecovery === true;

  const skills = (importIsCancelled(signal) || recoverySoFar)
    ? []
    : await importSkills({ scan, selectedIds: selectedSkillIds, overwrite: options.overwrite === true, signal, onProgress, journalFile });
  recoverySoFar = recoverySoFar || skills.needsRecovery === true;
  const plugins = (importIsCancelled(signal) || recoverySoFar)
    ? { ok: true, plugins: [] }
    : await importPlugins({
      ...options,
      scan,
      selectedNames: selectedPluginNames,
      signal,
      onProgress,
    });
  const mcp = (importIsCancelled(signal) || recoverySoFar)
    ? []
    : importMcp({ scan, selectedIds: selectedMcpIds, overwrite: options.overwrite === true });
  const settingsOutcome = (importIsCancelled(signal) || recoverySoFar)
    ? { settings: [], credentials: [] }
    : importSettings({
      scan,
      selectedIds: selectedSettingIds,
      overwrite: options.overwrite === true,
    });
  const presets = (importIsCancelled(signal) || recoverySoFar)
    ? []
    : await importPresets({ scan, selectedIds: selectedPresetIds, overwrite: options.overwrite === true, signal, onProgress, journalFile });
  recoverySoFar = recoverySoFar || presets.needsRecovery === true;

  // Combine recovery flags from every mutating phase.
  const needsRecovery = recoverySoFar
    || skills.needsRecovery === true
    || presets.needsRecovery === true;

  if (needsRecovery) {
    // Leave a persistent blocked journal the cold-start gate and every
    // direct start path must honor. Never record `done` here — that would
    // read as "settled" and let recovery be skipped.
    // Preserve the importer-owned txnIds inventory across this transition:
    // recovery consults it to decide which per-transaction journals are
    // authorized. Rebuilding the journal without it would drop the registry
    // precisely when recovery needs it most.
    const priorTxnIds = (() => {
      try {
        const existing = readImportJournal(path.dirname(journalFile));
        return Array.isArray(existing?.txnIds) ? existing.txnIds : [];
      } catch {
        return [];
      }
    })();
    const priorTxnDests = (() => {
      try {
        const existing = readImportJournal(path.dirname(journalFile));
        return (existing?.txnDests && typeof existing.txnDests === 'object' && !Array.isArray(existing.txnDests))
          ? existing.txnDests
          : {};
      } catch {
        return {};
      }
    })();
    writeJournal(journalFile, {
      phase: 'blocked',
      txnIds: priorTxnIds,
      txnDests: priorTxnDests,
      sourceHome: scan.sourceHome,
      destHome: scan.destHome,
      blockedReason: 'transaction-needs-recovery',
      sessions: sessions.sessions,
      skills,
      presets,
      attachments: sessions.attachments,
      blockedAt: new Date().toISOString(),
    });
    emitImportProgress(onProgress, { phase: 'blocked', done: 0, total: 0 });
    return {
      ok: false,
      empty: false,
      needsRecovery: true,
      error: 'transaction-needs-recovery',
      sessions: sessions.sessions,
      skills,
      plugins: plugins.plugins,
      mcp,
      settings: settingsOutcome.settings,
      credentials: settingsOutcome.credentials,
      presets,
      attachments: sessions.attachments,
      journal: journalFile,
      opId,
    };
  }
  const cancelled = sessions.cancelled === true || importIsCancelled(signal);
  if (cancelled) {
    emitImportProgress(onProgress, { phase: 'cancelled', done: 0, total: 0 });
    return {
      ok: false,
      cancelled: true,
      empty: false,
      sessions: sessions.sessions,
      skills,
      plugins: plugins.plugins,
      mcp,
      settings: settingsOutcome.settings,
      credentials: settingsOutcome.credentials,
      presets,
      attachments: sessions.attachments,
      journal: journalFile,
      opId,
    };
  }
  writeJournal(journalFile, {
    phase: 'done',
    sourceHome: scan.sourceHome,
    destHome: scan.destHome,
    sessions: sessions.sessions,
    skills,
    plugins: plugins.plugins,
    mcp,
    settings: settingsOutcome.settings,
    credentials: settingsOutcome.credentials,
    presets,
    attachments: sessions.attachments,
  });
  const ok = sessions.ok
    && plugins.ok
    && skills.every((row) => row.status !== 'failed')
    && mcp.every((row) => row.status !== 'failed')
    && settingsOutcome.settings.every((row) => row.status !== 'failed')
    && settingsOutcome.credentials.every((row) => row.status !== 'failed')
    && presets.every((row) => row.status !== 'failed');
  emitImportProgress(onProgress, { phase: 'done', done: 1, total: 1 });
  return {
    ok,
    empty: false,
    sessions: sessions.sessions,
    skills,
    plugins: plugins.plugins,
    mcp,
    settings: settingsOutcome.settings,
    credentials: settingsOutcome.credentials,
    presets,
    attachments: sessions.attachments,
    journal: journalFile,
    opId,
  };
}

module.exports = {
  officialDshHome,
  scanImport,
  scanImportAsync,
  shouldHoldForImport,
  probeImportHold,
  importSessions,
  importPlugins,
  importSettings,
  importCredentialRefs,
  importPresets,
  pluginReinstallSpec,
  splitTopLevelSections,
  credentialRefsOfSection,
  readCredentialRefs,
  recoverInterruptedImport,
  readImportJournal,
  journalIsBlocked,
  runImport,
  journalPath,
  SESSION_LOG,
  SETTINGS_SECTION_WHITELIST,
  AGENTS_DOC_SETTING_ID,
};
