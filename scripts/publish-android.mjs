#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, mkdtemp, open, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { cnbClient, uploadMirrorAsset, verifyDownload } from './sync-cnb.mjs'

const metadataName = 'android-release.json'
const sumsName = 'SHA512SUMS.txt'
const stableVersion = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/
const sourceSha = /^[a-f0-9]{40}$/
const safeRepo = /^[\w.-]+(?:\/[\w.-]+)+$/
const fingerprint = /^[a-f0-9]{64}$/

function validVersion(version) {
  return typeof version === 'string' && stableVersion.test(version) && version.split('.').every(part => Number.isSafeInteger(Number(part)))
}

async function hashes(file) {
  const sha256 = createHash('sha256')
  const sha512 = createHash('sha512')
  for await (const chunk of createReadStream(file)) { sha256.update(chunk); sha512.update(chunk) }
  return { sha256: sha256.digest('hex'), sha512: sha512.digest('hex') }
}

async function regularFile(file) {
  const info = await lstat(file)
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('Android asset must be a regular file: ' + file)
  return info
}

function exactKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
}

// apksigner verifies the APK during the build. This binds those build results to
// the exact bytes being published; it does not replace signature verification.
export async function validateAndroidAssets({ assetDir, version, sha, expectedCertificateSha256,
  expectedVersionCode = version === '0.3.10' ? 4 : undefined }) {
  const certificate = typeof expectedCertificateSha256 === 'string' ? expectedCertificateSha256.trim().replaceAll(':', '').toLowerCase() : ''
  if (!validVersion(version) || !sourceSha.test(sha) || !fingerprint.test(certificate)) {
    throw new Error('Android stable version, source SHA and ANDROID_SIGNING_CERT_SHA256 are required')
  }
  if (typeof assetDir !== 'string' || !assetDir) throw new Error('ANDROID_ASSET_DIR is required')
  const directory = resolve(assetDir)
  const info = await lstat(directory)
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Android asset directory must be a regular directory')
  const apkName = 'Whale-Isle-' + version + '-android.apk'
  const names = await readdir(directory)
  if (![2, 3].includes(names.length) || !names.includes(apkName) || !names.includes(metadataName) ||
      names.some(name => ![apkName, metadataName, sumsName].includes(name))) {
    throw new Error('Android asset directory must contain only the versioned APK, android-release.json and optional SHA512SUMS.txt')
  }
  const apkPath = join(directory, apkName)
  const metadataPath = join(directory, metadataName)
  const apkInfo = await regularFile(apkPath)
  const metadataInfo = await regularFile(metadataPath)
  if (!Number.isSafeInteger(apkInfo.size) || apkInfo.size <= 4 || metadataInfo.size <= 0 || metadataInfo.size > 1024 * 1024) {
    throw new Error('Invalid Android APK or metadata size')
  }
  const apk = await open(apkPath, 'r')
  try {
    const magic = Buffer.alloc(4)
    const { bytesRead } = await apk.read(magic, 0, 4, 0)
    if (bytesRead !== 4 || !magic.equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) throw new Error('Android APK has no ZIP local-file magic')
  } finally { await apk.close() }
  let metadata
  try { metadata = JSON.parse(await readFile(metadataPath, 'utf8')) }
  catch { throw new Error('Invalid android-release.json JSON') }
  if (!exactKeys(metadata, ['schemaVersion', 'version', 'versionCode', 'applicationId', 'minSdk', 'targetSdk', 'sourceSha', 'apk', 'checks']) ||
      metadata.schemaVersion !== 1 || metadata.version !== version || metadata.sourceSha !== sha ||
      metadata.applicationId !== 'ai.deepseek.harness.mobile' || metadata.minSdk !== 26 || metadata.targetSdk !== 36 ||
      !Number.isSafeInteger(metadata.versionCode) || metadata.versionCode <= 0 || metadata.versionCode > 2100000000 ||
      (expectedVersionCode !== undefined && metadata.versionCode !== expectedVersionCode) ||
      !exactKeys(metadata.apk, ['name', 'size', 'sha256', 'sha512', 'signingCertificateSha256']) ||
      metadata.apk.name !== apkName || metadata.apk.size !== apkInfo.size ||
      !fingerprint.test(metadata.apk.sha256) || !/^[a-f0-9]{128}$/.test(metadata.apk.sha512) ||
      !fingerprint.test(metadata.apk.signingCertificateSha256) || metadata.apk.signingCertificateSha256 !== certificate ||
      !exactKeys(metadata.checks, ['jvm', 'lint', 'emulator']) ||
      ['jvm', 'lint', 'emulator'].some(check => metadata.checks[check] !== 'passed')) {
    throw new Error('Android metadata schema, version, versionCode, source, certificate or build checks mismatch')
  }
  const apkHashes = await hashes(apkPath)
  if (metadata.apk.sha256 !== apkHashes.sha256 || metadata.apk.sha512 !== apkHashes.sha512) throw new Error('Android APK checksum mismatch')
  const files = [
    { file: apkPath, name: apkName, size: apkInfo.size, ...apkHashes },
    { file: metadataPath, name: metadataName, size: metadataInfo.size, ...await hashes(metadataPath) },
  ]
  const sums = Buffer.from(files.map(file => file.sha512 + '  ' + file.name).join('\n') + '\n')
  const sumsPath = join(directory, sumsName)
  if (names.includes(sumsName)) {
    await regularFile(sumsPath)
    if (!(await readFile(sumsPath)).equals(sums)) throw new Error('Existing Android SHA512SUMS.txt conflicts with the build artifacts')
  } else await writeFile(sumsPath, sums, { flag: 'wx' })
  files.push({ file: sumsPath, name: sumsName, size: sums.length, ...await hashes(sumsPath) })
  return { metadata, files }
}

export function androidReleaseBody(version) {
  return `# 鲸屿 Android ${version}\n\n` +
    `- 支持 Android 8.0 及以上（API 26+）。\n` +
    `- 安装 APK 后，扫描鲸屿 v${version} 桌面端提供的连接二维码。手机端是桌面的移动客户端，AI 会话与工具任务由连接的桌面端运行。\n` +
    `- 本次构建通过 JVM 测试、Android Lint 与模拟器检查；尚无物理 Android 设备扫码连接桌面并完成 AI 会话的全链路验证证据。\n` +
    `- APK 与构建记录的 SHA-512 校验值见 SHA512SUMS.txt。\n\n` +
    `<details>\n<summary>English</summary>\n\n` +
    `Whale Isle Android ${version} requires Android 8.0 or newer (API 26+).\n\n` +
    `Install the APK and scan the connection QR code shown by Whale Isle desktop v${version}. This is a mobile client for the connected desktop, which runs the AI sessions and tools.\n\n` +
    `JVM tests, Android Lint and emulator checks passed. There is no physical-device end-to-end evidence yet for scanning the desktop QR code and completing an AI session.\n\n` +
    `SHA512SUMS.txt contains SHA-512 checksums for the APK and build metadata.\n\n</details>\n`
}

async function findGithubRelease(request, prefix, tag) {
  let found = null
  for (let page = 1; ; page += 1) {
    const releases = await request(prefix + '/releases?per_page=100&page=' + page)
    if (!Array.isArray(releases)) throw new Error('GitHub returned no release list')
    for (const release of releases.filter(row => row.tag_name === tag)) {
      if (found) throw new Error('Duplicate Android GitHub releases')
      found = release
    }
    if (releases.length < 100) return found
  }
}

async function githubTag(request, prefix, tag) {
  const ref = await request(prefix + '/git/ref/tags/' + tag, { missing: true })
  if (!ref) return null
  if (ref.ref !== 'refs/tags/' + tag) throw new Error('Unexpected Android GitHub tag ref')
  let object = ref.object
  const seen = new Set()
  while (object?.type === 'tag') {
    if (!sourceSha.test(object.sha) || seen.has(object.sha) || seen.size >= 10) throw new Error('Invalid Android annotated GitHub tag')
    seen.add(object.sha)
    object = (await request(prefix + '/git/tags/' + object.sha))?.object
  }
  if (object?.type !== 'commit' || !sourceSha.test(object.sha)) throw new Error('Android GitHub tag does not resolve to a commit')
  return { sha: object.sha, identity: JSON.stringify(ref.object) }
}

function latestIdentity(release) { return JSON.stringify([release?.id ?? null, release?.tag_name ?? null]) }
function assetIdentity(asset) { return JSON.stringify([asset.id, asset.name, asset.size, asset.digest ?? null]) }

function checkRelease(release, { tag, sha, files, mirror = false, complete = false }) {
  if (!release?.id || release.tag_name !== tag || typeof release.draft !== 'boolean' || typeof release.prerelease !== 'boolean' ||
      (mirror ? release.draft : release.prerelease) ||
      (!mirror && release.target_commitish !== sha) || (mirror && release.target_commitish && release.target_commitish !== sha) ||
      !Array.isArray(release.assets)) throw new Error('Invalid or conflicting Android ' + (mirror ? 'CNB' : 'GitHub') + ' release')
  const staged = mirror ? release.prerelease : release.draft
  if ((!staged || complete) && release.assets.length !== files.length) throw new Error('Published or complete Android release is missing assets')
  const names = new Set()
  for (const asset of release.assets) {
    const file = files.find(row => row.name === asset.name)
    if (!file || names.has(asset.name) || !asset.id || asset.size !== file.size ||
        (asset.digest != null && asset.digest !== 'sha256:' + file.sha256)) throw new Error('Conflicting or unexpected Android asset: ' + asset.name)
    names.add(asset.name)
  }
  return staged
}

function preserveAssets(before, after) {
  for (const asset of before) {
    if (assetIdentity(asset) !== assetIdentity(after.find(row => row.name === asset.name) || {})) {
      throw new Error('Existing Android asset changed: ' + asset.name)
    }
  }
}

async function verifyGithubAssets({ release, files, tag, repo, gh }) {
  if (!release.assets.length) return
  const directory = await mkdtemp(join(tmpdir(), 'whale-android-download-'))
  try {
    await gh(['release', 'download', tag, '--repo', repo,
      ...release.assets.flatMap(asset => ['--pattern', asset.name]), '--dir', directory])
    const names = await readdir(directory)
    if (names.length !== release.assets.length || names.some(name => !release.assets.some(asset => asset.name === name))) {
      throw new Error('GitHub Android download did not contain exactly the expected assets')
    }
    for (const asset of release.assets) {
      const file = files.find(row => row.name === asset.name)
      const downloaded = join(directory, file.name)
      if ((await regularFile(downloaded)).size !== file.size || (await hashes(downloaded)).sha512 !== file.sha512) {
        throw new Error('GitHub Android download checksum mismatch: ' + file.name)
      }
    }
  } finally { await rm(directory, { recursive: true, force: true }) }
}

// Push only this Android tag. In particular this never updates desktop tags or
// main, and the token is supplied through askpass rather than command arguments.
export async function syncAndroidTag({ repo, tag, sha, token, git = (args, options) => execFileSync('git', args, options) }) {
  if (!safeRepo.test(repo) || !tag?.startsWith('android-v') || !validVersion(tag.slice(9)) || !sourceSha.test(sha) || !token) {
    throw new Error('CNB repository, Android tag, source SHA and push credentials are required')
  }
  const directory = await mkdtemp(join(tmpdir(), 'whale-android-auth-'))
  try {
    const askpass = join(directory, 'askpass.sh')
    await writeFile(askpass, '#!/bin/sh\ncase "$1" in\n  *Username*) printf "%s\\n" "cnb" ;;\n  *) printf "%s\\n" "$CNB_TOKEN" ;;\nesac\n', { mode: 0o700 })
    await git(['-c', 'credential.helper=', '-c', 'core.askPass=' + askpass, 'push', 'https://cnb.cool/' + repo + '.git',
      sha + ':refs/tags/' + tag], { env: { ...process.env, CNB_TOKEN: token, GIT_TERMINAL_PROMPT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] })
  } catch { throw new Error('CNB Android tag push failed; check permissions or tag divergence (no force push)') }
  finally { await rm(directory, { recursive: true, force: true }) }
}

// Build and publication share a workflow_dispatch job. Build metadata is the
// input; requiring a completed workflow run here would reject that same job.
export async function publishAndroid({ repo, mirrorRepo, version, sha, assetDir, expectedCertificateSha256,
  request, gh, mirrorRequest, syncTag, fetchImpl = fetch, output = console.log }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !safeRepo.test(mirrorRepo) ||
      typeof request !== 'function' || typeof gh !== 'function' || typeof mirrorRequest !== 'function') {
    throw new Error('GitHub/CNB repositories and authenticated request/gh clients are required')
  }
  const { metadata, files } = await validateAndroidAssets({ assetDir, version, sha, expectedCertificateSha256 })
  const tag = 'android-v' + version
  const prefix = 'repos/' + repo
  const mirrorPrefix = '/' + mirrorRepo + '/-'
  const [latest, existing, oldTag, mirrorLatest, mirrorTag, existingMirror] = await Promise.all([
    request(prefix + '/releases/latest', { missing: true }), findGithubRelease(request, prefix, tag), githubTag(request, prefix, tag),
    mirrorRequest(mirrorPrefix + '/releases/latest'), mirrorRequest(mirrorPrefix + '/git/tags/' + tag),
    mirrorRequest(mirrorPrefix + '/releases/tags/' + tag),
  ])
  if (oldTag && oldTag.sha !== sha) throw new Error('Android GitHub tag belongs to another source commit')
  if (mirrorTag && mirrorTag.commit?.sha !== sha) throw new Error('Android CNB tag belongs to another source commit')
  if (!mirrorTag && existingMirror) throw new Error('Existing Android CNB release has no source tag')
  if (!mirrorTag && typeof syncTag !== 'function') throw new Error('CNB Android tag synchronization is required')
  if (existing) {
    checkRelease(existing, { tag, sha, files })
    if (!existing.draft && !oldTag) throw new Error('Published Android GitHub release has no source tag')
    await verifyGithubAssets({ release: existing, files, tag, repo, gh })
  }
  if (existingMirror) {
    checkRelease(existingMirror, { tag, sha, files, mirror: true })
    for (const asset of existingMirror.assets) await verifyDownload(asset, files.find(file => file.name === asset.name), fetchImpl)
  }
  let expectedTag = oldTag
  const protectGithub = async () => {
    const [currentTag, currentLatest] = await Promise.all([
      githubTag(request, prefix, tag), request(prefix + '/releases/latest', { missing: true }),
    ])
    if (!currentTag || currentTag.sha !== sha || (expectedTag && currentTag.identity !== expectedTag.identity) ||
        latestIdentity(latest) !== latestIdentity(currentLatest)) throw new Error('Android GitHub source tag or desktop latest changed')
    expectedTag = currentTag
  }
  const protectMirror = async (requireTag = true) => {
    const [currentTag, currentLatest] = await Promise.all([
      mirrorRequest(mirrorPrefix + '/git/tags/' + tag), mirrorRequest(mirrorPrefix + '/releases/latest'),
    ])
    if ((currentTag ? currentTag.commit?.sha !== sha : requireTag) || latestIdentity(mirrorLatest) !== latestIdentity(currentLatest)) {
      throw new Error('Android CNB source tag or desktop latest changed')
    }
  }
  await protectMirror(Boolean(mirrorTag))
  if (!oldTag) await request(prefix + '/git/refs', { method: 'POST', body: { ref: 'refs/tags/' + tag, sha } })
  await protectGithub()
  let release = existing
  const uploaded = []
  if (!release) {
    const created = await request(prefix + '/releases', { method: 'POST', body: {
      tag_name: tag, target_commitish: sha, name: 'Whale Isle Android ' + version,
      body: androidReleaseBody(version), draft: true, prerelease: false, make_latest: 'false',
    } })
    if (!created?.id) throw new Error('GitHub Android draft creation returned no ID')
    release = await request(prefix + '/releases/' + created.id)
  }
  if (checkRelease(release, { tag, sha, files })) {
    const oldAssets = release.assets.map(asset => ({ ...asset }))
    for (const file of files) {
      if (release.assets.some(asset => asset.name === file.name)) continue
      await gh(['release', 'upload', tag, file.file, '--repo', repo])
      uploaded.push(file.name)
    }
    const staged = await request(prefix + '/releases/' + release.id)
    if (!checkRelease(staged, { tag, sha, files, complete: true })) throw new Error('Android GitHub draft changed during upload')
    preserveAssets(oldAssets, staged.assets)
    await verifyGithubAssets({ release: staged, files, tag, repo, gh })
    await protectGithub()
    await protectMirror(Boolean(mirrorTag))
    await request(prefix + '/releases/' + release.id, { method: 'PATCH', body: {
      name: 'Whale Isle Android ' + version, body: androidReleaseBody(version), draft: false, prerelease: false, make_latest: 'false',
    } })
    release = await request(prefix + '/releases/' + release.id)
    if (checkRelease(release, { tag, sha, files, complete: true })) throw new Error('Android GitHub release remains a draft')
    preserveAssets(staged.assets, release.assets)
  }
  await protectGithub()
  await protectMirror(Boolean(mirrorTag))
  if (!mirrorTag) {
    await syncTag({ repo: mirrorRepo, tag, sha })
    await protectMirror()
  }
  let target = existingMirror
  if (!target) {
    const created = await mirrorRequest(mirrorPrefix + '/releases', { method: 'POST', body: {
      tag_name: tag, target_commitish: sha, name: 'Whale Isle Android ' + version, body: androidReleaseBody(version),
      draft: false, prerelease: true, make_latest: 'false',
    } })
    if (!created?.id) throw new Error('CNB Android prerelease creation returned no ID')
    target = await mirrorRequest(mirrorPrefix + '/releases/' + created.id)
  }
  const mirrorUploaded = []
  if (checkRelease(target, { tag, sha, files, mirror: true })) {
    const oldAssets = target.assets.map(asset => ({ ...asset }))
    for (const file of files) {
      if (target.assets.some(asset => asset.name === file.name)) continue
      await uploadMirrorAsset({ file, overwrite: false, targetId: target.id, prefix: mirrorPrefix, request: mirrorRequest, fetchImpl })
      mirrorUploaded.push(file.name)
    }
    const staged = await mirrorRequest(mirrorPrefix + '/releases/' + target.id)
    if (!checkRelease(staged, { tag, sha, files, mirror: true, complete: true })) throw new Error('Android CNB prerelease changed during upload')
    preserveAssets(oldAssets, staged.assets)
    for (const file of files) await verifyDownload(staged.assets.find(asset => asset.name === file.name), file, fetchImpl)
    await protectGithub()
    await protectMirror()
    await mirrorRequest(mirrorPrefix + '/releases/' + target.id, { method: 'PATCH', body: {
      name: 'Whale Isle Android ' + version, body: androidReleaseBody(version), draft: false, prerelease: false, make_latest: 'false',
    } })
    target = await mirrorRequest(mirrorPrefix + '/releases/' + target.id)
    if (checkRelease(target, { tag, sha, files, mirror: true, complete: true })) throw new Error('Android CNB release remains a prerelease')
    preserveAssets(staged.assets, target.assets)
  }
  await protectGithub()
  await protectMirror()
  const url = 'https://github.com/' + repo + '/releases/tag/' + tag
  const mirrorUrl = 'https://cnb.cool/' + mirrorRepo + '/-/releases/tag/' + tag
  output('Verified Android release: ' + url)
  output('Verified Android CNB mirror: ' + mirrorUrl)
  return { tag, sha, versionCode: metadata.versionCode, url, uploaded,
    assets: files.map(({ name, size, sha256, sha512 }) => ({ name, size, sha256, sha512 })),
    mirror: { url: mirrorUrl, assets: files.length, uploaded: mirrorUploaded } }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const token = process.env.GH_TOKEN
    if (!token) throw new Error('GH_TOKEN is required')
    const mirrorToken = process.env.CNB_TOKEN
    const mirrorRequest = cnbClient(mirrorToken)
    const request = async (path, { method = 'GET', body, missing = false } = {}) => {
      const response = await fetch('https://api.github.com/' + path, { method, redirect: 'error', signal: AbortSignal.timeout(30000),
        headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body) })
      if (missing && response.status === 404) return null
      if (!response.ok) throw new Error('GitHub ' + method + ': HTTP ' + response.status)
      return response.json()
    }
    await publishAndroid({ repo: process.env.GITHUB_REPOSITORY, mirrorRepo: process.env.CNB_REPO,
      version: process.env.ANDROID_VERSION, sha: process.env.ANDROID_SOURCE_SHA, assetDir: process.env.ANDROID_ASSET_DIR,
      expectedCertificateSha256: process.env.ANDROID_SIGNING_CERT_SHA256, request, mirrorRequest,
      gh: args => execFileSync(process.env.GH_PATH || 'gh', args, { stdio: 'inherit' }),
      syncTag: options => syncAndroidTag({ ...options, token: mirrorToken }),
    })
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
