import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { load } from 'js-yaml'
import { giteeClient, mirrorRelease, syncSource } from './sync-gitee.mjs'

const sha = 'a'.repeat(40)
const digest = (bytes, algo = 'sha512', encoding = 'hex') => createHash(algo).update(bytes).digest(encoding)
function fixture(t, { existing = null, uploaded = [], corruptRemote = false, failUpload = false, tagSha = sha } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'gitee-mirror-test-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const name = 'Whale-Isle-Setup-1.2.3.exe'
  const bytes = new Map([[name, Buffer.from('installer')], [name + '.blockmap', Buffer.from('blockmap')]])
  bytes.set('latest.yml', Buffer.from(JSON.stringify({ version: '1.2.3', files: [{ url: name, size: bytes.get(name).length, sha512: digest(bytes.get(name), 'sha512', 'base64') }] })))
  bytes.set('SHA512SUMS.txt', Buffer.from([...bytes].map(([n, b]) => digest(b) + '  ' + n).join('\n') + '\n'))
  for (const [n, b] of bytes) writeFileSync(join(directory, n), b)
  const release = { tag_name: 'v1.2.3', name: 'Whale Isle', body: 'Release notes', prerelease: false, draft: false,
    assets: [...bytes].map(([n, b]) => ({ name: n, size: b.length, digest: 'sha256:' + digest(b, 'sha256') })) }
  const asset = name => ({ id: 7, name, browser_download_url: 'https://gitee.com/ayase/project/releases/download/v1.2.3/' + name })
  const calls = []
  const request = async (path, options = {}) => {
    calls.push([path, options])
    if (path.includes('/tags?')) return [{ name: release.tag_name, commit: { sha: tagSha } }]
    if (path.includes('/releases/tags/')) return existing
    if (options.file) {
      if (failUpload) throw new Error('upload interrupted')
      return asset(basename(options.file))
    }
    if (options.method === 'POST') return { id: 9, prerelease: options.body.prerelease }
    if (options.method === 'PATCH') return { id: 9, prerelease: options.body.prerelease }
    if (path.includes('/attach_files?')) return uploaded.map(asset)
    throw new Error('Unexpected request ' + path)
  }
  const fetchImpl = async (url, options) => {
    assert.equal(options.headers, undefined, 'attachment verification must be anonymous')
    const name = basename(new URL(url).pathname)
    calls.push(['download', name])
    return new Response(corruptRemote ? Buffer.from('wrong') : bytes.get(name))
  }
  return { options: { release, directory, sha, request, fetchImpl, output: () => {} }, calls, bytes }
}

test('stages original bytes and promotes only after every anonymous checksum passes', async t => {
  const f = fixture(t)
  const result = await mirrorRelease(f.options)
  assert.equal(result.assets, 4)
  const create = f.calls.find(([, o]) => o.method === 'POST' && !o.file)
  assert.equal(create[1].body.prerelease, true)
  assert.equal(create[1].body.target_commitish, sha)
  assert.equal(f.calls.filter(([p]) => p === 'download').length, 4)
  assert.equal(f.calls.at(-1)[1].body.prerelease, false)
})

test('partial mirrors resume missing files; published mirrors are verified without rewriting', async t => {
  const f = fixture(t, { existing: { id: 9, prerelease: true }, uploaded: ['latest.yml'] })
  await mirrorRelease(f.options)
  assert.equal(f.calls.filter(([, o]) => o.file).length, 3)
  assert.ok(!f.calls.some(([, o]) => o.method === 'POST' && !o.file))
  const published = fixture(t, { existing: { id: 9, prerelease: false } })
  await assert.rejects(mirrorRelease(published.options), /incomplete/)
  assert.ok(!published.calls.some(([, o]) => o.method))
  const complete = fixture(t, { existing: { id: 9, prerelease: false }, uploaded: [...published.bytes.keys()] })
  await mirrorRelease(complete.options)
  assert.ok(!complete.calls.some(([, o]) => o.method))
})

test('interrupted uploads or corrupt anonymous bytes never promote the staged release', async t => {
  for (const changes of [{ failUpload: true }, { corruptRemote: true }]) {
    const f = fixture(t, changes)
    await assert.rejects(mirrorRelease(f.options), /interrupted|mismatch/)
    assert.ok(!f.calls.some(([, o]) => o.method === 'PATCH'))
  }
})

test('source tag, GitHub digest and checksum manifest are checked before Gitee writes', async t => {
  const badTag = fixture(t, { tagSha: 'b'.repeat(40) })
  await assert.rejects(mirrorRelease(badTag.options), /source/)
  const badDigest = fixture(t)
  writeFileSync(join(badDigest.options.directory, 'Whale-Isle-Setup-1.2.3.exe'), 'tampering')
  await assert.rejects(mirrorRelease(badDigest.options), /digest/)
  const badSums = fixture(t)
  const sums = Buffer.from([...badSums.bytes].filter(([name]) => name !== 'SHA512SUMS.txt').map(([name]) => '0'.repeat(128) + '  ' + name).join('\n') + '\n')
  writeFileSync(join(badSums.options.directory, 'SHA512SUMS.txt'), sums)
  Object.assign(badSums.options.release.assets.find(a => a.name === 'SHA512SUMS.txt'), { size: sums.length, digest: 'sha256:' + digest(sums, 'sha256') })
  await assert.rejects(mirrorRelease(badSums.options), /manifest/)
  for (const f of [badTag, badDigest, badSums]) assert.ok(!f.calls.some(([, o]) => o.method))
})

test('Gitee API transport uses the documented JSON and multipart fields without logging tokens', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'gitee-client-test-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const file = join(directory, 'asset.bin')
  writeFileSync(file, 'asset bytes')
  const seen = []
  const client = giteeClient('secret-value', async (url, options) => {
    seen.push([url, options])
    return new Response('{}', { status: 201 })
  })
  await client('/user')
  await client('/repos/a/b/releases', { method: 'POST', body: { prerelease: true } })
  await client('/repos/a/b/releases/1/attach_files', { method: 'POST', file })
  assert.equal(seen[0][0].searchParams.get('access_token'), 'secret-value')
  assert.equal(JSON.parse(seen[1][1].body).access_token, 'secret-value')
  assert.equal(seen[2][1].body.get('access_token'), 'secret-value')
  assert.equal(await seen[2][1].body.get('file').text(), 'asset bytes')
  const failed = giteeClient('secret-value', async () => { throw new Error('https://gitee.com/?access_token=secret-value') })
  await assert.rejects(failed('/user'), error => !error.message.includes('secret-value'))
  assert.throws(() => giteeClient(''), /GITEE_TOKEN/)
})

test('source mirror pushes real main and tags, and rejects diverged main without force', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'gitee-git-test-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const source = join(directory, 'source')
  const target = join(directory, 'target.git')
  const exec = args => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  exec(['init', '--initial-branch=main', source])
  exec(['init', '--bare', target])
  exec(['-C', source, 'config', 'user.email', 'mirror@example.test'])
  exec(['-C', source, 'config', 'user.name', 'Mirror test'])
  exec(['-C', source, 'commit', '--allow-empty', '-m', 'main'])
  const head = exec(['-C', source, 'rev-parse', 'HEAD'])
  exec(['-C', source, 'update-ref', 'refs/remotes/origin/main', head])
  exec(['-C', source, 'tag', 'v1.2.3'])
  const git = (args, options) => {
    assert.ok(!args.includes('--force'))
    const askpass = args.find(a => a.startsWith('core.askPass=')).slice('core.askPass='.length)
    assert.ok(!readFileSync(askpass, 'utf8').includes('secret-value'))
    execFileSync('git', ['-C', source, ...args.map(a => a.startsWith('https://gitee.com/') ? target : a)], options)
  }
  await syncSource({ token: 'secret-value', username: 'user', git })
  assert.equal(exec(['--git-dir=' + target, 'rev-parse', 'main']), head)
  assert.equal(exec(['--git-dir=' + target, 'rev-parse', 'v1.2.3']), head)
  exec(['-C', source, 'checkout', '--orphan', 'divergent'])
  exec(['-C', source, 'commit', '--allow-empty', '-m', 'divergent'])
  exec(['-C', source, 'push', target, 'HEAD:main', '--force'])
  const remoteHead = exec(['--git-dir=' + target, 'rev-parse', 'main'])
  await assert.rejects(syncSource({ token: 'secret-value', username: 'user', git }), /push failed/)
  assert.equal(exec(['--git-dir=' + target, 'rev-parse', 'main']), remoteHead)
})

test('workflow covers main pushes, automatic-token releases and manual backfill without rebuilding', () => {
  const workflow = load(readFileSync(new URL('../.github/workflows/gitee-mirror.yml', import.meta.url), 'utf8'))
  assert.deepEqual(workflow.on.push.branches, ['main'])
  assert.deepEqual(workflow.on.workflow_run.workflows, ['Release'])
  assert.deepEqual(workflow.on.release.types, ['published'])
  assert.ok(workflow.on.workflow_dispatch.inputs.tag)
  assert.equal(workflow.concurrency['cancel-in-progress'], false)
  const steps = workflow.jobs.sync.steps
  assert.equal(steps[0].with['fetch-depth'], 0)
  assert.equal(steps.at(-1).env.GITEE_TOKEN, '${{ secrets.GITEE_TOKEN }}')
  assert.ok(!steps.some(step => /npm (test|run (dist|setup:harness))/.test(step.run || '')))
})
