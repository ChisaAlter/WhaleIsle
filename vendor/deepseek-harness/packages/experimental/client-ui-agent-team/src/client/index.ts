/** Browser entry registering the Agent Teams conversation-header action and Sidebar page. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { registerAgentTeamUi } from './mount.ts'

export { TeamAction, TeamBody } from './TeamAction.tsx'
export { TeamSidebar } from './TeamSidebar.tsx'
export { en as teamEnglish, zh as teamChinese } from './locales.ts'
export { inject, TEAM_SIDEBAR_ID, TEAM_SIDEBAR_KIND } from './mount.ts'
export type { TeamActionInjected, TeamActionProps, TeamBodyProps, TeamTaskScopesProps } from './TeamAction.tsx'
export type { TeamTaskScopeMap, TeamTaskScopes } from './mount.ts'
export type { TeamSidebarProps } from './TeamSidebar.tsx'
export type { TeamKey } from './locales.ts'

/**
 * Register the Team locale dictionaries and header action on the Client Context.
 * @param ctx - Client Context with the declared `inject` services available.
 */
export function apply(ctx: ClientContext): void {
  registerAgentTeamUi(ctx)
}
