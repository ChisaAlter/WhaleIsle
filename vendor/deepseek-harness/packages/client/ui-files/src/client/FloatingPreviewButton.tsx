import { useState, type ReactNode } from 'react'
import {
  Button,
  IconRightUpOutline16,
  IconWarningOutline16,
  Toast,
  Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import {
  floatingPreviewSucceeded,
  floatingPreviewTarget,
  readFloatingPreviewShell,
  type FloatingPreviewTarget,
} from './floating-preview.ts'
import { NS } from './locales.ts'
import css from './FilePreview.module.css'
import { parseFileAddress } from '@deepseek-ai/dsh-util-workspace-path'
import type { UseSessions } from '@deepseek-ai/dsh-client-ui-session/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { sessionWorkingDirectory } from '@deepseek-ai/dsh-api-session-controller/types'

type FloatingPreviewButtonProps =
  & PropsLocale<typeof NS>
  & {
    readonly resourceAddress: string
    readonly useSessions: UseSessions
  }

/**
 * Native read-only, always-on-top desktop viewer for a saved workspace file.
 * This is intentionally distinct from DockKit's in-page floating panel.
 */
export function FloatingPreviewButton({
  resourceAddress,
  useSessions,
  t,
}: FloatingPreviewButtonProps): ReactNode {
  const address = parseFileAddress(resourceAddress)
  const cwd = useSessions(state => address?.scope === 'session'
    ? sessionWorkingDirectory(state.byId[address.sessionId as SessionId])
    : undefined)
  const shape = floatingPreviewTarget(resourceAddress, cwd)
  const shell = readFloatingPreviewShell()
  const open = shell?.previewOpenFileWindow
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  if (typeof open !== 'function') return null

  const label = t('preview.floating')
  const title = shape.ok ? t('preview.floating.description') : t('preview.floating.noCwd')

  const activate = async (target: FloatingPreviewTarget): Promise<void> => {
    if (!target.ok || pending) return
    setPending(true)
    try {
      const result = await open(target.request)
      if (!floatingPreviewSucceeded(result)) {
        setError(t('preview.floating.failed'))
      } else {
        setError(undefined)
      }
    } catch {
      setError(t('preview.floating.failed'))
    } finally {
      setPending(false)
    }
  }

  return (
    <>
      <Tooltip label={title} side="bottom">
        <Button
          variant="ghost"
          size="sm"
          type="button"
          className={css.iconButton}
          aria-label={label}
          data-floating-preview
          disabled={!shape.ok || pending}
          loading={pending}
          onClick={() => { void activate(shape) }}
        >
          <IconRightUpOutline16 size={14} />
        </Button>
      </Tooltip>
      {error !== undefined && <Toast
        text={error} icon={<IconWarningOutline16 />} holdMs={null}
        dismissLabel={t('unsaved.close')}
        {...(shape.ok ? { actions: [{ label, onClick: () => { void activate(shape) } }] } : {})}
        onDone={() => { setError(undefined) }}
      />}
    </>
  )
}
