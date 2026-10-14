import * as React from 'react';
import { ActionButton, FeedbackToast } from './feedback.js';
import { createPortal } from 'react-dom';
import { useModalLayer } from '@deepseek-ai/dsh-client-ui-primitives';

import { h } from './i18n.js';

function pickerErrorCode(error) {
  return error?.rpcError?.code ?? error?.code;
}

function pickerErrorDetails(error) {
  return error?.rpcError?.details ?? error?.details;
}

function pickerErrorMessage(error) {
  return error?.rpcError?.message ?? error?.message ?? '无法读取目录，请重试。';
}

function FolderIcon() {
  return React.createElement('svg', {
    viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8,
    strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true',
  },
  React.createElement('path', { d: 'M3.5 7.25A2.25 2.25 0 0 1 5.75 5h4.1l1.8 2h6.6a2.25 2.25 0 0 1 2.25 2.25v7A2.75 2.75 0 0 1 17.75 19h-12A2.25 2.25 0 0 1 3.5 16.75v-9.5Z' }));
}

function ChevronIcon() {
  return React.createElement('svg', {
    viewBox: '0 0 20 20', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7,
    strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true',
  }, React.createElement('path', { d: 'm7.5 4.5 5 5.5-5 5.5' }));
}

function displayCrumbs(listing) {
  const homeIndex = listing.crumbs.findIndex((crumb) => crumb.path === listing.home);
  if (homeIndex < 0) return listing.crumbs;
  return listing.crumbs.slice(homeIndex);
}

export function WorkspaceDirectoryPicker({
  open,
  startPath,
  picker,
  busy = false,
  saveError = null,
  onPicked,
  onCancel,
}) {
  const [listing, setListing] = React.useState(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState(null);
  const [showHidden, setShowHidden] = React.useState(false);
  const [retryKey, setRetryKey] = React.useState(0);
  const requestRef = React.useRef(0);
  const controllerRef = React.useRef(null);
  const dialogRef = React.useRef(null);
  const ownerRef = React.useRef(null);
  const bodyRef = React.useRef(null);
  const titleId = React.useId();
  const noticeId = React.useId();
  const initialPathRef = React.useRef(startPath);
  const onPickedRef = React.useRef(onPicked);
  const onCancelRef = React.useRef(onCancel);

  onPickedRef.current = onPicked;
  onCancelRef.current = onCancel;
  useModalLayer(dialogRef, open, () => { if (!busy) onCancel?.(); }, ownerRef);

  const loadDirectory = React.useCallback(async (path, { reportError = true } = {}) => {
    const request = requestRef.current + 1;
    requestRef.current = request;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading(true);
    if (reportError) setError(null);
    try {
      const next = await picker.listDirectory(path, controller.signal);
      if (request !== requestRef.current || controller.signal.aborted) return { aborted: true };
      if (bodyRef.current) bodyRef.current.scrollTop = 0;
      setListing(next);
      setError(null);
      return { value: next };
    } catch (cause) {
      if (request !== requestRef.current || controller.signal.aborted) return { aborted: true };
      if (reportError) setError(pickerErrorMessage(cause));
      return { error: cause };
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }, [picker]);

  React.useEffect(() => {
    if (!open) return undefined;
    let active = true;
    setListing(null);
    setError(null);
    setShowHidden(false);

    const start = async () => {
      const initialPath = initialPathRef.current;
      const initial = await loadDirectory(initialPath || undefined, { reportError: false });
      if (!active || initial.aborted || initial.value) return;
      const code = pickerErrorCode(initial.error);
      const details = pickerErrorDetails(initial.error);
      if (code === 'directory-picker-unavailable'
        && details?.capability === 'native'
        && typeof picker.pickDirectory === 'function') {
        setLoading(true);
        try {
          const selected = await picker.pickDirectory();
          if (!active) return;
          if (selected !== null) await onPickedRef.current?.(selected);
          else onCancelRef.current?.();
        } catch (cause) {
          if (active) setError(pickerErrorMessage(cause));
        } finally {
          if (active) setLoading(false);
        }
        return;
      }
      if (initialPath && code === 'directory-unreadable') {
        const home = await loadDirectory(undefined, { reportError: false });
        if (!active || home.aborted || home.value) return;
        setError(pickerErrorMessage(home.error));
        return;
      }
      setError(pickerErrorMessage(initial.error));
    };

    void start();
    return () => {
      active = false;
      requestRef.current += 1;
      controllerRef.current?.abort();
    };
  }, [loadDirectory, open, picker, retryKey]);

  if (!open) return null;
  const entries = (listing?.entries ?? []).filter((entry) => showHidden || !entry.hidden);
  const crumbs = listing ? displayCrumbs(listing) : [];
  const presentedError = saveError ?? error;

  const content = h('div', {
    className: 'dim-directoryPickerBackdrop',
    onMouseDown: (event) => {
      if (event.target === event.currentTarget && !busy) onCancel();
    },
  },
  h('section', {
    ref: dialogRef,
    className: 'dim-directoryPicker',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-labelledby': titleId,
    'aria-describedby': noticeId,
    tabIndex: -1,
  },
  h('header', { className: 'dim-directoryPickerHeader' },
    h('h3', { id: titleId }, '选择机器人工作区目录'),
    listing
      ? h('nav', { className: 'dim-directoryCrumbs', 'aria-label': '当前目录' },
          crumbs.map((crumb, index) => h(React.Fragment, { key: crumb.path },
            index > 0 ? h('span', { className: 'dim-directoryCrumbSeparator', 'aria-hidden': 'true' }, '›') : null,
            React.createElement('button', {
              type: 'button',
              title: crumb.path,
              disabled: loading || busy,
              'aria-current': index === crumbs.length - 1 ? 'page' : undefined,
              onClick: () => void loadDirectory(crumb.path),
            }, crumb.path === listing.home
              ? h('span', null, '主目录')
              : (crumb.name || crumb.path)))),
        )
      : h('p', null, '正在准备目录选择器…')),
  h('div', { ref: bodyRef, className: 'dim-directoryPickerBody', 'aria-busy': loading },
    loading && !listing
      ? h('div', { className: 'dim-directoryPickerState' },
          h('span', { className: 'dim-directoryPickerSpinner', 'aria-hidden': 'true' }),
          h('p', null, '正在读取目录…'))
      : listing
        ? entries.length > 0
          ? h('ul', { className: 'dim-directoryList' }, entries.map((entry) => h('li', { key: entry.path },
              React.createElement('button', {
                type: 'button',
                title: entry.path,
                disabled: loading || busy,
                onClick: () => void loadDirectory(entry.path),
              },
              h('span', { className: 'dim-directoryFolder' }, h(FolderIcon)),
              React.createElement('span', { className: 'dim-directoryName' }, entry.name),
              h('span', { className: 'dim-directoryChevron' }, h(ChevronIcon))))))
          : h('div', { className: 'dim-directoryPickerState' },
              h('p', null, '这个目录中没有子文件夹。'))
        : null,
    listing?.truncated
      ? h('p', { className: 'dim-directoryPickerTruncated' }, '此目录的子文件夹过多，仅显示前一部分。')
      : null,
    presentedError ? h(FeedbackToast, {
      text: presentedError, tone: 'error',
      actions: !listing && !busy ? [{ label: '重试', onClick: () => setRetryKey((value) => value + 1) }] : undefined,
    }) : null),
  h('footer', { className: 'dim-directoryPickerFooter' },
    h('button', {
      type: 'button',
      className: 'dim-directoryHidden',
      'aria-pressed': showHidden,
      onClick: () => setShowHidden((value) => !value),
      disabled: busy || !listing,
    },
      h('span', { className: 'dim-directoryHiddenBox', 'aria-hidden': 'true' }),
      h('span', null, '显示隐藏文件夹')),
    h('p', { id: noticeId, className: 'dim-directoryPickerNotice' }, '切换后会清除这个机器人的旧会话映射。'),
    h('div', { className: 'dim-directoryPickerActions' },
      h('button', { type: 'button', onClick: onCancel, disabled: busy }, '取消'),
      h(ActionButton, {
        type: 'button',
        className: 'dim-directoryPickerPrimary',
        disabled: busy || loading || !listing,
        onClick: () => listing && void onPicked(listing.path), loading: busy, }, '选择此目录')))));

  return h(React.Fragment, null,
    h('span', { ref: ownerRef, hidden: true, 'data-dsh-modal-owner': '' }),
    typeof document === 'undefined' ? content : createPortal(content, document.body));
}
