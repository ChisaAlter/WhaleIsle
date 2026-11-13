/**
 * Parse, validate, merge, and serialize the managed MCP server document.
 * @module @deepseek-ai/dsh-mcp-servers-file/document
 */

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import type { Config as McpClientConfig } from '@deepseek-ai/dsh-mcp-client'
import type {
  McpHttpServerRecord,
  McpReconnectRecord,
  McpServerRecord,
  McpServersDocument,
  McpServerUpsert,
  McpStdioServerRecord,
} from './types.ts'

/** Valid managed id and `serverName`. */
export const MCP_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/

/** Display stand-in for a secret that the UI must not echo back. */
export const SECRET_MASK = '********'

const SECRET_KEY = /(?:token|secret|password|authorization|credential|api[_-]?key|auth)$/i

/** Empty document used when the file is absent. */
export const EMPTY_DOCUMENT: McpServersDocument = Object.freeze({ servers: Object.freeze([]) })

/**
 * Return whether a record key names a secret that list views must mask.
 * @param key - env or header name.
 * @returns true when list views must mask this key.
 */
export function isSecretKey(key: string): boolean {
  return SECRET_KEY.test(key)
}

/**
 * Parse YAML text into a managed-server document.
 * @param text - file contents; empty or whitespace is an empty document.
 * @returns the validated document.
 * @throws when the YAML is not an object with a `servers` array, or a record is invalid.
 */
export function parseDocument(text: string): McpServersDocument {
  const trimmed = text.trim()
  if (trimmed.length === 0) return EMPTY_DOCUMENT
  const parsed: unknown = parseYaml(trimmed)
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('mcp-servers-file: document must be a YAML object')
  }
  const servers = (parsed as { servers?: unknown }).servers
  if (servers === undefined) return EMPTY_DOCUMENT
  if (!Array.isArray(servers)) {
    throw new Error('mcp-servers-file: servers must be an array')
  }
  const records = servers.map((entry, index) => parseRecord(entry, index))
  assertUniqueIds(records)
  return { servers: records }
}

/**
 * Serialize a document to YAML with a trailing newline.
 * @param document - validated records.
 * @returns YAML text ending in a newline.
 */
export function serializeDocument(document: McpServersDocument): string {
  return stringifyYaml({ servers: document.servers.map(plainRecord) }, { lineWidth: 0 }).replace(/\s*$/, '\n')
}

/**
 * Replace or append one record. A masked or blank secret keeps the previous
 * value. An omitted or empty env/headers map keeps previous secret keys and
 * drops non-secret keys. An explicit new map that omits a key deletes that key.
 * @param document - current document.
 * @param upsert - incoming record.
 * @returns the next document with the upserted record.
 */
export function upsertRecord(document: McpServersDocument, upsert: McpServerUpsert): McpServersDocument {
  const incoming = parseRecord(upsert, 0)
  const existing = document.servers.find(server => server.id === incoming.id)
  const merged = existing === undefined ? incoming : mergeSecrets(existing, incoming)
  const servers = existing === undefined
    ? [...document.servers, merged]
    : document.servers.map(server => server.id === incoming.id ? merged : server)
  assertUniqueServerNames(servers)
  return { servers }
}

/**
 * Remove one record by id.
 * @param document - current document.
 * @param id - record id.
 * @returns the next document.
 * @throws when the id is absent.
 */
export function removeRecord(document: McpServersDocument, id: string): McpServersDocument {
  if (!document.servers.some(server => server.id === id)) {
    throw new Error(`mcp-servers-file: server "${id}" is not in the managed document`)
  }
  return { servers: document.servers.filter(server => server.id !== id) }
}

/**
 * Flip `enabled` on one record.
 * @param document - current document.
 * @param id - record id.
 * @param enabled - next enablement.
 * @returns the next document with that record's enabled flag.
 */
export function setRecordEnabled(document: McpServersDocument, id: string, enabled: boolean): McpServersDocument {
  if (!document.servers.some(server => server.id === id)) {
    throw new Error(`mcp-servers-file: server "${id}" is not in the managed document`)
  }
  return {
    servers: document.servers.map(server => server.id === id ? { ...server, enabled } : server),
  }
}

/**
 * Mask secret env and header values for a list/read response.
 * @param record - stored record.
 * @returns the record with secret values replaced by the mask.
 */
export function maskRecordSecrets(record: McpServerRecord): McpServerRecord {
  if (record.transport === 'stdio') {
    const env = maskMap(record.env)
    return env === undefined ? record : { ...record, env }
  }
  const headers = maskMap(record.headers)
  return headers === undefined ? record : { ...record, headers }
}

/**
 * Project a managed record into the mcp-client Config the child plugin consumes.
 * @param record - enabled managed record.
 * @returns the mcp-client Config for that record.
 */
export function toClientConfig(record: McpServerRecord): McpClientConfig {
  if (record.transport === 'stdio') {
    return {
      transport: 'stdio',
      serverName: record.serverName,
      command: record.command,
      args: [...(record.args ?? [])],
      env: { ...(record.env ?? {}) },
      cwd: record.cwd ?? '',
      toolCallTimeoutMs: record.toolCallTimeoutMs ?? 60_000,
      failOnStartupError: record.failOnStartupError ?? false,
      closeTimeoutMs: 5000,
      expandTemplates: false,
      ...record.reconnect === undefined ? {} : { reconnect: { ...record.reconnect } },
    }
  }
  return {
    transport: 'streamable-http',
    serverName: record.serverName,
    url: record.url,
    headers: { ...(record.headers ?? {}) },
    toolCallTimeoutMs: record.toolCallTimeoutMs ?? 60_000,
    failOnStartupError: record.failOnStartupError ?? false,
      closeTimeoutMs: 5000,
      expandTemplates: false,
    ...record.reconnect === undefined ? {} : { reconnect: { ...record.reconnect } },
  }
}

function parseRecord(entry: unknown, index: number): McpServerRecord {
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new Error(`mcp-servers-file: servers[${String(index)}] must be an object`)
  }
  const raw = entry as Record<string, unknown>
  const id = requiredName(raw.id, `servers[${String(index)}].id`)
  const serverName = requiredName(raw.serverName ?? raw.id, `servers[${String(index)}].serverName`)
  const enabled = raw.enabled === undefined ? true : booleanField(raw.enabled, `servers[${String(index)}].enabled`)
  const transport = raw.transport
  const shared = {
    id,
    enabled,
    serverName,
    ...optionalNumber(raw, 'toolCallTimeoutMs', index),
    ...optionalBoolean(raw, 'failOnStartupError', index),
    ...optionalReconnect(raw.reconnect, index),
  }
  if (transport === 'stdio' || transport === undefined) {
    const command = requiredString(raw.command, `servers[${String(index)}].command`)
    return {
      ...shared,
      transport: 'stdio',
      command,
      ...optionalStringList(raw, 'args', index),
      ...optionalStringMap(raw, 'env', index),
      ...optionalStringField(raw, 'cwd', index),
    } satisfies McpStdioServerRecord
  }
  if (transport === 'streamable-http') {
    const url = requiredString(raw.url, `servers[${String(index)}].url`)
    return {
      ...shared,
      transport: 'streamable-http',
      url,
      ...optionalStringMap(raw, 'headers', index),
    } satisfies McpHttpServerRecord
  }
  throw new Error(`mcp-servers-file: servers[${String(index)}].transport must be "stdio" or "streamable-http"`)
}

function mergeSecrets(previous: McpServerRecord, next: McpServerRecord): McpServerRecord {
  if (next.transport === 'stdio' && previous.transport === 'stdio') {
    const env = mergeSecretMap(previous.env, next.env)
    return env === undefined ? next : { ...next, env }
  }
  if (next.transport === 'streamable-http' && previous.transport === 'streamable-http') {
    const headers = mergeSecretMap(previous.headers, next.headers)
    return headers === undefined ? next : { ...next, headers }
  }
  return next
}

function mergeSecretMap(
  previous: Readonly<Record<string, string>> | undefined,
  next: Readonly<Record<string, string>> | undefined,
): Readonly<Record<string, string>> | undefined {
  if (next === undefined || Object.keys(next).length === 0) {
    if (previous === undefined) return undefined
    const kept: Record<string, string> = {}
    for (const [key, value] of Object.entries(previous)) {
      if (isSecretKey(key)) kept[key] = value
    }
    return Object.keys(kept).length === 0 ? undefined : kept
  }
  const merged: Record<string, string> = {}
  for (const [key, value] of Object.entries(next)) {
    if ((value === '' || value === SECRET_MASK) && previous?.[key] !== undefined) {
      merged[key] = previous[key]
      continue
    }
    merged[key] = value
  }
  return merged
}

function maskMap(values: Readonly<Record<string, string>> | undefined): Readonly<Record<string, string>> | undefined {
  if (values === undefined) return undefined
  const masked: Record<string, string> = {}
  for (const [key, value] of Object.entries(values)) {
    masked[key] = isSecretKey(key) ? SECRET_MASK : value
  }
  return masked
}

function plainRecord(record: McpServerRecord): Record<string, unknown> {
  if (record.transport === 'stdio') {
    return {
      id: record.id,
      enabled: record.enabled,
      transport: 'stdio',
      serverName: record.serverName,
      command: record.command,
      ...record.args === undefined || record.args.length === 0 ? {} : { args: [...record.args] },
      ...record.env === undefined || Object.keys(record.env).length === 0 ? {} : { env: { ...record.env } },
      ...record.cwd === undefined || record.cwd === '' ? {} : { cwd: record.cwd },
      ...optionalPlainShared(record),
    }
  }
  return {
    id: record.id,
    enabled: record.enabled,
    transport: 'streamable-http',
    serverName: record.serverName,
    url: record.url,
    ...record.headers === undefined || Object.keys(record.headers).length === 0 ? {} : { headers: { ...record.headers } },
    ...optionalPlainShared(record),
  }
}

function optionalPlainShared(record: McpServerRecord): Record<string, unknown> {
  return {
    ...record.toolCallTimeoutMs === undefined ? {} : { toolCallTimeoutMs: record.toolCallTimeoutMs },
    ...record.failOnStartupError === undefined ? {} : { failOnStartupError: record.failOnStartupError },
    ...record.reconnect === undefined ? {} : { reconnect: { ...record.reconnect } },
  }
}

function requiredName(value: unknown, field: string): string {
  const text = requiredString(value, field)
  if (!MCP_NAME_PATTERN.test(text)) {
    throw new Error(`mcp-servers-file: ${field} must match ${MCP_NAME_PATTERN.source}`)
  }
  return text
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`mcp-servers-file: ${field} is required`)
  }
  return value
}

function booleanField(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`mcp-servers-file: ${field} must be a boolean`)
  return value
}

function optionalNumber(raw: Record<string, unknown>, key: string, index: number): { toolCallTimeoutMs: number } | object {
  const value = raw[key]
  if (value === undefined) return {}
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) {
    throw new Error(`mcp-servers-file: servers[${String(index)}].${key} must be a positive number`)
  }
  return { [key]: value }
}

function optionalBoolean(raw: Record<string, unknown>, key: string, index: number): Record<string, boolean> | object {
  const value = raw[key]
  if (value === undefined) return {}
  if (typeof value !== 'boolean') {
    throw new Error(`mcp-servers-file: servers[${String(index)}].${key} must be a boolean`)
  }
  return { [key]: value }
}

function optionalStringField(raw: Record<string, unknown>, key: string, index: number): Record<string, string> | object {
  const value = raw[key]
  if (value === undefined) return {}
  if (typeof value !== 'string') {
    throw new Error(`mcp-servers-file: servers[${String(index)}].${key} must be a string`)
  }
  return { [key]: value }
}

function optionalStringList(raw: Record<string, unknown>, key: string, index: number): Record<string, string[]> | object {
  const value = raw[key]
  if (value === undefined) return {}
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new Error(`mcp-servers-file: servers[${String(index)}].${key} must be a string array`)
  }
  return { [key]: value }
}

function optionalStringMap(raw: Record<string, unknown>, key: string, index: number): Record<string, Record<string, string>> | object {
  const value = raw[key]
  if (value === undefined) return {}
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`mcp-servers-file: servers[${String(index)}].${key} must be a string map`)
  }
  const map: Record<string, string> = {}
  for (const [entryKey, entryValue] of Object.entries(value)) {
    if (typeof entryValue !== 'string') {
      throw new Error(`mcp-servers-file: servers[${String(index)}].${key}.${entryKey} must be a string`)
    }
    map[entryKey] = entryValue
  }
  return { [key]: map }
}

function optionalReconnect(value: unknown, index: number): { reconnect: McpReconnectRecord } | object {
  if (value === undefined) return {}
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`mcp-servers-file: servers[${String(index)}].reconnect must be an object`)
  }
  const raw = value as Record<string, unknown>
  return {
    reconnect: {
      ...raw.enabled === undefined ? {} : { enabled: booleanField(raw.enabled, `servers[${String(index)}].reconnect.enabled`) },
      ...optionalReconnectNumber(raw, 'initialDelayMs', index),
      ...optionalReconnectNumber(raw, 'maxDelayMs', index),
      ...optionalReconnectNumber(raw, 'maxAttempts', index),
    },
  }
}

function optionalReconnectNumber(raw: Record<string, unknown>, key: string, index: number): Record<string, number> | object {
  const value = raw[key]
  if (value === undefined) return {}
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) {
    throw new Error(`mcp-servers-file: servers[${String(index)}].reconnect.${key} must be a positive number`)
  }
  return { [key]: value }
}

function assertUniqueIds(records: readonly McpServerRecord[]): void {
  const seen = new Set<string>()
  for (const record of records) {
    if (seen.has(record.id)) throw new Error(`mcp-servers-file: duplicate server id "${record.id}"`)
    seen.add(record.id)
  }
  assertUniqueServerNames(records)
}

function assertUniqueServerNames(records: readonly McpServerRecord[]): void {
  const seen = new Set<string>()
  for (const record of records) {
    if (seen.has(record.serverName)) {
      throw new Error(`mcp-servers-file: duplicate serverName "${record.serverName}"`)
    }
    seen.add(record.serverName)
  }
}
