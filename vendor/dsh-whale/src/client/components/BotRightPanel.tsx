// Bot Right Panel mounted strictly as a native tab inside Harness `ui-sidebar-right`
// (respecting single-right-panel-contract). Houses Orca's 4 tabs (Home, Connectors, Chats, Files),
// BotPanelHeader, inline BotSettingsView (host="panel"), and Group inspector fallback.

import { useState, type ReactNode } from 'react';
import {
  botsStore,
  useBotById,
  useBotBySessionId,
  useBotsLocale,
  useBotsState,
  useGroupById,
  type BotRightPanelTab,
} from '../store/bots-store';
import { BotActivityTab } from './BotActivityTab';
import { BotAvatar, BotGroupAvatar } from './BotAvatar';
import { BotChatsTab } from './BotChatsTab';
import { BotConnectorsTab } from './BotConnectorsTab';
import { BotFilesTab } from './BotFilesTab';
import { BotPanelHeader } from './BotPanelHeader';
import { BotSettingsView } from './BotSettingsView';
import {
  IconBot,
  IconFileText,
  IconHome,
  IconMessageSquare,
  IconPlug,
  IconTrash,
  IconUsers,
} from './Icons';

export interface BotRightPanelProps {
  sessionId?: string;
  botId?: string | null;
}

export function BotRightPanel({ sessionId, botId: explicitBotId }: BotRightPanelProps) {
  const { locale, tr } = useBotsLocale();
  const zh = locale === 'zh-CN';
  const sessionBot = useBotBySessionId(sessionId);
  const activeBotId = useBotsState((state) => state.activeBotId);
  const activeGroupId = useBotsState((state) => state.activeGroupId);
  const bots = useBotsState((state) => state.bots);
  const activeTab = useBotsState((state) => state.rightPanelTab);
  const settingsRoute = useBotsState((state) => state.settingsRoute);
  const needsYouMap = useBotsState((state) => state.needsYou);
  const explicitBot = useBotById(explicitBotId ?? activeBotId);
  const activeGroup = useGroupById(activeGroupId);
  const [filterOpen, setFilterOpen] = useState(false);

  const bot = explicitBotId
    ? explicitBot
    : (sessionBot ?? explicitBot ?? bots[0] ?? null);

  if (!bot && activeGroup) {
    const memberBots = activeGroup.members
      .map((m) => bots.find((candidate) => candidate.id === m.botId))
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
    return (
      <div className="dsh-bots-panel-root" data-dsh-bots-right-panel="group">
        <div className="dsh-bots-panel-header">
          <BotGroupAvatar members={memberBots} size={36} unread={activeGroup.unread} />
          <div className="dsh-bots-panel-meta">
            <div className="dsh-bots-panel-name">{activeGroup.name}</div>
            <div className="dsh-bots-panel-sub">
              {zh ? `${memberBots.length} 位大肥鱼队友` : `${memberBots.length} member bots`}
            </div>
          </div>
        </div>
        <div className="dsh-bots-panel-scroll">
          <div className="dsh-bots-psection">
            <div className="dsh-bots-section-head">
              <span className="dsh-bots-section-title">
                <IconUsers size={13} />
                <span>{zh ? '群成员' : 'Members'}</span>
              </span>
              <button
                type="button"
                className="dsh-bots-pbtn dsh-bots-pbtn-xs"
                onClick={() => botsStore.openModal({ kind: 'group', groupId: activeGroup.id })}
              >
                {tr('bots.groups.manageMembers', 'Manage members…')}
              </button>
            </div>
            {memberBots.map((member) => (
              <div
                key={member.id}
                className="dsh-bots-settings-row"
                style={{ cursor: 'pointer' }}
                onClick={() => void botsStore.openBotHome(member.id)}
              >
                <div className="dsh-bots-row-left">
                  <BotAvatar
                    botId={member.id}
                    avatar={member.avatar}
                    avatarColor={member.avatarColor}
                    name={member.name}
                    size={28}
                    radius={8}
                    paused={member.paused}
                    status={member.dotState ?? undefined}
                  />
                  <span className="dsh-bots-ellipsis" style={{ fontWeight: 500 }}>{member.name}</span>
                </div>
                <span className="dsh-bots-muted">
                  {member.paused ? tr('bots.row.paused', 'Paused') : tr('bots.panel.idle', 'Idle')}
                </span>
              </div>
            ))}
          </div>
          <button
            type="button"
            className="dsh-bots-pbtn dsh-bots-pbtn-danger"
            onClick={() => botsStore.openModal({ kind: 'confirm-delete-group', groupId: activeGroup.id })}
          >
            <IconTrash size={13} />
            <span>{tr('bots.groups.delete', 'Delete group…')}</span>
          </button>
        </div>
      </div>
    );
  }

  if (!bot) {
    return (
      <div className="dsh-bots-panel-root" data-dsh-bots-right-panel="empty">
        <div className="dsh-bots-panel-scroll" style={{ justifyContent: 'center', alignItems: 'center' }}>
          <IconBot size={28} style={{ opacity: 0.45 }} />
          <div className="dsh-bots-muted">
            {zh ? '选择左侧任意大肥鱼队友查看概览、聊天、文件与设置。' : 'Select a bot from the sidebar to inspect it.'}
          </div>
          <button
            type="button"
            className="dsh-bots-pbtn dsh-bots-pbtn-primary"
            onClick={() => botsStore.openModal({ kind: 'new-bot' })}
          >
            {tr('bots.section.newBot', 'New bot')}
          </button>
        </div>
      </div>
    );
  }

  if (settingsRoute?.host === 'panel' && settingsRoute.botId === bot.id) {
    return (
      <div className="dsh-bots-panel-root" data-dsh-bots-right-panel="settings">
        <BotSettingsView host="panel" botId={bot.id} />
      </div>
    );
  }

  const needsYouCount = needsYouMap[bot.id] ?? bot.needsYouCount ?? 0;

  const tabs: Array<{ id: BotRightPanelTab; label: string; icon: ReactNode; badge?: number }> = [
    { id: 'home', label: tr('bots.items.tab', '概览'), icon: <IconHome size={13} />, badge: needsYouCount },
    { id: 'connectors', label: tr('bots.connectors.tab', '连接器'), icon: <IconPlug size={13} /> },
    { id: 'chats', label: tr('bots.chats.title', '聊天'), icon: <IconMessageSquare size={13} /> },
    { id: 'files', label: tr('bots.files.tab', '文件'), icon: <IconFileText size={13} /> },
  ];

  const subtitle = typeof bot.activityLine === 'string'
    ? bot.activityLine
    : (bot.activityLine?.text ?? bot.description ?? undefined);

  return (
    <div className="dsh-bots-panel-root" data-dsh-bots-right-panel={bot.id}>
      <BotPanelHeader
        bot={bot}
        subtitle={subtitle}
        showFilterToggle={activeTab === 'home'}
        filterOpen={filterOpen}
        onToggleFilter={() => setFilterOpen((prev) => !prev)}
        onOpenSettings={() => botsStore.openBotSettings(bot.id, { host: 'panel' })}
      />

      <div className="dsh-bots-panel-tabs-wrap">
        <div className="dsh-bots-panel-tabs" role="tablist">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              className="dsh-bots-panel-tab"
              onClick={() => botsStore.setRightPanelTab(tab.id, bot.id)}
            >
              {tab.icon}
              <span>{tab.label}</span>
              {tab.badge && tab.badge > 0 ? (
                <span className="dsh-bots-badge dsh-bots-badge-warn">{tab.badge}</span>
              ) : null}
            </button>
          ))}
        </div>
      </div>

      {activeTab === 'home' && <BotActivityTab bot={bot} filterOpen={filterOpen} />}
      {activeTab === 'connectors' && <BotConnectorsTab bot={bot} />}
      {activeTab === 'chats' && <BotChatsTab bot={bot} />}
      {activeTab === 'files' && <BotFilesTab bot={bot} />}
    </div>
  );
}
