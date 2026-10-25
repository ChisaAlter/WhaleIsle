/** Source-safe Agent Teams browser registration. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { createSnapshotStore, type ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import { subagentChatAddress } from '@deepseek-ai/dsh-client-ui-subagent/client'
import { TeamAction, type TeamActionInjected } from './TeamAction.tsx'
import { TeamSidebar } from './TeamSidebar.tsx'
import { en, NS, zh, type TeamKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Agent Teams roster and task-board copy. */
    'agent-team': TeamKey
  }
}

/** Task ids each Lead Session's owner currently considers in scope, by Lead Session id. */
export type TeamTaskScopeMap = Readonly<Record<string, readonly string[]>>

/**
 * Owner-supplied current work for a Lead's Team views. A conversation owner
 * (Project) names the tasks of its current work so the Current view leaves out
 * older members and tasks that are still open in the Team record.
 */
export interface TeamTaskScopes {
  /** Current scopes by Lead Session id. */
  readonly source: ObservableSnapshot<TeamTaskScopeMap>
  /**
   * Replace or clear one Lead's scope.
   * @param leadSessionId - the Lead Session whose Team views read the scope.
   * @param taskIds - current task ids, most relevant first; undefined clears the scope.
   */
  set(leadSessionId: SessionId, taskIds: readonly string[] | undefined): void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Owner-supplied current task scopes for Team views. */
    agentTeamScopes: TeamTaskScopes
  }
}

/** Required browser services for navigation, slots, and localized copy. */
export const inject = ['sessions', 'uiWorkspace', 'slots', 'locale']

/** The Team page's implementation identity, and the key its body registers under. */
export const TEAM_SIDEBAR_ID = '@deepseek-ai/dsh-experimental-client-ui-agent-team'

/** The Team page kind opened through the right Sidebar. */
export const TEAM_SIDEBAR_KIND = 'agent-team'

/**
 * Register the Team locale dictionaries and the conversation-header action.
 * The panel reads the Lead Session's `agentTeam` projection from the shared
 * Session store; this registration performs no Team RPC.
 * @param ctx - Client Context carrying the injected navigation, locale, slot, and Session services.
 */
export function registerAgentTeamUi(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'client-ui-agent-team: dictionaries')
  const scopeStore = createSnapshotStore<TeamTaskScopeMap>({})
  const scopes: TeamTaskScopes = {
    source: scopeStore,
    set(leadSessionId, taskIds) {
      const { [leadSessionId]: _previous, ...rest } = scopeStore.getSnapshot()
      scopeStore.set(taskIds === undefined ? rest : { ...rest, [leadSessionId]: taskIds })
    },
  }
  const disposeScopes = ctx.reflect.provide('agentTeamScopes', scopes)
  ctx.effect(() => () => { void disposeScopes() }, 'client-ui-agent-team: task scopes')
  const scopeHooks = { hooks: { teamTaskScopes: scopeStore } }
  const sessions = ctx.sessions
  const leadSessionId = (sessionId: SessionId): SessionId => {
    const address = sessions.binding(sessionId)?.session.getSnapshot().subagent?.address
    return address?.parentSessionId ?? sessionId
  }

  const actions: TeamActionInjected = {
    openTeammate(sessionId: SessionId, childSessionId: SessionId): void {
      const parentSessionId = leadSessionId(sessionId)
      if ((sessions.retainInfo(sessionId).getSnapshot().retainedBy.mainView ?? 0) === 0) return
      if (childSessionId === parentSessionId) {
        ctx.uiWorkspace.openSession(parentSessionId)
        return
      }
      ctx.uiWorkspace.openSession({
        parentSessionId,
        childSessionId,
        mode: 'continuable',
      })
    },
  }

  ctx.slots.inject(
    'conversation.session.header.actions',
    () => ctx.slots.register({
      name: 'conversation.session.header.actions',
      id: 'agent-team',
      order: -20,
      locale: NS,
      inject: () => ({ ...actions, ...scopeHooks }),
    }, TeamAction),
  )

  // The same Team as a Sidebar page; a member opens beside it in the Sidebar
  // so the conversation and the Team both stay in view.
  ctx.inject(['sidebarRight', 'sidebarRightTabs'], (scope) => {
    const t = ctx.locale.bind(NS)
    scope.effect(() => scope.sidebarRightTabs.register({
      id: TEAM_SIDEBAR_ID, kind: TEAM_SIDEBAR_KIND, priority: 'extension', title: () => t('trigger'),
    }), 'client-ui-agent-team: sidebar type')
    const asideActions: TeamActionInjected = {
      openTeammate(sessionId: SessionId, childSessionId: SessionId): void {
        const parentSessionId = leadSessionId(sessionId)
        if (childSessionId === parentSessionId) {
          ctx.uiWorkspace.openSession(parentSessionId)
          return
        }
        // Same pane as the Team page: a split column is too narrow to read beside the Lead.
        scope.sidebarRight.openResource(subagentChatAddress({ parentSessionId, childSessionId, mode: 'continuable' }), {
          kind: 'subagentchat',
        })
      },
    }
    scope.slots.inject('sidebar.right.pane.tab', () => scope.slots.register({
      name: 'sidebar.right.pane.tab', key: TEAM_SIDEBAR_ID, locale: NS, inject: () => ({ ...asideActions, ...scopeHooks }),
    }, TeamSidebar))
  })
}
