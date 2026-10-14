import type { ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import { NS } from './locales.ts'
import type { TerminalShellInjected } from './shell.ts'
import type { createTerminalSessionStore } from './stores.ts'
import { TerminalWorkspace } from './TerminalWorkspace.tsx'

export type TerminalSurfaceProps =
  & PropsRuntime<'surfaces.terminal'>
  & PropsStore<ReturnType<typeof createTerminalSessionStore>>
  & PropsLocale<typeof NS>
  & InjectFace<TerminalShellInjected>

/**
 * Right-panel Terminal occupant of the `surfaces.terminal` slot ui-surfaces declares.
 * @param props - session-maybe seats, this shell's store, and PTY IPC.
 * @returns the surface chrome, or nothing before a session exists.
 */
export function TerminalSurface(props: TerminalSurfaceProps): ReactNode {
  return (
    <TerminalWorkspace
      mode="surface"
      sessionId={props.sessionId}
      useSessions={props.useSessions}
      useStore={props.useStore}
      actions={props.actions}
      ptyCreate={props.ptyCreate}
      ptyCanCreate={props.ptyCanCreate}
      ptyWrite={props.ptyWrite}
      ptyAck={props.ptyAck}
      ptyResize={props.ptyResize}
      ptyKill={props.ptyKill}
      toggleTerminalDrawer={props.toggleTerminalDrawer}
      setTerminalDrawer={props.setTerminalDrawer}
      mentionTerminal={props.mentionTerminal}
      writeClipboard={props.writeClipboard}
      openWorkspacePath={props.openWorkspacePath}
      openLocalUrl={props.openLocalUrl}
      openExternal={props.openExternal}
      t={props.t}
    />
  )
}
