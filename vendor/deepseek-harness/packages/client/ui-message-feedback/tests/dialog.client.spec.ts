/**
 * FeedbackDialogController: one draft per open, submission routed by target,
 * success closes the dialog, failure keeps the draft with its code, and a
 * settlement from a superseded open closes nothing.
 */
import { describe, expect, it, vi } from 'vitest'
import type { MessageId } from '@deepseek-ai/dsh-api-remotes/client'
import type { MessageFeedbackActionResult } from '../src/client/controller.ts'
import { FeedbackDialogController, type FeedbackSubmit } from '../src/client/dialog.ts'

const MSG = 'm-1' as MessageId
const MESSAGE_TARGET = { kind: 'message', messageId: MSG, rating: 'positive' } as const

function bench(result: () => Promise<MessageFeedbackActionResult> = () => Promise.resolve({ ok: true })) {
  const submit = vi.fn<FeedbackSubmit>(() => result())
  return { submit, controller: new FeedbackDialogController(submit) }
}

describe('FeedbackDialogController', () => {
  it('starts closed', () => {
    const { controller } = bench()

    expect(controller.state.getSnapshot()).toEqual({
      target: null, category: null, text: '', submitting: false, failure: null,
    })
  })

  it('opens with an empty draft and drops the draft on dismiss', () => {
    const { controller } = bench()

    controller.open({ kind: 'session' })
    controller.edit({ category: 'task-result' })
    controller.edit({ text: 'slow' })
    expect(controller.state.getSnapshot()).toMatchObject({
      target: { kind: 'session' }, category: 'task-result', text: 'slow',
    })

    controller.dismiss()
    controller.open(MESSAGE_TARGET)
    expect(controller.state.getSnapshot()).toMatchObject({
      target: MESSAGE_TARGET, category: null, text: '',
    })
  })

  it('ignores draft edits and submits while closed', async () => {
    const { controller, submit } = bench()

    controller.edit({ category: 'other' })
    controller.edit({ text: 'x' })
    await controller.submitDraft()

    expect(controller.state.getSnapshot()).toMatchObject({ category: null, text: '' })
    expect(submit).not.toHaveBeenCalled()
  })

  it('submits the Session target with the trimmed text and the category', async () => {
    const { controller, submit } = bench()
    controller.open({ kind: 'session' })
    controller.edit({ category: 'service-stability' })
    controller.edit({ text: '  timed out twice  ' })

    await controller.submitDraft()

    expect(submit).toHaveBeenCalledWith({ kind: 'session' }, { text: 'timed out twice', category: 'service-stability' })
    expect(controller.state.getSnapshot()).toMatchObject({ target: null })
  })

  it('submits an empty draft as an entry with neither text nor category', async () => {
    const { controller, submit } = bench()
    controller.open({ kind: 'session' })
    controller.edit({ text: '   ' })

    await controller.submitDraft()

    expect(submit).toHaveBeenCalledWith({ kind: 'session' }, {})
  })

  it('submits the message target with the entry', async () => {
    const { controller, submit } = bench()
    controller.open(MESSAGE_TARGET)
    controller.edit({ category: 'task-result' })
    controller.edit({ text: 'wrong file' })

    await controller.submitDraft()

    expect(submit).toHaveBeenCalledWith(MESSAGE_TARGET, { text: 'wrong file', category: 'task-result' })
    expect(controller.state.getSnapshot()).toMatchObject({ target: null })
  })

  it('keeps the draft open with the failure code when the submission is rejected', async () => {
    const { controller } = bench(() => Promise.resolve({ ok: false, error: { code: 'version-conflict', message: 'changed' } }))
    controller.open(MESSAGE_TARGET)
    controller.edit({ text: 'draft' })

    await controller.submitDraft()

    expect(controller.state.getSnapshot()).toMatchObject({
      target: MESSAGE_TARGET, text: 'draft', submitting: false,
      failure: 'version-conflict',
    })
  })

  it('retires the failure toast without closing its draft', async () => {
    const { controller } = bench(() => Promise.resolve({ ok: false, error: { code: 'version-conflict', message: 'changed' } }))
    controller.open(MESSAGE_TARGET)
    await controller.submitDraft()

    controller.dismissFailure()
    expect(controller.state.getSnapshot().failure).toBeNull()
    expect(controller.state.getSnapshot().target).toEqual(MESSAGE_TARGET)
  })

  it('freezes the draft and refuses a second submit while one is in flight', async () => {
    let release = (): void => {}
    const gate = new Promise<MessageFeedbackActionResult>((resolve) => { release = () => { resolve({ ok: true }) } })
    const { controller, submit } = bench(() => gate)
    controller.open({ kind: 'session' })
    controller.edit({ text: 'first' })

    const first = controller.submitDraft()
    controller.edit({ text: 'second' })
    controller.edit({ category: 'other' })
    await controller.submitDraft()
    expect(controller.state.getSnapshot()).toMatchObject({ submitting: true, text: 'first', category: null })

    release()
    await first
    expect(submit).toHaveBeenCalledTimes(1)
    expect(controller.state.getSnapshot()).toMatchObject({ target: null })
  })

  it('keeps the new draft open when a success lands after a reopen', async () => {
    let release = (): void => {}
    const gate = new Promise<MessageFeedbackActionResult>((resolve) => { release = () => { resolve({ ok: true }) } })
    const { controller } = bench(() => gate)
    controller.open({ kind: 'session' })
    const pending = controller.submitDraft()
    controller.open(MESSAGE_TARGET)
    controller.edit({ text: 'new draft' })

    release()
    await pending

    expect(controller.state.getSnapshot()).toMatchObject({
      target: MESSAGE_TARGET, text: 'new draft',
    })
  })

  it('drops a failure that lands after the draft was dismissed', async () => {
    let release = (): void => {}
    const gate = new Promise<MessageFeedbackActionResult>((resolve) => {
      release = () => { resolve({ ok: false, error: { code: 'gateway/internal', message: 'boom' } }) }
    })
    const { controller } = bench(() => gate)
    controller.open({ kind: 'session' })
    const pending = controller.submitDraft()
    controller.dismiss()

    release()
    await pending

    expect(controller.state.getSnapshot()).toMatchObject({ target: null, failure: null, submitting: false })
  })

  it('drops everything on dispose', () => {
    const { controller } = bench()
    controller.open({ kind: 'session' })
    controller.edit({ text: 'draft' })
    controller.dispose()
    expect(controller.state.getSnapshot()).toEqual({
      target: null, category: null, text: '', submitting: false, failure: null,
    })
  })
})
