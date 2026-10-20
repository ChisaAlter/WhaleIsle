/** Present a completed generated interface through its Session-owned renderer. */
import type { Context } from '@deepseek-ai/cordis'
import type { PropsLocale, PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallViewProps } from '../../contract/slots.ts'
import { GenericToolCard } from './GenericToolCard.tsx'
import { CONVERSATION_NS as NS } from '../../locale.ts'

type RenderUiProps = ToolCallViewProps & PropsLocale<'conversation'> & PropsRenderSlots<'tool.call.whale-ui'>
function isWhaleMetadata(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || !('whaleUi' in value)) return false
  const payload = value.whaleUi
  return typeof payload === 'object' && payload !== null && 'version' in payload && payload.version === 1
    && 'language' in payload && ['whale-ui', 'openui', 'openui-lang', 'dsh-ui'].includes(String(payload.language))
    && 'program' in payload && typeof payload.program === 'string'
}
function RenderUiRow(props: RenderUiProps) {
  if (props.phase !== 'result' || props.block.isError || !isWhaleMetadata(props.block.meta)) return <GenericToolCard {...props} />
  return props.renderSlot('tool.call.whale-ui', { callId: props.callId, seq: props.block.seq, metadata: props.block.meta })
}

/** Register the tool card while retaining generic preparation and failed results. */
export const renderUiToolview = {
  name: 'whale-ui-toolview',
  inject: ['slots'],
  apply(ctx: Context): void {
    ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
      name: 'tool.call.toolview', key: 'render_ui', locale: NS,
      children: { 'tool.call.whale-ui': { kind: 'single', scope: 'session' } },
    }, RenderUiRow))
  },
}
