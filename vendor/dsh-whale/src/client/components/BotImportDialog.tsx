// Import existing bots from local Orca / OpenClaw / Hermes / legacy Whale folders.

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { randomMascotAvatar } from '../../shared/bot-avatar.js';
import { DEFAULT_BOT_AVATAR_COLOR, normalizeHexColor } from '../../shared/bot-avatar-color.js';
import { botsStore, useBotsLocale } from '../store/bots-store';
import {
  RPC_METHODS,
  callBotRpc,
  invalidateUploadedAvatarCache,
  type BotImportSource,
} from '../store/rpc';
import { AvatarPickerPopover, type AvatarPickerValue } from './AvatarPicker';
import { BotAvatar } from './BotAvatar';
import {
  IconArrowRight,
  IconCheck,
  IconDownload,
  IconLink,
  IconRefresh,
  IconSpinner,
  IconX,
} from './Icons';

export interface BotImportDialogProps {
  open: boolean;
  onClose: () => void;
}

const SOURCE_LABELS: Record<string, string> = {
  orca: 'Orca',
  openclaw: 'OpenClaw',
  hermes: 'Hermes',
  whale: 'WhaleIsle (Legacy)',
  'legacy-whale': 'WhaleIsle (Legacy)',
};

function sourceKindOf(src: BotImportSource): string {
  return src.sourceKind ?? src.source ?? 'orca';
}

export function BotImportDialog({ open, onClose }: BotImportDialogProps) {
  const { locale, tr } = useBotsLocale();

  const [sources, setSources] = useState<BotImportSource[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [targetName, setTargetName] = useState('');
  const [avatarVal, setAvatarVal] = useState<AvatarPickerValue>(() => ({
    avatar: randomMascotAvatar(),
    avatarColor: DEFAULT_BOT_AVATAR_COLOR,
    uploadedImage: null,
  }));
  const [pickerAnchor, setPickerAnchor] = useState<DOMRect | null>(null);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSources = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await callBotRpc<{ sources?: BotImportSource[] } | BotImportSource[]>(RPC_METHODS.IMPORT_SOURCES);
      const list = Array.isArray(res) ? res : (res?.sources ?? []);
      setSources(list);
      const first = list.find((s) => !s.imported) ?? list[0] ?? null;
      if (first) {
        setSelectedId(first.id);
        setTargetName(first.name);
        setAvatarVal({
          avatar: first.avatar || randomMascotAvatar(),
          avatarColor: normalizeHexColor(first.avatarColor) ?? DEFAULT_BOT_AVATAR_COLOR,
          uploadedImage: null,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    setPickerAnchor(null);
    void loadSources();
    const handleEsc = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && !pickerAnchor) {
        onClose();
      }
    };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [onClose, open, pickerAnchor]);

  const selected = sources.find((s) => s.id === selectedId) ?? null;

  const handleSelectSource = (src: BotImportSource) => {
    setSelectedId(src.id);
    setTargetName(src.name);
    setAvatarVal({
      avatar: src.avatar || randomMascotAvatar(),
      avatarColor: normalizeHexColor(src.avatarColor) ?? DEFAULT_BOT_AVATAR_COLOR,
      uploadedImage: null,
    });
  };

  const handleImport = async () => {
    if (!selected || !targetName.trim() || importing) {
      return;
    }
    setImporting(true);
    setError(null);
    try {
      const hasCustomUpload = Boolean(avatarVal.uploadedImage && avatarVal.avatar.startsWith('upload:'));
      const res = await callBotRpc<{ bot?: { id: string; name: string } }>('bots.import.execute', {
        sourceId: selected.id,
        sourcePath: selected.path,
        name: targetName.trim().slice(0, 64),
        includeMemory: true,
      });
      const created = res?.bot;
      if (created?.id) {
        if (hasCustomUpload && avatarVal.uploadedImage) {
          await callBotRpc(RPC_METHODS.AVATAR_UPLOAD, {
            botId: created.id,
            base64Png: avatarVal.uploadedImage.base64Png,
          });
          invalidateUploadedAvatarCache(created.id);
        } else {
          await botsStore.updateBot(created.id, {
            avatar: avatarVal.avatar,
            avatarColor: avatarVal.avatarColor,
          });
        }
        await botsStore.refresh();
        botsStore.setSectionCollapsed(false);
        void botsStore.openBotHome(created.id);
      }
      botsStore.pushToast({
        message: locale === 'zh-CN'
          ? `已导入大肥鱼队友「${created?.name ?? targetName.trim()}」`
          : `Imported "${created?.name ?? targetName.trim()}"`,
        tone: 'success',
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setImporting(false);
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
      <div role="dialog" aria-modal="true" className="dsh-bots-modal dsh-bots-modal-lg">
        <div className="dsh-bots-modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <IconDownload size={16} />
            <span className="dsh-bots-modal-title">
              {tr('bots.section.importFromApp', 'Import from another app…').replace(/…$/, '')}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <button
              type="button"
              className="dsh-bots-icon-btn"
              title={locale === 'zh-CN' ? '重新扫描' : 'Rescan'}
              onClick={() => void loadSources()}
            >
              <IconRefresh size={15} className={loading ? 'dsh-bots-spin' : undefined} />
            </button>
            <button type="button" className="dsh-bots-icon-btn" onClick={onClose} aria-label="Close">
              <IconX size={16} />
            </button>
          </div>
        </div>

        <div className="dsh-bots-modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {loading ? (
            <div style={{ padding: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, color: 'var(--dsw-alias-label-tertiary)', fontSize: 13, lineHeight: '20px' }}>
              <IconSpinner size={15} />
              <span>{locale === 'zh-CN' ? '正在扫描 Orca、OpenClaw、Hermes 与旧大肥鱼目录…' : 'Scanning Orca, OpenClaw, Hermes, and WhaleIsle folders…'}</span>
            </div>
          ) : sources.length === 0 ? (
            <div style={{ padding: 28, textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
              <div style={{ fontSize: 14, lineHeight: '22px', fontWeight: 600 }}>
                {locale === 'zh-CN' ? '未检测到本地可导入的大肥鱼队友' : 'No local bots found to import'}
              </div>
              <div style={{ fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary)', maxWidth: 420 }}>
                {locale === 'zh-CN'
                  ? '已扫描 ~/.orca/bots、~/.openclaw、~/.hermes 与 WhaleIsle 历史大肥鱼配置。你也可以导入 JSON 分享包。'
                  : 'Checked ~/.orca/bots, ~/.openclaw, ~/.hermes, and legacy WhaleIsle data. You can also import a BotPackage JSON.'}
              </div>
            </div>
          ) : (
            <>
              <div style={{ maxHeight: 190, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
                {sources.map((src) => {
                  const active = src.id === selectedId;
                  return (
                    <button
                      key={src.id}
                      type="button"
                      className="dsh-bots-modal-row-btn"
                      data-active={active ? 'true' : 'false'}
                      onClick={() => handleSelectSource(src)}
                    >
                      <BotAvatar
                        avatar={src.avatar}
                        avatarColor={src.avatarColor}
                        dataUrlOverride={src.avatarDataUrl}
                        name={src.name}
                        size={36}
                        radius={10}
                      />
                      <div style={{ flex: '1 1 auto', minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontSize: 13, lineHeight: '20px', fontWeight: 600 }}>{src.name}</span>
                          <span className="dsh-bots-badge">
                            {SOURCE_LABELS[sourceKindOf(src)] ?? sourceKindOf(src)}
                          </span>
                          {src.imported && (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: 11, color: 'var(--dsw-alias-state-success-primary)' }}>
                              <IconCheck size={11} />
                              {locale === 'zh-CN' ? '已导入' : 'Imported'}
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2 }}>
                          {src.path}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>

              {selected && (
                <div className="dsh-bots-modal-card" style={{ padding: 14, gap: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 18 }}>
                    <div style={{ textAlign: 'center' }}>
                      <BotAvatar
                        avatar={selected.avatar}
                        avatarColor={selected.avatarColor}
                        dataUrlOverride={selected.avatarDataUrl}
                        name={selected.name}
                        size={52}
                        radius={12}
                      />
                      <div style={{ fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary)', marginTop: 4 }}>
                        {SOURCE_LABELS[sourceKindOf(selected)] ?? sourceKindOf(selected)}
                      </div>
                    </div>
                    <IconArrowRight size={18} style={{ color: 'var(--dsw-alias-label-tertiary)' }} />
                    <div style={{ textAlign: 'center' }}>
                      <button
                        type="button"
                        onClick={(e) => {
                          const rect = e.currentTarget.getBoundingClientRect();
                          setPickerAnchor((prev) => (prev ? null : rect));
                        }}
                        style={{ padding: 0, border: 0, background: 'transparent', cursor: 'pointer' }}
                        title={tr('bots.new.picture', 'Picture')}
                      >
                        <BotAvatar
                          avatar={avatarVal.avatar}
                          avatarColor={avatarVal.avatarColor}
                          dataUrlOverride={avatarVal.avatar.startsWith('upload:') ? avatarVal.uploadedImage?.dataUrl : null}
                          name={targetName || selected.name}
                          size={52}
                          radius={12}
                        />
                      </button>
                      <div style={{ fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-link)', marginTop: 4 }}>
                        {locale === 'zh-CN' ? '点击更换头像' : 'Change picture'}
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="dsh-bots-field-label">
                      {tr('bots.new.name', 'Name')}
                    </label>
                    <input
                      type="text"
                      className="dsh-bots-input"
                      maxLength={64}
                      value={targetName}
                      onChange={(e) => setTargetName(e.target.value)}
                    />
                  </div>
                </div>
              )}
            </>
          )}

          {error && <div className="dsh-bots-error-text">{error}</div>}
        </div>

        <div className="dsh-bots-modal-footer">
          <button
            type="button"
            className="dsh-bots-btn"
            data-variant="ghost"
            onClick={() => botsStore.openModal({ kind: 'share', mode: 'import' })}
          >
            <IconLink size={14} />
            <span>{locale === 'zh-CN' ? '导入 JSON 分享包…' : 'Import package JSON…'}</span>
          </button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="dsh-bots-btn" onClick={onClose}>
              {tr('bots.new.cancel', 'Cancel')}
            </button>
            <button
              type="button"
              className="dsh-bots-btn"
              data-variant="primary"
              disabled={!selected || !targetName.trim() || importing}
              onClick={() => void handleImport()}
            >
              {importing
                ? (locale === 'zh-CN' ? '导入中…' : 'Importing…')
                : (locale === 'zh-CN' ? '导入队友' : 'Import bot')}
            </button>
          </div>
        </div>

        <AvatarPickerPopover
          open={Boolean(pickerAnchor)}
          anchorRect={pickerAnchor}
          onClose={() => setPickerAnchor(null)}
          value={avatarVal}
          onChange={setAvatarVal}
        />
      </div>
    </div>,
    document.body,
  );
}
