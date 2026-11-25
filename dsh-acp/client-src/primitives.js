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

const EmptyIcon = () => null;

function fallbackRankByName(items, query) {
  const needle = String(query || '').trim().toLowerCase();
  const list = Array.isArray(items) ? items : [];
  if (!needle) return list;
  const prefix = [];
  const contains = [];
  for (const item of list) {
    const name = String(item?.name || '').toLowerCase();
    const id = String(item?.id || '').toLowerCase();
    if (name.startsWith(needle) || id.startsWith(needle)) prefix.push(item);
    else if (name.includes(needle) || id.includes(needle)) contains.push(item);
  }
  return [...prefix, ...contains];
}

export const {
  Button: HostButton,
  Input,
  MenuSurface,
  Toast,
  IconCloseFillRegular,
  IconWarningOutlineRegular,
  Modal,
  StateDot,
  Switch: HostSwitch,
  IconCheckOutlineRegular,
  IconChevronDownOutlineRegular,
  IconChevronRightOutlineRegular,
  IconAgentPresetOutlineRegular,
} = primitives;

export const rankByName = typeof primitives.rankByName === 'function' ? primitives.rankByName : fallbackRankByName;

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

export function Switch({ loading, disabled, ...props }) {
  // Strip desktop-only `loading` so standard Web hosts never leak it onto DOM.
  return h(HostSwitch, {
    ...props,
    disabled: Boolean(disabled || loading),
    'aria-busy': loading || props['aria-busy'],
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

export const IconPlusOutline16 =
  primitives.IconPlusOutline16 ?? primitives.IconPlusOutlineRegular ?? EmptyIcon;
export const IconRefreshOutline16 =
  primitives.IconRefreshOutline16 ?? primitives.IconRefreshOutlineRegular ?? EmptyIcon;
export const IconSettingsOutline16 =
  primitives.IconSettingsOutline16 ?? primitives.IconSettingsOutlineRegular ?? EmptyIcon;
export const IconTrashOutline16 =
  primitives.IconTrashOutline16 ?? primitives.IconTrashOutlineRegular ?? EmptyIcon;

export const FlipText = primitives.FlipText ?? (({ text, ...props }) => h('span', props, text));
export const usePresence =
  primitives.usePresence ?? ((open) => ({ mounted: open, state: open ? 'open' : 'closed' }));
