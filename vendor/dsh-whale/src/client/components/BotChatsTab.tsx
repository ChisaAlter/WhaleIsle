// Right-panel Chats tab: search chats & workers, '+ New chat', 'Adopt ordinary session as crew…' modal,
// adopted crew list with release action, and full active & closed conversation tree with smooth disclosure.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
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
  type BotCrewAdoption,
  type BotRecord,
  type BotWorkerRow,
} from '../store/rpc';
import { BotChevron, BotDisclosure } from './BotDisclosure';
import {
  IconHome,
  IconMessageSquare,
  IconPlus,
  IconSearch,
  IconUsers,
  IconX,
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
  const changeSeq = useBotsState((state) => state.changeSeq);
  const [query, setQuery] = useState('');
  const [remoteChats, setRemoteChats] = useState<BotChatRow[] | null>(null);
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
  const [workerCaps, setWorkerCaps] = useState<Record<string, number>>({});
  const [visibleLimit, setVisibleLimit] = useState(INITIAL_CHATS_SHOWN);
  const [starting, setStarting] = useState(false);

  // Crew adoption state
  const [crewList, setCrewList] = useState<BotCrewAdoption[]>([]);
  const [crewOpen, setCrewOpen] = useState(true);
  const [adoptModalOpen, setAdoptModalOpen] = useState(false);
  const [adoptSessionId, setAdoptSessionId] = useState('');
  const [adoptTitle, setAdoptTitle] = useState('');
  const [adoptCwd, setAdoptCwd] = useState('');
  const [adoptRole, setAdoptRole] = useState('crew');
  const [adopting, setAdopting] = useState(false);
  const [releasingId, setReleasingId] = useState<string | null>(null);

  const loadCrew = useCallback(async () => {
    const rows = await botsStore.listCrew(bot.id);
    setCrewList(rows);
  }, [bot.id]);

  useEffect(() => {
    void botsStore.refreshBotChatTree(bot.id);
    void loadCrew();
  }, [bot.id, changeSeq, loadCrew]);

  useEffect(() => {
    if (!adoptModalOpen) return undefined;
    const handleEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setAdoptModalOpen(false);
    };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [adoptModalOpen]);

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

  const handleAdoptSubmit = async () => {
    const sid = adoptSessionId.trim();
    if (!sid || adopting) return;
    setAdopting(true);
    try {
      await botsStore.adoptCrew({
        botId: bot.id,
        sessionId: sid,
        ...(adoptTitle.trim() ? { title: adoptTitle.trim() } : {}),
        ...(adoptCwd.trim() ? { cwd: adoptCwd.trim() } : {}),
        role: adoptRole || 'crew',
      });
      setAdoptModalOpen(false);
      setAdoptSessionId('');
      setAdoptTitle('');
      setAdoptCwd('');
      setAdoptRole('crew');
      await loadCrew();
      botsStore.pushToast({ message: zh ? '已将普通会话收编为船员' : 'Session adopted as crew', tone: 'success' });
    } catch (err) {
      botsStore.pushToast({ message: err instanceof Error ? err.message : String(err), tone: 'error' });
    } finally {
      setAdopting(false);
    }
  };

  const handleReleaseCrew = async (sessionId: string) => {
    if (releasingId) return;
    setReleasingId(sessionId);
    try {
      await botsStore.releaseCrew(sessionId, bot.id);
      await loadCrew();
      botsStore.pushToast({ message: zh ? '已释放该船员会话' : 'Crew session released', tone: 'info' });
    } catch (err) {
      botsStore.pushToast({ message: err instanceof Error ? err.message : String(err), tone: 'error' });
    } finally {
      setReleasingId(null);
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

      {/* Crew Adoption Toolbar & Collapsible Adopted Crew List */}
      <div className="dsh-bots-pcard" data-dsh-bots-crew-section={bot.id}>
        <div className="dsh-bots-row">
          <button
            type="button"
            className="dsh-bots-item-group-btn"
            style={{ width: 'auto', flex: 1 }}
            onClick={() => setCrewOpen((prev) => !prev)}
          >
            <BotChevron open={crewOpen} size={12} />
            <IconUsers size={12} />
            <span>{zh ? '已收编船员' : 'Adopted crew'}</span>
            <span className="dsh-bots-badge">{crewList.length}</span>
          </button>
          <button
            type="button"
            className="dsh-bots-pbtn dsh-bots-pbtn-xs"
            data-dsh-bots-adopt-trigger=""
            onClick={() => {
              if (!adoptSessionId && activeSessionId) {
                setAdoptSessionId(activeSessionId);
              }
              setAdoptModalOpen(true);
            }}
          >
            <IconPlus size={11} />
            <span>{zh ? '收编普通会话为船员…' : 'Adopt session…'}</span>
          </button>
        </div>
        <BotDisclosure open={crewOpen}>
          {crewList.length === 0 ? (
            <div className="dsh-bots-muted" style={{ marginTop: 4 }}>
              {zh
                ? '暂无收编的普通会话。可把已有开发/调研会话纳入当前队友麾下协同调度。'
                : 'No adopted crew sessions yet.'}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
              {crewList.map((crew) => (
                <div
                  key={crew.sessionId}
                  className="dsh-bots-tree-row"
                  data-dsh-bots-crew-row={crew.sessionId}
                  onClick={() => botsStore.openBotChat(bot.id, crew.sessionId)}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="dsh-bots-row">
                      <span className="dsh-bots-ellipsis" style={{ fontWeight: 500, fontSize: 12 }}>
                        {crew.title || crew.sessionId}
                      </span>
                      <span className="dsh-bots-badge dsh-bots-badge-accent">{crew.role || 'crew'}</span>
                    </div>
                    {crew.cwd && (
                      <div className="dsh-bots-muted dsh-bots-ellipsis dsh-bots-tsv-mono" style={{ fontSize: 11 }}>
                        {crew.cwd}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    className="dsh-bots-pbtn dsh-bots-pbtn-xs"
                    disabled={releasingId === crew.sessionId}
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleReleaseCrew(crew.sessionId);
                    }}
                  >
                    {zh ? '释放' : 'Release'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </BotDisclosure>
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
                      <BotChevron open={expanded} size={11} />
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

                {workers.length > 0 && (
                  <BotDisclosure open={expanded}>
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
                  </BotDisclosure>
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

      {/* Lightweight Adopt Ordinary Session as Crew Modal */}
      {adoptModalOpen && typeof document !== 'undefined' && createPortal(
        <div
          className="dsh-bots-backdrop"
          data-dsh-bots-adopt-modal=""
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setAdoptModalOpen(false);
          }}
        >
          <div role="dialog" aria-modal="true" className="dsh-bots-modal dsh-bots-modal-sm">
            <div className="dsh-bots-modal-header">
              <div className="dsh-bots-modal-title">
                {zh ? '收编普通会话为船员' : 'Adopt ordinary session as crew'}
              </div>
              <button
                type="button"
                className="dsh-bots-icon-btn"
                aria-label={zh ? '关闭' : 'Close'}
                onClick={() => setAdoptModalOpen(false)}
              >
                <IconX size={15} />
              </button>
            </div>
            <div className="dsh-bots-modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div className="dsh-bots-muted">
                {zh
                  ? `将已有普通会话纳入「${bot.name}」的船员编队，随时可一键释放，不会修改原会话历史。`
                  : `Link an existing session under "${bot.name}" as a crew member. Reversible at any time.`}
              </div>
              <label className="dsh-bots-field">
                <span className="dsh-bots-muted">{zh ? '会话 ID (sessionId)' : 'Session ID'}</span>
                <input
                  type="text"
                  className="dsh-bots-input"
                  placeholder={zh ? '输入或粘贴会话 ID…' : 'Enter or paste session ID…'}
                  value={adoptSessionId}
                  onChange={(e) => setAdoptSessionId(e.target.value)}
                />
              </label>
              <label className="dsh-bots-field">
                <span className="dsh-bots-muted">{zh ? '船员标题（可选）' : 'Title (optional)'}</span>
                <input
                  type="text"
                  className="dsh-bots-input"
                  placeholder={zh ? '例如：前端重构线程' : 'e.g. Frontend refactor'}
                  value={adoptTitle}
                  onChange={(e) => setAdoptTitle(e.target.value)}
                />
              </label>
              <label className="dsh-bots-field">
                <span className="dsh-bots-muted">{zh ? '工作目录（可选）' : 'Working directory (optional)'}</span>
                <input
                  type="text"
                  className="dsh-bots-input"
                  placeholder="C:/repo/path"
                  value={adoptCwd}
                  onChange={(e) => setAdoptCwd(e.target.value)}
                />
              </label>
              <label className="dsh-bots-field">
                <span className="dsh-bots-muted">{zh ? '编队角色' : 'Crew role'}</span>
                <select
                  className="dsh-bots-select"
                  value={adoptRole}
                  onChange={(e) => setAdoptRole(e.target.value)}
                >
                  <option value="crew">{zh ? '执行船员 (crew)' : 'Crew'}</option>
                  <option value="reviewer">{zh ? '审校员 (reviewer)' : 'Reviewer'}</option>
                  <option value="researcher">{zh ? '调研员 (researcher)' : 'Researcher'}</option>
                </select>
              </label>
            </div>
            <div className="dsh-bots-modal-footer" style={{ justifyContent: 'flex-end' }}>
              <button type="button" className="dsh-bots-btn" onClick={() => setAdoptModalOpen(false)} disabled={adopting}>
                {zh ? '取消' : 'Cancel'}
              </button>
              <button
                type="button"
                className="dsh-bots-btn"
                data-variant="primary"
                disabled={!adoptSessionId.trim() || adopting}
                onClick={() => void handleAdoptSubmit()}
              >
                {adopting ? (zh ? '收编中…' : 'Adopting…') : (zh ? '确认收编' : 'Adopt crew')}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
