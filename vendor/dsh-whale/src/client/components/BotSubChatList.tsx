// Bot sub-chat rows (Home Chat pinned first, side/automation/connector chats, and nested worker rows).

import { useMemo, useState, type MouseEvent } from 'react';
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
import type { BotChatRow, BotRecord, BotWorkerRow } from '../store/rpc';
import {
  IconChevronDown,
  IconChevronRight,
  IconGlobe,
  IconHome,
  IconMessageSquare,
  IconSpinner,
  IconZap,
} from './Icons';

export interface BotSubChatListProps {
  bot: BotRecord;
  now: number;
  hideSleepingWorkers: boolean;
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
  const { tr } = useBotsLocale();
  const [extraShown, setExtraShown] = useState(0);

  const running = useMemo(
    () => (chat.running ?? []).filter((w) => !hideSleepingWorkers || w.state !== 'sleeping'),
    [chat.running, hideSleepingWorkers],
  );
  const finished = useMemo(
    () => (chat.finished ?? []).filter((w) => !hideSleepingWorkers || w.state !== 'sleeping'),
    [chat.finished, hideSleepingWorkers],
  );

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
    <div className="dsh-bots-worker-list">
      {[...shownRunning, ...shownFinished].map((worker, idx) => {
        const key = worker.id ?? worker.sessionId ?? worker.workspaceId ?? `${chat.chatId}-w-${idx}`;
        const label = worker.title ?? worker.label ?? worker.statusText ?? 'Worker';
        return (
          <div
            key={key}
            className="dsh-bots-worker-row"
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

export function BotSubChatList({ bot, now, hideSleepingWorkers }: BotSubChatListProps) {
  const { locale, tr } = useBotsLocale();
  const rawTree = useBotsState((state) => state.chatsByBot[bot.id]);
  const activeSessionId = useBotsState((state) => state.activeSessionId);
  const activeBotId = useBotsState((state) => state.activeBotId);
  const chatFolds = useBotsState((state) => state.chatFolds);

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

  const handleChatClick = (chat: BotChatRow, event: MouseEvent) => {
    event.stopPropagation();
    if (chat.origin === 'home' && !chat.closed) {
      void botsStore.openBotHome(bot.id);
    } else {
      botsStore.openBotChat(bot.id, chat.sessionId || chat.chatId);
    }
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

        return (
          <div key={chat.chatId}>
            <div
              className="dsh-bots-subrow"
              data-active={isActive ? 'true' : 'false'}
              data-unread={chat.unread ? 'true' : 'false'}
              title={isHome ? tr('bots.chats.homeTooltip', "Home: the bot's main chat.") : label}
              onClick={(e) => handleChatClick(chat, e)}
            >
              <span className="dsh-bots-subrow-icon">
                <ChatOriginIcon origin={chat.origin} />
                <ChatLiveBadge live={chat.live} />
              </span>
              <span className="dsh-bots-subrow-title">{label}</span>
              {foldText ? (
                <span className="dsh-bots-subrow-meta">{foldText}</span>
              ) : timeText ? (
                <span className="dsh-bots-subrow-meta">{timeText}</span>
              ) : null}
              {hasWorkers && (
                <button
                  type="button"
                  className="dsh-bots-icon-btn dsh-bots-icon-btn-sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    botsStore.setChatFold(foldKey, folded ? 'open' : 'folded');
                  }}
                  aria-label={folded ? 'Expand workers' : 'Collapse workers'}
                >
                  {folded ? <IconChevronRight size={12} /> : <IconChevronDown size={12} />}
                </button>
              )}
            </div>
            {hasWorkers && !folded && (
              <BotChatWorkerRows
                botId={bot.id}
                chat={chat}
                hideSleepingWorkers={hideSleepingWorkers}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
