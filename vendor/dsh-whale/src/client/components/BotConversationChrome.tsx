// Bot Conversation Header chrome (leading bot chip + Home/Side switch + new chat menu,
// header actions for Home/Chats/Files/Settings/Pause) and HOC frame wrapper for paused banner
// and first-run kickoff overlay.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { orderBotChats } from '../../shared/bot-sidebar-logic.js';
import {
  botsStore,
  useBotBySessionId,
  useBotsLocale,
  useBotsState,
} from '../store/bots-store';
import type { BotChatRow, BotRecord } from '../store/rpc';
import { BotAvatar } from './BotAvatar';
import {
  IconAlertTriangle,
  IconCheck,
  IconChevronDown,
  IconHome,
  IconMessageSquare,
  IconPause,
  IconPlay,
  IconSettings,
} from './Icons';

export interface BotHeaderSlotProps {
  sessionId?: string;
  useSessions?: <T>(selector: (state: { byId?: Record<string, { presentation?: { owner?: string } }> }) => T) => T;
}

function useDropdownDismiss(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const handlePointer = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        onClose();
      }
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('mousedown', handlePointer);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handlePointer);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open, onClose]);
  return ref;
}

function resolveChatsForBot(chats: BotChatRow[] | undefined, bot: BotRecord): BotChatRow[] {
  const ordered = orderBotChats((chats ?? []).filter((chat) => !chat.closed)) as BotChatRow[];
  if (ordered.length > 0) {
    return ordered;
  }
  const homeSid = bot.chatSessionId ?? bot.homeSessionId;
  return homeSid ? [{ chatId: homeSid, sessionId: homeSid, origin: 'home', title: 'Home Chat' }] : [];
}

function isHomeChat(chat: BotChatRow, homeSessionId: string | null): boolean {
  return chat.origin === 'home' || chat.sessionId === homeSessionId;
}

function isActiveChat(chat: BotChatRow, sessionId: string | undefined): boolean {
  return Boolean(sessionId) && (chat.sessionId === sessionId || chat.chatId === sessionId);
}

export function BotConversationLeading({ sessionId }: BotHeaderSlotProps) {
  const bot = useBotBySessionId(sessionId);
  const { locale, tr } = useBotsLocale();
  const chatTree = useBotsState((state) => (bot ? state.chatsByBot[bot.id] : undefined));
  const [menuOpen, setMenuOpen] = useState(false);
  const [pillRevealed, setPillRevealed] = useState(false);
  const menuRef = useDropdownDismiss(menuOpen, () => setMenuOpen(false));

  const allChats = useMemo(
    () => (bot ? resolveChatsForBot(chatTree?.chats, bot) : []),
    [bot, chatTree?.chats],
  );

  if (!bot) {
    return null;
  }

  const homeSessionId = bot.chatSessionId ?? bot.homeSessionId ?? allChats[0]?.sessionId ?? null;
  const activeChat = allChats.find((chat) => isActiveChat(chat, sessionId))
    ?? allChats.find((chat) => isHomeChat(chat, homeSessionId))
    ?? allChats[0];
  const chatLabel = (chat: BotChatRow) => (isHomeChat(chat, homeSessionId)
    ? tr('bots.chats.home', 'Home Chat')
    : (chat.title || (chat.origin === 'automation'
      ? tr('bots.chats.kindAutomation', 'Automation')
      : tr('bots.chats.kindSide', 'Side chat'))));
  const openChat = (chat: BotChatRow) => {
    if (isHomeChat(chat, homeSessionId)) {
      void botsStore.openBotHome(bot.id);
    } else {
      botsStore.openBotChat(bot.id, chat.sessionId);
    }
  };
  const activeIsHome = activeChat ? isHomeChat(activeChat, homeSessionId) : true;
  const activeLabel = activeChat ? chatLabel(activeChat) : tr('bots.chats.home', 'Home Chat');
  const pillTooltip = `${bot.name} · ${activeLabel}`;

  return (
    <div className="dsh-bots-conv-lead" data-dsh-bots-conv-leading={bot.id}>
      <div
        ref={menuRef}
        className="dsh-bots-pmenu-wrap"
        onPointerEnter={(event) => {
          if (event.pointerType !== 'touch') {
            setPillRevealed(true);
          }
        }}
        onPointerLeave={(event) => {
          if (event.pointerType !== 'touch') {
            setPillRevealed(false);
          }
        }}
      >
        <button
          type="button"
          className="dsh-bots-conv-pill"
          aria-label={pillTooltip}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          data-revealed={menuOpen || pillRevealed ? 'true' : 'false'}
          title={pillTooltip}
          onClick={() => setMenuOpen((prev) => !prev)}
        >
          <BotAvatar
            botId={bot.id}
            avatar={bot.avatar}
            avatarColor={bot.avatarColor}
            name={bot.name}
            size={20}
            radius={6}
            status={bot.dotState ?? undefined}
            paused={bot.paused}
            usageLimit={Boolean(bot.usageLimit)}
          />
          <span className="dsh-bots-conv-pill-icon" aria-hidden="true">
            {activeIsHome ? <IconHome size={13} /> : <IconMessageSquare size={13} />}
          </span>
          <span className="dsh-bots-reveal-label">
            <span className="dsh-bots-reveal-clip">
              <span className="dsh-bots-reveal-text">
                {activeLabel}
                {allChats.length > 1 ? ` · ${allChats.length}` : ''}
              </span>
            </span>
          </span>
          <IconChevronDown size={12} className="dsh-bots-conv-pill-arrow" />
        </button>

        {menuOpen && (
          <div className="dsh-bots-pmenu dsh-bots-pmenu-left" role="menu">
            {allChats.map((chat) => {
              const isHome = isHomeChat(chat, homeSessionId);
              const selected = isActiveChat(chat, sessionId) || (activeChat?.chatId === chat.chatId);
              const label = chatLabel(chat);
              return (
                <button
                  key={chat.chatId}
                  type="button"
                  className="dsh-bots-pmenu-item"
                  role="menuitemradio"
                  aria-checked={selected}
                  aria-selected={selected}
                  title={label}
                  onClick={() => {
                    setMenuOpen(false);
                    openChat(chat);
                  }}
                >
                  {isHome ? <IconHome size={13} /> : <IconMessageSquare size={13} />}
                  <span className="dsh-bots-pmenu-item-label">{label}</span>
                  {selected && <IconCheck size={13} className="dsh-bots-pmenu-check" />}
                </button>
              );
            })}
            <div className="dsh-bots-pmenu-sep" />
            <button
              type="button"
              className="dsh-bots-pmenu-item"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                void botsStore.startSideChat(bot.id);
              }}
            >
              <IconMessageSquare size={13} />
              <span>{locale === 'zh-CN' ? '新建支线聊天' : 'New side chat'}</span>
            </button>
            <button
              type="button"
              className="dsh-bots-pmenu-item"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                void botsStore.resetBotHomeChat(bot.id);
              }}
            >
              <IconHome size={13} />
              <span>
                {locale === 'zh-CN' ? '新建主对话（从头开始）' : 'New Home Chat (start fresh)'}
              </span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function BotConversationActions({ sessionId }: BotHeaderSlotProps) {
  const bot = useBotBySessionId(sessionId);
  const { locale, tr } = useBotsLocale();
  const needsYouCount = useBotsState((state) => (bot ? (state.needsYou[bot.id] ?? bot.needsYouCount ?? 0) : 0));
  const [toolbarRevealed, setToolbarRevealed] = useState(false);

  if (!bot) {
    return null;
  }

  const workbenchLabel = locale === 'zh-CN' ? '工作台' : 'Workbench';
  const homeLabel = needsYouCount > 0
    ? `${workbenchLabel} (${needsYouCount})`
    : workbenchLabel;
  const pauseLabel = bot.paused ? tr('bots.row.resume', 'Resume bot') : tr('bots.row.pause', 'Pause bot');
  const settingsLabel = locale === 'zh-CN' ? '队友设置' : 'Bot settings';

  return (
    <div className="dsh-bots-conv-actions" data-dsh-bots-conv-actions={bot.id}>
      <div
        className="dsh-bots-conv-toolbar"
        data-revealed={toolbarRevealed || bot.paused ? 'true' : 'false'}
        data-pinned={bot.paused ? 'true' : 'false'}
        onPointerEnter={(event) => {
          if (event.pointerType !== 'touch') {
            setToolbarRevealed(true);
          }
        }}
        onPointerLeave={(event) => {
          if (event.pointerType !== 'touch') {
            setToolbarRevealed(false);
          }
        }}
      >
        <button
          type="button"
          className="dsh-bots-conv-toolbar-btn dsh-bots-conv-toolbar-primary"
          title={homeLabel}
          aria-label={homeLabel}
          data-dsh-bots-conv-action="home"
          onClick={() => botsStore.setRightPanelTab('home', bot.id)}
        >
          <span className="dsh-bots-conv-icon-wrap">
            <IconHome size={14} />
            {needsYouCount > 0 && (
              <span className="dsh-bots-conv-icon-badge" aria-hidden="true">
                {needsYouCount > 99 ? '99+' : needsYouCount}
              </span>
            )}
          </span>
          <span className="dsh-bots-reveal-label">
            <span className="dsh-bots-reveal-clip">
              <span className="dsh-bots-reveal-text">{workbenchLabel}</span>
            </span>
          </span>
        </button>

        <span className="dsh-bots-reveal-slot">
          <span className="dsh-bots-reveal-slot-clip">
            <span className="dsh-bots-reveal-slot-inner">
              <span className="dsh-bots-conv-toolbar-sep" aria-hidden="true" />
              <button
                type="button"
                className="dsh-bots-conv-toolbar-btn"
                title={pauseLabel}
                aria-label={pauseLabel}
                aria-pressed={Boolean(bot.paused)}
                data-dsh-bots-conv-action="pause"
                onClick={() => void botsStore.updateBot(bot.id, { paused: !bot.paused })}
              >
                {bot.paused ? <IconPlay size={14} /> : <IconPause size={14} />}
              </button>
              <button
                type="button"
                className="dsh-bots-conv-toolbar-btn"
                title={settingsLabel}
                aria-label={settingsLabel}
                data-dsh-bots-conv-action="settings"
                onClick={() => botsStore.openBotSettings(bot.id, { host: 'panel' })}
              >
                <IconSettings size={14} />
              </button>
            </span>
          </span>
        </span>
      </div>
    </div>
  );
}

export interface BotConversationFrameProps {
  children: ReactNode;
  useSessions?: <T>(
    selector: (state: { byId?: Record<string, { id?: string; retainedBy?: { mainView?: number } }> }) => T,
  ) => T;
  renderFirstScreen?: (bot: BotRecord, onDismiss: () => void) => ReactNode;
}

export function BotConversationFrame({
  children,
  useSessions,
  renderFirstScreen,
}: BotConversationFrameProps) {
  const { tr } = useBotsLocale();
  const mainSessionId = useSessions?.((state) => {
    const rows = Object.values(state?.byId ?? {});
    return rows.find((row) => (row.retainedBy?.mainView ?? 0) > 0)?.id ?? null;
  }) ?? null;
  const fallbackSessionId = useBotsState((state) => state.activeSessionId);
  const bot = useBotBySessionId(mainSessionId ?? fallbackSessionId);
  const [dismissedIds, setDismissedIds] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (mainSessionId) {
      botsStore.setActiveSelection({
        sessionId: mainSessionId,
        botId: bot ? bot.id : null,
        groupId: null,
      });
    }
  }, [mainSessionId, bot]);

  if (!bot) {
    return <>{children}</>;
  }

  const kickoff = bot.kickoff;
  const hasActiveKickoff = Boolean(kickoff && kickoff.status && kickoff.status !== 'ready');
  const isFirstRun = Boolean((bot as BotRecord & { firstRun?: boolean }).firstRun && hasActiveKickoff);
  const showFirstScreen = isFirstRun && !dismissedIds[bot.id] && Boolean(renderFirstScreen);
  const showPausedBanner = Boolean(bot.paused);

  if (!showPausedBanner && !showFirstScreen) {
    return <>{children}</>;
  }

  return (
    <div className="dsh-bots-conv-frame" data-dsh-bots-conv-frame={bot.id}>
      {showPausedBanner && (
        <div className="dsh-bots-paused-banner" role="status">
          <div className="dsh-bots-paused-banner-left">
            <IconAlertTriangle size={14} />
            <span>
              {tr('bots.paused.banner', 'Paused. Nothing runs for you until you turn it back on.')}
            </span>
          </div>
          <button
            type="button"
            className="dsh-bots-pbtn dsh-bots-pbtn-xs"
            onClick={() => void botsStore.updateBot(bot.id, { paused: false })}
          >
            <IconPlay size={11} />
            <span>{tr('bots.paused.resumeAction', 'Resume')}</span>
          </button>
        </div>
      )}
      {children}
      {showFirstScreen && renderFirstScreen && (
        <div className="dsh-bots-first-overlay">
          {renderFirstScreen(bot, () => setDismissedIds((prev) => ({ ...prev, [bot.id]: true })))}
        </div>
      )}
    </div>
  );
}
