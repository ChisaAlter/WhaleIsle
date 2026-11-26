'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const ZSTD_MAGIC = 0xFD2FB528;
const SESSION_PLAIN = /^session(?:\.v3)?\.jsonl$/i;
const SESSION_ZSTD = /^session(?:\.v3)?\.jsonl\.zstd$/i;
const SESSION_LOG = /^session(?:\.v3)?\.jsonl(?:\.zstd)?$/i;
const UNSUPPORTED_DB = /\.db$/i;
const SKILL_DOC = 'SKILL.md';
const MCP_FILE = 'mcp-servers.yaml';
const SETTINGS_FILE = 'settings.yaml';
const AGENT_PRESETS_DIR = '.agent-presets';
const PRESET_COMPOSITION_FILE = 'agent.cordis.yml';
const PRESET_ID = /^[a-z0-9][a-z0-9-]*$/;
const AGENTS_DOC = 'AGENTS.md';
const AGENTS_DOC_SETTING_ID = 'agents-md';
const SETTINGS_SECTION_WHITELIST = ['llm-deepseek', 'llm-pi-ai', 'agent-default-model', 'vision-fallback', 'ui-theme'];
const LOCAL_SPEC = /^(file:|link:|workspace:)/i;
const CHUNK_SIZE = 65536;
const YIELD_BUDGET_MS = 4;
const SESSION_NEEDLE = Buffer.from('"session');

/** @type {((buf: Buffer) => Promise<Buffer>) | null} */
const zstdDecompressAsync = typeof zlib.zstdDecompress === 'function'
  ? (buf) => new Promise((resolve, reject) => zlib.zstdDecompress(buf, (err, out) => (err ? reject(err) : resolve(out))))
  : null;

function yieldMacrotask() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** @param {number} sliceStart */
async function maybeYield(sliceStart) {
  if (Date.now() - sliceStart < YIELD_BUDGET_MS) return sliceStart;
  await yieldMacrotask();
  return Date.now();
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

/** @param {unknown} rel */
function idFromSessionRel(rel) {
  const text = String(rel || '');
  const slash = text.lastIndexOf('/');
  return slash === -1 ? text : text.slice(slash + 1);
}

/**
 * Fold one JSONL line into display meta. Last `session/title` wins.
 * @param {{ id: string, cwd: string, title: string, createdAt: string, compressedLog?: boolean }} meta
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

/** @param {any} meta @param {string} text */
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

/** @param {string} file */
function readPlainSessionMeta(file) {
  const meta = emptySessionMeta();
  try {
    foldSessionJsonlText(meta, fs.readFileSync(file, 'utf8'));
  } catch {
    // corrupt or unreadable log — keep empty meta
  }
  return meta;
}

/** @param {string} file */
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

/** @param {any} meta @param {Buffer} buffer */
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

/** @param {any} meta @param {Buffer} lineBuf */
function applySessionLineBuffer(meta, lineBuf) {
  if (!lineBuf.length) return;
  if (lineBuf.length > 256 && !lineBuf.includes(SESSION_NEEDLE)) return;
  applySessionJsonlLine(meta, lineBuf.toString('utf8'));
}

/** @param {any} meta @param {Buffer} slice @param {Buffer[]} pending */
function consumeJsonlSlice(meta, slice, pending) {
  let start = 0;
  for (;;) {
    const nl = slice.indexOf(0x0a, start);
    if (nl === -1) break;
    const tail = slice.subarray(start, nl);
    if (pending.length) {
      pending.push(tail);
      applySessionLineBuffer(meta, Buffer.concat(pending));
      pending = [];
    } else if (tail.length) {
      applySessionLineBuffer(meta, tail);
    }
    start = nl + 1;
  }
  if (start < slice.length) {
    pending.push(Buffer.from(slice.subarray(start)));
  }
  return pending;
}

/** @param {string} file @param {any} meta */
async function readPlainSessionMetaAsync(file, meta) {
  let fh;
  const chunk = Buffer.allocUnsafe(CHUNK_SIZE);
  /** @type {Buffer[]} */
  let pending = [];
  let sliceStart = Date.now();
  try {
    fh = await fs.promises.open(file, 'r');
    for (;;) {
      sliceStart = await maybeYield(sliceStart);
      const { bytesRead } = await fh.read(chunk, 0, CHUNK_SIZE, null);
      if (!bytesRead) break;
      pending = consumeJsonlSlice(meta, chunk.subarray(0, bytesRead), pending);
    }
    if (pending.length) {
      applySessionLineBuffer(meta, pending.length === 1 ? pending[0] : Buffer.concat(pending));
    }
  } finally {
    if (fh) await fh.close();
  }
}

/** @param {string} file @param {any} meta */
async function readZstdSessionMetaAsync(file, meta) {
  meta.compressedLog = true;
  if (!zstdDecompressAsync) return;
  const buffer = await fs.promises.readFile(file);
  let frames;
  try {
    frames = scanZstdFrames(buffer);
  } catch {
    return;
  }
  if (!frames.length) return;
  meta.compressedLog = false;
  let sliceStart = Date.now();
  for (const frame of frames) {
    sliceStart = await maybeYield(sliceStart);
    try {
      const raw = await zstdDecompressAsync(buffer.subarray(frame.start, frame.end));
      const tail = consumeJsonlSlice(meta, raw, []);
      if (tail.length) applySessionLineBuffer(meta, tail[0]);
    } catch {
      // skip one bad frame; keep prior meta
    }
  }
}

/**
 * Read display metadata asynchronously using chunked streaming for plaintext
 * logs and off-thread libuv decompression for `.jsonl.zstd` logs.
 * @param {{ abs: string, rel: string, logs: string[], unsupported: boolean }} row
 */
async function readSessionDisplayMetaAsync(row) {
  if (!row || row.unsupported) return readSessionDisplayMeta(row);
  const logs = Array.isArray(row.logs) ? row.logs : [];
  const plain = logs.find((name) => SESSION_PLAIN.test(name));
  const zstd = plain ? undefined : logs.find((name) => SESSION_ZSTD.test(name));
  const meta = emptySessionMeta();
  if (plain) {
    try {
      await readPlainSessionMetaAsync(path.join(row.abs, plain), meta);
    } catch {
      // Keep the same fail-soft metadata as the synchronous import API.
    }
  } else if (zstd) {
    try {
      await readZstdSessionMetaAsync(path.join(row.abs, zstd), meta);
    } catch {
      // Keep the same fail-soft metadata as the synchronous import API.
    }
  }
  if (!meta.id) meta.id = idFromSessionRel(row.rel);
  return meta;
}

/** @param {string} file */
async function existsAsync(file) {
  try {
    await fs.promises.access(file);
    return true;
  } catch {
    return false;
  }
}

/** @param {string} file */
async function readTextFileAsync(file) {
  try {
    return await fs.promises.readFile(file, 'utf8');
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }
}

/** @param {string} file */
async function readJsonAsync(file) {
  try {
    return JSON.parse(await fs.promises.readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

/** @param {string} sessionsRoot */
async function walkSessionDirsConcurrentAsync(sessionsRoot) {
  /** @type {Array<{ abs: string, rel: string, logs: string[], mixedEncoding: boolean, unsupported: boolean }>} */
  const found = [];
  const queue = [sessionsRoot];
  let active = 0;
  /** @type {((value?: unknown) => void) | undefined} */
  let notifyIdle;
  /** @param {string} dir @param {number} sliceStart */
  const processDir = async (dir, sliceStart) => {
    sliceStart = await maybeYield(sliceStart);
    /** @type {fs.Dirent[]} */
    let entries = [];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return sliceStart;
    }
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
      return sliceStart;
    }
    if (dbs.length) {
      found.push({
        abs: dir,
        rel: path.relative(sessionsRoot, dir).split(path.sep).join('/'),
        logs: dbs.map((entry) => entry.name),
        mixedEncoding: false,
        unsupported: true,
      });
      return sliceStart;
    }
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name !== '.' && entry.name !== '..') {
        queue.push(path.join(dir, entry.name));
      }
    }
    return sliceStart;
  };
  const worker = async () => {
    active++;
    let sliceStart = Date.now();
    try {
      while (queue.length) {
        const dir = queue.pop();
        if (dir) sliceStart = await processDir(dir, sliceStart);
        notifyIdle?.();
      }
    } finally {
      active--;
      notifyIdle?.();
    }
  };
  while (queue.length || active > 0) {
    while (queue.length && active < 16) void worker();
    if (queue.length || active > 0) await new Promise((resolve) => { notifyIdle = resolve; });
  }
  return found.sort((a, b) => a.rel.localeCompare(b.rel));
}

/** @param {string} sessionsRoot */
async function hasAnySessionDirAsync(sessionsRoot) {
  if (!(await existsAsync(sessionsRoot))) return false;
  const stack = [sessionsRoot];
  let sliceStart = Date.now();
  while (stack.length) {
    sliceStart = await maybeYield(sliceStart);
    const dir = /** @type {string} */ (stack.pop());
    /** @type {fs.Dirent[]} */
    let entries = [];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isFile() && (SESSION_LOG.test(entry.name) || UNSUPPORTED_DB.test(entry.name))) {
        return true;
      }
      if (entry.isDirectory()) stack.push(path.join(dir, entry.name));
    }
  }
  return false;
}

/** @param {string} skillDir */
async function readSkillDisplayNameAsync(skillDir) {
  try {
    const text = await fs.promises.readFile(path.join(skillDir, SKILL_DOC), 'utf8');
    const fence = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!fence) return '';
    const match = fence[1].match(/^name:\s*(.+)\s*$/m);
    if (!match) return '';
    let value = match[1].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    return value.trim();
  } catch {
    return '';
  }
}

/** @param {string} root @param {string} prefix */
async function listSkillPackagesAsync(root, prefix) {
  if (!root) return [];
  let stat;
  try {
    stat = await fs.promises.stat(root);
  } catch {
    return [];
  }
  if (!stat.isDirectory()) return [];
  if (await existsAsync(path.join(root, SKILL_DOC))) {
    const name = path.basename(root);
    if (name.startsWith('.')) return [];
    return [{
      id: `${prefix}:${name}`,
      name,
      displayName: (await readSkillDisplayNameAsync(root)) || name,
      destName: name,
      abs: path.resolve(root),
      source: prefix,
    }];
  }
  /** @type {fs.Dirent[]} */
  let entries = [];
  try {
    entries = await fs.promises.readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const rows = await Promise.all(entries.map(async (entry) => {
    if (!entry.isDirectory() || entry.name === '.' || entry.name === '..' || entry.name.startsWith('.')) return null;
    const abs = path.join(root, entry.name);
    if (!(await existsAsync(path.join(abs, SKILL_DOC)))) return null;
    return {
      id: `${prefix}:${entry.name}`,
      name: entry.name,
      displayName: (await readSkillDisplayNameAsync(abs)) || entry.name,
      destName: entry.name,
      abs: path.resolve(abs),
      source: prefix,
    };
  }));
  /** @type {Array<{ id: string, name: string, displayName: string, destName: string, abs: string, source: string }>} */
  const list = [];
  for (const row of rows) if (row) list.push(row);
  return list.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * @param {{
 *   source: string,
 *   extraSkillDirs?: string[],
 *   agentsSkillsRoot?: string,
 *   destSkills: string,
 *   isInside: (root: string, target: string) => boolean,
 *   isUnsafeRel: (rel: string) => boolean,
 * }} opts
 */
async function collectSkillsAsync({ source, extraSkillDirs, agentsSkillsRoot, destSkills, isInside, isUnsafeRel }) {
  const roots = [
    { prefix: 'home', dir: path.join(source, 'skills') },
    { prefix: 'agents', dir: agentsSkillsRoot || path.join(os.homedir(), '.agents', 'skills') },
  ];
  const extras = Array.isArray(extraSkillDirs) ? extraSkillDirs : [];
  extras.forEach((dir, index) => {
    if (typeof dir === 'string' && dir.trim()) {
      roots.push({ prefix: extras.length === 1 ? 'extra' : `extra${index}`, dir: path.resolve(dir.trim()) });
    }
  });
  const perRoot = await Promise.all(roots.map((root) => listSkillPackagesAsync(root.dir, root.prefix)));
  const seen = new Set();
  /** @type {Array<{ id: string, name: string, displayName: string, destName: string, abs: string, source: string, conflict?: boolean, sourceCollision?: string[] }>} */
  const candidates = [];
  roots.forEach((root, index) => {
    for (const row of perRoot[index]) {
      if (seen.has(row.id) || !isInside(root.dir, row.abs)) continue;
      seen.add(row.id);
      candidates.push(row);
    }
  });
  const skills = await Promise.all(candidates.map(async (row) => ({
    ...row,
    conflict: Boolean(row.destName && !isUnsafeRel(row.destName) && await existsAsync(path.join(destSkills, row.destName, SKILL_DOC))),
  })));
  /** @type {Map<string, typeof skills>} */
  const byDest = new Map();
  for (const row of skills) {
    const key = process.platform === 'win32' ? row.destName.toLowerCase() : row.destName;
    if (!byDest.has(key)) byDest.set(key, []);
    byDest.get(key)?.push(row);
  }
  for (const group of byDest.values()) {
    if (group.length > 1) {
      for (const row of group) row.sourceCollision = group.map((peer) => peer.id);
    }
  }
  return { skills, skillRoots: roots.map((row) => path.resolve(row.dir)) };
}

/** @param {string} sourceHome @param {any} deps */
async function pluginCandidatesAsync(sourceHome, deps) {
  const [manifest, installedResult] = await Promise.all([
    readJsonAsync(path.join(sourceHome, 'profiles', 'web', 'package.json')),
    deps.listInstalledPluginsAsync(),
  ]);
  const dependencies = manifest?.dependencies && typeof manifest.dependencies === 'object' ? manifest.dependencies : {};
  const installed = new Set((installedResult?.plugins || []).map((/** @type {any} */ row) => row.name));
  return Object.entries(dependencies).map(([name, spec]) => {
    const value = String(spec || '').trim();
    const reason = deps.OFFICIAL_TEMPLATE_BUNDLES.has(name)
      ? 'template'
      : deps.DROPPED.includes(name)
        ? 'dropped'
        : LOCAL_SPEC.test(value)
          ? 'local-spec'
          : deps.pluginReinstallSpec(name, value) === null
            ? 'unsupported'
            : '';
    return { name, spec: value, skipped: Boolean(reason), reason, alreadyInstalled: installed.has(name) };
  });
}

/** @param {string} sourceHome @param {string} destTarget @param {any} deps */
async function settingsCandidatesAsync(sourceHome, destTarget, deps) {
  const [sourceRaw, destRaw, hasSourceAgents, hasDestAgents] = await Promise.all([
    readTextFileAsync(path.join(sourceHome, SETTINGS_FILE)),
    readTextFileAsync(path.join(destTarget, SETTINGS_FILE)),
    existsAsync(path.join(sourceHome, AGENTS_DOC)),
    existsAsync(path.join(destTarget, AGENTS_DOC)),
  ]);
  const source = deps.splitTopLevelSections(sourceRaw || '');
  const dest = deps.splitTopLevelSections(destRaw || '');
  const rows = [];
  for (const id of SETTINGS_SECTION_WHITELIST) {
    if (!source.blocks.has(id)) continue;
    rows.push({
      id,
      conflict: dest.blocks.has(id),
      credentialRefs: deps.credentialRefsOfSection(id, source.blocks.get(id)),
    });
  }
  if (hasSourceAgents) {
    rows.push({ id: AGENTS_DOC_SETTING_ID, conflict: hasDestAgents, credentialRefs: [] });
  }
  return rows;
}

/** @param {string} sourceHome @param {string} destTarget */
async function presetCandidatesAsync(sourceHome, destTarget) {
  const root = path.join(sourceHome, AGENT_PRESETS_DIR);
  /** @type {fs.Dirent[]} */
  let entries = [];
  try {
    entries = await fs.promises.readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const rows = await Promise.all(entries.map(async (entry) => {
    if (!entry.isDirectory() || !PRESET_ID.test(entry.name)) return null;
    const abs = path.join(root, entry.name);
    const [hasComposition, hasConflict] = await Promise.all([
      existsAsync(path.join(abs, PRESET_COMPOSITION_FILE)),
      existsAsync(path.join(destTarget, AGENT_PRESETS_DIR, entry.name)),
    ]);
    return { id: entry.name, abs, broken: !hasComposition, conflict: hasConflict };
  }));
  /** @type {Array<{ id: string, abs: string, broken: boolean, conflict: boolean }>} */
  const list = [];
  for (const row of rows) if (row) list.push(row);
  return list.sort((a, b) => a.id.localeCompare(b.id));
}

/** @param {string} sourceSessions @param {string} destSessions @param {(rel: string) => boolean} isHarnessPresetSessionRel */
async function scanSessionsAsync(sourceSessions, destSessions, isHarnessPresetSessionRel) {
  const rows = (await walkSessionDirsConcurrentAsync(sourceSessions))
    .filter((row) => !isHarnessPresetSessionRel(row.rel));
  const sessions = new Array(rows.length);
  let nextRow = 0;
  const workerCount = Math.min(8, rows.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    let sliceStart = Date.now();
    while (nextRow < rows.length) {
      const index = nextRow++;
      const row = rows[index];
      sliceStart = await maybeYield(sliceStart);
      const meta = await readSessionDisplayMetaAsync(row);
      let conflict = false;
      if (!row.unsupported) {
        try {
          const entries = await fs.promises.readdir(path.join(destSessions, ...row.rel.split('/')));
          conflict = entries.some((name) => SESSION_LOG.test(name));
        } catch {
          // A missing destination directory has no existing session to conflict with.
        }
      }
      sessions[index] = {
        ...row,
        id: meta.id,
        cwd: meta.cwd,
        title: meta.title,
        createdAt: meta.createdAt,
        compressedLog: Boolean(meta.compressedLog),
        conflict,
      };
    }
  }));
  return sessions;
}

/**
 * Full non-blocking import scan pipeline: walks sessions, streams/decompresses
 * display metadata, and gathers plugins/skills/MCP/settings/presets via async I/O.
 * @param {any} params
 */
async function scanImportPipelineAsync(params) {
  const { source, target, extraSkillDirs, agentsSkillsRoot } = params;
  const destSessions = path.join(target, 'sessions');
  const [sessions, destHasAny, hasAttachments, plugins, skillsInfo, destMcpRows, sourceMcpRows, settings, presets] = await Promise.all([
    scanSessionsAsync(path.join(source, 'sessions'), destSessions, params.isHarnessPresetSessionRel),
    hasAnySessionDirAsync(destSessions),
    existsAsync(path.join(source, 'attachments')),
    pluginCandidatesAsync(source, params),
    collectSkillsAsync({ source, extraSkillDirs, agentsSkillsRoot, destSkills: path.join(target, 'skills'), isInside: params.isInside, isUnsafeRel: params.isUnsafeRel }),
    readTextFileAsync(path.join(target, MCP_FILE)).then((raw) => params.parseMcpServersYaml(raw || '')),
    readTextFileAsync(path.join(source, MCP_FILE)).then((raw) => params.parseMcpServersYaml(raw || '')),
    settingsCandidatesAsync(source, target, params),
    presetCandidatesAsync(source, target),
  ]);
  const destMcpIds = new Set(destMcpRows.map((/** @type {any} */ row) => String(row.id)));
  const mcp = sourceMcpRows.map((/** @type {any} */ row) => params.publicMcpRow(row, destMcpIds));
  const { skills, skillRoots } = skillsInfo;
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
    destEmpty: !destHasAny,
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

module.exports = { readSessionDisplayMeta, scanImportPipelineAsync };
