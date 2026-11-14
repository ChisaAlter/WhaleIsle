import { memo, useCallback, useMemo } from 'react'
import type { InjectFace, PropsRenderSlots, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { ChatFileMentions, ChatNodeViewProps, PresentationInjected, TurnTailOwnerProps } from '../contract/slots.ts'
import { AssistantMarkdown } from './AssistantMarkdown.tsx'
import type { AssistantOpenUi, OpenUiInjected } from './openui.ts'
import type { createWhaleUiStore } from './whale-ui-store.ts'

/** Business readers owned by the assistant renderer's existing Slot registration. */
export type AssistantNodeInjected = PresentationInjected & OpenUiInjected & {
  /** Resolve against the live Session directory. @param path - Recorded path. @returns Host path. */
  resolveFilePath: (path: string) => string
  /** Resolve closing-Turn mentions with the supplied ordinary file gesture callback. */
  fileMentions: (owner: TurnTailOwnerProps, getFileTriggerProps: NonNullable<Parameters<ChatFileMentions['forClosing']>[2]>) => ReturnType<ChatFileMentions['forClosing']>
}

type AssistantNodeViewProps = ChatNodeViewProps<'assistant-step'> & InjectFace<AssistantNodeInjected>
  & PropsRenderSlots<'conversation.chat.reasoning.body' | 'conversation.chat.message.images'>
  & PropsStore<ReturnType<typeof createWhaleUiStore>>

/** Streaming, settled, and interrupted Assistant states share one keyed renderer instance. */
export const AssistantNodeView = memo(function AssistantNodeView({
  node, groupPart, useDisclosure, useGroupAction, useTurnData, turnProcess, openFile, loadImage, fileMentions,
  usePresentation, renderSlot, t, sessionId, useContextMenu, resolveFilePath,
  useOpenUiTheme, useOpenUiLocale, sendOpenUiAction, readOpenUiState, saveOpenUiState, actions,
}: AssistantNodeViewProps) {
  const { getTriggerProps } = useContextMenu()
  const getFileTriggerProps = useCallback((path: string) => getTriggerProps(() => ({
    kind: 'file', value: { sessionId, path: resolveFilePath(path) },
  })), [getTriggerProps, sessionId, resolveFilePath])
  const data = node.data
  const theme = useOpenUiTheme(value => value)
  const locale = useOpenUiLocale(value => value)
  const seq = data.finalNode?.seq ?? node.anchorSeq
  const openUi = useMemo<AssistantOpenUi>(() => ({
    identity: `${encodeURIComponent(sessionId)}:${encodeURIComponent(node.id)}`,
    theme,
    locale,
    seq,
    send: sendOpenUiAction,
    readState: readOpenUiState,
    saveState: saveOpenUiState,
    publishPanel: actions.publish,
  }), [sessionId, node.id, theme, locale, seq, sendOpenUiAction, readOpenUiState, saveOpenUiState, actions.publish])
  const turn = node.location.kind === 'turn' || node.location.kind === 'step'
    ? node.location.turn
    : undefined
  const tail = useTurnData('turn-tail')
  const owner = useMemo<TurnTailOwnerProps | undefined>(() => {
    if (turn?.status !== 'closed' || data.finalNode === undefined) return undefined
    if (tail?.closing?.finalNode.seq !== data.finalNode.seq) return undefined
    return { turn, seq: data.finalNode.seq, openFile }
  }, [data.finalNode, openFile, tail, turn])
  const mentions = useMemo(
    () => owner === undefined ? undefined : fileMentions(owner, getFileTriggerProps),
    [fileMentions, owner, getFileTriggerProps],
  )
  const keepReplies = usePresentation(policy => policy.foldedReplies === 'all')
  // A kept reply row stays visible while the folded Turn hides its inline reasoning.
  const reasoningHidden = turnProcess !== undefined
    && turnProcess.foldable
    && (keepReplies
      ? groupPart !== 'reasoning'
      : turnProcess.spec.answerStep === data.step && turnProcess.spec.inlineReasoning)
    && !turnProcess.open
  const revealProcess = useCallback(() => { turnProcess?.setOpen(true) }, [turnProcess])
  return (
    <AssistantMarkdown
      blocks={data.blocks}
      groupPart={groupPart}
      useDisclosure={useDisclosure}
      streaming={data.status === 'running'}
      textInteractionSource={data.status === 'settled' && data.finalNode?.messageId !== undefined}
      interrupted={data.status === 'interrupted'}
      loadImage={loadImage}
      reasoningHidden={reasoningHidden}
      useGroupAction={useGroupAction}
      usePresentation={usePresentation}
      renderSlot={renderSlot}
      revealProcess={revealProcess}
      mentions={mentions}
      openUi={openUi}
      t={t}
    />
  )
})
