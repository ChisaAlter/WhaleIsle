// @vitest-environment jsdom
/**
 * Todo display acceptance: the TodoPanel plan strip (empty-hidden, status rows
 * including several `in_progress` at once, collapse), and its TodoDock
 * adapter (selects the plan off the session snapshot and follows changes).
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { TodoItem } from '@deepseek-ai/dsh-tool-todo/client'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { TodoDockProps } from '../src/client/skeleton/TodoPanel.tsx'
import { TodoDock, TodoPanel, todoDockEntry } from '../src/client/skeleton/TodoPanel.tsx'
import { NS, zh } from '../src/client/locales.ts'

const t: TodoDockProps['t'] = makeTranslate(zh, commonZh)

afterEach(cleanup)

const LIST: TodoItem[] = [
  { content: '搭骨架', status: 'completed' },
  { content: '写组件', status: 'in_progress' },
  { content: '补测试', status: 'pending' },
]

/** A parallel plan: three tasks running at once (concurrent subagents). */
const PARALLEL: TodoItem[] = [
  { content: '搭骨架', status: 'completed' },
  { content: '写组件', status: 'in_progress' },
  { content: '跑后台构建', status: 'in_progress' },
  { content: '读源码', status: 'in_progress' },
  { content: '补测试', status: 'pending' },
]

describe('TodoPanel', () => {
  it('renders nothing while the list is empty', () => {
    const { container } = render(<TodoPanel todos={[]} t={t} />)
    expect(container.innerHTML).toBe('')
  })

  it('starts collapsed with the per-status count summary visible', () => {
    render(<TodoPanel todos={LIST} t={t} />)
    expect(screen.getByTestId('todo-panel')).toBeTruthy()
    expect(screen.getByText('任务')).toBeTruthy()
    expect(screen.getByText('1 已完成 · 1 进行中 · 1 待处理')).toBeTruthy()
    expect(screen.getByRole('button', { expanded: false })).toBeTruthy()
    expect(screen.queryByRole('list')).toBeNull()
  })

  it('omits the completed segment while nothing is done yet', () => {
    render(<TodoPanel todos={[
      { content: '写组件', status: 'in_progress' },
      { content: '补测试', status: 'pending' },
    ]} t={t} />)
    expect(screen.getByText('1 进行中 · 1 待处理')).toBeTruthy()
    expect(screen.queryByText(/已完成/)).toBeNull()
  })

  it('expands to show one row per item with its status glyph', () => {
    render(<TodoPanel todos={LIST} t={t} />)
    fireEvent.click(screen.getByRole('button', { expanded: false }))
    const items = screen.getAllByRole('listitem')
    expect(items.map(li => li.getAttribute('data-status'))).toEqual(['completed', 'in_progress', 'pending'])
    expect(screen.getByText('搭骨架')).toBeTruthy()
    expect(screen.getByText('写组件')).toBeTruthy()
    expect(items.map(li => li.querySelector('[data-state]')?.getAttribute('data-state')))
      .toEqual(['done', 'ongoing', 'idle'])
    expect(screen.getAllByRole('img').map(node => node.getAttribute('aria-label')))
      .toEqual(['已完成', '进行中', '待处理'])
  })

  it('collapse hides an expanded list; expand restores; header keeps the count summary', () => {
    render(<TodoPanel todos={LIST} t={t} />)
    fireEvent.click(screen.getByRole('button', { expanded: false }))
    const header = screen.getByRole('button', { expanded: true })
    fireEvent.click(header)
    expect(screen.queryByRole('list')).toBeNull()
    // Collapsed header is title + progress only (no in-progress content hint).
    expect(screen.getByText('1 已完成 · 1 进行中 · 1 待处理')).toBeTruthy()
    expect(screen.getByText('写组件').closest('[aria-hidden="true"]')?.hasAttribute('inert')).toBe(true)
    fireEvent.click(screen.getByRole('button', { expanded: false }))
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
  })

  it('reopens during exit with the current plan and retains the expanded disclosure', async () => {
    const { rerender } = render(<TodoPanel todos={LIST} t={t} />)
    fireEvent.click(screen.getByRole('button', { expanded: false }))
    rerender(<TodoPanel todos={[]} t={t} />)
    expect(screen.queryByRole('list')).toBeNull()
    expect(screen.getByText('写组件')).toBeTruthy()
    rerender(<TodoPanel todos={PARALLEL} t={t} />)
    await waitFor(() => { expect(screen.getByTestId('todo-panel').getAttribute('data-state')).toBe('open') })
    expect(screen.getByRole('button', { expanded: true })).toBeTruthy()
    expect(screen.getAllByRole('listitem')).toHaveLength(PARALLEL.length)
  })

  it('skips retained strip and disclosure exits when reduced motion is requested', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    try {
      const { container, rerender } = render(<TodoPanel todos={LIST} t={t} />)
      fireEvent.click(screen.getByRole('button', { expanded: false }))
      fireEvent.click(screen.getByRole('button', { expanded: true }))
      expect(screen.queryByText('写组件')).toBeNull()
      rerender(<TodoPanel todos={[]} t={t} />)
      expect(container.firstChild).toBeNull()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('marks every parallel active item, and counts them all in the header', () => {
    render(<TodoPanel todos={PARALLEL} t={t} />)
    fireEvent.click(screen.getByRole('button', { expanded: false }))
    // An unconditional in-progress cap would make this list unreachable: three
    // items carry the in-progress glyph at once, and the header counts all three.
    const statuses = screen.getAllByRole('listitem').map(li => li.getAttribute('data-status'))
    expect(statuses.filter(s => s === 'in_progress')).toHaveLength(3)
    expect(screen.getByText('跑后台构建')).toBeTruthy()
    expect(screen.getByText('读源码')).toBeTruthy()
    expect(screen.getByText('1 已完成 · 3 进行中 · 1 待处理')).toBeTruthy()
  })

  it('an all-completed list collapses the summary to the done count alone', () => {
    render(<TodoPanel todos={[{ content: '都完了', status: 'completed' }]} t={t} />)
    expect(screen.getByRole('button', { expanded: false })).toBeTruthy()
    expect(screen.queryByText('都完了')).toBeNull()
    expect(screen.getByText('1 已完成')).toBeTruthy()
    expect(screen.queryByText(/进行中|待处理/)).toBeNull()
  })
})

const SID = 'todo-session' as SessionId

/** Live list metadata is independent of the Session's todo projection. */
function sessionList(presentation?: SessionSummary['presentation']): SessionListState {
  return {
    ids: [SID], phase: 'ready', projectionsBySession: {},
    byId: {
      [SID]: {
        id: SID, displayTitle: 'Current session', running: false,
        retainedBy: {}, blank: false, updatedAt: 1, ...presentation ? { presentation } : {},
      },
    },
  }
}

/** The local submission echoes the composer registers on the click's own frame. */
type EchoStore = ReturnType<typeof createSnapshotStore<{ pendingSubmissions: { placement: string }[] }>>

function echoes(): EchoStore {
  return createSnapshotStore<{ pendingSubmissions: { placement: string }[] }>({ pendingSubmissions: [] })
}

/** Bind the adapter's actual Session metadata, submission echoes and projected-plan inputs. */
function dockProps(
  store: ReturnType<typeof createSnapshotStore<{ value: readonly TodoItem[] | null | undefined }>>,
  sessions = createSnapshotStore(sessionList()),
  session: EchoStore = echoes(),
): TodoDockProps {
  const useProjection = ((_key: string, selector?: (v: unknown) => unknown) =>
    bindSnapshotSelector(store)(s => (selector ?? (v => v))(s.value))) as TodoDockProps['useProjection']
  return {
    sessionId: SID, useSession: bindSnapshotSelector(session) as unknown as TodoDockProps['useSession'],
    useSessions: bindSnapshotSelector(sessions), useProjection, t,
  }
}

describe('TodoDock', () => {
  it('reads the host-computed todos projection and retains a deactivated exit before removal', async () => {
    const store = createSnapshotStore<{ value: readonly TodoItem[] | null | undefined }>({ value: undefined })
    render(<TodoDock {...dockProps(store)} />)
    // Capability absent (no baseline/frame yet) renders nothing.
    expect(screen.queryByTestId('todo-panel')).toBeNull()
    act(() => { store.set({ value: LIST }) })
    expect(screen.getByText('1 已完成 · 1 进行中 · 1 待处理')).toBeTruthy()
    act(() => { store.set({ value: null }) })
    expect(screen.queryByRole('region', { name: '任务' })).toBeNull()
    expect(screen.getByTestId('todo-panel').hasAttribute('inert')).toBe(true)
    expect(screen.getByText('1 已完成 · 1 进行中 · 1 待处理')).toBeTruthy()
    await waitFor(() => { expect(screen.queryByTestId('todo-panel')).toBeNull() })
  })

  it('starts the plan leaving with the send echo, before the Host clears the plan', () => {
    vi.useFakeTimers()
    try {
      const store = createSnapshotStore<{ value: readonly TodoItem[] | null | undefined }>({ value: LIST })
      const session = echoes()
      render(<TodoDock {...dockProps(store, undefined, session)} />)
      expect(screen.getByRole('region', { name: '任务' })).toBeTruthy()

      // The click's own frame: the card is already on its way out, the plan still projected.
      act(() => { session.set({ pendingSubmissions: [{ placement: 'transcript' }] }) })
      expect(screen.getByTestId('todo-panel').hasAttribute('inert')).toBe(true)
      expect(screen.getByText('1 已完成 · 1 进行中 · 1 待处理')).toBeTruthy()

      // The turn start clears the plan, the echo hands off; the exit just finishes.
      act(() => { store.set({ value: null }) })
      act(() => { session.set({ pendingSubmissions: [] }) })
      act(() => { vi.advanceTimersByTime(300) })
      expect(screen.queryByTestId('todo-panel')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('leaves the plan alone for a queued or steering send', () => {
    const store = createSnapshotStore<{ value: readonly TodoItem[] | null | undefined }>({ value: LIST })
    const session = echoes()
    render(<TodoDock {...dockProps(store, undefined, session)} />)
    for (const placement of ['queued', 'steering']) {
      act(() => { session.set({ pendingSubmissions: [{ placement }] }) })
      expect(screen.getByTestId('todo-panel').hasAttribute('inert')).toBe(false)
    }
  })

  it('brings the plan back when the send starts no turn', () => {
    vi.useFakeTimers()
    try {
      const store = createSnapshotStore<{ value: readonly TodoItem[] | null | undefined }>({ value: LIST })
      const session = echoes()
      render(<TodoDock {...dockProps(store, undefined, session)} />)
      act(() => { session.set({ pendingSubmissions: [{ placement: 'transcript' }] }) })
      expect(screen.getByTestId('todo-panel').hasAttribute('inert')).toBe(true)

      // The prompt was rejected: the echo goes, the plan was never cleared.
      act(() => { session.set({ pendingSubmissions: [] }) })
      act(() => { vi.advanceTimersByTime(250) })
      expect(screen.queryByTestId('todo-panel')).toBeNull()
      act(() => { vi.advanceTimersByTime(1000) })
      expect(screen.getByTestId('todo-panel').hasAttribute('inert')).toBe(false)
      expect(screen.getByText('1 已完成 · 1 进行中 · 1 待处理')).toBeTruthy()
    } finally {
      vi.useRealTimers()
    }
  })

  it('shows a plan written while the echo is still around', () => {
    const store = createSnapshotStore<{ value: readonly TodoItem[] | null | undefined }>({ value: LIST })
    const session = echoes()
    render(<TodoDock {...dockProps(store, undefined, session)} />)
    act(() => { session.set({ pendingSubmissions: [{ placement: 'transcript' }] }) })
    act(() => { store.set({ value: null }) })
    // The new turn writes its plan before the echo retires.
    act(() => { store.set({ value: PARALLEL }) })
    expect(screen.getByTestId('todo-panel').hasAttribute('inert')).toBe(false)
    expect(screen.getByText('1 已完成 · 3 进行中 · 1 待处理')).toBeTruthy()
  })

  it('keeps a Project Lead plan available without mounting a composer strip', () => {
    const store = createSnapshotStore<{ value: readonly TodoItem[] | null | undefined }>({ value: LIST })
    const sessions = createSnapshotStore(sessionList({ owner: 'project', title: 'Project Lead' }))
    render(<TodoDock {...dockProps(store, sessions)} />)
    expect(screen.queryByTestId('todo-panel')).toBeNull()
    expect(store.getSnapshot().value).toBe(LIST)

    act(() => { store.set({ value: PARALLEL }) })
    expect(screen.queryByTestId('todo-panel')).toBeNull()
    expect(store.getSnapshot().value).toBe(PARALLEL)

    act(() => { sessions.set(sessionList()) })
    expect(screen.getByText('1 已完成 · 3 进行中 · 1 待处理')).toBeTruthy()
  })

  it('removes the native strip as soon as the Session acquires Project Lead presentation', () => {
    const store = createSnapshotStore<{ value: readonly TodoItem[] | null | undefined }>({ value: LIST })
    const sessions = createSnapshotStore<SessionListState>({ ids: [], byId: {}, phase: 'pending', projectionsBySession: {} })
    render(<TodoDock {...dockProps(store, sessions)} />)
    fireEvent.click(screen.getByRole('button', { expanded: false }))
    expect(screen.getByText('写组件')).toBeTruthy()

    act(() => { sessions.set(sessionList({ owner: 'project', title: 'Project Lead' })) })
    expect(screen.queryByTestId('todo-panel')).toBeNull()
    expect(screen.queryByText('写组件')).toBeNull()

    act(() => { store.set({ value: null }) })
    expect(screen.queryByTestId('todo-panel')).toBeNull()
  })

  it.each([
    { owner: 'project', title: 'Project member', composer: 'managed' as const },
    { owner: 'another-plugin', title: 'Other presentation' },
  ])('keeps the native plan for $title', (presentation) => {
    const store = createSnapshotStore<{ value: readonly TodoItem[] | null | undefined }>({ value: LIST })
    const sessions = createSnapshotStore(sessionList(presentation))
    render(<TodoDock {...dockProps(store, sessions)} />)
    expect(screen.getByText('1 已完成 · 1 进行中 · 1 待处理')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { expanded: false }))
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
  })

  it('registers before the goal and queue entries', () => {
    expect(todoDockEntry.name).toBe('conversation-todo-dock')
    expect(todoDockEntry.inject).toEqual(['slots'])
    const register = vi.fn(() => () => undefined)
    const inject = vi.fn((_name: string, callback: () => () => void) => callback())
    todoDockEntry.apply({ slots: { inject, register } } as never)
    expect(inject).toHaveBeenCalledWith('conversation.input.dock', expect.any(Function))
    expect(register).toHaveBeenCalledWith({ name: 'conversation.input.dock', id: 'todo', order: 0, locale: NS }, TodoDock)
  })
})
