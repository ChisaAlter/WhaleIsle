// Import existing bots from local Orca / OpenClaw / Hermes / legacy Whale folders.
// Enhanced with scanBotText security review, expandable SOUL/Skill preview, and re-review on content change.

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { randomMascotAvatar } from '../../shared/bot-avatar.js';
import { DEFAULT_BOT_AVATAR_COLOR, normalizeBotAvatarColor } from '../../shared/bot-avatar-color.js';
import { botsStore, useBotsLocale } from '../store/bots-store';
import {
  RPC_METHODS,
  callBotRpc,
  invalidateUploadedAvatarCache,
  type BotImportSource,
} from '../store/rpc';
import { AvatarPickerPopover, type AvatarPickerValue } from './AvatarPicker';
import { BotAvatar } from './BotAvatar';
import { BotChevron, BotDisclosure } from './BotDisclosure';
import {
  SecurityScanPanel,
  computeContentDigest,
  runBotSecurityScan,
} from './BotShareDialog';
import {
  IconAlertTriangle,
  IconArrowRight,
  IconCheck,
  IconDownload,
  IconFileText,
  IconLink,
  IconRefresh,
  IconSpinner,
  IconX,
} from './Icons';

export interface BotImportDialogProps {
  open: boolean;
  onClose: () => void;
}

type ExtendedImportSource = BotImportSource & {
  soul?: string;
  files?: Record<string, string>;
  skills?: Array<{ name: string; content?: string; description?: string }>;
  scan?: { blockers?: unknown[]; warnings?: unknown[]; findings?: unknown[] };
  warnings?: unknown[];
  blockers?: unknown[];
};

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
  const zh = locale === 'zh-CN';

  const [sources, setSources] = useState<ExtendedImportSource[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [targetName, setTargetName] = useState('');
  const [avatarVal, setAvatarVal] = useState<AvatarPickerValue>(() => ({
    avatar: randomMascotAvatar(),
    avatarColor: DEFAULT_BOT_AVATAR_COLOR,
    uploadedImage: null,
  }));
  const [pickerAnchor, setPickerAnchor] = useState<DOMRect | null>(null);
  const avatarBtnRef = useRef<HTMLButtonElement | null>(null);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedFiles, setExpandedFiles] = useState<Record<string, boolean>>({});
  const [reviewedDigestBySource, setReviewedDigestBySource] = useState<Record<string, string>>({});
  const [changedAfterReview, setChangedAfterReview] = useState(false);

  const loadSources = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await callBotRpc<{ sources?: ExtendedImportSource[] } | ExtendedImportSource[]>(RPC_METHODS.IMPORT_SOURCES);
      const list = Array.isArray(res) ? res : (res?.sources ?? []);
      setSources(list);
      const keep = selectedId ? list.find((s) => s.id === selectedId) : null;
      const first = keep ?? list.find((s) => !s.imported) ?? list[0] ?? null;
      if (first) {
        setSelectedId(first.id);
        if (!keep) {
          setTargetName(first.name);
          setAvatarVal({
            avatar: first.avatar || randomMascotAvatar(),
            avatarColor: normalizeBotAvatarColor(first.avatarColor) ?? DEFAULT_BOT_AVATAR_COLOR,
            uploadedImage: null,
          });
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) {
      return;
    }
    setPickerAnchor(null);
    setChangedAfterReview(false);
    void loadSources();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const handleEsc = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented && !pickerAnchor) {
        onClose();
      }
    };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [onClose, open, pickerAnchor]);

  const selected = sources.find((s) => s.id === selectedId) ?? null;

  const inspectableFiles = useMemo(() => {
    if (!selected) return [];
    const list: Array<{ path: string; label: string; content: string }> = [];
    const seen = new Set<string>();
    const add = (path: string, label: string, content: string) => {
      if (!seen.has(path) && content) {
        seen.add(path);
        list.push({ path, label, content });
      }
    };
    if (typeof selected.soul === 'string' && selected.soul.trim()) {
      add('SOUL.md', 'SOUL.md', selected.soul);
    }
    if (selected.files && typeof selected.files === 'object') {
      for (const [filePath, content] of Object.entries(selected.files)) {
        if (typeof content === 'string' && content.trim()) {
          add(filePath, filePath, content);
        }
      }
    }
    for (const sk of selected.skills ?? []) {
      if (sk.content) {
        add(`skills/${sk.name}/SKILL.md`, `Skill: ${sk.name}`, sk.content);
      }
    }
    return list;
  }, [selected]);

  const currentDigest = useMemo(() => {
    if (!selected) return null;
    return computeContentDigest([
      selected.id,
      selected.path,
      selected.description,
      ...inspectableFiles.map((f) => `${f.path}\n${f.content}`),
    ]);
  }, [inspectableFiles, selected]);

  useEffect(() => {
    if (!selected || !currentDigest) {
      setChangedAfterReview(false);
      return;
    }
    const prev = reviewedDigestBySource[selected.id];
    if (prev && prev !== currentDigest) {
      setChangedAfterReview(true);
    } else {
      setChangedAfterReview(false);
    }
  }, [currentDigest, reviewedDigestBySource, selected]);

  const scanReport = useMemo(() => {
    if (!selected) return { blockers: [], warnings: [] };
    const entries: Array<{ file: string; text: string }> = [
      ...inspectableFiles.map((f) => ({ file: f.path, text: f.content })),
      ...(selected.description ? [{ file: 'description', text: selected.description }] : []),
    ];
    return runBotSecurityScan(entries, zh, {
      blockers: selected.blockers ?? selected.scan?.blockers,
      warnings: [...(selected.warnings ?? []), ...(selected.scan?.warnings ?? [])],
      findings: selected.scan?.findings,
    });
  }, [inspectableFiles, selected, zh]);

  const hasBlockers = scanReport.blockers.length > 0;
  const needsExplicitReview = scanReport.warnings.length > 0 || changedAfterReview;
  const reviewSatisfied = Boolean(selected && currentDigest && reviewedDigestBySource[selected.id] === currentDigest);
  const canImport = Boolean(
    selected
    && targetName.trim()
    && !importing
    && !hasBlockers
    && (!needsExplicitReview || reviewSatisfied),
  );

  const handleSelectSource = (src: ExtendedImportSource) => {
    setSelectedId(src.id);
    setTargetName(src.name);
    setExpandedFiles({});
    setAvatarVal({
      avatar: src.avatar || randomMascotAvatar(),
      avatarColor: normalizeBotAvatarColor(src.avatarColor) ?? DEFAULT_BOT_AVATAR_COLOR,
      uploadedImage: null,
    });
  };

  const handleImport = async () => {
    if (!selected || !canImport) {
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
          await botsStore.updateBot(created.id, {
            avatarColor: avatarVal.avatarColor,
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
        message: zh
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
              title={zh ? '重新扫描' : 'Rescan'}
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
              <span>{zh ? '正在扫描 Orca、OpenClaw、Hermes 与旧大肥鱼目录…' : 'Scanning Orca, OpenClaw, Hermes, and WhaleIsle folders…'}</span>
            </div>
          ) : sources.length === 0 ? (
            <div style={{ padding: 28, textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
              <div style={{ fontSize: 14, lineHeight: '22px', fontWeight: 600 }}>
                {zh ? '未检测到本地可导入的大肥鱼队友' : 'No local bots found to import'}
              </div>
              <div style={{ fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary)', maxWidth: 420 }}>
                {zh
                  ? '已扫描 ~/.orca/bots、~/.openclaw、~/.hermes 与 WhaleIsle 历史大肥鱼配置。你也可以导入 JSON 分享包。'
                  : 'Checked ~/.orca/bots, ~/.openclaw, ~/.hermes, and legacy WhaleIsle data. You can also import a BotPackage JSON.'}
              </div>
            </div>
          ) : (
            <>
              <div style={{ maxHeight: 170, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
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
                              {zh ? '已导入' : 'Imported'}
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
                        ref={avatarBtnRef}
                        type="button"
                        aria-haspopup="dialog"
                        aria-expanded={Boolean(pickerAnchor)}
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
                        {zh ? '点击更换头像' : 'Change picture'}
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

                  {changedAfterReview && !reviewSatisfied && (
                    <div className="dsh-bots-pcard dsh-bots-pcard-warn" role="alert">
                      <div className="dsh-bots-row-left" style={{ fontWeight: 600 }}>
                        <IconAlertTriangle size={14} className="dsh-bots-text-warn" />
                        <span>{zh ? '源文件内容已变动，请重新审阅' : 'Source changed — review again'}</span>
                      </div>
                    </div>
                  )}

                  <SecurityScanPanel report={scanReport} />

                  {inspectableFiles.length > 0 && (
                    <div className="dsh-bots-file-review-list">
                      <div className="dsh-bots-field-label" style={{ marginBottom: 4 }}>
                        {zh ? '展开审阅 SOUL / Skill 正文' : 'Inspect SOUL / Skill content'}
                      </div>
                      {inspectableFiles.map((file) => {
                        const openFile = Boolean(expandedFiles[file.path]);
                        return (
                          <div key={file.path} className="dsh-bots-file-review-item">
                            <button
                              type="button"
                              className="dsh-bots-file-review-head"
                              aria-expanded={openFile}
                              onClick={() => setExpandedFiles((prev) => ({ ...prev, [file.path]: !prev[file.path] }))}
                            >
                              <BotChevron open={openFile} size={12} />
                              <IconFileText size={12} />
                              <span className="dsh-bots-ellipsis">{file.label}</span>
                            </button>
                            <BotDisclosure open={openFile}>
                              <pre className="dsh-bots-file-review-pre">{file.content}</pre>
                            </BotDisclosure>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {!hasBlockers && needsExplicitReview && currentDigest && (
                    <label className="dsh-bots-review-ack">
                      <input
                        type="checkbox"
                        checked={reviewSatisfied}
                        onChange={(e) => {
                          setReviewedDigestBySource((prev) => {
                            const next = { ...prev };
                            if (e.target.checked) next[selected.id] = currentDigest;
                            else delete next[selected.id];
                            return next;
                          });
                          if (e.target.checked) setChangedAfterReview(false);
                        }}
                      />
                      <span>
                        {zh ? '我已审阅上述安全警告并确认继续导入' : 'I have reviewed the warnings and wish to import'}
                      </span>
                    </label>
                  )}
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
            <span>{zh ? '导入 JSON 分享包…' : 'Import package JSON…'}</span>
          </button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="dsh-bots-btn" onClick={onClose}>
              {tr('bots.new.cancel', 'Cancel')}
            </button>
            <button
              type="button"
              className="dsh-bots-btn"
              data-variant="primary"
              disabled={!canImport}
              onClick={() => void handleImport()}
            >
              {importing
                ? (zh ? '导入中…' : 'Importing…')
                : hasBlockers
                  ? (zh ? '存在阻断项，无法导入' : 'Blocked by scan')
                  : changedAfterReview && !reviewSatisfied
                    ? (zh ? '请重新审阅' : 'Review again')
                    : (zh ? '导入队友' : 'Import bot')}
            </button>
          </div>
        </div>

        <AvatarPickerPopover
          open={Boolean(pickerAnchor)}
          anchorRect={pickerAnchor}
          triggerRef={avatarBtnRef}
          onClose={() => setPickerAnchor(null)}
          value={avatarVal}
          onChange={setAvatarVal}
        />
      </div>
    </div>,
    document.body,
  );
}
