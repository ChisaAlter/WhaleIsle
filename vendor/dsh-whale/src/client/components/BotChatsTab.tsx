// Right-panel Chats tab: split Chats/Workers search, '+ New chat', 'Adopt ordinary session as crew…' modal,
// adopted crew list with release action, full active & closed conversation tree with hover '⋯' &
// context menu (Open / Delete side chat), live 1s Worker elapsed timing + hover Stop + detail tooltip,
// skeleton loading, error retry & Show fewer.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { addressedBotWords } from '../../shared/bot-quiet-result.js';
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
import { useAnchoredPopoverDismiss } from './useAnchoredPopoverDismiss';
import {
  IconExternalLink,
  IconHome,
  IconMessageSquare,
  IconMoreHorizontal,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconSpinner,
  IconStopSquare,
  IconTrash,
  IconUsers,
  IconWrench,
  IconX,
  IconZap,
} from './Icons';

export interface BotChatsTabProps {
  bot: BotRecord;
}

interface ExtendedWorkerRow extends BotWorkerRow {
  dispatchId?: string;
  taskId?: string;
  createdAt?: number;
  closedAt?: number;
  cwd?: string;
  workspacePath?: string;
  branch?: string;
  summary?: string;
  resultSummary?: string;
  chatTitle?: string;
  parentChatTitle?: string;
  parentSessionId?: string;
}

interface ChatContextMenuState {
  chat: BotChatRow;
  isHome: boolean;
  isRunning: boolean;
  x: number;
  y: number;
  triggerEl: HTMLElement | null;
  contextTriggerEl: HTMLElement | null;
}

interface WorkerTooltipState {
  worker: ExtendedWorkerRow;
  rect: DOMRect;
}

const INITIAL_CHATS_SHOWN = 8;
const INITIAL_WORKERS_CAP = CHAT_TREE_CAPS.runningShown + CHAT_TREE_CAPS.finishedShown;
const RPC_CHAT_DELETE = RPC_METHODS.CHAT_DELETE;
const RPC_WORK_STOP = RPC_METHODS.WORK_STOP;

function chatOriginIcon(origin: string) {
  if (origin === 'home') {
    return <IconHome size={13} />;
  }
  if (origin === 'automation') {
    return <IconZap size={13} />;
  }
  if (origin === 'work') {
    return <IconWrench size={13} />;
  }
  return <IconMessageSquare size={13} />;
}

function isWorkerRunning(state: BotWorkerRow['state']): boolean {
  return state === 'running' || state === 'working';
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

function formatWorkerDuration(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  if (totalSec < 60) {
    return `${totalSec}s`;
  }
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  if (mins < 60) {
    return `${mins}m ${String(secs).padStart(2, '0')}s`;
  }
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hours}h ${String(remMins).padStart(2, '0')}m`;
}

function resolveWorkerKey(worker: ExtendedWorkerRow, fallback: string): string {
  return String(worker.id ?? worker.dispatchId ?? worker.sessionId ?? fallback);
}

function resolveWorkerWorkId(worker: ExtendedWorkerRow): string | null {
  const id = worker.id ?? worker.dispatchId ?? worker.sessionId ?? null;
  return id ? String(id) : null;
}

function highlightMatch(text: string, needle: string): ReactNode {
  const q = needle.trim();
  if (!q || !text) {
    return text;
  }
  const lower = text.toLowerCase();
  const qLower = q.toLowerCase();
  const idx = lower.indexOf(qLower);
  if (idx < 0) {
    return text;
  }
  return (
    <>
      {text.slice(0, idx)}
      <mark className="dsh-bots-mark">{text.slice(idx, idx + q.length)}</mark>
      {text.slice(idx + q.length)}
    </>
  );
}

function useLiveSecondTick(active: boolean): number {
  const [tick, setTick] = useState<number>(() => Date.now());
  useEffect(() => {
    if (!active) {
      return undefined;
    }
    setTick(Date.now());
    const id = window.setInterval(() => setTick(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [active]);
  return tick;
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
  const [remoteWorkers, setRemoteWorkers] = useState<ExtendedWorkerRow[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [loadingTree, setLoadingTree] = useState(!cachedTree);
  const [loadError, setLoadError] = useState<string | null>(null);
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

  const [menuState, setMenuState] = useState<ChatContextMenuState | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<BotChatRow | null>(null);
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);
  const [stoppingWorkIds, setStoppingWorkIds] = useState<Record<string, boolean>>({});
  const [tooltip, setTooltip] = useState<WorkerTooltipState | null>(null);

  const menuRef = useRef<HTMLDivElement | null>(null);
  const hoverTimerRef = useRef<number | null>(null);

  const loadCrew = useCallback(async () => {
    const rows = await botsStore.listCrew(bot.id);
    setCrewList(rows);
  }, [bot.id]);

  const loadChatTree = useCallback(async (showSkeleton = false) => {
    if (showSkeleton) {
      setLoadingTree(true);
    }
    setLoadError(null);
    try {
      const tree = await callBotRpc<{ chats?: BotChatRow[] }>(RPC_METHODS.CHAT_TREE, { botId: bot.id });
      if (!tree || !Array.isArray(tree.chats)) {
        throw new Error(zh ? '返回的聊天列表格式无效' : 'Invalid chat tree payload');
      }
      await botsStore.refreshBotChatTree(bot.id);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingTree(false);
    }
  }, [bot.id, zh]);

  useEffect(() => {
    setVisibleLimit(INITIAL_CHATS_SHOWN);
    setConfirmDelete(null);
    setMenuState(null);
    setTooltip(null);
    void loadChatTree(!cachedTree);
  }, [bot.id]);

  useEffect(() => {
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
    if (changeSeq > 0) {
      void botsStore.refreshBotChatTree(bot.id);
    }
  }, [bot.id, changeSeq]);

  // Dismiss context menu on outside pointerdown / Escape / scroll (excluding its trigger button)
  useAnchoredPopoverDismiss({
    open: Boolean(menuState),
    popoverRef: menuRef,
    triggerEl: menuState?.triggerEl ?? null,
    contextTriggerEl: menuState?.contextTriggerEl ?? null,
    onClose: () => setMenuState(null),
    closeOnScroll: true,
  });

  useEffect(() => {
    return () => {
      if (hoverTimerRef.current !== null) {
        window.clearTimeout(hoverTimerRef.current);
      }
    };
  }, []);

  // Debounced search RPC (supports both flat array and { chats, workers } split payloads)
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setRemoteChats(null);
      setRemoteWorkers(null);
      setSearching(false);
      return undefined;
    }
    let cancelled = false;
    setSearching(true);
    const timer = window.setTimeout(() => {
      void callBotRpc<{ chats?: BotChatRow[]; workers?: ExtendedWorkerRow[] } | BotChatRow[]>(
        RPC_METHODS.CHATS_SEARCH,
        { botId: bot.id, query: trimmed },
      )
        .then((res) => {
          if (cancelled) return;
          if (Array.isArray(res)) {
            setRemoteChats(res);
            setRemoteWorkers(null);
          } else {
            setRemoteChats(Array.isArray(res?.chats) ? res.chats : []);
            setRemoteWorkers(Array.isArray(res?.workers) ? res.workers : null);
          }
        })
        .catch((err) => {
          console.warn('[dsh-bots] chats search fallback to local filter', err);
          if (!cancelled) {
            setRemoteChats(null);
            setRemoteWorkers(null);
          }
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [bot.id, query]);

  const trimmedQuery = query.trim();
  const isSearching = trimmedQuery.length > 0;
  const allLocalChats = useMemo(
    () => orderBotChats(cachedTree?.chats ?? []) as BotChatRow[],
    [cachedTree?.chats],
  );

  // Split search results: matched Chats vs matched Workers
  const matchedChats = useMemo<BotChatRow[]>(() => {
    if (!isSearching) {
      return allLocalChats;
    }
    const q = trimmedQuery.toLowerCase();
    if (remoteChats !== null) {
      return orderBotChats(remoteChats) as BotChatRow[];
    }
    return allLocalChats.filter((chat) => {
      const title = (chat.title || (chat.origin === 'home' ? 'Home Chat' : '')).toLowerCase();
      const lastMsg = chat.lastMessageText ? (addressedBotWords(chat.lastMessageText) ?? '') : '';
      const preview = (lastMsg || chat.statusText || '').toLowerCase();
      return title.includes(q) || preview.includes(q);
    });
  }, [allLocalChats, isSearching, remoteChats, trimmedQuery]);

  const matchedWorkers = useMemo<ExtendedWorkerRow[]>(() => {
    if (!isSearching) {
      return [];
    }
    const q = trimmedQuery.toLowerCase();
    const seen = new Set<string>();
    const out: ExtendedWorkerRow[] = [];

    const pushWorker = (w: ExtendedWorkerRow, parentChat?: BotChatRow) => {
      const enriched: ExtendedWorkerRow = {
        ...w,
        parentChatTitle: w.parentChatTitle ?? w.chatTitle ?? parentChat?.title ?? (parentChat?.origin === 'home' ? tr('bots.chats.home', '主对话') : undefined),
        parentSessionId: w.parentSessionId ?? parentChat?.sessionId,
      };
      const key = resolveWorkerKey(enriched, `${parentChat?.chatId ?? 'w'}-${out.length}`);
      if (seen.has(key)) return;
      seen.add(key);
      out.push(enriched);
    };

    if (remoteWorkers) {
      for (const w of remoteWorkers) {
        pushWorker(w);
      }
    }

    const pool = [...allLocalChats, ...(remoteChats ?? [])];
    for (const chat of pool) {
      const workers = [...(chat.running ?? []), ...(chat.finished ?? [])] as ExtendedWorkerRow[];
      for (const w of workers) {
        const hay = `${w.title ?? ''} ${w.label ?? ''} ${w.statusText ?? ''} ${w.summary ?? ''} ${w.cwd ?? ''} ${w.workspaceId ?? ''} ${w.branch ?? ''} ${chat.title ?? ''}`.toLowerCase();
        if (hay.includes(q)) {
          pushWorker(w, chat);
        }
      }
    }
    return out;
  }, [allLocalChats, isSearching, remoteChats, remoteWorkers, tr, trimmedQuery]);

  // Check if any visible worker is running to drive 1-second live timer
  const hasRunningWorkers = useMemo(() => {
    if (matchedWorkers.some((w) => isWorkerRunning(w.state))) {
      return true;
    }
    return allLocalChats.some((chat) => (chat.running ?? []).some((w) => isWorkerRunning(w.state)));
  }, [allLocalChats, matchedWorkers]);

  const liveNow = useLiveSecondTick(hasRunningWorkers);

  const shownChats = isSearching ? matchedChats : matchedChats.slice(0, visibleLimit);
  const remaining = isSearching ? 0 : Math.max(0, matchedChats.length - shownChats.length);
  const canShowFewer = !isSearching && visibleLimit > INITIAL_CHATS_SHOWN && matchedChats.length > INITIAL_CHATS_SHOWN;

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

  const openChat = (chat: BotChatRow, isHome: boolean) => {
    if (isHome) {
      void botsStore.openBotHome(bot.id);
    } else {
      botsStore.openBotChat(bot.id, chat.sessionId);
    }
  };

  const executeDeleteChat = async (chat: BotChatRow, stopRunningWorkers = false) => {
    setDeletingSessionId(chat.sessionId);
    setMenuState(null);
    setConfirmDelete(null);
    try {
      if (stopRunningWorkers && (chat.running?.length ?? 0) > 0) {
        await Promise.allSettled(
          (chat.running ?? []).map((w) => {
            const wid = resolveWorkerWorkId(w as ExtendedWorkerRow);
            return wid ? callBotRpc(RPC_WORK_STOP, { botId: bot.id, workId: wid }) : Promise.resolve();
          }),
        );
      }
      await callBotRpc(RPC_CHAT_DELETE, { botId: bot.id, sessionId: chat.sessionId });
      setRemoteChats((prev) => (prev ? prev.filter((c) => c.sessionId !== chat.sessionId) : prev));
      await botsStore.refreshBotChatTree(bot.id);
      botsStore.pushToast({
        message: zh ? '已删除对话' : 'Chat deleted',
        tone: 'info',
      }, 3000);
    } catch (err) {
      botsStore.pushToast({ message: err instanceof Error ? err.message : String(err), tone: 'error' });
    } finally {
      setDeletingSessionId(null);
    }
  };

  const handleRequestDeleteChat = (chat: BotChatRow, isHome: boolean, isRunning: boolean) => {
    setMenuState(null);
    if (isHome) {
      return;
    }
    if (isRunning) {
      setConfirmDelete(chat);
      return;
    }
    void executeDeleteChat(chat, false);
  };

  const handleStopWorker = async (worker: ExtendedWorkerRow, event: ReactMouseEvent) => {
    event.stopPropagation();
    const workId = resolveWorkerWorkId(worker);
    if (!workId || stoppingWorkIds[workId]) {
      return;
    }
    setStoppingWorkIds((prev) => ({ ...prev, [workId]: true }));
    try {
      await callBotRpc(RPC_WORK_STOP, { botId: bot.id, workId });
      botsStore.pushToast({
        message: zh ? `已请求停止任务「${worker.title || worker.label || workId}」` : 'Stop requested for worker',
        tone: 'info',
      }, 3000);
      await botsStore.refreshBotChatTree(bot.id);
    } catch (err) {
      botsStore.pushToast({ message: err instanceof Error ? err.message : String(err), tone: 'error' });
    } finally {
      setStoppingWorkIds((prev) => {
        const next = { ...prev };
        delete next[workId];
        return next;
      });
    }
  };

  const openChatMenuAt = (
    chat: BotChatRow,
    isHome: boolean,
    isRunning: boolean,
    x: number,
    y: number,
    triggerEl: HTMLElement | null = null,
    contextTriggerEl: HTMLElement | null = null,
  ) => {
    setTooltip(null);
    setMenuState({ chat, isHome, isRunning, x, y, triggerEl, contextTriggerEl });
  };

  const showWorkerTooltip = (worker: ExtendedWorkerRow, el: HTMLElement) => {
    if (hoverTimerRef.current !== null) {
      window.clearTimeout(hoverTimerRef.current);
    }
    const rect = el.getBoundingClientRect();
    hoverTimerRef.current = window.setTimeout(() => {
      setTooltip({ worker, rect });
    }, 240);
  };

  const hideWorkerTooltip = () => {
    if (hoverTimerRef.current !== null) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    setTooltip(null);
  };

  const renderWorkerRow = (worker: ExtendedWorkerRow, key: string, parentChatTitle?: string) => {
    const enriched: ExtendedWorkerRow = {
      ...worker,
      parentChatTitle: worker.parentChatTitle ?? worker.chatTitle ?? parentChatTitle,
    };
    const running = isWorkerRunning(enriched.state);
    const workId = resolveWorkerWorkId(enriched);
    const stopping = Boolean(workId && stoppingWorkIds[workId]);
    const startTs = enriched.startedAt ?? enriched.createdAt;
    const elapsedMs = running && typeof startTs === 'number' && startTs > 0
      ? Math.max(0, liveNow - startTs)
      : (typeof startTs === 'number' && typeof (enriched.settledAt ?? enriched.closedAt) === 'number'
        ? Math.max(0, (enriched.settledAt ?? enriched.closedAt ?? startTs) - startTs)
        : null);
    const titleText = enriched.title || enriched.label || (zh ? '后台任务' : 'Worker');

    return (
      <div
        key={key}
        className="dsh-bots-worker-monitor-row"
        data-stoppable={running && Boolean(workId) ? 'true' : 'false'}
        tabIndex={0}
        role="button"
        onMouseEnter={(e) => showWorkerTooltip(enriched, e.currentTarget)}
        onMouseLeave={hideWorkerTooltip}
        onClick={() => {
          hideWorkerTooltip();
          if (enriched.sessionId) {
            botsStore.openBotChat(bot.id, enriched.sessionId);
          } else if (enriched.parentSessionId) {
            botsStore.openBotChat(bot.id, enriched.parentSessionId);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (enriched.sessionId) {
              botsStore.openBotChat(bot.id, enriched.sessionId);
            }
          }
        }}
      >
        <span className="dsh-bots-worker-dot" data-state={enriched.state} />
        <span className="dsh-bots-ellipsis" style={{ flex: 1, fontSize: 12 }}>
          {isSearching ? highlightMatch(titleText, trimmedQuery) : titleText}
        </span>

        <div className="dsh-bots-worker-right-slot">
          <div className="dsh-bots-worker-status-group">
            {elapsedMs !== null && (
              <span className="dsh-bots-worker-elapsed">{formatWorkerDuration(elapsedMs)}</span>
            )}
            <span className={workerBadgeClass(enriched.state)}>
              {workerStateLabel(enriched.state, zh)}
            </span>
          </div>

          {running && workId && (
            <button
              type="button"
              className="dsh-bots-worker-stop-btn"
              disabled={stopping}
              aria-label={zh ? `停止任务 ${titleText}` : `Stop ${titleText}`}
              onClick={(e) => void handleStopWorker(enriched, e)}
            >
              {stopping ? <IconSpinner size={10} /> : <IconStopSquare size={9} />}
              <span>{stopping ? (zh ? '停止中' : 'Stopping') : (zh ? '停止' : 'Stop')}</span>
            </button>
          )}
        </div>
      </div>
    );
  };

  const renderChatRow = (chat: BotChatRow) => {
    const isHome = chat.origin === 'home' && !chat.closed;
    const active = chat.sessionId === activeSessionId || chat.chatId === activeSessionId;
    const workers = [...(chat.running ?? []), ...(chat.finished ?? [])] as ExtendedWorkerRow[];
    const expanded = Boolean(expandedIds[chat.chatId]);
    const cap = workerCaps[chat.chatId] ?? INITIAL_WORKERS_CAP;
    const shownWorkers = workers.slice(0, cap);
    const moreWorkers = Math.max(0, workers.length - shownWorkers.length);
    const canCollapseWorkers = cap > INITIAL_WORKERS_CAP && workers.length > INITIAL_WORKERS_CAP;
    const title = isHome
      ? tr('bots.chats.home', '主对话')
      : (chat.title || tr('bots.chats.kindSide', '支线对话'));
    const isRunning = chat.live === 'replying' || chat.live === 'needs-you' || (chat.running?.length ?? 0) > 0;
    const menuOpenForRow = menuState?.chat.chatId === chat.chatId;
    const isDeleting = deletingSessionId === chat.sessionId;

    return (
      <div key={chat.chatId} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <div
          className="dsh-bots-tree-row dsh-bots-chat-row"
          data-active={active ? 'true' : 'false'}
          data-menu-open={menuOpenForRow ? 'true' : 'false'}
          style={isDeleting ? { opacity: 0.5, pointerEvents: 'none' } : undefined}
          onClick={() => openChat(chat, isHome)}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            openChatMenuAt(chat, isHome, isRunning, e.clientX, e.clientY, null, e.currentTarget);
          }}
        >
          {workers.length > 0 && !isSearching ? (
            <button
              type="button"
              className="dsh-bots-pbtn dsh-bots-pbtn-xs dsh-bots-pbtn-icon"
              style={{ width: 18, height: 18 }}
              aria-label={expanded ? (zh ? '收起后台任务' : 'Collapse workers') : (zh ? '展开后台任务' : 'Expand workers')}
              aria-expanded={expanded}
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
                {isSearching ? highlightMatch(title, trimmedQuery) : title}
              </span>

              <div className="dsh-bots-chat-meta-slot">
                <span className="dsh-bots-chat-time">
                  {formatRelativeTime(chat.lastActiveAt ?? chat.updatedAt, now, locale)}
                </span>
                <button
                  type="button"
                  className="dsh-bots-chat-more-btn"
                  aria-label={zh ? '更多对话操作' : 'Chat actions'}
                  aria-haspopup="menu"
                  aria-expanded={menuOpenForRow}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (menuState?.chat.chatId === chat.chatId) {
                      setMenuState(null);
                      return;
                    }
                    const rect = e.currentTarget.getBoundingClientRect();
                    openChatMenuAt(chat, isHome, isRunning, rect.right, rect.bottom + 4, e.currentTarget);
                  }}
                >
                  <IconMoreHorizontal size={13} />
                </button>
              </div>
            </div>

            <div className="dsh-bots-row">
              <span className="dsh-bots-muted dsh-bots-ellipsis">
                {(() => {
                  const lastMsg = chat.lastMessageText ? (addressedBotWords(chat.lastMessageText) ?? '') : '';
                  const sub = chat.statusText || lastMsg || (chat.closed ? (zh ? '已归档历史' : 'Closed') : '');
                  return isSearching ? highlightMatch(sub, trimmedQuery) : sub;
                })()}
              </span>
              <div style={{ display: 'inline-flex', gap: 4, flexShrink: 0 }}>
                {chat.closed && <span className="dsh-bots-badge">{zh ? '已归档' : 'Closed'}</span>}
                {chat.live === 'needs-you' && (
                  <span className="dsh-bots-badge dsh-bots-badge-warn">{zh ? '待处理' : 'Needs you'}</span>
                )}
                {chat.live === 'replying' && (
                  <span className="dsh-bots-badge dsh-bots-badge-accent">{zh ? '回复中' : 'Replying'}</span>
                )}
                {workers.length > 0 && (
                  <span className="dsh-bots-badge">{workers.length}</span>
                )}
              </div>
            </div>
          </div>
        </div>

        {!isSearching && workers.length > 0 && (
          <BotDisclosure open={expanded}>
            <div className="dsh-bots-pworker-list">
              {shownWorkers.map((worker, idx) =>
                renderWorkerRow(worker, resolveWorkerKey(worker, `${chat.chatId}-w-${idx}`), title),
              )}
              {(moreWorkers > 0 || canCollapseWorkers) && (
                <div style={{ display: 'inline-flex', gap: 6, paddingTop: 2 }}>
                  {moreWorkers > 0 && (
                    <button
                      type="button"
                      className="dsh-bots-pbtn dsh-bots-pbtn-xs dsh-bots-pbtn-ghost"
                      onClick={() => setWorkerCaps((prev) => ({
                        ...prev,
                        [chat.chatId]: cap + CHAT_TREE_CAPS.step,
                      }))}
                    >
                      {tr('bots.chats.showMoreWorkers', '显示更多 {{count}} 个任务', {
                        count: Math.min(CHAT_TREE_CAPS.step, moreWorkers),
                      })}
                    </button>
                  )}
                  {canCollapseWorkers && (
                    <button
                      type="button"
                      className="dsh-bots-pbtn dsh-bots-pbtn-xs dsh-bots-pbtn-ghost"
                      onClick={() => setWorkerCaps((prev) => ({
                        ...prev,
                        [chat.chatId]: INITIAL_WORKERS_CAP,
                      }))}
                    >
                      {zh ? '收起' : 'Show fewer'}
                    </button>
                  )}
                </div>
              )}
            </div>
          </BotDisclosure>
        )}
      </div>
    );
  };

  return (
    <div className="dsh-bots-panel-scroll" data-dsh-bots-chats-tab={bot.id}>
      {/* Search + New chat toolbar */}
      <div className="dsh-bots-row">
        <div style={{ position: 'relative', flex: 1 }}>
          <IconSearch
            size={13}
            style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', opacity: 0.55 }}
          />
          <input
            type="text"
            className="dsh-bots-pinput"
            style={{ paddingLeft: 26, paddingRight: query ? 24 : 10, height: 28 }}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && query) {
                e.preventDefault();
                setQuery('');
              }
            }}
            placeholder={tr('bots.chats.searchPlaceholder', '搜索对话和后台任务')}
          />
          {query && (
            <button
              type="button"
              aria-label={tr('bots.search.clear', '清除搜索')}
              style={{
                position: 'absolute',
                right: 4,
                top: '50%',
                transform: 'translateY(-50%)',
                width: 20,
                height: 20,
                padding: 0,
                border: 'none',
                background: 'transparent',
                color: 'var(--dsw-alias-label-tertiary)',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              onClick={() => setQuery('')}
            >
              <IconX size={12} />
            </button>
          )}
        </div>
        <button
          type="button"
          className="dsh-bots-pbtn"
          disabled={starting}
          onClick={() => void handleNewChat()}
        >
          <IconPlus size={12} />
          <span>{tr('bots.chats.newChat', '新建对话')}</span>
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

      {/* Inline confirmation when deleting a running chat */}
      {confirmDelete && (
        <div className="dsh-bots-inline-confirm" role="alertdialog" aria-label={zh ? '确认删除运行中的对话' : 'Confirm delete running chat'}>
          <div>
            {zh
              ? `「${confirmDelete.title || '支线对话'}」仍有运行中的任务或回复，确认先停止再删除？`
              : `"${confirmDelete.title || 'Side chat'}" is still running. Stop it and delete?`}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
            <button
              type="button"
              className="dsh-bots-pbtn dsh-bots-pbtn-xs"
              onClick={() => setConfirmDelete(null)}
            >
              {zh ? '取消' : 'Cancel'}
            </button>
            <button
              type="button"
              className="dsh-bots-pbtn dsh-bots-pbtn-xs dsh-bots-pbtn-danger"
              disabled={deletingSessionId === confirmDelete.sessionId}
              onClick={() => void executeDeleteChat(confirmDelete, true)}
            >
              <IconTrash size={11} />
              <span>{zh ? '停止并删除' : 'Stop & delete'}</span>
            </button>
          </div>
        </div>
      )}

      {/* Error retry state */}
      {loadError && (
        <div className="dsh-bots-error-box" role="alert">
          <span className="dsh-bots-ellipsis" title={loadError}>
            {zh ? `加载对话列表失败：${loadError}` : `Failed to load chats: ${loadError}`}
          </span>
          <button
            type="button"
            className="dsh-bots-pbtn dsh-bots-pbtn-xs"
            onClick={() => void loadChatTree(true)}
          >
            <IconRefresh size={11} />
            <span>{zh ? '重试' : 'Retry'}</span>
          </button>
        </div>
      )}

      {/* Loading skeleton */}
      {loadingTree && allLocalChats.length === 0 ? (
        <div className="dsh-bots-skeleton-list" aria-busy="true">
          {[0, 1, 2, 3].map((idx) => (
            <div key={idx} className="dsh-bots-skeleton-row">
              <div className="dsh-bots-skeleton-avatar" />
              <div className="dsh-bots-skeleton-col">
                <div className="dsh-bots-skeleton-bar dsh-bots-skeleton-bar-lg" />
                <div className="dsh-bots-skeleton-bar dsh-bots-skeleton-bar-sm" />
              </div>
            </div>
          ))}
        </div>
      ) : isSearching ? (
        /* Split search results: Chats + Workers */
        searching && matchedChats.length === 0 && matchedWorkers.length === 0 ? (
          <div className="dsh-bots-skeleton-list" aria-busy="true">
            {[0, 1].map((idx) => (
              <div key={idx} className="dsh-bots-skeleton-row">
                <div className="dsh-bots-skeleton-col">
                  <div className="dsh-bots-skeleton-bar dsh-bots-skeleton-bar-lg" />
                  <div className="dsh-bots-skeleton-bar dsh-bots-skeleton-bar-sm" />
                </div>
              </div>
            ))}
          </div>
        ) : matchedChats.length === 0 && matchedWorkers.length === 0 ? (
          <div className="dsh-bots-empty">
            {tr('bots.search.noMatches', '未找到匹配结果')}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="dsh-bots-psection">
              <div className="dsh-bots-search-section-head">
                <span>{zh ? '对话 (Chats)' : 'Chats'}</span>
                <span className="dsh-bots-badge">{matchedChats.length}</span>
              </div>
              {matchedChats.length === 0 ? (
                <div className="dsh-bots-muted" style={{ padding: '2px 4px' }}>
                  {zh ? '无匹配对话' : 'No matching chats'}
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {matchedChats.map(renderChatRow)}
                </div>
              )}
            </div>

            <div className="dsh-bots-psection">
              <div className="dsh-bots-search-section-head">
                <span>{zh ? '后台任务 (Workers)' : 'Workers'}</span>
                <span className="dsh-bots-badge">{matchedWorkers.length}</span>
              </div>
              {matchedWorkers.length === 0 ? (
                <div className="dsh-bots-muted" style={{ padding: '2px 4px' }}>
                  {zh ? '无匹配后台任务' : 'No matching workers'}
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {matchedWorkers.map((worker, idx) =>
                    renderWorkerRow(worker, resolveWorkerKey(worker, `search-w-${idx}`)),
                  )}
                </div>
              )}
            </div>
          </div>
        )
      ) : shownChats.length === 0 ? (
        <div className="dsh-bots-empty">
          {zh ? '暂无聊天记录。点击右上角「新建对话」开始。' : 'No chats yet.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {shownChats.map(renderChatRow)}

          {(remaining > 0 || canShowFewer) && (
            <div className="dsh-bots-chats-pager">
              {remaining > 0 && (
                <button
                  type="button"
                  className="dsh-bots-pbtn dsh-bots-pbtn-xs"
                  onClick={() => setVisibleLimit((prev) => prev + INITIAL_CHATS_SHOWN)}
                >
                  {zh
                    ? `再显示 ${Math.min(INITIAL_CHATS_SHOWN, remaining)} 条 · 另有 ${remaining} 条`
                    : `Show ${Math.min(INITIAL_CHATS_SHOWN, remaining)} more · ${remaining} earlier`}
                </button>
              )}
              {canShowFewer && (
                <button
                  type="button"
                  className="dsh-bots-pbtn dsh-bots-pbtn-xs dsh-bots-pbtn-ghost"
                  onClick={() => setVisibleLimit(INITIAL_CHATS_SHOWN)}
                >
                  {zh ? '收起更多' : 'Show fewer'}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Portal context / action menu for chat row */}
      {menuState && typeof document !== 'undefined' && createPortal(
        <div
          ref={menuRef}
          className="dsh-bots-popover"
          role="menu"
          data-dsh-bots-popover="chats-row-menu"
          style={{
            left: Math.max(8, Math.min(menuState.x - 168, window.innerWidth - 208)),
            top: Math.max(8, Math.min(menuState.y, window.innerHeight - 116)),
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            role="menuitem"
            className="dsh-bots-menu-item"
            onClick={() => {
              const target = menuState;
              setMenuState(null);
              openChat(target.chat, target.isHome);
            }}
          >
            <IconExternalLink size={13} />
            <span>{zh ? '打开' : 'Open'}</span>
          </button>
          <div className="dsh-bots-menu-sep" />
          <button
            type="button"
            role="menuitem"
            className="dsh-bots-menu-item"
            data-danger="true"
            disabled={menuState.isHome}
            title={menuState.isHome
              ? (zh ? '当前活跃主对话不可删除' : 'Active Home Chat cannot be deleted')
              : (zh ? '删除该对话记录' : 'Delete this chat')}
            onClick={() => handleRequestDeleteChat(menuState.chat, menuState.isHome, menuState.isRunning)}
          >
            <IconTrash size={13} />
            <span style={{ flex: 1 }}>
              <span>{zh ? '删除对话' : 'Delete chat'}</span>
              {menuState.isHome && (
                <span className="dsh-bots-menu-item-desc">
                  {zh ? '当前活跃主对话不可删除' : 'Active Home Chat protected'}
                </span>
              )}
            </span>
          </button>
        </div>,
        document.body,
      )}

      {/* Portal Worker detail tooltip */}
      {tooltip && typeof document !== 'undefined' && createPortal(
        (() => {
          const w = tooltip.worker;
          const workDir = w.cwd || w.workspacePath || w.workspaceId || '';
          const summary = w.summary || w.resultSummary || w.statusText || '';
          const running = isWorkerRunning(w.state);
          const startTs = w.startedAt ?? w.createdAt;
          const duration = typeof startTs === 'number' && startTs > 0
            ? formatWorkerDuration(Math.max(0, (running ? liveNow : (w.settledAt ?? w.closedAt ?? liveNow)) - startTs))
            : null;
          const left = Math.max(8, Math.min(tooltip.rect.left - 284, window.innerWidth - 284));
          const resolvedLeft = tooltip.rect.left > 296 ? left : Math.min(tooltip.rect.left, window.innerWidth - 284);
          const top = Math.max(8, Math.min(tooltip.rect.top, window.innerHeight - 180));

          return (
            <div
              className="dsh-bots-worker-tooltip"
              role="tooltip"
              style={{ left: resolvedLeft, top }}
            >
              <div className="dsh-bots-row">
                <span className="dsh-bots-ellipsis" style={{ fontWeight: 600 }}>
                  {w.title || w.label || (zh ? '后台任务' : 'Worker')}
                </span>
                <span className={workerBadgeClass(w.state)}>
                  {workerStateLabel(w.state, zh)}
                </span>
              </div>
              <div className="dsh-bots-worker-tooltip-grid">
                {duration && (
                  <div className="dsh-bots-worker-tooltip-kv">
                    <span className="dsh-bots-worker-tooltip-k">{zh ? '耗时' : 'Elapsed'}</span>
                    <span className="dsh-bots-worker-tooltip-v">{duration}</span>
                  </div>
                )}
                {workDir && (
                  <div className="dsh-bots-worker-tooltip-kv">
                    <span className="dsh-bots-worker-tooltip-k">{zh ? '工作目录' : 'Directory'}</span>
                    <span className="dsh-bots-worker-tooltip-v" style={{ fontFamily: 'var(--ds-font-family-code)', fontSize: 11 }}>
                      {workDir}
                    </span>
                  </div>
                )}
                {w.branch && (
                  <div className="dsh-bots-worker-tooltip-kv">
                    <span className="dsh-bots-worker-tooltip-k">{zh ? '分支' : 'Branch'}</span>
                    <span className="dsh-bots-worker-tooltip-v">{w.branch}</span>
                  </div>
                )}
                {w.parentChatTitle && (
                  <div className="dsh-bots-worker-tooltip-kv">
                    <span className="dsh-bots-worker-tooltip-k">{zh ? '关联对话' : 'Chat'}</span>
                    <span className="dsh-bots-worker-tooltip-v">{w.parentChatTitle}</span>
                  </div>
                )}
                {summary && (
                  <div className="dsh-bots-worker-tooltip-kv">
                    <span className="dsh-bots-worker-tooltip-k">{zh ? '摘要' : 'Summary'}</span>
                    <span className="dsh-bots-worker-tooltip-v">{summary}</span>
                  </div>
                )}
              </div>
            </div>
          );
        })(),
        document.body,
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
