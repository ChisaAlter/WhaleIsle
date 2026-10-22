/**
 * 桌宠 settings section: the Live2D companion's appearance, behavior, and
 * integration rows inside the desktop Settings shell. All writes ride the
 * shell's `saveLive2dPetSettings` channel so the pet manager normalizes,
 * persists, and pushes to the live overlay at once.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Button, SegmentedTabs, SettingsSelect, Switch, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { desktopShell } from './desktop-shell.ts'
import type { Live2dPetSettings, Live2dPetSettingsResult } from './desktop-shell.ts'
import css from './PetSection.module.css'

/** One catalog provider's model row, as `remote.session.modelCatalog` serves it. */
interface PetCatalogGroup {
  id: string
  name: string
  models: readonly { id: string; name: string; inputModalities?: readonly string[] }[]
}

/** Registrant-owned dependencies of {@link PetSection}. */
export interface PetSectionInjected {
  /** Read the session model catalog; the look picker lists image-capable routes. */
  modelCatalog: () => Promise<{
    ok: boolean
    value?: { groups?: readonly PetCatalogGroup[] }
    error?: { message?: string }
  }>
}

/** Props the Settings renderer binds for this section. */
export type PetSectionProps =
  PropsRuntime<'settings.section'> & PropsRenderSlots<'settings.pet.item'>
  & PropsLocale<'settings'> & InjectFace<PetSectionInjected>

const SCALE_OPTIONS = ['0.6', '0.8', '1', '1.2', '1.4', '1.6']
const OPACITY_OPTIONS = ['0.3', '0.5', '0.7', '0.85', '1']
const PERSONALITY_OPTIONS = [
  ['natural', 'pet.personality.natural'],
  ['genki', 'pet.personality.genki'],
  ['tsundere', 'pet.personality.tsundere'],
  ['poison', 'pet.personality.poison'],
] as const
const ACTIVITY_OPTIONS = [
  ['quiet', 'pet.activity.quiet'],
  ['balanced', 'pet.activity.balanced'],
  ['active', 'pet.activity.active'],
] as const
const TOGGLE_ROWS = [
  ['powerSave', 'pet.powerSave'],
  ['clickSound', 'pet.clickSound'],
] as const
const DRAG_OPTIONS = [
  ['free', 'pet.dragFree'],
  ['shift', 'pet.dragShift'],
  ['locked', 'pet.dragLocked'],
] as const

/** One image-capable catalog route flattened for the look picker. */
interface LookRoute {
  provider: string
  providerName: string
  model: string
  modelName: string
}

/** '\n' cannot appear in either id, so it is the stable route separator. */
function routeId(provider: string, model: string): string {
  return `${provider}\n${model}`
}

/** Flat Setting-Cell row: title (+ optional desc) left, control right. */
function Row({ title, desc, error, children }: {
  title: string
  desc?: string | undefined
  error?: string | undefined
  children?: ReactNode
}): ReactNode {
  return (
    <div className={css.item} title={error}>
      <div className={css.itemText}>
        <div className={css.itemTitle}>{title}</div>
        {desc ? <div className={css.itemDesc} title={desc}>{desc}</div> : null}
      </div>
      {children}
    </div>
  )
}

/** Render the whale settings column: every control writes through on change. */
export function PetSection({ t, modelCatalog, renderSlot }: PetSectionProps): ReactNode {
  const shell = desktopShell()
  const [enabled, setEnabled] = useState(true)
  const [settings, setSettings] = useState<Live2dPetSettings>({})
  const [whaleAssistant, setWhaleAssistant] = useState(false)
  const [lookRoutes, setLookRoutes] = useState<readonly LookRoute[] | undefined>(undefined)
  const [lookLoadError, setLookLoadError] = useState('')
  const [error, setError] = useState('')
  const [readError, setReadError] = useState('')
  const [configLoading, setConfigLoading] = useState(Boolean(shell?.getConfig))
  const [saving, setSaving] = useState<string | null>(null)
  const [whaleBusy, setWhaleBusy] = useState(false)
  const [whaleError, setWhaleError] = useState('')
  const [notice, setNotice] = useState<{ id: number; text: string } | null>(null)
  const noticeId = useRef(0)
  const [view, setView] = useState<'assistant' | 'desktop'>('assistant')

  useEffect(() => {
    let cancelled = false
    void shell?.getConfig?.().then((config) => {
      if (cancelled) return
      setEnabled(config?.live2dPet?.enabled !== false)
      setSettings(config?.live2dPet?.settings ?? {})
      setWhaleAssistant(config?.whaleAssistantEnabled === true)
      setReadError('')
    }).catch((caught: unknown) => {
      if (cancelled) return
      const message = caught instanceof Error ? caught.message : String(caught)
      setReadError(message)
      setNotice({ id: ++noticeId.current, text: t('feedback.readError', { message }) })
    }).finally(() => { if (!cancelled) setConfigLoading(false) })
    return () => { cancelled = true }
  }, [shell, t])

  // The look picker rides the session model catalog — the same source the
  // Models section's vision picker filters on 'image'.
  useEffect(() => {
    if (typeof modelCatalog !== 'function') return
    let cancelled = false
    void modelCatalog().then((res) => {
      if (cancelled) return
      if (!res?.ok || !res.value) {
        const message = res?.error?.message || 'failed'
        setLookLoadError(message)
        setNotice({ id: ++noticeId.current, text: t('pet.lookModelLoadFailed', { message }) })
        return
      }
      setLookLoadError('')
      setLookRoutes((res.value.groups ?? []).flatMap(group => group.models
        .filter(model => model.inputModalities?.includes('image') === true)
        .map(model => ({
          provider: group.id,
          providerName: group.name,
          model: model.id,
          modelName: model.name,
        }))))
    }).catch((err: unknown) => {
      if (cancelled) return
      const message = err instanceof Error ? err.message : String(err)
      setLookLoadError(message)
      setNotice({ id: ++noticeId.current, text: t('pet.lookModelLoadFailed', { message }) })
    })
    return () => { cancelled = true }
  }, [modelCatalog, t])

  // Every write returns the normalized settings — the local echo comes from
  // the same object the pet window just received.
  const save = useCallback(async (body: {
    enabled?: boolean
    patch?: Live2dPetSettings
    reset?: boolean
  }): Promise<Live2dPetSettingsResult | undefined> => {
    if (!shell?.saveLive2dPetSettings) return undefined
    setSaving(body.reset ? 'reset' : body.enabled !== undefined ? 'enabled' : Object.keys(body.patch ?? {})[0] ?? null)
    try {
      const res = await shell.saveLive2dPetSettings(body)
      if (res?.ok === true) {
        setError('')
        if (typeof res.enabled === 'boolean') setEnabled(res.enabled)
        if (res.settings) setSettings(res.settings)
        setNotice(null)
      } else {
        const message = res?.reason || 'failed'
        setError(message)
        setNotice({ id: ++noticeId.current, text: t('pet.saveError', { message }) })
      }
      return res
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      setNotice({ id: ++noticeId.current, text: t('pet.saveError', { message }) })
      return undefined
    } finally {
      setSaving(null)
    }
  }, [shell, t])

  const patch = useCallback((next: Live2dPetSettings) => {
    setSettings(prev => ({ ...prev, ...next }))
    void save({ patch: next })
  }, [save])

  // Select commits the whole route (provider + model) so the stored pick
  // round-trips exactly; 'off' clears both fields.
  const onLookChange = useCallback((id: string) => {
    if (id === '') {
      patch({ lookModel: '', lookProvider: '' })
      return
    }
    const [provider = '', model = ''] = id.split('\n')
    if (model === '') return // stale-route sentinel — display only
    patch({ lookModel: model, lookProvider: provider })
  }, [patch])

  const lookModel = settings.lookModel ?? ''
  const lookProvider = settings.lookProvider ?? ''
  const known = lookRoutes ?? []
  let lookValue = ''
  if (lookModel !== '') {
    if (lookProvider !== '') {
      lookValue = routeId(lookProvider, lookModel)
    } else {
      // A provider-less stored model (legacy or hand-written config) adopts
      // the route when exactly one catalog group offers it.
      const matches = known.filter(route => route.model === lookModel)
      const only = matches.length === 1 ? matches[0] : undefined
      if (only !== undefined) lookValue = routeId(only.provider, only.model)
    }
  }
  const stale = lookModel !== ''
    && !known.some(route => routeId(route.provider, route.model) === lookValue)
    ? {
      id: lookValue === '' ? `\n${lookModel}` : lookValue,
      label: lookProvider === '' ? lookModel : `${lookProvider} / ${lookModel}`,
    }
    : undefined
  const lookCurrent = lookValue === '' && stale !== undefined ? stale.id : lookValue

  const toggleWhale = useCallback((next: boolean) => {
    if (!shell?.saveConfig) return
    const previous = whaleAssistant
    setWhaleAssistant(next)
    setWhaleBusy(true)
    void shell.saveConfig({ whaleAssistantEnabled: next }).then(saved => {
      if (saved.whaleAssistantEnabled !== next) {
        setWhaleAssistant(typeof saved.whaleAssistantEnabled === 'boolean' ? saved.whaleAssistantEnabled : previous)
        const text = t(saved.restartCancelled === true ? 'feedback.restartCancelled' : 'feedback.notSaved')
        setWhaleError(text)
        setNotice({ id: ++noticeId.current, text })
        return
      }
      setWhaleError('')
      setNotice(null)
    }).catch((caught: unknown) => {
      setWhaleAssistant(previous)
      const text = t('feedback.saveError', { message: caught instanceof Error ? caught.message : String(caught) })
      setWhaleError(text)
      setNotice({ id: ++noticeId.current, text })
    }).finally(() => { setWhaleBusy(false) })
  }, [shell, t, whaleAssistant])

  const blocked = configLoading || saving !== null || whaleBusy

  return (
    <div className={css.section} title={readError ? t('feedback.readError', { message: readError }) : undefined}>
      <h2 className={css.heading}>{t('pet.nav')}</h2>
      <p className={css.intro}>{t('pet.intro')}</p>
      <SegmentedTabs
        label={t('pet.nav')}
        items={[
          { value: 'assistant', label: t('pet.tab.assistant'), id: 'whale-settings-assistant-tab', panelId: 'whale-settings-assistant-panel' },
          { value: 'desktop', label: t('pet.tab.desktop'), id: 'whale-settings-desktop-tab', panelId: 'whale-settings-desktop-panel' },
        ]}
        value={view}
        onChange={setView}
        className={css.tabs}
      />
      <div id="whale-settings-assistant-panel" role="tabpanel" aria-labelledby="whale-settings-assistant-tab" hidden={view !== 'assistant'} className={css.panel}>
        <div className={css.form}>
          <div className={css.group}>{t('pet.group.assistant')}</div>
          <Row title={t('pet.whaleAssistant')} desc={t('pet.whaleAssistantDesc')}>
            <Switch
              label={t('pet.whaleAssistant')}
              checked={whaleAssistant}
              disabled={blocked}
              loading={configLoading || whaleBusy}
              title={whaleError || undefined}
              onChange={toggleWhale}
            />
          </Row>
          {renderSlot('settings.pet.item', {})}
        </div>
      </div>
      <div id="whale-settings-desktop-panel" role="tabpanel" aria-labelledby="whale-settings-desktop-tab" hidden={view !== 'desktop'} className={css.panel}>
        <div className={css.form}>
          <div className={css.group}>{t('pet.group.look')}</div>
          <Row title={t('pet.enabled')} desc={t('pet.enabledDesc')}>
            <Switch
              label={t('pet.enabled')}
              checked={enabled}
              disabled={blocked}
              loading={configLoading || saving === 'enabled'}
              onChange={(next: boolean) => { setEnabled(next); void save({ enabled: next }) }}
            />
          </Row>

          <Row title={t('pet.scaleOpacity')}>
            <SettingsSelect
              variant="inline"
              align="end"
              aria-label={t('pet.scale')}
              disabled={blocked}
              loading={configLoading || saving === 'scale'}
              value={String(settings.scale ?? 1)}
              options={SCALE_OPTIONS.map(v => ({ id: v, label: `${Math.round(Number(v) * 100)}%` }))}
              onChange={(id) => patch({ scale: Number(id) })}
            />
            <SettingsSelect
              variant="inline"
              align="end"
              aria-label={t('pet.opacity')}
              disabled={blocked}
              loading={configLoading || saving === 'opacity'}
              value={String(settings.opacity ?? 1)}
              options={OPACITY_OPTIONS.map(v => ({ id: v, label: `${Math.round(Number(v) * 100)}%` }))}
              onChange={(id) => patch({ opacity: Number(id) })}
            />
          </Row>
          <Row title={t('pet.personality')} desc={t('pet.personalityDesc')}>
            <SettingsSelect
              variant="inline"
              align="end"
              aria-label={t('pet.personality')}
              disabled={blocked}
              loading={configLoading || saving === 'personality'}
              value={settings.personality ?? 'natural'}
              options={PERSONALITY_OPTIONS.map(([id, key]) => ({ id, label: t(key) }))}
              onChange={(id) => patch({ personality: id })}
            />
          </Row>
          <div className={css.group}>{t('pet.group.behavior')}</div>
          <Row title={t('pet.activity')} desc={t('pet.activityDesc')}>
            <SettingsSelect
              variant="inline"
              align="end"
              aria-label={t('pet.activity')}
              disabled={blocked}
              loading={configLoading || saving === 'activity'}
              value={settings.activity ?? 'balanced'}
              options={ACTIVITY_OPTIONS.map(([id, key]) => ({ id, label: t(key) }))}
              onChange={(id) => patch({ activity: id })}
            />
          </Row>
          <Row title={t('pet.autonomy')} desc={t('pet.autonomyDesc')}>
            <span className={css.miniToggle}>
              <span>{t('pet.selfTalk')}</span>
              <Switch
                label={t('pet.selfTalk')}
                checked={settings.selfTalk === true}
                disabled={blocked}
                loading={configLoading || saving === 'selfTalk'}
                onChange={(next: boolean) => patch({ selfTalk: next })}
              />
            </span>
            <span className={css.miniToggle}>
              <span>{t('pet.wander')}</span>
              <Switch
                label={t('pet.wander')}
                checked={settings.wander === true}
                disabled={blocked}
                loading={configLoading || saving === 'wander'}
                onChange={(next: boolean) => patch({ wander: next })}
              />
            </span>
          </Row>
          <Row title={t('pet.dragMode')} desc={t('pet.dragModeDesc')}>
            <SettingsSelect
              variant="inline"
              align="end"
              aria-label={t('pet.dragMode')}
              disabled={blocked}
              loading={configLoading || saving === 'lockPosition'}
              value={settings.lockPosition === true
                ? 'locked'
                : settings.shiftToDrag === true ? 'shift' : 'free'}
              options={DRAG_OPTIONS.map(([id, key]) => ({ id, label: t(key) }))}
              onChange={(id) => patch(id === 'locked'
                ? { lockPosition: true, shiftToDrag: false }
                : id === 'shift'
                  ? { lockPosition: false, shiftToDrag: true }
                  : { lockPosition: false, shiftToDrag: false })}
            />
          </Row>
          {TOGGLE_ROWS.map(([key, labelKey]) => (
            <Row
              key={key}
              title={t(labelKey)}
              desc={key === 'powerSave' ? t('pet.powerSaveDesc') : undefined}
            >
              <Switch
                label={t(labelKey)}
                checked={settings[key] === true}
                disabled={blocked}
                loading={configLoading || saving === key}
                onChange={(next: boolean) => patch({ [key]: next })}
              />
            </Row>
          ))}

          <div className={css.group}>{t('pet.group.link')}</div>
          <Row title={t('pet.chat')} desc={t('pet.chatDesc')}>
            <Switch
              label={t('pet.chat')}
              checked={settings.chatEnabled === true}
              disabled={blocked}
              loading={configLoading || saving === 'chatEnabled'}
              onChange={(next: boolean) => patch({ chatEnabled: next })}
            />
          </Row>
          <Row title={t('pet.lookModel')} desc={t('pet.lookModelDesc')}
            error={lookLoadError ? t('pet.lookModelLoadFailed', { message: lookLoadError }) : undefined}>
            <SettingsSelect
              variant="inline"
              align="end"
              aria-label={t('pet.lookModel')}
              disabled={blocked || (lookRoutes === undefined && lookLoadError === '')}
              loading={configLoading || saving === 'lookModel' || (lookRoutes === undefined && lookLoadError === '')}
              value={lookCurrent}
              placeholder={t('pet.lookModelOff')}
              options={[
                { id: '', label: t('pet.lookModelOff') },
                ...stale === undefined ? [] : [stale],
                ...known.map(route => ({
                  id: routeId(route.provider, route.model),
                  label: `${route.providerName} / ${route.modelName}`,
                })),
              ]}
              onChange={onLookChange}
            />
          </Row>

          <div className={css.actions}>
            <Button
              variant="outline"
              size="sm"
              disabled={blocked}
              loading={saving === 'reset'}
              title={error ? t('pet.saveError', { message: error }) : undefined}
              onClick={() => {
                void save({ reset: true })
              }}
            >
              {t('pet.reset')}
            </Button>
          </div>
        </div>
      </div>
      {notice !== null && <Toast key={notice.id} text={notice.text} onDone={() => { setNotice(null) }} />}
    </div>
  )
}
