import { echartEngineFor } from '../echarts-engine.ts'
import type { GenuiSpec } from '../spec.ts'
import { GENUI_NATIVE_TYPES } from '../genui-runtime/schema.ts'
import { ICONS } from '../icons/icon-data.ts'
import { safeMediaSrc } from '../genui-runtime/value-utils.ts'
import { walkGenuiNodes } from '../walk-spec.ts'
import type { GenuiPortabilityReport, GenuiStandaloneAsset } from './types.ts'

const ASSET_ORDER: GenuiStandaloneAsset[] = ['mermaid', 'three', 'echarts-core', 'echarts-full', 'icons']
/** Inspect actual renderer nodes; component data is never traversed as UI. */
export function analyzeGenuiPortability(spec: GenuiSpec): GenuiPortabilityReport {
  const report: GenuiPortabilityReport = { requiredAssets: [], customTypes: [], externalMedia: [], hasModelActions: false }
  const assets = new Set<GenuiStandaloneAsset>()
  walkGenuiNodes(spec, node => {
    if (!GENUI_NATIVE_TYPES.has(node.type)) report.customTypes.push(node.type)
    if (node.type === 'mermaid') assets.add('mermaid')
    if (node.type === 'scene3d') assets.add('three')
    if (node.type === 'echart') assets.add(echartEngineFor(node))
    if (node.type === 'icon' && !Object.hasOwn(ICONS, node.name)) assets.add('icons')
    if ('action' in node && typeof node.action === 'string' || node.type === 'submit' && typeof node.resetAction === 'string') report.hasModelActions = true
    if (node.type === 'image' || node.type === 'audio' || node.type === 'video') {
      const src = safeMediaSrc(node.src)
      if (src !== undefined) report.externalMedia.push(src)
      if (node.type === 'video') {
        const poster = safeMediaSrc(node.poster)
        if (poster !== undefined) report.externalMedia.push(poster)
      }
    }
  })
  report.requiredAssets = ASSET_ORDER.filter(name => assets.has(name))
  report.customTypes = [...new Set(report.customTypes)]
  report.externalMedia = [...new Set(report.externalMedia)]
  return report
}
