// Combined Group Work Items workbench for the Right Panel when a multi-bot group is selected.
// Aggregates items across all group member bots via `bots.groups.items`, with scope switch
// ("本群相关" / "全部工作"), per-member avatar capsules with open counts, "仅看需你处理" filter,
// quick status/snooze actions, and drill-in reuse of `BotItemDetailView` with owner banner.

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  botItemSnoozePickerPresets,
  botItemSnoozePresetName,
  formatBotItemNumber,
  isBotItemSnoozed,
  isBotItemStale,
  isOpenBotItemStatus,
} from '../../shared/bot-items.js';
import {
  botsStore,
  formatRelativeTime,
  useBotsLocale,
  useBotsState,
  useNow,
} from '../store/bots-store';
import {
  BotRpcError,
  RPC_METHODS,
  callBotRpc,
  type BotGroupRecord,
  type BotRecord,
} from '../store/rpc';
import { BotAvatar } from './BotAvatar';
import { BotChevron, BotDisclosure } from './BotDisclosure';
import { BotItemDetailView, type WorkItemFull } from './BotItemDetailView';
import {
  IconCheck,
  IconChevronLeft,
  IconClock,
  IconExternalLink,
  IconRefresh,
  IconX,
} from './Icons';

export type GroupItemsScope = 'group' | 'all';

export interface GroupWorkItem extends WorkItemFull {
  botId: string;
  ownerBotId?: string;
  groupId?: string | null;
  chatId?: string | null;
  threadId?: string | null;
  othersLastEventId?: number;
}

export interface GroupItemsCounts {
  total: number;
  open: number;
  needsYou: number;
  byBot: Record<string, { open: number; needsYou: number; total: number }>;
}

export interface BotGroupItemsPanelProps {
  group: BotGroupRecord;
  memberBots: BotRecord[];
  threadId?: string | null;
  onSelectedItemChange?: (selected: { botId: string; uid: string } | null) => void;
}

const RPC_GROUPS_ITEMS = RPC_METHODS.GROUPS_ITEMS;

const STATUS_GROUPS: Array<WorkItemFull['status']> = [
  'needs_you',
  'working',
  'planned',
  'done',
  'canceled',
];

function normalizeGroupItems(rawItems: unknown, fallbackBotId?: string): GroupWorkItem[] {
  if (!Array.isArray(rawItems)) {
    return [];
  }
  const out: GroupWorkItem[] = [];
  for (const entry of rawItems) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const row = entry as Record<string, unknown>;
    const uid = String(row.uid ?? row.id ?? '').trim();
    const botId = String(row.botId ?? row.ownerBotId ?? fallbackBotId ?? '').trim();
    if (!uid || !botId) {
      continue;
    }
    out.push({
      ...(row as unknown as WorkItemFull),
      uid,
      botId,
      ownerBotId: botId,
      groupId: typeof row.groupId === 'string' ? row.groupId : null,
      chatId: typeof row.chatId === 'string' ? row.chatId : null,
      threadId: typeof row.threadId === 'string' ? row.threadId : null,
      othersLastEventId: typeof row.othersLastEventId === 'number' ? row.othersLastEventId : undefined,
    });
  }
  return out;
}

function deriveCounts(items: GroupWorkItem[], rawCounts: unknown, now: number): GroupItemsCounts {
  const byBot: Record<string, { open: number; needsYou: number; total: number }> = {};
  let total = 0;
  let open = 0;
  let needsYou = 0;

  for (const item of items) {
    const bucket = byBot[item.botId] ?? { open: 0, needsYou: 0, total: 0 };
    bucket.total += 1;
    total += 1;
    if (isOpenBotItemStatus(item.status)) {
      bucket.open += 1;
      open += 1;
      if (item.status === 'needs_you' && !isBotItemSnoozed(item, now)) {
        bucket.needsYou += 1;
        needsYou += 1;
      }
    }
    byBot[item.botId] = bucket;
  }

  if (!rawCounts || typeof rawCounts !== 'object') {
    return { total, open, needsYou, byBot };
  }

  const obj = rawCounts as Record<string, unknown>;
  const rawByBot = (obj.byBot && typeof obj.byBot === 'object'
    ? (obj.byBot as Record<string, unknown>)
    : null);

  if (rawByBot) {
    for (const [botId, val] of Object.entries(rawByBot)) {
      if (typeof val === 'number') {
        const cur = byBot[botId] ?? { open: 0, needsYou: 0, total: 0 };
        byBot[botId] = { ...cur, open: val };
      } else if (val && typeof val === 'object') {
        const rec = val as Record<string, unknown>;
        const cur = byBot[botId] ?? { open: 0, needsYou: 0, total: 0 };
        byBot[botId] = {
          open: typeof rec.open === 'number' ? rec.open : cur.open,
          needsYou: typeof rec.needsYou === 'number' ? rec.needsYou : cur.needsYou,
          total: typeof rec.total === 'number' ? rec.total : cur.total,
        };
      }
    }
  }

  return {
    total: typeof obj.total === 'number' ? obj.total : total,
    open: typeof obj.open === 'number' ? obj.open : open,
    needsYou: typeof obj.needsYou === 'number' ? obj.needsYou : needsYou,
    byBot,
  };
}

function collectGroupSessionIds(group: BotGroupRecord): Set<string> {
  const ids = new Set<string>();
  const raw = group as BotGroupRecord & {
    memberSessionIds?: Record<string, string>;
    formerSessionIds?: string[] | Record<string, string[]>;
  };
  for (const m of group.members ?? []) {
    if (m.sessionId) ids.add(m.sessionId);
  }
  if (raw.memberSessionIds && typeof raw.memberSessionIds === 'object') {
    for (const sid of Object.values(raw.memberSessionIds)) {
      if (typeof sid === 'string' && sid) ids.add(sid);
    }
  }
  if (Array.isArray(raw.formerSessionIds)) {
    for (const sid of raw.formerSessionIds) {
      if (typeof sid === 'string' && sid) ids.add(sid);
    }
  } else if (raw.formerSessionIds && typeof raw.formerSessionIds === 'object') {
    for (const list of Object.values(raw.formerSessionIds)) {
      if (Array.isArray(list)) {
        for (const sid of list) {
          if (typeof sid === 'string' && sid) ids.add(sid);
        }
      }
    }
  }
  for (const th of group.threads ?? []) {
    for (const m of th.members ?? []) {
      if (m.sessionId) ids.add(m.sessionId);
    }
    for (const sid of th.formerSessionIds ?? []) {
      if (sid) ids.add(sid);
    }
  }
  return ids;
}

export function BotGroupItemsPanel({
  group,
  memberBots,
  threadId,
  onSelectedItemChange,
}: BotGroupItemsPanelProps) {
  const { locale, tr } = useBotsLocale();
  const zh = locale === 'zh-CN';
  const now = useNow(60_000);
  const changeSeq = useBotsState((state) => state.changeSeq);

  const [scope, setScope] = useState<GroupItemsScope>('group');
  const [selectedBotId, setSelectedBotId] = useState<string | null>(null);
  const [onlyNeedsYou, setOnlyNeedsYou] = useState(false);
  const [items, setItems] = useState<GroupWorkItem[]>([]);
  const [rawCounts, setRawCounts] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<{ botId: string; uid: string } | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({
    done: true,
    canceled: true,
  });
  const [snoozeTargetUid, setSnoozeTargetUid] = useState<string | null>(null);
  const [customSnoozeVal, setCustomSnoozeVal] = useState('');

  const memberMap = useMemo(() => new Map(memberBots.map((b) => [b.id, b])), [memberBots]);
  const memberIdsKey = useMemo(() => memberBots.map((b) => b.id).join(','), [memberBots]);

  // Reset per-group selection when switching groups
  useEffect(() => {
    setSelectedItem(null);
    setSelectedBotId(null);
    setScope('group');
    setOnlyNeedsYou(false);
    setSnoozeTargetUid(null);
  }, [group.id]);

  // Clear member filter if that member leaves the group
  useEffect(() => {
    if (selectedBotId && !memberMap.has(selectedBotId)) {
      setSelectedBotId(null);
    }
  }, [memberMap, selectedBotId]);

  useEffect(() => {
    onSelectedItemChange?.(selectedItem);
  }, [onSelectedItemChange, selectedItem]);

  const loadItems = useCallback(async (showSkeleton = false) => {
    if (showSkeleton) {
      setLoading(true);
    }
    setError(null);
    try {
      const res = await callBotRpc<{ items?: unknown[]; counts?: unknown }>(RPC_GROUPS_ITEMS, {
        groupId: group.id,
        scope,
        ...(selectedBotId ? { botId: selectedBotId } : {}),
        ...(onlyNeedsYou ? { onlyNeedsYou: true } : {}),
        ...(threadId ? { threadId } : {}),
      });
      setItems(normalizeGroupItems(res?.items ?? []));
      setRawCounts(res?.counts ?? null);
    } catch (err) {
      // Graceful fallback if backend `bots.groups.items` is not yet registered during partial dev
      if (err instanceof BotRpcError && err.code === 'unknown_method') {
        const targetBots = selectedBotId
          ? memberBots.filter((b) => b.id === selectedBotId)
          : memberBots;
        const settled = await Promise.allSettled(
          targetBots.map((bot) =>
            callBotRpc<{ items?: unknown[] }>(RPC_METHODS.ITEMS_OWNER_LIST, {
              botId: bot.id,
              includeClosed: true,
              limit: 100,
            }).then((r) => normalizeGroupItems(r?.items ?? r, bot.id)),
          ),
        );
        const combined: GroupWorkItem[] = [];
        for (const result of settled) {
          if (result.status === 'fulfilled') {
            combined.push(...result.value);
          }
        }
        const groupSessionIds = collectGroupSessionIds(group);
        const scoped = scope === 'group'
          ? combined.filter((item) => (
            item.groupId === group.id
            || (item.chatId && groupSessionIds.has(item.chatId))
          ))
          : combined;
        const finalRows = onlyNeedsYou
          ? scoped.filter((item) => item.status === 'needs_you')
          : scoped;
        finalRows.sort((a, b) => (b.lastActivityAt ?? b.updatedAt ?? 0) - (a.lastActivityAt ?? a.updatedAt ?? 0));
        setItems(finalRows);
        setRawCounts(null);
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setLoading(false);
    }
  }, [group, memberBots, memberIdsKey, onlyNeedsYou, scope, selectedBotId, threadId]);

  useEffect(() => {
    void loadItems(true);
  }, [group.id, scope, selectedBotId, onlyNeedsYou, threadId]);

  useEffect(() => {
    if (changeSeq > 0) {
      void loadItems(false);
    }
  }, [changeSeq, loadItems]);

  const counts = useMemo(() => deriveCounts(items, rawCounts, now), [items, rawCounts, now]);

  const visibleItems = useMemo(() => {
    return items.filter((item) => {
      if (selectedBotId && item.botId !== selectedBotId) {
        return false;
      }
      if (onlyNeedsYou && item.status !== 'needs_you') {
        return false;
      }
      return true;
    });
  }, [items, onlyNeedsYou, selectedBotId]);

  const orderedUids = useMemo(() => visibleItems.map((i) => i.uid), [visibleItems]);

  const updateItemStatus = async (item: GroupWorkItem, status: WorkItemFull['status']) => {
    try {
      await callBotRpc(RPC_METHODS.ITEMS_OWNER_STATUS, {
        botId: item.botId,
        uid: item.uid,
        uids: [item.uid],
        status,
      });
      void loadItems(false);
    } catch (err) {
      botsStore.pushToast({ message: err instanceof Error ? err.message : String(err), tone: 'error' });
    }
  };

  const snoozeItem = async (item: GroupWorkItem, until: number | null) => {
    setSnoozeTargetUid(null);
    setCustomSnoozeVal('');
    try {
      await callBotRpc(RPC_METHODS.ITEMS_OWNER_SNOOZE, {
        botId: item.botId,
        items: [{
          uid: item.uid,
          ...(item.othersLastEventId !== undefined ? { othersLastEventId: item.othersLastEventId } : {}),
        }],
        until,
      });
      void loadItems(false);
    } catch (err) {
      botsStore.pushToast({ message: err instanceof Error ? err.message : String(err), tone: 'error' });
    }
  };

  // Drill-in Detail View with owner avatar & name bar
  if (selectedItem) {
    const ownerBot = memberMap.get(selectedItem.botId)
      ?? botsStore.getState().bots.find((b) => b.id === selectedItem.botId)
      ?? null;

    return (
      <div className="dsh-bots-group-detail-shell" data-dsh-bots-group-item-detail={selectedItem.uid}>
        <div className="dsh-bots-group-detail-owner">
          <div className="dsh-bots-group-detail-owner-meta">
            <button
              type="button"
              className="dsh-bots-pbtn dsh-bots-pbtn-xs dsh-bots-pbtn-ghost"
              style={{ padding: '0 6px 0 4px' }}
              onClick={() => setSelectedItem(null)}
            >
              <IconChevronLeft size={12} />
              <span>{zh ? '群工作项' : 'Group items'}</span>
            </button>
            <span style={{ opacity: 0.4 }}>/</span>
            <BotAvatar
              botId={selectedItem.botId}
              avatar={ownerBot?.avatar}
              avatarColor={ownerBot?.avatarColor}
              name={ownerBot?.name ?? selectedItem.botId}
              size={20}
              radius={6}
              paused={ownerBot?.paused}
              status={ownerBot?.dotState ?? undefined}
            />
            <span className="dsh-bots-group-detail-owner-name">
              {ownerBot?.name ?? selectedItem.botId}
            </span>
          </div>
          {ownerBot && (
            <button
              type="button"
              className="dsh-bots-pbtn dsh-bots-pbtn-xs dsh-bots-pbtn-ghost"
              title={zh ? `前往「${ownerBot.name}」主对话` : `Open ${ownerBot.name}`}
              onClick={() => void botsStore.openBotHome(ownerBot.id)}
            >
              <IconExternalLink size={11} />
              <span>{zh ? '主对话' : 'Home'}</span>
            </button>
          )}
        </div>

        <BotItemDetailView
          botId={selectedItem.botId}
          itemUid={selectedItem.uid}
          orderedUids={orderedUids}
          onSelectUid={(uid) => {
            const matched = visibleItems.find((entry) => entry.uid === uid)
              ?? items.find((entry) => entry.uid === uid);
            if (matched) {
              setSelectedItem({ botId: matched.botId, uid: matched.uid });
            }
          }}
          onBack={() => setSelectedItem(null)}
          onMutated={() => void loadItems(false)}
        />
      </div>
    );
  }

  const snoozePresets = botItemSnoozePickerPresets(now);

  return (
    <div className="dsh-bots-panel-scroll" data-dsh-bots-group-items={group.id}>
      {/* Scope switch + Only needs you toggle */}
      <div className="dsh-bots-group-scope-bar">
        <div className="dsh-bots-seg-group" role="group" aria-label={zh ? '工作范围' : 'Work scope'}>
          <button
            type="button"
            className="dsh-bots-seg-btn"
            aria-pressed={scope === 'group'}
            onClick={() => setScope('group')}
          >
            <span>{zh ? '本群相关' : 'This group'}</span>
          </button>
          <button
            type="button"
            className="dsh-bots-seg-btn"
            aria-pressed={scope === 'all'}
            onClick={() => setScope('all')}
          >
            <span>{zh ? '全部工作' : 'All their work'}</span>
          </button>
        </div>

        <button
          type="button"
          className="dsh-bots-chip"
          data-active={onlyNeedsYou ? 'true' : 'false'}
          aria-pressed={onlyNeedsYou}
          onClick={() => setOnlyNeedsYou((prev) => !prev)}
        >
          <span>{zh ? '仅看需你处理' : 'Only needs you'}</span>
          {counts.needsYou > 0 && (
            <span className="dsh-bots-badge dsh-bots-badge-warn" style={{ height: 15, minWidth: 15, padding: '0 4px' }}>
              {counts.needsYou}
            </span>
          )}
        </button>
      </div>

      {/* Member avatar capsules with unclosed count */}
      {memberBots.length > 0 && (
        <div className="dsh-bots-member-pills" role="group" aria-label={zh ? '按群成员筛选' : 'Filter by member'}>
          <button
            type="button"
            className="dsh-bots-member-pill dsh-bots-member-pill-all"
            data-active={selectedBotId === null ? 'true' : 'false'}
            aria-pressed={selectedBotId === null}
            onClick={() => setSelectedBotId(null)}
          >
            <span>{zh ? '全部成员' : 'All'}</span>
            <span className="dsh-bots-member-pill-count" data-warn={counts.needsYou > 0 ? 'true' : 'false'}>
              {counts.open}
            </span>
          </button>
          {memberBots.map((bot) => {
            const stat = counts.byBot[bot.id] ?? { open: 0, needsYou: 0, total: 0 };
            const active = selectedBotId === bot.id;
            return (
              <button
                key={bot.id}
                type="button"
                className="dsh-bots-member-pill"
                data-active={active ? 'true' : 'false'}
                aria-pressed={active}
                title={zh ? `筛选「${bot.name}」的工作项（${stat.open} 未闭环）` : `Filter ${bot.name} (${stat.open} open)`}
                onClick={() => setSelectedBotId((prev) => (prev === bot.id ? null : bot.id))}
              >
                <BotAvatar
                  botId={bot.id}
                  avatar={bot.avatar}
                  avatarColor={bot.avatarColor}
                  name={bot.name}
                  size={18}
                  radius={5}
                  paused={bot.paused}
                />
                <span className="dsh-bots-member-pill-name">{bot.name}</span>
                {stat.open > 0 && (
                  <span
                    className="dsh-bots-member-pill-count"
                    data-warn={stat.needsYou > 0 ? 'true' : 'false'}
                  >
                    {stat.open}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Error retry banner */}
      {error && (
        <div className="dsh-bots-error-box" role="alert">
          <span className="dsh-bots-ellipsis" title={error}>
            {zh ? `加载工作项失败：${error}` : `Failed to load items: ${error}`}
          </span>
          <button
            type="button"
            className="dsh-bots-pbtn dsh-bots-pbtn-xs"
            onClick={() => void loadItems(true)}
          >
            <IconRefresh size={11} />
            <span>{zh ? '重试' : 'Retry'}</span>
          </button>
        </div>
      )}

      {/* Loading skeleton */}
      {loading && items.length === 0 ? (
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
      ) : visibleItems.length === 0 ? (
        <div className="dsh-bots-empty">
          {onlyNeedsYou
            ? (zh ? '目前没有需要你处理的群聊工作项。' : 'No group items need you right now.')
            : scope === 'group'
              ? (zh ? '本群暂无关联工作项，可切换「全部工作」查看群成员的其它任务。' : 'No items for this group yet. Switch to "All their work" to view all member tasks.')
              : (zh ? '群成员当前暂无工作项。' : 'No items across group members yet.')}
        </div>
      ) : (
        <div className="dsh-bots-psection">
          {STATUS_GROUPS.map((status) => {
            const rows = visibleItems.filter((item) => item.status === status);
            if (rows.length === 0) {
              return null;
            }
            const collapsed = Boolean(collapsedGroups[status]);
            return (
              <div key={status} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <button
                  type="button"
                  className="dsh-bots-item-group-btn"
                  aria-expanded={!collapsed}
                  onClick={() => setCollapsedGroups((prev) => ({ ...prev, [status]: !prev[status] }))}
                >
                  <BotChevron open={!collapsed} size={12} />
                  <span>{tr(`bots.items.status.${status}`, status)}</span>
                  <span className={`dsh-bots-badge ${status === 'needs_you' ? 'dsh-bots-badge-warn' : ''}`}>
                    {rows.length}
                  </span>
                </button>

                <BotDisclosure open={!collapsed}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingBottom: 2 }}>
                    {rows.map((item) => {
                      const ownerBot = memberMap.get(item.botId);
                      const staleDays = (ownerBot as (BotRecord & { itemsStale?: number | 'never' }) | undefined)?.itemsStale ?? 5;
                      const stale = staleDays !== 'never' && isBotItemStale(item, staleDays, now);
                      const snoozed = isBotItemSnoozed(item, now);

                      return (
                        <div
                          key={`${item.botId}:${item.uid}`}
                          className="dsh-bots-item-row"
                          tabIndex={0}
                          role="button"
                          onClick={() => setSelectedItem({ botId: item.botId, uid: item.uid })}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              setSelectedItem({ botId: item.botId, uid: item.uid });
                            }
                          }}
                        >
                          <BotAvatar
                            botId={item.botId}
                            avatar={ownerBot?.avatar}
                            avatarColor={ownerBot?.avatarColor}
                            name={ownerBot?.name ?? item.botId}
                            size={20}
                            radius={6}
                            paused={ownerBot?.paused}
                          />

                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div className="dsh-bots-row">
                              <span className="dsh-bots-ellipsis" style={{ fontWeight: 500 }}>
                                {item.number !== undefined ? `${formatBotItemNumber(item.number)} ` : ''}
                                {item.title}
                              </span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 5, marginTop: 1 }}>
                              <span className="dsh-bots-group-item-owner">
                                {ownerBot?.name ?? item.botId}
                              </span>
                              {stale && (
                                <span className="dsh-bots-badge dsh-bots-badge-warn">
                                  {tr('bots.items.stale', 'Stale')}
                                </span>
                              )}
                              {snoozed && (
                                <span className="dsh-bots-badge dsh-bots-badge-accent">
                                  {tr('bots.items.snoozed', 'Snoozed')}
                                </span>
                              )}
                              <span className="dsh-bots-muted">
                                {formatRelativeTime(item.lastActivityAt ?? item.updatedAt, now, locale)}
                              </span>
                            </div>
                          </div>

                          <div className="dsh-bots-item-row-actions" onClick={(e) => e.stopPropagation()}>
                            <div className="dsh-bots-pmenu-wrap">
                              <button
                                type="button"
                                className="dsh-bots-pbtn dsh-bots-pbtn-xs dsh-bots-pbtn-icon"
                                title={zh ? '延后提醒' : 'Snooze'}
                                onClick={() => setSnoozeTargetUid((prev) => (prev === item.uid ? null : item.uid))}
                              >
                                <IconClock size={12} />
                              </button>
                              {snoozeTargetUid === item.uid && (
                                <div className="dsh-bots-pmenu" role="menu">
                                  {snoozePresets.map((preset) => (
                                    <button
                                      key={preset.id}
                                      type="button"
                                      className="dsh-bots-pmenu-item"
                                      onClick={() => void snoozeItem(item, preset.at)}
                                    >
                                      {botItemSnoozePresetName(preset, tr)}
                                    </button>
                                  ))}
                                  <div className="dsh-bots-pmenu-sep" />
                                  <div style={{ padding: '4px 6px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                                    <input
                                      type="datetime-local"
                                      className="dsh-bots-pinput"
                                      style={{ fontSize: 11, padding: '3px 5px' }}
                                      value={customSnoozeVal}
                                      onChange={(e) => setCustomSnoozeVal(e.target.value)}
                                    />
                                    <button
                                      type="button"
                                      className="dsh-bots-pbtn dsh-bots-pbtn-xs dsh-bots-pbtn-primary"
                                      disabled={!customSnoozeVal}
                                      onClick={() => {
                                        const ts = Date.parse(customSnoozeVal);
                                        if (Number.isFinite(ts) && ts > Date.now()) {
                                          void snoozeItem(item, ts);
                                        }
                                      }}
                                    >
                                      {zh ? '确认时间' : 'Apply'}
                                    </button>
                                  </div>
                                  {item.snoozedUntil && (
                                    <>
                                      <div className="dsh-bots-pmenu-sep" />
                                      <button
                                        type="button"
                                        className="dsh-bots-pmenu-item"
                                        onClick={() => void snoozeItem(item, null)}
                                      >
                                        {zh ? '取消延后' : 'Clear snooze'}
                                      </button>
                                    </>
                                  )}
                                </div>
                              )}
                            </div>

                            {item.status !== 'done' && (
                              <button
                                type="button"
                                className="dsh-bots-pbtn dsh-bots-pbtn-xs dsh-bots-pbtn-icon"
                                title={tr('bots.items.status.done', 'Done')}
                                onClick={() => void updateItemStatus(item, 'done')}
                              >
                                <IconCheck size={12} />
                              </button>
                            )}
                            {item.status !== 'canceled' && (
                              <button
                                type="button"
                                className="dsh-bots-pbtn dsh-bots-pbtn-xs dsh-bots-pbtn-icon"
                                title={tr('bots.items.status.canceled', 'Canceled')}
                                onClick={() => void updateItemStatus(item, 'canceled')}
                              >
                                <IconX size={12} />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </BotDisclosure>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
