// @vitest-environment jsdom
/** Durable drafts and asynchronous close confirmation share one file owner. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DesktopFileState } from '../src/client/desktop-file-state.ts'

const ADDRESS = 'dsh-resource://file/session/session-files/src/a.ts'
const OTHER = 'dsh-resource://file/session/session-files/src/b.ts'
const dirty = { text: 'disk', draft: 'edited' }

afterEach(() => { vi.restoreAllMocks(); localStorage.clear() })

describe('DesktopFileState', () => {
  it('persists each edit immediately and restores it in a new plugin lifetime', () => {
    const first = new DesktopFileState()
    first.write(ADDRESS, dirty)
    first.dispose()
    const restored = new DesktopFileState()
    expect(restored.read(ADDRESS)).toEqual(dirty)
    restored.write(ADDRESS, { text: 'edited', draft: 'edited' })
    expect(new DesktopFileState().read(ADDRESS)).toBeUndefined()
  })

  it('writes each changed draft immediately without writing the render echo again', () => {
    const write = vi.spyOn(Storage.prototype, 'setItem')
    const state = new DesktopFileState()
    for (const draft of ['a', 'ab', 'abc']) {
      state.write(ADDRESS, { text: 'disk', draft })
      expect(new DesktopFileState().read(ADDRESS)?.draft).toBe(draft)
      state.write(ADDRESS, { text: 'disk', draft })
    }
    expect(write).toHaveBeenCalledTimes(3)
    state.write(ADDRESS, { text: 'new baseline', draft: 'abc' })
    expect(write).toHaveBeenCalledTimes(4)
    expect(new DesktopFileState().read(ADDRESS)).toEqual({ text: 'new baseline', draft: 'abc' })
  })

  it('does not treat a failed storage write as a persisted draft', () => {
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
      throw new Error('quota')
    })
    const state = new DesktopFileState()
    state.write(ADDRESS, dirty)
    expect(state.read(ADDRESS)).toEqual(dirty)
    expect(new DesktopFileState().read(ADDRESS)).toBeUndefined()
    state.write(ADDRESS, { ...dirty })
    expect(write).toHaveBeenCalledTimes(2)
    expect(new DesktopFileState().read(ADDRESS)).toEqual(dirty)
  })

  it('keeps a dirty draft and cancels close without removing its tab', () => {
    const state = new DesktopFileState()
    const proceed = vi.fn(() => true)
    state.write(ADDRESS, dirty)
    expect(state.requestClose('tab-a', ADDRESS, 'src/a.ts', proceed)).toBe(false)
    expect(state.closeRequest.getSnapshot()).toEqual({ path: 'src/a.ts', busy: false, failed: false })
    state.cancelClose()
    expect(proceed).not.toHaveBeenCalled()
    expect(state.closeRequest.getSnapshot()).toBeUndefined()
    expect(new DesktopFileState().read(ADDRESS)).toEqual(dirty)
  })

  it('discards only the confirmed draft and coalesces repeated close requests', () => {
    const state = new DesktopFileState()
    const first = vi.fn(() => true)
    const repeated = vi.fn(() => true)
    const second = vi.fn(() => true)
    state.write(ADDRESS, dirty)
    state.write(OTHER, dirty)
    state.requestClose('tab-a', ADDRESS, 'src/a.ts', first)
    state.requestClose('tab-a', ADDRESS, 'src/a.ts', repeated)
    state.requestClose('tab-b', OTHER, 'src/b.ts', second)
    state.discardClose()
    expect(first).toHaveBeenCalledOnce()
    expect(repeated).not.toHaveBeenCalled()
    expect(state.read(ADDRESS)).toBeUndefined()
    expect(new DesktopFileState().read(ADDRESS)).toBeUndefined()
    expect(state.closeRequest.getSnapshot()?.path).toBe('src/b.ts')
    expect(state.read(OTHER)).toEqual(dirty)
    state.cancelClose()
    expect(second).not.toHaveBeenCalled()
  })

  it.each(['false', 'throw'] as const)('preserves the tab and draft when Save returns %s', async (result) => {
    const state = new DesktopFileState()
    const proceed = vi.fn(() => true)
    state.write(ADDRESS, dirty)
    state.registerSave('tab-a', ADDRESS, async () => {
      if (result === 'throw') throw new Error('write failed')
      return false
    })
    state.requestClose('tab-a', ADDRESS, 'src/a.ts', proceed)
    await state.saveClose()
    expect(proceed).not.toHaveBeenCalled()
    expect(state.closeRequest.getSnapshot()).toEqual({ path: 'src/a.ts', busy: false, failed: true })
    expect(new DesktopFileState().read(ADDRESS)).toEqual(dirty)
  })

  it('leaves new characters dirty when an earlier Save succeeds', async () => {
    const state = new DesktopFileState()
    const proceed = vi.fn(() => true)
    let complete: (() => void) | undefined
    state.write(ADDRESS, dirty)
    state.registerSave('tab-a', ADDRESS, async () => {
      await new Promise<void>((resolve) => { complete = resolve })
      state.write(ADDRESS, { text: dirty.draft, draft: 'new characters' })
      return true
    })
    state.requestClose('tab-a', ADDRESS, 'src/a.ts', proceed)
    const saving = state.saveClose()
    expect(state.closeRequest.getSnapshot()?.busy).toBe(true)
    state.discardClose()
    state.cancelClose()
    expect(state.closeRequest.getSnapshot()?.busy).toBe(true)
    complete?.()
    await saving
    expect(proceed).not.toHaveBeenCalled()
    expect(state.closeRequest.getSnapshot()).toEqual({ path: 'src/a.ts', busy: false, failed: false })
    expect(new DesktopFileState().read(ADDRESS)).toEqual({ text: dirty.draft, draft: 'new characters' })
  })

  it('closes only after the editor queue confirms the whole current draft', async () => {
    const state = new DesktopFileState()
    const proceed = vi.fn(() => true)
    state.write(ADDRESS, dirty)
    state.registerSave('tab-a', ADDRESS, async () => {
      state.write(ADDRESS, { text: dirty.draft, draft: dirty.draft })
      return true
    })
    state.requestClose('tab-a', ADDRESS, 'src/a.ts', proceed)
    await state.saveClose()
    expect(proceed).toHaveBeenCalledOnce()
    expect(state.closeRequest.getSnapshot()).toBeUndefined()
    expect(new DesktopFileState().read(ADDRESS)).toBeUndefined()
  })

  it('closes a draft already saved by the debounce without attempting Save again', async () => {
    const state = new DesktopFileState()
    const proceed = vi.fn(() => true)
    const save = vi.fn(async () => false)
    state.write(ADDRESS, dirty)
    state.registerSave('tab-a', ADDRESS, save)
    state.requestClose('tab-a', ADDRESS, 'src/a.ts', proceed)
    state.write(ADDRESS, { text: dirty.draft, draft: dirty.draft })
    await state.saveClose()
    expect(save).not.toHaveBeenCalled()
    expect(proceed).toHaveBeenCalledOnce()
  })

  it('keeps the draft if an old close confirmation no longer owns its tab', () => {
    const state = new DesktopFileState()
    const staleProceed = vi.fn(() => false)
    state.write(ADDRESS, dirty)
    state.requestClose('tab-a', ADDRESS, 'src/a.ts', staleProceed)
    state.discardClose()
    expect(staleProceed).toHaveBeenCalledOnce()
    expect(state.closeRequest.getSnapshot()).toBeUndefined()
    expect(new DesktopFileState().read(ADDRESS)).toEqual(dirty)
  })

  it('isolates save callbacks and confirmations when two Sessions share a local tab id', async () => {
    const state = new DesktopFileState()
    const otherSession = 'dsh-resource://file/session/other-session/src/a.ts'
    const first = vi.fn(() => true)
    const second = vi.fn(() => true)
    const saveFirst = vi.fn(async () => {
      state.write(ADDRESS, { text: dirty.draft, draft: dirty.draft })
      return true
    })
    const saveSecond = vi.fn(async () => false)
    state.write(ADDRESS, dirty)
    state.write(otherSession, { text: 'other disk', draft: 'other draft' })
    state.registerSave('tab-a', ADDRESS, saveFirst)
    state.registerSave('tab-a', otherSession, saveSecond)
    state.requestClose('tab-a', ADDRESS, 'first/a.ts', first)
    state.requestClose('tab-a', otherSession, 'second/a.ts', second)
    await state.saveClose()
    expect(saveFirst).toHaveBeenCalledOnce()
    expect(saveSecond).not.toHaveBeenCalled()
    expect(first).toHaveBeenCalledOnce()
    expect(second).not.toHaveBeenCalled()
    expect(state.closeRequest.getSnapshot()?.path).toBe('second/a.ts')
    expect(state.read(otherSession)?.draft).toBe('other draft')
  })
})
