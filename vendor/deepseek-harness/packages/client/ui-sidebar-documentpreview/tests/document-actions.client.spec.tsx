// @vitest-environment jsdom
/** The document header's generic action seat through the production slot renderer. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from '@testing-library/react'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import type { PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { TextPreview } from '../src/client/TextPreview.tsx'
import { documentActionsTabInfoFactory } from '../src/client/document/actions.ts'
import { documentTabInfoFactory } from '../src/client/document/contract.ts'
import { ADDRESS, harness, page, settle } from './fixtures.client.ts'

const HOST = 'test.document-actions.host'
const SESSION = 'document-actions' as SessionId
const runtimes: SlotTestRuntime[] = []

afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.dispose()
})

type HostProps = {
  renderSlot: PropsRenderSlots<
    'sidebar.right.tab.document' | 'sidebar.right.tab.document.unpreviewable' | 'sidebar.right.tab.document.action' | 'sidebar.right.tab.document.actions'
  >['renderSlot']
}

async function boot() {
  const runtime = await SlotTestRuntime.create()
  runtimes.push(runtime)
  const file = harness({ 1: page(1, ['line'], true) })
  const info = file.props().useTabInfo()
  const useTabInfo = vi.fn(() => info)
  const props = { ...file.props(), useTabInfo }
  const Host = ({ renderSlot }: HostProps) => (
    <TextPreview {...props} renderSlot={renderSlot} />
  )

  await runtime.sessions.add({ id: SESSION })
  const session = runtime.sessions.retainFor(runtime.ctx, SESSION)
  await session.ready
  await runtime.declare({
    [HOST]: { kind: 'single', scope: 'session' },
  } as never)
  await act(async () => {
    runtime.slots.register({
      name: HOST,
      children: {
        'sidebar.right.tab.document': {
          kind: 'keyed',
          scope: 'session',
          inject: { hooks: { tabInfo: documentTabInfoFactory } },
        },
        'sidebar.right.tab.document.action': {
          kind: 'keyed',
          scope: 'session',
          inject: { hooks: { tabInfo: documentTabInfoFactory } },
        },
        'sidebar.right.tab.document.unpreviewable': { kind: 'list', scope: 'session' },
        'sidebar.right.tab.document.actions': {
          kind: 'list',
          scope: 'session',
          inject: { hooks: { tabInfo: documentActionsTabInfoFactory } },
        },
      },
    } as never, Host)
  })

  const render = async () => {
    const view = runtime.renderSlot(HOST as never, {}, { session })
    await settle()
    return view
  }
  return { runtime, info, useTabInfo, render }
}

describe('the document action seat', () => {
  it('renders a contributor at the end of the real header with its resource and tab reader', async () => {
    const h = await boot()
    let seenAddress: string | undefined
    let seenInfo: unknown
    await act(async () => {
      h.runtime.slots.register({
        name: 'sidebar.right.tab.document.actions',
        id: 'test.action',
      }, ({ resourceAddress, useTabInfo }: PropsRuntime<'sidebar.right.tab.document.actions'>) => {
        seenAddress = resourceAddress
        seenInfo = useTabInfo()
        return <button type="button" data-document-action>Action</button>
      })
    })

    const view = await h.render()
    const action = view.container.querySelector('[data-document-action]')
    const header = view.container.querySelector('[data-textpreview-path]')?.parentElement
    const outlet = header?.querySelector<HTMLElement>('[data-slot="sidebar.right.tab.document.actions"]')
    expect(action).not.toBeNull()
    expect(outlet?.style.display).toBe('contents')
    expect(header?.lastElementChild?.hasAttribute('data-navigator-factory')).toBe(true)
    expect(outlet?.nextElementSibling).toBe(header?.lastElementChild)
    expect(outlet?.lastElementChild).toBe(action)
    expect(header?.nextElementSibling?.querySelector('[data-textpreview-body]')).not.toBeNull()
    expect(seenAddress).toBe(ADDRESS)
    expect(seenInfo).toBe(h.info)
    expect(h.useTabInfo).toHaveBeenCalled()
  })

  it('removes the contributor when its registration is disposed', async () => {
    const h = await boot()
    let dispose: (() => void) | undefined
    await act(async () => {
      dispose = h.runtime.slots.register({
        name: 'sidebar.right.tab.document.actions',
        id: 'test.action',
      }, () => <button type="button" data-document-action>Action</button>)
    })
    const view = await h.render()
    expect(view.container.querySelector('[data-document-action]')).not.toBeNull()

    await act(async () => {
      dispose?.()
      await h.runtime.flush()
    })
    expect(view.container.querySelector('[data-document-action]')).toBeNull()
    const header = view.container.querySelector('[data-textpreview-path]')?.parentElement
    const outlet = header?.querySelector<HTMLElement>('[data-slot="sidebar.right.tab.document.actions"]')
    expect(outlet?.style.display).toBe('contents')
    expect(outlet?.childElementCount).toBe(0)
    expect(header?.querySelector('[data-textpreview-tool="reload"]')).not.toBeNull()
  })

  it('adds no layout-affecting wrapper when no contributor is registered', async () => {
    const h = await boot()
    const view = await h.render()
    const header = view.container.querySelector('[data-textpreview-path]')?.parentElement
    const outlet = header?.querySelector<HTMLElement>('[data-slot="sidebar.right.tab.document.actions"]')
    expect(outlet?.style.display).toBe('contents')
    expect(outlet?.childElementCount).toBe(0)
    expect(header?.lastElementChild?.hasAttribute('data-navigator-factory')).toBe(true)
    expect(outlet?.nextElementSibling).toBe(header?.lastElementChild)
    expect(header?.querySelector('[data-textpreview-tool="reload"]')).not.toBeNull()
    expect(view.container.querySelector('[data-document-action]')).toBeNull()
  })
})
