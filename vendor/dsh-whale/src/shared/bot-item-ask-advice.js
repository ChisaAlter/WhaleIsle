/**
 * Linear, zero-backtracking readability advisor for Work Item `needs_you` questions.
 * Skips fenced code blocks, inline code spans, Markdown link targets, and bare URLs.
 * Recognizes both English `?` and Chinese `？`. Returns at most one `Tip: ...` string or `null`.
 */

export const ASK_ADVICE_LIMITS = Object.freeze({
  maxQuestionChars: 140,
  maxContextLines: 5,
  maxContextChars: 300,
});

/** @param {string} ch */
function isWhitespace(ch) {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';
}

/** @param {string} ch */
function isUrlStop(ch) {
  return (
    isWhitespace(ch)
    || ch === ')'
    || ch === ']'
    || ch === '>'
    || ch === '"'
    || ch === "'"
    || ch === '，'
    || ch === '。'
    || ch === '；'
    || ch === '！'
    || ch === '）'
    || ch === '】'
  );
}

/** @param {number} code */
function isHexChar(code) {
  return (
    (code >= 48 && code <= 57) // 0-9
    || (code >= 65 && code <= 70) // A-F
    || (code >= 97 && code <= 102) // a-f
  );
}

/** @param {number} code */
function isDigitCode(code) {
  return code >= 48 && code <= 57;
}

/** @param {number} code */
function isHexLetterCode(code) {
  return (code >= 65 && code <= 70) || (code >= 97 && code <= 102);
}

/** @param {number} code */
function isTokenChar(code) {
  return (
    (code >= 48 && code <= 57)
    || (code >= 65 && code <= 90)
    || (code >= 97 && code <= 122)
    || code === 45 // -
    || code === 95 // _
  );
}

/**
 * Check whether a line opens a fenced code block (up to 3 leading spaces, 3+ backticks or tildes).
 * @param {string} line
 * @returns {{ char: string, count: number } | null}
 */
function parseFenceOpen(line) {
  let i = 0;
  while (i < line.length && i < 3 && line[i] === ' ') i += 1;
  const ch = line[i];
  if (ch !== '`' && ch !== '~') return null;
  let count = 0;
  while (i + count < line.length && line[i + count] === ch) count += 1;
  if (count < 3) return null;
  // Backtick info strings cannot contain backticks in CommonMark.
  if (ch === '`') {
    for (let j = i + count; j < line.length; j += 1) {
      if (line[j] === '`') return null;
    }
  }
  return { char: ch, count };
}

/**
 * Check whether a line closes the active fenced code block.
 * @param {string} line
 * @param {{ char: string, count: number }} fence
 */
function isFenceClose(line, fence) {
  let i = 0;
  while (i < line.length && i < 3 && line[i] === ' ') i += 1;
  let count = 0;
  while (i + count < line.length && line[i + count] === fence.char) count += 1;
  if (count < fence.count) return false;
  for (let j = i + count; j < line.length; j += 1) {
    if (line[j] !== ' ' && line[j] !== '\t') return false;
  }
  return true;
}

/**
 * Strip inline code spans, Markdown link/image targets `(target)`, and bare URLs from one line
 * in strictly linear O(n) time without regex backtracking.
 * @param {string} line
 */
function stripInlineNonProse(line) {
  const len = line.length;
  let out = '';
  let i = 0;
  /** @type {Set<number>} */
  const exhaustedBackticks = new Set();
  let noMoreLinkAtOrAfter = len + 1;

  while (i < len) {
    const ch = line[i];

    // 1. Inline code span (`...` or ``...``)
    if (ch === '`') {
      let tickCount = 0;
      while (i + tickCount < len && line[i + tickCount] === '`') tickCount += 1;
      if (!exhaustedBackticks.has(tickCount)) {
        let j = i + tickCount;
        let found = -1;
        while (j < len) {
          if (line[j] === '`') {
            let run = 0;
            while (j + run < len && line[j + run] === '`') run += 1;
            if (run === tickCount) {
              found = j + run;
              break;
            }
            j += run;
          } else {
            j += 1;
          }
        }
        if (found !== -1) {
          out += ' ';
          i = found;
          continue;
        }
        exhaustedBackticks.add(tickCount);
      }
      out += line.slice(i, i + tickCount);
      i += tickCount;
      continue;
    }

    // 2. Markdown link `[label](target)` or image `![alt](target)`
    const isImage = ch === '!' && i + 1 < len && line[i + 1] === '[';
    if ((ch === '[' || isImage) && i < noMoreLinkAtOrAfter) {
      const labelStart = isImage ? i + 2 : i + 1;
      let j = labelStart;
      let closeBracket = -1;
      while (j < len) {
        if (line[j] === '\\' && j + 1 < len) {
          j += 2;
          continue;
        }
        if (line[j] === ']') {
          closeBracket = j;
          break;
        }
        j += 1;
      }
      if (closeBracket !== -1 && closeBracket + 1 < len && line[closeBracket + 1] === '(') {
        let k = closeBracket + 2;
        let depth = 1;
        while (k < len && depth > 0) {
          if (line[k] === '\\' && k + 1 < len) {
            k += 2;
            continue;
          }
          if (line[k] === '(') depth += 1;
          else if (line[k] === ')') depth -= 1;
          k += 1;
        }
        if (depth === 0) {
          const label = line.slice(labelStart, closeBracket);
          out += stripInlineNonProse(label);
          i = k;
          continue;
        }
      } else if (closeBracket === -1) {
        noMoreLinkAtOrAfter = i;
      }
    }

    // 3. Bare HTTP(S) URL
    if (
      (ch === 'h' || ch === 'H')
      && (line.slice(i, i + 7).toLowerCase() === 'http://' || line.slice(i, i + 8).toLowerCase() === 'https://')
    ) {
      let j = i + (line[i + 4] === ':' ? 7 : 8);
      while (j < len && !isUrlStop(line[j])) j += 1;
      out += ' ';
      i = j;
      continue;
    }

    out += ch;
    i += 1;
  }

  return out;
}

/**
 * Strip fenced code blocks, inline code, URLs, and Markdown link targets in O(n) time.
 * @param {string} raw
 * @returns {{ prose: string, proseLines: string[] }}
 */
export function stripNonProse(raw) {
  if (typeof raw !== 'string' || raw.length === 0) {
    return { prose: '', proseLines: [] };
  }
  const normalized = raw.replace(/\r\n?/g, '\n');
  const rawLines = normalized.split('\n');
  /** @type {string[]} */
  const proseLines = [];
  /** @type {{ char: string, count: number } | null} */
  let activeFence = null;

  for (const line of rawLines) {
    if (activeFence) {
      if (isFenceClose(line, activeFence)) activeFence = null;
      continue;
    }
    const opened = parseFenceOpen(line);
    if (opened) {
      activeFence = opened;
      continue;
    }
    proseLines.push(stripInlineNonProse(line));
  }

  return { prose: proseLines.join('\n'), proseLines };
}

/** @param {string} text */
function hasQuestionMark(text) {
  return text.includes('?') || text.includes('？');
}

/**
 * Check if a trimmed prose line begins with a hand-written option marker
 * (bullet, numbered, lettered, or Option/选项 prefix). Linear scan.
 * @param {string} trimmed
 */
function isOptionLine(trimmed) {
  if (!trimmed) return false;
  // Bullet list: "- foo", "* foo", "• foo"
  if ((trimmed[0] === '-' || trimmed[0] === '*' || trimmed[0] === '•') && trimmed.length > 2 && trimmed[1] === ' ') {
    return true;
  }
  // Parenthesized number or letter: "(1) ", "（1）", "(A) ", "（A）"
  if ((trimmed[0] === '(' || trimmed[0] === '（') && trimmed.length >= 4) {
    const inner = trimmed[1];
    const close = trimmed[2];
    const validClose = close === ')' || close === '）';
    if (validClose && ((inner >= '1' && inner <= '9') || (inner >= 'A' && inner <= 'H') || (inner >= 'a' && inner <= 'h'))) {
      return true;
    }
  }
  // Numbered: "1. ", "2) ", "1、"
  if (trimmed[0] >= '1' && trimmed[0] <= '9') {
    let idx = 1;
    while (idx < trimmed.length && idx < 3 && trimmed[idx] >= '0' && trimmed[idx] <= '9') idx += 1;
    const sep = trimmed[idx];
    if (sep === '、' || ((sep === '.' || sep === ')') && trimmed[idx + 1] === ' ')) {
      return true;
    }
  }
  // Lettered: "A. ", "B) ", "A: ", "A："
  if (
    ((trimmed[0] >= 'A' && trimmed[0] <= 'H') || (trimmed[0] >= 'a' && trimmed[0] <= 'h'))
    && trimmed.length >= 3
  ) {
    const sep = trimmed[1];
    if (sep === '：' || ((sep === '.' || sep === ')' || sep === ':') && trimmed[2] === ' ')) {
      return true;
    }
  }
  // Explicit word prefix: "Option 1", "Option A", "选项1", "选项A", "方案1", "方案A"
  const lower = trimmed.toLowerCase();
  if (lower.startsWith('option ') || trimmed.startsWith('选项') || trimmed.startsWith('方案')) {
    return true;
  }
  return false;
}

/**
 * Detect inline multi-option text like `A) foo B) bar` or `1) foo 2) bar`. Linear scan.
 * @param {string} prose
 */
function hasInlineOptions(prose) {
  let markers = 0;
  for (let i = 0; i + 2 < prose.length; i += 1) {
    const prevOk = i === 0 || isWhitespace(prose[i - 1]) || prose[i - 1] === '/' || prose[i - 1] === '，' || prose[i - 1] === ',';
    if (!prevOk) continue;
    const ch = prose[i];
    const sep = prose[i + 1];
    const next = prose[i + 2];
    const isAlphaOrNum = (ch >= 'A' && ch <= 'H') || (ch >= '1' && ch <= '8');
    if (isAlphaOrNum && sep === ')' && (next === ' ' || next === '\t')) {
      markers += 1;
      if (markers >= 2) return true;
    }
  }
  return false;
}

/** @param {string[]} proseLines @param {string} prose */
function hasHandwrittenOptions(proseLines, prose) {
  let optionLines = 0;
  for (const line of proseLines) {
    if (isOptionLine(line.trim())) {
      optionLines += 1;
      if (optionLines >= 2) return true;
    }
  }
  return hasInlineOptions(prose);
}

/**
 * Check if `tok` is a standard 36-char UUID (`8-4-4-4-12` hex). Linear, zero regex.
 * @param {string} tok
 */
function isUuidToken(tok) {
  if (tok.length !== 36) return false;
  for (let i = 0; i < 36; i += 1) {
    if (i === 8 || i === 13 || i === 18 || i === 23) {
      if (tok[i] !== '-') return false;
    } else if (!isHexChar(tok.charCodeAt(i))) {
      return false;
    }
  }
  return true;
}

/**
 * Check if `tok` is a bare hex hash (7..64 hex chars with digit+letter, or 16+ hex, or `0x` + 7+ hex).
 * @param {string} tok
 */
function isBareHexHash(tok) {
  let start = 0;
  let hasPrefix = false;
  if (tok.length > 2 && tok[0] === '0' && (tok[1] === 'x' || tok[1] === 'X')) {
    start = 2;
    hasPrefix = true;
  }
  const hexLen = tok.length - start;
  if (hexLen < 7 || hexLen > 64) return false;
  let hasDigit = false;
  let hasLetter = false;
  for (let i = start; i < tok.length; i += 1) {
    const c = tok.charCodeAt(i);
    if (!isHexChar(c)) return false;
    if (isDigitCode(c)) hasDigit = true;
    if (isHexLetterCode(c)) hasLetter = true;
  }
  if (hasPrefix) return true;
  if (hexLen >= 16) return true;
  return hasDigit && hasLetter;
}

const INTERNAL_ID_PREFIXES = ['disp-', 'sess-', 'task-', 'req-', 'op-'];

/** @param {string} tok */
function isInternalIdToken(tok) {
  const lower = tok.toLowerCase();
  for (const prefix of INTERNAL_ID_PREFIXES) {
    if (!lower.startsWith(prefix)) continue;
    const rest = lower.slice(prefix.length);
    if (rest.length < 8) return false;
    let hasDigit = false;
    for (let i = 0; i < rest.length; i += 1) {
      if (isDigitCode(rest.charCodeAt(i))) {
        hasDigit = true;
        break;
      }
    }
    return hasDigit;
  }
  return false;
}

/**
 * Linearly scan `prose` for bare UUIDs, commit/hex hashes, or internal IDs.
 * @param {string} prose
 */
function containsBareIdOrHash(prose) {
  const len = prose.length;
  let i = 0;
  while (i < len) {
    while (i < len && !isTokenChar(prose.charCodeAt(i))) i += 1;
    const start = i;
    while (i < len && isTokenChar(prose.charCodeAt(i))) i += 1;
    if (i > start) {
      const tok = prose.slice(start, i);
      if (isUuidToken(tok) || isBareHexHash(tok) || isInternalIdToken(tok)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Analyze a `needs_you` question payload and return at most one actionable `Tip: ...` string,
 * or `null` if the question is clear and concise.
 *
 * @param {string | { comment?: string | null, text?: string | null, ask?: { context?: string | null, questions?: Array<{ prompt?: string, options?: Array<{ label?: string, detail?: string }> }> } | null }} input
 * @returns {string | null}
 */
export function botItemAskAdvice(input) {
  if (!input) return null;
  const rawObj = typeof input === 'string' ? { text: input } : input;
  const ask = rawObj.ask && typeof rawObj.ask === 'object' ? rawObj.ask : null;
  const rawComment = typeof rawObj.comment === 'string'
    ? rawObj.comment
    : (typeof rawObj.text === 'string' ? rawObj.text : '');
  const questions = Array.isArray(ask?.questions) ? ask.questions : [];
  const hasStructuredAsk = questions.length > 0;
  const hasStructuredOptions = hasStructuredAsk
    && questions.some((q) => Array.isArray(q?.options) && q.options.length > 0);

  if (hasStructuredAsk && ask) {
    const contextRaw = typeof ask.context === 'string' && ask.context.trim()
      ? ask.context
      : '';
    const contextStripped = stripNonProse(contextRaw);

    // 1. Missing question mark in structured prompt(s)
    for (const q of questions) {
      const promptStripped = stripNonProse(String(q?.prompt ?? '')).prose.trim();
      if (!promptStripped || !hasQuestionMark(promptStripped)) {
        return 'Tip: End each ask question with a question mark (? / ？) so the owner can spot the decision immediately.';
      }
    }

    // 2. Question prompt > 140 chars
    for (const q of questions) {
      const promptVisible = stripNonProse(String(q?.prompt ?? '')).prose.trim();
      if (promptVisible.length > ASK_ADVICE_LIMITS.maxQuestionChars) {
        return `Tip: Keep each question under ${ASK_ADVICE_LIMITS.maxQuestionChars} characters; put background details in ask.context or the item description.`;
      }
    }

    // 3. Context > 5 non-empty lines or > 300 chars
    if (contextRaw) {
      const nonEmpty = contextStripped.proseLines.filter((l) => l.trim().length > 0);
      if (nonEmpty.length > ASK_ADVICE_LIMITS.maxContextLines || contextStripped.prose.trim().length > ASK_ADVICE_LIMITS.maxContextChars) {
        return `Tip: Keep background context brief (<= ${ASK_ADVICE_LIMITS.maxContextLines} lines / ${ASK_ADVICE_LIMITS.maxContextChars} chars); move longer details into the item description.`;
      }
    }

    // 4. Bare hex hash / UUID / internal ID
    if (contextStripped.prose && containsBareIdOrHash(contextStripped.prose)) {
      return 'Tip: Avoid bare commit hashes, UUIDs, or internal IDs in needs_you questions; name the PR, file, or feature instead.';
    }
    for (const q of questions) {
      if (containsBareIdOrHash(stripNonProse(String(q?.prompt ?? '')).prose)) {
        return 'Tip: Avoid bare commit hashes, UUIDs, or internal IDs in needs_you questions; name the PR, file, or feature instead.';
      }
      for (const opt of q?.options ?? []) {
        if (
          containsBareIdOrHash(stripNonProse(String(opt?.label ?? '')).prose)
          || containsBareIdOrHash(stripNonProse(String(opt?.detail ?? '')).prose)
        ) {
          return 'Tip: Avoid bare commit hashes, UUIDs, or internal IDs in needs_you questions; name the PR, file, or feature instead.';
        }
      }
    }

    return null;
  }

  // Plain-text `needs_you` comment (without structured `ask`)
  if (!rawComment.trim()) return null;
  const { prose, proseLines } = stripNonProse(rawComment);
  const trimmedProse = prose.trim();
  const nonEmptyLines = proseLines.map((l) => l.trim()).filter(Boolean);

  // 1. Hand-written options in prose without structured `ask.questions[].options`
  if (!hasStructuredOptions && hasHandwrittenOptions(proseLines, prose)) {
    return 'Tip: Pass choices via structured ask.questions[].options instead of listing options in text so the owner can pick with one click.';
  }

  // 2. Missing question mark (? or ？)
  if (!hasQuestionMark(trimmedProse)) {
    return 'Tip: End your needs_you message with a clear question mark (? / ？) so the owner knows what decision is needed.';
  }

  // 3. Question line > 140 chars
  const questionLines = nonEmptyLines.filter((l) => hasQuestionMark(l));
  if (questionLines.some((l) => l.length > ASK_ADVICE_LIMITS.maxQuestionChars)) {
    return `Tip: Keep the question under ${ASK_ADVICE_LIMITS.maxQuestionChars} characters so it scans cleanly; put supporting details in the item description.`;
  }

  // 4. Background > 5 non-empty lines or > 300 chars
  const bgLines = nonEmptyLines.filter((l) => !hasQuestionMark(l));
  const bgText = bgLines.join('\n');
  if (
    bgLines.length > ASK_ADVICE_LIMITS.maxContextLines
    || bgText.length > ASK_ADVICE_LIMITS.maxContextChars
    || nonEmptyLines.length > ASK_ADVICE_LIMITS.maxContextLines + 1
    || trimmedProse.length > ASK_ADVICE_LIMITS.maxContextChars + ASK_ADVICE_LIMITS.maxQuestionChars
  ) {
    return `Tip: Keep background context brief (<= ${ASK_ADVICE_LIMITS.maxContextLines} lines / ${ASK_ADVICE_LIMITS.maxContextChars} chars); move longer context to the item description.`;
  }

  // 5. Bare hex hash / UUID / internal ID
  if (containsBareIdOrHash(prose)) {
    return 'Tip: Avoid bare commit hashes, UUIDs, or internal IDs in needs_you questions; name the PR, file, or feature instead.';
  }

  return null;
}
