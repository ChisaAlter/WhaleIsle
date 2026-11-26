import { createHash } from 'node:crypto'
import { openAsBlob } from 'node:fs'
import { open, rm } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'

export const MAX_BINARY_BYTES = 200 * 1024 * 1024
export const RETRYABLE_HTTP_STATUSES = new Set([408, 429, 500, 502, 503, 504])

const DEFAULT_MAX_ATTEMPTS = 4
const DEFAULT_BASE_DELAY_MS = 200
const DEFAULT_MAX_DELAY_MS = 10_000
const DEFAULT_MAX_RETRY_AFTER_MS = 60_000

/**
 * Parse `Retry-After` header (integer seconds or HTTP-date) into clamped milliseconds.
 * @param {string | null | undefined} value
 * @param {number} [now]
 * @param {number} [maxDelayMs]
 * @returns {number | null}
 */
export function parseRetryAfter(value, now = Date.now(), maxDelayMs = DEFAULT_MAX_RETRY_AFTER_MS) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  if (/^\d+$/.test(trimmed)) {
    const ms = Number(trimmed) * 1000
    return Number.isFinite(ms) ? Math.min(maxDelayMs, Math.max(0, ms)) : null
  }
  const timestamp = Date.parse(trimmed)
  if (!Number.isFinite(timestamp)) return null
  return Math.min(maxDelayMs, Math.max(0, timestamp - now))
}

/**
 * @param {number} attempt
 * @param {string | null | undefined} retryAfterHeader
 * @param {{ baseDelayMs?: number, maxDelayMs?: number, maxRetryAfterMs?: number, now?: number }} [options]
 * @returns {number}
 */
export function computeRetryDelayMs(attempt, retryAfterHeader, options = {}) {
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS
  const maxRetryAfterMs = options.maxRetryAfterMs ?? DEFAULT_MAX_RETRY_AFTER_MS
  const parsed = parseRetryAfter(retryAfterHeader, options.now, maxRetryAfterMs)
  if (parsed !== null) return parsed
  return Math.min(maxDelayMs, baseDelayMs * (2 ** Math.max(0, attempt - 1)))
}

/**
 * @param {number} ms
 * @param {AbortSignal | undefined} signal
 * @returns {Promise<void>}
 */
function defaultSleep(ms, signal) {
  return ms <= 0 ? Promise.resolve() : delay(ms, undefined, signal ? { signal } : undefined)
}

/**
 * @param {string | URL} url
 * @param {RequestInit | (() => RequestInit | Promise<RequestInit>)} initOrFactory
 * @param {AbortSignal | undefined} outerSignal
 * @param {typeof fetch} fetchImpl
 */
async function executeAttempt(url, initOrFactory, outerSignal, fetchImpl) {
  const init = typeof initOrFactory === 'function' ? await initOrFactory() : initOrFactory
  const signal = outerSignal ?? init?.signal ?? undefined
  try {
    return { response: await fetchImpl(url, init), signal, error: null }
  } catch (error) {
    return { response: null, signal, error }
  }
}

/**
 * @param {Response | null} response
 * @param {number} attempt
 * @param {number} maxAttempts
 * @param {Parameters<typeof fetchWithRetry>[2]} options
 * @returns {Promise<number | null>}
 */
async function nextRetryDelayMs(response, attempt, maxAttempts, options) {
  if (attempt >= maxAttempts || !response || !RETRYABLE_HTTP_STATUSES.has(response.status)) {
    return null
  }
  const retryAfter = response.headers?.get?.('retry-after') ?? null
  await response.body?.cancel?.().catch(() => { /* ignore unused retry body */ })
  return computeRetryDelayMs(attempt, retryAfter, options)
}

/**
 * Execute `fetchImpl` with bounded exponential backoff on 408/429/5xx and transient throws.
 * @param {string | URL} url
 * @param {RequestInit | (() => RequestInit | Promise<RequestInit>)} [initOrFactory]
 * @param {{
 *   fetchImpl?: typeof fetch,
 *   maxAttempts?: number,
 *   baseDelayMs?: number,
 *   maxDelayMs?: number,
 *   maxRetryAfterMs?: number,
 *   signal?: AbortSignal,
 *   sleep?: (ms: number, signal?: AbortSignal) => Promise<void>,
 * }} [options]
 * @returns {Promise<Response>}
 */
export async function fetchWithRetry(url, initOrFactory = {}, options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch
  const maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS)
  const sleep = options.sleep ?? defaultSleep
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (options.signal?.aborted) throw options.signal.reason ?? new Error('Request aborted')
    const { response, signal, error } = await executeAttempt(url, initOrFactory, options.signal, fetchImpl)
    if (error) {
      if (signal?.aborted || attempt >= maxAttempts) throw error
      await sleep(computeRetryDelayMs(attempt, null, options), signal)
      continue
    }
    const waitMs = await nextRetryDelayMs(response, attempt, maxAttempts, options)
    if (waitMs !== null) {
      await sleep(waitMs, signal)
      continue
    }
    if (!response) throw new Error('Empty response')
    return response
  }
  throw new Error('Retry attempts exhausted')
}

/**
 * @param {import('node:fs/promises').FileHandle} handle
 * @param {Uint8Array} chunk
 */
async function writeAll(handle, chunk) {
  let offset = 0
  while (offset < chunk.byteLength) {
    const { bytesWritten } = await handle.write(chunk, offset, chunk.byteLength - offset)
    if (!bytesWritten) throw new Error('File write made no progress')
    offset += bytesWritten
  }
}

/**
 * @param {Response} response
 * @param {string} label
 * @param {number} maxBytes
 */
async function assertDownloadResponse(response, label, maxBytes) {
  if (!response.ok) {
    await response.body?.cancel?.().catch(() => { /* ignore unused error body */ })
    throw new Error(`Upstream download failed for ${label}: HTTP ${response.status}`)
  }
  const contentLengthHeader = response.headers?.get?.('content-length')
  if (!contentLengthHeader) return
  const declared = Number(contentLengthHeader)
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel?.().catch(() => { /* ignore oversized body */ })
    throw new Error(`Downloaded asset exceeds maxBytes (${maxBytes}): ${label}`)
  }
}

/**
 * @param {Response} response
 * @param {import('node:fs/promises').FileHandle} handle
 * @param {string} label
 * @param {number} maxBytes
 * @returns {Promise<number>}
 */
async function writeResponseToHandle(response, handle, label, maxBytes) {
  if (!response.body) {
    const buf = Buffer.from(await response.arrayBuffer())
    if (buf.byteLength > maxBytes) {
      throw new Error(`Downloaded asset exceeds maxBytes (${maxBytes}): ${label}`)
    }
    await writeAll(handle, buf)
    return buf.byteLength
  }
  let bytes = 0
  for await (const chunk of response.body) {
    bytes += chunk.byteLength
    if (bytes > maxBytes) {
      await response.body.cancel?.().catch(() => { /* ignore cancel error on overflow */ })
      throw new Error(`Downloaded asset exceeds maxBytes (${maxBytes}): ${label}`)
    }
    await writeAll(handle, chunk)
  }
  return bytes
}

/**
 * Stream an HTTP response directly to `dest`, enforcing `maxBytes` during transfer.
 * @param {{
 *   url: string | URL,
 *   dest: string,
 *   label?: string,
 *   maxBytes?: number,
 *   allowEmpty?: boolean,
 *   timeoutMs?: number,
 *   fetchImpl?: typeof fetch,
 *   retryOptions?: Parameters<typeof fetchWithRetry>[2],
 * }} options
 * @returns {Promise<{ bytes: number }>}
 */
export async function downloadToFile({
  url,
  dest,
  label = String(url),
  maxBytes = MAX_BINARY_BYTES,
  allowEmpty = false,
  timeoutMs = 10 * 60 * 1000,
  fetchImpl = fetch,
  retryOptions = {},
}) {
  const response = await fetchWithRetry(
    url,
    () => ({ redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) }),
    { ...retryOptions, fetchImpl },
  )
  await assertDownloadResponse(response, label, maxBytes)
  /** @type {import('node:fs/promises').FileHandle | undefined} */
  let handle
  try {
    handle = await open(dest, 'w')
    const bytes = await writeResponseToHandle(response, handle, label, maxBytes)
    await handle.close()
    handle = undefined
    if (!allowEmpty && bytes <= 0) {
      throw new Error(`Downloaded asset is empty: ${label}`)
    }
    return { bytes }
  } catch (error) {
    await handle?.close().catch(() => { /* ignore handle close failure */ })
    await rm(dest, { force: true }).catch(() => { /* ignore partial file cleanup failure */ })
    throw error
  }
}

/**
 * Create an authenticated CNB OpenAPI client with bounded retry on transient failures.
 * Never embeds credentials or signed URLs in thrown errors.
 * @param {string | undefined} token
 * @param {typeof fetch} [fetchImpl]
 * @param {Parameters<typeof fetchWithRetry>[2]} [retryOptions]
 */
export function cnbClient(token, fetchImpl = fetch, retryOptions = {}) {
  if (!token) throw new Error('CNB_TOKEN is required')
  /**
   * @param {string} path
   * @param {{ method?: string, body?: unknown }} [requestOptions]
   */
  return async (path, { method = 'GET', body } = {}) => {
    const url = new URL('https://api.cnb.cool' + path)
    /** @type {Record<string, string>} */
    const headers = { Accept: 'application/vnd.cnb.api+json', Authorization: 'Bearer ' + token }
    if (body) headers['Content-Type'] = 'application/json'
    const encodedBody = body ? JSON.stringify(body) : undefined
    let response
    try {
      response = await fetchWithRetry(
        url,
        () => ({
          method,
          redirect: 'error',
          signal: AbortSignal.timeout(30_000),
          headers,
          ...(encodedBody !== undefined ? { body: encodedBody } : {}),
        }),
        { ...retryOptions, fetchImpl },
      )
    } catch {
      throw new Error('CNB ' + method + ': request failed')
    }
    if (response.status === 404) return null
    if (!response.ok) throw new Error('CNB ' + method + ': HTTP ' + response.status)
    const text = await response.text()
    return text ? JSON.parse(text) : null
  }
}

/**
 * Verify a mirrored CNB release asset via anonymous streaming download and SHA-512 check.
 * @param {{ browser_download_url?: string } | null | undefined} asset
 * @param {{ name: string, size: number, sha512: string } | null | undefined} expected
 * @param {typeof fetch} [fetchImpl]
 * @param {Parameters<typeof fetchWithRetry>[2]} [retryOptions]
 */
export async function verifyDownload(asset, expected, fetchImpl = fetch, retryOptions = {}) {
  if (!expected?.name) {
    throw new Error('Expected CNB asset metadata is required')
  }
  const url = asset?.browser_download_url
  if (!url || new URL(url).protocol !== 'https:' || new URL(url).hostname !== 'cnb.cool') {
    throw new Error('CNB asset has no anonymous download URL: ' + expected.name)
  }
  const response = await fetchWithRetry(
    url,
    () => ({ signal: AbortSignal.timeout(30 * 60 * 1000) }),
    { ...retryOptions, fetchImpl },
  )
  if (!response.ok || !response.body) throw new Error('CNB asset download failed: ' + expected.name)
  const hash = createHash('sha512')
  let size = 0
  for await (const chunk of response.body) {
    size += chunk.byteLength
    if (size > expected.size) {
      await response.body.cancel?.().catch(() => { /* ignore cancel error on size mismatch */ })
      throw new Error('CNB asset size mismatch: ' + expected.name)
    }
    hash.update(chunk)
  }
  if (size !== expected.size || hash.digest('hex') !== expected.sha512) {
    throw new Error('CNB asset checksum mismatch: ' + expected.name)
  }
}

/**
 * Upload a release asset to CNB and verify the resulting anonymous download bytes.
 * @param {{
 *   file: { file: string, name: string, size: number, sha512: string },
 *   overwrite: boolean,
 *   targetId: string | number,
 *   prefix: string,
 *   request: (path: string, opts?: { method?: string, body?: unknown }) => Promise<any>,
 *   fetchImpl?: typeof fetch,
 *   retryOptions?: Parameters<typeof fetchWithRetry>[2],
 * }} options
 */
export async function uploadMirrorAsset({ file, overwrite, targetId, prefix, request, fetchImpl = fetch, retryOptions = {} }) {
  const upload = await request(prefix + '/releases/' + targetId + '/asset-upload-url', {
    method: 'POST', body: { asset_name: file.name, size: file.size, overwrite, ttl: 0 },
  })
  const destination = new URL(upload.upload_url)
  const confirmation = new URL(upload.verify_url, 'https://api.cnb.cool')
  if (destination.protocol !== 'https:' || confirmation.origin !== 'https://api.cnb.cool' ||
      !confirmation.pathname.startsWith(prefix + '/releases/' + targetId + '/asset-upload-confirmation/')) {
    throw new Error('CNB returned an invalid upload destination')
  }
  let response
  try {
    response = await fetchWithRetry(
      destination,
      async () => ({
        method: 'PUT',
        body: await openAsBlob(file.file),
        redirect: 'error',
        signal: AbortSignal.timeout(30 * 60 * 1000),
      }),
      { ...retryOptions, fetchImpl },
    )
  } catch {
    throw new Error('CNB asset upload failed: ' + file.name)
  }
  if (!response.ok) throw new Error('CNB asset upload failed: ' + file.name + ' (HTTP ' + response.status + ')')
  confirmation.searchParams.set('ttl', '0')
  await request(confirmation.pathname + confirmation.search, { method: 'POST' })
  const refreshed = await request(prefix + '/releases/' + targetId)
  const asset = refreshed?.assets?.find((/** @type {any} */ row) => row.name === file.name)
  await verifyDownload(asset, file, fetchImpl, retryOptions)
  return asset
}
