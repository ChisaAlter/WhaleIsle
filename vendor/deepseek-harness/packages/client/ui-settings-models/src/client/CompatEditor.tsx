/**
 * Key compatibility override switches for `llm-pi-ai` provider profiles.
 * Unset fields remain omitted so pi-ai preserves protocol/endpoint auto-detection.
 */

import { useState } from 'react'
import type { ReactNode } from 'react'
import type { SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import { Button, IconChevronDownOutlineRegular, IconChevronRightOutlineRegular, SettingsSelect } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SettingsSchemaOperations } from './schema-operations.ts'
import type { en, ModelsKey } from './locales.ts'
import styles from './ModelsSection.module.css'

const PROBE_ROUTE = '\u0000probe'

const CANONICAL_MAX_TOKENS_FIELDS = ['max_completion_tokens', 'max_tokens'] as const

const CANONICAL_THINKING_FORMATS = [
  'openai',
  'deepseek',
  'openrouter',
  'together',
  'baseten',
  'zai',
  'qwen',
  'chat-template',
  'qwen-chat-template',
  'string-thinking',
  'ant-ling',
] as const

export type CompatFieldKey =
  | 'supportsDeveloperRole'
  | 'supportsReasoningEffort'
  | 'requiresReasoningContentOnAssistantMessages'
  | 'maxTokensField'
  | 'thinkingFormat'
  | 'supportsStrictMode'
  | 'allowEmptySignature'

interface CompatFieldDescriptor {
  readonly key: CompatFieldKey
  readonly kind: 'boolean' | 'enum'
  readonly labelKey: ModelsKey
  readonly protocols: readonly string[]
  readonly fallbackChoices?: readonly string[]
}

const COMPAT_FIELDS: readonly CompatFieldDescriptor[] = [
  {
    key: 'supportsDeveloperRole',
    kind: 'boolean',
    labelKey: 'compatSupportsDeveloperRole',
    protocols: ['openai-completions', 'openai-responses', 'azure-openai-responses', 'openai-codex-responses'],
  },
  {
    key: 'supportsReasoningEffort',
    kind: 'boolean',
    labelKey: 'compatSupportsReasoningEffort',
    protocols: ['openai-completions'],
  },
  {
    key: 'requiresReasoningContentOnAssistantMessages',
    kind: 'boolean',
    labelKey: 'compatRequiresReasoningContent',
    protocols: ['openai-completions'],
  },
  {
    key: 'maxTokensField',
    kind: 'enum',
    labelKey: 'compatMaxTokensField',
    protocols: ['openai-completions'],
    fallbackChoices: CANONICAL_MAX_TOKENS_FIELDS,
  },
  {
    key: 'thinkingFormat',
    kind: 'enum',
    labelKey: 'compatThinkingFormat',
    protocols: ['openai-completions'],
    fallbackChoices: CANONICAL_THINKING_FORMATS,
  },
  {
    key: 'supportsStrictMode',
    kind: 'boolean',
    labelKey: 'compatSupportsStrictMode',
    protocols: [
      'openai-completions',
      'openai-responses',
      'azure-openai-responses',
      'openai-codex-responses',
      'bedrock-converse-stream',
    ],
  },
  {
    key: 'allowEmptySignature',
    kind: 'boolean',
    labelKey: 'compatAllowEmptySignature',
    protocols: ['anthropic-messages'],
  },
]

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Extract a plain compat dictionary from draft/profile state, or `undefined` when empty. */
export function compatFromValue(value: unknown): Record<string, unknown> | undefined {
  if (!isPlainRecord(value)) return undefined
  const entries = Object.entries(value).filter(([, v]) => v !== undefined)
  return entries.length === 0 ? undefined : Object.fromEntries(entries)
}

/** Remove compat overrides unsupported by an explicit protocol (or omit when empty). */
export function filterCompatForProtocol(
  value: unknown,
  protocol: string | undefined,
): Record<string, unknown> | undefined {
  const current = compatFromValue(value)
  if (current === undefined) return undefined
  if (protocol === undefined || protocol === '') return current
  const allowed = new Set(
    COMPAT_FIELDS
      .filter(field => field.protocols.includes(protocol))
      .map(field => field.key as string),
  )
  const kept = Object.entries(current).filter(([key]) => allowed.has(key))
  return kept.length === 0 ? undefined : Object.fromEntries(kept)
}

function schemaEnumChoices(
  namespace: SettingsNamespaceView | undefined,
  schema: SettingsSchemaOperations | undefined,
  field: CompatFieldKey,
  fallback: readonly string[],
): readonly string[] {
  if (namespace === undefined || schema === undefined) return fallback
  const node = schema.nodeAtPath(
    schema.rehydrate(namespace.schema),
    ['providers', PROBE_ROUTE, 'compat', field],
  ) as { type?: string; list?: readonly { value?: unknown }[] } | undefined
  if (node?.type !== 'union' || node.list === undefined) return fallback
  const choices = node.list
    .map(entry => entry.value)
    .filter((item): item is string => typeof item === 'string')
  return choices.length > 0 ? choices : fallback
}

/** Props of {@link CompatEditor}. */
export interface CompatEditorProps {
  /** Current `compat` profile subtree. */
  compat: unknown
  /** Active wire protocol when the route names one (`undefined` for catalog multi-protocol routes). */
  protocol?: string | undefined
  /** Optional namespace view for reading enum choices from schema. */
  namespace?: SettingsNamespaceView | undefined
  /** Settings schema helper matching `namespace`. */
  schema?: SettingsSchemaOperations | undefined
  /** Localized copy accessor. */
  t: (key: keyof typeof en) => string
  /** Disable all controls. */
  disabled?: boolean | undefined
  /** Update the `compat` object, or `undefined` to omit/unset it when empty. */
  onChange: (next: Record<string, unknown> | undefined) => void
}

function fieldOptions(
  field: CompatFieldDescriptor,
  namespace: SettingsNamespaceView | undefined,
  schema: SettingsSchemaOperations | undefined,
  t: (key: keyof typeof en) => string,
): { id: string; label: string }[] {
  if (field.kind === 'boolean') {
    return [
      { id: '', label: t('compatDefault') },
      { id: 'true', label: t('compatEnabled') },
      { id: 'false', label: t('compatDisabled') },
    ]
  }
  const choices = schemaEnumChoices(namespace, schema, field.key, field.fallbackChoices ?? [])
  return [
    { id: '', label: t('compatDefault') },
    ...choices.map(choice => ({ id: choice, label: choice })),
  ]
}

/**
 * Render the collapsible `compat` override controls for a `llm-pi-ai` provider.
 * @param props - current compat map, protocol scope, copy, and change callback.
 * @returns the compat section.
 */
export function CompatEditor(props: CompatEditorProps): ReactNode {
  const { compat, protocol, namespace, schema, t, disabled = false, onChange } = props
  const current = compatFromValue(compat) ?? {}
  const [expanded, setExpanded] = useState(() => Object.keys(current).length > 0)

  const visibleFields = COMPAT_FIELDS.filter(field =>
    protocol === undefined
    || protocol === ''
    || field.protocols.includes(protocol)
    || current[field.key] !== undefined)

  const setField = (key: CompatFieldKey, raw: string): void => {
    if (raw === '') {
      const entries = Object.entries(current).filter(([entryKey]) => entryKey !== key)
      onChange(entries.length === 0 ? undefined : Object.fromEntries(entries))
      return
    }
    const nextValue = raw === 'true' ? true : raw === 'false' ? false : raw
    onChange({ ...current, [key]: nextValue })
  }

  return (
    <div className={styles['compatSection']}>
      <Button
        size="sm"
        variant="ghost"
        className={styles['compatToggle']}
        icon={expanded ? <IconChevronDownOutlineRegular size={14} /> : <IconChevronRightOutlineRegular size={14} />}
        aria-expanded={expanded}
        onClick={() => { setExpanded(open => !open) }}
      >
        {t('compatTitle')}
      </Button>
      {!expanded ? null : (
        <div className={styles['compatBody']}>
          <span className={styles['advancedHint']}>{t('compatHint')}</span>
          {visibleFields.length === 0
            ? <span className={styles['advancedHint']}>{t('compatUnavailableForProtocol')}</span>
            : (
              <div className={styles['compatGrid']}>
                {visibleFields.map((field) => {
                  const stored = current[field.key]
                  const value = field.kind === 'boolean'
                    ? (typeof stored === 'boolean' ? String(stored) : '')
                    : (typeof stored === 'string' ? stored : '')
                  return (
                    <div key={field.key} className={styles['modelField']}>
                      <span className={styles['modelFieldLabel']}>{t(field.labelKey)}</span>
                      <SettingsSelect
                        variant="block"
                        aria-label={t(field.labelKey)}
                        value={value}
                        disabled={disabled}
                        onChange={(selected) => { setField(field.key, selected) }}
                        options={fieldOptions(field, namespace, schema, t)}
                      />
                    </div>
                  )
                })}
              </div>
            )}
        </div>
      )}
    </div>
  )
}
