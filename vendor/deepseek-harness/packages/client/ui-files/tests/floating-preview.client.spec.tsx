// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Profiler } from 'react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { bindSnapshotSelector } from '../../ui-renderer/src/client/bind.ts'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { sessionFileAddress } from '@deepseek-ai/dsh-util-workspace-path'
import { FloatingPreviewButton } from '../src/client/FloatingPreviewButton.tsx'
import { floatingPreviewTarget } from '../src/client/floating-preview.ts'
import { en } from '../src/client/locales.ts'

const t = ((key: string): string => (en as Record<string, string>)[key] ?? key) as never

function sessions(rows: Record<string, { cwd?: string }>): SessionListState {
  const byId = Object.fromEntries(Object.entries(rows).map(([id, row]) => [id, {
    id: id as SessionId,
    displayTitle: id,
    running: false,
    blank: false,
    retainedBy: { mainView: 1 },
    updatedAt: 0,
    ...(row.cwd === undefined ? {} : { cwd: row.cwd }),
  }]))
  return {
    ids: Object.keys(byId) as SessionId[],
    byId: byId as SessionListState['byId'],
    phase: 'ready',
    projectionsBySession: {},
  }
}

afterEach(() => {
  cleanup()
  delete (window as Window & { shell?: unknown }).shell
})

describe('floating preview target', () => {
  it('uses the owning workspace for a relative resource', () => {
    expect(floatingPreviewTarget(
      sessionFileAddress('resource-session', 'src/a.ts'),
      '/tmp/resource',
    )).toEqual({
      ok: true,
      request: { cwd: '/tmp/resource', relativePath: 'src/a.ts' },
    })
  })

  it('uses an absolute request for an absolute resource address', () => {
    expect(floatingPreviewTarget(
      'dsh-resource://file/absolute/tmp/outside/a.ts',
      undefined,
    )).toEqual({ ok: true, request: { absolutePath: '/tmp/outside/a.ts' } })
  })

  it('disables a relative address whose owning session has no cwd', () => {
    expect(floatingPreviewTarget(
      sessionFileAddress('resource-session', 'src/a.ts'),
      undefined,
    )).toEqual({ ok: false, reason: 'no-cwd' })
  })
})

describe('FloatingPreviewButton', () => {
  it('sends the exact cwd + relativePath request', async () => {
    const previewOpenFileWindow = vi.fn(async () => ({ ok: true as const }))
    ;(window as Window & { shell?: unknown }).shell = { previewOpenFileWindow }
    render(
      <FloatingPreviewButton
        resourceAddress={sessionFileAddress('resource-session', 'src/a.ts')}
        useSessions={selector => selector(sessions({ 'resource-session': { cwd: '/tmp/resource' }, 'main-session': { cwd: '/tmp/main' } }))}
        t={t}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: en['preview.floating'] }))
    await waitFor(() => {
      expect(previewOpenFileWindow).toHaveBeenCalledWith({
        cwd: '/tmp/resource',
        relativePath: 'src/a.ts',
      })
    })
  })

  it('sends the absolutePath request when no cwd is available', async () => {
    const previewOpenFileWindow = vi.fn(async () => ({ ok: true as const }))
    ;(window as Window & { shell?: unknown }).shell = { previewOpenFileWindow }
    render(
      <FloatingPreviewButton
        resourceAddress="dsh-resource://file/absolute/tmp/a.ts"
        useSessions={selector => selector(sessions({}))}
        t={t}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: en['preview.floating'] }))
    await waitFor(() => {
      expect(previewOpenFileWindow).toHaveBeenCalledWith({ absolutePath: '/tmp/a.ts' })
    })
  })

  it('shows a disabled localized action when the owning session cwd is unavailable', () => {
    ;(window as Window & { shell?: unknown }).shell = { previewOpenFileWindow: vi.fn() }
    render(
      <FloatingPreviewButton
        resourceAddress={sessionFileAddress('resource-session', 'src/a.ts')}
        useSessions={selector => selector(sessions({ 'resource-session': {} }))}
        t={t}
      />,
    )
    expect((screen.getByRole('button', { name: en['preview.floating'] }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('hides the action without the Desktop preload capability', () => {
    render(
      <FloatingPreviewButton
        resourceAddress={sessionFileAddress('resource-session', 'src/a.ts')}
        useSessions={selector => selector(sessions({ 'resource-session': { cwd: '/tmp/resource' } }))}
        t={t}
      />,
    )
    expect(screen.queryByRole('button', { name: en['preview.floating'] })).toBeNull()
  })

  it('leaves a dirty editor untouched when the floating viewer opens', async () => {
    const previewOpenFileWindow = vi.fn(async () => ({ ok: true as const }))
    const writeFile = vi.fn(async () => ({ ok: true as const }))
    ;(window as Window & { shell?: unknown }).shell = { previewOpenFileWindow }
    const { FilePreview } = await import('../src/client/FilePreview.tsx')
    render(
      <FilePreview
        sessionId={'resource-session' as SessionId}
        relativePath="src/a.ts"
        active
        onDirtyChange={() => {}}
        registerSave={() => {}}
        readBuffer={() => undefined}
        writeBuffer={() => {}}
        useSessions={selector => selector(sessions({ 'resource-session': { cwd: '/tmp/resource' } }))}
        listDir={async () => ({ ok: false })}
        readFile={async () => ({ ok: true, text: 'disk', binary: false })}
        readFileMedia={async () => ({ ok: false })}
        mentionFile={() => {}}
        writeFile={writeFile}
        t={key => en[key as keyof typeof en] ?? key}
      />,
    )
    const editor = await screen.findByLabelText('src/a.ts') as HTMLTextAreaElement
    fireEvent.change(editor, { target: { value: 'unsaved draft' } })
    fireEvent.click(screen.getByRole('button', { name: en['preview.floating'] }))
    await waitFor(() => {
      expect(previewOpenFileWindow).toHaveBeenCalledWith({
        cwd: '/tmp/resource',
        relativePath: 'src/a.ts',
      })
    })
    expect((screen.getByLabelText('src/a.ts') as HTMLTextAreaElement).value).toBe('unsaved draft')
    expect(writeFile).not.toHaveBeenCalled()
  })

  it('ignores unrelated Session updates but tracks its resource workspace', async () => {
    const previewOpenFileWindow = vi.fn(async () => ({ ok: true as const }))
    ;(window as Window & { shell?: unknown }).shell = { previewOpenFileWindow }
    const source = createSnapshotStore(sessions({
      'resource-session': { cwd: '/tmp/resource' },
      'other-session': { cwd: '/tmp/other' },
    }))
    const useSessions = bindSnapshotSelector(source)
    const commits = vi.fn()
    const { FilePreview } = await import('../src/client/FilePreview.tsx')
    render(<Profiler id="file-preview" onRender={commits}>
      <FilePreview
        sessionId={'resource-session' as SessionId} relativePath="src/a.ts" active
        onDirtyChange={() => {}} registerSave={() => {}} readBuffer={() => undefined} writeBuffer={() => {}}
        useSessions={useSessions} listDir={async () => ({ ok: false })}
        readFile={async () => ({ ok: true, text: 'disk', binary: false })}
        readFileMedia={async () => ({ ok: false })} mentionFile={() => {}}
        writeFile={async () => ({ ok: true })} t={t}
      />
    </Profiler>)
    await screen.findByLabelText('src/a.ts')
    const count = commits.mock.calls.length
    await act(async () => {
      source.update(state => { state.byId['other-session' as SessionId]!.cwd = '/tmp/changed' })
    })
    expect(commits.mock.calls.length).toBe(count)
    await act(async () => {
      source.update(state => { state.byId['resource-session' as SessionId]!.cwd = '/tmp/new' })
    })
    expect(commits.mock.calls.length).toBeGreaterThan(count)
    fireEvent.click(screen.getByRole('button', { name: en['preview.floating'] }))
    await waitFor(() => {
      expect(previewOpenFileWindow).toHaveBeenCalledWith({ cwd: '/tmp/new', relativePath: 'src/a.ts' })
    })
  })

  it('captures the target before an in-flight request so a session switch cannot redirect it', async () => {
    let release!: (result: { ok: true }) => void
    const previewOpenFileWindow = vi.fn(() => new Promise<{ ok: true }>((resolve) => { release = resolve }))
    ;(window as Window & { shell?: unknown }).shell = { previewOpenFileWindow }
    const view = render(
      <FloatingPreviewButton
        resourceAddress={sessionFileAddress('resource-session', 'src/a.ts')}
        useSessions={selector => selector(sessions({ 'resource-session': { cwd: '/tmp/first' } }))}
        t={t}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: en['preview.floating'] }))
    view.rerender(
      <FloatingPreviewButton
        resourceAddress={sessionFileAddress('resource-session', 'src/a.ts')}
        useSessions={selector => selector(sessions({ 'resource-session': { cwd: '/tmp/second' } }))}
        t={t}
      />,
    )
    release({ ok: true })
    await waitFor(() => {
      expect(previewOpenFileWindow).toHaveBeenCalledWith({
        cwd: '/tmp/first',
        relativePath: 'src/a.ts',
      })
    })
  })

  it.each([
    ['rejected result', async () => ({ ok: false as const })],
    ['malformed result', async () => null],
    ['thrown IPC', async () => { throw new Error('ipc down') }],
  ])('shows a visible failure for %s without any OS fallback', async (_name, open) => {
    const previewOpenFileWindow = vi.fn(open)
    ;(window as Window & { shell?: unknown }).shell = { previewOpenFileWindow }
    render(
      <FloatingPreviewButton
        resourceAddress={sessionFileAddress('resource-session', 'src/a.ts')}
        useSessions={selector => selector(sessions({ 'resource-session': { cwd: '/tmp/resource' } }))}
        t={t}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: en['preview.floating'] }))
    expect((await screen.findByRole('alert')).textContent).toBe('Could not open the separate preview window.')
    expect(previewOpenFileWindow).toHaveBeenCalledTimes(1)
  })
})
