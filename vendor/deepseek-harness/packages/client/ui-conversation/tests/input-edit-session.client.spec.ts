/**
 * Composer edit-session coverage on the SessionInputShell: beginEdit stashes
 * the draft and attachments and seeds the message text; submission routes to the
 * edit sink (occurrence serialization included) instead of the default sink;
 * a success ends the edit and restores the stash while a failure keeps the
 * edit armed; cancel restores the stash; slash adjudication and command
 * claims stay off while the edit is live; the persistence mirror never
 * observes the edit text.
 */
import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { InputTriggerController, SubmitOutcome } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { SessionInputShell } from '../src/client/input/facade.ts'
import type { DraftAttachmentId, InputEditSpec } from '../src/client/contract/input.ts'

const commandAttachments = {
  serialize: () => Promise.resolve([]),
  release: () => {},
  unsupportedNotice: (token: string) => `${token.trim()} images-unsupported`,
}

const id = (k: string): DraftAttachmentId => k as DraftAttachmentId

type EditSink = InputEditSpec['submit']

function bench(options: { editSink?: EditSink; inputTriggers?: () => InputTriggerController } = {}) {
  const defaultSink = vi.fn<(
    text: string,
    attachmentIds: readonly DraftAttachmentId[],
    mode: 'queue' | 'steer',
    signal: AbortSignal,
  ) => Promise<SubmitOutcome>>(() => Promise.resolve({ kind: 'success' }))
  const shell = new SessionInputShell({
    actx: {} as Context,
    defaultSink,
    commandAttachments,
    ...(options.inputTriggers !== undefined ? { inputTriggers: options.inputTriggers } : {}),
  })
  const editSink = vi.fn<EditSink>(options.editSink ?? (() => Promise.resolve({ kind: 'success' })))
  const spec: InputEditSpec = {
    key: 'message-edit:7',
    label: '正在重新编辑此消息',
    seed: 'original prompt',
    submit: editSink,
  }
  return { shell, defaultSink, editSink, spec }
}

function hungTriggers(overrides: Partial<InputTriggerController> = {}): () => InputTriggerController {
  const lexicon = {
    getSnapshot: () => new Map(),
    subscribe: () => () => {},
  }
  return () => ({
    lexicon,
    track: vi.fn(),
    adjudicate: vi.fn(),
    serializeReference: vi.fn(),
    ...overrides,
  } as unknown as InputTriggerController)
}

describe('composer edit session', () => {
  it('restores structured references when cancelling an edit', () => {
    const { shell, spec } = bench()
    const draft = { text: 'carry @one.ts', references: [{ source: 'reference', ref: '@one.ts', label: 'one.ts', appearance: 'file' as const, clipboardText: '@one.ts', offset: 6, length: 7 }] }
    shell.setDraft(draft)
    shell.beginEdit(spec)
    shell.cancelEdit()
    expect(shell.draftSnapshot).toEqual(draft)
  })
  it('publishes edit entry and cancellation even when the seed and stash equal the current draft', () => {
    const { shell, spec } = bench()
    shell.setDraft(spec.seed)
    const changed = vi.fn()
    shell.state.subscribe(changed)
    expect(shell.beginEdit(spec)).toBe(true)
    expect(shell.snapshot.edit?.key).toBe(spec.key)
    expect(changed).toHaveBeenCalled()
    changed.mockClear()
    shell.cancelEdit()
    expect(shell.snapshot.edit).toBeUndefined()
    expect(changed).toHaveBeenCalled()
  })
  it('stashes draft and images, seeds the message text, and publishes the edit state', () => {
    const { shell, spec } = bench()
    shell.setDraft('half-typed next prompt')
    shell.addAttachments([id('img-1')])

    expect(shell.beginEdit(spec)).toBe(true)
    expect(shell.snapshot.draft).toBe('original prompt')
    expect(shell.snapshot.attachmentIds).toEqual([])
    expect(shell.snapshot.edit).toEqual({ key: 'message-edit:7', label: '正在重新编辑此消息' })
  })

  it('refuses a second edit and refuses while slash adjudication is in flight', () => {
    const { shell, spec } = bench()
    expect(shell.beginEdit(spec)).toBe(true)
    expect(shell.beginEdit({ ...spec, key: 'message-edit:9' })).toBe(false)
    shell.cancelEdit()

    let release!: (outcome: unknown) => void
    const gate = new Promise((resolve) => { release = resolve })
    const busy = new SessionInputShell({
      actx: {} as Context,
      defaultSink: () => Promise.resolve({ kind: 'success' }),
      commandAttachments,
      inputTriggers: hungTriggers({ adjudicate: () => gate as Promise<never> }),
    })
    busy.setDraft('/maybe-command')
    busy.submit()
    expect(busy.snapshot.phase).toBe('adjudicating')
    expect(busy.beginEdit(spec)).toBe(false)
    release(undefined)
  })

  it('refuses after disposal', () => {
    const { shell, spec } = bench()
    shell.dispose()
    expect(shell.beginEdit(spec)).toBe(false)
  })

  it('cancel restores the stashed draft and images; a bare cancel is a no-op', () => {
    const { shell, spec } = bench()
    shell.cancelEdit()
    shell.setDraft('half-typed next prompt')
    shell.addAttachments([id('img-1')])
    shell.beginEdit(spec)
    shell.setDraft('revised beyond saving')

    shell.cancelEdit()
    expect(shell.snapshot.edit).toBeUndefined()
    expect(shell.snapshot.draft).toBe('half-typed next prompt')
    expect(shell.snapshot.attachmentIds).toEqual([id('img-1')])
  })

  it('routes submit to the edit sink, ends the edit on success, and restores the stash', async () => {
    const { shell, defaultSink, editSink, spec } = bench()
    shell.setDraft('half-typed next prompt')
    shell.beginEdit(spec)
    shell.setDraft('revised prompt')
    shell.addAttachments([id('edit-img')])

    shell.submit('queue')
    await vi.waitFor(() => { expect(shell.snapshot.edit).toBeUndefined() })
    expect(editSink).toHaveBeenCalledWith('revised prompt', [id('edit-img')], expect.any(AbortSignal))
    expect(defaultSink).not.toHaveBeenCalled()
    // The machine committed (edit draft gone), then the stash returned.
    expect(shell.snapshot.draft).toBe('half-typed next prompt')
    expect(shell.snapshot.attachmentIds).toEqual([])
  })

  it('keeps the edit armed with the draft when the edit sink reports an error', async () => {
    const { shell, editSink, spec } = bench({
      editSink: () => Promise.resolve({ kind: 'error', text: '会话已有更新的消息' }),
    })
    shell.beginEdit(spec)
    shell.setDraft('revised prompt')

    shell.submit('queue')
    await vi.waitFor(() => { expect(shell.snapshot.phase).toBe('plain') })
    expect(editSink).toHaveBeenCalledTimes(1)
    expect(shell.snapshot.edit).toEqual({ key: 'message-edit:7', label: '正在重新编辑此消息' })
    expect(shell.snapshot.draft).toBe('revised prompt')
    expect(shell.notices.getSnapshot()).toMatchObject({ level: 'error', text: '会话已有更新的消息' })
  })

  it('refuses cancel while the edit submit is in flight; the settlement decides', async () => {
    let release!: (outcome: SubmitOutcome) => void
    const gate = new Promise<SubmitOutcome>((resolve) => { release = resolve })
    const { shell, spec } = bench({ editSink: () => gate })
    shell.setDraft('stash')
    shell.beginEdit(spec)
    shell.setDraft('revised prompt')
    shell.submit('queue')
    expect(shell.snapshot.edit).toBeDefined()

    shell.cancelEdit()
    expect(shell.snapshot.edit).toBeDefined()
    release({ kind: 'success' })
    await vi.waitFor(() => { expect(shell.snapshot.edit).toBeUndefined() })
    expect(shell.snapshot.draft).toBe('stash')
  })

  it('skips slash adjudication while editing: a "/" revision reaches the edit sink verbatim', async () => {
    const adjudicate = vi.fn()
    const { shell, editSink, spec } = bench({ inputTriggers: hungTriggers({ adjudicate }) })
    shell.beginEdit(spec)
    shell.setDraft('/looks-like-a-command but is a revision')

    shell.submit('queue')
    await vi.waitFor(() => { expect(shell.snapshot.edit).toBeUndefined() })
    expect(adjudicate).not.toHaveBeenCalled()
    expect(editSink).toHaveBeenCalledWith('/looks-like-a-command but is a revision', [], expect.any(AbortSignal))
  })

  it('refuses command claims while editing', () => {
    const { shell, spec } = bench()
    shell.beginEdit(spec)
    shell.setDraft('/compact')
    const accepted = shell.beginCommand(
      { name: 'compact', token: '/compact ', submit: vi.fn() },
      { start: 0, end: 8, draftRev: shell.snapshot.draftRev },
    )
    expect(accepted).toBe(false)
    expect(shell.snapshot.phase).toBe('plain')
  })

  it('serializes reference occurrences before the edit sink, like a real send', async () => {
    const serializeReference = vi.fn(() => Promise.resolve('@[Research](dsh-session:x)'))
    const { shell, editSink, spec } = bench({
      inputTriggers: hungTriggers({ serializeReference }),
    })
    shell.beginEdit(spec)
    shell.setDraft('@res')
    expect(shell.insertReference({
      source: 'reference', ref: 'r1', label: 'Research', clipboardText: '@Research',
    }, { start: 0, end: 4, draftRev: shell.snapshot.draftRev })).toBe(true)

    shell.submit('queue')
    await vi.waitFor(() => { expect(shell.snapshot.edit).toBeUndefined() })
    expect(editSink).toHaveBeenCalledWith('@[Research](dsh-session:x)', [], expect.any(AbortSignal))
  })

  it('routes an image-only edit submit to the edit sink and ends the edit on success', async () => {
    const { shell, defaultSink, editSink, spec } = bench()
    shell.setDraft('stash')
    shell.beginEdit(spec)
    shell.setDraft('')
    shell.addAttachments([id('edit-img')])

    shell.submit('queue')
    await vi.waitFor(() => { expect(shell.snapshot.edit).toBeUndefined() })
    expect(editSink).toHaveBeenCalledWith('', [id('edit-img')], expect.any(AbortSignal))
    expect(defaultSink).not.toHaveBeenCalled()
    expect(shell.snapshot.draft).toBe('stash')
  })

  it('keeps the edit when an image-only edit submit fails', async () => {
    const { shell, spec } = bench({ editSink: () => Promise.resolve({ kind: 'error', text: 'no fork' }) })
    shell.beginEdit(spec)
    shell.setDraft('')
    shell.addAttachments([id('edit-img')])

    shell.submit('queue')
    await vi.waitFor(() => {
      expect(shell.notices.getSnapshot()).toMatchObject({ level: 'error', text: 'no fork' })
    })
    expect(shell.snapshot.edit).toBeDefined()
    expect(shell.snapshot.attachmentIds).toEqual([id('edit-img')])
  })

  it('holds the persistence mirror through the edit and never mirrors edit text', () => {
    const mirror = vi.fn()
    const { shell, spec } = bench()
    shell.bindDraftPersistence(mirror)
    shell.setDraft('persisted draft')
    expect(mirror).toHaveBeenLastCalledWith({ text: 'persisted draft', references: [] })
    mirror.mockClear()

    shell.beginEdit(spec)
    shell.setDraft('revised prompt')
    expect(mirror).not.toHaveBeenCalled()

    // Restore equals the pre-edit mirror value: no redundant write either.
    shell.cancelEdit()
    expect(mirror).not.toHaveBeenCalled()
    expect(shell.snapshot.draft).toBe('persisted draft')
  })

  it('drops the edit on disposal without restoring into a dead scope', () => {
    const { shell, spec } = bench()
    shell.setDraft('stash')
    shell.beginEdit(spec)
    shell.dispose()
    expect(shell.snapshot.edit).toBeUndefined()
  })
})
