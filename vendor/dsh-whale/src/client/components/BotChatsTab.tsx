// Right-panel Chats tab: search chats & workers, '+ New chat', full active & closed
// conversation tree with expandable paginated nested Worker rows.

import { useEffect, useMemo, useState } from 'react';
import { CHAT_TREE_CAPS, orderBotChats } from '../../shared/bot-sidebar-logic.js';
import {
  botsStore,
  formatRelativeTime,
  useBotsLocale,
  useBotsState,
  useNow,
} from '../store/bots-store';
import {
  RPC_METHODS,
  callBotRpc,
  type BotChatRow,
  type BotRecord,
  type BotWorkerRow,
} from '../store/rpc';
import {
  IconChevronDown,
  IconChevronRight,
  IconHome,
  IconMessageSquare,
  IconPlus,
  IconSearch,
  IconZap,
} from './Icons';

export interface BotChatsTabProps {
  bot: BotRecord;
}

const INITIAL_CHATS_SHOWN = 8;

function chatOriginIcon(origin: string) {
  if (origin === 'home') {
    return <IconHome size={13} />;
  }
  if (origin === 'automation') {
    return <IconZap size={13} />;
  }
  return <IconMessageSquare size={13} />;
}

function workerBadgeClass(state: BotWorkerRow['state']): string {
  if (state === 'needs-you') {
    return 'dsh-bots-badge dsh-bots-badge-warn';
  }
  if (state === 'failed') {
    return 'dsh-bots-badge dsh-bots-badge-danger';
  }
  if (state === 'running' || state === 'working') {
    return 'dsh-bots-badge dsh-bots-badge-accent';
  }
  return 'dsh-bots-badge';
}

function workerStateLabel(state: BotWorkerRow['state'], zh: boolean): string {
  const map: Record<string, [string, string]> = {
    'needs-you': ['等待处理', 'Needs you'],
    running: ['运行中', 'Running'],
    working: ['进行中', 'Working'],
    failed: ['失败', 'Failed'],
    done: ['已完成', 'Done'],
    sleeping: ['休眠', 'Sleeping'],
    unreachable: ['不可达', 'Unreachable'],
  };
  const pair = map[state] ?? [state, state];
  return zh ? pair[0] : pair[1];
}

export function BotChatsTab({ bot }: BotChatsTabProps) {
  const { locale, tr } = useBotsLocale();
  const zh = locale === 'zh-CN';
  const now = useNow(60_000);
  const activeSessionId = useBotsState((state) => state.activeSessionId);
  const cachedTree = useBotsState((state) => state.chatsByBot[bot.id]);
  const [query, setQuery] = useState('');
  const [remoteChats, setRemoteChats] = useState<BotChatRow[] | null>(null);
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
  const [workerCaps, setWorkerCaps] = useState<Record<string, number>>({});
  const [visibleLimit, setVisibleLimit] = useState(INITIAL_CHATS_SHOWN);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    void botsStore.refreshBotChatTree(bot.id);
  }, [bot.id]);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setRemoteChats(null);
      return undefined;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void callBotRpc<{ chats?: BotChatRow[] } | BotChatRow[]>(RPC_METHODS.CHATS_SEARCH, {
        botId: bot.id,
        query: trimmed,
      })
        .then((res) => {
          if (cancelled) {
            return;
          }
          const rows = Array.isArray(res) ? res : (res?.chats ?? []);
          setRemoteChats(rows);
        })
        .catch((err) => {
          console.warn('[dsh-bots] chats search fallback to local filter', err);
          if (!cancelled) {
            setRemoteChats(null);
          }
        });
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [bot.id, query]);

  const chats = useMemo(() => {
    const base = remoteChats ?? cachedTree?.chats ?? [];
    const ordered = orderBotChats(base) as BotChatRow[];
    const trimmed = query.trim().toLowerCase();
    if (!trimmed || remoteChats !== null) {
      return ordered;
    }
    return ordered.filter((chat) => {
      const title = (chat.title || (chat.origin === 'home' ? 'Home Chat' : '')).toLowerCase();
      const preview = (chat.lastMessageText || chat.statusText || '').toLowerCase();
      const workerHit = [...(chat.running ?? []), ...(chat.finished ?? [])].some((w) =>
        `${w.title ?? ''} ${w.label ?? ''} ${w.statusText ?? ''}`.toLowerCase().includes(trimmed),
      );
      return title.includes(trimmed) || preview.includes(trimmed) || workerHit;
    });
  }, [cachedTree?.chats, query, remoteChats]);

  const shownChats = chats.slice(0, visibleLimit);
  const remaining = Math.max(0, chats.length - shownChats.length);

  const handleNewChat = async () => {
    setStarting(true);
    try {
      await botsStore.startSideChat(bot.id);
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="dsh-bots-panel-scroll">
      <div className="dsh-bots-row">
        <div style={{ position: 'relative', flex: 1 }}>
          <IconSearch
            size={13}
            style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', opacity: 0.55 }}
          />
          <input
            type="text"
            className="dsh-bots-pinput"
            style={{ paddingLeft: 26, height: 28 }}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={tr('bots.chats.searchPlaceholder', 'Search chats and workers')}
          />
        </div>
        <button
          type="button"
          className="dsh-bots-pbtn"
          disabled={starting}
          onClick={() => void handleNewChat()}
        >
          <IconPlus size={12} />
          <span>{tr('bots.chats.newChat', 'New chat')}</span>
        </button>
      </div>

      {shownChats.length === 0 ? (
        <div className="dsh-bots-empty">
          {query.trim()
            ? tr('bots.search.noMatches', 'No matches')
            : (zh ? '暂无聊天记录。点击右上角「新建聊天」开始。' : 'No chats yet.')}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {shownChats.map((chat) => {
            const isHome = chat.origin === 'home' && !chat.closed;
            const active = chat.sessionId === activeSessionId || chat.chatId === activeSessionId;
            const workers = [...(chat.running ?? []), ...(chat.finished ?? [])];
            const expanded = Boolean(expandedIds[chat.chatId]);
            const cap = workerCaps[chat.chatId] ?? (CHAT_TREE_CAPS.runningShown + CHAT_TREE_CAPS.finishedShown);
            const shownWorkers = workers.slice(0, cap);
            const moreWorkers = Math.max(0, workers.length - shownWorkers.length);
            const title = isHome
              ? tr('bots.chats.home', 'Home Chat')
              : (chat.title || tr('bots.chats.kindSide', 'Side chat'));

            return (
              <div key={chat.chatId} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <div
                  className="dsh-bots-tree-row"
                  data-active={active ? 'true' : 'false'}
                  onClick={() => {
                    if (isHome) {
                      void botsStore.openBotHome(bot.id);
                    } else {
                      botsStore.openBotChat(bot.id, chat.sessionId);
                    }
                  }}
                >
                  {workers.length > 0 ? (
                    <button
                      type="button"
                      className="dsh-bots-pbtn dsh-bots-pbtn-xs dsh-bots-pbtn-icon"
                      style={{ width: 18, height: 18 }}
                      aria-label={expanded ? 'Collapse workers' : 'Expand workers'}
                      onClick={(e) => {
                        e.stopPropagation();
                        setExpandedIds((prev) => ({ ...prev, [chat.chatId]: !prev[chat.chatId] }));
                      }}
                    >
                      {expanded ? <IconChevronDown size={11} /> : <IconChevronRight size={11} />}
                    </button>
                  ) : (
                    <span style={{ width: 18, display: 'inline-flex', justifyContent: 'center', opacity: 0.7 }}>
                      {chatOriginIcon(chat.origin)}
                    </span>
                  )}

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="dsh-bots-row">
                      <span className="dsh-bots-ellipsis" style={{ fontWeight: chat.unread || active ? 600 : 500 }}>
                        {title}
                      </span>
                      <span className="dsh-bots-muted" style={{ flexShrink: 0 }}>
                        {formatRelativeTime(chat.lastActiveAt ?? chat.updatedAt, now, locale)}
                      </span>
                    </div>
                    <div className="dsh-bots-row">
                      <span className="dsh-bots-muted dsh-bots-ellipsis">
                        {chat.statusText || chat.lastMessageText || (chat.closed ? (zh ? '已归档历史' : 'Closed') : '')}
                      </span>
                      <div style={{ display: 'inline-flex', gap: 4, flexShrink: 0 }}>
                        {chat.closed && <span className="dsh-bots-badge">{zh ? '已关闭' : 'Closed'}</span>}
                        {chat.live === 'needs-you' && (
                          <span className="dsh-bots-badge dsh-bots-badge-warn">{zh ? '待处理' : 'Needs you'}</span>
                        )}
                        {workers.length > 0 && (
                          <span className="dsh-bots-badge">{workers.length}</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {expanded && workers.length > 0 && (
                  <div className="dsh-bots-pworker-list">
                    {shownWorkers.map((worker, idx) => (
                      <div
                        key={worker.id ?? worker.sessionId ?? `${chat.chatId}-w-${idx}`}
                        className="dsh-bots-tree-row"
                        style={{ padding: '4px 6px' }}
                        onClick={() => {
                          if (worker.sessionId) {
                            botsStore.openBotChat(bot.id, worker.sessionId);
                          }
                        }}
                      >
                        <span className="dsh-bots-ellipsis" style={{ flex: 1, fontSize: 11.5 }}>
                          {worker.title || worker.label || (zh ? '工作者' : 'Worker')}
                        </span>
                        <span className={workerBadgeClass(worker.state)}>
                          {workerStateLabel(worker.state, zh)}
                        </span>
                      </div>
                    ))}
                    {moreWorkers > 0 && (
                      <button
                        type="button"
                        className="dsh-bots-pbtn dsh-bots-pbtn-xs dsh-bots-pbtn-ghost"
                        style={{ alignSelf: 'flex-start' }}
                        onClick={() => setWorkerCaps((prev) => ({
                          ...prev,
                          [chat.chatId]: cap + CHAT_TREE_CAPS.step,
                        }))}
                      >
                        {tr('bots.chats.showMoreWorkers', 'Show {{count}} more workers', {
                          count: Math.min(CHAT_TREE_CAPS.step, moreWorkers),
                        })}
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {remaining > 0 && (
            <button
              type="button"
              className="dsh-bots-pbtn dsh-bots-pbtn-xs"
              style={{ alignSelf: 'center', marginTop: 4 }}
              onClick={() => setVisibleLimit((prev) => prev + INITIAL_CHATS_SHOWN)}
            >
              {zh
                ? `再显示 ${Math.min(INITIAL_CHATS_SHOWN, remaining)} 条 · 另有 ${remaining} 条更早记录`
                : `Show ${Math.min(INITIAL_CHATS_SHOWN, remaining)} more · ${remaining} earlier`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
