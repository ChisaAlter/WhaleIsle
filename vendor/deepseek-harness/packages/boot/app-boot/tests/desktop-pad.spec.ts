/** Desktop pad defaults stay below user settings through boot, persisted edits, and recovery. */
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import type { ProfileContext } from '../src/index.ts'

const BASE = '@deepseek-ai/dsh-base'
const WEB = '@deepseek-ai/dsh-web-app'
const HEADLESS = '@deepseek-ai/dsh-headless'
const PAD_ID = 'dsh-pad'
const PAD_MODULE = 'cordis:desktop-pad'

beforeEach(() => {
  vi.resetModules()
  vi.stubEnv('DSHD_PLUGIN_MARKET_INDEX', undefined)
  vi.stubEnv('DSHD_PROFILE_DEFAULT_PATCH', undefined)
})
afterEach(() => { vi.unstubAllEnvs() })

async function desktopRuntime() {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'dsh-desktop-pad-')))
  const home = join(root, 'home')
  const installAnchor = join(root, 'installation', 'package.json')
  const contexts: Context[] = []
  onTestFinished(async () => {
    try {
      for (const ctx of contexts.reverse()) await ctx.fiber.dispose()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
  mkdirSync(dirname(installAnchor), { recursive: true })
  writeFileSync(installAnchor, '{"name":"desktop-pad-test-installation"}\n')
  const patches = {
    [BASE]: JSON.stringify([{ insert: [{ id: 'config-editor', name: 'cordis:editor' }] }]),
    [WEB]: '[]\n',
    [HEADLESS]: '[]\n',
  }
  for (const [name, patch] of Object.entries(patches)) {
    const dir = join(dirname(installAnchor), 'node_modules', name)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
      name, version: '1.0.0', dsh: { bundle: { patch: './cordis.patch.yml' } },
    }) + '\n')
    writeFileSync(join(dir, 'cordis.patch.yml'), patch)
  }
  const defaultsPath = join(root, 'desktop-plugins', PAD_ID, 'desktop-dsh-pad.patch.yml')
  mkdirSync(dirname(defaultsPath), { recursive: true })
  writeFileSync(defaultsPath, JSON.stringify([{ insert: [
    { id: PAD_ID, name: PAD_MODULE, config: { updateCheck: false } },
  ] }]) + '\n')
  vi.stubEnv('DSHD_PROFILE_DEFAULT_PATCH', defaultsPath)

  const app = await import('../src/index.ts')
  const [{ FiberState }, { default: ConfigEditor }, { default: z }, { writePluginEnabled }] = await Promise.all([
    import('@deepseek-ai/cordis'),
    import('@deepseek-ai/dsh-config-editor'),
    import('@deepseek-ai/schemastery'),
    import('../../plugin-manager/src/patch.ts'),
  ])
  const dir = app.resolveProfileDir('web', home)
  app.initProfile(dir, [BASE, WEB])
  const patchPath = join(dir, app.PROFILE_PATCH_FILENAME)
  const homePatchPath = join(home, app.PROFILE_PATCH_FILENAME)
  const Pad = {
    Config: z.object({
      updateCheck: z.boolean().default(true),
      dataFile: z.string(),
      agentRefresh: z.boolean().default(true),
      minIntervalSec: z.natural().min(1).default(2),
    }),
    apply() {},
  }
  const start = async (options: { name?: string; recovery?: boolean; overlays?: PatchOptions[] } = {}) => {
    const name = options.name ?? 'web'
    const loaded = app.loadProfile('dsh', name, installAnchor, home,
      options.recovery === true ? { userLayer: false, bundles: 'template' } : {})
    expect(loaded.skippedBundles).toEqual([])
    const profile: ProfileContext = {
      name, dir: loaded.dir, patchPath: loaded.patchPath, installAnchor,
      home, cwd: home, startedBundles: loaded.layers.map(layer => layer.packageName),
      overlays: options.overlays ?? [], telemetryDisabledEnv: undefined,
      ...(options.recovery === true ? { skipUserPlugins: true } : {}),
    }
    const configPath = join(loaded.dir, 'cordis.yml')
    writeFileSync(configPath, '[]\n')
    const ctx = await app.boot('dsh', configPath, app.readProfilePatches('dsh', profile, loaded), (ctx) => {
      ctx.provide('profileContext', profile)
      Object.assign(ctx.loader.builtins, { editor: ConfigEditor, 'desktop-pad': Pad })
    })
    contexts.push(ctx)
    return { ctx, profile, loaded }
  }
  return { app, start, home, dir, patchPath, homePatchPath, defaultsPath, installAnchor, FiberState, writePluginEnabled }
}

function padEntry(ctx: Context) {
  const entries = ctx.configEditor.entries().filter(entry => entry.options.id === PAD_ID)
  expect(entries).toHaveLength(1)
  return entries[0]!
}

function padConfiguration(ctx: Context) {
  const configuration = ctx.configEditor.configuration().find(row => row.entry.options.id === PAD_ID)
  expect(configuration).toBeDefined()
  return configuration!
}

describe('desktop pad profile defaults', { timeout: 15_000 }, () => {
  it('persists ConfigEditor changes above desktop defaults across reconciliation and restart', async () => {
    const fixture = await desktopRuntime()
    const { app, start, FiberState } = fixture
    let { ctx, profile, loaded } = await start()
    expect(loaded.patches).toEqual([])
    expect(padEntry(ctx).fiber?.state).toBe(FiberState.ACTIVE)
    expect(padConfiguration(ctx)).toMatchObject({ inherited: { updateCheck: false }, override: {} })
    const custom = {
      updateCheck: false, dataFile: join(fixture.home, 'custom-panels.json'),
      agentRefresh: false, minIntervalSec: 30,
    }
    await ctx.configEditor.edit(padEntry(ctx), (current, inherited) => {
      expect(current).toEqual({ updateCheck: false })
      expect(inherited).toEqual({ updateCheck: false })
      return custom
    })
    expect(padEntry(ctx).fiber?.config).toMatchObject(custom)
    expect(app.loadProfileDirectory('dsh', profile.dir, fixture.installAnchor).patches).toEqual([
      { id: PAD_ID, name: PAD_MODULE, config: custom },
    ])
    const persisted = readFileSync(profile.patchPath)
    await app.reconcileProfilePatches(ctx, app.readProfilePatches('dsh', profile), 'dsh')
    expect(padEntry(ctx).fiber?.config).toMatchObject(custom)
    expect(readFileSync(profile.patchPath)).toEqual(persisted)
    await ctx.fiber.dispose()
    ;({ ctx, profile, loaded } = await start())
    expect(padEntry(ctx).fiber?.state).toBe(FiberState.ACTIVE)
    expect(padEntry(ctx).fiber?.config).toMatchObject(custom)
    expect(padConfiguration(ctx)).toMatchObject({ inherited: { updateCheck: false }, override: custom })
    expect(readFileSync(profile.patchPath)).toEqual(persisted)
  })

  it('inherits updateCheck false and resets an explicit true to the desktop default without pinning it', async () => {
    const { app, start, installAnchor } = await desktopRuntime()
    let { ctx, profile } = await start()
    expect(padEntry(ctx).fiber?.config).toMatchObject({ updateCheck: false })
    await ctx.configEditor.edit(padEntry(ctx), current => ({ ...current, updateCheck: true }))
    expect(padEntry(ctx).fiber?.config).toMatchObject({ updateCheck: true })
    expect(padConfiguration(ctx)).toMatchObject({ inherited: { updateCheck: false }, override: { updateCheck: true } })
    await ctx.fiber.dispose()
    ;({ ctx, profile } = await start())
    expect(padEntry(ctx).fiber?.config).toMatchObject({ updateCheck: true })
    await ctx.configEditor.edit(padEntry(ctx), (_current, inherited) => {
      expect(inherited).toEqual({ updateCheck: false })
      return inherited
    })
    expect(app.loadProfileDirectory('dsh', profile.dir, installAnchor).patches).toEqual([])
    expect(padEntry(ctx).fiber?.config).toMatchObject({ updateCheck: false })
    expect(padConfiguration(ctx)).toMatchObject({ inherited: { updateCheck: false }, override: {} })
    await ctx.fiber.dispose()
    ;({ ctx } = await start())
    expect(padEntry(ctx).fiber?.config).toMatchObject({ updateCheck: false })
  })

  it('keeps a persisted disable on restart and removes the switch when the default pad is re-enabled', async () => {
    const { app, start, installAnchor, FiberState, writePluginEnabled } = await desktopRuntime()
    let { ctx, profile } = await start()
    expect(await writePluginEnabled(profile, PAD_ID, PAD_MODULE, false)).toBe(true)
    expect(app.loadProfileDirectory('dsh', profile.dir, installAnchor).patches).toEqual([{ id: PAD_ID, disabled: true }])
    await app.reconcileProfilePatches(ctx, app.readProfilePatches('dsh', profile), 'dsh')
    expect(padEntry(ctx).disabled).toBe(true)
    expect(padEntry(ctx).fiber?.state).not.toBe(FiberState.ACTIVE)
    const disabled = readFileSync(profile.patchPath)
    await ctx.fiber.dispose()
    ;({ ctx, profile } = await start())
    expect(padEntry(ctx).disabled).toBe(true)
    expect(padEntry(ctx).fiber).toBeUndefined()
    expect(readFileSync(profile.patchPath)).toEqual(disabled)
    expect(await writePluginEnabled(profile, PAD_ID, PAD_MODULE, true)).toBe(true)
    expect(app.loadProfileDirectory('dsh', profile.dir, installAnchor).patches).toEqual([])
    await app.reconcileProfilePatches(ctx, app.readProfilePatches('dsh', profile), 'dsh')
    expect(padEntry(ctx).disabled).toBe(false)
    expect(padEntry(ctx).fiber?.state).toBe(FiberState.ACTIVE)
    expect(padEntry(ctx).fiber?.config).toMatchObject({ updateCheck: false })
    expect(await writePluginEnabled(profile, PAD_ID, PAD_MODULE, true)).toBe(false)
    await ctx.fiber.dispose()
    ;({ ctx } = await start())
    expect(padEntry(ctx).disabled).toBe(false)
    expect(padEntry(ctx).fiber?.state).toBe(FiberState.ACTIVE)
    expect(padEntry(ctx).fiber?.config).toMatchObject({ updateCheck: false })
  })

  it.each(['profile', 'home'] as const)('applies the %s user patch after desktop defaults', async (layer) => {
    const fixture = await desktopRuntime()
    const custom = { updateCheck: true, dataFile: join(fixture.home, `${layer}-panels.json`), agentRefresh: false, minIntervalSec: 17 }
    writeFileSync(fixture.patchPath, JSON.stringify([
      { id: PAD_ID, disabled: true, config: layer === 'profile' ? custom : { updateCheck: false, minIntervalSec: 9 } },
    ]) + '\n')
    if (layer === 'home') writeFileSync(fixture.homePatchPath, JSON.stringify([{ id: PAD_ID, disabled: false, config: custom }]) + '\n')
    const userPatch = readFileSync(fixture.patchPath)
    const homePatch = layer === 'home' ? readFileSync(fixture.homePatchPath) : undefined
    const { ctx } = await fixture.start()
    expect(padEntry(ctx).options.config).toEqual(custom)
    expect(padEntry(ctx).disabled).toBe(layer === 'profile')
    if (layer === 'home') expect(padEntry(ctx).fiber?.config).toMatchObject(custom)
    expect(readFileSync(fixture.patchPath)).toEqual(userPatch)
    if (homePatch !== undefined) expect(readFileSync(fixture.homePatchPath)).toEqual(homePatch)
  })

  it('keeps an explicit launch overlay above user edits and rejects a shadowed ConfigEditor write', async () => {
    const fixture = await desktopRuntime()
    writeFileSync(fixture.patchPath, JSON.stringify([{ id: PAD_ID, config: { updateCheck: false, minIntervalSec: 5 } }]) + '\n')
    writeFileSync(fixture.homePatchPath, JSON.stringify([{ id: PAD_ID, config: { updateCheck: true, minIntervalSec: 7 } }]) + '\n')
    const { ctx, profile } = await fixture.start({ overlays: [{ id: PAD_ID, config: { updateCheck: true, minIntervalSec: 11 } }] })
    expect(padEntry(ctx).fiber?.config).toMatchObject({ updateCheck: true, minIntervalSec: 11 })
    const persisted = readFileSync(profile.patchPath)
    await expect(ctx.configEditor.edit(padEntry(ctx), current => ({ ...current, minIntervalSec: 13 })))
      .rejects.toThrow('overridden by a home patch or command-line overlay')
    expect(readFileSync(profile.patchPath)).toEqual(persisted)
    expect(padEntry(ctx).fiber?.config).toMatchObject({ updateCheck: true, minIntervalSec: 11 })
  })

  it('boots recovery with desktop defaults without reading malformed profile or home patches on later reloads', async () => {
    const fixture = await desktopRuntime()
    writeFileSync(fixture.patchPath, '- id: [broken-profile\n')
    writeFileSync(fixture.homePatchPath, '- id: [broken-home\n')
    const profilePatch = readFileSync(fixture.patchPath)
    const homePatch = readFileSync(fixture.homePatchPath)
    const { ctx, profile, loaded } = await fixture.start({ recovery: true })
    expect(loaded.patches).toEqual([])
    expect(padEntry(ctx).fiber?.state).toBe(fixture.FiberState.ACTIVE)
    expect(padEntry(ctx).fiber?.config).toMatchObject({ updateCheck: false })
    expect(padConfiguration(ctx)).toMatchObject({ inherited: { updateCheck: false }, override: {} })
    await fixture.app.reconcileProfilePatches(ctx, fixture.app.readProfilePatches('dsh', profile), 'dsh')
    expect(padEntry(ctx).fiber?.config).toMatchObject({ updateCheck: false })
    expect(readFileSync(fixture.patchPath)).toEqual(profilePatch)
    expect(readFileSync(fixture.homePatchPath)).toEqual(homePatch)
  })

  it('uses a newly selected user pad module once and keeps bundle disabling effective during reload', async () => {
    const fixture = await desktopRuntime()
    const { ctx, profile } = await fixture.start()
    const original = padEntry(ctx).fiber
    const userPad = { apply() {} }
    ctx.loader.builtins['user-pad'] = userPad
    const packageDir = join(profile.dir, 'node_modules', PAD_ID)
    mkdirSync(packageDir, { recursive: true })
    writeFileSync(join(packageDir, 'package.json'), JSON.stringify({
      name: PAD_ID, version: '0.3.2', dsh: { bundle: { patch: './cordis.patch.yml' } },
    }) + '\n')
    writeFileSync(join(packageDir, 'cordis.patch.yml'), '- insert:\n    - id: dsh-pad\n      name: cordis:user-pad\n')
    const manifest = fixture.app.readProfileManifest('dsh', profile.dir)
    manifest.dependencies = { [PAD_ID]: '0.3.2' }
    manifest.dsh = { profile: { bundles: [BASE, WEB, PAD_ID] } }
    fixture.app.writeProfileManifest(profile.dir, manifest)
    const patches = fixture.app.readProfilePatches('dsh', profile)
    expect(fixture.app.composeEntries([patches]).filter(row => row.id === PAD_ID)).toHaveLength(1)
    await fixture.app.reconcileProfilePatches(ctx, patches, 'dsh')
    expect(padEntry(ctx).options.name).toBe('cordis:user-pad')
    expect(padEntry(ctx).fiber).not.toBe(original)
    expect(padEntry(ctx).moduleNamespace).toBe(userPad)
    expect(original?.state).toBe(fixture.FiberState.DISPOSED)
    manifest.dsh.profile!.bundles = [BASE, WEB]
    fixture.app.writeProfileManifest(profile.dir, manifest)
    await fixture.app.reconcileProfilePatches(ctx, fixture.app.readProfilePatches('dsh', profile), 'dsh')
    expect(ctx.configEditor.entries().some(entry => entry.options.id === PAD_ID)).toBe(false)
    const recovery = await fixture.start({ recovery: true })
    expect(padEntry(recovery.ctx).options.name).toBe(PAD_MODULE)
  })

  it.each(['headless', 'custom'])('boots the %s profile without desktop defaults or reading their path', async (name) => {
    const fixture = await desktopRuntime()
    fixture.app.initProfile(fixture.app.resolveProfileDir(name, fixture.home), [BASE])
    vi.stubEnv('DSHD_PROFILE_DEFAULT_PATCH', join(fixture.home, 'missing-desktop-defaults.yml'))
    const { ctx, profile } = await fixture.start({ name })
    expect(ctx.configEditor.entries().some(entry => entry.options.id === PAD_ID)).toBe(false)
    expect(fixture.app.readProfileDefaultPatches('dsh', { name, dir: profile.dir })).toEqual([])
    await fixture.app.reconcileProfilePatches(ctx, fixture.app.readProfilePatches('dsh', profile), 'dsh')
    expect(ctx.configEditor.entries().some(entry => entry.options.id === PAD_ID)).toBe(false)
  })

  it.each([undefined, ''])('boots plain web without desktop defaults when the desktop path is %j', async (path) => {
    const fixture = await desktopRuntime()
    vi.stubEnv('DSHD_PROFILE_DEFAULT_PATCH', path)
    const { ctx, profile } = await fixture.start()
    expect(ctx.configEditor.entries().some(entry => entry.options.id === PAD_ID)).toBe(false)
    expect(fixture.app.readProfileDefaultPatches('dsh', { name: 'web', dir: profile.dir })).toEqual([])
  })
})
