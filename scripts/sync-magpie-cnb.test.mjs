import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { withOwnedTempDir } from '../src/shared/fs-safe.js'
import { downloadUpstreamMagpieAssets, mirrorMagpieRelease, validateMagpieMirrorAssets } from './sync-magpie-cnb.mjs'

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
