/**
 * Vision-model picker: one dropdown over catalog models that advertise image
 * input, persisting the designated vision route into the live
 * `llm-vision-fallback` configuration entry.
 * The host-side vision-fallback plugin reads that namespace; when the main
 * model cannot read images, it calls the designated model to describe them.
 * The control renders only when the host exposes the namespace (the plugin
 * is mounted), and hides itself entirely otherwise.
 */

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import { SettingsSelect, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import type { en } from './locales.ts'
import styles from './ModelsSection.module.css'

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Catalog group as the leftover picker still reads it. */
interface ModelProviderGroup {
  id: string
  name: string
  models: readonly {
    id: string
    name: string
    inputModalities?: readonly string[]
  }[]
}

/** Wire faces the leftover picker still takes (RpcResult envelope). */
export interface VisionPickerApi {
  llm: {
    models(request: Record<string, never>): Promise<{
      result: { ok: true; value: { groups: readonly ModelProviderGroup[] } } | { ok: false; error: { message: string } }
    }>
  }
  settings: {
    mutate(input: unknown): Promise<{
      result: { ok: true; value: unknown } | { ok: false; error: { message: string } }
    }>
  }
}

/** Live configuration entry id for the host-side vision-fallback plugin. */
export const VISION_FALLBACK_NS = 'llm-vision-fallback'

/** One selectable route flattened from the model catalog. */
interface RouteOption {
  provider: string
  providerName: string
  model: string
  modelName: string
}

/** Dependencies of {@link VisionModelPicker}. */
export interface VisionModelPickerProps {
  /** Wire faces: the catalog read and the settings write. */
  api: VisionPickerApi
  /** Section copy. */
  t: (key: keyof typeof en) => string
  /** The vision-fallback namespace view, or undefined while the plugin is absent. */
  namespace: SettingsNamespaceView | undefined
  /** Whether the settings document accepts writes. */
  writable: boolean
  /** Reload the page snapshot after a committed write (refreshes the revision). */
  onSaved: () => void
}

/** Encode one route as a stable option value ('\n' cannot appear in either id). */
function routeValue(provider: string, model: string): string {
  return `${provider}\n${model}`
}

/** Read a nested field from a settings namespace value. */
function getPath(value: unknown, path: readonly string[]): unknown {
  let current: unknown = value
  for (const key of path) {
    if (Array.isArray(current)) {
      current = current[Number(key)]
      continue
    }
    if (typeof current !== 'object' || current === null) return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

/** Flatten catalog groups into selectable image-capable routes in catalog order. */
function flattenGroups(groups: readonly ModelProviderGroup[]): RouteOption[] {
  return groups.flatMap(group => group.models
    .filter(model => model.inputModalities?.includes('image') === true)
    .map(model => ({
      provider: group.id,
      providerName: group.name,
      model: model.id,
      modelName: model.name,
    })))
}

/** Read one string field from the namespace's resolved value. */
function storedField(namespace: SettingsNamespaceView, field: string): string | undefined {
  const value = getPath(namespace.value, [field])
  return typeof value === 'string' && value !== '' ? value : undefined
}

/**
 * Render the vision-model dropdown row, or nothing while the host does not
 * expose the vision-fallback namespace.
 * @param props - wire faces, copy, namespace view, and write acknowledgement.
 * @returns the picker row, or null when the feature is absent.
 */
export function VisionModelPicker(props: VisionModelPickerProps): ReactNode {
  const { api, t, namespace, writable, onSaved } = props
  const [options, setOptions] = useState<RouteOption[] | undefined>(undefined)
  const [loadFailure, setLoadFailure] = useState<string | undefined>(undefined)
  const [saveFailure, setSaveFailure] = useState<string | undefined>(undefined)
  const [saving, setSaving] = useState(false)
  const [dismissedFailure, setDismissedFailure] = useState<string | undefined>()
  const [saveSequence, setSaveSequence] = useState(0)
  const enabled = namespace !== undefined

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    setLoadFailure(undefined)
    void api.llm.models({})
      .then((response) => {
        if (cancelled) return
        if (!response.result.ok) {
          setLoadFailure(response.result.error.message)
          return
        }
        setOptions(flattenGroups(response.result.value.groups))
        setLoadFailure(undefined)
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadFailure(messageOf(error))
      })
    return () => { cancelled = true }
  }, [api, enabled])

  if (namespace === undefined) return null

  const currentProvider = storedField(namespace, 'provider')
  const currentModel = storedField(namespace, 'model')
  const current = currentProvider !== undefined && currentModel !== undefined
    ? routeValue(currentProvider, currentModel)
    : ''
  const known = options ?? []
  // A stored route missing from the image-capable catalog (text-only, removed
  // provider, model unlisted) stays visible and selected instead of snapping to "off".
  const staleOption = currentProvider !== undefined && currentModel !== undefined
    && !known.some(option => routeValue(option.provider, option.model) === current)
    ? { value: current, label: `${currentProvider} / ${currentModel}` }
    : undefined

  const save = (value: string): void => {
    setSaveSequence(sequence => sequence + 1)
    setSaveFailure(undefined)
    setDismissedFailure(undefined)
    setSaving(true)
    const ops = value === ''
      ? [{ op: 'unset' as const, path: ['provider'] }, { op: 'unset' as const, path: ['model'] }]
      : (() => {
        const [provider = '', model = ''] = value.split('\n')
        return [
          { op: 'set' as const, path: ['provider'], value: provider },
          { op: 'set' as const, path: ['model'], value: model },
        ]
      })()
    void api.settings.mutate({ ns: VISION_FALLBACK_NS, ops, expectedRevision: namespace.revision })
      .then((response) => {
        if (!response.result.ok) {
          setSaveFailure(response.result.error.message)
          return
        }
        onSaved()
      })
      .catch((error: unknown) => { setSaveFailure(messageOf(error)) })
      .finally(() => { setSaving(false) })
  }

  return (
    <div className={styles['rowCard']}>
      <div className={styles['field']}>
        <span className={styles['fieldLabel']}>{t('visionModel')}</span>
        <SettingsSelect
          variant="block"
          aria-label={t('visionModel')}
          value={current}
          disabled={!writable || saving}
          loading={saving}
          options={[
            { id: '', label: t('visionModelOff') },
            ...staleOption === undefined ? [] : [{ id: staleOption.value, label: staleOption.label }],
            ...known.map(option => ({
              id: routeValue(option.provider, option.model),
              label: `${option.providerName} / ${option.modelName}`,
            })),
          ]}
          onChange={save}
        />
      </div>
      <p className={styles['advancedHint']}>{t('visionModelHint')}</p>
      {saveFailure !== undefined && dismissedFailure !== `save:${saveFailure}`
        ? <Toast key={saveSequence} text={`${t('visionModelSaveFailed')}: ${saveFailure}`} holdMs={9000} onDone={() => { setDismissedFailure(`save:${saveFailure}`) }} />
        : loadFailure !== undefined && dismissedFailure !== `load:${loadFailure}`
          ? <Toast text={`${t('visionModelLoadFailed')}: ${loadFailure}`} holdMs={9000} onDone={() => { setDismissedFailure(`load:${loadFailure}`) }} /> : null}
    </div>
  )
}
