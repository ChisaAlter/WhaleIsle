/**
 * Append a diff line comment into the current session composer draft.
 *
 * Uses the same structural context contract as `ui-files/src/client/draft.ts`
 * so `ui-diff` never takes a value dependency on `ui-conversation`.
 */
import type { Context } from '@deepseek-ai/cordis'

/** Structural conversation face; ui-diff must not value-import ui-conversation. */
interface ConversationDraftFace {
  input: {
    for: (actx: unknown) => {
      setDraft: (text: string) => void
      state: { getSnapshot: () => { draft: string } }
    }
  }
}

/** Session list face used only to resolve composer scope; optional on session-maybe fibers. */
interface SessionsDraftFace {
  scope: (sessionId: never) => unknown
}

/**
 * Append `text` to the session composer, preserving separation when a draft
 * already exists. Missing conversation or session scope is a no-op.
 * @param ctx - client root context.
 * @param sessionId - session whose composer to write.
 * @param text - formatted diff comment fragment.
 * @returns true when a draft write happened.
 */
export function appendToDraft(ctx: Context, sessionId: string, text: string): boolean {
  const conversation = ctx.get('conversation') as ConversationDraftFace | undefined
  if (conversation === undefined) return false
  const sessions = ctx.get('sessions') as SessionsDraftFace | undefined
  if (sessions === undefined) return false
  const scope = sessions.scope(sessionId as never)
  if (scope === undefined) return false
  const input = conversation.input.for(scope)
  const current = input.state.getSnapshot().draft
  const separator = current.length === 0
    ? ''
    : current.endsWith('\n')
      ? ''
      : text.includes('\n')
        ? '\n\n'
        : ' '
  input.setDraft(`${current}${separator}${text}`)
  return true
}
