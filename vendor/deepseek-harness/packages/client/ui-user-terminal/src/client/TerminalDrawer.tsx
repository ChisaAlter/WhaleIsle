import { type ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import { NS } from './locales.ts'
import type { TerminalShellInjected } from './shell.ts'
import type { createTerminalSessionStore } from './stores.ts'
import { TerminalWorkspace } from './TerminalWorkspace.tsx'

export type { TerminalShellInjected }

export type TerminalDrawerProps =
  & PropsRuntime<'shell.terminalDrawer'>
  & PropsStore<ReturnType<typeof createTerminalSessionStore>>
  & PropsLocale<typeof NS>
  & InjectFace<TerminalShellInjected>

/**
 * Bottom-drawer occupant of `shell.terminalDrawer`.
 * @param props - session-maybe seats, this shell's store, PTY IPC, and layout writes.
 * @returns the drawer chrome, or an empty unavailable state before a session exists.
 */
export function TerminalDrawer(props: TerminalDrawerProps): ReactNode {
  return (
    <TerminalWorkspace
      mode="drawer"
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
