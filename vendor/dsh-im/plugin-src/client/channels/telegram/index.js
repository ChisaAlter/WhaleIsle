import * as React from 'react';
import { ActionButton, FeedbackToast } from '../../feedback.js';

import { TelegramLogoGlyph } from '../../channel-logos.js';
import { createTokenChannelSettings } from '../shared/token-channel.js';
import { h } from '../../i18n.js';
import {
  TELEGRAM_ENDPOINTS,
  telegramClientApi,
} from './api.js';
import { installTelegramStyles } from './styles.js';

function policyFor(account) {
  return {
    accessMode: account?.accessPolicy?.accessMode === 'private-allowlist'
      ? 'private-allowlist' : 'compatible',
    allowedUsers: Array.isArray(account?.accessPolicy?.allowedUsers)
      ? account.accessPolicy.allowedUsers : [],
  };
}

function allowedUsersFromText(value) {
  const entries = value.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean);
  if (entries.some((entry) => !/^[1-9]\d{0,15}$/.test(entry))) {
    throw new TypeError('User ID 必须是 1–16 位正整数，每行一个。');
  }
  return [...new Set(entries)];
}

export function TelegramAccessSettings({ account, busy = false, onSave }) {
  const policy = policyFor(account);
  const sourceUsers = policy.allowedUsers.join('\n');
  const accessHelpId = React.useId();
  const [accessMode, setAccessMode] = React.useState(policy.accessMode);
  const [allowedUsers, setAllowedUsers] = React.useState(sourceUsers);
  const [error, setError] = React.useState(null);

  React.useEffect(() => {
    setAccessMode(policy.accessMode);
    setAllowedUsers(sourceUsers);
    setError(null);
  }, [policy.accessMode, sourceUsers]);

  const save = async (event) => {
    event.preventDefault();
    setError(null);
    try {
      const normalized = allowedUsersFromText(allowedUsers);
      if (typeof onSave !== 'function') throw new Error('Telegram 访问设置暂不可用。');
      await onSave({ accessMode, allowedUsers: normalized });
    } catch (caught) {
      setError(caught?.message ?? 'Telegram 访问设置保存失败。');
    }
  };

  const privateAllowlist = accessMode === 'private-allowlist';
  const savedPrivateAllowlist = policy.accessMode === 'private-allowlist';
  const emptyAllowlist = privateAllowlist && allowedUsers.trim() === '';
  return h('form', { className: 'dtg-access', onSubmit: save },
    h('div', { className: 'dtg-accessHeading' },
      h('strong', null, '访问设置'),
      h('span', { className: 'dtg-accessStatus' },
        h('span', { className: 'dtg-accessBadge', 'data-mode': policy.accessMode },
          savedPrivateAllowlist ? '已生效：安全模式' : '已生效：兼容模式'),
        h('span', { className: 'dtg-accessHelp' },
          h('button', {
            type: 'button',
            className: 'dtg-accessHelpButton',
            'aria-label': '查看 Telegram 访问模式说明',
            'aria-describedby': accessHelpId,
          }, h('span', { 'aria-hidden': 'true' }, '?')),
          h('span', {
            id: accessHelpId,
            className: 'dtg-accessTooltip',
            role: 'tooltip',
          },
          h('span', { className: 'dtg-accessTooltipItem' },
            h('strong', null, '兼容模式'),
            h('span', null, '保持原有行为：私聊直接响应，群聊在被提及或回复时响应。')),
          h('span', { className: 'dtg-accessTooltipItem' },
            h('strong', null, '安全模式'),
            h('span', null, '群聊全部忽略，私聊仅允许白名单用户。')))))),
    h('label', { className: 'dtg-accessField' },
      h('span', null, '模式'),
      h('select', {
        value: accessMode,
        disabled: busy,
        'aria-label': 'Telegram 访问模式',
        onChange: (event) => { setAccessMode(event.target.value); setError(null); },
      },
      h('option', { value: 'compatible' }, '兼容模式（默认）'),
      h('option', { value: 'private-allowlist' }, '安全模式（私聊白名单）'))),
    h('label', { className: 'dtg-accessField' },
      h('span', null, '允许私聊的 Telegram User ID'),
      h('textarea', {
        value: allowedUsers,
        disabled: busy || !privateAllowlist,
        rows: 3,
        placeholder: '每行一个数字 User ID',
        'aria-label': '允许私聊的 Telegram User ID',
        onChange: (event) => { setAllowedUsers(event.target.value); setError(null); },
      }),
      h('small', null, privateAllowlist
        ? '白名单仅属于当前机器人。'
        : '兼容模式下暂不使用白名单，切换模式时会保留。')),
    emptyAllowlist
      ? h('p', { className: 'dtg-accessWarning', role: 'status' },
          '白名单为空；保存后该机器人会拒绝所有入站消息。')
      : null,
    error ? h(FeedbackToast, { text: error, tone: "error" }) : null,
    h('div', { className: 'dtg-accessActions' },
      h(ActionButton, {
        type: 'submit',
        className: 'ddt-button',
        'data-kind': 'secondary',
        disabled: busy, loading: busy, }, '保存访问设置')));
}

const channel = createTokenChannelSettings({
  channel: 'Telegram',
  endpoints: TELEGRAM_ENDPOINTS,
  api: telegramClientApi,
  LogoGlyph: TelegramLogoGlyph,
  installStyles: installTelegramStyles,
  pageClass: 'dtg-page',
  avatarClass: 'dtg-avatar',
  connectionLabel: 'Bot API 长轮询',
  tokenPlaceholder: '填写 @BotFather 生成的 Bot Token',
  emptyTitle: '接入 Telegram 机器人',
  emptyDescription: '先通过 @BotFather 获取 Bot Token，再在这里完成接入。',
  platformLabel: 'Telegram',
  AccountSettings: TelegramAccessSettings,
  accountSettingsEndpoint: TELEGRAM_ENDPOINTS.setAccessPolicy,
});

export const TelegramSettingsTab = channel.SettingsTab;
export const TelegramAccountCard = channel.AccountCard;
