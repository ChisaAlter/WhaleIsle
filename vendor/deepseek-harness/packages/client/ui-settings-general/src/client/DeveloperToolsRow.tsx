/** General Settings control for shared developer-tool visibility and previews. */
import { useRef, useState } from 'react'
import { Switch, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './DeveloperToolsRow.module.css'

/** Accepted setting and ordered mutation supplied by the settings owner. */
export interface DeveloperToolsRowInjected {
  hooks: { developerTools: ObservableSnapshot<boolean> }
  setEnabled(enabled: boolean): Promise<void>
}

/**
 * Render the developer-tool toggle.
 * @param props - accepted preference, writer and localized copy.
 * @returns the General Settings row.
 */
export function DeveloperToolsRow({ useDeveloperTools, setEnabled, t }:
  PropsRuntime<'settings.general.item'> & PropsLocale<'settings'> & InjectFace<DeveloperToolsRowInjected>) {
  const enabled = useDeveloperTools(value => value)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [notice, setNotice] = useState<{ id: number; text: string } | null>(null)
  const noticeId = useRef(0)
  return <div className={css.row}>
    <div>
      <div className={css.title}>{t('developerTools.title')}</div>
      <div className={css.description}>{t('developerTools.description')}</div>
    </div>
    <Switch checked={enabled} disabled={busy} loading={busy} label={t('developerTools.title')}
      title={failed ? t('developerTools.error') : undefined}
      onChange={(next: boolean) => {
        setFailed(false)
        setNotice(null)
        setBusy(true)
        void setEnabled(next).catch(() => {
          setFailed(true)
          setNotice({ id: ++noticeId.current, text: t('developerTools.error') })
        }).finally(() => { setBusy(false) })
      }} />
    {notice !== null && <Toast key={notice.id} text={notice.text} onDone={() => { setNotice(null) }} />}
  </div>
}
