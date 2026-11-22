/**
 * Custom HTTP headers key-value editor for `llm-pi-ai` provider profiles.
 * Empty tables omit `headers` (`undefined`) so profile diffs `unset` cleared
 * headers cleanly instead of persisting an empty dictionary.
 */

import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Button, IconPlusOutlineRegular, IconTrashOutlineRegular, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { en } from './locales.ts'
import styles from './ModelsSection.module.css'

/** One editable HTTP header row. */
export interface HeaderRow {
  readonly id: number
  readonly name: string
  readonly value: string
}

/** Extract string header entries from a stored profile value, or `undefined` when empty. */
export function headersFromValue(value: unknown): Readonly<Record<string, string>> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const entries = Object.entries(value as Record<string, unknown>)
    .filter((pair): pair is [string, string] => typeof pair[1] === 'string')
  if (entries.length === 0) return undefined
  return Object.fromEntries(entries)
}

function rowsFromRecord(
  record: Readonly<Record<string, string>> | undefined,
  nextId: () => number,
): HeaderRow[] {
  if (record === undefined) return []
  return Object.entries(record).map(([name, value]) => ({ id: nextId(), name, value }))
}

/** Validate editable header rows using the same Fetch `Headers` constraint as `llm-pi-ai`. */
export function validateHeaderRows(
  rows: readonly HeaderRow[],
  t: (key: keyof typeof en) => string,
): string | undefined {
  const seen = new Set<string>()
  for (const row of rows) {
    const name = row.name.trim()
    if (name.length === 0) return t('headerNameRequired')
    const lower = name.toLowerCase()
    if (seen.has(lower)) return t('headerDuplicate')
    seen.add(lower)
    try {
      new Headers([[name, row.value]])
    } catch {
      // Fetch rejects invalid HTTP header field names and control/multiline values.
      return t('headerInvalid')
    }
  }
  return undefined
}

/** Normalize valid header rows into a dictionary, or `undefined` when none exist. */
export function normalizeHeaderRows(rows: readonly HeaderRow[]): Readonly<Record<string, string>> | undefined {
  if (rows.length === 0) return undefined
  const record: Record<string, string> = {}
  for (const row of rows) {
    const name = row.name.trim()
    if (name.length > 0 && !(name in record)) {
      record[name] = row.value
    }
  }
  return Object.keys(record).length === 0 ? undefined : record
}

/** Props of {@link HeadersEditor}. */
export interface HeadersEditorProps {
  /** Current profile `headers` map from the draft. */
  headers: unknown
  /** Localized copy accessor. */
  t: (key: keyof typeof en) => string
  /** Disable all header edits. */
  disabled?: boolean | undefined
  /** Called whenever rows change with the normalized map (or undefined) and any validation error. */
  onChange: (next: Readonly<Record<string, string>> | undefined, error: string | undefined) => void
}

/**
 * Render the custom HTTP headers key-value pair editor.
 * @param props - current headers value, copy, disabled state, and change callback.
 * @returns the headers editor block.
 */
export function HeadersEditor(props: HeadersEditorProps): ReactNode {
  const { t, disabled = false, onChange } = props
  const nextIdRef = useRef(1)
  const allocId = (): number => {
    const id = nextIdRef.current
    nextIdRef.current += 1
    return id
  }

  const external = headersFromValue(props.headers)
  const externalKey = JSON.stringify(external ?? null)
  const lastEmittedRef = useRef(externalKey)
  const [rows, setRows] = useState<HeaderRow[]>(() => rowsFromRecord(external, allocId))

  useEffect(() => {
    if (externalKey === lastEmittedRef.current) return
    lastEmittedRef.current = externalKey
    setRows(rowsFromRecord(headersFromValue(props.headers), allocId))
  }, [externalKey, props.headers])

  const error = validateHeaderRows(rows, t)

  const commit = (nextRows: HeaderRow[]): void => {
    setRows(nextRows)
    const nextError = validateHeaderRows(nextRows, t)
    const normalized = nextError === undefined ? normalizeHeaderRows(nextRows) : headersFromValue(props.headers)
    lastEmittedRef.current = JSON.stringify(normalized ?? null)
    onChange(normalized, nextError)
  }

  return (
    <div className={styles['field']}>
      <div className={styles['headerHead']}>
        <span className={styles['fieldLabel']}>{t('headersTitle')}</span>
        <Button
          size="sm"
          variant="outline"
          icon={<IconPlusOutlineRegular size={14} />}
          disabled={disabled}
          onClick={() => { commit([...rows, { id: allocId(), name: '', value: '' }]) }}
        >
          {t('addHeader')}
        </Button>
      </div>
      <span className={styles['advancedHint']}>{t('headersHint')}</span>
      {rows.length === 0
        ? <span className={styles['advancedHint']}>{t('headersEmpty')}</span>
        : (
          <div className={styles['headerRows']}>
            {rows.map((row, index) => (
              <div key={row.id} className={styles['modelReasoningRow']}>
                <Input
                  variant="form"
                  className={styles['input']}
                  type="text"
                  value={row.name}
                  placeholder={t('headerNamePlaceholder')}
                  aria-label={`${t('headerName')} ${String(index + 1)}`}
                  aria-invalid={error !== undefined && row.name.trim().length === 0}
                  disabled={disabled}
                  onChange={(event) => {
                    const name = event.target.value
                    commit(rows.map(candidate => candidate.id === row.id ? { ...candidate, name } : candidate))
                  }}
                />
                <Input
                  variant="form"
                  className={styles['input']}
                  type="text"
                  value={row.value}
                  placeholder={t('headerValuePlaceholder')}
                  aria-label={`${t('headerValue')} ${String(index + 1)}`}
                  disabled={disabled}
                  onChange={(event) => {
                    const value = event.target.value
                    commit(rows.map(candidate => candidate.id === row.id ? { ...candidate, value } : candidate))
                  }}
                />
                <Button
                  size="sm"
                  className={`${styles['iconButton']} ${styles['dangerButton']}`}
                  icon={<IconTrashOutlineRegular size={16} />}
                  aria-label={`${t('removeHeader')} ${String(index + 1)}`}
                  disabled={disabled}
                  onClick={() => { commit(rows.filter(candidate => candidate.id !== row.id)) }}
                />
              </div>
            ))}
          </div>
        )}
      {error === undefined ? null : <p className={styles['error']}>{error}</p>}
    </div>
  )
}
