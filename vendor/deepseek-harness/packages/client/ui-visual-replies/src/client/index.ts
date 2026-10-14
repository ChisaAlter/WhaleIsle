/** Browser entry for opt-in, durable visual replies. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SessionIdOf } from '@deepseek-ai/dsh-client-ui-slots'
import { VisualReplyLoadError, type VisualReplyInjected } from './PublishedPage.tsx'
import { VisualReplyNode } from './VisualReplyNode.tsx'
import { VisualReplyPage } from './VisualReplyPage.tsx'
import { visualReplyDefinition } from './visual-reply-node.ts'
import { installVisualRepliesSettings } from './settings.ts'
import { NS, zh, en } from './locale.ts'

export type { VisualReplyPageProps } from './VisualReplyPage.tsx'

export const inject = ['slots', 'locale', 'configForms', 'remote', 'remote.session', 'theme', 'uiConversation']

export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'visual-replies: copy')
  installVisualRepliesSettings(ctx)
  const theme = {
    getSnapshot: () => ctx.theme.getTheme(),
    subscribe: (listener: () => void) => ctx.on('theme/change', listener),
  }
  const interactive = (window as Window & {
    readonly shell?: { readonly visualReplyIsolation?: boolean }
  }).shell?.visualReplyIsolation === true
  const loadSessionPage = async (sessionId: SessionIdOf, attachmentId: Parameters<VisualReplyInjected['loadPage']>[0], signal: AbortSignal): Promise<string> => {
    const result = await ctx.remote.session.readVisualReply({ sessionId, attachmentId }, signal)
    if (!result.ok) throw new VisualReplyLoadError(result.error)
    return result.value.html
  }
  const injectPage = (sessionId: SessionIdOf): VisualReplyInjected => ({
    interactive,
    hooks: { theme },
    loadPage: async (attachmentId, signal) => {
      return loadSessionPage(sessionId, attachmentId, signal)
    },
  })
  ctx.slots.registerFactory({
    name: 'visual-reply.page', scope: 'root', locale: NS,
    inject: () => ({ interactive, hooks: { theme }, loadSessionPage }),
  }, VisualReplyPage)
  const match = visualReplyDefinition.match.bind(visualReplyDefinition)
  ctx.uiConversation.events.register({
    ...visualReplyDefinition,
    match: { 'tool/result': match, 'tool/ptc-dispatch': match },
  })
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node', key: 'visual-reply', locale: NS,
    inject: injectPage,
  }, VisualReplyNode))
}
