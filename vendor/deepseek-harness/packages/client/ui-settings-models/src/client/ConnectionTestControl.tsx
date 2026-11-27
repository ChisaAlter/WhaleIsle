/**
 * Non-blocking endpoint connectivity check powered by `operations.discoverModels`.
 * Measures round-trip latency and displays discovered model count or explicit errors
 * without overwriting the saved `models` configuration.
 */

import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { LlmModelDiscoveryRequest } from '@deepseek-ai/dsh-api-remotes/client'
import { Button, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ModelsOperations } from './operations.ts'
import type { en, ModelsKey } from './locales.ts'
import styles from './ModelsSection.module.css'

type ConnectionOutcome =
  | { readonly kind: 'success'; readonly ms: number; readonly count: number }
  | { readonly kind: 'error'; readonly message: string }

/** Props of {@link ConnectionTestControl}. */
export interface ConnectionTestControlProps {
  /** Probe parameters derived from the current form draft. */
  probe: LlmModelDiscoveryRequest & { readonly settingsNs: string }
  /** Validation reason preventing discovery when the draft probe is incomplete. */
  blockedReason?: ModelsKey | undefined
  /** Disable triggering tests while the parent card is read-only or submitting. */
  disabled?: boolean | undefined
  /** Host discovery operations. */
  operations: ModelsOperations
  /** Localized copy accessor. */
  t: (key: keyof typeof en) => string
  /** Optional primary control (such as the API key input) aligned inline before the button. */
  leading?: ReactNode
}

/**
 * Render the non-blocking connection test trigger and inline diagnostic status.
 * @param props - probe request, validation block reason, operations, and copy.
 * @returns the connection test control row.
 */
export function ConnectionTestControl(props: ConnectionTestControlProps): ReactNode {
  const { probe, blockedReason, disabled = false, operations, t, leading } = props
  const [testing, setTesting] = useState(false)
  const [outcome, setOutcome] = useState<ConnectionOutcome | undefined>(undefined)
  const epochRef = useRef(0)
  const mountedRef = useRef(true)

  useEffect(() => () => { mountedRef.current = false }, [])

  const probeKey = JSON.stringify([probe, blockedReason ?? null])
  useEffect(() => {
    epochRef.current += 1
    setTesting(false)
    setOutcome(undefined)
  }, [probeKey])

  const runTest = async (): Promise<void> => {
    if (disabled || blockedReason !== undefined || testing) return
    const epoch = epochRef.current + 1
    epochRef.current = epoch
    setTesting(true)
    setOutcome(undefined)
    const startedAt = performance.now()
    try {
      const { settingsNs, ...request } = probe
      const reply = await operations.discoverModels(settingsNs, request)
      if (!mountedRef.current || epochRef.current !== epoch) return
      const ms = Math.max(0, Math.round(performance.now() - startedAt))
      if (reply.kind === 'found') {
        setOutcome({ kind: 'success', ms, count: reply.models.length })
      } else {
        setOutcome({ kind: 'error', message: reply.message })
      }
    } catch (error) {
      // Surface unexpected discovery transport/runtime exceptions rather than leaving testing stuck.
      if (!mountedRef.current || epochRef.current !== epoch) return
      setOutcome({ kind: 'error', message: error instanceof Error ? error.message : String(error) })
    } finally {
      if (mountedRef.current && epochRef.current === epoch) {
        setTesting(false)
      }
    }
  }

  const blockedLabel = blockedReason === undefined ? '' : t(blockedReason)
  const trigger = (
    <Tooltip label={blockedLabel} disabled={blockedReason === undefined} portal side="bottom">
      <span className={styles['buttonAnchor']}>
        <Button
          size="sm"
          variant="outline"
          loading={testing}
          feedback={testing ? t('testingConnection') : undefined}
          disabled={disabled || blockedReason !== undefined || testing}
          onClick={() => { void runTest() }}
        >
          {t('testConnection')}
        </Button>
      </span>
    </Tooltip>
  )
  const statusNode = outcome === undefined
    ? null
    : outcome.kind === 'success'
      ? (
        <span role="status" className={styles['savedNotice']}>
          {t(outcome.count === 0 ? 'connectionSuccessEmpty' : 'connectionSuccess')
            .replace('{ms}', () => String(outcome.ms))
            .replace('{count}', () => String(outcome.count))}
        </span>
      )
      : (
        <span role="status" className={styles['error']}>
          {t('connectionFailed').replace('{message}', () => outcome.message)}
        </span>
      )

  if (leading !== undefined) {
    return (
      <div className={styles['connectionTest']}>
        <div className={styles['keyActionRow']}>
          <div className={styles['keyInputGrow']}>{leading}</div>
          <div className={styles['connectionTestRow']}>{trigger}</div>
        </div>
        {statusNode}
      </div>
    )
  }

  return (
    <div className={styles['connectionTest']}>
      <div className={styles['connectionTestRow']}>
        {trigger}
        {statusNode}
      </div>
    </div>
  )
}
