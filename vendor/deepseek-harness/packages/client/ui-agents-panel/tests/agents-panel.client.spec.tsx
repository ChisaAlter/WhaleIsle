// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { JobsSnapshot } from '@deepseek-ai/dsh-api-job-controller/client'
import type { SubagentCatalogEntry } from '@deepseek-ai/dsh-subagent/client'
import type { JobView } from '@deepseek-ai/dsh-jobs/view'
import type { AgentsPanelProps } from '../src/client/AgentsPanel.tsx'
import { AgentsPanel } from '../src/client/AgentsPanel.tsx'
import { en } from '../src/client/locales.ts'

const t: AgentsPanelProps['t'] = key => (en as Record<string, string>)[key] ?? key
const neverHook = (() => { throw new Error('agents must not read this hook') }) as never
const PARENT = 'session-parent' as SessionId
const CHILD = 'session-child' as SessionId

function sessionList(opts: {
  catalog?: SubagentCatalogEntry[]
  childInList?: boolean
}): SessionListState {
  return {
    ids: [PARENT],
    byId: {
      [PARENT]: {
        id: PARENT,
        displayTitle: 'root',
        retainedBy: {},
        running: true,
        blank: false,
        updatedAt: 1,
      },
      ...(opts.childInList === true
        ? {
          [CHILD]: {
            id: CHILD,
            displayTitle: 'writer',
            retainedBy: {},
            running: true,
            blank: false,
            updatedAt: 2,
            parentId: PARENT,
            origin: 'subagent' as const,
          },
        }
        : {}),
    },
    phase: 'ready',
    projectionsBySession: opts.catalog === undefined ? {} : {
      [PARENT]: { values: { subagentCatalog: opts.catalog }, state: 'ready', error: null },
    },
  }
}

function panelProps(
  state: SessionListState,
  jobRows: readonly JobView[] = [],
  openAgent = () => {},
  translate: AgentsPanelProps['t'] = t,
): AgentsPanelProps {
  const jobsSnapshot: JobsSnapshot = { rows: jobRows.length > 0 ? { [PARENT]: jobRows } : {}, observed: {} }
  const jobsSource = {
    snapshot: jobsSnapshot,
    listeners: new Set<() => void>(),
    getSnapshot() { return this.snapshot },
    subscribe(listener: () => void) {
      this.listeners.add(listener)
      return () => { this.listeners.delete(listener) }
    },
  }
  return {
    sessionId: PARENT,
    useSession: neverHook,
    useSessions: (sel: (s: SessionListState) => unknown) => sel(state),
    useWorkspaces: neverHook,
    useProjection: neverHook,
    jobs: jobsSource,
    watchJobs: () => () => {},
    openAgent,
    t: translate,
  } as unknown as AgentsPanelProps
}

function mount(state: SessionListState, openAgent = () => {}, jobRows: readonly JobView[] = []) {
  render(<AgentsPanel {...panelProps(state, jobRows, openAgent)} />)
}

afterEach(cleanup)

describe('AgentsPanel', () => {
  it('shows external executions without offering a nonexistent local conversation', () => {
    const openAgent = vi.fn()
    mount(sessionList({ catalog: [{ id: CHILD, createdAt: 1, mode: 'external', label: 'External worker' }] }), openAgent)
    const row = screen.getByRole('button', { name: /External worker/ }) as HTMLButtonElement
    expect(row.disabled).toBe(true)
    expect(screen.getByText('External task')).toBeTruthy()
    expect(screen.queryByText('not running')).toBeNull()
    fireEvent.click(row)
    expect(openAgent).not.toHaveBeenCalled()
  })

  it('keeps the Jobs source receiver for snapshot reads and live subscriptions', () => {
    const jobsSource = {
      snapshot: { rows: {}, observed: {} } as JobsSnapshot,
      listeners: new Set<() => void>(),
      getSnapshot() { return this.snapshot },
      subscribe(listener: () => void) {
        this.listeners.add(listener)
        return () => { this.listeners.delete(listener) }
      },
    }
    render(<AgentsPanel {...{ ...panelProps(sessionList({})), jobs: jobsSource }} />)
    expect(jobsSource.listeners.size).toBe(1)
    act(() => {
      jobsSource.snapshot = { rows: { [PARENT]: [{
        id: 'bash-live' as never, kind: 'bash', label: 'live job', status: 'running',
        startedAt: 1, output: { total: 0, earliest: 0 },
      }] }, observed: {} }
      for (const listener of jobsSource.listeners) listener()
    })
    expect(screen.getByText('live job')).toBeTruthy()
    cleanup()
    expect(jobsSource.listeners.size).toBe(0)
  })

  it('shows the empty state when the session has no subagents', () => {
    mount(sessionList({}))
    expect(screen.getByText('No agents yet')).toBeTruthy()
    expect(screen.getByText('When this session spawns subagents, they show up here.')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Agents' })).toBeNull()
    expect(screen.queryByText('writer')).toBeNull()
  })

  it('lists catalog children with label and activity', () => {
    mount(sessionList({
      catalog: [{ id: CHILD, createdAt: 1, mode: 'continuable', label: 'writer' }],
      childInList: true,
    }))
    expect(screen.getByText('writer')).toBeTruthy()
    expect(screen.getByText(/running/)).toBeTruthy()
    expect(screen.queryByText('No agents yet')).toBeNull()
  })

  it('lists byId children when the catalog is absent', () => {
    mount(sessionList({ childInList: true }))
    expect(screen.getByText('writer')).toBeTruthy()
    expect(screen.getByText('running')).toBeTruthy()
  })

  it('opens a catalog child when the row is clicked', () => {
    const openAgent = vi.fn()
    mount(sessionList({
      catalog: [{ id: CHILD, createdAt: 1, mode: 'continuable', label: 'writer' }],
      childInList: true,
    }), openAgent)
    fireEvent.click(screen.getByRole('button', { name: /writer/ }))
    expect(openAgent).toHaveBeenCalledWith(CHILD)
  })

  it('lists background jobs for the session', () => {
    const state = sessionList({ childInList: true })
    mount(state, undefined, [{
        id: 'bash-1' as never,
        kind: 'bash',
        label: 'sleep 2',
        status: 'running',
        startedAt: 1,
        output: { total: 0, earliest: 0 },
      }])
    expect(screen.getByText('Background jobs')).toBeTruthy()
    expect(screen.getByText('sleep 2')).toBeTruthy()
    expect(screen.getAllByText('running').length).toBeGreaterThan(0)
  })

  it('shows inactive one-shot rows and job detail', () => {
    const state = sessionList({
      catalog: [{ id: CHILD, createdAt: 1, mode: 'one-shot', label: 'once' }],
    })
    mount(state, undefined, [{
        id: 'bash-2' as never,
        kind: 'bash',
        label: 'echo',
        status: 'completed',
        startedAt: 1,
        output: { total: 0, earliest: 0 },
        detail: 'exit 0',
      }])
    expect(screen.getByText('once')).toBeTruthy()
    expect(screen.getByText(/not running/)).toBeTruthy()
    expect(screen.getByText(/one-shot/)).toBeTruthy()
    expect(screen.getByText(/exit 0/)).toBeTruthy()
  })

  it('renders job status through the locale table, not the raw enum', () => {
    const state = sessionList({})
    const jobRows: JobView[] = [{
        id: 'bash-3' as never,
        kind: 'bash',
        label: 'pnpm test',
        status: 'failed',
        startedAt: 1,
        output: { total: 0, earliest: 0 },
      }]
    const localized: AgentsPanelProps['t'] = (key) => (
      key === 'jobs.status.failed' ? '失败' : ((en as Record<string, string>)[key] ?? key)
    )
    render(<AgentsPanel {...panelProps(state, jobRows, undefined, localized)} />)
    expect(screen.getByText('失败')).toBeTruthy()
    expect(screen.queryByText('failed')).toBeNull()
  })

  it('reads agents and jobs from the tab session instead of a main-view fallback', () => {
    const state = sessionList({})
    const jobRows: JobView[] = [{
        id: 'bash-parent' as never,
        kind: 'bash',
        label: 'parent job',
        status: 'running',
        startedAt: 1,
        output: { total: 0, earliest: 0 },
      }]
    for (const row of Object.values(state.byId)) state.byId[row.id] = { ...row, retainedBy: {} }
    render(<AgentsPanel {...panelProps(state, jobRows)} />)
    expect(screen.getByText('No agents yet')).toBeTruthy()
    expect(screen.getByText('Background jobs')).toBeTruthy()
    expect(screen.getByText('parent job')).toBeTruthy()
  })
})
