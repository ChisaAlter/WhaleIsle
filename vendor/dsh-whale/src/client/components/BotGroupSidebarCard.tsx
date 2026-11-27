// Sidebar card for a multi-bot group chat with collage avatar, inline rename, and context menu.

import { useEffect, useMemo, useRef, useState, type MouseEvent, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { addressedBotWords } from '../../shared/bot-quiet-result.js';
import {
  botsStore,
  formatRelativeTime,
  useBotsLocale,
  useBotsState,
} from '../store/bots-store';
import type { BotGroupRecord, BotRecord } from '../store/rpc';
import { BotGroupAvatar } from './BotAvatar';
import type { SearchTextSegment } from './BotSidebarCard';
import { IconEdit, IconEye, IconEyeOff, IconTrash, IconUsers } from './Icons';
import { useAnchoredPopoverDismiss } from './useAnchoredPopoverDismiss';

export interface BotGroupSidebarCardProps {
  group: BotGroupRecord;
  botsById: Map<string, BotRecord>;
  now: number;
  nameSegments?: SearchTextSegment[] | null;
}

function GroupContextMenu({
  group,
  position,
  triggerRef,
  onClose,
  onStartRename,
}: {
  group: BotGroupRecord;
  position: { x: number; y: number };
  triggerRef?: RefObject<HTMLElement | null>;
  onClose: () => void;
  onStartRename: () => void;
}) {
  const { tr } = useBotsLocale();
  const menuRef = useRef<HTMLDivElement | null>(null);

  useAnchoredPopoverDismiss({
    open: true,
    popoverRef: menuRef,
    contextTriggerRef: triggerRef,
    onClose,
  });

  if (typeof document === 'undefined') {
    return null;
  }

  const left = Math.max(8, Math.min(position.x, window.innerWidth - 205));
  const top = Math.max(8, Math.min(position.y, window.innerHeight - 200));

  return createPortal(
    <div ref={menuRef} className="dsh-bots-popover" style={{ left, top }}>
      <button
        type="button"
        className="dsh-bots-menu-item"
        onClick={() => {
          onClose();
          onStartRename();
        }}
      >
        <IconEdit size={14} />
        <span>{tr('bots.row.rename', 'Rename')}</span>
      </button>
      <button
        type="button"
        className="dsh-bots-menu-item"
        onClick={() => {
          onClose();
          botsStore.openModal({ kind: 'group', groupId: group.id });
        }}
      >
        <IconUsers size={14} />
        <span>{tr('bots.groups.manageMembers', 'Manage members…')}</span>
      </button>
      <button
        type="button"
        className="dsh-bots-menu-item"
        onClick={() => {
          onClose();
          void botsStore.updateGroup(group.id, { unread: !group.unread });
        }}
      >
        {group.unread ? <IconEye size={14} /> : <IconEyeOff size={14} />}
        <span>{group.unread ? tr('bots.row.markRead', 'Mark Read') : tr('bots.row.markUnread', 'Mark Unread')}</span>
      </button>
      <div className="dsh-bots-menu-sep" />
      <button
        type="button"
        className="dsh-bots-menu-item"
        data-danger="true"
        onClick={() => {
          onClose();
          botsStore.openModal({ kind: 'confirm-delete-group', groupId: group.id });
        }}
      >
        <IconTrash size={14} />
        <span>{tr('bots.groups.delete', 'Delete group…')}</span>
      </button>
    </div>,
    document.body,
  );
}

export function BotGroupSidebarCard({
  group,
  botsById,
  now,
  nameSegments,
}: BotGroupSidebarCardProps) {
  const { locale } = useBotsLocale();
  const activeGroupId = useBotsState((state) => state.activeGroupId);

  const [renaming, setRenaming] = useState(false);
  const [renameText, setRenameText] = useState(group.name);
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setRenameText(group.name);
  }, [group.name]);

  const memberBots = useMemo(
    () => (group.members ?? []).map((m) => botsById.get(m.botId)).filter(Boolean) as BotRecord[],
    [botsById, group.members],
  );

  const subtitle = useMemo(() => {
    const cleaned = group.lastMessageText ? (addressedBotWords(group.lastMessageText) ?? '') : '';
    if (cleaned) {
      return group.lastMessageAuthor
        ? `${group.lastMessageAuthor}: ${cleaned}`
        : cleaned;
    }
    return memberBots.map((bot) => bot.name).join(', ');
  }, [group.lastMessageAuthor, group.lastMessageText, memberBots]);

  const commitRename = () => {
    const trimmed = renameText.trim();
    setRenaming(false);
    if (trimmed && trimmed !== group.name) {
      void botsStore.updateGroup(group.id, { name: trimmed.slice(0, 64) });
    } else {
      setRenameText(group.name);
    }
  };

  const handleContextMenu = (event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setMenuPos({ x: event.clientX, y: event.clientY });
  };

  const timeText = formatRelativeTime(group.lastActiveAt ?? group.updatedAt ?? group.createdAt, now, locale);
  const isActive = activeGroupId === group.id;

  return (
    <div className="dsh-bots-card-wrap">
      <div
        ref={cardRef}
        className="dsh-bots-card"
        data-active={isActive ? 'true' : 'false'}
        data-unread={group.unread ? 'true' : 'false'}
        onClick={() => {
          if (!renaming) {
            botsStore.openGroup(group.id);
          }
        }}
        onContextMenu={handleContextMenu}
      >
        <BotGroupAvatar members={memberBots} size={28} unread={group.unread} />

        <div className="dsh-bots-card-body">
          <div className="dsh-bots-card-top">
            {renaming ? (
              <input
                type="text"
                className="dsh-bots-inline-rename"
                value={renameText}
                maxLength={64}
                autoFocus
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => setRenameText(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    commitRename();
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    setRenameText(group.name);
                    setRenaming(false);
                  }
                }}
              />
            ) : (
              <span className="dsh-bots-card-name">
                {nameSegments ? (
                  nameSegments.map((seg, idx) =>
                    seg.marked ? (
                      <mark key={idx} className="dsh-bots-mark">{seg.text}</mark>
                    ) : (
                      <span key={idx}>{seg.text}</span>
                    ),
                  )
                ) : (
                  group.name
                )}
              </span>
            )}
            {!renaming && timeText && (
              <span className="dsh-bots-card-time">{timeText}</span>
            )}
          </div>
          <div className="dsh-bots-card-sub">
            <span className="dsh-bots-card-line">{subtitle}</span>
          </div>
        </div>
      </div>

      {menuPos && (
        <GroupContextMenu
          group={group}
          position={menuPos}
          triggerRef={cardRef}
          onClose={() => setMenuPos(null)}
          onStartRename={() => setRenaming(true)}
        />
      )}
    </div>
  );
}
