/**
 * 14-day Re-add Guard, bilingual similarity matching, recent archive reader,
 * and ephemeral status-signal detector for Bot Memory Service.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  isoDate,
  normalizeFactKey,
  parseDateMs,
  parseMemoryLine,
  splitLines,
} from './memory-helpers.js';

export const READD_GUARD_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
export const READD_SIMILARITY_THRESHOLD = 0.8;
export const READD_OWNER_OVERLAP_THRESHOLD = 0.5;

const ARCHIVE_SECTION_DATE_RE = /^##\s+(\d{4}-\d{2}-\d{2})\b/;
const ARCHIVE_SUFFIX_RE = /\s*·\s*(moved|replaced|merged|kept out|retired(?:\s*\([^)]*\))?)\s+(\d{4}-\d{2}-\d{2})\s*$/i;

// Ephemeral status-line detectors (>=2 hits & non-standing-rule => migrate to monthly journal)
const STATUS_SIGNALS = [
  // PR reference
  /(?:\bPR\s*#?\d+\b|\/pull\/\d+\b|(?:^|\s)#[1-9]\d{1,5}\b)/iu,
  // Git commit SHA (7-40 hex chars with at least one digit and one hex letter)
  /\b(?=[0-9a-f]{7,40}\b)(?=.*\d)(?=.*[a-f])[0-9a-f]{7,40}\b/u,
  // Worker / dispatch reference
  /(?:\b(?:dispatch(?:[_-]?[a-z0-9-]+)?|worker(?:[_-]?[a-z0-9-]+)?|subagent|bot_work)\b|派遣)/iu,
  // Review round / CI status
  /(?:\b(?:round\s*\d+|ci\s+(?:fail(?:ed|ing)?|pass(?:ed|ing)?|green|red|pending|running)|checks?\s+(?:fail(?:ed|ing)?|pass(?:ed)?|pending)|review\s+round)\b|第\s*\d+\s*轮|CI\s*(?:失败|通过|等待))/iu,
  // Temporary workflow status words
  /(?:\b(?:pending|waiting\s+(?:on|for)|in\s+progress|merged|queued|retrying|blocked\s+(?:on|by)|awaiting|needs\s+review|opened\s+pr)\b|等待中|进行中|待合并|已合并|待审|重试中|阻塞中)/iu,
];

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'to', 'of', 'in', 'on', 'for', 'and', 'or', 'at', 'by', 'with',
  '的', '了', '在', '是', '和', '与', '就', '都', '也',
]);

/**
 * Tokenize English words + CJK characters/bigrams for bilingual similarity checks.
 * @param {string} text
 * @returns {Set<string>}
 */
function tokenizeForSimilarity(text) {
  const clean = String(text ?? '')
    .toLowerCase()
    .replace(/~~/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  if (!clean) return new Set();
  /** @type {Set<string>} */
  const tokens = new Set();
  const latinWords = clean.match(/[a-z0-9]+/gu) ?? [];
  for (const word of latinWords) {
    if (word.length >= 2 && !STOP_WORDS.has(word)) {
      tokens.add(word);
    }
  }
  const cjkRuns = clean.match(/[\p{Script=Han}]+/gu) ?? [];
  for (const run of cjkRuns) {
    if (run.length === 1) {
      if (!STOP_WORDS.has(run)) tokens.add(run);
    } else {
      for (let i = 0; i < run.length - 1; i += 1) {
        tokens.add(run.slice(i, i + 2));
      }
    }
  }
  return tokens;
}

/**
 * Compute normalized similarity in `[0, 1]` between two memory fact texts.
 * @param {string} a
 * @param {string} b
 */
export function memoryTextSimilarity(a, b) {
  const normA = normalizeFactKey(a).replace(/~~/g, '');
  const normB = normalizeFactKey(b).replace(/~~/g, '');
  if (!normA || !normB) return 0;
  if (normA === normB) return 1;
  const setA = tokenizeForSimilarity(normA);
  const setB = tokenizeForSimilarity(normB);
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersect = 0;
  for (const tok of setA) {
    if (setB.has(tok)) intersect += 1;
  }
  const union = setA.size + setB.size - intersect;
  const jaccard = union > 0 ? intersect / union : 0;
  const dice = (2 * intersect) / (setA.size + setB.size);
  return Math.max(jaccard, dice);
}

/**
 * Fraction of `factText` tokens covered by `ownerMessageText`.
 * @param {string} factText
 * @param {string} ownerMessageText
 */
export function ownerMessageOverlap(factText, ownerMessageText) {
  if (!ownerMessageText || !String(ownerMessageText).trim()) return 0;
  const factTokens = tokenizeForSimilarity(factText);
  if (factTokens.size === 0) return 0;
  const ownerTokens = tokenizeForSimilarity(ownerMessageText);
  let matched = 0;
  for (const tok of factTokens) {
    if (ownerTokens.has(tok)) matched += 1;
  }
  return matched / factTokens.size;
}

/**
 * Read archived facts from `memory/archive.md` that were removed/archived within the last 14 days.
 * @param {string} homeDir
 * @param {number} [at]
 */
export function readRecentArchivedFacts(homeDir, at = Date.now()) {
  const archivePath = path.join(homeDir, 'memory', 'archive.md');
  if (!fs.existsSync(archivePath)) return [];
  const raw = fs.readFileSync(archivePath, 'utf8');
  const lines = splitLines(raw);
  const cutoff = at - READD_GUARD_WINDOW_MS;
  /** @type {string | null} */
  let sectionDate = null;
  /** @type {Array<{ text: string, archivedDate: string, raw: string }>} */
  const recent = [];

  for (const line of lines) {
    const secMatch = ARCHIVE_SECTION_DATE_RE.exec(line.trim());
    if (secMatch) {
      sectionDate = secMatch[1];
      continue;
    }
    const suffixMatch = ARCHIVE_SUFFIX_RE.exec(line);
    const archivedDate = suffixMatch?.[2] ?? sectionDate;
    if (!archivedDate) continue;
    const archivedMs = parseDateMs(archivedDate);
    if (archivedMs === null || archivedMs < cutoff || archivedMs > at + 24 * 60 * 60 * 1000) {
      continue;
    }
    const strippedLine = suffixMatch ? line.slice(0, suffixMatch.index).trimEnd() : line.trimEnd();
    const parsed = parseMemoryLine(strippedLine);
    if (!parsed.isFact || !parsed.body) continue;
    const cleanText = parsed.body.replace(/^~~([\s\S]*)~~$/, '$1').trim();
    if (!cleanText) continue;
    recent.push({
      text: cleanText,
      archivedDate,
      raw: line,
    });
  }
  return recent;
}

/**
 * Count how many ephemeral status signals appear in a memory line.
 * @param {string} text
 */
export function countStatusSignals(text) {
  const s = String(text ?? '');
  let count = 0;
  for (const re of STATUS_SIGNALS) {
    if (re.test(s)) count += 1;
  }
  return count;
}

/**
 * 14-day Re-add Guard: checks whether newly added fact lines match any fact archived in the
 * past 14 days (similarity >= 0.8) without being explicitly asked by the owner in this turn
 * (owner overlap < 0.5). Matching ghost re-adds are kept out of MEMORY.md and recorded in
 * `memory/archive.md` with `· kept out YYYY-MM-DD`.
 * @param {{
 *   homeDir: string,
 *   candidateLines: Array<any>,
 *   ownerMessageText?: string,
 *   at?: number,
 * }} params
 */
export function evaluateReaddGuard({ homeDir, candidateLines, ownerMessageText = '', at = Date.now() }) {
  const recentArchived = readRecentArchivedFacts(homeDir, at);
  if (recentArchived.length === 0) {
    return { allowed: candidateLines, keptOut: /** @type {Array<any>} */ ([]) };
  }
  /** @type {Array<any>} */
  const allowed = [];
  /** @type {Array<any>} */
  const keptOut = [];
  for (const item of candidateLines) {
    const factText = item?.body ?? parseMemoryLine(String(item?.line ?? item ?? '')).body;
    const bestMatch = recentArchived.find(
      (arch) => memoryTextSimilarity(factText, arch.text) >= READD_SIMILARITY_THRESHOLD,
    );
    if (bestMatch) {
      const overlap = ownerMessageOverlap(factText, ownerMessageText);
      if (overlap < READD_OWNER_OVERLAP_THRESHOLD) {
        keptOut.push({
          ...item,
          matchedArchived: bestMatch.text,
          archiveEntry: `${String(item?.line ?? item ?? '').trimEnd()} · kept out ${isoDate(at)}`,
        });
        continue;
      }
    }
    allowed.push(item);
  }
  return { allowed, keptOut };
}
