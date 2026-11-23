// Confirmation dialogs (delete bot with unsaved Home/SOUL draft guard, new Home Chat, delete group)
// plus unified BotsModalHost + Toasts.

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
import { clearUnsavedSoulDraftFlag, hasUnsavedSoulDraft } from './BotSettingsSubpagesA';
import { BotShareDialog } from './BotShareDialog';
import { BotTemplatesDialog } from './BotTemplatesDialog';
import { HandToBotDialog, type HandToBotWorkspace } from './HandToBotDialog';
import { IconAlertTriangle, IconTrash } from './Icons';
import { NewBotDialog } from './NewBotDialog';

interface UnsavedDraftBlockers {
  soulDirty: boolean;
  homeDraft: boolean;
  itemDraftKeys: string[];
}

function detectUnsavedDraftsForBot(botId: string, homeSessionId?: string | null): UnsavedDraftBlockers {
  const soulDirty = hasUnsavedSoulDraft(botId);
  let homeDraft = false;
  const itemDraftKeys: string[] = [];

  if (typeof window !== 'undefined') {
    const hostHook = (window as unknown as {
      __DSH_BOTS_HAS_UNSAVED_DRAFT__?: (id: string, sessionId?: string | null) => boolean;
    }).__DSH_BOTS_HAS_UNSAVED_DRAFT__;
    if (typeof hostHook === 'function') {
      try {
        if (hostHook(botId, homeSessionId)) {
          homeDraft = true;
        }
      } catch {
        // Ignore host hook error.
      }
    }

    try {
      const prefill = window.sessionStorage?.getItem(`dsh-bots.prefillDraft:${botId}`);
      if (prefill && prefill.trim()) {
        homeDraft = true;
      }
    } catch {
      // Ignore sessionStorage error.
    }

    if (window.localStorage) {
      try {
        const itemPrefix = `dsh-bots.itemDraft:${botId}:`;
        const sessionCandidateKeys = homeSessionId
          ? [
            `dsh-bots.homeDraft:${botId}`,
            `dsh.chatDraft:${homeSessionId}`,
            `dsh-chat-draft:${homeSessionId}`,
            `chat-draft:${homeSessionId}`,
          ]
          : [`dsh-bots.homeDraft:${botId}`];

        for (let i = 0; i < window.localStorage.length; i += 1) {
          const key = window.localStorage.key(i);
          if (!key) continue;
          const val = window.localStorage.getItem(key);
          if (!val || !val.trim()) continue;
          if (key.startsWith(itemPrefix)) {
            itemDraftKeys.push(key);
          } else if (sessionCandidateKeys.includes(key)) {
            homeDraft = true;
          } else if (homeSessionId && key.includes(homeSessionId) && /draft/i.test(key)) {
            homeDraft = true;
          }
        }
      } catch {
        // Ignore localStorage error.
      }
    }
  }

  return { soulDirty, homeDraft, itemDraftKeys };
}

function clearLocalDraftsForBot(botId: string, homeSessionId?: string | null, itemDraftKeys: string[] = []): void {
  clearUnsavedSoulDraftFlag(botId);
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage?.removeItem(`dsh-bots.prefillDraft:${botId}`);
  } catch {
    // Ignore storage error.
  }
  if (window.localStorage) {
    try {
      window.localStorage.removeItem(`dsh-bots.homeDraft:${botId}`);
      if (homeSessionId) {
        window.localStorage.removeItem(`dsh.chatDraft:${homeSessionId}`);
        window.localStorage.removeItem(`dsh-chat-draft:${homeSessionId}`);
        window.localStorage.removeItem(`chat-draft:${homeSessionId}`);
      }
      for (const k of itemDraftKeys) {
        window.localStorage.removeItem(k);
      }
    } catch {
      // Ignore storage error.
    }
  }
}

function ConfirmDialogShell({
  open,
  title,
  description,
  danger,
  confirmLabel,
  confirmDisabled,
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
  confirmDisabled?: boolean;
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
            disabled={busy || confirmDisabled}
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
  const zh = locale === 'zh-CN';
  const bot = useBotById(botId);
  const [busy, setBusy] = useState(false);
  const [blockers, setBlockers] = useState<UnsavedDraftBlockers>({
    soulDirty: false,
    homeDraft: false,
    itemDraftKeys: [],
  });

  const homeSessionId = bot?.chatSessionId ?? bot?.homeSessionId ?? null;

  useEffect(() => {
    if (open && bot) {
      setBusy(false);
      setBlockers(detectUnsavedDraftsForBot(bot.id, homeSessionId));
    }
  }, [bot, homeSessionId, open]);

  if (!bot) {
    return null;
  }

  const hasBlockers = blockers.soulDirty || blockers.homeDraft || blockers.itemDraftKeys.length > 0;

  const handleConfirm = async () => {
    if (busy) {
      return;
    }
    const latest = detectUnsavedDraftsForBot(bot.id, homeSessionId);
    setBlockers(latest);
    if (latest.soulDirty || latest.homeDraft || latest.itemDraftKeys.length > 0) {
      botsStore.pushToast({
        message: zh ? '请先保存或清空未保存的草稿后再删除队友' : 'Save or clear unsaved drafts before deleting this bot.',
        tone: 'error',
      });
      return;
    }

    setBusy(true);
    try {
      const result = await botsStore.deleteBot(bot.id);
      const pathText = result.folderPath || bot.homePath;
      botsStore.pushToast({
        message: pathText
          ? (zh ? `已移除「${bot.name}」，文件夹保留在 ${pathText}` : `Removed "${bot.name}". Folder kept at ${pathText}`)
          : (zh ? `已移除「${bot.name}」` : `Removed "${bot.name}"`),
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
      confirmDisabled={hasBlockers}
      title={tr('bots.row.deleteTitle', 'Delete {{name}}?', { name: bot.name })}
      description={tr(
        'bots.row.deleteDescription',
        'Its folder, with its soul and memory, stays at {{path}}.',
        { path: bot.homePath || '~/.whaleisle/bots' },
      )}
      confirmLabel={tr('bots.row.deleteConfirm', 'Delete bot')}
      extra={hasBlockers ? (
        <div className="dsh-bots-pcard dsh-bots-pcard-warn" role="alert">
          <div className="dsh-bots-row-left" style={{ fontWeight: 600 }}>
            <IconAlertTriangle size={14} className="dsh-bots-text-warn" />
            <span>{zh ? '存在未保存的草稿，已阻止删除' : 'Unsaved drafts detected — delete blocked'}</span>
          </div>
          <ul className="dsh-bots-draft-blocker-list">
            {blockers.soulDirty && (
              <li>{zh ? 'SOUL.md 存在未保存或存在冲突的修改' : 'SOUL.md has unsaved or conflicted edits'}</li>
            )}
            {blockers.homeDraft && (
              <li>{zh ? '主对话 (Home Chat) 输入框存在未发送草稿' : 'Home Chat has an unsaved message draft'}</li>
            )}
            {blockers.itemDraftKeys.length > 0 && (
              <li>
                {zh
                  ? `工作条目评论区存在 ${blockers.itemDraftKeys.length} 份未发送草稿`
                  : `${blockers.itemDraftKeys.length} work item comment draft(s) unsent`}
              </li>
            )}
          </ul>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {blockers.soulDirty && (
              <button
                type="button"
                className="dsh-bots-pbtn dsh-bots-pbtn-xs"
                onClick={() => {
                  onClose();
                  botsStore.openBotSettings(bot.id, { host: 'panel', page: 'soul' });
                }}
              >
                {zh ? '前往保存 SOUL.md' : 'Go to SOUL.md'}
              </button>
            )}
            {blockers.homeDraft && (
              <button
                type="button"
                className="dsh-bots-pbtn dsh-bots-pbtn-xs"
                onClick={() => {
                  onClose();
                  void botsStore.openBotHome(bot.id);
                }}
              >
                {zh ? '打开主对话' : 'Open Home Chat'}
              </button>
            )}
            <button
              type="button"
              className="dsh-bots-pbtn dsh-bots-pbtn-xs dsh-bots-pbtn-ghost"
              onClick={() => {
                clearLocalDraftsForBot(bot.id, homeSessionId, blockers.itemDraftKeys);
                setBlockers(detectUnsavedDraftsForBot(bot.id, homeSessionId));
              }}
            >
              {zh ? '放弃这些本地草稿' : 'Discard local drafts'}
            </button>
          </div>
        </div>
      ) : undefined}
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
  const { locale } = useBotsLocale();
  const zh = locale === 'zh-CN';
  const close = () => botsStore.closeModal();

  const handleCreateBotFromWorkspace = (workspace: HandToBotWorkspace, prompt: string) => {
    const cleaned = String(workspace.cwd ?? '').replace(/[\\/]+$/, '');
    const fallbackName = cleaned.split(/[\\/]/).filter(Boolean).at(-1) || cleaned || 'Workspace';
    const workspaceName = workspace.name?.trim() || fallbackName;
    const trimmedPrompt = prompt.trim();
    botsStore.openModal({
      kind: 'new-bot',
      draft: {
        initialName: workspaceName,
        initialPurpose: trimmedPrompt || (zh ? `负责维护工作区 ${workspaceName}` : `Maintain workspace ${workspaceName}`),
        takeOverWorkspace: {
          workspaceId: workspace.workspaceId ?? workspace.cwd,
          name: workspaceName,
          watches: workspace.cwd,
          does: trimmedPrompt || undefined,
        },
      },
    });
  };

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
      <HandToBotDialog
        open={modal?.kind === 'hand-to-bot'}
        workspace={modal?.kind === 'hand-to-bot' ? modal.workspace : null}
        initialBotId={modal?.kind === 'hand-to-bot' ? modal.initialBotId : null}
        initialPrompt={modal?.kind === 'hand-to-bot' ? modal.initialPrompt : ''}
        onClose={close}
        onCreateNewBot={handleCreateBotFromWorkspace}
        onSuccess={(result) => {
          if (result.botId) {
            void botsStore.refreshBotChatTree(result.botId);
          }
        }}
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
