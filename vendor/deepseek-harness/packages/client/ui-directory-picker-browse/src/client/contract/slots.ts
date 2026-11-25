/**
 * Remote-workspace child holes the browse picker's flow entries declare:
 * one inside each directoryFlow hole, so an SSH remote-workspace plugin can
 * mount a remote pane inside the same Select Workspace Directory dialog —
 * reachable through the dialog's local/remote tab strip instead of
 * competing for the local flow's single-kind seat. A plugin occupying a
 * remote hole registers one component into both keys, the same shape the
 * local browse flow uses for the two directoryFlow holes.
 */
import type {} from '@deepseek-ai/dsh-client-ui-slots'

/**
 * Owner share passed to a remote-flow occupant through the dialog's
 * renderSlot call site. The pick outcome is a LOCAL path — the occupant's
 * mirror workspace under `$DSH_HOME/remote-workspaces` — so the owner's
 * workspace-adoption path needs no remote awareness.
 */
export interface RemoteFlowOwnerProps {
  /** True while the picking dialog is open; flipping back withdraws the request. */
  open: boolean
  /** True while the remote tab is the visible pane; a hidden pane keeps state but must not act. */
  active: boolean
  /** True while the owner adopts a picked path; commit affordances disable. */
  busy: boolean
  /** The operator picked a workspace directory (the remote mirror's local path); the owner adopts it. */
  onPicked: (path: string) => void
  /** The operator dismissed the whole interaction; the owner just closes the flow. */
  onCancel: () => void
  /** The interaction itself failed (connect refused, listing denied); the owner shows its error surface. */
  onError: (message: string) => void
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** Remote-workspace hole inside the hero picker's directory dialog (declared by the hero flow entry). */
    'conversation.hero.workspace.directoryFlow.remote': { kind: 'single'; scope: 'root'; owner: RemoteFlowOwnerProps }
    /** Remote-workspace hole inside the sidebar browser's directory dialog (declared by the sidebar flow entry). */
    'sidebar.workspaces.directoryFlow.remote': { kind: 'single'; scope: 'root'; owner: RemoteFlowOwnerProps }
    /** Remote-workspace hole inside the shared workspace picker's directory dialog (declared by the picker flow entry). */
    'workspace.picker.directoryFlow.remote': { kind: 'single'; scope: 'root'; owner: RemoteFlowOwnerProps }
  }
}

/** The three remote-flow holes; a remote workspace plugin registers one component into the holes it serves. */
export type RemoteFlowSlotName =
  | 'conversation.hero.workspace.directoryFlow.remote'
  | 'sidebar.workspaces.directoryFlow.remote'
  | 'workspace.picker.directoryFlow.remote'
