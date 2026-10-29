import { afterEach, describe, expect, it, vi } from 'vitest'
import { FileSaveCoordinator } from '../src/client/fileSaveCoordinator.ts'

function deferred() {
  let resolve!: (result: { ok: boolean }) => void
  const promise = new Promise<{ ok: boolean }>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

describe('FileSaveCoordinator', () => {
  afterEach(() => { vi.useRealTimers() })

  it('debounces edits and persists only the latest contents', async () => {
    vi.useFakeTimers()
    const persist = vi.fn<(contents: string) => Promise<{ ok: boolean }>>()
      .mockResolvedValue({ ok: true })
    const onPendingChange = vi.fn()
    const onConfirmed = vi.fn()
    const coordinator = new FileSaveCoordinator({
      debounceMs: 500, persist, onPendingChange, onConfirmed,
    })
    coordinator.change('first')
    await vi.advanceTimersByTimeAsync(300)
    coordinator.change('latest')
    await vi.advanceTimersByTimeAsync(499)
    expect(persist).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(persist).toHaveBeenCalledOnce()
    expect(persist).toHaveBeenCalledWith('latest')
    expect(onConfirmed).toHaveBeenCalledWith('latest')
    expect(onPendingChange.mock.calls).toEqual([[true], [true], [false]])
  })

  it('holds automatic writes while paused but permits Save and resumes the latest edit', async () => {
    vi.useFakeTimers()
    const persist = vi.fn(async (_contents: string) => ({ ok: true }))
    const coordinator = new FileSaveCoordinator({
      debounceMs: 500, persist, onPendingChange: vi.fn(), onConfirmed: vi.fn(),
    })
    coordinator.change('before close')
    expect(coordinator.pause()).toBeNull()
    coordinator.change('latest')
    await vi.advanceTimersByTimeAsync(2000)
    expect(persist).not.toHaveBeenCalled()
    await expect(coordinator.flush('latest')).resolves.toBe(true)
    expect(persist).toHaveBeenCalledExactlyOnceWith('latest')
    coordinator.change('after Save')
    await vi.advanceTimersByTimeAsync(2000)
    expect(persist).toHaveBeenCalledOnce()
    coordinator.resume()
    await vi.advanceTimersByTimeAsync(500)
    expect(persist).toHaveBeenLastCalledWith('after Save')
    coordinator.dispose()
  })

  it('suppresses a queued automatic write before it starts, including disposal while paused', async () => {
    vi.useFakeTimers()
    const persist = vi.fn(async (_contents: string) => ({ ok: true }))
    const coordinator = new FileSaveCoordinator({
      debounceMs: 500, persist, onPendingChange: vi.fn(), onConfirmed: vi.fn(),
    })
    coordinator.change('discarded')
    vi.advanceTimersByTime(500)
    const settled = coordinator.pause()
    expect(settled).not.toBeNull()
    await settled
    coordinator.dispose()
    await vi.runAllTimersAsync()
    expect(persist).not.toHaveBeenCalled()
  })

  it('waits for an issued write without starting a newer draft until resumed', async () => {
    vi.useFakeTimers()
    const issued = deferred()
    const persist = vi.fn<(contents: string) => Promise<{ ok: boolean }>>()
      .mockReturnValueOnce(issued.promise).mockResolvedValue({ ok: true })
    const onConfirmed = vi.fn()
    const coordinator = new FileSaveCoordinator({
      debounceMs: 500, persist, onPendingChange: vi.fn(), onConfirmed,
    })
    coordinator.change('issued')
    await vi.advanceTimersByTimeAsync(500)
    const settled = coordinator.pause()
    coordinator.change('newer')
    await vi.advanceTimersByTimeAsync(2000)
    expect(persist).toHaveBeenCalledExactlyOnceWith('issued')
    issued.resolve({ ok: true })
    await settled
    expect(onConfirmed).toHaveBeenCalledExactlyOnceWith('issued')
    coordinator.resume()
    await vi.advanceTimersByTimeAsync(500)
    expect(persist).toHaveBeenLastCalledWith('newer')
    coordinator.dispose()
  })

  it('keeps pending state until an edit made during a write is also saved', async () => {
    vi.useFakeTimers()
    const firstWrite = deferred()
    const persist = vi.fn<(contents: string) => Promise<{ ok: boolean }>>()
      .mockReturnValueOnce(firstWrite.promise)
      .mockResolvedValueOnce({ ok: true })
    const onPendingChange = vi.fn()
    const coordinator = new FileSaveCoordinator({
      debounceMs: 500, persist, onPendingChange, onConfirmed: vi.fn(),
    })
    coordinator.change('first')
    await vi.advanceTimersByTimeAsync(500)
    coordinator.change('latest')
    await vi.advanceTimersByTimeAsync(500)
    expect(persist).toHaveBeenCalledTimes(1)
    firstWrite.resolve({ ok: true })
    await vi.runAllTimersAsync()
    expect(persist).toHaveBeenCalledTimes(2)
    expect(persist).toHaveBeenLastCalledWith('latest')
    expect(onPendingChange.mock.calls.at(-1)).toEqual([false])
  })

  it('serializes an explicit flush behind an in-flight debounce write', async () => {
    vi.useFakeTimers()
    const firstWrite = deferred()
    const persist = vi.fn<(contents: string) => Promise<{ ok: boolean }>>()
      .mockReturnValueOnce(firstWrite.promise)
      .mockResolvedValueOnce({ ok: true })
    const onConfirmed = vi.fn()
    const coordinator = new FileSaveCoordinator({
      debounceMs: 500, persist, onPendingChange: vi.fn(), onConfirmed,
    })
    coordinator.change('first')
    await vi.advanceTimersByTimeAsync(500)
    expect(persist).toHaveBeenCalledTimes(1)
    const flush = coordinator.flush('explicit')
    // The flush must wait for the in-flight debounce write, not run alongside it.
    expect(persist).toHaveBeenCalledTimes(1)
    firstWrite.resolve({ ok: true })
    await expect(flush).resolves.toBe(true)
    expect(persist).toHaveBeenCalledTimes(2)
    expect(persist).toHaveBeenLastCalledWith('explicit')
    expect(onConfirmed).toHaveBeenLastCalledWith('explicit')
  })

  it('folds a pending debounce write into an explicit flush', async () => {
    vi.useFakeTimers()
    const persist = vi.fn<(contents: string) => Promise<{ ok: boolean }>>()
      .mockResolvedValue({ ok: true })
    const onPendingChange = vi.fn()
    const coordinator = new FileSaveCoordinator({
      debounceMs: 500, persist, onPendingChange, onConfirmed: vi.fn(),
    })
    coordinator.change('draft')
    await expect(coordinator.flush('draft')).resolves.toBe(true)
    await vi.runAllTimersAsync()
    expect(persist).toHaveBeenCalledTimes(1)
    expect(persist).toHaveBeenCalledWith('draft')
    expect(onPendingChange.mock.calls.at(-1)).toEqual([false])
  })

  it('resolves a flush false when the write fails or rejects', async () => {
    const failing = new FileSaveCoordinator({
      debounceMs: 500,
      persist: vi.fn().mockResolvedValue({ ok: false }),
      onPendingChange: vi.fn(),
      onConfirmed: vi.fn(),
    })
    await expect(failing.flush('x')).resolves.toBe(false)
    const rejecting = new FileSaveCoordinator({
      debounceMs: 500,
      persist: vi.fn().mockRejectedValue(new Error('boom')),
      onPendingChange: vi.fn(),
      onConfirmed: vi.fn(),
    })
    await expect(rejecting.flush('x')).resolves.toBe(false)
  })

  it('flushes unconfirmed contents on dispose but not confirmed ones', async () => {
    vi.useFakeTimers()
    const persist = vi.fn<(contents: string) => Promise<{ ok: boolean }>>()
      .mockResolvedValue({ ok: true })
    const coordinator = new FileSaveCoordinator({
      debounceMs: 500, persist, onPendingChange: vi.fn(), onConfirmed: vi.fn(),
    })
    await coordinator.flush('saved')
    coordinator.dispose()
    await vi.runAllTimersAsync()
    expect(persist).toHaveBeenCalledTimes(1)
    const second = new FileSaveCoordinator({
      debounceMs: 500, persist, onPendingChange: vi.fn(), onConfirmed: vi.fn(),
    })
    second.change('unsaved')
    second.dispose()
    await vi.runAllTimersAsync()
    expect(persist).toHaveBeenCalledTimes(2)
    expect(persist).toHaveBeenLastCalledWith('unsaved')
  })

  it('leaves the file pending when the latest write fails', async () => {
    vi.useFakeTimers()
    const onPendingChange = vi.fn()
    const coordinator = new FileSaveCoordinator({
      debounceMs: 500,
      persist: vi.fn().mockResolvedValue({ ok: false }),
      onPendingChange,
      onConfirmed: vi.fn(),
    })
    coordinator.change('latest')
    await vi.advanceTimersByTimeAsync(500)
    await Promise.resolve()
    expect(onPendingChange).toHaveBeenCalledWith(true)
    expect(onPendingChange).not.toHaveBeenCalledWith(false)
  })
})
