/** Desktop market selection and bundle defaults through profile loading and persisted configuration edits. */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import type { ProfileContext } from '../src/index.ts'

const BASE = '@deepseek-ai/dsh-base'
const WEB = '@deepseek-ai/dsh-web-app'
const MARKET = '@deepseek-ai/dsh-experimental-plugin-market-bundle'
const MARKET_PLUGIN = '@deepseek-ai/dsh-plugin-market'
const MARKET_UI = '@deepseek-ai/dsh-client-ui-plugin-market'
const DESKTOP_INDEX = 'https://desktop.example/index.json'
const CUSTOM_INDEX = 'https://custom.example/index.json'
const NEXT_DESKTOP_INDEX = 'https://updated-desktop.example/index.json'
const MARKER = '.desktop-plugin-market-v1'

beforeEach(() => {
  vi.resetModules()
  vi.stubEnv('DSHD_PLUGIN_MARKET_INDEX', DESKTOP_INDEX)
})
afterEach(() => { vi.unstubAllEnvs() })

function installation() {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'dsh-desktop-market-')))
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
  writeFileSync(installAnchor, JSON.stringify({ name: 'desktop-market-test-installation' }) + '\n')
  const patches = {
    [BASE]: JSON.stringify([{ insert: [
      { id: 'config-editor', name: 'cordis:editor' },
      { id: 'settings', name: 'cordis:settings' },
      { id: 'plugin-manager', name: 'cordis:manager' },
    ] }]),
    [WEB]: '[]\n',
    'user-bundle': '[]\n',
    [MARKET]: readFileSync(new URL('../../../experimental/plugin-market-bundle/cordis.patch.yml', import.meta.url), 'utf8'),
  }
  for (const [name, patch] of Object.entries(patches)) {
    const dir = join(dirname(installAnchor), 'node_modules', name)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
      name, version: '1.0.0', dsh: { bundle: { patch: './cordis.patch.yml' } },
    }) + '\n')
    writeFileSync(join(dir, 'cordis.patch.yml'), patch)
  }
  return { home, installAnchor, contexts }
}

async function marketRuntime(fixture: ReturnType<typeof installation>) {
  const app = await import('../src/index.ts')
  const [{ Service }, { default: ConfigEditor }, { default: Settings }, { default: PluginMarket }, marketUi] = await Promise.all([
    import('@deepseek-ai/cordis'),
    import('@deepseek-ai/dsh-config-editor'),
    import('@deepseek-ai/dsh-settings'),
    import('@deepseek-ai/dsh-plugin-market'),
    // Its Node entry belongs to the Client project; runtime loading keeps Client types out of the Host aggregate.
    import(MARKET_UI),
  ])
  class EmptyPluginManager extends Service {
    constructor(ctx: Context) { super(ctx, 'pluginManager') }
    listBundles() { return Promise.resolve([]) }
    listVersionExemptions() { return { exemptions: {}, warnings: [] } }
  }
  const modules = new Map<string, unknown>([[MARKET_PLUGIN, PluginMarket], [MARKET_UI, marketUi]])
  const start = async () => {
    const loaded = app.loadProfile('dsh', 'web', fixture.installAnchor, fixture.home)
    expect(loaded.skippedBundles).toEqual([])
    const profile: ProfileContext = {
      name: 'web', dir: loaded.dir, patchPath: loaded.patchPath, installAnchor: fixture.installAnchor,
      home: fixture.home, cwd: fixture.home, startedBundles: loaded.layers.map(layer => layer.packageName),
      overlays: [], telemetryDisabledEnv: undefined,
    }
    const configPath = join(loaded.dir, 'cordis.yml')
    writeFileSync(configPath, '[]\n')
    const ctx = await app.boot('dsh', configPath, app.readProfilePatches('dsh', profile, loaded), (root) => {
      root.provide('profileContext', profile)
      Object.assign(root.loader.builtins, { editor: ConfigEditor, settings: Settings, manager: EmptyPluginManager })
      // Keep shipped bundle rows intact while resolving Host plugins to their source modules in this worker.
      const internal = root.loader.internal
      if (internal === undefined) throw new Error('Desktop market composition requires the Node module loader')
      root.loader.internal = { ...internal, import: async (name: string) => {
        if (!modules.has(name)) throw new Error(`Unexpected desktop market test import: ${name}`)
        return modules.get(name)
      } }
    })
    fixture.contexts.push(ctx)
    return { ctx, profile, loaded }
  }
  return { app, start }
}

describe('desktop market profile selection', () => {
  it('selects the market once for a new web profile and leaves its user patch empty', async () => {
    const fixture = installation()
    const app = await import('../src/index.ts')
    expect(app.PROFILE_TEMPLATES.web!.bundles).toEqual([BASE, WEB, MARKET])
    const profile = app.loadProfile('dsh', 'web', fixture.installAnchor, fixture.home)
    expect(profile.skippedBundles).toEqual([])
    expect(profile.layers.map(layer => layer.packageName)).toEqual([BASE, WEB, MARKET])
    expect(app.readProfileManifest('dsh', profile.dir).dsh?.profile?.bundles).toEqual([BASE, WEB, MARKET])
    expect(profile.patches).toEqual([])
    expect(readFileSync(join(profile.dir, MARKER), 'utf8')).toBe('1\n')
    const manifest = readFileSync(join(profile.dir, 'package.json'))
    const userPatch = readFileSync(profile.patchPath)
    const restarted = app.loadProfile('dsh', 'web', fixture.installAnchor, fixture.home)
    expect(restarted.layers.map(layer => layer.packageName)).toEqual([BASE, WEB, MARKET])
    expect(readFileSync(join(profile.dir, 'package.json'))).toEqual(manifest)
    expect(readFileSync(profile.patchPath)).toEqual(userPatch)
  })

  it('migrates an existing web profile while preserving all extra manifest fields and user patches', async () => {
    const fixture = installation()
    const app = await import('../src/index.ts')
    const dir = app.resolveProfileDir('web', fixture.home)
    const selected = [BASE, WEB, 'user-bundle']
    app.initProfile(dir, selected)
    const manifest = {
      name: 'my-web-profile', private: true,
      dependencies: { 'custom-plugin': '1.2.3' }, scripts: { custom: 'example' },
      custom: { retained: ['one', 'two'] },
      dsh: { custom: { enabled: true }, profile: { bundles: selected, label: 'Keep this label' } },
    }
    writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest) + '\n')
    const userPatch = `# Keep my source\n- id: plugin-market\n  config:\n    indexes: [${CUSTOM_INDEX}]\n`
    writeFileSync(join(dir, app.PROFILE_PATCH_FILENAME), userPatch)
    const loaded = app.loadProfile('dsh', 'web', fixture.installAnchor, fixture.home)
    expect(loaded.skippedBundles).toEqual([])
    expect(loaded.layers.map(layer => layer.packageName)).toEqual([...selected, MARKET])
    expect(app.readProfileManifest('dsh', dir)).toEqual({
      ...manifest, dsh: { ...manifest.dsh, profile: { ...manifest.dsh.profile, bundles: [...selected, MARKET] } },
    })
    expect(readFileSync(loaded.patchPath, 'utf8')).toBe(userPatch)
    expect(readFileSync(join(dir, MARKER), 'utf8')).toBe('1\n')
    const migrated = readFileSync(join(dir, 'package.json'))
    app.loadProfile('dsh', 'web', fixture.installAnchor, fixture.home)
    expect(readFileSync(join(dir, 'package.json'))).toEqual(migrated)
    expect(readFileSync(loaded.patchPath, 'utf8')).toBe(userPatch)
  })

  it('marks an already selected market without duplicating its bundle or rewriting the manifest', async () => {
    const fixture = installation()
    const app = await import('../src/index.ts')
    const dir = app.resolveProfileDir('web', fixture.home)
    const selected = [BASE, MARKET, WEB, 'user-bundle']
    app.initProfile(dir, selected)
    const manifest = readFileSync(join(dir, 'package.json'))
    for (let restart = 0; restart < 2; restart++) {
      const loaded = app.loadProfile('dsh', 'web', fixture.installAnchor, fixture.home)
      expect(loaded.skippedBundles).toEqual([])
      expect(loaded.layers.map(layer => layer.packageName)).toEqual(selected)
      expect(readFileSync(join(dir, 'package.json'))).toEqual(manifest)
    }
    expect(readFileSync(join(dir, MARKER), 'utf8')).toBe('1\n')
  })

  it('loads the desktop recovery template without migrating an existing profile or later directory reads', async () => {
    const fixture = installation()
    const app = await import('../src/index.ts')
    const dir = app.resolveProfileDir('web', fixture.home)
    app.initProfile(dir, [BASE, WEB, 'user-bundle'])
    writeFileSync(join(dir, app.PROFILE_PATCH_FILENAME), '# My configuration\n[]\n')
    const manifest = readFileSync(join(dir, 'package.json'))
    const userPatch = readFileSync(join(dir, app.PROFILE_PATCH_FILENAME))
    const recovered = app.loadProfile('dsh', 'web', fixture.installAnchor, fixture.home, { userLayer: false, bundles: 'template' })
    expect(recovered.layers.map(layer => layer.packageName)).toEqual([BASE, WEB, MARKET])
    expect(recovered.patches).toEqual([])
    app.loadProfileDirectory('dsh', dir, fixture.installAnchor)
    const resolution = await app.createRuntimeResolution({ installAnchor: fixture.installAnchor, home: fixture.home, profile: recovered })
    await resolution.computeLatestResolution()
    expect(readFileSync(join(dir, 'package.json'))).toEqual(manifest)
    expect(readFileSync(join(dir, app.PROFILE_PATCH_FILENAME))).toEqual(userPatch)
    expect(existsSync(join(dir, MARKER))).toBe(false)
    const normal = app.loadProfile('dsh', 'web', fixture.installAnchor, fixture.home)
    expect(normal.layers.map(layer => layer.packageName)).toEqual([BASE, WEB, 'user-bundle', MARKET])
    expect(existsSync(join(dir, MARKER))).toBe(true)
  })

  it('keeps an explicitly disabled market disabled on desktop restart after the one-time marker', async () => {
    const fixture = installation()
    const app = await import('../src/index.ts')
    const loaded = app.loadProfile('dsh', 'web', fixture.installAnchor, fixture.home)
    const manifest = app.readProfileManifest('dsh', loaded.dir)
    app.writeProfileManifest(loaded.dir, {
      ...manifest, dsh: { ...manifest.dsh, profile: { ...manifest.dsh?.profile, bundles: [BASE, WEB] } },
    })
    const disabled = readFileSync(join(loaded.dir, 'package.json'))
    for (let restart = 0; restart < 2; restart++) {
      const restarted = app.loadProfile('dsh', 'web', fixture.installAnchor, fixture.home)
      expect(restarted.skippedBundles).toEqual([])
      expect(restarted.layers.map(layer => layer.packageName)).toEqual([BASE, WEB])
      expect(readFileSync(join(loaded.dir, 'package.json'))).toEqual(disabled)
      expect(existsSync(join(loaded.dir, MARKER))).toBe(true)
    }
  })

  it.each(['headless', 'custom'])('leaves the %s profile unchanged in desktop mode', async (name) => {
    const fixture = installation()
    const app = await import('../src/index.ts')
    const dir = app.resolveProfileDir(name, fixture.home)
    app.initProfile(dir, [BASE])
    const manifest = readFileSync(join(dir, 'package.json'))
    const loaded = app.loadProfile('dsh', name, fixture.installAnchor, fixture.home)
    expect(loaded.skippedBundles).toEqual([])
    expect(loaded.layers.map(layer => layer.packageName)).toEqual([BASE])
    expect(readFileSync(join(dir, 'package.json'))).toEqual(manifest)
    expect(existsSync(join(dir, MARKER))).toBe(false)
  })

  it.each([undefined, ''])('leaves new and existing plain dsh profiles unchanged with desktop index %j', async (index) => {
    vi.stubEnv('DSHD_PLUGIN_MARKET_INDEX', index)
    const fixture = installation()
    const app = await import('../src/index.ts')
    expect(app.PROFILE_TEMPLATES.web!.bundles).toEqual([BASE, WEB])
    const created = app.loadProfile('dsh', 'web', fixture.installAnchor, fixture.home)
    expect(created.skippedBundles).toEqual([])
    expect(created.layers.map(layer => layer.packageName)).toEqual([BASE, WEB])
    expect(existsSync(join(created.dir, MARKER))).toBe(false)
    const existingHome = join(fixture.home, 'existing')
    const dir = app.resolveProfileDir('web', existingHome)
    app.initProfile(dir, [BASE, 'user-bundle'])
    const manifest = readFileSync(join(dir, 'package.json'))
    const existing = app.loadProfile('dsh', 'web', fixture.installAnchor, existingHome)
    expect(existing.skippedBundles).toEqual([])
    expect(existing.layers.map(layer => layer.packageName)).toEqual([BASE, 'user-bundle'])
    expect(readFileSync(join(dir, 'package.json'))).toEqual(manifest)
    expect(existsSync(join(dir, MARKER))).toBe(false)
  })
})

describe('desktop market bundle configuration', () => {
  it.each([
    { label: 'custom sources', indexes: [CUSTOM_INDEX, 'http://127.0.0.1:8080/index.json'] },
    { label: 'an explicit empty source list', indexes: [] },
  ])('inherits the desktop index from the bundle and retains $label after reload and restart', async ({ indexes }) => {
    const fixture = installation()
    const { app, start } = await marketRuntime(fixture)
    let { ctx, profile, loaded } = await start()
    expect(loaded.patches).toEqual([])
    expect(loaded.layers.find(layer => layer.packageName === MARKET)?.patches[0]?.insert)
      .toEqual(expect.arrayContaining([expect.objectContaining({
        id: 'plugin-market', config: { indexes: { __jsExpr: expect.stringContaining('DSHD_PLUGIN_MARKET_INDEX') } },
      })]))
    expect(ctx.get('pluginMarket')!.listIndexes()).toEqual([{ url: DESKTOP_INDEX }])
    expect(ctx.settings.describe().find(row => row.ns === 'plugin-market')).toMatchObject({
      base: { indexes: [DESKTOP_INDEX] }, value: { indexes: [DESKTOP_INDEX] }, user: {},
    })
    const fiber = ctx.configEditor.entries().find(entry => entry.options.id === 'plugin-market')!.fiber
    await ctx.get('pluginMarket')!.setIndexes(indexes)
    expect(ctx.get('pluginMarket')!.listIndexes().map(source => source.url)).toEqual(indexes)
    expect(ctx.configEditor.entries().find(entry => entry.options.id === 'plugin-market')!.fiber).toBe(fiber)
    expect(app.loadProfileDirectory('dsh', profile.dir, fixture.installAnchor).patches).toEqual([
      { id: 'plugin-market', name: MARKET_PLUGIN, config: { indexes } },
    ])
    const persisted = readFileSync(profile.patchPath)
    await app.reconcileProfilePatches(ctx, app.readProfilePatches('dsh', profile), 'dsh')
    expect(ctx.get('pluginMarket')!.listIndexes().map(source => source.url)).toEqual(indexes)
    expect(readFileSync(profile.patchPath)).toEqual(persisted)
    await ctx.fiber.dispose()
    vi.stubEnv('DSHD_PLUGIN_MARKET_INDEX', NEXT_DESKTOP_INDEX)
    ;({ ctx, profile, loaded } = await start())
    expect(loaded.layers.map(layer => layer.packageName)).toEqual([BASE, WEB, MARKET])
    expect(ctx.get('pluginMarket')!.listIndexes().map(source => source.url)).toEqual(indexes)
    expect(ctx.settings.describe().find(row => row.ns === 'plugin-market')).toMatchObject({
      base: { indexes: [NEXT_DESKTOP_INDEX] }, value: { indexes }, user: { indexes },
    })
    expect(readFileSync(profile.patchPath)).toEqual(persisted)
  })

  it('keeps an explicitly selected market empty under plain dsh when no user sources are configured', async () => {
    vi.stubEnv('DSHD_PLUGIN_MARKET_INDEX', undefined)
    const fixture = installation()
    const { app, start } = await marketRuntime(fixture)
    const dir = app.resolveProfileDir('web', fixture.home)
    app.initProfile(dir, [BASE, WEB, MARKET])
    const { ctx, loaded } = await start()
    expect(ctx.get('pluginMarket')!.listIndexes()).toEqual([])
    expect(loaded.patches).toEqual([])
    expect(existsSync(join(dir, MARKER))).toBe(false)
  })
})
