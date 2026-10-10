/** An opaque-origin page with a size/theme bridge and no application capabilities. */
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { ThemeSnapshot } from '@deepseek-ai/dsh-client-ui-theme/client'
import {
  VISUAL_REPLY_SIZE_MESSAGE, VISUAL_REPLY_THEME_MESSAGE,
} from '../constants.ts'
import css from './VisualReply.module.css'

interface FrameProps {
  readonly html: string
  readonly title: string
  readonly initialHeight: number
  readonly theme: ThemeSnapshot
  readonly expanded?: boolean
}

const TOKEN_MAP = [
  ['--bg', '--dsw-alias-bg-base'],
  ['--background', '--dsw-alias-bg-base'],
  ['--surface', '--dsw-alias-bg-layer-1'],
  ['--text', '--dsw-alias-label-primary'],
  ['--text-secondary', '--dsw-alias-label-secondary'],
  ['--border', '--dsw-alias-border-l2'],
  ['--accent', '--dsw-alias-brand-primary'],
] as const

export function VisualReplyFrame({ html, title, initialHeight, theme, expanded = false }: FrameProps) {
  const frame = useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = useState(initialHeight)
  const sendTheme = (): void => {
    const target = frame.current
    if (target?.contentWindow === null || target === null) return
    const computed = getComputedStyle(target)
    const variables = Object.fromEntries(TOKEN_MAP
      .map(([key, token]) => [key, computed.getPropertyValue(token).trim()]))
    target.contentWindow.postMessage({
      type: VISUAL_REPLY_THEME_MESSAGE, appearance: theme.active.colorScheme, variables,
    }, '*')
  }
  useEffect(() => { sendTheme() }, [theme, html])
  useEffect(() => {
    const resize = (event: MessageEvent<unknown>): void => {
      if (event.source !== frame.current?.contentWindow || typeof event.data !== 'object' || event.data === null) return
      const data = event.data as { type?: unknown; height?: unknown }
      if (data.type !== VISUAL_REPLY_SIZE_MESSAGE || typeof data.height !== 'number' || !Number.isFinite(data.height)) return
      setHeight(Math.max(80, Math.min(2000, Math.ceil(data.height))))
    }
    window.addEventListener('message', resize)
    return () => window.removeEventListener('message', resize)
  }, [])
  return <iframe
    ref={frame}
    name="whale-visual-reply"
    className={expanded ? css.expandedFrame : css.frame}
    title={title}
    sandbox="allow-scripts allow-forms"
    referrerPolicy="no-referrer"
    srcDoc={html}
    style={expanded ? undefined : { '--visual-reply-height': `${height}px` } as CSSProperties}
    onLoad={sendTheme}
  />
}
