import type { Context } from '@deepseek-ai/cordis'
import { createSnapshotStore, type ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { ThemeSnapshot } from '@deepseek-ai/dsh-client-ui-theme/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { PerformanceUsageMode } from '../../chat-settings.ts'
import type { ChatPresentationPolicy } from '../presentation-policy.ts'
import { NS } from '../locale.ts'
import { AssistantNodeView } from './AssistantNodeView.tsx'
import { CommandNodeView, ManualCompactionNodeView } from './CommandNodeView.tsx'
import {
  CompactionNodeView, ContextMessageNodeView, RetryNodeView, TurnErrorNodeView,
  TurnMaxTokensNodeView, UnknownNodeView, SteeringMessageNodeView, UserMessageNodeView,
} from './MessageItem.tsx'
import { DefaultReasoningBody, ReasoningContent } from './ReasoningContent.tsx'
import { SystemPromptNodeView } from './SystemPromptRow.tsx'
import { TurnProcessNodeView } from './TurnProcessNodeView.tsx'
import { TurnTailNodeView } from './TurnTailNodeView.tsx'
import { TurnTriggerNodeView } from './TurnTriggerNodeView.tsx'
import { openUiActionText, readOpenUiState, saveOpenUiState, type OpenUiInjected } from './openui.ts'
import { createWhaleUiStore } from './whale-ui-store.ts'
import { WhaleUiPanel } from './WhaleUiPanel.tsx'
import { WhaleUiToolView } from './WhaleUiPanelToolView.tsx'

/**
 * Register this package's business renderers behind the keyed Chat Node seat.
 * Renderers whose output depends on the work-details mode receive the policy
 * through their own registration; the seat and the other renderers do not.
 * @param ctx - owning UI Conversation context.
 * @param performanceUsage - live statistics detail preference.
 * @param presentation - live presentation policy.
 */
export function registerChatNodeRenderers(
  ctx: Context,
  performanceUsage: ObservableSnapshot<PerformanceUsageMode>,
  presentation: ObservableSnapshot<ChatPresentationPolicy>,
): void {
  ctx.effect(() => ctx.slots.registerFactory({
    name: 'conversation.chat.reasoning.content',
    scope: 'root',
    locale: NS,
  }, ReasoningContent))
  ctx.slots.inject('conversation.chat.reasoning.body', () => ctx.slots.register({
    name: 'conversation.chat.reasoning.body',
    priority: 100,
  }, DefaultReasoningBody))
  const openUiTheme = createSnapshotStore<ThemeSnapshot | null>(null)
  ctx.inject(['theme'], (child) => {
    openUiTheme.set(child.theme.getTheme())
    child.on('theme/change', snapshot => { openUiTheme.set(snapshot) })
  })
  const openUiLocale = createSnapshotStore<'zh' | 'en'>(ctx.locale.getLocale().active.startsWith('zh') ? 'zh' : 'en')
  ctx.on('locale/change', snapshot => { openUiLocale.set(snapshot.active.startsWith('zh') ? 'zh' : 'en') })
  const whaleUiStore = createWhaleUiStore()
  const injectWhaleUi = (sessionId: SessionId): OpenUiInjected => {
    const binding = ctx.sessions.binding(sessionId)
    if (binding === undefined) throw new Error('The Whale UI conversation is no longer available.')
    return {
      hooks: { openUiTheme, openUiLocale },
      readOpenUiState,
      saveOpenUiState,
      sendOpenUiAction: async (action) => {
        if (ctx.sessions.binding(sessionId) !== binding) return { ok: false, error: 'The Whale UI conversation is no longer available.' }
        const result = await binding.session.prompt([{ type: 'text', text: openUiActionText(action) }], 'queue')
        return result.ok ? { ok: true } : { ok: false, error: result.error.message }
      },
    }
  }
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'whale-ui',
    order: 30,
    locale: NS,
    store: whaleUiStore,
    inject: injectWhaleUi,
  }, WhaleUiPanel))
  ctx.slots.inject('tool.call.whale-ui', () => ctx.slots.register({
    name: 'tool.call.whale-ui',
    locale: NS,
    store: whaleUiStore,
    inject: injectWhaleUi,
  }, WhaleUiToolView))
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node',
    key: 'user',
    locale: NS,
    children: {
      'conversation.chat.user-actions': { kind: 'list', scope: 'session' },
      'conversation.chat.user-editor': { kind: 'single', scope: 'session' },
    },
  }, UserMessageNodeView))
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register(
    { name: 'conversation.chat.node', key: 'steering', locale: NS }, SteeringMessageNodeView))
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register(
    { name: 'conversation.chat.node', key: 'context', locale: NS }, ContextMessageNodeView))
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register(
    { name: 'conversation.chat.node', key: 'turn-trigger', locale: NS }, TurnTriggerNodeView))
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register(
    { name: 'conversation.chat.node', key: 'system-prompt', locale: NS }, SystemPromptNodeView))
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node',
    key: 'assistant-step',
    locale: NS,
    children: {
      'conversation.chat.reasoning.body': { kind: 'single', scope: 'session' },
      'conversation.chat.message.images': { kind: 'single', scope: 'session' },
    },
    store: whaleUiStore,
    inject: (sessionId): OpenUiInjected & { hooks: { presentation: typeof presentation } } => ({
      ...injectWhaleUi(sessionId),
      hooks: { presentation, openUiTheme, openUiLocale },
    }),
  }, AssistantNodeView))
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node',
    key: 'command',
    locale: NS,
    children: { 'conversation.chat.commandview': { kind: 'keyed', scope: 'session' } },
  }, CommandNodeView))
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register(
    { name: 'conversation.chat.node', key: 'manual-compaction', locale: NS }, ManualCompactionNodeView))
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register(
    { name: 'conversation.chat.node', key: 'compaction', locale: NS }, CompactionNodeView))
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register(
    { name: 'conversation.chat.node', key: 'model-retry', locale: NS }, RetryNodeView))
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register(
    { name: 'conversation.chat.node', key: 'turn-error', locale: NS }, TurnErrorNodeView))
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register(
    { name: 'conversation.chat.node', key: 'turn-max-tokens', locale: NS }, TurnMaxTokensNodeView))
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register(
    { name: 'conversation.chat.node', key: 'turn-process', locale: NS }, TurnProcessNodeView))
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node',
    key: 'turn-tail',
    locale: NS,
    inject: () => ({ hooks: { performanceUsage } }),
    children: {
      'conversation.chat.turnTail': { kind: 'list', scope: 'session' },
      'conversation.chat.assistant-actions': { kind: 'list', scope: 'session' },
    },
  }, TurnTailNodeView))
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register(
    { name: 'conversation.chat.node', key: 'unknown', locale: NS }, UnknownNodeView))
}
