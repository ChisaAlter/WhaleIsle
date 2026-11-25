// Right-panel Activity tab lower sections:
// 3. Upcoming (Automations sorted failed -> running -> soonest -> paused, capped at 5 with fold
//    keeping failed/broken rows visible even when collapsed; '+' opens Home Chat with prefill draft;
//    Look Around, Tidy Up, one-shot Waits + Cancel)
// 4. Up Next (Look Around suggestion cards with bots.upNext.seen/unseen unread dots,
//    clickable external links, Start/Dismiss + Look Now)

import { useEffect, useMemo, useRef, useState } from 'react';
import { botLookAround, nextLookAroundAt } from '../../shared/bot-look-around.js';
import { TIDY_UP_HOURS, botTidyUp } from '../../shared/bot-tidy-up.js';
import { botsStore, useBotsLocale } from '../store/bots-store';
import { RPC_METHODS, callBotRpc, type BotRecord } from '../store/rpc';
import { BotChevron, BotDisclosure } from './BotDisclosure';
import {
  IconAlertTriangle,
  IconExternalLink,
  IconEye,
  IconEyeOff,
  IconPause,
  IconPlay,
  IconPlus,
  IconRefresh,
  IconSparkles,
  IconTrash,
  IconZap,
} from './Icons';

export interface AutomationRow {
  id: string;
  botId: string;
  name: string;
  prompt: string;
  schedule?: string | null;
  intervalMinutes?: number | null;
  once?: { by?: number; label?: string } | null;
  enabled: boolean;
  running?: boolean;
  nextRunAt?: number | null;
  lastRunAt?: number | null;
  lastStatus?: string | null;
  lastError?: string | null;
}

export interface SuggestionRow {
  id: string;
  title: string;
  why?: string;
  summary?: string;
  ask?: string;
  link?: string;
  url?: string;
  status?: string;
  seen?: boolean;
  unread?: boolean;
  seenAt?: number | null;
  createdAt?: number;
}

export interface BotActivityUpcomingProps {
  bot: BotRecord;
  now: number;
  automations: AutomationRow[];
  suggestions: SuggestionRow[];
  upNextSeenAt?: number | null;
  onReload: () => void;
}

interface SuggestionStartResult {
  ok?: boolean;
  started?: boolean;
  background?: boolean;
  alreadyResolved?: boolean;
  status?: string;
  error?: string;
  turnError?: string;
  sessionId?: string;
}

interface SuggestionDismissResult {
  ok?: boolean;
  alreadyDismissed?: boolean;
  error?: string;
}

interface LookAroundNowResult {
  ok?: boolean;
  started?: boolean;
  background?: boolean;
  alreadyRunning?: boolean;
  skipped?: boolean;
  reason?: string;
  summary?: string;
  error?: string;
  runId?: string;
  botId?: string;
}

interface AutomationRunNowResult {
  ok?: boolean;
  started?: boolean;
  background?: boolean;
  alreadyRunning?: boolean;
  skipped?: boolean;
  reason?: string;
  budgetReason?: string;
  automationId?: string;
  summary?: string;
  error?: string;
}

function formatSuggestionStartFailure(res: SuggestionStartResult, zh: boolean): string {
  if (res.error) return res.error;
  if (res.alreadyResolved) {
    const suffix = res.status ? (zh ? `（${res.status}）` : ` (${res.status})`) : '';
    return zh ? `该建议已处理${suffix}` : `Suggestion already resolved${suffix}`;
  }
  if (res.status) {
    return zh ? `无法执行该建议（${res.status}）` : `Cannot start suggestion (${res.status})`;
  }
  return zh ? '启动建议失败' : 'Failed to start suggestion';
}

function formatLookNowFailure(res: LookAroundNowResult, zh: boolean): string {
  if (res.reason === 'budget_exceeded') {
    return zh ? '巡视跳过：超出预算限制' : 'Look around skipped: budget_exceeded';
  }
  if (res.reason === 'off_peak_only') {
    return zh ? '巡视跳过：仅谷段运行' : 'Look around skipped: off_peak_only';
  }
  const detail = res.summary || res.error || res.reason;
  if (res.skipped) {
    return detail
      ? (zh ? `巡视跳过：${detail}` : `Look around skipped: ${detail}`)
      : (zh ? '巡视已跳过' : 'Look around skipped');
  }
  return detail
    ? (zh ? `巡视失败：${detail}` : `Look around failed: ${detail}`)
    : (zh ? '巡视失败' : 'Look around failed');
}

function formatAutomationRunFailure(res: AutomationRunNowResult, name: string, zh: boolean): string {
  const budgetCode = res.budgetReason || res.reason;
  if (budgetCode === 'budget_exceeded') {
    return zh ? `任务跳过（超出预算限制）：${name}` : `Automation skipped (budget_exceeded): ${name}`;
  }
  if (budgetCode === 'off_peak_only') {
    return zh ? `任务跳过（仅谷段运行）：${name}` : `Automation skipped (off_peak_only): ${name}`;
  }
  if (res.skipped || res.reason === 'skipped_budget') {
    const detail = res.budgetReason || res.error || res.summary || res.reason;
    return detail
      ? (zh ? `任务跳过（${name}）：${detail}` : `Automation skipped (${name}): ${detail}`)
      : (zh ? `任务已跳过：${name}` : `Automation skipped: ${name}`);
  }
  const detail = res.error || res.reason || res.summary;
  return detail
    ? (zh ? `运行失败（${name}）：${detail}` : `Failed to run ${name}: ${detail}`)
    : (zh ? `运行失败：${name}` : `Failed to run ${name}`);
}

const MAX_VISIBLE_AUTOMATIONS = 5;
const AUTOMATION_DRAFT_PREFILL_EVENT = 'dsh-bots:prefill-chat-draft';

function isAutomationFailed(auto: AutomationRow): boolean {
  const st = (auto.lastStatus ?? '').toLowerCase();
  return Boolean(auto.lastError)
    || st === 'failed'
    || st === 'error'
    || st === 'needs_auth'
    || st === 'auth_required';
}

function isAutomationRunning(auto: AutomationRow): boolean {
  const st = (auto.lastStatus ?? '').toLowerCase();
  return Boolean(auto.running) || st === 'running';
}

function sortAutomations(list: AutomationRow[]): AutomationRow[] {
  const rank = (auto: AutomationRow): number => {
    if (isAutomationFailed(auto)) return 0;
    if (isAutomationRunning(auto)) return 1;
    if (auto.enabled) return 2;
    return 3;
  };
  return [...list].sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    if (ra === 2) {
      const na = typeof a.nextRunAt === 'number' ? a.nextRunAt : Number.MAX_SAFE_INTEGER;
      const nb = typeof b.nextRunAt === 'number' ? b.nextRunAt : Number.MAX_SAFE_INTEGER;
      if (na !== nb) return na - nb;
    }
    return (b.lastRunAt ?? 0) - (a.lastRunAt ?? 0) || a.name.localeCompare(b.name);
  });
}

function isSuggestionUnread(sug: SuggestionRow, fallbackSeenAt?: number | null): boolean {
  if (typeof sug.unread === 'boolean') return sug.unread;
  if (typeof sug.seen === 'boolean') return !sug.seen;
  const effectiveSeenAt = typeof sug.seenAt === 'number'
    ? sug.seenAt
    : (typeof fallbackSeenAt === 'number' ? fallbackSeenAt : null);
  if (typeof effectiveSeenAt === 'number' && typeof sug.createdAt === 'number') {
    return sug.createdAt > effectiveSeenAt;
  }
  return false;
}

function computeNextTidyUpAt(cfg: { on: boolean; every: 'night' | 'week' }, now: number): number | null {
  if (!cfg.on) {
    return null;
  }
  const d = new Date(now);
  d.setHours(TIDY_UP_HOURS.from, 0, 0, 0);
  if (d.getTime() <= now) {
    d.setDate(d.getDate() + 1);
  }
  if (cfg.every === 'week') {
    while (d.getDay() !== 0) {
      d.setDate(d.getDate() + 1);
    }
  }
  return d.getTime();
}

function formatFutureTime(ts: number | null | undefined, locale: string): string {
  if (!ts || !Number.isFinite(ts)) {
    return '—';
  }
  return new Date(ts).toLocaleString(locale, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function BotActivityUpcoming({
  bot,
  now,
  automations,
  suggestions,
  upNextSeenAt,
  onReload,
}: BotActivityUpcomingProps) {
  const { locale, tr } = useBotsLocale();
  const zh = locale === 'zh-CN';
  const [lookingNow, setLookingNow] = useState(false);
  const [creatingAuto, setCreatingAuto] = useState(false);
  const [autoName, setAutoName] = useState('');
  const [autoPrompt, setAutoPrompt] = useState('');
  const [autoInterval, setAutoInterval] = useState('60');
  const [autosSectionOpen, setAutosSectionOpen] = useState(true);
  const [showAllAutos, setShowAllAutos] = useState(false);
  const [localUnreadIds, setLocalUnreadIds] = useState<Record<string, boolean>>({});
  const [busySuggestionIds, setBusySuggestionIds] = useState<Record<string, 'start' | 'dismiss'>>({});
  const [busyAutoActions, setBusyAutoActions] = useState<Record<string, 'run' | 'update' | 'delete'>>({});
  const markedSeenForBotRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  const activeBotIdRef = useRef(bot.id);
  const lookingNowRef = useRef(false);
  const busySuggestionRef = useRef<Set<string>>(new Set());
  const busyAutoRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    activeBotIdRef.current = bot.id;
    lookingNowRef.current = false;
    busySuggestionRef.current.clear();
    busyAutoRef.current.clear();
    setLookingNow(false);
    setBusySuggestionIds({});
    setBusyAutoActions({});
    setLocalUnreadIds({});
  }, [bot.id]);

  const isCurrentBot = (targetBotId: string) => (
    mountedRef.current && activeBotIdRef.current === targetBotId
  );

  const scheduledAutos = useMemo(
    () => sortAutomations(automations.filter((a) => !a.once)),
    [automations],
  );
  const failedAutos = useMemo(
    () => scheduledAutos.filter(isAutomationFailed),
    [scheduledAutos],
  );
  const visibleAutos = useMemo(() => {
    if (showAllAutos || scheduledAutos.length <= MAX_VISIBLE_AUTOMATIONS) {
      return scheduledAutos;
    }
    const head = scheduledAutos.slice(0, MAX_VISIBLE_AUTOMATIONS);
    const headIds = new Set(head.map((a) => a.id));
    // Ensure all failed rows remain visible even when capped.
    const extraFailed = failedAutos.filter((a) => !headIds.has(a.id));
    return [...head, ...extraFailed];
  }, [failedAutos, scheduledAutos, showAllAutos]);

  const hiddenAutoCount = Math.max(0, scheduledAutos.length - visibleAutos.length);
  const oneShotWaits = automations.filter((a) => Boolean(a.once) && a.enabled);
  const lookCfg = botLookAround(bot);
  const tidyCfg = botTidyUp(bot);
  const nextLookTs = bot.paused ? null : nextLookAroundAt(lookCfg, now);
  const nextTidyTs = bot.paused ? null : computeNextTidyUpAt(tidyCfg as { on: boolean; every: 'night' | 'week' }, now);

  // Sync unread markers from server and automatically mark seen when viewing Up Next.
  const unreadSuggestions = useMemo(
    () => suggestions.filter((sug) => (
      localUnreadIds[sug.id] !== undefined ? localUnreadIds[sug.id] : isSuggestionUnread(sug, upNextSeenAt)
    )),
    [localUnreadIds, suggestions, upNextSeenAt],
  );

  useEffect(() => {
    const serverUnread = suggestions.filter((sug) => isSuggestionUnread(sug, upNextSeenAt));
    if (serverUnread.length === 0) {
      return;
    }
    const key = `${bot.id}:${serverUnread.map((s) => s.id).join(',')}`;
    if (markedSeenForBotRef.current === key) {
      return;
    }
    markedSeenForBotRef.current = key;
    const timer = window.setTimeout(() => {
      void callBotRpc(RPC_METHODS.UP_NEXT_SEEN, {
        botId: bot.id,
        ids: serverUnread.map((s) => s.id),
      }).catch((err) => {
        console.warn('[dsh-bots] upNext.seen failed', err);
      });
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [bot.id, suggestions, upNextSeenAt]);

  const toggleSuggestionUnread = async (sug: SuggestionRow, nextUnread: boolean) => {
    setLocalUnreadIds((prev) => ({ ...prev, [sug.id]: nextUnread }));
    try {
      await callBotRpc(nextUnread ? RPC_METHODS.UP_NEXT_UNSEEN : RPC_METHODS.UP_NEXT_SEEN, {
        botId: bot.id,
        id: sug.id,
        suggestionId: sug.id,
        ids: [sug.id],
      });
      onReload();
    } catch (err) {
      setLocalUnreadIds((prev) => ({ ...prev, [sug.id]: !nextUnread }));
      botsStore.pushToast({ message: err instanceof Error ? err.message : String(err), tone: 'error' });
    }
  };

  const handleOpenHomeForNewAutomation = () => {
    const draftText = zh
      ? '请帮我创建一个定时自动化任务：\n- 执行频率：\n- 需要做的事：'
      : 'Help me set up a scheduled automation:\n- Schedule:\n- What to do:';
    const sessionId = bot.chatSessionId ?? bot.homeSessionId ?? null;
    try {
      window.sessionStorage?.setItem(`dsh-bots.prefillDraft:${bot.id}`, draftText);
      window.dispatchEvent(new CustomEvent(AUTOMATION_DRAFT_PREFILL_EVENT, {
        detail: { botId: bot.id, sessionId, text: draftText },
      }));
    } catch {
      // Ignore storage errors.
    }
    void botsStore.openBotHome(bot.id);
    botsStore.pushToast({
      message: zh ? '已打开主对话并准备自动化草稿，可直接与队友对话配置' : 'Opened Home Chat with an automation draft',
      tone: 'info',
    });
  };

  const handleLookNow = async () => {
    if (lookingNowRef.current) {
      return;
    }
    const targetBotId = bot.id;
    lookingNowRef.current = true;
    setLookingNow(true);
    try {
      const res = await callBotRpc<LookAroundNowResult | null>(RPC_METHODS.LOOK_AROUND_NOW, {
        botId: targetBotId,
        background: true,
      });
      if (!isCurrentBot(targetBotId)) {
        return;
      }
      if (res && res.ok === false) {
        botsStore.pushToast({ message: formatLookNowFailure(res, zh), tone: 'error' });
        return;
      }
      if (res && res.alreadyRunning) {
        botsStore.pushToast({
          message: zh ? '巡视正在进行中' : 'Look around is already running',
          tone: 'info',
        });
        return;
      }
      botsStore.pushToast({
        message: zh ? '已启动立即巡视' : 'Look around sweep started',
        tone: 'success',
      });
      onReload();
    } catch (err) {
      if (isCurrentBot(targetBotId)) {
        botsStore.pushToast({ message: err instanceof Error ? err.message : String(err), tone: 'error' });
      }
    } finally {
      if (isCurrentBot(targetBotId)) {
        lookingNowRef.current = false;
        setLookingNow(false);
      }
    }
  };

  const handleStartSuggestion = async (sug: SuggestionRow) => {
    if (busySuggestionRef.current.has(sug.id)) {
      return;
    }
    const targetBotId = bot.id;
    busySuggestionRef.current.add(sug.id);
    setBusySuggestionIds((prev) => ({ ...prev, [sug.id]: 'start' }));
    void callBotRpc(RPC_METHODS.UP_NEXT_SEEN, { botId: targetBotId, ids: [sug.id] }).catch(() => {});
    try {
      const res = await callBotRpc<SuggestionStartResult | null>(RPC_METHODS.SUGGESTIONS_START, {
        botId: targetBotId,
        suggestionId: sug.id,
        background: true,
      });
      if (!isCurrentBot(targetBotId)) {
        return;
      }
      if (res && res.ok === false) {
        botsStore.pushToast({ message: formatSuggestionStartFailure(res, zh), tone: 'error' });
        if (res.alreadyResolved) {
          onReload();
        }
        return;
      }
      if (res && res.turnError) {
        botsStore.pushToast({ message: res.turnError, tone: 'error' });
        onReload();
        void botsStore.openBotHome(targetBotId);
        return;
      }
      onReload();
      void botsStore.openBotHome(targetBotId);
      botsStore.pushToast({
        message: zh ? `已开始执行：${sug.title}` : `Started: ${sug.title}`,
        tone: 'success',
      });
    } catch (err) {
      if (isCurrentBot(targetBotId)) {
        botsStore.pushToast({ message: err instanceof Error ? err.message : String(err), tone: 'error' });
      }
    } finally {
      if (isCurrentBot(targetBotId)) {
        busySuggestionRef.current.delete(sug.id);
        setBusySuggestionIds((prev) => {
          const next = { ...prev };
          delete next[sug.id];
          return next;
        });
      }
    }
  };

  const handleDismissSuggestion = async (sug: SuggestionRow) => {
    if (busySuggestionRef.current.has(sug.id)) {
      return;
    }
    const targetBotId = bot.id;
    busySuggestionRef.current.add(sug.id);
    setBusySuggestionIds((prev) => ({ ...prev, [sug.id]: 'dismiss' }));
    void callBotRpc(RPC_METHODS.UP_NEXT_SEEN, { botId: targetBotId, ids: [sug.id] }).catch(() => {});
    try {
      const res = await callBotRpc<SuggestionDismissResult | null>(RPC_METHODS.SUGGESTIONS_DISMISS, {
        botId: targetBotId,
        suggestionId: sug.id,
      });
      if (!isCurrentBot(targetBotId)) {
        return;
      }
      if (res && res.ok === false) {
        botsStore.pushToast({
          message: res.error || (zh ? '忽略建议失败' : 'Failed to dismiss suggestion'),
          tone: 'error',
        });
        return;
      }
      onReload();
      botsStore.pushToast({
        message: zh ? '已忽略建议' : 'Suggestion dismissed',
        tone: 'info',
      });
    } catch (err) {
      if (isCurrentBot(targetBotId)) {
        botsStore.pushToast({ message: err instanceof Error ? err.message : String(err), tone: 'error' });
      }
    } finally {
      if (isCurrentBot(targetBotId)) {
        busySuggestionRef.current.delete(sug.id);
        setBusySuggestionIds((prev) => {
          const next = { ...prev };
          delete next[sug.id];
          return next;
        });
      }
    }
  };

  const withBusyAuto = async (
    autoId: string,
    action: 'run' | 'update' | 'delete',
    fn: (targetBotId: string) => Promise<void>,
  ) => {
    if (busyAutoRef.current.has(autoId)) {
      return;
    }
    const targetBotId = bot.id;
    busyAutoRef.current.add(autoId);
    setBusyAutoActions((prev) => ({ ...prev, [autoId]: action }));
    try {
      await fn(targetBotId);
    } finally {
      if (isCurrentBot(targetBotId)) {
        busyAutoRef.current.delete(autoId);
        setBusyAutoActions((prev) => {
          const next = { ...prev };
          delete next[autoId];
          return next;
        });
      }
    }
  };

  const handleRunAutomation = (auto: AutomationRow) => withBusyAuto(auto.id, 'run', async (targetBotId) => {
    try {
      const res = await callBotRpc<AutomationRunNowResult | null>(RPC_METHODS.AUTOMATIONS_RUN_NOW, {
        id: auto.id,
        background: true,
      });
      if (!isCurrentBot(targetBotId)) {
        return;
      }
      if (res && res.ok === false) {
        botsStore.pushToast({ message: formatAutomationRunFailure(res, auto.name, zh), tone: 'error' });
        return;
      }
      if (res && res.alreadyRunning) {
        botsStore.pushToast({
          message: zh ? '任务正在运行中' : 'Automation is already running',
          tone: 'info',
        });
        return;
      }
      botsStore.pushToast({
        message: zh ? `已启动：${auto.name}` : `Started ${auto.name}`,
        tone: 'success',
      });
      onReload();
    } catch (err) {
      if (isCurrentBot(targetBotId)) {
        botsStore.pushToast({ message: err instanceof Error ? err.message : String(err), tone: 'error' });
      }
    }
  });

  const handleToggleAutomation = (auto: AutomationRow) => withBusyAuto(auto.id, 'update', async (targetBotId) => {
    try {
      await callBotRpc(RPC_METHODS.AUTOMATIONS_UPDATE, { id: auto.id, enabled: !auto.enabled });
      if (isCurrentBot(targetBotId)) {
        onReload();
      }
    } catch (err) {
      if (isCurrentBot(targetBotId)) {
        botsStore.pushToast({ message: err instanceof Error ? err.message : String(err), tone: 'error' });
      }
    }
  });

  const handleDeleteAutomation = (auto: AutomationRow) => withBusyAuto(auto.id, 'delete', async (targetBotId) => {
    try {
      await callBotRpc(RPC_METHODS.AUTOMATIONS_DELETE, { id: auto.id });
      if (isCurrentBot(targetBotId)) {
        onReload();
      }
    } catch (err) {
      if (isCurrentBot(targetBotId)) {
        botsStore.pushToast({ message: err instanceof Error ? err.message : String(err), tone: 'error' });
      }
    }
  });

  const handleCreateAuto = async () => {
    if (!autoPrompt.trim()) {
      return;
    }
    try {
      await callBotRpc('bots.automations.create', {
        botId: bot.id,
        name: autoName.trim() || (zh ? '定时任务' : 'Scheduled task'),
        prompt: autoPrompt.trim(),
        intervalMinutes: Math.max(5, Number(autoInterval) || 60),
        enabled: true,
      });
      setAutoName('');
      setAutoPrompt('');
      setCreatingAuto(false);
      onReload();
    } catch (err) {
      botsStore.pushToast({ message: err instanceof Error ? err.message : String(err), tone: 'error' });
    }
  };

  const renderAutomationCard = (auto: AutomationRow) => {
    const failed = isAutomationFailed(auto);
    const running = isAutomationRunning(auto);
    const busyAction = busyAutoActions[auto.id];
    const rowBusy = Boolean(busyAction);
    return (
      <div
        key={auto.id}
        className={`dsh-bots-pcard ${failed ? 'dsh-bots-auto-card-failed' : ''}`.trim()}
      >
        <div className="dsh-bots-row">
          <span className="dsh-bots-row-left" style={{ fontWeight: 600 }}>
            {failed && <IconAlertTriangle size={12} className="dsh-bots-text-danger" />}
            <span className="dsh-bots-ellipsis">{auto.name}</span>
            {failed && <span className="dsh-bots-badge dsh-bots-badge-danger">{zh ? '异常' : 'Failed'}</span>}
            {!failed && running && <span className="dsh-bots-badge dsh-bots-badge-accent">{zh ? '运行中' : 'Running'}</span>}
          </span>
          <div style={{ display: 'inline-flex', gap: 2 }}>
            <button
              type="button"
              className="dsh-bots-pbtn dsh-bots-pbtn-xs"
              disabled={rowBusy}
              onClick={() => void handleRunAutomation(auto)}
            >
              <IconPlay size={10} />
              <span>{busyAction === 'run' ? (zh ? '启动中…' : 'Starting…') : (zh ? '运行' : 'Run')}</span>
            </button>
            <button
              type="button"
              className="dsh-bots-pbtn dsh-bots-pbtn-xs dsh-bots-pbtn-icon"
              title={auto.enabled ? (zh ? '暂停' : 'Pause') : (zh ? '恢复' : 'Resume')}
              disabled={rowBusy}
              onClick={() => void handleToggleAutomation(auto)}
            >
              {auto.enabled ? <IconPause size={11} /> : <IconPlay size={11} />}
            </button>
            <button
              type="button"
              className="dsh-bots-pbtn dsh-bots-pbtn-xs dsh-bots-pbtn-icon dsh-bots-pbtn-danger"
              title={zh ? '删除' : 'Delete'}
              disabled={rowBusy}
              onClick={() => void handleDeleteAutomation(auto)}
            >
              <IconTrash size={11} />
            </button>
          </div>
        </div>
        {failed && auto.lastError && (
          <div className="dsh-bots-auto-error">{auto.lastError}</div>
        )}
        <div className="dsh-bots-muted dsh-bots-ellipsis">
          {auto.enabled ? formatFutureTime(auto.nextRunAt, locale) : (zh ? '已暂停' : 'Paused')}
          {auto.schedule ? ` · ${auto.schedule}` : auto.intervalMinutes ? ` · ${auto.intervalMinutes}m` : ''}
        </div>
      </div>
    );
  };

  return (
    <>
      <div className="dsh-bots-psection">
        <div className="dsh-bots-section-head">
          <button
            type="button"
            className="dsh-bots-section-toggle"
            aria-expanded={autosSectionOpen}
            onClick={() => setAutosSectionOpen((prev) => !prev)}
          >
            <BotChevron open={autosSectionOpen} size={12} />
            <IconZap size={12} />
            <span>{tr('bots.upcoming.title', 'Upcoming')}</span>
            {scheduledAutos.length > 0 && <span className="dsh-bots-badge">{scheduledAutos.length}</span>}
            {failedAutos.length > 0 && (
              <span className="dsh-bots-badge dsh-bots-badge-danger" title={zh ? '存在异常自动化' : 'Failed automations'}>
                {failedAutos.length}
              </span>
            )}
          </button>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <button
              type="button"
              className="dsh-bots-pbtn dsh-bots-pbtn-xs dsh-bots-pbtn-ghost"
              title={zh ? '手动填写定时任务表单' : 'Quick manual form'}
              onClick={() => {
                setAutosSectionOpen(true);
                setCreatingAuto((prev) => !prev);
              }}
            >
              {zh ? '手动' : 'Form'}
            </button>
            <button
              type="button"
              className="dsh-bots-pbtn dsh-bots-pbtn-xs dsh-bots-pbtn-icon"
              aria-label={zh ? '在主对话新建自动化' : 'New automation in Home Chat'}
              title={zh ? '打开主对话并预填草稿创建自动化' : 'Open Home Chat with automation draft'}
              onClick={handleOpenHomeForNewAutomation}
            >
              <IconPlus size={12} />
            </button>
          </div>
        </div>

        {/* Even when collapsed, keep failed/broken automation rows visible so alerts are never hidden. */}
        {!autosSectionOpen && failedAutos.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {failedAutos.map(renderAutomationCard)}
          </div>
        )}

        <BotDisclosure open={autosSectionOpen}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {creatingAuto && (
              <div className="dsh-bots-pcard">
                <input
                  type="text"
                  className="dsh-bots-pinput"
                  placeholder={zh ? '自动化名称（如每日晨报）' : 'Automation name'}
                  value={autoName}
                  onChange={(e) => setAutoName(e.target.value)}
                />
                <textarea
                  className="dsh-bots-ptextarea"
                  rows={2}
                  placeholder={zh ? '触发时给机器人的指令…' : 'Prompt to run when triggered…'}
                  value={autoPrompt}
                  onChange={(e) => setAutoPrompt(e.target.value)}
                />
                <div className="dsh-bots-row">
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5 }}>
                    <span>{zh ? '间隔(分钟)' : 'Every (min)'}</span>
                    <input
                      type="number"
                      min={5}
                      className="dsh-bots-pinput"
                      style={{ width: 72, padding: '3px 6px' }}
                      value={autoInterval}
                      onChange={(e) => setAutoInterval(e.target.value)}
                    />
                  </label>
                  <div style={{ display: 'inline-flex', gap: 6 }}>
                    <button type="button" className="dsh-bots-pbtn dsh-bots-pbtn-xs" onClick={() => setCreatingAuto(false)}>
                      {zh ? '取消' : 'Cancel'}
                    </button>
                    <button
                      type="button"
                      className="dsh-bots-pbtn dsh-bots-pbtn-xs dsh-bots-pbtn-primary"
                      disabled={!autoPrompt.trim()}
                      onClick={() => void handleCreateAuto()}
                    >
                      {zh ? '保存' : 'Create'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            <div className="dsh-bots-pcard" style={{ gap: 5 }}>
              <div className="dsh-bots-row">
                <span style={{ fontWeight: 500 }}>{tr('settings.bots.lookAround.title', 'Look around')}</span>
                <span className="dsh-bots-muted">
                  {lookCfg.on ? formatFutureTime(nextLookTs, locale) : (zh ? '已关闭' : 'Off')}
                </span>
              </div>
              <div className="dsh-bots-row">
                <span style={{ fontWeight: 500 }}>{tr('settings.bots.tidyUp.title', 'Tidy up')}</span>
                <span className="dsh-bots-muted">
                  {tidyCfg.on ? formatFutureTime(nextTidyTs, locale) : (zh ? '已关闭' : 'Off')}
                </span>
              </div>
            </div>

            {visibleAutos.map(renderAutomationCard)}

            {hiddenAutoCount > 0 && (
              <button
                type="button"
                className="dsh-bots-pbtn dsh-bots-pbtn-xs dsh-bots-pbtn-ghost"
                onClick={() => setShowAllAutos(true)}
              >
                {zh ? `展开其余 ${hiddenAutoCount} 条定时任务` : `Show ${hiddenAutoCount} more automations`}
              </button>
            )}

            {showAllAutos && scheduledAutos.length > MAX_VISIBLE_AUTOMATIONS && (
              <button
                type="button"
                className="dsh-bots-pbtn dsh-bots-pbtn-xs dsh-bots-pbtn-ghost"
                onClick={() => setShowAllAutos(false)}
              >
                {zh ? '收起部分定时任务' : 'Show fewer automations'}
              </button>
            )}

            {oneShotWaits.map((wait) => (
              <div key={wait.id} className="dsh-bots-settings-row">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="dsh-bots-ellipsis" style={{ fontWeight: 500 }}>{wait.name}</div>
                  <div className="dsh-bots-muted">{formatFutureTime(wait.once?.by ?? wait.nextRunAt, locale)}</div>
                </div>
                <button
                  type="button"
                  className="dsh-bots-pbtn dsh-bots-pbtn-xs"
                  onClick={() => {
                    void callBotRpc('bots.automations.cancelWait', { botId: bot.id, waitId: wait.id })
                      .then(() => onReload())
                      .catch((err) => botsStore.pushToast({ message: String(err), tone: 'error' }));
                  }}
                >
                  {zh ? '取消等待' : 'Cancel'}
                </button>
              </div>
            ))}
          </div>
        </BotDisclosure>
      </div>

      <div className="dsh-bots-psection">
        <div className="dsh-bots-section-head">
          <span className="dsh-bots-section-title">
            <IconSparkles size={12} />
            <span>{tr('bots.upNext.title', 'Up next')}</span>
            {suggestions.length > 0 && <span className="dsh-bots-badge">{suggestions.length}</span>}
            {unreadSuggestions.length > 0 && (
              <span
                className="dsh-bots-unread-dot"
                title={zh ? `${unreadSuggestions.length} 条未读建议` : `${unreadSuggestions.length} unread`}
              />
            )}
          </span>
          <button
            type="button"
            className="dsh-bots-pbtn dsh-bots-pbtn-xs"
            disabled={lookingNow || bot.paused}
            onClick={() => void handleLookNow()}
          >
            <IconRefresh size={11} />
            <span>{lookingNow ? tr('settings.bots.lookAround.looking', 'Looking…') : tr('bots.upNext.lookNow', 'Look now')}</span>
          </button>
        </div>

        {suggestions.length === 0 ? (
          <div className="dsh-bots-empty">
            {zh ? '暂无巡视建议。点击「立即巡视」让大肥鱼队友扫描近期上下文。' : 'No suggestions right now.'}
          </div>
        ) : (
          suggestions.map((sug) => {
            const unread = localUnreadIds[sug.id] !== undefined
              ? localUnreadIds[sug.id]
              : isSuggestionUnread(sug, upNextSeenAt);
            const href = sug.link || sug.url || null;
            const busyAction = busySuggestionIds[sug.id];
            const cardBusy = Boolean(busyAction);
            return (
              <div
                key={sug.id}
                className="dsh-bots-pcard"
                data-unread={unread ? 'true' : 'false'}
              >
                <div className="dsh-bots-row">
                  <span className="dsh-bots-row-left" style={{ fontWeight: 600 }}>
                    {unread && <span className="dsh-bots-unread-dot" aria-label={zh ? '未读' : 'Unread'} />}
                    <span className="dsh-bots-ellipsis">{sug.title}</span>
                  </span>
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                    {href && (
                      <a
                        href={href}
                        target="_blank"
                        rel="noreferrer"
                        className="dsh-bots-pbtn dsh-bots-pbtn-xs dsh-bots-pbtn-icon"
                        title={zh ? `打开关联链接：${href}` : `Open link: ${href}`}
                      >
                        <IconExternalLink size={11} />
                      </a>
                    )}
                    <button
                      type="button"
                      className="dsh-bots-pbtn dsh-bots-pbtn-xs dsh-bots-pbtn-icon"
                      title={unread ? (zh ? '标为已读' : 'Mark as read') : (zh ? '标为未读' : 'Mark as unread')}
                      disabled={cardBusy}
                      onClick={() => void toggleSuggestionUnread(sug, !unread)}
                    >
                      {unread ? <IconEye size={11} /> : <IconEyeOff size={11} />}
                    </button>
                  </div>
                </div>
                {(sug.why || sug.summary) && (
                  <div className="dsh-bots-muted">{sug.why || sug.summary}</div>
                )}
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    type="button"
                    className="dsh-bots-pbtn dsh-bots-pbtn-xs dsh-bots-pbtn-primary"
                    disabled={cardBusy}
                    onClick={() => void handleStartSuggestion(sug)}
                  >
                    {busyAction === 'start'
                      ? (zh ? '执行中…' : 'Starting…')
                      : tr('bots.upNext.start', 'Start')}
                  </button>
                  <button
                    type="button"
                    className="dsh-bots-pbtn dsh-bots-pbtn-xs"
                    disabled={cardBusy}
                    onClick={() => void handleDismissSuggestion(sug)}
                  >
                    {busyAction === 'dismiss'
                      ? (zh ? '忽略中…' : 'Dismissing…')
                      : tr('bots.upNext.dismiss', 'Dismiss')}
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </>
  );
}
