// BotPackageV1 export (redacted share) and import-review dual-mode dialog.

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { mascotAvatar } from '../../shared/bot-avatar.js';
import { BOT_PACKAGE_NEWER_ERROR, parseBotPackage } from '../../shared/bot-package.js';
import { botsStore, useBotById, useBotsLocale } from '../store/bots-store';
import {
  RPC_METHODS,
  callBotRpc,
  type BotRecord,
  type BotSharePrepareResult,
} from '../store/rpc';
import { BotAvatar } from './BotAvatar';
import {
  IconAlertTriangle,
  IconCheck,
  IconCopy,
  IconDownload,
  IconShare,
  IconShield,
  IconSpinner,
  IconUpload,
  IconX,
} from './Icons';

export interface BotShareDialogProps {
  open: boolean;
  mode: 'export' | 'import';
  botId?: string;
  initialJson?: string;
  onClose: () => void;
}

interface ParsedPackageReview {
  manifest: {
    name: string;
    purpose: string;
    avatar?: { mascot?: string; image?: string };
    skills: Array<{ name: string; description?: string }>;
    tools: Array<{ id: string; name: string; url: string; headerNames: string[] }>;
    schedules: Array<{ id: string; name: string; rrule: string }>;
    connectors: string[];
    setupNote?: string;
  };
  soul?: string;
  rawEnvelope: Record<string, unknown>;
}

function tryParsePackageText(rawText: string, locale: 'zh-CN' | 'en-US'): {
  review: ParsedPackageReview | null;
  error: string | null;
} {
  const trimmed = rawText.trim();
  if (!trimmed) {
    return { review: null, error: null };
  }
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const manifestCandidate = (parsed.manifest && typeof parsed.manifest === 'object'
      ? parsed.manifest
      : parsed) as Record<string, unknown>;
    const { bot } = parseBotPackage(manifestCandidate) as unknown as { bot: ParsedPackageReview['manifest'] };
    return {
      review: {
        manifest: bot,
        soul: typeof parsed.soul === 'string' ? parsed.soul : undefined,
        rawEnvelope: parsed,
      },
      error: null,
    };
  } catch (err) {
    const code = err instanceof Error ? err.message : String(err);
    if (code === BOT_PACKAGE_NEWER_ERROR) {
      return {
        review: null,
        error: locale === 'zh-CN'
          ? '该分享包版本较新，请升级 WhaleIsle 后再导入。'
          : 'This bot package requires a newer version of WhaleIsle.',
      };
    }
    return {
      review: null,
      error: locale === 'zh-CN'
        ? '无效的 BotPackageV1 JSON 格式，请检查粘贴内容。'
        : 'Invalid BotPackageV1 JSON. Check the pasted package content.',
    };
  }
}

function ExportShareBody({ bot, onClose }: { bot: BotRecord | null; onClose: () => void }) {
  const { locale, tr } = useBotsLocale();
  const [loading, setLoading] = useState(false);
  const [prepared, setPrepared] = useState<BotSharePrepareResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!bot) {
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void callBotRpc<BotSharePrepareResult>(RPC_METHODS.SHARE_PREPARE, { botId: bot.id })
      .then((res) => {
        if (!cancelled) {
          setPrepared(res);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [bot]);

  const serialized = useMemo(() => {
    if (!prepared) {
      return '';
    }
    if (typeof prepared.packageJson === 'string' && prepared.packageJson) {
      return prepared.packageJson;
    }
    return JSON.stringify(
      { manifest: prepared.manifest, ...(prepared.soul ? { soul: prepared.soul } : {}) },
      null,
      2,
    );
  }, [prepared]);

  const handleCopy = async () => {
    if (!serialized) {
      return;
    }
    const ok = await botsStore.copyToClipboard(serialized);
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDownload = () => {
    if (!serialized || !bot) {
      return;
    }
    const blob = new Blob([serialized], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const safeName = bot.name.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5_-]+/gi, '-') || 'bot';
    link.href = url;
    link.download = `${safeName}.orca-bot.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const manifest = prepared?.manifest as Partial<ParsedPackageReview['manifest']> | undefined;

  return (
    <>
      <div className="dsh-bots-modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {loading ? (
          <div style={{ padding: 32, display: 'flex', justifyContent: 'center', gap: 8, color: 'var(--dsw-alias-label-tertiary)', fontSize: 13, lineHeight: '20px' }}>
            <IconSpinner size={15} />
            <span>{locale === 'zh-CN' ? '正在生成脱敏分享包…' : 'Preparing redacted share package…'}</span>
          </div>
        ) : error ? (
          <div className="dsh-bots-error-text">{error}</div>
        ) : prepared && bot ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <BotAvatar
                botId={bot.id}
                avatar={bot.avatar}
                avatarColor={bot.avatarColor}
                name={bot.name}
                size={44}
                radius={10}
              />
              <div>
                <div style={{ fontSize: 14, lineHeight: '22px', fontWeight: 600 }}>{bot.name}</div>
                <div style={{ fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary)' }}>
                  {locale === 'zh-CN'
                    ? '仅包含灵魂、技能、定时与工具声明，自动排除隐私记忆与密钥。'
                    : 'Includes soul, skills, schedules, and tool specs; private memories and secrets are stripped.'}
                </div>
              </div>
            </div>

            <div
              className="dsh-bots-modal-card"
              style={{
                flexDirection: 'row',
                flexWrap: 'wrap',
                gap: 12,
                fontSize: 12,
                lineHeight: '18px',
                color: 'var(--dsw-alias-label-secondary)',
              }}
            >
              <span>{locale === 'zh-CN' ? '技能' : 'Skills'}: {manifest?.skills?.length ?? 0}</span>
              <span>{locale === 'zh-CN' ? '工具' : 'Tools'}: {manifest?.tools?.length ?? 0}</span>
              <span>{locale === 'zh-CN' ? '定时' : 'Schedules'}: {manifest?.schedules?.length ?? 0}</span>
              {((prepared.redactedCount ?? prepared.redactions ?? 0) > 0) && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--dsw-alias-state-warn-label)' }}>
                  <IconShield size={12} />
                  {locale === 'zh-CN'
                    ? `已脱敏 ${prepared.redactedCount ?? prepared.redactions} 处敏感信息`
                    : `${prepared.redactedCount ?? prepared.redactions} secrets redacted`}
                </span>
              )}
            </div>

            <textarea
              readOnly
              className="dsh-bots-textarea"
              rows={9}
              value={serialized}
              style={{ fontFamily: 'var(--ds-font-family-code)', fontSize: 12, lineHeight: '18px', resize: 'vertical', background: 'var(--dsw-alias-markdown-code-block)' }}
            />
          </>
        ) : null}
      </div>

      <div className="dsh-bots-modal-footer">
        <button type="button" className="dsh-bots-btn" onClick={onClose}>
          {tr('bots.new.cancel', 'Cancel')}
        </button>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            className="dsh-bots-btn"
            disabled={!serialized}
            onClick={() => void handleCopy()}
          >
            {copied ? <IconCheck size={13} /> : <IconCopy size={13} />}
            <span>{copied ? (locale === 'zh-CN' ? '已复制' : 'Copied') : (locale === 'zh-CN' ? '复制 JSON' : 'Copy JSON')}</span>
          </button>
          <button
            type="button"
            className="dsh-bots-btn"
            data-variant="primary"
            disabled={!serialized}
            onClick={handleDownload}
          >
            <IconDownload size={13} />
            <span>{locale === 'zh-CN' ? '下载分享包' : 'Download .json'}</span>
          </button>
        </div>
      </div>
    </>
  );
}

function ImportShareBody({ initialJson, onClose }: { initialJson?: string; onClose: () => void }) {
  const { locale, tr } = useBotsLocale();
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [rawJson, setRawJson] = useState(initialJson ?? '');
  const [customName, setCustomName] = useState('');
  const [selectedTools, setSelectedTools] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const { review, error: parseError } = useMemo(
    () => tryParsePackageText(rawJson, locale),
    [locale, rawJson],
  );

  useEffect(() => {
    if (review) {
      setCustomName(review.manifest.name);
      setSelectedTools(review.manifest.tools.map((t) => t.id));
    }
  }, [review]);

  const handleFile = (file: File) => {
    void file.text().then((text) => setRawJson(text)).catch((err) => {
      setSubmitError(err instanceof Error ? err.message : String(err));
    });
  };

  const handleConfirmImport = async () => {
    if (!review || importing) {
      return;
    }
    setImporting(true);
    setSubmitError(null);
    try {
      const res = await callBotRpc<{ bot?: BotRecord; sessionId?: string }>(RPC_METHODS.SHARE_IMPORT, {
        packageJson: review.rawEnvelope,
        name: customName.trim() || review.manifest.name,
        selectedToolIds: selectedTools,
      });
      await botsStore.refresh();
      const createdId = res?.bot?.id;
      if (createdId) {
        botsStore.setSectionCollapsed(false);
        void botsStore.openBotHome(createdId);
      }
      onClose();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
      setImporting(false);
    }
  };

  return (
    <>
      <div className="dsh-bots-modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <span style={{ fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-secondary)' }}>
            {locale === 'zh-CN' ? '粘贴 BotPackageV1 JSON 或选择 .json 文件' : 'Paste BotPackageV1 JSON or choose a .json file'}
          </span>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                handleFile(file);
              }
              e.target.value = '';
            }}
          />
          <button type="button" className="dsh-bots-btn" data-size="sm" onClick={() => fileRef.current?.click()}>
            <IconUpload size={13} />
            <span>{locale === 'zh-CN' ? '选择文件' : 'Choose file'}</span>
          </button>
        </div>

        <textarea
          className="dsh-bots-textarea"
          rows={5}
          value={rawJson}
          placeholder='{"schemaVersion": 1, "name": "...", ...}'
          onChange={(e) => setRawJson(e.target.value)}
          style={{ fontFamily: 'var(--ds-font-family-code)', fontSize: 12, lineHeight: '18px', background: 'var(--dsw-alias-markdown-code-block)' }}
        />

        {parseError && (
          <div className="dsh-bots-error-text" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <IconAlertTriangle size={14} />
            <span>{parseError}</span>
          </div>
        )}

        {review && (
          <div className="dsh-bots-modal-card" style={{ gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <BotAvatar
                avatar={review.manifest.avatar?.mascot ? mascotAvatar(review.manifest.avatar.mascot) : undefined}
                name={customName || review.manifest.name}
                size={42}
                radius={10}
              />
              <div style={{ flex: '1 1 auto' }}>
                <input
                  type="text"
                  className="dsh-bots-input"
                  value={customName}
                  maxLength={64}
                  onChange={(e) => setCustomName(e.target.value)}
                  style={{ height: 32, fontWeight: 600 }}
                />
                {review.manifest.purpose && (
                  <div style={{ fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary)', marginTop: 4 }}>
                    {review.manifest.purpose}
                  </div>
                )}
              </div>
            </div>

            {review.manifest.tools.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ fontSize: 12, lineHeight: '18px', fontWeight: 600, color: 'var(--dsw-alias-label-secondary)' }}>
                  {locale === 'zh-CN' ? '审核外部工具（需单独填写认证密钥）' : 'Review external tools (keys configured separately)'}
                </div>
                {review.manifest.tools.map((tool) => {
                  const checked = selectedTools.includes(tool.id);
                  return (
                    <label
                      key={tool.id}
                      style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, lineHeight: '18px', cursor: 'pointer' }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => setSelectedTools((prev) => (
                          prev.includes(tool.id) ? prev.filter((id) => id !== tool.id) : [...prev, tool.id]
                        ))}
                      />
                      <span style={{ fontWeight: 500 }}>{tool.name}</span>
                      <span style={{ color: 'var(--dsw-alias-label-tertiary)', fontSize: 12 }}>{tool.url}</span>
                    </label>
                  );
                })}
              </div>
            )}

            <div style={{ fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary)' }}>
              {locale === 'zh-CN'
                ? `技能 ${review.manifest.skills.length} 项 · 定时计划 ${review.manifest.schedules.length} 项（默认关闭）`
                : `${review.manifest.skills.length} skills · ${review.manifest.schedules.length} schedules (off by default)`}
            </div>
          </div>
        )}

        {submitError && <div className="dsh-bots-error-text">{submitError}</div>}
      </div>

      <div className="dsh-bots-modal-footer">
        <button type="button" className="dsh-bots-btn" onClick={onClose}>
          {tr('bots.new.cancel', 'Cancel')}
        </button>
        <button
          type="button"
          className="dsh-bots-btn"
          data-variant="primary"
          disabled={!review || importing}
          onClick={() => void handleConfirmImport()}
        >
          {importing
            ? (locale === 'zh-CN' ? '导入中…' : 'Importing…')
            : (locale === 'zh-CN' ? '确认导入' : 'Import bot')}
        </button>
      </div>
    </>
  );
}

export function BotShareDialog({ open, mode, botId, initialJson, onClose }: BotShareDialogProps) {
  const { locale } = useBotsLocale();
  const bot = useBotById(botId);

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
            <IconShare size={16} />
            <span className="dsh-bots-modal-title">
              {mode === 'export'
                ? (locale === 'zh-CN' ? '分享大肥鱼队友' : 'Share bot')
                : (locale === 'zh-CN' ? '导入大肥鱼分享包' : 'Import bot package')}
            </span>
          </div>
          <button type="button" className="dsh-bots-icon-btn" onClick={onClose} aria-label="Close">
            <IconX size={16} />
          </button>
        </div>

        {mode === 'export' ? (
          <ExportShareBody bot={bot} onClose={onClose} />
        ) : (
          <ImportShareBody initialJson={initialJson} onClose={onClose} />
        )}
      </div>
    </div>,
    document.body,
  );
}
