// Bot sub-chat rows (Home Chat pinned first, side/automation/connector chats, and nested worker rows).
// Enhanced with active-chat rim flash feedback, hover '...' & context menu (Open / Delete chat,
// protecting active Home Chat), and live 1s worker elapsed clock with hover Stop control.

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
  IconHome,
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

const FLASH_CHAT_PANE_EVENT = 'dsh-bots:flash-chat-pane';

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
  if (origin === 'home') {
    return <IconHome size={14} />;
  }
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
  chat,
  hideSleepingWorkers,
}: {
  botId: string;
  chat: BotChatRow;
  hideSleepingWorkers: boolean;
}) {
  const { locale, tr } = useBotsLocale();
  const zh = locale === 'zh-CN';
  const [extraShown, setExtraShown] = useState(0);
  const [stoppingKey, setStoppingKey] = useState<string | null>(null);

  const running = useMemo(
    () => (chat.running ?? []).filter((w) => !hideSleepingWorkers || w.state !== 'sleeping'),
    [chat.running, hideSleepingWorkers],
  );
  const finished = useMemo(
    () => (chat.finished ?? []).filter((w) => !hideSleepingWorkers || w.state !== 'sleeping'),
    [chat.finished, hideSleepingWorkers],
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

  const handleStopWorker = async (worker: BotWorkerRow, key: string, event: MouseEvent) => {
    event.stopPropagation();
    const workId = worker.id ?? worker.sessionId ?? worker.workspaceId;
    if (!workId || stoppingKey === key) {
      return;
    }
    setStoppingKey(key);
    try {
      await callBotRpc(RPC_METHODS.WORK_STOP, {
        botId,
        workId,
        ...(worker.sessionId ? { sessionId: worker.sessionId } : {}),
      });
      botsStore.pushToast({
        message: zh ? '已发送停止指令' : 'Stop requested for worker',
        tone: 'info',
      });
      void botsStore.refreshBotChatTree(botId);
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

  if (shownRunning.length === 0 && shownFinished.length === 0) {
    return null;
  }

  return (
    <div className="dsh-bots-worker-list">
      {[...shownRunning, ...shownFinished].map((worker, idx) => {
        const key = worker.id ?? worker.sessionId ?? worker.workspaceId ?? `${chat.chatId}-w-${idx}`;
        const label = worker.title ?? worker.label ?? worker.statusText ?? 'Worker';
        const active = isWorkerActive(worker);
        const elapsed = active ? formatElapsedDuration(worker.startedAt ?? worker.updatedAt, tickNow) : '';
        const canStop = active && Boolean(worker.id ?? worker.sessionId ?? worker.workspaceId);

        return (
          <div
            key={key}
            className="dsh-bots-worker-row"
            data-active-worker={active ? 'true' : 'false'}
            onClick={(e) => {
              e.stopPropagation();
              if (worker.sessionId) {
                botsStore.openBotChat(botId, worker.sessionId);
              }
            }}
            title={worker.statusText || label}
          >
            <span className="dsh-bots-worker-dot" data-state={worker.state} />
            <span className="dsh-bots-subrow-title">{label}</span>
            {(elapsed || canStop) && (
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
                    onClick={(e) => void handleStopWorker(worker, key, e)}
                  >
                    <IconStopSquare size={9} />
                    <span>{zh ? '停止' : 'Stop'}</span>
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

interface ChatMenuState {
  chat: BotChatRow;
  isHome: boolean;
  isActive: boolean;
  x: number;
  y: number;
  triggerEl: HTMLElement | null;
}

export function BotSubChatList({ bot, now, hideSleepingWorkers }: BotSubChatListProps) {
  const { locale, tr } = useBotsLocale();
  const zh = locale === 'zh-CN';
  const rawTree = useBotsState((state) => state.chatsByBot[bot.id]);
  const activeSessionId = useBotsState((state) => state.activeSessionId);
  const activeBotId = useBotsState((state) => state.activeBotId);
  const chatFolds = useBotsState((state) => state.chatFolds);

  const [menuState, setMenuState] = useState<ChatMenuState | null>(null);
  const [deletingChatId, setDeletingChatId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useAnchoredPopoverDismiss({
    open: Boolean(menuState),
    popoverRef: menuRef,
    triggerEl: menuState?.triggerEl ?? null,
    onClose: () => setMenuState(null),
  });

  const orderedChats = useMemo<BotChatRow[]>(() => {
    const owned = rawTree ? (botOwnChatTree(rawTree) as { chats: BotChatRow[] }) : null;
    const base = owned?.chats ? [...owned.chats] : [];
    const hasHome = base.some((chat) => chat.origin === 'home' && !chat.closed);
    if (!hasHome) {
      const homeSid = bot.chatSessionId ?? bot.homeSessionId ?? `home:${bot.id}`;
      base.unshift({
        chatId: homeSid,
        sessionId: homeSid,
        title: tr('bots.chats.home', 'Home Chat'),
        origin: 'home',
        unread: Boolean(bot.unread),
        live: bot.dotState === 'working' ? 'replying' : bot.dotState === 'permission' ? 'needs-you' : 'idle',
        lastActiveAt: bot.lastActiveAt ?? bot.updatedAt ?? bot.createdAt,
      });
    }
    return orderBotChats(base) as BotChatRow[];
  }, [bot, rawTree, tr]);

  const openChatRow = (chat: BotChatRow, isHome: boolean, isActive: boolean) => {
    const sid = chat.sessionId || chat.chatId;
    if (isActive) {
      triggerChatPaneRimFlash(bot.id, sid);
      return;
    }
    if (isHome) {
      void botsStore.openBotHome(bot.id);
    } else {
      botsStore.openBotChat(bot.id, sid);
    }
  };

  const handleDeleteChat = async (chat: BotChatRow, isHome: boolean) => {
    setMenuState(null);
    // Explicitly forbid deleting the active Home Chat.
    if (isHome) {
      botsStore.pushToast({
        message: zh ? '当前活跃的主对话不可直接删除，可使用「新建主对话」归档后再清理' : 'Active Home Chat cannot be deleted directly.',
        tone: 'info',
      });
      return;
    }
    const sid = chat.sessionId || chat.chatId;
    if (!sid || deletingChatId === chat.chatId) {
      return;
    }
    setDeletingChatId(chat.chatId);
    try {
      await callBotRpc(RPC_METHODS.CHAT_DELETE, {
        botId: bot.id,
        sessionId: sid,
        chatId: chat.chatId,
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

  const openMenuAt = (
    chat: BotChatRow,
    isHome: boolean,
    isActive: boolean,
    x: number,
    y: number,
    triggerEl: HTMLElement | null = null,
  ) => {
    const clampedX = Math.min(x, window.innerWidth - 188);
    const clampedY = Math.min(y, window.innerHeight - 110);
    setMenuState({ chat, isHome, isActive, x: Math.max(8, clampedX), y: Math.max(8, clampedY), triggerEl });
  };

  return (
    <div className="dsh-bots-sublist" data-paused={bot.paused ? 'true' : 'false'}>
      {orderedChats.map((chat) => {
        const isHome = chat.origin === 'home' && !chat.closed;
        const label = isHome
          ? tr('bots.chats.home', 'Home Chat')
          : (chat.title || (chat.origin === 'automation'
            ? tr('bots.chats.kindAutomation', 'Automation')
            : tr('bots.chats.kindSide', 'Side chat')));
        const foldKey = botChatFoldKey('local', bot.id, chat.chatId);
        const foldCounts = chatFoldCounts(chat) as { waiting: number; running: number } | null;
        const hasWorkers = (chat.running?.length ?? 0) > 0 || (chat.finished?.length ?? 0) > 0;
        const folded = chatFolds[foldKey] ? chatFolds[foldKey] === 'folded' : !foldCounts;
        const isActive =
          activeBotId === bot.id
          && (activeSessionId === chat.sessionId
            || activeSessionId === chat.chatId
            || (isHome && !activeSessionId));
        const timeText = formatRelativeTime(chat.lastActiveAt, now, locale);
        const foldText = folded && foldCounts ? chatFoldSummary(tr, foldCounts) : '';
        const toggleWorkers = (e: MouseEvent) => {
          e.stopPropagation();
          botsStore.setChatFold(foldKey, folded ? 'open' : 'folded');
        };

        return (
          <div key={chat.chatId}>
            <div
              className="dsh-bots-subrow"
              data-active={isActive ? 'true' : 'false'}
              data-unread={chat.unread ? 'true' : 'false'}
              data-menu-open={menuState?.chat.chatId === chat.chatId ? 'true' : 'false'}
              title={isHome ? tr('bots.chats.homeTooltip', "Home: the bot's main chat.") : label}
              onClick={(e) => {
                e.stopPropagation();
                openChatRow(chat, isHome, isActive);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                openMenuAt(chat, isHome, isActive, e.clientX, e.clientY);
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
                  aria-expanded={menuState?.chat.chatId === chat.chatId}
                  onClick={(e) => {
                    e.stopPropagation();
                    const rect = e.currentTarget.getBoundingClientRect();
                    if (menuState?.chat.chatId === chat.chatId) {
                      setMenuState(null);
                    } else {
                      openMenuAt(chat, isHome, isActive, rect.left, rect.bottom + 4, e.currentTarget);
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
                chat={chat}
                hideSleepingWorkers={hideSleepingWorkers}
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
          <button
            type="button"
            className="dsh-bots-menu-item"
            role="menuitem"
            onClick={() => {
              const { chat, isHome, isActive } = menuState;
              setMenuState(null);
              openChatRow(chat, isHome, isActive);
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
            disabled={menuState.isHome || deletingChatId === menuState.chat.chatId}
            title={menuState.isHome ? (zh ? '当前活跃主对话不可删除' : 'Active Home Chat cannot be deleted') : undefined}
            onClick={() => void handleDeleteChat(menuState.chat, menuState.isHome)}
          >
            <IconTrash size={13} />
            <span>
              {menuState.isHome
                ? (zh ? '主对话不可删除' : 'Home Chat protected')
                : (zh ? '删除对话' : 'Delete chat')}
            </span>
          </button>
        </div>,
        document.body,
      )}
    </div>
  );
}
