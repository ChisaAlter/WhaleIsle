// Multi-Bot Group Room View mounted in Harness `main` keyed slot `'dsh-bots:group'`.
// Features group collage header, reply mode switcher (specific bot / all / mentions only),
// member list & manage members, threads switcher, streaming/live per-bot bubbles with stop &
// quick '@BotName' reply, and bottom composer with @mention/@everyone autocomplete.

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
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
  type BotRecord,
} from '../store/rpc';
import { BotAvatar, BotGroupAvatar } from './BotAvatar';
import {
  IconMessageSquare,
  IconPlus,
  IconSend,
  IconSpinner,
  IconStopSquare,
  IconUsers,
} from './Icons';

interface GroupTurnRecord {
  botId: string;
  botName?: string;
  operationId?: string;
  sessionId?: string;
  status?: 'queued' | 'running' | 'replying' | 'done' | 'stopped' | 'error';
  reply?: string | null;
  error?: string | null;
}

interface GroupMessageRecord {
  id: string;
  sequence?: number;
  threadId?: string;
  author?: { kind?: string; id?: string; name?: string };
  text: string;
  turns?: GroupTurnRecord[];
  createdAt?: number;
}

type ReplyModeObj =
  | { kind: 'all' }
  | { kind: 'mentions' }
  | { kind: 'bot'; botId: string };

function normalizeReplyMode(raw: unknown, fallbackBotId?: string): ReplyModeObj {
  if (raw && typeof raw === 'object' && 'kind' in raw) {
    const obj = raw as ReplyModeObj;
    if (obj.kind === 'all' || obj.kind === 'mentions') {
      return obj;
    }
    if (obj.kind === 'bot') {
      return { kind: 'bot', botId: obj.botId || fallbackBotId || '' };
    }
  }
  if (raw === 'all') {
    return { kind: 'all' };
  }
  if (raw === 'bot' && fallbackBotId) {
    return { kind: 'bot', botId: fallbackBotId };
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
  const [caret, setCaret] = useState(0);
  const [mentionIdx, setMentionIdx] = useState(0);
  const [sending, setSending] = useState(false);
  const [stopping, setStopping] = useState(false);
  const feedEndRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

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
    feedEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
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

  const sharedGroup = { ...group, replyMode: replyModeObj };
  const draftAudience = botGroupDraftAudience(draft, sharedGroup, memberBots);
  const audienceLabel = formatBotGroupAudience(draftAudience, sharedGroup, memberBots, tr);
  const hasRunningTurns = messages.some((m) =>
    (m.turns ?? []).some((t) => t.status === 'queued' || t.status === 'running' || t.status === 'replying'),
  );

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
    if (!text || sending || draftAudience === 'invalid') {
      return;
    }
    setSending(true);
    try {
      await callBotRpc(RPC_METHODS.GROUPS_SEND, {
        groupId: group.id,
        threadId: threadId || undefined,
        text,
      });
      setDraft('');
      setCaret(0);
      await loadMessages();
    } catch (err) {
      botsStore.pushToast({ message: err instanceof Error ? err.message : String(err), tone: 'error' });
    } finally {
      setSending(false);
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
              } else {
                void handleUpdateReplyMode({ kind: 'mentions' });
              }
            }}
          >
            <option value="bot">{zh ? '回复模式：指定队友' : 'Replies: Specific bot'}</option>
            <option value="all">{zh ? '回复模式：全部回复' : 'Replies: All bots'}</option>
            <option value="mentions">{zh ? '回复模式：仅 @提及' : 'Replies: Only @mentions'}</option>
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
              ? '输入消息开始多鱼协作，输入 @ 可精准呼叫指定大肥鱼队友或 @everyone。'
              : 'Send a message to start collaborating. Type @ to mention a bot or @everyone.'}
          </div>
        ) : (
          messages.map((msg) => (
            <div key={msg.id} className="dsh-bots-group-msg">
              <div className="dsh-bots-group-user-bubble">
                {botGroupMentionSegments(msg.text, memberNames, true).map((seg, i) => (
                  seg.mention
                    ? <span key={i} className="dsh-bots-group-mention">{seg.text}</span>
                    : <span key={i}>{seg.text}</span>
                ))}
                <div className="dsh-bots-muted" style={{ textAlign: 'right', marginTop: 4, fontSize: 10.5 }}>
                  {formatRelativeTime(msg.createdAt, now, locale)}
                </div>
              </div>

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
          ))
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
          <textarea
            ref={textareaRef}
            className="dsh-bots-group-composer-input"
            rows={2}
            placeholder={zh ? '发消息给鱼群成员… 输入 @ 提及大肥鱼队友，Enter 发送，Shift+Enter 换行' : 'Message the group… Type @ to mention, Enter to send'}
            value={draft}
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
            <span className={`dsh-bots-badge ${draftAudience === 'invalid' ? 'dsh-bots-badge-danger' : ''}`}>
              {zh ? '响应对象：' : 'Replies: '}
              {audienceLabel}
            </span>
            <button
              type="button"
              className="dsh-bots-group-send-btn"
              aria-label={sending ? (zh ? '发送中…' : 'Sending…') : (zh ? '发送' : 'Send')}
              title={sending ? (zh ? '发送中…' : 'Sending…') : (zh ? '发送' : 'Send')}
              disabled={!draft.trim() || sending || draftAudience === 'invalid'}
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
