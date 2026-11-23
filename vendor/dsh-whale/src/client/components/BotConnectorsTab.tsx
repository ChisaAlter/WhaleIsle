// Bot Connectors panel & settings subpage: integrates WhaleIsle dsh-im channels
// (Feishu / WeCom / DingTalk / Telegram / Discord / Slack) and local inbound Webhooks.

import { useCallback, useEffect, useState } from 'react';
import { botsStore, useBotsLocale } from '../store/bots-store';
import { callBotRpc, type BotRecord } from '../store/rpc';
import { IconCopy, IconPlug, IconPlus, IconRefresh, IconTrash } from './Icons';

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
}

interface WebhookInfo {
  id: string;
  name: string;
  enabled: boolean;
  path: string;
  hasSecret: boolean;
  createdAt?: number | null;
}

interface ConnectorsPayload {
  botId: string;
  imDefault: boolean;
  imChannels: ImChannelInfo[];
  webhooks: WebhookInfo[];
}

const CHANNEL_LABELS_ZH: Record<string, string> = {
  feishu: '飞书 (Feishu)',
  wecom: '企业微信 (WeCom)',
  dingtalk: '钉钉 (DingTalk)',
  telegram: 'Telegram',
  discord: 'Discord',
  slack: 'Slack',
};

export function BotConnectorsTab({ bot, embedded = false }: BotConnectorsTabProps) {
  const { locale } = useBotsLocale();
  const zh = locale === 'zh-CN';
  const [data, setData] = useState<ConnectorsPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [addingHook, setAddingHook] = useState(false);
  const [hookName, setHookName] = useState('');
  const [hookSecret, setHookSecret] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await callBotRpc<ConnectorsPayload>('bots.connectors.list', { botId: bot.id });
      setData(res);
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

  const updatePatch = async (patch: Record<string, unknown>) => {
    setSaving(true);
    try {
      const next = await callBotRpc<ConnectorsPayload>('bots.connectors.update', {
        botId: bot.id,
        ...patch,
      });
      setData(next);
    } catch (err) {
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
    if (!trimmed || !data) {
      return;
    }
    const nextHooks = [
      ...data.webhooks.map((w) => ({ id: w.id, name: w.name, enabled: w.enabled, createdAt: w.createdAt })),
      { name: trimmed, enabled: true, ...(hookSecret.trim() ? { secret: hookSecret.trim() } : {}) },
    ];
    await updatePatch({ webhooks: nextHooks });
    setHookName('');
    setHookSecret('');
    setAddingHook(false);
  };

  const handleRemoveWebhook = async (id: string) => {
    if (!data) {
      return;
    }
    const nextHooks = data.webhooks
      .filter((w) => w.id !== id)
      .map((w) => ({ id: w.id, name: w.name, enabled: w.enabled, createdAt: w.createdAt }));
    await updatePatch({ webhooks: nextHooks });
  };

  const handleToggleWebhook = async (id: string, enabled: boolean) => {
    if (!data) {
      return;
    }
    const nextHooks = data.webhooks.map((w) => ({
      id: w.id,
      name: w.name,
      enabled: w.id === id ? enabled : w.enabled,
      createdAt: w.createdAt,
    }));
    await updatePatch({ webhooks: nextHooks });
  };

  const content = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="dsh-bots-psection">
        <div className="dsh-bots-section-head">
          <span className="dsh-bots-section-title">
            <IconPlug size={13} />
            <span>{zh ? 'IM 渠道接入 (dsh-im)' : 'IM Channels (dsh-im)'}</span>
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
              {zh ? '未指定其他预设的 IM 消息将自动路由到该队友的主对话。' : 'Unassigned IM messages route into this bot’s Home Chat.'}
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

        {(data?.imChannels ?? []).map((ch) => (
          <div key={ch.kind} className="dsh-bots-settings-row">
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontWeight: 500 }}>{zh ? (CHANNEL_LABELS_ZH[ch.kind] ?? ch.label) : ch.label}</span>
                <span className={`dsh-bots-badge ${ch.configured ? 'dsh-bots-badge-success' : ''}`}>
                  {ch.configured ? (zh ? '已配置' : 'Configured') : (zh ? '未配置' : 'Not configured')}
                </span>
              </div>
              <div className="dsh-bots-muted">
                {ch.configured
                  ? (zh ? '可将此渠道消息与该队友关联' : 'Ready to bind to this bot')
                  : (zh ? '请先在「设置 › 远程与 IM」中完成通道凭证配置' : 'Configure channel credentials in Settings › Remote first')}
              </div>
            </div>
            <button
              type="button"
              role="switch"
              className="dsh-bots-switch"
              aria-checked={ch.bound}
              disabled={saving}
              onClick={() => void updatePatch({ im: { [ch.kind]: !ch.bound } })}
            >
              <span className="dsh-bots-switch-thumb" />
            </button>
          </div>
        ))}
      </div>

      <div className="dsh-bots-psection">
        <div className="dsh-bots-section-head">
          <span className="dsh-bots-section-title">{zh ? '本地入站 Webhooks' : 'Local Webhooks'}</span>
          <button
            type="button"
            className="dsh-bots-pbtn dsh-bots-pbtn-xs"
            onClick={() => setAddingHook((prev) => !prev)}
          >
            <IconPlus size={11} />
            <span>{zh ? '新增 Webhook' : 'Add webhook'}</span>
          </button>
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
              placeholder={zh ? '签名密钥 Secret（可选）' : 'Signing secret (optional)'}
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

        {(data?.webhooks ?? []).length === 0 ? (
          <div className="dsh-bots-empty">
            {zh ? '尚未配置本地 Webhook。创建后可接收外部事件触发机器人处理。' : 'No local webhooks configured yet.'}
          </div>
        ) : (
          (data?.webhooks ?? []).map((hook) => (
            <div key={hook.id} className="dsh-bots-pcard">
              <div className="dsh-bots-row">
                <div className="dsh-bots-row-left">
                  <span style={{ fontWeight: 600 }}>{hook.name}</span>
                  {hook.hasSecret && <span className="dsh-bots-badge">Secret</span>}
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
                    title={zh ? '复制路径' : 'Copy path'}
                    onClick={() => {
                      void botsStore.copyToClipboard(hook.path).then((ok) => {
                        botsStore.pushToast({
                          message: ok ? (zh ? '已复制 Webhook 路径' : 'Copied webhook path') : (zh ? '复制失败' : 'Copy failed'),
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
              <div className="dsh-bots-muted" style={{ fontFamily: 'var(--ds-font-family-code)', wordBreak: 'break-all' }}>
                POST {hook.path}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );

  return embedded ? content : <div className="dsh-bots-panel-scroll">{content}</div>;
}
