/** Embedded renderer. Identity, persistence and session routing belong to the host. */
import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { renderInline } from './inline.ts'
import { invokeGenuiAction, useGenuiAction, type GenuiActionAck, type GenuiActionHandler } from './action-context.ts'
import { GenuiComponentStateContext } from './component-state.tsx'
import { GenuiRenderBoundary, GenuiRenderDiagnosticsProvider } from './render-diagnostics.tsx'
import css from './GenuiBlock.module.css'
import { renderNode } from './blocks/render-node.tsx'
import type { AnswersState, GenuiBlockProps } from './blocks/state.ts'
import type { BlockInteractionState } from './interaction-state.ts'
import { compileSubmissionRegistry } from './submission-registry.ts'
import { walkGenuiNodes } from './walk-spec.ts'
import { useT } from './i18n/index.ts'

export const GENUI_ACTION_DEBOUNCE_MS = 300

function useDebouncedAction(handler: GenuiActionHandler | undefined, sourceRevision: unknown, sourceId: string | undefined): GenuiActionHandler | undefined {
  const pending = useRef(new Map<string, { timer: ReturnType<typeof setTimeout>; resolve: (ack: GenuiActionAck) => void }>())
  const current = useRef(handler)
  current.current = handler
  useLayoutEffect(() => () => {
    for (const item of pending.current.values()) {
      clearTimeout(item.timer)
      item.resolve({ status: 'cancelled', message: 'The component source changed or unmounted before the action was sent.' })
    }
    pending.current.clear()
  }, [sourceRevision, sourceId])
  const dispatch = useCallback<GenuiActionHandler>((action, payload) => {
    const send = (): Promise<GenuiActionAck> => current.current === undefined
      ? Promise.resolve({ status: 'failed', message: 'No host action handler is available.' })
      : invokeGenuiAction(current.current, action, payload)
    if (payload.type !== 'slider') return send()
    const key = `${action}\u0000${typeof payload.id === 'string' ? payload.id : ''}`
    const previous = pending.current.get(key)
    if (previous !== undefined) {
      clearTimeout(previous.timer)
      previous.resolve({ status: 'cancelled', message: 'Superseded by a newer slider value.' })
    }
    return new Promise(resolve => {
      const timer = setTimeout(() => { pending.current.delete(key); void send().then(resolve) }, GENUI_ACTION_DEBOUNCE_MS)
      pending.current.set(key, { timer, resolve })
    })
  }, [])
  return handler === undefined ? undefined : dispatch
}

function GenuiBlockInstance({ spec, diagnosticSourceId, animateEntrance = true, initialState, onStateChange, onStateSnapshot, onAction: suppliedAction }: GenuiBlockProps) {
  const t = useT()
  const contextAction = useGenuiAction()
  const hostAction = useDebouncedAction(suppliedAction ?? contextAction, spec, diagnosticSourceId)
  const [actionError, setActionError] = useState<string | null>(null)
  const alive = useRef(true)
  useLayoutEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const onAction = useMemo<GenuiActionHandler | undefined>(() => hostAction === undefined ? undefined : async (action, payload) => {
    const ack = await hostAction(action, payload)
    if (alive.current) setActionError(ack.status === 'failed' ? ack.message : null)
    return ack
  }, [hostAction])
  const submissionRegistry = useMemo(() => compileSubmissionRegistry(spec), [spec])
  const secretFields = useMemo<ReadonlySet<string>>(() => {
    const ids = new Set<string>()
    walkGenuiNodes(spec, node => { if (node.type === 'input' && node.inputType === 'password' && node.id !== undefined) ids.add(node.id) })
    return ids
  }, [spec])
  const sanitize = (state: BlockInteractionState): BlockInteractionState => ({
    ...state, fields: Object.fromEntries(Object.entries(state.fields ?? {}).filter(([id]) => !secretFields.has(id))),
  })
  const [state, setState] = useState<BlockInteractionState>(() => sanitize(initialState ?? {}))
  const stateRef = useRef(state)
  const suppliedRef = useRef(initialState)
  // External snapshots can replace state at the same document identity. Echoes
  // of onStateChange are cheap; callers need not remount to restore/reset state.
  if (suppliedRef.current !== initialState) {
    suppliedRef.current = initialState
    const next = sanitize(initialState ?? {})
    stateRef.current = next
    setState(next)
  }
  const callbacks = useRef({ onStateChange, onStateSnapshot, secretFields })
  callbacks.current = { onStateChange, onStateSnapshot, secretFields }
  const commit = useCallback((update: (previous: BlockInteractionState) => BlockInteractionState): void => {
    const previous = stateRef.current
    const candidate = update(previous)
    if (candidate === previous) return
    const next = { ...candidate, fields: Object.fromEntries(Object.entries(candidate.fields ?? {}).filter(([id]) => !callbacks.current.secretFields.has(id))) }
    stateRef.current = next
    setState(next)
    // Synchronous notification makes immediate unmount/host navigation safe.
    callbacks.current.onStateChange?.(next)
    callbacks.current.onStateSnapshot?.(next)
  }, [])
  useLayoutEffect(() => { onStateSnapshot?.(sanitize(stateRef.current)) }, [onStateSnapshot, secretFields])
  const setAnswer = useCallback((group: string, choice: string) => commit(previous => previous.answers?.[group] === choice ? previous : { ...previous, answers: { ...previous.answers, [group]: choice } }), [commit])
  const setMultiAnswer = useCallback((group: string, choice: string, checked: boolean) => commit(previous => {
    const current = previous.multiAnswers?.[group] ?? []
    const next = checked ? current.includes(choice) ? current : [...current, choice] : current.filter(item => item !== choice)
    if (previous.multiAnswers?.[group] !== undefined && next === current) return previous
    return { ...previous, multiAnswers: { ...previous.multiAnswers, [group]: next } }
  }), [commit])
  const setField = useCallback((id: string, value: string) => {
    if (callbacks.current.secretFields.has(id)) return
    commit(previous => previous.fields?.[id] === value ? previous : { ...previous, fields: { ...previous.fields, [id]: value } })
  }, [commit])
  const setLocked = useCallback((locked: boolean) => commit(previous => previous.locked === locked ? previous : { ...previous, locked }), [commit])
  const setComponentValue = useCallback((key: string, value: unknown) => commit(previous => Object.is(previous.componentState?.[key], value) ? previous : { ...previous, componentState: { ...previous.componentState, [key]: value } }), [commit])
  const clear = useCallback(() => commit(previous => ({ ...previous, answers: {}, multiAnswers: {}, locked: false, componentState: { ...previous.componentState, '$round': Number(previous.componentState?.['$round'] ?? 0) + 1 } })), [commit])
  const answersState: AnswersState = {
    answers: state.answers ?? {}, multiAnswers: state.multiAnswers ?? {}, fields: state.fields ?? {},
    secretFields, registry: submissionRegistry, locked: state.locked === true, round: Number(state.componentState?.['$round'] ?? 0),
    setAnswer, setMultiAnswer, setField, registerSecretField: () => {}, clear, setLocked,
  }
  const owner = useMemo(() => ({ values: state.componentState ?? {}, getValue: (key: string, fallback: unknown) => Object.hasOwn(stateRef.current.componentState ?? {}, key) ? stateRef.current.componentState![key] : fallback, setValue: setComponentValue }), [state.componentState, setComponentValue])
  return <GenuiComponentStateContext.Provider value={owner}>
    <div className={css.block} data-genui>
      {spec.title !== undefined && <div className={css.banner}>{renderInline(spec.title)}</div>}
      <div className={css.col} style={{ gap: `${spec.gap ?? 16}px` }}>
        {spec.items.map((node, index) => <div key={`items[${index}]`} className={css.reveal} style={{ animationDelay: `${Math.min(index * 90, 720)}ms`, ...(!animateEntrance || initialState !== undefined ? { animation: 'none' } : {}) }} onAnimationEnd={event => { if (event.target === event.currentTarget) event.currentTarget.style.animation = 'none' }}>
          {renderNode(node, `items[${index}]`, onAction, 0, answersState)}
        </div>)}
      </div>
      {actionError !== null && <div role="alert">{t('action.failed')}: {actionError}</div>}
    </div>
  </GenuiComponentStateContext.Provider>
}

/** A streaming instance adopts its first durable identity; leaving it remounts. */
export const GenuiBlock = memo(function GenuiBlock(props: GenuiBlockProps) {
  const [identity, setIdentity] = useState({ key: props.stateKey, generation: 0 })
  if (identity.key !== props.stateKey) setIdentity({ key: props.stateKey, generation: identity.generation + (identity.key === undefined ? 0 : 1) })
  return <GenuiRenderDiagnosticsProvider sourceId={props.diagnosticSourceId ?? props.stateKey ?? 'genui'} onDiagnostics={props.onRenderDiagnostics}>
    <GenuiRenderBoundary component="genui" resetKey={props.spec}><GenuiBlockInstance key={identity.generation} {...props} /></GenuiRenderBoundary>
  </GenuiRenderDiagnosticsProvider>
})
