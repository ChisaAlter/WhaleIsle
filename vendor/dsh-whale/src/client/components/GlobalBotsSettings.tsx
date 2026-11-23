// Global Bots Settings block mounted in Harness `settings.pet.item` slot:
// Enable bots, Ask before new Home Chat, Hide bot-created workspaces,
// Desktop Pet bound bot selector, Desktop Pet Voice interaction toggle,
// and quick navigation into any bot's settings page.

import { useEffect, useState } from 'react';
import { botsStore, useBotsLocale, useBotsState } from '../store/bots-store';
import { BotAvatar } from './BotAvatar';
import { IconChevronRight, IconPlus } from './Icons';

export interface GlobalBotsSettingsProps {
  closeSettings?: () => void;
}

export function GlobalBotsSettings({ closeSettings }: GlobalBotsSettingsProps) {
  const { locale, tr } = useBotsLocale();
  const zh = locale === 'zh-CN';
  const botsEnabled = useBotsState((state) => state.botsEnabled);
  const skipNewHomeChatConfirm = useBotsState((state) => state.skipNewHomeChatConfirm);
  const hideBotCreatedWorkspaces = useBotsState((state) => state.hideBotCreatedWorkspaces);
  const petBotId = useBotsState((state) => state.petBotId);
  const bots = useBotsState((state) => state.bots);
  const voiceState = useBotsState((state) => state.voiceState);
  const [voiceBusy, setVoiceBusy] = useState(false);

  useEffect(() => {
    void botsStore.refreshVoiceState();
  }, []);

  const voiceEnabled = Boolean(voiceState?.enabled);
  const voiceUnavailable = voiceState?.reason === 'voice_unavailable' || voiceState?.state === 'unavailable';

  const handleToggleVoice = async () => {
    if (voiceBusy) return;
    setVoiceBusy(true);
    try {
      const next = await botsStore.toggleVoice(!voiceEnabled);
      if (next.ok === false || next.reason === 'voice_unavailable') {
        botsStore.pushToast({
          message: next.message || (zh ? '当前环境未检测到可用语音设备，已保持文字气泡模式' : 'Voice device unavailable; staying in text bubble mode'),
          tone: 'info',
        });
      }
    } finally {
      setVoiceBusy(false);
    }
  };

  return (
    <div className="dsh-bots-global-settings" data-dsh-bots-global-settings="">
      <div className="dsh-bots-global-row">
        <div className="dsh-bots-global-row-text">
          <div className="dsh-bots-global-row-title">{tr('settings.bots.enable', 'Enable bots')}</div>
          <div className="dsh-bots-global-row-desc">
            {zh
              ? '在侧栏工作区上方显示「大肥鱼队友」分组。关闭后仅隐藏入口并暂停响应，磁盘上的灵魂与记忆不会删除。'
              : 'Show the Whale Bots section above Workspaces in the sidebar. Turning off keeps all files on disk.'}
          </div>
        </div>
        <button
          type="button"
          role="switch"
          className="dsh-bots-switch"
          aria-checked={botsEnabled}
          aria-label={tr('settings.bots.enable', 'Enable bots')}
          onClick={() => void botsStore.updateGlobalSettings({ botsEnabled: !botsEnabled })}
        >
          <span className="dsh-bots-switch-thumb" />
        </button>
      </div>

      <div className="dsh-bots-global-row">
        <div className="dsh-bots-global-row-text">
          <div className="dsh-bots-global-row-title">
            {tr('settings.bots.askNewHomeChat', 'Ask before a new Home Chat')}
          </div>
          <div className="dsh-bots-global-row-desc">
            {zh
              ? '重置大肥鱼队友的主对话前先弹出确认框。'
              : 'Show a confirmation dialog before starting a fresh Home Chat.'}
          </div>
        </div>
        <button
          type="button"
          role="switch"
          className="dsh-bots-switch"
          aria-checked={!skipNewHomeChatConfirm}
          onClick={() => void botsStore.updateGlobalSettings({ skipNewHomeChatConfirm: !skipNewHomeChatConfirm })}
        >
          <span className="dsh-bots-switch-thumb" />
        </button>
      </div>

      <div className="dsh-bots-global-row">
        <div className="dsh-bots-global-row-text">
          <div className="dsh-bots-global-row-title">
            {zh ? '隐藏队友创建的工作区' : 'Hide bot-created workspaces'}
          </div>
          <div className="dsh-bots-global-row-desc">
            {zh
              ? '大肥鱼队友派生或接管的工作区仅展示在队友条目下，不在普通工作区列表中重复出现。'
              : 'Keep bot worker workspaces nested under their bot instead of duplicating them in Workspaces.'}
          </div>
        </div>
        <button
          type="button"
          role="switch"
          className="dsh-bots-switch"
          aria-checked={hideBotCreatedWorkspaces}
          onClick={() => void botsStore.updateGlobalSettings({ hideBotCreatedWorkspaces: !hideBotCreatedWorkspaces })}
        >
          <span className="dsh-bots-switch-thumb" />
        </button>
      </div>

      <div className="dsh-bots-global-row">
        <div className="dsh-bots-global-row-text">
          <div className="dsh-bots-global-row-title">
            {zh ? '桌宠绑定队友' : 'Desktop pet bound bot'}
          </div>
          <div className="dsh-bots-global-row-desc">
            {zh
              ? '桌宠小窗聊天、气泡提醒与快捷入口将连接所选大肥鱼队友的主对话。'
              : 'Connect desktop pet chat and bubble alerts to the selected bot’s Home Chat.'}
          </div>
        </div>
        <select
          className="dsh-bots-pselect"
          style={{ width: 'auto', minWidth: 160 }}
          aria-label={zh ? '桌宠绑定队友' : 'Desktop pet bound bot'}
          value={petBotId ?? ''}
          onChange={(e) => void botsStore.updateGlobalSettings({ petBotId: e.target.value || null })}
        >
          <option value="">{zh ? '默认（首位队友）' : 'Default (first bot)'}</option>
          {bots.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
      </div>

      <div className="dsh-bots-global-row" data-dsh-bots-voice-row="">
        <div className="dsh-bots-global-row-text">
          <div className="dsh-bots-global-row-title" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span>{zh ? '桌宠语音交互（支持插话打断）' : 'Desktop pet voice interaction'}</span>
            {voiceState?.state && voiceState.state !== 'unavailable' && (
              <span className="dsh-bots-badge">{voiceState.state}</span>
            )}
          </div>
          <div className="dsh-bots-global-row-desc">
            {voiceUnavailable
              ? (zh
                ? '当前环境未检测到可用语音端点或麦克风，已自动保持文字气泡交互。'
                : 'No voice endpoint or microphone detected; staying in text bubble mode.')
              : (zh
                ? '开启桌宠低延迟语音对话，支持播报中途随时打断（Barge-in）并即时中止在途推理。'
                : 'Enable low-latency voice conversation with instant barge-in interruption.')}
          </div>
        </div>
        <button
          type="button"
          role="switch"
          className="dsh-bots-switch"
          aria-checked={voiceEnabled}
          aria-label={zh ? '桌宠语音交互' : 'Desktop pet voice interaction'}
          data-dsh-bots-voice-switch=""
          disabled={voiceBusy}
          onClick={() => void handleToggleVoice()}
        >
          <span className="dsh-bots-switch-thumb" />
        </button>
      </div>

      <div style={{ paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div className="dsh-bots-row">
          <span className="dsh-bots-section-title">
            {zh ? `全部大肥鱼队友 (${bots.length})` : `All whale bots (${bots.length})`}
          </span>
          <button
            type="button"
            className="dsh-bots-pbtn dsh-bots-pbtn-xs"
            onClick={() => {
              closeSettings?.();
              botsStore.openModal({ kind: 'new-bot' });
            }}
          >
            <IconPlus size={11} />
            <span>{tr('bots.section.newBot', 'New bot')}</span>
          </button>
        </div>

        {bots.length === 0 ? (
          <div className="dsh-bots-empty">
            {zh ? '还没有创建大肥鱼队友，点击右上角「新建队友」开始。' : 'No bots yet. Create one to get started.'}
          </div>
        ) : (
          bots.map((bot) => (
            <button
              key={bot.id}
              type="button"
              className="dsh-bots-settings-nav-row"
              onClick={() => {
                closeSettings?.();
                botsStore.openBotSettings(bot.id, { host: 'page' });
              }}
            >
              <div className="dsh-bots-row-left">
                <BotAvatar
                  botId={bot.id}
                  avatar={bot.avatar}
                  avatarColor={bot.avatarColor}
                  name={bot.name}
                  size={28}
                  radius={8}
                  paused={bot.paused}
                />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 500 }}>{bot.name}</div>
                  <div className="dsh-bots-muted dsh-bots-ellipsis">
                    {bot.description || (bot.paused ? tr('bots.row.paused', 'Paused') : (zh ? '已启用' : 'Active'))}
                  </div>
                </div>
              </div>
              <IconChevronRight size={14} style={{ opacity: 0.6 }} />
            </button>
          ))
        )}
      </div>
    </div>
  );
}
