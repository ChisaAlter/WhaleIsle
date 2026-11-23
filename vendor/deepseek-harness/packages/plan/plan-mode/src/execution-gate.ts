/**
 * Read-only `tools/pre-execute` enforcement when plan mode is active.
 * Uses a fail-closed allowlist for inspection/plan tools and strictly parses
 * `bash`/`pwsh` command segments to block writes, mutations, and side effects.
 *
 * @module @deepseek-ai/dsh-plan-mode/execution-gate
 */

import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'

const PLAN_READ_ONLY_TOOLS = new Set<string>([
  'exit_plan_mode',
  'ask_user_question',
  'whale_ui_guide',
  'render_ui',
  'html_preview',
  'html_render',
  'present',
  'read',
  'read_image',
  'glob',
  'grep',
  'working_directory',
  'lsp',
  'web_search',
  'web_fetch',
  'skill',
  'get_goal',
  'schedule_list',
  'schedule_view',
  'team_task_list',
  'team_task_get',
  'list_agents',
  'wait_agent',
  'list_subagent_models',
  'list_mcp_resources',
  'list_mcp_resource_templates',
  'read_mcp_resource',
  'session_search',
  'session_event_search',
  'session_trace',
  'session_event_trace',
  'session_event_read',
  'cordis_inspect_list',
  'cordis_inspect_query',
  'terminal_list',
  'terminal_read',
  'user_terminal_list',
  'user_terminal_read',
  'job_list',
  'job_output',
])

const SAFE_ENV_VARS = new Set(['LANG', 'LC_ALL', 'LC_CTYPE', 'NO_COLOR', 'TERM', 'TZ', 'CI'])

const BASH_READ_ONLY_CMDS = new Set([
  'ls', 'dir', 'pwd', 'which', 'where', 'whereis', 'type', 'cat', 'head', 'tail',
  'nl', 'wc', 'stat', 'file', 'realpath', 'readlink', 'dirname', 'basename', 'tree',
  'rg', 'ag', 'ack', 'grep', 'egrep', 'fgrep', 'jq', 'uniq', 'cut', 'tr', 'diff',
  'cmp', 'comm', 'md5sum', 'sha1sum', 'sha256sum', 'shasum', 'echo', 'printf',
  'true', 'false', 'test', '[', 'date', 'uname', 'whoami', 'id', 'hostname',
  'printenv', 'ps', 'df', 'du', 'free', 'uptime', 'lsof', 'findstr', 'where.exe',
])

const PWSH_READ_ONLY_CMDS = new Set([
  'get-childitem', 'gci', 'dir', 'ls',
  'get-content', 'gc', 'cat', 'type',
  'get-item', 'gi', 'get-itemproperty', 'gp', 'get-itempropertyvalue', 'gpv',
  'get-location', 'gl', 'pwd',
  'test-path', 'resolve-path', 'rvpa', 'split-path', 'join-path',
  'select-string', 'sls',
  'select-object', 'select',
  'sort-object', 'sort',
  'group-object', 'group',
  'measure-object', 'measure',
  'format-table', 'ft', 'format-list', 'fl', 'out-string',
  'write-output', 'echo',
  'get-command', 'gcm', 'get-help', 'get-process', 'gps', 'get-date', 'get-filehash',
  'convertfrom-json', 'convertto-json', 'compare-object', 'diff',
])

const GIT_READ_ONLY_SUBCOMMANDS = new Set([
  'status', 'diff', 'log', 'show', 'blame', 'annotate', 'ls-files', 'ls-tree',
  'rev-parse', 'describe', 'shortlog', 'grep', 'cat-file', 'for-each-ref',
  'name-rev', 'merge-base', 'check-ignore',
])

const FIND_BLOCKED_FLAGS = new Set([
  '-exec', '-execdir', '-ok', '-okdir', '-delete', '-fls', '-fprint', '-fprint0', '-fprintf',
])

const PKG_READ_ONLY_SUBCOMMANDS = new Set(['list', 'ls', 'view', 'info', 'show', 'why', 'outdated', 'version'])

const SAFE_PROBE_FLAGS = new Set(['--version', '-v', '-V', '--help', '-h'])

export interface ShellGateCheck {
  readonly allowed: boolean
  readonly reason?: string
}

function isSeparatorBoundary(ch: string | undefined): boolean {
  return ch === undefined || /\s|[;|&]/.test(ch)
}

function matchSafeRedirection(command: string, index: number, shellName: 'bash' | 'pwsh'): number | null {
  const candidates = shellName === 'pwsh'
    ? ['2>$null', '>$null', '2>&1', '1>&2']
    : ['2>/dev/null', '2>&1', '1>&2']
  for (const candidate of candidates) {
    if (command.startsWith(candidate, index)) {
      const before = index === 0 ? undefined : command[index - 1]
      const after = command[index + candidate.length]
      if (isSeparatorBoundary(before) && isSeparatorBoundary(after)) {
        return candidate.length
      }
    }
  }
  return null
}

/**
 * Split a shell string into statement segments on `;`, `&&`, `||`, `|`, and newlines,
 * while rejecting unclosed quotes and dangerous shell constructs (redirections,
 * subshells, command/process substitution, background `&`, unquoted braces).
 */
function parseShellSegments(command: string, shellName: 'bash' | 'pwsh'): { ok: true; segments: string[][] } | { ok: false; reason: string } {
  if (command.includes('\0')) return { ok: false, reason: 'NUL byte is not permitted in shell commands' }

  const segments: string[][] = []
  let tokens: string[] = []
  let current = ''
  let hasToken = false
  let quote: '\'' | '"' | null = null

  const pushToken = () => {
    if (hasToken) {
      tokens.push(current)
      current = ''
      hasToken = false
    }
  }

  const pushSegment = () => {
    pushToken()
    if (tokens.length > 0) {
      segments.push(tokens)
      tokens = []
    }
  }

  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i]
    if (ch === undefined) continue

    if (quote === '\'') {
      if (ch === '\'') quote = null
      else current += ch
      continue
    }

    if (quote === '"') {
      if (ch === '"') {
        quote = null
        continue
      }
      if (ch === '`') {
        return { ok: false, reason: 'backtick expansion/escape is blocked in plan mode' }
      }
      if (ch === '$' && command[i + 1] === '(') {
        return { ok: false, reason: 'command substitution "$(" is blocked in plan mode' }
      }
      if (shellName === 'bash' && ch === '\\' && i + 1 < command.length) {
        const next = command[i + 1]
        if (next === '"' || next === '\\' || next === '$' || next === '`') {
          current += next
          i += 1
          continue
        }
      }
      current += ch
      continue
    }

    // Outside quotes:
    const redirLen = matchSafeRedirection(command, i, shellName)
    if (redirLen !== null) {
      pushToken()
      i += redirLen - 1
      continue
    }

    if (ch === '\'' || ch === '"') {
      quote = ch
      hasToken = true
      continue
    }

    if (shellName === 'bash' && ch === '\\') {
      const next = command[i + 1]
      if (next === undefined) return { ok: false, reason: 'trailing backslash escape is blocked in plan mode' }
      if (next !== '\n') {
        current += next
        hasToken = true
      }
      i += 1
      continue
    }

    if (ch === '#') {
      while (i < command.length && command[i] !== '\n') i += 1
      pushSegment()
      continue
    }

    if (ch === '`') return { ok: false, reason: 'backtick expansion/escape is blocked in plan mode' }
    if (ch === '$' && command[i + 1] === '(') return { ok: false, reason: 'command substitution "$(" is blocked in plan mode' }
    if ((ch === '<' || ch === '>') && command[i + 1] === '(') return { ok: false, reason: 'process substitution is blocked in plan mode' }
    if (ch === '>') return { ok: false, reason: 'output redirection ">" is blocked in plan mode' }
    if (ch === '(' || ch === ')' || ch === '{' || ch === '}') {
      return { ok: false, reason: `unquoted grouping operator "${ch}" is blocked in plan mode` }
    }

    if (ch === '\n' || ch === '\r' || ch === ';') {
      pushSegment()
      continue
    }

    if (ch === '&') {
      if (command[i + 1] === '&') {
        pushSegment()
        i += 1
        continue
      }
      return { ok: false, reason: 'background/call operator "&" is blocked in plan mode' }
    }

    if (ch === '|') {
      if (command[i + 1] === '|') i += 1
      pushSegment()
      continue
    }

    if (/\s/.test(ch)) {
      pushToken()
      continue
    }

    current += ch
    hasToken = true
  }

  if (quote !== null) return { ok: false, reason: 'unterminated quote in shell command' }
  pushSegment()
  if (segments.length === 0) return { ok: false, reason: 'empty shell command is not permitted' }
  return { ok: true, segments }
}

function normalizeExecutable(token: string, shellName: 'bash' | 'pwsh'): string {
  const unslashed = token.includes('/') ? token.slice(token.lastIndexOf('/') + 1) : token
  const base = unslashed.includes('\\') ? unslashed.slice(unslashed.lastIndexOf('\\') + 1) : unslashed
  return shellName === 'pwsh' ? base.toLowerCase() : base
}

function stripLeadingSafeEnv(tokens: readonly string[], shellName: 'bash' | 'pwsh'): readonly string[] | null {
  if (shellName !== 'bash') return tokens
  let index = 0
  while (index < tokens.length) {
    const token = tokens[index]
    if (token === undefined) break
    const eq = token.indexOf('=')
    if (eq <= 0 || token.startsWith('-')) break
    const key = token.slice(0, eq)
    const value = token.slice(eq + 1)
    const allowed = SAFE_ENV_VARS.has(key) || ((key === 'GIT_PAGER' || key === 'PAGER') && value === 'cat')
    if (!allowed) return null
    index += 1
  }
  return tokens.slice(index)
}

function checkGitArgs(args: readonly string[]): ShellGateCheck {
  let index = 0
  while (index < args.length) {
    const arg = args[index]
    if (arg === undefined || !arg.startsWith('-')) break
    if (arg === '-c' || arg.startsWith('-c=') || arg === '--config-env' || arg.startsWith('--config-env=')
      || arg === '--exec-path' || arg.startsWith('--exec-path=') || arg === '--upload-pack' || arg.startsWith('--upload-pack=')) {
      return { allowed: false, reason: `git option "${arg}" can invoke external commands or override config` }
    }
    if (arg === '-C' || arg === '--git-dir' || arg === '--work-tree' || arg === '--namespace') {
      index += 2
      continue
    }
    index += 1
  }

  const sub = args[index]
  if (sub === undefined) {
    return args.some(a => a === '--version' || a === '-v' || a === '--help' || a === '-h')
      ? { allowed: true }
      : { allowed: false, reason: 'git invocation without a read-only subcommand is blocked' }
  }

  const rest = args.slice(index + 1)
  if (sub === 'diff' && rest.some(a => a === '--ext-diff' || a.startsWith('--output='))) {
    return { allowed: false, reason: 'git diff external/output options are blocked in plan mode' }
  }
  if (GIT_READ_ONLY_SUBCOMMANDS.has(sub)) return { allowed: true }

  if (sub === 'branch') {
    const hasMutatingFlag = rest.some(a =>
      ['-d', '-D', '-m', '-M', '-c', '-C', '-f', '--delete', '--move', '--copy', '--force', '--set-upstream-to', '--unset-upstream', '--edit-description'].includes(a)
      || a.startsWith('--set-upstream-to='))
    const positionals = rest.filter(a => !a.startsWith('-'))
    return !hasMutatingFlag && positionals.length === 0
      ? { allowed: true }
      : { allowed: false, reason: 'mutating git branch flags or arguments are blocked in plan mode' }
  }

  if (sub === 'tag') {
    const hasMutatingFlag = rest.some(a => ['-d', '-a', '-s', '-u', '-f', '--delete', '--annotate', '--sign', '--force'].includes(a))
    const listOnly = rest.length === 0 || rest.includes('-l') || rest.includes('--list')
    return !hasMutatingFlag && listOnly
      ? { allowed: true }
      : { allowed: false, reason: 'mutating git tag operations are blocked in plan mode' }
  }

  if (sub === 'remote') {
    const subAction = rest.find(a => !a.startsWith('-'))
    return subAction === undefined || subAction === 'show' || subAction === 'get-url'
      ? { allowed: true }
      : { allowed: false, reason: `git remote "${subAction}" is blocked in plan mode` }
  }

  if (sub === 'config') {
    return rest.some(a => a === '--get' || a === '--get-all' || a === '--list' || a === '-l')
      && !rest.some(a => a === '--unset' || a === '--unset-all' || a === '--add' || a === '--replace-all' || a === '--edit' || a === '-e')
      ? { allowed: true }
      : { allowed: false, reason: 'only read-only git config queries (--get / --list) are allowed in plan mode' }
  }

  if (sub === 'stash') {
    const subAction = rest[0]
    return subAction === 'list' || subAction === 'show'
      ? { allowed: true }
      : { allowed: false, reason: `git stash "${subAction ?? 'push'}" is blocked in plan mode` }
  }

  if (sub === 'reflog') {
    const subAction = rest.find(a => !a.startsWith('-'))
    return subAction === undefined || subAction === 'show'
      ? { allowed: true }
      : { allowed: false, reason: `git reflog "${subAction}" is blocked in plan mode` }
  }

  return { allowed: false, reason: `git subcommand "${sub}" is not in the plan-mode read-only allowlist` }
}

function checkSegment(tokens: readonly string[], shellName: 'bash' | 'pwsh'): ShellGateCheck {
  const effective = stripLeadingSafeEnv(tokens, shellName)
  if (effective === null) {
    return { allowed: false, reason: 'environment variable assignment before command is blocked in plan mode' }
  }
  if (effective.length === 0) return { allowed: false, reason: 'missing executable in command segment' }

  const rawExe = effective[0]
  if (rawExe === undefined) return { allowed: false, reason: 'missing executable in command segment' }
  // Reject relative script executions like `./script.sh` or `.` dot-sourcing.
  if (rawExe === '.' || rawExe.startsWith('./') || rawExe.startsWith('.\\') || rawExe.includes('/') || rawExe.includes('\\')) {
    return { allowed: false, reason: `script or path-qualified executable "${rawExe}" is blocked in plan mode` }
  }

  const exe = normalizeExecutable(rawExe, shellName)
  const args = effective.slice(1)

  if (exe === 'git') return checkGitArgs(args)

  if (exe === 'find') {
    const blocked = args.find(a => FIND_BLOCKED_FLAGS.has(a))
    return blocked === undefined
      ? { allowed: true }
      : { allowed: false, reason: `find option "${blocked}" can modify files or execute commands` }
  }

  if (exe === 'sed') {
    const hasWriteOrScriptFile = args.some(a =>
      a === '-i' || a.startsWith('-i') || a === '--in-place' || a.startsWith('--in-place=')
      || a === '-f' || a.startsWith('-f') || a === '--file' || a.startsWith('--file='))
    if (hasWriteOrScriptFile) return { allowed: false, reason: 'sed in-place editing (-i) and external script files (-f) are blocked in plan mode' }
    const hasScriptWrite = args.some(a =>
      /(?:^|[;\n{:])\s*(?:[0-9,$]+|\/[^\/]*\/)?\s*[wWe]\b|s(.)[\s\S]*?\1[\s\S]*?\1[a-zA-Z0-9]*[wWe]/.test(a))
    if (hasScriptWrite) return { allowed: false, reason: 'sed write/execute expressions (w/W/e) are blocked in plan mode' }
    return { allowed: true }
  }

  if (exe === 'awk' || exe === 'gawk' || exe === 'mawk') {
    const hasScriptFile = args.some(a => a === '-f' || a.startsWith('-f') || a === '--file' || a.startsWith('--file='))
    if (hasScriptFile) return { allowed: false, reason: `${exe} external script files (-f) are blocked in plan mode` }
    const risky = args.some(a => /(?:system\s*\(|getline|(?:^|[^|])\|(?:[^|]|$)|>|>>)/.test(a))
    return risky
      ? { allowed: false, reason: `${exe} system()/file-write/pipe actions are blocked in plan mode` }
      : { allowed: true }
  }

  if (exe === 'rg' || exe === 'grep' || exe === 'ag' || exe === 'ack') {
    const risky = args.find(a => a === '--pre' || a.startsWith('--pre=') || a === '--hostname-bin' || a.startsWith('--hostname-bin='))
    return risky === undefined
      ? { allowed: true }
      : { allowed: false, reason: `${exe} option "${risky}" executes external binaries` }
  }

  if (exe === 'sort') {
    const hasUnsafe = args.some(a =>
      a === '-o' || a.startsWith('-o') || a === '--output' || a.startsWith('--output=')
      || a === '--compress-program' || a.startsWith('--compress-program='))
    return hasUnsafe ? { allowed: false, reason: 'sort output file (-o) and --compress-program are blocked in plan mode' } : { allowed: true }
  }

  if (exe === 'env') {
    return args.every(a => a === '-0' || a === '--null')
      ? { allowed: true }
      : { allowed: false, reason: 'env with command execution or flags beyond listing (-0/--null) is blocked in plan mode' }
  }

  if (exe === 'command') {
    return args.some(a => a === '-v' || a === '-V')
      ? { allowed: true }
      : { allowed: false, reason: 'command builtin is restricted to -v/-V lookup in plan mode' }
  }

  if (exe === 'node' || exe === 'python' || exe === 'python3' || exe === 'ruby' || exe === 'perl' || exe === 'php' || exe === 'bun' || exe === 'deno') {
    const firstArg = args[0]
    return args.length === 1 && firstArg !== undefined && SAFE_PROBE_FLAGS.has(firstArg)
      ? { allowed: true }
      : { allowed: false, reason: `arbitrary script execution via "${exe}" is blocked in plan mode` }
  }

  if (exe === 'npm' || exe === 'pnpm' || exe === 'yarn' || exe === 'cargo' || exe === 'pip' || exe === 'pip3' || exe === 'go') {
    let idx = 0
    while (idx < args.length) {
      const a = args[idx]
      if (a === undefined) break
      if (a === '--dir' || a === '-C' || a === '--prefix') {
        idx += 2
        continue
      }
      if (!a.startsWith('-')) break
      if (SAFE_PROBE_FLAGS.has(a) && args.length === 1) return { allowed: true }
      idx += 1
    }
    const sub = args[idx]
    if (sub !== undefined && PKG_READ_ONLY_SUBCOMMANDS.has(sub)) return { allowed: true }
    if (sub === 'config' && (args[idx + 1] === 'list' || args[idx + 1] === 'get' || args[idx + 1] === 'ls')) {
      return { allowed: true }
    }
    return { allowed: false, reason: `package/build tool "${exe} ${sub ?? ''}" is blocked in plan mode`.trim() }
  }

  const allowedSet = shellName === 'pwsh' ? PWSH_READ_ONLY_CMDS : BASH_READ_ONLY_CMDS
  if (allowedSet.has(exe) || (shellName === 'pwsh' && BASH_READ_ONLY_CMDS.has(exe))) {
    return { allowed: true }
  }

  return { allowed: false, reason: `command "${rawExe}" is not in the plan-mode read-only allowlist` }
}

/** Verify every statement in a `bash` or `pwsh` command is strictly read-only. */
export function isReadOnlyShellCommand(shellName: 'bash' | 'pwsh', command: unknown): ShellGateCheck {
  if (typeof command !== 'string' || command.trim() === '') {
    return { allowed: false, reason: 'missing or empty shell command' }
  }
  const parsed = parseShellSegments(command, shellName)
  if (!parsed.ok) return { allowed: false, reason: parsed.reason }

  for (const segment of parsed.segments) {
    const check = checkSegment(segment, shellName)
    if (!check.allowed) return check
  }
  return { allowed: true }
}

/**
 * Evaluate a pending tool call under active plan mode (`tools/pre-execute`).
 * Allows only explicitly safe read/plan tools, `str_replace_editor` (`view`),
 * and strictly verified read-only shell commands.
 */
export function evaluatePlanModeToolGate(exec: Readonly<ToolExecution>): PreToolDecision {
  if (PLAN_READ_ONLY_TOOLS.has(exec.name)) return { kind: 'allow' }

  const args = (typeof exec.arguments === 'object' && exec.arguments !== null
    ? exec.arguments
    : {}) as Record<string, unknown>

  if (exec.name === 'str_replace_editor') {
    if (args.command === 'view') return { kind: 'allow' }
    const cmdLabel = typeof args.command === 'string' ? args.command : typeof args.command
    return {
      kind: 'deny',
      reason: `Plan mode is read-only: str_replace_editor command "${cmdLabel}" is blocked while planning; only "view" is permitted.`,
      info: { name: 'PlanModeReadOnlyError', code: 'PLAN_MODE_READ_ONLY' },
    }
  }

  if (exec.name === 'bash' || exec.name === 'pwsh') {
    const shellCheck = isReadOnlyShellCommand(exec.name, args.command)
    if (shellCheck.allowed) return { kind: 'allow' }
    return {
      kind: 'deny',
      reason: `Plan mode is read-only: ${exec.name} command denied (${shellCheck.reason ?? 'non-read-only command'}). Only read-only inspection commands are allowed while planning.`,
      info: { name: 'PlanModeReadOnlyError', code: 'PLAN_MODE_READ_ONLY' },
    }
  }

  return {
    kind: 'deny',
    reason: `Plan mode is read-only: tool "${exec.name}" cannot run while plan mode is active. Use read-only inspection tools or call exit_plan_mode when your plan is ready.`,
    info: { name: 'PlanModeReadOnlyError', code: 'PLAN_MODE_READ_ONLY' },
  }
}
