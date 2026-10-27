import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { androidReleaseBody, publishAndroid, syncAndroidTag, validateAndroidAssets } from './publish-android.mjs'
import { readAndroidVersion } from './android-version.mjs'

const repo = 'owner/project'
const mirrorRepo = 'mirror/project'
const version = '0.3.10'
const tag = 'android-v' + version
const sha = 'a'.repeat(40)
const certificate = 'c'.repeat(64)
const apkName = 'Whale-Isle-' + version + '-android.apk'
const metadataName = 'android-release.json'
const sumsName = 'SHA512SUMS.txt'
const names = [apkName, metadataName, sumsName]
const digest = (bytes, algorithm = 'sha512') => createHash(algorithm).update(bytes).digest('hex')
const clone = value => value == null ? value : structuredClone(value)

async function buildFixture(t, { version: buildVersion = version, versionCode = 4 } = {}) {
  const buildApkName = 'Whale-Isle-' + buildVersion + '-android.apk'
  const directory = await mkdtemp(join(tmpdir(), 'publish-android-test-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const apk = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('APK bytes already checked by build apksigner')])
  const metadata = { schemaVersion: 1, version: buildVersion, versionCode, applicationId: 'ai.deepseek.harness.mobile', minSdk: 26, targetSdk: 36,
    sourceSha: sha, apk: { name: buildApkName, size: apk.length, sha256: digest(apk, 'sha256'), sha512: digest(apk), signingCertificateSha256: certificate },
    checks: { jvm: 'passed', lint: 'passed', emulator: 'passed' } }
  const bytes = new Map([[buildApkName, apk], [metadataName, Buffer.from(JSON.stringify(metadata) + '\n')]])
  bytes.set(sumsName, Buffer.from([...bytes].map(([name, data]) => digest(data) + '  ' + name).join('\n') + '\n'))
  for (const [name, data] of bytes) if (name !== sumsName) await writeFile(join(directory, name), data)
  return { directory, metadata, bytes, options: { assetDir: directory, version: buildVersion, sha, expectedCertificateSha256: certificate },
    async saveMetadata() { await writeFile(join(directory, metadataName), JSON.stringify(metadata) + '\n') } }
}

async function fixture(t, config = {}) {
  const build = await buildFixture(t)
  const github = new Map()
  const cnb = new Map()
  let nextId = 500
  const assets = (source, mirror = false) => [...source].map(([name, data]) => ({
    id: data.id, name, size: data.bytes.length, digest: 'sha256:' + digest(data.bytes, 'sha256'),
    ...(mirror ? { browser_download_url: 'https://cnb.cool/' + mirrorRepo + '/-/releases/download/' + tag + '/' + name } : {}),
  }))
  const seed = (source, selected) => {
    for (const name of selected) source.set(name, { id: nextId++, bytes: Buffer.from(build.bytes.get(name)) })
  }
  seed(github, config.ghAssets || (config.ghStable ? names : []))
  seed(cnb, config.cnbAssets || (config.cnbStable ? names : []))
  let release = config.ghStable || config.ghDraft ? { id: 100, tag_name: tag, target_commitish: sha,
    draft: !config.ghStable, prerelease: false, name: 'Existing Android', body: 'Existing notes' } : null
  let target = config.cnbStable || config.cnbStaged ? { id: '200', tag_name: tag, target_commitish: sha,
    draft: false, prerelease: !config.cnbStable, name: 'Existing Android', body: 'Existing notes' } : null
  let ref = config.ghStable || config.ghTag || config.annotatedTag ? { ref: 'refs/tags/' + tag,
    object: { type: config.annotatedTag ? 'tag' : 'commit', sha: config.annotatedTag ? 'd'.repeat(40) : sha } } : null
  let mirrorTag = config.cnbStable || config.cnbStaged || config.cnbTag ? { name: tag, commit: { sha } } : null
  const latest = { id: 1, tag_name: 'v0.3.10' }
  const mirrorLatest = { id: '2', tag_name: 'v0.3.10' }
  const desktopAssets = [{ id: 20, name: 'Whale-Isle-Setup-0.3.10.exe', size: 123, digest: 'sha256:' + 'e'.repeat(64) },
    { id: 21, name: 'latest.yml', size: 66 }]
  const desktop = { id: 1, tag_name: 'v0.3.10', draft: false, prerelease: false, assets: desktopAssets }
  const desktopOriginal = clone(desktop)
  const calls = []
  const pending = new Map()
  const state = {
    github, cnb, latest, mirrorLatest, desktop,
    failGh: config.failGh, failCnb: config.failCnb, corruptGh: config.corruptGh, corruptCnb: config.corruptCnb,
    wrongGhDownloadSet: false, changeTagAfterUpload: false, changeLatestAfterUpload: false,
    changeMirrorLatestAfterUpload: false,
    get release() { return release }, get target() { return target },
    setRef(value) { ref = value }, setMirrorTag(value) { mirrorTag = value },
  }
  const githubSnapshot = () => release ? { ...clone(release), assets: assets(github) } : null
  const cnbSnapshot = () => target ? { ...clone(target), assets: assets(cnb, true) } : null
  const request = async (path, options = {}) => {
    calls.push(['github', path, clone(options)])
    assert.ok(!path.includes('/actions/'), 'Publication inside its build job must never query run success')
    const prefix = 'repos/' + repo
    if (options.method) {
      if (options.method === 'POST' && path === prefix + '/git/refs') {
        assert.deepEqual(options.body, { ref: 'refs/tags/' + tag, sha })
        assert.equal(ref, null)
        ref = { ref: 'refs/tags/' + tag, object: { type: 'commit', sha } }
        return clone(ref)
      }
      if (options.method === 'POST' && path === prefix + '/releases') {
        assert.equal(release, null)
        assert.equal(options.body.tag_name, tag)
        assert.equal(options.body.target_commitish, sha)
        assert.equal(options.body.draft, true)
        assert.equal(options.body.make_latest, 'false')
        release = { id: 100, ...options.body }
        return githubSnapshot()
      }
      if (options.method === 'PATCH' && path === prefix + '/releases/100') {
        assert.equal(github.size, names.length)
        assert.equal(options.body.make_latest, 'false')
        Object.assign(release, options.body)
        return githubSnapshot()
      }
      assert.fail('Unexpected GitHub mutation: ' + options.method + ' ' + path)
    }
    if (path === prefix + '/releases/latest') return clone(latest)
    if (path.includes('/releases?per_page=100&page=')) {
      if (config.paginatedDraft && path.endsWith('page=1')) return Array.from({ length: 100 }, (_, index) => ({ tag_name: 'unrelated-' + index }))
      return release ? [githubSnapshot()] : []
    }
    if (path === prefix + '/git/ref/tags/' + tag) return clone(ref)
    if (path === prefix + '/git/tags/' + 'd'.repeat(40)) return { object: { type: 'tag', sha: 'e'.repeat(40) } }
    if (path === prefix + '/git/tags/' + 'e'.repeat(40)) return { object: { type: 'commit', sha } }
    if (path === prefix + '/releases/100') return githubSnapshot()
    assert.fail('Unexpected GitHub request: ' + path)
  }
  const mirrorRequest = async (path, options = {}) => {
    calls.push(['cnb', path, clone(options)])
    const prefix = '/' + mirrorRepo + '/-'
    if (options.method) {
      if (options.method === 'POST' && path === prefix + '/releases') {
        assert.equal(target, null)
        assert.equal(release.draft, false, 'Only a published, verified GitHub release is mirrored')
        assert.deepEqual(options.body, { tag_name: tag, target_commitish: sha, name: 'Whale Isle Android ' + version,
          body: androidReleaseBody(version), draft: false, prerelease: true, make_latest: 'false' })
        target = { id: '200', ...options.body }
        return cnbSnapshot()
      }
      if (options.method === 'POST' && path === prefix + '/releases/200/asset-upload-url') {
        const { asset_name: name } = options.body
        assert.ok(names.includes(name), 'Only intended Android assets are uploaded')
        assert.equal(options.body.overwrite, false)
        assert.equal(cnb.has(name), false, 'Existing CNB assets must never be clobbered')
        return { upload_url: 'https://storage.example/' + name,
          verify_url: 'https://api.cnb.cool' + prefix + '/releases/200/asset-upload-confirmation/' + name }
      }
      if (options.method === 'POST' && path.startsWith(prefix + '/releases/200/asset-upload-confirmation/')) {
        const name = basename(new URL('https://api.cnb.cool' + path).pathname)
        cnb.set(name, { id: nextId++, bytes: pending.get(name) })
        return null
      }
      if (options.method === 'PATCH' && path === prefix + '/releases/200') {
        assert.equal(cnb.size, names.length)
        assert.equal(options.body.make_latest, 'false')
        for (const name of names) assert.ok(calls.some(([kind, value]) => kind === 'anonymous-download' && value === name))
        Object.assign(target, options.body)
        return cnbSnapshot()
      }
      assert.fail('Unexpected CNB mutation: ' + options.method + ' ' + path)
    }
    if (path === prefix + '/releases/latest') return clone(mirrorLatest)
    if (path === prefix + '/git/tags/' + tag) return clone(mirrorTag)
    if (path === prefix + '/releases/tags/' + tag || path === prefix + '/releases/200') return cnbSnapshot()
    assert.fail('Unexpected CNB request: ' + path)
  }
  const gh = async args => {
    calls.push(['gh', [...args]])
    assert.deepEqual(args.slice(0, 1), ['release'])
    assert.equal(args[2], tag)
    assert.equal(args[args.indexOf('--repo') + 1], repo)
    assert.equal(args.includes('--clobber'), false)
    if (args[1] === 'download') {
      const directory = args[args.indexOf('--dir') + 1]
      const patterns = args.flatMap((arg, index) => arg === '--pattern' ? [args[index + 1]] : [])
      await mkdir(directory, { recursive: true })
      for (const [name, value] of github) if (patterns.includes(name)) await writeFile(join(directory, name), state.corruptGh === name ? Buffer.from('bad bytes') : value.bytes)
      if (state.wrongGhDownloadSet) await writeFile(join(directory, 'unexpected.txt'), 'unrelated')
      return
    }
    assert.equal(args[1], 'upload')
    assert.equal(release.draft, true, 'Published GitHub releases are immutable')
    const name = basename(args[3])
    assert.ok(names.includes(name))
    assert.equal(github.has(name), false, 'Existing GitHub assets must never be clobbered')
    if (state.failGh === name) throw new Error('GitHub upload interrupted')
    github.set(name, { id: nextId++, bytes: await readFile(args[3]) })
    if (state.changeTagAfterUpload) ref.object.sha = 'f'.repeat(40)
    if (state.changeLatestAfterUpload) latest.id = 999
  }
  const fetchImpl = async (url, options = {}) => {
    assert.equal(options.headers, undefined, 'CNB downloads and signed uploads must not send credentials')
    const endpoint = new URL(url)
    const name = basename(endpoint.pathname)
    if (options.method === 'PUT') {
      calls.push(['cnb-upload', name])
      assert.equal(endpoint.origin, 'https://storage.example')
      if (state.failCnb === name) throw new Error('CNB upload interrupted')
      const bytes = Buffer.from(await options.body.arrayBuffer())
      assert.deepEqual(bytes, build.bytes.get(name))
      pending.set(name, bytes)
      if (state.changeMirrorLatestAfterUpload) mirrorLatest.id = '999'
      return new Response(null, { status: 200 })
    }
    calls.push(['anonymous-download', name])
    assert.equal(endpoint.origin, 'https://cnb.cool')
    return new Response(state.corruptCnb === name ? Buffer.from('corrupt download') : cnb.get(name)?.bytes)
  }
  const syncTag = async options => {
    calls.push(['sync-tag', clone(options)])
    assert.deepEqual(options, { repo: mirrorRepo, tag, sha })
    assert.equal(mirrorTag, null)
    mirrorTag = { name: tag, commit: { sha } }
  }
  t.after(() => assert.deepEqual(desktop, desktopOriginal, 'Desktop release and original asset IDs must stay unchanged'))
  return { ...build, calls, state, options: { ...build.options, repo, mirrorRepo, request, gh, mirrorRequest, syncTag, fetchImpl, output: () => {} },
    ghUploads() { return calls.filter(([kind, args]) => kind === 'gh' && args[1] === 'upload').map(([, args]) => basename(args[3])) },
    cnbUploads() { return calls.filter(([kind]) => kind === 'cnb-upload').map(([, name]) => name) },
    mutations() { return calls.filter(([kind, , options]) => ['github', 'cnb'].includes(kind) && options.method) } }
}

test('build artifact validation emits exact APK and metadata checksums and is idempotent', async t => {
  const f = await buildFixture(t)
  assert.deepEqual((await readdir(f.directory)).sort(), [apkName, metadataName].sort())
  const result = await validateAndroidAssets(f.options)
  assert.deepEqual(result.metadata, f.metadata)
  assert.deepEqual(result.files.map(file => file.name), names)
  assert.deepEqual(await readFile(join(f.directory, sumsName)), f.bytes.get(sumsName))
  assert.deepEqual((await validateAndroidAssets({ ...f.options, expectedCertificateSha256: certificate.toUpperCase().match(/../g).join(':') })).files, result.files)
})

test('current Gradle candidate requires its own code and cannot reuse the historical code', async t => {
  const current = await readAndroidVersion()
  const candidate = await buildFixture(t, current)
  const result = await validateAndroidAssets(candidate.options)
  assert.equal(result.metadata.version, current.version)
  assert.equal(result.metadata.versionCode, current.versionCode)
  assert.equal(result.files[0].name, current.apkName)
  for (const versionCode of [4, current.versionCode + 1]) {
    const invalid = await buildFixture(t, { version: current.version, versionCode })
    await assert.rejects(validateAndroidAssets(invalid.options), /versionCode/)
    await assert.rejects(validateAndroidAssets({ ...invalid.options, expectedVersionCode: versionCode }), /versionCode/)
    assert.ok(!(await readdir(invalid.directory)).includes(sumsName))
  }
  const historical = await buildFixture(t, { version, versionCode: current.versionCode })
  await assert.rejects(validateAndroidAssets(historical.options), /versionCode/)
  await assert.rejects(validateAndroidAssets({ ...historical.options, expectedVersionCode: current.versionCode }), /versionCode/)
})

test('schema, identities, versionCode, certificates, checks and APK bytes reject before any API or upload', async t => {
  const mutations = [
    f => { f.metadata.schemaVersion = 2 }, f => { f.metadata.version = '0.3.11' }, f => { f.metadata.versionCode = 3 },
    f => { f.metadata.versionCode = 0 }, f => { f.metadata.versionCode = 4.5 }, f => { f.metadata.versionCode = 2100000001 },
    f => { f.metadata.sourceSha = 'b'.repeat(40) }, f => { f.metadata.applicationId = 'other.application' },
    f => { f.metadata.minSdk = 25 }, f => { f.metadata.targetSdk = 35 }, f => { f.metadata.extra = true },
    f => { f.metadata.apk.name = '../other.apk' }, f => { f.metadata.apk.size += 1 },
    f => { f.metadata.apk.sha256 = '0'.repeat(64) }, f => { f.metadata.apk.sha512 = '0'.repeat(128) },
    f => { f.metadata.apk.signingCertificateSha256 = 'd'.repeat(64) }, f => { delete f.metadata.apk.signingCertificateSha256 },
    f => { f.metadata.checks.jvm = 'failed' }, f => { f.metadata.checks.lint = 'skipped' }, f => { f.metadata.checks.emulator = 'not-run' },
    f => { f.metadata.checks.physicalDevice = 'passed' },
  ]
  for (const mutate of mutations) {
    const f = await fixture(t)
    mutate(f)
    await f.saveMetadata()
    await assert.rejects(publishAndroid(f.options), /metadata|checksum/)
    assert.deepEqual(f.calls, [])
    assert.ok(!(await readdir(f.directory)).includes(sumsName))
  }
  for (const bad of [Buffer.from('this is no APK'), Buffer.from([0x50, 0x4b, 0x05, 0x06]), Buffer.alloc(0)]) {
    const f = await fixture(t)
    await writeFile(join(f.directory, apkName), bad)
    await assert.rejects(publishAndroid(f.options), /ZIP|size/)
    assert.deepEqual(f.calls, [])
  }
  for (const change of [{ expectedCertificateSha256: '' }, { version: '0.3.10-rc.1' }, { sha: 'main' }, { assetDir: '' }]) {
    const f = await fixture(t)
    await assert.rejects(publishAndroid({ ...f.options, ...change }))
    assert.deepEqual(f.calls, [])
  }
})

test('unexpected files, non-regular artifacts, invalid JSON and a conflicting existing checksum reject', async t => {
  const extra = await fixture(t)
  await writeFile(join(extra.directory, 'desktop.exe'), 'not Android')
  await assert.rejects(publishAndroid(extra.options), /only/)
  assert.deepEqual(extra.calls, [])
  const directoryApk = await fixture(t)
  await rm(join(directoryApk.directory, apkName))
  await mkdir(join(directoryApk.directory, apkName))
  await assert.rejects(publishAndroid(directoryApk.options), /regular file/)
  assert.deepEqual(directoryApk.calls, [])
  const invalid = await fixture(t)
  await writeFile(join(invalid.directory, metadataName), '{invalid json')
  await assert.rejects(publishAndroid(invalid.options), /JSON/)
  assert.deepEqual(invalid.calls, [])
  const sums = await fixture(t)
  await writeFile(join(sums.directory, sumsName), '0'.repeat(128) + '  ' + apkName + '\n')
  await assert.rejects(publishAndroid(sums.options), /conflicts/)
  assert.deepEqual(sums.calls, [])
})

test('symlink artifacts are rejected instead of following a path outside the build directory', { skip: process.platform === 'win32' && 'Windows symlinks require host privileges' }, async t => {
  const f = await fixture(t)
  const source = join(f.directory, 'original.apk')
  await writeFile(source, f.bytes.get(apkName))
  await rm(join(f.directory, apkName))
  await symlink(source, join(f.directory, apkName))
  await rm(source)
  await assert.rejects(publishAndroid(f.options), /regular file/)
  assert.deepEqual(f.calls, [])
})

test('same-job publication stages only three Android assets, verifies downloads, preserves desktop latest and publishes both sites', async t => {
  const f = await fixture(t)
  const result = await publishAndroid(f.options)
  assert.equal(result.tag, tag)
  assert.equal(result.sha, sha)
  assert.equal(result.versionCode, 4)
  assert.deepEqual(result.assets.map(asset => asset.name), names)
  assert.deepEqual(f.ghUploads(), names)
  assert.deepEqual(f.cnbUploads(), names)
  assert.equal(f.state.release.draft, false)
  assert.equal(f.state.target.prerelease, false)
  assert.deepEqual(f.state.latest, { id: 1, tag_name: 'v0.3.10' })
  assert.deepEqual(f.state.mirrorLatest, { id: '2', tag_name: 'v0.3.10' })
  const ghPublish = f.calls.findIndex(([kind, , options]) => kind === 'github' && options.method === 'PATCH')
  const ghDownload = f.calls.findIndex(([kind, args]) => kind === 'gh' && args[1] === 'download')
  const cnbCreate = f.calls.findIndex(([kind, path, options]) => kind === 'cnb' && path.endsWith('/releases') && options.method === 'POST')
  const cnbPublish = f.calls.findIndex(([kind, , options]) => kind === 'cnb' && options.method === 'PATCH')
  assert.ok(ghDownload >= 0 && ghDownload < ghPublish && ghPublish < cnbCreate)
  for (const name of names) {
    const lastVerified = f.calls.findLastIndex(([kind, value]) => kind === 'anonymous-download' && value === name)
    assert.ok(lastVerified > cnbCreate && lastVerified < cnbPublish)
  }
  for (const [kind, path] of f.mutations()) {
    if (kind === 'github') assert.match(path, new RegExp('^repos/' + repo + '/(?:git/refs|releases(?:/100)?)$'))
    else assert.match(path, new RegExp('^/' + mirrorRepo + '/-/releases(?:/200(?:/asset-upload-(?:url|confirmation/[^?]+)\\?ttl=0|/asset-upload-url)?)?$'))
  }
  assert.equal(result.url, 'https://github.com/' + repo + '/releases/tag/' + tag)
  assert.equal(result.mirror.url, 'https://cnb.cool/' + mirrorRepo + '/-/releases/tag/' + tag)
})

test('GitHub partial draft is found through pagination and uploads only missing files, then a stable rerun is read-only', async t => {
  const f = await fixture(t, { ghDraft: true, ghTag: true, ghAssets: [apkName], paginatedDraft: true })
  const existingId = f.state.github.get(apkName).id
  await publishAndroid(f.options)
  assert.deepEqual(f.ghUploads(), [metadataName, sumsName])
  assert.equal(f.state.github.get(apkName).id, existingId)
  assert.ok(!f.mutations().some(([kind, path]) => kind === 'github' && path.endsWith('/releases')))
  const start = f.calls.length
  const result = await publishAndroid(f.options)
  assert.deepEqual(result.uploaded, [])
  assert.deepEqual(result.mirror.uploaded, [])
  assert.ok(!f.calls.slice(start).some(([kind, , options]) => ['github', 'cnb'].includes(kind) && options.method))
  assert.ok(!f.calls.slice(start).some(([kind, args]) => kind === 'cnb-upload' || kind === 'sync-tag' || kind === 'gh' && args[1] === 'upload'))
})

test('GitHub interruption or corrupt returned bytes leaves a resumable draft and never starts the CNB mirror', async t => {
  for (const change of [{ failGh: metadataName }, { corruptGh: apkName }]) {
    const f = await fixture(t, change)
    await assert.rejects(publishAndroid(f.options), /interrupted|checksum/)
    assert.equal(f.state.release.draft, true)
    assert.equal(f.state.target, null)
    assert.equal(f.mutations().some(([, , options]) => options.method === 'PATCH'), false)
    assert.deepEqual(f.cnbUploads(), [])
    const uploadedIds = new Map([...f.state.github].map(([name, value]) => [name, value.id]))
    f.state.failGh = null
    f.state.corruptGh = null
    await publishAndroid(f.options)
    for (const [name, id] of uploadedIds) assert.equal(f.state.github.get(name).id, id)
    assert.equal(f.state.release.draft, false)
    assert.equal(f.state.target.prerelease, false)
  }
})

test('CNB interruption and corrupt anonymous bytes keep prerelease staged, and resume without reuploading existing bytes', async t => {
  for (const change of [{ failCnb: metadataName }, { corruptCnb: apkName }]) {
    const f = await fixture(t, change)
    await assert.rejects(publishAndroid(f.options), /upload failed|mismatch/)
    assert.equal(f.state.release.draft, false)
    assert.equal(f.state.target.prerelease, true)
    assert.equal(f.mutations().some(([kind, , options]) => kind === 'cnb' && options.method === 'PATCH'), false)
    const ghIds = [...f.state.github].map(([name, value]) => [name, value.id])
    const cnbIds = [...f.state.cnb].map(([name, value]) => [name, value.id])
    const start = f.calls.length
    f.state.failCnb = null
    f.state.corruptCnb = null
    await publishAndroid(f.options)
    for (const [name, id] of ghIds) assert.equal(f.state.github.get(name).id, id)
    for (const [name, id] of cnbIds) assert.equal(f.state.cnb.get(name).id, id)
    assert.ok(!f.calls.slice(start).some(([kind, args]) => kind === 'gh' && args[1] === 'upload'))
    assert.equal(f.state.target.prerelease, false)
  }
})

test('existing stable Android release on both sites is fully verified without any writes', async t => {
  const f = await fixture(t, { ghStable: true, cnbStable: true })
  const originalRelease = clone(f.state.release)
  const originalTarget = clone(f.state.target)
  const result = await publishAndroid(f.options)
  assert.deepEqual(result.uploaded, [])
  assert.deepEqual(result.mirror.uploaded, [])
  assert.deepEqual(f.mutations(), [])
  assert.deepEqual(f.ghUploads(), [])
  assert.deepEqual(f.cnbUploads(), [])
  assert.deepEqual(f.state.release, originalRelease)
  assert.deepEqual(f.state.target, originalTarget)
  assert.equal(f.calls.filter(([kind]) => kind === 'anonymous-download').length, 3)
})

test('published missing assets, conflicting bytes, unexpected assets and foreign tags reject before writes', async t => {
  const mutations = [
    f => f.state.github.delete(metadataName), f => f.state.cnb.delete(metadataName),
    f => f.state.github.set('desktop.exe', { id: 999, bytes: Buffer.from('unexpected') }),
    f => f.state.cnb.set('desktop.exe', { id: 999, bytes: Buffer.from('unexpected') }),
    f => { f.state.github.get(apkName).bytes = Buffer.from('x'.repeat(f.bytes.get(apkName).length)) },
    f => { f.state.cnb.get(apkName).bytes = Buffer.from('x'.repeat(f.bytes.get(apkName).length)) },
    f => { f.state.release.target_commitish = 'b'.repeat(40) },
    f => f.state.setRef({ ref: 'refs/tags/' + tag, object: { type: 'commit', sha: 'b'.repeat(40) } }),
    f => f.state.setMirrorTag({ name: tag, commit: { sha: 'b'.repeat(40) } }),
    f => f.state.setRef(null), f => f.state.setMirrorTag(null),
  ]
  for (const mutate of mutations) {
    const f = await fixture(t, { ghStable: true, cnbStable: true })
    mutate(f)
    await assert.rejects(publishAndroid(f.options))
    assert.deepEqual(f.mutations(), [])
    assert.deepEqual(f.ghUploads(), [])
    assert.deepEqual(f.cnbUploads(), [])
  }
})

test('draft conflicting assets, corrupt downloads and absent source sync refuse publication without overwrites', async t => {
  for (const mode of ['bytes', 'extra', 'download-set', 'sync']) {
    const f = await fixture(t, { ghDraft: true, ghTag: true, ghAssets: [apkName] })
    if (mode === 'bytes') f.state.github.get(apkName).bytes = Buffer.from('different')
    if (mode === 'extra') f.state.github.set('desktop.exe', { id: 999, bytes: Buffer.from('unexpected') })
    if (mode === 'download-set') f.state.wrongGhDownloadSet = true
    if (mode === 'sync') f.options.syncTag = undefined
    await assert.rejects(publishAndroid(f.options))
    assert.deepEqual(f.mutations(), [])
    assert.deepEqual(f.ghUploads(), [])
    assert.deepEqual(f.cnbUploads(), [])
  }
})

test('annotated GitHub tags resolve to their actual commit and their original object is preserved', async t => {
  const f = await fixture(t, { annotatedTag: true })
  assert.equal((await publishAndroid(f.options)).sha, sha)
  assert.ok(f.calls.some(([kind, path]) => kind === 'github' && path.endsWith('/git/tags/' + 'd'.repeat(40))))
  assert.ok(f.calls.some(([kind, path]) => kind === 'github' && path.endsWith('/git/tags/' + 'e'.repeat(40))))
  assert.ok(!f.mutations().some(([, path]) => path.endsWith('/git/refs')))
  assert.ok(!f.calls.some(([kind, path]) => kind === 'github' && path.includes('/commits/')))
})

test('source tag or desktop latest changes after uploading block promotion on the affected site', async t => {
  for (const flag of ['changeTagAfterUpload', 'changeLatestAfterUpload', 'changeMirrorLatestAfterUpload']) {
    const f = await fixture(t)
    f.state[flag] = true
    await assert.rejects(publishAndroid(f.options), /source tag or desktop latest changed/)
    if (flag === 'changeMirrorLatestAfterUpload') {
      assert.equal(f.state.target.prerelease, true)
      assert.equal(f.mutations().some(([kind, , options]) => kind === 'cnb' && options.method === 'PATCH'), false)
    } else {
      assert.equal(f.state.release.draft, true)
      assert.equal(f.mutations().some(([kind, , options]) => kind === 'github' && options.method === 'PATCH'), false)
    }
  }
})

test('release notes explain Android requirements, desktop QR connection and the missing physical-device evidence in both languages', () => {
  const body = androidReleaseBody(version)
  assert.match(body, /Android 8\.0/)
  assert.match(body, /API 26\+/)
  assert.match(body, /扫描鲸屿桌面端提供的连接二维码/)
  assert.match(body, /物理 Android 设备.*全链路验证证据/)
  assert.match(body, /scan the connection QR code/)
  assert.match(body, /shown by Whale Isle desktop\./)
  assert.doesNotMatch(androidReleaseBody('0.3.11'), /v0\.3\.11 (?:桌面端|desktop)|desktop v0\.3\.11/)
  assert.match(body, /no physical-device end-to-end evidence/)
  assert.doesNotMatch(body, /autonomous|standalone AI|自主运行/)
})

test('CNB source sync pushes only Android tag, keeps credentials out of arguments and cleans askpass on failure', async () => {
  let askpassPath
  const git = async (args, options) => {
    assert.ok(!args.includes('--force'))
    assert.ok(!args.includes('--tags'))
    assert.ok(!args.some(arg => arg.includes('refs/heads/main')))
    assert.equal(args.at(-1), sha + ':refs/tags/' + tag)
    assert.equal(options.env.CNB_TOKEN, 'test-only-token')
    assert.ok(!args.join(' ').includes('test-only-token'))
    askpassPath = args.find(arg => arg.startsWith('core.askPass=')).slice('core.askPass='.length)
    const script = await readFile(askpassPath, 'utf8')
    assert.ok(script.includes('$CNB_TOKEN'))
    assert.ok(!script.includes('test-only-token'))
    throw new Error('test-only-token is in an external git failure')
  }
  await assert.rejects(syncAndroidTag({ repo: mirrorRepo, tag, sha, token: 'test-only-token', git }), error =>
    /tag push failed/.test(error.message) && !error.message.includes('test-only-token'))
  await assert.rejects(lstat(askpassPath), { code: 'ENOENT' })
})

test('CNB source sync creates a real exact commit tag and refuses an existing divergent tag without force', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'android-git-test-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const source = join(directory, 'source')
  const target = join(directory, 'target.git')
  const git = args => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  git(['init', '--initial-branch=main', source])
  git(['init', '--bare', target])
  git(['-C', source, 'config', 'user.email', 'android-test@example.test'])
  git(['-C', source, 'config', 'user.name', 'Android test'])
  git(['-C', source, 'commit', '--allow-empty', '-m', 'Android source'])
  const sourceCommit = git(['-C', source, 'rev-parse', 'HEAD'])
  const runGit = (args, options) => execFileSync('git', ['-C', source, ...args.map(arg => arg.startsWith('https://cnb.cool/') ? target : arg)], options)
  await syncAndroidTag({ repo: mirrorRepo, tag, sha: sourceCommit, token: 'test-only-token', git: runGit })
  assert.equal(git(['--git-dir=' + target, 'rev-parse', 'refs/tags/' + tag]), sourceCommit)
  assert.equal(git(['--git-dir=' + target, 'for-each-ref', '--format=%(refname)']), 'refs/tags/' + tag)
  git(['-C', source, 'commit', '--allow-empty', '-m', 'Different Android source'])
  const otherCommit = git(['-C', source, 'rev-parse', 'HEAD'])
  await assert.rejects(syncAndroidTag({ repo: mirrorRepo, tag, sha: otherCommit, token: 'test-only-token', git: runGit }), /tag push failed/)
  assert.equal(git(['--git-dir=' + target, 'rev-parse', 'refs/tags/' + tag]), sourceCommit)
})
