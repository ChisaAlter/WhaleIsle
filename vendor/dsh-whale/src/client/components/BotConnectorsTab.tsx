// Bot Connectors panel & settings subpage:
// Displays all 9 dsh-im channels (Feishu / WeCom / DingTalk / Telegram / Discord / Slack / QQ / Weixin / WhatsApp),
// single-channel -> target Bot route binding selectors, and local inbound Webhooks with full URL & HMAC-SHA256 status.

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BOT_IM_CHANNELS,
  BOT_WEBHOOK_MAX_SKEW_SEC,
  BOT_WEBHOOK_RATE_LIMIT_PER_MIN,
} from '../../shared/bot-types.js';
import { botsStore, useBotsLocale, useBotsState } from '../store/bots-store';
import {
  RPC_METHODS,
  callBotRpc,
  getBotsApiBase,
  setConnectorChannelRoute,
  type BotRecord,
} from '../store/rpc';
import { BotChevron, BotDisclosure } from './BotDisclosure';
import {
  IconCopy,
  IconPlug,
  IconPlus,
  IconRefresh,
  IconShield,
  IconTrash,
} from './Icons';

export interface BotConnectorsTabProps {
  bot: BotRecord;
  embedded?: boolean;
}

interface ImChannelInfo {
  kind: string;
  configured: boolean;
  enabled: boolean;
  label: string;
  bound: boolean;
  routeBotId?: string | null;
}

interface WebhookInfo {
  id: string;
  name: string;
  enabled: boolean;
  path: string;
  url?: string;
  hasSecret: boolean;
  hmacRequired?: boolean;
  createdAt?: number | null;
}

interface ConnectorsPayload {
  botId?: string;
  imDefault?: boolean;
  imChannels?: ImChannelInfo[];
  routes?: Record<string, string | null>;
  webhooks?: WebhookInfo[];
}

const CHANNEL_LABELS: Record<string, { zh: string; en: string }> = {
  feishu: { zh: '飞书 (Feishu)', en: 'Feishu' },
  wecom: { zh: '企业微信 (WeCom)', en: 'WeCom' },
  dingtalk: { zh: '钉钉 (DingTalk)', en: 'DingTalk' },
  telegram: { zh: 'Telegram', en: 'Telegram' },
  discord: { zh: 'Discord', en: 'Discord' },
  slack: { zh: 'Slack', en: 'Slack' },
  qq: { zh: 'QQ 频道 / 机器人', en: 'QQ' },
  weixin: { zh: '微信 (Weixin)', en: 'Weixin' },
  whatsapp: { zh: 'WhatsApp', en: 'WhatsApp' },
};

function buildWebhookDisplayUrl(hook: WebhookInfo): string {
  if (hook.url) {
    return hook.url;
  }
  const base = getBotsApiBase();
  const origin = base || (typeof window !== 'undefined' && window.location?.origin && window.location.origin !== 'null'
    ? window.location.origin
    : '');
  const pathStr = hook.path || `/dsh-bots/webhooks/${hook.id}`;
  return origin && pathStr.startsWith('/') ? `${origin}${pathStr}` : pathStr;
}

export function BotConnectorsTab({ bot, embedded = false }: BotConnectorsTabProps) {
  const { locale } = useBotsLocale();
  const zh = locale === 'zh-CN';
  const allBots = useBotsState((state) => state.bots);
  const [data, setData] = useState<ConnectorsPayload | null>(null);
  const [webhooks, setWebhooks] = useState<WebhookInfo[]>([]);
  const [routesMap, setRoutesMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [addingHook, setAddingHook] = useState(false);
  const [hookName, setHookName] = useState('');
  const [hookSecret, setHookSecret] = useState('');
  const [hmacGuideOpen, setHmacGuideOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [connRes, hookRes] = await Promise.allSettled([
        callBotRpc<ConnectorsPayload>('bots.connectors.list', { botId: bot.id }),
        callBotRpc<WebhookInfo[] | { webhooks?: WebhookInfo[] }>(RPC_METHODS.CONNECTORS_WEBHOOK_LIST, { botId: bot.id }),
      ]);
      if (connRes.status === 'fulfilled' && connRes.value && typeof connRes.value === 'object') {
        const payload = connRes.value;
        setData(payload);
        const nextRoutes: Record<string, string> = {};
        if (payload.routes && typeof payload.routes === 'object') {
          for (const [k, v] of Object.entries(payload.routes)) {
            if (typeof v === 'string' && v) nextRoutes[k] = v;
          }
        }
        for (const ch of payload.imChannels ?? []) {
          if (typeof ch.routeBotId === 'string' && ch.routeBotId) {
            nextRoutes[ch.kind] = ch.routeBotId;
          } else if (ch.bound && !nextRoutes[ch.kind]) {
            nextRoutes[ch.kind] = bot.id;
          }
        }
        setRoutesMap(nextRoutes);
        if (hookRes.status !== 'fulfilled') {
          setWebhooks(Array.isArray(payload.webhooks) ? payload.webhooks : []);
        }
      }
      if (hookRes.status === 'fulfilled') {
        const val = hookRes.value;
        const list = Array.isArray(val) ? val : (Array.isArray(val?.webhooks) ? val.webhooks : []);
        if (list.length > 0 || connRes.status !== 'fulfilled' || !(connRes.value?.webhooks?.length)) {
          setWebhooks(list);
        } else if (connRes.status === 'fulfilled' && Array.isArray(connRes.value?.webhooks)) {
          setWebhooks(connRes.value.webhooks);
        }
      }
    } catch (err) {
      botsStore.pushToast({
        message: err instanceof Error ? err.message : String(err),
        tone: 'error',
      });
    } finally {
      setLoading(false);
    }
  }, [bot.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const channels = useMemo<ImChannelInfo[]>(() => {
    const byKind = new Map<string, ImChannelInfo>();
    for (const ch of data?.imChannels ?? []) {
      if (ch && typeof ch.kind === 'string') {
        byKind.set(ch.kind, ch);
      }
    }
    return BOT_IM_CHANNELS.map((kind) => {
      const existing = byKind.get(kind);
      const labelMeta = CHANNEL_LABELS[kind] ?? { zh: kind, en: kind };
      const routeBotId = routesMap[kind] ?? existing?.routeBotId ?? (existing?.bound ? bot.id : '');
      return {
        kind,
        configured: Boolean(existing?.configured),
        enabled: Boolean(existing?.enabled),
        label: zh ? labelMeta.zh : (existing?.label || labelMeta.en),
        bound: routeBotId === bot.id || Boolean(existing?.bound),
        routeBotId: routeBotId || null,
      };
    });
  }, [bot.id, data?.imChannels, routesMap, zh]);

  const updatePatch = async (patch: Record<string, unknown>) => {
    setSaving(true);
    try {
      const next = await callBotRpc<ConnectorsPayload>('bots.connectors.update', {
        botId: bot.id,
        ...patch,
      });
      if (next && typeof next === 'object') {
        setData(next);
        if (Array.isArray(next.webhooks)) {
          setWebhooks(next.webhooks);
        }
      }
    } catch (err) {
      botsStore.pushToast({
        message: err instanceof Error ? err.message : String(err),
        tone: 'error',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleSetRoute = async (channel: string, targetBotId: string) => {
    const prev = routesMap;
    setRoutesMap((cur) => {
      const next = { ...cur };
      if (targetBotId) next[channel] = targetBotId;
      else delete next[channel];
      return next;
    });
    setSaving(true);
    try {
      await setConnectorChannelRoute({ channel, botId: targetBotId || null });
      void load();
    } catch (err) {
      setRoutesMap(prev);
      botsStore.pushToast({
        message: err instanceof Error ? err.message : String(err),
        tone: 'error',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleAddWebhook = async () => {
    const trimmed = hookName.trim();
    if (!trimmed) {
      return;
    }
    setSaving(true);
    try {
      await callBotRpc(RPC_METHODS.CONNECTORS_WEBHOOK_CREATE, {
        botId: bot.id,
        name: trimmed,
        ...(hookSecret.trim() ? { secret: hookSecret.trim() } : {}),
      });
      setHookName('');
      setHookSecret('');
      setAddingHook(false);
      await load();
    } catch {
      const nextHooks = [
        ...webhooks.map((w) => ({ id: w.id, name: w.name, enabled: w.enabled, createdAt: w.createdAt })),
        { name: trimmed, enabled: true, ...(hookSecret.trim() ? { secret: hookSecret.trim() } : {}) },
      ];
      await updatePatch({ webhooks: nextHooks });
      setHookName('');
      setHookSecret('');
      setAddingHook(false);
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveWebhook = async (id: string) => {
    setSaving(true);
    try {
      await callBotRpc(RPC_METHODS.CONNECTORS_WEBHOOK_DELETE, { botId: bot.id, webhookId: id, id });
      await load();
    } catch {
      const nextHooks = webhooks
        .filter((w) => w.id !== id)
        .map((w) => ({ id: w.id, name: w.name, enabled: w.enabled, createdAt: w.createdAt }));
      await updatePatch({ webhooks: nextHooks });
    } finally {
      setSaving(false);
    }
  };

  const handleToggleWebhook = async (id: string, enabled: boolean) => {
    const nextHooks = webhooks.map((w) => ({
      id: w.id,
      name: w.name,
      enabled: w.id === id ? enabled : w.enabled,
      createdAt: w.createdAt,
    }));
    await updatePatch({ webhooks: nextHooks });
  };

  const content = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }} data-dsh-bots-connectors={bot.id}>
      <div className="dsh-bots-psection">
        <div className="dsh-bots-section-head">
          <span className="dsh-bots-section-title">
            <IconPlug size={13} />
            <span>{zh ? `IM 渠道路由 (${channels.length} 渠道)` : `IM Channels (${channels.length})`}</span>
          </span>
          <button
            type="button"
            className="dsh-bots-pbtn dsh-bots-pbtn-xs dsh-bots-pbtn-icon"
            onClick={() => void load()}
            title={zh ? '刷新状态' : 'Refresh'}
          >
            <IconRefresh size={12} />
          </button>
        </div>

        <div className="dsh-bots-settings-row">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 500, fontSize: 13 }}>
              {zh ? '作为默认 IM 接待队友' : 'Default IM routing bot'}
            </div>
            <div className="dsh-bots-muted">
              {zh ? '未单独绑定路由的渠道消息将自动回退到此队友。' : 'Unassigned IM messages fall back to this bot.'}
            </div>
          </div>
          <button
            type="button"
            role="switch"
            className="dsh-bots-switch"
            aria-checked={Boolean(data?.imDefault)}
            disabled={saving || loading}
            onClick={() => void updatePatch({ imDefault: !data?.imDefault })}
          >
            <span className="dsh-bots-switch-thumb" />
          </button>
        </div>

        {channels.map((ch) => (
          <div key={ch.kind} className="dsh-bots-settings-row" data-dsh-bots-channel={ch.kind}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 500 }}>{ch.label}</span>
                <span className={`dsh-bots-badge ${ch.configured ? 'dsh-bots-badge-success' : ''}`}>
                  {ch.configured ? (zh ? '已配置' : 'Configured') : (zh ? '未配置' : 'Not configured')}
                </span>
              </div>
              <div className="dsh-bots-muted">
                {ch.configured
                  ? (zh ? '选择此渠道消息路由到的目标队友' : 'Select target bot for inbound messages')
                  : (zh ? '请先在「设置 › 远程与 IM」完成通道凭证配置' : 'Configure channel credentials in Settings › Remote')}
              </div>
            </div>
            <select
              className="dsh-bots-pselect dsh-bots-route-select"
              data-dsh-bots-channel-route={ch.kind}
              aria-label={zh ? `${ch.label} 路由目标队友` : `${ch.label} route target bot`}
              value={ch.routeBotId ?? ''}
              disabled={saving}
              onChange={(e) => void handleSetRoute(ch.kind, e.target.value)}
            >
              <option value="">{zh ? '默认回退' : 'Default fallback'}</option>
              {allBots.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>

      <div className="dsh-bots-psection">
        <div className="dsh-bots-section-head">
          <span className="dsh-bots-section-title">
            <IconShield size={13} />
            <span>{zh ? '本地入站 Webhooks (HMAC)' : 'Local Webhooks (HMAC)'}</span>
          </span>
          <button
            type="button"
            className="dsh-bots-pbtn dsh-bots-pbtn-xs"
            onClick={() => setAddingHook((prev) => !prev)}
          >
            <IconPlus size={11} />
            <span>{zh ? '新增 Webhook' : 'Add webhook'}</span>
          </button>
        </div>

        <div className="dsh-bots-pcard">
          <button
            type="button"
            className="dsh-bots-item-group-btn"
            onClick={() => setHmacGuideOpen((prev) => !prev)}
          >
            <BotChevron open={hmacGuideOpen} size={12} />
            <span>{zh ? 'HMAC-SHA256 验签与防重放说明' : 'HMAC-SHA256 signing & replay policy'}</span>
            <span className="dsh-bots-badge dsh-bots-badge-accent">
              ±{BOT_WEBHOOK_MAX_SKEW_SEC}s · {BOT_WEBHOOK_RATE_LIMIT_PER_MIN}/min
            </span>
          </button>
          <BotDisclosure open={hmacGuideOpen}>
            <div className="dsh-bots-muted" style={{ marginTop: 4, lineHeight: '19px' }}>
              {zh
                ? '入站请求须携带 x-whale-timestamp（±300s 时间窗）、x-whale-signature（HMAC-SHA256(secret, ts + "." + rawBody)）与 x-whale-event-id（24 小时幂等去重）。'
                : 'Inbound requests require x-whale-timestamp (±300s), x-whale-signature (HMAC-SHA256 of ts + "." + rawBody), and x-whale-event-id for 24h idempotency.'}
            </div>
          </BotDisclosure>
        </div>

        {addingHook && (
          <div className="dsh-bots-pcard">
            <input
              type="text"
              className="dsh-bots-pinput"
              placeholder={zh ? 'Webhook 名称（如 CI 报警）' : 'Webhook name'}
              value={hookName}
              onChange={(e) => setHookName(e.target.value)}
            />
            <input
              type="password"
              className="dsh-bots-pinput"
              placeholder={zh ? 'HMAC 签名密钥 Secret（留空将自动生成）' : 'HMAC secret (auto-generated if blank)'}
              value={hookSecret}
              onChange={(e) => setHookSecret(e.target.value)}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
              <button type="button" className="dsh-bots-pbtn dsh-bots-pbtn-xs" onClick={() => setAddingHook(false)}>
                {zh ? '取消' : 'Cancel'}
              </button>
              <button
                type="button"
                className="dsh-bots-pbtn dsh-bots-pbtn-xs dsh-bots-pbtn-primary"
                disabled={!hookName.trim() || saving}
                onClick={() => void handleAddWebhook()}
              >
                {zh ? '创建' : 'Create'}
              </button>
            </div>
          </div>
        )}

        {webhooks.length === 0 ? (
          <div className="dsh-bots-empty">
            {zh ? '尚未配置本地 Webhook。创建后可接收签名外部事件触发机器人处理。' : 'No local webhooks configured yet.'}
          </div>
        ) : (
          webhooks.map((hook) => {
            const fullUrl = buildWebhookDisplayUrl(hook);
            return (
              <div key={hook.id} className="dsh-bots-pcard" data-dsh-bots-webhook={hook.id}>
                <div className="dsh-bots-row">
                  <div className="dsh-bots-row-left" style={{ flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 600 }}>{hook.name}</span>
                    <span className={`dsh-bots-badge ${hook.hasSecret ? 'dsh-bots-badge-success' : 'dsh-bots-badge-warn'}`}>
                      <IconShield size={10} />
                      <span>{hook.hasSecret ? (zh ? 'HMAC 已签名' : 'HMAC signed') : (zh ? '未设密钥' : 'No secret')}</span>
                    </span>
                  </div>
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <button
                      type="button"
                      role="switch"
                      className="dsh-bots-switch"
                      aria-checked={hook.enabled}
                      onClick={() => void handleToggleWebhook(hook.id, !hook.enabled)}
                    >
                      <span className="dsh-bots-switch-thumb" />
                    </button>
                    <button
                      type="button"
                      className="dsh-bots-pbtn dsh-bots-pbtn-xs dsh-bots-pbtn-icon"
                      title={zh ? '复制 Webhook URL' : 'Copy webhook URL'}
                      onClick={() => {
                        void botsStore.copyToClipboard(fullUrl).then((ok) => {
                          botsStore.pushToast({
                            message: ok ? (zh ? '已复制 Webhook URL' : 'Copied webhook URL') : (zh ? '复制失败' : 'Copy failed'),
                            tone: ok ? 'success' : 'error',
                          });
                        });
                      }}
                    >
                      <IconCopy size={12} />
                    </button>
                    <button
                      type="button"
                      className="dsh-bots-pbtn dsh-bots-pbtn-xs dsh-bots-pbtn-icon dsh-bots-pbtn-danger"
                      title={zh ? '删除' : 'Delete'}
                      onClick={() => void handleRemoveWebhook(hook.id)}
                    >
                      <IconTrash size={12} />
                    </button>
                  </div>
                </div>
                <div className="dsh-bots-muted dsh-bots-tsv-mono" style={{ wordBreak: 'break-all' }}>
                  POST {fullUrl}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );

  return embedded ? content : <div className="dsh-bots-panel-scroll">{content}</div>;
}
