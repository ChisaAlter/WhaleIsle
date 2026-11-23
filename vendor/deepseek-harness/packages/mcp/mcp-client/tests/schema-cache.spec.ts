import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  computeSchemaFingerprint,
  createMcpSchemaCache,
  hashServerIdentity,
  identityFromServerConfig,
  SCHEMA_CACHE_VERSION,
  schemaCacheFilePath,
  type McpListedTool,
} from '../src/schema-cache.ts'

describe('mcp-client schema-cache', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'dsh-mcp-schema-cache-'))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  const sampleTools: McpListedTool[] = [
    {
      name: 'search_docs',
      description: 'Search docs by keyword',
      inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    },
    {
      name: 'fetch_item',
      description: 'Fetch item by id',
      inputSchema: { type: 'object', properties: { id: { type: 'number' } } },
    },
  ]

  it('derives deterministic SHA-256 filenames and omits secrets from identity and payload', async () => {
    const secretEnvToken = 'sk-super-secret-env-value'
    const secretHeaderToken = 'Bearer super-secret-header-token'
    const stdioId = identityFromServerConfig({
      serverName: 'docs/server:prod',
      command: 'node',
      args: ['server.mjs'],
      cwd: '/workspace',
      env: { API_TOKEN: secretEnvToken },
    })
    const httpId = identityFromServerConfig({
      serverName: 'remote',
      url: 'https://example.test/mcp',
      headers: { Authorization: secretHeaderToken },
    })

    const stdioHash = hashServerIdentity(stdioId)
    expect(stdioHash).toMatch(/^[a-f0-9]{64}$/)
    const stdioSame = identityFromServerConfig({
      serverName: 'docs/server:prod',
      command: 'node',
      args: ['server.mjs'],
      cwd: '/workspace',
      env: { API_TOKEN: 'different-secret-should-not-affect-identity' },
    })
    expect(hashServerIdentity(stdioSame)).toBe(stdioHash)

    const filePath = schemaCacheFilePath(tempDir, stdioId)
    expect(filePath).toBe(join(tempDir, `mcp-schema-${stdioHash}.json`))

    const fp = computeSchemaFingerprint(stdioId)
    const cache = createMcpSchemaCache({ cacheDir: tempDir, identity: stdioId, fingerprint: fp, now: () => 1_000 })
    await cache.write(sampleTools)

    const raw = readFileSync(filePath, 'utf8')
    expect(raw).not.toContain(secretEnvToken)
    expect(raw).not.toContain(secretHeaderToken)
    expect(readdirSync(tempDir)).toEqual([`mcp-schema-${stdioHash}.json`])

    const httpRaw = JSON.stringify(httpId)
    expect(httpRaw).not.toContain(secretHeaderToken)
    expect(httpRaw).toContain('Authorization')
  })

  it('reads back valid cached schemas via atomic write and cleans up on clear()', async () => {
    const identity = identityFromServerConfig({ serverName: 'srv', command: 'echo' })
    const fingerprint = computeSchemaFingerprint(identity)
    let clock = 10_000
    const cache = createMcpSchemaCache({
      cacheDir: tempDir,
      identity,
      fingerprint,
      ttlMs: 60_000,
      now: () => clock,
    })

    expect(await cache.read()).toBeUndefined()

    await cache.write(sampleTools)
    // No stray .tmp files left behind.
    expect(readdirSync(tempDir)).toHaveLength(1)

    clock = 40_000
    expect(await cache.read()).toEqual(sampleTools)

    await cache.clear()
    expect(await cache.read()).toBeUndefined()
    expect(readdirSync(tempDir)).toHaveLength(0)
  })

  it('invalidates cache on TTL expiration and zero/negative TTL', async () => {
    const identity = identityFromServerConfig({ serverName: 'srv', command: 'echo' })
    const fingerprint = computeSchemaFingerprint(identity)
    let clock = 1_000
    const cache = createMcpSchemaCache({
      cacheDir: tempDir,
      identity,
      fingerprint,
      ttlMs: 5_000,
      now: () => clock,
    })

    await cache.write(sampleTools)
    clock = 5_999
    expect(await cache.read()).toEqual(sampleTools)

    clock = 6_000
    expect(await cache.read()).toBeUndefined()

    // Non-positive TTL always misses.
    const disabledCache = createMcpSchemaCache({
      cacheDir: tempDir,
      identity,
      fingerprint,
      ttlMs: 0,
      now: () => 1_500,
    })
    expect(await disabledCache.read()).toBeUndefined()
  })

  it('invalidates cache when server identity or metadata fingerprint changes', async () => {
    const identity = identityFromServerConfig({ serverName: 'srv', command: 'mcp-v1' })
    const fp1 = computeSchemaFingerprint(identity, { serverVersion: { name: 'srv', version: '1.0.0' } })
    const fp2 = computeSchemaFingerprint(identity, { serverVersion: { name: 'srv', version: '2.0.0' } })

    const writer = createMcpSchemaCache({
      cacheDir: tempDir,
      identity,
      fingerprint: fp1,
      now: () => 1_000,
    })
    await writer.write(sampleTools)

    const reader = createMcpSchemaCache({
      cacheDir: tempDir,
      identity,
      fingerprint: fp2,
      now: () => 1_500,
    })
    expect(await reader.read()).toBeUndefined()
  })

  it('falls back safely when cache file contains corrupt JSON, wrong version, or invalid tool entries', async () => {
    const warnings: string[] = []
    const identity = identityFromServerConfig({ serverName: 'corrupt', command: 'echo' })
    const fingerprint = computeSchemaFingerprint(identity)
    const cache = createMcpSchemaCache({
      cacheDir: tempDir,
      identity,
      fingerprint,
      now: () => 2_000,
      onWarn: (msg) => { warnings.push(msg) },
    })

    writeFileSync(cache.filePath, '{not-valid-json', 'utf8')
    expect(await cache.read()).toBeUndefined()

    writeFileSync(cache.filePath, JSON.stringify({
      version: SCHEMA_CACHE_VERSION + 1,
      fingerprint,
      cachedAt: 1_900,
      tools: sampleTools,
    }), 'utf8')
    expect(await cache.read()).toBeUndefined()

    writeFileSync(cache.filePath, JSON.stringify({
      version: SCHEMA_CACHE_VERSION,
      fingerprint,
      cachedAt: 1_900,
      tools: [{ name: '', inputSchema: { type: 'object' } }],
    }), 'utf8')
    expect(await cache.read()).toBeUndefined()

    writeFileSync(cache.filePath, JSON.stringify({
      version: SCHEMA_CACHE_VERSION,
      fingerprint,
      cachedAt: 'NaN',
      tools: sampleTools,
    }), 'utf8')
    expect(await cache.read()).toBeUndefined()

    expect(warnings.length).toBeGreaterThanOrEqual(3)
  })

  it('cleans up temporary file if rename/write fails', async () => {
    const identity = identityFromServerConfig({ serverName: 'fail-target', command: 'echo' })
    const fingerprint = computeSchemaFingerprint(identity)
    const cache = createMcpSchemaCache({ cacheDir: tempDir, identity, fingerprint })

    // Create a directory at the target filePath so rename(tmpFile, targetDir) fails cleanly on disk.
    mkdirSync(cache.filePath, { recursive: true })

    await expect(cache.write(sampleTools)).rejects.toThrow()
    expect(readdirSync(tempDir).filter(name => name.endsWith('.tmp'))).toEqual([])
  })
})
