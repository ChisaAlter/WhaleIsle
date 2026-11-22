// Detailed view for a single Bot Work Item inside the right panel:
// prev/next navigation, status/snooze controls, description, doneMeans, links,
// structured Ask decision answering, event timeline, and idempotent comment composer.

import { useCallback, useEffect, useState } from 'react';
import {
  BOT_ITEM_STATUSES,
  botItemPrUrl,
  botItemQuestionShape,
  botItemSnoozePickerPresets,
  botItemSnoozePresetName,
  formatBotItemNumber,
  isBotItemSnoozed,
} from '../../shared/bot-items.js';
import {
  botsStore,
  formatRelativeTime,
  useBotsLocale,
  useNow,
} from '../store/bots-store';
import { RPC_METHODS, callBotRpc } from '../store/rpc';
import {
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconClock,
  IconExternalLink,
  IconLink,
  IconSend,
  IconX,
} from './Icons';

export interface WorkItemEvent {
  id: number;
  eventId?: string;
  kind: string;
  actor?: { kind?: string; botId?: string; why?: string };
  data?: Record<string, unknown>;
  createdAt?: number;
}

export interface WorkItemLink {
  kind?: string;
  ref?: string;
  label?: string;
  url?: string;
  state?: string;
}

export interface WorkItemFull {
  uid: string;
  id?: string;
  number?: number;
  title: string;
  description?: string | null;
  summary?: string | null;
  doneMeans?: string | null;
  status: 'planned' | 'working' | 'needs_you' | 'done' | 'canceled';
  snoozedUntil?: number | null;
  lastActivityAt?: number;
  updatedAt?: number;
  createdAt?: number;
  links?: WorkItemLink[];
  events?: WorkItemEvent[];
  question?: { eventId?: number | string; text?: string; ask?: unknown; data?: Record<string, unknown> } | null;
}

export interface BotItemDetailViewProps {
  botId: string;
  itemUid: string;
  orderedUids: string[];
  onSelectUid: (uid: string) => void;
  onBack: () => void;
  onMutated: () => void;
}

interface AskReplyOption {
  label: string;
  detail?: string;
  recommended?: boolean;
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

function makeRequestId(): string {
  return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function statusLabel(status: string, tr: (k: string, fb?: string) => string): string {
  return tr(`bots.items.status.${status}`, status);
}

function eventSummaryText(ev: WorkItemEvent, zh: boolean): string {
  const data = ev.data ?? {};
  if (ev.kind === 'commented' && typeof data.text === 'string') {
    return data.text;
  }
  if (ev.kind === 'status' && typeof data.to === 'string') {
    return zh ? `状态变更为 ${data.to}` : `Status changed to ${data.to}`;
  }
  if (ev.kind === 'snoozed') {
    return zh ? '已设置延后提醒' : 'Snoozed item';
  }
  if (ev.kind === 'unsnoozed') {
    return zh ? '已取消延后提醒' : 'Unsnoozed item';
  }
  if (ev.kind === 'linked' && typeof data.ref === 'string') {
    return `${zh ? '关联' : 'Linked'}: ${data.ref}`;
  }
  if (typeof data.text === 'string' && data.text.trim()) {
    return data.text;
  }
  return ev.kind;
}

function resolveLinkHref(link: WorkItemLink): string | null {
  if (link.url) {
    return link.url;
  }
  if (link.kind === 'url' && link.ref) {
    return link.ref;
  }
  if (link.kind === 'pr' && link.ref) {
    return botItemPrUrl(link.ref);
  }
  return null;
}

export function BotItemDetailView({
  botId,
  itemUid,
  orderedUids,
  onSelectUid,
  onBack,
  onMutated,
}: BotItemDetailViewProps) {
  const { locale, tr } = useBotsLocale();
  const zh = locale === 'zh-CN';
  const now = useNow(60_000);
  const [item, setItem] = useState<WorkItemFull | null>(null);
  const [events, setEvents] = useState<WorkItemEvent[]>([]);
  const [links, setLinks] = useState<WorkItemLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const [customSnooze, setCustomSnooze] = useState('');
  const [selectedPicks, setSelectedPicks] = useState<Record<number, number[]>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await callBotRpc<{
        item?: WorkItemFull;
        events?: WorkItemEvent[];
        links?: WorkItemLink[];
      } & Partial<WorkItemFull>>(RPC_METHODS.ITEMS_OWNER_SHOW, {
        botId,
        uid: itemUid,
        id: itemUid,
      });
      const resolved = res?.item ?? (res?.uid || res?.id ? (res as WorkItemFull) : null);
      setItem(resolved);
      setEvents(Array.isArray(res?.events) ? res.events : (resolved?.events ?? []));
      setLinks(Array.isArray(res?.links) ? res.links : (resolved?.links ?? []));
      setSelectedPicks({});
      void callBotRpc(RPC_METHODS.ITEMS_OWNER_OPENED, { botId, uid: itemUid, id: itemUid }).catch((err) => {
        console.warn('[dsh-bots] items.owner.opened failed', err);
      });
    } catch (err) {
      botsStore.pushToast({
        message: err instanceof Error ? err.message : String(err),
        tone: 'error',
      });
    } finally {
      setLoading(false);
    }
  }, [botId, itemUid]);

  useEffect(() => {
    void load();
  }, [load]);

  const idx = orderedUids.indexOf(itemUid);
  const prevUid = idx > 0 ? orderedUids[idx - 1] : null;
  const nextUid = idx >= 0 && idx < orderedUids.length - 1 ? orderedUids[idx + 1] : null;

  const updateStatus = async (status: WorkItemFull['status']) => {
    try {
      await callBotRpc(RPC_METHODS.ITEMS_OWNER_STATUS, {
        botId,
        uid: itemUid,
        uids: [itemUid],
        status,
      });
      await load();
      onMutated();
    } catch (err) {
      botsStore.pushToast({ message: err instanceof Error ? err.message : String(err), tone: 'error' });
    }
  };

  const applySnooze = async (until: number | null) => {
    setSnoozeOpen(false);
    const othersLastEventId = events.filter((e) => e.actor?.kind !== 'owner').at(-1)?.id;
    try {
      await callBotRpc(RPC_METHODS.ITEMS_OWNER_SNOOZE, {
        botId,
        items: [{
          uid: itemUid,
          ...(othersLastEventId !== undefined ? { othersLastEventId } : {}),
        }],
        until,
      });
      await load();
      onMutated();
    } catch (err) {
      botsStore.pushToast({ message: err instanceof Error ? err.message : String(err), tone: 'error' });
    }
  };

  const latestAskEvent = [...events].reverse().find((ev) => Boolean(ev.data?.ask));
  const askData = item?.question?.data ?? (item?.question?.ask ? { ask: item.question.ask } : latestAskEvent?.data);
  const askShape: AskQuestionShape = askData
    ? (botItemQuestionShape(askData) as AskQuestionShape)
    : { body: '', decisions: [] };

  const toggleOption = (qIndex: number, optIndex: number, multi: boolean) => {
    setSelectedPicks((prev) => {
      const cur = prev[qIndex] ?? [];
      if (!multi) {
        return { ...prev, [qIndex]: [optIndex] };
      }
      const next = cur.includes(optIndex) ? cur.filter((x) => x !== optIndex) : [...cur, optIndex];
      return { ...prev, [qIndex]: next };
    });
  };

  const submitComment = async (textOverride?: string, decisionsPayload?: Array<{ picks: number[] }>) => {
    const body = (textOverride ?? comment).trim();
    if (!body || submitting) {
      return;
    }
    setSubmitting(true);
    try {
      await callBotRpc(RPC_METHODS.ITEMS_OWNER_COMMENT, {
        botId,
        uid: itemUid,
        text: body,
        requestId: makeRequestId(),
        ...(decisionsPayload ? { decisions: decisionsPayload } : {}),
      });
      if (!textOverride) {
        setComment('');
      }
      await load();
      onMutated();
    } catch (err) {
      botsStore.pushToast({ message: err instanceof Error ? err.message : String(err), tone: 'error' });
    } finally {
      setSubmitting(false);
    }
  };

  const submitAskDecisions = () => {
    const lines: string[] = [];
    const decisionsPayload: Array<{ picks: number[] }> = [];
    askShape.decisions.forEach((dec: AskDecisionItem, qIdx: number) => {
      const picks = selectedPicks[qIdx] ?? [];
      decisionsPayload.push({ picks });
      const labels = picks.map((i) => dec.replies[i]?.label).filter(Boolean).join(', ');
      if (labels) {
        lines.push(askShape.decisions.length > 1 ? `${dec.question} → ${labels}` : labels);
      }
    });
    const finalText = [lines.join('\n'), comment.trim()].filter(Boolean).join('\n');
    if (finalText) {
      void submitComment(finalText, decisionsPayload);
      setComment('');
    }
  };

  const snoozePresets = botItemSnoozePickerPresets(now);

  return (
    <div className="dsh-bots-panel-scroll">
      <div className="dsh-bots-row">
        <button type="button" className="dsh-bots-pbtn dsh-bots-pbtn-xs" onClick={onBack}>
          <IconChevronLeft size={12} />
          <span>{zh ? '返回列表' : 'Back'}</span>
        </button>
        <div style={{ display: 'inline-flex', gap: 4 }}>
          <button
            type="button"
            className="dsh-bots-pbtn dsh-bots-pbtn-xs dsh-bots-pbtn-icon"
            disabled={!prevUid}
            title={zh ? '上一条' : 'Previous item'}
            onClick={() => prevUid && onSelectUid(prevUid)}
          >
            <IconChevronLeft size={12} />
          </button>
          <button
            type="button"
            className="dsh-bots-pbtn dsh-bots-pbtn-xs dsh-bots-pbtn-icon"
            disabled={!nextUid}
            title={zh ? '下一条' : 'Next item'}
            onClick={() => nextUid && onSelectUid(nextUid)}
          >
            <IconChevronRight size={12} />
          </button>
        </div>
      </div>

      {loading && !item ? (
        <div className="dsh-bots-muted">{zh ? '加载中…' : 'Loading…'}</div>
      ) : !item ? (
        <div className="dsh-bots-empty">{zh ? '未找到该工作条目' : 'Item not found.'}</div>
      ) : (
        <>
          <div className="dsh-bots-pcard">
            <div className="dsh-bots-row">
              <span className="dsh-bots-muted" style={{ fontFamily: 'var(--ds-font-family-code)' }}>
                {item.number !== undefined ? formatBotItemNumber(item.number) : itemUid.slice(0, 8)}
              </span>
              {isBotItemSnoozed(item, now) && (
                <span className="dsh-bots-badge dsh-bots-badge-accent">
                  {tr('bots.items.snoozed', 'Snoozed')}
                </span>
              )}
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.4 }}>{item.title}</div>

            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 2 }}>
              <select
                className="dsh-bots-pselect"
                style={{ width: 'auto', height: 26, padding: '0 8px', fontSize: 11.5 }}
                value={item.status}
                onChange={(e) => void updateStatus(e.target.value as WorkItemFull['status'])}
              >
                {BOT_ITEM_STATUSES.map((st) => (
                  <option key={st} value={st}>{statusLabel(st, tr)}</option>
                ))}
              </select>

              <button
                type="button"
                className="dsh-bots-pbtn dsh-bots-pbtn-xs"
                onClick={() => void updateStatus('done')}
              >
                <IconCheck size={11} />
                <span>{tr('bots.items.status.done', 'Done')}</span>
              </button>

              <button
                type="button"
                className="dsh-bots-pbtn dsh-bots-pbtn-xs"
                onClick={() => void updateStatus('canceled')}
              >
                <IconX size={11} />
                <span>{tr('bots.items.status.canceled', 'Canceled')}</span>
              </button>

              <div className="dsh-bots-pmenu-wrap">
                <button
                  type="button"
                  className="dsh-bots-pbtn dsh-bots-pbtn-xs"
                  onClick={() => setSnoozeOpen((prev) => !prev)}
                >
                  <IconClock size={11} />
                  <span>{zh ? '延后' : 'Snooze'}</span>
                </button>
                {snoozeOpen && (
                  <div className="dsh-bots-pmenu" role="menu">
                    {snoozePresets.map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        className="dsh-bots-pmenu-item"
                        onClick={() => void applySnooze(preset.at)}
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
                        value={customSnooze}
                        onChange={(e) => setCustomSnooze(e.target.value)}
                      />
                      <button
                        type="button"
                        className="dsh-bots-pbtn dsh-bots-pbtn-xs dsh-bots-pbtn-primary"
                        disabled={!customSnooze}
                        onClick={() => {
                          const ts = Date.parse(customSnooze);
                          if (Number.isFinite(ts) && ts > Date.now()) {
                            void applySnooze(ts);
                          }
                        }}
                      >
                        {zh ? '应用自定义时间' : 'Set custom time'}
                      </button>
                    </div>
                    {item.snoozedUntil && (
                      <>
                        <div className="dsh-bots-pmenu-sep" />
                        <button
                          type="button"
                          className="dsh-bots-pmenu-item"
                          onClick={() => void applySnooze(null)}
                        >
                          {zh ? '取消延后' : 'Clear snooze'}
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {(item.description || item.summary) && (
            <div className="dsh-bots-psection">
              <span className="dsh-bots-section-title">{zh ? '描述' : 'Description'}</span>
              <div className="dsh-bots-pcard" style={{ whiteSpace: 'pre-wrap', lineHeight: 1.55 }}>
                {item.description || item.summary}
              </div>
            </div>
          )}

          {item.doneMeans && (
            <div className="dsh-bots-psection">
              <span className="dsh-bots-section-title">{tr('bots.items.doneMeans', 'Done means')}</span>
              <div className="dsh-bots-pcard" style={{ whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
                {item.doneMeans}
              </div>
            </div>
          )}

          {links.length > 0 && (
            <div className="dsh-bots-psection">
              <span className="dsh-bots-section-title">
                <IconLink size={12} />
                <span>{tr('bots.items.links', 'Links')}</span>
              </span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {links.map((link, i) => {
                  const href = resolveLinkHref(link);
                  const text = link.label || link.ref || link.url || 'Link';
                  return (
                    <div key={`${link.ref ?? link.url ?? i}`} className="dsh-bots-settings-row" style={{ padding: '6px 9px' }}>
                      <span className="dsh-bots-ellipsis" style={{ fontSize: 12 }}>{text}</span>
                      {href ? (
                        <a
                          href={href}
                          target="_blank"
                          rel="noreferrer"
                          className="dsh-bots-pbtn dsh-bots-pbtn-xs dsh-bots-pbtn-icon"
                          title={href}
                        >
                          <IconExternalLink size={12} />
                        </a>
                      ) : (
                        <span className="dsh-bots-badge">{link.kind || 'ref'}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {item.status === 'needs_you' && askShape.decisions.length > 0 && (
            <div className="dsh-bots-pcard dsh-bots-pcard-warn">
              <div style={{ fontWeight: 600, fontSize: 12.5 }}>{zh ? '需要你做出决定' : 'Decision needed'}</div>
              {askShape.body && <div style={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>{askShape.body}</div>}
              {askShape.decisions.map((dec: AskDecisionItem, qIdx: number) => (
                <div key={dec.question} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ fontWeight: 500, fontSize: 12 }}>{dec.question}</div>
                  {dec.replies.map((opt: AskReplyOption, optIdx: number) => {
                    const selected = (selectedPicks[qIdx] ?? []).includes(optIdx);
                    return (
                      <button
                        key={opt.label}
                        type="button"
                        className="dsh-bots-ask-option"
                        data-selected={selected ? 'true' : 'false'}
                        onClick={() => toggleOption(qIdx, optIdx, dec.multi)}
                      >
                        <input
                          type={dec.multi ? 'checkbox' : 'radio'}
                          readOnly
                          checked={selected}
                          style={{ marginTop: 2 }}
                        />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontWeight: 500 }}>{opt.label}</span>
                            {opt.recommended && (
                              <span className="dsh-bots-badge dsh-bots-badge-accent">
                                {tr('bots.items.recommended', 'Recommended')}
                              </span>
                            )}
                          </div>
                          {opt.detail && <div className="dsh-bots-muted">{opt.detail}</div>}
                        </div>
                      </button>
                    );
                  })}
                </div>
              ))}
              <button
                type="button"
                className="dsh-bots-pbtn dsh-bots-pbtn-xs dsh-bots-pbtn-primary"
                disabled={submitting}
                onClick={submitAskDecisions}
              >
                {zh ? '提交决定并恢复执行' : 'Submit answer & resume'}
              </button>
            </div>
          )}

          <div className="dsh-bots-psection">
            <span className="dsh-bots-section-title">{zh ? '动态时间线' : 'Activity timeline'}</span>
            {events.length === 0 ? (
              <div className="dsh-bots-muted">{zh ? '暂无动态记录' : 'No events yet.'}</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {events.map((ev) => (
                  <div key={ev.id} className="dsh-bots-timeline-entry">
                    <div className="dsh-bots-row">
                      <span style={{ fontWeight: 600, fontSize: 11.5 }}>
                        {ev.actor?.kind === 'owner' ? (zh ? '你' : 'You') : (ev.actor?.kind || 'Bot')}
                      </span>
                      <span className="dsh-bots-muted">{formatRelativeTime(ev.createdAt, now, locale)}</span>
                    </div>
                    <div style={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>{eventSummaryText(ev, zh)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="dsh-bots-psection">
            <textarea
              className="dsh-bots-ptextarea"
              rows={2}
              placeholder={zh ? '添加评论或回复机器人… (Ctrl+Enter 发送)' : 'Add a comment or reply…'}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                  e.preventDefault();
                  void submitComment();
                }
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="dsh-bots-pbtn dsh-bots-pbtn-xs dsh-bots-pbtn-primary"
                disabled={!comment.trim() || submitting}
                onClick={() => void submitComment()}
              >
                <IconSend size={11} />
                <span>{zh ? '发送回复' : 'Send comment'}</span>
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
