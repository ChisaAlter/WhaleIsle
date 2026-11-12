/** Present a completed generated interface through its Session-owned renderer. */
import { useCallback } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { PropsLocale, PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallViewProps } from '../../contract/slots.ts'
import { toolFileInject, type ToolFileInjected } from '../file-menu.ts'
import { GenericToolCard } from './GenericToolCard.tsx'
import { CONVERSATION_NS as NS } from '../../locale.ts'

type RenderUiProps = ToolCallViewProps & ToolFileInjected & PropsLocale<'conversation'> & PropsRenderSlots<'tool.call.whale-ui'>
function isWhaleMetadata(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || !('whaleUi' in value)) return false
  const payload = value.whaleUi
  return typeof payload === 'object' && payload !== null && 'version' in payload && payload.version === 1
    && 'language' in payload && ['whale-ui', 'openui', 'openui-lang', 'dsh-ui'].includes(String(payload.language))
    && 'program' in payload && typeof payload.program === 'string'
}
function RenderUiRow(props: RenderUiProps) {
  const { getTriggerProps } = props.useContextMenu()
  const { sessionId, resolveFilePath } = props
  const getFileTriggerProps = useCallback((path: string) => getTriggerProps(() => ({
    kind: 'file', value: { sessionId, path: resolveFilePath(path) },
  })), [getTriggerProps, sessionId, resolveFilePath])
  if (props.phase !== 'result' || props.block.isError || !isWhaleMetadata(props.block.meta)) {
    return <GenericToolCard {...props} getFileTriggerProps={getFileTriggerProps} />
  }
  return props.renderSlot('tool.call.whale-ui', { callId: props.callId, seq: props.block.seq, metadata: props.block.meta })
}

/** Register the tool card while retaining generic preparation and failed results. */
export const renderUiToolview = {
  name: 'whale-ui-toolview',
  inject: ['slots', 'sessions'],
  apply(ctx: Context): void {
    ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
      name: 'tool.call.toolview', key: 'render_ui', locale: NS,
      inject: toolFileInject(ctx),
      children: { 'tool.call.whale-ui': { kind: 'single', scope: 'session' } },
    }, RenderUiRow))
  },
}
