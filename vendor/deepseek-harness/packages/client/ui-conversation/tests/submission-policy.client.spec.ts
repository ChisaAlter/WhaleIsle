// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { stubConfigForm } from '@deepseek-ai/dsh-client-test-runtime'
import type { SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import {
  ComposerSubmissionPolicy, DEFAULT_BUSY_ENTER_BEHAVIOR, DEFAULT_COMPOSER_BEAM_PRESETS,
  DEFAULT_COMPOSER_BEAM_STYLE, DEFAULT_TYPING_FX_PRESETS, DEFAULT_TYPING_FX_STYLE,
  normalizeComposerBeamPresets, normalizeComposerBeamStyle,
  normalizeTypingFxPresets, normalizeTypingFxStyle, resolveSubmitMode,
} from '../src/client/input/submission-policy.ts'
import type { ConversationSettings } from '../src/submission-settings.ts'
import { ConversationSettingsSchema } from '../src/submission-settings.ts'

function chrome(over: Partial<ConversationSettings> = {}): ConversationSettings {
  return {
    busyEnter: 'queue',
    composerBeam: true,
    composerResize: false,
    composerResizeHeight: null,
    composerResizeWidth: null,
    customInstructions: '',
    statsLine: true,
    officialPeakValley: false,
    viewTabs: true,
    ...over,
  }
}

describe('resolveSubmitMode', () => {
  it('queues outside steer-capable busy state and applies the preference to the enter gesture', () => {
    expect(resolveSubmitMode('queue', false, 'enter', true)).toBe('queue')
    expect(resolveSubmitMode('queue', false, 'accelerated', true)).toBe('queue')
    expect(resolveSubmitMode('queue', true, 'enter', true)).toBe('queue')
    expect(resolveSubmitMode('queue', true, 'accelerated', true)).toBe('steer')
    expect(resolveSubmitMode('queue', true, 'enter', false)).toBe('queue')
    expect(resolveSubmitMode('queue', true, 'accelerated', false)).toBe('queue')

    expect(resolveSubmitMode('steer', true, 'enter', true)).toBe('steer')
    expect(resolveSubmitMode('steer', true, 'accelerated', true)).toBe('queue')
    expect(resolveSubmitMode('steer', false, 'enter', true)).toBe('queue')
    expect(resolveSubmitMode('steer', false, 'accelerated', true)).toBe('queue')
    expect(resolveSubmitMode('steer', true, 'enter', false)).toBe('queue')
  })
})

describe('ComposerSubmissionPolicy', () => {
  it.each([
    ['statsLine', 'setStatsLine', false],
    ['sessionCost', 'setSessionCost', true],
    ['officialPeakValley', 'setOfficialPeakValley', true],
    ['nextPrompt', 'setNextPrompt', false],
  ] as const)('keeps the latest %s choice while an older Host snapshot arrives during its write', async (field, setter, value) => {
    const host = stubConfigForm<ConversationSettings>()
    host.publish({ status: 'ready', value: chrome({ sessionCost: false }), revision: 1, writable: true })
    const write = Promise.withResolvers<boolean>()
    host.set.mockReturnValue(write.promise)
    const policy = new ComposerSubmissionPolicy(host.scope)
    const changes: boolean[] = []
    policy[field].subscribe(() => { changes.push(policy[field].getSnapshot()) })
    policy[setter](value)
    host.publish({ value: chrome({ sessionCost: false }), revision: 2 })
    expect(policy[field].getSnapshot()).toBe(value)
    expect(changes).toEqual([value])
    host.publish({ value: chrome({ sessionCost: false, [field]: value }), revision: 3 })
    write.resolve(true)
    await write.promise
    expect(policy[field].getSnapshot()).toBe(value)
    policy.dispose()
  })

  it('defaults to Queue and publishes preference changes', () => {
    const policy = new ComposerSubmissionPolicy()
    expect(policy.busyEnter.getSnapshot()).toBe(DEFAULT_BUSY_ENTER_BEHAVIOR)

    const changed = vi.fn()
    policy.busyEnter.subscribe(changed)
    policy.setBusyEnter('steer')
    expect(changed).toHaveBeenCalledTimes(1)
    expect(policy.busyEnter.getSnapshot()).toBe('steer')
  })

  it('enables next-prompt suggestions by default without writing a missing Host preference', () => {
    expect(ConversationSettingsSchema({}).nextPrompt).toBe(true)
    const local = new ComposerSubmissionPolicy()
    expect(local.nextPrompt.getSnapshot()).toBe(true)
    local.dispose()

    const host = stubConfigForm<ConversationSettings>()
    const policy = new ComposerSubmissionPolicy(host.scope)
    expect(policy.nextPrompt.getSnapshot()).toBe(true)
    host.publish({ status: 'ready', value: chrome(), revision: 1, writable: true })
    expect(policy.nextPrompt.getSnapshot()).toBe(true)
    expect(host.set).not.toHaveBeenCalled()
    policy.dispose()
  })

  it('persists disabling next-prompt suggestions and restores that choice in a new policy', async () => {
    const host = stubConfigForm<ConversationSettings>()
    let saved = chrome()
    host.publish({ status: 'ready', value: saved, revision: 1, writable: true })
    host.set.mockImplementation(async (field: string, value: unknown) => {
      saved = ConversationSettingsSchema({ ...saved, [field]: value })
      host.publish({ value: saved, revision: 2 })
      return true
    })
    const policy = new ComposerSubmissionPolicy(host.scope)
    policy.setNextPrompt(false)
    expect(policy.nextPrompt.getSnapshot()).toBe(false)
    expect(host.set).toHaveBeenCalledExactlyOnceWith('nextPrompt', false)
    await Promise.resolve()
    policy.dispose()

    const restoredHost = stubConfigForm<ConversationSettings>()
    restoredHost.publish({ status: 'ready', value: saved, revision: 2, writable: true })
    const restored = new ComposerSubmissionPolicy(restoredHost.scope)
    expect(restored.nextPrompt.getSnapshot()).toBe(false)
    restored.setNextPrompt(false)
    expect(restoredHost.set).not.toHaveBeenCalled()
    restored.dispose()
  })

  it('keeps the latest next-prompt intent through rapid off/on writes and delayed Host reflection', async () => {
    const host = stubConfigForm<ConversationSettings>()
    host.publish({ status: 'ready', value: chrome(), revision: 1, writable: true })
    const off = Promise.withResolvers<boolean>()
    const on = Promise.withResolvers<boolean>()
    host.set.mockReturnValueOnce(off.promise).mockReturnValueOnce(on.promise)
    const policy = new ComposerSubmissionPolicy(host.scope)
    policy.setNextPrompt(false)
    policy.setNextPrompt(true)
    expect(host.set).toHaveBeenNthCalledWith(1, 'nextPrompt', false)
    expect(host.set).toHaveBeenNthCalledWith(2, 'nextPrompt', true)

    host.publish({ value: chrome({ nextPrompt: false }), revision: 2 })
    off.resolve(true)
    await off.promise
    expect(policy.nextPrompt.getSnapshot()).toBe(true)
    on.resolve(true)
    await on.promise
    host.publish({ value: chrome({ nextPrompt: false }), revision: 3 })
    expect(policy.nextPrompt.getSnapshot()).toBe(true)

    host.publish({ value: chrome({ nextPrompt: true }), revision: 4 })
    host.publish({ value: chrome({ nextPrompt: false }), revision: 5 })
    expect(policy.nextPrompt.getSnapshot()).toBe(false)
    policy.dispose()
  })

  it('keeps all three latest choices across partial namespace publications and superseded settlements', async () => {
    const host = stubConfigForm<ConversationSettings>()
    host.publish({ value: chrome({ sessionCost: false }), revision: 1 })
    const writes = Array.from({ length: 5 }, () => Promise.withResolvers<boolean>())
    for (const write of writes) host.set.mockReturnValueOnce(write.promise)
    const policy = new ComposerSubmissionPolicy(host.scope)
    const snapshot = () => [policy.statsLine.getSnapshot(), policy.sessionCost.getSnapshot(), policy.officialPeakValley.getSnapshot()]
    policy.setStatsLine(false)
    policy.setSessionCost(true)
    policy.setOfficialPeakValley(true)
    policy.setStatsLine(true)
    policy.setStatsLine(false)
    expect(snapshot()).toEqual([false, true, true])
    host.publish({ value: chrome({ statsLine: false, sessionCost: false }), revision: 2 })
    writes[0]!.resolve(true)
    writes[1]!.resolve(true)
    writes[3]!.resolve(false)
    await Promise.all([writes[0]!.promise, writes[1]!.promise, writes[3]!.promise])
    // The accepted cost write has not reached the shared namespace mirror yet.
    host.publish({ value: chrome({ statsLine: true, sessionCost: false }), revision: 3 })
    expect(snapshot()).toEqual([false, true, true])
    host.publish({ value: chrome({ statsLine: false, sessionCost: true, officialPeakValley: true }), revision: 4 })
    writes[2]!.resolve(true)
    writes[4]!.resolve(true)
    await Promise.all(writes.map(write => write.promise))
    expect(snapshot()).toEqual([false, true, true])
    // After confirmation, genuine external changes are adopted again.
    host.publish({ value: chrome({ sessionCost: false }), revision: 5 })
    expect(snapshot()).toEqual([true, false, false])
    policy.dispose()
  })

  it.each([
    ['sessionCost', 'setSessionCost', true, 'refused'],
    ['sessionCost', 'setSessionCost', true, 'rejected'],
    ['nextPrompt', 'setNextPrompt', false, 'refused'],
    ['nextPrompt', 'setNextPrompt', false, 'rejected'],
  ] as const)('restores confirmed %s after %s(%s) is %s', async (field, setter, value, failure) => {
    const host = stubConfigForm<ConversationSettings>()
    host.publish({ value: chrome({ sessionCost: false }), revision: 1 })
    const write = Promise.withResolvers<boolean>()
    host.set.mockReturnValue(write.promise)
    const policy = new ComposerSubmissionPolicy(host.scope)
    policy[setter](value)
    host.publish({ value: chrome({ sessionCost: false }), revision: 2 })
    expect(policy[field].getSnapshot()).toBe(value)
    if (failure === 'refused') write.resolve(false)
    else write.reject(new Error('transport disconnected'))
    await write.promise.catch(() => {})
    expect(policy[field].getSnapshot()).toBe(!value)
    policy[setter](value)
    expect(host.set).toHaveBeenCalledTimes(2)
    policy.dispose()
  })

  it('does not publish a pending dock write settlement after disposal', async () => {
    const host = stubConfigForm<ConversationSettings>()
    host.publish({ value: chrome({ sessionCost: false }), revision: 1 })
    const write = Promise.withResolvers<boolean>()
    host.set.mockReturnValue(write.promise)
    const policy = new ComposerSubmissionPolicy(host.scope)
    policy.setSessionCost(true)
    const changed = vi.fn()
    policy.sessionCost.subscribe(changed)
    policy.dispose()
    write.resolve(false)
    await write.promise
    expect(changed).not.toHaveBeenCalled()
  })

  it('writes an explicit change through the scope after publishing it locally', () => {
    const host = stubConfigForm<ConversationSettings>()
    const observed: string[] = []
    let liveBehavior = (): string => 'unconstructed'
    const scope: typeof host.scope = {
      ...host.scope,
      set: (field, value) => {
        observed.push(`${field}=${String(value)}:${liveBehavior()}`)
        return host.scope.set(field, value)
      },
    }
    const policy = new ComposerSubmissionPolicy(scope)
    liveBehavior = () => policy.busyEnter.getSnapshot()
    policy.setBusyEnter('steer')
    expect(observed).toEqual(['busyEnter=steer:steer'])
    expect(host.set).toHaveBeenCalledWith('busyEnter', 'steer')
    expect(host.set).toHaveBeenCalledOnce()
  })

  it('adopts a Host preference without writing it back and leaves an identical write untouched', () => {
    const host = stubConfigForm<ConversationSettings>()
    const policy = new ComposerSubmissionPolicy(host.scope)
    host.publish({ status: 'ready', value: chrome({ busyEnter: 'steer' }), revision: 1, writable: true })
    expect(policy.busyEnter.getSnapshot()).toBe('steer')
    policy.setBusyEnter('steer')
    expect(host.set).not.toHaveBeenCalled()
    host.publish({ value: chrome({ busyEnter: 'steer' }), revision: 2 })
    expect(policy.busyEnter.getSnapshot()).toBe('steer')
  })

  it('adopts a section already standing at construction', () => {
    const host = stubConfigForm<ConversationSettings>()
    host.publish({ status: 'ready', value: chrome({ busyEnter: 'steer' }), revision: 1, writable: true })
    const policy = new ComposerSubmissionPolicy(host.scope)
    expect(policy.busyEnter.getSnapshot()).toBe('steer')
  })

  it('keeps the composer beam on while the Host section is missing and adopts false independently', () => {
    const host = stubConfigForm<ConversationSettings>()
    const policy = new ComposerSubmissionPolicy(host.scope)
    expect(policy.composerBeam.getSnapshot()).toBe(true)
    expect(policy.writable.getSnapshot()).toBe(false)
    host.publish({ status: 'unavailable', value: undefined, writable: false, mode: 'memory' })
    expect(policy.composerBeam.getSnapshot()).toBe(true)
    host.publish({
      status: 'ready',
      value: chrome({ busyEnter: 'steer', composerBeam: false }),
      revision: 1,
      writable: true,
    })
    expect(policy.busyEnter.getSnapshot()).toBe('steer')
    expect(policy.composerBeam.getSnapshot()).toBe(false)
    expect(policy.writable.getSnapshot()).toBe(true)
    policy.setComposerBeam(true)
    expect(policy.composerBeam.getSnapshot()).toBe(true)
    expect(host.set).toHaveBeenCalledWith('composerBeam', true)
    policy.setComposerBeam(true)
    expect(host.set).toHaveBeenCalledOnce()
  })

  it('treats a missing composerBeam field as shown', () => {
    const host = stubConfigForm<ConversationSettings>()
    const policy = new ComposerSubmissionPolicy(host.scope)
    policy.setComposerBeam(false)
    host.publish({
      status: 'ready',
      value: { busyEnter: 'queue' } as ConversationSettings,
      revision: 1,
      writable: true,
    })
    expect(policy.composerBeam.getSnapshot()).toBe(true)
  })

  it('publishes normalized beam tuning before persisting it and adopts legacy absence', () => {
    const host = stubConfigForm<ConversationSettings>()
    const policy = new ComposerSubmissionPolicy(host.scope)
    expect(policy.composerBeamStyle.getSnapshot()).toBe(DEFAULT_COMPOSER_BEAM_STYLE)

    const observed: number[] = []
    policy.composerBeamStyle.subscribe(() => { observed.push(policy.composerBeamStyle.getSnapshot().period) })
    policy.setComposerBeamStyle({
      ...DEFAULT_COMPOSER_BEAM_STYLE,
      direction: 'counterclockwise', period: 3, intensity: 120, bloom: 80, hue: 45,
    })
    expect(observed).toEqual([3])
    expect(host.set).toHaveBeenCalledWith('composerBeamStyle', {
      ...DEFAULT_COMPOSER_BEAM_STYLE,
      direction: 'counterclockwise', period: 3, intensity: 120, bloom: 80, hue: 45,
    })

    host.publish({
      status: 'ready', value: chrome(), revision: 1, writable: true,
    })
    expect(policy.composerBeamStyle.getSnapshot()).toEqual(DEFAULT_COMPOSER_BEAM_STYLE)
  })

  it('normalizes malformed or out-of-range beam tuning at the adoption boundary', () => {
    expect(normalizeComposerBeamStyle({
      direction: 'sideways', period: 99, intensity: -1, bloom: 999, hue: Number.NaN,
    })).toEqual({
      ...DEFAULT_COMPOSER_BEAM_STYLE,
      direction: 'clockwise', period: 60, intensity: 40, bloom: 160, hue: 0,
    })
  })

  it('publishes active style and presets in one atomic mutation', async () => {
    const host = stubConfigForm<ConversationSettings>()
    const policy = new ComposerSubmissionPolicy(host.scope)
    host.publish({ status: 'ready', value: chrome(), revision: 7, writable: true })
    const style = {
      ...DEFAULT_COMPOSER_BEAM_STYLE,
      direction: 'pingPong' as const,
      period: 60,
      trackWidth: 4,
      glowBlur: 0,
      breathing: { enabled: true, amplitude: 0.5, period: 9 },
      hueCycle: { enabled: false, range: 180, period: 20 },
      night: { enabled: true, fromMinute: 1320, toMinute: 360, dim: 50 },
      palette: { kind: 'custom' as const, colors: ['#112233', '#aabbcc'] },
    }
    const presets = { Focus: style }
    host.mutate.mockImplementation(async (ops: readonly SettingsPathOpView[]) => {
      const values = ops.filter(op => op.op === 'set')
      host.publish({
        status: 'ready',
        value: chrome({
          composerBeamStyle: values[0]?.value as never,
          composerBeamPresets: values[1]?.value as never,
        }),
        revision: 8,
        writable: true,
      })
      return true
    })
    await policy.setComposerBeamConfiguration(style, presets)
    expect(policy.composerBeamStyle.getSnapshot()).toEqual(style)
    expect(policy.composerBeamPresets.getSnapshot()).toEqual({ Focus: style })
    expect(host.mutate).toHaveBeenCalledWith([
      { op: 'set', path: ['composerBeamStyle'], value: style },
      { op: 'set', path: ['composerBeamPresets'], value: { Focus: style } },
    ], 7)
    expect(host.set).not.toHaveBeenCalled()
  })

  it('caps and sanitizes the preset library without mutating the caller', () => {
    const source: Record<string, unknown> = {
      '  one  ': DEFAULT_COMPOSER_BEAM_STYLE,
      two: DEFAULT_COMPOSER_BEAM_STYLE,
      three: DEFAULT_COMPOSER_BEAM_STYLE,
      four: DEFAULT_COMPOSER_BEAM_STYLE,
      five: DEFAULT_COMPOSER_BEAM_STYLE,
      six: DEFAULT_COMPOSER_BEAM_STYLE,
      __proto__: DEFAULT_COMPOSER_BEAM_STYLE,
    }
    expect(normalizeComposerBeamPresets(source)).toEqual({
      one: DEFAULT_COMPOSER_BEAM_STYLE,
      two: DEFAULT_COMPOSER_BEAM_STYLE,
      three: DEFAULT_COMPOSER_BEAM_STYLE,
      four: DEFAULT_COMPOSER_BEAM_STYLE,
      five: DEFAULT_COMPOSER_BEAM_STYLE,
    })
    expect(DEFAULT_COMPOSER_BEAM_PRESETS).toEqual({})
  })

  it('reports a rejected atomic mutation instead of claiming that the save succeeded', async () => {
    const host = stubConfigForm<ConversationSettings>()
    const policy = new ComposerSubmissionPolicy(host.scope)
    host.publish({ status: 'ready', value: chrome(), revision: 2, writable: true })
    await expect(policy.setComposerBeamConfiguration({ ...DEFAULT_COMPOSER_BEAM_STYLE, hue: 90 }, {})).rejects.toThrow()
    expect(host.mutate).toHaveBeenCalledOnce()
  })

  it('keeps composer resize off while the Host section is missing and adopts true independently', () => {
    const host = stubConfigForm<ConversationSettings>()
    const policy = new ComposerSubmissionPolicy(host.scope)
    expect(policy.composerResize.getSnapshot()).toBe(false)
    host.publish({ status: 'unavailable', value: undefined, writable: false, mode: 'memory' })
    expect(policy.composerResize.getSnapshot()).toBe(false)
    host.publish({
      status: 'ready',
      value: chrome({ composerResize: true }),
      revision: 1,
      writable: true,
    })
    expect(policy.composerResize.getSnapshot()).toBe(true)
    policy.setComposerResizeSize({ height: 180, width: 500 })
    expect(policy.composerResizeHeight.getSnapshot()).toBe(180)
    expect(policy.composerResizeWidth.getSnapshot()).toBe(500)
    policy.setComposerResize(false)
    expect(policy.composerResize.getSnapshot()).toBe(false)
    // Turning the switch off clears the live DOM size, but keeps the remembered
    // box so enabling resize again (or remounting) restores the last drag.
    expect(policy.composerResizeHeight.getSnapshot()).toBe(180)
    expect(policy.composerResizeWidth.getSnapshot()).toBe(500)
    expect(host.set).toHaveBeenCalledWith('composerResize', false)
    const calls = host.set.mock.calls.length
    policy.setComposerResize(false)
    expect(host.set).toHaveBeenCalledTimes(calls)
  })

  it('remembers a dragged composer size through the Host scope', () => {
    const host = stubConfigForm<ConversationSettings>()
    const policy = new ComposerSubmissionPolicy(host.scope)
    policy.setComposerResizeSize({ height: 140, width: 420 })
    expect(host.set).toHaveBeenCalledWith('composerResizeHeight', 140)
    expect(host.set).toHaveBeenCalledWith('composerResizeWidth', 420)
    host.publish({
      status: 'ready',
      value: chrome({ composerResize: true, composerResizeHeight: 140, composerResizeWidth: 420 }),
      revision: 1,
      writable: true,
    })
    expect(policy.composerResizeHeight.getSnapshot()).toBe(140)
    expect(policy.composerResizeWidth.getSnapshot()).toBe(420)
  })

  it('treats a missing composerResize field as off', () => {
    const host = stubConfigForm<ConversationSettings>()
    const policy = new ComposerSubmissionPolicy(host.scope)
    policy.setComposerResize(true)
    host.publish({
      status: 'ready',
      value: { busyEnter: 'queue' } as ConversationSettings,
      revision: 1,
      writable: true,
    })
    expect(policy.composerResize.getSnapshot()).toBe(false)
  })

  it('keeps statsLine and viewTabs on while the Host section is missing and adopts false independently', () => {
    const host = stubConfigForm<ConversationSettings>()
    const policy = new ComposerSubmissionPolicy(host.scope)
    expect(policy.statsLine.getSnapshot()).toBe(true)
    expect(policy.viewTabs.getSnapshot()).toBe(true)
    host.publish({ status: 'unavailable', value: undefined, writable: false, mode: 'memory' })
    expect(policy.statsLine.getSnapshot()).toBe(true)
    expect(policy.viewTabs.getSnapshot()).toBe(true)
    host.publish({
      status: 'ready',
      value: chrome({ statsLine: false, viewTabs: false }),
      revision: 1,
      writable: true,
    })
    expect(policy.statsLine.getSnapshot()).toBe(false)
    expect(policy.viewTabs.getSnapshot()).toBe(false)
    policy.setStatsLine(true)
    expect(policy.statsLine.getSnapshot()).toBe(true)
    expect(host.set).toHaveBeenCalledWith('statsLine', true)
    policy.setViewTabs(true)
    expect(policy.viewTabs.getSnapshot()).toBe(true)
    expect(host.set).toHaveBeenCalledWith('viewTabs', true)
    policy.setStatsLine(true)
    policy.setViewTabs(true)
    expect(host.set).toHaveBeenCalledTimes(2)
  })

  it('treats missing statsLine and viewTabs fields as shown', () => {
    const host = stubConfigForm<ConversationSettings>()
    host.publish({ value: chrome({ statsLine: false, viewTabs: false }) })
    const policy = new ComposerSubmissionPolicy(host.scope)
    host.publish({
      status: 'ready',
      value: { busyEnter: 'queue' } as ConversationSettings,
      revision: 1,
      writable: true,
    })
    expect(policy.statsLine.getSnapshot()).toBe(true)
    expect(policy.viewTabs.getSnapshot()).toBe(true)
  })

  it('keeps officialPeakValley off while the Host section is missing and adopts true independently', () => {
    const host = stubConfigForm<ConversationSettings>()
    const policy = new ComposerSubmissionPolicy(host.scope)
    expect(policy.officialPeakValley.getSnapshot()).toBe(false)
    host.publish({ status: 'unavailable', value: undefined, writable: false, mode: 'memory' })
    expect(policy.officialPeakValley.getSnapshot()).toBe(false)
    host.publish({
      status: 'ready',
      value: chrome({ officialPeakValley: true }),
      revision: 1,
      writable: true,
    })
    expect(policy.officialPeakValley.getSnapshot()).toBe(true)
    policy.setOfficialPeakValley(false)
    expect(policy.officialPeakValley.getSnapshot()).toBe(false)
    expect(host.set).toHaveBeenCalledWith('officialPeakValley', false)
    policy.setOfficialPeakValley(false)
    expect(host.set).toHaveBeenCalledOnce()
  })

  it('treats a missing officialPeakValley field as detection-only', () => {
    const host = stubConfigForm<ConversationSettings>()
    host.publish({ value: chrome({ officialPeakValley: true }) })
    const policy = new ComposerSubmissionPolicy(host.scope)
    host.publish({
      status: 'ready',
      value: { busyEnter: 'queue' } as ConversationSettings,
      revision: 1,
      writable: true,
    })
    expect(policy.officialPeakValley.getSnapshot()).toBe(false)
  })

  it('keeps typingFx off while the Host section is missing and adopts true independently', () => {
    const host = stubConfigForm<ConversationSettings>()
    const policy = new ComposerSubmissionPolicy(host.scope)
    expect(policy.typingFx.getSnapshot()).toBe(false)
    host.publish({ status: 'unavailable', value: undefined, writable: false, mode: 'memory' })
    expect(policy.typingFx.getSnapshot()).toBe(false)
    host.publish({
      status: 'ready',
      value: chrome({ typingFx: true, typingFxStyle: { ...DEFAULT_TYPING_FX_STYLE, cursor: 'block' } }),
      revision: 1,
      writable: true,
    })
    expect(policy.typingFx.getSnapshot()).toBe(true)
    expect(policy.typingFxStyle.getSnapshot().cursor).toBe('block')
    policy.setTypingFx(false)
    expect(policy.typingFx.getSnapshot()).toBe(false)
    expect(host.set).toHaveBeenCalledWith('typingFx', false)
    policy.setTypingFx(false)
    expect(host.set).toHaveBeenCalledOnce()
  })

  it('treats missing typingFx fields as the shipped defaults', () => {
    const host = stubConfigForm<ConversationSettings>()
    const policy = new ComposerSubmissionPolicy(host.scope)
    policy.setTypingFx(true)
    host.publish({
      status: 'ready',
      value: { busyEnter: 'queue' } as ConversationSettings,
      revision: 1,
      writable: true,
    })
    expect(policy.typingFx.getSnapshot()).toBe(false)
    expect(policy.typingFxStyle.getSnapshot()).toEqual(DEFAULT_TYPING_FX_STYLE)
    expect(policy.typingFxPresets.getSnapshot()).toEqual(DEFAULT_TYPING_FX_PRESETS)
  })

  it('normalizes malformed typing-fx tuning at the adoption boundary', () => {
    const host = stubConfigForm<ConversationSettings>()
    const policy = new ComposerSubmissionPolicy(host.scope)
    host.publish({
      status: 'ready',
      value: chrome({
        typingFx: true,
        typingFxStyle: { effect: 'spiral', cursor: 'beam', cursorBlink: 'yes', speed: 9999 } as never,
      }),
      revision: 1,
      writable: true,
    })
    expect(policy.typingFxStyle.getSnapshot()).toEqual({ ...DEFAULT_TYPING_FX_STYLE, speed: 240 })
    expect(normalizeTypingFxStyle('junk')).toEqual(DEFAULT_TYPING_FX_STYLE)
    expect(normalizeTypingFxPresets('junk')).toEqual({})
  })

  it('publishes typing-fx style and presets in one atomic mutation', async () => {
    const host = stubConfigForm<ConversationSettings>()
    const policy = new ComposerSubmissionPolicy(host.scope)
    host.publish({ status: 'ready', value: chrome(), revision: 7, writable: true })
    const style = {
      effect: 'flash' as const, cursor: 'underline' as const, cursorBlink: false, speed: 160,
      colors: { kind: 'preset' as const, id: 'candy' as const },
    }
    const presets = { Calm: style }
    host.mutate.mockImplementation(async (ops: readonly SettingsPathOpView[]) => {
      const values = ops.filter(op => op.op === 'set')
      host.publish({
        status: 'ready',
        value: chrome({
          typingFxStyle: values[0]?.value as never,
          typingFxPresets: values[1]?.value as never,
        }),
        revision: 8,
        writable: true,
      })
      return true
    })
    await policy.setTypingFxConfiguration(style, presets)
    expect(policy.typingFxStyle.getSnapshot()).toEqual(style)
    expect(policy.typingFxPresets.getSnapshot()).toEqual({ Calm: style })
    expect(host.mutate).toHaveBeenCalledWith([
      { op: 'set', path: ['typingFxStyle'], value: style },
      { op: 'set', path: ['typingFxPresets'], value: { Calm: style } },
    ], 7)
    expect(host.set).not.toHaveBeenCalled()
  })

  it('reports a rejected typing-fx mutation instead of claiming that the save succeeded', async () => {
    const host = stubConfigForm<ConversationSettings>()
    const policy = new ComposerSubmissionPolicy(host.scope)
    host.publish({ status: 'ready', value: chrome(), revision: 2, writable: true })
    await expect(policy.setTypingFxConfiguration({ ...DEFAULT_TYPING_FX_STYLE, speed: 200 }, {}))
      .rejects.toThrow()
    expect(host.mutate).toHaveBeenCalledOnce()
  })

  it('refuses typing-fx configuration writes while the Host is not writable', async () => {
    const host = stubConfigForm<ConversationSettings>()
    const policy = new ComposerSubmissionPolicy(host.scope)
    await expect(policy.setTypingFxConfiguration({ ...DEFAULT_TYPING_FX_STYLE, speed: 200 }, {}))
      .rejects.toThrow()
    expect(host.mutate).not.toHaveBeenCalled()
    expect(policy.typingFxStyle.getSnapshot()).toEqual(DEFAULT_TYPING_FX_STYLE)
  })

  it('publishes custom instructions immediately and debounces the durable write', async () => {
    vi.useFakeTimers()
    try {
      const host = stubConfigForm<ConversationSettings>()
      const policy = new ComposerSubmissionPolicy(host.scope)
      policy.setCustomInstructions('first')
      policy.setCustomInstructions('second')
      expect(policy.customInstructions.getSnapshot()).toBe('second')
      expect(host.set).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1000)
      expect(host.set).toHaveBeenCalledWith('customInstructions', 'second')
      expect(host.set).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })

  it('adopts committed instructions but never reverts a queued or in-flight edit', async () => {
    vi.useFakeTimers()
    try {
      const host = stubConfigForm<ConversationSettings>()
      const policy = new ComposerSubmissionPolicy(host.scope)
      host.publish({
        status: 'ready',
        value: chrome({ customInstructions: 'committed' }),
        revision: 1,
        writable: true,
      })
      expect(policy.customInstructions.getSnapshot()).toBe('committed')

      policy.setCustomInstructions('draft')
      host.publish({
        status: 'ready',
        value: chrome({ customInstructions: 'committed' }),
        revision: 2,
        writable: true,
      })
      expect(policy.customInstructions.getSnapshot()).toBe('draft')
      await vi.advanceTimersByTimeAsync(1000)
      await vi.waitFor(() => {
        expect(policy.customInstructions.getSnapshot()).toBe('draft')
      })
      host.publish({
        status: 'ready',
        value: chrome({ customInstructions: 'draft' }),
        revision: 3,
        writable: true,
      })
      expect(policy.customInstructions.getSnapshot()).toBe('draft')
    } finally {
      vi.useRealTimers()
    }
  })
})
