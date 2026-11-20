/**
 * Tiered memory engine for the Whale assistant:
 * - Narrow Push index: `MEMORY.md` strictly capped at <= 200 lines AND <= 25 KiB
 *   so every turn preserves KV-Cache stability instead of injecting a 40 KiB blob.
 * - Atomic Pull files: `memory/<id>.md` (one fact per Markdown file; file boundary
 *   = invalidation unit) with categories (`fact` | `moment` | `upcoming` | `self`)
 *   and non-destructive `superseded` archival (never physically deleted unattended).
 * - Smooth non-destructive migration of oversized legacy `MEMORY.md` into
 *   `memory/legacy-memory-archive.md`.
 * - Pre-compaction flush trigger (~85% of effective compaction threshold ~69%)
 *   and cursor-based idle incremental review anchored strictly to owner-authored
 *   `user/message` IDs (anti-indirect-injection defense).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { whaleHomeDir } from './preset.js';
import { eventText, trimTo } from './shared.js';
import { isSessionTainted, isTaintingEvent } from './call-origin.js';

export const INDEX_MAX_LINES = 200;
export const INDEX_MAX_BYTES = 25 * 1024;
export const MEMORY_CATEGORIES = Object.freeze(['fact', 'moment', 'upcoming', 'self']);
export const DEFAULT_COMPACT_RATIO = 0.8;
export const DEFAULT_COMPACT_HEADROOM = 65536;
export const PRE_COMPACT_FLUSH_FACTOR = 0.85;
export const LEGACY_ARCHIVE_FILENAME = 'legacy-memory-archive.md';

const REVIEW_CURSOR_FILE = 'memory-review-cursor.json';
const MAX_FACT_BODY_CHARS = 4000;
const INDEX_HEADER = '# 鲸鱼娘的长期记忆索引\n';

/** @param {string} home */
export function memoryIndexPath(home) {
  return home ? path.join(whaleHomeDir(home), 'MEMORY.md') : '';
}

/** @param {string} home */
export function memoryDirPath(home) {
  return home ? path.join(whaleHomeDir(home), 'memory') : '';
}

/** @param {string} text */
export function measureIndex(text) {
  const normalized = String(text ?? '');
  const lines = normalized === '' ? 0 : normalized.split(/\r?\n/u).length;
  const bytes = Buffer.byteLength(normalized, 'utf8');
  return { lines, bytes };
}

/** @param {string} text */
export function withinIndexCap(text) {
  const { lines, bytes } = measureIndex(text);
  return lines <= INDEX_MAX_LINES && bytes <= INDEX_MAX_BYTES;
}

/**
 * Truncate text cleanly at line + UTF-8 byte bounds without splitting multi-byte
 * characters.
 * @param {string} text
 * @param {number} maxLines
 * @param {number} maxBytes
 */
export function capIndexText(text, maxLines = INDEX_MAX_LINES, maxBytes = INDEX_MAX_BYTES) {
  const rawLines = String(text ?? '').split(/\r?\n/u);
  const kept = [];
  let bytes = 0;
  for (const line of rawLines) {
    if (kept.length >= maxLines) break;
    const addition = Buffer.byteLength(kept.length ? `\n${line}` : line, 'utf8');
    if (bytes + addition > maxBytes) break;
    kept.push(line);
    bytes += addition;
  }
  return kept.join('\n');
}

/** @param {string} filePath @param {string} content */
function writeAtomic(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(tmp, content, 'utf8');
    fs.renameSync(tmp, filePath);
  } finally {
    if (fs.existsSync(tmp)) {
      try { fs.unlinkSync(tmp); } catch { /* Best-effort temp cleanup. */ }
    }
  }
}

/**
 * Smooth non-destructive migration when a legacy `MEMORY.md` exceeds the narrow
 * Push index limits (>200 lines or >25 KiB). Saves a complete verbatim backup
 * to `memory/legacy-memory-archive.md` (never deleting user data) and compacts
 * `MEMORY.md` to fit within the narrow Push budget.
 * @param {string} home
 */
export function migrateLegacyMemoryIfNeeded(home) {
  const indexFile = memoryIndexPath(home);
  if (!indexFile || !fs.existsSync(indexFile)) return { migrated: false };
  const raw = fs.readFileSync(indexFile, 'utf8');
  if (withinIndexCap(raw)) return { migrated: false };

  const dir = memoryDirPath(home);
  fs.mkdirSync(dir, { recursive: true });
  const archiveFile = path.join(dir, LEGACY_ARCHIVE_FILENAME);
  if (!fs.existsSync(archiveFile)) {
    writeAtomic(archiveFile, raw);
  } else {
    const stamped = path.join(dir, `legacy-memory-archive-${Date.now()}.md`);
    writeAtomic(stamped, raw);
  }

  const notice = [
    '# 鲸鱼娘的长期记忆索引',
    '',
    `> 历史完整记录已无损归档至 \`memory/${LEGACY_ARCHIVE_FILENAME}\`，可用 \`whale_memory_search\` 按需检索。`,
    '',
  ].join('\n');
  const lines = raw.split(/\r?\n/u).map((l) => l.trim()).filter(Boolean);
  const bullets = lines.filter((l) => /^[-*]\s+/u.test(l) || /^#+\s+/u.test(l));
  const summaryBody = (bullets.length ? bullets : lines).join('\n');
  const compacted = capIndexText(`${notice}${summaryBody}\n`, INDEX_MAX_LINES - 2, INDEX_MAX_BYTES - 128);
  writeAtomic(indexFile, compacted.endsWith('\n') ? compacted : `${compacted}\n`);
  return { migrated: true, archiveFile };
}

/**
 * Read the narrow Push index for system-prompt injection.
 * Short user files stay verbatim; oversized files migrate non-destructively.
 * @param {string} home
 */
export function readPushIndex(home) {
  const indexFile = memoryIndexPath(home);
  if (!indexFile || !fs.existsSync(indexFile)) return '';
  try {
    const raw = fs.readFileSync(indexFile, 'utf8');
    if (!withinIndexCap(raw)) {
      migrateLegacyMemoryIfNeeded(home);
      const compacted = fs.readFileSync(indexFile, 'utf8');
      return capIndexText(compacted);
    }
    return raw;
  } catch {
    return '';
  }
}

/**
 * Monotonic cap guard for `ctx.tools.guard()` on `MEMORY.md` writes:
 * - Always allows writes within 200 lines & 25 KiB.
 * - If existing `MEMORY.md` is already over cap, ALWAYS allows compression
 *   writes that strictly shrink byte size without increasing line count.
 * - Rejects over-cap writes that grow or stay at/above current size.
 * @param {string} home
 * @param {string} proposedContent
 */
export function evaluateIndexWriteGuard(home, proposedContent) {
  const proposed = measureIndex(proposedContent);
  if (proposed.lines <= INDEX_MAX_LINES && proposed.bytes <= INDEX_MAX_BYTES) {
    return { allowed: true, reason: '' };
  }
  const indexFile = memoryIndexPath(home);
  if (indexFile && fs.existsSync(indexFile)) {
    try {
      const existing = measureIndex(fs.readFileSync(indexFile, 'utf8'));
      const alreadyOver = existing.lines > INDEX_MAX_LINES || existing.bytes > INDEX_MAX_BYTES;
      if (alreadyOver && proposed.bytes < existing.bytes && proposed.lines <= existing.lines) {
        return { allowed: true, reason: 'compression-shrink-allowed' };
      }
    } catch { /* Fall through to cap refusal. */ }
  }
  return {
    allowed: false,
    reason: `MEMORY.md 索引超过单调上限（当前写入 ${proposed.lines} 行 / ${proposed.bytes} 字节，上限 ${INDEX_MAX_LINES} 行 / ${INDEX_MAX_BYTES} 字节）。请把详细内容拆分到 memory/<id>.md（使用 whale_remember）或压缩缩小索引体积。`,
  };
}

/** @param {string} value */
function sanitizeId(value) {
  const clean = String(value ?? '').trim().replace(/[^A-Za-z0-9_-]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 80);
  return clean || `mem-${Date.now()}-${crypto.randomUUID().slice(0, 6)}`;
}

/** @param {string} category */
export function normalizeCategory(category) {
  const v = String(category ?? '').trim().toLowerCase();
  return MEMORY_CATEGORIES.includes(v) ? v : 'fact';
}

/**
 * Serialize one atomic memory file with minimal YAML frontmatter.
 * @param {any} item
 */
function serializeMemoryFile(item) {
  const meta = {
    id: item.id,
    category: item.category,
    title: item.title,
    status: item.status,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    ...(item.sourceMessageId ? { sourceMessageId: item.sourceMessageId } : {}),
    ...(item.supersededBy ? { supersededBy: item.supersededBy } : {}),
    ...(item.supersededReason ? { supersededReason: item.supersededReason } : {}),
    ...(item.tags?.length ? { tags: item.tags } : {}),
  };
  const headerLines = ['---'];
  for (const [key, val] of Object.entries(meta)) {
    headerLines.push(`${key}: ${JSON.stringify(val)}`);
  }
  headerLines.push('---', '');
  return `${headerLines.join('\n')}${item.body.trim()}\n`;
}

/**
 * Parse one atomic memory Markdown file. Tolerates plain Markdown files without
 * frontmatter so manually added user notes in `memory/` are also searchable.
 * @param {string} filePath
 */
export function parseMemoryFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const fallbackId = path.basename(filePath, '.md');
  const fmMatch = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/u.exec(raw);
  /** @type {Record<string, any>} */
  const meta = {};
  let body = raw;
  if (fmMatch) {
    body = fmMatch[2];
    for (const line of fmMatch[1].split(/\r?\n/u)) {
      const idx = line.indexOf(':');
      if (idx <= 0) continue;
      const key = line.slice(0, idx).trim();
      const valText = line.slice(idx + 1).trim();
      try { meta[key] = JSON.parse(valText); } catch { meta[key] = valText; }
    }
  }
  return {
    id: String(meta.id || fallbackId),
    category: normalizeCategory(meta.category),
    title: String(meta.title || fallbackId).slice(0, 200),
    status: meta.status === 'superseded' ? 'superseded' : 'active',
    createdAt: Number(meta.createdAt) || 0,
    updatedAt: Number(meta.updatedAt) || 0,
    sourceMessageId: String(meta.sourceMessageId || ''),
    supersededBy: String(meta.supersededBy || ''),
    supersededReason: String(meta.supersededReason || ''),
    tags: Array.isArray(meta.tags) ? meta.tags.map(String).slice(0, 12) : [],
    body: body.trim(),
    filePath,
  };
}

/**
 * Append or update a concise index pointer line in `MEMORY.md` without ever
 * exceeding the narrow Push cap.
 * @param {string} home
 * @param {any} item
 */
function upsertIndexPointer(home, item) {
  const indexFile = memoryIndexPath(home);
  if (!indexFile) return { indexed: false };
  const existing = fs.existsSync(indexFile) ? fs.readFileSync(indexFile, 'utf8') : INDEX_HEADER;
  const tag = `[${item.category}]`;
  const summary = trimTo(item.title || item.body.replace(/\s+/gu, ' '), 120);
  const pointer = item.status === 'superseded'
    ? `- ~~${tag} ${summary}~~ (superseded -> \`memory/${item.id}.md\`)`
    : `- ${tag} ${summary} (\`memory/${item.id}.md\`)`;
  const marker = `memory/${item.id}.md`;
  const lines = existing.split(/\r?\n/u);
  const idx = lines.findIndex((line) => line.includes(marker));
  let nextText;
  if (idx >= 0) {
    if (item.status === 'superseded') {
      // Remove superseded item from the narrow Push index while keeping its file intact on disk.
      lines.splice(idx, 1);
      nextText = lines.join('\n');
    } else {
      lines[idx] = pointer;
      nextText = lines.join('\n');
    }
  } else if (item.status === 'superseded') {
    return { indexed: false };
  } else {
    const base = existing.endsWith('\n') ? existing : `${existing}\n`;
    nextText = `${base}${pointer}\n`;
  }
  const guard = evaluateIndexWriteGuard(home, nextText);
  if (!guard.allowed) return { indexed: false, reason: guard.reason };
  writeAtomic(indexFile, nextText.endsWith('\n') ? nextText : `${nextText}\n`);
  return { indexed: true };
}

/**
 * Create one atomic Markdown memory file under `memory/<id>.md` and add a
 * compact pointer to `MEMORY.md` (when index budget allows).
 * @param {string} home
 * @param {{ text: string, title?: string, category?: string, tags?: string[], sourceMessageId?: string, id?: string }} input
 */
export function storeMemoryFact(home, input) {
  if (!home) throw new Error('DSH home is unavailable.');
  const body = String(input?.text ?? '').trim().slice(0, MAX_FACT_BODY_CHARS);
  if (!body) throw new Error('Empty memory text; nothing was stored.');
  const category = normalizeCategory(input?.category);
  const now = Date.now();
  const id = sanitizeId(input?.id || `${category}-${new Date(now).toISOString().slice(0, 10).replace(/-/gu, '')}-${crypto.randomUUID().slice(0, 6)}`);
  const title = trimTo(String(input?.title ?? '').trim() || body.split(/\r?\n/u)[0], 140);
  const tags = Array.isArray(input?.tags)
    ? [...new Set(input.tags.map((t) => String(t ?? '').trim()).filter(Boolean))].slice(0, 12)
    : [];
  const item = {
    id,
    category,
    title,
    status: 'active',
    createdAt: now,
    updatedAt: now,
    sourceMessageId: String(input?.sourceMessageId ?? '').trim().slice(0, 128),
    tags,
    body,
  };
  const dir = memoryDirPath(home);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${id}.md`);
  writeAtomic(filePath, serializeMemoryFile(item));
  const idx = upsertIndexPointer(home, item);
  return { item: { ...item, filePath }, indexed: idx.indexed, ...(idx.reason ? { indexNote: idx.reason } : {}) };
}

/** @param {string} home */
export function listMemoryFacts(home, { category = '', includeSuperseded = false } = {}) {
  const dir = memoryDirPath(home);
  if (!dir || !fs.existsSync(dir)) return [];
  const wantCat = category ? normalizeCategory(category) : '';
  const items = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    if (entry.name.startsWith('legacy-memory-archive')) continue;
    try {
      const parsed = parseMemoryFile(path.join(dir, entry.name));
      if (!includeSuperseded && parsed.status === 'superseded') continue;
      if (wantCat && parsed.category !== wantCat) continue;
      items.push(parsed);
    } catch { /* Skip unreadable file. */ }
  }
  return items.sort((a, b) => b.updatedAt - a.updatedAt);
}

function searchLegacyArchiveHit(home, q, tokens) {
  if (!q) return null;
  const archiveFile = path.join(memoryDirPath(home), LEGACY_ARCHIVE_FILENAME);
  if (!fs.existsSync(archiveFile)) return null;
  try {
    const lines = fs.readFileSync(archiveFile, 'utf8').split(/\r?\n/u);
    const hits = lines.filter((line) => tokens.every((tok) => line.toLowerCase().includes(tok))).slice(0, 5);
    if (!hits.length) return null;
    return {
      score: 5,
      item: {
        id: 'legacy-memory-archive',
        category: 'fact',
        title: '历史归档记忆匹配片段',
        status: 'active',
        createdAt: 0,
        updatedAt: 0,
        sourceMessageId: '',
        supersededBy: '',
        supersededReason: '',
        tags: ['legacy-archive'],
        body: hits.join('\n').slice(0, 1200),
        filePath: archiveFile,
      },
    };
  } catch {
    return null;
  }
}

/**
 * Pull-search across atomic memory files (and legacy archive if present).
 * @param {string} home
 * @param {{ query: string, category?: string, includeSuperseded?: boolean, limit?: number }} opts
 */
export function searchMemoryFacts(home, { query = '', category = '', includeSuperseded = false, limit = 15 } = {}) {
  const q = String(query ?? '').trim().toLowerCase();
  const max = Math.max(1, Math.min(50, Number(limit) || 15));
  const tokens = q ? q.split(/\s+/u).filter(Boolean) : [];
  const items = listMemoryFacts(home, { category, includeSuperseded });
  const scored = [];
  for (const item of items) {
    const hay = `${item.title}\n${item.tags.join(' ')}\n${item.body}`.toLowerCase();
    if (tokens.length && !tokens.every((tok) => hay.includes(tok))) continue;
    let score = item.status === 'active' ? 10 : 2;
    if (q && item.title.toLowerCase().includes(q)) score += 10;
    if (q && item.tags.some((t) => t.toLowerCase().includes(q))) score += 6;
    scored.push({ score, item });
  }
  const legacyHit = searchLegacyArchiveHit(home, q, tokens);
  if (legacyHit) scored.push(legacyHit);

  return scored
    .sort((a, b) => b.score - a.score || b.item.updatedAt - a.item.updatedAt)
    .slice(0, max)
    .map(({ item }) => ({
      id: item.id,
      category: item.category,
      title: item.title,
      status: item.status,
      tags: item.tags,
      sourceMessageId: item.sourceMessageId,
      snippet: trimTo(item.body.replace(/\s+/gu, ' '), 240),
      updatedAt: item.updatedAt,
    }));
}

/** @param {string} home @param {string} id */
export function readMemoryFact(home, id) {
  const clean = sanitizeId(id);
  const dir = memoryDirPath(home);
  if (!dir) return null;
  const candidate = clean === 'legacy-memory-archive'
    ? path.join(dir, LEGACY_ARCHIVE_FILENAME)
    : path.join(dir, `${clean}.md`);
  if (!fs.existsSync(candidate)) return null;
  return parseMemoryFile(candidate);
}

/**
 * Mark an atomic memory file as `superseded` (archived in place, NEVER physically
 * deleted). Optionally writes a replacement fact and links `supersededBy`.
 * @param {string} home
 * @param {string} id
 * @param {{ reason?: string, replacementText?: string, replacementTitle?: string, category?: string }} [opts]
 */
export function supersedeMemoryFact(home, id, opts = {}) {
  const existing = readMemoryFact(home, id);
  if (!existing || existing.id === 'legacy-memory-archive') {
    throw new Error(`找不到记忆条目：${String(id ?? '')}`);
  }
  let replacement = null;
  if (typeof opts.replacementText === 'string' && opts.replacementText.trim()) {
    replacement = storeMemoryFact(home, {
      text: opts.replacementText,
      title: opts.replacementTitle || existing.title,
      category: opts.category || existing.category,
      tags: existing.tags,
    }).item;
  }
  const updated = {
    ...existing,
    status: 'superseded',
    updatedAt: Date.now(),
    supersededBy: replacement?.id || String(opts.supersededBy ?? ''),
    supersededReason: trimTo(String(opts.reason ?? '').trim(), 300),
  };
  writeAtomic(existing.filePath, serializeMemoryFile(updated));
  upsertIndexPointer(home, updated);
  return { superseded: updated, replacement };
}

// ── Pre-compaction flush (~85% of actual compaction point ~69%) ───────────

/**
 * Compute the effective compaction threshold matching `@deepseek-ai/dsh-compaction-basic`
 * and return 85% of it as the pre-compaction flush trigger.
 * @param {number} contextWindow
 */
export function computePreCompactionFlushThreshold(contextWindow) {
  if (!Number.isFinite(contextWindow) || contextWindow <= 0) return 0;
  const ratioTarget = Math.floor(contextWindow * DEFAULT_COMPACT_RATIO);
  const headroomTarget = contextWindow > DEFAULT_COMPACT_HEADROOM
    ? contextWindow - DEFAULT_COMPACT_HEADROOM
    : Math.floor(contextWindow * 0.69);
  const compactionPoint = Math.min(ratioTarget, headroomTarget);
  return Math.max(1000, Math.floor(compactionPoint * PRE_COMPACT_FLUSH_FACTOR));
}

function extractMeasuredTokens(measured) {
  if (typeof measured === 'number' && Number.isFinite(measured)) return measured;
  if (typeof measured?.total === 'number' && Number.isFinite(measured.total)) return measured.total;
  if (typeof measured?.tokens === 'number' && Number.isFinite(measured.tokens)) return measured.tokens;
  return null;
}

/**
 * Estimate live token usage for a session, preferring `ctx.tokenMeter` when
 * available and falling back to a conservative text-length estimate.
 * @param {any} ctx
 * @param {any} session
 */
export async function estimateSessionTokens(ctx, session) {
  const meter = ctx?.get?.('tokenMeter') ?? ctx?.tokenMeter;
  if (typeof meter?.measure === 'function') {
    try {
      const value = extractMeasuredTokens(await meter.measure(session, session?.header));
      if (value !== null) return value;
    } catch { /* Fall through to conservative estimate. */ }
  }
  const events = typeof session?.snapshotEvents === 'function' ? session.snapshotEvents() : [];
  let chars = 0;
  for (const ev of events) {
    if (ev?.type === 'user/message' || ev?.type === 'assistant/message') chars += eventText(ev).length;
  }
  return Math.ceil(chars / 3);
}

async function resolveFlushContextWindow(ctx, session, opts) {
  const explicit = Number(opts?.contextWindow) || 0;
  if (explicit) return explicit;
  const llm = ctx?.get?.('llm') ?? ctx?.llm;
  const sel = session.header?.model;
  if (typeof llm?.resolveModelInfo === 'function' && sel?.provider && sel?.model) {
    const info = await llm.resolveModelInfo(sel.provider, sel.model).catch(() => null);
    const resolved = Number(info?.contextWindow) || 0;
    if (resolved) return resolved;
  }
  return 131072;
}

/**
 * Check whether the whale session crossed the pre-compaction flush trigger
 * for the current compaction epoch. Injects a single silent notice per epoch
 * asking whale-girl to crystallize durable facts before compaction runs.
 * Never runs on tainted (`guest` / `group`) sessions.
 *
 * @param {any} ctx
 * @param {any} agent
 * @param {Map<string, number>} flushedEpochBySession
 * @param {{ contextWindow?: number }} [opts]
 */
export async function maybeTriggerPreCompactionFlush(ctx, agent, flushedEpochBySession, opts = {}) {
  const session = agent?.session;
  if (!session || typeof session.snapshotEvents !== 'function') return { triggered: false, reason: 'no-session' };
  if (isSessionTainted(session)) return { triggered: false, reason: 'tainted' };

  const lastCompact = session.snapshotEvents().findLast((ev) => ev?.type === 'compaction/summary');
  const epochSeq = Number(lastCompact?.seq ?? 0);
  if (flushedEpochBySession.get(session.id) === epochSeq) {
    return { triggered: false, reason: 'already-flushed-this-epoch' };
  }

  const contextWindow = await resolveFlushContextWindow(ctx, session, opts);
  const flushAt = computePreCompactionFlushThreshold(contextWindow);
  const usedTokens = await estimateSessionTokens(ctx, session);
  if (usedTokens < flushAt) return { triggered: false, usedTokens, flushAt };

  flushedEpochBySession.set(session.id, epochSeq);
  const notice = createUserMessage({
    source: {
      kind: 'plugin',
      plugin: 'dsh-whale',
      form: 'notice',
      subtype: 'pre-compaction-flush',
      summary: '上下文接近自动压缩阈值，静默沉淀关键记忆',
    },
    content: [{
      type: 'text',
      text: `（系统静默提醒：当前上下文约 ${usedTokens} tokens，已接近自动压缩阈值；请先用 whale_remember 把本阶段主人明确表达的偏好、约定、重要时刻或待办计划沉淀进分层记忆，再用 whale_memory_supersede 归档已过时事实；切勿物理删除记忆文件。）`,
    }],
  });
  if (typeof agent.inject === 'function') agent.inject(notice);
  else if (typeof session.append === 'function') session.append('user/message', notice, { surfaceOp: 'append' });
  return { triggered: true, usedTokens, flushAt, epochSeq };
}

// ── Cursor-based Idle Incremental Memory Review ───────────────────────────

/** @param {string} home */
function readReviewCursor(home) {
  const file = path.join(whaleHomeDir(home), REVIEW_CURSOR_FILE);
  if (!fs.existsSync(file)) return { sessionId: '', lastSeq: 0, lastReviewedAt: 0 };
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    return {
      sessionId: String(raw?.sessionId ?? ''),
      lastSeq: Number(raw?.lastSeq) || 0,
      lastReviewedAt: Number(raw?.lastReviewedAt) || 0,
    };
  } catch {
    return { sessionId: '', lastSeq: 0, lastReviewedAt: 0 };
  }
}

/** @param {string} home @param {{ sessionId: string, lastSeq: number, lastReviewedAt: number }} cursor */
function writeReviewCursor(home, cursor) {
  const file = path.join(whaleHomeDir(home), REVIEW_CURSOR_FILE);
  writeAtomic(file, `${JSON.stringify(cursor, null, 2)}\n`);
}

const OWNER_MEMORY_PATTERNS = [
  { category: 'upcoming', re: /(?:记得|提醒我|别忘了|下周|明天|计划|打算|约定|日程)[^\n。！？!?]{3,160}/u },
  { category: 'self', re: /(?:我(?:习惯|喜欢|偏好|讨厌|不吃|平时|一般|常用|叫|是)[^\n。！？!?]{2,140})/u },
  { category: 'moment', re: /(?:今天(?:终于|完成了|上线了|搞定了|发布了|拿到了)|刚(?:刚)?(?:上线|发布|完成))[^\n。！？!?]{2,140}/u },
];

/**
 * True only when an event is a direct, owner-authored message (desktop user
 * or verified private IM owner). Rejects assistant replies, tool results,
 * plugin notices, and any guest/group event so indirect prompt injection in
 * files/webpages can never poison long-term memory.
 * @param {any} event
 */
export function isTrustedOwnerMessage(event) {
  if (!event || event.type !== 'user/message') return false;
  if (isTaintingEvent(event)) return false;
  const source = event.data?.source ?? {};
  const rpcId = String(source.rpcId ?? '');
  if (/^whale-pulse-/u.test(rpcId)) return false;
  if (source.kind === 'plugin' || source.kind?.startsWith?.('dsh-whale:')) return false;
  if (source.kind === 'user') {
    if (rpcId && /^(im|feishu|weixin|wecom|qq|slack|telegram|discord|whatsapp|dingtalk|office)-/u.test(rpcId)) {
      return /^[a-z0-9_]+-owner-private-[a-f0-9-]+$/iu.test(rpcId);
    }
    return true;
  }
  if (source.kind === 'dsh-im:inbound') {
    return source.speaker?.role === 'owner' && source.speaker?.chat === 'private';
  }
  return false;
}

/**
 * Idle incremental memory review: reads ONLY events after the durable cursor,
 * extracts candidate facts strictly from trusted owner-authored messages,
 * anchors every written fact with `sourceMessageId`, and NEVER physically
 * deletes any memory file.
 * @param {string} home
 * @param {any} session
 */
export function runIdleIncrementalMemoryReview(home, session) {
  if (!home || !session || typeof session.snapshotEvents !== 'function') {
    return { reviewed: 0, stored: [] };
  }
  if (isSessionTainted(session)) {
    return { reviewed: 0, stored: [], skippedReason: 'tainted' };
  }
  const events = session.snapshotEvents();
  const cursor = readReviewCursor(home);
  const startSeq = cursor.sessionId === session.id ? cursor.lastSeq : 0;
  const fresh = events.filter((ev) => Number(ev?.seq ?? 0) > startSeq);
  if (!fresh.length) return { reviewed: 0, stored: [] };

  const existingBySource = new Set(
    listMemoryFacts(home, { includeSuperseded: true })
      .map((item) => item.sourceMessageId)
      .filter(Boolean),
  );

  const stored = [];
  let maxSeq = startSeq;
  for (const ev of fresh) {
    const seq = Number(ev?.seq ?? 0);
    if (seq > maxSeq) maxSeq = seq;
    if (!isTrustedOwnerMessage(ev)) continue;
    const messageId = String(ev.data?.id ?? `seq-${seq}`);
    if (existingBySource.has(messageId)) continue;
    const text = eventText(ev).trim();
    if (!text || text.startsWith('/')) continue;
    for (const rule of OWNER_MEMORY_PATTERNS) {
      const match = rule.re.exec(text);
      if (match) {
        const fact = storeMemoryFact(home, {
          text: match[0].trim(),
          category: rule.category,
          sourceMessageId: messageId,
          tags: ['idle-review'],
        });
        existingBySource.add(messageId);
        stored.push(fact.item);
        break;
      }
    }
  }

  writeReviewCursor(home, {
    sessionId: String(session.id ?? ''),
    lastSeq: maxSeq,
    lastReviewedAt: Date.now(),
  });
  return { reviewed: fresh.length, stored, lastSeq: maxSeq };
}
