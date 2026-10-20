import { processGenuiSpec } from '../guard.ts'
import type { BlockInteractionState } from '../interaction-state.ts'
import { GENUI_ARTIFACT_FORMAT, GENUI_ARTIFACT_VERSION, type GenuiArtifactTheme, type GenuiArtifactV1 } from './types.ts'
import { createGenuiArtifact } from './create.ts'

/** 判断值是否为普通记录对象。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 验证 artifact 持久化交互状态的字段类型。 */
function validState(value: unknown): boolean {
  if (!isRecord(value)) return false
  if (value.answers !== undefined && (!isRecord(value.answers) || !Object.values(value.answers).every(item => typeof item === 'string'))) return false
  if (value.multiAnswers !== undefined && (!isRecord(value.multiAnswers) || !Object.values(value.multiAnswers).every(item => Array.isArray(item) && item.every(entry => typeof entry === 'string')))) return false
  if (value.locked !== undefined && typeof value.locked !== 'boolean') return false
  if (value.componentState !== undefined && !isRecord(value.componentState)) return false
  return value.fields === undefined || (isRecord(value.fields) && Object.values(value.fields).every(item => typeof item === 'string'))
}

/** 校验 artifact 格式并重新执行当前 GenUI 规范化流程。 */
export function parseGenuiArtifact(value: unknown): GenuiArtifactV1 | null {
  if (!isRecord(value) || value.format !== GENUI_ARTIFACT_FORMAT || value.version !== GENUI_ARTIFACT_VERSION || !isRecord(value.presentation)) return null
  if (value.presentation.locale !== 'en' && value.presentation.locale !== 'zh') return null
  if (value.presentation.theme !== 'light' && value.presentation.theme !== 'dark') return null
  if (value.state !== undefined && !validState(value.state)) return null
  const processed = processGenuiSpec(value.spec)
  // JSON may preserve unsupported opaque records. It is data interchange,
  // not a claim that the standalone renderer can display these components.
  const supportErrors = new Set(processed.unsupportedComponents.map(diagnostic => diagnostic.message))
  if (processed.spec === null || processed.errors.some(error => !supportErrors.has(error))) return null
  return createGenuiArtifact(processed.spec, value.state as BlockInteractionState | undefined, {
    locale: value.presentation.locale,
    theme: value.presentation.theme as GenuiArtifactTheme,
  })
}
