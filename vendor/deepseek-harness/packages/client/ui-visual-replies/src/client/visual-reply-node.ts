/** Successful published HTML is reply content, independently of tool activity. */
import type {
  ConversationMatch, ConversationNodeDefinition,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ChatNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-tools/types'
import { visualReplyModel, type VisualReplyModel } from './model.ts'

declare module '@deepseek-ai/dsh-client-ui-chat/client' {
  interface ChatNodeDataMap {
    /** One durable published page, rendered outside tool activity. */
    'visual-reply': VisualReplyModel
  }
}

interface Publication {
  readonly id: string
  readonly model: VisualReplyModel
}

interface VisualReplyState extends Publication {
  readonly seq: number
}

function publication(event: ConversationMatch['event']): Publication | null {
  if (event.type === 'tool/result' && event.surfaceOp === 'append') {
    const message = event.data.message
    const model = visualReplyModel({
      kind: 'tool-result', call: null, content: message.content,
      isError: message.isError === true, meta: event.data.meta,
    })
    return model === null ? null : { id: String(message.source.callId), model }
  }
  if (event.type === 'tool/ptc-dispatch' && event.data.name === 'html_render') {
    const data = event.data
    const model = visualReplyModel({
      kind: 'tool-result', content: data.content, isError: data.isError,
      call: { name: data.name, argsRaw: JSON.stringify(data.arguments) },
    })
    return model === null ? null : { id: String(data.subCallId), model }
  }
  return null
}

function stateOf(match: ConversationMatch): VisualReplyState {
  const value = publication(match.event)
  if (value === null) throw new Error('Visual-reply Context requires a published HTML result')
  return { ...value, seq: match.event.seq }
}

/** Project authoritative successful native/PTC results as independent reply content. */
export const visualReplyDefinition: ConversationNodeDefinition<VisualReplyState> = {
  kind: 'visual-reply', target: 'chat',
  match: event => {
    const value = publication(event)
    return value === null ? null : { id: value.id, role: 'start' }
  },
  start: (_context, match) => stateOf(match),
  update: (_context, match) => stateOf(match),
  buildViewNode: context => {
    const state = context.state
    if (state === undefined) return null
    const location = context.start?.location ?? context.matches[0]?.location ?? { kind: 'unresolved' }
    return {
      key: context.key, id: context.id, kind: 'visual-reply', target: 'chat',
      anchorSeq: state.seq, location, visibility: 'visible', processVisibility: 'independent',
      data: state.model,
    } satisfies ChatNode<'visual-reply'>
  },
}
