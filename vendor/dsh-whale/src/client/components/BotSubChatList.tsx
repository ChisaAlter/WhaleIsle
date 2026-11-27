// Bot sub-chat rows (non-home side/automation/connector/worker chats, home-owned worker rows, and nested worker rows).
// Enhanced with active-chat rim flash feedback, hover '...' & context menu (Open / Stop / Delete),
// and live 1s worker elapsed clock with hover Stop control.

import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  CHAT_TREE_CAPS,
  botChatFoldKey,
  botOwnChatTree,
  chatFoldCounts,
  chatFoldSummary,
  orderBotChats,
} from '../../shared/bot-sidebar-logic.js';
import {
  botsStore,
  formatRelativeTime,
  useBotsLocale,
  useBotsState,
} from '../store/bots-store';
import { RPC_METHODS, callBotRpc, type BotChatRow, type BotRecord, type BotWorkerRow } from '../store/rpc';
import { BotChevron, BotDisclosure } from './BotDisclosure';
import { useAnchoredPopoverDismiss } from './useAnchoredPopoverDismiss';
import {
  IconExternalLink,
  IconGlobe,
  IconMessageSquare,
  IconMoreHorizontal,
  IconSpinner,
  IconStopSquare,
  IconTrash,
  IconZap,
} from './Icons';

export interface BotSubChatListProps {
  bot: BotRecord;
  now: number;
  hideSleepingWorkers: boolean;
}

type SidebarWorkerRow = BotWorkerRow & {
  dispatchId?: string;
  taskId?: string;
  createdAt?: number;
  closedAt?: number;
};

const FLASH_CHAT_PANE_EVENT = 'dsh-bots:flash-chat-pane';

function chatRowKey(chat: BotChatRow): string {
  return chat.sessionId || chat.chatId || (chat as { id?: string }).id || '';
}

function workerRowKey(worker: SidebarWorkerRow, fallback: string): string {
  return String(worker.id ?? worker.dispatchId ?? worker.sessionId ?? worker.workspaceId ?? fallback);
}

function workerStopWorkId(worker: SidebarWorkerRow): string | null {
  const workId = worker.id ?? worker.dispatchId ?? worker.sessionId ?? worker.workspaceId;
  return workId ? String(workId) : null;
}

function isWorkerActive(worker: BotWorkerRow): boolean {
  return worker.state === 'running' || worker.state === 'working';
}

function formatElapsedDuration(startedAt: number | undefined, tickNow: number): string {
  if (typeof startedAt !== 'number' || !Number.isFinite(startedAt) || startedAt <= 0) {
    return '';
  }
  const sec = Math.max(0, Math.floor((tickNow - startedAt) / 1000));
  if (sec < 60) {
    return `${sec}s`;
  }
  const mins = Math.floor(sec / 60);
  const remSec = sec % 60;
  if (mins < 60) {
    return `${mins}m ${String(remSec).padStart(2, '0')}s`;
  }
  const hrs = Math.floor(mins / 60);
  const remMin = mins % 60;
  return `${hrs}h ${String(remMin).padStart(2, '0')}m`;
}

function triggerChatPaneRimFlash(botId: string, sessionId: string): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return;
  }
  window.dispatchEvent(new CustomEvent(FLASH_CHAT_PANE_EVENT, {
    detail: { botId, sessionId },
  }));
  const selectors = [
    `[data-session-id="${CSS.escape(sessionId)}"]`,
    '.dsh-bots-conv-frame',
    '[data-dsh-chat-pane]',
    'main',
  ];
  for (const selector of selectors) {
    const target = document.querySelector<HTMLElement>(selector);
    if (target) {
      target.classList.remove('dsh-bots-pane-rim-flash');
      // Force reflow so rapid re-clicks re-trigger the rim flash.
      void target.offsetWidth;
      target.classList.add('dsh-bots-pane-rim-flash');
      window.setTimeout(() => {
        target.classList.remove('dsh-bots-pane-rim-flash');
      }, 720);
      break;
    }
  }
}

function ChatOriginIcon({ origin }: { origin: string }) {
  if (origin === 'automation') {
    return <IconZap size={14} />;
  }
  if (origin === 'side') {
    return <IconMessageSquare size={14} />;
  }
  return <IconGlobe size={14} />;
}

function ChatLiveBadge({ live }: { live?: BotChatRow['live'] }) {
  if (!live || live === 'idle') {
    return null;
  }
  if (live === 'replying') {
    return (
      <span className="dsh-bots-subrow-badge" data-live="replying">
        <IconSpinner size={8} strokeWidth={2.5} />
      </span>
    );
  }
  const tone = live === 'needs-you' || live === 'usage-limit' ? 'attention' : 'working';
  return <span className="dsh-bots-subrow-badge" data-live={tone} />;
}

function BotChatWorkerRows({
  botId,
  keyPrefix,
  running: rawRunning,
  finished: rawFinished,
  hideSleepingWorkers,
  flat = false,
  activeBotId,
  activeSessionId,
  openMenuKey,
  stoppingKey,
  onOpenSession,
  onStopWorker,
  onToggleWorkerMenu,
  onOpenWorkerContextMenu,
}: {
  botId: string;
  keyPrefix: string;
  running: SidebarWorkerRow[];
  finished: SidebarWorkerRow[];
  hideSleepingWorkers: boolean;
  flat?: boolean;
  activeBotId: string | null;
  activeSessionId: string | null;
  openMenuKey: string | null;
  stoppingKey: string | null;
  onOpenSession: (sessionId: string, isActive: boolean) => void;
  onStopWorker: (worker: SidebarWorkerRow, key: string) => Promise<void>;
  onToggleWorkerMenu: (
    worker: SidebarWorkerRow,
    key: string,
    label: string,
    isActive: boolean,
    canStop: boolean,
    triggerEl: HTMLElement,
  ) => void;
  onOpenWorkerContextMenu: (
    worker: SidebarWorkerRow,
    key: string,
    label: string,
    isActive: boolean,
    canStop: boolean,
    x: number,
    y: number,
    contextTriggerEl: HTMLElement | null,
  ) => void;
}) {
  const { locale, tr } = useBotsLocale();
  const zh = locale === 'zh-CN';
  const [extraShown, setExtraShown] = useState(0);

  const running = useMemo(
    () => rawRunning.filter((w) => !hideSleepingWorkers || w.state !== 'sleeping'),
    [rawRunning, hideSleepingWorkers],
  );
  const finished = useMemo(
    () => rawFinished.filter((w) => !hideSleepingWorkers || w.state !== 'sleeping'),
    [rawFinished, hideSleepingWorkers],
  );

  const hasActiveWorker = useMemo(() => running.some(isWorkerActive), [running]);
  const [tickNow, setTickNow] = useState(() => Date.now());

  // Tick every 1 second only while at least one worker is actively running.
  useEffect(() => {
    if (!hasActiveWorker) {
      return undefined;
    }
    setTickNow(Date.now());
    const id = window.setInterval(() => setTickNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [hasActiveWorker]);

  const runningLimit = CHAT_TREE_CAPS.runningShown + extraShown;
  const finishedLimit = CHAT_TREE_CAPS.finishedShown + extraShown;
  const shownRunning = running.slice(0, runningLimit);
  const shownFinished = finished.slice(0, finishedLimit);
  const remaining = Math.max(0, running.length - shownRunning.length)
    + Math.max(0, finished.length - shownFinished.length);

  if (shownRunning.length === 0 && shownFinished.length === 0) {
    return null;
  }

  return (
    <div className="dsh-bots-worker-list" data-root-workers={flat ? 'true' : undefined}>
      {[...shownRunning, ...shownFinished].map((worker, idx) => {
        const key = workerRowKey(worker, `${keyPrefix}-w-${idx}`);
        const menuKey = `worker:${key}`;
        const label = worker.title ?? worker.label ?? worker.statusText ?? worker.taskId ?? 'Worker';
        const active = isWorkerActive(worker);
        const elapsed = active
          ? formatElapsedDuration(worker.startedAt ?? worker.createdAt ?? worker.updatedAt, tickNow)
          : '';
        const canStop = active && Boolean(workerStopWorkId(worker));
        const hasSession = Boolean(worker.sessionId);
        const hasMenu = hasSession || canStop;
        const isRowActive = activeBotId === botId && Boolean(activeSessionId) && worker.sessionId === activeSessionId;
        const menuOpen = openMenuKey === menuKey;

        return (
          <div
            key={key}
            className="dsh-bots-worker-row"
            data-active={isRowActive ? 'true' : 'false'}
            data-active-worker={active ? 'true' : 'false'}
            data-menu-open={menuOpen ? 'true' : 'false'}
            onClick={(e) => {
              e.stopPropagation();
              if (worker.sessionId) {
                onOpenSession(worker.sessionId, isRowActive);
              }
            }}
            onContextMenu={hasMenu ? (e) => {
              e.preventDefault();
              e.stopPropagation();
              onOpenWorkerContextMenu(worker, menuKey, label, isRowActive, canStop, e.clientX, e.clientY, e.currentTarget);
            } : undefined}
            title={worker.statusText || label}
          >
            <span className="dsh-bots-worker-dot" data-state={worker.state} />
            <span className="dsh-bots-subrow-title">{label}</span>
            {(elapsed || hasMenu) && (
              <span className="dsh-bots-worker-tail">
                {elapsed && (
                  <span className="dsh-bots-worker-elapsed">{elapsed}</span>
                )}
                {canStop && (
                  <button
                    type="button"
                    className="dsh-bots-worker-stop-btn"
                    disabled={stoppingKey === key}
                    aria-label={zh ? `停止 ${label}` : `Stop ${label}`}
                    title={zh ? '停止运行' : 'Stop worker'}
                    onClick={(e) => {
                      e.stopPropagation();
                      void onStopWorker(worker, key);
                    }}
                  >
                    <IconStopSquare size={9} />
                    <span>{zh ? '停止' : 'Stop'}</span>
                  </button>
                )}
                {hasMenu && (
                  <button
                    type="button"
                    className="dsh-bots-icon-btn dsh-bots-icon-btn-sm dsh-bots-subrow-more-btn"
                    aria-label={zh ? '更多子代理操作' : 'Worker actions'}
                    aria-haspopup="menu"
                    aria-expanded={menuOpen}
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleWorkerMenu(worker, menuKey, label, isRowActive, canStop, e.currentTarget);
                    }}
                  >
                    <IconMoreHorizontal size={13} />
                  </button>
                )}
              </span>
            )}
          </div>
        );
      })}
      {remaining > 0 ? (
        <button
          type="button"
          className="dsh-bots-worker-more"
          onClick={(e) => {
            e.stopPropagation();
            setExtraShown((prev) => prev + CHAT_TREE_CAPS.step);
          }}
        >
          {tr('bots.chats.showMoreWorkers', 'Show {{count}} more workers', {
            count: Math.min(remaining, CHAT_TREE_CAPS.step),
          })}
        </button>
      ) : extraShown > 0 ? (
        <button
          type="button"
          className="dsh-bots-worker-more"
          onClick={(e) => {
            e.stopPropagation();
            setExtraShown(0);
          }}
        >
          {tr('bots.chats.collapseWorkers', 'Collapse')}
        </button>
      ) : null}
    </div>
  );
}

type RowMenuState =
  | {
      kind: 'chat';
      key: string;
      chat: BotChatRow;
      isActive: boolean;
      x: number;
      y: number;
      triggerEl: HTMLElement | null;
      contextTriggerEl: HTMLElement | null;
    }
  | {
      kind: 'worker';
      key: string;
      worker: SidebarWorkerRow;
      label: string;
      isActive: boolean;
      canStop: boolean;
      x: number;
      y: number;
      triggerEl: HTMLElement | null;
      contextTriggerEl: HTMLElement | null;
    };

export function BotSubChatList({ bot, now, hideSleepingWorkers }: BotSubChatListProps) {
  const { locale, tr } = useBotsLocale();
  const zh = locale === 'zh-CN';
  const rawTree = useBotsState((state) => state.chatsByBot[bot.id]);
  const activeSessionId = useBotsState((state) => state.activeSessionId);
  const activeBotId = useBotsState((state) => state.activeBotId);
  const chatFolds = useBotsState((state) => state.chatFolds);

  const [menuState, setMenuState] = useState<RowMenuState | null>(null);
  const [deletingChatId, setDeletingChatId] = useState<string | null>(null);
  const [stoppingKey, setStoppingKey] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useAnchoredPopoverDismiss({
    open: Boolean(menuState),
    popoverRef: menuRef,
    triggerEl: menuState?.triggerEl ?? null,
    contextTriggerEl: menuState?.contextTriggerEl ?? null,
    onClose: () => setMenuState(null),
  });

  const { homeRunning, homeFinished, subChats } = useMemo(() => {
    const owned = rawTree ? (botOwnChatTree(rawTree) as { chats: BotChatRow[] }) : null;
    const openChats = (owned?.chats ?? []).filter((chat) => !chat.closed);
    const homeChats = openChats.filter((chat) => chat.origin === 'home');
    const nonHome = openChats.filter((chat) => chat.origin !== 'home');
    return {
      homeRunning: homeChats.flatMap((chat) => (chat.running ?? []) as SidebarWorkerRow[]),
      homeFinished: homeChats.flatMap((chat) => (chat.finished ?? []) as SidebarWorkerRow[]),
      subChats: orderBotChats(nonHome) as BotChatRow[],
    };
  }, [rawTree]);

  const hasVisibleHomeWorkers = useMemo(() => {
    const hasRunning = homeRunning.some((w) => !hideSleepingWorkers || w.state !== 'sleeping');
    const hasFinished = homeFinished.some((w) => !hideSleepingWorkers || w.state !== 'sleeping');
    return hasRunning || hasFinished;
  }, [hideSleepingWorkers, homeFinished, homeRunning]);

  const openSession = (sessionId: string, isActive: boolean) => {
    if (!sessionId) {
      return;
    }
    if (isActive) {
      triggerChatPaneRimFlash(bot.id, sessionId);
      return;
    }
    botsStore.openBotChat(bot.id, sessionId);
  };

  const openChatRow = (chat: BotChatRow, isActive: boolean) => {
    openSession(chatRowKey(chat), isActive);
  };

  const deleteChatSession = async (sessionId: string, lockKey: string, chatId?: string) => {
    setMenuState(null);
    if (!sessionId || deletingChatId === lockKey) {
      return;
    }
    setDeletingChatId(lockKey);
    try {
      await callBotRpc(RPC_METHODS.CHAT_DELETE, {
        botId: bot.id,
        sessionId,
        ...(chatId ? { chatId } : {}),
      });
      botsStore.pushToast({
        message: zh ? '已删除该对话' : 'Chat deleted',
        tone: 'info',
      });
      void botsStore.refreshBotChatTree(bot.id);
      void botsStore.refresh();
    } catch (err) {
      botsStore.pushToast({
        message: err instanceof Error ? err.message : String(err),
        tone: 'error',
      });
    } finally {
      setDeletingChatId(null);
    }
  };

  const handleStopWorker = async (worker: SidebarWorkerRow, key: string) => {
    const workId = workerStopWorkId(worker);
    if (!workId || stoppingKey === key) {
      return;
    }
    setStoppingKey(key);
    try {
      await callBotRpc(RPC_METHODS.WORK_STOP, {
        botId: bot.id,
        workId,
        ...(worker.sessionId ? { sessionId: worker.sessionId } : {}),
      });
      botsStore.pushToast({
        message: zh ? '已发送停止指令' : 'Stop requested for worker',
        tone: 'info',
      });
      void botsStore.refreshBotChatTree(bot.id);
      void botsStore.refresh();
    } catch (err) {
      botsStore.pushToast({
        message: err instanceof Error ? err.message : String(err),
        tone: 'error',
      });
    } finally {
      setStoppingKey(null);
    }
  };

  const clampMenuPos = (x: number, y: number) => ({
    x: Math.max(8, Math.min(x, window.innerWidth - 188)),
    y: Math.max(8, Math.min(y, window.innerHeight - 148)),
  });

  const openChatMenuAt = (
    chat: BotChatRow,
    isActive: boolean,
    x: number,
    y: number,
    triggerEl: HTMLElement | null = null,
    contextTriggerEl: HTMLElement | null = null,
  ) => {
    const key = chatRowKey(chat);
    const pos = clampMenuPos(x, y);
    setMenuState({ kind: 'chat', key, chat, isActive, ...pos, triggerEl, contextTriggerEl });
  };

  const openWorkerMenuAt = (
    worker: SidebarWorkerRow,
    key: string,
    label: string,
    isActive: boolean,
    canStop: boolean,
    x: number,
    y: number,
    triggerEl: HTMLElement | null = null,
    contextTriggerEl: HTMLElement | null = null,
  ) => {
    const pos = clampMenuPos(x, y);
    setMenuState({ kind: 'worker', key, worker, label, isActive, canStop, ...pos, triggerEl, contextTriggerEl });
  };

  if (!hasVisibleHomeWorkers && subChats.length === 0) {
    return null;
  }

  return (
    <div className="dsh-bots-sublist" data-paused={bot.paused ? 'true' : 'false'}>
      {hasVisibleHomeWorkers && (
        <BotChatWorkerRows
          botId={bot.id}
          keyPrefix={`home:${bot.id}`}
          running={homeRunning}
          finished={homeFinished}
          hideSleepingWorkers={hideSleepingWorkers}
          flat
          activeBotId={activeBotId}
          activeSessionId={activeSessionId}
          openMenuKey={menuState?.kind === 'worker' ? menuState.key : null}
          stoppingKey={stoppingKey}
          onOpenSession={openSession}
          onStopWorker={handleStopWorker}
          onToggleWorkerMenu={(worker, key, label, isActive, canStop, triggerEl) => {
            if (menuState?.kind === 'worker' && menuState.key === key) {
              setMenuState(null);
            } else {
              const rect = triggerEl.getBoundingClientRect();
              openWorkerMenuAt(worker, key, label, isActive, canStop, rect.left, rect.bottom + 4, triggerEl);
            }
          }}
          onOpenWorkerContextMenu={(worker, key, label, isActive, canStop, x, y, contextTriggerEl) => {
            openWorkerMenuAt(worker, key, label, isActive, canStop, x, y, null, contextTriggerEl);
          }}
        />
      )}

      {subChats.map((chat) => {
        const chatKey = chatRowKey(chat);
        const label = chat.title || (chat.origin === 'automation'
          ? tr('bots.chats.kindAutomation', 'Automation')
          : tr('bots.chats.kindSide', 'Side chat'));
        const foldKey = botChatFoldKey('local', bot.id, chatKey);
        const foldCounts = chatFoldCounts(chat) as { waiting: number; running: number } | null;
        const hasWorkers = (chat.running?.length ?? 0) > 0 || (chat.finished?.length ?? 0) > 0;
        const folded = chatFolds[foldKey] ? chatFolds[foldKey] === 'folded' : !foldCounts;
        const isActive =
          activeBotId === bot.id
          && Boolean(activeSessionId)
          && (activeSessionId === chat.sessionId || activeSessionId === chat.chatId || activeSessionId === chatKey);
        const menuOpen = menuState?.kind === 'chat' && menuState.key === chatKey;
        const timeText = formatRelativeTime(chat.lastActiveAt, now, locale);
        const foldText = folded && foldCounts ? chatFoldSummary(tr, foldCounts) : '';
        const toggleWorkers = (e: MouseEvent) => {
          e.stopPropagation();
          botsStore.setChatFold(foldKey, folded ? 'open' : 'folded');
        };

        return (
          <div key={chatKey}>
            <div
              className="dsh-bots-subrow"
              data-active={isActive ? 'true' : 'false'}
              data-unread={chat.unread ? 'true' : 'false'}
              data-menu-open={menuOpen ? 'true' : 'false'}
              title={label}
              onClick={(e) => {
                e.stopPropagation();
                openChatRow(chat, isActive);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                openChatMenuAt(chat, isActive, e.clientX, e.clientY, null, e.currentTarget);
              }}
            >
              <span className="dsh-bots-subrow-icon">
                <ChatOriginIcon origin={chat.origin} />
                <ChatLiveBadge live={chat.live} />
              </span>
              <span className="dsh-bots-subrow-title">{label}</span>

              <span className="dsh-bots-subrow-tail">
                {foldText ? (
                  <button
                    type="button"
                    className="dsh-bots-subrow-fold-meta"
                    aria-expanded={!folded}
                    onClick={toggleWorkers}
                  >
                    {foldText}
                  </button>
                ) : timeText ? (
                  <span className="dsh-bots-subrow-meta">{timeText}</span>
                ) : null}

                <button
                  type="button"
                  className="dsh-bots-icon-btn dsh-bots-icon-btn-sm dsh-bots-subrow-more-btn"
                  aria-label={zh ? '更多对话操作' : 'Chat actions'}
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  onClick={(e) => {
                    e.stopPropagation();
                    const rect = e.currentTarget.getBoundingClientRect();
                    if (menuState?.kind === 'chat' && menuState.key === chatKey) {
                      setMenuState(null);
                    } else {
                      openChatMenuAt(chat, isActive, rect.left, rect.bottom + 4, e.currentTarget);
                    }
                  }}
                >
                  <IconMoreHorizontal size={13} />
                </button>
              </span>

              {hasWorkers && (
                <button
                  type="button"
                  className="dsh-bots-icon-btn dsh-bots-icon-btn-sm"
                  aria-expanded={!folded}
                  onClick={toggleWorkers}
                  aria-label={folded ? 'Expand workers' : 'Collapse workers'}
                >
                  <BotChevron open={!folded} size={12} />
                </button>
              )}
            </div>
            <BotDisclosure open={hasWorkers && !folded} className="dsh-bots-workers-disclosure">
              <BotChatWorkerRows
                botId={bot.id}
                keyPrefix={chatKey}
                running={(chat.running ?? []) as SidebarWorkerRow[]}
                finished={(chat.finished ?? []) as SidebarWorkerRow[]}
                hideSleepingWorkers={hideSleepingWorkers}
                activeBotId={activeBotId}
                activeSessionId={activeSessionId}
                openMenuKey={menuState?.kind === 'worker' ? menuState.key : null}
                stoppingKey={stoppingKey}
                onOpenSession={openSession}
                onStopWorker={handleStopWorker}
                onToggleWorkerMenu={(worker, key, wLabel, wIsActive, canStop, triggerEl) => {
                  if (menuState?.kind === 'worker' && menuState.key === key) {
                    setMenuState(null);
                  } else {
                    const rect = triggerEl.getBoundingClientRect();
                    openWorkerMenuAt(worker, key, wLabel, wIsActive, canStop, rect.left, rect.bottom + 4, triggerEl);
                  }
                }}
                onOpenWorkerContextMenu={(worker, key, wLabel, wIsActive, canStop, x, y, contextTriggerEl) => {
                  openWorkerMenuAt(worker, key, wLabel, wIsActive, canStop, x, y, null, contextTriggerEl);
                }}
              />
            </BotDisclosure>
          </div>
        );
      })}

      {menuState && typeof document !== 'undefined' && createPortal(
        <div
          ref={menuRef}
          className="dsh-bots-popover dsh-bots-chat-row-menu"
          role="menu"
          style={{ left: menuState.x, top: menuState.y, width: 176 }}
          onClick={(e) => e.stopPropagation()}
        >
          {menuState.kind === 'chat' ? (
            <>
              <button
                type="button"
                className="dsh-bots-menu-item"
                role="menuitem"
                onClick={() => {
                  const { chat, isActive } = menuState;
                  setMenuState(null);
                  openChatRow(chat, isActive);
                }}
              >
                <IconExternalLink size={13} />
                <span>{zh ? '打开对话' : 'Open chat'}</span>
              </button>
              <div className="dsh-bots-menu-sep" />
              <button
                type="button"
                className="dsh-bots-menu-item dsh-bots-menu-item-danger"
                role="menuitem"
                disabled={deletingChatId === menuState.key}
                onClick={() => void deleteChatSession(menuState.key, menuState.key, menuState.chat.chatId)}
              >
                <IconTrash size={13} />
                <span>{zh ? '删除对话' : 'Delete chat'}</span>
              </button>
            </>
          ) : (
            <>
              {menuState.worker.sessionId && (
                <button
                  type="button"
                  className="dsh-bots-menu-item"
                  role="menuitem"
                  onClick={() => {
                    const sid = menuState.worker.sessionId!;
                    const { isActive } = menuState;
                    setMenuState(null);
                    openSession(sid, isActive);
                  }}
                >
                  <IconExternalLink size={13} />
                  <span>{zh ? '打开对话' : 'Open chat'}</span>
                </button>
              )}
              {menuState.canStop && (
                <button
                  type="button"
                  className="dsh-bots-menu-item"
                  role="menuitem"
                  disabled={stoppingKey === menuState.key.replace(/^worker:/, '')}
                  onClick={() => {
                    const { worker, key } = menuState;
                    setMenuState(null);
                    void handleStopWorker(worker, key.replace(/^worker:/, ''));
                  }}
                >
                  <IconStopSquare size={13} />
                  <span>{zh ? '停止运行' : 'Stop worker'}</span>
                </button>
              )}
              {menuState.worker.sessionId && (
                <>
                  <div className="dsh-bots-menu-sep" />
                  <button
                    type="button"
                    className="dsh-bots-menu-item dsh-bots-menu-item-danger"
                    role="menuitem"
                    disabled={deletingChatId === menuState.key}
                    onClick={() => void deleteChatSession(menuState.worker.sessionId!, menuState.key)}
                  >
                    <IconTrash size={13} />
                    <span>{zh ? '删除对话' : 'Delete chat'}</span>
                  </button>
                </>
              )}
            </>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}
