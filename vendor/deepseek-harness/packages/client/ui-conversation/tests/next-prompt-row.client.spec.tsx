// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { allowAllAccess, bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { NextPromptRow } from '../src/client/settings/NextPromptRow.tsx'
import type { NextPromptRowProps } from '../src/client/settings/NextPromptRow.tsx'
import { ComposerSubmissionPolicy } from '../src/client/input/submission-policy.ts'
import { en, zh } from '../src/client/locales.ts'

afterEach(cleanup)

const unused = (): never => { throw new Error('unused by NextPromptRow') }
const useResource = (() => ({ status: 'none' as const, value: undefined, failure: undefined })) as NextPromptRowProps['useResource']

function mount(copy: typeof en | typeof zh = en, writable = true) {
  const policy = new ComposerSubmissionPolicy()
  const setNextPrompt = vi.fn((value: boolean) => { policy.setNextPrompt(value) })
  const props: NextPromptRowProps = {
    ...allowAllAccess,
    usePanelInfo: selector => selector({ activePanelId: null }),
    useResource,
    useSessions: unused,
    useSessionStatus: unused,
    useSessionRetainInfo: () => undefined,
    useWorkspaces: unused,
    useNextPrompt: bindSnapshotSelector(policy.nextPrompt),
    useWritable: bindSnapshotSelector(createSnapshotStore(writable)),
    setNextPrompt,
    t: makeTranslate(copy),
  }
  render(<NextPromptRow {...props} />)
  return { policy, setNextPrompt }
}

describe('NextPromptRow', () => {
  it.each([
    {
      copy: zh,
      name: '下一句提示',
      description: /Tab.*不会自动发送.*额外调用当前模型.*关闭后不再调用/,
    },
    {
      copy: en,
      name: 'Next-prompt suggestions',
      description: /Press Tab to accept without sending.*additional call to the current model.*turning this off stops those calls/,
    },
  ])('exposes the localized label and call cost, and disables suggestions on click ($name)', ({ copy, name, description }) => {
    const mounted = mount(copy)
    const toggle = screen.getByRole('switch', { name, description })
    expect(toggle).toHaveProperty('checked', true)
    fireEvent.click(toggle)
    expect(mounted.setNextPrompt).toHaveBeenCalledExactlyOnceWith(false)
    expect(mounted.policy.nextPrompt.getSnapshot()).toBe(false)
    expect(toggle).toHaveProperty('checked', false)
    mounted.policy.dispose()
  })

  it('prevents changes when the Host preference is not writable', () => {
    const mounted = mount(en, false)
    const toggle = screen.getByRole('switch', { name: 'Next-prompt suggestions' })
    expect(toggle).toHaveProperty('disabled', true)
    toggle.click()
    expect(mounted.setNextPrompt).not.toHaveBeenCalled()
    expect(mounted.policy.nextPrompt.getSnapshot()).toBe(true)
    mounted.policy.dispose()
  })
})
