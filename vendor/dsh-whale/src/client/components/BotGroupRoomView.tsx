// Multi-Bot Group Room View mounted in Harness `main` keyed slot `'dsh-bots:group'`.
// Features group collage header, reply mode switcher (specific bot / all / mentions / coordinator plan-gate),
// member list & manage members, threads switcher, Coordinator Plan approval card (`awaiting_approval`),
// streaming/live per-bot bubbles with stop & quick '@BotName' reply, and bottom composer with
// @mention/@everyone autocomplete plus clipboard image paste & file upload.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type KeyboardEvent,
} from 'react';
import {
  BOT_GROUP_LIMITS,
  botGroupDraftAudience,
  botGroupMentionSegments,
  botGroupReplyDraft,
  formatBotGroupAudience,
} from '../../shared/bot-groups.js';
import {
  botsStore,
  formatRelativeTime,
  useBotsLocale,
  useBotsState,
  useGroupById,
  useNow,
} from '../store/bots-store';
import {
  RPC_METHODS,
  callBotRpc,
  type BotGroupRecord,
  type BotGroupReplyMode,
  type BotRecord,
} from '../store/rpc';
import { BotAvatar, BotGroupAvatar } from './BotAvatar';
import {
  IconCheck,
  IconMessageSquare,
  IconPlus,
  IconSend,
  IconShield,
  IconSpinner,
  IconStopSquare,
  IconUpload,
  IconUsers,
  IconX,
} from './Icons';

interface GroupTurnRecord {
  botId: string;
  botName?: string;
  operationId?: string;
  sessionId?: string;
  status?: 'queued' | 'running' | 'replying' | 'done' | 'stopped' | 'error' | 'awaiting_approval';
  reply?: string | null;
  error?: string | null;
}

interface GroupPlanStep {
  botId?: string;
  botName?: string;
  task?: string;
  summary?: string;
}

interface GroupPlanRecord {
  status?: 'awaiting_approval' | 'approved' | 'running' | 'completed' | 'rejected';
  coordinatorBotId?: string;
  summary?: string;
  steps?: GroupPlanStep[];
  depth?: number;
  maxConcurrency?: number;
}

interface GroupImageItem {
  id?: string;
  name: string;
  mimeType?: string;
  dataUrl?: string;
  path?: string;
  url?: string;
}

interface GroupMessageRecord {
  id: string;
  sequence?: number;
  threadId?: string;
  author?: { kind?: string; id?: string; name?: string };
  text: string;
  status?: string;
  planStatus?: string;
  plan?: GroupPlanRecord | null;
  images?: GroupImageItem[];
  turns?: GroupTurnRecord[];
  createdAt?: number;
}

type ReplyModeObj = BotGroupReplyMode;

function normalizeReplyMode(raw: unknown, fallbackBotId?: string): ReplyModeObj {
  if (raw && typeof raw === 'object' && 'kind' in raw) {
    const obj = raw as ReplyModeObj;
    if (obj.kind === 'all' || obj.kind === 'mentions') {
      return obj;
    }
    if (obj.kind === 'bot') {
      return { kind: 'bot', botId: obj.botId || fallbackBotId || '' };
    }
    if (obj.kind === 'coordinator') {
      return { kind: 'coordinator', coordinatorBotId: obj.coordinatorBotId || fallbackBotId || '' };
    }
  }
  if (raw === 'all') {
    return { kind: 'all' };
  }
  if (raw === 'bot' && fallbackBotId) {
    return { kind: 'bot', botId: fallbackBotId };
  }
  if (raw === 'coordinator') {
    return { kind: 'coordinator', coordinatorBotId: fallbackBotId || '' };
  }
  return { kind: 'mentions' };
}

function findMentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const match = /(?:^|[\s(])@([^\s@]*)$/u.exec(before);
  if (!match) {
    return null;
  }
  const query = match[1] ?? '';
  const start = caret - query.length - 1;
  return { start, query };
}

function readFileAsDataUrl(file: File): Promise<GroupImageItem> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve({
        id: `img-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        name: file.name || 'pasted-image.png',
        mimeType: file.type || 'image/png',
        dataUrl: typeof reader.result === 'string' ? reader.result : '',
      });
    };
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read image file'));
    reader.readAsDataURL(file);
  });
}

function isMessageAwaitingPlanApproval(msg: GroupMessageRecord): boolean {
  if (msg.plan?.status === 'awaiting_approval') return true;
  if (msg.planStatus === 'awaiting_approval' || msg.status === 'awaiting_approval') return true;
  return (msg.turns ?? []).some((t) => t.status === 'awaiting_approval');
}

export function BotGroupRoomView() {
  const { locale, tr } = useBotsLocale();
  const zh = locale === 'zh-CN';
  const now = useNow(60_000);
  const activeGroupId = useBotsState((state) => state.activeGroupId);
  const groups = useBotsState((state) => state.groups);
  const bots = useBotsState((state) => state.bots);
  const changeSeq = useBotsState((state) => state.changeSeq);
  const storeGroup = useGroupById(activeGroupId ?? groups[0]?.id ?? null);

  const [groupDetail, setGroupDetail] = useState<BotGroupRecord | null>(null);
  const [threadId, setThreadId] = useState<string>('');
  const [messages, setMessages] = useState<GroupMessageRecord[]>([]);
  const [draft, setDraft] = useState('');
  const [pendingImages, setPendingImages] = useState<GroupImageItem[]>([]);
  const [caret, setCaret] = useState(0);
  const [mentionIdx, setMentionIdx] = useState(0);
  const [sending, setSending] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [approvingMsgId, setApprovingMsgId] = useState<string | null>(null);
  const feedEndRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const group = groupDetail && groupDetail.id === storeGroup?.id ? groupDetail : storeGroup;

  const memberBots = useMemo<BotRecord[]>(() => {
    if (!group) {
      return [];
    }
    return (group.members ?? [])
      .map((m) => bots.find((b) => b.id === m.botId))
      .filter((b): b is BotRecord => Boolean(b));
  }, [bots, group]);

  const replyModeObj = useMemo(
    () => normalizeReplyMode(group?.replyMode, memberBots[0]?.id),
    [group?.replyMode, memberBots],
  );

  const loadMessages = useCallback(async () => {
    if (!storeGroup?.id) {
      return;
    }
    try {
      const res = await callBotRpc<{ group?: BotGroupRecord; messages?: GroupMessageRecord[] }>(
        RPC_METHODS.GROUPS_READ,
        { groupId: storeGroup.id, threadId: threadId || undefined, limit: 60 },
      );
      if (res?.group) {
        setGroupDetail(res.group);
      }
      setMessages(Array.isArray(res?.messages) ? res.messages : []);
    } catch (err) {
      console.warn('[dsh-bots] Failed to read group messages', err);
    }
  }, [storeGroup?.id, threadId]);

  useEffect(() => {
    setThreadId('');
  }, [storeGroup?.id]);

  useEffect(() => {
    void loadMessages();
  }, [loadMessages, changeSeq]);

  useEffect(() => {
    feedEndRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'end' });
  }, [messages.length]);

  const mentionMatch = useMemo(() => findMentionQuery(draft, caret), [draft, caret]);

  const mentionCandidates = useMemo(() => {
    if (!mentionMatch) {
      return [];
    }
    const q = mentionMatch.query.toLowerCase();
    const list: Array<{ id: string; label: string; insert: string; bot?: BotRecord }> = [];
    if ('everyone'.startsWith(q) || (zh && '所有人'.includes(q))) {
      list.push({ id: 'everyone', label: zh ? '@everyone（全部成员）' : '@everyone (all bots)', insert: '@everyone ' });
    }
    for (const bot of memberBots) {
      if (!q || bot.name.toLowerCase().includes(q)) {
        list.push({ id: bot.id, label: `@${bot.name}`, insert: `@${bot.name} `, bot });
      }
    }
    return list;
  }, [memberBots, mentionMatch, zh]);

  const applyMention = (candidate: { insert: string }) => {
    if (!mentionMatch) {
      return;
    }
    const nextText = `${draft.slice(0, mentionMatch.start)}${candidate.insert}${draft.slice(caret)}`;
    const nextCaret = mentionMatch.start + candidate.insert.length;
    setDraft(nextText);
    setCaret(nextCaret);
    setMentionIdx(0);
    window.requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(nextCaret, nextCaret);
    });
  };

  if (!group) {
    return (
      <div className="dsh-bots-group-room" style={{ justifyContent: 'center', alignItems: 'center', gap: 10 }}>
        <IconUsers size={28} style={{ opacity: 0.45 }} />
        <div className="dsh-bots-muted">
          {zh ? '选择一个鱼群协作开始多鱼群聊。' : 'Select a bot group to start chatting.'}
        </div>
        <button
          type="button"
          className="dsh-bots-pbtn dsh-bots-pbtn-primary"
          onClick={() => botsStore.openModal({ kind: 'group' })}
        >
          {tr('bots.groups.newGroup', 'New group')}
        </button>
      </div>
    );
  }

  const sharedGroup = {
    ...group,
    replyMode: replyModeObj.kind === 'coordinator'
      ? { kind: 'bot' as const, botId: replyModeObj.coordinatorBotId || memberBots[0]?.id || '' }
      : replyModeObj,
  };
  const draftAudience = botGroupDraftAudience(draft, sharedGroup, memberBots);
  const coordBotName = replyModeObj.kind === 'coordinator'
    ? (memberBots.find((b) => b.id === replyModeObj.coordinatorBotId)?.name ?? memberBots[0]?.name ?? '')
    : '';
  const audienceLabel = replyModeObj.kind === 'coordinator' && draftAudience !== 'invalid' && !draftAudience.addressed
    ? (zh ? `协调者：${coordBotName}（先出计划再审批）` : `Coordinator: ${coordBotName} (plan-gate)`)
    : formatBotGroupAudience(draftAudience, sharedGroup, memberBots, tr);

  const hasRunningTurns = messages.some((m) =>
    (m.turns ?? []).some((t) => t.status === 'queued' || t.status === 'running' || t.status === 'replying'),
  );

  const appendImageFiles = async (files: File[]) => {
    const imageFiles = files.filter((f) => f.type.startsWith('image/'));
    if (imageFiles.length === 0) return;
    const room = Math.max(0, BOT_GROUP_LIMITS.maxImages - pendingImages.length);
    if (room === 0) {
      botsStore.pushToast({
        message: zh ? `单条消息最多附加 ${BOT_GROUP_LIMITS.maxImages} 张图片` : `Max ${BOT_GROUP_LIMITS.maxImages} images`,
        tone: 'error',
      });
      return;
    }
    try {
      const loaded = await Promise.all(imageFiles.slice(0, room).map(readFileAsDataUrl));
      setPendingImages((prev) => [...prev, ...loaded.filter((img) => Boolean(img.dataUrl))]);
    } catch (err) {
      botsStore.pushToast({ message: err instanceof Error ? err.message : String(err), tone: 'error' });
    }
  };

  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const items = event.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
    if (files.length > 0) {
      event.preventDefault();
      void appendImageFiles(files);
    }
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const list = event.target.files ? Array.from(event.target.files) : [];
    if (list.length > 0) {
      void appendImageFiles(list);
    }
    event.target.value = '';
  };

  const handleUpdateReplyMode = async (next: ReplyModeObj) => {
    try {
      const updated = await callBotRpc<BotGroupRecord>(RPC_METHODS.GROUPS_UPDATE, {
        groupId: group.id,
        replyMode: next,
      });
      if (updated?.id) {
        setGroupDetail(updated);
      }
      void botsStore.refresh();
    } catch (err) {
      botsStore.pushToast({ message: err instanceof Error ? err.message : String(err), tone: 'error' });
    }
  };

  const handleSend = async () => {
    const text = draft.trim();
    if ((!text && pendingImages.length === 0) || sending || draftAudience === 'invalid') {
      return;
    }
    setSending(true);
    try {
      await callBotRpc(RPC_METHODS.GROUPS_SEND, {
        groupId: group.id,
        threadId: threadId || undefined,
        text,
        ...(pendingImages.length > 0
          ? {
            images: pendingImages.map((img) => ({
              name: img.name,
              mimeType: img.mimeType,
              dataUrl: img.dataUrl,
            })),
          }
          : {}),
      });
      setDraft('');
      setPendingImages([]);
      setCaret(0);
      await loadMessages();
    } catch (err) {
      botsStore.pushToast({ message: err instanceof Error ? err.message : String(err), tone: 'error' });
    } finally {
      setSending(false);
    }
  };

  const handleApprovePlan = async (messageId: string) => {
    if (approvingMsgId) return;
    setApprovingMsgId(messageId);
    try {
      await botsStore.approveGroupPlan(group.id, messageId, threadId || undefined);
      await loadMessages();
      botsStore.pushToast({ message: zh ? '已批准计划，开始分派执行' : 'Plan approved and dispatched', tone: 'success' });
    } catch (err) {
      botsStore.pushToast({ message: err instanceof Error ? err.message : String(err), tone: 'error' });
    } finally {
      setApprovingMsgId(null);
    }
  };

  const handleStop = async (botId?: string) => {
    setStopping(true);
    try {
      await callBotRpc(RPC_METHODS.GROUPS_STOP, {
        groupId: group.id,
        threadId: threadId || undefined,
        ...(botId ? { botId } : {}),
      });
      await loadMessages();
    } catch (err) {
      botsStore.pushToast({ message: err instanceof Error ? err.message : String(err), tone: 'error' });
    } finally {
      setStopping(false);
    }
  };

  const handleNewThread = async () => {
    const title = zh
      ? `话题 ${(group.threads?.length ?? 0) + 1}`
      : `Thread ${(group.threads?.length ?? 0) + 1}`;
    try {
      const res = await callBotRpc<{ group?: BotGroupRecord; thread?: { id: string } }>(
        RPC_METHODS.GROUPS_NEW_THREAD,
        { groupId: group.id, title },
      );
      if (res?.group) {
        setGroupDetail(res.group);
      }
      if (res?.thread?.id) {
        setThreadId(res.thread.id);
      }
    } catch (err) {
      botsStore.pushToast({ message: err instanceof Error ? err.message : String(err), tone: 'error' });
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionCandidates.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setMentionIdx((prev) => (prev + 1) % mentionCandidates.length);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setMentionIdx((prev) => (prev - 1 + mentionCandidates.length) % mentionCandidates.length);
        return;
      }
      if (event.key === 'Tab' || event.key === 'Enter') {
        event.preventDefault();
        applyMention(mentionCandidates[mentionIdx] ?? mentionCandidates[0]);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setCaret(0);
        return;
      }
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void handleSend();
    }
  };

  const memberNames = memberBots.map((b) => b.name);

  return (
    <div className="dsh-bots-group-room" data-dsh-bots-group-room={group.id}>
      <div className="dsh-bots-group-header">
        <div className="dsh-bots-row-left" style={{ gap: 10 }}>
          <BotGroupAvatar members={memberBots} size={36} unread={group.unread} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 600 }}>{group.name}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 2 }}>
              {memberBots.map((m) => (
                <span key={m.id} className="dsh-bots-muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <BotAvatar botId={m.id} avatar={m.avatar} avatarColor={m.avatarColor} name={m.name} size={14} radius={4} />
                  <span>{m.name}</span>
                </span>
              ))}
            </div>
          </div>
        </div>

        <div style={{ display: 'inline-flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
          <select
            className="dsh-bots-pselect"
            style={{ width: 'auto', height: 28, padding: '0 8px' }}
            aria-label={zh ? '群回复模式' : 'Group reply mode'}
            value={replyModeObj.kind}
            onChange={(e) => {
              const kind = e.target.value;
              if (kind === 'all') {
                void handleUpdateReplyMode({ kind: 'all' });
              } else if (kind === 'bot' && memberBots[0]) {
                void handleUpdateReplyMode({ kind: 'bot', botId: memberBots[0].id });
              } else if (kind === 'coordinator' && memberBots[0]) {
                void handleUpdateReplyMode({ kind: 'coordinator', coordinatorBotId: memberBots[0].id });
              } else {
                void handleUpdateReplyMode({ kind: 'mentions' });
              }
            }}
          >
            <option value="bot">{zh ? '回复模式：指定队友' : 'Replies: Specific bot'}</option>
            <option value="all">{zh ? '回复模式：全部回复' : 'Replies: All bots'}</option>
            <option value="mentions">{zh ? '回复模式：仅 @提及' : 'Replies: Only @mentions'}</option>
            <option value="coordinator">{zh ? '回复模式：协调者计划审批' : 'Replies: Coordinator plan-gate'}</option>
          </select>

          {replyModeObj.kind === 'bot' && (
            <select
              className="dsh-bots-pselect"
              style={{ width: 'auto', height: 28, padding: '0 8px' }}
              value={replyModeObj.botId}
              onChange={(e) => void handleUpdateReplyMode({ kind: 'bot', botId: e.target.value })}
            >
              {memberBots.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          )}

          {replyModeObj.kind === 'coordinator' && (
            <select
              className="dsh-bots-pselect"
              style={{ width: 'auto', height: 28, padding: '0 8px' }}
              aria-label={zh ? '协调者队友' : 'Coordinator bot'}
              value={replyModeObj.coordinatorBotId ?? memberBots[0]?.id ?? ''}
              onChange={(e) => void handleUpdateReplyMode({ kind: 'coordinator', coordinatorBotId: e.target.value })}
            >
              {memberBots.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          )}

          <button
            type="button"
            className="dsh-bots-pbtn"
            onClick={() => botsStore.openModal({ kind: 'group', groupId: group.id })}
          >
            <IconUsers size={13} />
            <span>{tr('bots.groups.manageMembers', 'Manage members…')}</span>
          </button>

          {hasRunningTurns && (
            <button
              type="button"
              className="dsh-bots-pbtn dsh-bots-pbtn-danger"
              disabled={stopping}
              onClick={() => void handleStop()}
            >
              <IconStopSquare size={11} />
              <span>{zh ? '停止' : 'Stop'}</span>
            </button>
          )}
        </div>
      </div>

      <div className="dsh-bots-group-threads">
        <button
          type="button"
          className="dsh-bots-chip"
          data-active={threadId === '' ? 'true' : 'false'}
          onClick={() => setThreadId('')}
        >
          <IconMessageSquare size={11} />
          <span>{zh ? '主房间' : 'Main room'}</span>
        </button>
        {(group.threads ?? []).filter((th) => typeof th?.id === 'string' && th.id.trim() !== '').map((th) => (
          <button
            key={th.id}
            type="button"
            className="dsh-bots-chip"
            data-active={threadId === th.id ? 'true' : 'false'}
            onClick={() => setThreadId(th.id)}
          >
            <span>{th.title || th.id.slice(0, 8)}</span>
          </button>
        ))}
        <button type="button" className="dsh-bots-pbtn dsh-bots-pbtn-xs" onClick={() => void handleNewThread()}>
          <IconPlus size={11} />
          <span>{zh ? '新建话题' : 'New thread'}</span>
        </button>
      </div>

      <div className="dsh-bots-group-feed">
        {messages.length === 0 ? (
          <div className="dsh-bots-empty" style={{ maxWidth: 460, margin: '40px auto' }}>
            {zh
              ? '输入消息开始多鱼协作，输入 @ 可精准呼叫指定大肥鱼队友或 @everyone，支持直接粘贴或上传图片。'
              : 'Send a message to start collaborating. Type @ to mention a bot or paste/upload images.'}
          </div>
        ) : (
          messages.map((msg) => {
            const awaitingPlan = isMessageAwaitingPlanApproval(msg);
            const planSteps = msg.plan?.steps ?? [];
            return (
              <div key={msg.id} className="dsh-bots-group-msg">
                <div className="dsh-bots-group-user-bubble">
                  {msg.text && botGroupMentionSegments(msg.text, memberNames, true).map((seg, i) => (
                    seg.mention
                      ? <span key={i} className="dsh-bots-group-mention">{seg.text}</span>
                      : <span key={i}>{seg.text}</span>
                  ))}
                  {(msg.images?.length ?? 0) > 0 && (
                    <div className="dsh-bots-group-msg-images">
                      {(msg.images ?? []).map((img, idx) => (
                        <div key={`${msg.id}-img-${idx}`} className="dsh-bots-group-img-chip">
                          {(img.dataUrl || img.url) ? (
                            <img src={img.dataUrl || img.url} alt={img.name} className="dsh-bots-group-img-thumb" />
                          ) : (
                            <span className="dsh-bots-badge">{img.name}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="dsh-bots-muted" style={{ textAlign: 'right', marginTop: 4, fontSize: 10.5 }}>
                    {formatRelativeTime(msg.createdAt, now, locale)}
                  </div>
                </div>

                {/* Coordinator Plan-Gate Approval Card */}
                {awaitingPlan && (
                  <div className="dsh-bots-pcard dsh-bots-pcard-warn" data-dsh-bots-plan-card={msg.id}>
                    <div className="dsh-bots-row">
                      <span className="dsh-bots-row-left" style={{ fontWeight: 600 }}>
                        <IconShield size={13} />
                        <span>{zh ? '协调者执行计划 · 待你批准' : 'Coordinator plan · Awaiting approval'}</span>
                      </span>
                      <span className="dsh-bots-badge dsh-bots-badge-warn">awaiting_approval</span>
                    </div>
                    {msg.plan?.summary && (
                      <div style={{ fontSize: 13, lineHeight: '20px', whiteSpace: 'pre-wrap' }}>
                        {msg.plan.summary}
                      </div>
                    )}
                    {planSteps.length > 0 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {planSteps.map((step, sIdx) => (
                          <div key={`step-${sIdx}`} className="dsh-bots-timeline-entry">
                            <div className="dsh-bots-row">
                              <span style={{ fontWeight: 600, fontSize: 12 }}>
                                {step.botName || step.botId || `${zh ? '步骤' : 'Step'} ${sIdx + 1}`}
                              </span>
                            </div>
                            <div className="dsh-bots-muted">{step.task || step.summary || ''}</div>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="dsh-bots-row">
                      <span className="dsh-bots-muted">
                        {zh ? '批准后按并发 ≤3、深度 ≤6 与防环规则分派执行。' : 'Dispatches with max concurrency 3 and loop guards upon approval.'}
                      </span>
                      <button
                        type="button"
                        className="dsh-bots-pbtn dsh-bots-pbtn-primary"
                        data-dsh-bots-approve-plan={msg.id}
                        disabled={approvingMsgId === msg.id}
                        onClick={() => void handleApprovePlan(msg.id)}
                      >
                        <IconCheck size={12} />
                        <span>
                          {approvingMsgId === msg.id
                            ? (zh ? '批准中…' : 'Approving…')
                            : (zh ? '批准并执行计划' : 'Approve & run plan')}
                        </span>
                      </button>
                    </div>
                  </div>
                )}

                {(msg.turns ?? []).map((turn, tIdx) => {
                  const bot = bots.find((b) => b.id === turn.botId);
                  const live = turn.status === 'queued' || turn.status === 'running' || turn.status === 'replying';
                  return (
                    <div key={`${msg.id}-${turn.botId}-${tIdx}`} className="dsh-bots-group-bot-bubble">
                      <div className="dsh-bots-row">
                        <div className="dsh-bots-row-left">
                          <BotAvatar
                            botId={turn.botId}
                            avatar={bot?.avatar}
                            avatarColor={bot?.avatarColor}
                            name={bot?.name ?? turn.botName ?? turn.botId}
                            size={22}
                            radius={6}
                          />
                          <span style={{ fontWeight: 600, fontSize: 12.5 }}>
                            {bot?.name ?? turn.botName ?? turn.botId}
                          </span>
                          {live && (
                            <span className="dsh-bots-badge dsh-bots-badge-accent">
                              <IconSpinner size={10} /> {zh ? '回复中…' : 'Replying…'}
                            </span>
                          )}
                          {turn.status === 'awaiting_approval' && (
                            <span className="dsh-bots-badge dsh-bots-badge-warn">
                              {zh ? '待批准计划' : 'Awaiting approval'}
                            </span>
                          )}
                          {turn.error && <span className="dsh-bots-badge dsh-bots-badge-danger">{zh ? '错误' : 'Error'}</span>}
                        </div>
                        <div style={{ display: 'inline-flex', gap: 4 }}>
                          {live && (
                            <button
                              type="button"
                              className="dsh-bots-pbtn dsh-bots-pbtn-xs dsh-bots-pbtn-danger"
                              onClick={() => void handleStop(turn.botId)}
                            >
                              <IconStopSquare size={10} />
                              <span>{zh ? '停止' : 'Stop'}</span>
                            </button>
                          )}
                          {bot && (
                            <button
                              type="button"
                              className="dsh-bots-pbtn dsh-bots-pbtn-xs"
                              onClick={() => {
                                setDraft((prev) => botGroupReplyDraft(bot.id, prev, sharedGroup, memberBots));
                                textareaRef.current?.focus();
                              }}
                            >
                              {zh ? `回复 @${bot.name}` : `Reply @${bot.name}`}
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="dsh-bots-group-bot-body">
                        {turn.error
                          ? <span className="dsh-bots-error-text">{turn.error}</span>
                          : (turn.reply || (live ? (zh ? '正在思考并组织回复…' : 'Thinking…') : (zh ? '（无回复）' : '(No reply)')))}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })
        )}
        <div ref={feedEndRef} />
      </div>

      <div className="dsh-bots-group-composer-wrap">
        {mentionCandidates.length > 0 && (
          <div className="dsh-bots-mention-popup" role="listbox">
            {mentionCandidates.map((cand, idx) => (
              <button
                key={cand.id}
                type="button"
                role="option"
                aria-selected={idx === mentionIdx}
                className="dsh-bots-pmenu-item"
                onMouseDown={(e) => {
                  e.preventDefault();
                  applyMention(cand);
                }}
              >
                {cand.bot ? (
                  <BotAvatar
                    botId={cand.bot.id}
                    avatar={cand.bot.avatar}
                    avatarColor={cand.bot.avatarColor}
                    name={cand.bot.name}
                    size={18}
                    radius={5}
                  />
                ) : (
                  <IconUsers size={14} />
                )}
                <span>{cand.label}</span>
              </button>
            ))}
          </div>
        )}

        <div className="dsh-bots-group-composer">
          {pendingImages.length > 0 && (
            <div className="dsh-bots-group-attachments" data-dsh-bots-group-attachments="">
              {pendingImages.map((img, idx) => (
                <div key={img.id ?? idx} className="dsh-bots-group-attach-item">
                  {img.dataUrl && (
                    <img src={img.dataUrl} alt={img.name} className="dsh-bots-group-img-thumb" />
                  )}
                  <button
                    type="button"
                    className="dsh-bots-group-attach-remove"
                    aria-label={zh ? `移除 ${img.name}` : `Remove ${img.name}`}
                    onClick={() => setPendingImages((prev) => prev.filter((_, i) => i !== idx))}
                  >
                    <IconX size={10} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <textarea
            ref={textareaRef}
            className="dsh-bots-group-composer-input"
            rows={2}
            placeholder={zh ? '发消息给鱼群成员… 输入 @ 提及大肥鱼队友，支持 Ctrl+V 粘贴图片' : 'Message the group… Type @ to mention or paste images'}
            value={draft}
            onPaste={handlePaste}
            onChange={(e) => {
              setDraft(e.target.value);
              setCaret(e.target.selectionStart ?? e.target.value.length);
              setMentionIdx(0);
            }}
            onClick={(e) => setCaret(e.currentTarget.selectionStart ?? draft.length)}
            onKeyUp={(e) => setCaret(e.currentTarget.selectionStart ?? draft.length)}
            onKeyDown={handleKeyDown}
          />
          <div className="dsh-bots-row">
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                style={{ display: 'none' }}
                data-dsh-bots-group-image-input=""
                onChange={handleFileChange}
              />
              <button
                type="button"
                className="dsh-bots-pbtn dsh-bots-pbtn-xs dsh-bots-pbtn-icon"
                title={zh ? '上传图片' : 'Upload image'}
                aria-label={zh ? '上传图片' : 'Upload image'}
                onClick={() => fileInputRef.current?.click()}
              >
                <IconUpload size={13} />
              </button>
              <span className={`dsh-bots-badge ${draftAudience === 'invalid' ? 'dsh-bots-badge-danger' : ''}`}>
                {zh ? '响应对象：' : 'Replies: '}
                {audienceLabel}
              </span>
            </div>
            <button
              type="button"
              className="dsh-bots-group-send-btn"
              aria-label={sending ? (zh ? '发送中…' : 'Sending…') : (zh ? '发送' : 'Send')}
              title={sending ? (zh ? '发送中…' : 'Sending…') : (zh ? '发送' : 'Send')}
              disabled={(!draft.trim() && pendingImages.length === 0) || sending || draftAudience === 'invalid'}
              onClick={() => void handleSend()}
            >
              {sending ? <IconSpinner size={15} /> : <IconSend size={15} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
