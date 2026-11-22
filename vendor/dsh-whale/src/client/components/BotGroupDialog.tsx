// Create / edit multi-bot group dialog with Tab-to-accept suggested name and animated checkmarks.

import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  BOT_GROUP_LIMITS,
  botGroupMissing,
  botGroupPickOrder,
  botGroupUnchanged,
  suggestGroupName,
} from '../../shared/bot-groups.js';
import {
  botsStore,
  useBotsLocale,
  useBotsState,
  useGroupById,
} from '../store/bots-store';
import { BotAvatar } from './BotAvatar';
import { IconCheck, IconSearch, IconUsers, IconX } from './Icons';

export interface BotGroupDialogProps {
  open: boolean;
  groupId?: string;
  onClose: () => void;
}

export function BotGroupDialog({ open, groupId, onClose }: BotGroupDialogProps) {
  const { locale, tr } = useBotsLocale();
  const bots = useBotsState((s) => s.bots);
  const existingGroup = useGroupById(groupId);
  const editing = Boolean(existingGroup);

  const [name, setName] = useState('');
  const [pickedIds, setPickedIds] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const savedMemberIds = useMemo(
    () => (existingGroup?.members ?? []).map((m) => m.botId),
    [existingGroup],
  );

  useEffect(() => {
    if (!open) {
      return;
    }
    setSearch('');
    setError(null);
    setSaving(false);
    if (existingGroup) {
      setName(existingGroup.name);
      setPickedIds(savedMemberIds);
    } else {
      setName('');
      setPickedIds([]);
    }
  }, [existingGroup, open, savedMemberIds]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const handleEsc = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [onClose, open]);

  const orderedIds = useMemo(
    () => (editing ? botGroupPickOrder(savedMemberIds, pickedIds) : pickedIds),
    [editing, pickedIds, savedMemberIds],
  );

  const pickedNames = useMemo(() => {
    const map = new Map(bots.map((bot) => [bot.id, bot.name]));
    return orderedIds.map((id) => map.get(id)).filter(Boolean) as string[];
  }, [bots, orderedIds]);

  const suggestedName = useMemo(
    () => (!editing ? (suggestGroupName as (names: string[], t?: unknown) => string | null)(pickedNames, tr) : null),
    [editing, pickedNames, tr],
  );

  const filteredBots = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) {
      return bots;
    }
    return bots.filter((bot) =>
      bot.name.toLowerCase().includes(q)
      || (bot.purpose ?? bot.description ?? '').toLowerCase().includes(q),
    );
  }, [bots, search]);

  const toggleBot = (botId: string) => {
    setPickedIds((prev) => {
      if (prev.includes(botId)) {
        return prev.filter((id) => id !== botId);
      }
      if (prev.length >= BOT_GROUP_LIMITS.maxMembers) {
        return prev;
      }
      return [...prev, botId];
    });
  };

  const effectiveName = name.trim() || suggestedName || '';
  const missing = botGroupMissing(orderedIds.length, effectiveName, editing);
  const unchanged = existingGroup
    ? botGroupUnchanged({ name: existingGroup.name, botIds: savedMemberIds }, effectiveName, orderedIds)
    : false;
  const canSubmit = !missing && !unchanged && !saving;

  const handleNameKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Tab' && !name.trim() && suggestedName) {
      event.preventDefault();
      setName(suggestedName);
    } else if (event.key === 'Enter' && canSubmit) {
      event.preventDefault();
      void handleSubmit();
    }
  };

  const handleSubmit = async () => {
    if (!canSubmit) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (existingGroup) {
        await botsStore.updateGroup(existingGroup.id, {
          name: effectiveName.slice(0, BOT_GROUP_LIMITS.nameMaxLength),
          botIds: orderedIds,
        });
      } else {
        await botsStore.createGroup({
          name: effectiveName.slice(0, BOT_GROUP_LIMITS.nameMaxLength),
          botIds: orderedIds,
          replyMode: { kind: 'bot', botId: orderedIds[0] },
        });
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  };

  if (!open || typeof document === 'undefined') {
    return null;
  }

  return createPortal(
    <div
      className="dsh-bots-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="dsh-bots-modal"
      >
        <div className="dsh-bots-modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <IconUsers size={16} />
            <span className="dsh-bots-modal-title">
              {editing
                ? tr('bots.groups.manageMembers', 'Manage members…').replace(/…$/, '')
                : tr('bots.groups.newGroup', 'New group')}
            </span>
          </div>
          <button type="button" className="dsh-bots-icon-btn" onClick={onClose} aria-label="Close">
            <IconX size={16} />
          </button>
        </div>

        <div className="dsh-bots-modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label className="dsh-bots-field-label">
              {locale === 'zh-CN' ? '鱼群名称' : 'Group name'}
            </label>
            <input
              type="text"
              className="dsh-bots-input"
              maxLength={BOT_GROUP_LIMITS.nameMaxLength}
              value={name}
              placeholder={suggestedName ?? (locale === 'zh-CN' ? '输入鱼群名称' : 'Name this group')}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={handleNameKeyDown}
            />
            {!name.trim() && suggestedName && (
              <div style={{ fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary)', marginTop: 4 }}>
                {locale === 'zh-CN'
                  ? `按 Tab 采纳建议名称「${suggestedName}」`
                  : `Press Tab to accept "${suggestedName}"`}
              </div>
            )}
          </div>

          <div className="dsh-bots-search-box" style={{ margin: 0 }}>
            <IconSearch size={14} />
            <input
              type="text"
              className="dsh-bots-search-input"
              value={search}
              placeholder={tr('bots.search.label', 'Search bots')}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div style={{ maxHeight: 270, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
            {filteredBots.map((bot) => {
              const selected = pickedIds.includes(bot.id);
              return (
                <button
                  key={bot.id}
                  type="button"
                  className="dsh-bots-modal-row-btn"
                  data-active={selected ? 'true' : 'false'}
                  onClick={() => toggleBot(bot.id)}
                >
                  <span style={{ position: 'relative', display: 'inline-flex' }}>
                    <BotAvatar
                      botId={bot.id}
                      avatar={bot.avatar}
                      avatarColor={bot.avatarColor}
                      name={bot.name}
                      size={36}
                      radius={10}
                    />
                    {selected && (
                      <span className="dsh-bots-check-badge">
                        <IconCheck size={10} strokeWidth={2.6} />
                      </span>
                    )}
                  </span>
                  <div style={{ flex: '1 1 auto', minWidth: 0 }}>
                    <div style={{ fontSize: 13, lineHeight: '20px', fontWeight: 500 }}>{bot.name}</div>
                    {(bot.purpose || bot.description) && (
                      <div style={{ fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {bot.purpose ?? bot.description}
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {error && <div className="dsh-bots-error-text">{error}</div>}
        </div>

        <div className="dsh-bots-modal-footer">
          <span style={{ fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary)' }}>
            {missing === 'pickTwo'
              ? (locale === 'zh-CN' ? '请至少选择 2 位大肥鱼队友' : 'Select at least 2 bots')
              : missing === 'pickOne'
                ? (locale === 'zh-CN' ? '请至少保留 1 位队友' : 'Keep at least 1 bot')
                : (locale === 'zh-CN' ? `已选择 ${orderedIds.length} 位成员` : `${orderedIds.length} selected`)}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="dsh-bots-btn" onClick={onClose}>
              {tr('bots.new.cancel', 'Cancel')}
            </button>
            <button
              type="button"
              className="dsh-bots-btn"
              data-variant="primary"
              disabled={!canSubmit}
              onClick={() => void handleSubmit()}
            >
              {saving
                ? tr('settings.bots.saving', 'Saving…')
                : editing
                  ? (locale === 'zh-CN' ? '保存' : 'Save')
                  : tr('bots.new.create', 'Create')}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
