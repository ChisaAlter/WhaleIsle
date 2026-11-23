// Right-panel Home / Activity tab: Filter strip -> All Clear banner -> Needs You (Stepper Ask + Access Requests) ->
// Work Items (5 collapsible status groups, sticky floating bulk pill with 5 statuses + batch Snooze,
// quick Done/Cancel/Snooze, stale cleanup, drill-in detail view) -> BotActivityUpcoming (Upcoming + Up Next).

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BOT_ITEM_STATUSES,
  botItemQuestionShape,
  botItemSnoozePickerPresets,
  botItemSnoozePresetName,
  formatBotItemNumber,
  isBotItemSnoozed,
  isBotItemStale,
} from '../../shared/bot-items.js';
import {
  botsStore,
  formatRelativeTime,
  useBotsLocale,
  useBotsState,
  useNow,
} from '../store/bots-store';
import { RPC_METHODS, callBotRpc, type BotRecord } from '../store/rpc';
import {
  BotActivityUpcoming,
  type AutomationRow,
  type SuggestionRow,
} from './BotActivityUpcoming';
import { BotAvatar } from './BotAvatar';
import {
  BotItemDetailView,
  writeBotItemDraft,
  type WorkItemFull,
} from './BotItemDetailView';
import {
  BotItemQuestionStep,
  type AskQuestionShape,
  type AskSubmitPayload,
} from './BotItemQuestionStep';
import {
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconClock,
  IconShield,
  IconX,
} from './Icons';

export interface BotActivityTabProps {
  bot: BotRecord;
  filterOpen: boolean;
}

interface AccessRequestRow {
  id: string;
  botId: string;
  requesterId: string;
  requesterName?: string;
  source?: string;
  message?: string;
  status: string;
  createdAt?: number;
}

const STATUS_GROUPS: Array<WorkItemFull['status']> = [
  'needs_you',
  'working',
  'planned',
  'done',
  'canceled',
];

function normalizeWorkItems(raw: unknown): WorkItemFull[] {
  const arr = Array.isArray(raw)
    ? raw
    : (raw && typeof raw === 'object' && Array.isArray((raw as { items?: unknown[] }).items)
      ? (raw as { items: unknown[] }).items
      : []);
  return arr
    .filter((row): row is Record<string, unknown> => Boolean(row && typeof row === 'object'))
    .map((row) => ({
      ...(row as unknown as WorkItemFull),
      uid: String(row.uid ?? row.id ?? ''),
    }))
    .filter((row) => row.uid.length > 0);
}

export function BotActivityTab({ bot, filterOpen }: BotActivityTabProps) {
  const { locale, tr } = useBotsLocale();
  const zh = locale === 'zh-CN';
  const now = useNow(60_000);
  const selectedItemId = useBotsState((state) => state.rightPanelItemId);
  const changeSeq = useBotsState((state) => state.changeSeq);

  const [scopeFilter, setScopeFilter] = useState<'all' | 'home' | 'side'>('all');
  const [onlyNeedsYou, setOnlyNeedsYou] = useState(false);
  const [items, setItems] = useState<WorkItemFull[]>([]);
  const [automations, setAutomations] = useState<AutomationRow[]>([]);
  const [accessRequests, setAccessRequests] = useState<AccessRequestRow[]>([]);
  const [suggestions, setSuggestions] = useState<SuggestionRow[]>([]);
  const [upNextSeenAt, setUpNextSeenAt] = useState<number | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({
    done: true,
    canceled: true,
  });
  const [selectedUids, setSelectedUids] = useState<string[]>([]);
  const [snoozeTargetUid, setSnoozeTargetUid] = useState<string | null>(null);
  const [customSnoozeVal, setCustomSnoozeVal] = useState('');
  const [bulkStatusMenuOpen, setBulkStatusMenuOpen] = useState(false);
  const [bulkSnoozeMenuOpen, setBulkSnoozeMenuOpen] = useState(false);
  const [bulkCustomSnooze, setBulkCustomSnooze] = useState('');
  const [submittingAskUid, setSubmittingAskUid] = useState<string | null>(null);

  const reloadAll = useCallback(async () => {
    const [itemsRes, autoRes, accessRes, upNextRes] = await Promise.allSettled([
      callBotRpc(RPC_METHODS.ITEMS_OWNER_LIST, { botId: bot.id, limit: 100 }),
      callBotRpc<AutomationRow[] | { automations?: AutomationRow[] }>('bots.automations.list', { botId: bot.id }),
      callBotRpc<AccessRequestRow[] | { requests?: AccessRequestRow[] }>(RPC_METHODS.ACCESS_LIST, {
        botId: bot.id,
        status: 'pending',
      }),
      callBotRpc<
        SuggestionRow[]
        | { openSuggestions?: SuggestionRow[]; suggestions?: SuggestionRow[]; seenAt?: number | null }
      >('bots.upNext.list', { botId: bot.id }),
    ]);

    if (itemsRes.status === 'fulfilled') {
      setItems(normalizeWorkItems(itemsRes.value));
    }
    if (autoRes.status === 'fulfilled') {
      const val = autoRes.value;
      setAutomations(Array.isArray(val) ? val : (val?.automations ?? []));
    }
    if (accessRes.status === 'fulfilled') {
      const val = accessRes.value;
      const list = Array.isArray(val) ? val : (val?.requests ?? []);
      setAccessRequests(list.filter((r) => r.status === 'pending'));
    }
    if (upNextRes.status === 'fulfilled') {
      const val = upNextRes.value;
      const hasSeenAt = !Array.isArray(val) && val !== null && typeof val === 'object' && 'seenAt' in val;
      const seenAt = !Array.isArray(val) && typeof val?.seenAt === 'number'
        ? val.seenAt
        : (hasSeenAt && val.seenAt === null ? 0 : null);
      const rawList = Array.isArray(val)
        ? val
        : Array.isArray(val?.openSuggestions)
          ? val.openSuggestions
          : (val?.suggestions ?? []);
      const openOnly = rawList
        .filter((s) => !s.status || s.status === 'open')
        .map((s) => {
          if (typeof s.unread === 'boolean' || typeof s.seen === 'boolean') {
            return s;
          }
          if (typeof seenAt === 'number' && typeof s.createdAt === 'number') {
            const unread = s.createdAt > seenAt;
            return { ...s, seen: !unread, unread, seenAt };
          }
          return seenAt !== null ? { ...s, seenAt } : s;
        });
      setUpNextSeenAt(seenAt);
      setSuggestions(openOnly);
    }
  }, [bot.id]);

  useEffect(() => {
    void reloadAll();
  }, [reloadAll, changeSeq]);

  const staleDays = (bot as BotRecord & { itemsStale?: number | 'never' }).itemsStale ?? 5;
  const homeChatId = bot.chatSessionId ?? bot.homeSessionId ?? null;

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (onlyNeedsYou && item.status !== 'needs_you') {
        return false;
      }
      const chatId = (item as WorkItemFull & { chatId?: string }).chatId;
      if (scopeFilter === 'home' && homeChatId && chatId && chatId !== homeChatId) {
        return false;
      }
      if (scopeFilter === 'side' && homeChatId && (!chatId || chatId === homeChatId)) {
        return false;
      }
      return true;
    });
  }, [homeChatId, items, onlyNeedsYou, scopeFilter]);

  const needsYouItems = useMemo(
    () => filteredItems.filter((item) => item.status === 'needs_you' && !isBotItemSnoozed(item, now)),
    [filteredItems, now],
  );
  const workingItems = useMemo(
    () => filteredItems.filter((item) => item.status === 'working'),
    [filteredItems],
  );
  const staleItems = useMemo(
    () => (staleDays === 'never' ? [] : filteredItems.filter((item) => isBotItemStale(item, staleDays, now))),
    [filteredItems, now, staleDays],
  );
  const orderedUids = useMemo(() => filteredItems.map((i) => i.uid), [filteredItems]);

  const showAllClear = !bot.paused
    && needsYouItems.length === 0
    && accessRequests.length === 0
    && workingItems.length === 0
    && (bot.workers?.working ?? 0) === 0
    && (bot.workers?.permission ?? 0) === 0;

  if (selectedItemId) {
    return (
      <BotItemDetailView
        botId={bot.id}
        itemUid={selectedItemId}
        orderedUids={orderedUids}
        onSelectUid={(uid) => botsStore.setRightPanelItemId(uid)}
        onBack={() => botsStore.setRightPanelItemId(null)}
        onMutated={() => void reloadAll()}
      />
    );
  }

  const batchStatus = async (uids: string[], status: WorkItemFull['status']) => {
    if (uids.length === 0) {
      return;
    }
    setBulkStatusMenuOpen(false);
    try {
      await callBotRpc(RPC_METHODS.ITEMS_OWNER_STATUS, { botId: bot.id, uids, uid: uids[0], status });
      setSelectedUids((prev) => prev.filter((id) => !uids.includes(id)));
      void reloadAll();
    } catch (err) {
      botsStore.pushToast({ message: err instanceof Error ? err.message : String(err), tone: 'error' });
    }
  };

  const batchSnooze = async (uids: string[], until: number | null) => {
    if (uids.length === 0) {
      return;
    }
    setSnoozeTargetUid(null);
    setBulkSnoozeMenuOpen(false);
    try {
      const batchItems = uids.map((uid) => {
        const targetItem = items.find((entry) => entry.uid === uid) as (WorkItemFull & { othersLastEventId?: number }) | undefined;
        return {
          uid,
          ...(targetItem?.othersLastEventId !== undefined ? { othersLastEventId: targetItem.othersLastEventId } : {}),
        };
      });
      await callBotRpc(RPC_METHODS.ITEMS_OWNER_SNOOZE, {
        botId: bot.id,
        items: batchItems,
        until,
      });
      setSelectedUids((prev) => prev.filter((id) => !uids.includes(id)));
      void reloadAll();
    } catch (err) {
      botsStore.pushToast({ message: err instanceof Error ? err.message : String(err), tone: 'error' });
    }
  };

  const submitQuickAsk = async (item: WorkItemFull, payload: AskSubmitPayload) => {
    if (!payload.text || submittingAskUid) {
      return;
    }
    setSubmittingAskUid(item.uid);
    try {
      await callBotRpc(RPC_METHODS.ITEMS_OWNER_COMMENT, {
        botId: bot.id,
        uid: item.uid,
        text: payload.text,
        decisions: payload.decisions,
        ...(item.question?.eventId !== undefined ? { questionEventId: item.question.eventId } : {}),
        requestId: `ask-${Date.now().toString(36)}`,
      });
      void reloadAll();
    } catch (err) {
      botsStore.pushToast({ message: err instanceof Error ? err.message : String(err), tone: 'error' });
    } finally {
      setSubmittingAskUid(null);
    }
  };

  const handleInlineFillComment = (itemUid: string, text: string) => {
    writeBotItemDraft(bot.id, itemUid, text);
    botsStore.setRightPanelItemId(itemUid);
  };

  const decideAccess = async (id: string, decision: 'granted' | 'denied') => {
    try {
      await callBotRpc(RPC_METHODS.ACCESS_DECIDE, { id, decision });
      void reloadAll();
      void botsStore.refresh();
    } catch (err) {
      botsStore.pushToast({ message: err instanceof Error ? err.message : String(err), tone: 'error' });
    }
  };

  const snoozePresets = botItemSnoozePickerPresets(now);

  return (
    <div className="dsh-bots-panel-scroll dsh-bots-activity-scroll">
      {filterOpen && (
        <div className="dsh-bots-filter-bar">
          {([['all', zh ? '全部' : 'All'], ['home', zh ? '主对话' : 'Home Chat'], ['side', zh ? '支线' : 'Side']] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              className="dsh-bots-chip"
              data-active={scopeFilter === key ? 'true' : 'false'}
              onClick={() => setScopeFilter(key)}
            >
              {label}
            </button>
          ))}
          <button
            type="button"
            className="dsh-bots-chip"
            data-active={onlyNeedsYou ? 'true' : 'false'}
            onClick={() => setOnlyNeedsYou((prev) => !prev)}
          >
            {zh ? '仅看需要你处理' : 'Only needs you'}
          </button>
        </div>
      )}

      {showAllClear && (
        <div className="dsh-bots-all-clear" role="status">
          <BotAvatar
            botId={bot.id}
            avatar={bot.avatar}
            avatarColor={bot.avatarColor}
            name={bot.name}
            size={32}
            radius={9}
            status={bot.dotState ?? undefined}
          />
          <div className="dsh-bots-all-clear-body">
            <div className="dsh-bots-all-clear-title">
              {zh ? '当前一切顺利' : 'All clear'}
            </div>
            <div className="dsh-bots-muted">
              {zh
                ? `${bot.name} 暂无待你处理或正在运行的工作条目`
                : `No pending questions or active runs for ${bot.name}.`}
            </div>
          </div>
        </div>
      )}

      {(needsYouItems.length > 0 || accessRequests.length > 0) && (
        <div className="dsh-bots-psection">
          <div className="dsh-bots-section-head">
            <span className="dsh-bots-section-title">
              <span>{tr('bots.items.needsYou', 'Needs you')}</span>
              <span className="dsh-bots-badge dsh-bots-badge-warn">
                {needsYouItems.length + accessRequests.length}
              </span>
            </span>
          </div>

          {accessRequests.map((req) => (
            <div key={req.id} className="dsh-bots-pcard dsh-bots-pcard-warn">
              <div className="dsh-bots-row">
                <span className="dsh-bots-row-left" style={{ fontWeight: 600 }}>
                  <IconShield size={13} />
                  <span>{req.requesterName || req.requesterId}</span>
                </span>
                {req.source && <span className="dsh-bots-badge">{req.source}</span>}
              </div>
              <div className="dsh-bots-muted">
                {req.message || (zh ? '请求向此机器人提问的权限' : 'Requested permission to ask this bot.')}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  type="button"
                  className="dsh-bots-pbtn dsh-bots-pbtn-xs dsh-bots-pbtn-primary"
                  onClick={() => void decideAccess(req.id, 'granted')}
                >
                  {zh ? '批准' : 'Approve'}
                </button>
                <button
                  type="button"
                  className="dsh-bots-pbtn dsh-bots-pbtn-xs"
                  onClick={() => void decideAccess(req.id, 'denied')}
                >
                  {zh ? '拒绝' : 'Deny'}
                </button>
              </div>
            </div>
          ))}

          {needsYouItems.map((item) => {
            const askData = item.question?.data ?? (item.question?.ask ? { ask: item.question.ask } : null);
            const shape = askData ? (botItemQuestionShape(askData) as AskQuestionShape) : null;
            return (
              <div key={`ny-${item.uid}`} className="dsh-bots-pcard dsh-bots-pcard-warn">
                <div className="dsh-bots-row">
                  <button
                    type="button"
                    style={{ border: 'none', background: 'transparent', padding: 0, font: 'inherit', fontWeight: 600, color: 'inherit', cursor: 'pointer', textAlign: 'left' }}
                    onClick={() => botsStore.setRightPanelItemId(item.uid)}
                  >
                    {item.title}
                  </button>
                  <button
                    type="button"
                    className="dsh-bots-pbtn dsh-bots-pbtn-xs"
                    onClick={() => botsStore.setRightPanelItemId(item.uid)}
                  >
                    {zh ? '查看' : 'Open'}
                  </button>
                </div>

                {shape && shape.decisions.length > 0 ? (
                  <BotItemQuestionStep
                    questionKey={`inline:${item.uid}:${item.question?.eventId ?? '0'}`}
                    shape={shape}
                    compact
                    submitting={submittingAskUid === item.uid}
                    onSubmit={(payload) => void submitQuickAsk(item, payload)}
                    onFillComment={(text) => handleInlineFillComment(item.uid, text)}
                  />
                ) : (
                  <div className="dsh-bots-muted">{item.question?.text || item.summary || (zh ? '等待你的确认或回复' : 'Waiting for your input')}</div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="dsh-bots-psection">
        <div className="dsh-bots-section-head">
          <span className="dsh-bots-section-title">
            <span>{zh ? '工作条目 (Items)' : 'Items'}</span>
            <span className="dsh-bots-badge">{filteredItems.length}</span>
          </span>
          {staleItems.length > 0 && (
            <button
              type="button"
              className="dsh-bots-pbtn dsh-bots-pbtn-xs"
              onClick={() => void batchStatus(staleItems.map((i) => i.uid), 'canceled')}
            >
              {zh ? `清理 ${staleItems.length} 条陈旧项` : `Clean ${staleItems.length} stale`}
            </button>
          )}
        </div>

        {filteredItems.length === 0 ? (
          <div className="dsh-bots-empty">{tr('bots.items.empty', 'No items yet.')}</div>
        ) : (
          STATUS_GROUPS.map((status) => {
            const rows = filteredItems.filter((item) => item.status === status);
            if (rows.length === 0) {
              return null;
            }
            const collapsed = Boolean(collapsedGroups[status]);
            return (
              <div key={status} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <button
                  type="button"
                  className="dsh-bots-item-group-btn"
                  onClick={() => setCollapsedGroups((prev) => ({ ...prev, [status]: !prev[status] }))}
                >
                  {collapsed ? <IconChevronRight size={12} /> : <IconChevronDown size={12} />}
                  <span>{tr(`bots.items.status.${status}`, status)}</span>
                  <span className="dsh-bots-badge">{rows.length}</span>
                </button>

                {!collapsed && rows.map((item) => {
                  const checked = selectedUids.includes(item.uid);
                  const stale = staleDays !== 'never' && isBotItemStale(item, staleDays, now);
                  const snoozed = isBotItemSnoozed(item, now);
                  return (
                    <div
                      key={item.uid}
                      className="dsh-bots-item-row"
                      data-selected={checked ? 'true' : 'false'}
                      onClick={() => botsStore.setRightPanelItemId(item.uid)}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        aria-label={item.title}
                        onClick={(e) => e.stopPropagation()}
                        onChange={() => setSelectedUids((prev) => (
                          prev.includes(item.uid) ? prev.filter((id) => id !== item.uid) : [...prev, item.uid]
                        ))}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="dsh-bots-row">
                          <span className="dsh-bots-ellipsis" style={{ fontWeight: 500 }}>
                            {item.number !== undefined ? `${formatBotItemNumber(item.number)} ` : ''}
                            {item.title}
                          </span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 1 }}>
                          {stale && <span className="dsh-bots-badge dsh-bots-badge-warn">{tr('bots.items.stale', 'Stale')}</span>}
                          {snoozed && <span className="dsh-bots-badge dsh-bots-badge-accent">{tr('bots.items.snoozed', 'Snoozed')}</span>}
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
                                  onClick={() => void batchSnooze([item.uid], preset.at)}
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
                                      void batchSnooze([item.uid], ts);
                                    }
                                  }}
                                >
                                  {zh ? '确认时间' : 'Apply'}
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                        {item.status !== 'done' && (
                          <button
                            type="button"
                            className="dsh-bots-pbtn dsh-bots-pbtn-xs dsh-bots-pbtn-icon"
                            title={tr('bots.items.status.done', 'Done')}
                            onClick={() => void batchStatus([item.uid], 'done')}
                          >
                            <IconCheck size={12} />
                          </button>
                        )}
                        {item.status !== 'canceled' && (
                          <button
                            type="button"
                            className="dsh-bots-pbtn dsh-bots-pbtn-xs dsh-bots-pbtn-icon"
                            title={tr('bots.items.status.canceled', 'Canceled')}
                            onClick={() => void batchStatus([item.uid], 'canceled')}
                          >
                            <IconX size={12} />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })
        )}
      </div>

      <BotActivityUpcoming
        bot={bot}
        now={now}
        automations={automations}
        suggestions={suggestions}
        upNextSeenAt={upNextSeenAt}
        onReload={() => void reloadAll()}
      />

      {selectedUids.length > 0 && (
        <div className="dsh-bots-bulk-pill" role="toolbar" aria-label={zh ? '批量操作' : 'Bulk actions'}>
          <span className="dsh-bots-bulk-pill-count">
            {zh ? `已选 ${selectedUids.length} 项` : `${selectedUids.length} selected`}
          </span>

          <div className="dsh-bots-bulk-pill-actions">
            <div className="dsh-bots-pmenu-wrap">
              <button
                type="button"
                className="dsh-bots-pbtn dsh-bots-pbtn-xs dsh-bots-pbtn-primary"
                onClick={() => {
                  setBulkSnoozeMenuOpen(false);
                  setBulkStatusMenuOpen((prev) => !prev);
                }}
              >
                <span>{zh ? '移至状态' : 'Move to'}</span>
                <IconChevronDown size={11} />
              </button>
              {bulkStatusMenuOpen && (
                <div className="dsh-bots-pmenu dsh-bots-pmenu-up" role="menu">
                  {BOT_ITEM_STATUSES.map((st) => (
                    <button
                      key={st}
                      type="button"
                      className="dsh-bots-pmenu-item"
                      role="menuitem"
                      onClick={() => void batchStatus(selectedUids, st as WorkItemFull['status'])}
                    >
                      {tr(`bots.items.status.${st}`, st)}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="dsh-bots-pmenu-wrap">
              <button
                type="button"
                className="dsh-bots-pbtn dsh-bots-pbtn-xs"
                onClick={() => {
                  setBulkStatusMenuOpen(false);
                  setBulkSnoozeMenuOpen((prev) => !prev);
                }}
              >
                <IconClock size={11} />
                <span>{zh ? '延后' : 'Snooze'}</span>
              </button>
              {bulkSnoozeMenuOpen && (
                <div className="dsh-bots-pmenu dsh-bots-pmenu-up" role="menu">
                  {snoozePresets.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      className="dsh-bots-pmenu-item"
                      role="menuitem"
                      onClick={() => void batchSnooze(selectedUids, preset.at)}
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
                      value={bulkCustomSnooze}
                      onChange={(e) => setBulkCustomSnooze(e.target.value)}
                    />
                    <button
                      type="button"
                      className="dsh-bots-pbtn dsh-bots-pbtn-xs dsh-bots-pbtn-primary"
                      disabled={!bulkCustomSnooze}
                      onClick={() => {
                        const ts = Date.parse(bulkCustomSnooze);
                        if (Number.isFinite(ts) && ts > Date.now()) {
                          void batchSnooze(selectedUids, ts);
                        }
                      }}
                    >
                      {zh ? '应用自定义时间' : 'Apply custom time'}
                    </button>
                  </div>
                  <div className="dsh-bots-pmenu-sep" />
                  <button
                    type="button"
                    className="dsh-bots-pmenu-item"
                    role="menuitem"
                    onClick={() => void batchSnooze(selectedUids, null)}
                  >
                    {zh ? '取消延后' : 'Clear snooze'}
                  </button>
                </div>
              )}
            </div>

            <button
              type="button"
              className="dsh-bots-pbtn dsh-bots-pbtn-xs dsh-bots-pbtn-icon dsh-bots-pbtn-ghost"
              aria-label={zh ? '清空选择' : 'Clear selection'}
              onClick={() => {
                setBulkStatusMenuOpen(false);
                setBulkSnoozeMenuOpen(false);
                setSelectedUids([]);
              }}
            >
              <IconX size={12} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
