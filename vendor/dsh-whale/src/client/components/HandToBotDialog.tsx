// Workspace "Hand to Bot" modal dialog: lets users pick an existing Whale Bot teammate
// or jump to creating a new teammate, enter an optional handoff goal, choose Home Chat vs
// new Side Chat, and invoke the `bots.takeOver` RPC with progress and failure-rollback messaging.

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  botsStore,
  useBotsLocale,
  useBotsState,
} from '../store/bots-store';
import { RPC_METHODS, callBotRpc } from '../store/rpc';
import { BotAvatar } from './BotAvatar';
import {
  IconAlertTriangle,
  IconArrowRight,
  IconCheck,
  IconFolder,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconSpinner,
  IconX,
} from './Icons';

export interface HandToBotWorkspace {
  /** Absolute filesystem path of the workspace/worktree (passed as `cwd` to `bots.takeOver`). */
  cwd: string;
  /** Optional workspace identifier used when pre-filling NewBotDialog `takeOverWorkspace`. */
  workspaceId?: string;
  /** Display name for the workspace; defaults to the last path segment of `cwd`. */
  name?: string;
  /** Optional Git branch label for display. */
  branch?: string;
}

export interface HandToBotResult {
  botId: string;
  sessionId: string;
  cwd: string;
}

export interface HandToBotDialogProps {
  open: boolean;
  workspace: HandToBotWorkspace | null;
  initialBotId?: string | null;
  initialPrompt?: string;
  onClose: () => void;
  onSuccess?: (result: HandToBotResult) => void;
  onCreateNewBot?: (workspace: HandToBotWorkspace, prompt: string) => void;
}

function basenameOfPath(rawPath: string): string {
  const cleaned = String(rawPath ?? '').replace(/[\\/]+$/, '');
  const parts = cleaned.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) || cleaned || 'Workspace';
}

export function HandToBotDialog({
  open,
  workspace,
  initialBotId = null,
  initialPrompt = '',
  onClose,
  onSuccess,
  onCreateNewBot,
}: HandToBotDialogProps) {
  const { locale, tr } = useBotsLocale();
  const zh = locale === 'zh-CN';
  const bots = useBotsState((s) => s.bots);

  const [selectedBotId, setSelectedBotId] = useState<string | null>(initialBotId);
  const [chatTarget, setChatTarget] = useState<'home' | 'new'>('home');
  const [goal, setGoal] = useState(initialPrompt);
  const [search, setSearch] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const defaultId = initialBotId && bots.some((b) => b.id === initialBotId)
      ? initialBotId
      : (bots.find((b) => !b.paused)?.id ?? bots[0]?.id ?? null);
    setSelectedBotId(defaultId);
    setChatTarget('home');
    setGoal(initialPrompt);
    setSearch('');
    setSubmitting(false);
    setError(null);
  }, [bots, initialBotId, initialPrompt, open, workspace?.cwd]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const handleEsc = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && !submitting) {
        onClose();
      }
    };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [onClose, open, submitting]);

  const filteredBots = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) {
      return bots;
    }
    return bots.filter((bot) =>
      bot.name.toLowerCase().includes(q)
      || (bot.purpose ?? bot.description ?? '').toLowerCase().includes(q),
    );
  }, [bots, search]);

  if (!open || !workspace || typeof document === 'undefined') {
    return null;
  }

  const workspaceName = workspace.name?.trim() || basenameOfPath(workspace.cwd);
  const selectedBot = bots.find((b) => b.id === selectedBotId) ?? null;

  const handleCreateNewBot = () => {
    if (submitting) {
      return;
    }
    if (onCreateNewBot) {
      onCreateNewBot(workspace, goal.trim());
      return;
    }
    onClose();
    botsStore.openModal({
      kind: 'new-bot',
      draft: {
        initialName: workspaceName,
        initialPurpose: goal.trim() || (zh ? `负责维护工作区 ${workspaceName}` : `Maintain workspace ${workspaceName}`),
        takeOverWorkspace: {
          workspaceId: workspace.workspaceId ?? workspace.cwd,
          name: workspaceName,
          watches: workspace.cwd,
          does: goal.trim() || undefined,
        },
      },
    });
  };

  const handleSubmit = async () => {
    if (!selectedBot || submitting || !workspace.cwd.trim()) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await callBotRpc<{
        ok?: boolean;
        botId?: string;
        sessionId?: string;
        cwd?: string;
      }>(RPC_METHODS.TAKE_OVER, {
        botId: selectedBot.id,
        cwd: workspace.cwd,
        title: workspaceName,
        chat: chatTarget,
        prompt: goal.trim() || null,
      });

      const resolvedBotId = res?.botId || selectedBot.id;
      const resolvedCwd = res?.cwd || workspace.cwd;
      const resolvedSessionId = res?.sessionId || '';

      void botsStore.refresh();
      if (resolvedSessionId) {
        botsStore.openBotChat(resolvedBotId, resolvedSessionId);
      } else {
        void botsStore.openBotHome(resolvedBotId);
      }

      botsStore.pushToast({
        message: zh
          ? `已将工作区「${workspaceName}」移交给「${selectedBot.name}」`
          : `Handed "${workspaceName}" to ${selectedBot.name}`,
        tone: 'success',
      });

      onSuccess?.({
        botId: resolvedBotId,
        sessionId: resolvedSessionId,
        cwd: resolvedCwd,
      });
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setSubmitting(false);
    }
  };

  return createPortal(
    <div
      className="dsh-bots-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !submitting) {
          onClose();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={zh ? '将工作区移交给大肥鱼队友' : 'Hand workspace to teammate'}
        className="dsh-bots-modal"
        data-dsh-bots-hand-dialog="true"
      >
        <div className="dsh-bots-modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <IconArrowRight size={16} />
            <span className="dsh-bots-modal-title">
              {zh ? '移交给队友' : 'Hand to teammate'}
            </span>
          </div>
          <button
            type="button"
            className="dsh-bots-icon-btn"
            disabled={submitting}
            onClick={onClose}
            aria-label={zh ? '关闭' : 'Close'}
          >
            <IconX size={16} />
          </button>
        </div>

        <div className="dsh-bots-modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Workspace target summary */}
          <div className="dsh-bots-hand-ws-card">
            <IconFolder size={18} style={{ color: 'var(--dsw-alias-label-secondary)' }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="dsh-bots-row">
                <span className="dsh-bots-ellipsis" style={{ fontWeight: 600, fontSize: 13.5 }}>
                  {workspaceName}
                </span>
                {workspace.branch && (
                  <span className="dsh-bots-badge">{workspace.branch}</span>
                )}
              </div>
              <div className="dsh-bots-hand-ws-path" title={workspace.cwd}>
                {workspace.cwd}
              </div>
            </div>
          </div>

          {/* Existing teammates selector */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="dsh-bots-row">
              <label className="dsh-bots-field-label" style={{ marginBottom: 0 }}>
                {zh ? '选择接管的大肥鱼队友' : 'Choose a teammate'}
              </label>
              <span className="dsh-bots-muted">
                {zh ? `共 ${bots.length} 位` : `${bots.length} available`}
              </span>
            </div>

            {bots.length > 4 && (
              <div className="dsh-bots-search-box" style={{ margin: 0 }}>
                <IconSearch size={14} />
                <input
                  type="text"
                  className="dsh-bots-search-input"
                  value={search}
                  disabled={submitting}
                  placeholder={tr('bots.search.label', '搜索大肥鱼队友')}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            )}

            {bots.length === 0 ? (
              <div className="dsh-bots-empty" style={{ padding: '12px 8px' }}>
                {zh ? '还没有已创建的大肥鱼队友，点击下方新建一位来接管此工作区。' : 'No teammates yet. Create one below to take over this workspace.'}
              </div>
            ) : filteredBots.length === 0 ? (
              <div className="dsh-bots-empty" style={{ padding: '12px 8px' }}>
                {tr('bots.search.noMatches', '未找到匹配的队友')}
              </div>
            ) : (
              <div className="dsh-bots-hand-list" role="radiogroup" aria-label={zh ? '大肥鱼队友列表' : 'Teammates'}>
                {filteredBots.map((bot) => {
                  const selected = selectedBotId === bot.id;
                  return (
                    <button
                      key={bot.id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      disabled={submitting}
                      className="dsh-bots-modal-row-btn"
                      data-active={selected ? 'true' : 'false'}
                      onClick={() => setSelectedBotId(bot.id)}
                    >
                      <span style={{ position: 'relative', display: 'inline-flex' }}>
                        <BotAvatar
                          botId={bot.id}
                          avatar={bot.avatar}
                          avatarColor={bot.avatarColor}
                          name={bot.name}
                          size={32}
                          radius={9}
                          paused={bot.paused}
                          status={bot.dotState ?? undefined}
                        />
                        {selected && (
                          <span className="dsh-bots-check-badge">
                            <IconCheck size={10} strokeWidth={2.6} />
                          </span>
                        )}
                      </span>
                      <div style={{ flex: '1 1 auto', minWidth: 0 }}>
                        <div className="dsh-bots-row">
                          <span className="dsh-bots-ellipsis" style={{ fontSize: 13, fontWeight: 500 }}>
                            {bot.name}
                          </span>
                          {bot.paused && (
                            <span className="dsh-bots-badge">
                              {tr('bots.row.paused', '已暂停')}
                            </span>
                          )}
                        </div>
                        {(bot.purpose || bot.description) && (
                          <div className="dsh-bots-muted dsh-bots-ellipsis">
                            {bot.purpose ?? bot.description}
                          </div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            <button
              type="button"
              className="dsh-bots-hand-create-btn"
              disabled={submitting}
              onClick={handleCreateNewBot}
            >
              <span
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 9,
                  background: 'var(--dsw-alias-interactive-bg-hover)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flex: 'none',
                }}
              >
                <IconPlus size={15} />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 500 }}>
                  {zh ? '新建大肥鱼队友来接管…' : 'Create a new teammate for this workspace…'}
                </div>
                <div className="dsh-bots-muted">
                  {zh ? '自动带入当前工作区路径与目标说明' : 'Pre-fills this workspace path and goal'}
                </div>
              </div>
            </button>
          </div>

          {/* Chat destination choice */}
          <div>
            <label className="dsh-bots-field-label">
              {zh ? '承接会话方式' : 'Conversation'}
            </label>
            <div className="dsh-bots-seg-group" role="group">
              <button
                type="button"
                className="dsh-bots-seg-btn"
                disabled={submitting}
                aria-pressed={chatTarget === 'home'}
                onClick={() => setChatTarget('home')}
              >
                {zh ? '在主对话中承接' : 'Use Home Chat'}
              </button>
              <button
                type="button"
                className="dsh-bots-seg-btn"
                disabled={submitting}
                aria-pressed={chatTarget === 'new'}
                onClick={() => setChatTarget('new')}
              >
                {zh ? '新建支线对话' : 'Start new side chat'}
              </button>
            </div>
          </div>

          {/* Optional goal instructions */}
          <div>
            <label className="dsh-bots-field-label" htmlFor="dsh-bots-hand-goal">
              {zh ? '目标说明（可选）' : 'Goal or instructions (optional)'}
            </label>
            <textarea
              id="dsh-bots-hand-goal"
              className="dsh-bots-textarea"
              rows={3}
              disabled={submitting}
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder={zh
                ? '例如：先检查当前未提交改动与测试状态，梳理风险点并给出下一步建议…'
                : 'e.g. Inspect current changes, run tests, and report next steps…'}
            />
          </div>

          {/* Submitting progress notice */}
          {submitting && selectedBot && (
            <div className="dsh-bots-hand-progress" role="status">
              <IconSpinner size={14} />
              <span>
                {zh
                  ? `正在将工作区移交给「${selectedBot.name}」并发送首条交接指令…`
                  : `Handing workspace to ${selectedBot.name} and starting session…`}
              </span>
            </div>
          )}

          {/* Failure & rollback guarantee notice */}
          {error && (
            <div className="dsh-bots-error-box" role="alert" style={{ alignItems: 'flex-start' }}>
              <IconAlertTriangle size={14} style={{ marginTop: 2, flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>
                  {zh ? '移交失败，工作区未发生改动（已保持原样）' : 'Hand-off failed; workspace remains unchanged'}
                </div>
                <div style={{ marginTop: 2, wordBreak: 'break-word' }}>{error}</div>
              </div>
              <button
                type="button"
                className="dsh-bots-pbtn dsh-bots-pbtn-xs"
                onClick={() => void handleSubmit()}
              >
                <IconRefresh size={11} />
                <span>{zh ? '重试' : 'Retry'}</span>
              </button>
            </div>
          )}
        </div>

        <div className="dsh-bots-modal-footer">
          <span className="dsh-bots-muted">
            {selectedBot
              ? (zh ? `将移交给「${selectedBot.name}」` : `Handing to ${selectedBot.name}`)
              : (zh ? '请先选择一位大肥鱼队友' : 'Select a teammate first')}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="dsh-bots-btn"
              disabled={submitting}
              onClick={onClose}
            >
              {tr('bots.new.cancel', '取消')}
            </button>
            <button
              type="button"
              className="dsh-bots-btn"
              data-variant="primary"
              disabled={!selectedBot || submitting}
              onClick={() => void handleSubmit()}
            >
              {submitting ? (
                <>
                  <IconSpinner size={13} />
                  <span>{zh ? '移交中…' : 'Handing over…'}</span>
                </>
              ) : (
                <span>{zh ? '确认移交' : 'Hand over'}</span>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
