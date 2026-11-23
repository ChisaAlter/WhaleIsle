/**
 * Shared Bot Outbound Bridge for `dsh-im`.
 *
 * Bridges WhaleIsle Bots (`bot_reply` & `Needs You` cards) to active `dsh-im`
 * channel transports across all 9 IM channels, reusing Feishu Schema 2.0 cards,
 * DingTalk API, and Telegram Bot API where configured, and returning honest
 * delivery outcomes when a channel is disconnected or rejects delivery.
 */
import { createDingtalkApi } from '../dingtalk/dingtalk-api.mjs';
import { TelegramApi, validTelegramToken } from '../telegram/telegram-api.mjs';

export const BOT_OUTBOUND_BRIDGE_SYMBOL = Symbol.for('whaleisle.dsh-im.bot-outbound-bridge');

export const SUPPORTED_IM_CHANNELS = Object.freeze([
  'feishu',
  'wecom',
  'dingtalk',
  'telegram',
  'discord',
  'slack',
  'qq',
  'weixin',
  'whatsapp',
]);

const SUPPORTED_CHANNEL_SET = new Set(SUPPORTED_IM_CHANNELS);

function cleanStr(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function normalizeChannel(channel) {
  const clean = cleanStr(channel).toLowerCase();
  return SUPPORTED_CHANNEL_SET.has(clean) ? clean : '';
}

function senderKey(channel, accountId) {
  const acct = cleanStr(accountId);
  return acct ? `${channel}:${acct}` : channel;
}

/**
 * Build a Feishu Schema 2.0 interactive card JSON string compatible with
 * `feishu-cards.mjs` and `im.message.create` (`msg_type: 'interactive'`).
 */
export function buildFeishuNeedsYouCard({ botId, item }) {
  const title = cleanStr(item?.title) || '需要你拍板';
  const summary = cleanStr(item?.summary ?? item?.description ?? item?.comment) || '有待你确认的事项。';
  const itemUid = cleanStr(item?.uid ?? item?.id);
  const botLabel = cleanStr(item?.botName) || cleanStr(botId) || 'WhaleIsle Bot';
  const lines = [
    `**来源 Bot**：${botLabel}`,
    summary,
    ...(item?.link ? [`[查看详情](${String(item.link)})`] : []),
  ];
  const elements = [
    { tag: 'markdown', content: lines.join('\n\n') },
    {
      tag: 'column_set',
      flex_mode: 'none',
      columns: [
        {
          tag: 'column',
          width: 'weighted',
          weight: 1,
          elements: [{
            tag: 'button',
            text: { tag: 'plain_text', content: '批准 / 处理' },
            type: 'primary',
            width: 'fill',
            behaviors: [{ type: 'callback', value: { action: 'needs_you_approve', botId, itemUid } }],
          }],
        },
        {
          tag: 'column',
          width: 'weighted',
          weight: 1,
          elements: [{
            tag: 'button',
            text: { tag: 'plain_text', content: '稍后提醒' },
            type: 'default',
            width: 'fill',
            behaviors: [{ type: 'callback', value: { action: 'needs_you_snooze', botId, itemUid } }],
          }],
        },
      ],
    },
  ];
  return JSON.stringify({
    schema: '2.0',
    header: {
      title: { tag: 'plain_text', content: `需要你拍板 · ${title}` },
      template: 'orange',
    },
    body: { elements },
  });
}

/**
 * Build a channel-specific `Needs You` payload + readable plain-text fallback.
 */
export function buildNeedsYouCardPayload({ botId, item, channel }) {
  const normChannel = normalizeChannel(channel) || 'feishu';
  const title = cleanStr(item?.title) || '需要你拍板';
  const summary = cleanStr(item?.summary ?? item?.description ?? item?.comment) || '有待你确认的事项。';
  const itemUid = cleanStr(item?.uid ?? item?.id);
  const botLabel = cleanStr(item?.botName) || cleanStr(botId) || 'WhaleIsle Bot';
  const text = [`[需要你拍板] ${title}`, `来源：${botLabel}`, summary, item?.link ? `链接：${item.link}` : '']
    .filter(Boolean)
    .join('\n');

  if (normChannel === 'feishu') {
    return {
      text,
      card: {
        kind: 'needs_you',
        format: 'feishu-card-v2',
        msgType: 'interactive',
        content: buildFeishuNeedsYouCard({ botId, item }),
        itemUid,
      },
    };
  }
  if (normChannel === 'dingtalk') {
    return {
      text,
      card: {
        kind: 'needs_you',
        format: 'dingtalk-markdown',
        title: `需要你拍板 · ${title}`,
        markdown: `### 需要你拍板 · ${title}\n\n- 来源：${botLabel}\n- 说明：${summary}`,
        itemUid,
      },
    };
  }
  if (normChannel === 'telegram') {
    return {
      text,
      card: {
        kind: 'needs_you',
        format: 'telegram-inline',
        itemUid,
        inlineKeyboard: [[
          { text: '批准 / 处理', callback_data: `needs_you:approve:${itemUid}` },
          { text: '稍后提醒', callback_data: `needs_you:snooze:${itemUid}` },
        ]],
      },
    };
  }
  return {
    text,
    card: {
      kind: 'needs_you',
      format: 'generic-card',
      title: `需要你拍板 · ${title}`,
      summary,
      botId,
      itemUid,
    },
  };
}

async function invokeRegisteredSender(sender, payload) {
  if (typeof sender === 'function') {
    return sender(payload);
  }
  if (sender && typeof sender === 'object') {
    if (payload.card && typeof sender.sendCard === 'function') {
      return sender.sendCard(payload);
    }
    if (typeof sender.deliverReply === 'function') {
      return sender.deliverReply(payload);
    }
    if (typeof sender.sendText === 'function') {
      return sender.sendText(payload);
    }
    if (typeof sender.sendMessage === 'function') {
      return sender.sendMessage(payload);
    }
    if (payload.channel === 'dingtalk' && sender.clientId && sender.clientSecret && sender.sessionWebhook) {
      const api = createDingtalkApi({ fetchImpl: sender.fetchImpl });
      const text = payload.card?.markdown || payload.text;
      return api.sendText({
        clientId: sender.clientId,
        clientSecret: sender.clientSecret,
        sessionWebhook: sender.sessionWebhook,
        text,
        signal: payload.signal,
      });
    }
    if (payload.channel === 'telegram' && validTelegramToken(sender.token)) {
      const api = new TelegramApi({ token: sender.token, fetchImpl: sender.fetchImpl });
      return api.sendMessage({
        chatId: payload.targetId,
        text: payload.text,
        replyToMessageId: payload.replyTo,
        signal: payload.signal,
      });
    }
  }
  throw Object.assign(new Error(`Invalid outbound sender registered for ${payload.channel}`), {
    code: 'invalid_sender',
  });
}

function attachBridgeToContext(ctx, bridge) {
  if (!ctx || typeof ctx !== 'object') return;
  try {
    if (typeof ctx.provide === 'function') {
      ctx.provide('botOutboundBridge', bridge);
    } else if (typeof ctx.set === 'function') {
      ctx.set('botOutboundBridge', bridge);
    } else {
      ctx.botOutboundBridge = bridge;
    }
  } catch {
    // Cordis proxy may disallow undeclared service properties; global symbol still holds the bridge.
  }
}

export function setActiveBotOutboundBridge(bridge) {
  if (bridge) {
    globalThis[BOT_OUTBOUND_BRIDGE_SYMBOL] = bridge;
  } else {
    delete globalThis[BOT_OUTBOUND_BRIDGE_SYMBOL];
  }
  return bridge ?? null;
}

export function getActiveBotOutboundBridge(ctx = null) {
  if (ctx && typeof ctx === 'object') {
    try {
      if (typeof ctx.get === 'function') {
        const fromCtx = ctx.get('botOutboundBridge');
        if (fromCtx) return fromCtx;
      } else if (ctx.botOutboundBridge) {
        return ctx.botOutboundBridge;
      }
    } catch {
      // Ignore undeclared Cordis service lookup and fall back to shared process bridge.
    }
  }
  return globalThis[BOT_OUTBOUND_BRIDGE_SYMBOL] ?? null;
}

/**
 * Create the shared outbound bridge for WhaleIsle Bots -> `dsh-im` channels.
 * @param {any} [ctx]
 * @param {{ senders?: Record<string, any>, logger?: any, dshHome?: string }} [options]
 */
export function createBotOutboundBridge(ctx = null, options = {}) {
  /** @type {Map<string, any>} */
  const senders = new Map();
  const logger = options.logger ?? (typeof ctx?.logger === 'function' ? ctx.logger('dsh-im:bot-outbound') : console);

  if (options.senders && typeof options.senders === 'object') {
    for (const [key, handler] of Object.entries(options.senders)) {
      if (handler) senders.set(String(key).toLowerCase(), handler);
    }
  }

  function registerSender(channel, sender, { accountId = null } = {}) {
    const normChannel = normalizeChannel(channel);
    if (!normChannel) {
      throw Object.assign(new Error(`Unsupported IM channel: ${String(channel)}`), { code: 'unsupported_channel' });
    }
    if (!sender) {
      throw Object.assign(new Error('Outbound sender handler is required'), { code: 'invalid_argument' });
    }
    const key = senderKey(normChannel, accountId);
    senders.set(key, sender);
    return () => {
      if (senders.get(key) === sender) senders.delete(key);
    };
  }

  function unregisterSender(channel, { accountId = null } = {}) {
    const normChannel = normalizeChannel(channel);
    if (!normChannel) return false;
    return senders.delete(senderKey(normChannel, accountId));
  }

  function resolveSender(channel, accountId) {
    if (accountId) {
      const exact = senders.get(senderKey(channel, accountId));
      if (exact) return { key: senderKey(channel, accountId), sender: exact };
    }
    const byChannel = senders.get(channel);
    if (byChannel) return { key: channel, sender: byChannel };
    return null;
  }

  async function deliverReply({
    botId = null,
    channel,
    accountId = null,
    targetId,
    text = '',
    card = null,
    replyTo = undefined,
    signal = undefined,
  } = {}) {
    const normChannel = normalizeChannel(channel);
    if (!normChannel) {
      return {
        ok: false,
        delivered: false,
        code: 'unsupported_channel',
        channel: cleanStr(channel) || null,
        targetId: cleanStr(targetId) || null,
        error: `Unsupported IM channel: ${String(channel ?? '')}`,
      };
    }
    const normTarget = cleanStr(targetId);
    if (!normTarget) {
      return {
        ok: false,
        delivered: false,
        code: 'missing_target',
        channel: normChannel,
        targetId: null,
        error: 'targetId is required for IM delivery',
      };
    }
    const cleanText = typeof text === 'string' ? text.trim() : '';
    if (!cleanText && !card) {
      return {
        ok: false,
        delivered: false,
        code: 'empty_message',
        channel: normChannel,
        targetId: normTarget,
        error: 'Reply text or card payload is required',
      };
    }

    const found = resolveSender(normChannel, accountId);
    if (!found) {
      return {
        ok: false,
        delivered: false,
        code: 'channel_not_connected',
        channel: normChannel,
        accountId: cleanStr(accountId) || null,
        targetId: normTarget,
        error: `No active outbound sender registered for ${senderKey(normChannel, accountId)}`,
      };
    }

    const payload = {
      botId: cleanStr(botId) || null,
      channel: normChannel,
      accountId: cleanStr(accountId) || null,
      targetId: normTarget,
      text: cleanText,
      ...(card ? { card } : {}),
      ...(replyTo !== undefined ? { replyTo } : {}),
      ...(signal ? { signal } : {}),
    };

    try {
      const providerResult = await invokeRegisteredSender(found.sender, payload);
      return {
        ok: true,
        delivered: true,
        channel: normChannel,
        accountId: payload.accountId,
        targetId: normTarget,
        senderKey: found.key,
        messageId: cleanStr(providerResult?.messageId ?? providerResult?.message_id ?? providerResult?.id) || null,
        providerResult: providerResult ?? null,
      };
    } catch (error) {
      logger?.warn?.(`[dsh-im:bot-outbound] delivery failed on ${found.key}:`, error?.message ?? error);
      return {
        ok: false,
        delivered: false,
        code: cleanStr(error?.code) || 'delivery_failed',
        channel: normChannel,
        accountId: payload.accountId,
        targetId: normTarget,
        senderKey: found.key,
        error: error?.message || String(error),
      };
    }
  }

  async function sendNeedsYouCard({
    botId,
    item,
    channel,
    accountId = null,
    targetId,
    replyTo = undefined,
    signal = undefined,
  } = {}) {
    const built = buildNeedsYouCardPayload({ botId, item, channel });
    const res = await deliverReply({
      botId,
      channel,
      accountId,
      targetId,
      text: built.text,
      card: built.card,
      replyTo,
      signal,
    });
    return {
      ...res,
      cardKind: 'needs_you',
      itemUid: built.card.itemUid || null,
    };
  }

  const bridge = Object.freeze({
    deliverReply,
    sendNeedsYouCard,
    registerSender,
    unregisterSender,
    listSenders: () => [...senders.keys()],
    hasSender: (channel, accountId = null) => Boolean(resolveSender(normalizeChannel(channel), accountId)),
    buildNeedsYouCardPayload,
  });

  attachBridgeToContext(ctx, bridge);
  return bridge;
}
