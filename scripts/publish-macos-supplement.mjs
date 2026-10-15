#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { copyFile, lstat, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { cnbClient, supplementMacosMirror, validateMirrorAssets } from './sync-cnb.mjs'

const workflow = '.github/workflows/release-macos-diagnostic.yml'
const artifactName = 'Whale-Isle-macos-arm64'
const sourceArtifactName = 'Whale-Isle-macos-build-source'
const sourceFileName = 'macos-build-source.json'
const buildToolPaths = ['scripts/prepare-dsh-feedback-clients.mjs', 'scripts/plugin-build-esbuild.mjs']
const sumsName = 'SHA512SUMS.txt'

async function hash(file, algorithm = 'sha512') {
  const digest = createHash(algorithm)
  for await (const chunk of createReadStream(file)) digest.update(chunk)
  return digest.digest('hex')
}

function assetIdentity(asset) {
  return JSON.stringify([asset.id, asset.name, asset.size, asset.digest ?? null])
}

function releaseIdentity(release) {
  return JSON.stringify([release.id, release.tag_name, release.target_commitish,
    release.draft, release.prerelease, release.name, release.body])
}

function latestIdentity(release) {
  return JSON.stringify([release?.id, release?.tag_name])
}

function requireAssets(release, names, macosName) {
  if (!Array.isArray(release.assets) || ![names.length, names.length + 1].includes(release.assets.length) ||
      new Set(release.assets.map(asset => asset.name)).size !== release.assets.length ||
      names.some(name => !release.assets.some(asset => asset.name === name)) ||
      release.assets.some(asset => !names.includes(asset.name) && asset.name !== macosName) ||
      release.assets.some(asset => !Number.isSafeInteger(asset.id) || asset.id <= 0 ||
        !Number.isSafeInteger(asset.size) || asset.size < 0)) {
    throw new Error('Supplement requires exactly the existing Windows assets and optional matching macOS DMG')
  }
}

export function macosSupplementDecision({ repo, tag, run, release, tagSha, artifacts }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !/^v\d+\.\d+\.\d+$/.test(tag) || !/^[a-f0-9]{40}$/.test(tagSha)) {
    throw new Error('Supplement requires a repository, stable release tag and existing source commit')
  }
  if (!release?.id || release.tag_name !== tag || release.draft !== false || release.prerelease !== false ||
      release.target_commitish !== tagSha) throw new Error('Supplement requires the existing published release on its unchanged tag commit')
  if (run.status !== 'completed' || run.conclusion !== 'success' || run.event !== 'workflow_dispatch' ||
      run.path !== workflow || typeof run.head_branch !== 'string' || !run.head_branch || !/^[a-f0-9]{40}$/.test(run.head_sha) ||
      run.head_repository?.full_name !== repo) throw new Error('Supplement requires a successful same-repository manual macOS run')
  for (const name of [artifactName, sourceArtifactName]) {
    const candidates = artifacts.filter(artifact => artifact.name === name)
    if (candidates.length !== 1 || candidates[0].expired !== false) {
      throw new Error('Supplement requires one unexpired original artifact: ' + name)
    }
  }
  const version = tag.slice(1)
  return { macosName: 'Whale-Isle-' + version + '-mac-arm64.dmg',
    oldNames: ['Whale-Isle-Setup-' + version + '.exe', 'Whale-Isle-Setup-' + version + '.exe.blockmap', 'latest.yml', sumsName] }
}

export async function validateMacosBuildSource({ source, tag, tagSha, run, request, prefix }) {
  if (source?.schemaVersion !== 1 || source.sourceTag !== tag || source.sourceSha !== tagSha || source.toolingSha !== run.head_sha ||
      !Array.isArray(source.buildTools) || source.buildTools.length !== buildToolPaths.length ||
      new Set(source.buildTools.map(tool => tool?.path)).size !== buildToolPaths.length ||
      source.buildTools.some(tool => !buildToolPaths.includes(tool?.path) || !/^[a-f0-9]{64}$/.test(tool.sha256))) {
    throw new Error('macOS build source does not bind the release tag and exact build-only tooling')
  }
  const comparison = await request(prefix + '/compare/' + run.head_sha + '...main')
  if (!['ahead', 'identical'].includes(comparison.status)) throw new Error('macOS build tooling commit is not contained in main')
  for (const tool of source.buildTools) {
    const content = await request(prefix + '/contents/' + tool.path + '?ref=' + run.head_sha)
    if (content?.type !== 'file' || content.path !== tool.path || content.encoding !== 'base64' ||
        typeof content.content !== 'string' || !/^[A-Za-z0-9+/=\r\n]+$/.test(content.content)) {
      throw new Error('GitHub returned no source bytes for build tool: ' + tool.path)
    }
    const bytes = Buffer.from(content.content, 'base64')
    if (bytes.length !== content.size || createHash('sha256').update(bytes).digest('hex') !== tool.sha256) {
      throw new Error('macOS build tool hash does not match its tooling commit: ' + tool.path)
    }
  }
}

// Keep every existing checksum byte. A resumed run may already have appended
// this exact line while the following DMG upload was interrupted.
export function appendMacosChecksum(original, oldNames, macos) {
  const text = original.toString('utf8')
  if (!Buffer.from(text, 'utf8').equals(original)) throw new Error('Invalid UTF-8 checksum manifest')
  const rows = text.trimEnd().split(/\r?\n/)
  const entries = new Map()
  for (const row of rows) {
    const match = row.match(/^([a-f0-9]{128})  ([\w.-]+)$/)
    if (!match || entries.has(match[2])) throw new Error('Invalid or duplicate checksum manifest entry')
    entries.set(match[2], match[1])
  }
  const required = oldNames.filter(name => name !== sumsName)
  if (required.some(name => !entries.has(name)) || [...entries.keys()].some(name => !required.includes(name) && name !== macos.name)) {
    throw new Error('Checksum manifest does not contain the unchanged Windows asset set')
  }
  if (entries.has(macos.name)) {
    if (entries.get(macos.name) !== macos.sha512) throw new Error('Existing macOS checksum does not match the original artifact')
    return original
  }
  return Buffer.concat([original, Buffer.from((text.endsWith('\n') ? '' : '\n') + macos.sha512 + '  ' + macos.name + '\n')])
}

async function listArtifacts(request, prefix, runId) {
  const artifacts = []
  for (let page = 1; ; page += 1) {
    const response = await request(prefix + '/actions/runs/' + runId + '/artifacts?per_page=100&page=' + page)
    if (!Array.isArray(response.artifacts)) throw new Error('GitHub returned no workflow artifact list')
    artifacts.push(...response.artifacts)
    if (response.artifacts.length < 100) return artifacts
  }
}

async function readState(request, prefix, tag) {
  const [release, ref, latest] = await Promise.all([
    request(prefix + '/releases/tags/' + tag),
    request(prefix + '/git/ref/tags/' + tag),
    request(prefix + '/releases/latest'),
  ])
  if (ref?.ref !== 'refs/tags/' + tag) throw new Error('The published release tag does not exist')
  let object = ref.object
  while (object?.type === 'tag') {
    if (!/^[a-f0-9]{40}$/.test(object.sha)) throw new Error('Invalid annotated release tag')
    object = (await request(prefix + '/git/tags/' + object.sha)).object
  }
  if (object?.type !== 'commit' || !/^[a-f0-9]{40}$/.test(object.sha)) throw new Error('Release tag does not resolve to a source commit')
  return { release, sha: object.sha, tagObject: JSON.stringify(ref.object), latest }
}

function protectState(before, after, names, macosName, { checksumMayChange = false } = {}) {
  if (before.sha !== after.sha || before.tagObject !== after.tagObject || releaseIdentity(before.release) !== releaseIdentity(after.release) ||
      latestIdentity(before.latest) !== latestIdentity(after.latest)) throw new Error('Release, source tag or latest release changed during supplementation')
  requireAssets(after.release, names, macosName)
  for (const old of before.release.assets) {
    if (checksumMayChange && old.name === sumsName) continue
    const current = after.release.assets.find(asset => asset.name === old.name)
    if (!current || assetIdentity(old) !== assetIdentity(current)) throw new Error('Published asset changed: ' + old.name)
  }
}

export async function supplementMacosRelease({ repo, runId, tag, request, gh, mirrorRequest, mirrorRepo,
  fetchImpl = fetch, output = console.log, mirror = supplementMacosMirror }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !/^\d+$/.test(String(runId)) || !/^v\d+\.\d+\.\d+$/.test(tag)) {
    throw new Error('Repository, numeric macOS run ID and stable release tag are required')
  }
  if (!/^[\w.-]+(?:\/[\w.-]+)+$/.test(mirrorRepo) || typeof mirrorRequest !== 'function') {
    throw new Error('CNB mirror repository and authenticated client are required before supplementation')
  }
  const prefix = 'repos/' + repo
  const [before, run, artifacts] = await Promise.all([
    readState(request, prefix, tag), request(prefix + '/actions/runs/' + runId), listArtifacts(request, prefix, runId),
  ])
  const { macosName, oldNames } = macosSupplementDecision({ repo, tag, run, release: before.release, tagSha: before.sha, artifacts })
  requireAssets(before.release, oldNames, macosName)
  const directory = await mkdtemp(join(tmpdir(), 'whale-macos-supplement-'))
  try {
    const sourceDir = join(directory, 'build-source')
    await gh(['run', 'download', String(runId), '--repo', repo, '--name', sourceArtifactName, '--dir', sourceDir])
    const sourceNames = await readdir(sourceDir)
    const sourcePath = join(sourceDir, sourceFileName)
    const sourceInfo = sourceNames.length === 1 && sourceNames[0] === sourceFileName ? await lstat(sourcePath) : null
    if (!sourceInfo?.isFile() || sourceInfo.isSymbolicLink()) throw new Error('Build-source artifact must contain only macos-build-source.json')
    await validateMacosBuildSource({ source: JSON.parse(await readFile(sourcePath, 'utf8')), tag, tagSha: before.sha, run, request, prefix })
    const originalDir = join(directory, 'published')
    const macosDir = join(directory, 'original-macos')
    await gh(['release', 'download', tag, '--repo', repo, '--dir', originalDir])
    const downloaded = await readdir(originalDir)
    if (downloaded.length !== before.release.assets.length || downloaded.some(name => !before.release.assets.some(asset => asset.name === name))) {
      throw new Error('GitHub download did not contain the exact published asset set')
    }
    const oldFiles = await validateMirrorAssets(before.release, originalDir)
    await gh(['run', 'download', String(runId), '--repo', repo, '--name', artifactName, '--dir', macosDir])
    const macosNames = await readdir(macosDir)
    const macosPath = join(macosDir, macosName)
    if (macosNames.length !== 1 || macosNames[0] !== macosName || !(await lstat(macosPath)).isFile() || (await lstat(macosPath)).isSymbolicLink()) {
      throw new Error('Original macOS artifact must contain only the expected regular DMG file')
    }
    const macos = { name: macosName, size: (await lstat(macosPath)).size, sha512: await hash(macosPath) }
    if (macos.size === 0) throw new Error('Original macOS artifact contains an empty DMG')
    const existingMacos = oldFiles.find(file => file.name === macosName)
    if (existingMacos && (existingMacos.size !== macos.size || existingMacos.sha512 !== macos.sha512)) {
      throw new Error('Published macOS DMG does not match the original artifact; replacement is forbidden')
    }
    const oldSums = await readFile(join(originalDir, sumsName))
    const extendedSums = appendMacosChecksum(oldSums, oldNames, macos)
    const sumsPath = join(directory, sumsName)
    await writeFile(sumsPath, extendedSums)
    protectState(before, await readState(request, prefix, tag), oldNames, macosName)

    // The only replaceable public object is the checksum manifest. Publish it
    // first so a newly visible DMG always already has its checksum available.
    if (!oldSums.equals(extendedSums)) await gh(['release', 'upload', tag, sumsPath, '--repo', repo, '--clobber'])
    if (!existingMacos) await gh(['release', 'upload', tag, macosPath, '--repo', repo])

    const after = await readState(request, prefix, tag)
    protectState(before, after, oldNames, macosName, { checksumMayChange: !oldSums.equals(extendedSums) })
    if (!after.release.assets.some(asset => asset.name === macosName)) throw new Error('Supplemented release has no macOS DMG')
    const verifiedDir = join(directory, 'verified')
    await gh(['release', 'download', tag, '--repo', repo, '--pattern', sumsName, '--pattern', macosName, '--dir', verifiedDir])
    for (const name of oldNames.filter(name => name !== sumsName)) await copyFile(join(originalDir, name), join(verifiedDir, name))
    const finalFiles = await validateMirrorAssets(after.release, verifiedDir)
    if (!(await readFile(join(verifiedDir, sumsName))).equals(extendedSums) ||
        finalFiles.find(file => file.name === macosName)?.sha512 !== macos.sha512) {
      throw new Error('Published supplement bytes do not match the verified original assets')
    }
    const mirrored = await mirror({ release: after.release, directory: verifiedDir, sha: before.sha,
      request: mirrorRequest, fetchImpl, repo: mirrorRepo, expectedMacos: macos, output })
    output('Verified macOS supplement: ' + after.release.html_url)
    return { url: after.release.html_url, sha: before.sha, macos, mirror: mirrored }
  } finally { await rm(directory, { recursive: true, force: true }) }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const token = process.env.GH_TOKEN
    if (!token) throw new Error('GH_TOKEN is required')
    const mirrorRequest = cnbClient(process.env.CNB_TOKEN)
    const request = async (path) => {
      const response = await fetch('https://api.github.com/' + path, { signal: AbortSignal.timeout(30000),
        headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' } })
      if (!response.ok) throw new Error('GitHub GET ' + path + ': HTTP ' + response.status)
      return response.json()
    }
    await supplementMacosRelease({ repo: process.env.GITHUB_REPOSITORY, runId: process.env.MACOS_RUN_ID,
      tag: process.env.RELEASE_TAG, request, mirrorRequest, mirrorRepo: process.env.CNB_REPO,
      gh: args => execFileSync(process.env.GH_PATH || 'gh', args, { stdio: 'inherit' }) })
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
