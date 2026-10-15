import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { appendMacosChecksum, macosSupplementDecision, supplementMacosRelease } from './publish-macos-supplement.mjs'

const repo = 'owner/project'
const tag = 'v0.3.8'
const sha = 'a'.repeat(40)
const toolingSha = 'b'.repeat(40)
const macosName = 'Whale-Isle-0.3.8-mac-arm64.dmg'
const setupName = 'Whale-Isle-Setup-0.3.8.exe'
const oldNames = [setupName, setupName + '.blockmap', 'latest.yml', 'SHA512SUMS.txt']
const digest = (bytes, algorithm = 'sha512', encoding = 'hex') => createHash(algorithm).update(bytes).digest(encoding)
const run = { status: 'completed', conclusion: 'success', event: 'workflow_dispatch',
  path: '.github/workflows/release-macos-diagnostic.yml', head_branch: 'codex/supplement-macos-0.3.8', head_sha: toolingSha,
  head_repository: { full_name: repo } }
const artifact = { id: 80, name: 'Whale-Isle-macos-arm64', expired: false }
const sourceArtifact = { id: 81, name: 'Whale-Isle-macos-build-source', expired: false }
const toolSources = new Map([
  ['scripts/prepare-dsh-feedback-clients.mjs', Buffer.from('prepare plugin clients\n')],
  ['scripts/plugin-build-esbuild.mjs', Buffer.from('build using plugin host version\n')],
])
const buildSource = { schemaVersion: 1, sourceTag: tag, sourceSha: sha, toolingSha,
  buildTools: [...toolSources].map(([path, bytes]) => ({ path, sha256: digest(bytes, 'sha256') })) }
const release = { id: 1, tag_name: tag, target_commitish: sha, name: 'Whale Isle ' + tag,
  body: 'Published notes stay unchanged', draft: false, prerelease: false,
  html_url: 'https://github.com/' + repo + '/releases/tag/' + tag }

test('only a successful same-repository manual run with unique DMG and source artifacts is eligible', () => {
  const input = { repo, tag, run, release, tagSha: sha, artifacts: [artifact, sourceArtifact] }
  assert.deepEqual(macosSupplementDecision(input), { macosName, oldNames })
  assert.deepEqual(macosSupplementDecision({ ...input, run: { ...run, head_branch: 'main' } }), { macosName, oldNames })
  for (const change of [{ conclusion: 'failure' }, { status: 'in_progress' }, { event: 'push' },
    { head_branch: '' }, { head_sha: 'invalid' }, { head_repository: { full_name: 'fork/project' } },
    { path: '.github/workflows/test.yml' }]) {
    assert.throws(() => macosSupplementDecision({ ...input, run: { ...run, ...change } }), /successful same-repository manual macOS run/)
  }
  for (const change of [{ draft: true }, { prerelease: true }, { target_commitish: 'main' }, { tag_name: 'v0.3.9' }]) {
    assert.throws(() => macosSupplementDecision({ ...input, release: { ...release, ...change } }), /existing published release/)
  }
  for (const artifacts of [[], [artifact], [sourceArtifact], [artifact, artifact, sourceArtifact],
    [artifact, sourceArtifact, sourceArtifact], [{ ...artifact, expired: true }, sourceArtifact],
    [artifact, { ...sourceArtifact, expired: true }]]) {
    assert.throws(() => macosSupplementDecision({ ...input, artifacts }), /one unexpired original/)
  }
})

test('checksum extension preserves all original bytes, resumes exactly, and rejects conflicting or duplicate rows', () => {
  const macos = { name: macosName, sha512: 'f'.repeat(128) }
  for (const ending of ['\n', '\r\n', '']) {
    const original = Buffer.from(oldNames.slice(0, 3).map(name => 'a'.repeat(128) + '  ' + name).join('\r\n') + ending)
    const extended = appendMacosChecksum(original, oldNames, macos)
    assert.ok(extended.subarray(0, original.length).equals(original))
    assert.ok(appendMacosChecksum(extended, oldNames, macos).equals(extended))
    assert.throws(() => appendMacosChecksum(extended, oldNames, { ...macos, sha512: 'b'.repeat(128) }), /does not match/)
    assert.throws(() => appendMacosChecksum(Buffer.concat([extended, Buffer.from('f'.repeat(128) + '  ' + macosName + '\n')]), oldNames, macos), /duplicate/)
  }
})

function fixture({ completed = false, checksumOnly = false, conflictingMacos = false, badRun = false,
  corruptDownload = false, mutateWindows = false, changeLatestBeforeUpload = false, unexpectedAsset = false,
  failDmgOnce = false, annotatedTag = false, changedTag = false, sourceChange = {}, compareStatus = 'ahead',
  corruptToolContent = false, extraSourceFile = false } = {}) {
  const windows = Buffer.from('original Windows installer')
  const macos = Buffer.from('original tag build macOS DMG')
  const files = new Map([
    [setupName, windows], [setupName + '.blockmap', Buffer.from('original blockmap')],
    ['latest.yml', Buffer.from(JSON.stringify({ version: '0.3.8', files: [{ url: setupName,
      size: windows.length, sha512: digest(windows, 'sha512', 'base64') }] }))],
  ])
  const originalSums = Buffer.from([...files].map(([name, bytes]) => digest(bytes) + '  ' + name).join('\r\n') + '\r\n')
  files.set('SHA512SUMS.txt', originalSums)
  if (completed || checksumOnly || conflictingMacos) files.set('SHA512SUMS.txt', appendMacosChecksum(originalSums, oldNames,
    { name: macosName, sha512: digest(conflictingMacos ? Buffer.from('different DMG') : macos) }))
  if (completed || conflictingMacos) files.set(macosName, conflictingMacos ? Buffer.from('different DMG') : macos)
  if (unexpectedAsset) files.set('unrelated.zip', Buffer.from('unrelated'))
  let nextId = 10
  let state = { ...release, assets: [...files].map(([name, bytes], index) => ({ name, id: index + 1,
    size: bytes.length, digest: 'sha256:' + digest(bytes, 'sha256') })) }
  const originalAssets = structuredClone(state.assets)
  const calls = []
  let reads = 0
  let mirrorCalls = 0
  let failedDmg = false
  const request = async path => {
    calls.push(['request', path])
    if (path.endsWith('/releases/tags/' + tag)) { reads += 1; return structuredClone(state) }
    if (path.endsWith('/git/ref/tags/' + tag)) return { ref: 'refs/tags/' + tag,
      object: { type: annotatedTag ? 'tag' : 'commit', sha: changedTag && reads >= 2 ? 'b'.repeat(40) : annotatedTag ? 'c'.repeat(40) : sha } }
    if (path.endsWith('/git/tags/' + 'c'.repeat(40))) return { object: { type: 'commit', sha } }
    if (path.endsWith('/releases/latest')) return changeLatestBeforeUpload && reads >= 2 ? { id: 55, tag_name: 'v0.3.9' } : { id: release.id, tag_name: tag }
    if (path.endsWith('/actions/runs/42')) return structuredClone({ ...run, ...(badRun ? { event: 'push' } : {}) })
    if (path.includes('/actions/runs/42/artifacts?')) return { artifacts: [artifact, sourceArtifact] }
    if (path.endsWith('/compare/' + toolingSha + '...main')) return { status: compareStatus }
    for (const [toolPath, bytes] of toolSources) {
      if (path.endsWith('/contents/' + toolPath + '?ref=' + toolingSha)) return { type: 'file', path: toolPath,
        encoding: 'base64', size: bytes.length, content: (corruptToolContent ? Buffer.from('wrong source') : bytes).toString('base64') }
    }
    throw new Error('Unexpected request ' + path)
  }
  const gh = async args => {
    calls.push(['gh', args])
    if (args[0] === 'run') {
      const directory = args[args.indexOf('--dir') + 1]
      await mkdir(directory, { recursive: true })
      if (args[args.indexOf('--name') + 1] === sourceArtifact.name) {
        await writeFile(join(directory, 'macos-build-source.json'), JSON.stringify({ ...buildSource, ...sourceChange }))
        if (extraSourceFile) await writeFile(join(directory, 'unexpected.txt'), 'unexpected')
      } else await writeFile(join(directory, macosName), macos)
      return
    }
    if (args[1] === 'download') {
      const directory = args[args.indexOf('--dir') + 1]
      await mkdir(directory, { recursive: true })
      const patterns = args.flatMap((arg, i) => arg === '--pattern' ? [args[i + 1]] : [])
      for (const [name, bytes] of files) if (!patterns.length || patterns.includes(name)) {
        await writeFile(join(directory, name), corruptDownload && name === setupName ? Buffer.from('corrupt') : bytes)
      }
      return
    }
    assert.equal(args[1], 'upload')
    const name = basename(args[3])
    const bytes = await readFile(args[3])
    assert.ok(['SHA512SUMS.txt', macosName].includes(name), 'Windows uploads are forbidden')
    assert.equal(args.includes('--clobber'), name === 'SHA512SUMS.txt')
    if (name === macosName) {
      assert.match(files.get('SHA512SUMS.txt').toString(), new RegExp(digest(macos) + '  ' + macosName))
      if (failDmgOnce && !failedDmg) { failedDmg = true; throw new Error('DMG upload interrupted') }
      assert.ok(!files.has(name), 'Existing DMG must never be replaced')
    }
    files.set(name, bytes)
    state.assets = state.assets.filter(asset => asset.name !== name)
    state.assets.push({ name, id: nextId++, size: bytes.length, digest: 'sha256:' + digest(bytes, 'sha256') })
    if (mutateWindows) state.assets.find(asset => asset.name === setupName).id = 999
  }
  const mirror = async options => {
    mirrorCalls += 1
    calls.push(['mirror'])
    assert.equal(options.sha, sha)
    assert.equal(options.repo, 'mirror/project')
    assert.deepEqual(options.expectedMacos, { name: macosName, size: macos.length, sha512: digest(macos) })
    for (const [name, bytes] of files) assert.ok((await readFile(join(options.directory, name))).equals(bytes))
    return { url: 'https://cnb.cool/mirror/project/-/releases/tag/' + tag }
  }
  return { options: { repo, runId: '42', tag, request, gh, mirror, mirrorRequest: () => {}, mirrorRepo: 'mirror/project', output: () => {} },
    calls, files, originalSums, originalAssets, get state() { return state }, get mirrorCalls() { return mirrorCalls },
    uploads: () => calls.filter(([type, args]) => type === 'gh' && args[1] === 'upload').map(([, args]) => basename(args[3])) }
}

test('supplement publishes checksum before missing DMG, protects Windows bytes and IDs, then mirrors final five files', async () => {
  const f = fixture()
  const result = await supplementMacosRelease(f.options)
  assert.deepEqual(f.uploads(), ['SHA512SUMS.txt', macosName])
  assert.equal(result.sha, sha)
  assert.equal(f.mirrorCalls, 1)
  assert.ok(f.files.get('SHA512SUMS.txt').subarray(0, f.originalSums.length).equals(f.originalSums))
  assert.deepEqual(f.state.assets.filter(asset => oldNames.slice(0, 3).includes(asset.name)), f.originalAssets.slice(0, 3))
  assert.ok(f.calls.findIndex(([type]) => type === 'mirror') > f.calls.findLastIndex(([type, args]) => type === 'gh' && args[1] === 'upload'))
})

test('interrupted DMG upload resumes existing checksum bytes; fully supplemented rerun performs zero GitHub uploads', async () => {
  const f = fixture({ failDmgOnce: true })
  await assert.rejects(supplementMacosRelease(f.options), /DMG upload interrupted/)
  assert.equal(f.mirrorCalls, 0)
  const sums = Buffer.from(f.files.get('SHA512SUMS.txt'))
  const start = f.uploads().length
  await supplementMacosRelease(f.options)
  assert.deepEqual(f.uploads().slice(start), [macosName])
  assert.ok(f.files.get('SHA512SUMS.txt').equals(sums))
  const complete = fixture({ completed: true })
  await supplementMacosRelease(complete.options)
  assert.deepEqual(complete.uploads(), [])
  assert.equal(complete.mirrorCalls, 1)
})

test('foreign run, conflicting DMG, corrupted Windows download, extra asset and changed latest reject before uploading', async () => {
  for (const input of [{ badRun: true }, { conflictingMacos: true }, { corruptDownload: true },
    { unexpectedAsset: true }, { changeLatestBeforeUpload: true }, { changedTag: true }]) {
    const f = fixture(input)
    await assert.rejects(supplementMacosRelease(f.options))
    assert.deepEqual(f.uploads(), [], JSON.stringify(input))
    assert.equal(f.mirrorCalls, 0)
  }
})

test('an existing annotated tag resolves its actual commit without accepting an ambiguous branch name', async () => {
  const f = fixture({ annotatedTag: true })
  assert.equal((await supplementMacosRelease(f.options)).sha, sha)
  assert.ok(f.calls.some(([type, path]) => type === 'request' && path.endsWith('/git/tags/' + 'c'.repeat(40))))
  assert.ok(!f.calls.some(([type, path]) => type === 'request' && path.includes('/commits/')))
})

test('post-upload Windows asset identity changes prevent mirror publication', async () => {
  const f = fixture({ mutateWindows: true })
  await assert.rejects(supplementMacosRelease(f.options), /Published asset changed/)
  assert.equal(f.mirrorCalls, 0)
})

test('source provenance binds tag, tooling commit, only the two build tools and their exact reviewed main bytes before any upload', async () => {
  const mutations = [
    { sourceChange: { schemaVersion: 2 } }, { sourceChange: { sourceTag: 'v0.3.9' } },
    { sourceChange: { sourceSha: 'c'.repeat(40) } }, { sourceChange: { toolingSha: sha } },
    { sourceChange: { buildTools: [buildSource.buildTools[0], buildSource.buildTools[0]] } },
    { sourceChange: { buildTools: [buildSource.buildTools[0], { path: 'src/main/index.js', sha256: 'c'.repeat(64) }] } },
    { sourceChange: { buildTools: buildSource.buildTools.map(tool => ({ ...tool, sha256: 'c'.repeat(64) })) } },
    { compareStatus: 'behind' }, { compareStatus: 'diverged' }, { corruptToolContent: true }, { extraSourceFile: true },
  ]
  for (const input of mutations) {
    const f = fixture(input)
    await assert.rejects(supplementMacosRelease(f.options))
    assert.deepEqual(f.uploads(), [], JSON.stringify(input))
    assert.equal(f.mirrorCalls, 0)
    assert.ok(!f.calls.some(([type, args]) => type === 'gh' && args[0] === 'release'), 'Reject provenance before downloading published Windows assets')
  }
  const identical = fixture({ compareStatus: 'identical' })
  await supplementMacosRelease(identical.options)
  assert.deepEqual(identical.uploads(), ['SHA512SUMS.txt', macosName])
})
