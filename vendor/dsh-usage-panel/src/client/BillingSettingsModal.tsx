// dsh-usage-panel · billing settings modal (opened from the toolbar's 设置 button).
//
// Minimal SELECT + INPUT form over one model at a time: pick a provider →
// pick a model → the price inputs show the DEFAULT price (official DeepSeek
// columns, including a third-party relay serving an official id) and an
// unknown model starts empty with a "set your own price" hint. 保存 commits
// ONLY the selected model: values equal to the default remove any custom
// override (revert to official), edited values are stored as a custom
// override; every other model's stored override is preserved.
//
// The 峰谷计价 switch is PER MODEL and its state is seeded from the saved
// record (`billing-buffer.ts`), never defaulted on: the main row is labelled
// 空闲价格 while it is on and 价格 while it is off. With it OFF the entered
// price is persisted in BOTH columns plus the plugin's own `flat` marker —
// the harness reads the top-level triple as the PEAK column and halves it when
// no `idle` column exists, so a flat record without `idle` bills half in
// off-peak hours.
import * as React from 'react'
import { Button, Modal, Switch, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import type { I18n } from './locales.ts'
import type { RpcLike } from './ctx.ts'
import { type BillingModelOption, type BillingModelOptions, type BillingSettings } from '../shared/contract.ts'
import type { SessionCostPrices } from '../shared/pricing.ts'
import {
  compositePriceKey,
  resolveModelPrice,
} from '../shared/pricing.ts'
import { callBillingGet, callBillingModels, callBillingSet } from './api.ts'
import { EMPTY_BUFFER, seedPriceBuffer, type PriceBuffer } from './billing-buffer.ts'
import { currentBilling, publishBilling } from './billing-bus.ts'

export interface BillingSettingsModalProps {
  rpc: RpcLike
  i18n: I18n
  open: boolean
  onClose: () => void
}

function rowKey(provider: string, model: string): string {
  return compositePriceKey(provider, model)
}

function validPrice(value: string): boolean {
  if (value.trim() === '') return false
  const n = Number(value)
  return Number.isFinite(n) && n >= 0
}

/** The default price of a model: the official column when known, else null. */
function defaultPrice(provider: string, model: string): ReturnType<typeof resolveModelPrice> {
  return resolveModelPrice(provider, model, {})
}

/**
 * Bound a client RPC with a timeout: the modal must never spin forever on a
 * cold-start host (a large boot fold can block the host loop for seconds).
 * The losing side is guarded so its late settlement never goes unhandled.
 */
function withClientTimeout<T>(source: Promise<T>, ms: number, label: string): Promise<T> {
  source.catch(() => {
    /* guarded: the caller only observes the race result */
  })
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(label + ' timed out')), ms)
    source.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}

export function BillingSettingsModal({ rpc, i18n, open, onClose }: BillingSettingsModalProps): JSX.Element | null {
  const t = i18n.t
  // Seed from the in-bundle bus: the plugin prefetches billing settings at
  // apply time, so a cold-start open renders instantly from the snapshot.
  const [settings, setSettings] = React.useState<BillingSettings | null>(() => currentBilling())
  const [options, setOptions] = React.useState<BillingModelOptions>({ options: [] })
  const [providerId, setProviderId] = React.useState('')
  const [modelName, setModelName] = React.useState('')
  const [buffer, setBuffer] = React.useState<PriceBuffer>({ ...EMPTY_BUFFER })
  const [feedback, setFeedback] = React.useState<{ id: number; text: string; success: boolean } | null>(null)
  const [dismissedFeedbackId, setDismissedFeedbackId] = React.useState<number | null>(null)
  const feedbackId = React.useRef(0)
  const [validationAttempted, setValidationAttempted] = React.useState(false)
  const [loading, setLoading] = React.useState(false)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [loadNonce, setLoadNonce] = React.useState(0)
  const [savingAction, setSavingAction] = React.useState<'save' | 'commit' | null>(null)
  const saving = savingAction !== null

  const showFeedback = (text: string, success = false): void => {
    setFeedback({ id: ++feedbackId.current, text, success })
  }

  const bumpLoad = (): void => setLoadNonce((n) => n + 1)

  // Two-stage load with a client-side timeout: a cold-start host busy with a
  // large boot fold must surface as an error + retry, never an endless
  // spinner. The bus snapshot (prefetched at apply) renders immediately.
  React.useEffect(() => {
    if (!open) return
    let disposed = false
    const snapshot = currentBilling()
    setLoadError(null)
    setFeedback(null)
    setValidationAttempted(false)
    setOptions({ options: [] })
    setProviderId('')
    setModelName('')
    setBuffer({ ...EMPTY_BUFFER })
    if (snapshot !== null) {
      setSettings(snapshot)
      setLoading(false)
    } else {
      setSettings(null)
      setLoading(true)
    }
    withClientTimeout(callBillingGet(rpc), 6000, 'billing settings')
      .then((current) => {
        if (disposed) return
        publishBilling(current)
        setSettings(current)
        setLoading(false)
      })
      .catch((err) => {
        if (disposed) return
        if (currentBilling() === null) {
          setLoadError(String((err as Error)?.message ?? err))
          setLoading(false)
        }
      })
    callBillingModels(rpc)
      .then((modelOptions) => {
        if (!disposed) setOptions(modelOptions)
      })
      .catch(() => {
        if (!disposed) setOptions({ options: [] })
      })
    return () => {
      disposed = true
    }
  }, [rpc, open, loadNonce])

  React.useEffect(() => {
    if (!open || options.options.length === 0) return
    setProviderId((prev) => (prev !== '' ? prev : options.options[0]!.provider))
  }, [open, options])

  const providerOptions = React.useMemo(() => {
    const map = new Map<string, BillingModelOption>()
    for (const option of options.options) {
      map.set(option.provider, { ...option, models: [...option.models] })
    }
    // Providers that only appear in stored custom prices stay reachable.
    if (settings !== null) {
      for (const key of Object.keys(settings.prices)) {
        const provider = key.includes('/') ? key.slice(0, key.indexOf('/')) : '(unknown)'
        if (!map.has(provider)) map.set(provider, { provider, providerName: provider, models: [] })
      }
    }
    if (map.size === 0) map.set('(unknown)', { provider: '(unknown)', providerName: '(unknown)', models: [] })
    return [...map.values()]
  }, [options, settings])

  const providerModels = React.useMemo(() => {
    const option = providerOptions.find((p) => p.provider === providerId)
    return option ? option.models : []
  }, [providerOptions, providerId])

  /** Load the selected model into the buffer. The switch state and every
   *  prefilled row come from the saved record — a model the user saved with
   *  峰谷计价 OFF reopens OFF — falling back to the official peak + idle
   *  columns (both shown, switch on) and then to empty (unknown model, one
   *  price to enter). See `billing-buffer.ts` for the seeding rules. */
  const selectModel = (provider: string, model: string): void => {
    setProviderId(provider)
    setModelName(model)
    setFeedback(null)
    setValidationAttempted(false)
    const custom = settings?.prices[rowKey(provider, model)] ?? settings?.prices[model]
    setBuffer(seedPriceBuffer(custom, defaultPrice(provider, model)))
  }

  // The model dropdown has no placeholder, so the form must never sit on an
  // empty selection: once the provider directory (or the selected provider)
  // arrives, land on that provider's first model THROUGH selectModel — setting
  // modelName alone would fill the dropdown and leave every price input blank.
  // Idempotent (it only ever fires while modelName is empty) and guarded: a
  // provider with NO models — the synthesized `(unknown)` provider built from
  // stored custom prices, or a failed/timed-out `listModels` — leaves the form
  // empty, which is the reachable case `commitModel` still handles.
  React.useEffect(() => {
    if (!open || modelName !== '' || providerId === '') return
    const first = providerModels[0]
    if (first === undefined) return
    selectModel(providerId, first)
  }, [open, modelName, providerId, providerModels])

  /** Toggle per-model 峰谷计价: ON shows the 高峰价格 row, OFF bills both
   *  periods at the entered single (价格) row. Opening prefills the peak row as
   *  twice the idle values when the peak fields are empty. */
  const toggleIdle = (checked: boolean): void => {
    setFeedback(null)
    if (!checked) {
      setBuffer({ ...buffer, idleChecked: false })
      return
    }
    const double = (n: string): string => (n.trim() === '' ? '' : String(Number(n) * 2))
    setBuffer({
      ...buffer,
      idleChecked: true,
      hit: buffer.hit === '' ? double(buffer.idleHit) : buffer.hit,
      miss: buffer.miss === '' ? double(buffer.idleMiss) : buffer.miss,
      out: buffer.out === '' ? double(buffer.idleOut) : buffer.out,
    })
  }

  /** Switch provider and land on its first model (the dropdown has no
   *  placeholder). A provider with no models — `(unknown)`, an empty adapter
   *  directory — keeps the form empty instead of forcing a model that does not
   *  exist, which is what leaves `commitModel`'s no-model branch reachable. */
  const switchProvider = (provider: string): void => {
    const first = providerOptions.find((p) => p.provider === provider)?.models[0]
    setFeedback(null)
    setValidationAttempted(false)
    if (first === undefined) {
      setProviderId(provider)
      setModelName('')
      setBuffer({ ...EMPTY_BUFFER })
      return
    }
    selectModel(provider, first)
  }

  /** Commit the selected model; values equal to the default revert it to
   *  the official column (no custom record), edited values override. With no
   *  model selected — the only remaining cause is a provider that has none — 保存
   *  simply persists the switch settings (no forced pick).
   *  @param close - true = also close the modal (footer 保存); false = stay open (添加/更新). */
  const commitModel = (close: boolean): void => {
    if (settings === null || saving) return
    setFeedback(null)
    if (modelName === '') {
      if (!close) return // 添加/更新 is disabled without a model anyway
      setSavingAction('save')
      callBillingSet(rpc, settings)
        .then((saved) => {
          publishBilling(saved)
          setSettings(saved)
          onClose()
        })
        .catch((err) => {
          showFeedback(t('billing.saveError', { msg: String((err as Error)?.message ?? err) }))
        })
        .finally(() => setSavingAction(null))
      return
    }
    const key = rowKey(providerId, modelName)
    setValidationAttempted(true)
    if (buffer.idleChecked && (!validPrice(buffer.hit) || !validPrice(buffer.miss) || !validPrice(buffer.out))) {
      showFeedback(t('billing.err.invalidPrice', { key: modelName }))
      return
    }
    if (!validPrice(buffer.idleHit) || !validPrice(buffer.idleMiss) || !validPrice(buffer.idleOut)) {
      showFeedback(t(buffer.idleChecked ? 'billing.err.invalidIdle' : 'billing.err.invalidSingle', { key: modelName }))
      return
    }
    const prices: SessionCostPrices = { ...settings.prices }
    const def = defaultPrice(providerId, modelName)
    const unchanged = def !== null && buffer.idleChecked
      && Number(buffer.idleHit) === def.idle.inputCacheHit
      && Number(buffer.idleMiss) === def.idle.inputCacheMiss
      && Number(buffer.idleOut) === def.idle.output
      && Number(buffer.hit) === def.peak.inputCacheHit
      && Number(buffer.miss) === def.peak.inputCacheMiss
      && Number(buffer.out) === def.peak.output
    if (unchanged) {
      // Reverting to the default never stores a duplicate of the official column.
      delete prices[key]
      delete prices[modelName]
    } else if (buffer.idleChecked) {
      // 峰谷计价 ON: peak row (fields) + explicit idle row.
      delete prices[modelName] // legacy bare key never wins alongside the composite
      prices[key] = {
        inputCacheHit: Number(buffer.hit),
        inputCacheMiss: Number(buffer.miss),
        output: Number(buffer.out),
        idle: { inputCacheHit: Number(buffer.idleHit), inputCacheMiss: Number(buffer.idleMiss), output: Number(buffer.idleOut) },
      }
    } else {
      // 峰谷计价 OFF: the single (价格) row IS the one price for both periods.
      delete prices[modelName]
      const flat = {
        inputCacheHit: Number(buffer.idleHit),
        inputCacheMiss: Number(buffer.idleMiss),
        output: Number(buffer.idleOut),
      }
      // WRITE BOTH COLUMNS. The harness has no `flat` field: it reads the three
      // top-level numbers as the PEAK column and derives the off-peak charge as
      // HALF of them when `idle` is absent — so the old flat-only record billed
      // the entered price at half in off-peak hours. Persisting the same triple
      // as an explicit idle column makes every reader (the composer strip, this
      // plugin's cost math, this modal on reopen) agree that both periods bill
      // that price; `flat` stays as this plugin's own switch marker.
      prices[key] = { ...flat, idle: { ...flat }, flat: true }
    }
    setSavingAction(close ? 'save' : 'commit')
    callBillingSet(rpc, { ...settings, prices })
      .then((saved) => {
        publishBilling(saved)
        setSettings(saved)
        if (close) onClose()
        else showFeedback(t('billing.updated', { model: modelName }), true)
      })
      .catch((err) => {
        showFeedback(t('billing.saveError', { msg: String((err as Error)?.message ?? err) }))
      })
      .finally(() => setSavingAction(null))
  }

  const save = (): void => commitModel(true)
  const addUpdate = (): void => commitModel(false)

  const peakValley = settings?.peakValleyEnabled !== false
  const idleInvalidReason = t(buffer.idleChecked ? 'billing.err.invalidIdle' : 'billing.err.invalidSingle', { key: modelName })
  const peakInvalidReason = t('billing.err.invalidPrice', { key: modelName })
  const editPrice = (field: Exclude<keyof PriceBuffer, 'idleChecked'>, value: string): void => {
    setFeedback(null)
    setBuffer({ ...buffer, [field]: value })
  }

  const body = loadError !== null ? (
    <div className="dsw-ust-bill-loading">
      <div>{t('billing.loadError', { msg: loadError })}</div>
      <button type="button" onClick={bumpLoad} className="dsw-ust-bill-cancel">
        {t('billing.retry')}
      </button>
    </div>
  ) : loading || settings === null ? (
    <div className="dsw-ust-bill-loading">{t('billing.loading')}</div>
  ) : (
    <div className="dsw-ust-bill">
      <section className="dsw-ust-bill-section">
        <div className="dsw-ust-bill-section-head">
          <h4>{t('billing.modelsTitle')}</h4>
        </div>
        <div className="dsw-ust-bill-pick">
          <label className="dsw-ust-bill-select">
            <span>{t('billing.providerLabel')}</span>
            <select
              value={providerId}
              disabled={saving}
              onChange={(e) => switchProvider(e.target.value)}
            >
              {providerOptions.map((option) => (
                <option key={option.provider} value={option.provider}>
                  {option.providerName}
                </option>
              ))}
            </select>
          </label>
          <label className="dsw-ust-bill-select">
            <span>{t('billing.modelLabel')}</span>
            <select
              value={modelName}
              disabled={saving}
              onChange={(e) => selectModel(providerId, e.target.value)}
            >
              {providerModels.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </select>
          </label>
          {peakValley && (
            <label className="dsw-ust-bill-switch-inline">
              <span>{t('billing.idleToggle')}</span>
              <Switch
                checked={buffer.idleChecked}
                disabled={saving}
                onChange={(e) => toggleIdle(e.target.checked)}
              />
            </label>
          )}
        </div>
        <div className="dsw-ust-bill-prices" data-period="idle">
          {/* The main row is the OFF-PEAK column only while the switch is on;
              with it off this is the one price that bills both periods, so it
              is labelled 价格 and drops the green `is-idle` colour — green
              claims "off-peak", a period this row does not name. */}
          <span className={buffer.idleChecked ? 'dsw-ust-bill-period is-idle' : 'dsw-ust-bill-period'}>
            {buffer.idleChecked ? t('billing.periodIdle') : t('billing.periodSingle')}
          </span>
          <PriceInput label={t('billing.hit')} value={buffer.idleHit} onChange={(v) => editPrice('idleHit', v)} validationAttempted={validationAttempted} invalidReason={idleInvalidReason} disabled={saving} />
          <PriceInput label={t('billing.miss')} value={buffer.idleMiss} onChange={(v) => editPrice('idleMiss', v)} validationAttempted={validationAttempted} invalidReason={idleInvalidReason} disabled={saving} />
          <PriceInput label={t('billing.out')} value={buffer.idleOut} onChange={(v) => editPrice('idleOut', v)} validationAttempted={validationAttempted} invalidReason={idleInvalidReason} disabled={saving} />
        </div>
        {buffer.idleChecked && (
          <div className="dsw-ust-bill-prices">
            <span className="dsw-ust-bill-period is-peak">{t('billing.periodPeak')}</span>
            <PriceInput label={t('billing.hit')} value={buffer.hit} onChange={(v) => editPrice('hit', v)} validationAttempted={validationAttempted} invalidReason={peakInvalidReason} disabled={saving} />
            <PriceInput label={t('billing.miss')} value={buffer.miss} onChange={(v) => editPrice('miss', v)} validationAttempted={validationAttempted} invalidReason={peakInvalidReason} disabled={saving} />
            <PriceInput label={t('billing.out')} value={buffer.out} onChange={(v) => editPrice('out', v)} validationAttempted={validationAttempted} invalidReason={peakInvalidReason} disabled={saving} />
          </div>
        )}
        <div className="dsw-ust-bill-commit-row">
          <Button size="sm" className="dsw-ust-bill-commit" onClick={addUpdate} disabled={saving || modelName === ''} loading={savingAction === 'commit'}>
            {t('billing.commit')}
          </Button>
        </div>
      </section>
    </div>
  )

  return (
    <>
      <Modal
        open={open}
        onClose={() => { if (!saving) onClose() }}
        title={t('billing.title')}
        closeLabel={t('billing.close')}
        className="dsw-ust-modal"
        contentClassName="dsw-ust-modal-content"
        footer={
          <div className="dsw-ust-bill-footer">
            <button type="button" className="dsw-ust-bill-cancel" onClick={onClose} disabled={saving}>
              {t('billing.close')}
            </button>
            <Button size="sm" className="dsw-ust-bill-save" onClick={save} disabled={saving || loading} loading={savingAction === 'save'}>
              {t('billing.save')}
            </Button>
          </div>
        }
      >
        {body}
      </Modal>
      {open && feedback !== null && feedback.id !== dismissedFeedbackId && (
        <Toast
          key={feedback.id}
          text={feedback.text}
          tone={feedback.success ? 'success' : undefined}
          holdMs={feedback.success ? undefined : null}
          dismissLabel={t('billing.close')}
          onDone={() => setDismissedFeedbackId(feedback.id)}
        />
      )}
    </>
  )
}

function PriceInput({ label, value, onChange, validationAttempted, invalidReason, disabled }: {
  label: string
  value: string
  onChange: (value: string) => void
  validationAttempted: boolean
  invalidReason: string
  disabled: boolean
}): JSX.Element {
  const invalid = (validationAttempted || value !== '') && !validPrice(value)
  return (
    <label className="dsw-ust-bill-input">
      <span>{label}</span>
      <input
        value={value}
        disabled={disabled}
        inputMode="decimal"
        placeholder="0.00"
        onChange={(e) => onChange(e.target.value)}
        className={invalid ? 'is-bad' : value === '' ? '' : 'is-ok'}
        aria-invalid={invalid}
        title={invalid ? invalidReason : undefined}
      />
    </label>
  )
}
