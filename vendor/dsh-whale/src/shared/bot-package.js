// BotPackageV1 export/import validation, agent-neutral skill planning,
// URL authority credential parsing, and 5-category bot text security scanner (`scanBotText`).

import { BOT_AVATAR_FILE, BOT_MASCOT_IDS, isBotMascotId, mascotAvatar } from './bot-avatar.js';
import { redactSecretLike } from './bot-memory-lines.js';
import { BOT_TOOL_HEADER_NAME_PATTERN, BOT_TOOL_LIMITS, BOT_TOOL_NAME_PATTERN } from './bot-tools-schema.js';
import { BOT_AGENTS, isBotAgent, validateBotName } from './bot-types.js';

export const BOT_PACKAGE_SCHEMA_VERSION = 1;
export const BOT_PACKAGE_MANIFEST_PATH = 'dev.orca.bot-sharing/bot.json';
export const BOT_PACKAGE_SOUL_PATH = 'SOUL.md';
export const BOT_PACKAGE_AVATAR_PATH = BOT_AVATAR_FILE;
export const BOT_PACKAGE_MAX_MANIFEST_BYTES = 256 * 1024;
export const BOT_PACKAGE_PURPOSE_MAX = 200;
export const BOT_PACKAGE_SETUP_NOTE_MAX = 2000;
export const BOT_PACKAGE_NEWER_ERROR = 'bot-package-newer-schema';

export const BOT_PACKAGE_RESULTS = Object.freeze(['chat', 'slack-channel', 'linear-issue', 'none']);
export const BOT_PACKAGE_EVENT_RESULTS = Object.freeze([...BOT_PACKAGE_RESULTS, 'thread']);
export const BOT_PACKAGE_CONNECTORS = Object.freeze(['github', 'slack', 'linear', 'google', 'composio']);

export const BOT_PACKAGE_EVENT_KINDS = Object.freeze({
  slack: Object.freeze(['mentioned', 'message', 'reaction']),
  github: Object.freeze([
    'issue_opened', 'pr_opened', 'pr_pushed', 'pr_merged', 'comment', 'review_comment',
    'review', 'mentioned', 'review_requested', 'assigned', 'ci_failed', 'ci_passed',
    'pr_conflicted', 'pr_closed', 'pr_ready', 'labeled', 'issue_closed',
    'deploy_finished', 'security_alert', 'workflow_finished',
  ]),
  linear: Object.freeze(['assigned', 'mentioned', 'issue_created', 'issue_moved']),
  gmail: Object.freeze(['new_email']),
  calendar: Object.freeze(['starting_soon']),
});

export const BOT_TEXT_SCAN_KINDS = Object.freeze([
  'secret',
  'pipe-to-shell',
  'sudo',
  'sends-file',
  'hidden-unicode',
]);

const PART_NAME_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const PART_ID_RE = /^[a-z0-9-]{1,32}$/;
const MEMORY_PATH_RE = /^memory\/([^/]+)\.md$/;
const SKILL_PATH_RE = /^skills\/([^/]+)\/(.+)$/;

const ALLOWED_TOP_KEYS = new Set([
  'schemaVersion', 'name', 'avatar', 'purpose', 'agentHint', 'skills',
  'tools', 'connectors', 'schedules', 'eventSuggestions', 'memory', 'setupNote',
]);

/**
 * Extracts the authority component of a URL (`scheme://<authority>/...`), distinguishing
 * `@` in the authority (embedded userinfo credentials like `https://user:pass@host/path`)
 * from `@` in the path (e.g. `https://server.smithery.ai/@owner/mcp`).
 * @param {string} rawUrl
 */
export function botToolUrlAuthority(rawUrl) {
  if (typeof rawUrl !== 'string') return null;
  const trimmed = rawUrl.trim();
  const schemeMatch = /^([a-z][a-z0-9+.-]*):\/\//i.exec(trimmed);
  if (!schemeMatch) return null;
  const afterScheme = trimmed.slice(schemeMatch[0].length);
  const endIdx = afterScheme.search(/[/?#]/);
  const authority = endIdx === -1 ? afterScheme : afterScheme.slice(0, endIdx);
  if (!authority) return null;
  const atIdx = authority.lastIndexOf('@');
  const hasUserinfo = atIdx !== -1;
  return {
    scheme: schemeMatch[1].toLowerCase(),
    authority,
    userinfo: hasUserinfo ? authority.slice(0, atIdx) : '',
    host: hasUserinfo ? authority.slice(atIdx + 1) : authority,
    hasUserinfo,
  };
}

/**
 * Validates an HTTP/HTTPS MCP tool URL without embedded credentials in the authority,
 * while correctly allowing `@` in the URL path (such as `https://server.smithery.ai/@owner/mcp`).
 * @param {string} value
 */
export function isSafeBotPackageToolUrl(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > BOT_TOOL_LIMITS.maxUrlLength) {
    return false;
  }
  const auth = botToolUrlAuthority(value);
  if (!auth || (auth.scheme !== 'http' && auth.scheme !== 'https') || auth.hasUserinfo || !auth.host) {
    return false;
  }
  try {
    const parsed = new URL(value);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

export function validateSkillPackageName(name) {
  if (typeof name !== 'string' || !PART_NAME_RE.test(name) || name.includes('--')) {
    throw new Error('Use lowercase letters, digits and dashes');
  }
  return name;
}

function isValidPartName(name) {
  return typeof name === 'string' && PART_NAME_RE.test(name) && !name.includes('--');
}

function validateAvatarField(avatar) {
  if (avatar === undefined) {
    return { ok: true, value: undefined };
  }
  if (!avatar || typeof avatar !== 'object') {
    return { ok: false };
  }
  if (typeof avatar.mascot === 'string' && isBotMascotId(avatar.mascot)) {
    return { ok: true, value: { mascot: avatar.mascot } };
  }
  if (avatar.image === BOT_PACKAGE_AVATAR_PATH) {
    return { ok: true, value: { image: BOT_PACKAGE_AVATAR_PATH } };
  }
  return { ok: false };
}

function validateToolsField(tools) {
  if (!Array.isArray(tools) || tools.length > 32) {
    return null;
  }
  const out = [];
  for (const tool of tools) {
    if (
      !tool || typeof tool !== 'object'
      || !PART_ID_RE.test(String(tool.id ?? ''))
      || !BOT_TOOL_NAME_PATTERN.test(String(tool.name ?? ''))
      || !isSafeBotPackageToolUrl(tool.url)
      || !Array.isArray(tool.headerNames)
      || tool.headerNames.length > 16
      || tool.headerNames.some((h) => !BOT_TOOL_HEADER_NAME_PATTERN.test(String(h ?? '')))
    ) {
      return null;
    }
    out.push({ id: tool.id, name: tool.name, url: tool.url, headerNames: [...tool.headerNames] });
  }
  return out;
}

function isNonEmptyString(value, max) {
  return typeof value === 'string' && value.length >= 1 && value.length <= max;
}

function isValidScheduleEntry(s) {
  if (!s || typeof s !== 'object' || !PART_ID_RE.test(String(s.id ?? ''))) {
    return false;
  }
  if (!isNonEmptyString(s.name, 200) || !isNonEmptyString(s.prompt, 20_000) || !isNonEmptyString(s.rrule, 512)) {
    return false;
  }
  if (!BOT_PACKAGE_RESULTS.includes(s.results)) {
    return false;
  }
  return s.timezone === undefined || isNonEmptyString(s.timezone, 64);
}

function validateSchedulesField(schedules) {
  if (!Array.isArray(schedules) || schedules.length > 32) {
    return null;
  }
  const out = [];
  for (const s of schedules) {
    if (!isValidScheduleEntry(s)) {
      return null;
    }
    out.push({
      id: s.id,
      name: s.name,
      prompt: s.prompt,
      rrule: s.rrule,
      ...(s.timezone !== undefined ? { timezone: s.timezone } : {}),
      results: s.results,
    });
  }
  return out;
}

function isValidEventEntry(ev) {
  if (!ev || typeof ev !== 'object' || !PART_ID_RE.test(String(ev.id ?? ''))) {
    return false;
  }
  if (!isNonEmptyString(ev.name, 200) || !isNonEmptyString(ev.prompt, 20_000)) {
    return false;
  }
  const allowedEvents = BOT_PACKAGE_EVENT_KINDS[ev.source];
  if (!allowedEvents || !allowedEvents.includes(ev.event) || !BOT_PACKAGE_EVENT_RESULTS.includes(ev.results)) {
    return false;
  }
  return ev.textContains === undefined || isNonEmptyString(ev.textContains, 200);
}

function validateEventsField(events) {
  if (!Array.isArray(events) || events.length > 32) {
    return null;
  }
  const out = [];
  for (const ev of events) {
    if (!isValidEventEntry(ev)) {
      return null;
    }
    out.push({
      id: ev.id,
      name: ev.name,
      prompt: ev.prompt,
      source: ev.source,
      event: ev.event,
      ...(ev.textContains !== undefined ? { textContains: ev.textContains } : {}),
      results: ev.results,
    });
  }
  return out;
}

function validateNamedList(list, field, max) {
  if (!Array.isArray(list) || list.length > max) {
    return null;
  }
  const out = [];
  for (const entry of list) {
    if (!entry || typeof entry !== 'object' || !isValidPartName(entry[field])) {
      return null;
    }
    out.push({ [field]: entry[field] });
  }
  return out;
}

function validateConnectorsField(connectors) {
  if (!Array.isArray(connectors) || connectors.length > 8) {
    return null;
  }
  if (!connectors.every((c) => c && typeof c === 'object' && BOT_PACKAGE_CONNECTORS.includes(c.kind))) {
    return null;
  }
  return connectors.map((c) => ({ kind: c.kind }));
}

function collectDroppedKeys(input, parsed, path = []) {
  if (Array.isArray(input) && Array.isArray(parsed)) {
    return input.flatMap((entry, index) => collectDroppedKeys(entry, parsed[index], [...path, String(index)]));
  }
  if (!input || typeof input !== 'object' || !parsed || typeof parsed !== 'object') {
    return [];
  }
  const kept = new Map(Object.entries(parsed));
  return Object.entries(input).flatMap(([key, value]) => (
    kept.has(key) ? collectDroppedKeys(value, kept.get(key), [...path, key]) : [[...path, key].join('.')]
  ));
}

function buildValidatedPackage(value) {
  const nameCheck = validateBotName(value.name);
  const avatarCheck = validateAvatarField(value.avatar);
  const tools = validateToolsField(value.tools);
  const schedules = validateSchedulesField(value.schedules);
  const eventSuggestions = validateEventsField(value.eventSuggestions);
  const skills = validateNamedList(value.skills, 'name', 64);
  const memory = validateNamedList(value.memory, 'topic', 64);
  const connectors = validateConnectorsField(value.connectors);
  const validStrings = typeof value.purpose === 'string'
    && value.purpose.length <= BOT_PACKAGE_PURPOSE_MAX
    && isBotAgent(value.agentHint)
    && (value.setupNote === undefined || (typeof value.setupNote === 'string' && value.setupNote.length <= BOT_PACKAGE_SETUP_NOTE_MAX));

  if (!nameCheck.ok || !avatarCheck.ok || !validStrings || !tools || !schedules || !eventSuggestions || !skills || !memory || !connectors) {
    throw new Error('bot-package-invalid');
  }
  return {
    schemaVersion: BOT_PACKAGE_SCHEMA_VERSION,
    name: nameCheck.name,
    ...(avatarCheck.value ? { avatar: avatarCheck.value } : {}),
    purpose: value.purpose,
    agentHint: value.agentHint,
    skills,
    tools,
    connectors,
    schedules,
    eventSuggestions,
    memory,
    ...(value.setupNote !== undefined ? { setupNote: value.setupNote } : {}),
  };
}

/**
 * Strictly validates a `BotPackageV1` manifest, rejecting newer schema versions and duplicate
 * part IDs/names, and returning `{ bot, droppedKeys }`.
 */
export function parseBotPackage(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('bot-package-invalid');
  }
  if (typeof value.schemaVersion === 'number' && value.schemaVersion > BOT_PACKAGE_SCHEMA_VERSION) {
    throw new Error(BOT_PACKAGE_NEWER_ERROR);
  }
  if (value.schemaVersion !== BOT_PACKAGE_SCHEMA_VERSION) {
    throw new Error('bot-package-invalid');
  }
  const bot = buildValidatedPackage(value);
  const uniqueKeys = [
    ...bot.tools.map((t) => `tool:${t.id}`),
    ...bot.schedules.map((s) => `schedule:${s.id}`),
    ...bot.eventSuggestions.map((e) => `event:${e.id}`),
    ...bot.skills.map((s) => `skill:${s.name}`),
    ...bot.memory.map((m) => `memory:${m.topic}`),
  ];
  if (new Set(uniqueKeys).size !== uniqueKeys.length) {
    throw new Error('bot-package-duplicate-part');
  }
  const droppedKeys = collectDroppedKeys(value, bot).filter((k) => !ALLOWED_TOP_KEYS.has(k));
  return { bot, droppedKeys };
}

export function botPackagePartOf(filePath) {
  if (filePath === BOT_PACKAGE_MANIFEST_PATH) {
    return { role: 'manifest' };
  }
  if (filePath === BOT_PACKAGE_SOUL_PATH) {
    return { role: 'soul' };
  }
  if (filePath === BOT_PACKAGE_AVATAR_PATH) {
    return { role: 'avatar' };
  }
  const mem = MEMORY_PATH_RE.exec(filePath);
  if (mem && isValidPartName(mem[1])) {
    return { role: 'memory', topic: mem[1] };
  }
  const skill = SKILL_PATH_RE.exec(filePath);
  if (skill && isValidPartName(skill[1]) && !skill[2].split('/').includes('..')) {
    return { role: 'skill', name: skill[1], path: skill[2] };
  }
  return null;
}

export function botPackageRole(part) {
  return part.role === 'skill' ? `skill:${part.name}` : part.role;
}

export function botPackageResults(resultsTo) {
  if (typeof resultsTo === 'string') {
    return resultsTo;
  }
  return 'channel' in resultsTo ? 'slack-channel' : 'linear-issue';
}

/**
 * Agent-neutral own skills directory (`skills/`).
 * @param {string} [_agent]
 */
export function skillsFolderFor(_agent) {
  return 'skills';
}

/** Plans files, tools, and disabled schedules to install from a validated `BotPackageV1`. */
export function planBotFromPackage(bot, inventory, choice) {
  const ticked = new Set(choice.toolIds ?? []);
  const files = (inventory ?? []).flatMap((file) => {
    const part = botPackagePartOf(file.path);
    if (!part) {
      throw new Error('bot-package-path-not-allowed');
    }
    let to = null;
    if (part.role === 'soul') {
      to = BOT_PACKAGE_SOUL_PATH;
    } else if (part.role === 'memory') {
      to = `memory/${part.topic}.md`;
    } else if (part.role === 'skill') {
      to = `${skillsFolderFor(choice.agent)}/${part.name}/${part.path}`;
    }
    return to === null ? [] : [{ from: file.path, to, executable: Boolean(file.executable) }];
  });
  return {
    create: {
      name: bot.name,
      agent: choice.agent,
      ...(bot.avatar && 'mascot' in bot.avatar ? { avatar: mascotAvatar(bot.avatar.mascot) } : {}),
    },
    avatarImage: bot.avatar && 'image' in bot.avatar ? bot.avatar.image : null,
    files,
    tools: bot.tools.filter((tool) => ticked.has(tool.id)),
    schedules: bot.schedules.map((schedule) => ({ ...schedule, enabled: false })),
    eventSuggestions: bot.eventSuggestions,
    connectors: bot.connectors.map((connector) => connector.kind),
    setupNote: bot.setupNote ?? null,
  };
}

// ---- Security text redaction & 5-category scanning (`scanBotText`) ----

export const BOT_TEXT_LEFT_OUT = '[line left out: it looked like it held a secret]';

const SECRET_LINE = /\b(passwords?|passwd|passcodes?|pins?|api ?keys?|secrets?|tokens?|private ?keys?|cookies?|credentials?|authorization)\b.*?(:|=|\bis\b)\s*\S|\bbearer\s+\S/i;
const SECRET_SHAPE = /\b(sk-[\w-]{8,}|sk-ant-[\w-]{8,}|xox[abprs]-[\w-]{8,}|xapp-[\w-]{8,}|gh[opsu]_[\w]{8,}|github_pat_\w{8,}|AKIA[0-9A-Z]{12,}|AIza[\w-]{20,}|tvly-[\w-]{8,}|eyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{5,})/;
const URL_IN_TEXT = /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'`<>)]+/gi;
const URL_QUERY = /\b([a-z][a-z0-9+.-]*:\/\/)(?:[^\s/@"'`<>]+@)?([^\s?#"'`<>]*)\?[^\s#"'`<>]*/gi;
const KEY_BLOCK_START = /-----BEGIN [A-Z0-9 ]+-----/;
const KEY_BLOCK_END = /-----END [A-Z0-9 ]+-----/;
const UNSAFE_TEXT_SOURCE = '[\\u0000-\\u001f\\u007f-\\u009f\\u061c\\u200b-\\u200f\\u202a-\\u202e\\u2066-\\u2069\\ufeff]';
const HIDDEN_UNICODE_LINE_SOURCE = '[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f-\\u009f\\u061c\\u200b-\\u200f\\u202a-\\u202e\\u2066-\\u2069\\ufeff]';
const UNSAFE_TEXT = new RegExp(UNSAFE_TEXT_SOURCE, 'u');
const UNSAFE_TEXT_ALL = new RegExp(UNSAFE_TEXT_SOURCE, 'gu');
const HIDDEN_UNICODE_LINE = new RegExp(HIDDEN_UNICODE_LINE_SOURCE, 'u');

const PIPE_TO_SHELL_PATTERNS = [
  /\b(?:curl|wget|fetch)\b[^\n|]*\|\s*(?:sudo\s+)?(?:\/(?:usr\/)?bin\/)?(?:ba|z|da|k|a)?sh\b/i,
  /\b(?:curl|wget|fetch)\b[^\n|]*\|\s*(?:sudo\s+)?(?:python3?|node|perl|ruby|pwsh|powershell)\b/i,
  /\b(?:(?:ba|z|da|k)?sh|source|\.)\s+<\(\s*(?:curl|wget)\b/i,
  /\b(?:irm|iwr|invoke-restmethod|invoke-webrequest)\b[^\n|]*\|\s*(?:iex|invoke-expression)\b/i,
];

const SUDO_PATTERN = /(?:^|[\s;&|`($])sudo(?:\s+-[A-Za-z0-9]+)*\s+[A-Za-z0-9_./-]+/i;

const SENDS_FILE_PATTERNS = [
  /\bcurl\b[^\n]*(?:\s(?:-d|--data(?:-(?:binary|raw|urlencode|ascii))?)\s+@\S|\s(?:-F|--form)\s+[^\s]*=@\S|\s(?:-T|--upload-file)\s+\S)/i,
  /\bwget\b[^\n]*\s--post-file(?:=|\s+)\S/i,
  /\b(?:scp|rsync)\b[^\n]*\s[^\s]+:[^\s]+/i,
];

/** @param {string} line */
function splitWords(line) {
  return line.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' ');
}

/** @param {string} line */
function lineHasCredentialUrl(line) {
  URL_IN_TEXT.lastIndex = 0;
  let match;
  while ((match = URL_IN_TEXT.exec(line)) !== null) {
    const auth = botToolUrlAuthority(match[0]);
    if (auth?.hasUserinfo) {
      return true;
    }
  }
  return false;
}

/** @param {string} line */
function lineLooksLikeSecret(line) {
  if (line.trim() === BOT_TEXT_LEFT_OUT) return false;
  if (KEY_BLOCK_START.test(line) || SECRET_SHAPE.test(line)) return true;
  if (lineHasCredentialUrl(line)) return true;
  if (SECRET_LINE.test(splitWords(line))) return true;
  // Check redactSecretLike on line with non-credential URLs masked so path `@` never false-positives
  const urlMasked = line.replace(URL_IN_TEXT, (m) => (botToolUrlAuthority(m)?.hasUserinfo ? m : '[url]'));
  return redactSecretLike(urlMasked) !== urlMasked;
}

export function hasUnsafeText(value) {
  return typeof value === 'string' && UNSAFE_TEXT.test(value);
}

export function withoutUnsafeText(value) {
  return String(value ?? '').replace(UNSAFE_TEXT_ALL, ' ');
}

export function redactBotText(text) {
  const lines = String(text ?? '').split('\n');
  let inKeyBlock = false;
  let leftOut = 0;
  const out = [];
  for (const raw of lines) {
    const startsBlock = !inKeyBlock && KEY_BLOCK_START.test(raw);
    if (inKeyBlock || startsBlock) {
      inKeyBlock = !KEY_BLOCK_END.test(startsBlock ? raw.replace(KEY_BLOCK_START, '') : raw);
      if (startsBlock) {
        leftOut += 1;
        out.push(BOT_TEXT_LEFT_OUT);
      }
      continue;
    }
    const stripped = raw.replace(URL_QUERY, '$1$2?…');
    if (lineLooksLikeSecret(stripped)) {
      leftOut += 1;
      out.push(BOT_TEXT_LEFT_OUT);
    } else {
      out.push(stripped);
    }
  }
  return { text: out.join('\n'), leftOut };
}

/**
 * Scans bot text (SOUL.md, SKILL.md, memory topics, prompts) across 5 security categories:
 * - `secret` (`severity: 'block'`): blocks sharing/importing secrets, keys, and authority credentials
 * - `pipe-to-shell` (`severity: 'warn'`): `curl | sh`, `bash <(curl ...)`, `irm | iex`, etc.
 * - `sudo` (`severity: 'warn'`): privilege escalation via `sudo`
 * - `sends-file` (`severity: 'warn'`): `curl -d @file` / `-T` / `-F =@` / `wget --post-file` / `scp`
 * - `hidden-unicode` (`severity: 'warn'`): zero-width, bidi override, or control characters
 *
 * @param {string} text
 * @param {{ file?: string }} [options]
 */
export function scanBotText(text, options = {}) {
  const safe = String(text ?? '');
  const lines = safe.split(/\r?\n/);
  /** @type {Array<{ kind: string, severity: 'block' | 'warn', line: number, file?: string, sample: string }>} */
  const findings = [];
  /** @type {boolean} */
  let inKeyBlock = false;

  /**
   * @param {string} kind
   * @param {'block' | 'warn'} severity
   * @param {number} lineNo
   * @param {string} raw
   */
  const pushFinding = (kind, severity, lineNo, raw) => {
    const sample = kind === 'secret'
      ? '[redacted]'
      : withoutUnsafeText(raw).trim().slice(0, 120);
    findings.push({
      kind,
      severity,
      line: lineNo,
      ...(options.file ? { file: options.file } : {}),
      sample,
    });
  };

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    const lineNo = i + 1;

    if (HIDDEN_UNICODE_LINE.test(raw)) {
      pushFinding('hidden-unicode', 'warn', lineNo, raw);
    }

    /** @type {boolean} */
    const startsKey = !inKeyBlock && KEY_BLOCK_START.test(raw);
    if (inKeyBlock || startsKey) {
      if (startsKey) {
        pushFinding('secret', 'block', lineNo, raw);
      }
      inKeyBlock = !KEY_BLOCK_END.test(startsKey ? raw.replace(KEY_BLOCK_START, '') : raw);
      continue;
    }

    if (lineLooksLikeSecret(raw)) {
      pushFinding('secret', 'block', lineNo, raw);
    }
    if (PIPE_TO_SHELL_PATTERNS.some((re) => re.test(raw))) {
      pushFinding('pipe-to-shell', 'warn', lineNo, raw);
    }
    if (SUDO_PATTERN.test(raw)) {
      pushFinding('sudo', 'warn', lineNo, raw);
    }
    if (SENDS_FILE_PATTERNS.some((re) => re.test(raw))) {
      pushFinding('sends-file', 'warn', lineNo, raw);
    }
  }

  const blocks = findings.filter((f) => f.severity === 'block');
  const warnings = findings.filter((f) => f.severity === 'warn');
  return {
    ok: blocks.length === 0,
    blocked: blocks.length > 0,
    findings,
    blocks,
    warnings,
  };
}

export { BOT_MASCOT_IDS, BOT_AGENTS };
