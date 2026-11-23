// Per-Bot MCP Server validation, sensitive header detection, naming, and paste parsing.

export const BOT_TOOL_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
export const BOT_TOOL_HEADER_NAME_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
export const BOT_TOOL_ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
export const BOT_TOOL_CREDENTIAL_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

export const BOT_TOOL_LIMITS = Object.freeze({
  maxNameLength: 64,
  maxUrlLength: 2048,
  maxTextLength: 4096,
  maxExecutableLength: 1024,
  maxArgs: 64,
  maxSecretRows: 64,
});

export const SENSITIVE_HEADER_NAMES = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'api-key',
  'apikey',
  'x-auth-token',
  'x-access-token',
  'x-secret-key',
  'x-token',
  'x-session-token',
  'x-csrf-token',
  'x-xsrf-token',
]);

const SENSITIVE_HEADER_FRAGMENT = /(?:^|[-_])(auth|authorization|token|secret|api[-_]?key|key|password|passwd|cookie|credential|session|signature)(?:$|[-_])/i;

/**
 * Determines whether an HTTP MCP header name carries sensitive credentials that must be
 * stored outside the bot home folder in host credential storage.
 */
export function isSensitiveHeaderName(name) {
  if (typeof name !== 'string') {
    return false;
  }
  const lower = name.trim().toLowerCase();
  if (!lower) {
    return false;
  }
  return SENSITIVE_HEADER_NAMES.has(lower) || SENSITIVE_HEADER_FRAGMENT.test(lower);
}

/** Splits a headers record into `{ publicHeaders, sensitiveHeaders }`. */
export function splitToolSensitiveHeaders(headers) {
  const publicHeaders = {};
  const sensitiveHeaders = {};
  if (!headers || typeof headers !== 'object') {
    return { publicHeaders, sensitiveHeaders };
  }
  for (const [key, value] of Object.entries(headers)) {
    if (isSensitiveHeaderName(key)) {
      sensitiveHeaders[key] = value;
    } else {
      publicHeaders[key] = value;
    }
  }
  return { publicHeaders, sensitiveHeaders };
}

/** True for an HTTP/HTTPS URL <= 2048 chars with no embedded user:pass credentials. */
export function isValidBotToolUrl(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > BOT_TOOL_LIMITS.maxUrlLength) {
    return false;
  }
  if (!/^https?:\/\//i.test(value)) {
    return false;
  }
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password;
  } catch (err) {
    return Boolean(!err);
  }
}

function isValidTextValue(value, disallowNewlines = false) {
  if (typeof value !== 'string' || value.length > BOT_TOOL_LIMITS.maxTextLength || value.includes('\0')) {
    return false;
  }
  return !disallowNewlines || !/[\r\n]/.test(value);
}

function isValidExecutable(value) {
  return (
    typeof value === 'string'
    && value.length >= 1
    && value.length <= BOT_TOOL_LIMITS.maxExecutableLength
    && value.trim() === value
    && !value.includes('\0')
    && !/[\r\n]/.test(value)
  );
}

/** Validates a persisted `BotToolServer` entry (either HTTP remote or stdio command). */
export function validateBotToolServer(server) {
  if (!server || typeof server !== 'object' || !BOT_TOOL_NAME_PATTERN.test(String(server.name ?? ''))) {
    return { ok: false, reason: 'Invalid MCP server name.' };
  }
  if ('url' in server) {
    return validateHttpToolServer(server);
  }
  if ('command' in server) {
    return validateStdioToolServer(server);
  }
  return { ok: false, reason: 'MCP server must define either url or command.' };
}

function validateHttpToolServer(server) {
  if (!isValidBotToolUrl(server.url)) {
    return { ok: false, reason: 'Use an HTTP or HTTPS URL without embedded credentials.' };
  }
  if (server.transport !== undefined && server.transport !== 'http') {
    return { ok: false, reason: 'Invalid HTTP transport.' };
  }
  if (server.credential !== undefined && !BOT_TOOL_CREDENTIAL_ID_PATTERN.test(String(server.credential))) {
    return { ok: false, reason: 'Invalid credential reference.' };
  }
  if (server.headers !== undefined) {
    if (!server.headers || typeof server.headers !== 'object' || Array.isArray(server.headers)) {
      return { ok: false, reason: 'Headers must be a key/value map.' };
    }
    for (const [key, value] of Object.entries(server.headers)) {
      if (!BOT_TOOL_HEADER_NAME_PATTERN.test(key) || !isValidTextValue(value, true)) {
        return { ok: false, reason: `Invalid header "${key}".` };
      }
    }
  }
  return { ok: true };
}

function validateStdioToolServer(server) {
  if (!isValidExecutable(server.command)) {
    return { ok: false, reason: 'Enter one valid executable path.' };
  }
  if (!Array.isArray(server.args) || server.args.length > BOT_TOOL_LIMITS.maxArgs) {
    return { ok: false, reason: 'Invalid command arguments.' };
  }
  if (server.args.some((arg) => !isValidTextValue(arg))) {
    return { ok: false, reason: 'Command arguments cannot contain NUL characters.' };
  }
  if (server.env !== undefined) {
    if (!server.env || typeof server.env !== 'object' || Array.isArray(server.env)) {
      return { ok: false, reason: 'Environment must be a key/value map.' };
    }
    for (const [key, value] of Object.entries(server.env)) {
      if (!BOT_TOOL_ENV_NAME_PATTERN.test(key) || !isValidTextValue(value)) {
        return { ok: false, reason: `Invalid environment variable "${key}".` };
      }
    }
  }
  return { ok: true };
}

/** Validates form input for adding/editing a per-bot MCP tool; returns error message or `null`. */
export function botToolInputError(input, platform = 'win32') {
  if (!input || typeof input !== 'object' || !BOT_TOOL_NAME_PATTERN.test(String(input.name ?? ''))) {
    return 'Enter a valid server name and URL or executable.';
  }
  const remote = 'url' in input;
  if (remote) {
    if (!isValidBotToolUrl(input.url) || (input.transport !== undefined && input.transport !== 'http')) {
      return 'Enter a valid server name and URL or executable.';
    }
  } else if (!isValidExecutable(input.command) || !Array.isArray(input.args) || input.args.length > BOT_TOOL_LIMITS.maxArgs) {
    return 'Enter a valid server name and URL or executable.';
  }

  const rows = remote ? input.headers : input.env;
  if (!Array.isArray(rows) || rows.length > BOT_TOOL_LIMITS.maxSecretRows) {
    return 'Enter a valid server name and URL or executable.';
  }
  const names = rows.map((row) => (remote || platform === 'win32' ? String(row?.key ?? '').toLowerCase() : String(row?.key ?? '')));
  if (new Set(names).size !== rows.length) {
    return 'Each header or environment name must be unique.';
  }
  const keyPattern = remote ? BOT_TOOL_HEADER_NAME_PATTERN : BOT_TOOL_ENV_NAME_PATTERN;
  const badRow = rows.some((row) => {
    if (!row || typeof row !== 'object' || !keyPattern.test(String(row.key ?? ''))) {
      return true;
    }
    const keeps = row.keep === true;
    const hasValue = typeof row.value === 'string' && row.value.length > 0;
    if (keeps === (row.value !== undefined)) {
      return true;
    }
    return (!keeps && !hasValue) || (row.value !== undefined && !isValidTextValue(row.value, remote));
  });
  return badRow ? 'Enter a valid name and value for every row, or remove the row.' : null;
}

export function botToolDetail(server) {
  return 'url' in server ? server.url : [server.command, ...(server.args ?? [])].join(' ');
}

const NAME_NOISE = new Set(['mcp', 'server', 'servers', 'api', 'www', 'app', 'com', 'io', 'dev', 'ai']);

function meaningfulWords(words) {
  return words
    .map((word) => word.toLowerCase().replace(/[^a-z0-9]/g, ''))
    .filter((word) => word && !NAME_NOISE.has(word))
    .join('-')
    .slice(0, BOT_TOOL_LIMITS.maxNameLength);
}

/** Derives a short server name from a URL host or CLI package (`mcp.notion.com` -> `notion`). */
export function botToolNameFrom(detail) {
  let name = '';
  const text = String(detail ?? '').trim();
  if (/^https?:\/\//i.test(text)) {
    try {
      name = meaningfulWords(new URL(text).hostname.split('.'));
    } catch (err) {
      name = err ? '' : '';
    }
  }
  if (!name) {
    const parts = text.split(/\s+/);
    const pkg = parts.find((part, index) => index > 0 && !part.startsWith('-')) ?? parts[0] ?? '';
    const [scope, base] = pkg.startsWith('@') ? pkg.slice(1).split('/') : [undefined, pkg];
    const words = (base ?? '').replace(/@[^@]*$/, '').split(/[-_.]/);
    name = meaningfulWords(words) || meaningfulWords([scope ?? '']);
  }
  return BOT_TOOL_NAME_PATTERN.test(name) ? name : 'tool';
}

export function freeBotToolName(name, taken) {
  const takenSet = taken instanceof Set ? taken : new Set(taken ?? []);
  if (!takenSet.has(name)) {
    return name;
  }
  for (let n = 2; ; n += 1) {
    const suffix = `-${n}`;
    const candidate = `${name.slice(0, BOT_TOOL_LIMITS.maxNameLength - suffix.length)}${suffix}`;
    if (!takenSet.has(candidate)) {
      return candidate;
    }
  }
}

function tokenizeSimpleCommand(text) {
  const tokens = [];
  let current = '';
  let quote = null;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (/\s/.test(ch)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
    } else {
      current += ch;
    }
  }
  if (quote) {
    return null;
  }
  if (current) {
    tokens.push(current);
  }
  return tokens;
}

/** Parses a pasted MCP URL or start command into a validated `BotToolServer`. */
export function parseBotToolPaste(source, platform = 'win32') {
  const text = String(source ?? '').trim();
  if (/^[{[]/.test(text)) {
    throw new Error('Paste a server URL or start command, or enter the configuration in Edit details.');
  }
  if (/^https?:|^[a-z][a-z0-9+.-]*:\/\//i.test(text)) {
    const server = { name: botToolNameFrom(text), url: text };
    const checked = validateBotToolServer(server);
    if (!checked.ok) {
      throw new Error('Use an HTTP or HTTPS URL without embedded credentials.');
    }
    return server;
  }
  if (/[\r\n]/.test(text)) {
    throw new Error('Use a single start command with balanced quotes, or enter the details manually.');
  }
  const tokens = tokenizeSimpleCommand(text);
  if (!tokens || tokens.length === 0) {
    throw new Error('Use a single start command with balanced quotes, or enter the details manually.');
  }
  const env = {};
  let idx = 0;
  while (idx < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[idx])) {
    const eq = tokens[idx].indexOf('=');
    env[tokens[idx].slice(0, eq)] = tokens[idx].slice(eq + 1);
    idx += 1;
  }
  const [command, ...args] = tokens.slice(idx);
  const name = botToolNameFrom([command ?? '', ...args].join(' '));
  const input = {
    name,
    command: command ?? '',
    args,
    env: Object.entries(env).map(([key, value]) => ({ key, value })),
  };
  const error = botToolInputError(input, platform);
  if (error) {
    throw new Error(error);
  }
  return { name, command, args, ...(Object.keys(env).length > 0 ? { env } : {}) };
}

// ---- Native Bot Tool Parameter Schemas (`bot_item_*` & `bot_reply`) ----

const BOT_ITEM_LINK_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  properties: {
    kind: { type: 'string', required: true },
    ref: { type: 'string', required: true },
  },
});

const BOT_ITEM_ASK_SCHEMA = Object.freeze({
  type: 'object',
  description: 'Structured ask payload ({ context?, questions: [...] }) for needs_you.',
  additionalProperties: true,
  properties: {
    context: { type: 'string', description: 'Optional short background context (<= 5 lines / 300 chars).' },
    questions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: true,
        properties: {
          prompt: { type: 'string' },
          recommended: { type: 'number' },
          multi: { type: 'boolean' },
          options: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: true,
              properties: {
                label: { type: 'string' },
                detail: { type: 'string' },
              },
            },
          },
        },
      },
    },
  },
});

const BOT_ITEM_FILES_SCHEMA = Object.freeze({
  type: 'array',
  description: 'Optional file attachments (up to 10 paths or attachment objects).',
  items: { type: 'string' },
});

/** Canonical parameter schemas for the 8 native `bot_item_*` tools. */
export const BOT_ITEM_TOOL_SCHEMAS = Object.freeze({
  bot_item_add: Object.freeze({
    title: { type: 'string', description: 'Short item title (<=200 chars).', required: true },
    description: { type: 'string', description: 'Optional markdown description.' },
    doneMeans: { type: 'string', description: 'Optional acceptance criteria.' },
    status: { type: 'string', description: 'Initial status: planned | working | needs_you.' },
    comment: { type: 'string', description: 'Optional initial question/note (for needs_you).' },
    ask: BOT_ITEM_ASK_SCHEMA,
    files: BOT_ITEM_FILES_SCHEMA,
    links: { type: 'array', description: 'Optional array of { kind: dispatch|pr|url|file, ref }.', items: BOT_ITEM_LINK_SCHEMA },
    targetBotId: { type: 'string', description: 'Optional target bot id when filing on behalf of another bot.' },
  }),
  bot_item_set: Object.freeze({
    id: { type: 'string', description: 'Item uid or #number.', required: true },
    title: { type: 'string', description: 'Updated title.' },
    description: { type: 'string', description: 'Updated description (empty string clears).' },
    doneMeans: { type: 'string', description: 'Updated acceptance criteria.' },
    status: { type: 'string', description: 'planned | working | needs_you | done | canceled.' },
    comment: { type: 'string', description: 'Comment attached to a status change.' },
    ask: BOT_ITEM_ASK_SCHEMA,
    files: BOT_ITEM_FILES_SCHEMA,
    reason: { type: 'string', description: 'Required reason when status=canceled.' },
    note: { type: 'string', description: 'Optional closing note when status=done.' },
  }),
  bot_item_comment: Object.freeze({
    id: { type: 'string', description: 'Item uid or #number.', required: true },
    text: { type: 'string', description: 'Comment body (optional when ask or files is provided).' },
    ask: BOT_ITEM_ASK_SCHEMA,
    files: BOT_ITEM_FILES_SCHEMA,
  }),
  bot_item_done: Object.freeze({
    id: { type: 'string', description: 'Item uid or #number.', required: true },
    note: { type: 'string', description: 'Optional completion note.' },
  }),
  bot_item_cancel: Object.freeze({
    id: { type: 'string', description: 'Item uid or #number.', required: true },
    reason: { type: 'string', description: 'Reason for canceling.', required: true },
  }),
  bot_item_link: Object.freeze({
    id: { type: 'string', description: 'Item uid or #number.', required: true },
    links: { type: 'array', description: 'Array of { kind: dispatch|pr|url|file, ref }.', required: true, items: BOT_ITEM_LINK_SCHEMA },
  }),
  bot_item_list: Object.freeze({
    botId: { type: 'string', description: 'Optional target bot id or name (defaults to caller bot).' },
    all: { type: 'boolean', description: 'Include closed items (alias for openOnly: false).' },
    here: { type: 'boolean', description: 'Only return items belonging to the current chat/session.' },
    chat: { type: 'string', description: 'Filter items by a specific chat/session id.' },
    link: { type: 'string', description: 'Reverse-lookup items linked to a PR, URL, dispatch, file, or kind:ref.' },
    cursor: { type: 'string', description: 'Pagination cursor returned by a previous bot_item_list call.' },
    openOnly: { type: 'boolean', description: 'Only return open items (default true unless all=true or statuses given).' },
    statuses: { type: 'array', description: 'Optional status filter array.', items: { type: 'string' } },
    limit: { type: 'number', description: 'Max items (1..100, default 50).' },
  }),
  bot_item_show: Object.freeze({
    id: { type: 'string', description: 'Item uid or #number.', required: true },
    after: { type: 'string', description: 'Optional event cursor like e12.' },
  }),
});

export const BOT_REPLY_LIMITS = Object.freeze({
  maxChoices: 8,
  maxChoiceLength: 80,
  maxFiles: 10,
  maxReactLength: 64,
});

/** Canonical parameter schema for `bot_reply` (including optional choices, files, and react). */
export const BOT_REPLY_TOOL_SCHEMA = Object.freeze({
  text: { type: 'string', description: 'Reply text (required unless files or react is provided).' },
  channel: { type: 'string', description: 'Optional external channel/thread identifier.' },
  choices: {
    type: 'array',
    description: 'Optional quick-reply choice buttons (1..8 unique labels, <=80 chars each; mutually exclusive with files).',
    items: { type: 'string' },
  },
  files: {
    type: 'array',
    description: 'Optional file paths to send in the same reply post (up to 10; mutually exclusive with choices).',
    items: { type: 'string' },
  },
  react: {
    type: 'string',
    description: 'Optional emoji reaction to add to the triggering message (e.g. :thumbsup: or 👍).',
  },
});

/**
 * Validate `bot_reply` arguments (choices/files mutual exclusion, bounds, uniqueness, react).
 * @param {any} args
 * @returns {{ ok: true, data: { text: string, channel: string | null, choices: string[], files: string[], react: string | null } } | { ok: false, code: string, reason: string }}
 */
export function validateBotReplyArgs(args) {
  const raw = args && typeof args === 'object' ? args : {};
  const text = typeof raw.text === 'string' ? raw.text.trim() : '';
  const channel = typeof raw.channel === 'string' && raw.channel.trim() ? raw.channel.trim() : null;
  const react = typeof raw.react === 'string' && raw.react.trim() ? raw.react.trim() : null;

  if (react && react.length > BOT_REPLY_LIMITS.maxReactLength) {
    return { ok: false, code: 'invalid_react', reason: `Reaction must be at most ${BOT_REPLY_LIMITS.maxReactLength} characters.` };
  }

  /** @type {string[]} */
  const choices = [];
  if (raw.choices !== undefined && raw.choices !== null) {
    if (!Array.isArray(raw.choices)) {
      return { ok: false, code: 'invalid_choices', reason: 'choices must be an array of strings.' };
    }
    if (raw.choices.length > BOT_REPLY_LIMITS.maxChoices) {
      return { ok: false, code: 'too_many_choices', reason: `At most ${BOT_REPLY_LIMITS.maxChoices} choices allowed.` };
    }
    const seen = new Set();
    for (const item of raw.choices) {
      const label = typeof item === 'string' ? item.trim() : '';
      if (!label || label.length > BOT_REPLY_LIMITS.maxChoiceLength) {
        return { ok: false, code: 'invalid_choice', reason: `Each choice must be 1..${BOT_REPLY_LIMITS.maxChoiceLength} characters.` };
      }
      const key = label.toLowerCase();
      if (seen.has(key)) {
        return { ok: false, code: 'duplicate_choice', reason: `Duplicate choice: "${label}".` };
      }
      seen.add(key);
      choices.push(label);
    }
  }

  /** @type {string[]} */
  const files = [];
  if (raw.files !== undefined && raw.files !== null) {
    if (!Array.isArray(raw.files)) {
      return { ok: false, code: 'invalid_files', reason: 'files must be an array of file paths.' };
    }
    if (raw.files.length > BOT_REPLY_LIMITS.maxFiles) {
      return { ok: false, code: 'too_many_files', reason: `At most ${BOT_REPLY_LIMITS.maxFiles} files allowed.` };
    }
    for (const item of raw.files) {
      const filePath = typeof item === 'string' ? item.trim() : '';
      if (!filePath) {
        return { ok: false, code: 'invalid_file', reason: 'Each file entry must be a non-empty path string.' };
      }
      files.push(filePath);
    }
  }

  if (choices.length > 0 && files.length > 0) {
    return { ok: false, code: 'choices_files_conflict', reason: 'choices and files cannot be sent in the same reply.' };
  }
  if (!text && files.length === 0 && !react) {
    return { ok: false, code: 'empty_reply', reason: 'Reply requires text, files, or react.' };
  }

  return { ok: true, data: { text, channel, choices, files, react } };
}

export const BOT_NATIVE_TOOL_PARAM_SCHEMAS = Object.freeze({
  ...BOT_ITEM_TOOL_SCHEMAS,
  bot_reply: BOT_REPLY_TOOL_SCHEMA,
});
