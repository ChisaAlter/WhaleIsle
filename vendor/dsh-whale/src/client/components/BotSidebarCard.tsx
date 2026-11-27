// Sidebar bot card with 36px mascot avatar, 11-tier activity line, inline rename,
// 8-item context menu, hover preview card, drag reorder, and expandable sub-chat tree.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent,
} from 'react';
import { createPortal } from 'react-dom';
import {
  botChatFoldKey,
  botFoldLiveStatus,
  botHasSubChats,
  botOwnChatTree,
  botRowLineText,
  botWaitTimeFormat,
  chatFoldCounts,
  countLiveBotWorkspaces,
  resolveBotRowActivityLine,
} from '../../shared/bot-sidebar-logic.js';
import {
  botsStore,
  formatRelativeTime,
  useBotsLocale,
  useBotsState,
} from '../store/bots-store';
import type { BotChatRow, BotRecord } from '../store/rpc';
import { BotAvatar } from './BotAvatar';
import { BotChevron, BotDisclosure } from './BotDisclosure';
import { BotHoverCard } from './BotHoverCard';
import { BotSubChatList } from './BotSubChatList';
import { useAnchoredPopoverDismiss } from './useAnchoredPopoverDismiss';
import {
  IconCopy,
  IconEdit,
  IconEye,
  IconEyeOff,
  IconPause,
  IconPlay,
  IconSettings,
  IconTrash,
} from './Icons';

export interface SearchTextSegment {
  text: string;
  marked: boolean;
}

export interface BotCardSearchMatch {
  matchedBy: 'name' | 'purpose';
  nameSegments: SearchTextSegment[];
  purpose?: { segments: SearchTextSegment[] } | null;
}

export interface BotSidebarCardProps {
  bot: BotRecord;
  now: number;
  collapsed: boolean;
  hideSleepingWorkers: boolean;
  manualSort: boolean;
  searchMatch?: BotCardSearchMatch | null;
  dragging?: boolean;
  dropPosition?: 'before' | 'after' | null;
  onDragStart?: (botId: string) => void;
  onDragOverCard?: (botId: string, event: DragEvent<HTMLDivElement>) => void;
  onDropCard?: (botId: string, event: DragEvent<HTMLDivElement>) => void;
  onDragEnd?: () => void;
}

function HighlightedSegments({ segments }: { segments: SearchTextSegment[] }) {
  return (
    <>
      {segments.map((seg, idx) =>
        seg.marked ? (
          <mark key={idx} className="dsh-bots-mark">{seg.text}</mark>
        ) : (
          <span key={idx}>{seg.text}</span>
        ),
      )}
    </>
  );
}

function BotContextMenu({
  bot,
  position,
  triggerRef,
  onClose,
  onStartRename,
}: {
  bot: BotRecord;
  position: { x: number; y: number };
  triggerRef?: { current: HTMLElement | null };
  onClose: () => void;
  onStartRename: () => void;
}) {
  const { locale, tr } = useBotsLocale();
  const menuRef = useRef<HTMLDivElement | null>(null);

  useAnchoredPopoverDismiss({
    open: true,
    popoverRef: menuRef,
    contextTriggerRef: triggerRef,
    onClose,
  });

  if (typeof document === 'undefined') {
    return null;
  }

  const left = Math.max(8, Math.min(position.x, window.innerWidth - 210));
  const top = Math.max(8, Math.min(position.y, window.innerHeight - 280));
  const hasUnreadSignal = Boolean(bot.unread) || bot.dotState === 'failed' || (bot.upNextCount ?? 0) > 0;

  return createPortal(
    <div ref={menuRef} className="dsh-bots-popover" style={{ left, top }}>
      <button
        type="button"
        className="dsh-bots-menu-item"
        onClick={() => {
          onClose();
          onStartRename();
        }}
      >
        <IconEdit size={14} />
        <span>{tr('bots.row.rename', 'Rename')}</span>
      </button>
      <button
        type="button"
        className="dsh-bots-menu-item"
        onClick={() => {
          onClose();
          botsStore.openBotSettings(bot.id, { host: 'page' });
        }}
      >
        <IconSettings size={14} />
        <span>{tr('bots.row.settings', 'Bot settings…')}</span>
      </button>
      <button
        type="button"
        className="dsh-bots-menu-item"
        onClick={() => {
          onClose();
          void botsStore.updateBot(bot.id, { paused: !bot.paused });
        }}
      >
        {bot.paused ? <IconPlay size={14} /> : <IconPause size={14} />}
        <span>{bot.paused ? tr('bots.row.resume', 'Resume bot') : tr('bots.row.pause', 'Pause bot')}</span>
      </button>
      <div className="dsh-bots-menu-sep" />
      <button
        type="button"
        className="dsh-bots-menu-item"
        disabled={!bot.homePath}
        onClick={() => {
          onClose();
          if (bot.homePath) {
            void botsStore.copyToClipboard(bot.homePath).then((ok) => {
              if (ok) {
                botsStore.pushToast({
                  message: locale === 'zh-CN' ? '已复制队友路径' : 'Copied bot path',
                  tone: 'success',
                }, 2500);
              }
            });
          }
        }}
      >
        <IconCopy size={14} />
        <span>{tr('bots.row.copyPath', 'Copy Path')}</span>
      </button>
      <button
        type="button"
        className="dsh-bots-menu-item"
        onClick={() => {
          onClose();
          const targetSessionId = hasUnreadSignal ? null : (bot.chatSessionId ?? bot.homeSessionId ?? null);
          void botsStore.markChatSeen(bot.id, targetSessionId, hasUnreadSignal);
          if (hasUnreadSignal && (bot.upNextCount ?? 0) > 0) {
            void botsStore.markUpNextSeen(bot.id);
          }
        }}
      >
        {hasUnreadSignal ? <IconEye size={14} /> : <IconEyeOff size={14} />}
        <span>{hasUnreadSignal ? tr('bots.row.markRead', 'Mark Read') : tr('bots.row.markUnread', 'Mark Unread')}</span>
      </button>
      <div className="dsh-bots-menu-sep" />
      <button
        type="button"
        className="dsh-bots-menu-item"
        data-danger="true"
        onClick={() => {
          onClose();
          botsStore.openModal({ kind: 'confirm-delete-bot', botId: bot.id });
        }}
      >
        <IconTrash size={14} />
        <span>{tr('bots.row.delete', 'Delete bot')}</span>
      </button>
    </div>,
    document.body,
  );
}

export function BotSidebarCard({
  bot,
  now,
  collapsed,
  hideSleepingWorkers,
  manualSort,
  searchMatch,
  dragging,
  dropPosition,
  onDragStart,
  onDragOverCard,
  onDropCard,
  onDragEnd,
}: BotSidebarCardProps) {
  const { locale, tr } = useBotsLocale();
  const activeBotId = useBotsState((state) => state.activeBotId);
  const activeGroupId = useBotsState((state) => state.activeGroupId);
  const activeSessionId = useBotsState((state) => state.activeSessionId);
  const chatFolds = useBotsState((state) => state.chatFolds);
  const needsYouCount = useBotsState((state) => state.needsYou[bot.id] ?? bot.needsYouCount ?? 0);
  const startingSessionIds = useBotsState((state) => state.startingSessionIds);
  const chatTree = useBotsState((state) => state.chatsByBot[bot.id]);

  const cardRef = useRef<HTMLDivElement | null>(null);
  const openHoverTimer = useRef<number | null>(null);
  const closeHoverTimer = useRef<number | null>(null);

  const [renaming, setRenaming] = useState(false);
  const [renameText, setRenameText] = useState(bot.name);
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [hoverRect, setHoverRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    setRenameText(bot.name);
  }, [bot.name]);

  const clearHoverTimers = useCallback(() => {
    if (openHoverTimer.current !== null) {
      window.clearTimeout(openHoverTimer.current);
      openHoverTimer.current = null;
    }
    if (closeHoverTimer.current !== null) {
      window.clearTimeout(closeHoverTimer.current);
      closeHoverTimer.current = null;
    }
  }, []);

  useEffect(() => clearHoverTimers, [clearHoverTimers]);

  const scheduleHoverOpen = () => {
    if (renaming || menuPos) {
      return;
    }
    clearHoverTimers();
    openHoverTimer.current = window.setTimeout(() => {
      if (cardRef.current) {
        setHoverRect(cardRef.current.getBoundingClientRect());
      }
    }, 420);
  };

  const scheduleHoverClose = () => {
    clearHoverTimers();
    closeHoverTimer.current = window.setTimeout(() => {
      setHoverRect(null);
    }, 120);
  };

  const { lineText, lineTone } = useMemo(() => {
    if (typeof bot.activityLine === 'string' && bot.activityLine.trim()) {
      const tone = needsYouCount > 0 || bot.dotState === 'permission'
        ? 'attention'
        : bot.dotState === 'working'
          ? 'working'
          : 'default';
      return { lineText: bot.activityLine, lineTone: tone };
    }
    const resolved = bot.activityLine && typeof bot.activityLine === 'object'
      ? bot.activityLine
      : resolveBotRowActivityLine({
        disconnected: bot.disconnected,
        hostName: bot.hostName,
        paused: bot.paused,
        chatSessionId: bot.chatSessionId ?? bot.homeSessionId,
        chatPaneKey: bot.chatPaneKey,
        rows: bot.rows ?? [],
        links: bot.links ?? [],
        waits: bot.waits ?? [],
        workers: bot.workers,
        itemsNeedingYou: needsYouCount,
        usageLimit: bot.usageLimit,
        description: bot.description ?? bot.purpose ?? '',
        startingSessionIds: new Set(startingSessionIds),
        now,
      });
    const waitFormatter = (ts: number) =>
      new Intl.DateTimeFormat(locale, botWaitTimeFormat(ts, now) as Intl.DateTimeFormatOptions).format(new Date(ts));
    const text = botRowLineText(resolved, tr, waitFormatter) || bot.description || bot.purpose || '';
    const kind = resolved?.kind ?? '';
    const tone = kind === 'needYouElsewhere' || kind === 'usageLimit' || needsYouCount > 0
      ? 'attention'
      : kind === 'workingElsewhere' || kind === 'replying' || kind === 'reading'
        ? 'working'
        : 'default';
    return { lineText: text, lineTone: tone };
  }, [bot, locale, needsYouCount, now, startingSessionIds, tr]);

  const foldSignal = useMemo(() => {
    if (!collapsed) {
      return null;
    }
    const statuses: string[] = [];
    for (const chat of chatTree?.chats ?? []) {
      for (const worker of chat.running ?? []) {
        if (worker.state === 'needs-you') {
          statuses.push('permission');
        } else if (worker.state === 'running' || worker.state === 'working') {
          statuses.push('working');
        } else if (worker.state === 'failed') {
          statuses.push('failed');
        }
      }
    }
    const counts = countLiveBotWorkspaces(statuses);
    if (bot.workers) {
      counts.permission += bot.workers.permission ?? 0;
      counts.working += bot.workers.working ?? 0;
      counts.failed += bot.workers.failed ?? 0;
    }
    return botFoldLiveStatus(counts) as 'permission' | 'working' | 'failed' | null;
  }, [bot.workers, chatTree?.chats, collapsed]);

  const commitRename = () => {
    const trimmed = renameText.trim();
    setRenaming(false);
    if (trimmed && trimmed !== bot.name) {
      void botsStore.updateBot(bot.id, { name: trimmed.slice(0, 64) });
    } else {
      setRenameText(bot.name);
    }
  };

  const handleContextMenu = (event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    clearHoverTimers();
    setHoverRect(null);
    setMenuPos({ x: event.clientX, y: event.clientY });
  };

  const isActive = activeBotId === bot.id && !activeGroupId;
  const hasSubChats = useMemo(
    () => botHasSubChats(chatTree, hideSleepingWorkers),
    [chatTree, hideSleepingWorkers],
  );
  const showExpandedTree = hasSubChats && !collapsed;
  const ownedChatTree = useMemo(
    () => (chatTree ? (botOwnChatTree(chatTree) as { chats?: BotChatRow[] }) : null),
    [chatTree],
  );
  const homeChat = useMemo(
    () => (ownedChatTree?.chats ?? []).find((chat) => chat.origin === 'home' && !chat.closed) ?? null,
    [ownedChatTree],
  );
  const homeSessionId = bot.chatSessionId ?? bot.homeSessionId ?? homeChat?.sessionId ?? homeChat?.chatId ?? null;
  const isHomeSession = !activeSessionId || (homeSessionId !== null && activeSessionId === homeSessionId);
  const hasActiveVisibleChild = useMemo(() => {
    if (!showExpandedTree || !activeSessionId || isHomeSession) {
      return false;
    }
    const openChats = (ownedChatTree?.chats ?? []).filter((chat) => !chat.closed);
    for (const chat of openChats) {
      const chatKey = chat.sessionId || chat.chatId || (chat as { id?: string }).id || '';
      const isHome = chat.origin === 'home';
      if (!isHome && (chat.sessionId === activeSessionId || chat.chatId === activeSessionId)) {
        return true;
      }
      const workers = [...(chat.running ?? []), ...(chat.finished ?? [])].filter(
        (w) => !hideSleepingWorkers || w.state !== 'sleeping',
      );
      if (workers.length === 0) {
        continue;
      }
      if (isHome) {
        if (workers.some((w) => w.sessionId === activeSessionId)) {
          return true;
        }
        continue;
      }
      const foldKey = botChatFoldKey('local', bot.id, chatKey);
      const folded = chatFolds[foldKey] ? chatFolds[foldKey] === 'folded' : !chatFoldCounts(chat);
      if (!folded && workers.some((w) => w.sessionId === activeSessionId)) {
        return true;
      }
    }
    return false;
  }, [activeSessionId, bot.id, chatFolds, hideSleepingWorkers, isHomeSession, ownedChatTree, showExpandedTree]);

  const parentActive = isActive && !hasActiveVisibleChild;
  const hasActiveChild = isActive && hasActiveVisibleChild;
  const timeText = formatRelativeTime(bot.lastActiveAt ?? bot.updatedAt ?? bot.createdAt, now, locale);
  const avatarStatus = needsYouCount > 0 ? 'attention' : (bot.dotState ?? undefined);

  return (
    <div
      className="dsh-bots-card-wrap"
      data-dragging={dragging ? 'true' : 'false'}
      data-drop-position={dropPosition ?? undefined}
      onDragOver={(e) => onDragOverCard?.(bot.id, e)}
      onDrop={(e) => onDropCard?.(bot.id, e)}
    >
      <div
        ref={cardRef}
        className="dsh-bots-card"
        draggable={manualSort && !renaming}
        onDragStart={() => onDragStart?.(bot.id)}
        onDragEnd={onDragEnd}
        data-active={parentActive ? 'true' : 'false'}
        data-has-active-child={hasActiveChild ? 'true' : 'false'}
        data-unread={bot.unread ? 'true' : 'false'}
        data-dimmed={bot.paused || bot.disconnected ? 'true' : 'false'}
        onClick={() => {
          if (!renaming) {
            void botsStore.openBotHome(bot.id);
          }
        }}
        onContextMenu={handleContextMenu}
        onMouseEnter={scheduleHoverOpen}
        onMouseLeave={scheduleHoverClose}
      >
        <BotAvatar
          botId={bot.id}
          avatar={bot.avatar}
          avatarColor={bot.avatarColor}
          name={bot.name}
          size={28}
          radius={8}
          status={avatarStatus}
          unread={bot.unread}
          paused={bot.paused}
          usageLimit={Boolean(bot.usageLimit)}
        />

        <div className="dsh-bots-card-body">
          <div className="dsh-bots-card-top">
            {renaming ? (
              <input
                type="text"
                className="dsh-bots-inline-rename"
                value={renameText}
                maxLength={64}
                autoFocus
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => setRenameText(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    commitRename();
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    setRenameText(bot.name);
                    setRenaming(false);
                  }
                }}
              />
            ) : (
              <span className="dsh-bots-card-name">
                {searchMatch?.matchedBy === 'name' ? (
                  <HighlightedSegments segments={searchMatch.nameSegments} />
                ) : (
                  bot.name
                )}
              </span>
            )}
            {!renaming && timeText && (
              <span className="dsh-bots-card-time">{timeText}</span>
            )}
          </div>

          <div className="dsh-bots-card-sub">
            <span className="dsh-bots-card-line" data-tone={lineTone}>
              {searchMatch?.matchedBy === 'purpose' && searchMatch.purpose ? (
                <HighlightedSegments segments={searchMatch.purpose.segments} />
              ) : (
                lineText
              )}
            </span>
            {(bot.upNextCount ?? 0) > 0 && (
              <button
                type="button"
                className="dsh-bots-upnext-pill"
                title={tr('bots.upNext.title', 'Up next')}
                onClick={(e) => {
                  e.stopPropagation();
                  void botsStore.markUpNextSeen(bot.id);
                  void botsStore.openBotHome(bot.id).finally(() => {
                    if (botsStore.getState().activeBotId === bot.id) {
                      botsStore.setRightPanelTab('home', bot.id);
                    }
                  });
                }}
              >
                {bot.upNextCount}
              </button>
            )}
          </div>
        </div>

        {hasSubChats && (
          <button
            type="button"
            className="dsh-bots-card-fold-btn"
            data-collapsed={collapsed ? 'true' : 'false'}
            data-has-signal={foldSignal ? 'true' : 'false'}
            aria-expanded={!collapsed}
            aria-label={collapsed ? 'Expand chats' : 'Collapse chats'}
            onClick={(e) => {
              e.stopPropagation();
              botsStore.toggleBotCollapsed(bot.id);
            }}
          >
            <BotChevron open={!collapsed} size={14} />
            {foldSignal && (
              <span className="dsh-bots-fold-dot" data-signal={foldSignal} />
            )}
          </button>
        )}
      </div>

      <BotDisclosure open={showExpandedTree} className="dsh-bots-sublist-disclosure">
        <BotSubChatList
          bot={bot}
          now={now}
          hideSleepingWorkers={hideSleepingWorkers}
        />
      </BotDisclosure>

      {menuPos && (
        <BotContextMenu
          bot={bot}
          position={menuPos}
          triggerRef={cardRef}
          onClose={() => setMenuPos(null)}
          onStartRename={() => setRenaming(true)}
        />
      )}

      {hoverRect && !menuPos && !renaming && (
        <BotHoverCard
          bot={bot}
          anchorRect={hoverRect}
          now={now}
          statusLine={lineText}
          onMouseEnter={clearHoverTimers}
          onMouseLeave={scheduleHoverClose}
          onClose={() => setHoverRect(null)}
        />
      )}
    </div>
  );
}
