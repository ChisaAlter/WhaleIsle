/**
 * Runtime enforcement of Whale Assistant handoff scope ceilings (`scopeCeiling` / `writePaths`)
 * on project worker subagents via `ctx.tools.guard(...)`.
 */
import { isAbsolute, relative, resolve } from 'node:path';
import { SCOPE_CEILINGS } from './schema.js';

const DOC_EXT_RE = /\.(md|mdx|txt|rst|adoc)$/i;
const PATCH_PATH_RE = /^\*\*\*\s+(?:Add File|Update File|Delete File|Move to):\s*(.+)$/i;
const HANDOFF_ID_LINE_RE = /^handoffId:\s*([^\r\n]+)/m;

export const SCOPE_RANK = Object.freeze({
  readonly: 0,
  research: 1,
  docs: 2,
  development: 3,
});

const SHELL_TOOLS = new Set(['bash', 'pwsh', 'run_code', 'shell', 'exec']);
const WRITE_TOOLS = new Set([
  'write',
  'edit',
  'apply_patch',
  'str_replace_editor',
  'create_file',
  'delete_file',
]);

function isShellTool(toolName) {
  if (SHELL_TOOLS.has(toolName)) return true;
  return toolName.startsWith('terminal_')
    || toolName.startsWith('job_')
    || toolName.endsWith('_bash')
    || toolName.endsWith('_pwsh');
}

function isWriteTool(toolName) {
  return WRITE_TOOLS.has(toolName);
}

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

function normalizeRulePath(entry) {
  const posix = String(entry || '').trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
  return posix;
}

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

function extractWriteTargets(toolName, args) {
  if (!args || typeof args !== 'object') return null;
  if (toolName === 'apply_patch') {
    const input = typeof args.input === 'string' ? args.input : '';
    if (!input.trim()) return null;
    const targets = [];
    for (const line of input.split(/\r?\n/)) {
      const match = PATCH_PATH_RE.exec(line.trim());
      if (match && match[1]?.trim()) targets.push(match[1].trim());
    }
    return targets.length > 0 ? targets : null;
  }
  const single = args.file_path ?? args.path ?? args.target_path;
  return typeof single === 'string' && single.trim() ? [single.trim()] : null;
}

function extractSessionId(agent) {
  const sid = agent?.session?.id ?? agent?.id;
  return typeof sid === 'string' && sid.trim() ? sid.trim() : '';
}

function extractTextFromMessageContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((block) => (block && block.type === 'text' && typeof block.text === 'string' ? block.text : ''))
    .filter(Boolean)
    .join('\n');
}

/**
 * Inspect the coordinator's latest user message to see if the current turn
 * originated from a recorded Whale Assistant handoff, returning its scope policy.
 */
export function resolveActiveHandoffScope(service, projectId, exec) {
  const receipts = service?.handoffReceipts;
  if (!(receipts instanceof Map) || receipts.size === 0) return null;
  const events = exec?.agent?.session?.snapshotEvents?.();
  if (!Array.isArray(events) || events.length === 0) return null;

  for (let i = events.length - 1; i >= 0; i -= 1) {
    const ev = events[i];
    if (ev?.type !== 'user/message') continue;
    const source = ev.data?.source ?? {};
    let handoffId = typeof source.handoffId === 'string' && source.handoffId
      ? source.handoffId
      : typeof source.rpcId === 'string' && source.rpcId
        ? source.rpcId
        : '';
    if (!handoffId) {
      const msgText = extractTextFromMessageContent(ev.data?.content);
      const match = HANDOFF_ID_LINE_RE.exec(msgText);
      if (match) handoffId = match[1].trim();
    }
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

/**
 * Creates a `ctx.tools.guard` callback that enforces task `scopeCeiling` and
 * `writePaths` on every tool call executed by a project worker subagent.
 */
export function createWorkerScopeGuard(service) {
  return function workerScopeGuard(exec) {
    const sid = extractSessionId(exec?.agent);
    if (!sid) return undefined;
    const worker = service.store.getWorkerInfo(sid);
    if (!worker?.task?.scopeCeiling) return undefined;

    const { project, task } = worker;
    const ceiling = task.scopeCeiling;
    const toolName = String(exec?.name || '');
    const args = exec?.arguments;

    if (ceiling === 'readonly' && toolName === 'projects_memory') {
      const action = typeof args?.action === 'string' ? args.action.trim().toLowerCase() : 'read';
      if (action === 'write' || action === 'append' || action === 'delete') {
        return `Task ${task.id} has scopeCeiling="readonly": mutating shared memory (${action}) is not permitted.`;
      }
    }

    if (ceiling === 'readonly' || ceiling === 'research') {
      if (isWriteTool(toolName) || isShellTool(toolName)) {
        return `Task ${task.id} has scopeCeiling="${ceiling}": tool "${toolName}" is not permitted.`;
      }
      return undefined;
    }

    const baseDir = task.worktreePath || project.workspace || exec?.agent?.session?.header?.cwd || '';
    const allowedPaths = Array.isArray(task.writePaths) ? task.writePaths : [];

    if (ceiling === 'docs') {
      if (isShellTool(toolName)) {
        return `Task ${task.id} has scopeCeiling="docs": shell/terminal tool "${toolName}" is not permitted.`;
      }
      if (isWriteTool(toolName)) {
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
      }
      return undefined;
    }

    if (ceiling === 'development' && allowedPaths.length > 0 && isWriteTool(toolName)) {
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
    }

    return undefined;
  };
}
