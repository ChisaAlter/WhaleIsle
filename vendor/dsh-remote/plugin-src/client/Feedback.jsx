import * as React from 'react'
import { Toast } from '@deepseek-ai/dsh-client-ui-primitives'

export function RemoteFeedback({ error, message, onClearMessage, t, actions }) {
  const [dismissedError, setDismissedError] = React.useState('')
  React.useEffect(() => { setDismissedError('') }, [error])
  return <>
    {error && error !== dismissedError ? <Toast key={'error:' + error} text={error} holdMs={null} dismissLabel={t('common.close')} actions={actions} onDone={() => setDismissedError(error)} /> : null}
    {message ? <Toast key={'message:' + message} text={message} tone="success" onDone={onClearMessage} /> : null}
  </>
}
