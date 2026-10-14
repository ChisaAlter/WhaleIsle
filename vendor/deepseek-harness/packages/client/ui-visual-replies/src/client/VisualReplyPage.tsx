/** Reuse the existing isolated page carrier outside its conversation node. */
import { useMemo } from 'react'
import type { FileAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { FactoryComponentPropsOf, SessionIdOf } from '@deepseek-ai/dsh-client-ui-slots'
import { PublishedPage, type VisualReplyInjected } from './PublishedPage.tsx'
import type { VisualReplyModel } from './model.ts'

export interface VisualReplyPageProps extends VisualReplyModel {
  /** The Session that actually published this attachment. */
  readonly sessionId: SessionIdOf
}

export interface VisualReplyPageInjected extends Omit<VisualReplyInjected, 'loadPage'> {
  readonly loadSessionPage: (sessionId: SessionIdOf, attachmentId: FileAttachmentRef['attachmentId'], signal: AbortSignal) => Promise<string>
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotFactoryMap {
    'visual-reply.page': {
      scope: 'root'
      props: VisualReplyPageProps
      inject: VisualReplyPageInjected
      locale: 'visual-replies'
    }
  }
}

export function VisualReplyPage({ sessionId, file, title, height, interactive, loadSessionPage, useTheme, t }: FactoryComponentPropsOf<'visual-reply.page'>) {
  const loadPage = useMemo(() => (attachmentId: FileAttachmentRef['attachmentId'], signal: AbortSignal) =>
    loadSessionPage(sessionId, attachmentId, signal), [sessionId, loadSessionPage])
  return <PublishedPage key={`${sessionId}:${file.attachmentId}`} model={{ file, title, height }}
    interactive={interactive} loadPage={loadPage} useTheme={useTheme} t={t} />
}
