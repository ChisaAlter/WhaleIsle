/**
 * OAuth sign-in, interactive prompt/notice relay, usage shortcut, and sign-out
 * control for `llm-pi-ai` providers that advertise an `oauth` authorization flow
 * (such as `openai` with Sign in with ChatGPT and `openai-codex`).
 */

import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type {
  AuthorizationEntry,
  AuthorizationNotice,
  AuthorizationStreamEvent,
  AuthorizationWirePrompt,
  CredentialRecordInfo,
} from '@deepseek-ai/dsh-api-remotes/client'
import { Button, Input, SettingsSelect } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ModelsOperations } from './operations.ts'
import type { en } from './locales.ts'
import styles from './ModelsSection.module.css'

const CHATGPT_USAGE_URL = 'https://chatgpt.com/settings/usage'

/** Props of {@link ProviderOAuthControl}. */
export interface ProviderOAuthControlProps {
  /** Provider route id (e.g. `'openai'`, `'openai-codex'`). */
  provider: string
  /** Credential record key (`llm-pi-ai/<provider>`). */
  oauthKey: string
  /** Registered authorization flow metadata from `authorization.list()`. */
  oauthFlow: AuthorizationEntry
  /** Stored grant presence and writability from `credentials.describeRecords()`. */
  oauthCredential?: CredentialRecordInfo
  /** True when a configured API key takes precedence over OAuth credentials. */
  hasApiKeyConflict?: boolean
  /** Disable actions while the parent card is read-only or submitting. */
  disabled?: boolean
  /** Host operations for streaming auth, prompt replies, record deletion, and URL opening. */
  operations: ModelsOperations
  /** Section copy accessor. */
  t: (key: keyof typeof en) => string
  /** Invoked when an interactive authorization attempt completes with `'authorized'`. */
  onAuthorized: () => void | Promise<void>
  /** Invoked after signing out deletes the stored credential record. */
  onSignedOut: () => void | Promise<void>
  /** Notifies the parent card when an authorization or sign-out operation is active. */
  onBusyChange?: (busy: boolean) => void
}

interface ActivePrompt {
  readonly promptId: string
  readonly prompt: AuthorizationWirePrompt
}

/**
 * Render the OAuth authentication section for one `llm-pi-ai` provider card.
 * @param props - flow metadata, stored credential state, Host operations, and callbacks.
 * @returns the OAuth sign-in or connected control, or null when no method is offered.
 */
export function ProviderOAuthControl(props: ProviderOAuthControlProps): ReactNode {
  const { provider, oauthKey, oauthFlow, oauthCredential, hasApiKeyConflict = false, disabled = false, operations, t } = props
  const oauthMethod = oauthFlow.methods.find(method => method.id === 'oauth') ?? oauthFlow.methods[0]
  const [running, setRunning] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const [notice, setNotice] = useState<AuthorizationNotice | undefined>(undefined)
  const [activePrompt, setActivePrompt] = useState<ActivePrompt | undefined>(undefined)
  const [promptAnswer, setPromptAnswer] = useState('')
  const [promptSubmitting, setPromptSubmitting] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  const mountedRef = useRef(true)
  const abortRef = useRef<AbortController | null>(null)
  const openedUrlsRef = useRef<Set<string>>(new Set())
  const attemptIdRef = useRef(0)
  const { onBusyChange } = props

  useEffect(() => {
    onBusyChange?.(running || signingOut)
  }, [running, signingOut, onBusyChange])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      abortRef.current?.abort()
      abortRef.current = null
    }
  }, [])

  if (oauthMethod === undefined) return null

  const isOpenAi = provider === 'openai'
  const signInLabel = isOpenAi ? t('oauthSignInChatGpt') : oauthMethod.label

  const handleEvent = (
    event: AuthorizationStreamEvent,
    attemptId: number,
    controller: AbortController,
  ): boolean => {
    if (!mountedRef.current || controller.signal.aborted || attemptIdRef.current !== attemptId) return false
    switch (event.type) {
      case 'notice': {
        setNotice(event.notice)
        const targetUrl = event.notice.url
        if (targetUrl !== undefined && !openedUrlsRef.current.has(targetUrl)) {
          openedUrlsRef.current.add(targetUrl)
          operations.openExternalUrl(targetUrl)
        }
        return false
      }
      case 'prompt':
        setActivePrompt({ promptId: event.promptId, prompt: event.prompt })
        setPromptAnswer(event.prompt.kind === 'select' ? (event.prompt.options[0]?.id ?? '') : '')
        setPromptSubmitting(false)
        return false
      case 'prompt-withdrawn':
        setActivePrompt(current => current?.promptId === event.promptId ? undefined : current)
        return false
      case 'done':
        setActivePrompt(undefined)
        setPromptSubmitting(false)
        setRunning(false)
        if (abortRef.current === controller) abortRef.current = null
        setNotice(undefined)
        setError(undefined)
        if (event.status === 'authorized') {
          void Promise.resolve(props.onAuthorized()).catch((err: unknown) => {
            if (mountedRef.current) setError(err instanceof Error ? err.message : String(err))
          })
        }
        return true
      case 'error':
        setActivePrompt(undefined)
        setPromptSubmitting(false)
        setRunning(false)
        if (abortRef.current === controller) abortRef.current = null
        setNotice(undefined)
        setError(event.message)
        return true
    }
  }

  const startSignIn = async (): Promise<void> => {
    if (disabled || running || signingOut) return
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    const attemptId = ++attemptIdRef.current
    openedUrlsRef.current.clear()
    setRunning(true)
    setError(undefined)
    setNotice(undefined)
    setActivePrompt(undefined)
    setPromptAnswer('')
    const outcome = { settled: false }
    try {
      await operations.startAuthorization(
        oauthKey,
        oauthMethod.id,
        (event) => {
          if (handleEvent(event, attemptId, controller)) outcome.settled = true
        },
        controller.signal,
      )
    } catch (err) {
      if (!mountedRef.current || controller.signal.aborted || attemptIdRef.current !== attemptId) return
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      if (abortRef.current === controller) abortRef.current = null
      if (mountedRef.current && attemptIdRef.current === attemptId && !outcome.settled) {
        setRunning(false)
        setActivePrompt(undefined)
        setPromptSubmitting(false)
      }
    }
  }

  const cancelSignIn = (): void => {
    attemptIdRef.current += 1
    abortRef.current?.abort()
    abortRef.current = null
    setRunning(false)
    setNotice(undefined)
    setActivePrompt(undefined)
    setPromptAnswer('')
    setPromptSubmitting(false)
    setError(undefined)
    void operations.cancelAuthorization(oauthKey)
  }

  const submitPrompt = async (answer: string | null): Promise<void> => {
    if (activePrompt === undefined || promptSubmitting) return
    const targetPromptId = activePrompt.promptId
    setPromptSubmitting(true)
    setError(undefined)
    try {
      const failure = await operations.respondAuthorizationPrompt(targetPromptId, answer)
      if (!mountedRef.current) return
      if (failure !== undefined) {
        setError(failure)
        return
      }
      setActivePrompt(current => current?.promptId === targetPromptId ? undefined : current)
      setPromptAnswer('')
    } catch (err) {
      if (mountedRef.current) setError(err instanceof Error ? err.message : String(err))
    } finally {
      if (mountedRef.current) setPromptSubmitting(false)
    }
  }

  const signOut = async (): Promise<void> => {
    if (disabled || signingOut || !oauthCredential?.writable) return
    setSigningOut(true)
    setError(undefined)
    try {
      const failure = await operations.removeCredentialRecord(oauthKey)
      if (!mountedRef.current) return
      if (failure !== undefined) {
        setError(failure)
        return
      }
      await props.onSignedOut()
    } catch (err) {
      if (mountedRef.current) setError(err instanceof Error ? err.message : String(err))
    } finally {
      if (mountedRef.current) setSigningOut(false)
    }
  }

  if (oauthCredential?.configured === true && !running) {
    return (
      <div className={styles['oauthBox']}>
        <div className={styles['oauthRow']}>
          <span className={styles['accountStatus']}>
            <span className={`${styles['credentialDot']} ${styles['credentialDotConfigured']}`} aria-hidden="true" />
            {isOpenAi ? t('oauthConnectedChatGpt') : t('accountSignedIn')}
          </span>
          <div className={styles['oauthActions']}>
            {isOpenAi
              ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={disabled || signingOut}
                  onClick={() => { operations.openExternalUrl(CHATGPT_USAGE_URL) }}
                >
                  {t('oauthManageUsage')}
                </Button>
              )
              : null}
            <Button
              size="sm"
              variant="outline"
              className={styles['dangerButton']}
              disabled={disabled || signingOut || !oauthCredential.writable}
              loading={signingOut}
              feedback={signingOut ? t('oauthSigningOut') : undefined}
              onClick={() => { void signOut() }}
            >
              {t('oauthSignOut')}
            </Button>
          </div>
        </div>
        {hasApiKeyConflict
          ? <p className={styles['notice']}>{t(isOpenAi ? 'oauthApiKeyPrecedence' : 'oauthApiKeyPrecedenceGeneric')}</p>
          : null}
        {error !== undefined ? <p className={styles['error']}>{error}</p> : null}
      </div>
    )
  }

  return (
    <div className={styles['oauthBox']}>
      {running
        ? (
          <>
            <div className={styles['oauthRow']}>
              <span className={styles['advancedHint']}>{notice?.message ?? t('oauthSigningIn')}</span>
              <div className={styles['oauthActions']}>
                {notice?.url !== undefined
                  ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        if (notice.url !== undefined) operations.openExternalUrl(notice.url)
                      }}
                    >
                      {t('oauthOpenBrowser')}
                    </Button>
                  )
                  : null}
                <Button size="sm" variant="outline" onClick={cancelSignIn}>
                  {t('cancel')}
                </Button>
              </div>
            </div>
            {notice?.code !== undefined
              ? (
                <div className={styles['oauthCode']}>
                  <span>{t('oauthDeviceCode')}:</span>
                  <code className={styles['oauthCodeValue']}>{notice.code}</code>
                </div>
              )
              : null}
            {activePrompt !== undefined
              ? (
                <div className={styles['oauthPrompt']}>
                  <span className={styles['fieldLabel']}>{activePrompt.prompt.message}</span>
                  {activePrompt.prompt.kind === 'select'
                    ? (
                      <SettingsSelect
                        variant="block"
                        aria-label={activePrompt.prompt.message}
                        placeholder={t('oauthSelectPlaceholder')}
                        value={promptAnswer}
                        disabled={promptSubmitting}
                        options={activePrompt.prompt.options.map(option => ({
                          id: option.id,
                          label: option.description === undefined ? option.label : `${option.label} — ${option.description}`,
                        }))}
                        onChange={setPromptAnswer}
                      />
                    )
                    : (
                      <Input
                        variant="form"
                        className={styles['input']}
                        type={activePrompt.prompt.kind === 'secret' ? 'password' : 'text'}
                        aria-label={activePrompt.prompt.message}
                        placeholder={activePrompt.prompt.placeholder}
                        value={promptAnswer}
                        disabled={promptSubmitting}
                        onChange={(event) => { setPromptAnswer(event.target.value) }}
                      />
                    )}
                  <div className={styles['oauthActions']}>
                    <Button
                      size="sm"
                      variant="primary"
                      disabled={promptSubmitting || (activePrompt.prompt.kind === 'select' && promptAnswer.length === 0)}
                      loading={promptSubmitting}
                      onClick={() => { void submitPrompt(promptAnswer) }}
                    >
                      {t('oauthPromptSubmit')}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={promptSubmitting}
                      onClick={() => { void submitPrompt(null) }}
                    >
                      {t('cancel')}
                    </Button>
                  </div>
                </div>
              )
              : null}
          </>
        )
        : (
          <>
            <div className={styles['oauthRow']}>
              <Button
                size="sm"
                variant="outline"
                disabled={disabled}
                onClick={() => { void startSignIn() }}
              >
                {signInLabel}
              </Button>
            </div>
            {isOpenAi ? <p className={styles['advancedHint']}>{t('oauthChatGptHint')}</p> : null}
          </>
        )}
      {error !== undefined ? <p className={styles['error']}>{error}</p> : null}
    </div>
  )
}
