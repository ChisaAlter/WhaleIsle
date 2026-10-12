/** Session Controller adapter for Agent-scoped file-reference discovery. */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-file-reference'
import type { FileReferenceCandidate } from '@deepseek-ai/dsh-file-reference/types'
import type {} from '@deepseek-ai/dsh-workspace'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host owner of the `fileReferences` Remote namespace. */
    sessionFileReferences: SessionFileReferences
  }
}

/** Host Remote adapter over the composed file-reference provider. */
export class SessionFileReferences extends TypertRemoteService {
  static inject = ['fileReferences', 'typert']

  /** @param ctx - Host context carrying the selected file-reference provider. */
  constructor(ctx: Context) {
    super(ctx, 'sessionFileReferences', { namespace: 'fileReferences' })
  }

  /**
   * List file and directory candidates for one Agent's working directory.
   * @param agent - target Agent resolved from the Session identity on the wire.
   * @param query - path text following `@` or `@"`.
   * @param signal - caller cancellation.
   * @returns deterministic path-only candidates from the composed provider.
   */
  @Remote
  list(
    agent: Agent,
    query: string,
    signal: AbortSignal,
  ): Promise<FileReferenceCandidate[]> {
    const presentation = agent.session.snapshotEvents().findLast(event => event.type === 'session/presentation')
    const workingDirectory = presentation?.type === 'session/presentation' ? presentation.data?.workingDirectory : undefined
    if (workingDirectory === undefined) return this.ctx.fileReferences.list(agent, query, signal)
    // Presentation is a navigation hint. Only a registered, user-selected Workspace may supply this root.
    if (!this.ctx.get('workspaceRegistry') || !this.ctx.workspaceRegistry.list().some(workspace => workspace.path === workingDirectory)) {
      return Promise.resolve([])
    }
    return this.ctx.fileReferences.list(agent, query, signal, workingDirectory)
  }
}

export default SessionFileReferences
