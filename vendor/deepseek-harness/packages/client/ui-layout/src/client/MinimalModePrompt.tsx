import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from './index.ts'
import css from './MinimalModePrompt.module.css'

/** The startup observer owns availability; the theme service owns decisions. */
export type MinimalModePromptInjected = {
  decide: (choice: 'enable' | 'later' | 'never') => void
  hooks: { minimalSuggestion: HostObservable<boolean> }
}

type Props = PropsRuntime<'shell.overlay'> & PropsLocale<'settings.theme'> & InjectFace<MinimalModePromptInjected>

/** A conservative initial focus prevents a pending Enter from enabling the mode. */
export function MinimalModePrompt({ useMinimalSuggestion, decide, t }: Props) {
  const open = useMinimalSuggestion(value => value)
  return <Modal open={open} title={t('minimal.prompt.title')}
    description={t('minimal.prompt.description')} closeLabel={t('minimal.prompt.later')}
    onClose={() => { decide('later') }} footer={<div className={css.actions}>
      <Button variant="ghost" onClick={() => { decide('never') }}>{t('minimal.prompt.never')}</Button>
      <Button variant="outline" data-modal-autofocus onClick={() => { decide('later') }}>{t('minimal.prompt.later')}</Button>
      <Button variant="primary" onClick={() => { decide('enable') }}>{t('minimal.prompt.enable')}</Button>
    </div>} />
}
