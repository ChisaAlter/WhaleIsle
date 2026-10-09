/** Host-owned live preference for generating visual replies. */
import type { Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'

/** Stable profile entry and configuration-form namespace. */
export const VISUAL_REPLIES_SETTINGS_NAMESPACE = 'visual-replies'

/** Profile field that authorizes new visual-reply operations. */
export const VISUAL_REPLIES_ENABLED_FIELD = 'enabled'

/** Accepted configuration values projected to the browser. */
export interface VisualRepliesSettings {
  /** Allow new generation, preview, and publication; saved replies remain readable. Screenshot inspection requires an image-capable route. */
  enabled: boolean
}

/** The executor reads this reference at each operation's decision point. */
export interface Config {
  /** Only the explicit true value authorizes new visual-reply operations. */
  enabled: Volatile<boolean>
}

/** Opt in through settings; updates apply without remounting the plugin. */
export const Config = z.object({
  [VISUAL_REPLIES_ENABLED_FIELD]: z.boolean().default(false).volatile(),
})
