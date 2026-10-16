import { memo, useCallback, useMemo } from 'react'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { ChatNodeViewProps, PresentationInjected, TurnTailOwnerProps } from '../contract/slots.ts'
import { AssistantMarkdown } from './AssistantMarkdown.tsx'
import type { AssistantOpenUi, OpenUiInjected } from './openui.ts'

type AssistantNodeViewProps = ChatNodeViewProps<'assistant-step'> & InjectFace<PresentationInjected & OpenUiInjected>

/** Streaming, settled, and interrupted Assistant states share one keyed renderer instance. */
export const AssistantNodeView = memo(function AssistantNodeView({
  node, sessionId, groupPart, useDisclosure, useTurnData, turnProcess, openFile, renderMessageImages, fileMentions, usePresentation,
  useOpenUiTheme, sendOpenUiAction, readOpenUiState, saveOpenUiState, t,
}: AssistantNodeViewProps) {
  const data = node.data
  const theme = useOpenUiTheme(value => value)
  const openUi = useMemo<AssistantOpenUi>(() => ({
    identity: `${encodeURIComponent(sessionId)}:${encodeURIComponent(node.id)}`,
    theme,
    send: sendOpenUiAction,
    readState: readOpenUiState,
    saveState: saveOpenUiState,
  }), [sessionId, node.id, theme, sendOpenUiAction, readOpenUiState, saveOpenUiState])
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
      renderMessageImages={renderMessageImages}
      reasoningHidden={reasoningHidden}
      usePresentation={usePresentation}
      revealProcess={revealProcess}
      mentions={mentions}
      openUi={openUi}
      t={t}
    />
  )
})
