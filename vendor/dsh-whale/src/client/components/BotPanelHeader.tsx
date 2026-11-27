// Right-panel header for a Bot: clickable 32px AvatarPicker trigger, name, live status
// (idle state shows next scheduled run time, simplifying cleanly in narrow columns),
// filter toggle, inline settings gear button, and '...' overflow menu.

import { useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_BOT_AVATAR_COLOR, normalizeBotAvatarColor } from '../../shared/bot-avatar-color.js';
import { botLookAround, nextLookAroundAt } from '../../shared/bot-look-around.js';
import { TIDY_UP_HOURS, botTidyUp } from '../../shared/bot-tidy-up.js';
import { botsStore, useBotsLocale, useBotsState, useNow } from '../store/bots-store';
import {
  RPC_METHODS,
  callBotRpc,
  invalidateUploadedAvatarCache,
  type BotRecord,
} from '../store/rpc';
import { AvatarPickerPopover, type AvatarPickerValue, type CroppedAvatarImage } from './AvatarPicker';
import { BotAvatar } from './BotAvatar';
import {
  IconCopy,
  IconMoreHorizontal,
  IconPause,
  IconPlay,
  IconSettings,
  IconShare,
  IconSliders,
} from './Icons';

export interface BotPanelHeaderProps {
  bot: BotRecord;
  subtitle?: string;
  nextRunAt?: number | null;
  showFilterToggle?: boolean;
  filterOpen?: boolean;
  onToggleFilter?: () => void;
  onOpenSettings: () => void;
}

interface AutomationSummary {
  enabled?: boolean;
  nextRunAt?: number | null;
  once?: { by?: number } | null;
}

function computeNextTidyUpAt(cfg: { on: boolean; every: 'night' | 'week' }, now: number): number | null {
  if (!cfg.on) return null;
  const d = new Date(now);
  d.setHours(TIDY_UP_HOURS.from, 0, 0, 0);
  if (d.getTime() <= now) d.setDate(d.getDate() + 1);
  if (cfg.every === 'week') {
    while (d.getDay() !== 0) d.setDate(d.getDate() + 1);
  }
  return d.getTime();
}

function formatNextRunTime(ts: number, now: number, locale: 'zh-CN' | 'en-US'): string {
  const target = new Date(ts);
  const current = new Date(now);
  const sameDay = target.getFullYear() === current.getFullYear()
    && target.getMonth() === current.getMonth()
    && target.getDate() === current.getDate();
  const timeText = target.toLocaleTimeString(locale, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  if (sameDay) {
    return timeText;
  }
  const tomorrow = new Date(current);
  tomorrow.setDate(current.getDate() + 1);
  const isTomorrow = target.getFullYear() === tomorrow.getFullYear()
    && target.getMonth() === tomorrow.getMonth()
    && target.getDate() === tomorrow.getDate();
  if (isTomorrow) {
    return locale === 'zh-CN' ? `明天 ${timeText}` : `Tomorrow ${timeText}`;
  }
  const dateText = target.toLocaleDateString(locale, { month: 'short', day: 'numeric' });
  return `${dateText} ${timeText}`;
}

export function BotPanelHeader({
  bot,
  subtitle,
  nextRunAt,
  showFilterToggle = false,
  filterOpen = false,
  onToggleFilter,
  onOpenSettings,
}: BotPanelHeaderProps) {
  const { locale, tr } = useBotsLocale();
  const zh = locale === 'zh-CN';
  const now = useNow(60_000);
  const changeSeq = useBotsState((state) => state.changeSeq);
  const headerRef = useRef<HTMLDivElement | null>(null);
  const avatarBtnRef = useRef<HTMLButtonElement | null>(null);
  const moreRef = useRef<HTMLDivElement | null>(null);
  const [pickerRect, setPickerRect] = useState<DOMRect | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const [earliestAutoTs, setEarliestAutoTs] = useState<number | null>(null);

  // Detect narrow right panel width so idle subtitle cleanly simplifies to "下次 20:00".
  useEffect(() => {
    const el = headerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') {
      return undefined;
    }
    const update = () => {
      setNarrow(el.clientWidth > 0 && el.clientWidth < 270);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Fetch earliest scheduled automation run if caller did not pass explicit nextRunAt.
  useEffect(() => {
    if (nextRunAt !== undefined || bot.paused) {
      setEarliestAutoTs(null);
      return undefined;
    }
    let cancelled = false;
    void callBotRpc<AutomationSummary[] | { automations?: AutomationSummary[] }>('bots.automations.list', {
      botId: bot.id,
    }).then((res) => {
      if (cancelled) return;
      const list = Array.isArray(res) ? res : (res?.automations ?? []);
      const candidates = list
        .filter((a) => a.enabled !== false)
        .map((a) => a.once?.by ?? a.nextRunAt)
        .filter((ts): ts is number => typeof ts === 'number' && Number.isFinite(ts) && ts > Date.now());
      setEarliestAutoTs(candidates.length > 0 ? Math.min(...candidates) : null);
    }).catch(() => {
      if (!cancelled) setEarliestAutoTs(null);
    });
    return () => {
      cancelled = true;
    };
  }, [bot.id, bot.paused, changeSeq, nextRunAt]);

  useEffect(() => {
    if (!moreOpen) {
      return undefined;
    }
    const handleClick = (event: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(event.target as Node)) {
        setMoreOpen(false);
      }
    };
    const handleEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMoreOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [moreOpen]);

  const resolvedNextRunTs = useMemo(() => {
    if (bot.paused) return null;
    if (typeof nextRunAt === 'number' && Number.isFinite(nextRunAt) && nextRunAt > now) {
      return nextRunAt;
    }
    const candidates: number[] = [];
    if (earliestAutoTs && earliestAutoTs > now) {
      candidates.push(earliestAutoTs);
    }
    const lookCfg = botLookAround(bot);
    const nextLook = nextLookAroundAt(lookCfg, now);
    if (typeof nextLook === 'number' && Number.isFinite(nextLook) && nextLook > now) {
      candidates.push(nextLook);
    }
    const tidyCfg = botTidyUp(bot) as { on: boolean; every: 'night' | 'week' };
    const nextTidy = computeNextTidyUpAt(tidyCfg, now);
    if (nextTidy && nextTidy > now) {
      candidates.push(nextTidy);
    }
    if (Array.isArray(bot.waits)) {
      for (const w of bot.waits) {
        if (typeof w.by === 'number' && w.by > now) {
          candidates.push(w.by);
        }
      }
    }
    return candidates.length > 0 ? Math.min(...candidates) : null;
  }, [bot, earliestAutoTs, nextRunAt, now]);

  const persistedColor = normalizeBotAvatarColor(bot.avatarColor);
  const pickerValue: AvatarPickerValue = {
    avatar: bot.avatar || 'mascot:W1',
    avatarColor: persistedColor ?? DEFAULT_BOT_AVATAR_COLOR,
  };

  const handleAvatarChange = (next: AvatarPickerValue) => {
    if (next.avatar === 'upload:pending') {
      if (next.avatarColor !== persistedColor) {
        void botsStore.updateBot(bot.id, { avatarColor: next.avatarColor });
      }
      return;
    }
    void botsStore.updateBot(bot.id, {
      avatar: next.avatar,
      avatarColor: next.avatarColor,
    });
  };

  const handleUploadCommit = async (image: CroppedAvatarImage): Promise<string | undefined> => {
    const res = await callBotRpc<{ avatar?: string }>(RPC_METHODS.AVATAR_UPLOAD, {
      botId: bot.id,
      base64Png: image.base64Png,
    });
    invalidateUploadedAvatarCache(bot.id);
    await botsStore.refresh();
    return typeof res?.avatar === 'string' && res.avatar.startsWith('upload:') ? res.avatar : undefined;
  };

  const handleCopyPath = async () => {
    setMoreOpen(false);
    const pathText = bot.homePath || '';
    if (!pathText) {
      botsStore.pushToast({
        message: zh ? '暂无可用路径' : 'Path unavailable',
        tone: 'info',
      });
      return;
    }
    const ok = await botsStore.copyToClipboard(pathText);
    botsStore.pushToast({
      message: ok
        ? (zh ? `已复制路径：${pathText}` : `Copied path: ${pathText}`)
        : (zh ? '复制失败' : 'Copy failed'),
      tone: ok ? 'success' : 'error',
    });
  };

  const isBusy = bot.dotState === 'working' || bot.dotState === 'monitoring';
  const idleText = tr('bots.panel.idle', zh ? '空闲' : 'Idle');

  const { displaySub, fullSubTitle } = useMemo(() => {
    if (subtitle) {
      return { displaySub: subtitle, fullSubTitle: subtitle };
    }
    if (bot.paused) {
      const label = tr('bots.row.paused', zh ? '已暂停' : 'Paused');
      return { displaySub: label, fullSubTitle: label };
    }
    if (isBusy) {
      const label = tr('bots.row.replying', zh ? '正在处理' : 'Replying');
      return { displaySub: label, fullSubTitle: label };
    }
    if (resolvedNextRunTs) {
      const timeLabel = formatNextRunTime(resolvedNextRunTs, now, locale);
      const compact = zh ? `下次 ${timeLabel}` : `Next ${timeLabel}`;
      const full = zh ? `${idleText} · 下次 ${timeLabel}` : `${idleText} · next ${timeLabel}`;
      return {
        displaySub: narrow ? compact : full,
        fullSubTitle: full,
      };
    }
    return { displaySub: idleText, fullSubTitle: idleText };
  }, [bot.paused, idleText, isBusy, locale, narrow, now, resolvedNextRunTs, subtitle, tr, zh]);

  return (
    <div ref={headerRef} className="dsh-bots-panel-header">
      <button
        ref={avatarBtnRef}
        type="button"
        className="dsh-bots-panel-avatar-trigger"
        aria-haspopup="dialog"
        aria-expanded={Boolean(pickerRect)}
        title={zh ? '点击更换头像' : 'Change avatar'}
        onClick={() => {
          const rect = avatarBtnRef.current?.getBoundingClientRect() ?? null;
          setPickerRect((prev) => (prev ? null : rect));
        }}
      >
        <BotAvatar
          botId={bot.id}
          avatar={bot.avatar}
          avatarColor={bot.avatarColor}
          name={bot.name}
          size={32}
          radius={9}
          status={bot.dotState ?? undefined}
          unread={bot.unread}
          paused={bot.paused}
          usageLimit={Boolean(bot.usageLimit)}
        />
      </button>

      <div className="dsh-bots-panel-meta">
        <div className="dsh-bots-panel-name" title={bot.name}>{bot.name}</div>
        <div className="dsh-bots-panel-sub" title={fullSubTitle}>
          {displaySub}
        </div>
      </div>

      <div className="dsh-bots-panel-actions">
        {showFilterToggle && onToggleFilter && (
          <button
            type="button"
            className="dsh-bots-pbtn dsh-bots-pbtn-icon"
            aria-label={zh ? '筛选' : 'Filter'}
            aria-pressed={filterOpen}
            title={zh ? '筛选' : 'Filter'}
            onClick={onToggleFilter}
          >
            <IconSliders size={15} />
          </button>
        )}

        <button
          type="button"
          className="dsh-bots-pbtn dsh-bots-pbtn-icon"
          aria-label={tr('bots.panel.settings.title', 'Settings')}
          title={tr('bots.panel.settings.title', 'Settings')}
          onClick={onOpenSettings}
        >
          <IconSettings size={15} />
        </button>

        <div ref={moreRef} className="dsh-bots-pmenu-wrap">
          <button
            type="button"
            className="dsh-bots-pbtn dsh-bots-pbtn-icon"
            aria-label={tr('bots.panel.more', 'More')}
            aria-haspopup="menu"
            aria-expanded={moreOpen}
            title={tr('bots.panel.more', 'More')}
            onClick={() => setMoreOpen((prev) => !prev)}
          >
            <IconMoreHorizontal size={15} />
          </button>

          {moreOpen && (
            <div className="dsh-bots-pmenu" role="menu">
              <button
                type="button"
                className="dsh-bots-pmenu-item"
                role="menuitem"
                onClick={() => {
                  setMoreOpen(false);
                  void botsStore.updateBot(bot.id, { paused: !bot.paused });
                }}
              >
                {bot.paused ? <IconPlay size={14} /> : <IconPause size={14} />}
                <span>{bot.paused ? tr('bots.row.resume', 'Resume bot') : tr('bots.row.pause', 'Pause bot')}</span>
              </button>
              <button
                type="button"
                className="dsh-bots-pmenu-item"
                role="menuitem"
                onClick={() => {
                  setMoreOpen(false);
                  botsStore.openModal({ kind: 'share', mode: 'export', botId: bot.id });
                }}
              >
                <IconShare size={14} />
                <span>{zh ? '分享队友…' : 'Share bot…'}</span>
              </button>
              <button
                type="button"
                className="dsh-bots-pmenu-item"
                role="menuitem"
                onClick={() => void handleCopyPath()}
              >
                <IconCopy size={14} />
                <span>{tr('bots.row.copyPath', 'Copy Path')}</span>
              </button>
              <div className="dsh-bots-pmenu-sep" />
              <button
                type="button"
                className="dsh-bots-pmenu-item"
                role="menuitem"
                onClick={() => {
                  setMoreOpen(false);
                  botsStore.openBotSettings(bot.id, { host: 'page' });
                }}
              >
                <IconSettings size={14} />
                <span>{zh ? '在独立页面打开设置' : 'Open full settings page'}</span>
              </button>
            </div>
          )}
        </div>
      </div>

      <AvatarPickerPopover
        open={Boolean(pickerRect)}
        anchorRect={pickerRect}
        triggerRef={avatarBtnRef}
        onClose={() => setPickerRect(null)}
        botId={bot.id}
        hasExplicitColor={Boolean(persistedColor)}
        value={pickerValue}
        onChange={handleAvatarChange}
        onUploadCommit={handleUploadCommit}
      />
    </div>
  );
}
