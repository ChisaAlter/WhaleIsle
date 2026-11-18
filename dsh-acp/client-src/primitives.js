import * as react from 'react';
import { createPortal } from 'react-dom';
import * as primitives from '@deepseek-ai/dsh-client-ui-primitives';

export const {
  createElement: h,
  Fragment,
  useState,
  useEffect,
  useLayoutEffect,
  useId,
  useMemo,
  useCallback,
  useRef,
  useSyncExternalStore,
} = react;

export { createPortal };

export const {
  Button: HostButton,
  Input,
  MenuSurface,
  Toast,
  rankByName,
  IconCloseFillRegular,
  IconWarningOutlineRegular,
  Modal,
  StateDot,
  Switch,
  IconCheckOutlineRegular,
  IconChevronDownOutlineRegular,
  IconChevronRightOutlineRegular,
  IconAgentPresetOutlineRegular,
} = primitives;

export function Button({ loading, disabled, icon, ...props }) {
  // aria-busy is understood by both hosts; `loading` is desktop-only and
  // otherwise leaks onto a native button without blocking repeat submits.
  return h(HostButton, {
    ...props,
    disabled: Boolean(disabled || loading),
    'aria-busy': loading || props['aria-busy'],
    icon: loading ? h(StateDot, { state: 'ongoing', size: 14 }) : icon,
  });
}

// The desktop shell extends the standard DSH primitives namespace. Keep
// those implementations when present without requiring them for activation.
export const SettingsSelect =
  primitives.SettingsSelect
  ?? function NativeSettingsSelect({ options, onChange, variant, className, ...props }) {
    return h(
      'select',
      {
        ...props,
        className: ['dsh-acp-settings-select', className].filter(Boolean).join(' '),
        onChange: (event) => onChange?.(event.currentTarget.value),
      },
      options.map((option) =>
        h('option', { key: option.id, value: option.id, disabled: option.disabled }, option.label),
      ),
    );
  };

export const IconPlusOutline16 = primitives.IconPlusOutline16 ?? primitives.IconPlusOutlineRegular;
export const IconRefreshOutline16 =
  primitives.IconRefreshOutline16 ?? primitives.IconRefreshOutlineRegular;
export const IconSettingsOutline16 =
  primitives.IconSettingsOutline16 ?? primitives.IconSettingsOutlineRegular;
export const IconTrashOutline16 = primitives.IconTrashOutline16 ?? primitives.IconTrashOutlineRegular;

export const FlipText = primitives.FlipText ?? (({ text, ...props }) => h('span', props, text));
export const usePresence =
  primitives.usePresence ?? ((open) => ({ mounted: open, state: open ? 'open' : 'closed' }));
