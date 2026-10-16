import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Button, CodeBlock, IconCloseOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import type { AssistantOpenUi } from './openui.ts'
import css from './OpenUiFrame.module.css'

const CHANNEL = 'whale-openui'
const VERSION = 1
const API_PATHS = new Set(['/api/wiki', '/api/image-search', '/api/street-route'])

interface OpenUiShell {
  openuiViewer(): Promise<string>
  openuiApi(input: { path: string; query: Record<string, unknown> }): Promise<{ status: number; body: unknown }>
  openExternal(url: string): Promise<unknown>
}

interface Props {
  readonly instanceId: string
  readonly program: string
  readonly streaming: boolean
  readonly openUi: AssistantOpenUi
  readonly t: ChatViewSlotProps['t']
}

const TOKEN_MAP = [
  ['--bg', '--dsw-alias-bg-base'], ['--background', '--dsw-alias-bg-base'],
  ['--surface', '--dsw-alias-bg-layer-1'], ['--text', '--dsw-alias-label-primary'],
  ['--text-secondary', '--dsw-alias-label-secondary'], ['--border', '--dsw-alias-border-l2'],
  ['--accent', '--dsw-alias-brand-primary'],
] as const

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** A stable, opaque-origin React 19 viewer; all host actions stay in the trusted parent. */
export function OpenUiFrame({ instanceId, program, streaming, openUi, t }: Props) {
  const frame = useRef<HTMLIFrameElement>(null)
  const alive = useRef(false)
  const ready = useRef(false)
  const [html, setHtml] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [source, setSource] = useState(false)
  const [height, setHeight] = useState(320)
  const [pending, setPending] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [viewerError, setViewerError] = useState<string | null>(null)
  const state = useRef<Record<string, unknown>>({})
  const current = useRef({ program, streaming, openUi, t })
  current.current = { program, streaming, openUi, t }

  const post = (type: string, payload: Record<string, unknown> = {}): void => {
    if (!alive.current) return
    frame.current?.contentWindow?.postMessage({ channel: CHANNEL, version: VERSION, instanceId, type, ...payload }, '*')
  }
  const render = (): void => {
    if (!ready.current || frame.current === null) return
    const computed = getComputedStyle(frame.current)
    const variables: Record<string, string> = {}
    for (const name of Array.from(computed)) {
      if (name.startsWith('--dsw-')) variables[name] = computed.getPropertyValue(name).trim()
    }
    for (const [name, token] of TOKEN_MAP) variables[name] = computed.getPropertyValue(token).trim()
    const props = current.current
    const appearance = props.openUi.theme?.active.colorScheme
      ?? (computed.colorScheme === 'light' ? 'light' : 'dark')
    post('render', {
      program: props.program, streaming: props.streaming, state: state.current,
      theme: { appearance, variables },
    })
  }

  useEffect(() => {
    alive.current = true
    const label = (key: Parameters<ChatViewSlotProps['t']>[0]): string => current.current.t(key)
    const shell = (window as Window & { shell?: OpenUiShell }).shell
    try { state.current = current.current.openUi.readState(instanceId) }
    catch (cause: unknown) { setError(`${label('openui.stateFailed')} ${messageOf(cause)}`) }
    if (shell?.openuiViewer === undefined) {
      setError(label('openui.desktopOnly'))
    } else {
      void shell.openuiViewer().then(document => {
        if (!document.trim()) throw new Error(label('openui.emptyViewer'))
        if (alive.current) setHtml(document)
      }).catch((cause: unknown) => {
        if (alive.current) setError(`${label('openui.loadFailed')} ${messageOf(cause)}`)
      })
    }
    const receive = (event: MessageEvent<unknown>): void => {
      if (!alive.current || event.source !== frame.current?.contentWindow || !record(event.data)) return
      const data = event.data
      if (data.channel !== CHANNEL || data.version !== VERSION || data.instanceId !== instanceId) return
      switch (data.type) {
        case 'ready':
          ready.current = true
          setLoaded(true)
          render()
          break
        case 'height':
          if (typeof data.height === 'number' && Number.isFinite(data.height)) {
            setHeight(Math.max(80, Math.min(2000, Math.ceil(data.height))))
          }
          break
        case 'state':
          if (!record(data.state)) return
          state.current = data.state
          try { current.current.openUi.saveState(instanceId, data.state) }
          catch (cause: unknown) { setError(`${label('openui.stateFailed')} ${messageOf(cause)}`) }
          break
        case 'assistant': {
          if (typeof data.message !== 'string' || data.message.trim() === '') return
          setError(null)
          setPending(value => value + 1)
          const formState = data.formState ?? (Object.keys(state.current).length > 0 ? state.current : undefined)
          void current.current.openUi.send({ message: data.message, formState, context: data.context })
            .catch((cause: unknown) => {
              if (alive.current) setError(`${label('openui.actionFailed')} ${messageOf(cause)}`)
            }).finally(() => { if (alive.current) setPending(value => value - 1) })
          break
        }
        case 'open-url': {
          if (typeof data.url !== 'string') return
          let url: URL
          try { url = new URL(data.url) } catch { return }
          if (url.protocol !== 'https:' && url.protocol !== 'http:') return
          if (shell?.openExternal === undefined) return
          void shell.openExternal(url.href).catch((cause: unknown) => {
            if (alive.current) setError(`${label('openui.actionFailed')} ${messageOf(cause)}`)
          })
          break
        }
        case 'clipboard': {
          if (typeof data.requestId !== 'string' || typeof data.text !== 'string') return
          const requestId = data.requestId
          const text = data.text
          void Promise.resolve().then(() => navigator.clipboard.writeText(text)).then(
            () => post('clipboard-response', { requestId, ok: true }),
            (cause: unknown) => {
              post('clipboard-response', { requestId, ok: false, error: messageOf(cause) })
              if (alive.current) setError(`${label('openui.actionFailed')} ${messageOf(cause)}`)
            },
          )
          break
        }
        case 'api-request': {
          if (typeof data.requestId !== 'string') return
          const requestId = data.requestId
          if (typeof data.path !== 'string' || !API_PATHS.has(data.path) || !record(data.query)) {
            post('api-response', { requestId, status: 400, body: { error: 'Unsupported OpenUI API request.' } })
            return
          }
          if (shell?.openuiApi === undefined) {
            post('api-response', { requestId, status: 503, body: { error: label('openui.desktopOnly') } })
            return
          }
          void shell.openuiApi({ path: data.path, query: data.query }).then(
            result => post('api-response', { requestId, ...result }),
            (cause: unknown) => post('api-response', { requestId, status: 502, body: { error: messageOf(cause) } }),
          )
          break
        }
        case 'error':
          if (typeof data.message === 'string') setViewerError(data.message)
          break
        case 'resolved':
          if (data.program === current.current.program) setViewerError(null)
          break
      }
    }
    window.addEventListener('message', receive)
    return () => {
      alive.current = false
      ready.current = false
      window.removeEventListener('message', receive)
    }
  }, [instanceId])

  useEffect(() => { render() }, [program, streaming, openUi.theme])

  const visibleError = error ?? viewerError

  return <section className={css.root} data-openui-instance={instanceId} aria-busy={(!loaded && error === null) || pending > 0}>
    <header className={css.toolbar}>
      <span className={css.label} role="status">{t(pending > 0 ? 'openui.sending' : 'openui.title')}</span>
      <Button size="sm" onClick={() => setSource(value => !value)} aria-pressed={source}>
        {t(source ? 'openui.preview' : 'openui.source')}
      </Button>
    </header>
    <div className={css.body}>
      {html !== null && <iframe
        ref={frame}
        name={`whale-openui:${instanceId}`}
        title={t('openui.title')}
        className={css.frame}
        sandbox="allow-scripts"
        allow="fullscreen; picture-in-picture; encrypted-media"
        allowFullScreen
        referrerPolicy="no-referrer"
        srcDoc={html}
        hidden={source}
        style={{ '--openui-height': `${height}px` } as CSSProperties}
      />}
      {source && <CodeBlock code={program} lang="openui" streaming={streaming}
        copyLabel={t('copy')} copiedLabel={t('copied')} />}
      {!source && !loaded && error === null && <div className={css.loading} role="status">{t('openui.loading')}</div>}
      {visibleError !== null && <div className={css.error} role="alert">
        <span>{visibleError}</span>
        {loaded && <Button size="sm" onClick={() => { setError(null); setViewerError(null) }}
          aria-label={t('openui.dismiss')} icon={<IconCloseOutlineRegular />} />}
      </div>}
    </div>
  </section>
}
