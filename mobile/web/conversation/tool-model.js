/**
 * Tool-call row model for the phone timeline. A port of the desktop
 * `ui-tool` `toolRowModel`: variant classification by wire tool name, a
 * one-line summary derived from the call ARGUMENTS, the expanded input body,
 * the flattened result text, and the row state. Everything is derived from
 * the frozen call / result slice — no host presenter output is consulted, so
 * the phone paints exactly what the desktop derives from the same events.
 */

/** Wire tool name → row variant (desktop TOOL_VARIANTS). */
const TOOL_VARIANTS = {
  bash: 'bash',
  pwsh: 'bash',
  read: 'read',
  web_fetch: 'read',
  web_search: 'search',
  grep: 'search',
  glob: 'search',
  write: 'write',
  edit: 'edit',
  str_replace_editor: 'edit',
  run_code: 'code',
  cordis_package_inspect: 'read',
  cordis_runtime_inspect: 'read',
  cordis_run: 'others',
  cordis_stop: 'others',
  cordis_undefine: 'others',
};

/** Variant → title (desktop `tool.title.*` zh strings). */
const VARIANT_TITLES = {
  search: '搜索',
  read: '读取',
  bash: 'Bash',
  write: '写入',
  edit: '编辑',
  code: '代码',
  others: '工具调用',
};

/** Tool-owned titles that refine a variant without replacing it. */
const TOOL_TITLES = {
  pwsh: 'Pwsh',
  grep: 'Grep',
  glob: 'Glob',
  web_search: '网页搜索',
  web_fetch: '网页获取',
  cordis_package_inspect: '查看',
  cordis_runtime_inspect: '查看',
  cordis_run: '运行 Cordis 插件',
  cordis_stop: '停止 Cordis 插件',
  cordis_undefine: '移除 Cordis 插件',
  todo: '待办',
  ask_question: '提问',
  skill: '技能',
};

/** Summary key preference per variant (args-derived). */
const SUMMARY_KEYS = {
  bash: ['description', 'command'],
  read: ['path', 'file_path', 'url'],
  search: ['query', 'pattern', 'url'],
  write: ['path', 'file_path'],
  edit: ['path', 'file_path'],
  code: ['description'],
  others: [],
};

const FILE_PATH_KEYS = ['path', 'file_path'];
const FILE_PATH_VARIANTS = new Set(['read', 'write', 'edit']);

function classifyTool(toolName) {
  return TOOL_VARIANTS[toolName] || 'others';
}

function toolTitle(toolName) {
  return TOOL_TITLES[toolName] || VARIANT_TITLES[classifyTool(toolName)];
}

function isSubagentTool(name) {
  return name === 'subagent' || String(name || '').startsWith('subagent_');
}

function parseArgs(argsRaw) {
  if (typeof argsRaw !== 'string' || argsRaw === '') return undefined;
  try {
    return JSON.parse(argsRaw);
  } catch {
    return undefined;
  }
}

function firstLine(text) {
  const value = String(text ?? '');
  const nl = value.indexOf('\n');
  return nl === -1 ? value : value.slice(0, nl);
}

function pickString(args, keys) {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === 'string' && value !== '') return value;
  }
  return undefined;
}

/** Strip the session workspace root from an absolute path (display only). */
function relativizeToCwd(text, cwd) {
  if (!cwd) return text;
  const root = String(cwd).replace(/[/\\]+$/, '');
  if (text.startsWith(`${root}/`) || text.startsWith(`${root}\\`)) return text.slice(root.length + 1);
  return text;
}

/** A leftover POSIX/Windows home prefix displays as `~`. */
function abbreviateHome(text, home) {
  if (!home) return text;
  const root = String(home).replace(/[/\\]+$/, '');
  if (text === root) return '~';
  if (text.startsWith(`${root}/`) || text.startsWith(`${root}\\`)) return `~${text.slice(root.length)}`;
  return text;
}

function deriveSummary(variant, argsRaw) {
  const parsed = parseArgs(argsRaw);
  if (typeof parsed !== 'object' || parsed === null) return firstLine(argsRaw);
  if (variant === 'search' && Array.isArray(parsed.queries)) {
    const queries = parsed.queries.filter((query) => typeof query === 'string' && query !== '');
    if (queries.length) return queries.map(firstLine).join(', ');
  }
  const picked = pickString(parsed, SUMMARY_KEYS[variant]);
  if (picked !== undefined) return firstLine(picked);
  for (const value of Object.values(parsed)) {
    if (typeof value === 'string' && value !== '') return firstLine(value);
  }
  return firstLine(argsRaw);
}

function deriveFilePath(variant, argsRaw) {
  if (!FILE_PATH_VARIANTS.has(variant)) return undefined;
  const parsed = parseArgs(argsRaw);
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const picked = pickString(parsed, FILE_PATH_KEYS);
  return picked === undefined ? undefined : firstLine(picked);
}

function deriveBody(variant, argsRaw) {
  if (!argsRaw) return null;
  const parsed = parseArgs(argsRaw);
  if (parsed === undefined) return argsRaw;
  if (variant === 'code' && typeof parsed === 'object' && parsed !== null) {
    const code = parsed.code;
    if (typeof code === 'string' && code !== '') return code;
  }
  if (variant === 'bash' && typeof parsed === 'object' && parsed !== null && typeof parsed.command === 'string') {
    return parsed.command;
  }
  return JSON.stringify(parsed, null, 2);
}

/** Flatten a settled result's content blocks to text (desktop `resultText`). */
function resultText(result) {
  if (!result) return '';
  const parts = [];
  for (const block of result.content || []) {
    if (block && block.type === 'text' && typeof block.text === 'string') parts.push(block.text);
    else if (block !== undefined) parts.push(JSON.stringify(block, null, 2));
  }
  if (!parts.length && result.error && typeof result.error === 'object') {
    parts.push(`${result.error.name || 'Error'}: ${result.error.code || ''}`.trim());
  }
  return parts.join('\n');
}

/**
 * The intended file mutation from a write / edit / str_replace_editor call:
 * `{ path, oldText, newText }` or null when the args do not describe one.
 */
function intendedDiff(toolName, argsRaw) {
  const args = parseArgs(argsRaw);
  if (typeof args !== 'object' || args === null) return null;
  if (toolName === 'str_replace_editor') {
    if (typeof args.path !== 'string' || !args.path.trim()) return null;
    if (args.command === 'create') return { path: args.path, oldText: null, newText: typeof args.file_text === 'string' ? args.file_text : '' };
    if (args.command === 'str_replace') {
      return {
        path: args.path,
        oldText: typeof args.old_str === 'string' ? args.old_str : null,
        newText: typeof args.new_str === 'string' ? args.new_str : '',
      };
    }
    return null;
  }
  const path = pickString(args, FILE_PATH_KEYS);
  if (!path) return null;
  if (toolName === 'write') {
    return typeof args.content === 'string' ? { path, oldText: null, newText: args.content } : null;
  }
  if (toolName === 'edit') {
    if (typeof args.old_string !== 'string' || typeof args.new_string !== 'string') return null;
    return { path, oldText: args.old_string || null, newText: args.new_string };
  }
  return null;
}

/**
 * Line diff between two snippets (LCS). Returns `[{ kind: 'same'|'add'|'del', text }]`.
 * Snippets are small (an edit's old/new strings); quadratic LCS is fine and
 * bails to a plain replace above a size guard so a pathological pair never
 * stalls the phone.
 */
function lineDiff(oldText, newText) {
  const a = oldText == null ? [] : String(oldText).split('\n');
  const b = String(newText ?? '').split('\n');
  if (a.length * b.length > 40_000) {
    return [...a.map((text) => ({ kind: 'del', text })), ...b.map((text) => ({ kind: 'add', text }))];
  }
  const rows = a.length + 1;
  const cols = b.length + 1;
  const lcs = new Uint16Array(rows * cols);
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      lcs[i * cols + j] = a[i] === b[j]
        ? lcs[(i + 1) * cols + j + 1] + 1
        : Math.max(lcs[(i + 1) * cols + j], lcs[i * cols + j + 1]);
    }
  }
  const out = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ kind: 'same', text: a[i] });
      i += 1;
      j += 1;
    } else if (lcs[(i + 1) * cols + j] >= lcs[i * cols + j + 1]) {
      out.push({ kind: 'del', text: a[i] });
      i += 1;
    } else {
      out.push({ kind: 'add', text: b[j] });
      j += 1;
    }
  }
  while (i < a.length) out.push({ kind: 'del', text: a[i++] });
  while (j < b.length) out.push({ kind: 'add', text: b[j++] });
  return out;
}

/**
 * Derive the row model from a call and its (optional) settled result.
 * @param {{ name: string, argsRaw: string, result?: { content?: unknown[], isError?: boolean, error?: { name?: string, code?: string } } | null, interrupted?: boolean }} call
 * @param {{ cwd?: string, home?: string }} [context]
 */
function toolRowModel(call, { cwd = '', home = '' } = {}) {
  const toolName = String(call?.name || '');
  const variant = classifyTool(toolName);
  const argsRaw = typeof call?.argsRaw === 'string' ? call.argsRaw : '';
  const result = call?.result || null;
  const done = result !== null;
  const state = !done
    ? (call?.interrupted ? 'stopped' : 'running')
    : result.error?.code === 'interrupted' ? 'stopped'
      : result.isError ? 'error' : 'ok';
  const base = argsRaw === ''
    ? String(call?.callId || '')
    : abbreviateHome(relativizeToCwd(deriveSummary(variant, argsRaw), cwd), home);
  const ownTitle = TOOL_TITLES[toolName];
  const summary = variant === 'others' && toolName !== '' && ownTitle === undefined
    ? `${toolName} · ${base}`
    : base;
  const output = done ? (resultText(result) || null) : null;
  const errorSummary = state === 'error' && output !== null ? firstLine(output) : null;
  const diff = variant === 'write' || variant === 'edit' ? intendedDiff(toolName, argsRaw) : null;
  return {
    variant,
    title: ownTitle || VARIANT_TITLES[variant],
    summary,
    filePath: deriveFilePath(variant, argsRaw),
    body: deriveBody(variant, argsRaw),
    output,
    errorSummary,
    state,
    diff,
    subagent: isSubagentTool(toolName),
  };
}

export {
  intendedDiff,
  lineDiff,
  toolRowModel,
};
