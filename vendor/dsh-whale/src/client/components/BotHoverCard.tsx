// Hover preview card for sidebar bot cards (56px avatar, SOUL summary, recent activity, needs-you items).

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  botsStore,
  formatRelativeTime,
  useBotsLocale,
} from '../store/bots-store';
import {
  RPC_METHODS,
  callBotRpc,
  type BotActivitySnapshot,
  type BotRecord,
} from '../store/rpc';
import { BotAvatar } from './BotAvatar';
import { IconArrowRight, IconHome } from './Icons';

export interface BotHoverCardProps {
  bot: BotRecord;
  anchorRect: DOMRect;
  now: number;
  statusLine: string;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onClose: () => void;
}

const activityCache = new Map<string, { at: number; data: BotActivitySnapshot }>();
const CACHE_TTL_MS = 10_000;

export function BotHoverCard({
  bot,
  anchorRect,
  now,
  statusLine,
  onMouseEnter,
  onMouseLeave,
  onClose,
}: BotHoverCardProps) {
  const { locale, tr } = useBotsLocale();
  const [snapshot, setSnapshot] = useState<BotActivitySnapshot | null>(() => {
    const cached = activityCache.get(bot.id);
    return cached && Date.now() - cached.at < CACHE_TTL_MS ? cached.data : null;
  });

  useEffect(() => {
    const cached = activityCache.get(bot.id);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      setSnapshot(cached.data);
      return undefined;
    }
    const controller = new AbortController();
    void callBotRpc<BotActivitySnapshot>(RPC_METHODS.ACTIVITY, { botId: bot.id }, { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted && data) {
          activityCache.set(bot.id, { at: Date.now(), data });
          setSnapshot(data);
        }
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          console.warn(`[dsh-bots] Failed to load hover activity for ${bot.id}`, err);
        }
      });
    return () => controller.abort();
  }, [bot.id]);

  if (typeof document === 'undefined') {
    return null;
  }

  const cardWidth = 288;
  const approxHeight = 250;
  const left = Math.min(anchorRect.right + 10, window.innerWidth - cardWidth - 12);
  const top = Math.max(12, Math.min(anchorRect.top - 6, window.innerHeight - approxHeight - 12));

  const needsYouItems = (snapshot?.needsYou ?? snapshot?.items?.filter((item) => item.status === 'needs_you') ?? []).slice(0, 3);
  const recentLines = (snapshot?.recent ?? []).slice(0, 3);
  const purpose = bot.purpose ?? bot.description ?? '';

  return createPortal(
    <div
      className="dsh-bots-hovercard"
      style={{ left, top }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <BotAvatar
          botId={bot.id}
          avatar={bot.avatar}
          avatarColor={bot.avatarColor}
          name={bot.name}
          size={56}
          radius={12}
          status={bot.dotState ?? undefined}
          unread={bot.unread}
          paused={bot.paused}
          usageLimit={Boolean(bot.usageLimit)}
        />
        <div style={{ flex: '1 1 auto', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <div
              style={{
                fontSize: 14,
                lineHeight: '22px',
                fontWeight: 600,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {bot.name}
            </div>
            <button
              type="button"
              className="dsh-bots-btn"
              data-size="sm"
              onClick={() => {
                void botsStore.openBotHome(bot.id);
                onClose();
              }}
            >
              <IconHome size={13} />
              <span>{locale === 'zh-CN' ? '打开' : 'Open'}</span>
            </button>
          </div>
          {statusLine && (
            <div style={{ fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-secondary)', marginTop: 2 }}>
              {statusLine}
            </div>
          )}
          {purpose && (
            <div
              style={{
                fontSize: 12,
                lineHeight: '18px',
                color: 'var(--dsw-alias-label-tertiary)',
                marginTop: 4,
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {purpose}
            </div>
          )}
        </div>
      </div>

      {needsYouItems.length > 0 && (
        <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--dsw-alias-border-l1)' }}>
          <div style={{ fontSize: 12, lineHeight: '18px', fontWeight: 600, color: 'var(--dsw-alias-state-warn-label)', marginBottom: 6 }}>
            {tr('bots.items.needsYou', 'Needs you')} ({needsYouItems.length})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {needsYouItems.map((item) => (
              <div
                key={item.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                  fontSize: 12,
                  lineHeight: '18px',
                }}
              >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {item.title}
                </span>
                <button
                  type="button"
                  className="dsh-bots-link-btn"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 2, flexShrink: 0, fontSize: 12 }}
                  onClick={() => {
                    botsStore.setRightPanelTab('home', bot.id);
                    botsStore.setRightPanelItemId(item.id);
                    void botsStore.openBotHome(bot.id);
                    onClose();
                  }}
                >
                  <span>{locale === 'zh-CN' ? '查看' : 'View'}</span>
                  <IconArrowRight size={12} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {recentLines.length > 0 && (
        <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--dsw-alias-border-l1)' }}>
          <div style={{ fontSize: 12, lineHeight: '18px', fontWeight: 600, color: 'var(--dsw-alias-label-tertiary)', marginBottom: 4 }}>
            {tr('bots.activity.tab', 'Activity')}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {recentLines.map((line, index) => (
              <div
                key={line.id ?? `${bot.id}-act-${index}`}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, fontSize: 12, lineHeight: '18px' }}
              >
                <span
                  style={{
                    color: 'var(--dsw-alias-label-secondary)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {line.place ? `${line.place} · ${line.text}` : line.text}
                </span>
                {line.at ? (
                  <span style={{ color: 'var(--dsw-alias-label-tertiary)', fontSize: 11, lineHeight: '14px', flexShrink: 0 }}>
                    {formatRelativeTime(line.at, now, locale)}
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}
