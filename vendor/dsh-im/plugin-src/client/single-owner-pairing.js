import * as React from 'react';
import { ActionButton, ConfirmDialog } from './feedback.js';
import { h, localizeText } from './i18n.js';

export const SINGLE_OWNER_ACCESS_CHANNEL = '/dsh-im/access';

export const SINGLE_OWNER_ACCESS_ENDPOINTS = Object.freeze({
  status: 'access.status',
  approve: 'access.approve',
  reject: 'access.reject',
  revoke: 'access.revoke',
});

// Must match host SINGLE_OWNER_CHANNELS (excludes AI Office Connector).
export const SINGLE_OWNER_CLIENT_CHANNELS = Object.freeze([
  'weixin',
  'feishu',
  'dingtalk',
  'wecom',
  'qq',
  'slack',
  'telegram',
  'discord',
  'whatsapp',
]);

const SINGLE_OWNER_CHANNEL_SET = new Set(SINGLE_OWNER_CLIENT_CHANNELS);
const DEFAULT_REFRESH_MS = 15_000;

export function isSingleOwnerClientChannel(channel) {
  return typeof channel === 'string' && SINGLE_OWNER_CHANNEL_SET.has(channel);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cleanText(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : '';
}

function unwrapAccessResult(result) {
  const payload = isRecord(result?.result) && typeof result.result.ok === 'boolean'
    ? result.result
    : result;
  if (!isRecord(payload) || typeof payload.ok !== 'boolean') {
    throw new Error('单人助理配对服务返回了无法识别的响应');
  }
  if (!payload.ok) {
    const message = cleanText(payload.error?.message) || '单人助理配对操作失败，请稍后重试。';
    const error = new Error(message);
    error.code = cleanText(payload.error?.code) || 'access-operation-failed';
    throw error;
  }
  return payload.value;
}

/**
 * Strictly pick redacted public fields so raw platform IDs can never be rendered
 * even if an upstream response were ever malformed.
 */
export function normalizeSingleOwnerBot(raw) {
  if (!isRecord(raw)) return null;
  const channel = cleanText(raw.channel);
  const botId = cleanText(raw.botId);
  if (!channel || !botId) return null;
  const owner = isRecord(raw.owner) && cleanText(raw.owner.senderKey)
    ? Object.freeze({
        senderKey: cleanText(raw.owner.senderKey),
        displayName: cleanText(raw.owner.displayName) || '已配对主人',
        pairedAt: cleanText(raw.owner.pairedAt) || null,
        source: cleanText(raw.owner.source) || 'paired',
      })
    : null;
  const pending = Array.isArray(raw.pending)
    ? raw.pending
        .filter((item) => isRecord(item) && cleanText(item.requestId) && cleanText(item.code))
        .map((item) => Object.freeze({
          requestId: cleanText(item.requestId),
          code: cleanText(item.code).toUpperCase(),
          displayName: cleanText(item.displayName) || '待配对用户',
          requestedAt: cleanText(item.requestedAt) || null,
          lastSeenAt: cleanText(item.lastSeenAt) || null,
          expiresAt: cleanText(item.expiresAt) || null,
        }))
    : [];
  return Object.freeze({
    channel,
    botId,
    mode: cleanText(raw.mode) || 'single-owner',
    owner,
    pending: Object.freeze(pending),
    ttlMs: typeof raw.ttlMs === 'number' && Number.isFinite(raw.ttlMs) ? raw.ttlMs : 3_600_000,
    maxPending: typeof raw.maxPending === 'number' && Number.isFinite(raw.maxPending) ? raw.maxPending : 3,
  });
}

function sourceBadgeLabel(source) {
  if (source === 'migrated') return '历史迁移';
  if (source === 'manual') return '手动绑定';
  return '短码配对';
}

function formatIsoTime(iso) {
  if (!iso) return '';
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return '';
  try {
    return new Date(ts).toLocaleString([], {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function formatExpiryRemaining(iso, now = Date.now()) {
  if (!iso) return '';
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return '';
  const diffMs = ts - now;
  if (diffMs <= 0) return '已过期';
  const minutes = Math.max(1, Math.ceil(diffMs / 60_000));
  return `剩余 ${minutes} 分钟`;
}

function upsertBotRow(rows, updated) {
  if (!updated) return rows;
  const idx = rows.findIndex((row) => row.channel === updated.channel && row.botId === updated.botId);
  if (idx < 0) return [...rows, updated];
  return rows.map((row, index) => (index === idx ? updated : row));
}

export function SingleOwnerPairingPanel({
  channel,
  channelLabel,
  rpcCall,
  refreshIntervalMs = DEFAULT_REFRESH_MS,
}) {
  const [bots, setBots] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [passiveLoadError, setPassiveLoadError] = React.useState('');
  const [busyKey, setBusyKey] = React.useState('');
  const [codeInputs, setCodeInputs] = React.useState({});
  const [feedback, setFeedback] = React.useState(null);
  const [revokeTarget, setRevokeTarget] = React.useState(null);
  const mountedRef = React.useRef(true);

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadStatus = React.useCallback(async ({ manual = false, signal } = {}) => {
    if (typeof rpcCall !== 'function' || !isSingleOwnerClientChannel(channel)) {
      if (mountedRef.current) setLoading(false);
      return;
    }
    if (manual && mountedRef.current) setRefreshing(true);
    try {
      const raw = await rpcCall(SINGLE_OWNER_ACCESS_ENDPOINTS.status, { channel }, signal);
      if (!mountedRef.current || signal?.aborted) return;
      const value = unwrapAccessResult(raw);
      const list = Array.isArray(value?.bots)
        ? value.bots.map(normalizeSingleOwnerBot).filter(Boolean)
        : [];
      setBots(list);
      setPassiveLoadError('');
      if (manual) {
        setFeedback({ tone: 'success', text: '配对状态已刷新。' });
      }
    } catch (error) {
      if (!mountedRef.current || signal?.aborted) return;
      const message = error instanceof Error ? error.message : String(error);
      if (manual) {
        setFeedback({ tone: 'error', text: message });
      } else {
        setPassiveLoadError(message);
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
        if (manual) setRefreshing(false);
      }
    }
  }, [channel, rpcCall]);

  React.useEffect(() => {
    setBots([]);
    setLoading(true);
    setPassiveLoadError('');
    setFeedback(null);
    setRevokeTarget(null);
    const controller = new AbortController();
    void loadStatus({ manual: false, signal: controller.signal });
    const interval = refreshIntervalMs > 0
      ? setInterval(() => {
          void loadStatus({ manual: false, signal: controller.signal });
        }, refreshIntervalMs)
      : null;
    return () => {
      controller.abort();
      if (interval !== null) clearInterval(interval);
    };
  }, [channel, loadStatus, refreshIntervalMs]);

  const runMutation = React.useCallback(async (actionKey, endpoint, payload, successText) => {
    if (typeof rpcCall !== 'function') return false;
    setBusyKey(actionKey);
    setFeedback(null);
    try {
      const raw = await rpcCall(endpoint, payload);
      if (!mountedRef.current) return false;
      const updated = normalizeSingleOwnerBot(unwrapAccessResult(raw));
      if (updated) {
        setBots((current) => upsertBotRow(current, updated));
      } else {
        await loadStatus({ manual: false });
      }
      setPassiveLoadError('');
      setFeedback({ tone: 'success', text: successText });
      return true;
    } catch (error) {
      if (!mountedRef.current) return false;
      setFeedback({
        tone: 'error',
        text: error instanceof Error ? error.message : String(error),
      });
      return false;
    } finally {
      if (mountedRef.current) setBusyKey('');
    }
  }, [loadStatus, rpcCall]);

  const handleApproveRequest = (bot, item) => {
    void runMutation(
      `approve:${bot.botId}:${item.requestId}`,
      SINGLE_OWNER_ACCESS_ENDPOINTS.approve,
      {
        channel: bot.channel,
        botId: bot.botId,
        requestId: item.requestId,
        confirm: true,
      },
      `已批准「${item.displayName}」成为唯一主人。`,
    );
  };

  const handleRejectRequest = (bot, item) => {
    void runMutation(
      `reject:${bot.botId}:${item.requestId}`,
      SINGLE_OWNER_ACCESS_ENDPOINTS.reject,
      {
        channel: bot.channel,
        botId: bot.botId,
        requestId: item.requestId,
        confirm: true,
      },
      '已拒绝该配对请求。',
    );
  };

  const handleApproveCode = async (event, bot) => {
    event.preventDefault();
    const rawCode = cleanText(codeInputs[bot.botId] ?? '').toUpperCase();
    if (!/^[A-Z0-9]{4,12}$/.test(rawCode)) {
      setFeedback({ tone: 'error', text: '请输入 4-12 位字母或数字配对短码。' });
      return;
    }
    const ok = await runMutation(
      `approve-code:${bot.botId}`,
      SINGLE_OWNER_ACCESS_ENDPOINTS.approve,
      {
        channel: bot.channel,
        botId: bot.botId,
        code: rawCode,
        confirm: true,
      },
      '已通过短码完成唯一主人配对。',
    );
    if (ok && mountedRef.current) {
      setCodeInputs((current) => ({ ...current, [bot.botId]: '' }));
    }
  };

  const handleConfirmRevoke = async () => {
    if (!revokeTarget) return;
    const target = revokeTarget;
    const ok = await runMutation(
      `revoke:${target.botId}`,
      SINGLE_OWNER_ACCESS_ENDPOINTS.revoke,
      {
        channel: target.channel,
        botId: target.botId,
        senderKey: target.owner.senderKey,
        confirm: true,
      },
      '已撤销唯一主人绑定。',
    );
    if (ok && mountedRef.current) {
      setRevokeTarget(null);
    }
  };

  if (!isSingleOwnerClientChannel(channel) || typeof rpcCall !== 'function') {
    return null;
  }

  const label = channelLabel || channel;

  return h('section', {
    className: 'dim-surfaceCard dim-pairingCard',
    'data-single-owner-panel': channel,
    'aria-label': '单人私人助理配对',
  },
  h('div', { className: 'dim-pairingHeader' },
    h('div', { className: 'dim-pairingHeaderCopy' },
      h('h3', { className: 'dim-pairingTitle' }, '单人私人助理配对'),
      h('p', { className: 'dim-pairingSubtitle' },
        '仅允许唯一已配对主人在私聊中使用鲸鱼娘；界面仅展示脱敏称呼与配对短码，不暴露原始平台 ID。'),
    ),
    h(ActionButton, {
      className: 'dim-pairingRefreshBtn',
      'data-pairing-action': 'refresh',
      loading: refreshing,
      disabled: busyKey !== '',
      onClick: () => { void loadStatus({ manual: true }); },
    }, '刷新'),
  ),
  feedback
    ? h('p', {
        className: `dim-pairingFeedback dim-pairingFeedback--${feedback.tone}`,
        'data-pairing-feedback': feedback.tone,
        role: 'status',
      }, feedback.text)
    : null,
  loading
    ? h('p', { className: 'dim-pairingHint' }, '正在读取单人配对状态…')
    : bots.length === 0
      ? h('p', { className: 'dim-pairingHint', 'data-pairing-empty': 'true' },
          passiveLoadError
            ? localizeText('暂时无法读取配对状态，请稍后点击刷新。')
            : `${localizeText(label)} 尚未产生配对记录。接入机器人后，用本人账号私聊机器人即可在此批准唯一主人。`)
      : h('div', { className: 'dim-pairingBotList' },
          bots.map((bot) => {
            const codeValue = codeInputs[bot.botId] ?? '';
            const revokingThis = busyKey === `revoke:${bot.botId}`;
            const approvingCodeThis = busyKey === `approve-code:${bot.botId}`;
            return h('article', {
              key: `${bot.channel}:${bot.botId}`,
              className: 'dim-pairingBotItem',
              'data-pairing-bot': bot.botId,
            },
            h('div', { className: 'dim-pairingBotHead' },
              h('div', { className: 'dim-pairingBotMeta' },
                h('strong', { className: 'dim-pairingBotId' }, bot.botId),
                h('span', {
                  className: `dim-pairingState ${bot.owner ? 'is-paired' : 'is-unpaired'}`,
                }, bot.owner ? '已配对唯一主人' : '待配对'),
              ),
              bot.owner
                ? h(ActionButton, {
                    className: 'dim-pairingDangerBtn',
                    'data-kind': 'danger',
                    'data-pairing-action': 'revoke',
                    loading: revokingThis,
                    disabled: busyKey !== '',
                    onClick: () => setRevokeTarget(bot),
                  }, '撤销唯一主人')
                : null,
            ),
            bot.owner
              ? h('div', { className: 'dim-pairingOwnerRow', 'data-pairing-owner': 'true' },
                  h('span', { className: 'dim-pairingOwnerName' }, bot.owner.displayName),
                  h('span', { className: 'dim-pairingBadge' }, sourceBadgeLabel(bot.owner.source)),
                  bot.owner.pairedAt
                    ? h('span', { className: 'dim-pairingTime' }, formatIsoTime(bot.owner.pairedAt))
                    : null,
                )
              : h('div', { className: 'dim-pairingPendingBlock' },
                  bot.pending.length === 0
                    ? h('p', { className: 'dim-pairingHint' },
                        '尚未配对唯一主人。请使用本人账号私聊该机器人获取配对短码，或在下方直接输入短码批准。')
                    : h('ul', { className: 'dim-pairingPendingList' },
                        bot.pending.map((item) => {
                          const approveBusy = busyKey === `approve:${bot.botId}:${item.requestId}`;
                          const rejectBusy = busyKey === `reject:${bot.botId}:${item.requestId}`;
                          return h('li', {
                            key: item.requestId,
                            className: 'dim-pairingPendingRow',
                            'data-pairing-request': item.requestId,
                          },
                          h('div', { className: 'dim-pairingPendingInfo' },
                            h('code', { className: 'dim-pairingCode' }, item.code),
                            h('span', { className: 'dim-pairingPendingName' }, item.displayName),
                            item.expiresAt
                              ? h('span', { className: 'dim-pairingTime' }, formatExpiryRemaining(item.expiresAt))
                              : null,
                          ),
                          h('div', { className: 'dim-pairingPendingActions' },
                            h(ActionButton, {
                              className: 'dim-pairingApproveBtn',
                              'data-kind': 'primary',
                              'data-pairing-action': 'approve',
                              loading: approveBusy,
                              disabled: busyKey !== '',
                              onClick: () => handleApproveRequest(bot, item),
                            }, '批准配对'),
                            h(ActionButton, {
                              className: 'dim-pairingRejectBtn',
                              'data-pairing-action': 'reject',
                              loading: rejectBusy,
                              disabled: busyKey !== '',
                              onClick: () => handleRejectRequest(bot, item),
                            }, '拒绝'),
                          ));
                        }),
                      ),
                  h('form', {
                    className: 'dim-pairingCodeForm',
                    onSubmit: (event) => { void handleApproveCode(event, bot); },
                  },
                  h('input', {
                    type: 'text',
                    className: 'dim-pairingCodeInput',
                    'aria-label': '配对短码',
                    placeholder: '输入私聊收到的配对短码',
                    maxLength: 12,
                    value: codeValue,
                    disabled: busyKey !== '',
                    onChange: (event) => {
                      const nextValue = event.target.value;
                      setCodeInputs((current) => ({ ...current, [bot.botId]: nextValue }));
                    },
                  }),
                  h(ActionButton, {
                    type: 'submit',
                    className: 'dim-pairingCodeSubmit',
                    'data-pairing-action': 'approve-code',
                    loading: approvingCodeThis,
                    disabled: busyKey !== '' || cleanText(codeValue).length === 0,
                  }, '通过短码批准')),
                ),
            );
          }),
        ),
  revokeTarget?.owner
    ? h(ConfirmDialog, {
        busy: busyKey === `revoke:${revokeTarget.botId}`,
        onClose: () => setRevokeTarget(null),
      },
      h('strong', null, '撤销唯一主人绑定？'),
      h('p', null,
        `撤销「${revokeTarget.owner.displayName}」后，该账号将立即失去此机器人的鲸鱼娘访问权限，后续需重新私聊并在此批准配对短码。`),
      h('div', { className: 'dim-viewActions' },
        h('button', {
          type: 'button',
          disabled: busyKey !== '',
          onClick: () => setRevokeTarget(null),
        }, '取消'),
        h('button', {
          type: 'button',
          'data-kind': 'danger',
          'data-pairing-action': 'confirm-revoke',
          disabled: busyKey !== '',
          onClick: () => { void handleConfirmRevoke(); },
        }, '确认撤销'),
      ))
    : null);
}
