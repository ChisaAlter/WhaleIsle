import * as React from 'react';
import { createPortal } from 'react-dom';
import { Button, Toast, IconWarningOutlineRegular, useModalLayer } from '@deepseek-ai/dsh-client-ui-primitives';
import { localizeText } from './i18n.js';

export const ActionButton = React.forwardRef(function ActionButton({ children, loading = false, className = '', disabled, ...props }, ref) {
  return React.createElement(Button, {
    type: 'button', ...props, ref,
    className: `${className} dim-busyButton`.trim(),
    loading,
    disabled: disabled || loading,
    'aria-busy': loading || props['aria-busy'] || undefined,
    'data-loading': loading || undefined,
  }, children);
});

export function BusyIndicator({ busy }) {
  return busy ? React.createElement('span', { className: 'dim-controlSpinner', 'aria-hidden': true }) : null;
}

export function FeedbackToast({ text, tone, holdMs = null, actions, sequence = 0 }) {
  const [dismissed, setDismissed] = React.useState(null);
  const showing = `${sequence}:${holdMs}:${text}`;
  React.useEffect(() => { setDismissed(null); }, [showing]);
  if (!text || dismissed === showing) return null;
  return React.createElement(Toast, {
    key: showing, text: localizeText(text), holdMs,
    tone: tone === 'success' ? 'success' : undefined,
    icon: tone === 'error' ? React.createElement(IconWarningOutlineRegular) : undefined,
    actions: actions?.map((action) => ({ ...action, label: localizeText(action.label) })),
    dismissLabel: holdMs === null ? localizeText('关闭') : undefined,
    onDone: () => setDismissed(showing),
  });
}

export function ConfirmDialog({ children, onClose, busy = false, className = '', error, feedbackSequence, ...props }) {
  const dialogRef = React.useRef(null);
  const ownerRef = React.useRef(null);
  const heading = React.Children.toArray(children).find(child => React.isValidElement(child) && ['strong', 'h4'].includes(child.type));
  useModalLayer(dialogRef, true, () => { if (!busy) onClose?.(); }, ownerRef);
  const content = React.createElement('div', {
    className: 'dim-confirmBackdrop',
    onMouseDown: (event) => { if (event.target === event.currentTarget && !busy) onClose?.(); },
  }, React.createElement('section', {
    ...props, ref: dialogRef, className: `dim-confirmDialog ${className}`.trim(), role: 'dialog', 'aria-modal': true,
    'aria-label': props['aria-label'] ?? (props['aria-labelledby'] ? undefined : heading?.props.children),
    tabIndex: -1, onKeyDown: undefined,
  }, children, error ? React.createElement(FeedbackToast, { text: error, tone: 'error', sequence: feedbackSequence }) : null));
  return React.createElement(React.Fragment, null,
    React.createElement('span', { ref: ownerRef, hidden: true, 'data-dsh-modal-owner': '' }),
    typeof document === 'undefined' ? content : createPortal(content, document.body));
}
