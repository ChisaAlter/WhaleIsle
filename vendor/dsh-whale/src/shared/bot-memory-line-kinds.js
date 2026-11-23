// Memory 2.0 line-kind classification & standing owner rule/decision detection
// (English + Simplified Chinese compatible). Zero Node/DOM dependencies.

export const BOT_MEMORY_LINE_KINDS = Object.freeze([
  'rule',
  'prefers',
  'decided',
  'lesson',
  'fact',
]);

export const PROTECTED_MEMORY_KINDS = Object.freeze(['rule', 'prefers', 'decided']);

const LEADING_BULLET_OR_NUMBER_RE = /^\s*(?:[-*+]\s+|\d+[.)]\s+)/u;
const LEADING_DATE_RE = /^(\d{4}-\d{2}-\d{2})(?:\s*[:\u2013\u2014-]\s*|\s+)/u;
const SOURCE_SEP = ' · from: ';

const EXPLICIT_PREFIX_RULES = [
  { kind: 'rule', re: /^(Rule|规则)\s*[:：]\s*(.*)$/iu },
  { kind: 'prefers', re: /^(Prefers?|偏好)\s*[:：]\s*(.*)$/iu },
  { kind: 'decided', re: /^(Decided|Decision|决定|决策)\s*[:：]\s*(.*)$/iu },
  { kind: 'lesson', re: /^(Lesson|教训|经验)\s*[:：]\s*(.*)$/iu },
  { kind: 'fact', re: /^(Fact|事实)\s*[:：]\s*(.*)$/iu },
];

const STANDING_RULE_EN_RE =
  /\b(?:always|never|must(?:\s+not)?|mustn't|do\s+not|don't|prefer(?:s|red)?|standing\s+rule|hard\s+rule|forbidden|prohibited|only\s+use|stick\s+to|make\s+sure\s+to|remember\s+to|by\s+default|unless\s+asked|never\s+auto)\b/i;

const STANDING_RULE_ZH_RE =
  /(?:总是|始终|永远|务必|必须|不得|不要|严禁|禁止|绝不|千万别|偏好|倾向于|习惯于?|规则|原则|规范|一律|默认使用|统一使用|固定使用|长期|除非明确|切勿|严守)/u;

const DECISION_EN_RE =
  /\b(?:decided(?:\s+to|\s+on)?|decision|chose\s+to|chosen|agreed(?:\s+to|\s+on)?|settled\s+on|standardiz(?:e|ed)\s+on|we\s+use|going\s+with|locked\s+in)\b/i;

const DECISION_ZH_RE =
  /(?:已?决定|决策|拍板|定下来|约定好?|采用|选用|统一用|确定使用|最终选择)/u;

const LESSON_EN_RE =
  /\b(?:lesson(?:\s+learned)?|gotcha|pitfall|root\s+cause|takeaway|postmortem|watch\s+out|trap)\b/i;

const LESSON_ZH_RE = /(?:教训|踩坑|避坑|复盘|经验|根因|注意(?:事项|坑点))/u;

const OWNER_SOURCE_RE = /^(?:owner|主人|self|direct)$/i;

/**
 * Extract normalized `{ text, date, source }` from either a raw line string or a parsed fact object.
 * @param {string | { text?: string, body?: string, raw?: string, date?: string | null, source?: string | null }} input
 */
function unwrapMemoryLine(input) {
  if (input && typeof input === 'object') {
    const rawText = typeof input.text === 'string'
      ? input.text
      : (typeof input.body === 'string' ? input.body : String(input.raw ?? ''));
    return {
      text: rawText.trim(),
      date: input.date ?? null,
      source: input.source ?? null,
    };
  }
  let s = String(input ?? '').trim();
  s = s.replace(LEADING_BULLET_OR_NUMBER_RE, '');
  let source = null;
  const sepIdx = s.lastIndexOf(SOURCE_SEP);
  if (sepIdx > 0) {
    source = s.slice(sepIdx + SOURCE_SEP.length).trim() || null;
    s = s.slice(0, sepIdx).trim();
  }
  let date = null;
  const dm = LEADING_DATE_RE.exec(s);
  if (dm) {
    date = dm[1];
    s = s.slice(dm[0].length).trim();
  }
  return { text: s, date, source };
}

/**
 * Returns true when `source` indicates an untrusted/external non-owner origin.
 * @param {string | null | undefined} source
 */
export function isExternalMemorySource(source) {
  if (typeof source !== 'string' || !source.trim()) {
    return false;
  }
  return !OWNER_SOURCE_RE.test(source.trim());
}

/**
 * Parses an optional structured kind prefix (`Rule:`, `Prefers:`, `Decided:`, `Lesson:`, `Fact:`
 * and Chinese equivalents) from a memory fact line.
 * @param {string | { text?: string, body?: string, raw?: string, date?: string | null, source?: string | null }} input
 */
export function parseMemoryLineKind(input) {
  const { text } = unwrapMemoryLine(input);
  for (const entry of EXPLICIT_PREFIX_RULES) {
    const match = entry.re.exec(text);
    if (match) {
      return {
        kind: entry.kind,
        prefix: match[1],
        body: match[2].trim(),
        explicit: true,
      };
    }
  }
  if (STANDING_RULE_EN_RE.test(text) || STANDING_RULE_ZH_RE.test(text)) {
    return { kind: 'rule', prefix: null, body: text, explicit: false };
  }
  if (DECISION_EN_RE.test(text) || DECISION_ZH_RE.test(text)) {
    return { kind: 'decided', prefix: null, body: text, explicit: false };
  }
  if (LESSON_EN_RE.test(text) || LESSON_ZH_RE.test(text)) {
    return { kind: 'lesson', prefix: null, body: text, explicit: false };
  }
  return { kind: null, prefix: null, body: text, explicit: false };
}

/**
 * Returns true when a memory line represents an owner decision (explicit `Decided:` or decision wording).
 * @param {string | { text?: string, body?: string, raw?: string, date?: string | null, source?: string | null }} input
 * @param {{ allowExternal?: boolean }} [options]
 */
export function isOwnerDecisionLine(input, options = {}) {
  const { text, source } = unwrapMemoryLine(input);
  if (!text) return false;
  if (!options.allowExternal && isExternalMemorySource(source)) {
    return false;
  }
  const parsed = parseMemoryLineKind(text);
  if (parsed.explicit && parsed.kind === 'decided') {
    return true;
  }
  return DECISION_EN_RE.test(text) || DECISION_ZH_RE.test(text);
}

/**
 * Returns true when a memory line carries an owner standing rule, preference, or long-term decision
 * that Tidy-Up / status migration must protect from accidental deletion.
 * @param {string | { text?: string, body?: string, raw?: string, date?: string | null, source?: string | null }} input
 * @param {{ allowExternal?: boolean }} [options]
 */
export function isStandingOwnerRule(input, options = {}) {
  const { text, source } = unwrapMemoryLine(input);
  if (!text) return false;
  if (!options.allowExternal && isExternalMemorySource(source)) {
    return false;
  }
  const parsed = parseMemoryLineKind(text);
  if (parsed.explicit && parsed.kind !== null && PROTECTED_MEMORY_KINDS.includes(parsed.kind)) {
    return true;
  }
  return (
    STANDING_RULE_EN_RE.test(text)
    || STANDING_RULE_ZH_RE.test(text)
    || DECISION_EN_RE.test(text)
    || DECISION_ZH_RE.test(text)
  );
}

/**
 * Returns true when a memory line captures a lesson/gotcha (useful for salvage candidates).
 * @param {string | { text?: string, body?: string, raw?: string, date?: string | null, source?: string | null }} input
 */
export function isLessonMemoryLine(input) {
  const { text } = unwrapMemoryLine(input);
  if (!text) return false;
  const parsed = parseMemoryLineKind(text);
  if (parsed.explicit && parsed.kind === 'lesson') {
    return true;
  }
  return LESSON_EN_RE.test(text) || LESSON_ZH_RE.test(text);
}

/**
 * Returns true when Tidy-Up must protect this line from automatic retirement:
 * - Undated lines (unless `protectUndated === false`)
 * - Standing owner rules / preferences / decisions
 * @param {string | { text?: string, body?: string, raw?: string, date?: string | null, source?: string | null }} input
 * @param {{ protectUndated?: boolean, allowExternal?: boolean }} [options]
 */
export function isProtectedMemoryLine(input, options = {}) {
  const unwrapped = unwrapMemoryLine(input);
  if (!unwrapped.text) return false;
  if (options.protectUndated !== false && unwrapped.date === null) {
    return true;
  }
  return isStandingOwnerRule(unwrapped, options);
}
