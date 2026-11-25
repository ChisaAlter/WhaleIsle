/**
 * Model-facing `lsp` tool over `ctx.lsp`, plus optional post-edit automatic diagnostics feedback.
 * Supports `goToDefinition`, `findReferences`, `goToImplementation`, `hover`, and `diagnostics`;
 * converts one-based UTF-16 cursor coordinates to the seam's zero-based positions, requires the
 * session workspace with no fallback, caps and renders results, and attaches a configurable
 * timeout budget for `dsh-tool-call-timeout-policy` to enforce.
 *
 * Namespace plugin (named exports, no default export).
 * @module @deepseek-ai/dsh-tool-lsp
 */

import type {} from '@deepseek-ai/dsh-working-directory'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { PostToolDecision } from '@deepseek-ai/dsh-tools'
import { LspError } from '@deepseek-ai/dsh-lsp'
import type {} from '@deepseek-ai/dsh-lsp'
import { deadline, MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { assertNever } from '@deepseek-ai/dsh-util-values'
import {
  appendDiagnosticsContent,
  DEFAULT_MAX_LOCATIONS,
  DEFAULT_MAX_RESULT_CHARS,
  extractEditedFilePaths,
  formatDiagnostics,
  formatHover,
  formatLocations,
  LSP_OPERATIONS,
  parseLspArgs,
  presentLspCall,
} from './render.ts'

export {
  appendDiagnosticsContent,
  DEFAULT_MAX_LOCATIONS,
  DEFAULT_MAX_RESULT_CHARS,
  extractEditedFilePaths,
  formatDiagnostics,
  formatHover,
  formatLocations,
  LSP_OPERATIONS,
  parseLspArgs,
  presentLspCall,
  renderUri,
} from './render.ts'

/** Cordis plugin name for loader diagnostics. */
export const name = 'tool-lsp'

/** Services required by this plugin. */
export const inject = ['tools', 'lsp', 'systemPrompt', 'workingDirectory']

/** Default tool-call timeout budget (ms), covering the queued open/query/close lifecycle. */
export const DEFAULT_LSP_TOOL_TIMEOUT_MS = 60_000

/** Default short timeout budget (ms) for post-edit automatic diagnostics feedback. */
export const DEFAULT_AUTO_DIAGNOSTICS_TIMEOUT_MS = 2_000

/** Maximum files probed per post-execute hook (guards large multi-file patches). */
const MAX_AUTO_DIAGNOSTICS_FILES = 5

/** Maximum character length for compact post-edit diagnostics appended to edit results. */
const MAX_AUTO_DIAGNOSTICS_CHARS = 4_000

/** The stable system-prompt guidance positioning LSP as a precision aid. */
export const LSP_PROMPT_TEXT =
  'Use search/read for ordinary navigation. Use lsp when textual matches are ambiguous or before a change requires precise definitions, implementations, or references. Positions are one-based line and character (UTF-16) at the cursor; an off-symbol position may return no results. findReferences always includes the declaration.'

/** Plugin configuration: result caps, timeout budgets, and post-edit diagnostics switch. */
export interface Config {
  /** Largest number of rendered locations or diagnostics before an omission marker (default 100). */
  maxLocations?: number
  /** Largest complete rendered result in characters, including truncation metadata (default 16000). */
  maxResultChars?: number
  /** Tool-call timeout budget in ms (default 60000). */
  timeoutMs?: number
  /** Automatically query LSP diagnostics after successful file edits and append Error/Warning results (default true). */
  autoDiagnosticsAfterEdit?: boolean
  /** Short bounded timeout (ms) for post-edit automatic diagnostics (default 2000). */
  autoDiagnosticsTimeoutMs?: number
}

export const Config: z<Config> = z.object({
  maxLocations: z.number().default(DEFAULT_MAX_LOCATIONS),
  maxResultChars: z.number().default(DEFAULT_MAX_RESULT_CHARS),
  timeoutMs: z.number().max(MAX_TIMER_DELAY_MS).default(DEFAULT_LSP_TOOL_TIMEOUT_MS),
  autoDiagnosticsAfterEdit: z.boolean().default(true),
  autoDiagnosticsTimeoutMs: z.number().max(MAX_TIMER_DELAY_MS).default(DEFAULT_AUTO_DIAGNOSTICS_TIMEOUT_MS),
})

type ResolvedConfig = Required<Config>

const LSP_POSITION_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    line: { type: 'integer', required: true },
    character: { type: 'integer', required: true },
  },
} as const

const LSP_RANGE_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    start: { ...LSP_POSITION_OUTPUT_SCHEMA, required: true },
    end: { ...LSP_POSITION_OUTPUT_SCHEMA, required: true },
  },
} as const

/**
 * Register the `lsp` tool, its system-prompt guidance, and optional post-edit diagnostics feedback.
 * @param ctx - the plugin context (must inject `tools`, `lsp`, `systemPrompt`, `workingDirectory`).
 * @param config - the resolved plugin configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const resolved: ResolvedConfig = {
    maxLocations: config.maxLocations ?? DEFAULT_MAX_LOCATIONS,
    maxResultChars: config.maxResultChars ?? DEFAULT_MAX_RESULT_CHARS,
    timeoutMs: config.timeoutMs ?? DEFAULT_LSP_TOOL_TIMEOUT_MS,
    autoDiagnosticsAfterEdit: config.autoDiagnosticsAfterEdit ?? true,
    autoDiagnosticsTimeoutMs: config.autoDiagnosticsTimeoutMs ?? DEFAULT_AUTO_DIAGNOSTICS_TIMEOUT_MS,
  }
  assertPositiveInteger('maxLocations', resolved.maxLocations)
  assertPositiveInteger('maxResultChars', resolved.maxResultChars)
  assertTimer('timeoutMs', resolved.timeoutMs)
  assertTimer('autoDiagnosticsTimeoutMs', resolved.autoDiagnosticsTimeoutMs)

  ctx.systemPrompt.section({
    name: 'tool:lsp',
    order: ctx.systemPrompt.getSectionOrder('TOOL_LSP'),
    text: LSP_PROMPT_TEXT,
    retirement: 'The lsp tool is no longer available. Its guidance no longer applies.',
  })

  ctx.tools.register(defineTool({
    name: 'lsp',
    description:
      'Query a language server for precise code navigation or diagnostics. operation is one of goToDefinition, findReferences, goToImplementation, hover, diagnostics. line and character are one-based UTF-16 cursor coordinates (optional for diagnostics). findReferences includes the declaration.',
    parameters: {
      operation: {
        type: 'string',
        required: true,
        enum: [...LSP_OPERATIONS],
        description: 'goToDefinition, findReferences, goToImplementation, hover, or diagnostics.',
      },
      file_path: { type: 'string', required: true, description: 'The source file to query, relative to the workspace or absolute.' },
      line: { type: 'number', description: 'One-based line of the cursor (required for cursor operations; optional for diagnostics).' },
      character: { type: 'number', description: 'One-based UTF-16 column of the cursor (required for cursor operations; optional for diagnostics).' },
    },
    output: {
      schema: {
        oneOf: [
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              kind: { type: 'string', required: true, const: 'locations' },
              locations: {
                type: 'array',
                required: true,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    uri: { type: 'string', required: true },
                    range: { ...LSP_RANGE_OUTPUT_SCHEMA, required: true },
                  },
                },
              },
              resolvedWorkspaceUri: { type: 'string', required: true },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              kind: { type: 'string', required: true, const: 'hover' },
              hover: {
                required: true,
                oneOf: [
                  { type: 'null' },
                  {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      contents: { type: 'string', required: true },
                      range: LSP_RANGE_OUTPUT_SCHEMA,
                    },
                  },
                ],
              },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              kind: { type: 'string', required: true, const: 'diagnostics' },
              uri: { type: 'string', required: true },
              diagnostics: {
                type: 'array',
                required: true,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    range: { ...LSP_RANGE_OUTPUT_SCHEMA, required: true },
                    severity: { type: 'string', required: true, enum: ['error', 'warning', 'information', 'hint'] },
                    message: { type: 'string', required: true },
                    code: { oneOf: [{ type: 'string' }, { type: 'number' }] },
                    source: { type: 'string' },
                  },
                },
              },
              resolvedWorkspaceUri: { type: 'string', required: true },
            },
          },
        ],
      },
      render: (_args, value) => {
        switch (value.kind) {
          case 'locations':
            return [{ type: 'text', text: formatLocations(value.locations, value.resolvedWorkspaceUri, resolved.maxLocations, resolved.maxResultChars) }]
          case 'hover':
            return [{ type: 'text', text: formatHover(value.hover, resolved.maxResultChars) }]
          case 'diagnostics':
            return [{
              type: 'text',
              text: formatDiagnostics(
                value.diagnostics,
                value.uri,
                value.resolvedWorkspaceUri,
                resolved.maxLocations,
                resolved.maxResultChars,
              ),
            }]
          /* v8 ignore next -- exhaustive over the output schema's closed union; unreachable. */
          default:
            return assertNever(value, 'tool-lsp output')
        }
      },
    },
    timeoutMs: resolved.timeoutMs,
    async execute(args, exec) {
      const input = parseLspArgs(args)
      const workspaceRoot = exec.agent === undefined ? undefined : await ctx.workingDirectory.ensure(exec.agent, exec.signal)
      if (workspaceRoot === undefined) {
        throw new LspError('the lsp tool requires a session workspace cwd', 'LSP_WORKSPACE_REQUIRED')
      }
      const result = await ctx.lsp.query({
        operation: input.operation,
        filePath: input.filePath,
        position: input.position,
        workspaceRoot,
      }, exec.signal)
      switch (result.kind) {
        case 'locations':
          return {
            kind: 'locations' as const,
            locations: result.locations.map(location => ({
              uri: location.uri,
              range: {
                start: { line: location.range.start.line, character: location.range.start.character },
                end: { line: location.range.end.line, character: location.range.end.character },
              },
            })),
            resolvedWorkspaceUri: result.resolvedWorkspaceUri,
          }
        case 'hover':
          return {
            kind: 'hover' as const,
            hover: result.hover === null
              ? null
              : {
                contents: result.hover.contents,
                ...result.hover.range === undefined
                  ? {}
                  : {
                    range: {
                      start: { line: result.hover.range.start.line, character: result.hover.range.start.character },
                      end: { line: result.hover.range.end.line, character: result.hover.range.end.character },
                    },
                  },
              },
          }
        case 'diagnostics':
          return {
            kind: 'diagnostics' as const,
            uri: result.uri,
            diagnostics: result.diagnostics.map(diagnostic => ({
              range: {
                start: { line: diagnostic.range.start.line, character: diagnostic.range.start.character },
                end: { line: diagnostic.range.end.line, character: diagnostic.range.end.character },
              },
              severity: diagnostic.severity,
              message: diagnostic.message,
              ...diagnostic.code !== undefined ? { code: diagnostic.code } : {},
              ...diagnostic.source !== undefined ? { source: diagnostic.source } : {},
            })),
            resolvedWorkspaceUri: result.resolvedWorkspaceUri,
          }
        /* v8 ignore next -- exhaustive over the closed LspQueryResult union; unreachable. */
        default:
          return assertNever(result, 'tool-lsp result')
      }
    },
    presentCall: presentLspCall,
  }))

  ctx.on('tools/post-execute', async (exec, result, next): Promise<PostToolDecision> => {
    const decision = await next()
    if (!resolved.autoDiagnosticsAfterEdit) return decision
    if (result.isError || decision.kind !== 'accept') return decision
    if (Object.hasOwn(decision, 'value')) return decision

    const filePaths = extractEditedFilePaths(exec.name, exec.arguments, result.value)
    if (filePaths.length === 0) return decision

    const matchedPaths = filePaths.filter(path => ctx.lsp.supportsFile?.(path) !== false)
    if (matchedPaths.length === 0 || exec.agent === undefined) return decision

    using budget = deadline(exec.signal, resolved.autoDiagnosticsTimeoutMs, 'LSP_AUTO_DIAGNOSTICS_TIMEOUT')
    let workspaceRoot: string
    try {
      workspaceRoot = await raceSignal(ctx.workingDirectory.ensure(exec.agent, budget.signal), budget.signal)
    } catch {
      // Auto-diagnostics are best-effort; never fail or stall a completed file edit when workspace resolution fails or times out.
      return decision
    }

    const diagnosticBlocks: string[] = []
    const maxDiagChars = Math.min(resolved.maxResultChars, MAX_AUTO_DIAGNOSTICS_CHARS)
    for (const filePath of matchedPaths.slice(0, MAX_AUTO_DIAGNOSTICS_FILES)) {
      if (budget.signal.aborted) break
      try {
        const queryResult = await raceSignal(ctx.lsp.query({
          operation: 'diagnostics',
          filePath,
          workspaceRoot,
        }, budget.signal), budget.signal)
        if (queryResult.kind !== 'diagnostics') continue
        const severe = queryResult.diagnostics.filter(d => d.severity === 'error' || d.severity === 'warning')
        if (severe.length === 0) continue
        diagnosticBlocks.push(formatDiagnostics(
          severe,
          queryResult.uri,
          queryResult.resolvedWorkspaceUri,
          resolved.maxLocations,
          maxDiagChars,
        ))
      } catch {
        // Auto-diagnostics are best-effort; silently ignore unavailable providers, timeouts, or server failures.
      }
    }

    if (diagnosticBlocks.length === 0) return decision
    const note = `LSP diagnostics:\n${diagnosticBlocks.join('\n')}`
    const baseContent = decision.content ?? result.content
    return {
      kind: 'accept',
      content: appendDiagnosticsContent(baseContent, note),
      ...decision.additionalContexts !== undefined ? { additionalContexts: decision.additionalContexts } : {},
    }
  })
}

/**
 * Race an async lookup/query against an AbortSignal so even a non-cooperative provider cannot
 * stall a completed edit tool past the short auto-diagnostics budget.
 */
function raceSignal<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    void work.catch(() => {
      // Absorb late rejections from abandoned best-effort lookups so they never trigger unhandledRejection.
    })
    return Promise.reject(signal.reason instanceof Error ? signal.reason : new Error('aborted'))
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      void work.catch(() => {
        // Absorb late rejections from abandoned best-effort lookups so they never trigger unhandledRejection.
      })
      reject(signal.reason instanceof Error ? signal.reason : new Error('aborted'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    work.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(error instanceof Error ? error : new Error(String(error)))
      },
    )
  })
}

/** Reject a non-positive-integer config value at load, so misconfiguration fails loud. */
function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`tool-lsp: ${name} must be a positive integer`)
  }
}

/** Reject a timer value Node would clamp instead of scheduling as configured. */
function assertTimer(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1 || value > MAX_TIMER_DELAY_MS) {
    throw new Error(`tool-lsp: ${name} must be a positive integer no greater than ${MAX_TIMER_DELAY_MS}`)
  }
}
