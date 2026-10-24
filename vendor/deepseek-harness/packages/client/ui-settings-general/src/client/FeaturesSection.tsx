/** The Built-in features section: one switch per feature that ships with the desktop. */
import type { PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './FeaturesSection.module.css'

/** Full component props: section owner share plus item render share. */
export type FeaturesSectionComponentProps =
  PropsRuntime<'settings.section'> & PropsRenderSlots<'settings.features.item'>

/**
 * Render the Built-in features section content column.
 * @param props - composed slot props (contract/slots.ts).
 * @returns the section element tree.
 */
export function FeaturesSection({ renderSlot }: FeaturesSectionComponentProps) {
  return (
    <div className={css.section}>
      {renderSlot('settings.features.item', {})}
    </div>
  )
}
