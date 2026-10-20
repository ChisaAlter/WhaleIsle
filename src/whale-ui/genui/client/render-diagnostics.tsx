import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react'
import { GenuiComponentPathContext } from './component-state.tsx'
import { ErrorBoundary } from './ErrorBoundary.tsx'

export interface GenuiRenderDiagnostic {
  readonly code: 'engine-error' | 'plot-error' | 'render-error'
  readonly component: string
  readonly path: string
  readonly message: string
}
export interface GenuiRenderDiagnosticsSnapshot {
  readonly sourceId: string
  readonly diagnostics: readonly GenuiRenderDiagnostic[]
}
export type GenuiRenderDiagnosticsHandler = (snapshot: GenuiRenderDiagnosticsSnapshot) => void
interface DiagnosticScope {
  readonly set: (id: string, diagnostic: GenuiRenderDiagnostic | null) => void
}
const Context = createContext<DiagnosticScope | null>(null)

/** Block-local error ownership. No global store or DOM inspection. The source
 * id is supplied by the host and should include its document/source revision. */
export function GenuiRenderDiagnosticsProvider({ sourceId, onDiagnostics, children }: {
  sourceId: string
  onDiagnostics?: GenuiRenderDiagnosticsHandler | undefined
  children: ReactNode
}) {
  const callback = useRef(onDiagnostics)
  callback.current = onDiagnostics
  const scope = useMemo(() => {
    const entries = new Map<string, GenuiRenderDiagnostic>()
    let active = true
    let scheduled = false
    let lastPublished: string | undefined
    const publish = (): void => {
      if (!active || callback.current === undefined) return
      const diagnostics = [...entries.values()]
      const signature = JSON.stringify(diagnostics)
      if (signature === lastPublished) return
      lastPublished = signature
      callback.current({ sourceId, diagnostics })
    }
    return {
      publish,
      start: () => { active = true; lastPublished = undefined; publish() },
      stop: () => { active = false; entries.clear(); callback.current?.({ sourceId, diagnostics: [] }) },
      set: (id: string, diagnostic: GenuiRenderDiagnostic | null) => {
        if (!active) return
        const previous = entries.get(id)
        if (diagnostic === null) { if (!entries.delete(id)) return }
        else {
          if (previous?.code === diagnostic.code && previous.path === diagnostic.path && previous.component === diagnostic.component && previous.message === diagnostic.message) return
          entries.set(id, diagnostic)
        }
        if (scheduled) return
        scheduled = true
        queueMicrotask(() => { scheduled = false; publish() })
      },
    }
  }, [sourceId])
  useLayoutEffect(() => { scope.start(); return scope.stop }, [scope])
  useEffect(() => { scope.publish() }, [scope, onDiagnostics])
  return <Context.Provider value={scope}>{children}</Context.Provider>
}

/** A stable reporter for one mounted component; stale work cannot write into
 * a later source scope. Calling with null clears only this component's error. */
export function useGenuiRenderReporter(component: string) {
  const scope = useContext(Context)
  const path = useContext(GenuiComponentPathContext)
  const id = useId()
  const report = useCallback((error: unknown | null, code: GenuiRenderDiagnostic['code'] = 'engine-error'): void => {
    scope?.set(id, error === null ? null : { code, component, path, message: error instanceof Error ? error.message : String(error) })
  }, [scope, path, component, id])
  useEffect(() => () => report(null), [report])
  return report
}

/** Report caught React render/effect exceptions using the same source scope. */
export function GenuiRenderBoundary({ component, resetKey, children }: { component: string; resetKey: unknown; children: ReactNode }) {
  const report = useGenuiRenderReporter(component)
  const onError = useCallback((error: Error | null) => report(error, 'render-error'), [report])
  return <ErrorBoundary resetKey={resetKey} onError={onError}>{children}</ErrorBoundary>
}

export function GenuiRenderError({ component, message }: { component: string; message: string }) {
  const report = useGenuiRenderReporter(component)
  useEffect(() => { report(message, 'render-error'); return () => report(null) }, [message, report])
  return <div role="alert" data-genui-unsupported>{message}</div>
}
