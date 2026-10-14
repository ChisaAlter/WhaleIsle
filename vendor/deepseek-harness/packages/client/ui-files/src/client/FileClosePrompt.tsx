/** Existing unsaved-file confirmation rendered once above all Sidebar tabs. */
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { FileCloseRequest } from './desktop-file-state.ts'

/** Callbacks and private observable bound by the slot renderer. */
export interface FileClosePromptInjected {
  hooks: { closeRequest: ObservableSnapshot<FileCloseRequest | undefined> }
  cancelClose(): void
  discardClose(): void
  saveClose(): Promise<void>
}

/** Shared close prompt using the baseline Modal and Button primitives. */
export function FileClosePrompt({ useCloseRequest, cancelClose, discardClose, saveClose, t }:
  PropsLocale<'files'> & InjectFace<FileClosePromptInjected>) {
  const request = useCloseRequest(value => value)
  return <Modal
    open={request !== undefined}
    onClose={cancelClose}
    title={t('unsaved.title')}
    description={t('unsaved.body')}
    closeLabel={t('unsaved.close')}
    footer={<>
      <Button variant="ghost" disabled={request?.busy} onClick={cancelClose}>{t('unsaved.keep')}</Button>
      <Button variant="ghost" disabled={request?.busy} onClick={discardClose}>{t('unsaved.discard')}</Button>
      <Button variant="primary" disabled={request?.busy} loading={request?.busy === true}
        {...(request?.failed ? { feedback: t('error.write'), title: t('error.write') } : {})}
        onClick={() => { void saveClose() }}>{t('unsaved.save')}</Button>
    </>}
  >
    <p>{request?.path}</p>
  </Modal>
}
