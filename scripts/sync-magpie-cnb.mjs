#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { appendFile, readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { withOwnedTempDir } from '../src/shared/fs-safe.js'
import {
  MAX_BINARY_BYTES,
  cnbClient,
  downloadToFile,
  fetchWithRetry,
  uploadMirrorAsset,
  verifyDownload,
} from './lib/cnb-client.mjs'

const require = createRequire(import.meta.url)
const { PLATFORM_ASSETS } = require('../src/launcher/magpie/platform.js')
const { GITHUB_RELEASES, parseSha256Sums, resolveLatestMagpieRelease } = require('../src/launcher/magpie/release.js')

const SAFE_REPO = /^[\w.-]+(?:\/[\w.-]+)+$/
const VERSION_RE = /^\d+\.\d+\.\d+$/
const PRERELEASE_VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
const GITHUB_API_RELEASE_BASE = 'https://api.github.com/repos/yetone/magpie/releases/tags'
const EXPECTED_BINARIES = Object.values(PLATFORM_ASSETS)
const EXPECTED_NAMES = ['SHA256SUMS', ...EXPECTED_BINARIES]

/** @param {string} file @param {string} algorithm */
async function fileHash(file, algorithm) {
  const hash = createHash(algorithm)
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}

/** @param {string} version @param {string} directory @param {{ allowPrerelease?: boolean }} [options] */
export async function validateMagpieMirrorAssets(version, directory, { allowPrerelease = false } = {}) {
  const pattern = allowPrerelease ? PRERELEASE_VERSION_RE : VERSION_RE
  if (!pattern.test(version)) {
    throw new Error('Magpie mirror requires a valid X.Y.Z version')
  }
  const sumsFile = join(directory, 'SHA256SUMS')
  const sumsInfo = await stat(sumsFile)
  if (!sumsInfo.isFile() || sumsInfo.size <= 0 || sumsInfo.size > 1024 * 1024) {
    throw new Error('Invalid SHA256SUMS file size')
  }
  const sumsText = await readFile(sumsFile, 'utf8')
  const sums = parseSha256Sums(sumsText)
  const files = [{ file: sumsFile, name: 'SHA256SUMS', size: sumsInfo.size, sha512: await fileHash(sumsFile, 'sha512') }]
  for (const name of EXPECTED_BINARIES) {
    const expectedSha256 = sums.get(name)
    if (!expectedSha256) {
      throw new Error('SHA256SUMS missing binary entry: ' + name)
    }
    const file = join(directory, name)
    const info = await stat(file)
    if (!info.isFile() || info.size <= 0 || info.size > MAX_BINARY_BYTES) {
      throw new Error('Invalid Magpie binary size: ' + name)
    }
    if ((await fileHash(file, 'sha256')) !== expectedSha256) {
      throw new Error('Magpie binary SHA256 mismatch: ' + name)
    }
    files.push({ file, name, size: info.size, sha512: await fileHash(file, 'sha512') })
  }
  return files
}

/**
 * Inspect upstream GitHub release metadata for a manually pinned version so
 * draft/prerelease builds are never silently promoted as stable mirrors.
 * @param {string} targetVersion
 * @param {{ allowPrerelease: boolean, fetchImpl: typeof fetch, ghToken?: string, retryOptions?: Parameters<typeof fetchWithRetry>[2] }} options
 */
async function inspectManualUpstreamRelease(targetVersion, { allowPrerelease, fetchImpl, ghToken = '', retryOptions = {} }) {
  /** @type {Record<string, string>} */
  const headers = { Accept: 'application/vnd.github+json' }
  if (ghToken) headers.Authorization = 'Bearer ' + ghToken
  const resp = await fetchWithRetry(
    `${GITHUB_API_RELEASE_BASE}/v${encodeURIComponent(targetVersion)}`,
    () => ({ redirect: 'follow', headers, signal: AbortSignal.timeout(30_000) }),
    { ...retryOptions, fetchImpl },
  )
  if (!resp.ok) {
    await resp.body?.cancel?.().catch(() => { /* ignore unused error body */ })
    throw new Error(`Upstream Magpie release lookup failed for v${targetVersion}: HTTP ${resp.status}`)
  }
  const meta = await resp.json()
  if (meta?.draft === true) {
    throw new Error(`Refusing to mirror draft Magpie release: v${targetVersion}`)
  }
  const isPrerelease = meta?.prerelease === true || !VERSION_RE.test(targetVersion)
  if (isPrerelease && !allowPrerelease) {
    throw new Error(`Refusing to mirror prerelease Magpie release without ALLOW_PRERELEASE=1: v${targetVersion}`)
  }
  return { prerelease: isPrerelease }
}

/**
 * @param {{
 *   version?: string,
 *   directory: string,
 *   fetchImpl?: typeof fetch,
 *   allowPrerelease?: boolean,
 *   ghToken?: string,
 *   retryOptions?: Parameters<typeof fetchWithRetry>[2],
 * }} opts
 */
export async function downloadUpstreamMagpieAssets({
  version = '',
  directory,
  fetchImpl = fetch,
  allowPrerelease = false,
  ghToken = '',
  retryOptions = {},
}) {
  let targetVersion = String(version || '').trim().replace(/^v/i, '')
  let prerelease = false
  if (!targetVersion) {
    const latest = await resolveLatestMagpieRelease({ route: 'github', platform: 'win32', arch: 'x64', fetchImpl })
    targetVersion = latest.version
    if (!VERSION_RE.test(targetVersion)) {
      throw new Error('Invalid Magpie version: ' + targetVersion)
    }
  } else {
    const pattern = allowPrerelease ? PRERELEASE_VERSION_RE : VERSION_RE
    if (!pattern.test(targetVersion)) {
      throw new Error('Invalid Magpie version: ' + targetVersion)
    }
    const inspected = await inspectManualUpstreamRelease(targetVersion, { allowPrerelease, fetchImpl, ghToken, retryOptions })
    prerelease = inspected.prerelease
  }
  const baseUrl = `${GITHUB_RELEASES}/download/v${targetVersion}`
  for (const name of EXPECTED_NAMES) {
    const maxBytes = name === 'SHA256SUMS' ? 1024 * 1024 : MAX_BINARY_BYTES
    await downloadToFile({
      url: `${baseUrl}/${name}`,
      dest: join(directory, name),
      label: name,
      maxBytes,
      fetchImpl,
      retryOptions,
    })
  }
  const files = await validateMagpieMirrorAssets(targetVersion, directory, { allowPrerelease: prerelease || allowPrerelease })
  return { version: targetVersion, tag: 'magpie-v' + targetVersion, prerelease, files }
}

/**
 * @param {(path: string, opts?: { method?: string, body?: unknown }) => Promise<any>} request
 * @param {string} prefix
 * @param {{ tag_name: string, name: string, body: string }} releaseBody
 * @param {string} targetCommitish
 */
async function ensureMagpieCnbRelease(request, prefix, releaseBody, targetCommitish) {
  let target = await request(prefix + '/releases/tags/' + encodeURIComponent(releaseBody.tag_name))
  if (!target) {
    const created = await request(prefix + '/releases', {
      method: 'POST',
      body: { ...releaseBody, target_commitish: targetCommitish, draft: false, prerelease: true, make_latest: 'false' },
    })
    if (!created?.id) throw new Error('CNB Magpie release creation returned no ID')
    target = await request(prefix + '/releases/' + created.id)
  }
  if (!target?.id || !Array.isArray(target.assets)) {
    throw new Error('CNB Magpie release returned no ID or asset list')
  }
  return target
}

/**
 * @param {{
 *   file: { file: string, name: string, size: number, sha512: string },
 *   assets: any[],
 *   staged: boolean,
 *   targetId: string | number,
 *   prefix: string,
 *   request: (path: string, opts?: { method?: string, body?: unknown }) => Promise<any>,
 *   fetchImpl: typeof fetch,
 *   retryOptions: Parameters<typeof fetchWithRetry>[2],
 *   output: (line: string) => void,
 *   uploaded: string[],
 *   repaired: string[],
 * }} params
 */
async function syncMagpieAsset({ file, assets, staged, targetId, prefix, request, fetchImpl, retryOptions, output, uploaded, repaired }) {
  const existing = assets.filter((/** @type {any} */ a) => a.name === file.name)
  if (existing.length > 1) throw new Error('Duplicate CNB asset: ' + file.name)
  const asset = existing[0]
  if (!asset) {
    if (!staged) throw new Error('Published CNB Magpie release is incomplete: ' + file.name)
    output('Uploading ' + file.name)
    await uploadMirrorAsset({ file, overwrite: false, targetId, prefix, request, fetchImpl, retryOptions })
    uploaded.push(file.name)
    return
  }
  try {
    await verifyDownload(asset, file, fetchImpl, retryOptions)
  } catch (error) {
    if (!staged) throw error
    output(`Re-uploading damaged staged asset ${file.name}: ${error instanceof Error ? error.message : String(error)}`)
    await uploadMirrorAsset({ file, overwrite: true, targetId, prefix, request, fetchImpl, retryOptions })
    repaired.push(file.name)
  }
}

/**
 * @param {{
 *   version: string,
 *   directory: string,
 *   request: (path: string, opts?: { method?: string, body?: unknown }) => Promise<any>,
 *   fetchImpl?: typeof fetch,
 *   repo: string,
 *   targetCommitish?: string,
 *   prerelease?: boolean,
 *   retryOptions?: Parameters<typeof fetchWithRetry>[2],
 *   output?: (line: string) => void,
 * }} opts
 */
export async function mirrorMagpieRelease({
  version,
  directory,
  request,
  fetchImpl = fetch,
  repo,
  targetCommitish = 'main',
  prerelease = false,
  retryOptions = {},
  output = console.log,
}) {
  if (!SAFE_REPO.test(repo)) throw new Error('Valid CNB repository is required')
  const keepPrerelease = Boolean(prerelease)
  const files = await validateMagpieMirrorAssets(version, directory, { allowPrerelease: keepPrerelease })
  const tag = 'magpie-v' + version
  const prefix = '/' + repo + '/-'
  const body = {
    tag_name: tag,
    name: `Magpie CLI v${version}`,
    body: `Mirror of https://github.com/yetone/magpie/releases/tag/v${version}`,
  }
  const target = await ensureMagpieCnbRelease(request, prefix, body, targetCommitish)
  const staged = target.prerelease === true && target.draft !== true
  /** @type {string[]} */
  const uploaded = []
  /** @type {string[]} */
  const repaired = []
  for (const file of files) {
    await syncMagpieAsset({
      file,
      assets: target.assets,
      staged,
      targetId: target.id,
      prefix,
      request,
      fetchImpl,
      retryOptions,
      output,
      uploaded,
      repaired,
    })
  }
  if (staged && !keepPrerelease) {
    await request(prefix + '/releases/' + target.id, {
      method: 'PATCH',
      body: { name: body.name, body: body.body, draft: false, prerelease: false, make_latest: 'false' },
    })
  }
  const url = 'https://cnb.cool/' + repo + '/-/releases/tag/' + tag
  output('Verified Magpie CNB mirror: ' + url)
  return { url, tag, version, prerelease: keepPrerelease, assets: files.length, uploaded, repaired }
}

/**
 * Append a Markdown mirror summary to `$GITHUB_STEP_SUMMARY` when running in Actions.
 * @param {{ url: string, tag: string, version: string, prerelease?: boolean, assets: number, uploaded?: string[], repaired?: string[] }} summary
 * @param {string | undefined} [summaryFile]
 */
export async function writeMagpieMirrorSummary(summary, summaryFile = process.env.GITHUB_STEP_SUMMARY) {
  if (!summaryFile) return
  const lines = [
    '### Magpie CNB Mirror',
    '',
    `- **Version**: \`${summary.version}\` (\`${summary.tag}\`)`,
    `- **Channel**: ${summary.prerelease ? 'prerelease' : 'stable'}`,
    `- **CNB Release**: ${summary.url}`,
    `- **Assets Verified**: ${summary.assets}`,
    `- **Uploaded**: ${summary.uploaded?.length ? summary.uploaded.join(', ') : 'none (existing verified)'}`,
  ]
  if (summary.repaired?.length) {
    lines.push(`- **Repaired (overwrite)**: ${summary.repaired.join(', ')}`)
  }
  lines.push('')
  await appendFile(summaryFile, lines.join('\n'), 'utf8')
}

async function main() {
  const token = process.env.CNB_TOKEN || ''
  const repo = process.env.CNB_REPO || ''
  const version = process.env.MAGPIE_VERSION || ''
  const allowPrerelease = process.env.ALLOW_PRERELEASE === '1'
  const ghToken = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || ''
  const targetCommitish = process.env.CNB_TARGET_COMMITISH || 'main'
  const request = cnbClient(token)
  await withOwnedTempDir('magpie-cnb-', async (directory) => {
    const { version: resolvedVersion, prerelease } = await downloadUpstreamMagpieAssets({
      version,
      directory,
      allowPrerelease,
      ghToken,
    })
    const result = await mirrorMagpieRelease({
      version: resolvedVersion,
      directory,
      request,
      repo,
      targetCommitish,
      prerelease,
    })
    await writeMagpieMirrorSummary(result)
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1 })
}
