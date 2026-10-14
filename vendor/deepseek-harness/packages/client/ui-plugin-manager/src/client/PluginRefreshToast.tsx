/** Refresh failure feedback hosted outside the Plugins panel's lifetime. */
import type { ReactNode } from 'react'
import { IconWarningOutlineRegular, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { PluginManagerFace } from './manager-store.ts'
import { noticeText } from './presentation.ts'

/** The controller's shared notice source and dismissal action. */
export type PluginRefreshToastFace = Pick<PluginManagerFace, 'dismissNotice' | 'refresh'> & {
  hooks: Pick<PluginManagerFace['hooks'], 'pluginManager'>
}

/** Render inputs bound from the shared controller and plugin dictionary. */
export type PluginRefreshToastProps = InjectFace<PluginRefreshToastFace> & PropsLocale<'pluginManager'>

/**
 * Display refresh failures even after navigation leaves the Plugins panel.
 * @param props - shared notice hook, dismissal action, and locale seat.
 * @returns the refresh failure toast, or null for other notices.
 */
export function PluginRefreshToast({ usePluginManager, dismissNotice, refresh, t }: PluginRefreshToastProps): ReactNode {
  const notice = usePluginManager(state => state.notice)
  if (notice?.kind !== 'refresh-failed') return null
  return (
    <Toast
      key={notice.seq}
      text={noticeText(notice, t)}
      icon={<IconWarningOutlineRegular />}
      holdMs={null}
      dismissLabel={t('close')}
      actions={[{ label: t('retry'), onClick: refresh }]}
      onDone={dismissNotice}
    />
  )
}
