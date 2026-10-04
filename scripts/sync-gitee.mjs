#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, openAsBlob } from 'node:fs'
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { validateReleaseAssets } from './check-release-assets.mjs'

export const GITEE_REPO = 'ayase/Deepseek-Harness-Desktop'
const safeRepo = /^[\w.-]+\/[\w.-]+$/
const stableTag = /^v\d+\.\d+\.\d+$/
async function fileHash(file, algorithm = 'sha512') {
  const hash = createHash(algorithm)
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}

export function giteeClient(token, fetchImpl = fetch) {
  if (!token) throw new Error('GITEE_TOKEN is required')
  return async (path, { method = 'GET', body, file } = {}) => {
    const url = new URL('https://gitee.com/api/v5' + path)
    const options = { method, redirect: 'error', signal: AbortSignal.timeout(file ? 30 * 60 * 1000 : 30000) }
    if (file) {
      const form = new FormData()
      form.set('access_token', token)
      form.set('file', await openAsBlob(file), basename(file))
      options.body = form
    } else if (body) {
      options.headers = { 'Content-Type': 'application/json' }
      options.body = JSON.stringify({ ...body, access_token: token })
    } else {
      url.searchParams.set('access_token', token)
    }
    let response
    try { response = await fetchImpl(url, options) }
    catch { throw new Error('Gitee ' + method + ' ' + path.split('?')[0] + ': request failed') }
    if (response.status === 404) return null
    if (!response.ok) throw new Error('Gitee ' + method + ' ' + path.split('?')[0] + ': HTTP ' + response.status)
    return response.status === 204 ? null : response.json()
  }
}

async function verifyDownload(asset, expected, fetchImpl) {
  const url = asset?.browser_download_url
  if (!url || new URL(url).protocol !== 'https:' || new URL(url).hostname !== 'gitee.com') {
    throw new Error('Gitee asset has no anonymous download URL: ' + expected.name)
  }
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(30 * 60 * 1000) })
  if (!response.ok || !response.body) throw new Error('Gitee asset download failed: ' + expected.name)
  const hash = createHash('sha512')
  let size = 0
  for await (const chunk of response.body) {
    size += chunk.byteLength
    if (size > expected.size) throw new Error('Gitee asset size mismatch: ' + expected.name)
    hash.update(chunk)
  }
  if (size !== expected.size || hash.digest('hex') !== expected.sha512) {
    throw new Error('Gitee asset checksum mismatch: ' + expected.name)
  }
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
export async function mirrorRelease({ release, directory, sha, request, fetchImpl = fetch, repo = GITEE_REPO, output = console.log }) {
  if (!safeRepo.test(repo) || !/^[a-f0-9]{40}$/.test(sha)) throw new Error('Mirror repository and source commit are required')
  const files = await validateMirrorAssets(release, directory)
  const tag = release.tag_name
  const prefix = '/repos/' + repo
  let sourceTag
  for (let page = 1; ; page++) {
    const tags = await request(prefix + '/tags?per_page=100&page=' + page)
    if (!Array.isArray(tags)) throw new Error('Gitee tag list unavailable')
    sourceTag = tags.find(row => row.name === tag)
    if (sourceTag || tags.length < 100) break
  }
  if (sourceTag?.commit?.sha !== sha) throw new Error('Gitee tag does not match GitHub source: ' + tag)
  let target = await request(prefix + '/releases/tags/' + encodeURIComponent(tag))
  const body = { tag_name: tag, name: release.name || tag, body: release.body || ('GitHub release ' + tag) }
  if (!target) target = await request(prefix + '/releases', { method: 'POST', body: { ...body, target_commitish: sha, prerelease: true } })
  if (!target?.id) throw new Error('Gitee release creation returned no ID')
  const staged = target.prerelease === true
  const assets = []
  for (let page = 1; ; page++) {
    const rows = await request(prefix + '/releases/' + target.id + '/attach_files?per_page=100&page=' + page)
    if (!Array.isArray(rows)) throw new Error('Gitee attachment list unavailable')
    assets.push(...rows)
    if (rows.length < 100) break
  }
  for (const file of files) {
    const existing = assets.filter(a => a.name === file.name)
    if (existing.length > 1) throw new Error('Duplicate Gitee asset: ' + file.name)
    let asset = existing[0]
    if (!asset) {
      if (!staged) throw new Error('Published Gitee release is incomplete: ' + file.name)
      output('Uploading ' + file.name)
      asset = await request(prefix + '/releases/' + target.id + '/attach_files', { method: 'POST', file: file.file })
    }
    await verifyDownload(asset, file, fetchImpl)
  }
  if (staged) await request(prefix + '/releases/' + target.id, { method: 'PATCH', body: { ...body, prerelease: false } })
  const url = 'https://gitee.com/' + repo + '/releases/tag/' + tag
  output('Verified Gitee mirror: ' + url)
  return { url, assets: files.length }
}

export async function syncSource({ repo = GITEE_REPO, token, username, git = (args, options) => execFileSync('git', args, options) }) {
  if (!safeRepo.test(repo) || !token || !username) throw new Error('Gitee repository and push credentials are required')
  const directory = await mkdtemp(join(tmpdir(), 'gitee-auth-'))
  try {
    const askpass = join(directory, 'askpass.sh')
    await writeFile(askpass, '#!/bin/sh\ncase "$1" in\n  *Username*) printf "%s\\n" "$GITEE_USERNAME" ;;\n  *) printf "%s\\n" "$GITEE_TOKEN" ;;\nesac\n', { mode: 0o700 })
    git(['-c', 'credential.helper=', '-c', 'core.askPass=' + askpass, 'push', 'https://gitee.com/' + repo + '.git',
      'refs/remotes/origin/main:refs/heads/main', '--tags'], {
      env: { ...process.env, GITEE_TOKEN: token, GITEE_USERNAME: username, GIT_TERMINAL_PROMPT: '0' }, stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch { throw new Error('Gitee source push failed; check token permissions, repository limits and branch/tag divergence (no force push)') }
  finally { await rm(directory, { recursive: true, force: true }) }
}

async function main() {
  const token = process.env.GITEE_TOKEN
  const request = giteeClient(token)
  const user = await request('/user')
  await syncSource({ token, username: user?.login })
  console.log('Gitee main and tags synchronized')
  if (process.env.MIRROR_RELEASE !== '1') return
  const repo = process.env.GITHUB_REPOSITORY || 'ChisaAlter/WhaleIsle'
  if (!safeRepo.test(repo)) throw new Error('Invalid GitHub repository')
  const tag = process.env.RELEASE_TAG || ''
  if (tag && !stableTag.test(tag)) throw new Error('RELEASE_TAG must be a stable version tag')
  const gh = args => execFileSync(process.env.GH_PATH || 'gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  const release = JSON.parse(gh(['api', 'repos/' + repo + '/releases/' + (tag ? 'tags/' + tag : 'latest')]))
  if (!stableTag.test(release.tag_name) || release.draft || release.prerelease) throw new Error('Only stable published releases can be mirrored')
  const sha = execFileSync('git', ['rev-parse', 'refs/tags/' + release.tag_name + '^{commit}'], { encoding: 'utf8' }).trim()
  const directory = await mkdtemp(join(tmpdir(), 'gitee-release-'))
  try {
    gh(['release', 'download', release.tag_name, '--repo', repo, '--dir', directory])
    const downloaded = await readdir(directory)
    if (downloaded.length !== release.assets.length) throw new Error('GitHub download did not contain the expected release assets')
    await mirrorRelease({ release, directory, sha, request })
  } finally { await rm(directory, { recursive: true, force: true }) }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1 })
}
