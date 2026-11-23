// Detailed view for a single Bot Work Item inside the right panel:
// prev/next keyboard navigation, cancel-reason dialog, loading skeleton, origin chat jump,
// multi-step Ask stepper, Replying-To capsule with timeline flash highlight,
// rich comment composer (auto-height, per-item drafts, paste/drop images & files, optimistic retry).

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
} from 'react';
import {
  BOT_ITEM_COMMENT_FILE_MAX_COUNT,
  BOT_ITEM_STATUSES,
  botItemPrUrl,
  botItemQuestionLine,
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
  BotItemQuestionStep,
  type AskQuestionShape,
  type AskSubmitPayload,
} from './BotItemQuestionStep';
import { BotItemReplyingTo } from './BotItemReplyingTo';
import {
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconClock,
  IconExternalLink,
  IconFileText,
  IconLink,
  IconMessageSquare,
  IconRefresh,
  IconSend,
  IconUpload,
  IconX,
} from './Icons';

export interface WorkItemEvent {
  id: number;
  eventId?: string;
  kind: string;
  actor?: { kind?: string; botId?: string; why?: string; sessionId?: string };
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
  chatId?: string | null;
  sessionId?: string | null;
  originSessionId?: string | null;
  askedInConversation?: string | null;
  links?: WorkItemLink[];
  events?: WorkItemEvent[];
  question?: {
    eventId?: number | string;
    text?: string;
    gist?: string;
    ask?: unknown;
    data?: Record<string, unknown>;
  } | null;
}

export interface BotItemDetailViewProps {
  botId: string;
  itemUid: string;
  orderedUids: string[];
  onSelectUid: (uid: string) => void;
  onBack: () => void;
  onMutated: () => void;
}

interface PendingAttachment {
  id: string;
  kind: 'image' | 'file';
  name: string;
  mimeType: string;
  bytes: number;
  dataUrl?: string;
  path?: string;
  textContent?: string;
}

interface PendingCommentEntry {
  requestId: string;
  text: string;
  createdAt: number;
  status: 'sending' | 'failed';
  error?: string;
  decisions?: Array<{ picks: number[] }>;
  questionEventId?: number | string;
  plain?: boolean;
  images?: Array<{ name: string; mimeType: string; bytes: number; dataUrl?: string; path?: string }>;
  files?: Array<{ name: string; mimeType: string; bytes: number; path?: string; text?: string }>;
}

const DRAFT_STORAGE_PREFIX = 'dsh-bots.itemDraft:';

function draftStorageKey(botId: string, itemUid: string): string {
  return `${DRAFT_STORAGE_PREFIX}${botId}:${itemUid}`;
}

export function readBotItemDraft(botId: string, itemUid: string): string {
  if (typeof window === 'undefined' || !window.localStorage) {
    return '';
  }
  try {
    return window.localStorage.getItem(draftStorageKey(botId, itemUid)) ?? '';
  } catch {
    return '';
  }
}

export function writeBotItemDraft(botId: string, itemUid: string, text: string): void {
  if (typeof window === 'undefined' || !window.localStorage) {
    return;
  }
  try {
    const key = draftStorageKey(botId, itemUid);
    if (!text) {
      window.localStorage.removeItem(key);
    } else {
      window.localStorage.setItem(key, text);
    }
  } catch {
    // Ignore storage quota / private mode failures.
  }
}

function makeRequestId(): string {
  return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function statusLabel(status: string, tr: (k: string, fb?: string) => string): string {
  return tr(`bots.items.status.${status}`, status);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function eventSummaryText(ev: WorkItemEvent, zh: boolean): string {
  const data = ev.data ?? {};
  if (ev.kind === 'commented' && typeof data.text === 'string') {
    return data.text;
  }
  if (ev.kind === 'status' && typeof data.to === 'string') {
    const reason = typeof data.reason === 'string' && data.reason.trim() ? `（${data.reason.trim()}）` : '';
    return zh ? `状态变更为 ${data.to}${reason}` : `Status changed to ${data.to}${reason}`;
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

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'));
    reader.readAsText(file);
  });
}

function isEditableElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target.isContentEditable) {
    return true;
  }
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
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

  const rootRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const prevBtnRef = useRef<HTMLButtonElement | null>(null);
  const nextBtnRef = useRef<HTMLButtonElement | null>(null);
  const cancelInputRef = useRef<HTMLTextAreaElement | null>(null);
  const focusAfterStepRef = useRef<'prev' | 'next' | 'root' | null>(null);
  const flashTimerRef = useRef<number | null>(null);

  const [item, setItem] = useState<WorkItemFull | null>(null);
  const [events, setEvents] = useState<WorkItemEvent[]>([]);
  const [links, setLinks] = useState<WorkItemLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [comment, setComment] = useState(() => readBotItemDraft(botId, itemUid));
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [pendingComments, setPendingComments] = useState<PendingCommentEntry[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const [customSnooze, setCustomSnooze] = useState('');
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [canceling, setCanceling] = useState(false);
  const [dismissedQuestionKey, setDismissedQuestionKey] = useState<string | null>(null);
  const [flashedEventId, setFlashedEventId] = useState<string | null>(null);
  const [composerGlow, setComposerGlow] = useState(false);

  // Sync draft when switching items.
  useEffect(() => {
    setComment(readBotItemDraft(botId, itemUid));
    setAttachments([]);
    setPendingComments([]);
    setSnoozeOpen(false);
    setCancelDialogOpen(false);
    setCancelReason('');
    setDismissedQuestionKey(null);
  }, [botId, itemUid]);

  // Persist per-item draft to localStorage.
  useEffect(() => {
    writeBotItemDraft(botId, itemUid, comment);
  }, [botId, itemUid, comment]);

  // Restore focus after keyboard stepping between items.
  useEffect(() => {
    const target = focusAfterStepRef.current;
    if (!target) {
      return;
    }
    focusAfterStepRef.current = null;
    if (target === 'prev' && prevBtnRef.current && !prevBtnRef.current.disabled) {
      prevBtnRef.current.focus();
    } else if (target === 'next' && nextBtnRef.current && !nextBtnRef.current.disabled) {
      nextBtnRef.current.focus();
    } else {
      rootRef.current?.focus();
    }
  }, [itemUid]);

  useEffect(() => () => {
    if (flashTimerRef.current !== null) {
      window.clearTimeout(flashTimerRef.current);
    }
  }, []);

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

  const latestAskEvent = useMemo(
    () => [...events].reverse().find((ev) => Boolean(ev.data?.ask) || (ev.kind === 'status' && ev.data?.to === 'needs_you')),
    [events],
  );

  const askData = item?.question?.data ?? (item?.question?.ask ? { ask: item.question.ask } : latestAskEvent?.data);
  const askShape: AskQuestionShape = useMemo(
    () => (askData ? (botItemQuestionShape(askData) as AskQuestionShape) : { body: '', decisions: [] }),
    [askData],
  );

  const questionEventId = item?.question?.eventId ?? latestAskEvent?.eventId ?? latestAskEvent?.id;
  const questionKey = `${itemUid}:${questionEventId ?? 'none'}`;
  const hasOpenQuestion = item?.status === 'needs_you' && Boolean(
    askShape.decisions.length > 0 || item.question?.text || askShape.body || latestAskEvent,
  );
  const replyingActive = hasOpenQuestion && dismissedQuestionKey !== questionKey;

  const questionSummary = useMemo(() => {
    if (item?.question?.gist) {
      return item.question.gist;
    }
    if (askShape.decisions.length > 0) {
      return botItemQuestionLine(askShape.decisions[0].question);
    }
    if (item?.question?.text) {
      return botItemQuestionLine(item.question.text);
    }
    if (askShape.body) {
      return botItemQuestionLine(askShape.body);
    }
    if (latestAskEvent && typeof latestAskEvent.data?.text === 'string') {
      return botItemQuestionLine(latestAskEvent.data.text);
    }
    return zh ? '需要你确认当前进展' : 'Needs your reply';
  }, [askShape, item?.question?.gist, item?.question?.text, latestAskEvent, zh]);

  const originChatSessionId = useMemo(() => {
    const direct = item?.originSessionId || item?.askedInConversation || item?.sessionId || item?.chatId;
    if (direct && typeof direct === 'string') {
      return direct;
    }
    for (const ev of events) {
      const sid = (typeof ev.data?.sessionId === 'string' && ev.data.sessionId)
        || (typeof ev.data?.chatId === 'string' && ev.data.chatId)
        || ev.actor?.sessionId;
      if (sid) {
        return sid;
      }
    }
    return null;
  }, [events, item?.askedInConversation, item?.chatId, item?.originSessionId, item?.sessionId]);

  // Trigger a gentle glow on the composer if the open question has no quick-reply choices.
  useEffect(() => {
    if (replyingActive && askShape.decisions.length === 0) {
      setComposerGlow(true);
      const timer = window.setTimeout(() => setComposerGlow(false), 1200);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [askShape.decisions.length, questionKey, replyingActive]);

  // Auto-resize composer textarea up to 4+ lines smoothly.
  useEffect(() => {
    const el = composerRef.current;
    if (!el) {
      return;
    }
    el.style.height = 'auto';
    const minHeight = replyingActive ? 88 : 54;
    const maxHeight = 200;
    const next = Math.min(maxHeight, Math.max(minHeight, el.scrollHeight));
    el.style.height = `${next}px`;
  }, [comment, replyingActive, itemUid]);

  // Focus cancel reason input when dialog opens.
  useEffect(() => {
    if (cancelDialogOpen) {
      window.setTimeout(() => cancelInputRef.current?.focus(), 0);
    }
  }, [cancelDialogOpen]);

  // Keyboard flow: Esc / Alt+Left / Cmd+[ back, Alt+Cmd/Ctrl+Up/Down step, type anywhere -> composer.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing) {
        return;
      }

      if (cancelDialogOpen) {
        if (event.key === 'Escape') {
          event.preventDefault();
          setCancelDialogOpen(false);
        }
        return;
      }

      // Alt+Meta+Up/Down or Alt+Ctrl+Up/Down step between items while keeping focus.
      if (event.altKey && (event.metaKey || event.ctrlKey) && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        event.preventDefault();
        if (event.key === 'ArrowUp' && prevUid) {
          focusAfterStepRef.current = 'prev';
          onSelectUid(prevUid);
        } else if (event.key === 'ArrowDown' && nextUid) {
          focusAfterStepRef.current = 'next';
          onSelectUid(nextUid);
        }
        return;
      }

      // Alt+Left or Meta+[ goes back to list.
      if ((event.altKey && event.key === 'ArrowLeft') || (event.metaKey && event.key === '[')) {
        event.preventDefault();
        onBack();
        return;
      }

      if (event.key === 'Escape') {
        if (snoozeOpen) {
          event.preventDefault();
          setSnoozeOpen(false);
          return;
        }
        if (document.activeElement === composerRef.current) {
          composerRef.current?.blur();
          return;
        }
        event.preventDefault();
        onBack();
        return;
      }

      // Type anywhere in detail pane (outside inputs) flows into comment composer.
      if (
        !event.ctrlKey
        && !event.metaKey
        && !event.altKey
        && event.key.length === 1
        && !isEditableElement(event.target)
        && rootRef.current?.contains(event.target as Node)
        && composerRef.current
      ) {
        event.preventDefault();
        composerRef.current.focus();
        setComment((prev) => `${prev}${event.key}`);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [cancelDialogOpen, nextUid, onBack, onSelectUid, prevUid, snoozeOpen]);

  const updateStatus = async (status: WorkItemFull['status'], reason?: string) => {
    try {
      await callBotRpc(RPC_METHODS.ITEMS_OWNER_STATUS, {
        botId,
        uid: itemUid,
        uids: [itemUid],
        status,
        ...(reason?.trim() ? { reason: reason.trim() } : {}),
      });
      await load();
      onMutated();
    } catch (err) {
      botsStore.pushToast({ message: err instanceof Error ? err.message : String(err), tone: 'error' });
    }
  };

  const handleConfirmCancel = async () => {
    if (canceling) {
      return;
    }
    setCanceling(true);
    try {
      await updateStatus('canceled', cancelReason);
      setCancelDialogOpen(false);
      setCancelReason('');
    } finally {
      setCanceling(false);
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

  const jumpToQuestionEvent = () => {
    const targetId = latestAskEvent ? String(latestAskEvent.id) : (questionEventId !== undefined ? String(questionEventId) : null);
    if (!targetId || !rootRef.current) {
      return;
    }
    const node = rootRef.current.querySelector<HTMLElement>(`[data-event-id="${targetId}"]`);
    if (node) {
      node.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setFlashedEventId(targetId);
      if (flashTimerRef.current !== null) {
        window.clearTimeout(flashTimerRef.current);
      }
      flashTimerRef.current = window.setTimeout(() => {
        setFlashedEventId(null);
      }, 1400);
    }
  };

  const addFilesAsAttachments = async (fileList: FileList | File[]) => {
    const incoming = Array.from(fileList);
    if (incoming.length === 0) {
      return;
    }
    const remainingSlots = Math.max(0, BOT_ITEM_COMMENT_FILE_MAX_COUNT - attachments.length);
    if (remainingSlots <= 0) {
      botsStore.pushToast({
        message: zh ? `单条评论最多附带 ${BOT_ITEM_COMMENT_FILE_MAX_COUNT} 个附件` : `Max ${BOT_ITEM_COMMENT_FILE_MAX_COUNT} attachments`,
        tone: 'info',
      });
      return;
    }
    const nextItems: PendingAttachment[] = [];
    for (const file of incoming.slice(0, remainingSlots)) {
      const isImage = file.type.startsWith('image/');
      const filePath = (file as File & { path?: string }).path;
      try {
        if (isImage) {
          const dataUrl = await readFileAsDataUrl(file);
          nextItems.push({
            id: `att-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
            kind: 'image',
            name: file.name || 'image.png',
            mimeType: file.type || 'image/png',
            bytes: file.size,
            dataUrl,
            ...(filePath ? { path: filePath } : {}),
          });
        } else {
          const textContent = file.size <= 128 * 1024 ? await readFileAsText(file).catch(() => undefined) : undefined;
          nextItems.push({
            id: `att-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
            kind: 'file',
            name: file.name,
            mimeType: file.type || 'application/octet-stream',
            bytes: file.size,
            ...(filePath ? { path: filePath } : {}),
            ...(textContent !== undefined ? { textContent } : {}),
          });
        }
      } catch (err) {
        botsStore.pushToast({
          message: err instanceof Error ? err.message : String(err),
          tone: 'error',
        });
      }
    }
    if (nextItems.length > 0) {
      setAttachments((prev) => [...prev, ...nextItems]);
    }
  };

  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const items = event.clipboardData?.items;
    if (!items) {
      return;
    }
    const pastedFiles: File[] = [];
    for (let i = 0; i < items.length; i += 1) {
      const entry = items[i];
      if (entry.kind === 'file') {
        const file = entry.getAsFile();
        if (file) {
          pastedFiles.push(file);
        }
      }
    }
    if (pastedFiles.length > 0) {
      event.preventDefault();
      void addFilesAsAttachments(pastedFiles);
    }
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragActive(false);
    if (event.dataTransfer?.files?.length) {
      void addFilesAsAttachments(event.dataTransfer.files);
    }
  };

  const dispatchCommentEntry = async (entry: PendingCommentEntry) => {
    setSubmitting(true);
    try {
      await callBotRpc(RPC_METHODS.ITEMS_OWNER_COMMENT, {
        botId,
        uid: itemUid,
        text: entry.text,
        requestId: entry.requestId,
        ...(entry.decisions ? { decisions: entry.decisions } : {}),
        ...(entry.plain ? { plain: true } : {}),
        ...(!entry.plain && entry.questionEventId !== undefined ? { questionEventId: entry.questionEventId } : {}),
        ...(entry.images && entry.images.length > 0 ? { images: entry.images } : {}),
        ...(entry.files && entry.files.length > 0 ? { files: entry.files } : {}),
      });
      setPendingComments((prev) => prev.filter((p) => p.requestId !== entry.requestId));
      await load();
      onMutated();
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      setPendingComments((prev) => prev.map((p) => (
        p.requestId === entry.requestId ? { ...p, status: 'failed', error: errMsg } : p
      )));
      botsStore.pushToast({ message: errMsg, tone: 'error' });
    } finally {
      setSubmitting(false);
    }
  };

  const submitComment = async (
    textOverride?: string,
    options: { decisions?: Array<{ picks: number[] }>; forceReply?: boolean } = {},
  ) => {
    const rawBody = (textOverride ?? comment).trim();
    const hasFiles = !textOverride && attachments.length > 0;
    if (!rawBody && !hasFiles) {
      return;
    }

    const images = !textOverride
      ? attachments
        .filter((a) => a.kind === 'image')
        .map((a) => ({
          name: a.name,
          mimeType: a.mimeType,
          bytes: a.bytes,
          ...(a.dataUrl ? { dataUrl: a.dataUrl } : {}),
          ...(a.path ? { path: a.path } : {}),
        }))
      : [];

    const files = !textOverride
      ? attachments
        .filter((a) => a.kind === 'file')
        .map((a) => ({
          name: a.name,
          mimeType: a.mimeType,
          bytes: a.bytes,
          ...(a.path ? { path: a.path } : {}),
          ...(a.textContent !== undefined ? { text: a.textContent } : {}),
        }))
      : [];

    const isPlain = !options.forceReply && hasOpenQuestion && !replyingActive;
    const entry: PendingCommentEntry = {
      requestId: makeRequestId(),
      text: rawBody || (zh ? `[附带 ${attachments.length} 个附件]` : `[${attachments.length} attachment(s)]`),
      createdAt: Date.now(),
      status: 'sending',
      ...(options.decisions ? { decisions: options.decisions } : {}),
      ...(!isPlain && questionEventId !== undefined ? { questionEventId } : {}),
      ...(isPlain ? { plain: true } : {}),
      ...(images.length > 0 ? { images } : {}),
      ...(files.length > 0 ? { files } : {}),
    };

    if (!textOverride) {
      setComment('');
      writeBotItemDraft(botId, itemUid, '');
      setAttachments([]);
    }
    setPendingComments((prev) => [...prev, entry]);
    await dispatchCommentEntry(entry);
  };

  const handleRetryPending = (entry: PendingCommentEntry) => {
    setPendingComments((prev) => prev.map((p) => (
      p.requestId === entry.requestId ? { ...p, status: 'sending', error: undefined } : p
    )));
    void dispatchCommentEntry({ ...entry, status: 'sending', error: undefined });
  };

  const handleStepperSubmit = (payload: AskSubmitPayload) => {
    const extra = comment.trim();
    const combined = [payload.text, extra].filter(Boolean).join('\n');
    if (extra) {
      setComment('');
      writeBotItemDraft(botId, itemUid, '');
    }
    void submitComment(combined, { decisions: payload.decisions, forceReply: true });
  };

  const handleFillComment = (text: string) => {
    setComment((prev) => (prev.trim() ? `${prev.trim()}\n${text}` : text));
    window.setTimeout(() => {
      composerRef.current?.focus();
    }, 0);
  };

  const snoozePresets = botItemSnoozePickerPresets(now);

  return (
    <div ref={rootRef} className="dsh-bots-panel-scroll dsh-bots-item-detail" tabIndex={-1}>
      <div className="dsh-bots-row">
        <button
          type="button"
          className="dsh-bots-pbtn dsh-bots-pbtn-xs"
          title={zh ? '返回列表 (Esc / Alt+←)' : 'Back (Esc / Alt+Left)'}
          onClick={onBack}
        >
          <IconChevronLeft size={12} />
          <span>{zh ? '返回列表' : 'Back'}</span>
        </button>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          {originChatSessionId && (
            <button
              type="button"
              className="dsh-bots-pbtn dsh-bots-pbtn-xs"
              title={zh ? '跳转到发起该任务的对话' : 'Open origin chat'}
              onClick={() => botsStore.openBotChat(botId, originChatSessionId)}
            >
              <IconMessageSquare size={11} />
              <span>{zh ? '来源对话' : 'Origin chat'}</span>
            </button>
          )}
          <button
            ref={prevBtnRef}
            type="button"
            className="dsh-bots-pbtn dsh-bots-pbtn-xs dsh-bots-pbtn-icon"
            disabled={!prevUid}
            title={zh ? '上一条 (Alt+Ctrl/⌘+↑)' : 'Previous item (Alt+Cmd/Ctrl+Up)'}
            onClick={() => {
              if (prevUid) {
                focusAfterStepRef.current = 'prev';
                onSelectUid(prevUid);
              }
            }}
          >
            <IconChevronLeft size={12} />
          </button>
          <button
            ref={nextBtnRef}
            type="button"
            className="dsh-bots-pbtn dsh-bots-pbtn-xs dsh-bots-pbtn-icon"
            disabled={!nextUid}
            title={zh ? '下一条 (Alt+Ctrl/⌘+↓)' : 'Next item (Alt+Cmd/Ctrl+Down)'}
            onClick={() => {
              if (nextUid) {
                focusAfterStepRef.current = 'next';
                onSelectUid(nextUid);
              }
            }}
          >
            <IconChevronRight size={12} />
          </button>
        </div>
      </div>

      {loading && !item ? (
        <div className="dsh-bots-item-skeleton" aria-busy="true" aria-label={zh ? '正在加载条目详情' : 'Loading item'}>
          <div className="dsh-bots-pcard">
            <div className="dsh-bots-skel-line" style={{ width: '24%', height: 12 }} />
            <div className="dsh-bots-skel-line" style={{ width: '82%', height: 18 }} />
            <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
              <div className="dsh-bots-skel-pill" style={{ width: 72 }} />
              <div className="dsh-bots-skel-pill" style={{ width: 58 }} />
              <div className="dsh-bots-skel-pill" style={{ width: 58 }} />
            </div>
          </div>
          <div className="dsh-bots-pcard">
            <div className="dsh-bots-skel-line" style={{ width: '30%', height: 11 }} />
            <div className="dsh-bots-skel-line" style={{ width: '100%', height: 13 }} />
            <div className="dsh-bots-skel-line" style={{ width: '76%', height: 13 }} />
          </div>
          <div className="dsh-bots-pcard">
            <div className="dsh-bots-skel-line" style={{ width: '36%', height: 11 }} />
            <div className="dsh-bots-skel-line" style={{ width: '92%', height: 13 }} />
            <div className="dsh-bots-skel-line" style={{ width: '64%', height: 13 }} />
          </div>
        </div>
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
                onChange={(e) => {
                  const nextStatus = e.target.value as WorkItemFull['status'];
                  if (nextStatus === 'canceled') {
                    setCancelDialogOpen(true);
                  } else {
                    void updateStatus(nextStatus);
                  }
                }}
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
                onClick={() => setCancelDialogOpen(true)}
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

          {cancelDialogOpen && (
            <div className="dsh-bots-pcard dsh-bots-cancel-dialog" role="dialog" aria-label={zh ? '取消工作条目' : 'Cancel item'}>
              <div className="dsh-bots-row">
                <span style={{ fontWeight: 600, fontSize: 12.5 }}>
                  {zh ? '取消该工作条目' : 'Cancel this item'}
                </span>
                <button
                  type="button"
                  className="dsh-bots-pbtn dsh-bots-pbtn-xs dsh-bots-pbtn-icon"
                  aria-label={zh ? '关闭' : 'Close'}
                  onClick={() => setCancelDialogOpen(false)}
                >
                  <IconX size={12} />
                </button>
              </div>
              <div className="dsh-bots-muted">
                {zh
                  ? '大肥鱼队友会看到你填写的取消原因，历史记录不会被删除。'
                  : 'The bot will see your reason. History will not be deleted.'}
              </div>
              <textarea
                ref={cancelInputRef}
                className="dsh-bots-ptextarea"
                rows={2}
                placeholder={zh ? '可选：填写取消原因，例如需求已变更或改由人工处理…' : 'Optional reason for canceling…'}
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                    e.preventDefault();
                    void handleConfirmCancel();
                  }
                }}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
                <button
                  type="button"
                  className="dsh-bots-pbtn dsh-bots-pbtn-xs"
                  disabled={canceling}
                  onClick={() => setCancelDialogOpen(false)}
                >
                  {zh ? '返回' : 'Back'}
                </button>
                <button
                  type="button"
                  className="dsh-bots-pbtn dsh-bots-pbtn-xs dsh-bots-pbtn-danger"
                  disabled={canceling}
                  onClick={() => void handleConfirmCancel()}
                >
                  {canceling ? (zh ? '取消中…' : 'Canceling…') : (zh ? '确认取消' : 'Confirm cancel')}
                </button>
              </div>
            </div>
          )}

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
              <BotItemQuestionStep
                questionKey={questionKey}
                shape={askShape}
                submitting={submitting}
                onSubmit={handleStepperSubmit}
                onFillComment={handleFillComment}
              />
            </div>
          )}

          <div className="dsh-bots-psection">
            <span className="dsh-bots-section-title">{zh ? '动态时间线' : 'Activity timeline'}</span>
            {events.length === 0 && pendingComments.length === 0 ? (
              <div className="dsh-bots-muted">{zh ? '暂无动态记录' : 'No events yet.'}</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {events.map((ev) => {
                  const evKey = String(ev.id);
                  const isFlashed = flashedEventId === evKey;
                  const evImages = Array.isArray(ev.data?.images)
                    ? (ev.data.images as Array<{ name?: string; dataUrl?: string; path?: string }>)
                    : [];
                  const evFiles = Array.isArray(ev.data?.files)
                    ? (ev.data.files as Array<{ name?: string }>)
                    : [];
                  return (
                    <div
                      key={ev.id}
                      data-event-id={evKey}
                      className={`dsh-bots-timeline-entry ${isFlashed ? 'dsh-bots-timeline-flash' : ''}`.trim()}
                    >
                      <div className="dsh-bots-row">
                        <span style={{ fontWeight: 600, fontSize: 11.5 }}>
                          {ev.actor?.kind === 'owner' ? (zh ? '你' : 'You') : (ev.actor?.kind || 'Bot')}
                        </span>
                        <span className="dsh-bots-muted">{formatRelativeTime(ev.createdAt, now, locale)}</span>
                      </div>
                      <div style={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>{eventSummaryText(ev, zh)}</div>
                      {(evImages.length > 0 || evFiles.length > 0) && (
                        <div className="dsh-bots-att-strip">
                          {evImages.map((img, i) => (
                            <span key={`ev-img-${i}`} className="dsh-bots-att-chip">
                              {img.dataUrl ? (
                                <img src={img.dataUrl} alt={img.name || 'image'} className="dsh-bots-att-thumb" />
                              ) : null}
                              <span className="dsh-bots-ellipsis">{img.name || (zh ? '图片' : 'Image')}</span>
                            </span>
                          ))}
                          {evFiles.map((f, i) => (
                            <span key={`ev-file-${i}`} className="dsh-bots-att-chip">
                              <IconFileText size={11} />
                              <span className="dsh-bots-ellipsis">{f.name || (zh ? '附件' : 'File')}</span>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}

                {pendingComments.map((entry) => (
                  <div
                    key={entry.requestId}
                    className={`dsh-bots-timeline-entry dsh-bots-timeline-pending ${entry.status === 'failed' ? 'dsh-bots-timeline-failed' : ''}`.trim()}
                  >
                    <div className="dsh-bots-row">
                      <span style={{ fontWeight: 600, fontSize: 11.5 }}>{zh ? '你' : 'You'}</span>
                      <span className="dsh-bots-muted">
                        {entry.status === 'sending' ? (zh ? '发送中…' : 'Sending…') : (zh ? '发送失败' : 'Failed')}
                      </span>
                    </div>
                    <div style={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>{entry.text}</div>
                    {entry.status === 'failed' && (
                      <div className="dsh-bots-pending-actions">
                        {entry.error && <span className="dsh-bots-pending-err">{entry.error}</span>}
                        <button
                          type="button"
                          className="dsh-bots-pbtn dsh-bots-pbtn-xs dsh-bots-pbtn-primary"
                          onClick={() => handleRetryPending(entry)}
                        >
                          <IconRefresh size={11} />
                          <span>{zh ? '重试' : 'Retry'}</span>
                        </button>
                        <button
                          type="button"
                          className="dsh-bots-pbtn dsh-bots-pbtn-xs dsh-bots-pbtn-ghost"
                          onClick={() => setPendingComments((prev) => prev.filter((p) => p.requestId !== entry.requestId))}
                        >
                          <span>{zh ? '移除' : 'Dismiss'}</span>
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div
            className={`dsh-bots-psection dsh-bots-item-composer ${dragActive ? 'dsh-bots-item-composer-drag' : ''}`.trim()}
            onDragOver={(e) => {
              e.preventDefault();
              if (!dragActive) setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={handleDrop}
          >
            {replyingActive && (
              <BotItemReplyingTo
                summary={questionSummary}
                onJumpToQuestion={jumpToQuestionEvent}
                onDismiss={() => setDismissedQuestionKey(questionKey)}
              />
            )}

            {hasOpenQuestion && !replyingActive && (
              <div className="dsh-bots-plain-banner">
                <span>{zh ? '普通评论模式（不会结题）' : 'Plain comment (won’t close question)'}</span>
                <button
                  type="button"
                  className="dsh-bots-link-btn"
                  onClick={() => setDismissedQuestionKey(null)}
                >
                  {zh ? '改为回复提问' : 'Reply to question'}
                </button>
              </div>
            )}

            {attachments.length > 0 && (
              <div className="dsh-bots-att-strip">
                {attachments.map((att) => (
                  <div key={att.id} className="dsh-bots-att-chip">
                    {att.kind === 'image' && att.dataUrl ? (
                      <img src={att.dataUrl} alt={att.name} className="dsh-bots-att-thumb" />
                    ) : (
                      <IconFileText size={12} />
                    )}
                    <span className="dsh-bots-ellipsis" title={`${att.name} (${formatBytes(att.bytes)})`}>
                      {att.name}
                    </span>
                    <button
                      type="button"
                      className="dsh-bots-att-remove"
                      aria-label={zh ? `移除 ${att.name}` : `Remove ${att.name}`}
                      onClick={() => setAttachments((prev) => prev.filter((x) => x.id !== att.id))}
                    >
                      <IconX size={10} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <textarea
              ref={composerRef}
              className={`dsh-bots-ptextarea dsh-bots-composer-textarea ${composerGlow ? 'dsh-bots-composer-glow' : ''}`.trim()}
              rows={replyingActive ? 4 : 2}
              placeholder={replyingActive
                ? (zh ? '回复机器人的提问，或粘贴/拖入图片与文件… (Ctrl+Enter 发送)' : 'Reply to the question, or paste/drop files… (Ctrl+Enter)')
                : (zh ? '添加评论，或粘贴/拖入图片与文件… (Ctrl+Enter 发送)' : 'Add a comment, or paste/drop files… (Ctrl+Enter)')}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              onPaste={handlePaste}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                  e.preventDefault();
                  void submitComment();
                }
              }}
            />

            <input
              ref={fileInputRef}
              type="file"
              multiple
              style={{ display: 'none' }}
              onChange={(e) => {
                if (e.target.files) {
                  void addFilesAsAttachments(e.target.files);
                }
                e.target.value = '';
              }}
            />

            <div className="dsh-bots-row">
              <button
                type="button"
                className="dsh-bots-pbtn dsh-bots-pbtn-xs dsh-bots-pbtn-ghost"
                title={zh ? '添加图片或文件附件' : 'Attach images or files'}
                onClick={() => fileInputRef.current?.click()}
              >
                <IconUpload size={12} />
                <span>{zh ? '附件' : 'Attach'}</span>
              </button>

              <button
                type="button"
                className="dsh-bots-pbtn dsh-bots-pbtn-xs dsh-bots-pbtn-primary"
                disabled={(!comment.trim() && attachments.length === 0) || submitting}
                onClick={() => void submitComment()}
              >
                <IconSend size={11} />
                <span>
                  {replyingActive
                    ? (zh ? '回复提问' : 'Send reply')
                    : (zh ? '发送评论' : 'Send comment')}
                </span>
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
