import { useMemo } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { AssistantOpenUi, OpenUiInjected, WhaleSourceLanguage } from './openui.ts'
import type { createWhaleUiStore } from './whale-ui-store.ts'
import { OpenUiFrame } from './OpenUiFrame.tsx'

type Props = PropsRuntime<'tool.call.whale-ui'> & PropsLocale<'chat'>
  & PropsStore<ReturnType<typeof createWhaleUiStore>> & InjectFace<OpenUiInjected>

type Document = { language: WhaleSourceLanguage; program: string }

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function documentOf(metadata: unknown): Document | undefined {
  if (!record(metadata) || !record(metadata.whaleUi)) return undefined
  const document = metadata.whaleUi
  if (document.version !== 1 || typeof document.program !== 'string') return undefined
  const language = document.language
  if (language !== 'whale-ui' && language !== 'dsh-ui' && language !== 'openui' && language !== 'openui-lang') return undefined
  return { language, program: document.program }
}

/** Settled render_ui results share the original Session, viewer, store and action acknowledgement path. */
export function WhaleUiToolView({ sessionId, callId, seq, metadata, actions, useOpenUiTheme, useOpenUiLocale,
  sendOpenUiAction, readOpenUiState, saveOpenUiState, t }: Props) {
  const theme = useOpenUiTheme(value => value)
  const locale = useOpenUiLocale(value => value)
  const identity = `${encodeURIComponent(sessionId)}:tool:${encodeURIComponent(callId)}`
  const openUi = useMemo<AssistantOpenUi>(() => ({ identity, theme, locale, seq,
    send: sendOpenUiAction, readState: readOpenUiState, saveState: saveOpenUiState, publishPanel: actions.publish,
  }), [identity, theme, locale, seq, sendOpenUiAction, readOpenUiState, saveOpenUiState, actions.publish])
  const document = documentOf(metadata)
  if (document === undefined || !Number.isSafeInteger(seq) || seq < 0) return <div role="alert">{t('openui.invalidResult')}</div>
  return <OpenUiFrame key={identity} instanceId={identity} language={document.language} program={document.program}
    streaming={false} panelSource={{ sourceId: identity, order: [seq, 0, 0] }} openUi={openUi} t={t} />
}
