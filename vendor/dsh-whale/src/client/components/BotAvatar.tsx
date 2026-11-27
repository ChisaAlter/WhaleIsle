// Orca-faithful rounded-rectangle BotAvatar with dual-track SVG tinting,
// upload data URL loading, radial-gradient cutout status dot, and group collage avatar.

import { useEffect, useState, type CSSProperties } from 'react';
import { botFallback, parseBotAvatar } from '../../shared/bot-avatar.js';
import {
  DEFAULT_BOT_AVATAR_COLOR,
  isTransparentBotAvatarColor,
  normalizeBotAvatarColor,
} from '../../shared/bot-avatar-color.js';
import {
  getTintedMascotDataUrl,
  mascotAssetUrl,
  readUploadedAvatarDataUrl,
  type BotDotState,
  type BotRecord,
} from '../store/rpc';
import { IconAlertTriangle } from './Icons';

export type AvatarStatusKind =
  | 'attention'
  | 'permission'
  | 'unconfirmed'
  | 'working'
  | 'monitoring'
  | 'unread'
  | 'failed'
  | 'paused'
  | 'disconnected'
  | 'usage-limit'
  | null;

export interface BotAvatarProps {
  botId?: string | null;
  avatar?: string | null;
  avatarColor?: string | null;
  name?: string | null;
  size?: number;
  radius?: number;
  dataUrlOverride?: string | null;
  status?: AvatarStatusKind | BotDotState;
  unread?: boolean;
  usageLimit?: boolean;
  paused?: boolean;
  className?: string;
  style?: CSSProperties;
}

function defaultRadiusForSize(size: number): number {
  if (size <= 22) {
    return 6;
  }
  if (size <= 28) {
    return 8;
  }
  if (size <= 44) {
    return 10;
  }
  if (size <= 64) {
    return 12;
  }
  return 16;
}

export function resolveAvatarStatus(options: {
  status?: AvatarStatusKind | BotDotState;
  unread?: boolean;
  usageLimit?: boolean;
  paused?: boolean;
}): AvatarStatusKind {
  if (options.usageLimit) {
    return 'usage-limit';
  }
  const s = options.status;
  if (s === 'permission' || s === 'unconfirmed' || s === 'attention') {
    return 'attention';
  }
  if (s === 'failed') {
    return 'failed';
  }
  if (s === 'working' || s === 'monitoring') {
    return 'working';
  }
  if (options.unread || s === 'unread') {
    return 'unread';
  }
  if (options.paused || s === 'paused') {
    return 'paused';
  }
  if (s === 'disconnected') {
    return 'disconnected';
  }
  return null;
}

export function getAvatarMaskStyle(size: number, hasDot: boolean): CSSProperties | undefined {
  if (!hasDot) {
    return undefined;
  }
  const cutout = size <= 24 ? 5 : size <= 44 ? 6.5 : 8.5;
  const cx = size - (size <= 24 ? 2 : 3);
  const cy = size - (size <= 24 ? 2 : 3);
  const mask = `radial-gradient(circle ${cutout}px at ${cx}px ${cy}px, transparent 98%, #000 100%)`;
  return {
    WebkitMaskImage: mask,
    maskImage: mask,
  };
}

export function AvatarCutoutDot({
  size,
  status,
}: {
  size: number;
  status: AvatarStatusKind;
}) {
  if (!status) {
    return null;
  }
  const dotSize = size <= 24 ? 6 : size <= 44 ? 8 : 10;
  if (status === 'usage-limit') {
    return (
      <span
        className="dsh-bots-avatar-dot"
        data-state="attention"
        style={{
          width: dotSize + 4,
          height: dotSize + 4,
        }}
      >
        <IconAlertTriangle size={Math.max(8, dotSize)} strokeWidth={2.2} />
      </span>
    );
  }
  return (
    <span
      className={`dsh-bots-avatar-dot ${status === 'working' ? 'dsh-bots-pulse' : ''}`.trim()}
      data-state={status}
      style={{ width: dotSize, height: dotSize }}
    />
  );
}

function useResolvedAvatarSrc(
  botId: string | null | undefined,
  avatar: string | null | undefined,
  avatarColor: string | null | undefined,
  dataUrlOverride: string | null | undefined,
): { src: string | null; emoji: string | null } {
  const parsed = parseBotAvatar(avatar ?? null);
  const parsedKind = parsed?.kind ?? null;
  const parsedMascotId = parsed?.kind === 'mascot' && parsed.id ? parsed.id : null;
  const parsedVersion = parsed?.kind === 'upload' && parsed.version ? parsed.version : null;
  const parsedEmoji = parsed?.kind === 'emoji' && parsed.emoji ? parsed.emoji : null;

  const resolvedColor = normalizeBotAvatarColor(avatarColor) ?? DEFAULT_BOT_AVATAR_COLOR;
  const directMascotUrl =
    parsedMascotId && resolvedColor === DEFAULT_BOT_AVATAR_COLOR
      ? mascotAssetUrl(parsedMascotId, 'svg')
      : null;

  const [asyncSrc, setAsyncSrc] = useState<string | null>(null);

  useEffect(() => {
    if (dataUrlOverride || directMascotUrl) {
      return undefined;
    }
    let cancelled = false;
    if (parsedMascotId) {
      void getTintedMascotDataUrl(parsedMascotId, resolvedColor).then((url) => {
        if (!cancelled) {
          setAsyncSrc(url);
        }
      });
    } else if (parsedVersion && botId) {
      void readUploadedAvatarDataUrl(botId, parsedVersion).then((url) => {
        if (!cancelled) {
          setAsyncSrc(url);
        }
      });
    } else {
      setAsyncSrc(null);
    }
    return () => {
      cancelled = true;
    };
  }, [botId, dataUrlOverride, directMascotUrl, parsedKind, parsedMascotId, parsedVersion, resolvedColor]);

  if (dataUrlOverride) {
    return { src: dataUrlOverride, emoji: null };
  }
  if (directMascotUrl) {
    return { src: directMascotUrl, emoji: null };
  }
  if (parsedEmoji) {
    return { src: null, emoji: parsedEmoji };
  }
  return { src: asyncSrc, emoji: null };
}

export function BotAvatar({
  botId,
  avatar,
  avatarColor,
  name,
  size = 36,
  radius,
  dataUrlOverride,
  status,
  unread,
  usageLimit,
  paused,
  className,
  style,
}: BotAvatarProps) {
  const effectiveStatus = resolveAvatarStatus({ status, unread, usageLimit, paused });
  const borderRadius = radius ?? defaultRadiusForSize(size);
  const { src, emoji } = useResolvedAvatarSrc(botId, avatar, avatarColor, dataUrlOverride);
  const fallbackChar = botFallback({ avatar: avatar ?? null, name: name ?? '' });
  const resolvedBg = normalizeBotAvatarColor(avatarColor) ?? DEFAULT_BOT_AVATAR_COLOR;
  const isTransparent = isTransparentBotAvatarColor(resolvedBg);
  const maskStyle = getAvatarMaskStyle(size, Boolean(effectiveStatus));

  return (
    <span
      className={`dsh-bots-avatar-wrap ${className ?? ''}`.trim()}
      style={{ width: size, height: size, ...style }}
    >
      <span
        className={isTransparent ? 'dsh-bots-avatar-tile dsh-bots-avatar-tile-transparent' : 'dsh-bots-avatar-tile'}
        data-transparent={isTransparent ? 'true' : 'false'}
        style={{
          width: size,
          height: size,
          borderRadius,
          overflow: 'hidden',
          backgroundColor: isTransparent ? 'transparent' : resolvedBg,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          ...maskStyle,
        }}
      >
        {src ? (
          <img
            src={src}
            alt={name ?? 'bot'}
            className="dsh-bots-avatar-img"
            draggable={false}
          />
        ) : (
          <span
            className="dsh-bots-avatar-fallback"
            style={{ fontSize: Math.max(10, Math.round(size * (emoji ? 0.56 : 0.44))) }}
          >
            {emoji ?? fallbackChar}
          </span>
        )}
      </span>
      <AvatarCutoutDot size={size} status={effectiveStatus} />
    </span>
  );
}

export interface BotGroupAvatarProps {
  members: BotRecord[];
  size?: number;
  unread?: boolean;
  className?: string;
}

export function BotGroupAvatar({
  members,
  size = 36,
  unread,
  className,
}: BotGroupAvatarProps) {
  const visibleCount = members.length > 4 ? 3 : Math.min(4, members.length);
  const visible = members.slice(0, visibleCount);
  const overflow = members.length > 4 ? members.length - 3 : 0;
  const cellSize = Math.floor((size - 5) / 2);
  const maskStyle = getAvatarMaskStyle(size, Boolean(unread));

  return (
    <span
      className={`dsh-bots-avatar-wrap ${className ?? ''}`.trim()}
      style={{ width: size, height: size }}
    >
      <span
        className="dsh-bots-group-collage"
        style={{ width: size, height: size, ...maskStyle }}
      >
        {visible.map((bot) => (
          <BotAvatar
            key={bot.id}
            botId={bot.id}
            avatar={bot.avatar}
            avatarColor={bot.avatarColor}
            name={bot.name}
            size={cellSize}
            radius={3}
          />
        ))}
        {overflow > 0 && (
          <span className="dsh-bots-group-collage-more">+{overflow}</span>
        )}
      </span>
      <AvatarCutoutDot size={size} status={unread ? 'unread' : null} />
    </span>
  );
}
