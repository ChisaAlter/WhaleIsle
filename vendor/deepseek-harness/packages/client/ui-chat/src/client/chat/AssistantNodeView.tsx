import { memo, useCallback, useMemo } from 'react'
import type { InjectFace, PropsRenderSlots, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { ChatNodeViewProps, PresentationInjected, TurnTailOwnerProps } from '../contract/slots.ts'
import { AssistantMarkdown } from './AssistantMarkdown.tsx'
import type { AssistantOpenUi, OpenUiInjected } from './openui.ts'
import type { createWhaleUiStore } from './whale-ui-store.ts'

type AssistantNodeViewProps = ChatNodeViewProps<'assistant-step'> & InjectFace<PresentationInjected & OpenUiInjected>
  & PropsRenderSlots<'conversation.chat.reasoning.body' | 'conversation.chat.message.images'>
  & PropsStore<ReturnType<typeof createWhaleUiStore>>

/** Streaming, settled, and interrupted Assistant states share one keyed renderer instance. */
export const AssistantNodeView = memo(function AssistantNodeView({
  node, sessionId, groupPart, useDisclosure, useGroupAction, useTurnData, turnProcess, openFile, loadImage, fileMentions,
  usePresentation, renderSlot, t,
  useOpenUiTheme, useOpenUiLocale, sendOpenUiAction, readOpenUiState, saveOpenUiState, actions,
}: AssistantNodeViewProps) {
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
    () => owner === undefined ? undefined : fileMentions(owner),
    [fileMentions, owner],
  )
  const reasoningHidden = turnProcess !== undefined
    && turnProcess.foldable
    && turnProcess.spec.answerStep === data.step
    && turnProcess.spec.inlineReasoning
    && !turnProcess.open
  const revealProcess = useCallback(() => { turnProcess?.setOpen(true) }, [turnProcess])
  return (
    <AssistantMarkdown
      blocks={data.blocks}
      groupPart={groupPart}
      useDisclosure={useDisclosure}
      streaming={data.status === 'running'}
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
