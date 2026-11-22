/**
 * Command-line argument parser and task catalog for the WhaleIsle Eval Harness.
 * @module scripts/eval-harness/cli
 */

/** @typedef {'offline' | 'live'} EvalMode */

/**
 * @typedef {object} EvalCliOptions
 * @property {EvalMode} mode
 * @property {string | undefined} baseUrl
 * @property {string | undefined} model
 * @property {string[]} tasks
 * @property {string | undefined} out
 * @property {string | undefined} tempRoot
 * @property {boolean} keepTemp
 * @property {number} timeoutMs
 * @property {boolean} help
 */

/** @type {readonly string[]} */
export const OFFLINE_TASKS = Object.freeze([
  'edit',
  'glob',
  'grep',
  'git-hunk',
  'win-acl',
  'mcp-deferred',
  'lsp-diagnostics',
  'subagent-worktree',
]);

/** @type {readonly string[]} */
export const LIVE_TASKS = Object.freeze([
  'web-whaleui-payload',
  'glob-bare',
  'math-e2e',
  'max-tokens-continuation',
  'worktree-isolation',
]);

export const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * Render CLI help text without mentioning any credentials.
 * @returns {string}
 */
export function formatUsage() {
  return [
    'Usage: node scripts/eval-harness.mjs [options]',
    '',
    'Options:',
    '  --mode <offline|live>     Execution mode (default: offline)',
    '  --base-url <url>          Upstream OpenAI/Anthropic-compatible base URL (required in live mode)',
    '  --model <model>           Model identifier to evaluate (required in live mode)',
    '  --tasks <a,b,...>         Comma-separated subset of tasks for the selected mode',
    '  --out <jsonPath>          Write full JSON report to this path atomically',
    '  --temp-root <dir>         Isolated temporary root directory (created and cleaned in finally)',
    '  --keep-temp               Retain temporary root and newly generated pruned-results artifacts',
    `  --timeout-ms <ms>         Per-task timeout in milliseconds (default: ${DEFAULT_TIMEOUT_MS})`,
    '  -h, --help                Show this help text',
    '',
    `Offline tasks: ${OFFLINE_TASKS.join(', ')}`,
    `Live tasks:    ${LIVE_TASKS.join(', ')}`,
  ].join('\n');
}

/**
 * Validate and normalize a `--base-url` value.
 * @param {string} raw
 * @returns {string}
 */
function normalizeBaseUrl(raw) {
  let parsed;
  try {
    parsed = new URL(raw);
  } catch (error) {
    throw new Error(`Invalid --base-url "${raw}": ${error instanceof Error ? error.message : String(error)}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Invalid --base-url "${raw}": only http: and https: protocols are supported`);
  }
  return raw.replace(/\/+$/u, '');
}

/**
 * Parse a positive integer flag value.
 * @param {string} flag
 * @param {string} raw
 * @returns {number}
 */
function parsePositiveInt(flag, raw) {
  const num = Number(raw);
  if (!Number.isSafeInteger(num) || num <= 0) {
    throw new Error(`${flag} must be a positive integer, got "${raw}"`);
  }
  return num;
}

/**
 * Validate requested tasks against the active mode's task catalog.
 * @param {EvalMode} mode
 * @param {string[]} requested
 * @returns {string[]}
 */
function resolveTaskList(mode, requested) {
  const allowed = mode === 'live' ? LIVE_TASKS : OFFLINE_TASKS;
  if (requested.length === 0) {
    return [...allowed];
  }
  const invalid = requested.filter(name => !allowed.includes(name));
  if (invalid.length > 0) {
    throw new Error(`Unknown ${mode} task(s): ${invalid.join(', ')}. Valid tasks: ${allowed.join(', ')}`);
  }
  return [...new Set(requested)];
}

/**
 * Consume the value for a single-value flag, supporting `--flag=val` and `--flag val`.
 * @param {readonly string[]} argv
 * @param {number} index
 * @param {string} inlineValue
 * @param {string} flag
 * @returns {{ value: string, nextIndex: number }}
 */
function readFlagValue(argv, index, inlineValue, flag) {
  if (inlineValue !== '') {
    return { value: inlineValue, nextIndex: index };
  }
  const next = argv[index + 1];
  if (next === undefined || next.startsWith('-')) {
    throw new Error(`Missing value for ${flag}`);
  }
  return { value: next, nextIndex: index + 1 };
}

/**
 * Split `--flag=value` into flag name and inline value (empty string when absent).
 * @param {string} arg
 * @returns {{ flag: string, inlineValue: string, hasEquals: boolean }}
 */
function splitArg(arg) {
  const eq = arg.indexOf('=');
  if (eq < 0) {
    return { flag: arg, inlineValue: '', hasEquals: false };
  }
  return { flag: arg.slice(0, eq), inlineValue: arg.slice(eq + 1), hasEquals: true };
}

/** @type {Record<string, (state: any, val: string) => void>} */
const VALUE_FLAG_HANDLERS = {
  '--mode': (state, val) => {
    if (val !== 'offline' && val !== 'live') {
      throw new Error(`Invalid --mode "${val}": expected "offline" or "live"`);
    }
    state.mode = val;
  },
  '--base-url': (state, val) => {
    state.baseUrl = normalizeBaseUrl(val);
  },
  '--model': (state, val) => {
    if (val.trim().length === 0) throw new Error('--model must be a non-empty string');
    state.model = val.trim();
  },
  '--tasks': (state, val) => {
    const items = val.split(',').map(item => item.trim()).filter(Boolean);
    if (items.length === 0) throw new Error('--tasks must contain at least one task name');
    state.requestedTasks.push(...items);
  },
  '--out': (state, val) => {
    state.out = val;
  },
  '--temp-root': (state, val) => {
    if (val.trim().length === 0) throw new Error('--temp-root must be a non-empty path');
    state.tempRoot = val;
  },
  '--timeout-ms': (state, val) => {
    state.timeoutMs = parsePositiveInt('--timeout-ms', val);
  },
};

/**
 * Parse CLI flags for the Eval Harness.
 * @param {readonly string[]} argv
 * @returns {EvalCliOptions}
 */
export function parseEvalArgs(argv) {
  /** @type {{ mode: EvalMode, baseUrl?: string, model?: string, requestedTasks: string[], out?: string, tempRoot?: string, keepTemp: boolean, timeoutMs: number, help: boolean }} */
  const state = {
    mode: 'offline',
    requestedTasks: [],
    keepTemp: false,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === undefined) continue;
    const { flag, inlineValue, hasEquals } = splitArg(arg);
    if (flag === '-h' || flag === '--help') {
      state.help = true;
      continue;
    }
    if (flag === '--keep-temp') {
      if (hasEquals) throw new Error('--keep-temp does not accept a value');
      state.keepTemp = true;
      continue;
    }
    const handler = VALUE_FLAG_HANDLERS[flag];
    if (!handler) throw new Error(`Unknown option: ${flag}`);
    const read = readFlagValue(argv, i, inlineValue, flag);
    i = read.nextIndex;
    handler(state, read.value);
  }

  const tasks = resolveTaskList(state.mode, state.requestedTasks);
  if (!state.help && state.mode === 'live') {
    if (!state.baseUrl) throw new Error('--base-url is required in --mode live');
    if (!state.model) throw new Error('--model is required in --mode live');
  }

  return {
    mode: state.mode,
    baseUrl: state.baseUrl,
    model: state.model,
    tasks,
    out: state.out,
    tempRoot: state.tempRoot,
    keepTemp: state.keepTemp,
    timeoutMs: state.timeoutMs,
    help: state.help,
  };
}
