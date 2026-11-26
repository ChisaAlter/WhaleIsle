/**
 * Runtime enforcement of Whale Assistant handoff scope ceilings (`scopeCeiling` / `writePaths`)
 * on project worker subagents via `ctx.tools.guard(...)`.
 */
import { isAbsolute, relative, resolve } from 'node:path';
import { SCOPE_CEILINGS } from './schema.js';

const DOC_EXT_RE = /\.(md|mdx|txt|rst|adoc)$/i;
const PATCH_PATH_RE = /^\*\*\*\s+(?:Add File|Update File|Delete File|Move to):\s*(.+)$/i;
const HANDOFF_ID_LINE_RE = /^handoffId:\s*([^\r\n]+)/m;

/** @type {Readonly<Record<string, number>>} */
export const SCOPE_RANK = Object.freeze({
  readonly: 0,
  research: 1,
  docs: 2,
  development: 3,
});

const SHELL_TOOLS = new Set(['bash', 'pwsh', 'run_code', 'shell', 'exec', 'terminal', 'run_command']);
const WRITE_TOOLS = new Set([
  'write',
  'write_file',
  'fs_write',
  'create_file',
  'edit',
  'edit_file',
  'fs_edit',
  'multi_edit',
  'replace_file',
  'apply_patch',
  'str_replace_editor',
  'str_replace_based_edit_tool',
  'delete',
  'delete_file',
  'remove_file',
  'rm',
  'unlink',
]);

/** @param {string} toolName */
function isShellTool(toolName) {
  const normalized = String(toolName || '').trim().toLowerCase();
  if (SHELL_TOOLS.has(normalized)) return true;
  return normalized.startsWith('terminal_')
    || normalized.startsWith('job_')
    || normalized.endsWith('_bash')
    || normalized.endsWith('_pwsh')
    || normalized.endsWith('_shell');
}

/** @param {string} toolName */
function isWriteTool(toolName) {
  return WRITE_TOOLS.has(String(toolName || '').trim().toLowerCase());
}

/** @param {any} rawPath @param {string} baseDir */
function normalizePosixRelative(rawPath, baseDir) {
  const trimmed = typeof rawPath === 'string' ? rawPath.trim() : '';
  if (!trimmed) return null;
  let rel;
  if (isAbsolute(trimmed)) {
    if (!baseDir) return null;
    rel = relative(resolve(baseDir), resolve(trimmed));
  } else {
    rel = trimmed;
  }
  const posix = rel.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
  if (!posix || posix === '.' || posix === '..') return null;
  if (isAbsolute(posix) || /^[A-Za-z]:/.test(posix)) return null;
  const parts = posix.split('/');
  if (parts.some((part) => !part || part === '..' || part.toLowerCase() === '.git')) return null;
  return posix;
}

/** @param {any} entry */
function normalizeRulePath(entry) {
  return String(entry || '').trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
}

/** @param {string} relPosix @param {string[]} writePaths */
function matchesWritePaths(relPosix, writePaths) {
  if (!Array.isArray(writePaths) || writePaths.length === 0) return true;
  const target = process.platform === 'win32' ? relPosix.toLowerCase() : relPosix;
  return writePaths.some((raw) => {
    const rule = normalizeRulePath(raw);
    if (!rule) return false;
    const normRule = process.platform === 'win32' ? rule.toLowerCase() : rule;
    return target === normRule || target.startsWith(`${normRule}/`);
  });
}

/** @param {Record<string, any>} obj */
function singleTargetPath(obj) {
  const candidate = obj.file_path ?? obj.path ?? obj.target_path ?? obj.filePath;
  return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : null;
}

/** @param {string} input */
function extractPatchTargets(input) {
  if (!input.trim()) return null;
  const targets = [];
  for (const line of input.split(/\r?\n/)) {
    const match = PATCH_PATH_RE.exec(line.trim());
    if (match && match[1]?.trim()) targets.push(match[1].trim());
  }
  return targets.length > 0 ? targets : null;
}

/** @param {unknown[]} edits */
function extractEditArrayTargets(edits) {
  const targets = [];
  for (const entry of edits) {
    const candidate = entry && typeof entry === 'object' ? singleTargetPath(entry) : null;
    if (!candidate) return null;
    targets.push(candidate);
  }
  return targets.length > 0 ? targets : null;
}

/** @param {string} toolName @param {any} args */
function extractWriteTargets(toolName, args) {
  if (!args || typeof args !== 'object') return null;
  if (String(toolName || '').trim().toLowerCase() === 'apply_patch') {
    return typeof args.input === 'string' ? extractPatchTargets(args.input) : null;
  }
  const single = singleTargetPath(args);
  if (single) return [single];
  return Array.isArray(args.edits) ? extractEditArrayTargets(args.edits) : null;
}

/** @param {any} agent */
function extractSessionId(agent) {
  const sid = agent?.session?.id ?? agent?.id;
  return typeof sid === 'string' && sid.trim() ? sid.trim() : '';
}

/** @param {any} content */
function extractTextFromMessageContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((block) => (block && block.type === 'text' && typeof block.text === 'string' ? block.text : ''))
    .filter(Boolean)
    .join('\n');
}

/** @param {any} ev */
function extractHandoffIdFromEvent(ev) {
  const source = ev.data?.source ?? {};
  if (typeof source.handoffId === 'string' && source.handoffId) return source.handoffId;
  if (typeof source.rpcId === 'string' && source.rpcId) return source.rpcId;
  const msgText = extractTextFromMessageContent(ev.data?.content);
  const match = HANDOFF_ID_LINE_RE.exec(msgText);
  return match ? match[1].trim() : '';
}

/**
 * Inspect the coordinator's latest user message to see if the current turn
 * originated from a recorded Whale Assistant handoff, returning its scope policy.
 * @param {any} service
 * @param {string} projectId
 * @param {any} exec
 */
export function resolveActiveHandoffScope(service, projectId, exec) {
  const receipts = service?.handoffReceipts;
  if (!(receipts instanceof Map) || receipts.size === 0) return null;
  const events = exec?.agent?.session?.snapshotEvents?.();
  if (!Array.isArray(events) || events.length === 0) return null;

  for (let i = events.length - 1; i >= 0; i -= 1) {
    const ev = events[i];
    if (ev?.type !== 'user/message') continue;
    const handoffId = extractHandoffIdFromEvent(ev);
    if (!handoffId) return null;
    const receipt = receipts.get(handoffId);
    if (!receipt || receipt.projectId !== projectId || !receipt.scopeCeiling) return null;
    return {
      handoffId,
      scopeCeiling: receipt.scopeCeiling,
      writePaths: Array.isArray(receipt.writePaths) ? receipt.writePaths : [],
    };
  }
  return null;
}

/**
 * Merge explicitly requested task scope fields with any active handoff ceiling.
 * A task created during a handoff turn can narrow the ceiling, never widen it.
 * @param {any} requestedScope
 * @param {any} requestedWritePaths
 * @param {{ scopeCeiling: string, writePaths: string[] } | null | undefined} activeHandoff
 */
export function clampTaskScope(requestedScope, requestedWritePaths, activeHandoff) {
  const validRequested = typeof requestedScope === 'string' && SCOPE_CEILINGS.includes(requestedScope.trim())
    ? requestedScope.trim()
    : '';
  const cleanedRequestedPaths = Array.isArray(requestedWritePaths)
    ? requestedWritePaths.map((p) => normalizeRulePath(p)).filter(Boolean)
    : [];

  if (!activeHandoff) {
    return {
      ...(validRequested ? { scopeCeiling: validRequested } : {}),
      ...(cleanedRequestedPaths.length > 0 ? { writePaths: cleanedRequestedPaths } : {}),
    };
  }

  const ceiling = validRequested && SCOPE_RANK[validRequested] <= SCOPE_RANK[activeHandoff.scopeCeiling]
    ? validRequested
    : activeHandoff.scopeCeiling;

  /** @type {string[]} */
  let writePaths = [];
  if (ceiling === 'readonly' || ceiling === 'research') {
    writePaths = [];
  } else if (activeHandoff.writePaths.length > 0) {
    if (cleanedRequestedPaths.length === 0) {
      writePaths = [...activeHandoff.writePaths];
    } else {
      const filtered = cleanedRequestedPaths.filter((p) => matchesWritePaths(p, activeHandoff.writePaths));
      writePaths = filtered.length > 0 ? filtered : [...activeHandoff.writePaths];
    }
  } else {
    writePaths = cleanedRequestedPaths;
  }

  return {
    scopeCeiling: ceiling,
    ...(writePaths.length > 0 ? { writePaths } : {}),
  };
}

/** @param {any} task @param {string} ceiling @param {string} toolName @param {any} args */
function guardRestrictedCeiling(task, ceiling, toolName, args) {
  if (ceiling === 'readonly' && toolName === 'projects_memory') {
    const action = typeof args?.action === 'string' ? args.action.trim().toLowerCase() : 'read';
    if (action === 'write' || action === 'append' || action === 'delete') {
      return `Task ${task.id} has scopeCeiling="readonly": mutating shared memory (${action}) is not permitted.`;
    }
  }
  if (isWriteTool(toolName) || isShellTool(toolName)) {
    return `Task ${task.id} has scopeCeiling="${ceiling}": tool "${toolName}" is not permitted.`;
  }
  return undefined;
}

/** @param {any} task @param {string} toolName @param {any} args @param {string} baseDir @param {string[]} allowedPaths */
function guardDocsCeiling(task, toolName, args, baseDir, allowedPaths) {
  if (isShellTool(toolName)) {
    return `Task ${task.id} has scopeCeiling="docs": shell/terminal tool "${toolName}" is not permitted.`;
  }
  if (!isWriteTool(toolName)) return undefined;
  const targets = extractWriteTargets(toolName, args);
  if (!targets) {
    return `Task ${task.id} has scopeCeiling="docs": cannot verify target file paths for "${toolName}".`;
  }
  for (const target of targets) {
    const rel = normalizePosixRelative(target, baseDir);
    if (!rel || !DOC_EXT_RE.test(rel)) {
      return `Task ${task.id} has scopeCeiling="docs": writing "${target}" is not permitted (only .md/.mdx/.txt/.rst/.adoc inside workspace).`;
    }
    if (!matchesWritePaths(rel, allowedPaths)) {
      return `Task ${task.id} has scopeCeiling="docs": "${target}" is outside allowed writePaths (${allowedPaths.join(', ')}).`;
    }
  }
  return undefined;
}

/** @param {any} task @param {string} toolName @param {any} args @param {string} baseDir @param {string[]} allowedPaths */
function guardDevelopmentWritePaths(task, toolName, args, baseDir, allowedPaths) {
  if (allowedPaths.length === 0) return undefined;
  // When writePaths explicitly narrows writable paths under development, shell/terminal
  // tools cannot be path-confined safely and must be blocked (fail-closed).
  if (isShellTool(toolName)) {
    return `Task ${task.id} restricts writePaths (${allowedPaths.join(', ')}): shell/terminal tool "${toolName}" is not permitted.`;
  }
  if (!isWriteTool(toolName)) return undefined;
  const targets = extractWriteTargets(toolName, args);
  if (!targets) {
    return `Task ${task.id} restricts writePaths: cannot verify target file paths for "${toolName}".`;
  }
  for (const target of targets) {
    const rel = normalizePosixRelative(target, baseDir);
    if (!rel || !matchesWritePaths(rel, allowedPaths)) {
      return `Task ${task.id} restricts writePaths (${allowedPaths.join(', ')}): writing "${target}" is not permitted.`;
    }
  }
  return undefined;
}

/** @param {any} worker @param {any} exec */
function evaluateWorkerToolCall(worker, exec) {
  const { project, task } = worker;
  const ceiling = task.scopeCeiling;
  const toolName = String(exec?.name || '');
  const args = exec?.arguments;

  if (ceiling === 'readonly' || ceiling === 'research') {
    return guardRestrictedCeiling(task, ceiling, toolName, args);
  }
  const baseDir = task.worktreePath || project.workspace || exec?.agent?.session?.header?.cwd || '';
  const allowedPaths = Array.isArray(task.writePaths) ? task.writePaths : [];
  if (ceiling === 'docs') {
    return guardDocsCeiling(task, toolName, args, baseDir, allowedPaths);
  }
  if (ceiling === 'development') {
    return guardDevelopmentWritePaths(task, toolName, args, baseDir, allowedPaths);
  }
  return undefined;
}

/**
 * Creates a `ctx.tools.guard` callback that enforces task `scopeCeiling` and
 * `writePaths` on every tool call executed by a project worker subagent.
 * @param {any} service
 */
export function createWorkerScopeGuard(service) {
  /** @param {any} exec */
  return function workerScopeGuard(exec) {
    const sid = extractSessionId(exec?.agent);
    if (!sid) return undefined;
    const worker = service.store.getWorkerInfo(sid);
    if (!worker?.task?.scopeCeiling) return undefined;
    return evaluateWorkerToolCall(worker, exec);
  };
}
