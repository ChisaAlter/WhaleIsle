import { currentLocale } from '../i18n/index.ts'
import { processGenuiSpec } from '../guard.ts'
import type { BlockInteractionState } from '../interaction-state.ts'
import { mapGenuiNodes } from '../walk-spec.ts'
import type { GenuiSpec } from '../spec.ts'
import { GenuiExportError, GENUI_ARTIFACT_FORMAT, GENUI_ARTIFACT_VERSION, type CreateGenuiArtifactOptions, type GenuiArtifactTheme, type GenuiArtifactV1 } from './types.ts'

/** 复制 durable 状态并移除密码字段。 */
function safeState(state: BlockInteractionState | undefined, secretIds: Set<string>): BlockInteractionState | undefined {
  if (state === undefined) return undefined
  const fields = Object.fromEntries(Object.entries(state.fields ?? {}).filter(([id]) => !secretIds.has(id)))
  return {
    ...(state.answers === undefined ? {} : { answers: { ...state.answers } }),
    ...(state.multiAnswers === undefined ? {} : { multiAnswers: Object.fromEntries(Object.entries(state.multiAnswers).map(([id, values]) => [id, [...values]])) }),
    ...(state.locked === undefined ? {} : { locked: state.locked }),
    ...(state.componentState === undefined ? {} : { componentState: structuredClone(state.componentState) }),
    ...(Object.keys(fields).length === 0 ? {} : { fields }),
  }
}

/** 创建规范化 artifact，并清除密码默认值及对应的持久化字段。 */
export function createGenuiArtifact(
  spec: GenuiSpec,
  state?: BlockInteractionState,
  options: CreateGenuiArtifactOptions = {},
): GenuiArtifactV1 {
  const processed = processGenuiSpec(spec)
  if (processed.spec === null) throw new GenuiExportError('artifact-invalid', 'invalid GenUI spec')
  const { panel: _panel, append: _append, ...portableSpec } = processed.spec
  const secretIds = new Set<string>()
  const sanitizedSpec = mapGenuiNodes(portableSpec, node => {
    if (node.type === 'input' && node.inputType === 'password') {
      if (node.id !== undefined) secretIds.add(node.id)
      delete node.value
    }
    return node
  })
  const theme: GenuiArtifactTheme = options.theme ?? (typeof document !== 'undefined' && document.body.hasAttribute('data-ds-dark-theme') ? 'dark' : 'light')
  const sanitizedState = safeState(state, secretIds)
  return {
    format: GENUI_ARTIFACT_FORMAT,
    version: GENUI_ARTIFACT_VERSION,
    spec: sanitizedSpec,
    ...(sanitizedState === undefined ? {} : { state: sanitizedState }),
    presentation: { locale: options.locale ?? currentLocale(), theme },
  }
}
