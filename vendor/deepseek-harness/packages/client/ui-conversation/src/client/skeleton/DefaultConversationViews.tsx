import { useEffect } from 'react'
import type { ConversationSessionSlotProps } from '../contract/slots.ts'
import { conversationPhase } from '../contract/snapshot.ts'
import { resolveActiveView } from '../view-selection.ts'
import css from './ConversationRoot.module.css'

/**
 * Renders the active Session view inside the resident scrollport and keeps
 * the input draft persisted while blank Hero chrome is visible.
 * @param props - Strict Session input/store, view ledger, and render shares.
 * @returns the active view area, or null while the Session remains blank.
 */
export function DefaultConversationViews({
  view, useSession, useSessions, useConversation, useConversationViews, inputActions, useStore, actions,
  renderSlot, renderSlotChain, bindDraftPersistence, openView, sessionId, useInspectCall,
}: ConversationSessionSlotProps) {
  const tabs = useConversationViews(value => value)
  const inspectCall = useInspectCall(value => value)
  const selectedId = useStore(s => s.view)
  const session = useSession(s => s)
  const presentation = useSessions(s => s.byId[sessionId]?.presentation)
  const managed = presentation?.composer === 'managed'
  const active = resolveActiveView(tabs, managed ? null : selectedId)
  const conversation = useConversation(s => s)
  const viewRequest = useStore(s => s.viewRequest ?? null)

  useEffect(() => {
    const unbindDraftPersistence = bindDraftPersistence(actions.setDraft)
    inputActions.persistDraft()
    return () => { unbindDraftPersistence() }
    // The Session input owns content before this persistence writer is attached.
  }, [inputActions])

  if (presentation === undefined
    && session.blank
    && conversationPhase(session, conversation) === 'blank') return null
  const viewId = view ?? active?.id
  const resident = viewId !== undefined
    ? renderSlot('conversation.view', {
      inspectCall,
      viewRequest,
      openView,
      completeViewRequest: actions.completeViewRequest,
    }, { only: viewId })
    : null
  return (
    <div className={css.viewArea}>
      {renderSlotChain('conversation.session.body', { sessionId, session, presentation }, { fallback: resident })}
    </div>
  )
}
