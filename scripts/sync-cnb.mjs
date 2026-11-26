#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { withOwnedTempDir } from '../src/shared/fs-safe.js'
import { validateReleaseAssets } from './check-release-assets.mjs'
import { cnbClient, uploadMirrorAsset, verifyDownload } from './lib/cnb-client.mjs'

export { cnbClient, uploadMirrorAsset, verifyDownload }

const safeRepo = /^[\w.-]+(?:\/[\w.-]+)+$/
const stableTag = /^v\d+\.\d+\.\d+$/
const CNB_PAGE_SIZE = 100

/** @param {string} left @param {string} right */
function compareDesktopTags(left, right) {
  const a = left.slice(1).split('.').map(Number)
  const b = right.slice(1).split('.').map(Number)
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1
  }
  return 0
}

/**
 * Scan all published desktop `vX.Y.Z` releases on CNB instead of trusting
 * `/releases/latest` (which can point to `magpie-v*` or `android-v*`).
 * @param {(path: string, opts?: any) => Promise<any>} request
 * @param {string} prefix
 */
async function findHighestDesktopRelease(request, prefix) {
  let highest = null
  for (let page = 1; ; page += 1) {
    const releases = await request(`${prefix}/releases?page_size=${CNB_PAGE_SIZE}&page=${page}`)
    if (!Array.isArray(releases) || releases.length === 0) break
    for (const row of releases) {
      if (!row || row.draft || row.prerelease || !stableTag.test(row.tag_name || '')) continue
      if (!highest || compareDesktopTags(row.tag_name, highest.tag_name) > 0) highest = row
    }
    if (releases.length < CNB_PAGE_SIZE) break
  }
  return highest
}

async function fileHash(file, algorithm = 'sha512') {
  const hash = createHash(algorithm)
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}

export async function validateMirrorAssets(release, directory) {
  if (!stableTag.test(release.tag_name) || release.draft || release.prerelease) {
    throw new Error('Mirror requires a published stable GitHub release')
  }
  const tag = release.tag_name
  const names = release.assets.map(a => a.name)
  if (!names.length || new Set(names).size !== names.length || names.some(name => !/^[\w.-]+$/.test(name))) {
    throw new Error('Invalid GitHub release asset names')
  }
  const files = []
  for (const asset of release.assets) {
    const file = join(directory, asset.name)
    const info = await stat(file)
    if (!info.isFile() || info.size !== asset.size) throw new Error('GitHub asset size mismatch: ' + asset.name)
    if (asset.digest && (!/^sha256:[a-f0-9]{64}$/.test(asset.digest) || asset.digest !== 'sha256:' + await fileHash(file, 'sha256'))) {
      throw new Error('GitHub asset digest mismatch: ' + asset.name)
    }
    files.push({ file, name: asset.name, size: info.size, sha512: await fileHash(file) })
  }
  const version = tag.slice(1)
  const setup = join(directory, 'Whale-Isle-Setup-' + version + '.exe')
  await validateReleaseAssets({ assetDir: directory, releaseTag: tag, packageVersion: version, expectedSetupSha256: await fileHash(setup, 'sha256') })
  const sums = await readFile(join(directory, 'SHA512SUMS.txt'), 'utf8')
  const expectedSums = new Map(sums.trim().split(/\r?\n/).map(line => {
    const match = line.match(/^([a-f0-9]{128})  ([\w.-]+)$/)
    if (!match) throw new Error('Invalid GitHub SHA512SUMS.txt')
    return [match[2], match[1]]
  }))
  for (const file of files.filter(f => /\.(exe|blockmap|yml|dmg)$/.test(f.name))) {
    if (expectedSums.get(file.name) !== file.sha512) throw new Error('GitHub checksum manifest mismatch: ' + file.name)
  }
  return files
}

// Partial uploads remain prereleases. Reruns verify existing bytes and resume missing attachments.
export async function mirrorRelease({ release, directory, sha, request, fetchImpl = fetch, repo, output = console.log }) {
  if (!safeRepo.test(repo) || !/^[a-f0-9]{40}$/.test(sha)) throw new Error('Mirror repository and source commit are required')
  const files = await validateMirrorAssets(release, directory)
  const tag = release.tag_name
  const prefix = '/' + repo + '/-'
  const sourceTag = await request(prefix + '/git/tags/' + encodeURIComponent(tag))
  if (sourceTag?.commit?.sha !== sha) throw new Error('CNB tag does not match GitHub source: ' + tag)
  const highestDesktop = await findHighestDesktopRelease(request, prefix)
  let target = await request(prefix + '/releases/tags/' + encodeURIComponent(tag))
  const body = { tag_name: tag, name: release.name || tag, body: release.body || ('GitHub release ' + tag) }
  if (!target) {
    const created = await request(prefix + '/releases', { method: 'POST', body: { ...body, target_commitish: sha, draft: false, prerelease: true, make_latest: 'false' } })
    if (!created?.id) throw new Error('CNB release creation returned no ID')
    target = await request(prefix + '/releases/' + created.id)
  }
  if (!target?.id || !Array.isArray(target.assets)) throw new Error('CNB release returned no ID or asset list')
  const staged = target.prerelease === true && target.draft !== true
  const assets = target.assets
  for (const file of files) {
    const existing = assets.filter(a => a.name === file.name)
    if (existing.length > 1) throw new Error('Duplicate CNB asset: ' + file.name)
    const asset = existing[0]
    if (!asset) {
      if (!staged) throw new Error('Published CNB release is incomplete: ' + file.name)
      output('Uploading ' + file.name)
      await uploadMirrorAsset({ file, overwrite: false, targetId: target.id, prefix, request, fetchImpl })
    } else {
      await verifyDownload(asset, file, fetchImpl)
    }
  }
  if (staged) await request(prefix + '/releases/' + target.id, { method: 'PATCH', body: {
    name: body.name, body: body.body, draft: false, prerelease: false,
    make_latest: highestDesktop && compareDesktopTags(highestDesktop.tag_name, tag) > 0 ? 'false' : 'true',
  } })
  const url = 'https://cnb.cool/' + repo + '/-/releases/tag/' + tag
  output('Verified CNB mirror: ' + url)
  return { url, assets: files.length }
}

function checksumRows(bytes) {
  const rows = new Map()
  const lines = bytes.toString('utf8').split(/\r?\n/)
  if (lines.at(-1) === '') lines.pop()
  for (const line of lines) {
    const match = line.match(/^([a-f0-9]{128})  ([\w.-]+)$/)
    if (!match || rows.has(match[2])) throw new Error('Invalid or duplicate supplement checksum entry')
    rows.set(match[2], match[1])
  }
  return rows
}

// Explicit same-tag Mac supplementation; ordinary published mirrors remain immutable.
export async function supplementMacosMirror({ release, directory, sha, request, fetchImpl = fetch, repo, expectedMacos }) {
  if (!safeRepo.test(repo) || !/^[a-f0-9]{40}$/.test(sha) || !/^v\d+\.\d+\.\d+$/.test(release.tag_name) ||
      release.target_commitish !== sha) throw new Error('Mac supplement requires a stable release on the source commit')
  const tag = release.tag_name
  const version = tag.slice(1)
  const macName = 'Whale-Isle-' + version + '-mac-arm64.dmg'
  if (expectedMacos?.name !== macName || !Number.isSafeInteger(expectedMacos.size) || expectedMacos.size <= 0 ||
      !/^[a-f0-9]{128}$/.test(expectedMacos.sha512)) throw new Error('Verified source Mac artifact is required')
  const files = await validateMirrorAssets(release, directory)
  const windowsNames = ['Whale-Isle-Setup-' + version + '.exe', 'Whale-Isle-Setup-' + version + '.exe.blockmap', 'latest.yml']
  const names = [...windowsNames, 'SHA512SUMS.txt', macName]
  if (files.length !== names.length || files.some(file => !names.includes(file.name))) {
    throw new Error('Mac supplement has unexpected GitHub assets')
  }
  const mac = files.find(file => file.name === macName)
  if (mac.size !== expectedMacos.size || mac.sha512 !== expectedMacos.sha512) throw new Error('Mac source artifact mismatch')
  const sums = files.find(file => file.name === 'SHA512SUMS.txt')
  const newSums = await readFile(sums.file)
  const rows = checksumRows(newSums)
  if (rows.size !== 4 || [...windowsNames, macName].some(name => rows.get(name) !== files.find(file => file.name === name).sha512)) {
    throw new Error('Mac supplement checksum entries do not match the release')
  }
  const prefix = '/' + repo + '/-'
  const sourceTag = await request(prefix + '/git/tags/' + encodeURIComponent(tag))
  if (sourceTag?.commit?.sha !== sha) throw new Error('CNB tag does not match GitHub source: ' + tag)
  const target = await request(prefix + '/releases/tags/' + encodeURIComponent(tag))
  if (!target?.id || target.tag_name !== tag || target.draft !== false || target.prerelease !== false || !Array.isArray(target.assets)) {
    throw new Error('Mac supplement requires an existing published CNB release')
  }
  const oldAssets = new Map(target.assets.map(asset => [asset.name, { ...asset }]))
  if (oldAssets.size !== target.assets.length || [...oldAssets.keys()].some(name => !names.includes(name)) ||
      [...windowsNames, sums.name].some(name => !oldAssets.get(name)?.id)) throw new Error('Unexpected or missing existing CNB assets')
  const stateKeys = ['id', 'tag_name', 'name', 'body', 'draft', 'prerelease']
  const oldState = stateKeys.map(key => target[key])
  const latest = await request(prefix + '/releases/latest')
  const oldLatest = { id: latest?.id, tag: latest?.tag_name }
  for (const name of windowsNames) {
    const file = files.find(row => row.name === name)
    if (oldAssets.get(name).size !== file.size) throw new Error('Existing CNB asset size mismatch: ' + name)
    await verifyDownload(oldAssets.get(name), file, fetchImpl)
  }
  const oldMac = oldAssets.get(macName)
  if (oldMac) {
    if (!oldMac.id || oldMac.size !== mac.size) throw new Error('Existing CNB Mac asset size mismatch')
    await verifyDownload(oldMac, mac, fetchImpl)
  }
  const oldSumsAsset = oldAssets.get(sums.name)
  const oldSumsUrl = oldSumsAsset.browser_download_url
  if (!oldSumsUrl || new URL(oldSumsUrl).protocol !== 'https:' || new URL(oldSumsUrl).hostname !== 'cnb.cool' ||
      !Number.isSafeInteger(oldSumsAsset.size) || oldSumsAsset.size > newSums.length) throw new Error('Invalid existing CNB checksum asset')
  const response = await fetchImpl(oldSumsUrl, { signal: AbortSignal.timeout(30 * 60 * 1000) })
  if (!response.ok) throw new Error('CNB checksum download failed')
  const oldSums = Buffer.from(await response.arrayBuffer())
  if (oldSums.length !== oldSumsAsset.size) throw new Error('Existing CNB checksum size mismatch')
  const oldRows = checksumRows(oldSums)
  const sameSums = oldSums.equals(newSums)
  const macLine = Buffer.from(mac.sha512 + '  ' + macName + '\n')
  if (!sameSums && (oldRows.size !== 3 || windowsNames.some(name => oldRows.get(name) !== rows.get(name)) ||
      !Buffer.concat([oldSums, macLine]).equals(newSums))) throw new Error('CNB checksum change is not an append-only Mac supplement')

  const uploaded = []
  const verifiedIds = new Map([[sums.name, oldSumsAsset.id], [macName, oldMac?.id]])
  const supplementPairs = /** @type {Array<[{ file: string, name: string, size: number, sha512: string }, boolean]>} */ ([[sums, true], [mac, false]])
  for (const [file, overwrite] of supplementPairs) {
    if (file === sums ? sameSums : Boolean(oldMac)) continue
    const asset = await uploadMirrorAsset({ file, overwrite, targetId: target.id, prefix, request, fetchImpl })
    verifiedIds.set(file.name, asset.id)
    uploaded.push(file.name)
  }
  const final = await request(prefix + '/releases/' + target.id)
  if (!final || stateKeys.some((key, index) => final[key] !== oldState[index]) || !Array.isArray(final.assets) ||
      final.assets.length !== names.length || new Set(final.assets.map(asset => asset.name)).size !== names.length ||
      final.assets.some(asset => !names.includes(asset.name))) throw new Error('CNB release state changed during Mac supplement')
  for (const name of windowsNames) {
    const before = oldAssets.get(name)
    const after = final.assets.find(asset => asset.name === name)
    if (after?.id !== before.id || after.size !== before.size || after.digest !== before.digest) {
      throw new Error('Existing CNB asset changed during Mac supplement: ' + name)
    }
  }
  for (const file of [sums, mac]) {
    const asset = final.assets.find(row => row.name === file.name)
    if (!asset?.id || asset.id !== verifiedIds.get(file.name) || asset.size !== file.size) {
      throw new Error('CNB supplemental asset metadata mismatch: ' + file.name)
    }
  }
  const finalTag = await request(prefix + '/git/tags/' + encodeURIComponent(tag))
  const finalLatest = await request(prefix + '/releases/latest')
  if (finalTag?.commit?.sha !== sha || finalLatest?.id !== oldLatest.id || finalLatest?.tag_name !== oldLatest.tag) {
    throw new Error('CNB tag or latest changed during Mac supplement')
  }
  return { url: 'https://cnb.cool/' + repo + '/-/releases/tag/' + tag, assets: names.length, uploaded }
}

export async function syncSource({ repo, token, git = (args, options) => execFileSync('git', args, options) }) {
  if (!safeRepo.test(repo) || !token) throw new Error('CNB repository and push credentials are required')
  return withOwnedTempDir('cnb-auth-', async (directory) => {
    const askpass = join(directory, 'askpass.sh')
    try {
      await writeFile(askpass, '#!/bin/sh\ncase "$1" in\n  *Username*) printf "%s\\n" "cnb" ;;\n  *) printf "%s\\n" "$CNB_TOKEN" ;;\nesac\n', { mode: 0o700 })
      git(['-c', 'credential.helper=', '-c', 'core.askPass=' + askpass, 'push', 'https://cnb.cool/' + repo + '.git',
        'refs/remotes/origin/main:refs/heads/main', '--tags'], {
        env: { ...process.env, CNB_TOKEN: token, GIT_TERMINAL_PROMPT: '0' }, stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch { throw new Error('CNB source push failed; check token permissions, repository limits and branch/tag divergence (no force push)') }
  })
}

async function main() {
  const token = process.env.CNB_TOKEN
  const mirrorRepo = process.env.CNB_REPO
  const request = cnbClient(token)
  await syncSource({ token, repo: mirrorRepo })
  console.log('CNB main and tags synchronized')
  if (process.env.MIRROR_RELEASE !== '1') return
  const repo = process.env.GITHUB_REPOSITORY || 'ChisaAlter/WhaleIsle'
  if (!safeRepo.test(repo)) throw new Error('Invalid GitHub repository')
  const tag = process.env.RELEASE_TAG || ''
  if (tag && !stableTag.test(tag)) throw new Error('RELEASE_TAG must be a stable version tag')
  const gh = args => execFileSync(process.env.GH_PATH || 'gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  const release = JSON.parse(gh(['api', 'repos/' + repo + '/releases/' + (tag ? 'tags/' + tag : 'latest')]))
  if (!stableTag.test(release.tag_name) || release.draft || release.prerelease) throw new Error('Only stable published releases can be mirrored')
  const sha = execFileSync('git', ['rev-parse', 'refs/tags/' + release.tag_name + '^{commit}'], { encoding: 'utf8' }).trim()
  await withOwnedTempDir('cnb-release-', async (directory) => {
    gh(['release', 'download', release.tag_name, '--repo', repo, '--dir', directory])
    const downloaded = await readdir(directory)
    if (downloaded.length !== release.assets.length) throw new Error('GitHub download did not contain the expected release assets')
    await mirrorRelease({ release, directory, sha, request, repo: mirrorRepo })
  })
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1 })
}
