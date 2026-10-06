/** Open the installed desktop component's existing native settings window. */
import { useEffect, useState } from 'react'
import { Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'

/** Non-secret desktop commands; the management URL stays in the main process. */
export interface WhaleBridgeBridge {
  status: () => Promise<{ installed: boolean }>
  open: () => Promise<{ ok: boolean; error?: string; message?: string }>
}

/** Native settings opener injected by the account feature's desktop registration. */
export interface WhaleBridgeMenuActionInjected {
  openWhaleBridge: WhaleBridgeBridge['open']
}

/** Account-menu action props composed by the settings launcher. */
export type WhaleBridgeMenuActionProps = PropsRuntime<'settings.launcher.action'>
  & PropsLocale<'settings.account'> & InjectFace<WhaleBridgeMenuActionInjected>

/** @param props - native opener and account-menu close operation. @returns failure feedback, or no extra UI. */
export function WhaleBridgeMenuAction({ openWhaleBridge, close, t }: WhaleBridgeMenuActionProps) {
  const [failed, setFailed] = useState<{ error?: string; message?: string } | null>(null)
  useEffect(() => {
    let disposed = false
    void openWhaleBridge().then(result => {
      if (disposed) return
      if (result.ok) close()
      else setFailed(result)
    }).catch(error => {
      if (!disposed) setFailed({ message: error instanceof Error ? error.message : String(error) })
    })
    return () => { disposed = true }
  }, [openWhaleBridge, close])
  if (failed === null) return null
  return <Toast text={failed.message || t(failed.error === 'busy' ? 'whaleBridgeBusy' : 'whaleBridgeOpenFailed')} onDone={close} />
}
