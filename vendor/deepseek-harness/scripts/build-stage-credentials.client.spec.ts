/**
 * Negative cases for the per-stage build credentials.
 *
 * The point of these tests is the failure direction: every way of making the
 * artifacts untrustworthy must report "run the stage", and only a provably
 * unchanged tree may be reused. A test that only proves the happy path would
 * not protect the thing this module exists for.
 */

import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { arch, platform, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  BUILD_STAGES,
  buildStageCredentials,
  captureStageCredential,
  createTreeIndex,
  readStageCredentials,
  stagesToRun,
  STAGE_CREDENTIAL_FORMAT,
  verifyStageCredential,
  writeStageCredentials,
} from './build-stage-credentials.mjs'

/** A miniature repository matching the layouts the real stages declare. */
function scaffold(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-stage-credentials-'))
  for (const directory of [
    'packages/client/ui-primitives/src',
    'packages/client/ui-primitives/lib',
    'apps/web/dist',
    'native/system/scripts',
    'native/system/packages/entry/src',
    `native/system/packages/${platform()}-${arch()}/bin`,
    'vendor/cordis/src/lib',
    'vendor/cordis/lib',
    'scripts',
  ]) {
    mkdirSync(resolve(root, directory), { recursive: true })
  }
  writeFileSync(resolve(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
  writeFileSync(resolve(root, 'packages/client/ui-primitives/src/index.ts'), 'export const one = 1\n')
  writeFileSync(resolve(root, 'packages/client/ui-primitives/lib/index.js'), 'exports.one = 1\n')
  writeFileSync(resolve(root, 'packages/client/ui-primitives/lib/client.js'), 'exports.client = 1\n')
  writeFileSync(resolve(root, 'apps/web/dist/index.html'), '<!doctype html>\n')
  writeFileSync(resolve(root, 'native/system/scripts/build.ts'), 'export {}\n')
  writeFileSync(resolve(root, 'native/system/packages/entry/src/index.ts'), 'export {}\n')
  writeFileSync(resolve(root, `native/system/packages/${platform()}-${arch()}/bin/system.node`), 'native binary\n')
  writeFileSync(resolve(root, 'vendor/cordis/src/index.ts'), 'export const context = 1\n')
  writeFileSync(resolve(root, 'vendor/cordis/src/lib/helper.ts'), 'export const helper = 1\n')
  writeFileSync(resolve(root, 'vendor/cordis/lib/index.js'), 'export const context = 1\n')
  writeFileSync(resolve(root, 'scripts/bundle-input-isolation.ts'), 'export const bundleInput = 1\n')
  return root
}

const roots: string[] = []
const created: string[] = []

function repository(): string {
  const root = scaffold()
  roots.push(root)
  return root
}

/** Record every stage, as a successful build would. */
async function recordAll(root: string, environment: Record<string, string>) {
  const credentials = await buildStageCredentials(root, environment, BUILD_STAGES, undefined, createTreeIndex(root))
  await writeStageCredentials(root, credentials)
  return credentials
}

afterEach(() => {
  for (const path of [...roots.splice(0), ...created.splice(0)]) {
    rmSync(path, { recursive: true, force: true })
  }
})

describe('build stage credentials', () => {
  it('rebuilds the Client copy gate when a terminal payload is missing', async () => {
    const root = repository()
    const environment = { DSH_CLIENT_COMMIT_HASH: 'aaaaaaa' }
    const assets = resolve(root, 'packages/client/ui-user-terminal/lib/assets')
    mkdirSync(assets, { recursive: true })
    const wasm = resolve(assets, 'ghostty-vt.wasm')
    writeFileSync(wasm, 'wasm payload')
    await recordAll(root, environment)
    rmSync(wasm)
    await expect(stagesToRun(root, environment, readStageCredentials(root)))
      .resolves.toEqual(['client', 'web'])
  })

  it('rebuilds after a build-helper edit without a Git commit change', async () => {
    const root = repository()
    const environment = { DSH_CLIENT_COMMIT_HASH: 'aaaaaaa' }
    await recordAll(root, environment)
    writeFileSync(resolve(root, 'scripts/bundle-input-isolation.ts'), 'export const bundleInput = 2\n')
    await expect(stagesToRun(root, environment, readStageCredentials(root)))
      .resolves.toEqual(['host', 'client', 'web'])
  })

  it('tracks vendored sources, including source directories named lib', async () => {
    const root = repository()
    const environment = { DSH_CLIENT_COMMIT_HASH: 'aaaaaaa' }
    await recordAll(root, environment)
    writeFileSync(resolve(root, 'vendor/cordis/src/lib/helper.ts'), 'export const helper = 2\n')
    await expect(stagesToRun(root, environment, readStageCredentials(root)))
      .resolves.toEqual(['host', 'client', 'web'])
  })

  it('owns vendored lib outputs without treating them as new source inputs', async () => {
    const root = repository()
    const environment = { DSH_CLIENT_COMMIT_HASH: 'aaaaaaa' }
    const before = await recordAll(root, environment)
    writeFileSync(resolve(root, 'vendor/cordis/lib/index.js'), 'export const context = 2\n')
    const changed = await captureStageCredential(root, 'host', environment)
    expect(changed.inputs).toBe(before.stages.host?.inputs)
    expect(changed.outputs).not.toBe(before.stages.host?.outputs)
    await expect(stagesToRun(root, environment, readStageCredentials(root)))
      .resolves.toEqual(['host', 'client', 'web'])
    await recordAll(root, environment)
    await expect(stagesToRun(root, environment, readStageCredentials(root))).resolves.toEqual([])
  })

  it('tracks the actual platform native outputs and declaration metadata', async () => {
    const root = repository()
    const environment = { DSH_CLIENT_COMMIT_HASH: 'aaaaaaa' }
    const before = await recordAll(root, environment)
    expect(before.stages['native-system']?.outputCount).toBe(1)
    mkdirSync(resolve(root, `native/system/packages/${platform()}-${arch()}`), { recursive: true })
    writeFileSync(resolve(root, `native/system/packages/${platform()}-${arch()}/prebuilds.json`), '{"binaries":[]}\n')
    await expect(stagesToRun(root, environment, readStageCredentials(root)))
      .resolves.toEqual([...BUILD_STAGES])
  })

  it('reuses every stage when nothing changed', async () => {
    const root = repository()
    await recordAll(root, { DSH_CLIENT_COMMIT_HASH: 'aaaaaaa' })
    await expect(stagesToRun(root, { DSH_CLIENT_COMMIT_HASH: 'aaaaaaa' }, readStageCredentials(root)))
      .resolves.toEqual([])
  })

  it('detects an edit that preserves both size and mtime', async () => {
    const root = repository()
    const environment = { DSH_CLIENT_COMMIT_HASH: 'aaaaaaa' }
    const target = resolve(root, 'packages/client/ui-primitives/src/index.ts')
    // Pin an exact mtime first, so the mutation below can restore it bit-for-bit
    // and the test really exercises a same-size/same-mtime edit.
    const pinned = new Date('2020-01-01T00:00:00Z')
    utimesSync(target, pinned, pinned)
    await recordAll(root, environment)

    const before = readFileSync(target)
    const beforeStat = statSync(target)
    const mutated = Buffer.from(before)
    mutated[mutated.length - 2] = mutated[mutated.length - 2] === 0x31 ? 0x32 : 0x31
    writeFileSync(target, mutated)
    utimesSync(target, pinned, pinned)
    expect(statSync(target).size).toBe(beforeStat.size)
    expect(Math.trunc(statSync(target).mtimeMs)).toBe(Math.trunc(pinned.getTime()))
    // Only the bytes differ; size, mtime and the path list are all identical.
    await expect(verifyStageCredential(
      root,
      'host',
      readStageCredentials(root),
      environment,
      { content: true },
    )).resolves.toBe(false)

    await expect(stagesToRun(root, environment, readStageCredentials(root)))
      .resolves.toEqual(['host', 'client', 'web'])
  })

  it('detects a new untracked input and its removal', async () => {
    const root = repository()
    const environment = { DSH_CLIENT_COMMIT_HASH: 'aaaaaaa' }
    await recordAll(root, environment)

    const added = resolve(root, 'packages/client/ui-primitives/src/added.ts')
    writeFileSync(added, 'export const added = true\n')
    await expect(stagesToRun(root, environment, readStageCredentials(root)))
      .resolves.toEqual(['host', 'client', 'web'])

    await recordAll(root, environment)
    rmSync(added)
    await expect(stagesToRun(root, environment, readStageCredentials(root)))
      .resolves.toEqual(['host', 'client', 'web'])
  })

  it('detects a deleted input', async () => {
    const root = repository()
    const environment = { DSH_CLIENT_COMMIT_HASH: 'aaaaaaa' }
    await recordAll(root, environment)
    rmSync(resolve(root, 'packages/client/ui-primitives/src/index.ts'))
    await expect(stagesToRun(root, environment, readStageCredentials(root)))
      .resolves.toEqual(['host', 'client', 'web'])
  })

  it('detects a tampered artifact and accepts a byte-identical restore', async () => {
    const root = repository()
    const environment = { DSH_CLIENT_COMMIT_HASH: 'aaaaaaa' }
    await recordAll(root, environment)

    const artifact = resolve(root, 'apps/web/dist/index.html')
    const before = readFileSync(artifact)
    writeFileSync(artifact, Buffer.concat([before, Buffer.from('<!--tamper-->')]))
    await expect(stagesToRun(root, environment, readStageCredentials(root))).resolves.toEqual(['web'])

    writeFileSync(artifact, before)
    await expect(stagesToRun(root, environment, readStageCredentials(root))).resolves.toEqual([])
  })

  it('fails closed when an artifact is missing', async () => {
    const root = repository()
    const environment = { DSH_CLIENT_COMMIT_HASH: 'aaaaaaa' }
    await recordAll(root, environment)
    rmSync(resolve(root, 'apps/web/dist/index.html'))
    await expect(stagesToRun(root, environment, readStageCredentials(root))).resolves.toEqual(['web'])
  })

  it('rebuilds only the browser faces when the embedded environment changes', async () => {
    const root = repository()
    await recordAll(root, { DSH_CLIENT_COMMIT_HASH: 'aaaaaaa', DSH_CLIENT_VERSION: '1.0.0' })
    await expect(stagesToRun(
      root,
      { DSH_CLIENT_COMMIT_HASH: 'bbbbbbb', DSH_CLIENT_VERSION: '1.0.0' },
      readStageCredentials(root),
    )).resolves.toEqual(['client', 'web'])
    await expect(stagesToRun(
      root,
      { DSH_CLIENT_COMMIT_HASH: 'aaaaaaa', DSH_CLIENT_VERSION: '1.0.1' },
      readStageCredentials(root),
    )).resolves.toEqual(['client', 'web'])
  })

  it('runs every stage when a credential is absent, truncated or from a future format', async () => {
    const root = repository()
    const environment = { DSH_CLIENT_COMMIT_HASH: 'aaaaaaa' }
    const credentials = await recordAll(root, environment)

    writeFileSync(resolve(root, '.dsh-build/build-stage-credentials.json'), '{"formatVersion":1,"stages')
    await expect(stagesToRun(root, environment, readStageCredentials(root))).resolves.toEqual([...BUILD_STAGES])

    await writeStageCredentials(root, { ...credentials, formatVersion: STAGE_CREDENTIAL_FORMAT + 1 })
    await expect(stagesToRun(root, environment, readStageCredentials(root))).resolves.toEqual([...BUILD_STAGES])

    rmSync(resolve(root, '.dsh-build/build-stage-credentials.json'))
    await expect(stagesToRun(root, environment, readStageCredentials(root))).resolves.toEqual([...BUILD_STAGES])
  })

  it('reports a stage as reusable only when its own outputs and inputs both verify', async () => {
    const root = repository()
    const environment = { DSH_CLIENT_COMMIT_HASH: 'aaaaaaa' }
    const credentials = await recordAll(root, environment)
    await expect(verifyStageCredential(root, 'web', credentials, environment)).resolves.toBe(true)
    writeFileSync(resolve(root, 'apps/web/dist/index.html'), '<!doctype html><p>changed</p>\n')
    await expect(verifyStageCredential(root, 'web', credentials, environment)).resolves.toBe(false)
    await expect(verifyStageCredential(root, 'web', undefined, environment)).resolves.toBe(false)
  })

  it('keeps an unchanged stage recorded when only a later stage runs', async () => {
    const root = repository()
    const environment = { DSH_CLIENT_COMMIT_HASH: 'aaaaaaa' }
    const before = await recordAll(root, environment)
    const after = await buildStageCredentials(root, environment, ['web'], before, createTreeIndex(root))
    expect(after.stages['native-system']).toEqual(before.stages['native-system'])
    expect(after.stages.host).toEqual(before.stages.host)
    expect(after.stages.web?.outputs).toBe(before.stages.web?.outputs)
  })

  it('records diagnostics for every stage it captures', async () => {
    const root = repository()
    const credential = await captureStageCredential(root, 'host', {}, createTreeIndex(root))
    expect(credential.inputCount).toBeGreaterThan(0)
    expect(credential.outputCount).toBeGreaterThan(0)
    expect(credential.inputs).toMatch(/^[0-9a-f]{64}$/u)
    expect(credential.outputManifest).toMatch(/^[0-9a-f]{64}$/u)
  })
})
