// Switch: two-state toggle. Two call shapes coexist while the fork catches up
// with upstream: the controlled form (`label` + `checked`/`onChange(next)`) is
// the baseline and `label` is required and has no default, so a render site
// cannot ship it without an accessible name; the native-checkbox form is the
// desktop fork's original shape and stays until its render sites migrate.

import type { InputHTMLAttributes } from 'react'
import clsx from 'clsx'
import { StateDot } from './StateDot.tsx'
import css from './Switch.module.css'

/** Controlled form: the state lives with the owner, the label with the render site. */
export interface ControlledSwitchProps {
  /** The current state; the control is fully controlled. */
  checked: boolean
  /** Called with the state the click asks for. */
  onChange: (next: boolean) => void
  /** Localized accessible name, owned by the render site. */
  label: string
  /** Whether the control refuses input; owners also set it while a write is in
   * flight, not only when a deployment locks the toggle. */
  disabled?: boolean
  /** A pending write blocks another gesture and shows motion inside the thumb. */
  loading?: boolean | undefined
  /** Localized hover text, typically why the toggle is locked. */
  title?: string | undefined
  // `| undefined` so a caller can forward an optional class straight through
  // under exactOptionalPropertyTypes (a CSS-module lookup is string|undefined).
  className?: string | undefined
}

/** Native-checkbox form: any native input attribute, `type`/`role` fixed by the primitive. */
export type NativeSwitchProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'role' | 'label'> & {
  /** Always absent here: a `label` selects the controlled form above. */
  label?: undefined
  loading?: boolean | undefined
}

export type SwitchProps = ControlledSwitchProps | NativeSwitchProps

function isControlled(props: SwitchProps): props is ControlledSwitchProps {
  return props.label !== undefined
}

/**
 * Render a two-state toggle.
 * @param props.label - controlled form: the localized accessible name; its
 * presence selects the button-based control. Omitted, the switch renders as a
 * native checkbox (`aria-label`/`aria-labelledby` name it) for the desktop
 * settings rows that still pass native input attributes.
 * @param props.checked - the current state; the control is fully controlled.
 * @param props.onChange - controlled form: called with the state the click
 * asks for. Native form: the native change event.
 * @param props.disabled - whether the control refuses input.
 * @param props.title - localized hover text, typically why the toggle is locked.
 * @param props.className - extra class for layout placement.
 * @returns the switch element.
 */
export function Switch(props: SwitchProps) {
  if (isControlled(props)) {
    const { checked, onChange, label, disabled = false, loading = false, title, className } = props
    return (
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        title={title}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        className={clsx(css.switch, className)}
        onClick={() => { onChange(!checked) }}
      >
        <span className={css.thumb}>{loading && <StateDot state="ongoing" size={12} className={css.busy} />}</span>
      </button>
    )
  }

  const { className, loading = false, ...rest } = props
  return (
    <span className={css.root}>
      <input
        {...rest}
        type="checkbox"
        role="switch"
        className={clsx(css.input, className)}
        disabled={rest.disabled || loading}
        aria-busy={loading || rest['aria-busy']}
      />
      <span className={css.track} aria-hidden="true">
        <span className={css.thumb}>{loading && <StateDot state="ongoing" size={12} className={css.busy} />}</span>
      </span>
    </span>
  )
}
