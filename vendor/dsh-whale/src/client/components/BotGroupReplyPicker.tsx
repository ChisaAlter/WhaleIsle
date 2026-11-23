// Compact upward popover selector for Group Room reply mode, mounted at the bottom-left
// of the group composer. Displays member avatars, live @mention override reflection,
// and keyboard-accessible selection replacing the legacy top-bar native <select> controls.

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useBotsLocale } from '../store/bots-store';
import type { BotRecord } from '../store/rpc';
import { BotAvatar } from './BotAvatar';
import {
  IconAlertTriangle,
  IconCheck,
  IconChevronDown,
  IconMessageSquare,
  IconUsers,
} from './Icons';

export type BotGroupReplyModeValue =
  | { kind: 'all' }
  | { kind: 'mentions' }
  | { kind: 'bot'; botId: string };

export type BotGroupDraftAudience =
  | 'invalid'
  | { ids: string[]; addressed: boolean };

export interface BotGroupReplyPickerProps {
  replyMode: BotGroupReplyModeValue;
  memberBots: BotRecord[];
  draftAudience: BotGroupDraftAudience;
  audienceLabel: string;
  disabled?: boolean;
  onChange: (next: BotGroupReplyModeValue) => void | Promise<void>;
}

export function BotGroupReplyPicker({
  replyMode,
  memberBots,
  draftAudience,
  audienceLabel,
  disabled = false,
  onChange,
}: BotGroupReplyPickerProps) {
  const { locale, tr } = useBotsLocale();
  const zh = locale === 'zh-CN';
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const handlePointerDown = (event: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const isInvalid = draftAudience === 'invalid';
  const isAddressed = !isInvalid && draftAudience.addressed;

  // Determine which single bot avatar (if any) to show on the trigger pill
  const singleTargetBot = (() => {
    if (isInvalid) {
      return null;
    }
    if (isAddressed && draftAudience.ids.length === 1) {
      return memberBots.find((b) => b.id === draftAudience.ids[0]) ?? null;
    }
    if (!isAddressed && replyMode.kind === 'bot') {
      return memberBots.find((b) => b.id === replyMode.botId) ?? null;
    }
    return null;
  })();

  const handleSelect = async (next: BotGroupReplyModeValue) => {
    setOpen(false);
    setSaving(true);
    try {
      await onChange(next);
    } finally {
      setSaving(false);
      triggerRef.current?.focus();
    }
  };

  const handleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]:not(:disabled)');
    if (!items || items.length === 0) {
      return;
    }
    const list = Array.from(items);
    const curIdx = list.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      list[(curIdx + 1) % list.length]?.focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      list[(curIdx - 1 + list.length) % list.length]?.focus();
    } else if (event.key === 'Home') {
      event.preventDefault();
      list[0]?.focus();
    } else if (event.key === 'End') {
      event.preventDefault();
      list[list.length - 1]?.focus();
    }
  };

  const prefixText = isInvalid
    ? (zh ? '回复对象：' : 'Replies: ')
    : isAddressed
      ? (zh ? '本次回复：' : 'This turn: ')
      : (zh ? '回复模式：' : 'Replies: ');

  return (
    <div ref={wrapRef} className="dsh-bots-reply-picker" data-dsh-bots-reply-picker="true">
      <button
        ref={triggerRef}
        type="button"
        className="dsh-bots-reply-trigger"
        disabled={disabled || saving}
        aria-haspopup="menu"
        aria-expanded={open}
        data-addressed={isAddressed ? 'true' : 'false'}
        data-invalid={isInvalid ? 'true' : 'false'}
        title={isInvalid
          ? (zh ? '请修正消息中模糊或不可用的 @提及' : 'Correct the ambiguous or unavailable @mention')
          : (zh ? '点击切换本群默认回复模式' : 'Choose group default reply mode')}
        onClick={() => setOpen((prev) => !prev)}
      >
        {isInvalid ? (
          <IconAlertTriangle size={13} />
        ) : singleTargetBot ? (
          <BotAvatar
            botId={singleTargetBot.id}
            avatar={singleTargetBot.avatar}
            avatarColor={singleTargetBot.avatarColor}
            name={singleTargetBot.name}
            size={16}
            radius={4}
            paused={singleTargetBot.paused}
          />
        ) : (!isAddressed && replyMode.kind === 'mentions') ? (
          <IconMessageSquare size={13} />
        ) : (
          <IconUsers size={13} />
        )}

        <span className="dsh-bots-reply-trigger-prefix">{prefixText}</span>
        <span className="dsh-bots-reply-trigger-label">{audienceLabel}</span>
        <IconChevronDown size={12} style={{ opacity: 0.7 }} />
      </button>

      {open && (
        <div
          ref={menuRef}
          className="dsh-bots-reply-popover"
          role="menu"
          aria-label={zh ? '选择群默认回复模式' : 'Group reply mode'}
          onKeyDown={handleMenuKeyDown}
        >
          {isAddressed && (
            <div className="dsh-bots-reply-override-hint">
              {zh
                ? `当前草稿已通过 @提及 指定「${audienceLabel}」，以下设置决定未 @提及 时的默认回复对象。`
                : `Draft @mentions override this message (${audienceLabel}). Choose default behavior below.`}
            </div>
          )}

          <div className="dsh-bots-menu-section">
            {zh ? '默认回复模式' : 'Default reply mode'}
          </div>

          <button
            type="button"
            role="menuitemradio"
            aria-checked={replyMode.kind === 'all'}
            className="dsh-bots-pmenu-item"
            onClick={() => void handleSelect({ kind: 'all' })}
          >
            <IconUsers size={14} style={{ opacity: 0.8 }} />
            <span className="dsh-bots-reply-option-text">
              <span className="dsh-bots-pmenu-item-label">
                {tr('bots.groups.allBots', '全部队友')}
              </span>
              <span className="dsh-bots-reply-option-desc">
                {zh ? '未 @提及 时，所有活跃队友共同回复' : 'All active teammates reply'}
              </span>
            </span>
            {replyMode.kind === 'all' && <IconCheck size={13} className="dsh-bots-pmenu-check" />}
          </button>

          <button
            type="button"
            role="menuitemradio"
            aria-checked={replyMode.kind === 'mentions'}
            className="dsh-bots-pmenu-item"
            onClick={() => void handleSelect({ kind: 'mentions' })}
          >
            <IconMessageSquare size={14} style={{ opacity: 0.8 }} />
            <span className="dsh-bots-reply-option-text">
              <span className="dsh-bots-pmenu-item-label">
                {tr('bots.groups.onlyWhenMentioned', '仅 @提及')}
              </span>
              <span className="dsh-bots-reply-option-desc">
                {zh ? '只有显式 @队友 或 @everyone 时才回复' : 'Only reply when @mentioned'}
              </span>
            </span>
            {replyMode.kind === 'mentions' && <IconCheck size={13} className="dsh-bots-pmenu-check" />}
          </button>

          {memberBots.length > 0 && (
            <>
              <div className="dsh-bots-pmenu-sep" />
              <div className="dsh-bots-menu-section">
                {zh ? '指定默认回复队友' : 'Default specific teammate'}
              </div>
              {memberBots.map((bot) => {
                const selected = replyMode.kind === 'bot' && replyMode.botId === bot.id;
                return (
                  <button
                    key={bot.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={selected}
                    className="dsh-bots-pmenu-item"
                    onClick={() => void handleSelect({ kind: 'bot', botId: bot.id })}
                  >
                    <BotAvatar
                      botId={bot.id}
                      avatar={bot.avatar}
                      avatarColor={bot.avatarColor}
                      name={bot.name}
                      size={20}
                      radius={6}
                      paused={bot.paused}
                      status={bot.dotState ?? undefined}
                    />
                    <span className="dsh-bots-pmenu-item-label">{bot.name}</span>
                    {bot.paused && (
                      <span className="dsh-bots-badge" style={{ flex: 'none' }}>
                        {tr('bots.row.paused', '已暂停')}
                      </span>
                    )}
                    {selected && <IconCheck size={13} className="dsh-bots-pmenu-check" />}
                  </button>
                );
              })}
            </>
          )}
        </div>
      )}
    </div>
  );
}
