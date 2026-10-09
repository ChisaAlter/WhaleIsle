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
const state = () => ({ run: { ...run }, repo, sha, version: '1.2.3', latest: { tag_name: 'v1.2.2' }, existing: null, artifacts: [artifact] })

test('only a successful matching main build may publish', () => {
  assert.deepEqual(releaseDecision(state()), { tag: 'v1.2.3', macos: false })
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
test('documentation-only builds skip publishing; expired and foreign drafts do not pass', () => {
  assert.match(releaseDecision({ ...state(), artifacts: [] }).skip, /no installer/)
  assert.throws(() => releaseDecision({ ...state(), artifacts: [{ ...artifact, expired: true }] }), /expired/)
  assert.throws(() => releaseDecision({ ...state(), existing: { draft: true, target_commitish: 'b'.repeat(40) } }), /another commit/)
})

function fixture(t, { corrupt = false, failUpload = false, existing = null, tagSha = null } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'publish-test-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, '.github'))
  writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '1.2.3' }))
  writeFileSync(join(root, '.github/release-notes.md'), '中文发布说明')
  writeFileSync(join(root, '.github/release-notes.en.md'), 'Release notes')
  const bytes = Buffer.from('installer bytes')
  const setupName = 'Whale-Isle-Setup-1.2.3.exe'
  const sha512 = createHash('sha512').update(bytes).digest('base64')
  const calls = []
  const downloads = []
  let uploadedSums
  const request = async (path, options = {}) => {
    calls.push([path, options])
    if (path.endsWith('/actions/runs/12')) return run
    if (path.endsWith('/releases/latest')) return { tag_name: 'v1.2.2' }
    if (path.includes('/releases?')) return existing ? [{ ...existing, tag_name: 'v1.2.3' }] : []
    if (path.includes('/artifacts?')) return { artifacts: [artifact] }
    if (path.endsWith('/commits/v1.2.3')) return tagSha ? { sha: tagSha } : null
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
  const upload = f.calls.findIndex(([name, args]) => name === 'gh' && args[0] === 'release')
  const makePublic = f.calls.findIndex(([, o]) => o.method === 'PATCH')
  assert.ok(upload >= 0 && makePublic > upload)
  const body = f.calls.find(([, o]) => o.method === 'PATCH')[1].body.body
  assert.match(body, /^中文发布说明\n\n<details>\n<summary>English<\/summary>\n\nRelease notes\n\n<\/details>/)
  assert.doesNotMatch(body, /Source:|Build:|Setup SHA256:/)
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
