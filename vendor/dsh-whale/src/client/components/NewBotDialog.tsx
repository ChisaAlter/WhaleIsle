// Orca-faithful NewBotDialog with 84px adaptive color banner, drag/paste avatar upload,
// template prefill (skills/schedules/events), workspace takeover fields, and model selector.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { mascotAvatar, randomMascotAvatar } from '../../shared/bot-avatar.js';
import { DEFAULT_BOT_AVATAR_COLOR, normalizeHexColor } from '../../shared/bot-avatar-color.js';
import { BOT_CONNECTOR_NAMES, botTemplate, localizeTemplate } from '../../shared/bot-templates.js';
import {
  botsStore,
  useBotsLocale,
  useBotsState,
  type NewBotModalDraft,
} from '../store/bots-store';
import {
  RPC_METHODS,
  callBotRpc,
  invalidateUploadedAvatarCache,
  type BotImportSource,
} from '../store/rpc';
import {
  AvatarPickerPopover,
  cropImageFileToPng512,
  type AvatarPickerValue,
} from './AvatarPicker';
import { BotAvatar } from './BotAvatar';
import { IconCheck, IconDownload, IconSparkles, IconX } from './Icons';

export interface NewBotDialogProps {
  open: boolean;
  draft?: NewBotModalDraft;
  onClose: () => void;
}

const NAME_MAX = 64;
const PURPOSE_MAX = 200;

export function NewBotDialog({ open, draft, onClose }: NewBotDialogProps) {
  const { locale, tr } = useBotsLocale();
  const models = useBotsState((s) => s.models);

  const template = useMemo(() => {
    const raw = draft?.templateId ? botTemplate(draft.templateId) : null;
    return raw ? (localizeTemplate(raw, locale) ?? raw) : null;
  }, [draft?.templateId, locale]);

  const [name, setName] = useState('');
  const [purpose, setPurpose] = useState('');
  const [avatarVal, setAvatarVal] = useState<AvatarPickerValue>(() => ({
    avatar: randomMascotAvatar(),
    avatarColor: DEFAULT_BOT_AVATAR_COLOR,
    uploadedImage: null,
  }));
  const [selectedModel, setSelectedModel] = useState('');
  const [reasoningEffort, setReasoningEffort] = useState('');
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [watches, setWatches] = useState('');
  const [doesText, setDoesText] = useState('');
  const [reports, setReports] = useState('');

  const [pickerAnchor, setPickerAnchor] = useState<DOMRect | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importCount, setImportCount] = useState(0);
  const [draggingFile, setDraggingFile] = useState(false);

  const nameRef = useRef<HTMLInputElement | null>(null);
  const purposeRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    setError(null);
    setSubmitting(false);
    setPickerAnchor(null);
    if (template) {
      setName(draft?.initialName ?? template.name ?? '');
      setPurpose(draft?.initialPurpose ?? template.line ?? '');
      setAvatarVal({
        avatar: template.mascot ? mascotAvatar(template.mascot) : randomMascotAvatar(),
        avatarColor: normalizeHexColor(draft?.initialAvatarColor) ?? DEFAULT_BOT_AVATAR_COLOR,
        uploadedImage: null,
      });
      setSelectedSkills([...(template.skills ?? [])]);
      setWatches(template.watches ?? '');
      setDoesText(template.does ?? '');
      setReports(template.reports ?? '');
    } else if (draft?.takeOverWorkspace) {
      const tw = draft.takeOverWorkspace;
      setName(draft.initialName ?? tw.name ?? '');
      setPurpose(draft.initialPurpose ?? '');
      setAvatarVal({
        avatar: draft.initialAvatar ?? randomMascotAvatar(),
        avatarColor: normalizeHexColor(draft.initialAvatarColor) ?? DEFAULT_BOT_AVATAR_COLOR,
        uploadedImage: null,
      });
      setSelectedSkills([]);
      setWatches(tw.watches ?? '');
      setDoesText(tw.does ?? '');
      setReports(tw.reports ?? '');
    } else {
      setName(draft?.initialName ?? '');
      setPurpose(draft?.initialPurpose ?? '');
      setAvatarVal({
        avatar: draft?.initialAvatar ?? randomMascotAvatar(),
        avatarColor: normalizeHexColor(draft?.initialAvatarColor) ?? DEFAULT_BOT_AVATAR_COLOR,
        uploadedImage: null,
      });
      setSelectedSkills([]);
      setWatches('');
      setDoesText('');
      setReports('');
    }
    if (models.length === 0) {
      void botsStore.refreshModels();
    }
    window.setTimeout(() => nameRef.current?.focus(), 30);
  }, [draft, models.length, open, template]);

  useEffect(() => {
    if (!open || models.length === 0) {
      return;
    }
    setSelectedModel((prev) => {
      if (prev && models.some((m) => m.id === prev)) {
        return prev;
      }
      return models.find((m) => m.default)?.id ?? models[0]?.id ?? '';
    });
  }, [models, open]);

  useEffect(() => {
    if (!open || template || draft?.takeOverWorkspace) {
      setImportCount(0);
      return undefined;
    }
    let cancelled = false;
    void callBotRpc<{ sources?: BotImportSource[] } | BotImportSource[]>(RPC_METHODS.IMPORT_SOURCES)
      .then((res) => {
        if (cancelled) {
          return;
        }
        const list = Array.isArray(res) ? res : (res?.sources ?? []);
        setImportCount(list.filter((item) => !item.imported).length);
      })
      .catch((err) => {
        console.warn('[dsh-bots] Import source discovery skipped', err);
      });
    return () => {
      cancelled = true;
    };
  }, [draft?.takeOverWorkspace, open, template]);

  const activeModelObj = useMemo(
    () => models.find((m) => m.id === selectedModel) ?? null,
    [models, selectedModel],
  );

  useEffect(() => {
    const efforts = activeModelObj?.reasoningEfforts ?? [];
    if (efforts.length === 0) {
      setReasoningEffort('');
    } else if (!efforts.includes(reasoningEffort)) {
      setReasoningEffort(efforts[0]);
    }
  }, [activeModelObj, reasoningEffort]);

  const adjustTextareaHeight = () => {
    const el = purposeRef.current;
    if (!el) {
      return;
    }
    el.style.height = 'auto';
    el.style.height = `${Math.min(132, Math.max(54, el.scrollHeight))}px`;
  };

  const applyImageFile = useCallback(async (file: File) => {
    setError(null);
    try {
      const cropped = await cropImageFileToPng512(file);
      setAvatarVal({
        avatar: 'upload:pending',
        avatarColor: cropped.edgeColor,
        uploadedImage: cropped,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const handlePaste = (event: ClipboardEvent<HTMLDivElement>) => {
    const items = event.clipboardData?.items;
    if (!items) {
      return;
    }
    for (const item of Array.from(items) as DataTransferItem[]) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          event.preventDefault();
          void applyImageFile(file);
          return;
        }
      }
    }
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDraggingFile(false);
    const file = event.dataTransfer.files?.[0];
    if (file && file.type.startsWith('image/')) {
      void applyImageFile(file);
    }
  };

  const handleSubmit = async () => {
    const cleanName = name.trim();
    if (!cleanName || submitting) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const hasCustomUpload = Boolean(avatarVal.uploadedImage && avatarVal.avatar.startsWith('upload:'));
      const resolvedPurpose = (purpose.trim() || template?.summary || template?.line || '').slice(0, PURPOSE_MAX);
      const payload: Record<string, unknown> = {
        name: cleanName.slice(0, NAME_MAX),
        purpose: resolvedPurpose,
        locale,
        avatar: hasCustomUpload ? randomMascotAvatar() : avatarVal.avatar,
        avatarColor: avatarVal.avatarColor,
        ...(selectedModel ? { model: selectedModel } : {}),
        ...(reasoningEffort ? { reasoningEffort } : {}),
        ...(template
          ? {
            fromTemplate: {
              templateId: template.id,
              skills: selectedSkills,
            },
            selectedSkills,
            watches: (watches.trim() || template.watches || '').trim(),
            does: (doesText.trim() || template.does || '').trim(),
            reports: (reports.trim() || template.reports || '').trim(),
          }
          : {}),
        ...(draft?.takeOverWorkspace
          ? {
            takeOverWorkspaceId: draft.takeOverWorkspace.workspaceId,
            watches: watches.trim(),
            does: doesText.trim(),
            reports: reports.trim(),
          }
          : {}),
      };
      const created = await botsStore.createBot(payload);
      if (hasCustomUpload && avatarVal.uploadedImage && created?.id) {
        await callBotRpc(RPC_METHODS.AVATAR_UPLOAD, {
          botId: created.id,
          base64Png: avatarVal.uploadedImage.base64Png,
        });
        invalidateUploadedAvatarCache(created.id);
        void botsStore.refresh();
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && !pickerAnchor) {
      onClose();
    } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void handleSubmit();
    }
  };

  if (!open || typeof document === 'undefined') {
    return null;
  }

  const bandColor = avatarVal.uploadedImage && avatarVal.avatar.startsWith('upload:')
    ? avatarVal.uploadedImage.edgeColor
    : avatarVal.avatarColor;
  const isTakeOver = Boolean(draft?.takeOverWorkspace);

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
        aria-label={tr('bots.new.title', 'New bot')}
        className="dsh-bots-modal"
        data-drag-file={draggingFile ? 'true' : 'false'}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        onDragOver={(e) => {
          e.preventDefault();
          setDraggingFile(true);
        }}
        onDragLeave={() => setDraggingFile(false)}
        onDrop={handleDrop}
      >
        <div
          className="dsh-bots-modal-band"
          style={{ '--new-bot-band': bandColor } as CSSProperties}
        />

        <button
          type="button"
          className="dsh-bots-icon-btn"
          aria-label="Close"
          onClick={onClose}
          style={{ position: 'absolute', top: 12, right: 12, background: 'var(--dsw-alias-bg-layer-2)' }}
        >
          <IconX size={16} />
        </button>

        <div className="dsh-bots-modal-body" style={{ paddingTop: 0, marginTop: -38 }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, marginBottom: 16 }}>
            <button
              type="button"
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                setPickerAnchor((prev) => (prev ? null : rect));
              }}
              title={tr('bots.new.picture', 'Picture')}
              style={{
                padding: 0,
                border: '3px solid var(--dsw-alias-bg-panel-solid)',
                borderRadius: 16,
                background: 'transparent',
                cursor: 'pointer',
                boxShadow: 'var(--dsw-shadow-lv2)',
                flexShrink: 0,
              }}
            >
              <BotAvatar
                avatar={avatarVal.avatar}
                avatarColor={avatarVal.avatarColor}
                dataUrlOverride={avatarVal.avatar.startsWith('upload:') ? avatarVal.uploadedImage?.dataUrl : null}
                name={name || 'Bot'}
                size={72}
                radius={14}
              />
            </button>

            <div style={{ flex: '1 1 auto', minWidth: 0, paddingBottom: 4 }}>
              <input
                ref={nameRef}
                type="text"
                value={name}
                maxLength={NAME_MAX}
                placeholder={tr('bots.new.namePlaceholder', 'Name your bot')}
                onChange={(e) => setName(e.target.value)}
                style={{
                  width: '100%',
                  border: 0,
                  outline: 'none',
                  background: 'transparent',
                  color: 'var(--dsw-alias-label-primary)',
                  fontSize: 18,
                  lineHeight: '26px',
                  fontWeight: 600,
                  fontFamily: 'inherit',
                }}
              />
              {template && (
                <div style={{ fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary)', marginTop: 2 }}>
                  {locale === 'zh-CN' ? `基于模板：${template.name}` : `From template: ${template.name}`}
                </div>
              )}
            </div>
          </div>

          {importCount > 0 && (
            <div className="dsh-bots-search-banner" style={{ margin: '0 0 12px', padding: '8px 12px' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <IconDownload size={14} />
                <span>
                  {locale === 'zh-CN'
                    ? `检测到 ${importCount} 位本地可导入的大肥鱼队友`
                    : `${importCount} local bot${importCount > 1 ? 's' : ''} ready to import`}
                </span>
              </span>
              <button
                type="button"
                className="dsh-bots-link-btn"
                onClick={() => botsStore.openModal({ kind: 'import', initialTab: 'apps' })}
              >
                {locale === 'zh-CN' ? '导入' : 'Import'}
              </button>
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <label className="dsh-bots-field-label" style={{ marginBottom: 0 }}>
                  {tr('bots.new.purposeLabel', 'Identity')}
                </label>
                {purpose.length >= 160 && (
                  <span style={{ fontSize: 11, lineHeight: '14px', color: 'var(--dsw-alias-label-tertiary)' }}>
                    {purpose.length}/{PURPOSE_MAX}
                  </span>
                )}
              </div>
              <textarea
                ref={purposeRef}
                className="dsh-bots-textarea"
                rows={2}
                maxLength={PURPOSE_MAX}
                value={purpose}
                placeholder={tr('bots.new.purposePlaceholder', 'Who it is and what it does')}
                onChange={(e) => {
                  setPurpose(e.target.value);
                  adjustTextareaHeight();
                }}
                style={{ resize: 'none', minHeight: 56 }}
              />
            </div>

            {models.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: activeModelObj?.reasoningEfforts?.length ? '1fr 140px' : '1fr', gap: 8 }}>
                <div>
                  <label className="dsh-bots-field-label">
                    {locale === 'zh-CN' ? '模型' : 'Model'}
                  </label>
                  <select
                    className="dsh-bots-select"
                    value={selectedModel}
                    onChange={(e) => setSelectedModel(e.target.value)}
                  >
                    {models.map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.label}
                      </option>
                    ))}
                  </select>
                </div>
                {activeModelObj?.reasoningEfforts && activeModelObj.reasoningEfforts.length > 0 && (
                  <div>
                    <label className="dsh-bots-field-label">
                      {locale === 'zh-CN' ? '推理强度' : 'Effort'}
                    </label>
                    <select
                      className="dsh-bots-select"
                      value={reasoningEffort}
                      onChange={(e) => setReasoningEffort(e.target.value)}
                    >
                      {activeModelObj.reasoningEfforts.map((effort) => (
                        <option key={effort} value={effort}>{effort}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            )}

            {isTakeOver && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div>
                  <label className="dsh-bots-field-label">
                    {tr('bots.new.watches', 'Watches')}
                  </label>
                  <input className="dsh-bots-input" value={watches} onChange={(e) => setWatches(e.target.value)} />
                </div>
                <div>
                  <label className="dsh-bots-field-label">
                    {tr('bots.new.does', 'Does')}
                  </label>
                  <input className="dsh-bots-input" value={doesText} onChange={(e) => setDoesText(e.target.value)} />
                </div>
                <div>
                  <label className="dsh-bots-field-label">
                    {tr('bots.new.reports', 'Reports')}
                  </label>
                  <input className="dsh-bots-input" value={reports} onChange={(e) => setReports(e.target.value)} />
                </div>
              </div>
            )}

            {template && (
              <div className="dsh-bots-modal-card">
                <div style={{ fontSize: 12, lineHeight: '18px', fontWeight: 600, color: 'var(--dsw-alias-label-secondary)' }}>
                  {tr('bots.templates.comesWith', 'Comes with')}
                </div>
                {(template.skills?.length ?? 0) > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {template.skills.map((skillId: string) => {
                      const checked = selectedSkills.includes(skillId);
                      return (
                        <button
                          key={skillId}
                          type="button"
                          className="dsh-bots-chip"
                          data-active={checked ? 'true' : 'false'}
                          onClick={() => setSelectedSkills((prev) => (
                            prev.includes(skillId) ? prev.filter((id) => id !== skillId) : [...prev, skillId]
                          ))}
                        >
                          {checked && <IconCheck size={12} />}
                          <span>{skillId}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
                {(template.schedules?.length ?? 0) > 0 && (
                  <div style={{ fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary)' }}>
                    {locale === 'zh-CN'
                      ? `定时任务（默认关闭）：${template.schedules.map((s: { when: string }) => s.when).join('、')}`
                      : `Schedules (off by default): ${template.schedules.map((s: { when: string }) => s.when).join(', ')}`}
                  </div>
                )}
                {(template.connectors?.length ?? 0) > 0 && (
                  <div style={{ fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary)' }}>
                    {locale === 'zh-CN' ? '连接器：' : 'Connectors: '}
                    {template.connectors
                      .map((c: string) => BOT_CONNECTOR_NAMES[c as keyof typeof BOT_CONNECTOR_NAMES] ?? c)
                      .join(', ')}
                  </div>
                )}
              </div>
            )}

            {error && <div className="dsh-bots-error-text">{error}</div>}
          </div>
        </div>

        <div className="dsh-bots-modal-footer">
          <button
            type="button"
            className="dsh-bots-btn"
            data-variant="ghost"
            onClick={() => botsStore.openModal({ kind: 'templates' })}
          >
            <IconSparkles size={13} />
            <span>{tr('bots.new.fromTemplate', 'Templates')}</span>
          </button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="dsh-bots-btn" onClick={onClose}>
              {tr('bots.new.cancel', 'Cancel')}
            </button>
            <button
              type="button"
              className="dsh-bots-btn"
              data-variant="primary"
              disabled={!name.trim() || submitting}
              onClick={() => void handleSubmit()}
            >
              {submitting ? tr('bots.new.creating', 'Creating…') : tr('bots.new.create', 'Create')}
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
