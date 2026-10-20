import { useMemo, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { OpenUiInjected, AssistantOpenUi } from './openui.ts'
import type { createWhaleUiStore } from './whale-ui-store.ts'
import { OpenUiFrame } from './OpenUiFrame.tsx'
import css from './WhaleUiPanel.module.css'

type Props = PropsRuntime<'conversation.input.dock'> & PropsLocale<'chat'>
  & PropsStore<ReturnType<typeof createWhaleUiStore>> & InjectFace<OpenUiInjected>

/** One Session's folded panel, rendered by the same Whale UI frame as Markdown fences. */
export function WhaleUiPanel({ sessionId, useStore, actions, useOpenUiTheme, useOpenUiLocale,
  sendOpenUiAction, readOpenUiState, saveOpenUiState, t }: Props) {
  const snapshot = useStore(state => state.snapshot)
  const collapsed = useStore(state => state.collapsed)
  const restoreError = useStore(state => state.restoreError)
  const [error, setError] = useState<string | null>(null)
  const theme = useOpenUiTheme(value => value)
  const locale = useOpenUiLocale(value => value)
  const openUi = useMemo<AssistantOpenUi>(() => ({
    identity: `${encodeURIComponent(sessionId)}:panel`, theme, locale,
    send: sendOpenUiAction, readState: readOpenUiState, saveState: saveOpenUiState,
  }), [sessionId, theme, locale, sendOpenUiAction, readOpenUiState, saveOpenUiState])
  const program = useMemo(() => snapshot === null ? '' : JSON.stringify(snapshot), [snapshot])
  const change = (callback: () => void): void => {
    try { callback(); setError(null) }
    catch (cause: unknown) { setError(`${t('openui.stateFailed')} ${cause instanceof Error ? cause.message : String(cause)}`) }
  }
  if (snapshot === null && restoreError === null && error === null) return null
  return <section className={css.root} aria-label={t('openui.panel')}>
    <header className={css.toolbar}>
      <span className={css.title}>{typeof snapshot?.title === 'string' ? snapshot.title : t('openui.panel')}</span>
      {snapshot !== null && <div className={css.controls}>
        <Button size="sm" onClick={() => change(() => { actions.collapse(!collapsed) })} aria-expanded={!collapsed}>
          {t(collapsed ? 'openui.expand' : 'openui.collapse')}
        </Button>
        <Button size="sm" onClick={() => change(actions.clear)}>{t('openui.clear')}</Button>
      </div>}
    </header>
    {(error ?? restoreError) !== null && <div className={css.error} role="alert">{error ?? restoreError}</div>}
    {snapshot !== null && <div hidden={collapsed}>
      <OpenUiFrame key={openUi.identity} instanceId={`${openUi.identity}:document`} language="dsh-ui" panel
        program={program} streaming={false} openUi={openUi} t={t} />
    </div>}
  </section>
}
