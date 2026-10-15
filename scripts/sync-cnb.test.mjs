import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { load } from 'js-yaml'
import { cnbClient, mirrorRelease, supplementMacosMirror, syncSource, validateMirrorAssets } from './sync-cnb.mjs'

test('component mirror validates native bytes against the component manifest', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'cnb-component-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const binary = Buffer.from('component')
  const manifest = { id: 'whalebridge', version: '1.0.0', license: 'MIT License', platforms: { 'win32-x64': {
    asset: 'WhaleBridge-win32-x64.exe', size: binary.length, sha256: createHash('sha256').update(binary).digest('hex'),
  } } }
  const bytes = Buffer.from(JSON.stringify(manifest))
  writeFileSync(join(directory, 'WhaleBridge-component.json'), bytes)
  writeFileSync(join(directory, 'WhaleBridge-win32-x64.exe'), binary)
  const release = { tag_name: 'whalebridge-v1.0.0', assets: [
    { name: 'WhaleBridge-component.json', size: bytes.length }, { name: 'WhaleBridge-win32-x64.exe', size: binary.length },
  ] }
  assert.equal((await validateMirrorAssets(release, directory)).length, 2)
  writeFileSync(join(directory, 'WhaleBridge-win32-x64.exe'), Buffer.from('tampered!'))
  await assert.rejects(validateMirrorAssets(release, directory), /manifest mismatch/)
})

const repo = 'ayasealter/WhaleIsle'
const sha = 'a'.repeat(40)
const digest = (bytes, algo = 'sha512', encoding = 'hex') => createHash(algo).update(bytes).digest(encoding)
function fixture(t, { existing = null, uploaded = [], corruptRemote = false, failUpload = false, tagSha = sha, latest = null } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'cnb-mirror-test-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const name = 'Whale-Isle-Setup-1.2.3.exe'
  const bytes = new Map([[name, Buffer.from('installer')], [name + '.blockmap', Buffer.from('blockmap')]])
  bytes.set('latest.yml', Buffer.from(JSON.stringify({ version: '1.2.3', files: [{ url: name, size: bytes.get(name).length, sha512: digest(bytes.get(name), 'sha512', 'base64') }] })))
  bytes.set('SHA512SUMS.txt', Buffer.from([...bytes].map(([n, b]) => digest(b) + '  ' + n).join('\n') + '\n'))
  for (const [n, b] of bytes) writeFileSync(join(directory, n), b)
  const release = { tag_name: 'v1.2.3', name: 'Whale Isle', body: 'Release notes', prerelease: false, draft: false,
    assets: [...bytes].map(([n, b]) => ({ name: n, size: b.length, digest: 'sha256:' + digest(b, 'sha256') })) }
  const asset = name => ({ id: name, name, browser_download_url: 'https://cnb.cool/' + repo + '/-/releases/download/v1.2.3/' + name })
  const calls = []
  let target = existing ? { draft: false, ...existing, assets: uploaded.map(asset) } : null
  const request = async (path, options = {}) => {
    calls.push([path, options])
    if (path.includes('/git/tags/')) return { name: release.tag_name, commit: { sha: tagSha } }
    if (path.endsWith('/releases/latest')) return latest
    if (path.includes('/releases/tags/')) return target
    if (path.endsWith('/asset-upload-url')) return { upload_url: 'https://storage.example/' + options.body.asset_name, verify_url: 'https://api.cnb.cool/' + repo + '/-/releases/9/asset-upload-confirmation/' + options.body.asset_name }
    if (path.includes('/asset-upload-confirmation/')) {
      target.assets.push(asset(basename(new URL('https://api.cnb.cool' + path).pathname)))
      return null
    }
    if (options.method === 'POST') {
      target = { id: '9', draft: false, prerelease: options.body.prerelease, assets: [] }
      return { ...target, assets: null }
    }
    if (options.method === 'PATCH') { Object.assign(target, options.body); return null }
    if (path.endsWith('/releases/9')) return target
    throw new Error('Unexpected request ' + path)
  }
  const fetchImpl = async (url, options) => {
    assert.equal(options.headers, undefined, 'storage upload and attachment verification must not send credentials')
    const name = basename(new URL(url).pathname)
    if (options.method === 'PUT') {
      calls.push(['upload', name])
      if (failUpload) throw new Error('upload interrupted')
      assert.deepEqual(Buffer.from(await options.body.arrayBuffer()), bytes.get(name))
      return new Response(null, { status: 200 })
    }
    calls.push(['download', name])
    return new Response(corruptRemote ? Buffer.from('wrong') : bytes.get(name))
  }
  return { options: { release, directory, sha, request, fetchImpl, repo, output: () => {} }, calls, bytes }
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
  assert.equal(f.calls.filter(([p]) => p === 'upload').length, 3)
  assert.ok(!f.calls.some(([p, o]) => p.endsWith('/releases') && o.method === 'POST'))
  const published = fixture(t, { existing: { id: 9, prerelease: false } })
  await assert.rejects(mirrorRelease(published.options), /incomplete/)
  assert.ok(!published.calls.some(([, o]) => o.method))
  const complete = fixture(t, { existing: { id: 9, prerelease: false }, uploaded: [...published.bytes.keys()] })
  await mirrorRelease(complete.options)
  assert.ok(!complete.calls.some(([, o]) => o.method))
})

test('backfilling an older stable release preserves the newer latest version', async t => {
  const f = fixture(t, { latest: { tag_name: 'v2.0.0' } })
  await mirrorRelease(f.options)
  assert.equal(f.calls.at(-1)[1].body.make_latest, 'false')
})

test('interrupted uploads or corrupt anonymous bytes never promote the staged release', async t => {
  for (const changes of [{ failUpload: true }, { corruptRemote: true }]) {
    const f = fixture(t, changes)
    await assert.rejects(mirrorRelease(f.options), /upload failed|mismatch/)
    assert.ok(!f.calls.some(([, o]) => o.method === 'PATCH'))
  }
})

test('source tag, GitHub digest and checksum manifest are checked before CNB writes', async t => {
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

test('CNB API uses bearer JSON, supports empty confirmations and never logs signed URLs or tokens', async () => {
  const seen = []
  const client = cnbClient('secret-value', async (url, options) => {
    seen.push([url, options])
    return new Response(options.method === 'PATCH' ? null : '{}', { status: 200 })
  })
  await client('/a/b/-/releases')
  await client('/a/b/-/releases', { method: 'POST', body: { prerelease: true } })
  assert.equal(await client('/a/b/-/releases/1', { method: 'PATCH', body: { prerelease: false } }), null)
  assert.equal(seen[0][0].origin, 'https://api.cnb.cool')
  assert.equal(seen[0][1].headers.Authorization, 'Bearer secret-value')
  assert.equal(seen[0][1].headers.Accept, 'application/vnd.cnb.api+json')
  assert.deepEqual(JSON.parse(seen[1][1].body), { prerelease: true })
  const failed = cnbClient('secret-value', async () => { throw new Error('signed URL secret-value') })
  await assert.rejects(failed('/a/b/-/releases'), error => !error.message.includes('secret-value'))
  assert.throws(() => cnbClient(''), /CNB_TOKEN/)
})

test('source mirror pushes real main and tags, and rejects diverged main without force', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'cnb-git-test-'))
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
    execFileSync('git', ['-C', source, ...args.map(a => a.startsWith('https://cnb.cool/') ? target : a)], options)
  }
  await syncSource({ token: 'secret-value', repo, git })
  assert.equal(exec(['--git-dir=' + target, 'rev-parse', 'main']), head)
  assert.equal(exec(['--git-dir=' + target, 'rev-parse', 'v1.2.3']), head)
  exec(['-C', source, 'checkout', '--orphan', 'divergent'])
  exec(['-C', source, 'commit', '--allow-empty', '-m', 'divergent'])
  exec(['-C', source, 'push', target, 'HEAD:main', '--force'])
  const remoteHead = exec(['--git-dir=' + target, 'rev-parse', 'main'])
  await assert.rejects(syncSource({ token: 'secret-value', repo, git }), /push failed/)
  assert.equal(exec(['--git-dir=' + target, 'rev-parse', 'main']), remoteHead)
})

test('workflow covers main pushes, automatic-token releases and manual backfill without rebuilding', () => {
  const workflow = load(readFileSync(new URL('../.github/workflows/cnb-mirror.yml', import.meta.url), 'utf8'))
  assert.deepEqual(workflow.on.push.branches, ['main'])
  assert.deepEqual(workflow.on.workflow_run.workflows, ['Release'])
  assert.deepEqual(workflow.on.release.types, ['published'])
  assert.ok(workflow.on.workflow_dispatch.inputs.tag)
  assert.equal(workflow.concurrency['cancel-in-progress'], false)
  const steps = workflow.jobs.sync.steps
  assert.equal(steps[0].with['fetch-depth'], 0)
  assert.equal(steps.at(-1).env.CNB_TOKEN, '${{ secrets.CNB_TOKEN }}')
  assert.ok(!steps.some(step => /npm (test|run (dist|setup:harness))/.test(step.run || '')))
})

function supplementFixture(t, { complete = false, checksumOnly = false } = {}) {
  const base = fixture(t)
  const { release, directory } = base.options
  const remoteBytes = new Map(base.bytes)
  const windows = [...remoteBytes.keys()].filter(name => name !== 'SHA512SUMS.txt')
  const macName = 'Whale-Isle-1.2.3-mac-arm64.dmg'
  const macBytes = Buffer.from('verified Mac installer')
  const sums = Buffer.concat([base.bytes.get('SHA512SUMS.txt'), Buffer.from(digest(macBytes) + '  ' + macName + '\n')])
  base.bytes.set(macName, macBytes)
  base.bytes.set('SHA512SUMS.txt', sums)
  for (const [name, bytes] of base.bytes) writeFileSync(join(directory, name), bytes)
  release.target_commitish = sha
  release.assets = [...base.bytes].map(([name, bytes]) => ({ name, size: bytes.length, digest: 'sha256:' + digest(bytes, 'sha256') }))
  if (complete || checksumOnly) remoteBytes.set('SHA512SUMS.txt', sums)
  if (complete) remoteBytes.set(macName, macBytes)
  const ids = new Map([...remoteBytes.keys()].map(name => [name, 'original-' + name]))
  const state = { id: '9', tag_name: release.tag_name, name: 'Published title', body: 'Published notes', draft: false, prerelease: false }
  const latest = { id: '10', tag_name: 'v2.0.0' }
  const target = () => ({ ...state, assets: [...remoteBytes].map(([name, bytes]) => ({
    id: ids.get(name) || 'extra-' + name, name, size: bytes.length, digest: 'sha256:' + digest(bytes, 'sha256'),
    browser_download_url: 'https://cnb.cool/' + repo + '/-/releases/download/v1.2.3/' + name,
  })) })
  const calls = []
  const pending = new Map()
  let failUpload
  let wrongTag = false
  const request = async (path, options = {}) => {
    calls.push(['api', path, options])
    if (path.includes('/git/tags/')) return { commit: { sha: wrongTag ? 'b'.repeat(40) : sha } }
    if (path.endsWith('/releases/latest')) return { ...latest }
    if (path.includes('/releases/tags/') || path.endsWith('/releases/9')) return target()
    if (path.endsWith('/asset-upload-url')) {
      const name = options.body.asset_name
      assert.ok(name === 'SHA512SUMS.txt' || name === macName)
      assert.equal(options.body.overwrite, name === 'SHA512SUMS.txt')
      return { upload_url: 'https://storage.example/' + name,
        verify_url: 'https://api.cnb.cool/' + repo + '/-/releases/9/asset-upload-confirmation/' + name }
    }
    if (path.includes('/asset-upload-confirmation/')) {
      const name = basename(new URL('https://api.cnb.cool' + path).pathname)
      remoteBytes.set(name, pending.get(name))
      ids.set(name, 'uploaded-' + name)
      return null
    }
    throw new Error('Unexpected supplement request ' + path)
  }
  const fetchImpl = async (url, options) => {
    assert.equal(options.headers, undefined, 'supplement transfers must not send credentials')
    const name = basename(new URL(url).pathname)
    if (options.method === 'PUT') {
      calls.push(['upload', name])
      if (failUpload === name) throw new Error('interrupted upload')
      pending.set(name, Buffer.from(await options.body.arrayBuffer()))
      return new Response(null, { status: 200 })
    }
    calls.push(['download', name])
    return new Response(remoteBytes.get(name))
  }
  return {
    options: { release, directory, sha, request, fetchImpl, repo, expectedMacos: { name: macName, size: macBytes.length, sha512: digest(macBytes) } },
    calls, remoteBytes, ids, state, latest, windows, macName,
    fail(name) { failUpload = name },
    wrongTag() { wrongTag = true },
    setSourceSums(bytes) {
      writeFileSync(join(directory, 'SHA512SUMS.txt'), bytes)
      Object.assign(release.assets.find(asset => asset.name === 'SHA512SUMS.txt'), { size: bytes.length, digest: 'sha256:' + digest(bytes, 'sha256') })
    },
  }
}

test('Mac supplement preflights original bytes and only extends checksums before adding the DMG', async t => {
  const f = supplementFixture(t)
  const result = await supplementMacosMirror(f.options)
  assert.deepEqual(result.uploaded, ['SHA512SUMS.txt', f.macName])
  assert.equal(result.assets, 5)
  const firstWrite = f.calls.findIndex(([kind, , options]) => kind === 'api' && options.method)
  for (const name of [...f.windows, 'SHA512SUMS.txt']) {
    const download = f.calls.findIndex(([kind, file]) => kind === 'download' && file === name)
    assert.ok(download >= 0 && download < firstWrite)
  }
  assert.deepEqual(f.calls.filter(([kind]) => kind === 'upload').map(([, name]) => name), ['SHA512SUMS.txt', f.macName])
  assert.ok(f.calls.filter(([kind, , options]) => kind === 'api' && options.method)
    .every(([, path, options]) => options.method === 'POST' && /\/asset-upload-(url|confirmation\/)/.test(path)))
  for (const name of f.windows) assert.equal(f.ids.get(name), 'original-' + name)
  assert.deepEqual(f.state, { id: '9', tag_name: 'v1.2.3', name: 'Published title', body: 'Published notes', draft: false, prerelease: false })
  assert.deepEqual(f.latest, { id: '10', tag_name: 'v2.0.0' })
})

test('completed Mac supplements do no uploads and interrupted additions resume only the missing DMG', async t => {
  const complete = supplementFixture(t, { complete: true })
  assert.deepEqual((await supplementMacosMirror(complete.options)).uploaded, [])
  assert.ok(!complete.calls.some(([kind, , options]) => kind === 'api' && options.method))
  const interrupted = supplementFixture(t)
  interrupted.fail(interrupted.macName)
  await assert.rejects(supplementMacosMirror(interrupted.options), /upload failed/)
  assert.equal(interrupted.remoteBytes.has(interrupted.macName), false)
  interrupted.fail(null)
  assert.deepEqual((await supplementMacosMirror(interrupted.options)).uploaded, [interrupted.macName])
})

test('Mac supplement rejects changed Windows bytes, manifests, unexpected assets and provenance before any write', async t => {
  const cases = [
    f => f.remoteBytes.set(f.windows[0], Buffer.from('tampering')),
    f => f.remoteBytes.set('SHA512SUMS.txt', Buffer.from('0'.repeat(128) + '  ' + f.windows[0] + '\n')),
    f => f.remoteBytes.set('extra.txt', Buffer.from('unexpected')),
    f => f.remoteBytes.delete('latest.yml'),
    f => { f.options.expectedMacos.sha512 = '0'.repeat(128) },
    f => { f.options.release.target_commitish = 'b'.repeat(40) },
    f => f.wrongTag(),
    f => { f.state.prerelease = true },
    f => {
      const sums = readFileSync(join(f.options.directory, 'SHA512SUMS.txt'))
      f.setSourceSums(Buffer.concat([sums, Buffer.from(sums.toString().split('\n')[0] + '\n')]))
    },
  ]
  for (const change of cases) {
    const f = supplementFixture(t)
    change(f)
    await assert.rejects(supplementMacosMirror(f.options))
    assert.ok(!f.calls.some(([kind, , options]) => kind === 'api' && options.method))
  }
})

test('Mac supplement detects changed original asset IDs or published state in final API readback', async t => {
  for (const change of [
    (release, f) => { release.assets.find(asset => asset.name === f.windows[0]).id = 'replaced-original' },
    release => { release.prerelease = true },
  ]) {
    const f = supplementFixture(t)
    const request = f.options.request
    f.options.request = async (path, options) => {
      const response = await request(path, options)
      if (path.endsWith('/releases/9') && f.remoteBytes.has(f.macName)) change(response, f)
      return response
    }
    await assert.rejects(supplementMacosMirror(f.options), /asset changed|release state changed/)
  }
})
