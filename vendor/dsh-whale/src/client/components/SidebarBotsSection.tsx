// Orca-faithful Sidebar "Bots" section mounted in Harness `sidebar.sections.before`.
// Enhanced with keyboard search navigation (ArrowDown to first result, Enter to open first match),
// clickable collapsed +N overflow button with hidden attention/working/unread dot propagation and full tooltip.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { EMPTY_CARD_MASCOT_IDS, mascotAvatar } from '../../shared/bot-avatar.js';
import {
  BOT_SIDEBAR_SORT_CHOICES,
  SIDEBAR_BOTS_MIN_HEIGHT,
  botHasSubChats,
  botPreviewCapacity,
  botPreviewSignal,
  countActiveBotSidebarFilters,
  normalizeSidebarBotsHeight,
  searchBots,
  selectCollapsedPreviewBots,
  sortAndFilterBots,
} from '../../shared/bot-sidebar-logic.js';
import { botsStore, useBotsLocale, useBotsState, useNow } from '../store/bots-store';
import type { BotGroupRecord, BotRecord, BotSidebarSort, BotSidebarView } from '../store/rpc';
import { BotAvatar } from './BotAvatar';
import { BotChevron, BotDisclosure, useBotsPresence } from './BotDisclosure';
import { BotGroupSidebarCard } from './BotGroupSidebarCard';
import { BotSidebarCard, type BotCardSearchMatch } from './BotSidebarCard';
import {
  IconBot,
  IconCheck,
  IconChevronsUpDown,
  IconDownload,
  IconLink,
  IconPlus,
  IconSearch,
  IconSliders,
  IconSparkles,
  IconUsers,
  IconX,
} from './Icons';

export interface SidebarBotsSectionProps {
  wide?: boolean;
  expandSidebar?: () => void;
}

type SidebarEntry =
  | { kind: 'bot'; id: string; bot: BotRecord }
  | { kind: 'group'; id: string; group: BotGroupRecord };

function useAnchoredPopoverClose(open: boolean, ref: RefObject<HTMLDivElement | null>, onClose: () => void) {
  useEffect(() => {
    if (!open) return undefined;
    const handleDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const handleKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', handleDown);
    document.addEventListener('keydown', handleKey);
    return () => { document.removeEventListener('mousedown', handleDown); document.removeEventListener('keydown', handleKey); };
  }, [onClose, open, ref]);
}

function OptionsPopover({
  anchorRect,
  open,
  motionState,
  view,
  projectsFirst,
  onClose,
}: {
  anchorRect: DOMRect;
  open: boolean;
  motionState: 'open' | 'closed';
  view: BotSidebarView;
  projectsFirst: boolean;
  onClose: () => void;
}) {
  const { locale, tr } = useBotsLocale();
  const ref = useRef<HTMLDivElement | null>(null);
  useAnchoredPopoverClose(open, ref, onClose);
  if (typeof document === 'undefined') return null;

  const sortLabels: Record<BotSidebarSort, { title: string; desc?: string }> = {
    manual: { title: tr('bots.options.sortManual', 'Manual'), desc: tr('bots.options.sortManualDescription', 'Drag bots to arrange them. New bots go on top.') },
    smart: { title: tr('bots.options.sortSmart', 'Agent Activity'), desc: tr('bots.options.sortSmartDescription', 'Bots that need you, then most recent activity.') },
    recent: { title: tr('bots.options.sortRecent', 'Recent') },
    name: { title: tr('bots.options.sortName', 'Name') },
  };
  const left = Math.min(anchorRect.left, window.innerWidth - 252);
  const top = Math.min(anchorRect.bottom + 6, window.innerHeight - 340);

  return createPortal(
    <div
      ref={ref}
      className="dsh-bots-popover"
      data-motion="presence"
      data-state={motionState}
      aria-hidden={open ? undefined : true}
      style={{ left, top, width: 244 }}
    >
      <div className="dsh-bots-menu-section">{tr('bots.options.sortBy', 'Sort by')}</div>
      {BOT_SIDEBAR_SORT_CHOICES.map((choice) => {
        const id = choice.id as BotSidebarSort;
        const meta = sortLabels[id];
        return (
          <button
            key={id}
            type="button"
            className="dsh-bots-menu-item"
            style={{ alignItems: 'flex-start' }}
            onClick={() => void botsStore.updateGlobalSettings({ botSidebarView: { ...view, sortBy: id } })}
          >
            <span style={{ width: 14, marginTop: 2, flexShrink: 0 }}>{view.sortBy === id ? <IconCheck size={13} /> : null}</span>
            <span style={{ flex: '1 1 auto' }}>
              <span>{meta.title}</span>
              {meta.desc && <span className="dsh-bots-menu-item-desc">{meta.desc}</span>}
            </span>
          </button>
        );
      })}
      <div className="dsh-bots-menu-sep" />
      <div className="dsh-bots-menu-section">{tr('bots.options.filters', 'Filters')}</div>
      <button
        type="button"
        className="dsh-bots-menu-item"
        onClick={() => void botsStore.updateGlobalSettings({ botSidebarView: { ...view, hidePausedBots: !view.hidePausedBots } })}
      >
        <span style={{ width: 14 }}>{view.hidePausedBots ? <IconCheck size={13} /> : null}</span>
        <span>{tr('bots.options.hidePaused', 'Hide paused bots')}</span>
      </button>
      <button
        type="button"
        className="dsh-bots-menu-item"
        onClick={() => void botsStore.updateGlobalSettings({ botSidebarView: { ...view, hideSleepingWorkers: !view.hideSleepingWorkers } })}
      >
        <span style={{ width: 14 }}>{view.hideSleepingWorkers ? <IconCheck size={13} /> : null}</span>
        <span>{tr('bots.options.hideSleepingWorkers', 'Hide sleeping workers')}</span>
      </button>
      <div className="dsh-bots-menu-sep" />
      <button
        type="button"
        className="dsh-bots-menu-item"
        onClick={() => void botsStore.updateGlobalSettings({ sidebarProjectsFirst: !projectsFirst })}
      >
        <span style={{ width: 14 }}>{projectsFirst ? <IconCheck size={13} /> : null}</span>
        <span>{locale === 'zh-CN' ? '工作区置顶' : 'Show projects first'}</span>
      </button>
    </div>,
    document.body,
  );
}

function CreateMenuPopover({
  anchorRect,
  open,
  motionState,
  botCount,
  onClose,
}: {
  anchorRect: DOMRect;
  open: boolean;
  motionState: 'open' | 'closed';
  botCount: number;
  onClose: () => void;
}) {
  const { tr } = useBotsLocale();
  const ref = useRef<HTMLDivElement | null>(null);
  useAnchoredPopoverClose(open, ref, onClose);
  if (typeof document === 'undefined') return null;

  const left = Math.min(anchorRect.left, window.innerWidth - 224);
  const top = Math.min(anchorRect.bottom + 6, window.innerHeight - 230);
  const openAndClose = (modal: Parameters<typeof botsStore.openModal>[0]) => { onClose(); botsStore.openModal(modal); };

  return createPortal(
    <div
      ref={ref}
      className="dsh-bots-popover"
      data-motion="presence"
      data-state={motionState}
      aria-hidden={open ? undefined : true}
      style={{ left, top, width: 216 }}
    >
      <button type="button" className="dsh-bots-menu-item" onClick={() => openAndClose({ kind: 'new-bot' })}>
        <IconPlus size={14} /><span>{tr('bots.section.startFromScratch', 'Start from scratch')}</span>
      </button>
      <button type="button" className="dsh-bots-menu-item" onClick={() => openAndClose({ kind: 'templates' })}>
        <IconSparkles size={14} /><span>{tr('bots.section.browseTemplates', 'Browse templates')}</span>
      </button>
      <button type="button" className="dsh-bots-menu-item" onClick={() => openAndClose({ kind: 'share', mode: 'import' })}>
        <IconLink size={14} /><span>{tr('bots.section.importFromLink', 'Import from link…')}</span>
      </button>
      <button type="button" className="dsh-bots-menu-item" onClick={() => openAndClose({ kind: 'import', initialTab: 'apps' })}>
        <IconDownload size={14} /><span>{tr('bots.section.importFromApp', 'Import from another app…')}</span>
      </button>
      <div className="dsh-bots-menu-sep" />
      <button type="button" className="dsh-bots-menu-item" disabled={botCount < 2} onClick={() => openAndClose({ kind: 'group' })}>
        <IconUsers size={14} /><span>{tr('bots.section.newGroup', 'New group')}</span>
      </button>
    </div>,
    document.body,
  );
}

function CollapsedPreviewStrip({
  bots,
  needsYou,
  activeBotId,
}: {
  bots: BotRecord[];
  needsYou: Record<string, number>;
  activeBotId: string | null;
}) {
  const { locale } = useBotsLocale();
  const zh = locale === 'zh-CN';
  const stripRef = useRef<HTMLDivElement | null>(null);
  const [stripWidth, setStripWidth] = useState(120);

  useEffect(() => {
    const el = stripRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver((entries) => setStripWidth(entries[0]?.contentRect.width ?? 120));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const preview = useMemo(() => {
    const items = bots.map((bot) => ({
      bot,
      status: bot.dotState ?? bot.status ?? 'idle',
      attention: (needsYou[bot.id] ?? bot.needsYouCount ?? 0) > 0 || bot.dotState === 'permission',
      unread: Boolean(bot.unread),
      paused: Boolean(bot.paused),
    }));
    const current = items.find((item) => item.bot.id === activeBotId) ?? null;
    const selectPreview = selectCollapsedPreviewBots as (
      list: typeof items,
      cap: number,
      cur: (typeof items)[number] | null,
    ) => { shown: typeof items; hidden: typeof items };
    return selectPreview(items, botPreviewCapacity(stripWidth, items.length), current);
  }, [activeBotId, bots, needsYou, stripWidth]);

  // Propagate highest-priority alert dot from hidden overflow bots and build full roster tooltip.
  const hiddenOverflow = useMemo(() => {
    if (preview.hidden.length === 0) {
      return { signal: null as 'attention' | 'working' | 'unread' | null, tooltip: '' };
    }
    let signal: 'attention' | 'working' | 'unread' | null = null;
    const lines = preview.hidden.map((item) => {
      const itemSig = botPreviewSignal(item) as 'attention' | 'working' | 'unread' | null;
      if (itemSig === 'attention') {
        signal = 'attention';
      } else if (itemSig === 'working' && signal !== 'attention') {
        signal = 'working';
      } else if (itemSig === 'unread' && !signal) {
        signal = 'unread';
      }
      const tag = itemSig === 'attention'
        ? (zh ? '（待处理）' : ' (needs you)')
        : itemSig === 'working'
          ? (zh ? '（运行中）' : ' (working)')
          : itemSig === 'unread'
            ? (zh ? '（未读）' : ' (unread)')
            : item.paused
              ? (zh ? '（已暂停）' : ' (paused)')
              : '';
      return `${item.bot.name}${tag}`;
    });
    const header = zh
      ? `点击展开其余 ${preview.hidden.length} 位队友：`
      : `Click to expand ${preview.hidden.length} more bots:`;
    return {
      signal,
      tooltip: `${header}\n${lines.join('\n')}`,
    };
  }, [preview.hidden, zh]);

  return (
    <div ref={stripRef} className="dsh-bots-preview-strip">
      {preview.shown.map((item) => (
        <button
          key={item.bot.id}
          type="button"
          className="dsh-bots-preview-item"
          data-paused={item.paused ? 'true' : 'false'}
          title={item.bot.name}
          onClick={(e) => { e.stopPropagation(); botsStore.setSectionCollapsed(false); void botsStore.openBotHome(item.bot.id); }}
        >
          <BotAvatar
            botId={item.bot.id}
            avatar={item.bot.avatar}
            avatarColor={item.bot.avatarColor}
            name={item.bot.name}
            size={20}
            radius={5}
            status={botPreviewSignal(item) as 'attention' | 'unread' | 'working' | null}
          />
        </button>
      ))}
      {preview.hidden.length > 0 && (
        <button
          type="button"
          className="dsh-bots-preview-more dsh-bots-preview-more-btn"
          data-signal={hiddenOverflow.signal ?? undefined}
          title={hiddenOverflow.tooltip}
          aria-label={hiddenOverflow.tooltip}
          onClick={(e) => {
            e.stopPropagation();
            botsStore.setSectionCollapsed(false);
          }}
        >
          <span>+{preview.hidden.length}</span>
          {hiddenOverflow.signal && (
            <span
              className="dsh-bots-preview-more-dot"
              data-signal={hiddenOverflow.signal}
              aria-hidden="true"
            />
          )}
        </button>
      )}
    </div>
  );
}

function EmptyBotsCard() {
  const { tr } = useBotsLocale();
  return (
    <div className="dsh-bots-empty-card">
      <div className="dsh-bots-empty-stack">
        {EMPTY_CARD_MASCOT_IDS.map((mascotId) => (
          <span key={mascotId} className="dsh-bots-empty-stack-item">
            <BotAvatar avatar={mascotAvatar(mascotId)} size={28} radius={8} />
          </span>
        ))}
      </div>
      <div className="dsh-bots-empty-title">
        {tr('bots.section.emptyCardTitle', '你的大肥鱼队友')}
      </div>
      <div className="dsh-bots-empty-subtitle">
        {tr('bots.section.emptyCardSubtitle', '常驻协作、自主巡视与多鱼联动')}
      </div>
      <div className="dsh-bots-empty-actions">
        <button
          type="button"
          className="dsh-bots-btn"
          data-variant="primary"
          data-size="sm"
          onClick={() => botsStore.openModal({ kind: 'new-bot' })}
        >
          <IconPlus size={13} />
          <span>{tr('bots.section.newBot', '新建队友')}</span>
        </button>
        <button
          type="button"
          className="dsh-bots-btn"
          data-size="sm"
          onClick={() => botsStore.openModal({ kind: 'templates' })}
        >
          <span>{tr('bots.section.templates', '模板库')}</span>
        </button>
      </div>
    </div>
  );
}

export function SidebarBotsSection({ wide = true, expandSidebar }: SidebarBotsSectionProps) {
  const { tr } = useBotsLocale();
  const now = useNow(60_000);
  const state = useBotsState((s) => s);
  const { botsEnabled, bots, groups, needsYou, botSidebarView: view, sectionCollapsed, collapsedBotIds, activeBotId, sidebarBotsHeight: storedHeight, sidebarProjectsFirst: projectsFirst } = state;

  const listRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const lastOptionsAnchorRef = useRef<DOMRect | null>(null);
  const lastCreateAnchorRef = useRef<DOMRect | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchPresent, setSearchPresent] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [optionsAnchor, setOptionsAnchor] = useState<DOMRect | null>(null);
  const [createAnchor, setCreateAnchor] = useState<DOMRect | null>(null);
  const [sectionBodyPresent, setSectionBodyPresent] = useState(!sectionCollapsed);
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  const [draggingBotId, setDraggingBotId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ botId: string; position: 'before' | 'after' } | null>(null);

  if (optionsAnchor) lastOptionsAnchorRef.current = optionsAnchor;
  if (createAnchor) lastCreateAnchorRef.current = createAnchor;

  const previewPresence = useBotsPresence(sectionCollapsed && bots.length > 0, 180);
  const optionsPresence = useBotsPresence(Boolean(optionsAnchor), 180);
  const createPresence = useBotsPresence(Boolean(createAnchor), 180);

  useEffect(() => { botsStore.start(); }, []);
  useEffect(() => { if (searchOpen && searchPresent) searchInputRef.current?.focus(); }, [searchOpen, searchPresent]);

  const botsById = useMemo(() => new Map(bots.map((bot) => [bot.id, bot])), [bots]);
  const collapsedSet = useMemo(() => new Set(collapsedBotIds), [collapsedBotIds]);
  const allCollapsed = bots.length > 0 && bots.every((bot) => collapsedSet.has(bot.id));
  const hasExpandableBots = useMemo(
    () => collapsedSet.size > 0 || bots.some((bot) => botHasSubChats(state.chatsByBot[bot.id], view.hideSleepingWorkers)),
    [bots, collapsedSet.size, state.chatsByBot, view.hideSleepingWorkers],
  );
  const activeFilterCount = countActiveBotSidebarFilters(view);
  const totalNeedsYou = useMemo(() => bots.reduce((sum, b) => sum + (needsYou[b.id] ?? b.needsYouCount ?? 0), 0), [bots, needsYou]);

  const allEntries = useMemo<SidebarEntry[]>(() => [
    ...groups.map((group): SidebarEntry => ({ kind: 'group', id: group.id, group })),
    ...bots.map((bot): SidebarEntry => ({ kind: 'bot', id: bot.id, bot })),
  ], [bots, groups]);

  const arrangedEntries = useMemo<SidebarEntry[]>(() => {
    const arrange = sortAndFilterBots as (
      entries: SidebarEntry[],
      sidebarView: BotSidebarView,
      activityOf: (entry: SidebarEntry) => { needsYou: boolean; activityAt: number },
    ) => SidebarEntry[];
    return arrange(allEntries, view, (entry) => {
      if (entry.kind === 'group') {
        return { needsYou: Boolean(entry.group.unread), activityAt: entry.group.lastActiveAt ?? entry.group.createdAt ?? 0 };
      }
      const need = (needsYou[entry.bot.id] ?? entry.bot.needsYouCount ?? 0) > 0 || entry.bot.dotState === 'permission';
      return { needsYou: need, activityAt: entry.bot.lastActiveAt ?? entry.bot.updatedAt ?? entry.bot.createdAt ?? 0 };
    });
  }, [allEntries, needsYou, view]);

  const searchResult = useMemo(() => {
    const trimmed = searchQuery.trim();
    if (!searchOpen || !trimmed) return null;
    return searchBots(arrangedEntries, trimmed, {
      all: allEntries,
      purposeOf: (entry: SidebarEntry) => (entry.kind === 'bot' ? (entry.bot.purpose ?? entry.bot.description ?? null) : null),
    }) as {
      matches: Array<{ entry: SidebarEntry; matchedBy: 'name' | 'purpose'; nameSegments: { text: string; marked: boolean }[]; purpose?: { segments: { text: string; marked: boolean }[] } | null }>;
      hiddenPausedMatches: number;
    };
  }, [allEntries, arrangedEntries, searchOpen, searchQuery]);

  const handleResizePointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = listRef.current?.getBoundingClientRect().height ?? storedHeight ?? 240;
    let latestHeight = startHeight;
    const onMove = (moveEvent: globalThis.PointerEvent) => {
      latestHeight = Math.max(SIDEBAR_BOTS_MIN_HEIGHT, Math.round(startHeight + (moveEvent.clientY - startY)));
      setDragHeight(latestHeight);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setDragHeight(null);
      const normalized = normalizeSidebarBotsHeight(latestHeight);
      if (normalized !== null) void botsStore.updateGlobalSettings({ sidebarBotsHeight: normalized });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [storedHeight]);

  const handleResizeKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    const current = listRef.current?.getBoundingClientRect().height ?? storedHeight ?? 240;
    const next = normalizeSidebarBotsHeight(Math.max(SIDEBAR_BOTS_MIN_HEIGHT, current + (event.key === 'ArrowDown' ? 8 : -8)));
    if (next !== null) void botsStore.updateGlobalSettings({ sidebarBotsHeight: next });
  };

  const handleDragOverBot = (targetId: string, event: DragEvent<HTMLDivElement>) => {
    if (!draggingBotId || draggingBotId === targetId) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    setDropTarget({ botId: targetId, position: event.clientY - rect.top < rect.height / 2 ? 'before' : 'after' });
  };

  const handleDropBot = (targetId: string, event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (draggingBotId && draggingBotId !== targetId) {
      const ids = bots.map((b) => b.id).filter((id) => id !== draggingBotId);
      const idx = ids.indexOf(targetId);
      if (idx >= 0) {
        ids.splice(dropTarget?.position === 'after' ? idx + 1 : idx, 0, draggingBotId);
        void botsStore.reorderBots(ids);
      }
    }
    setDraggingBotId(null);
    setDropTarget(null);
  };

  if (!botsEnabled) return null;
  if (!wide) {
    return (
      <button type="button" className="dsh-bots-rail-btn" title={tr('bots.section.title', 'Bots')} onClick={() => expandSidebar?.()}>
        <IconBot size={18} />
        {totalNeedsYou > 0 && <span className="dsh-bots-rail-badge">{totalNeedsYou > 9 ? '9+' : totalNeedsYou}</span>}
      </button>
    );
  }

  const effectiveMaxHeight = dragHeight ?? storedHeight;
  const visibleRows = searchResult
    ? searchResult.matches.map((m) => ({ entry: m.entry, match: { matchedBy: m.matchedBy, nameSegments: m.nameSegments, purpose: m.purpose } as BotCardSearchMatch }))
    : arrangedEntries.map((entry) => ({ entry, match: null as BotCardSearchMatch | null }));
  const allHiddenPaused = !searchResult && bots.length > 0 && visibleRows.length === 0 && view.hidePausedBots;
  const showPaused = () => void botsStore.updateGlobalSettings({ botSidebarView: { ...view, hidePausedBots: false } });

  const hasResizeHandle = sectionBodyPresent && (bots.length > 0 || groups.length > 0);
  const showExpandAll = !sectionCollapsed && hasExpandableBots;
  const activeOptionsAnchor = optionsAnchor ?? lastOptionsAnchorRef.current;
  const activeCreateAnchor = createAnchor ?? lastCreateAnchorRef.current;

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) {
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      setSearchQuery('');
      setSearchOpen(false);
      return;
    }
    if (event.key === 'ArrowDown') {
      if (visibleRows.length > 0 && listRef.current) {
        event.preventDefault();
        const firstFocusable = listRef.current.querySelector<HTMLElement>(
          '.dsh-bots-card[tabindex], .dsh-bots-card button, [role="button"], button',
        );
        firstFocusable?.focus();
      }
      return;
    }
    if (event.key === 'Enter' && visibleRows.length > 0) {
      event.preventDefault();
      const first = visibleRows[0].entry;
      if (first.kind === 'group') {
        botsStore.openGroup(first.group.id);
      } else {
        void botsStore.openBotHome(first.bot.id);
      }
    }
  };

  return (
    <section
      className="dsh-bots-section"
      data-has-resize={hasResizeHandle ? 'true' : 'false'}
      aria-label={tr('bots.section.title', '大肥鱼队友')}
    >
      <div className="dsh-bots-header">
        <button
          type="button"
          className="dsh-bots-header-toggle"
          onClick={() => botsStore.setSectionCollapsed(!sectionCollapsed)}
          aria-expanded={!sectionCollapsed}
          title={sectionCollapsed ? tr('bots.section.expand', 'Expand bots') : tr('bots.section.collapse', 'Collapse bots')}
        >
          <BotChevron open={!sectionCollapsed} size={14} />
          <span>{tr('bots.section.title', '大肥鱼队友')}</span>
        </button>

        <div className="dsh-bots-header-spacer">
          {previewPresence.present ? (
            <div
              className="dsh-bots-preview-wrap"
              data-state={previewPresence.state}
              aria-hidden={!sectionCollapsed ? true : undefined}
            >
              <CollapsedPreviewStrip bots={bots} needsYou={needsYou} activeBotId={activeBotId} />
            </div>
          ) : null}
        </div>

        <div className="dsh-bots-header-actions">
          <div
            className="dsh-bots-header-action-slot"
            data-open={showExpandAll ? 'true' : 'false'}
            aria-hidden={showExpandAll ? undefined : true}
          >
            <div className="dsh-bots-header-action-slot-inner">
              <button
                type="button"
                className="dsh-bots-icon-btn"
                tabIndex={showExpandAll ? 0 : -1}
                title={allCollapsed ? tr('bots.section.expandAll', 'Expand all bots') : tr('bots.section.collapseAll', 'Collapse all bots')}
                onClick={() => botsStore.setAllBotsCollapsed(!allCollapsed)}
              >
                <IconChevronsUpDown size={15} />
              </button>
            </div>
          </div>
          <button
            type="button"
            className="dsh-bots-icon-btn"
            data-active={searchOpen ? 'true' : 'false'}
            title={tr('bots.search.open', 'Search bots')}
            onClick={() => {
              if (searchOpen) { setSearchOpen(false); setSearchQuery(''); }
              else { botsStore.setSectionCollapsed(false); setSearchOpen(true); }
            }}
          >
            <IconSearch size={15} />
          </button>
          <button
            type="button"
            className="dsh-bots-icon-btn"
            data-active={optionsAnchor ? 'true' : 'false'}
            title={activeFilterCount > 0 ? tr('bots.options.activeFilters', 'Bot options ({{count}} filters active)', { count: activeFilterCount }) : tr('bots.options.title', 'Bot options')}
            onClick={(e) => { const rect = e.currentTarget.getBoundingClientRect(); setCreateAnchor(null); setOptionsAnchor((prev) => (prev ? null : rect)); }}
          >
            <IconSliders size={15} />
            {activeFilterCount > 0 && <span className="dsh-bots-filter-badge" />}
          </button>
          <button
            type="button"
            className="dsh-bots-icon-btn"
            data-active={createAnchor ? 'true' : 'false'}
            title={tr('bots.section.new', 'New bot or group')}
            onClick={(e) => { const rect = e.currentTarget.getBoundingClientRect(); setOptionsAnchor(null); setCreateAnchor((prev) => (prev ? null : rect)); }}
          >
            <IconPlus size={16} />
          </button>
        </div>
      </div>

      <BotDisclosure
        open={!sectionCollapsed}
        className="dsh-bots-section-disclosure"
        onPresenceChange={setSectionBodyPresent}
      >
        <BotDisclosure
          open={searchOpen}
          className="dsh-bots-search-disclosure"
          onPresenceChange={setSearchPresent}
        >
          <div className="dsh-bots-search-box">
            <IconSearch size={14} />
            <input
              ref={searchInputRef}
              type="text"
              className="dsh-bots-search-input"
              value={searchQuery}
              placeholder={tr('bots.search.label', 'Search bots')}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={handleSearchKeyDown}
            />
            {searchQuery && (
              <button type="button" className="dsh-bots-icon-btn dsh-bots-icon-btn-sm" aria-label={tr('bots.search.clear', 'Clear search')} onClick={() => { setSearchQuery(''); searchInputRef.current?.focus(); }}>
                <IconX size={13} />
              </button>
            )}
          </div>
        </BotDisclosure>

        {bots.length === 0 && groups.length === 0 ? (
          <EmptyBotsCard />
        ) : (
          <>
            {searchResult && searchResult.hiddenPausedMatches > 0 && (
              <div className="dsh-bots-search-banner">
                <span>{tr('bots.search.pausedMatches', '{{count}} paused matches', { count: searchResult.hiddenPausedMatches })}</span>
                <button type="button" className="dsh-bots-link-btn" onClick={showPaused}>{tr('bots.search.show', 'Show')}</button>
              </div>
            )}

            {allHiddenPaused ? (
              <div className="dsh-bots-search-banner">
                <span>{tr('bots.options.allHidden', 'All bots are paused and hidden.')}</span>
                <button type="button" className="dsh-bots-link-btn" onClick={showPaused}>{tr('bots.search.show', 'Show')}</button>
              </div>
            ) : searchResult && visibleRows.length === 0 ? (
              <div className="dsh-bots-search-empty">
                {tr('bots.search.noMatches', 'No matches')}
              </div>
            ) : (
              <div
                ref={listRef}
                className="dsh-bots-list"
                data-sidebar-nested-scroller=""
                style={{ maxHeight: effectiveMaxHeight ? `${effectiveMaxHeight}px` : '40vh' }}
              >
                {visibleRows.map(({ entry, match }) =>
                  entry.kind === 'group' ? (
                    <BotGroupSidebarCard key={`group:${entry.group.id}`} group={entry.group} botsById={botsById} now={now} nameSegments={match?.nameSegments ?? null} />
                  ) : (
                    <BotSidebarCard
                      key={`bot:${entry.bot.id}`}
                      bot={entry.bot}
                      now={now}
                      collapsed={collapsedSet.has(entry.bot.id)}
                      hideSleepingWorkers={view.hideSleepingWorkers}
                      manualSort={view.sortBy === 'manual' && !searchResult}
                      searchMatch={match}
                      dragging={draggingBotId === entry.bot.id}
                      dropPosition={dropTarget?.botId === entry.bot.id ? dropTarget.position : null}
                      onDragStart={setDraggingBotId}
                      onDragOverCard={handleDragOverBot}
                      onDropCard={handleDropBot}
                      onDragEnd={() => { setDraggingBotId(null); setDropTarget(null); }}
                    />
                  ),
                )}
              </div>
            )}

            <div
              role="separator"
              aria-orientation="horizontal"
              aria-label="Resize bots section"
              tabIndex={0}
              className="dsh-bots-resize-handle"
              data-dragging={dragHeight !== null ? 'true' : 'false'}
              onPointerDown={handleResizePointerDown}
              onKeyDown={handleResizeKeyDown}
            />
          </>
        )}
      </BotDisclosure>

      {optionsPresence.present && activeOptionsAnchor && (
        <OptionsPopover
          anchorRect={activeOptionsAnchor}
          open={Boolean(optionsAnchor)}
          motionState={optionsPresence.state}
          view={view}
          projectsFirst={projectsFirst}
          onClose={() => setOptionsAnchor(null)}
        />
      )}
      {createPresence.present && activeCreateAnchor && (
        <CreateMenuPopover
          anchorRect={activeCreateAnchor}
          open={Boolean(createAnchor)}
          motionState={createPresence.state}
          botCount={bots.length}
          onClose={() => setCreateAnchor(null)}
        />
      )}
    </section>
  );
}
