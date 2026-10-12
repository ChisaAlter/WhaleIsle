/**
 * Message edit plugin, browser half: a pencil in the latest user message's
 * action strip that promotes the session's resident composer — the full
 * input, not a lookalike — into an edit session for that bubble. Confirm
 * rides the composer's own submit: the redirected sink re-checks the
 * latest-and-idle preconditions and sends the revision (text and any
 * attached images) within the same Session. Failures return error outcomes, so the composer
 * keeps the draft armed and announces the reason on its own channel. Both
 * entries share one interaction store carrying the focus-return handshake
 * after a bubble-side cancel.
 * @module @deepseek-ai/dsh-client-ui-message-edit/client
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
// Type-only: pulls the ui-chat SlotMap merge (user-actions / user-editor).
import type { SessionInput } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { MessageEditAction } from './MessageEditAction.tsx'
import { MessageEditEditor } from './MessageEditEditor.tsx'
import { createMessageEditStore } from './stores.ts'
import { editKey } from './text.ts'
import type { MessageEditInjected } from './slots.ts'
import { en, zh } from './locales.ts'

export { MessageEditAction } from './MessageEditAction.tsx'
export type { MessageEditActionProps, MessageEditInjected } from './slots.ts'
export type { MessageEditKey } from './locales.ts'

/** Dictionary namespace owned by this plugin. */
const NS = 'messageEdit'

/** Required services: slots, Session bindings, the conversation input face, and locale. */
export const inject = ['slots', 'sessions', 'conversation', 'locale']

/**
 * Client plugin body: the latest-user-message edit action and the composer
 * edit session driving the same-session resend transaction.
 * @param ctx - client root context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-message-edit: dictionaries')

  const t = ctx.locale.bind(NS)

  // One shared handle for both entries: the editor writes the focus-return
  // request on cancel, the pencil consumes it (one instance per session).
  const store = createMessageEditStore()

  /** Resolve one session's input facade, failing loud on a dead scope. */
  const inputFor = (sessionId: SessionId): SessionInput => {
    const scope = ctx.sessions.scope(sessionId)
    if (scope === undefined) throw new Error(`message edit scope unavailable: ${sessionId}`)
    return ctx.conversation.input.for(scope)
  }

  ctx.slots.inject('conversation.chat.user-actions', () => ctx.slots.register({
    name: 'conversation.chat.user-actions',
    id: 'edit',
    order: 10,
    locale: NS,
    store,
  }, MessageEditAction))

  ctx.slots.inject('conversation.chat.user-editor', () => ctx.slots.register({
    name: 'conversation.chat.user-editor',
    locale: NS,
    store,
    inject: (sessionId): MessageEditInjected => ({
      beginEdit: (seq, text) => {
        const input = inputFor(sessionId)
        const started = input.beginEdit({
          key: editKey(seq),
          label: t('editor.banner'),
          seed: text,
          submit: async (revised, attachmentIds, signal) => {
            // Host admission repeats these checks against complete history.
            const binding = ctx.sessions.binding(sessionId)
            if (binding === undefined) return { kind: 'error', text: t('error.generic') }
            if (binding.session.getSnapshot().running) return { kind: 'error', text: t('editor.hint.running') }
            const entries = binding.eventSource.getSnapshot().entries
            let lastUserSeq: number | undefined
            let opening = true
            for (const row of entries) {
              if (row.type !== 'event') continue
              if (row.event.type === 'turn/start') opening = true
              if (row.event.type === 'user/message' && row.event.data.source.kind === 'user' && opening) {
                lastUserSeq = row.event.seq
                opening = false
              }
            }
            if (lastUserSeq !== seq) return { kind: 'error', text: t('editor.hint.stale') }
            try {
              const scope = ctx.sessions.scope(sessionId)
              if (scope === undefined) return { kind: 'error', text: t('error.generic') }
              const conversation = scope.get('conversation')
              if (conversation === undefined) return { kind: 'error', text: t('error.generic') }
              const result = await conversation.edit(seq, revised, attachmentIds, signal)
              return result.kind === 'success' ? result : { kind: 'error', text: result.text ?? t('error.generic') }
            } catch {
              // Admission failure keeps the edit armed with the draft; the
              // localized reason rides the composer's notice channel.
              return { kind: 'error', text: t('error.generic') }
            }
          },
        })
        if (started) input.focus()
        else input.notify('error', t('error.busy'))
        return started
      },
      endEdit: (seq) => {
        const input = inputFor(sessionId)
        if (input.state.getSnapshot().edit?.key === editKey(seq)) input.cancelEdit()
      },
    }),
  }, MessageEditEditor))
}
