/**
 * Deferred MCP tool discovery and execution bridge.
 *
 * When a server exposes more tools than `inlineToolThreshold` under `'auto'`
 * discovery (or when `toolDiscoveryMode` is `'deferred'`), only two compact
 * server-namespaced meta-tools are registered on ToolRuntime:
 * - `mcp__<serverName>__search_tools`
 * - `mcp__<serverName>__call_tool`
 *
 * This keeps prompt token budgets bounded while preserving the 64-character
 * public naming contract, parameter validation, timeout, redaction,
 * cancellation, and canonical/structured/image result projection guarantees.
 *
 * @module
 */

import { isDeepStrictEqual } from 'node:util'
import type { Client } from '@modelcontextprotocol/client'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition, ToolExecution } from '@deepseek-ai/dsh-tools'
import { McpLocalError } from './diagnostic.ts'
import type { McpListedTool } from './schema-cache.ts'
import {
  callMcpRemoteTool,
  createMcpOutput,
  createProjectContent,
  createProjectionStore,
  executeAndProjectMcpCall,
  publicToolName,
  type ToolBridgeOptions,
} from './tools.ts'

/** Controls whether remote MCP tools are registered eagerly or behind meta-tools. */
export type ToolDiscoveryMode = 'eager' | 'deferred' | 'auto'

/** Default discovery mode: inline tools up to {@link DEFAULT_INLINE_TOOL_THRESHOLD}, then defer. */
export const DEFAULT_TOOL_DISCOVERY_MODE: ToolDiscoveryMode = 'auto'

/** Default maximum number of remote tools registered directly in `'auto'` mode. */
export const DEFAULT_INLINE_TOOL_THRESHOLD = 16

/** Default maximum matches returned by `mcp__<serverName>__search_tools`. */
export const DEFAULT_TOOL_SEARCH_LIMIT = 10

/** Hard upper bound on `mcp__<serverName>__search_tools` results per call. */
export const MAX_TOOL_SEARCH_LIMIT = 50

const MAX_VALIDATION_DEPTH = 32
const COMBINATOR_KEYS = ['allOf', 'anyOf', 'oneOf', '$ref', 'not'] as const

/** One matching remote tool returned by `mcp__<serverName>__search_tools`. */
export interface DeferredToolSearchMatch {
  readonly name: string
  readonly description: string
  readonly inputSchema: Record<string, unknown>
}

/** Structured result returned by `mcp__<serverName>__search_tools`. */
export interface DeferredToolSearchResult {
  readonly serverName: string
  readonly totalTools: number
  readonly matchedCount: number
  readonly tools: DeferredToolSearchMatch[]
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Resolve whether a tool list of `toolCount` items should register eagerly or
 * behind deferred `search_tools`/`call_tool` meta-tools.
 */
export function resolveToolDiscoveryStrategy(
  toolCount: number,
  mode: ToolDiscoveryMode = DEFAULT_TOOL_DISCOVERY_MODE,
  threshold: number = DEFAULT_INLINE_TOOL_THRESHOLD,
): 'eager' | 'deferred' {
  if (!Number.isInteger(threshold) || threshold < 0) {
    throw new McpLocalError(`mcp-client: inlineToolThreshold must be a non-negative integer (received ${String(threshold)})`)
  }
  if (mode === 'eager') return 'eager'
  if (mode === 'deferred') return 'deferred'
  return toolCount > threshold ? 'deferred' : 'eager'
}

/**
 * Filter and rank remote MCP tools by case-insensitive keyword tokens across
 * tool names and descriptions.
 */
export function searchDeferredTools(
  tools: readonly McpListedTool[],
  query?: string,
  limit: number = DEFAULT_TOOL_SEARCH_LIMIT,
): { matchedCount: number; tools: DeferredToolSearchMatch[] } {
  const effectiveLimit = Math.min(Math.max(1, limit), MAX_TOOL_SEARCH_LIMIT)
  const normalizedQuery = (query ?? '').trim().toLowerCase()

  if (normalizedQuery.length === 0) {
    return {
      matchedCount: tools.length,
      tools: tools.slice(0, effectiveLimit).map(toSearchMatch),
    }
  }

  const tokens = normalizedQuery.split(/\s+/).filter(token => token.length > 0)
  const ranked: Array<{ readonly rank: number; readonly index: number; readonly tool: McpListedTool }> = []

  for (const [index, tool] of tools.entries()) {
    const nameLower = tool.name.toLowerCase()
    const descLower = (tool.description ?? '').toLowerCase()
    const haystack = `${nameLower}\n${descLower}`
    if (!tokens.every(token => haystack.includes(token))) continue

    let rank = 4
    if (nameLower === normalizedQuery) rank = 0
    else if (nameLower.startsWith(normalizedQuery)) rank = 1
    else if (nameLower.includes(normalizedQuery)) rank = 2
    else if (tokens.every(token => nameLower.includes(token))) rank = 3

    ranked.push({ rank, index, tool })
  }

  ranked.sort((a, b) => (a.rank !== b.rank ? a.rank - b.rank : a.index - b.index))
  return {
    matchedCount: ranked.length,
    tools: ranked.slice(0, effectiveLimit).map(entry => toSearchMatch(entry.tool)),
  }
}

function toSearchMatch(tool: McpListedTool): DeferredToolSearchMatch {
  return {
    name: tool.name,
    description: tool.description ?? '',
    inputSchema: tool.inputSchema,
  }
}

function matchesSchemaType(expectedType: string, value: unknown): boolean {
  switch (expectedType) {
    case 'string':
      return typeof value === 'string'
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value)
    case 'boolean':
      return typeof value === 'boolean'
    case 'null':
      return value === null
    case 'array':
      return Array.isArray(value)
    case 'object':
      return isPlainObject(value)
    default:
      return true
  }
}

function validateSchemaNode(
  schema: Record<string, unknown>,
  value: unknown,
  path: string,
  violations: string[],
  depth: number,
): void {
  if (depth > MAX_VALIDATION_DEPTH) return

  const declaredType = schema['type']
  if (typeof declaredType === 'string') {
    if (!matchesSchemaType(declaredType, value)) {
      violations.push(`"${path}" must be of type ${declaredType}`)
      return
    }
  } else if (Array.isArray(declaredType)) {
    const stringTypes = declaredType.filter((item): item is string => typeof item === 'string')
    if (stringTypes.length > 0 && !stringTypes.some(item => matchesSchemaType(item, value))) {
      violations.push(`"${path}" must be one of types ${stringTypes.join(' | ')}`)
      return
    }
  }

  if (Object.hasOwn(schema, 'const') && !isDeepStrictEqual(value, schema['const'])) {
    violations.push(`"${path}" must equal ${JSON.stringify(schema['const'])}`)
    return
  }

  const allowedEnum = schema['enum']
  if (Array.isArray(allowedEnum) && !allowedEnum.some(candidate => isDeepStrictEqual(value, candidate))) {
    violations.push(`"${path}" must be one of ${JSON.stringify(allowedEnum)}`)
    return
  }

  if (isPlainObject(value)) {
    const required = schema['required']
    if (Array.isArray(required)) {
      for (const key of required) {
        if (typeof key !== 'string') continue
        if (!Object.hasOwn(value, key) || value[key] === undefined) {
          violations.push(`missing required property "${path}.${key}"`)
        }
      }
    }

    const properties = isPlainObject(schema['properties']) ? schema['properties'] : undefined
    if (properties !== undefined) {
      for (const [key, propSchema] of Object.entries(properties)) {
        if (!Object.hasOwn(value, key) || value[key] === undefined) continue
        if (isPlainObject(propSchema)) {
          validateSchemaNode(propSchema, value[key], `${path}.${key}`, violations, depth + 1)
        }
      }
    }

    const hasCombinators = COMBINATOR_KEYS.some(key => Object.hasOwn(schema, key))
    if (schema['additionalProperties'] === false && properties !== undefined && !hasCombinators) {
      for (const key of Object.keys(value)) {
        if (!Object.hasOwn(properties, key)) {
          violations.push(`"${path}.${key}" is not an allowed property (additionalProperties: false)`)
        }
      }
    }
    return
  }

  if (Array.isArray(value) && isPlainObject(schema['items'])) {
    const itemSchema = schema['items']
    for (const [index, entry] of value.entries()) {
      validateSchemaNode(itemSchema, entry, `${path}[${index}]`, violations, depth + 1)
    }
  }
}

/**
 * Validate caller-provided arguments for one remote MCP tool against its
 * advertised `inputSchema` before sending `tools/call` on the wire.
 */
export function validateRemoteToolArguments(
  toolName: string,
  inputSchema: unknown,
  args: Record<string, unknown>,
): void {
  if (!isPlainObject(inputSchema)) return
  const violations: string[] = []
  validateSchemaNode(inputSchema, args, 'arguments', violations, 0)
  if (violations.length > 0) {
    throw new Error(`Invalid arguments for MCP tool "${toolName}": ${violations.join('; ')}`)
  }
}

/**
 * Build the `mcp__<serverName>__search_tools` and `mcp__<serverName>__call_tool`
 * ToolRuntime definitions covering all discovered remote tools for one server.
 */
export function createDeferredToolDefinitions(
  ctx: Context,
  client: Client,
  opts: ToolBridgeOptions,
  tools: readonly McpListedTool[],
): ToolDefinition[] {
  const searchToolName = publicToolName(opts.serverName, 'search_tools')
  const callToolName = publicToolName(opts.serverName, 'call_tool')
  const toolsByRawName = new Map<string, McpListedTool>()
  for (const tool of tools) {
    toolsByRawName.set(tool.name, tool)
  }

  const searchDefinition: ToolDefinition = {
    name: searchToolName,
    description: `Search ${tools.length} tools exposed by MCP server "${opts.serverName}" by keyword to inspect names, descriptions, and input schemas before calling ${callToolName}.`,
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Optional keyword(s) matched case-insensitively against tool names and descriptions.',
        },
        limit: {
          type: 'integer',
          description: `Maximum tools to return (1-${MAX_TOOL_SEARCH_LIMIT}, default ${DEFAULT_TOOL_SEARCH_LIMIT}).`,
        },
      },
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          serverName: { type: 'string' },
          totalTools: { type: 'integer' },
          matchedCount: { type: 'integer' },
          tools: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                description: { type: 'string' },
                inputSchema: {},
              },
              required: ['name', 'description', 'inputSchema'],
              additionalProperties: false,
            },
          },
        },
        required: ['serverName', 'totalTools', 'matchedCount', 'tools'],
        additionalProperties: false,
      },
      render(_args: unknown, value) {
        return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
      },
    },
    execute(args: unknown): Promise<DeferredToolSearchResult> {
      const argsObj = args === undefined ? {} : args
      if (!isPlainObject(argsObj)) {
        throw new Error(`Invalid arguments for ${searchToolName}: expected a JSON object`)
      }
      const query = argsObj['query']
      if (query !== undefined && typeof query !== 'string') {
        throw new Error(`Invalid arguments for ${searchToolName}: "query" must be a string`)
      }
      const limit = argsObj['limit']
      if (limit !== undefined && (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1)) {
        throw new Error(`Invalid arguments for ${searchToolName}: "limit" must be a positive integer`)
      }
      const { matchedCount, tools: matches } = searchDeferredTools(tools, query, limit)
      return Promise.resolve({
        serverName: opts.serverName,
        totalTools: tools.length,
        matchedCount,
        tools: matches,
      })
    },
  }

  const projections = createProjectionStore()
  const callDefinition: ToolDefinition = {
    name: callToolName,
    description: `Invoke one remote tool on MCP server "${opts.serverName}" by raw tool name discovered via ${searchToolName}.`,
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: `Exact remote tool name from ${searchToolName}.`,
        },
        arguments: {
          type: 'object',
          description: 'JSON argument object matching the target tool inputSchema.',
          additionalProperties: true,
        },
      },
      required: ['name'],
      additionalProperties: false,
    },
    output: createMcpOutput(
      callToolName,
      undefined,
      (args: unknown) => (isPlainObject(args) && typeof args['name'] === 'string' && args['name'].length > 0
        ? args['name']
        : callToolName),
    ),
    async execute(args: unknown, exec: ToolExecution) {
      if (!isPlainObject(args)) {
        throw new Error(`Invalid arguments for ${callToolName}: expected a JSON object`)
      }
      const rawName = args['name']
      if (typeof rawName !== 'string' || rawName.length === 0) {
        throw new Error(`Invalid arguments for ${callToolName}: "name" must be a non-empty string`)
      }
      const targetTool = toolsByRawName.get(rawName)
      if (targetTool === undefined) {
        throw new Error(`Unknown tool "${rawName}" on MCP server "${opts.serverName}". Use ${searchToolName} to discover available tools.`)
      }
      if (targetTool.execution?.taskSupport === 'required') {
        throw new Error(`Tool "${targetTool.name}" requires task-based execution, which this bridge does not support`)
      }
      const rawArgs = args['arguments']
      if (rawArgs !== undefined && !isPlainObject(rawArgs)) {
        throw new Error(`Invalid arguments for MCP tool "${targetTool.name}": "arguments" must be a JSON object`)
      }
      const toolArgs = rawArgs ?? {}
      validateRemoteToolArguments(targetTool.name, targetTool.inputSchema, toolArgs)

      const rawResult = await callMcpRemoteTool(client, opts, targetTool, toolArgs, exec)
      return await executeAndProjectMcpCall(ctx, targetTool.name, rawResult, exec, projections)
    },
    projectContent: createProjectContent(projections),
  }

  return [searchDefinition, callDefinition]
}
