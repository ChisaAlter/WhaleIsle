// Multi-Bot Group Room View mounted in Harness `main` keyed slot `'dsh-bots:group'`.
// Multi-Bot Group Room View mounted in Harness `main` keyed slot `'dsh-bots:group'`.
// Features group collage header, threads switcher, Coordinator Plan approval card (`awaiting_approval`),
// safe lightweight Markdown rendering inside member bubbles, collapsible thinking/tool step summaries,
// live elapsed timing & granular turn states, centered `@Name` peer handoff divider lines,
// earlier-message pagination, floating jump-to-latest button, instant stop feedback,
// clipboard image paste & file upload, and bottom-left BotGroupReplyPicker (including coordinator plan-gate).

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type KeyboardEvent,
  type ReactNode,
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
  type BotRecord,
} from '../store/rpc';
import { BotAvatar, BotGroupAvatar } from './BotAvatar';
import { BotChevron, BotDisclosure } from './BotDisclosure';
import {
  BotGroupReplyPicker,
  type BotGroupReplyModeValue,
} from './BotGroupReplyPicker';
import {
  IconBrain,
  IconCheck,
  IconChevronDown,
  IconClock,
  IconCopy,
  IconMessageSquare,
  IconPlus,
  IconSend,
  IconShield,
  IconSpinner,
  IconStopSquare,
  IconUpload,
  IconUsers,
  IconWrench,
  IconX,
} from './Icons';

interface GroupTurnStep {
  id?: string;
  kind?: string;
  title?: string;
  name?: string;
  detail?: string;
  summary?: string;
  status?: string;
  durationMs?: number;
}

interface GroupHandoffMeta {
  kind?: 'asked' | 'replied' | 'stopped' | 'paused' | string;
  fromBotId?: string;
  fromBotName?: string;
  toBotId?: string;
  toBotName?: string;
  count?: number;
  reason?: string;
  label?: string;
}

interface GroupTurnRecord {
  botId: string;
  botName?: string;
  operationId?: string;
  sessionId?: string;
  status?: 'queued' | 'running' | 'thinking' | 'replying' | 'streaming' | 'done' | 'quiet' | 'stopped' | 'removed' | 'error' | 'awaiting_approval';
  reply?: string | null;
  error?: string | null;
  revoked?: boolean;
  startedAt?: number;
  finishedAt?: number;
  thinking?: string | null;
  reasoning?: string | null;
  steps?: GroupTurnStep[];
  toolCalls?: GroupTurnStep[];
  handoff?: GroupHandoffMeta | null;
  handoffKind?: 'asked' | 'replied' | 'stopped' | 'paused' | string;
  requestedBy?: { botId?: string; botName?: string; name?: string } | null;
  triggeredByBotId?: string;
  triggeredByBotName?: string;
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
  kind?: 'message' | 'handoff' | 'peer_request' | 'handoff_stopped' | 'system' | string;
  author?: { kind?: string; id?: string; name?: string };
  authorName?: string;
  text: string;
  status?: string;
  planStatus?: string;
  plan?: GroupPlanRecord | null;
  images?: GroupImageItem[];
  turns?: GroupTurnRecord[];
  handoff?: GroupHandoffMeta | null;
  handoffStopped?: boolean | { count?: number; reason?: string };
  handoffPaused?: boolean | { count?: number; reason?: string };
  createdAt?: number;
}

const PAGE_LIMIT = 40;
const NEAR_BOTTOM_PX = 88;

function normalizeReplyMode(raw: unknown, fallbackBotId?: string): BotGroupReplyModeValue {
  if (raw && typeof raw === 'object' && 'kind' in raw) {
    const obj = raw as BotGroupReplyModeValue;
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

function isTurnLive(turn: GroupTurnRecord): boolean {
  return (
    turn.status === 'queued'
    || turn.status === 'running'
    || turn.status === 'thinking'
    || turn.status === 'replying'
    || turn.status === 'streaming'
  );
}

function formatElapsedDuration(ms: number): string {
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

function isSafeLinkUrl(raw: string): boolean {
  try {
    const parsed = new URL(raw, 'https://invalid.local');
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'mailto:';
  } catch {
    return false;
  }
}

// ---- Lightweight Safe Markdown Renderer (Pure React nodes, zero dangerouslySetInnerHTML) ----

function renderTextWithMentions(text: string, memberNames: string[], keyPrefix: string): ReactNode {
  if (!text.includes('@')) {
    return text;
  }
  const segs = botGroupMentionSegments(text, memberNames, true) as Array<{ text: string; mention: boolean }>;
  return segs.map((seg, idx) => (
    seg.mention
      ? <span key={`${keyPrefix}-m-${idx}`} className="dsh-bots-group-mention">{seg.text}</span>
      : <Fragment key={`${keyPrefix}-t-${idx}`}>{seg.text}</Fragment>
  ));
}

const INLINE_TOKEN_RE = /(`[^`\n]+`)|(\[([^\]\n]+)\]\(([^)\s]+)\))|(\*\*([^*\n]+)\*\*|__([^_\n]+)__)|(~~([^~\n]+)~~)|(\*([^*\n]+)\*)/gu;

function renderInlineMarkdown(text: string, memberNames: string[], keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let tokenIdx = 0;
  for (const match of text.matchAll(INLINE_TOKEN_RE)) {
    const start = match.index ?? 0;
    if (start > cursor) {
      nodes.push(
        <Fragment key={`${keyPrefix}-p-${tokenIdx++}`}>
          {renderTextWithMentions(text.slice(cursor, start), memberNames, `${keyPrefix}-pm-${tokenIdx}`)}
        </Fragment>,
      );
    }
    const [full, inlineCode, , linkLabel, linkHref, , boldStar, boldUnder, , strike, , italic] = match;
    const k = `${keyPrefix}-i-${tokenIdx++}`;
    if (inlineCode) {
      nodes.push(<code key={k} className="dsh-bots-md-inline-code">{inlineCode.slice(1, -1)}</code>);
    } else if (linkLabel && linkHref) {
      if (isSafeLinkUrl(linkHref)) {
        nodes.push(
          <a key={k} href={linkHref} target="_blank" rel="noopener noreferrer" className="dsh-bots-md-link">
            {linkLabel}
          </a>,
        );
      } else {
        nodes.push(<Fragment key={k}>{linkLabel}</Fragment>);
      }
    } else if (boldStar || boldUnder) {
      nodes.push(
        <strong key={k}>
          {renderTextWithMentions(boldStar || boldUnder, memberNames, `${k}-b`)}
        </strong>,
      );
    } else if (strike) {
      nodes.push(<del key={k}>{strike}</del>);
    } else if (italic) {
      nodes.push(<em key={k}>{italic}</em>);
    } else {
      nodes.push(<Fragment key={k}>{full}</Fragment>);
    }
    cursor = start + full.length;
  }
  if (cursor < text.length) {
    nodes.push(
      <Fragment key={`${keyPrefix}-tail`}>
        {renderTextWithMentions(text.slice(cursor), memberNames, `${keyPrefix}-tm`)}
      </Fragment>,
    );
  }
  return nodes;
}

function CodeBlockView({ lang, code, zh }: { lang: string; code: string; zh: boolean }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const ok = await botsStore.copyToClipboard(code);
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    }
  };

  return (
    <div className="dsh-bots-md-codeblock">
      <div className="dsh-bots-md-codeblock-head">
        <span>{lang || (zh ? '代码' : 'code')}</span>
        <button
          type="button"
          className="dsh-bots-pbtn dsh-bots-pbtn-xs dsh-bots-pbtn-ghost"
          style={{ height: 20, padding: '0 6px', fontSize: 11 }}
          onClick={() => void handleCopy()}
        >
          {copied ? <IconCheck size={11} /> : <IconCopy size={11} />}
          <span>{copied ? (zh ? '已复制' : 'Copied') : (zh ? '复制' : 'Copy')}</span>
        </button>
      </div>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
}

function SafeMarkdown({ text, memberNames, zh }: { text: string; memberNames: string[]; zh: boolean }) {
  const blocks = useMemo(() => {
    const src = String(text ?? '').replace(/\r\n/g, '\n');
    const lines = src.split('\n');
    const out: Array<
      | { kind: 'code'; lang: string; content: string }
      | { kind: 'heading'; level: number; content: string }
      | { kind: 'quote'; lines: string[] }
      | { kind: 'ul'; items: string[] }
      | { kind: 'ol'; items: string[] }
      | { kind: 'hr' }
      | { kind: 'p'; lines: string[] }
    > = [];

    let i = 0;
    while (i < lines.length) {
      const line = lines[i];

      // Fenced code block
      const fenceMatch = /^```([^\s`]*)\s*$/.exec(line.trim());
      if (fenceMatch) {
        const lang = fenceMatch[1] ?? '';
        const buf: string[] = [];
        i += 1;
        while (i < lines.length && !/^```\s*$/.test(lines[i].trim())) {
          buf.push(lines[i]);
          i += 1;
        }
        if (i < lines.length) i += 1;
        out.push({ kind: 'code', lang, content: buf.join('\n') });
        continue;
      }

      if (line.trim() === '') {
        i += 1;
        continue;
      }

      if (/^(?:---|\*\*\*|___)\s*$/.test(line.trim())) {
        out.push({ kind: 'hr' });
        i += 1;
        continue;
      }

      const headingMatch = /^(#{1,4})\s+(.+)$/.exec(line.trim());
      if (headingMatch) {
        out.push({ kind: 'heading', level: headingMatch[1].length, content: headingMatch[2] });
        i += 1;
        continue;
      }

      if (/^\s*>\s?/.test(line)) {
        const qLines: string[] = [];
        while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
          qLines.push(lines[i].replace(/^\s*>\s?/, ''));
          i += 1;
        }
        out.push({ kind: 'quote', lines: qLines });
        continue;
      }

      if (/^\s*[-*•]\s+/.test(line)) {
        const items: string[] = [];
        while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i])) {
          items.push(lines[i].replace(/^\s*[-*•]\s+/, ''));
          i += 1;
        }
        out.push({ kind: 'ul', items });
        continue;
      }

      if (/^\s*\d+[.)]\s+/.test(line)) {
        const items: string[] = [];
        while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
          items.push(lines[i].replace(/^\s*\d+[.)]\s+/, ''));
          i += 1;
        }
        out.push({ kind: 'ol', items });
        continue;
      }

      const pLines: string[] = [];
      while (
        i < lines.length
        && lines[i].trim() !== ''
        && !/^```/.test(lines[i].trim())
        && !/^(#{1,4})\s+/.test(lines[i].trim())
        && !/^\s*>\s?/.test(lines[i])
        && !/^\s*[-*•]\s+/.test(lines[i])
        && !/^\s*\d+[.)]\s+/.test(lines[i])
        && !/^(?:---|\*\*\*|___)\s*$/.test(lines[i].trim())
      ) {
        pLines.push(lines[i]);
        i += 1;
      }
      if (pLines.length > 0) {
        out.push({ kind: 'p', lines: pLines });
      }
    }
    return out;
  }, [text]);

  return (
    <div className="dsh-bots-md">
      {blocks.map((block, idx) => {
        const key = `md-${idx}`;
        if (block.kind === 'code') {
          return <CodeBlockView key={key} lang={block.lang} code={block.content} zh={zh} />;
        }
        if (block.kind === 'hr') {
          return <hr key={key} />;
        }
        if (block.kind === 'heading') {
          const inner = renderInlineMarkdown(block.content, memberNames, key);
          if (block.level === 1) return <h1 key={key}>{inner}</h1>;
          if (block.level === 2) return <h2 key={key}>{inner}</h2>;
          if (block.level === 3) return <h3 key={key}>{inner}</h3>;
          return <h4 key={key}>{inner}</h4>;
        }
        if (block.kind === 'quote') {
          return (
            <blockquote key={key}>
              {block.lines.map((l, li) => (
                <div key={`${key}-q-${li}`}>{renderInlineMarkdown(l, memberNames, `${key}-q-${li}`)}</div>
              ))}
            </blockquote>
          );
        }
        if (block.kind === 'ul') {
          return (
            <ul key={key}>
              {block.items.map((item, ii) => (
                <li key={`${key}-ul-${ii}`}>{renderInlineMarkdown(item, memberNames, `${key}-ul-${ii}`)}</li>
              ))}
            </ul>
          );
        }
        if (block.kind === 'ol') {
          return (
            <ol key={key}>
              {block.items.map((item, ii) => (
                <li key={`${key}-ol-${ii}`}>{renderInlineMarkdown(item, memberNames, `${key}-ol-${ii}`)}</li>
              ))}
            </ol>
          );
        }
        return (
          <p key={key}>
            {block.lines.map((l, li) => (
              <Fragment key={`${key}-p-${li}`}>
                {li > 0 && <br />}
                {renderInlineMarkdown(l, memberNames, `${key}-p-${li}`)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}

// ---- Collapsible Tool / Thinking Steps Disclosure ----

function TurnStepsDisclosure({ turn, zh }: { turn: GroupTurnRecord; zh: boolean }) {
  const [open, setOpen] = useState(false);

  const steps = useMemo<GroupTurnStep[]>(() => {
    const list: GroupTurnStep[] = [];
    const thought = (turn.thinking || turn.reasoning || '').trim();
    if (thought) {
      list.push({
        id: 'thinking',
        kind: 'thinking',
        title: zh ? '思考过程' : 'Thinking',
        detail: thought,
      });
    }
    for (const s of turn.steps ?? []) {
      list.push(s);
    }
    for (const tc of turn.toolCalls ?? []) {
      list.push({ ...tc, kind: tc.kind || 'tool' });
    }
    return list;
  }, [turn.reasoning, turn.steps, turn.thinking, turn.toolCalls, zh]);

  if (steps.length === 0) {
    return null;
  }

  const label = steps.length === 1 && steps[0].kind === 'thinking'
    ? (zh ? '思考过程' : 'Thinking')
    : (zh ? `思考与工具步骤 (${steps.length})` : `Steps & tools (${steps.length})`);

  return (
    <div className="dsh-bots-turn-steps">
      <button
        type="button"
        className="dsh-bots-turn-steps-toggle"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
      >
        <BotChevron open={open} size={11} />
        <IconWrench size={11} style={{ opacity: 0.75 }} />
        <span>{label}</span>
      </button>
      <BotDisclosure open={open}>
        <div className="dsh-bots-turn-steps-list">
          {steps.map((step, idx) => (
            <div key={step.id ?? `step-${idx}`} className="dsh-bots-turn-step-item">
              {step.kind === 'thinking' ? (
                <IconBrain size={12} style={{ marginTop: 3, opacity: 0.75 }} />
              ) : (
                <IconWrench size={12} style={{ marginTop: 3, opacity: 0.75 }} />
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="dsh-bots-row">
                  <span style={{ fontWeight: 500, color: 'var(--dsw-alias-label-primary)' }}>
                    {step.title || step.name || (zh ? '执行步骤' : 'Step')}
                  </span>
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    {typeof step.durationMs === 'number' && step.durationMs > 0 && (
                      <span className="dsh-bots-turn-elapsed">{formatElapsedDuration(step.durationMs)}</span>
                    )}
                    {step.status && <span className="dsh-bots-badge">{step.status}</span>}
                  </div>
                </div>
                {(step.detail || step.summary) && (
                  <div className="dsh-bots-turn-step-detail">{step.detail || step.summary}</div>
                )}
              </div>
            </div>
          ))}
        </div>
      </BotDisclosure>
    </div>
  );
}

// ---- Handoff Divider Formatter ----

function formatHandoffLabel(
  handoff: GroupHandoffMeta,
  botNameLookup: (id?: string, fallback?: string) => string,
  zh: boolean,
): { text: string; tone: 'normal' | 'stopped' } {
  if (handoff.label && handoff.label.trim()) {
    const tone = handoff.kind === 'stopped' || handoff.kind === 'paused' ? 'stopped' : 'normal';
    return { text: handoff.label.trim(), tone };
  }
  const from = botNameLookup(handoff.fromBotId, handoff.fromBotName);
  const to = botNameLookup(handoff.toBotId, handoff.toBotName);

  if (handoff.kind === 'stopped' || handoff.kind === 'paused') {
    if (typeof handoff.count === 'number' && handoff.count > 0) {
      return {
        text: zh ? `已停止后续接力（已完成 ${handoff.count} 轮）` : `Paused after ${handoff.count} hand-offs`,
        tone: 'stopped',
      };
    }
    return {
      text: handoff.reason || (zh ? '已停止后续接力' : 'Stopped further hand-offs'),
      tone: 'stopped',
    };
  }

  if (handoff.kind === 'replied') {
    return {
      text: zh ? `${from} 回复了 ${to}` : `${from} replied to ${to}`,
      tone: 'normal',
    };
  }

  return {
    text: zh ? `${from} 邀请了 ${to}` : `${from} invited ${to}`,
    tone: 'normal',
  };
}

function HandoffDivider({ text, tone = 'normal' }: { text: string; tone?: 'normal' | 'stopped' }) {
  return (
    <div className="dsh-bots-handoff-line" role="separator" aria-label={text}>
      <span className="dsh-bots-handoff-pill" data-tone={tone}>
        {text}
      </span>
    </div>
  );
}

function useLiveTick(active: boolean): number {
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
  const [hasMore, setHasMore] = useState(false);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [draft, setDraft] = useState('');
  const [pendingImages, setPendingImages] = useState<GroupImageItem[]>([]);
  const [caret, setCaret] = useState(0);
  const [mentionIdx, setMentionIdx] = useState(0);
  const [sending, setSending] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [approvingMsgId, setApprovingMsgId] = useState<string | null>(null);
  const [stopNotice, setStopNotice] = useState<string | null>(null);
  const [isNearBottom, setIsNearBottom] = useState(true);
  const [unseenCount, setUnseenCount] = useState(0);

  const feedRef = useRef<HTMLDivElement | null>(null);
  const feedEndRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const nearBottomRef = useRef(true);
  const lastLatestSeqRef = useRef<number>(0);

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

  const botNameLookup = useCallback((id?: string, fallback?: string): string => {
    if (id) {
      const found = bots.find((b) => b.id === id);
      if (found) return found.name;
    }
    return fallback || id || (zh ? '队友' : 'Teammate');
  }, [bots, zh]);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    feedEndRef.current?.scrollIntoView?.({ behavior, block: 'end' });
    setUnseenCount(0);
    nearBottomRef.current = true;
    setIsNearBottom(true);
  }, []);

  const loadMessages = useCallback(async (options: { reset?: boolean } = {}) => {
    if (!storeGroup?.id) {
      return;
    }
    try {
      const res = await callBotRpc<{
        group?: BotGroupRecord;
        messages?: GroupMessageRecord[];
        hasMore?: boolean;
      }>(RPC_METHODS.GROUPS_READ, {
        groupId: storeGroup.id,
        threadId: threadId || undefined,
        limit: PAGE_LIMIT,
      });
      if (res?.group) {
        setGroupDetail(res.group);
      }
      const incoming = Array.isArray(res?.messages) ? res.messages : [];
      const incomingHasMore = Boolean(res?.hasMore);

      setMessages((prev) => {
        if (options.reset || prev.length === 0) {
          setHasMore(incomingHasMore);
          return incoming;
        }
        // Preserve earlier paginated messages while updating the latest window in place
        const incomingById = new Map(incoming.map((m) => [m.id, m]));
        const firstIncomingSeq = incoming[0]?.sequence;
        const earlierKept = typeof firstIncomingSeq === 'number'
          ? prev.filter((m) => typeof m.sequence === 'number' && m.sequence < firstIncomingSeq && !incomingById.has(m.id))
          : [];
        if (earlierKept.length === 0) {
          setHasMore(incomingHasMore);
        }
        return [...earlierKept, ...incoming];
      });

      const newestSeq = incoming.at(-1)?.sequence ?? 0;
      if (options.reset) {
        lastLatestSeqRef.current = newestSeq;
        setUnseenCount(0);
        window.requestAnimationFrame(() => scrollToBottom('auto'));
      } else if (newestSeq > lastLatestSeqRef.current) {
        const added = incoming.filter((m) => (m.sequence ?? 0) > lastLatestSeqRef.current).length;
        lastLatestSeqRef.current = newestSeq;
        if (nearBottomRef.current) {
          window.requestAnimationFrame(() => scrollToBottom('smooth'));
        } else if (added > 0) {
          setUnseenCount((prev) => prev + added);
        }
      }
    } catch (err) {
      console.warn('[dsh-bots] Failed to read group messages', err);
    }
  }, [scrollToBottom, storeGroup?.id, threadId]);

  const loadEarlierMessages = async () => {
    if (!storeGroup?.id || loadingEarlier || !hasMore) {
      return;
    }
    const oldestSeq = messages.find((m) => typeof m.sequence === 'number')?.sequence;
    if (oldestSeq === undefined) {
      setHasMore(false);
      return;
    }
    const feedEl = feedRef.current;
    const prevScrollHeight = feedEl?.scrollHeight ?? 0;
    const prevScrollTop = feedEl?.scrollTop ?? 0;

    setLoadingEarlier(true);
    try {
      const res = await callBotRpc<{
        messages?: GroupMessageRecord[];
        hasMore?: boolean;
      }>(RPC_METHODS.GROUPS_READ, {
        groupId: storeGroup.id,
        threadId: threadId || undefined,
        beforeSequence: oldestSeq,
        limit: PAGE_LIMIT,
      });
      const older = Array.isArray(res?.messages) ? res.messages : [];
      setHasMore(Boolean(res?.hasMore));
      if (older.length > 0) {
        setMessages((prev) => {
          const existingIds = new Set(prev.map((m) => m.id));
          const uniqueOlder = older.filter((m) => !existingIds.has(m.id));
          return [...uniqueOlder, ...prev];
        });
        window.requestAnimationFrame(() => {
          if (feedEl) {
            const delta = feedEl.scrollHeight - prevScrollHeight;
            feedEl.scrollTop = prevScrollTop + delta;
          }
        });
      }
    } catch (err) {
      botsStore.pushToast({ message: err instanceof Error ? err.message : String(err), tone: 'error' });
    } finally {
      setLoadingEarlier(false);
    }
  };

  useEffect(() => {
    setThreadId('');
    setMessages([]);
    setHasMore(false);
    setStopNotice(null);
    lastLatestSeqRef.current = 0;
  }, [storeGroup?.id]);

  useEffect(() => {
    void loadMessages({ reset: true });
  }, [storeGroup?.id, threadId]);

  useEffect(() => {
    if (changeSeq > 0) {
      void loadMessages({ reset: false });
    }
  }, [changeSeq, loadMessages]);

  const handleFeedScroll = () => {
    const el = feedRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const near = distFromBottom <= NEAR_BOTTOM_PX;
    nearBottomRef.current = near;
    setIsNearBottom(near);
    if (near && unseenCount > 0) {
      setUnseenCount(0);
    }
  };

  const hasRunningTurns = useMemo(
    () => messages.some((m) => (m.turns ?? []).some(isTurnLive)),
    [messages],
  );
  const liveNow = useLiveTick(hasRunningTurns);

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
  const draftAudience = botGroupDraftAudience(draft, sharedGroup, memberBots) as 'invalid' | { ids: string[]; addressed: boolean };
  const coordBotName = replyModeObj.kind === 'coordinator'
    ? (memberBots.find((b) => b.id === replyModeObj.coordinatorBotId)?.name ?? memberBots[0]?.name ?? '')
    : '';
  const audienceLabel = replyModeObj.kind === 'coordinator' && draftAudience !== 'invalid' && !draftAudience.addressed
    ? (zh ? `协调者：${coordBotName}（先出计划再审批）` : `Coordinator: ${coordBotName} (plan-gate)`)
    : formatBotGroupAudience(draftAudience, sharedGroup, memberBots, tr);

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

  const handleUpdateReplyMode = async (next: BotGroupReplyModeValue) => {
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
    setStopNotice(null);
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
      nearBottomRef.current = true;
      setIsNearBottom(true);
      await loadMessages({ reset: false });
      window.requestAnimationFrame(() => scrollToBottom('smooth'));
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
    const targetName = botId ? botNameLookup(botId) : null;
    setStopping(true);

    // Immediate optimistic feedback: mark live turns as stopped right away
    setMessages((prev) => prev.map((msg) => ({
      ...msg,
      turns: (msg.turns ?? []).map((t) => {
        if (isTurnLive(t) && (!botId || t.botId === botId)) {
          return { ...t, status: 'stopped', finishedAt: Date.now() };
        }
        return t;
      }),
    })));
    const noticeMsg = targetName
      ? (zh ? `已中止「${targetName}」的当前回复` : `Stopped ${targetName}`)
      : (zh ? '已中止本群当前所有运行中的回复与接力' : 'Stopped all running replies');
    setStopNotice(noticeMsg);

    try {
      await callBotRpc(RPC_METHODS.GROUPS_STOP, {
        groupId: group.id,
        threadId: threadId || undefined,
        ...(botId ? { botId } : {}),
      });
      botsStore.pushToast({ message: noticeMsg, tone: 'info' }, 3000);
      await loadMessages({ reset: false });
    } catch (err) {
      setStopNotice(null);
      botsStore.pushToast({ message: err instanceof Error ? err.message : String(err), tone: 'error' });
      await loadMessages({ reset: false });
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

  const renderTurnStatusBadge = (turn: GroupTurnRecord, msgCreatedAt?: number) => {
    const startTs = turn.startedAt ?? msgCreatedAt;
    const elapsedMs = typeof startTs === 'number' && startTs > 0
      ? Math.max(0, (turn.finishedAt ?? liveNow) - startTs)
      : null;

    if (turn.revoked || turn.status === 'removed') {
      return <span className="dsh-bots-badge">{zh ? '已移出' : 'Removed'}</span>;
    }
    if (turn.status === 'queued') {
      return (
        <span className="dsh-bots-badge">
          <IconClock size={10} />
          <span>{zh ? '排队中' : 'Queued'}</span>
        </span>
      );
    }
    if (turn.status === 'running' || turn.status === 'thinking') {
      return (
        <>
          <span className="dsh-bots-badge dsh-bots-badge-accent">
            <IconSpinner size={10} />
            <span>{zh ? '思考中…' : 'Thinking…'}</span>
          </span>
          {elapsedMs !== null && (
            <span className="dsh-bots-turn-elapsed">{formatElapsedDuration(elapsedMs)}</span>
          )}
        </>
      );
    }
    if (turn.status === 'replying' || turn.status === 'streaming') {
      return (
        <>
          <span className="dsh-bots-badge dsh-bots-badge-accent">
            <IconSpinner size={10} />
            <span>{zh ? '回复中…' : 'Replying…'}</span>
          </span>
          {elapsedMs !== null && (
            <span className="dsh-bots-turn-elapsed">{formatElapsedDuration(elapsedMs)}</span>
          )}
        </>
      );
    }
    if (turn.status === 'awaiting_approval') {
      return <span className="dsh-bots-badge dsh-bots-badge-warn">{zh ? '待批准计划' : 'Awaiting approval'}</span>;
    }
    if (turn.status === 'stopped') {
      return <span className="dsh-bots-badge">{zh ? '已停止' : 'Stopped'}</span>;
    }
    if (turn.status === 'quiet') {
      return <span className="dsh-bots-badge">{zh ? '无需补充' : 'Quiet'}</span>;
    }
    if (turn.error || turn.status === 'error') {
      return <span className="dsh-bots-badge dsh-bots-badge-danger">{zh ? '错误' : 'Error'}</span>;
    }
    if (turn.finishedAt && startTs && turn.finishedAt > startTs) {
      return (
        <span className="dsh-bots-turn-elapsed">
          {formatElapsedDuration(turn.finishedAt - startTs)}
        </span>
      );
    }
    return null;
  };

  return (
    <div className="dsh-bots-group-room" data-dsh-bots-group-room={group.id}>
      <div className="dsh-bots-group-header">
        <div className="dsh-bots-row-left" style={{ gap: 10 }}>
          <BotGroupAvatar members={memberBots} size={36} unread={group.unread} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 600 }}>{group.name}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 2 }}>
              {memberBots.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className="dsh-bots-group-member-chip"
                  title={zh ? `点击 @${m.name}` : `Mention @${m.name}`}
                  onClick={() => {
                    setDraft((prev) => botGroupReplyDraft(m.id, prev, sharedGroup, memberBots));
                    textareaRef.current?.focus();
                  }}
                >
                  <BotAvatar botId={m.id} avatar={m.avatar} avatarColor={m.avatarColor} name={m.name} size={14} radius={4} paused={m.paused} />
                  <span>{m.name}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div style={{ display: 'inline-flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
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
              <span>{stopping ? (zh ? '停止中…' : 'Stopping…') : (zh ? '停止全部' : 'Stop')}</span>
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

      <div className="dsh-bots-group-feed-wrap">
        <div ref={feedRef} className="dsh-bots-group-feed" onScroll={handleFeedScroll}>
          {hasMore && (
            <div className="dsh-bots-load-earlier">
              <button
                type="button"
                className="dsh-bots-load-earlier-btn"
                disabled={loadingEarlier}
                onClick={() => void loadEarlierMessages()}
              >
                {loadingEarlier && <IconSpinner size={12} />}
                <span>{loadingEarlier ? (zh ? '正在加载更早消息…' : 'Loading earlier…') : (zh ? '加载更早消息' : 'Load earlier messages')}</span>
              </button>
            </div>
          )}

          {messages.length === 0 ? (
            <div className="dsh-bots-empty" style={{ maxWidth: 460, margin: '40px auto' }}>
              {zh
                ? '输入消息开始多鱼协作，输入 @ 可精准呼叫指定大肥鱼队友或 @everyone，支持直接粘贴或上传图片。'
                : 'Send a message to start collaborating. Type @ to mention a bot or paste/upload images.'}
            </div>
          ) : (
            messages.map((msg) => {
              // Dedicated standalone handoff / system event message
              if (
                msg.kind === 'handoff'
                || msg.kind === 'peer_request'
                || msg.kind === 'handoff_stopped'
                || msg.kind === 'system'
              ) {
                const info = msg.handoff
                  ? formatHandoffLabel(msg.handoff, botNameLookup, zh)
                  : {
                    text: msg.text || (zh ? '已停止后续接力' : 'Stopped hand-offs'),
                    tone: (msg.kind === 'handoff_stopped' ? 'stopped' : 'normal') as 'normal' | 'stopped',
                  };
                return <HandoffDivider key={msg.id} text={info.text} tone={info.tone} />;
              }

              const stoppedMeta = msg.handoffStopped || msg.handoffPaused;
              const awaitingPlan = isMessageAwaitingPlanApproval(msg);
              const planSteps = msg.plan?.steps ?? [];

              return (
                <div key={msg.id} className="dsh-bots-group-msg">
                  {(msg.text || (msg.images?.length ?? 0) > 0) && (
                    <div className="dsh-bots-group-user-bubble">
                      {msg.text && (botGroupMentionSegments(msg.text, memberNames, true) as Array<{ text: string; mention: boolean }>).map((seg, i) => (
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
                  )}

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
                    const live = isTurnLive(turn);
                    const isRemoved = Boolean(turn.revoked || turn.status === 'removed');
                    const displayName = bot?.name ?? turn.botName ?? turn.botId;

                    // Resolve optional per-turn @Name peer handoff divider
                    const turnHandoff: GroupHandoffMeta | null = (() => {
                      if (turn.handoff) {
                        return turn.handoff;
                      }
                      const fromId = turn.requestedBy?.botId ?? turn.triggeredByBotId;
                      const fromName = turn.requestedBy?.botName ?? turn.requestedBy?.name ?? turn.triggeredByBotName;
                      if (fromId || fromName) {
                        return {
                          kind: turn.handoffKind || 'asked',
                          fromBotId: fromId,
                          fromBotName: fromName,
                          toBotId: turn.botId,
                          toBotName: displayName,
                        };
                      }
                      return null;
                    })();

                    const handoffInfo = turnHandoff
                      ? formatHandoffLabel(turnHandoff, botNameLookup, zh)
                      : null;

                    return (
                      <Fragment key={`${msg.id}-${turn.botId}-${tIdx}`}>
                        {handoffInfo && (
                          <HandoffDivider text={handoffInfo.text} tone={handoffInfo.tone} />
                        )}
                        <div
                          className="dsh-bots-group-bot-bubble"
                          data-revoked={isRemoved ? 'true' : 'false'}
                        >
                          <div className="dsh-bots-row">
                            <div className="dsh-bots-row-left">
                              <BotAvatar
                                botId={turn.botId}
                                avatar={bot?.avatar}
                                avatarColor={bot?.avatarColor}
                                name={displayName}
                                size={22}
                                radius={6}
                                paused={bot?.paused}
                              />
                              <span style={{ fontWeight: 600, fontSize: 12.5 }}>
                                {displayName}
                              </span>
                              {renderTurnStatusBadge(turn, msg.createdAt)}
                            </div>
                            <div style={{ display: 'inline-flex', gap: 4 }}>
                              {live && (
                                <button
                                  type="button"
                                  className="dsh-bots-pbtn dsh-bots-pbtn-xs dsh-bots-pbtn-danger"
                                  disabled={stopping}
                                  onClick={() => void handleStop(turn.botId)}
                                >
                                  <IconStopSquare size={10} />
                                  <span>{zh ? '停止' : 'Stop'}</span>
                                </button>
                              )}
                              {bot && !isRemoved && (
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

                          <TurnStepsDisclosure turn={turn} zh={zh} />

                          <div className="dsh-bots-group-bot-body">
                            {turn.error ? (
                              <span className="dsh-bots-error-text">{turn.error}</span>
                            ) : turn.reply ? (
                              <SafeMarkdown text={turn.reply} memberNames={memberNames} zh={zh} />
                            ) : turn.status === 'queued' ? (
                              <span className="dsh-bots-muted">{zh ? '已入队，等待轮次开始…' : 'Queued, waiting to start…'}</span>
                            ) : live ? (
                              <span className="dsh-bots-muted">{zh ? '正在思考并组织回复…' : 'Thinking…'}</span>
                            ) : turn.status === 'stopped' ? (
                              <span className="dsh-bots-muted">{zh ? '（已中止本次回复）' : '(Stopped)'}</span>
                            ) : turn.status === 'quiet' ? (
                              <span className="dsh-bots-muted">{zh ? '（无额外补充）' : '(Nothing to add)'}</span>
                            ) : isRemoved ? (
                              <span className="dsh-bots-muted">{zh ? '（该成员已移出本群）' : '(Member removed from group)'}</span>
                            ) : (
                              <span className="dsh-bots-muted">{zh ? '（无回复）' : '(No reply)'}</span>
                            )}
                          </div>
                        </div>
                      </Fragment>
                    );
                  })}

                  {stoppedMeta && (
                    <HandoffDivider
                      text={
                        typeof stoppedMeta === 'object' && stoppedMeta !== null
                          ? formatHandoffLabel({ kind: 'stopped', ...stoppedMeta }, botNameLookup, zh).text
                          : (zh ? '已停止后续接力' : 'Stopped further hand-offs')
                      }
                      tone="stopped"
                    />
                  )}
                </div>
              );
            })
          )}
          <div ref={feedEndRef} />
        </div>

        {!isNearBottom && (
          <button
            type="button"
            className="dsh-bots-jump-latest"
            onClick={() => scrollToBottom('smooth')}
          >
            <IconChevronDown size={13} />
            <span>{zh ? '跳回最新' : 'Jump to latest'}</span>
            {unseenCount > 0 && (
              <span className="dsh-bots-badge dsh-bots-badge-accent">{unseenCount}</span>
            )}
          </button>
        )}
      </div>

      <div className="dsh-bots-group-composer-wrap">
        {stopNotice && (
          <div className="dsh-bots-stop-notice" role="status">
            <span>{stopNotice}</span>
            <button
              type="button"
              className="dsh-bots-pbtn dsh-bots-pbtn-xs dsh-bots-pbtn-ghost"
              onClick={() => setStopNotice(null)}
            >
              {zh ? '知道了' : 'Dismiss'}
            </button>
          </div>
        )}

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
              <BotGroupReplyPicker
                replyMode={replyModeObj}
                memberBots={memberBots}
                draftAudience={draftAudience}
                audienceLabel={audienceLabel}
                disabled={sending}
                onChange={handleUpdateReplyMode}
              />
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
            </div>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {hasRunningTurns && (
                <button
                  type="button"
                  className="dsh-bots-pbtn dsh-bots-pbtn-xs dsh-bots-pbtn-danger"
                  disabled={stopping}
                  onClick={() => void handleStop()}
                >
                  <IconStopSquare size={10} />
                  <span>{zh ? '停止' : 'Stop'}</span>
                </button>
              )}
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
    </div>
  );
}
