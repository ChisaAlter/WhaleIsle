/**
 * Optional on-disk MCP tool schema cache with atomic writes, TTL expiration,
 * config/server fingerprint validation, and safe fallback on corrupt cache files.
 *
 * Cache filenames are SHA-256 digests of non-secret server identity metadata so
 * credentials, environment values, and auth headers are never persisted or exposed
 * in filesystem paths.
 *
 * @module
 */

import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type { Client } from '@modelcontextprotocol/client'

/** One tool entry returned by MCP `tools/list`. */
export type McpToolList = Awaited<ReturnType<Client['listTools']>>['tools']

/** Single MCP tool descriptor returned by `tools/list`. */
export type McpListedTool = McpToolList[number]

/** On-disk cache format version. Bump when persisted structure changes incompatibly. */
export const SCHEMA_CACHE_VERSION = 1

/** Default schema cache time-to-live: 24 hours. */
export const DEFAULT_SCHEMA_CACHE_TTL_MS = 24 * 60 * 60 * 1000

/**
 * Non-secret transport identity of an MCP server used to derive deterministic
 * cache filenames and server identity fingerprints.
 */
export type SchemaCacheIdentity =
  | {
    readonly serverName: string
    readonly transport: 'stdio'
    readonly command: string
    readonly args?: readonly string[]
    readonly cwd?: string
    readonly envKeys?: readonly string[]
  }
  | {
    readonly serverName: string
    readonly transport: 'streamable-http'
    readonly url: string
    readonly headerKeys?: readonly string[]
  }

/** Options to create a server-scoped on-disk MCP schema cache. */
export interface SchemaCacheOptions {
  /** Directory storing cache files (`mcp-schema-<sha256>.json`). */
  readonly cacheDir: string
  /** Non-secret server identity used to name the cache file. */
  readonly identity: SchemaCacheIdentity | string
  /** Opaque fingerprint validating cached schemas against current config/server metadata. */
  readonly fingerprint: string
  /** Cache entry TTL in milliseconds. Values `<= 0` disable cache hits. */
  readonly ttlMs?: number
  /** Clock provider for deterministic testing. Defaults to `Date.now`. */
  readonly now?: () => number
  /** Optional warning sink when corrupt or unreadable cache data triggers fallback. */
  readonly onWarn?: (message: string) => void
}

/** Disk cache handle for reading, writing, and clearing one server's schemas. */
export interface McpSchemaCache {
  readonly filePath: string
  readonly fingerprint: string
  read(): Promise<McpListedTool[] | undefined>
  write(tools: readonly McpListedTool[]): Promise<void>
  clear(): Promise<void>
}

interface SchemaCachePayload {
  readonly version: number
  readonly fingerprint: string
  readonly cachedAt: number
  readonly tools: McpListedTool[]
}

function stableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(item => stableJsonValue(item))
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) {
      if (entry !== undefined) out[key] = stableJsonValue(entry)
    }
    return out
  }
  return value
}

function canonicalIdentityString(identity: SchemaCacheIdentity | string): string {
  if (typeof identity === 'string') return identity
  if (identity.transport === 'stdio') {
    return JSON.stringify(stableJsonValue({
      serverName: identity.serverName,
      transport: 'stdio',
      command: identity.command,
      args: identity.args ?? [],
      cwd: identity.cwd ?? '',
      envKeys: [...(identity.envKeys ?? [])].sort(),
    }))
  }
  return JSON.stringify(stableJsonValue({
    serverName: identity.serverName,
    transport: 'streamable-http',
    url: identity.url,
    headerKeys: [...(identity.headerKeys ?? [])].sort(),
  }))
}

/** Compute the SHA-256 hex digest identifying a server cache slot without exposing secrets. */
export function hashServerIdentity(identity: SchemaCacheIdentity | string): string {
  return createHash('sha256').update(canonicalIdentityString(identity)).digest('hex')
}

/** Compute the cache file path inside `cacheDir` for the given server identity. */
export function schemaCacheFilePath(cacheDir: string, identity: SchemaCacheIdentity | string): string {
  return join(cacheDir, `mcp-schema-${hashServerIdentity(identity)}.json`)
}

/** Compute a deterministic fingerprint combining server identity and optional server metadata. */
export function computeSchemaFingerprint(
  identity: SchemaCacheIdentity | string,
  extra?: {
    readonly serverVersion?: unknown
    readonly instructions?: string
  },
): string {
  return createHash('sha256')
    .update(JSON.stringify(stableJsonValue({
      identity: typeof identity === 'string' ? identity : canonicalIdentityString(identity),
      serverVersion: extra?.serverVersion ?? null,
      instructions: extra?.instructions ?? '',
    })))
    .digest('hex')
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isValidCachedTool(value: unknown): value is McpListedTool {
  if (!isPlainRecord(value)) return false
  if (typeof value['name'] !== 'string' || value['name'].length === 0) return false
  if (value['description'] !== undefined && typeof value['description'] !== 'string') return false
  if (!isPlainRecord(value['inputSchema'])) return false
  if (value['outputSchema'] !== undefined && !isPlainRecord(value['outputSchema'])) return false
  return true
}

function isErrnoCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code
}

/**
 * Extract non-secret server identity metadata from a resolved or unresolved MCP config object.
 * Only key names from `env` and `headers` are captured; secret values are intentionally excluded.
 */
export function identityFromServerConfig(config: {
  readonly serverName: string
  readonly command?: string
  readonly args?: readonly string[]
  readonly cwd?: string
  readonly env?: Readonly<Record<string, string>>
  readonly url?: string
  readonly headers?: Readonly<Record<string, string>>
}): SchemaCacheIdentity {
  if (config.command !== undefined) {
    return {
      serverName: config.serverName,
      transport: 'stdio',
      command: config.command,
      ...config.args !== undefined ? { args: config.args } : {},
      ...config.cwd !== undefined ? { cwd: config.cwd } : {},
      ...config.env !== undefined ? { envKeys: Object.keys(config.env).sort() } : {},
    }
  }
  return {
    serverName: config.serverName,
    transport: 'streamable-http',
    url: config.url ?? '',
    ...config.headers !== undefined ? { headerKeys: Object.keys(config.headers).sort() } : {},
  }
}

/**
 * Create an on-disk MCP tool schema cache instance for one server.
 */
export function createMcpSchemaCache(options: SchemaCacheOptions): McpSchemaCache {
  const filePath = schemaCacheFilePath(options.cacheDir, options.identity)
  const ttlMs = options.ttlMs ?? DEFAULT_SCHEMA_CACHE_TTL_MS
  const now = options.now ?? Date.now
  const warn = (reason: string): void => {
    options.onWarn?.(`mcp-client schema cache fallback (${filePath}): ${reason}`)
  }

  return {
    filePath,
    fingerprint: options.fingerprint,
    async read(): Promise<McpListedTool[] | undefined> {
      if (!Number.isFinite(ttlMs) || ttlMs <= 0) return undefined
      let rawText: string
      try {
        rawText = await readFile(filePath, 'utf8')
      } catch (error) {
        if (isErrnoCode(error, 'ENOENT')) return undefined
        warn(String(error))
        return undefined
      }

      let parsed: unknown
      try {
        parsed = JSON.parse(rawText)
      } catch (error) {
        warn(`invalid JSON (${String(error)})`)
        return undefined
      }

      if (!isPlainRecord(parsed)) {
        warn('cache root is not an object')
        return undefined
      }
      if (parsed['version'] !== SCHEMA_CACHE_VERSION) return undefined
      if (typeof parsed['fingerprint'] !== 'string' || parsed['fingerprint'] !== options.fingerprint) {
        return undefined
      }
      if (typeof parsed['cachedAt'] !== 'number' || !Number.isFinite(parsed['cachedAt'])) {
        warn('invalid cachedAt timestamp')
        return undefined
      }
      const ageMs = now() - parsed['cachedAt']
      if (ageMs < 0 || ageMs >= ttlMs) return undefined

      const toolsRaw = parsed['tools']
      if (!Array.isArray(toolsRaw)) {
        warn('tools field is not an array')
        return undefined
      }
      const tools: McpListedTool[] = []
      for (const item of toolsRaw) {
        if (!isValidCachedTool(item)) {
          warn('corrupt tool entry in schema cache')
          return undefined
        }
        tools.push(item)
      }
      return tools
    },

    async write(tools: readonly McpListedTool[]): Promise<void> {
      const dir = dirname(filePath)
      await mkdir(dir, { recursive: true })
      const tempPath = join(dir, `.${basename(filePath)}.${process.pid}.${randomUUID()}.tmp`)
      const payload: SchemaCachePayload = {
        version: SCHEMA_CACHE_VERSION,
        fingerprint: options.fingerprint,
        cachedAt: now(),
        tools: [...tools],
      }
      try {
        await writeFile(tempPath, JSON.stringify(payload), { encoding: 'utf8', mode: 0o600 })
        await rename(tempPath, filePath)
      } catch (error) {
        try {
          await unlink(tempPath)
        } catch {
          // Ignore temp-file cleanup failure so callers observe the primary write error.
        }
        throw error
      }
    },

    async clear(): Promise<void> {
      try {
        await unlink(filePath)
      } catch (error) {
        if (!isErrnoCode(error, 'ENOENT')) throw error
      }
    },
  }
}
