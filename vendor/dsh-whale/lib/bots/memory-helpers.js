/**
 * Shared low-level primitives for Bot Memory Service:
 * `BotMemoryError`, line parsing/formatting, secret redaction, disk I/O, and archive appending.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  parseBotMemoryLine,
  scanBotMemoryLines,
} from '../../src/shared/bot-memory-lines.js';
import { writeAtomicFile } from './fs-home.js';

export const MEMORY_MAX_LOADED_LINES = 200;
export const MEMORY_SOURCE_SEPARATOR = ' · from: ';

const SPOOFED_SOURCE_RE = /\s*·\s*from\s*:/giu;

const SECRET_PATTERNS = [
  /\bsk-(?:proj-|ant-|live-|test-)?[A-Za-z0-9_-]{12,}\b/gu,
  /\bgh[pousr]_[A-Za-z0-9]{16,}\b/gu,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/gu,
  /\bAIza[0-9A-Za-z_-]{20,}\b/gu,
  /\bAKIA[0-9A-Z]{16}\b/gu,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}\b/giu,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/gu,
  /\b(api[_-]?key|secret|password|passwd|access[_-]?token|auth[_-]?token)\s*[:=]\s*(['"]?)[^\s'"]{6,}\2/giu,
];

export class BotMemoryError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {Record<string, any>} [data]
   */
  constructor(code, message, data = undefined) {
    super(message);
    this.name = 'BotMemoryError';
    this.code = code;
    if (data !== undefined) this.data = data;
  }
}

/** @param {number} ts */
export function isoDate(ts) {
  return new Date(ts).toISOString().slice(0, 10);
}

/** @param {number} ts */
export function isoYearMonth(ts) {
  return isoDate(ts).slice(0, 7);
}

/** @param {string} dateStr */
export function parseDateMs(dateStr) {
  const ms = Date.parse(`${dateStr}T00:00:00Z`);
  return Number.isFinite(ms) ? ms : null;
}

/** @param {string} text */
export function normalizeFactKey(text) {
  return String(text ?? '').replace(/\s+/gu, ' ').trim().toLowerCase();
}

/** @param {string} text */
export function sanitizeFactBody(text) {
  return String(text ?? '')
    .replace(/\r?\n/gu, ' ')
    .replace(SPOOFED_SOURCE_RE, ' - from:')
    .replace(/\s+/gu, ' ')
    .trim();
}

/** @param {string} sourceLabel */
export function sanitizeSourceLabel(sourceLabel) {
  return String(sourceLabel ?? '')
    .replace(/\r?\n/gu, ' ')
    .replace(SPOOFED_SOURCE_RE, ' - from:')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 240);
}

/**
 * Parse a single standalone line of `MEMORY.md` (bullet, numbered, or plain body fact).
 * @param {string} line
 */
export function parseMemoryLine(line) {
  const raw = String(line ?? '');
  const parsed = parseBotMemoryLine(raw);
  if (!parsed) {
    return { isFact: false, raw, bullet: '', date: null, body: raw, source: null, key: '', kind: null };
  }
  return {
    isFact: true,
    raw,
    bullet: parsed.prefix,
    date: parsed.date,
    body: parsed.text,
    source: parsed.source,
    key: normalizeFactKey(parsed.text),
    kind: parsed.kind ?? null,
  };
}

/** @param {{ bullet?: string, date?: string | null, body: string, source?: string | null }} parts */
export function formatFactLine({ bullet = '- ', date = null, body, source = null }) {
  const safeBody = sanitizeFactBody(body);
  const datePart = date ? `${date} ` : '';
  const sourcePart = source ? `${MEMORY_SOURCE_SEPARATOR}${sanitizeSourceLabel(source)}` : '';
  return `${bullet}${datePart}${safeBody}${sourcePart}`;
}

/**
 * Scan and redact credential-like strings from text.
 * @param {string} text
 */
export function redactSecrets(text) {
  let out = String(text ?? '');
  let redacted = false;
  for (const pattern of SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    const replaced = out.replace(pattern, (_match, keyName) => {
      redacted = true;
      return keyName ? `${keyName}=[REDACTED]` : '[REDACTED]';
    });
    out = replaced;
  }
  return { text: out, redacted };
}

/** @param {string} text */
export function splitLines(text) {
  const normalized = String(text ?? '').replace(/\r\n/gu, '\n');
  if (!normalized) return [];
  const trimmedTrailing = normalized.endsWith('\n') ? normalized.slice(0, -1) : normalized;
  return trimmedTrailing === '' ? [] : trimmedTrailing.split('\n');
}

/** @param {string[]} lines */
export function joinLines(lines) {
  return lines.length === 0 ? '' : `${lines.join('\n')}\n`;
}

/** @param {string} homeDir */
export function readMemoryRaw(homeDir) {
  const file = path.join(homeDir, 'MEMORY.md');
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

/**
 * @param {string} homeDir
 * @param {string} content
 */
export function writeMemoryRaw(homeDir, content) {
  writeAtomicFile(path.join(homeDir, 'MEMORY.md'), content);
}

/**
 * Load `MEMORY.md` for prompt injection with 200-line truncation notice.
 * @param {string} homeDir
 * @param {number} [maxLines]
 */
export function readMemoryForPrompt(homeDir, maxLines = MEMORY_MAX_LOADED_LINES) {
  const raw = readMemoryRaw(homeDir);
  const lines = splitLines(raw);
  const totalLines = lines.length;
  if (totalLines <= maxLines) {
    return { text: joinLines(lines), totalLines, loadedLines: totalLines, truncatedLines: 0 };
  }
  const truncatedLines = totalLines - maxLines;
  const loaded = lines.slice(0, maxLines);
  const text = `${loaded.join('\n')}\n(${truncatedLines} more lines in MEMORY.md not loaded)\n`;
  return { text, totalLines, loadedLines: maxLines, truncatedLines };
}

/**
 * Collect fact entries from lines while respecting ```` ``` ```` / `~~~` code fences
 * and multi-line HTML comments.
 * @param {string[] | string} linesOrText
 */
export function collectFactEntries(linesOrText) {
  const text = Array.isArray(linesOrText) ? linesOrText.join('\n') : String(linesOrText ?? '');
  if (!text) return [];
  const scanned = scanBotMemoryLines(text);
  /** @type {Array<{ isFact: true, raw: string, bullet: string, date: string | null, body: string, source: string | null, key: string, kind: string | null, index: number }>} */
  const out = [];
  for (const entry of scanned.entries) {
    if (!entry.fact) continue;
    const key = normalizeFactKey(entry.fact.text);
    if (!key) continue;
    out.push({
      isFact: true,
      raw: entry.raw,
      bullet: entry.fact.prefix,
      date: entry.fact.date,
      body: entry.fact.text,
      source: entry.fact.source,
      key,
      kind: entry.fact.kind ?? null,
      index: entry.line,
    });
  }
  return out;
}

/**
 * @param {string} memoryDir
 * @param {string[]} archiveLines
 * @param {number} at
 */
export function appendArchiveLines(memoryDir, archiveLines, at) {
  if (!archiveLines || archiveLines.length === 0) return;
  fs.mkdirSync(memoryDir, { recursive: true });
  const archivePath = path.join(memoryDir, 'archive.md');
  const existing = fs.existsSync(archivePath) ? fs.readFileSync(archivePath, 'utf8') : '# Memory Archive\n';
  const sep = existing.endsWith('\n') ? '\n' : '\n\n';
  writeAtomicFile(archivePath, `${existing}${sep}## ${isoDate(at)}\n${archiveLines.join('\n')}\n`);
}
