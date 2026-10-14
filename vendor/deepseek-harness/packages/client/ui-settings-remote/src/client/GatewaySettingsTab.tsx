/** Settings → Remote → Gateway: offer v2 connections and local daemon settings. */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Button, DisclosureRow, SettingsSelect, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { RemotePatch, RemoteSnapshot } from './desktop-shell.ts'
import { ipcErrorMessage } from './relay-copy.ts'
import css from './GatewaySettingsTab.module.css'

/** Desktop callbacks used by the gateway tab. */
export interface GatewaySettingsTabInjected {
  getRemote: () => Promise<RemoteSnapshot | null>
  saveRemote: (patch: RemotePatch) => Promise<RemoteSnapshot | null>
  rotateRemoteToken: () => Promise<RemoteSnapshot | null>
}

/** Props assembled for the gateway tab slot. */
export type GatewaySettingsTabProps =
  PropsRuntime<'settings.remote.tab'>
  & PropsLocale<'settings.remote'>
  & InjectFace<GatewaySettingsTabInjected>

type GatewayAction = 'load' | 'relayUrl' | 'relayDefault' | 'relayToken' | 'relayClear' | 'modeLan' | 'modeRelay' | 'port' | 'bind' | 'rotate'
type Notice = { id: number; text: string; success: boolean }

/**
 * Explain why Relay is unavailable, or the ready-state mode hint.
 * @param snap - latest remote snapshot.
 * @param t - locale lookup.
 * @returns localized mode description.
 */
function modeDescription(
  snap: RemoteSnapshot,
  t: GatewaySettingsTabProps['t'],
): string {
  if (snap.relayConfigured) return t('modeHint')
  const hasUrl = Boolean(snap.relayUrl)
  const hasToken = Boolean(snap.relayTokenSet)
  if (hasUrl && !hasToken) return t('relayNeedsToken')
  if (!hasUrl && hasToken) return t('relayNeedsUrl')
  return t('relayNeedsBoth')
}

/**
 * Advanced gateway configuration: relay credentials first, then connection mode.
 * @param props - composed remote-tab props plus desktop inject face.
 * @returns the gateway settings page.
 */
export function GatewaySettingsTab({
  t,
  getRemote,
  saveRemote,
  rotateRemoteToken,
}: GatewaySettingsTabProps): ReactNode {
  const [snap, setSnap] = useState<RemoteSnapshot | null>(null)
  const [error, setError] = useState('')
  const [validation, setValidation] = useState<'port-invalid' | null>(null)
  const [pending, setPending] = useState<GatewayAction | null>(null)
  const [portDraft, setPortDraft] = useState('')
  const [relayUrlDraft, setRelayUrlDraft] = useState('')
  const [relayTokenDraft, setRelayTokenDraft] = useState('')
  const [legacyOpen, setLegacyOpen] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)
  const noticeId = useRef(0)
  const busy = pending !== null

  const showNotice = useCallback((text: string, success = false) => {
    noticeId.current += 1
    setNotice({ id: noticeId.current, text, success })
  }, [])

  const applySnap = useCallback((next: RemoteSnapshot) => {
    setSnap(next)
    setError(next.error || '')
    setValidation(null)
    setPortDraft(String(next.port ?? 3180))
    setRelayUrlDraft(next.relayUrl || '')
  }, [])

  const load = useCallback(async () => {
    setPending('load')
    try {
      const next = await getRemote()
      if (next === null || next.available === false) {
        setError(t('error'))
        showNotice(t('error'))
        return
      }
      applySnap(next)
      if (next.error) showNotice(t('statusError', { message: next.error }))
      else setNotice(null)
    } catch (caught) {
      const message = ipcErrorMessage(caught)
      setError(message)
      showNotice(t('statusError', { message }))
    } finally {
      setPending(null)
    }
  }, [applySnap, getRemote, showNotice, t])

  useEffect(() => {
    void load()
  }, [load])

  const save = useCallback(async (patch: RemotePatch, action: GatewayAction): Promise<boolean> => {
    if (busy) return false
    setPending(action)
    setNotice(null)
    try {
      const next = await saveRemote(patch)
      if (next === null || next.available === false) {
        setError(t('error'))
        showNotice(t('error'))
        return false
      }
      applySnap(next)
      if (next.error) {
        showNotice(t('savedServiceError', { message: next.error }))
        return false
      }
      showNotice(t('saved'), true)
      return true
    } catch (caught) {
      const message = ipcErrorMessage(caught)
      setError(message)
      showNotice(t('statusError', { message }))
      return false
    } finally {
      setPending(null)
    }
  }, [applySnap, busy, saveRemote, showNotice, t])

  const feedback = notice ? (
    <Toast key={notice.id} text={notice.text} {...notice.success ? { tone: 'success' as const } : { holdMs: null }}
      dismissLabel={t('dismiss')} onDone={() => { setNotice(null) }} />
  ) : null

  const bindAddress = snap?.bindAddress || '0.0.0.0'
  const mode = snap?.mode === 'lan' ? 'lan' : 'relay'
  const relayReady = snap?.relayConfigured === true
  const modeHint = snap ? modeDescription(snap, t) : ''
  const detectedBindAddresses = snap?.addresses
  const bindOptions = useMemo(() => {
    const nics = (snap?.addresses ?? []).filter(address => address !== '127.0.0.1')
    const options = ['0.0.0.0', '127.0.0.1', ...nics]
    return options.includes(bindAddress) ? options : [...options, bindAddress]
  }, [snap?.addresses, bindAddress])

  const bindLabel = (option: string): string => {
    if (option === '0.0.0.0') return t('bindAll')
    if (option === '127.0.0.1') return t('bindLoopback')
    // A persisted per-NIC choice missing from the live scan went stale
    // (adapter down, DHCP renumber, WSL/vEthernet subnet rebuild).
    if (Array.isArray(detectedBindAddresses) && !detectedBindAddresses.includes(option)) {
      return `${option} · ${t('bindUnavailable')}`
    }
    return option
  }

  if (!snap) {
    return <div className={css.page}>{feedback}
      <Button size="sm" variant="ghost" loading={busy} disabled={busy} title={error || undefined} onClick={() => { void load() }}>{t('retry')}</Button>
    </div>
  }

  return (
    <div className={css.page} data-dsh-remote-gateway="">
      {feedback}
      <div className={css.row}>
        <div className={css.rowText}>
          <div className={css.title}>{t('relayUrl')}</div>
          <div className={css.desc}>{t('relayUrlHint')}</div>
        </div>
        <div className={css.control}>
          <input
            className={css.input}
            type="url"
            spellCheck={false}
            placeholder={snap.defaultRelayUrl || t('relayUrlPlaceholder')}
            aria-label={t('relayUrl')}
            value={relayUrlDraft}
            disabled={busy}
            onChange={(event) => { setRelayUrlDraft(event.target.value) }}
          />
          <div className={css.actions}>
            <Button
              size="sm"
              variant="primary"
              disabled={busy}
              loading={pending === 'relayUrl'}
              onClick={() => { void save({ remoteRelayUrl: relayUrlDraft.trim() }, 'relayUrl') }}
            >
              {t('save')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy || !snap.defaultRelayUrl}
              loading={pending === 'relayDefault'}
              onClick={() => {
                const origin = snap.defaultRelayUrl || ''
                setRelayUrlDraft(origin)
                void save({ remoteRelayUrl: origin }, 'relayDefault')
              }}
            >
              {t('relayUseDefault')}
            </Button>
          </div>
        </div>
      </div>

      {snap.protocol === 'chisacode-v2' ? (
        <DisclosureRow className={css.legacy} icon={null} title={t('legacyConfiguration')}
          open={legacyOpen} expandable expandOnRowClick previewChevron={false}
          onToggle={() => { setLegacyOpen(value => !value) }}>
          <p className={css.desc}>{t('relayTokenHint')}</p>
          {snap.legacyRelayTokenSet ? (
            <Button size="sm" variant="ghost" disabled={busy}
              loading={pending === 'relayClear'}
              onClick={() => { void save({ remoteRelayToken: '' }, 'relayClear') }}>
              {t('relayTokenClear')}
            </Button>
          ) : <p className={css.desc}>{t('legacyEmpty')}</p>}
        </DisclosureRow>
      ) : <div className={css.row}>
        <div className={css.rowText}>
          <div className={css.title}>{t('relayToken')}</div>
          <div className={css.desc}>{t('relayTokenHint')}</div>
          {snap.relayTokenSet ? <div className={css.tokenMeta}>{t('relayTokenSet')}</div> : null}
        </div>
        <div className={css.control}>
          <input
            className={css.input}
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder={t('relayTokenPlaceholder')}
            aria-label={t('relayToken')}
            value={relayTokenDraft}
            disabled={busy}
            onChange={(event) => { setRelayTokenDraft(event.target.value) }}
          />
          <div className={css.actions}>
            <Button
              size="sm"
              variant="primary"
              disabled={busy || !relayTokenDraft.trim()}
              loading={pending === 'relayToken'}
              onClick={() => {
                const token = relayTokenDraft.trim()
                void save({ remoteRelayToken: token }, 'relayToken').then(saved => { if (saved) setRelayTokenDraft('') })
              }}
            >
              {t('save')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy || !snap.relayTokenSet}
              loading={pending === 'relayClear'}
              onClick={() => {
                void save({ remoteRelayToken: '' }, 'relayClear').then(saved => { if (saved) setRelayTokenDraft('') })
              }}
            >
              {t('relayTokenClear')}
            </Button>
          </div>
        </div>
      </div>}

      <div className={css.row}>
        <div className={css.rowText}>
          <div className={css.title}>{t('mode')}</div>
          <div className={css.desc}>{modeHint}</div>
        </div>
        <div className={`${css.control} ${css.modes}`} role="radiogroup" aria-label={t('mode')}>
          <Button
            size="sm"
            variant={mode === 'lan' ? 'primary' : 'ghost'}
            className={css.modeButton}
            role="radio"
            aria-checked={mode === 'lan'}
            disabled={busy}
            loading={pending === 'modeLan'}
            onClick={() => { if (mode !== 'lan') void save({ remoteMode: 'lan' }, 'modeLan') }}
          >
            {t('modeLan')}
          </Button>
          <Button
            size="sm"
            variant={mode === 'relay' ? 'primary' : 'ghost'}
            className={css.modeButton}
            role="radio"
            aria-checked={mode === 'relay'}
            disabled={busy || !relayReady}
            loading={pending === 'modeRelay'}
            title={relayReady ? undefined : modeHint}
            onClick={() => { if (relayReady && mode !== 'relay') void save({ remoteMode: 'relay' }, 'modeRelay') }}
          >
            {t('modeRelay')}
          </Button>
        </div>
      </div>

      <div className={css.row}>
        <div className={css.rowText}>
          <div className={css.title}>{t('port')}</div>
          <div className={css.desc}>{t('portHint')}</div>
        </div>
        <div className={css.control}>
          <input
            className={css.input}
            type="number"
            min={1024}
            max={65535}
            inputMode="numeric"
            aria-label={t('port')}
            aria-invalid={validation === 'port-invalid' || undefined}
            title={validation === 'port-invalid' ? t('portInvalid') : undefined}
            value={portDraft}
            disabled={busy}
            onChange={(event) => { setPortDraft(event.target.value) }}
          />
          <Button
            size="sm"
            variant="primary"
            disabled={busy}
            loading={pending === 'port'}
            onClick={() => {
              const port = Number(portDraft)
              if (!Number.isInteger(port) || port < 1024 || port > 65535) {
                setValidation('port-invalid')
                setError(t('portInvalid'))
                showNotice(t('portInvalid'))
                return
              }
              setValidation(null)
              void save({ remotePort: port }, 'port')
            }}
          >
            {t('save')}
          </Button>
        </div>
      </div>

      <div className={css.row}>
        <div className={css.rowText}>
          <div className={css.title}>{t('bindScope')}</div>
          <div className={css.desc}>{bindAddress === '127.0.0.1' ? t('bindLoopbackHint') : t('bindAll')}</div>
        </div>
        <div className={css.control}>
          <SettingsSelect
            align="end"
            aria-label={t('bindScope')}
            value={bindAddress}
            disabled={busy}
            loading={pending === 'bind'}
            options={bindOptions.map(option => ({ id: option, label: bindLabel(option) }))}
            onChange={(id) => {
              if (id !== bindAddress) void save({ remoteBindAddress: id }, 'bind')
            }}
          />
        </div>
      </div>

      <div className={css.row}>
        <div className={css.rowText}>
          <div className={css.title}>{t('lanTransport')}</div>
          <div className={css.desc}>{t('lanTlsHint')}</div>
        </div>
      </div>

      <div className={css.row}>
        <div className={css.rowText}>
          <div className={css.title}>{t('rotateToken')}</div>
          <div className={css.desc}>{t('rotateTokenHint')}</div>
        </div>
        <div className={css.control}>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            loading={pending === 'rotate'}
            onClick={() => {
              setPending('rotate')
              setNotice(null)
              void rotateRemoteToken()
                .then((next) => {
                  if (next === null || next.available === false) {
                    setError(t('error'))
                    showNotice(t('error'))
                    return
                  }
                  applySnap(next)
                  if (next.error) showNotice(t('statusError', { message: next.error }))
                })
                .catch((caught: unknown) => {
                  const message = ipcErrorMessage(caught)
                  setError(message)
                  showNotice(t('statusError', { message }))
                })
                .finally(() => { setPending(null) })
            }}
          >
            {t('rotateTokenConfirm')}
          </Button>
        </div>
      </div>
    </div>
  )
}
