import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, basename } from 'node:path'
import { releaseDecision, publish } from './publish-release.mjs'

const sha = 'a'.repeat(40)
const repo = 'owner/project'
const run = { status: 'completed', conclusion: 'success', path: '.github/workflows/test.yml', head_branch: 'main',
  head_repository: { full_name: repo }, event: 'push', head_sha: sha, html_url: 'https://github.com/owner/project/actions/runs/12' }
const artifact = { name: 'Whale-Isle-windows-x64', expired: false }
const macosArtifact = { name: 'Whale-Isle-macos-arm64', expired: false }
const state = () => ({ run: { ...run }, repo, sha, version: '1.2.3', latest: { tag_name: 'v1.2.2' }, existing: null, artifacts: [artifact, macosArtifact] })

test('only a successful matching main build may publish', () => {
  assert.deepEqual(releaseDecision(state()), { tag: 'v1.2.3', macos: true })
  for (const change of [{ conclusion: 'failure' }, { conclusion: 'cancelled' }, { status: 'in_progress' },
    { event: 'pull_request' }, { head_branch: 'feature' }, { head_sha: 'b'.repeat(40) },
    { head_repository: { full_name: 'fork/project' } }, { path: '.github/workflows/old.yml' }]) {
    assert.throws(() => releaseDecision({ ...state(), run: { ...run, ...change } }), /successful main/)
  }
})
test('same or older versions never replace a published release', () => {
  assert.match(releaseDecision({ ...state(), existing: { draft: false } }).skip, /already published/)
  assert.match(releaseDecision({ ...state(), latest: { tag_name: 'v1.3.0' } }).skip, /not newer/)
  assert.equal(releaseDecision({ ...state(), latest: null }).tag, 'v1.2.3')
})
test('a non-desktop latest tag never breaks the version comparison', () => {
  for (const tagName of ['whalebridge-v1.1.0', 'android-v2', 'nightly']) {
    assert.deepEqual(releaseDecision({ ...state(), latest: { tag_name: tagName } }), { tag: 'v1.2.3', macos: true })
    assert.equal(releaseDecision({ ...state(), latest: { tag_name: tagName }, artifacts: [artifact] }).macos, false)
  }
})
test('a version bump without a macOS installer is refused instead of publishing Windows-only', () => {
  assert.throws(() => releaseDecision({ ...state(), artifacts: [artifact] }), /macOS installer/)
  assert.throws(() => releaseDecision({ ...state(), artifacts: [artifact, { ...macosArtifact, expired: true }] }), /macOS installer/)
  assert.equal(releaseDecision({ ...state(), artifacts: [artifact, { ...macosArtifact, expired: false }] }).macos, true)
  // The first published desktop release has no predecessor to supersede.
  assert.equal(releaseDecision({ ...state(), latest: null, artifacts: [artifact] }).macos, false)
})
test('a Windows-only publish needs windowsOnlyTag to equal the version tag exactly', () => {
  const windowsOnly = { ...state(), artifacts: [artifact] }
  assert.throws(() => releaseDecision(windowsOnly), /macOS installer/)
  assert.deepEqual(releaseDecision({ ...windowsOnly, windowsOnlyTag: 'v1.2.3' }), { tag: 'v1.2.3', macos: false })
  assert.throws(() => releaseDecision({ ...windowsOnly, windowsOnlyTag: 'v9.9.9' }), /macOS installer/)
})
test('documentation-only builds skip publishing; expired and foreign drafts do not pass', () => {
  assert.match(releaseDecision({ ...state(), artifacts: [] }).skip, /no installer/)
  assert.throws(() => releaseDecision({ ...state(), artifacts: [{ ...artifact, expired: true }] }), /expired/)
  assert.throws(() => releaseDecision({ ...state(), existing: { draft: true, target_commitish: 'b'.repeat(40) } }), /another commit/)
})

function fixture(t, { corrupt = false, failUpload = false, existing = null, tagSha = null, macos = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'publish-test-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, '.github'))
  writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '1.2.3' }))
  writeFileSync(join(root, '.github/release-notes.md'), '中文发布说明')
  writeFileSync(join(root, '.github/release-notes.en.md'), 'Release notes')
  const bytes = Buffer.from('installer bytes')
  const setupName = 'Whale-Isle-Setup-1.2.3.exe'
  const dmgName = 'Whale-Isle-1.2.3-mac-arm64.dmg'
  const sha512 = createHash('sha512').update(bytes).digest('base64')
  const calls = []
  const downloads = []
  let uploadedSums
  const releases = [
    { tag_name: 'whalebridge-v9.9.9', draft: false, prerelease: false },
    { tag_name: 'v1.2.2', draft: false, prerelease: false },
    ...(existing ? [{ ...existing, tag_name: 'v1.2.3' }] : []),
  ]
  const request = async (path, options = {}) => {
    calls.push([path, options])
    if (path.endsWith('/actions/runs/12')) return run
    if (path.includes('/releases?')) return releases
    if (path.includes('/artifacts?')) return { artifacts: macos ? [artifact, macosArtifact] : [artifact] }
    if (path.endsWith('/git/ref/tags/v1.2.3')) return tagSha ? { ref: 'refs/tags/v1.2.3' } : null
    if (path.endsWith('/commits/v1.2.3')) {
      if (!tagSha) throw new Error('GitHub commits API returns HTTP 422 for a missing tag')
      return { sha: tagSha }
    }
    if (options.method === 'POST') {
      assert.equal(options.body.draft, true)
      assert.equal(options.body.target_commitish, sha)
      return { id: 7, draft: true, target_commitish: sha }
    }
    if (options.method === 'PATCH') return { html_url: 'https://github.com/owner/project/releases/tag/v1.2.3' }
    throw new Error('Unexpected request ' + path)
  }
  const gh = args => {
    calls.push(['gh', args])
    if (args[0] === 'run') {
      const directory = args[args.indexOf('--dir') + 1]
      downloads.push(directory)
      mkdirSync(directory, { recursive: true })
      if (args[args.indexOf('--name') + 1] === 'Whale-Isle-macos-arm64') {
        writeFileSync(join(directory, dmgName), 'dmg bytes')
        return
      }
      writeFileSync(join(directory, setupName), corrupt ? 'changed bytes' : bytes)
      writeFileSync(join(directory, setupName + '.blockmap'), 'blockmap')
      writeFileSync(join(directory, 'latest.yml'), JSON.stringify({ version: '1.2.3', files: [{ url: setupName, sha512, size: bytes.length }] }))
    } else {
      if (failUpload) throw new Error('upload interrupted')
      const sumsPath = args.find(a => basename(a) === 'SHA512SUMS.txt')
      uploadedSums = readFileSync(sumsPath, 'utf8')
      copyFileSync(sumsPath, join(root, 'uploaded-SHA512SUMS.txt'))
    }
  }
  t.after(() => {
    for (const path of downloads) rmSync(join(path, '..'), { recursive: true, force: true })
  })
  return { options: { repo, runId: '12', request, gh, sha, root, output: () => {} }, calls, sums: () => uploadedSums }
}
test('actual publication path validates bytes, emits updater checksums and uploads before making public', async t => {
  const f = fixture(t)
  const result = await publish(f.options)
  assert.match(result.url, /v1.2.3$/)
  assert.equal(result.sha256, createHash('sha256').update('installer bytes').digest('hex'))
  assert.match(f.sums(), new RegExp(createHash('sha512').update('installer bytes').digest('hex') + '  Whale-Isle-Setup-1.2.3.exe'))
  assert.match(f.sums(), new RegExp(createHash('sha512').update('dmg bytes').digest('hex') + '  Whale-Isle-1.2.3-mac-arm64.dmg'))
  const upload = f.calls.findIndex(([name, args]) => name === 'gh' && args[0] === 'release')
  const makePublic = f.calls.findIndex(([, o]) => o.method === 'PATCH')
  assert.ok(upload >= 0 && makePublic > upload)
  const body = f.calls.find(([, o]) => o.method === 'PATCH')[1].body.body
  assert.match(body, /^中文发布说明\n\n<details>\n<summary>English<\/summary>\n\nRelease notes\n\n<\/details>/)
  assert.doesNotMatch(body, /Source:|Build:|Setup SHA256:/)
  assert.ok(f.calls.some(([path, options]) => path.endsWith('/git/ref/tags/v1.2.3') && options.missing))
  assert.ok(!f.calls.some(([path]) => path.endsWith('/commits/v1.2.3')))
})

test('a version bump whose CI run has no macOS artifact is refused before any upload', async t => {
  const f = fixture(t, { macos: false })
  await assert.rejects(publish(f.options), /macOS installer/)
  assert.ok(!f.calls.some(([name, args]) => name === 'gh' && args[0] === 'release'))
  assert.ok(!f.calls.some(([, o]) => o.method === 'POST'))
})

test('an existing matching tag resolves its commit and may resume publication', async t => {
  const f = fixture(t, { tagSha: sha })
  assert.match((await publish(f.options)).url, /v1.2.3$/)
  assert.ok(f.calls.some(([path]) => path.endsWith('/commits/v1.2.3')))
})
test('corrupt assets and a tag on another commit never upload', async t => {
  for (const input of [{ corrupt: true }, { tagSha: 'b'.repeat(40) }]) {
    const f = fixture(t, input)
    await assert.rejects(publish(f.options))
    assert.ok(!f.calls.some(([name, args]) => name === 'gh' && args[0] === 'release'))
    assert.ok(!f.calls.some(([, o]) => o.method === 'POST'))
  }
})
test('upload failure leaves a draft; retry uses the same CI artifact and draft', async t => {
  const failing = fixture(t, { failUpload: true })
  await assert.rejects(publish(failing.options), /upload interrupted/)
  assert.ok(!failing.calls.some(([, o]) => o.method === 'PATCH'))
  const retry = fixture(t, { existing: { id: 7, draft: true, target_commitish: sha } })
  await publish(retry.options)
  assert.ok(!retry.calls.some(([, o]) => o.method === 'POST'))
  assert.ok(retry.calls.some(([name, args]) => name === 'gh' && args[0] === 'run' && args[2] === '12'))
})
