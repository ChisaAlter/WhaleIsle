/** Direct conversation presentation for a published visual reply. */
import type { PropsRuntime, PropsLocale, InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from './visual-reply-node.ts'
import { PublishedPage, type VisualReplyInjected } from './PublishedPage.tsx'

type NodeProps = PropsRuntime<'conversation.chat.node', 'visual-reply'>
  & PropsLocale<'visual-replies'> & InjectFace<VisualReplyInjected>

/** Render only the page itself; surrounding tool details retain their own disclosure. */
export function VisualReplyNode({ node, interactive, loadPage, useTheme, t }: NodeProps) {
  return <PublishedPage key={node.data.file.attachmentId} model={node.data}
    interactive={interactive} loadPage={loadPage} useTheme={useTheme} t={t} />
}
