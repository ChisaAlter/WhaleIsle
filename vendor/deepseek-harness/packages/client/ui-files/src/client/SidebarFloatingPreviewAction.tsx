import type { ReactNode } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/client'
import { FloatingPreviewButton } from './FloatingPreviewButton.tsx'
import { NS } from './locales.ts'

type SidebarFloatingPreviewActionProps =
  & PropsRuntime<'sidebar.right.tab.document.actions'>
  & PropsLocale<typeof NS>

/** The Desktop floating-preview control contributed to the native document toolbar. */
export function SidebarFloatingPreviewAction({
  resourceAddress,
  useSessions,
  t,
}: SidebarFloatingPreviewActionProps): ReactNode {
  return (
    <FloatingPreviewButton
      resourceAddress={resourceAddress}
      useSessions={useSessions}
      t={t}
    />
  )
}
