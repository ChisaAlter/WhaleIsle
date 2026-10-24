/** Interface Settings row for the composer send/think border beam. */
import { useId, useState, type ChangeEvent } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  IconSettingsOutline16, Switch, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ComposerBeamPresets, ComposerBeamStyle } from '../../submission-settings.ts'
import type { ConversationKey } from '../locales.ts'
import { BeamSettingsModal } from './BeamSettingsModal.tsx'
import css from './BeamRow.module.css'

/** Registration-side preference face. */
export interface BeamRowInjected {
  hooks: {
    /** Persisted composer-beam preference bound as useComposerBeam. */
    composerBeam: SnapshotStore<boolean>
    /** Persisted composer-beam visual tuning bound as useComposerBeamStyle. */
    composerBeamStyle: SnapshotStore<ComposerBeamStyle>
    /** Persisted user presets bound as useComposerBeamPresets. */
    composerBeamPresets: SnapshotStore<ComposerBeamPresets>
    /** Host writability bound as useWritable. */
    writable: SnapshotStore<boolean>
  }
  /** Change whether the composer plays the send/think border beam. */
  setComposerBeam: (value: boolean) => void
  /** Persist the active profile and user presets as one namespace mutation. */
  saveComposerBeamConfiguration: (value: ComposerBeamStyle, presets: ComposerBeamPresets) => Promise<void>
  /** Backward-compatible single-style setter for existing composition tests and callers. */
  setComposerBeamStyle: (value: ComposerBeamStyle) => void
}

/** Full Settings-row props. */
export type BeamRowProps =
  PropsRuntime<'settings.appearance.item'>
  & PropsLocale<'conversation'>
  & InjectFace<BeamRowInjected>

/**
 * Render the composer thinking-beam Switch.
 * @param props - composed Settings slot props.
 * @returns the preference row.
 */
/* jscpd:ignore-start */
export function BeamRow({
  useComposerBeam, useComposerBeamStyle, useComposerBeamPresets, useWritable,
  setComposerBeam, saveComposerBeamConfiguration, t,
}: BeamRowProps) {
  const enabled = useComposerBeam(value => value)
  const appearance = useComposerBeamStyle(value => value)
  const presets = useComposerBeamPresets(value => value)
  const writable = useWritable(value => value)
  const [panelOpen, setPanelOpen] = useState(false)
  const titleId = useId()
  const title: ConversationKey = 'settings.beam.title'
  const description: ConversationKey = 'settings.beam.description'

  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.title} id={titleId}>{t(title)}</div>
        <div className={css.desc}>{t(description)}</div>
      </div>
      <div className={css.actions}>
        <Tooltip label={t('settings.beam.configure')} side="top" delayMs={500}>
          <button
            type="button"
            className={css.settingsButton}
            aria-label={t('settings.beam.configure')}
            disabled={!writable}
            onClick={() => { setPanelOpen(true) }}
          >
            <IconSettingsOutline16 size={16} />
          </button>
        </Tooltip>
        <Switch
          checked={enabled}
          disabled={!writable}
          aria-labelledby={titleId}
          onChange={(event: ChangeEvent<HTMLInputElement>) => {
            setComposerBeam(event.target.checked)
          }}
        />
      </div>
      <BeamSettingsModal
        open={panelOpen}
        value={appearance}
        presets={presets}
        onClose={() => { setPanelOpen(false) }}
        onSave={saveComposerBeamConfiguration}
        t={t}
      />
    </div>
  )
}
/* jscpd:ignore-end */
