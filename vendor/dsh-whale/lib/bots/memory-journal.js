/**
 * Zero-LLM monthly journal (`memory/journal/YYYY-MM.md`) writer with 3x CAS retry
 * and 24-hour startup backfill for closed Work Items.
 */
import fs from 'node:fs';
import path from 'node:path';
import { sha256Hex, writeAtomicFile } from './fs-home.js';
import {
  BotMemoryError,
  isoDate,
  isoYearMonth,
  normalizeFactKey,
  parseMemoryLine,
  splitLines,
} from './memory-helpers.js';

export const JOURNAL_CAS_MAX_RETRIES = 3;

/**
 * Format a closed Work Item into a single-line monthly journal entry.
 * @param {any} item
 * @param {string} dateStr
 */
export function formatJournalItemLine(item, dateStr) {
  const num = item?.number !== undefined && item?.number !== null ? `item #${item.number}` : `item ${item?.uid ?? 'unknown'}`;
  const status = String(item?.status ?? 'done').trim() || 'done';
  const prLink = Array.isArray(item?.links)
    ? item.links.find((/** @type {any} */ l) => l?.kind === 'pr' && l?.ref)
    : null;
  const statusTag = prLink ? `${status} (PR ${String(prLink.ref).replace(/[\r\n|]+/g, ' ').trim()})` : status;
  const title = String(item?.title ?? '').replace(/[\r\n|]+/g, ' ').replace(/\s+/gu, ' ').trim() || '(untitled)';
  return `- ${dateStr} | ${num} | ${statusTag} | ${title}`;
}

/**
 * @param {{
 *   item?: any,
 *   line?: string | null,
 *   dedupeKey?: string | null,
 *   date?: string | null,
 *   at: number,
 * }} spec
 */
function resolveJournalEntrySpec({ item, line, dedupeKey, date, at }) {
  const dateStr = date || (item?.closedAt ? isoDate(item.closedAt) : isoDate(at));
  const yearMonth = /^\d{4}-\d{2}/.test(dateStr) ? dateStr.slice(0, 7) : isoYearMonth(at);
  const entryLine = String(line ?? (item ? formatJournalItemLine(item, dateStr) : '')).trim();
  if (!entryLine) {
    throw new BotMemoryError('invalid_argument', 'Either item or line is required for journal entry');
  }
  const hasItemNum = item?.number !== undefined && item?.number !== null;
  const key = dedupeKey ?? (hasItemNum ? `| item #${item.number} |` : normalizeFactKey(entryLine));
  return { yearMonth, entryLine, key };
}

/**
 * @param {string[]} existingLines
 * @param {string} key
 */
function hasJournalDuplicate(existingLines, key) {
  if (key.startsWith('| item #')) {
    return existingLines.some((l) => l.includes(key));
  }
  return existingLines.some(
    (l) => normalizeFactKey(l) === key || normalizeFactKey(parseMemoryLine(l).body) === key,
  );
}

/**
 * @param {string} filePath
 * @param {string} defaultHeader
 */
function readJournalFile(filePath, defaultHeader) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : defaultHeader;
}

/**
 * Append a line to `memory/journal/YYYY-MM.md` with idempotent dedupe and 3x CAS retry.
 * Zero LLM cost.
 * @param {{
 *   homeDir: string,
 *   item?: any,
 *   line?: string | null,
 *   dedupeKey?: string | null,
 *   date?: string | null,
 *   at?: number,
 * }} params
 */
export function appendJournalEntry({ homeDir, item = null, line = null, dedupeKey = null, date = null, at = Date.now() }) {
  if (!homeDir) throw new BotMemoryError('invalid_argument', 'homeDir is required');
  const { yearMonth, entryLine, key } = resolveJournalEntrySpec({ item, line, dedupeKey, date, at });
  const journalDir = path.join(homeDir, 'memory', 'journal');
  const filePath = path.join(journalDir, `${yearMonth}.md`);
  const defaultHeader = `# Journal ${yearMonth}\n`;
  fs.mkdirSync(journalDir, { recursive: true });

  for (let attempt = 1; attempt <= JOURNAL_CAS_MAX_RETRIES; attempt += 1) {
    const existing = readJournalFile(filePath, defaultHeader);
    const beforeSig = sha256Hex(existing);
    if (hasJournalDuplicate(splitLines(existing), key)) {
      return { appended: false, duplicate: true, filePath, yearMonth, line: entryLine, attempts: attempt };
    }
    const sep = existing.endsWith('\n') ? '' : '\n';
    const nextContent = `${existing}${sep}${entryLine}\n`;
    if (sha256Hex(readJournalFile(filePath, defaultHeader)) !== beforeSig) {
      if (attempt < JOURNAL_CAS_MAX_RETRIES) continue;
      throw new BotMemoryError('journal_cas_conflict', `Concurrent modification on ${filePath} after ${attempt} retries`);
    }
    writeAtomicFile(filePath, nextContent);
    return { appended: true, duplicate: false, filePath, yearMonth, line: entryLine, attempts: attempt };
  }

  return { appended: false, duplicate: false, filePath, yearMonth, line: entryLine, attempts: JOURNAL_CAS_MAX_RETRIES };
}

/**
 * Startup backfill: append any items closed within the last 24 hours to `memory/journal/YYYY-MM.md`.
 * Fully idempotent.
 * @param {{ homeDir: string, items: any[], now?: number, windowMs?: number }} params
 */
export function backfillJournal24h({ homeDir, items = [], now = Date.now(), windowMs = 24 * 60 * 60 * 1000 }) {
  const cutoff = now - windowMs;
  let scanned = 0;
  let appended = 0;
  let skipped = 0;
  /** @type {Set<string>} */
  const files = new Set();

  for (const item of Array.isArray(items) ? items : []) {
    if (!item || (item.status !== 'done' && item.status !== 'canceled')) continue;
    const closedTs = Number(item.closedAt ?? item.updatedAt ?? item.lastActivityAt ?? 0);
    if (!Number.isFinite(closedTs) || closedTs < cutoff || closedTs > now + 60_000) continue;
    scanned += 1;
    const res = appendJournalEntry({ homeDir, item, date: isoDate(closedTs), at: closedTs });
    files.add(res.filePath);
    if (res.appended) appended += 1;
    else skipped += 1;
  }

  return { scanned, appended, skipped, files: [...files] };
}
