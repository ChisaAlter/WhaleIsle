#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { withOwnedTempDir } from '../src/shared/fs-safe.js'
import { cnbClient, uploadMirrorAsset, verifyDownload } from './sync-cnb.mjs'

const require = createRequire(import.meta.url)
const { MAX_BINARY_BYTES, PLATFORM_ASSETS } = require('../src/launcher/magpie/platform.js')
const { GITHUB_RELEASES, parseSha256Sums, resolveLatestMagpieRelease } = require('../src/launcher/magpie/release.js')

const SAFE_REPO = /^[\w.-]+(?:\/[\w.-]+)+$/
const VERSION_RE = /^\d+\.\d+\.\d+$/
const EXPECTED_BINARIES = Object.values(PLATFORM_ASSETS)
const EXPECTED_NAMES = ['SHA256SUMS', ...EXPECTED_BINARIES]

/** @param {string} file @param {string} algorithm */
async function fileHash(file, algorithm) {
  const hash = createHash(algorithm)
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}

/** @param {string} version @param {string} directory */
export async function validateMagpieMirrorAssets(version, directory) {
  if (!VERSION_RE.test(version)) {
    throw new Error('Magpie mirror requires a stable X.Y.Z version')
  }
  const sumsFile = join(directory, 'SHA256SUMS')
  const sumsText = await readFile(sumsFile, 'utf8')
  const sums = parseSha256Sums(sumsText)
  const sumsInfo = await stat(sumsFile)
  if (!sumsInfo.isFile() || sumsInfo.size <= 0 || sumsInfo.size > 1024 * 1024) {
    throw new Error('Invalid SHA256SUMS file size')
  }
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

/** @param {{ version?: string, directory: string, fetchImpl?: typeof fetch }} opts */
export async function downloadUpstreamMagpieAssets({ version = '', directory, fetchImpl = fetch }) {
  let targetVersion = String(version || '').trim().replace(/^v/i, '')
  if (!targetVersion) {
    const latest = await resolveLatestMagpieRelease({ route: 'github', platform: 'win32', arch: 'x64', fetchImpl })
    targetVersion = latest.version
  }
  if (!VERSION_RE.test(targetVersion)) {
    throw new Error('Invalid Magpie version: ' + targetVersion)
  }
  const baseUrl = `${GITHUB_RELEASES}/download/v${targetVersion}`
  for (const name of EXPECTED_NAMES) {
    const response = await fetchImpl(`${baseUrl}/${name}`, { redirect: 'follow', signal: AbortSignal.timeout(10 * 60 * 1000) })
    if (!response.ok) {
      throw new Error(`Upstream download failed for ${name}: HTTP ${response.status}`)
    }
    const buf = Buffer.from(await response.arrayBuffer())
    if (name !== 'SHA256SUMS' && (buf.length <= 0 || buf.length > MAX_BINARY_BYTES)) {
      throw new Error('Downloaded Magpie asset exceeds MAX_BINARY_BYTES: ' + name)
    }
    await writeFile(join(directory, name), buf)
  }
  return { version: targetVersion, tag: 'magpie-v' + targetVersion, files: await validateMagpieMirrorAssets(targetVersion, directory) }
}

/** @param {{ version: string, directory: string, request: Function, fetchImpl?: typeof fetch, repo: string, targetCommitish?: string, output?: Function }} opts */
export async function mirrorMagpieRelease({ version, directory, request, fetchImpl = fetch, repo, targetCommitish = 'main', output = console.log }) {
  if (!SAFE_REPO.test(repo)) throw new Error('Valid CNB repository is required')
  const files = await validateMagpieMirrorAssets(version, directory)
  const tag = 'magpie-v' + version
  const prefix = '/' + repo + '/-'
  let target = await request(prefix + '/releases/tags/' + encodeURIComponent(tag))
  const body = {
    tag_name: tag,
    name: `Magpie CLI v${version}`,
    body: `Mirror of https://github.com/yetone/magpie/releases/tag/v${version}`,
  }
  if (!target) {
    const created = await request(prefix + '/releases', {
      method: 'POST',
      body: { ...body, target_commitish: targetCommitish, draft: false, prerelease: true, make_latest: 'false' },
    })
    if (!created?.id) throw new Error('CNB Magpie release creation returned no ID')
    target = await request(prefix + '/releases/' + created.id)
  }
  if (!target?.id || !Array.isArray(target.assets)) throw new Error('CNB Magpie release returned no ID or asset list')
  const staged = target.prerelease === true && target.draft !== true
  const assets = target.assets
  for (const file of files) {
    const existing = assets.filter((/** @type {any} */ a) => a.name === file.name)
    if (existing.length > 1) throw new Error('Duplicate CNB asset: ' + file.name)
    const asset = existing[0]
    if (!asset) {
      if (!staged) throw new Error('Published CNB Magpie release is incomplete: ' + file.name)
      output('Uploading ' + file.name)
      await uploadMirrorAsset({ file, overwrite: false, targetId: target.id, prefix, request, fetchImpl })
    } else {
      await verifyDownload(asset, file, fetchImpl)
    }
  }
  if (staged) {
    await request(prefix + '/releases/' + target.id, {
      method: 'PATCH',
      body: { name: body.name, body: body.body, draft: false, prerelease: false, make_latest: 'false' },
    })
  }
  const url = 'https://cnb.cool/' + repo + '/-/releases/tag/' + tag
  output('Verified Magpie CNB mirror: ' + url)
  return { url, tag, version, assets: files.length }
}

async function main() {
  const token = process.env.CNB_TOKEN || ''
  const repo = process.env.CNB_REPO || ''
  const version = process.env.MAGPIE_VERSION || ''
  const targetCommitish = process.env.CNB_TARGET_COMMITISH || 'main'
  const request = cnbClient(token)
  await withOwnedTempDir('magpie-cnb-', async (directory) => {
    const { version: resolvedVersion } = await downloadUpstreamMagpieAssets({ version, directory })
    await mirrorMagpieRelease({ version: resolvedVersion, directory, request, repo, targetCommitish })
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1 })
}
