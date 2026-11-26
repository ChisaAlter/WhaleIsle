import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { withOwnedTempDir } from '../src/shared/fs-safe.js'
import { downloadToFile, fetchWithRetry } from './lib/cnb-client.mjs'
import {
  downloadUpstreamMagpieAssets,
  mirrorMagpieRelease,
  validateMagpieMirrorAssets,
  writeMagpieMirrorSummary,
} from './sync-magpie-cnb.mjs'

const PLATFORMS = [
  'magpie-cli-windows-amd64.exe',
  'magpie-cli-windows-arm64.exe',
  'magpie-cli-darwin-arm64',
  'magpie-cli-darwin-amd64',
  'magpie-cli-linux-amd64',
  'magpie-cli-linux-arm64',
]

function buildFixture() {
  const payloads = new Map()
  const lines = []
  for (const name of PLATFORMS) {
    const buf = Buffer.from(`binary-for-${name}-0.1.4708`)
    payloads.set(name, buf)
    const sha256 = createHash('sha256').update(buf).digest('hex')
    lines.push(`${sha256}  ${name}`)
  }
  payloads.set('SHA256SUMS', Buffer.from(lines.join('\n') + '\n', 'utf8'))
  return payloads
}

test('validateMagpieMirrorAssets verifies SHA256SUMS and all 6 platform binaries', async () => {
  const payloads = buildFixture()
  await withOwnedTempDir('magpie-sync-valid-', async (dir) => {
    for (const [name, buf] of payloads) await writeFile(join(dir, name), buf)
    const files = await validateMagpieMirrorAssets('0.1.4708', dir)
    assert.equal(files.length, 7)
    assert.equal(files[0].name, 'SHA256SUMS')

    await writeFile(join(dir, 'magpie-cli-windows-amd64.exe'), Buffer.from('corrupted'))
    await assert.rejects(() => validateMagpieMirrorAssets('0.1.4708', dir), /SHA256 mismatch/)
  })
})

test('downloadUpstreamMagpieAssets resolves latest via GitHub redirect and stages verified binaries', async () => {
  const payloads = buildFixture()
  const seen = []
  const fetchImpl = async (url) => {
    const str = String(url)
    seen.push(str)
    if (str.endsWith('/releases/latest')) {
      return new Response('', { status: 302, headers: { location: 'https://github.com/yetone/magpie/releases/tag/v0.1.4708' } })
    }
    const name = str.split('/').pop()
    const buf = payloads.get(name)
    if (!buf) return new Response('not found', { status: 404 })
    return new Response(buf, { status: 200 })
  }
  await withOwnedTempDir('magpie-sync-dl-', async (dir) => {
    const res = await downloadUpstreamMagpieAssets({ directory: dir, fetchImpl })
    assert.equal(res.version, '0.1.4708')
    assert.equal(res.tag, 'magpie-v0.1.4708')
    assert.equal(res.files.length, 7)
    assert.ok(seen.some(u => u.includes('/v0.1.4708/magpie-cli-windows-amd64.exe')))
  })
})

test('mirrorMagpieRelease creates prerelease with make_latest false, uploads, verifies, and publishes', async () => {
  const payloads = buildFixture()
  const apiCalls = []
  const uploaded = new Map()
  let releaseState = null
  let nextId = 100

  const request = async (path, options = {}) => {
    apiCalls.push([path, options])
    if (path.endsWith('/releases/tags/magpie-v0.1.4708')) return releaseState
    if (path.endsWith('/releases/101') && options.method === 'PATCH') {
      assert.equal(options.body.make_latest, 'false')
      assert.equal(options.body.prerelease, false)
      releaseState.prerelease = false
      return releaseState
    }
    if (path.endsWith('/releases/101')) return releaseState
    if (path.endsWith('/releases') && options.method === 'POST') {
      assert.equal(options.body.make_latest, 'false')
      assert.equal(options.body.prerelease, true)
      releaseState = { id: 101, tag_name: options.body.tag_name, prerelease: true, draft: false, assets: [] }
      return releaseState
    }
    if (path.endsWith('/asset-upload-url')) {
      const name = options.body.asset_name
      const token = ++nextId
      return {
        upload_url: `https://upload.cnb.cool/item/${token}/${name}`,
        verify_url: `https://api.cnb.cool/ayasealter/WhaleIsle/-/releases/101/asset-upload-confirmation/${name}`,
      }
    }
    if (path.includes('/asset-upload-confirmation/')) {
      const name = path.split('/').pop().split('?')[0]
      const buf = uploaded.get(name)
      releaseState.assets.push({
        name,
        size: buf.length,
        browser_download_url: `https://cnb.cool/ayasealter/WhaleIsle/-/releases/download/magpie-v0.1.4708/${name}`,
      })
      return { ok: true }
    }
    throw new Error('Unexpected CNB API path: ' + path)
  }

  const fetchImpl = async (url, options = {}) => {
    const str = String(url)
    if (options.method === 'PUT') {
      const name = str.split('/').pop()
      uploaded.set(name, Buffer.from(await options.body.arrayBuffer()))
      return new Response('', { status: 200 })
    }
    const name = str.split('/').pop()
    return new Response(uploaded.get(name), { status: 200 })
  }

  await withOwnedTempDir('magpie-sync-mirror-', async (dir) => {
    for (const [name, buf] of payloads) await writeFile(join(dir, name), buf)
    const out = await mirrorMagpieRelease({
      version: '0.1.4708',
      directory: dir,
      request,
      fetchImpl,
      repo: 'ayasealter/WhaleIsle',
      output: () => {},
    })
    assert.equal(out.tag, 'magpie-v0.1.4708')
    assert.equal(out.assets, 7)
    assert.equal(releaseState.prerelease, false)
    assert.equal(releaseState.assets.length, 7)
  })
})

test('manual MAGPIE_VERSION checks upstream draft/prerelease status and ALLOW_PRERELEASE keeps CNB prerelease', async () => {
  const payloads = buildFixture()
  const makeFetch = (meta) => async (url) => {
    const str = String(url)
    if (str === 'https://api.github.com/repos/yetone/magpie/releases/tags/v0.1.4708') {
      return new Response(JSON.stringify(meta), { status: 200 })
    }
    const name = str.split('/').pop()
    const buf = payloads.get(name)
    return buf ? new Response(buf, { status: 200 }) : new Response('not found', { status: 404 })
  }

  await withOwnedTempDir('magpie-sync-manual-', async (dir) => {
    await assert.rejects(
      () => downloadUpstreamMagpieAssets({ version: '0.1.4708', directory: dir, fetchImpl: makeFetch({ draft: true, prerelease: false }), allowPrerelease: true }),
      /draft/,
    )
    await assert.rejects(
      () => downloadUpstreamMagpieAssets({ version: '0.1.4708', directory: dir, fetchImpl: makeFetch({ draft: false, prerelease: true }) }),
      /ALLOW_PRERELEASE=1/,
    )
    const pre = await downloadUpstreamMagpieAssets({
      version: '0.1.4708',
      directory: dir,
      fetchImpl: makeFetch({ draft: false, prerelease: true }),
      allowPrerelease: true,
    })
    assert.equal(pre.prerelease, true)

    let patched = false
    let createdPrerelease = null
    const uploaded = new Map()
    let state = null
    const request = async (path, options = {}) => {
      if (path.endsWith('/releases/tags/magpie-v0.1.4708')) return state
      if (path.endsWith('/releases') && options.method === 'POST') {
        createdPrerelease = options.body.prerelease
        state = { id: 201, tag_name: options.body.tag_name, prerelease: true, draft: false, assets: [] }
        return state
      }
      if (path.endsWith('/releases/201') && options.method === 'PATCH') {
        patched = true
        return state
      }
      if (path.endsWith('/releases/201')) return state
      if (path.endsWith('/asset-upload-url')) {
        return {
          upload_url: `https://upload.cnb.cool/${options.body.asset_name}`,
          verify_url: `https://api.cnb.cool/ayasealter/WhaleIsle/-/releases/201/asset-upload-confirmation/${options.body.asset_name}`,
        }
      }
      if (path.includes('/asset-upload-confirmation/')) {
        const name = path.split('/').pop().split('?')[0]
        state.assets.push({ name, size: uploaded.get(name).length, browser_download_url: `https://cnb.cool/dl/${name}` })
        return { ok: true }
      }
      throw new Error('Unexpected CNB path: ' + path)
    }
    const fetchImpl = async (url, options = {}) => {
      const name = String(url).split('/').pop()
      if (options.method === 'PUT') {
        uploaded.set(name, Buffer.from(await options.body.arrayBuffer()))
        return new Response('', { status: 200 })
      }
      return new Response(uploaded.get(name), { status: 200 })
    }
    const res = await mirrorMagpieRelease({
      version: '0.1.4708',
      directory: dir,
      request,
      fetchImpl,
      repo: 'ayasealter/WhaleIsle',
      prerelease: true,
      output: () => {},
    })
    assert.equal(createdPrerelease, true)
    assert.equal(patched, false)
    assert.equal(state.prerelease, true)
    assert.equal(res.prerelease, true)
  })
})

test('staged Magpie mirror self-heals corrupted assets via overwrite=true while published releases reject corruption', async () => {
  const payloads = buildFixture()
  const uploaded = new Map()
  for (const [name, buf] of payloads) uploaded.set(name, buf)
  uploaded.set('magpie-cli-linux-amd64', Buffer.from('corrupt-staged-bytes'))

  const overwrites = []
  const stagedState = {
    id: 301,
    tag_name: 'magpie-v0.1.4708',
    prerelease: true,
    draft: false,
    assets: [...payloads.keys()].map((name) => ({
      name,
      size: uploaded.get(name).length,
      browser_download_url: `https://cnb.cool/dl/${name}`,
    })),
  }
  const request = async (path, options = {}) => {
    if (path.endsWith('/releases/tags/magpie-v0.1.4708')) return stagedState
    if (path.endsWith('/releases/301') && options.method === 'PATCH') {
      stagedState.prerelease = false
      return stagedState
    }
    if (path.endsWith('/releases/301')) return stagedState
    if (path.endsWith('/asset-upload-url')) {
      overwrites.push([options.body.asset_name, options.body.overwrite])
      return {
        upload_url: `https://upload.cnb.cool/${options.body.asset_name}`,
        verify_url: `https://api.cnb.cool/ayasealter/WhaleIsle/-/releases/301/asset-upload-confirmation/${options.body.asset_name}`,
      }
    }
    if (path.includes('/asset-upload-confirmation/')) {
      const name = path.split('/').pop().split('?')[0]
      const asset = stagedState.assets.find((row) => row.name === name)
      asset.size = uploaded.get(name).length
      return { ok: true }
    }
    throw new Error('Unexpected CNB path: ' + path)
  }
  const fetchImpl = async (url, options = {}) => {
    const name = String(url).split('/').pop()
    if (options.method === 'PUT') {
      uploaded.set(name, Buffer.from(await options.body.arrayBuffer()))
      return new Response('', { status: 200 })
    }
    return new Response(uploaded.get(name), { status: 200 })
  }

  await withOwnedTempDir('magpie-sync-heal-', async (dir) => {
    for (const [name, buf] of payloads) await writeFile(join(dir, name), buf)
    const out = await mirrorMagpieRelease({
      version: '0.1.4708',
      directory: dir,
      request,
      fetchImpl,
      repo: 'ayasealter/WhaleIsle',
      output: () => {},
    })
    assert.deepEqual(overwrites, [['magpie-cli-linux-amd64', true]])
    assert.deepEqual(out.repaired, ['magpie-cli-linux-amd64'])
    assert.equal(stagedState.prerelease, false)

    // Published releases remain immutable if an asset fails verification.
    uploaded.set('magpie-cli-linux-amd64', Buffer.from('corrupt-published'))
    await assert.rejects(
      () => mirrorMagpieRelease({ version: '0.1.4708', directory: dir, request, fetchImpl, repo: 'ayasealter/WhaleIsle', output: () => {} }),
      /checksum mismatch|size mismatch/,
    )
  })
})

test('cnb-client enforces streaming byte cap and bounded Retry-After backoff, and writes step summary', async () => {
  const sleepCalls = []
  let attempts = 0
  const retryResp = await fetchWithRetry(
    'https://api.cnb.cool/test',
    {},
    {
      maxAttempts: 3,
      baseDelayMs: 50,
      sleep: async (ms) => { sleepCalls.push(ms) },
      fetchImpl: async () => {
        attempts += 1
        if (attempts === 1) return new Response('rate limited', { status: 429, headers: { 'Retry-After': '2' } })
        if (attempts === 2) return new Response('unavailable', { status: 503 })
        return new Response('ok', { status: 200 })
      },
    },
  )
  assert.equal(retryResp.status, 200)
  assert.deepEqual(sleepCalls, [2000, 100])

  await withOwnedTempDir('magpie-stream-cap-', async (dir) => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(64))
        controller.enqueue(new Uint8Array(64))
        controller.close()
      },
    })
    await assert.rejects(
      () => downloadToFile({
        url: 'https://github.com/yetone/magpie/releases/download/v0.1.4708/bin',
        dest: join(dir, 'oversized.bin'),
        label: 'oversized.bin',
        maxBytes: 100,
        fetchImpl: async () => new Response(stream, { status: 200 }),
        retryOptions: { baseDelayMs: 1 },
      }),
      /exceeds maxBytes/,
    )

    const summaryPath = join(dir, 'summary.md')
    await writeMagpieMirrorSummary({
      url: 'https://cnb.cool/ayasealter/WhaleIsle/-/releases/tag/magpie-v0.1.4708',
      tag: 'magpie-v0.1.4708',
      version: '0.1.4708',
      prerelease: false,
      assets: 7,
      uploaded: ['SHA256SUMS'],
      repaired: ['magpie-cli-linux-amd64'],
    }, summaryPath)
    const summaryText = await readFile(summaryPath, 'utf8')
    assert.match(summaryText, /magpie-v0\.1\.4708/)
    assert.match(summaryText, /\*\*Repaired \(overwrite\)\*\*: magpie-cli-linux-amd64/)
  })
})
