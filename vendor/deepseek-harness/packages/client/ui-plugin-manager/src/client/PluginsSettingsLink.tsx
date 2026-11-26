/** The Settings navigation entry that lets the user open the Plugins workspace page on demand. */
import type { ReactNode } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: the `settings.section` declaration this entry registers into.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { en, type PluginManagerLocaleKey } from './locales.ts'
import css from './PluginsSettingsLink.module.css'

/** What the entry receives from the plugin manager. */
export interface PluginsSettingsLinkInjected {
  /** Show the Plugins page's main list. */
  readonly openPlugins: () => void
  /** Bound pluginManager locale lookup; falls back to English in isolated tests. */
  readonly t?: (key: PluginManagerLocaleKey) => string
}

/** Full component props assembled by the settings shell. */
export type PluginsSettingsLinkProps = PropsRuntime<'settings.section'> & InjectFace<PluginsSettingsLinkInjected>

/**
 * Render an in-Settings summary card with an explicit action to open the full Plugins page.
 * Navigating inside a mount effect would hijack Settings selection and Settings search indexing.
 * @param props - the shell's close action and the injected navigation.
 * @returns the in-Settings Plugins landing card.
 */
export function PluginsSettingsLink({ close, openPlugins, t }: PluginsSettingsLinkProps): ReactNode {
  const copy = t ?? (key => en[key])
  return (
    <section className={css.section} aria-label={copy('settingsEntry')}>
      <h2 className={css.heading}>{copy('settingsEntry')}</h2>
      <p className={css.intro}>{copy('intro')}</p>
      <div className={css.card}>
        <div className={css.cardText}>
          <div className={css.cardTitle}>{copy('infoLabel')}</div>
          <div className={css.cardHint}>{copy('settingsPageSummary')}</div>
        </div>
        <Button
          size="md"
          variant="primary"
          onClick={() => {
            close()
            openPlugins()
          }}
        >
          {copy('settingsOpenPlugins')}
        </Button>
      </div>
    </section>
  )
}
