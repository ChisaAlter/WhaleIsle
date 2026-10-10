/** Install the owning feature's General Settings row. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { VisualRepliesSettings } from '../config.ts'
import { NS } from './locale.ts'
import { VisualRepliesRow, type VisualRepliesRowInjected } from './settings/VisualRepliesRow.tsx'

/**
 * Register the persisted opt-in switch through the shared configuration forms.
 * The caller owns locale registration and declares configForms and slots injections.
 * @param ctx - the visual-replies browser plugin context.
 */
export function installVisualRepliesSettings(ctx: Context): void {
  const settings = ctx.configForms.get<VisualRepliesSettings>(NS)
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'visual-replies',
    order: 35,
    locale: NS,
    inject: (): VisualRepliesRowInjected => ({
      hooks: { settings },
      setEnabled: (enabled) => settings.set('enabled', enabled),
    }),
  }, VisualRepliesRow))
}
