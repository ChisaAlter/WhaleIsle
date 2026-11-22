// Right-panel header for a Bot: clickable 36px AvatarPicker trigger, name, live status,
// filter toggle, inline settings gear button, and '...' overflow menu.

import { useEffect, useRef, useState } from 'react';
import { DEFAULT_BOT_AVATAR_COLOR } from '../../shared/bot-avatar-color.js';
import { botsStore, useBotsLocale } from '../store/bots-store';
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
  showFilterToggle?: boolean;
  filterOpen?: boolean;
  onToggleFilter?: () => void;
  onOpenSettings: () => void;
}

export function BotPanelHeader({
  bot,
  subtitle,
  showFilterToggle = false,
  filterOpen = false,
  onToggleFilter,
  onOpenSettings,
}: BotPanelHeaderProps) {
  const { locale, tr } = useBotsLocale();
  const avatarBtnRef = useRef<HTMLButtonElement | null>(null);
  const moreRef = useRef<HTMLDivElement | null>(null);
  const [pickerRect, setPickerRect] = useState<DOMRect | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);

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

  const pickerValue: AvatarPickerValue = {
    avatar: bot.avatar || 'mascot:W1',
    avatarColor: bot.avatarColor || DEFAULT_BOT_AVATAR_COLOR,
  };

  const handleAvatarChange = (next: AvatarPickerValue) => {
    if (next.avatar === 'upload:pending') {
      return;
    }
    void botsStore.updateBot(bot.id, {
      avatar: next.avatar,
      avatarColor: next.avatarColor,
    });
  };

  const handleUploadCommit = async (image: CroppedAvatarImage) => {
    await callBotRpc(RPC_METHODS.AVATAR_UPLOAD, {
      botId: bot.id,
      base64Png: image.base64Png,
    });
    invalidateUploadedAvatarCache(bot.id);
    await botsStore.refresh();
  };

  const handleCopyPath = async () => {
    setMoreOpen(false);
    const pathText = bot.homePath || '';
    if (!pathText) {
      botsStore.pushToast({
        message: locale === 'zh-CN' ? '暂无可用路径' : 'Path unavailable',
        tone: 'info',
      });
      return;
    }
    const ok = await botsStore.copyToClipboard(pathText);
    botsStore.pushToast({
      message: ok
        ? (locale === 'zh-CN' ? `已复制路径：${pathText}` : `Copied path: ${pathText}`)
        : (locale === 'zh-CN' ? '复制失败' : 'Copy failed'),
      tone: ok ? 'success' : 'error',
    });
  };

  const fallbackSub = bot.paused
    ? tr('bots.row.paused', 'Paused')
    : (bot.dotState === 'working' || bot.dotState === 'monitoring'
      ? tr('bots.row.replying', 'Replying')
      : tr('bots.panel.idle', 'Idle'));

  return (
    <div className="dsh-bots-panel-header">
      <button
        ref={avatarBtnRef}
        type="button"
        className="dsh-bots-panel-avatar-trigger"
        title={locale === 'zh-CN' ? '点击更换头像' : 'Change avatar'}
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
        <div className="dsh-bots-panel-sub" title={subtitle || fallbackSub}>
          {subtitle || fallbackSub}
        </div>
      </div>

      <div className="dsh-bots-panel-actions">
        {showFilterToggle && onToggleFilter && (
          <button
            type="button"
            className="dsh-bots-pbtn dsh-bots-pbtn-icon"
            aria-label={locale === 'zh-CN' ? '筛选' : 'Filter'}
            aria-pressed={filterOpen}
            title={locale === 'zh-CN' ? '筛选' : 'Filter'}
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
                <span>{locale === 'zh-CN' ? '分享队友…' : 'Share bot…'}</span>
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
                <span>{locale === 'zh-CN' ? '在独立页面打开设置' : 'Open full settings page'}</span>
              </button>
            </div>
          )}
        </div>
      </div>

      <AvatarPickerPopover
        open={Boolean(pickerRect)}
        anchorRect={pickerRect}
        onClose={() => setPickerRect(null)}
        value={pickerValue}
        onChange={handleAvatarChange}
        onUploadCommit={handleUploadCommit}
      />
    </div>
  );
}
