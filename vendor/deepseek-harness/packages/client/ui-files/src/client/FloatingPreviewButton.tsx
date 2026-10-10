import { useState, type ReactNode } from 'react'
import {
  IconRightUpOutline16,
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
    ? state.byId[address.sessionId as SessionId]?.cwd
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
    setError(undefined)
    try {
      const result = await open(target.request)
      if (!floatingPreviewSucceeded(result)) {
        setError(t('preview.floating.failed'))
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
        <button
          type="button"
          className={css.iconButton}
          aria-label={label}
          data-floating-preview
          disabled={!shape.ok || pending}
          onClick={() => { void activate(shape) }}
        >
          <IconRightUpOutline16 size={14} />
        </button>
      </Tooltip>
      {error !== undefined ? <span className={css.saveError} role="alert">{error}</span> : null}
    </>
  )
}
