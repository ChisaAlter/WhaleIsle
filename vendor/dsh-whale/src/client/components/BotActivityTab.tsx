// Right-panel Home / Activity tab:
// 3-section Ketchup Rolling Digest (In progress / Auto-handled / Needs You decision cards
// with recommendation, risk, and evidence links) -> Work Items (5 smooth collapsible groups) ->
// BotActivityUpcoming -> Lightweight today's cost & peak/off-peak summary strip.

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  botItemPrUrl,
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
import {
  RPC_METHODS,
  callBotRpc,
  getBotBudgetUsage,
  type BotBudgetUsageSummary,
  type BotRecord,
} from '../store/rpc';
import {
  BotActivityUpcoming,
  type AutomationRow,
  type SuggestionRow,
} from './BotActivityUpcoming';
import { BotChevron, BotDisclosure } from './BotDisclosure';
import { BotItemDetailView, type WorkItemFull, type WorkItemLink } from './BotItemDetailView';
import {
  IconAlertTriangle,
  IconCheck,
  IconClock,
  IconExternalLink,
  IconLink,
  IconShield,
  IconSparkles,
  IconX,
  IconZap,
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

interface AskReplyOption {
  label: string;
  detail?: string;
  recommended?: boolean;
  risk?: string;
}

interface AskDecisionItem {
  question: string;
  multi: boolean;
  replies: AskReplyOption[];
}

interface AskQuestionShape {
  body: string;
  decisions: AskDecisionItem[];
}

type DigestWorkItem = WorkItemFull & {
  chatId?: string;
  risk?: string | null;
  recommended?: string | null;
  evidenceLinks?: WorkItemLink[];
  othersLastEventId?: number;
};

const STATUS_GROUPS: Array<WorkItemFull['status']> = [
  'needs_you',
  'working',
  'planned',
  'done',
  'canceled',
];

function normalizeWorkItems(raw: unknown): DigestWorkItem[] {
  const arr = Array.isArray(raw)
    ? raw
    : (raw && typeof raw === 'object' && Array.isArray((raw as { items?: unknown[] }).items)
      ? (raw as { items: unknown[] }).items
      : []);
  return arr
    .filter((row): row is Record<string, unknown> => Boolean(row && typeof row === 'object'))
    .map((row) => ({
      ...(row as unknown as DigestWorkItem),
      uid: String(row.uid ?? row.id ?? ''),
    }))
    .filter((row) => row.uid.length > 0);
}

function extractItemRisk(item: DigestWorkItem): string | null {
  if (typeof item.risk === 'string' && item.risk.trim()) {
    return item.risk.trim();
  }
  const qData = item.question?.data;
  if (qData && typeof qData.risk === 'string' && qData.risk.trim()) {
    return qData.risk.trim();
  }
  if (qData && typeof qData.exitCode === 'number' && qData.exitCode !== 0) {
    return `退出码 ${qData.exitCode}`;
  }
  return null;
}

function extractItemRecommended(item: DigestWorkItem, shape: AskQuestionShape | null): string | null {
  if (typeof item.recommended === 'string' && item.recommended.trim()) {
    return item.recommended.trim();
  }
  const qData = item.question?.data;
  if (qData && typeof qData.recommended === 'string' && qData.recommended.trim()) {
    return qData.recommended.trim();
  }
  if (shape) {
    for (const dec of shape.decisions) {
      const rec = dec.replies.find((opt) => opt.recommended);
      if (rec?.label) {
        return rec.label;
      }
    }
  }
  return null;
}

function resolveEvidenceHref(link: WorkItemLink): string | null {
  if (link.url) return link.url;
  if (link.kind === 'url' && link.ref) return link.ref;
  if (link.kind === 'pr' && link.ref) return botItemPrUrl(link.ref);
  return null;
}

function formatUsd(value: number | undefined | null): string {
  const num = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  return `$${num.toFixed(num > 0 && num < 0.01 ? 4 : 2)}`;
}

export function BotActivityTab({ bot, filterOpen }: BotActivityTabProps) {
  const { locale, tr } = useBotsLocale();
  const zh = locale === 'zh-CN';
  const now = useNow(60_000);
  const selectedItemId = useBotsState((state) => state.rightPanelItemId);
  const changeSeq = useBotsState((state) => state.changeSeq);

  const [scopeFilter, setScopeFilter] = useState<'all' | 'home' | 'side'>('all');
  const [onlyNeedsYou, setOnlyNeedsYou] = useState(false);
  const [items, setItems] = useState<DigestWorkItem[]>([]);
  const [automations, setAutomations] = useState<AutomationRow[]>([]);
  const [accessRequests, setAccessRequests] = useState<AccessRequestRow[]>([]);
  const [suggestions, setSuggestions] = useState<SuggestionRow[]>([]);
  const [budgetUsage, setBudgetUsage] = useState<BotBudgetUsageSummary | null>(null);
  const [digestInProgressOpen, setDigestInProgressOpen] = useState(true);
  const [digestAutoDoneOpen, setDigestAutoDoneOpen] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({
    done: true,
    canceled: true,
  });
  const [selectedUids, setSelectedUids] = useState<string[]>([]);
  const [snoozeTargetUid, setSnoozeTargetUid] = useState<string | null>(null);
  const [customSnoozeVal, setCustomSnoozeVal] = useState('');
  const [askPicks, setAskPicks] = useState<Record<string, Record<number, number[]>>>({});

  const reloadAll = useCallback(async () => {
    const [itemsRes, autoRes, accessRes, upNextRes, budgetRes] = await Promise.allSettled([
      callBotRpc(RPC_METHODS.ITEMS_OWNER_LIST, { botId: bot.id, limit: 100 }),
      callBotRpc<AutomationRow[] | { automations?: AutomationRow[] }>(RPC_METHODS.AUTOMATIONS_LIST, { botId: bot.id }),
      callBotRpc<AccessRequestRow[] | { requests?: AccessRequestRow[] }>(RPC_METHODS.ACCESS_LIST, {
        botId: bot.id,
        status: 'pending',
      }),
      callBotRpc<SuggestionRow[] | { suggestions?: SuggestionRow[] }>('bots.upNext.list', { botId: bot.id }),
      getBotBudgetUsage(bot.id),
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
      setSuggestions(Array.isArray(val) ? val : (val?.suggestions ?? []));
    }
    if (budgetRes.status === 'fulfilled') {
      setBudgetUsage(budgetRes.value);
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
      if (scopeFilter === 'home' && homeChatId && item.chatId && item.chatId !== homeChatId) {
        return false;
      }
      if (scopeFilter === 'side' && homeChatId && (!item.chatId || item.chatId === homeChatId)) {
        return false;
      }
      return true;
    });
  }, [homeChatId, items, onlyNeedsYou, scopeFilter]);

  const needsYouItems = useMemo(
    () => filteredItems.filter((item) => item.status === 'needs_you' && !isBotItemSnoozed(item, now)),
    [filteredItems, now],
  );
  const inProgressItems = useMemo(
    () => filteredItems.filter((item) => item.status === 'working' || item.status === 'planned'),
    [filteredItems],
  );
  const autoDoneItems = useMemo(
    () => filteredItems.filter((item) => item.status === 'done'),
    [filteredItems],
  );
  const staleItems = useMemo(
    () => (staleDays === 'never' ? [] : filteredItems.filter((item) => isBotItemStale(item, staleDays, now))),
    [filteredItems, now, staleDays],
  );
  const orderedUids = useMemo(() => filteredItems.map((i) => i.uid), [filteredItems]);

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
    try {
      await callBotRpc(RPC_METHODS.ITEMS_OWNER_STATUS, { botId: bot.id, uids, uid: uids[0], status });
      setSelectedUids((prev) => prev.filter((id) => !uids.includes(id)));
      void reloadAll();
    } catch (err) {
      botsStore.pushToast({ message: err instanceof Error ? err.message : String(err), tone: 'error' });
    }
  };

  const snoozeItem = async (uid: string, until: number | null) => {
    setSnoozeTargetUid(null);
    const targetItem = items.find((entry) => entry.uid === uid);
    try {
      await callBotRpc(RPC_METHODS.ITEMS_OWNER_SNOOZE, {
        botId: bot.id,
        items: [{
          uid,
          ...(targetItem?.othersLastEventId !== undefined ? { othersLastEventId: targetItem.othersLastEventId } : {}),
        }],
        until,
      });
      void reloadAll();
    } catch (err) {
      botsStore.pushToast({ message: err instanceof Error ? err.message : String(err), tone: 'error' });
    }
  };

  const submitQuickAsk = async (item: DigestWorkItem) => {
    const askData = item.question?.data ?? (item.question?.ask ? { ask: item.question.ask } : null);
    if (!askData) {
      return;
    }
    const shape = botItemQuestionShape(askData) as AskQuestionShape;
    const picksMap = askPicks[item.uid] ?? {};
    const lines: string[] = [];
    const decisions = shape.decisions.map((dec: AskDecisionItem, qIdx: number) => {
      const picks = picksMap[qIdx] ?? [];
      const labels = picks.map((i) => dec.replies[i]?.label).filter(Boolean).join(', ');
      if (labels) {
        lines.push(shape.decisions.length > 1 ? `${dec.question} → ${labels}` : labels);
      }
      return { picks };
    });
    const text = lines.join('\n').trim();
    if (!text) {
      return;
    }
    try {
      await callBotRpc(RPC_METHODS.ITEMS_OWNER_COMMENT, {
        botId: bot.id,
        uid: item.uid,
        text,
        decisions,
        requestId: `ask-${Date.now().toString(36)}`,
      });
      void reloadAll();
    } catch (err) {
      botsStore.pushToast({ message: err instanceof Error ? err.message : String(err), tone: 'error' });
    }
  };

  const decideAccess = async (id: string, decision: 'granted' | 'declined') => {
    try {
      await callBotRpc(RPC_METHODS.ACCESS_DECIDE, { id, decision });
      void reloadAll();
      void botsStore.refresh();
    } catch (err) {
      botsStore.pushToast({ message: err instanceof Error ? err.message : String(err), tone: 'error' });
    }
  };

  const snoozePresets = botItemSnoozePickerPresets(now);
  const needsYouTotal = needsYouItems.length + accessRequests.length;
  const cacheHitPct = typeof budgetUsage?.cacheHitRate === 'number' && Number.isFinite(budgetUsage.cacheHitRate)
    ? Math.round(budgetUsage.cacheHitRate <= 1 ? budgetUsage.cacheHitRate * 100 : budgetUsage.cacheHitRate)
    : null;

  return (
    <div className="dsh-bots-panel-scroll">
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

      {/* 3-section Ketchup Rolling Digest */}
      <div className="dsh-bots-digest" data-dsh-bots-digest="ketchup">
        <div className="dsh-bots-digest-strip">
          <div className="dsh-bots-digest-stat">
            <span className="dsh-bots-muted">{zh ? '推进中' : 'In progress'}</span>
            <strong>{inProgressItems.length}</strong>
          </div>
          <div className="dsh-bots-digest-stat">
            <span className="dsh-bots-muted">{zh ? '自动搞定' : 'Auto-handled'}</span>
            <strong>{autoDoneItems.length}</strong>
          </div>
          <div className="dsh-bots-digest-stat" data-warn={needsYouTotal > 0 ? 'true' : 'false'}>
            <span className="dsh-bots-muted">{zh ? '唯独这些需拍板' : 'Needs you'}</span>
            <strong>{needsYouTotal}</strong>
          </div>
        </div>

        {/* Section 1: In progress */}
        <div className="dsh-bots-digest-group" data-digest-section="in-progress">
          <button
            type="button"
            className="dsh-bots-item-group-btn"
            onClick={() => setDigestInProgressOpen((prev) => !prev)}
          >
            <BotChevron open={digestInProgressOpen} size={12} />
            <IconZap size={12} />
            <span>{zh ? '推进中' : 'In progress'}</span>
            <span className="dsh-bots-badge dsh-bots-badge-accent">{inProgressItems.length}</span>
          </button>
          <BotDisclosure open={digestInProgressOpen}>
            {inProgressItems.length === 0 ? (
              <div className="dsh-bots-digest-empty">
                {zh ? '当前无正在推进的后台事项。' : 'Nothing currently in progress.'}
              </div>
            ) : (
              <div className="dsh-bots-digest-list">
                {inProgressItems.slice(0, 4).map((item) => (
                  <button
                    key={`prog-${item.uid}`}
                    type="button"
                    className="dsh-bots-digest-item"
                    onClick={() => botsStore.setRightPanelItemId(item.uid)}
                  >
                    <span className="dsh-bots-ellipsis" style={{ fontWeight: 500 }}>{item.title}</span>
                    <span className="dsh-bots-badge">
                      {tr(`bots.items.status.${item.status}`, item.status)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </BotDisclosure>
        </div>

        {/* Section 2: Auto-handled */}
        <div className="dsh-bots-digest-group" data-digest-section="auto-done">
          <button
            type="button"
            className="dsh-bots-item-group-btn"
            onClick={() => setDigestAutoDoneOpen((prev) => !prev)}
          >
            <BotChevron open={digestAutoDoneOpen} size={12} />
            <IconCheck size={12} />
            <span>{zh ? '自动搞定' : 'Auto-handled'}</span>
            <span className="dsh-bots-badge dsh-bots-badge-success">{autoDoneItems.length}</span>
          </button>
          <BotDisclosure open={digestAutoDoneOpen}>
            {autoDoneItems.length === 0 ? (
              <div className="dsh-bots-digest-empty">
                {zh ? '近期暂无自动结单事项。' : 'No auto-handled items yet.'}
              </div>
            ) : (
              <div className="dsh-bots-digest-list">
                {autoDoneItems.slice(0, 4).map((item) => (
                  <button
                    key={`done-${item.uid}`}
                    type="button"
                    className="dsh-bots-digest-item"
                    onClick={() => botsStore.setRightPanelItemId(item.uid)}
                  >
                    <span className="dsh-bots-ellipsis">{item.title}</span>
                    <span className="dsh-bots-muted">
                      {formatRelativeTime(item.lastActivityAt ?? item.updatedAt, now, locale)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </BotDisclosure>
        </div>

        {/* Section 3: Only these Needs You decision cards */}
        {needsYouTotal > 0 && (
          <div className="dsh-bots-psection" data-digest-section="needs-you">
            <div className="dsh-bots-section-head">
              <span className="dsh-bots-section-title">
                <IconSparkles size={12} />
                <span>{zh ? '唯独这些需要你拍板' : 'Only these need you'}</span>
                <span className="dsh-bots-badge dsh-bots-badge-warn">{needsYouTotal}</span>
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
                    onClick={() => void decideAccess(req.id, 'declined')}
                  >
                    {zh ? '拒绝' : 'Decline'}
                  </button>
                </div>
              </div>
            ))}

            {needsYouItems.map((item) => {
              const askData = item.question?.data ?? (item.question?.ask ? { ask: item.question.ask } : null);
              const shape = askData ? (botItemQuestionShape(askData) as AskQuestionShape) : null;
              const riskText = extractItemRisk(item);
              const recText = extractItemRecommended(item, shape);
              const evidenceLinks = [...(item.links ?? []), ...(item.evidenceLinks ?? [])];
              return (
                <div key={`ny-${item.uid}`} className="dsh-bots-pcard dsh-bots-pcard-warn" data-dsh-bots-decision-card={item.uid}>
                  <div className="dsh-bots-row">
                    <button
                      type="button"
                      className="dsh-bots-card-title-btn"
                      onClick={() => botsStore.setRightPanelItemId(item.uid)}
                    >
                      {item.title}
                    </button>
                    <button
                      type="button"
                      className="dsh-bots-pbtn dsh-bots-pbtn-xs"
                      onClick={() => botsStore.setRightPanelItemId(item.uid)}
                    >
                      {zh ? '详情' : 'Open'}
                    </button>
                  </div>

                  {(recText || riskText) && (
                    <div className="dsh-bots-decision-meta">
                      {recText && (
                        <span className="dsh-bots-badge dsh-bots-badge-accent">
                          {zh ? `推荐：${recText}` : `Rec: ${recText}`}
                        </span>
                      )}
                      {riskText && (
                        <span className="dsh-bots-badge dsh-bots-badge-danger">
                          <IconAlertTriangle size={10} />
                          <span>{zh ? `风险：${riskText}` : `Risk: ${riskText}`}</span>
                        </span>
                      )}
                    </div>
                  )}

                  {evidenceLinks.length > 0 && (
                    <div className="dsh-bots-evidence-links">
                      {evidenceLinks.slice(0, 3).map((link, idx) => {
                        const href = resolveEvidenceHref(link);
                        const label = link.label || link.ref || link.url || (zh ? '证据链接' : 'Evidence');
                        return href ? (
                          <a
                            key={`ev-${idx}`}
                            href={href}
                            target="_blank"
                            rel="noreferrer"
                            className="dsh-bots-evidence-link"
                          >
                            <IconLink size={11} />
                            <span className="dsh-bots-ellipsis">{label}</span>
                            <IconExternalLink size={10} />
                          </a>
                        ) : (
                          <button
                            key={`ev-${idx}`}
                            type="button"
                            className="dsh-bots-evidence-link"
                            onClick={() => botsStore.setRightPanelItemId(item.uid)}
                          >
                            <IconLink size={11} />
                            <span className="dsh-bots-ellipsis">{label}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {shape && shape.decisions.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                      {shape.decisions.map((dec: AskDecisionItem, qIdx: number) => (
                        <div key={dec.question} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                          <div style={{ fontSize: 12, fontWeight: 500 }}>{dec.question}</div>
                          {dec.replies.map((opt: AskReplyOption, optIdx: number) => {
                            const picks = askPicks[item.uid]?.[qIdx] ?? [];
                            const picked = picks.includes(optIdx);
                            return (
                              <button
                                key={opt.label}
                                type="button"
                                className="dsh-bots-ask-option"
                                data-selected={picked ? 'true' : 'false'}
                                onClick={() => setAskPicks((prev) => {
                                  const cur = prev[item.uid]?.[qIdx] ?? [];
                                  const next = dec.multi
                                    ? (cur.includes(optIdx) ? cur.filter((x) => x !== optIdx) : [...cur, optIdx])
                                    : [optIdx];
                                  return { ...prev, [item.uid]: { ...(prev[item.uid] ?? {}), [qIdx]: next } };
                                })}
                              >
                                <span style={{ flex: 1 }}>{opt.label}</span>
                                {opt.recommended && (
                                  <span className="dsh-bots-badge dsh-bots-badge-accent">
                                    {tr('bots.items.recommended', '推荐')}
                                  </span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      ))}
                      <button
                        type="button"
                        className="dsh-bots-pbtn dsh-bots-pbtn-xs dsh-bots-pbtn-primary"
                        onClick={() => void submitQuickAsk(item)}
                      >
                        {zh ? '提交拍板' : 'Submit decision'}
                      </button>
                    </div>
                  ) : (
                    <div className="dsh-bots-muted">
                      {item.question?.text || item.summary || (zh ? '等待你的确认或回复' : 'Waiting for your input')}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Work Items 5 collapsible status groups */}
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

        {selectedUids.length > 0 && (
          <div className="dsh-bots-bulk-bar">
            <span>{zh ? `已选 ${selectedUids.length} 项` : `${selectedUids.length} selected`}</span>
            <div style={{ display: 'inline-flex', gap: 4 }}>
              <button
                type="button"
                className="dsh-bots-pbtn dsh-bots-pbtn-xs dsh-bots-pbtn-primary"
                onClick={() => void batchStatus(selectedUids, 'done')}
              >
                {tr('bots.items.status.done', 'Done')}
              </button>
              <button
                type="button"
                className="dsh-bots-pbtn dsh-bots-pbtn-xs"
                onClick={() => void batchStatus(selectedUids, 'canceled')}
              >
                {tr('bots.items.status.canceled', 'Canceled')}
              </button>
              <button
                type="button"
                className="dsh-bots-pbtn dsh-bots-pbtn-xs dsh-bots-pbtn-ghost"
                onClick={() => setSelectedUids([])}
              >
                <IconX size={11} />
              </button>
            </div>
          </div>
        )}

        {filteredItems.length === 0 ? (
          <div className="dsh-bots-empty">{tr('bots.items.empty', 'No items yet.')}</div>
        ) : (
          STATUS_GROUPS.map((status) => {
            const rows = filteredItems.filter((item) => item.status === status);
            if (rows.length === 0) {
              return null;
            }
            const open = !collapsedGroups[status];
            return (
              <div key={status} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <button
                  type="button"
                  className="dsh-bots-item-group-btn"
                  onClick={() => setCollapsedGroups((prev) => ({ ...prev, [status]: !prev[status] }))}
                >
                  <BotChevron open={open} size={12} />
                  <span>{tr(`bots.items.status.${status}`, status)}</span>
                  <span className="dsh-bots-badge">{rows.length}</span>
                </button>

                <BotDisclosure open={open}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {rows.map((item) => {
                      const checked = selectedUids.includes(item.uid);
                      const stale = staleDays !== 'never' && isBotItemStale(item, staleDays, now);
                      const snoozed = isBotItemSnoozed(item, now);
                      return (
                        <div
                          key={item.uid}
                          className="dsh-bots-item-row"
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
                                      onClick={() => void snoozeItem(item.uid, preset.at)}
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
                                          void snoozeItem(item.uid, ts);
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
                </BotDisclosure>
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
        onReload={() => void reloadAll()}
      />

      {/* Lightweight today's cost & peak/off-peak summary strip */}
      <button
        type="button"
        className="dsh-bots-budget-strip"
        data-dsh-bots-budget-strip={bot.id}
        onClick={() => botsStore.openBotSettings(bot.id, { host: 'panel', page: 'budget' })}
      >
        <div className="dsh-bots-row-left" style={{ gap: 6 }}>
          <span className="dsh-bots-muted">{zh ? '今日费用' : 'Today'}</span>
          <strong className="dsh-bots-num">{formatUsd(budgetUsage?.costUsd)}</strong>
          {budgetUsage?.isOffPeak !== undefined && (
            <span className={`dsh-bots-badge ${budgetUsage.isOffPeak ? 'dsh-bots-badge-success' : 'dsh-bots-badge-warn'}`}>
              {budgetUsage.isOffPeak ? (zh ? '谷段' : 'Off-peak') : (zh ? '峰段' : 'Peak')}
            </span>
          )}
          {cacheHitPct !== null && (
            <span className="dsh-bots-muted">{zh ? `缓存 ${cacheHitPct}%` : `Cache ${cacheHitPct}%`}</span>
          )}
        </div>
        <span className="dsh-bots-muted">
          {budgetUsage?.exceeded ? (zh ? '已超额' : 'Exceeded') : (zh ? '预算 ›' : 'Budget ›')}
        </span>
      </button>
    </div>
  );
}
