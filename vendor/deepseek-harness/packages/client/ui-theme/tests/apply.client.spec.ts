/** ui-theme apply wiring: service provision, settings dictionaries riding the
 * locale service, declaration-aware Appearance section + font-size row
 * registration, snapshot projection into the stores, and HMR collapse recovery. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { TestRemote, stubConfigForm } from '@deepseek-ai/dsh-client-test-runtime'
import { apply as settingsApply, inject as settingsInject } from '@deepseek-ai/dsh-client-ui-settings/client'
import { apply, inject, SETTINGS_NS, ThemeRuntime } from '@deepseek-ai/dsh-client-ui-theme/client'
import type { AppearanceSectionInjected, FontSettingsInjected, ThemeSnapshot } from '@deepseek-ai/dsh-client-ui-theme/client'
import { DEFAULT_THEME_SETTINGS, THEME_SETTINGS_NAMESPACE, ThemeSettingsSchema, type ThemeSettings } from '../src/theme-settings.ts'
import type { createAppearanceRowStore, createFontRowStore } from '../src/client/settings-store.ts'

import type { Shortcuts, ShortcutContext, ShortcutFixedInput, ShortcutGesture, ShortcutPlatform } from '@deepseek-ai/dsh-client-shortcuts/client'
import { bindingKey, normalizeBinding, presentBinding } from '@deepseek-ai/dsh-client-shortcuts/protocol'
import { ShortcutRegistry } from '../../shortcuts/src/client/registry.ts'

// These specs assert the shipped Chinese copy. The lane has no jsdom `window`,
// so browser-language detection never runs and a fresh LocaleRuntime opens on
// FALLBACK_LOCALE (en); bench stages zh explicitly on the locale instead.

const SECTION_SLOT = 'settings.section'
const ITEM_SLOT = 'settings.general.item'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

async function bench(isLoopback = true) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('zh')
  ctx.provide('locale', locale)
  ctx.provide('connection', {
    api: { settings: { describe: () => Promise.resolve({
      rpcId: 'theme-apply' as never,
      result: { ok: true, value: { writable: true, hasDocument: false, namespaces: [] } },
    }) } },
    isLoopback: true,
  } as never)
  const section: Record<string, unknown> = { ...DEFAULT_THEME_SETTINGS, fontSizeCode: 11 }
  const namespace = () => ({
    ns: THEME_SETTINGS_NAMESPACE,
    schema: ThemeSettingsSchema.toJSON(),
    value: { ...section },
    autoGenerate: true, applies: 'live' as const,
    secrets: [],
    revision: 0,
  })
  const describe = vi.fn(() => Promise.resolve({
    ok: true as const,
    value: { writable: true, hasDocument: true, namespaces: [namespace()] },
  }))
  const mutate = vi.fn((_ns: string, ops: { path: string[]; value: unknown }[]) => {
    for (const op of ops) section[op.path[0]!] = op.value
    return Promise.resolve({ ok: true as const, value: namespace() })
  })
  const events = new TestRemote(ctx, { settings: { describe, mutate } })
  events.$host = { home: undefined, isLoopback }
  await ctx.plugin({ inject: [...settingsInject], apply: settingsApply }).await()
  return {
    ctx, slots: ctx.get('slots') as SlotRegistry, locale, describe, mutate, events,
    setHostSection: (next: Record<string, unknown>) => { Object.assign(section, next) },
  }
}

/** Stand in for the settings shell: declare Appearance section + General item slots. */
function declareSlots(slots: SlotRegistry): () => void {
  return slots.register(
    {
      name: 'root',
      children: {
        [SECTION_SLOT]: { kind: 'list', scope: 'root' },
        [ITEM_SLOT]: { kind: 'list', scope: 'root' },
      },
    } as never,
    () => null,
  )
}

/** Mirror the framework's inject choreography for the Appearance section. */
function faceOf(slots: SlotRegistry) {
  const entry = slots.entries(SECTION_SLOT).find(e => e.options.id === 'appearance')!
  const handle = entry.store as ReturnType<typeof createAppearanceRowStore>
  const instance = handle.create()
  const face = (entry.inject as unknown as (a: typeof instance.actions) => AppearanceSectionInjected)(instance.actions)
  return { entry, instance, face }
}

/** The same choreography for the font-size row entry. */
function fontSizeFaceOf(slots: SlotRegistry) {
  const entry = slots.entries(ITEM_SLOT).find(e => e.options.id === 'font-size')!
  const handle = entry.store as ReturnType<typeof createFontRowStore>
  const instance = handle.create()
  const face = (entry.inject as unknown as (a: typeof instance.actions) => FontSettingsInjected)(instance.actions)
  return { entry, instance, face }
}

const declareItems = declareSlots
const fontSettingsFaceOf = fontSizeFaceOf

/** Deliver the keyboard service's arbitrated input while keeping its real catalog and bindings. */
function fontKeyboard(ctx: Context, runtime: Shortcuts['runtime'] = 'desktop', platform: ShortcutPlatform = 'macos') {
  onTestFinished(() => ctx.fiber.dispose())
  const registry = new ShortcutRegistry(runtime, platform)
  const listeners = new Set<(input: ShortcutFixedInput) => void>()
  const shortcuts: Pick<Shortcuts, 'runtime' | 'platform' | 'registerFixed' | 'describeBinding' | 'observeFixedInput'> = {
    runtime, platform,
    registerFixed: command => registry.registerFixed(command),
    describeBinding: (candidate) => {
      const binding = candidate === null ? null : normalizeBinding(candidate, platform)
      return { binding, keys: presentBinding(binding, platform).keys, issue: null, conflicts: [] }
    },
    observeFixedInput: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
  ctx.provide('shortcuts', shortcuts)
  return {
    registry,
    press: (gesture: Partial<ShortcutGesture> = {}, context: Partial<ShortcutContext> = {}) => {
      const consume = vi.fn()
      for (const listener of listeners) listener({
        type: 'keydown', consume,
        gesture: { code: 'Equal', meta: platform === 'macos', control: platform !== 'macos', alt: false,
          shift: false, repeat: false, composing: false, defaultPrevented: false, ...gesture },
        context: { region: 'page', modal: null, target: null, ...context },
      })
      return consume
    },
    reset: () => { for (const listener of listeners) listener({ type: 'reset' }) },
  }
}

/** Isolate theme write outcomes behind the same registered keyboard input. */
async function keyboardTheme(host = stubConfigForm<ThemeSettings>()) {
  const ctx = new Context()
  ctx.provide('locale', new LocaleRuntime(ctx))
  const keyboard = fontKeyboard(ctx)
  const events: ThemeSnapshot[] = []
  ctx.on('theme/change', (snapshot) => { events.push(snapshot) })
  await ctx.plugin({ apply: (scope) => {
    scope.provide('theme', new ThemeRuntime(scope, host.scope))
  } }).await()
  return { theme: ctx.get('theme') as ThemeRuntime, keyboard, events, host }
}

describe('ui-theme apply', () => {
  it('steps all font sizes in one settings mutation and one snapshot', async () => {
    const { theme, keyboard, events, host } = await keyboardTheme()
    keyboard.press()
    expect(theme.getTheme().fontSizes).toEqual({ text: 15, code: 14, terminal: 14 })
    expect(host.mutate).toHaveBeenCalledExactlyOnceWith([
      { op: 'set', path: ['fontSize'], value: 15 },
      { op: 'set', path: ['fontSizeCode'], value: 14 },
      { op: 'set', path: ['terminalFontSize'], value: 14 },
    ])
    expect(host.set).not.toHaveBeenCalled()
    expect(events).toHaveLength(1)
    expect(events[0]?.fontSizes).toEqual({ text: 15, code: 14, terminal: 14 })
  })

  it('continues stepping other font roles when one has reached its own limit', async () => {
    const { theme, keyboard, host } = await keyboardTheme()
    theme.setFontSize('text', 22)
    theme.setFontSize('code', 10)
    theme.setFontSize('terminal', 20)
    keyboard.press()
    expect(theme.getTheme().fontSizes).toEqual({ text: 22, code: 11, terminal: 20 })
    expect(host.mutate).toHaveBeenCalledExactlyOnceWith([
      { op: 'set', path: ['fontSizeCode'], value: 11 },
    ])
    keyboard.press({ code: 'Minus' })
    expect(theme.getTheme().fontSizes).toEqual({ text: 21, code: 10, terminal: 19 })
    keyboard.press({ code: 'Minus' })
    expect(theme.getTheme().fontSizes).toEqual({ text: 20, code: 10, terminal: 18 })
    expect(host.mutate).toHaveBeenLastCalledWith([
      { op: 'set', path: ['fontSize'], value: 20 },
      { op: 'set', path: ['terminalFontSize'], value: 18 },
    ])
  })

  it('adopts all durable font sizes together after a refused batch settles', async () => {
    const host = stubConfigForm<ThemeSettings>()
    const section: ThemeSettings = { ...DEFAULT_THEME_SETTINGS, preference: 'system', fontSize: 14, fontSizeCode: 11, terminalFontSize: 13,
      fontFamilySans: '', fontFamilyCode: '', fontFamilyTerminal: '' }
    host.publish({ status: 'ready', value: section, revision: 1, writable: true })
    const { theme, keyboard } = await keyboardTheme(host)
    const write = Promise.withResolvers<boolean>()
    host.mutate.mockReturnValue(write.promise)
    keyboard.press()
    host.publish({ value: section, revision: 2 })
    expect(theme.getTheme().fontSizes).toEqual({ text: 15, code: 12, terminal: 14 })
    write.resolve(false)
    await vi.waitFor(() => { expect(theme.getTheme().fontSizes).toEqual({ text: 14, code: 11, terminal: 13 }) })
  })

  it.each(['macos', 'windows', 'linux'] as const)('shares %s font shortcuts with the settings control and durable values', async (platform) => {
    const b = await bench()
    const keyboard = fontKeyboard(b.ctx, 'desktop', platform)
    declareItems(b.slots)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const theme = b.ctx.get('theme') as ThemeRuntime
    const { instance, face } = fontSettingsFaceOf(b.slots)

    expect(keyboard.press()).toHaveBeenCalledOnce()
    expect(theme.getTheme().fontSizes).toEqual({ text: 15, code: 12, terminal: 14 })
    keyboard.press({ shift: true }, { region: 'editable' })
    expect(instance.getSnapshot().fontSizes).toEqual({ text: 16, code: 13, terminal: 15 })
    keyboard.press({ code: 'Minus' })
    expect(instance.getSnapshot().fontSizes).toEqual({ text: 15, code: 12, terminal: 14 })
    face.setFontSize('text', 20)
    keyboard.press()
    expect(theme.getTheme().fontSizes).toEqual({ text: 21, code: 13, terminal: 15 })
    await vi.waitFor(() => { expect(b.mutate).toHaveBeenCalledTimes(5) })
    expect(b.mutate.mock.calls.at(-1)?.[1]).toEqual([
      { op: 'set', path: ['fontSize'], value: 21 },
      { op: 'set', path: ['fontSizeCode'], value: 13 },
      { op: 'set', path: ['terminalFontSize'], value: 15 },
    ])
    expect(theme.getTheme().fontSizes).toEqual({ text: 21, code: 13, terminal: 15 })

    await fiber.dispose()
    expect(keyboard.registry.fixedCatalog.getSnapshot()).toEqual([])
    expect(keyboard.press()).not.toHaveBeenCalled()
    expect(theme.getTheme().fontSizes.text).toBe(21)
    await b.ctx.fiber.dispose()
  })

  it('presents both desktop font actions with their accepted physical combinations', async () => {
    const b = await bench()
    const keyboard = fontKeyboard(b.ctx)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    expect(keyboard.registry.fixedCatalog.getSnapshot().map(row => ({
      label: row.label, keys: row.keys, bindings: row.bindings.map(bindingKey),
    }))).toMatchInlineSnapshot(`
      [
        {
          "bindings": [
            "meta+Equal",
            "shift+meta+Equal",
          ],
          "keys": [
            "⌘",
            "=",
          ],
          "label": "增大字号",
        },
        {
          "bindings": [
            "meta+Minus",
          ],
          "keys": [
            "⌘",
            "-",
          ],
          "label": "减小字号",
        },
      ]
    `)
    await b.ctx.fiber.dispose()
  })

  it('consumes font shortcuts at either size limit without persisting another write', async () => {
    const b = await bench()
    const keyboard = fontKeyboard(b.ctx)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const theme = b.ctx.get('theme') as ThemeRuntime
    theme.setFontSize('text', 22)
    theme.setFontSize('code', 20)
    theme.setFontSize('terminal', 20)
    await vi.waitFor(() => { expect(b.mutate).toHaveBeenCalledTimes(3) })
    expect(keyboard.press()).toHaveBeenCalledOnce()
    expect(keyboard.press({ shift: true })).toHaveBeenCalledOnce()
    theme.setFontSize('text', 10)
    theme.setFontSize('code', 10)
    theme.setFontSize('terminal', 10)
    await vi.waitFor(() => { expect(b.mutate).toHaveBeenCalledTimes(6) })
    expect(keyboard.press({ code: 'Minus' })).toHaveBeenCalledOnce()
    expect(theme.getTheme().fontSizes).toEqual({ text: 10, code: 10, terminal: 10 })
    expect(b.mutate).toHaveBeenCalledTimes(6)
    await b.ctx.fiber.dispose()
  })

  it('leaves browser zoom and locally owned input unchanged', async () => {
    const browser = await bench()
    const web = fontKeyboard(browser.ctx, 'web')
    await browser.ctx.plugin({ inject: [...inject], apply }).await()
    expect(web.registry.fixedCatalog.getSnapshot()).toEqual([])
    expect(web.press()).not.toHaveBeenCalled()
    await browser.ctx.fiber.dispose()

    const b = await bench()
    const keyboard = fontKeyboard(b.ctx)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    for (const gesture of [
      { composing: true }, { defaultPrevented: true }, { repeat: true }, { alt: true },
      { meta: false }, { control: true }, { code: 'KeyA' }, { code: 'Minus', shift: true },
    ]) expect(keyboard.press(gesture)).not.toHaveBeenCalled()
    expect(keyboard.press({}, { region: 'terminal' })).not.toHaveBeenCalled()
    keyboard.reset()
    expect((b.ctx.get('theme') as ThemeRuntime).getTheme().fontSizes.text).toBe(14)
    expect(b.mutate).not.toHaveBeenCalled()
    await b.ctx.fiber.dispose()
  })

  it('declares the slot and locale services', () => {
    expect(inject).toEqual(['slots', 'locale', 'remote', 'configForms'])
  })

  it('provides the service, registers localized copy, and registers the section and font-size row', async () => {
    const before = await bench()
    declareSlots(before.slots)
    await before.ctx.plugin({ inject: [...inject], apply }).await()
    expect(before.locale.bind(SETTINGS_NS)('appearance.title')).toBe('外观')
    expect(before.locale.bind(SETTINGS_NS)('fontSize.text.title')).toBe('字号大小')
    before.locale.setLocale('en')
    expect(before.locale.bind(SETTINGS_NS)('appearance.title')).toBe('Appearance')
    const entry = before.slots.entries(SECTION_SLOT).find(e => e.options.id === 'appearance')!
    expect(entry.options).toMatchObject({ id: 'appearance', order: 5 })
    const fontEntry = before.slots.entries(ITEM_SLOT).find(e => e.options.id === 'font-size')!
    expect(fontEntry.options).toMatchObject({ id: 'font-size', order: 11 })
    expect(fontEntry.locale).toBe(SETTINGS_NS)

    const after = await bench()
    const fiber = after.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(after.slots.entries(SECTION_SLOT)).toHaveLength(0)
    expect(after.slots.entries(ITEM_SLOT)).toHaveLength(0)
    declareSlots(after.slots)
    await Promise.resolve()
    expect(after.slots.entries(SECTION_SLOT).some(e => e.options.id === 'appearance')).toBe(true)
    expect(after.slots.entries(ITEM_SLOT).some(e => e.options.id === 'font-size')).toBe(true)
  })

  it('projects service snapshots into the section store and routes face writes back', async () => {
    const b = await bench()
    declareSlots(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const theme = b.ctx.get('theme') as ThemeRuntime
    // An event ahead of any inject hits the unbound-actions arm.
    theme.setTheme('dark')

    const { instance, face } = faceOf(b.slots)
    // The inject-time re-sync sealed the init window: the mirror is current.
    expect(instance.getSnapshot().preference).toBe('dark')
    expect(b.slots.entries(SECTION_SLOT).find(e => e.options.id === 'appearance')!.locale).toBe(SETTINGS_NS)

    face.setTheme('system')
    expect(theme.getTheme().preference).toBe('system')
    expect(instance.getSnapshot().preference).toBe('system')
    // Desktop fork: preference writes debounce 300ms per field, so the dark
    // pick and the system pick collapse into ONE Host mutation.
    await vi.waitFor(() => { expect(b.mutate).toHaveBeenCalledTimes(1) })
    expect(b.mutate.mock.calls.at(-1)?.[1].at(-1)?.value).toBe('system')
  })

  it('projects font-size snapshots into its row store and routes face writes back', async () => {
    const b = await bench()
    declareSlots(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const theme = b.ctx.get('theme') as ThemeRuntime
    // An event ahead of any inject hits the unbound-actions arm.
    theme.setFontSize('text', 16)

    const { instance, face } = fontSettingsFaceOf(b.slots)
    // The inject-time re-sync sealed the init window: the mirror is current.
    expect(instance.getSnapshot().fontSizes.text).toBe(16)

    face.setFontSize('text', 12)
    expect(theme.getTheme().fontSizes.text).toBe(12)
    expect(instance.getSnapshot().fontSizes.text).toBe(12)
    await vi.waitFor(() => { expect(b.mutate).toHaveBeenCalledTimes(2) })
  })

  it('projects font snapshots into the shared font store and routes group writes by role', async () => {
    const b = await bench()
    declareItems(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const theme = b.ctx.get('theme') as ThemeRuntime
    theme.setFontFamily('code', 'Iosevka')

    const group = fontSettingsFaceOf(b.slots)
    expect(group.instance.getSnapshot().fontFamilies.code).toBe('"Iosevka"')

    group.face.setFontFamily('terminal', 'MesloLGS NF')
    group.face.setFontSize('terminal', 16)
    expect(theme.getTheme().fontFamilies).toEqual({ text: '', code: '"Iosevka"', terminal: '"MesloLGS NF"' })
    expect(group.instance.getSnapshot().fontSizes.terminal).toBe(16)
    await vi.waitFor(() => { expect(b.mutate).toHaveBeenCalledTimes(3) })
  })

  it('loads Host settings at boot, refreshes its namespace, and persists for a trusted remote page', async () => {
    const b = await bench()
    b.setHostSection({ preference: 'dark', fontSize: 17 })
    b.events.emit('settings/document-updated', [THEME_SETTINGS_NAMESPACE, 0])
    declareSlots(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const theme = b.ctx.get('theme') as ThemeRuntime
    await vi.waitFor(() => { expect(theme.getTheme().preference).toBe('dark') })
    expect(theme.getTheme().fontSize).toBe(17)
    b.events.emit('settings/document-updated', ['unrelated', 0])
    await vi.waitFor(() => { expect(b.describe).toHaveBeenCalledTimes(3) })
    expect(theme.getTheme().preference).toBe('dark')
    b.setHostSection({ preference: 'light' })
    b.events.emit('settings/document-updated', [THEME_SETTINGS_NAMESPACE, 0])
    await vi.waitFor(() => { expect(theme.getTheme().preference).toBe('light') })
    b.setHostSection({ preference: 'dark' })
    b.ctx.emit('connection/reset')
    await vi.waitFor(() => { expect(theme.getTheme().preference).toBe('dark') })

    // A non-loopback page persists through the same path as loopback.
    const remote = await bench(false)
    declareSlots(remote.slots)
    await remote.ctx.plugin({ inject: [...inject], apply }).await()
    const remoteTheme = remote.ctx.get('theme') as ThemeRuntime
    remoteTheme.setTheme('dark')
    await vi.waitFor(() => {
      expect(remote.mutate).toHaveBeenCalledWith(THEME_SETTINGS_NAMESPACE, [{ op: 'set', path: ['preference'], value: 'dark' }], 0)
    })
  })

  it('activates before a slow settings refresh and converges when it settles', async () => {
    const b = await bench()
    b.setHostSection({ preference: 'dark' })
    const describe = b.describe.getMockImplementation()!
    const pending = deferred<Awaited<ReturnType<typeof describe>>>()
    b.describe.mockImplementationOnce(() => pending.promise)
    b.events.emit('settings/document-updated', [THEME_SETTINGS_NAMESPACE, 0])
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const theme = b.ctx.get('theme') as ThemeRuntime
    expect(theme.getTheme().preference).toBe('system')
    pending.resolve(await describe())
    await vi.waitFor(() => { expect(theme.getTheme().preference).toBe('dark') })
    await fiber.dispose()
  })

  it('ignores an invalid preference crossing the settings wire', async () => {
    const b = await bench()
    b.setHostSection({ preference: 'sepia' })
    b.events.emit('settings/document-updated', [THEME_SETTINGS_NAMESPACE, 0])
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const theme = b.ctx.get('theme') as ThemeRuntime
    await vi.waitFor(() => { expect(b.describe).toHaveBeenCalledTimes(2) })
    expect(theme.getTheme().preference).toBe('system')
  })

  it('recovers after an HMR collapse of the declaring entry (stale disposer must not block)', async () => {
    const b = await bench()
    const host = declareSlots(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    expect(b.slots.entries(SECTION_SLOT)).toHaveLength(1)
    expect(b.slots.entries(ITEM_SLOT)).toHaveLength(1)

    host()
    expect(b.slots.entries(SECTION_SLOT)).toHaveLength(0)
    expect(b.slots.entries(ITEM_SLOT)).toHaveLength(0)

    declareSlots(b.slots)
    await Promise.resolve()
    expect(b.slots.entries(SECTION_SLOT).some(e => e.options.id === 'appearance')).toBe(true)
    expect(b.slots.entries(ITEM_SLOT).some(e => e.options.id === 'font-size')).toBe(true)
  })

  it('teardown removes the section, the font-size row, and the dictionaries; teardown without a declaration is quiet', async () => {
    const b = await bench()
    declareSlots(b.slots)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.slots.entries(SECTION_SLOT)).toHaveLength(1)
    expect(b.slots.entries(ITEM_SLOT)).toHaveLength(1)
    await fiber.dispose()
    expect(b.slots.entries(SECTION_SLOT)).toHaveLength(0)
    expect(b.slots.entries(ITEM_SLOT)).toHaveLength(0)
    expect(b.locale.bind(SETTINGS_NS)('appearance.title')).toBe('appearance.title')

    const quiet = await bench()
    const f2 = quiet.ctx.plugin({ inject: [...inject], apply })
    await f2.await()
    await f2.dispose()
    expect(quiet.slots.entries(SECTION_SLOT)).toHaveLength(0)
    expect(quiet.slots.entries(ITEM_SLOT)).toHaveLength(0)
  })
})
