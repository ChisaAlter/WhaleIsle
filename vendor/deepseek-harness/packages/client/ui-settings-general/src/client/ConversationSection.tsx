/** The Conversation section: how sessions behave — permissions, sending, replies, instructions. */
import type { PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './ConversationSection.module.css'

/** Full component props: section owner share plus item render share. */
export type ConversationSectionComponentProps =
  PropsRuntime<'settings.section'> & PropsRenderSlots<'settings.conversation.item'>

/**
 * Render the Conversation section content column.
 * @param props - composed slot props (contract/slots.ts).
 * @returns the section element tree.
 */
export function ConversationSection({ renderSlot }: ConversationSectionComponentProps) {
  return (
    <div className={css.section}>
      {renderSlot('settings.conversation.item', {})}
    </div>
  )
}
