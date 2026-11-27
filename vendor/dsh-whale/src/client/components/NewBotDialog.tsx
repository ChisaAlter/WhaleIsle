// Orca-faithful NewBotDialog with 84px adaptive color banner, drag/paste avatar upload,
// compact template chips (N skills / N schedules / N events / Needs X) with toggle popovers,
// non-intrusive focus when prefilled from a template, workspace takeover fields, and model selector.

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
import {
  IconCalendar,
  IconChevronDown,
  IconDownload,
  IconPlug,
  IconSparkles,
  IconWrench,
  IconX,
  IconZap,
} from './Icons';

export interface NewBotDialogProps {
  open: boolean;
  draft?: NewBotModalDraft;
  onClose: () => void;
}

type TemplateChipKind = 'skills' | 'schedules' | 'events' | 'setup';

interface TemplateScheduleItem {
  id?: string;
  when: string;
  what?: string;
}

interface TemplateEventItem {
  id?: string;
  name?: string;
  source?: string;
  summary?: string;
}

const NAME_MAX = 64;
const PURPOSE_MAX = 200;

export function NewBotDialog({ open, draft, onClose }: NewBotDialogProps) {
  const { locale, tr } = useBotsLocale();
  const zh = locale === 'zh-CN';
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
  const [includeSchedules, setIncludeSchedules] = useState(true);
  const [includeEvents, setIncludeEvents] = useState(true);
  const [activeChipPopover, setActiveChipPopover] = useState<TemplateChipKind | null>(null);
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
  const chipsBarRef = useRef<HTMLDivElement | null>(null);
  const avatarBtnRef = useRef<HTMLButtonElement | null>(null);
  const modalRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!activeChipPopover) {
      return undefined;
    }
    const handleOutside = (e: MouseEvent) => {
      if (chipsBarRef.current && !chipsBarRef.current.contains(e.target as Node)) {
        setActiveChipPopover(null);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [activeChipPopover]);

  useEffect(() => {
    if (!open) {
      return;
    }
    setError(null);
    setSubmitting(false);
    setPickerAnchor(null);
    setActiveChipPopover(null);
    setIncludeSchedules(true);
    setIncludeEvents(true);

    const hasPrefilledName = Boolean(template || draft?.initialName || draft?.takeOverWorkspace?.name);

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
    // Only auto-focus the name input when starting blank; avoid hijacking cursor on template prefill.
    if (!hasPrefilledName) {
      window.setTimeout(() => nameRef.current?.focus(), 30);
    }
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
              includeSchedules,
              includeEvents,
            },
            selectedSkills,
            includeSchedules,
            includeEvents,
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

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const handleDocKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (submitting) {
          event.preventDefault();
          return;
        }
        if (activeChipPopover) {
          event.stopPropagation();
          setActiveChipPopover(null);
          return;
        }
        if (!pickerAnchor) {
          event.preventDefault();
          onClose();
        }
        return;
      }
      if (event.key !== 'Tab' || pickerAnchor || !modalRef.current) {
        return;
      }
      const focusables = Array.from(
        modalRef.current.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => !el.hidden && !el.closest('[hidden], [inert]'));
      if (focusables.length === 0) {
        return;
      }
      const idx = focusables.indexOf(document.activeElement as HTMLElement);
      const next = idx < 0
        ? (event.shiftKey ? focusables.length - 1 : 0)
        : (idx + (event.shiftKey ? -1 : 1) + focusables.length) % focusables.length;
      event.preventDefault();
      focusables[next]?.focus();
    };
    document.addEventListener('keydown', handleDocKey);
    return () => document.removeEventListener('keydown', handleDocKey);
  }, [activeChipPopover, onClose, open, pickerAnchor, submitting]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
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

  const templateSkills: string[] = Array.isArray(template?.skills) ? template.skills : [];
  const templateSchedules: TemplateScheduleItem[] = Array.isArray(template?.schedules)
    ? (template.schedules as TemplateScheduleItem[])
    : [];
  const templateEvents: TemplateEventItem[] = Array.isArray(template?.events)
    ? (template.events as TemplateEventItem[])
    : [];
  const templateConnectors: string[] = Array.isArray(template?.connectors)
    ? (template.connectors as string[])
    : [];
  const templateNeedsSetup: string = typeof template?.needsSetup === 'string' ? template.needsSetup.trim() : '';
  const connectorLabels = templateConnectors.map(
    (c) => BOT_CONNECTOR_NAMES[c as keyof typeof BOT_CONNECTOR_NAMES] ?? c,
  );
  const setupSummary = templateNeedsSetup || connectorLabels.join(' / ');
  const hasTemplateParts = Boolean(
    template
    && (templateSkills.length > 0 || templateSchedules.length > 0 || templateEvents.length > 0 || setupSummary),
  );

  return createPortal(
    <div
      className="dsh-bots-backdrop"
      onMouseDown={(e) => {
        if (!submitting && e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        ref={modalRef}
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
          aria-label={tr('bots.common.close', zh ? '关闭' : 'Close')}
          disabled={submitting}
          onClick={() => { if (!submitting) onClose(); }}
          style={{ position: 'absolute', top: 12, right: 12, background: 'var(--dsw-alias-bg-layer-2)' }}
        >
          <IconX size={16} />
        </button>

        <div className="dsh-bots-modal-body" style={{ paddingTop: 0, marginTop: -38 }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, marginBottom: 16 }}>
            <button
              ref={avatarBtnRef}
              type="button"
              aria-haspopup="dialog"
              aria-expanded={Boolean(pickerAnchor)}
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
                  {zh ? `基于模板：${template.name}` : `From template: ${template.name}`}
                </div>
              )}
            </div>
          </div>

          {importCount > 0 && (
            <div className="dsh-bots-search-banner" style={{ margin: '0 0 12px', padding: '8px 12px' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <IconDownload size={14} />
                <span>
                  {zh
                    ? `检测到 ${importCount} 位本地可导入的大肥鱼队友`
                    : `${importCount} local bot${importCount > 1 ? 's' : ''} ready to import`}
                </span>
              </span>
              <button
                type="button"
                className="dsh-bots-link-btn"
                disabled={submitting}
                onClick={() => { if (!submitting) botsStore.openModal({ kind: 'import', initialTab: 'apps' }); }}
              >
                {zh ? '导入' : 'Import'}
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
                    {zh ? '模型' : 'Model'}
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
                      {zh ? '推理强度' : 'Effort'}
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

            {hasTemplateParts && (
              <div ref={chipsBarRef} className="dsh-bots-tpl-chips-wrap">
                <div className="dsh-bots-tpl-chips-row">
                  {templateSkills.length > 0 && (
                    <div className="dsh-bots-tpl-chip-slot">
                      <button
                        type="button"
                        className="dsh-bots-tpl-chip"
                        data-active={activeChipPopover === 'skills' ? 'true' : 'false'}
                        aria-expanded={activeChipPopover === 'skills'}
                        onClick={() => setActiveChipPopover((prev) => (prev === 'skills' ? null : 'skills'))}
                      >
                        <IconWrench size={11} />
                        <span>
                          {zh
                            ? `${selectedSkills.length} 项技能`
                            : `${selectedSkills.length} skill${selectedSkills.length === 1 ? '' : 's'}`}
                        </span>
                        <IconChevronDown size={11} />
                      </button>
                      {activeChipPopover === 'skills' && (
                        <div className="dsh-bots-tpl-popover" role="dialog" aria-label={zh ? '模板技能开关' : 'Template skills'}>
                          <div className="dsh-bots-tpl-popover-title">
                            {zh ? '随模板安装的技能' : 'Included skills'}
                          </div>
                          {templateSkills.map((skillId) => {
                            const checked = selectedSkills.includes(skillId);
                            return (
                              <label key={skillId} className="dsh-bots-tpl-popover-row">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => setSelectedSkills((prev) => (
                                    prev.includes(skillId) ? prev.filter((id) => id !== skillId) : [...prev, skillId]
                                  ))}
                                />
                                <span>{skillId}</span>
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {templateSchedules.length > 0 && (
                    <div className="dsh-bots-tpl-chip-slot">
                      <button
                        type="button"
                        className="dsh-bots-tpl-chip"
                        data-active={activeChipPopover === 'schedules' ? 'true' : 'false'}
                        data-muted={!includeSchedules ? 'true' : 'false'}
                        aria-expanded={activeChipPopover === 'schedules'}
                        onClick={() => setActiveChipPopover((prev) => (prev === 'schedules' ? null : 'schedules'))}
                      >
                        <IconCalendar size={11} />
                        <span>
                          {zh
                            ? `${includeSchedules ? templateSchedules.length : 0} 项定时`
                            : `${includeSchedules ? templateSchedules.length : 0} schedule${templateSchedules.length === 1 ? '' : 's'}`}
                        </span>
                        <IconChevronDown size={11} />
                      </button>
                      {activeChipPopover === 'schedules' && (
                        <div className="dsh-bots-tpl-popover" role="dialog" aria-label={zh ? '模板定时任务' : 'Template schedules'}>
                          <div className="dsh-bots-row">
                            <span className="dsh-bots-tpl-popover-title">{zh ? '随模板创建定时（默认暂停）' : 'Create schedules (paused)'}</span>
                            <button
                              type="button"
                              role="switch"
                              className="dsh-bots-switch"
                              aria-checked={includeSchedules}
                              onClick={() => setIncludeSchedules((prev) => !prev)}
                            >
                              <span className="dsh-bots-switch-thumb" />
                            </button>
                          </div>
                          {templateSchedules.map((sched, i) => (
                            <div key={sched.id ?? i} className="dsh-bots-tpl-popover-detail">
                              <div style={{ fontWeight: 500 }}>{sched.when}</div>
                              {sched.what && <div className="dsh-bots-muted">{sched.what}</div>}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {templateEvents.length > 0 && (
                    <div className="dsh-bots-tpl-chip-slot">
                      <button
                        type="button"
                        className="dsh-bots-tpl-chip"
                        data-active={activeChipPopover === 'events' ? 'true' : 'false'}
                        data-muted={!includeEvents ? 'true' : 'false'}
                        aria-expanded={activeChipPopover === 'events'}
                        onClick={() => setActiveChipPopover((prev) => (prev === 'events' ? null : 'events'))}
                      >
                        <IconZap size={11} />
                        <span>
                          {zh
                            ? `${includeEvents ? templateEvents.length : 0} 项事件`
                            : `${includeEvents ? templateEvents.length : 0} event${templateEvents.length === 1 ? '' : 's'}`}
                        </span>
                        <IconChevronDown size={11} />
                      </button>
                      {activeChipPopover === 'events' && (
                        <div className="dsh-bots-tpl-popover" role="dialog" aria-label={zh ? '模板事件监听' : 'Template events'}>
                          <div className="dsh-bots-row">
                            <span className="dsh-bots-tpl-popover-title">{zh ? '保留事件触发建议' : 'Include event triggers'}</span>
                            <button
                              type="button"
                              role="switch"
                              className="dsh-bots-switch"
                              aria-checked={includeEvents}
                              onClick={() => setIncludeEvents((prev) => !prev)}
                            >
                              <span className="dsh-bots-switch-thumb" />
                            </button>
                          </div>
                          {templateEvents.map((ev, i) => (
                            <div key={ev.id ?? i} className="dsh-bots-tpl-popover-detail">
                              <div style={{ fontWeight: 500 }}>{ev.name || ev.source || `Event ${i + 1}`}</div>
                              {ev.summary && <div className="dsh-bots-muted">{ev.summary}</div>}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {setupSummary && (
                    <div className="dsh-bots-tpl-chip-slot">
                      <button
                        type="button"
                        className="dsh-bots-tpl-chip dsh-bots-tpl-chip-warn"
                        data-active={activeChipPopover === 'setup' ? 'true' : 'false'}
                        aria-expanded={activeChipPopover === 'setup'}
                        onClick={() => setActiveChipPopover((prev) => (prev === 'setup' ? null : 'setup'))}
                      >
                        <IconPlug size={11} />
                        <span className="dsh-bots-ellipsis" style={{ maxWidth: 160 }}>
                          {zh ? `需配置 ${setupSummary}` : `Needs ${setupSummary}`}
                        </span>
                        <IconChevronDown size={11} />
                      </button>
                      {activeChipPopover === 'setup' && (
                        <div className="dsh-bots-tpl-popover" role="dialog" aria-label={zh ? '需要配置的项目' : 'Setup required'}>
                          <div className="dsh-bots-tpl-popover-title">
                            {zh ? '创建后需完成配置' : 'Requires setup after creation'}
                          </div>
                          <div className="dsh-bots-muted">
                            {templateNeedsSetup || (zh
                              ? `建议在队友设置 → 连接器中接入：${connectorLabels.join('、')}`
                              : `Connect in Bot Settings → Connectors: ${connectorLabels.join(', ')}`)}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
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
            disabled={submitting}
            onClick={() => { if (!submitting) botsStore.openModal({ kind: 'templates' }); }}
          >
            <IconSparkles size={13} />
            <span>{tr('bots.new.fromTemplate', 'Templates')}</span>
          </button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="dsh-bots-btn" disabled={submitting} onClick={() => { if (!submitting) onClose(); }}>
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
