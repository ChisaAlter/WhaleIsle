/** Host half of Visual replies; historical page reads are owned by Session API. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { Config, VISUAL_REPLIES_SETTINGS_NAMESPACE } from './config.ts'
import { registerVisualReplyTools, VISUAL_REPLY_PAGE_GUIDE } from './tools.ts'

export { Config }
export const name = 'ui-visual-replies'
export const inject = ['tools', 'fs', 'attachments', 'systemPrompt']

export function apply(ctx: Context, config: Config): void {
  let disposeTools: (() => void) | undefined
  const syncTools = () => {
    if (config.enabled.get() && disposeTools === undefined) disposeTools = registerVisualReplyTools(ctx, config)
    else if (!config.enabled.get() && disposeTools !== undefined) {
      disposeTools()
      disposeTools = undefined
    }
  }
  syncTools()
  ctx.effect(() => () => { disposeTools?.(); disposeTools = undefined })
  ctx.on('settings/document-updated', ns => { if (ns === VISUAL_REPLIES_SETTINGS_NAMESPACE) syncTools() })
  ctx.inject(['settings'], child => {
    child.effect(() => child.settings.configure({ auto: false }, ctx.fiber))
  })
  ctx.systemPrompt.section({
    name: 'visual-replies', order: 80,
    text: () => config.enabled.get()
      ? 'Visual replies are enabled. When a diagram, interactive explanation, comparison, chart, or calculator helps, create a visual reply. Use ordinary text for answers that do not benefit from a visual or interaction. Call html_preview, inspect the screenshot and console feedback, fix issues, then call html_render before your written reply. The published page is interactive in the conversation. Do not repeat its entire contents in prose. ' + VISUAL_REPLY_PAGE_GUIDE
      : '',
  })
}
