// @vitest-environment jsdom
/** Apple's real control-key deletion bindings retain the chip's two-step selection. */
import { expect, it, onTestFinished, vi } from 'vitest'
import { fireEvent } from '@testing-library/react'
import type { Context } from '@deepseek-ai/cordis'
import { IS_APPLE } from 'lexical'
import { SessionInputShell } from '../src/client/input/facade.ts'
import { $replaceDetectSpanWithText, $selectDetectPoints } from '../src/client/input/editor/span-map.ts'

vi.hoisted(() => {
  Object.defineProperty(window.navigator, 'platform', { configurable: true, value: 'MacIntel' })
})

it.each([
  { key: 'h', caret: 1 }, { key: 'd', caret: 0 },
])('Ctrl+$key selects the adjacent chip first and deletes it on the second keydown', async ({ key, caret }) => {
  expect(IS_APPLE).toBe(true)
  const root = document.createElement('div')
  root.setAttribute('contenteditable', 'true')
  document.body.append(root)
  const shell = new SessionInputShell({
    actx: {} as Context,
    defaultSink: () => Promise.resolve({ kind: 'success' }),
    commandAttachments: { serialize: () => Promise.resolve([]), release: () => {}, unsupportedNotice: token => token },
  })
  shell.editor.setRootElement(root)
  onTestFinished(() => { shell.dispose(); root.remove() })
  shell.setDraft('/goal')
  shell.beginCommand({ name: 'goal', token: '/goal ', submit: vi.fn() }, {
    start: 0, end: 5, draftRev: shell.snapshot.draftRev,
  })
  shell.editor.update(() => {
    $replaceDetectSpanWithText({ start: 1, end: 2 }, '')
    $selectDetectPoints(caret, caret)
  }, { discrete: true })
  const chip = () => root.querySelector('[data-composer-command]')
  const press = async () => {
    fireEvent.keyDown(root, { key, ctrlKey: true })
    shell.editor.update(() => {}, { discrete: true })
    await Promise.resolve()
  }

  await press()
  expect(chip()?.hasAttribute('data-selected')).toBe(true)
  expect(shell.snapshot.phase).toBe('claimed')
  await press()
  expect(chip()).toBeNull()
  expect(shell.snapshot.phase).toBe('plain')
})
