/**
 * SettingsSelect: Setting-Cell Selector pill (figma Selector h36 r18) backed by
 * {@link Menu}. Replaces native `<select>` in settings forms so the open list
 * uses the shared menu surface instead of the OS dropdown.
 */

import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import clsx from 'clsx'
import { FlipText } from './FlipText.tsx'
import { IconChevronDownOutlineRegular } from './icons/index.tsx'
import { Menu } from './Menu.tsx'
import { StateDot } from './StateDot.tsx'
import css from './SettingsSelect.module.css'

/** One selectable row. */
export interface SettingsSelectOption {
  /** Stable option id (also the value written on change). */
  id: string
  /** Visible label. */
  label: string
  /** Non-selectable row. */
  disabled?: boolean
}

/** Props of {@link SettingsSelect}. */
export interface SettingsSelectProps {
  /** Keep the selected label and replace the chevron while a write is pending. */
  loading?: boolean | undefined
  /** Currently selected option id, or empty when none. */
  value: string
  /** Options shown in the menu. */
  options: readonly SettingsSelectOption[]
  /** Commit a new selection. */
  onChange: (id: string) => void
  /** Accessible name of the trigger. */
  'aria-label': string
  /** Disable the trigger and block opens. */
  disabled?: boolean
  /**
   * Label shown when `value` is empty or matches no option.
   * Defaults to an empty string so the trigger stays a blank pill.
   */
  placeholder?: string
  /**
   * `inline` — compact pill (Setting-Cell trailing control).
   * `block` — full-width trigger for form fields (vision model, protocol, …).
   */
  variant?: 'inline' | 'block'
  /**
   * Menu alignment relative to the trigger.
   * Trailing Setting-Cell pills use `end` so the list stays on the control.
   */
  align?: 'start' | 'end'
  /** Extra class on the outer wrapper. */
  className?: string | undefined
}

/**
 * Render a Menu-backed settings selector.
 * @param props - value, options, and chrome.
 * @returns the selector.
 */
export function SettingsSelect({
  value,
  options,
  onChange,
  'aria-label': ariaLabel,
  disabled = false,
  loading = false,
  placeholder = '',
  variant = 'inline',
  align = 'start',
  className,
}: SettingsSelectProps): ReactNode {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const getTriggerRect = useCallback(() => triggerRef.current?.getBoundingClientRect() ?? null, [])
  const selected = options.find(option => option.id === value)
  const label = selected?.label ?? (value === '' ? placeholder : value)
  const restingLabel = useRef(label)
  useLayoutEffect(() => { if (!loading) restingLabel.current = label }, [loading, label])
  const blocked = disabled || loading
  const block = variant === 'block'

  return (
    <div className={clsx(css.root, block && css.block, className)}>
      <Menu
        open={open && !blocked}
        onClose={() => { setOpen(false) }}
        items={options.map(option => ({
          id: option.id,
          label: option.label,
          ...(option.disabled === true ? { disabled: true as const } : {}),
        }))}
        selectedId={selected === undefined ? undefined : value}
        onSelect={(id) => {
          onChange(id)
          setOpen(false)
        }}
        align={align}
        portal
        matchAnchorWidth={block}
        getAnchorRect={getTriggerRect}
        className={block ? css.menuFill : undefined}
        anchor={(
          <button
            ref={triggerRef}
            type="button"
            className={css.trigger}
            aria-label={ariaLabel}
            aria-haspopup="menu"
            aria-expanded={open && !blocked}
            aria-busy={loading || undefined}
            disabled={blocked}
            onClick={() => { setOpen(current => !current) }}
          >
            <FlipText
              className={clsx(css.label, selected === undefined && value === '' && placeholder !== '' && css.placeholder)}
              text={loading ? restingLabel.current : label}
            />
            {loading ? <StateDot state="ongoing" size={14} className={css.chevron} />
              : <IconChevronDownOutlineRegular className={css.chevron} size={14} />}
          </button>
        )}
      />
    </div>
  )
}
