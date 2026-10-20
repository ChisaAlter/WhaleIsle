import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Button, CodeBlock, IconCloseOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import type { AssistantOpenUi, WhaleActionResult, WhaleSourceLanguage } from './openui.ts'
import type { WhalePanelOrder } from './whale-ui-store.ts'
import css from './OpenUiFrame.module.css'

const CHANNEL = 'whale-ui'
const VERSION = 2
const API_PATHS = new Set(['/api/wiki', '/api/image-search', '/api/street-route'])
const BUNDLES = new Set(['mermaid.js', 'three.js', 'echarts-core.js', 'echarts-full.js', 'icons.js', 'standalone-runtime.js'])

interface OpenUiShell {
  openuiViewer(): Promise<string>
  openuiApi(input: { path: string; query: Record<string, string> }): Promise<{ status: number; body: unknown }>
  openuiBundle(input: { name: string }): Promise<string>
  openExternal(url: string): Promise<unknown>
}

interface Props {
  readonly instanceId: string
  readonly program: string
  readonly language?: WhaleSourceLanguage
  readonly streaming: boolean
  /** A dock rendering must not republish its own normalized spec. */
  readonly panel?: boolean
  /** Host-owned coordinates; the viewer cannot choose its Session or ordering. */
  readonly panelSource?: { readonly sourceId: string; readonly order: WhalePanelOrder } | undefined
  readonly openUi: AssistantOpenUi
  readonly t: ChatViewSlotProps['t']
}

type Source = { readonly program: string; readonly language: WhaleSourceLanguage; readonly streaming: boolean }

function sameSource(left: Source, right: Source): boolean {
  return left.program === right.program && left.language === right.language && left.streaming === right.streaming
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

function download(filename: string, mime: string, content: string, t: ChatViewSlotProps['t']): void {
  if (filename === '' || filename.length > 240 || /[<>:"/\\|?*\u0000-\u001f\u007f]/u.test(filename)
    || filename === '.' || filename === '..' || /[. ]$/u.test(filename)) {
    throw new Error(t('openui.invalidFilename'))
  }
  if (!/^[\w.+-]+\/[\w.+-]+(?:;[\w=.+ -]+)*$/u.test(mime)) throw new Error(t('openui.invalidMediaType'))
  let data: BlobPart = content
  if (content.startsWith('data:')) {
    const comma = content.indexOf(',')
    if (comma < 0) throw new Error(t('openui.invalidDownload'))
    const header = content.slice(0, comma)
    const payload = content.slice(comma + 1)
    data = /;base64$/u.test(header)
      ? Uint8Array.from(atob(payload), character => character.charCodeAt(0))
      : decodeURIComponent(payload)
  }
  const url = URL.createObjectURL(new Blob([data], { type: mime }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.hidden = true
  document.body.appendChild(anchor)
  try { anchor.click() }
  finally { anchor.remove(); URL.revokeObjectURL(url) }
}

/** A stable opaque-origin Whale UI viewer; all host actions stay in the owning Session. */
export function OpenUiFrame({ instanceId, program, language = 'whale-ui', streaming, panel = false, panelSource, openUi, t }: Props) {
  const frame = useRef<HTMLIFrameElement>(null)
  const alive = useRef(false)
  const ready = useRef(false)
  const [html, setHtml] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [source, setSource] = useState(false)
  const [height, setHeight] = useState(320)
  const [title, setTitle] = useState('')
  const [pending, setPending] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<{ source: Source; error: string } | null>(null)
  const [viewerError, setViewerError] = useState<string | null>(null)
  const [publishedProgram, setPublishedProgram] = useState<string | null>(null)
  const state = useRef<Record<string, unknown>>({})
  const current = useRef({ program, language, streaming, panel, panelSource, openUi, t })
  current.current = { program, language, streaming, panel, panelSource, openUi, t }

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
    variables['--whale-font'] = computed.fontFamily
    variables['--whale-mono'] = computed.getPropertyValue('--ds-font-family-code').trim()
    variables['--whale-font-size'] = computed.getPropertyValue('--dsh-content-font-size').trim() || computed.fontSize
    const props = current.current
    const appearance = props.openUi.theme?.active.colorScheme
      ?? (computed.colorScheme === 'light' ? 'light' : 'dark')
    post('render', {
      program: props.program, language: props.language, streaming: props.streaming, state: state.current,
      theme: { appearance, variables }, locale: props.openUi.locale ?? 'en', panel: props.panel,
    })
  }

  useEffect(() => {
    let active = true
    alive.current = true
    const label = (key: Parameters<ChatViewSlotProps['t']>[0]): string => current.current.t(key)
    const shell = (window as Window & { shell?: OpenUiShell }).shell
    const hostFailure = (cause: unknown, source: Source): void => {
      if (active && sameSource(source, current.current)) {
        setActionError({ source, error: `${label('openui.actionFailed')} ${messageOf(cause)}` })
      }
    }
    try { state.current = current.current.openUi.readState(instanceId) }
    catch (cause: unknown) { setError(`${label('openui.stateFailed')} ${messageOf(cause)}`) }
    if (shell?.openuiViewer === undefined) {
      setError(label('openui.desktopOnly'))
    } else {
      void shell.openuiViewer().then(document => {
        if (!document.trim()) throw new Error(label('openui.emptyViewer'))
        if (active) setHtml(document)
      }).catch((cause: unknown) => {
        if (active) setError(`${label('openui.loadFailed')} ${messageOf(cause)}`)
      })
    }
    const action = async (data: Record<string, unknown>): Promise<WhaleActionResult> => {
      switch (data.action) {
        case 'assistant': {
          if (typeof data.message !== 'string' || data.message.trim() === '') throw new Error(label('openui.invalidAction'))
          // The viewer owns form membership; a document-wide state snapshot is not a form payload.
          return current.current.openUi.send({ message: data.message,
            ...(data.formState === undefined ? {} : { formState: data.formState }),
            ...(data.context === undefined ? {} : { context: data.context }) })
        }
        case 'open-url': {
          if (typeof data.url !== 'string') throw new Error(label('openui.invalidAction'))
          const url = new URL(data.url)
          if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error(label('openui.invalidAction'))
          if (shell?.openExternal === undefined) throw new Error(label('openui.desktopOnly'))
          const result = await shell.openExternal(url.href)
          if (result === false) throw new Error(label('openui.actionFailed'))
          return { ok: true }
        }
        case 'clipboard':
          if (typeof data.text !== 'string') throw new Error(label('openui.invalidAction'))
          await navigator.clipboard.writeText(data.text)
          return { ok: true }
        case 'download':
          if (typeof data.filename !== 'string' || typeof data.mime !== 'string' || typeof data.content !== 'string') {
            throw new Error(label('openui.invalidAction'))
          }
          download(data.filename, data.mime, data.content, current.current.t)
          return { ok: true }
        default: throw new Error(label('openui.invalidAction'))
      }
    }
    const receive = (event: MessageEvent<unknown>): void => {
      if (!active || event.source !== frame.current?.contentWindow || !record(event.data)) return
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
        case 'title':
          if (typeof data.title === 'string') setTitle(data.title.trim().slice(0, 120))
          break
        case 'state':
          if (!record(data.state)) return
          state.current = data.state
          try { current.current.openUi.saveState(instanceId, data.state) }
          catch (cause: unknown) { setError(`${label('openui.stateFailed')} ${messageOf(cause)}`) }
          break
        case 'action': {
          if (typeof data.requestId !== 'string' || data.requestId === '') return
          const requestId = data.requestId
          const owner = current.current
          const source = { program: owner.program, language: owner.language, streaming: owner.streaming }
          setActionError(null)
          setPending(value => value + 1)
          void action(data).catch((cause: unknown): WhaleActionResult => ({ ok: false, error: messageOf(cause) }))
            .then(result => {
              if (!active) return
              post('action-response', { requestId, result })
              if (!result.ok) hostFailure(result.error, source)
            }).finally(() => { if (active) setPending(value => value - 1) })
          break
        }
        case 'resource': {
          if (typeof data.requestId !== 'string') return
          const requestId = data.requestId
          if (typeof data.path !== 'string' || !API_PATHS.has(data.path) || !record(data.query)
            || !Object.values(data.query).every(value => typeof value === 'string')) {
            post('resource-response', { requestId, status: 400, body: { error: label('openui.invalidResource') } })
            return
          }
          if (shell?.openuiApi === undefined) {
            post('resource-response', { requestId, status: 503, body: { error: label('openui.desktopOnly') } })
            return
          }
          void shell.openuiApi({ path: data.path, query: data.query as Record<string, string> }).then(
            result => { if (active) post('resource-response', { requestId, ...result }) },
            (cause: unknown) => { if (active) post('resource-response', { requestId, status: 502, body: { error: messageOf(cause) } }) },
          )
          break
        }
        case 'bundle': {
          if (typeof data.requestId !== 'string' || typeof data.name !== 'string') return
          const { requestId, name } = data
          if (!BUNDLES.has(name)) {
            post('bundle-response', { requestId, name, error: label('openui.invalidBundle') })
            return
          }
          if (shell?.openuiBundle === undefined) {
            post('bundle-response', { requestId, name, error: label('openui.desktopOnly') })
            return
          }
          void shell.openuiBundle({ name }).then(
            base64 => { if (active) post('bundle-response', { requestId, name, base64 }) },
            (cause: unknown) => { if (active) post('bundle-response', { requestId, name, error: messageOf(cause) }) },
          )
          break
        }
        case 'panel': {
          const owner = current.current
          if (owner.panel || owner.streaming || owner.panelSource === undefined || owner.openUi.publishPanel === undefined) return
          if (!record(data.operation) || !record(data.operation.spec) || !Array.isArray(data.operation.spec.items)
            || typeof data.operation.append !== 'boolean') return
          try {
            owner.openUi.publishPanel({ sourceId: owner.panelSource.sourceId, order: owner.panelSource.order,
              append: data.operation.append, spec: data.operation.spec })
            setPublishedProgram(owner.program)
          } catch (cause: unknown) { hostFailure(cause, owner) }
          break
        }
        case 'diagnostics':
          if (data.program !== current.current.program || !Array.isArray(data.diagnostics)) return
          if (data.diagnostics.length > 0) {
            const messages = data.diagnostics.filter((value: unknown) => record(value) && typeof value.message === 'string')
              .map((value: Record<string, unknown>) => `${typeof value.path === 'string' ? `${value.path}: ` : ''}${String(value.message)}`)
            if (messages.length > 0) setViewerError(messages.join('\n'))
          } else if (data.complete === true) setViewerError(null)
          break
      }
    }
    window.addEventListener('message', receive)
    return () => {
      active = false
      alive.current = false
      ready.current = false
      window.removeEventListener('message', receive)
    }
  }, [instanceId])

  useEffect(() => { render() }, [program, language, streaming, panel, openUi.theme, openUi.locale, t])

  const visibleError = error ?? (actionError !== null && sameSource(actionError.source, { program, language, streaming })
    ? actionError.error : null) ?? viewerError
  const published = publishedProgram === program

  return <section className={css.root} data-whale-ui-instance={instanceId} aria-busy={(!loaded && error === null) || pending > 0}>
    <header className={css.toolbar}>
      <span className={css.label} role="status">{pending > 0 ? t('openui.sending') : published ? t('openui.panelPublished') : title || t('openui.title')}</span>
      <Button size="sm" onClick={() => setSource(value => !value)} aria-pressed={source}>
        {t(source ? 'openui.preview' : 'openui.source')}
      </Button>
    </header>
    <div className={css.body} data-panel-published={published && !source && visibleError === null || undefined}>
      {html !== null && <iframe
        ref={frame}
        name={`whale-ui:${instanceId}`}
        title={title || t('openui.title')}
        className={css.frame}
        sandbox="allow-scripts"
        allow="fullscreen; picture-in-picture; encrypted-media"
        allowFullScreen
        referrerPolicy="no-referrer"
        srcDoc={html}
        hidden={source || published}
        style={{ '--openui-height': `${height}px` } as CSSProperties}
      />}
      {source && <CodeBlock code={program} lang={language} streaming={streaming}
        copyLabel={t('copy')} copiedLabel={t('copied')} />}
      {!source && !published && !loaded && error === null && <div className={css.loading} role="status">{t('openui.loading')}</div>}
      {visibleError !== null && <div className={css.error} role="alert">
        <span>{visibleError}</span>
        {loaded && <Button size="sm" onClick={() => { setError(null); setActionError(null); setViewerError(null) }}
          aria-label={t('openui.dismiss')} icon={<IconCloseOutlineRegular />} />}
      </div>}
    </div>
  </section>
}
