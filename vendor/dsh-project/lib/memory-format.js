/**
 * Pure formatting, parsing, indexing, search, and archive-planning helpers for shared memory.
 */
import { randomBytes } from 'node:crypto';
import {
  MAX_MEMORY,
  MEMORY_BUDGET,
  MEMORY_DESCRIPTION_MAX,
  MEMORY_INDEX_LIMIT,
  MEMORY_NAME_MAX,
  MEMORY_SEARCH_LIMIT,
  MEMORY_STALE_MARKERS,
  MEMORY_TYPE_MAX,
  estimateTokens,
  httpError,
  text,
} from './schema.js';

export const MEMORY_INDEX_FILE = 'MEMORY.md';
export const MEMORY_INDEX_READ_ONLY =
  'MEMORY.md is the generated index of the shared memory: it is rebuilt from the topic files on every write, so it is read-only. Edit or delete a topic file instead.';
export const MEMORY_INDEX_DESCRIPTION = 'Generated index of the shared memory';

export function memorySlug(value) {
  const slug = String(value ?? '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  return Array.from(slug).slice(0, MEMORY_NAME_MAX).join('').replace(/-+$/g, '');
}

export function uniqueMemoryName(used, base) {
  let name = String(base ?? '').trim() || 'memory-topic';
  if (name === 'memory') name = 'memory-topic';
  if (!used.has(name)) return name;
  for (let index = 2; index < 1_000; index += 1) {
    const suffix = `-${index}`;
    const candidate = `${name.slice(0, MEMORY_NAME_MAX - suffix.length)}${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${name.slice(0, 40)}-${randomBytes(3).toString('hex')}`;
}

export function memoryNameOf(value) {
  const raw = text(value, 300).trim().replace(/\.md$/i, '');
  if (!raw) return '';
  return memorySlug(raw);
}

export function memoryNameOrThrow(value) {
  const raw = text(value, 300).trim();
  if (!raw) {
    throw httpError(400, 'name is required for this action (a memory file name such as "deployment-notes")');
  }
  const name = memorySlug(raw.replace(/\.md$/i, ''));
  if (!name) throw httpError(400, `"${raw}" is not a valid memory file name`);
  if (name === 'memory') throw httpError(400, MEMORY_INDEX_READ_ONLY);
  return name;
}

export function isMemoryIndexName(value) {
  const raw = String(value ?? '').trim().toLowerCase();
  return raw === 'memory' || raw === 'memory.md';
}

function plainMemoryLine(line) {
  return String(line ?? '')
    .replace(/^\s*>\s?/, '')
    .replace(/^\s*#{1,6}\s*/, '')
    .replace(/^\s*[-*+]\s+/, '')
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function memoryDescriptionLine(value) {
  const plain = plainMemoryLine(value);
  if (!plain) return '';
  return plain.length > MEMORY_DESCRIPTION_MAX
    ? `${plain.slice(0, MEMORY_DESCRIPTION_MAX).trimEnd()}…`
    : plain;
}

export function memoryDescription(body) {
  const first = String(body ?? '')
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!first) return '';
  return memoryDescriptionLine(first);
}

export function memoryTypeOf(value) {
  const plain = String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, MEMORY_TYPE_MAX);
  return plain || 'reference';
}

function memoryDateOf(modified) {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(String(modified ?? ''));
  return match ? match[1] : '';
}

export function legacyMemoryDate(title) {
  const match = /\b(\d{4}-\d{2}-\d{2})\b/.exec(String(title ?? ''));
  return match ? match[1] : '';
}

export function isStaleMemoryFile(file) {
  const first = String(file.body ?? '').split('\n').find((line) => line.trim()) || '';
  const haystack = `${file.name}\n${file.description}\n${first}`.toLowerCase();
  if (MEMORY_STALE_MARKERS.some((marker) => haystack.includes(marker))) return true;
  return /(^|-)(superseded|archived)(-|$)/.test(String(file.name ?? '').toLowerCase());
}

export function readMemoryFrontmatter(raw) {
  const source = String(raw ?? '').replace(/\r\n/g, '\n');
  if (!source.startsWith('---\n')) return null;
  const end = source.indexOf('\n---', 4);
  if (end === -1) return null;
  const fields = {};
  for (const line of source.slice(4, end).split('\n')) {
    const match = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2].trim();
    if (value.length >= 2) {
      const first = value[0];
      const last = value[value.length - 1];
      if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
        value = value.slice(1, -1);
      }
    }
    fields[match[1].toLowerCase()] = value;
  }
  const body = source.slice(end + 4).replace(/^\n+/, '').replace(/\n+$/, '');
  return { fields, body };
}

export function parseMemoryFile(raw, fallback = {}) {
  const source = String(raw ?? '').replace(/\r\n/g, '\n');
  const fileName = String(fallback.name ?? '');
  const body = source.replace(/\n+$/, '');
  const file = {
    name: fileName,
    fileName,
    description: '',
    type: 'reference',
    modified: '',
    pinned: false,
    sourceTaskId: '',
    body,
    chars: body.length,
    estimatedTokens: estimateTokens(body),
    path: String(fallback.path ?? ''),
  };
  const frontmatter = readMemoryFrontmatter(source);
  if (frontmatter) {
    const { fields } = frontmatter;
    if (fields.name) file.name = memorySlug(fields.name) || fileName;
    if (fields.description) file.description = memoryDescriptionLine(fields.description);
    if (fields.type) file.type = memoryTypeOf(fields.type);
    if (fields.modified && !Number.isNaN(Date.parse(fields.modified))) {
      file.modified = new Date(fields.modified).toISOString();
    }
    if (fields.pinned === 'true' || fields.pinned === '1') {
      file.pinned = true;
    }
    const sourceTask = fields.source_task_id || fields.sourcetaskid || '';
    if (sourceTask) file.sourceTaskId = text(sourceTask, 64).trim();
    file.body = frontmatter.body;
    file.chars = file.body.length;
    file.estimatedTokens = estimateTokens(file.body);
  }
  if (!file.description) file.description = memoryDescription(file.body) || file.name;
  file.stale = isStaleMemoryFile(file);
  return file;
}

export function serializeMemoryFile(file) {
  const body = String(file.body ?? '').replace(/\n+$/, '');
  const header = [
    '---',
    `name: ${file.name}`,
    `description: ${file.description}`,
    `type: ${file.type || 'reference'}`,
    `modified: ${file.modified}`,
    ...(file.pinned === true ? ['pinned: true'] : []),
    ...(typeof file.sourceTaskId === 'string' && file.sourceTaskId.trim()
      ? [`source_task_id: ${text(file.sourceTaskId.trim(), 64)}`]
      : []),
    '---',
  ];
  return [
    ...header,
    '',
    body,
    '',
  ].join('\n');
}

export function nextMemoryModified(files) {
  const now = Date.now();
  let newest = 0;
  for (const file of files) {
    const parsed = Date.parse(file.modified);
    if (Number.isFinite(parsed) && parsed > newest) newest = parsed;
  }
  return new Date(Math.max(now, newest + 1)).toISOString();
}

function compareText(left, right) {
  const a = String(left ?? '');
  const b = String(right ?? '');
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

export function compareMemoryFiles(left, right) {
  return compareText(left.modified, right.modified) || compareText(left.name, right.name);
}

export function memoryTotal(files) {
  return files.reduce((total, file) => total + (Number(file.chars) || 0), 0);
}

function memoryIndexEntry(file, mode) {
  const pin = file.pinned ? '[pinned] ' : '';
  if (mode === 'titles') return `· ${pin}${file.name}`;
  const size = `${file.chars} chars`;
  const date = memoryDateOf(file.modified);
  const suffix = date ? `, ${date}` : '';
  if (mode === 'no-description' || !file.description) return `· ${pin}${file.name} (${size}${suffix})`;
  return `· ${pin}${file.name} — ${file.description} (${size}${suffix})`;
}

function staleMemoryLine(stale) {
  const names = stale.map((file) => file.name).join(' | ');
  let line = `- ${stale.length} file(s) marked stale (superseded/archived; still readable by name): ${names}`;
  if (line.length > 500) line = `${line.slice(0, 500).trimEnd()}…`;
  return line;
}

export function memoryIndex(files, limit = MEMORY_INDEX_LIMIT, { listStale = false } = {}) {
  const all = Array.isArray(files) ? files : [];
  if (all.length === 0) return '(empty)';
  const live = all
    .filter((file) => !file.stale)
    .sort((left, right) => (right.pinned ? 1 : 0) - (left.pinned ? 1 : 0));
  const stale = all.filter((file) => file.stale);
  const header =
    `${live.length} file(s), ${memoryTotal(all)} characters. `
    + 'Read one with projects_memory {action:"read", name:"<name>"} — do not assume you know what a file says. '
    + 'Find one with projects_memory {action:"search", query:"<keyword>"}.';
  const staleLine = listStale && stale.length ? staleMemoryLine(stale) : '';
  const levels = [
    { mode: 'full', note: '' },
    { mode: 'no-description', note: ` Descriptions omitted to fit the ${limit}-character index cap.` },
    { mode: 'titles', note: ` Titles only (descriptions and sizes omitted) to fit the ${limit}-character index cap.` },
  ];
  for (const level of levels) {
    const lines = [`${header}${level.note}`];
    for (const file of live) lines.push(memoryIndexEntry(file, level.mode));
    if (staleLine) lines.push(staleLine);
    const candidate = lines.join('\n');
    if (candidate.length <= limit) return candidate;
  }
  const truncatedHeader = `${header} Titles only (descriptions and sizes omitted), truncated to fit the ${limit}-character index cap.`;
  const fixedLength = truncatedHeader.length + (staleLine ? staleLine.length + 1 : 0);
  const room = Math.max(0, limit - fixedLength - 2 - 200);
  const shown = [];
  let used = 0;
  for (const file of live) {
    const entry = memoryIndexEntry(file, 'titles');
    if (used + entry.length + 1 > room) break;
    shown.push(entry);
    used += entry.length + 1;
  }
  const omitted = live.length - shown.length;
  const lines = [truncatedHeader, ...shown];
  if (omitted > 0) {
    lines.push(`- …and ${omitted} more file(s) not listed (index capped at ${limit} characters).`);
  }
  if (staleLine) lines.push(staleLine);
  return lines.join('\n');
}

const LATIN_TOKEN_RE = /[a-z0-9_]+/g;
const CJK_RUN_RE = /[\u3400-\u9fff\uf900-\ufaff]+/g;

function tokenizeSearchTerms(input) {
  const lower = String(input ?? '').toLowerCase();
  const terms = new Set();
  for (const match of lower.matchAll(LATIN_TOKEN_RE)) {
    if (match[0].length >= 2 || /^\d+$/.test(match[0])) terms.add(match[0]);
  }
  for (const match of lower.matchAll(CJK_RUN_RE)) {
    const run = match[0];
    if (run.length === 1) {
      terms.add(run);
    } else {
      for (let i = 0; i < run.length - 1; i += 1) {
        terms.add(run.slice(i, i + 2));
      }
    }
  }
  return [...terms];
}

function scoreField(haystack, needle, terms, weight) {
  if (!haystack) return 0;
  let score = 0;
  if (haystack.includes(needle)) score += 6 * weight;
  if (terms.length > 0) {
    let hits = 0;
    for (const term of terms) {
      if (haystack.includes(term)) hits += 1;
    }
    if (hits > 0) {
      const coverage = hits / terms.length;
      score += (hits + coverage * 2) * weight;
    }
  }
  return score;
}

export function searchMemoryRanked(files, query, limit = MEMORY_SEARCH_LIMIT) {
  const needle = String(query ?? '').trim();
  if (!needle) throw httpError(400, 'query is required for action "search"');
  const all = Array.isArray(files) ? files : [];
  const live = all.filter((file) => !file.stale);
  const wanted = needle.toLowerCase();
  const terms = tokenizeSearchTerms(wanted);
  const ranked = [];

  for (const file of live) {
    const nameText = String(file.name ?? '').toLowerCase();
    const descText = String(file.description ?? '').toLowerCase();
    const bodyText = String(file.body ?? '').toLowerCase();
    const score =
      scoreField(nameText, wanted, terms, 4)
      + scoreField(descText, wanted, terms, 2.5)
      + scoreField(bodyText, wanted, terms, 1);
    if (score <= 0) continue;
    ranked.push({
      file,
      score: Number((score + (file.pinned ? 0.25 : 0)).toFixed(3)),
    });
  }

  ranked.sort((left, right) => right.score - left.score || compareMemoryFiles(right.file, left.file));
  return {
    needle,
    totalMatches: ranked.length,
    liveCount: live.length,
    staleCount: all.length - live.length,
    matches: ranked.slice(0, limit),
  };
}

export function searchMemory(files, query, limit = MEMORY_SEARCH_LIMIT) {
  const needle = String(query ?? '').trim();
  if (!needle) throw httpError(400, 'query is required for action "search"');
  const all = Array.isArray(files) ? files : [];
  if (all.length === 0) return `No memory file matches "${needle}". The shared memory is empty.`;
  const ranked = searchMemoryRanked(all, needle, limit);
  if (ranked.totalMatches === 0) {
    return (
      `No memory file matches "${needle}". ${ranked.liveCount} live file(s) in memory`
      + `${ranked.staleCount ? `, ${ranked.staleCount} stale file(s) excluded` : ''} — `
      + 'use projects_memory {action:"index"} to see them all.'
    );
  }
  const shown = ranked.matches.map((entry) => entry.file);
  const header =
    `${ranked.totalMatches} file(s) match "${needle}"`
    + (shown.length < ranked.totalMatches ? `, showing the first ${shown.length}` : '')
    + '. Read one with projects_memory {action:"read", name:"<name>"}.';
  const lines = [header, ...shown.map((file) => memoryIndexEntry(file, 'full'))];
  if (shown.length < ranked.totalMatches) {
    lines.push(`- …and ${ranked.totalMatches - shown.length} more file(s) match; narrow the query or use action:"index".`);
  }
  return lines.join('\n');
}

export function findMemoryFile(files, needle) {
  const wanted = memoryNameOf(needle);
  if (!wanted) return null;
  const names = (file) => [file.name, file.fileName].filter(Boolean).map((v) => String(v).toLowerCase());
  return (
    files.find((file) => names(file).includes(wanted))
    || files.find((file) => names(file).some((v) => v.startsWith(wanted)))
    || files.find((file) => names(file).some((v) => v.includes(wanted)))
    || null
  );
}

export function renderMemoryIndexFile(files) {
  return `# Shared memory index\n\n${memoryIndex(files, Number.POSITIVE_INFINITY, { listStale: true })}\n`;
}

export function splitLegacyMemory(raw) {
  const blocks = [];
  const preamble = [];
  let current = null;
  for (const line of String(raw ?? '').replace(/\r\n/g, '\n').split('\n')) {
    if (line.startsWith('## ')) {
      if (current) blocks.push(current);
      current = { title: line.slice(3).trim(), lines: [] };
      continue;
    }
    if (current) current.lines.push(line);
    else preamble.push(line);
  }
  if (current) blocks.push(current);
  const result = [];
  const pre = preamble.join('\n').trim();
  if (pre) result.push({ title: null, body: pre });
  for (const block of blocks) {
    result.push({ title: block.title, body: block.lines.join('\n').trim() });
  }
  return result;
}

export function planFileArchive(files, target) {
  if (!files || files.length <= 1) return null;
  const pinned = files.filter((file) => file.pinned === true);
  const unpinned = files.filter((file) => file.pinned !== true);
  if (unpinned.length === 0) return null;
  const kept = [...pinned];
  let used = pinned.reduce((sum, file) => sum + (Number(file.chars) || 0), 0);
  const keptUnpinned = [];
  for (let index = unpinned.length - 1; index >= 0; index -= 1) {
    const file = unpinned[index];
    if ((kept.length > 0 || keptUnpinned.length > 0) && used + file.chars > target) break;
    keptUnpinned.unshift(file);
    used += file.chars;
  }
  const moved = unpinned.slice(0, unpinned.length - keptUnpinned.length);
  if (moved.length === 0) return null;
  return { kept: [...kept, ...keptUnpinned], moved };
}

export function archiveSummary(files, limit = 2_000) {
  if (!files || files.length === 0) return '';
  const header =
    `${files.length} archived file(s) in memory/archive/ — moved out by compaction, not injected into prompts. `
    + 'Read one with action "read", name:"<name>".';
  const lines = [header];
  let used = header.length;
  for (const file of files) {
    const entry = `- ${file.fileName || file.name} (${file.chars} chars)`;
    if (used + entry.length + 1 > limit) {
      lines.push(`- …and ${files.length - (lines.length - 1)} more archived file(s) not listed.`);
      break;
    }
    lines.push(entry);
    used += entry.length + 1;
  }
  return lines.join('\n');
}

export function memoryWarning({ length, truncated, name }, budget = MEMORY_BUDGET) {
  const notes = [];
  if (truncated) {
    notes.push(
      `WARNING: memory file "${name}" hit the ${MAX_MEMORY}-character write ceiling and the tail was cut.`,
    );
  }
  if (length > budget) {
    notes.push(
      `WARNING: the shared memory is now ${length} characters, ${length - budget} over the ${budget}-character budget.`,
    );
  }
  return notes.length ? ` ${notes.join(' ')}` : '';
}

export function compactionNote(result) {
  if (!result) return '';
  if (!result.skipped) {
    const still = result.after > result.budget
      ? ` It is still over the ${result.budget}-character budget: remaining files are too large to archive.`
      : '';
    return ` Auto-compacted the shared memory: ${result.before} → ${result.after} characters (${result.archived} file(s) moved to memory/archive/).${still}`;
  }
  if (result.skipped === 'in_flight') {
    return ' A compaction is already running for this project; it will finish on its own.';
  }
  if (result.skipped === 'under_budget') return '';
  if (result.skipped === 'nothing_to_archive') {
    return ` The memory is ${result.before} characters, over its ${result.budget}-character budget, but there is nothing safe to archive: a single file is never split.`;
  }
  return ` Auto-compaction failed (${result.reason}); the memory is unchanged at ${result.before} characters.`;
}
