// Confirmation dialogs (delete bot, new Home Chat, delete group) plus unified BotsModalHost + Toasts.

import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  botsStore,
  useBotById,
  useBotsLocale,
  useBotsState,
  useGroupById,
} from '../store/bots-store';
import { BotGroupDialog } from './BotGroupDialog';
import { BotImportDialog } from './BotImportDialog';
import { BotShareDialog } from './BotShareDialog';
import { BotTemplatesDialog } from './BotTemplatesDialog';
import { IconAlertTriangle, IconTrash } from './Icons';
import { NewBotDialog } from './NewBotDialog';

function ConfirmDialogShell({
  open,
  title,
  description,
  danger,
  confirmLabel,
  busy,
  extra,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: string;
  danger?: boolean;
  confirmLabel: string;
  busy?: boolean;
  extra?: ReactNode;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { tr } = useBotsLocale();

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const handleEsc = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        onCancel();
      }
    };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [onCancel, open]);

  if (!open || typeof document === 'undefined') {
    return null;
  }

  return createPortal(
    <div
      className="dsh-bots-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          onCancel();
        }
      }}
    >
      <div role="alertdialog" aria-modal="true" className="dsh-bots-modal dsh-bots-modal-sm">
        <div className="dsh-bots-modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 22 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {danger ? (
              <IconTrash size={16} style={{ color: 'var(--dsw-alias-state-error-primary)' }} />
            ) : (
              <IconAlertTriangle size={16} style={{ color: 'var(--dsw-alias-state-warn-primary)' }} />
            )}
            <div className="dsh-bots-modal-title">{title}</div>
          </div>
          <div style={{ fontSize: 14, lineHeight: '22px', color: 'var(--dsw-alias-label-secondary)', wordBreak: 'break-all' }}>
            {description}
          </div>
          {extra}
        </div>
        <div className="dsh-bots-modal-footer" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="dsh-bots-btn" onClick={onCancel} disabled={busy}>
            {tr('bots.new.cancel', 'Cancel')}
          </button>
          <button
            type="button"
            className="dsh-bots-btn"
            data-variant={danger ? 'danger' : 'primary'}
            disabled={busy}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function DeleteBotConfirmDialog({
  open,
  botId,
  onClose,
}: {
  open: boolean;
  botId?: string;
  onClose: () => void;
}) {
  const { locale, tr } = useBotsLocale();
  const bot = useBotById(botId);
  const [busy, setBusy] = useState(false);

  if (!bot) {
    return null;
  }

  const handleConfirm = async () => {
    if (busy) {
      return;
    }
    setBusy(true);
    try {
      const result = await botsStore.deleteBot(bot.id);
      const pathText = result.folderPath || bot.homePath;
      botsStore.pushToast({
        message: pathText
          ? (locale === 'zh-CN' ? `已移除「${bot.name}」，文件夹保留在 ${pathText}` : `Removed "${bot.name}". Folder kept at ${pathText}`)
          : (locale === 'zh-CN' ? `已移除「${bot.name}」` : `Removed "${bot.name}"`),
        tone: 'info',
      });
      onClose();
    } catch (err) {
      botsStore.pushToast({
        message: err instanceof Error ? err.message : String(err),
        tone: 'error',
      });
      setBusy(false);
    }
  };

  return (
    <ConfirmDialogShell
      open={open}
      danger
      busy={busy}
      title={tr('bots.row.deleteTitle', 'Delete {{name}}?', { name: bot.name })}
      description={tr(
        'bots.row.deleteDescription',
        'Its folder, with its soul and memory, stays at {{path}}.',
        { path: bot.homePath || '~/.whaleisle/bots' },
      )}
      confirmLabel={tr('bots.row.deleteConfirm', 'Delete bot')}
      onCancel={onClose}
      onConfirm={() => void handleConfirm()}
    />
  );
}

export function NewHomeChatConfirmDialog({
  open,
  botId,
  onClose,
}: {
  open: boolean;
  botId?: string;
  onClose: () => void;
}) {
  const { tr } = useBotsLocale();
  const bot = useBotById(botId);
  const [dontAsk, setDontAsk] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setDontAsk(false);
      setBusy(false);
    }
  }, [open]);

  if (!bot) {
    return null;
  }

  const handleConfirm = async () => {
    if (busy) {
      return;
    }
    setBusy(true);
    try {
      await botsStore.resetBotHomeChat(bot.id, { skipConfirm: true, dontAskAgain: dontAsk });
      onClose();
    } catch (err) {
      botsStore.pushToast({
        message: err instanceof Error ? err.message : String(err),
        tone: 'error',
      });
      setBusy(false);
    }
  };

  return (
    <ConfirmDialogShell
      open={open}
      busy={busy}
      title={tr('bots.newHomeChat.title', 'Start a new Home Chat?')}
      description={tr(
        'bots.newHomeChat.description',
        'Its soul and memory stay; this conversation moves to history.',
      )}
      confirmLabel={tr('bots.newHomeChat.confirm', 'New Home Chat')}
      extra={
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12.5, cursor: 'pointer', marginTop: 2 }}>
          <input
            type="checkbox"
            checked={dontAsk}
            onChange={(e) => setDontAsk(e.target.checked)}
          />
          <span>{tr('bots.newHomeChat.dontAskAgain', "Don't ask again")}</span>
        </label>
      }
      onCancel={onClose}
      onConfirm={() => void handleConfirm()}
    />
  );
}

export function DeleteGroupConfirmDialog({
  open,
  groupId,
  onClose,
}: {
  open: boolean;
  groupId?: string;
  onClose: () => void;
}) {
  const { locale } = useBotsLocale();
  const group = useGroupById(groupId);
  const [busy, setBusy] = useState(false);

  if (!group) {
    return null;
  }

  const handleConfirm = async () => {
    if (busy) {
      return;
    }
    setBusy(true);
    try {
      await botsStore.deleteGroup(group.id);
      onClose();
    } catch (err) {
      botsStore.pushToast({
        message: err instanceof Error ? err.message : String(err),
        tone: 'error',
      });
      setBusy(false);
    }
  };

  return (
    <ConfirmDialogShell
      open={open}
      danger
      busy={busy}
      title={locale === 'zh-CN' ? `解散鱼群「${group.name}」？` : `Delete group "${group.name}"?`}
      description={locale === 'zh-CN'
        ? '仅解散该群聊，成员大肥鱼队友及其各自的记忆与会话均不受影响。'
        : 'Only this group chat is deleted. Member bots and their own memories stay intact.'}
      confirmLabel={locale === 'zh-CN' ? '解散鱼群' : 'Delete group'}
      onCancel={onClose}
      onConfirm={() => void handleConfirm()}
    />
  );
}

export function BotsToastHost() {
  const toasts = useBotsState((s) => s.toasts);

  if (toasts.length === 0 || typeof document === 'undefined') {
    return null;
  }

  return createPortal(
    <div className="dsh-bots-toasts" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className="dsh-bots-toast" data-tone={toast.tone ?? 'info'}>
          <span style={{ flex: '1 1 auto' }}>{toast.message}</span>
          {toast.actionLabel && toast.onAction && (
            <button
              type="button"
              className="dsh-bots-toast-action"
              onClick={() => {
                toast.onAction?.();
                botsStore.dismissToast(toast.id);
              }}
            >
              {toast.actionLabel}
            </button>
          )}
        </div>
      ))}
    </div>,
    document.body,
  );
}

/**
 * Unified overlay host for Harness `shell.overlay` slot.
 * Renders whichever bots dialog is active in `botsStore` alongside global toasts.
 */
export function BotsModalHost() {
  const modal = useBotsState((s) => s.modal);
  const close = () => botsStore.closeModal();

  return (
    <>
      <NewBotDialog
        open={modal?.kind === 'new-bot'}
        draft={modal?.kind === 'new-bot' ? modal.draft : undefined}
        onClose={close}
      />
      <BotTemplatesDialog
        open={modal?.kind === 'templates'}
        onClose={close}
      />
      <BotGroupDialog
        open={modal?.kind === 'group'}
        groupId={modal?.kind === 'group' ? modal.groupId : undefined}
        onClose={close}
      />
      <BotImportDialog
        open={modal?.kind === 'import'}
        onClose={close}
      />
      <BotShareDialog
        open={modal?.kind === 'share'}
        mode={modal?.kind === 'share' ? modal.mode : 'import'}
        botId={modal?.kind === 'share' && modal.mode === 'export' ? modal.botId : undefined}
        initialJson={modal?.kind === 'share' && modal.mode === 'import' ? modal.initialJson : undefined}
        onClose={close}
      />
      <DeleteBotConfirmDialog
        open={modal?.kind === 'confirm-delete-bot'}
        botId={modal?.kind === 'confirm-delete-bot' ? modal.botId : undefined}
        onClose={close}
      />
      <NewHomeChatConfirmDialog
        open={modal?.kind === 'confirm-new-home'}
        botId={modal?.kind === 'confirm-new-home' ? modal.botId : undefined}
        onClose={close}
      />
      <DeleteGroupConfirmDialog
        open={modal?.kind === 'confirm-delete-group'}
        groupId={modal?.kind === 'confirm-delete-group' ? modal.groupId : undefined}
        onClose={close}
      />
      <BotsToastHost />
    </>
  );
}
