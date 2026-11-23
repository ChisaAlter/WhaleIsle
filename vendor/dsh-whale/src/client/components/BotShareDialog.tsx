// BotPackageV1 export (redacted share) and import-review dual-mode dialog.
// Enhanced with scanBotText security findings (blockers & risk warnings listed individually),
// expandable SOUL/Skill/Memory file text viewer, and content-change re-review guard.

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { mascotAvatar } from '../../shared/bot-avatar.js';
import * as botPackageMod from '../../shared/bot-package.js';
import { botsStore, useBotById, useBotsLocale } from '../store/bots-store';
import {
  RPC_METHODS,
  callBotRpc,
  type BotRecord,
  type BotSharePrepareResult,
} from '../store/rpc';
import { BotAvatar } from './BotAvatar';
import { BotChevron, BotDisclosure } from './BotDisclosure';
import {
  IconAlertTriangle,
  IconCheck,
  IconCopy,
  IconDownload,
  IconFileText,
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

export interface SecurityScanFinding {
  id: string;
  severity: 'block' | 'warn';
  rule: string;
  file: string;
  line?: number;
  snippet?: string;
  reason: string;
}

export interface SecurityScanReport {
  blockers: SecurityScanFinding[];
  warnings: SecurityScanFinding[];
}

interface ParsedPackageReview {
  manifest: {
    name: string;
    purpose: string;
    avatar?: { mascot?: string; image?: string };
    skills: Array<{ name: string; description?: string; content?: string }>;
    tools: Array<{ id: string; name: string; url: string; headerNames: string[] }>;
    schedules: Array<{ id: string; name: string; rrule: string }>;
    connectors: Array<string | { kind?: string; name?: string }>;
    memory?: Array<{ topic: string; content?: string }>;
    setupNote?: string;
  };
  soul?: string;
  files: Array<{ path: string; label: string; kind: 'soul' | 'skill' | 'memory' | 'other'; content: string }>;
  rawEnvelope: Record<string, unknown>;
}

const FALLBACK_RULES: Array<{
  rule: string;
  severity: 'block' | 'warn';
  re: RegExp;
  zhReason: string;
  enReason: string;
}> = [
  {
    rule: 'hidden-control-chars',
    severity: 'block',
    re: /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u061c\u200b-\u200f\u202a-\u202e\u2066-\u2069]/u,
    zhReason: '检测到不可见控制字符或双向文本混淆字符（可能用于隐藏恶意指令）',
    enReason: 'Hidden control or bidi override characters detected',
  },
  {
    rule: 'private-key-block',
    severity: 'block',
    re: /-----BEGIN [A-Z0-9 ]+PRIVATE KEY-----/,
    zhReason: '检测到疑似私钥文本块，禁止直接随包分发或写入',
    enReason: 'Private key block detected',
  },
  {
    rule: 'secret-token',
    severity: 'block',
    re: /\b(sk-[\w-]{12,}|sk-ant-[\w-]{12,}|xox[abprs]-[\w-]{10,}|gh[opsu]_[\w]{16,}|github_pat_\w{16,}|AKIA[0-9A-Z]{16}|AIza[\w-]{28,})/,
    zhReason: '检测到疑似明文 API Key / Token 凭证',
    enReason: 'Plaintext API key or token detected',
  },
  {
    rule: 'pipe-to-shell',
    severity: 'warn',
    re: /\b(curl|wget|fetch|iwr|irm)\b[^\n|]{0,200}\|\s*(sh|bash|zsh|fish|pwsh|powershell|python|node)\b/i,
    zhReason: '包含从远程下载并直接通过管道执行脚本的命令（pipe-to-shell）',
    enReason: 'Downloads and pipes remote content straight into a shell (pipe-to-shell)',
  },
  {
    rule: 'sudo-privilege',
    severity: 'warn',
    re: /(?:^|\s|`|'|"|;|\||&&)sudo\s+\S/i,
    zhReason: '包含使用 sudo 提权执行的指令',
    enReason: 'Invokes elevated privileges via sudo',
  },
  {
    rule: 'sends-file',
    severity: 'warn',
    re: /\b(curl|wget)\b[^\n]{0,160}(?:--data-binary|-F\s|--upload-file|-d\s*@|-T\s)|(?:\bscp\b|\brsync\b)[^\n]{0,120}@/i,
    zhReason: '可能将本地文件上传或外发至外部地址（sends-file）',
    enReason: 'May upload or exfiltrate local files to an external host (sends-file)',
  },
  {
    rule: 'destructive-command',
    severity: 'warn',
    re: /\brm\s+-[a-z]*r[a-z]*f\b|\bchmod\s+777\b/i,
    zhReason: '包含高风险文件系统删除或宽泛权限变更命令',
    enReason: 'Contains destructive file removal or permissive chmod command',
  },
];

type SharedScanBotText = (text: string, options?: Record<string, unknown>) => unknown;

function normalizeExternalFinding(
  raw: unknown,
  file: string,
  index: number,
  zh: boolean,
): SecurityScanFinding | null {
  if (typeof raw === 'string') {
    return {
      id: `${file}-str-${index}`,
      severity: 'warn',
      rule: 'warning',
      file,
      reason: raw,
    };
  }
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const obj = raw as Record<string, unknown>;
  const sevRaw = String(obj.severity ?? obj.level ?? (obj.block || obj.blocked ? 'block' : 'warn')).toLowerCase();
  const severity: 'block' | 'warn' = sevRaw === 'block' || sevRaw === 'blocker' || sevRaw === 'error' || sevRaw === 'high'
    ? 'block'
    : 'warn';
  const rule = String(obj.rule ?? obj.kind ?? obj.code ?? 'scan');
  const reason = String(obj.reason ?? obj.message ?? obj.detail ?? (zh ? `命中安全规则：${rule}` : `Matched rule: ${rule}`));
  const line = typeof obj.line === 'number' ? obj.line : undefined;
  const snippet = typeof obj.snippet === 'string'
    ? obj.snippet
    : (typeof obj.match === 'string' ? obj.match : undefined);
  return {
    id: `${file}-${rule}-${line ?? index}-${index}`,
    severity,
    rule,
    file: typeof obj.file === 'string' ? obj.file : file,
    line,
    snippet,
    reason,
  };
}

/**
 * Runs shared `scanBotText` when available in `shared/bot-package.js`, merged with
 * client-side safety checks (blockers: hidden chars / private keys / secrets;
 * warnings: pipe-to-shell / sudo / sends-file / destructive commands).
 */
export function runBotSecurityScan(
  entries: Array<{ file: string; text: string }>,
  zh: boolean,
  extraServerFindings?: { blockers?: unknown[]; warnings?: unknown[]; findings?: unknown[] },
): SecurityScanReport {
  const findings: SecurityScanFinding[] = [];
  const seen = new Set<string>();
  const pushUnique = (f: SecurityScanFinding) => {
    const key = `${f.severity}|${f.file}|${f.rule}|${f.line ?? ''}|${f.reason}`;
    if (!seen.has(key)) {
      seen.add(key);
      findings.push(f);
    }
  };

  if (extraServerFindings) {
    (extraServerFindings.blockers ?? []).forEach((item, idx) => {
      const f = normalizeExternalFinding(item, 'package', idx, zh);
      if (f) pushUnique({ ...f, severity: 'block' });
    });
    (extraServerFindings.warnings ?? []).forEach((item, idx) => {
      const f = normalizeExternalFinding(item, 'package', idx, zh);
      if (f) pushUnique({ ...f, severity: 'warn' });
    });
    (extraServerFindings.findings ?? []).forEach((item, idx) => {
      const f = normalizeExternalFinding(item, 'package', idx, zh);
      if (f) pushUnique(f);
    });
  }

  const sharedScanner = (botPackageMod as unknown as { scanBotText?: SharedScanBotText }).scanBotText;

  for (const { file, text } of entries) {
    if (!text) continue;

    if (typeof sharedScanner === 'function') {
      try {
        const res = sharedScanner(text, { file });
        if (Array.isArray(res)) {
          res.forEach((item, idx) => {
            const f = normalizeExternalFinding(item, file, idx, zh);
            if (f) pushUnique(f);
          });
        } else if (res && typeof res === 'object') {
          const obj = res as { blockers?: unknown[]; warnings?: unknown[]; findings?: unknown[]; issues?: unknown[] };
          (obj.blockers ?? []).forEach((item, idx) => {
            const f = normalizeExternalFinding(item, file, idx, zh);
            if (f) pushUnique({ ...f, severity: 'block' });
          });
          (obj.warnings ?? []).forEach((item, idx) => {
            const f = normalizeExternalFinding(item, file, idx, zh);
            if (f) pushUnique({ ...f, severity: 'warn' });
          });
          (obj.findings ?? obj.issues ?? []).forEach((item, idx) => {
            const f = normalizeExternalFinding(item, file, idx, zh);
            if (f) pushUnique(f);
          });
        }
      } catch {
        // Fall through to client scanner.
      }
    }

    const lines = text.split(/\r?\n/);
    lines.forEach((lineText, idx) => {
      for (const spec of FALLBACK_RULES) {
        if (spec.re.test(lineText)) {
          pushUnique({
            id: `${file}-${spec.rule}-${idx + 1}`,
            severity: spec.severity,
            rule: spec.rule,
            file,
            line: idx + 1,
            snippet: lineText.trim().slice(0, 120),
            reason: zh ? spec.zhReason : spec.enReason,
          });
        }
      }
    });
  }

  return {
    blockers: findings.filter((f) => f.severity === 'block'),
    warnings: findings.filter((f) => f.severity === 'warn'),
  };
}

export function computeContentDigest(parts: Array<string | undefined>): string {
  const joined = parts.filter((p): p is string => typeof p === 'string').join('\u0000');
  let hash = 2166136261;
  for (let i = 0; i < joined.length; i += 1) {
    hash ^= joined.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${joined.length}:${(hash >>> 0).toString(16)}`;
}

export function SecurityScanPanel({ report }: { report: SecurityScanReport }) {
  const { locale } = useBotsLocale();
  const zh = locale === 'zh-CN';
  const total = report.blockers.length + report.warnings.length;

  if (total === 0) {
    return (
      <div className="dsh-bots-scan-box" data-status="clean">
        <div className="dsh-bots-row-left" style={{ fontWeight: 600 }}>
          <IconShield size={14} className="dsh-bots-text-success" />
          <span>{zh ? '安全扫描通过：未发现阻断项或高风险指令' : 'Safety check passed: no blockers or risk warnings'}</span>
        </div>
      </div>
    );
  }

  return (
    <div
      className="dsh-bots-scan-box"
      data-status={report.blockers.length > 0 ? 'blocked' : 'warn'}
      role="region"
      aria-label={zh ? '安全扫描结果' : 'Security scan results'}
    >
      <div className="dsh-bots-row">
        <span className="dsh-bots-row-left" style={{ fontWeight: 600 }}>
          <IconAlertTriangle
            size={14}
            className={report.blockers.length > 0 ? 'dsh-bots-text-danger' : 'dsh-bots-text-warn'}
          />
          <span>
            {zh
              ? `安全扫描发现 ${report.blockers.length} 项阻断 · ${report.warnings.length} 项风险警告`
              : `Safety check: ${report.blockers.length} blocker(s) · ${report.warnings.length} warning(s)`}
          </span>
        </span>
      </div>

      {report.blockers.length > 0 && (
        <div className="dsh-bots-scan-group">
          <div className="dsh-bots-scan-group-title" data-severity="block">
            {zh ? '阻断项（必须先处理才可继续）' : 'Blockers (must be resolved)'}
          </div>
          <ul className="dsh-bots-scan-list">
            {report.blockers.map((item) => (
              <li key={item.id} className="dsh-bots-scan-item" data-severity="block">
                <div className="dsh-bots-scan-item-head">
                  <span className="dsh-bots-badge dsh-bots-badge-danger">{item.rule}</span>
                  <span className="dsh-bots-scan-loc">
                    {item.file}{item.line ? `:${item.line}` : ''}
                  </span>
                </div>
                <div className="dsh-bots-scan-reason">{item.reason}</div>
                {item.snippet && <code className="dsh-bots-scan-snippet">{item.snippet}</code>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {report.warnings.length > 0 && (
        <div className="dsh-bots-scan-group">
          <div className="dsh-bots-scan-group-title" data-severity="warn">
            {zh ? '风险警告（请逐条审阅确认）' : 'Risk warnings (review carefully)'}
          </div>
          <ul className="dsh-bots-scan-list">
            {report.warnings.map((item) => (
              <li key={item.id} className="dsh-bots-scan-item" data-severity="warn">
                <div className="dsh-bots-scan-item-head">
                  <span className="dsh-bots-badge dsh-bots-badge-warn">{item.rule}</span>
                  <span className="dsh-bots-scan-loc">
                    {item.file}{item.line ? `:${item.line}` : ''}
                  </span>
                </div>
                <div className="dsh-bots-scan-reason">{item.reason}</div>
                {item.snippet && <code className="dsh-bots-scan-snippet">{item.snippet}</code>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function collectPackageFiles(
  parsed: Record<string, unknown>,
  manifest: ParsedPackageReview['manifest'],
): ParsedPackageReview['files'] {
  const out: ParsedPackageReview['files'] = [];
  const seen = new Set<string>();
  const add = (path: string, label: string, kind: 'soul' | 'skill' | 'memory' | 'other', content: string) => {
    if (!seen.has(path) && typeof content === 'string') {
      seen.add(path);
      out.push({ path, label, kind, content });
    }
  };

  if (typeof parsed.soul === 'string') {
    add('SOUL.md', 'SOUL.md', 'soul', parsed.soul);
  }
  if (parsed.files && typeof parsed.files === 'object' && !Array.isArray(parsed.files)) {
    for (const [path, content] of Object.entries(parsed.files as Record<string, unknown>)) {
      if (typeof content !== 'string') continue;
      const lower = path.toLowerCase();
      const kind: 'soul' | 'skill' | 'memory' | 'other' = lower === 'soul.md'
        ? 'soul'
        : lower.startsWith('skills/') || lower.includes('/skills/')
          ? 'skill'
          : lower.startsWith('memory/')
            ? 'memory'
            : 'other';
      add(path, path, kind, content);
    }
  }
  for (const sk of manifest.skills ?? []) {
    if (typeof sk.content === 'string' && sk.content) {
      add(`skills/${sk.name}/SKILL.md`, `Skill: ${sk.name}`, 'skill', sk.content);
    }
  }
  for (const mem of manifest.memory ?? []) {
    if (typeof mem.content === 'string' && mem.content) {
      add(`memory/${mem.topic}.md`, `Memory: ${mem.topic}`, 'memory', mem.content);
    }
  }
  return out;
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
    const { bot } = botPackageMod.parseBotPackage(manifestCandidate) as unknown as {
      bot: ParsedPackageReview['manifest'];
    };
    const files = collectPackageFiles(parsed, bot);
    return {
      review: {
        manifest: bot,
        soul: typeof parsed.soul === 'string' ? parsed.soul : undefined,
        files,
        rawEnvelope: parsed,
      },
      error: null,
    };
  } catch (err) {
    const code = err instanceof Error ? err.message : String(err);
    if (code === botPackageMod.BOT_PACKAGE_NEWER_ERROR) {
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
  const zh = locale === 'zh-CN';
  const [loading, setLoading] = useState(false);
  const [prepared, setPrepared] = useState<BotSharePrepareResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [expandedFiles, setExpandedFiles] = useState<Record<string, boolean>>({});
  const [showRawJson, setShowRawJson] = useState(false);

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
      {
        manifest: prepared.manifest,
        ...(prepared.soul ? { soul: prepared.soul } : {}),
        ...(prepared.files ? { files: prepared.files } : {}),
      },
      null,
      2,
    );
  }, [prepared]);

  const exportFiles = useMemo(() => {
    if (!prepared) return [];
    const list: Array<{ path: string; content: string }> = [];
    if (typeof prepared.soul === 'string' && prepared.soul) {
      list.push({ path: 'SOUL.md', content: prepared.soul });
    }
    if (prepared.files && typeof prepared.files === 'object') {
      for (const [filePath, content] of Object.entries(prepared.files)) {
        if (filePath === 'SOUL.md' && list.some((i) => i.path === 'SOUL.md')) continue;
        if (typeof content === 'string') {
          list.push({ path: filePath, content });
        }
      }
    }
    return list;
  }, [prepared]);

  const scanReport = useMemo(() => {
    if (!prepared) return { blockers: [], warnings: [] };
    const extra = prepared as BotSharePrepareResult & {
      blockers?: unknown[];
      findings?: unknown[];
      scan?: { blockers?: unknown[]; warnings?: unknown[]; findings?: unknown[] };
    };
    const entries = exportFiles.map((f) => ({ file: f.path, text: f.content }));
    const manifestObj = prepared.manifest as Partial<ParsedPackageReview['manifest']> | undefined;
    if (manifestObj?.setupNote) {
      entries.push({ file: 'setupNote', text: manifestObj.setupNote });
    }
    return runBotSecurityScan(entries, zh, {
      blockers: extra.blockers ?? extra.scan?.blockers,
      warnings: [...(extra.warnings ?? []), ...(extra.scan?.warnings ?? [])],
      findings: extra.findings ?? extra.scan?.findings,
    });
  }, [exportFiles, prepared, zh]);

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
  const hasBlockers = scanReport.blockers.length > 0;

  return (
    <>
      <div className="dsh-bots-modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {loading ? (
          <div style={{ padding: 32, display: 'flex', justifyContent: 'center', gap: 8, color: 'var(--dsw-alias-label-tertiary)', fontSize: 13, lineHeight: '20px' }}>
            <IconSpinner size={15} />
            <span>{zh ? '正在生成脱敏分享包并执行安全扫描…' : 'Preparing redacted share package…'}</span>
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
                  {zh
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
              <span>{zh ? '技能' : 'Skills'}: {manifest?.skills?.length ?? 0}</span>
              <span>{zh ? '工具' : 'Tools'}: {manifest?.tools?.length ?? 0}</span>
              <span>{zh ? '定时' : 'Schedules'}: {manifest?.schedules?.length ?? 0}</span>
              {((prepared.redactedCount ?? prepared.redactions ?? 0) > 0) && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--dsw-alias-state-warn-label)' }}>
                  <IconShield size={12} />
                  {zh
                    ? `已脱敏 ${prepared.redactedCount ?? prepared.redactions} 处敏感信息`
                    : `${prepared.redactedCount ?? prepared.redactions} secrets redacted`}
                </span>
              )}
            </div>

            <SecurityScanPanel report={scanReport} />

            {exportFiles.length > 0 && (
              <div className="dsh-bots-file-review-list">
                <div className="dsh-bots-field-label" style={{ marginBottom: 4 }}>
                  {zh ? `包含文件正文预览（${exportFiles.length}）` : `Included files (${exportFiles.length})`}
                </div>
                {exportFiles.map((file) => {
                  const open = Boolean(expandedFiles[file.path]);
                  return (
                    <div key={file.path} className="dsh-bots-file-review-item">
                      <button
                        type="button"
                        className="dsh-bots-file-review-head"
                        aria-expanded={open}
                        onClick={() => setExpandedFiles((prev) => ({ ...prev, [file.path]: !prev[file.path] }))}
                      >
                        <BotChevron open={open} size={12} />
                        <IconFileText size={12} />
                        <span className="dsh-bots-ellipsis">{file.path}</span>
                        <span className="dsh-bots-muted" style={{ marginLeft: 'auto' }}>
                          {file.content.split(/\r?\n/).length} {zh ? '行' : 'lines'}
                        </span>
                      </button>
                      <BotDisclosure open={open}>
                        <pre className="dsh-bots-file-review-pre">{file.content}</pre>
                      </BotDisclosure>
                    </div>
                  );
                })}
              </div>
            )}

            <div>
              <button
                type="button"
                className="dsh-bots-link-btn"
                onClick={() => setShowRawJson((prev) => !prev)}
              >
                {showRawJson ? (zh ? '收起完整 JSON' : 'Hide raw JSON') : (zh ? '查看完整 JSON' : 'Show raw JSON')}
              </button>
              <BotDisclosure open={showRawJson}>
                <textarea
                  readOnly
                  className="dsh-bots-textarea"
                  rows={8}
                  value={serialized}
                  style={{ marginTop: 6, fontFamily: 'var(--ds-font-family-code)', fontSize: 12, lineHeight: '18px', resize: 'vertical', background: 'var(--dsw-alias-markdown-code-block)' }}
                />
              </BotDisclosure>
            </div>
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
            disabled={!serialized || hasBlockers}
            onClick={() => void handleCopy()}
          >
            {copied ? <IconCheck size={13} /> : <IconCopy size={13} />}
            <span>{copied ? (zh ? '已复制' : 'Copied') : (zh ? '复制 JSON' : 'Copy JSON')}</span>
          </button>
          <button
            type="button"
            className="dsh-bots-btn"
            data-variant="primary"
            disabled={!serialized || hasBlockers}
            onClick={handleDownload}
          >
            <IconDownload size={13} />
            <span>{zh ? '下载分享包' : 'Download .json'}</span>
          </button>
        </div>
      </div>
    </>
  );
}

function ImportShareBody({ initialJson, onClose }: { initialJson?: string; onClose: () => void }) {
  const { locale, tr } = useBotsLocale();
  const zh = locale === 'zh-CN';
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [rawJson, setRawJson] = useState(initialJson ?? '');
  const [customName, setCustomName] = useState('');
  const [selectedTools, setSelectedTools] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [expandedFiles, setExpandedFiles] = useState<Record<string, boolean>>({});
  const [reviewedDigest, setReviewedDigest] = useState<string | null>(null);
  const [changedAfterReview, setChangedAfterReview] = useState(false);

  const { review, error: parseError } = useMemo(
    () => tryParsePackageText(rawJson, locale),
    [locale, rawJson],
  );

  const currentDigest = useMemo(() => {
    if (!review) return null;
    return computeContentDigest([
      JSON.stringify(review.manifest),
      review.soul,
      ...review.files.map((f) => `${f.path}\n${f.content}`),
    ]);
  }, [review]);

  // If package content changes after the user already reviewed it, force a fresh re-review.
  useEffect(() => {
    if (reviewedDigest && currentDigest && reviewedDigest !== currentDigest) {
      setReviewedDigest(null);
      setChangedAfterReview(true);
    } else if (!currentDigest) {
      setReviewedDigest(null);
      setChangedAfterReview(false);
    }
  }, [currentDigest, reviewedDigest]);

  useEffect(() => {
    if (review) {
      setCustomName(review.manifest.name);
      setSelectedTools(review.manifest.tools.map((t) => t.id));
    }
  }, [review]);

  const scanReport = useMemo(() => {
    if (!review) return { blockers: [], warnings: [] };
    const entries: Array<{ file: string; text: string }> = [
      ...review.files.map((f) => ({ file: f.path, text: f.content })),
    ];
    if (review.manifest.purpose) {
      entries.push({ file: 'manifest.purpose', text: review.manifest.purpose });
    }
    if (review.manifest.setupNote) {
      entries.push({ file: 'manifest.setupNote', text: review.manifest.setupNote });
    }
    const envScan = review.rawEnvelope.scan as { blockers?: unknown[]; warnings?: unknown[]; findings?: unknown[] } | undefined;
    return runBotSecurityScan(entries, zh, envScan);
  }, [review, zh]);

  const hasBlockers = scanReport.blockers.length > 0;
  const needsExplicitReview = scanReport.warnings.length > 0 || changedAfterReview;
  const reviewSatisfied = Boolean(currentDigest && reviewedDigest === currentDigest);
  const canConfirmImport = Boolean(
    review
    && !importing
    && !hasBlockers
    && (!needsExplicitReview || reviewSatisfied),
  );

  const handleFile = (file: File) => {
    void file.text().then((text) => setRawJson(text)).catch((err) => {
      setSubmitError(err instanceof Error ? err.message : String(err));
    });
  };

  const handleConfirmImport = async () => {
    if (!review || !canConfirmImport) {
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
            {zh ? '粘贴 BotPackageV1 JSON 或选择 .json 文件' : 'Paste BotPackageV1 JSON or choose a .json file'}
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
            <span>{zh ? '选择文件' : 'Choose file'}</span>
          </button>
        </div>

        <textarea
          className="dsh-bots-textarea"
          rows={4}
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

        {changedAfterReview && review && !reviewSatisfied && (
          <div className="dsh-bots-pcard dsh-bots-pcard-warn" role="alert">
            <div className="dsh-bots-row-left" style={{ fontWeight: 600 }}>
              <IconAlertTriangle size={14} className="dsh-bots-text-warn" />
              <span>{zh ? '分享包内容已变更，请重新审阅' : 'Package content changed — please review again'}</span>
            </div>
            <div className="dsh-bots-muted">
              {zh
                ? '检测到正文或配置与上次审阅不一致，请展开检查下方文件并重新勾选确认。'
                : 'The package changed since your last review. Inspect the files below and confirm again.'}
            </div>
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

            <SecurityScanPanel report={scanReport} />

            {review.files.length > 0 && (
              <div className="dsh-bots-file-review-list">
                <div className="dsh-bots-field-label" style={{ marginBottom: 4 }}>
                  {zh ? `将写入的 SOUL / 技能 / 记忆正文（点击展开审阅）` : 'Files to be written (click to inspect)'}
                </div>
                {review.files.map((file) => {
                  const open = Boolean(expandedFiles[file.path]);
                  return (
                    <div key={file.path} className="dsh-bots-file-review-item">
                      <button
                        type="button"
                        className="dsh-bots-file-review-head"
                        aria-expanded={open}
                        onClick={() => setExpandedFiles((prev) => ({ ...prev, [file.path]: !prev[file.path] }))}
                      >
                        <BotChevron open={open} size={12} />
                        <IconFileText size={12} />
                        <span className="dsh-bots-ellipsis">{file.label}</span>
                        <span className="dsh-bots-muted" style={{ marginLeft: 'auto' }}>
                          {file.content.split(/\r?\n/).length} {zh ? '行' : 'lines'}
                        </span>
                      </button>
                      <BotDisclosure open={open}>
                        <pre className="dsh-bots-file-review-pre">{file.content}</pre>
                      </BotDisclosure>
                    </div>
                  );
                })}
              </div>
            )}

            {review.manifest.tools.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ fontSize: 12, lineHeight: '18px', fontWeight: 600, color: 'var(--dsw-alias-label-secondary)' }}>
                  {zh ? '审核外部工具（需单独填写认证密钥）' : 'Review external tools (keys configured separately)'}
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
              {zh
                ? `技能 ${review.manifest.skills.length} 项 · 定时计划 ${review.manifest.schedules.length} 项（默认关闭）`
                : `${review.manifest.skills.length} skills · ${review.manifest.schedules.length} schedules (off by default)`}
            </div>

            {!hasBlockers && currentDigest && (
              <label className="dsh-bots-review-ack">
                <input
                  type="checkbox"
                  checked={reviewSatisfied}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setReviewedDigest(currentDigest);
                      setChangedAfterReview(false);
                    } else {
                      setReviewedDigest(null);
                    }
                  }}
                />
                <span>
                  {needsExplicitReview
                    ? (zh ? '我已审阅上述正文与安全提示，确认继续导入' : 'I have reviewed the contents and warnings above')
                    : (zh ? '已审阅导入内容（若内容变动将自动要求重新确认）' : 'Mark reviewed (content changes require re-review)')}
                </span>
              </label>
            )}
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
          disabled={!canConfirmImport}
          onClick={() => void handleConfirmImport()}
        >
          {importing
            ? (zh ? '导入中…' : 'Importing…')
            : hasBlockers
              ? (zh ? '存在阻断项，无法导入' : 'Blocked by safety scan')
              : changedAfterReview && !reviewSatisfied
                ? (zh ? '请重新审阅' : 'Review again')
                : (zh ? '确认导入' : 'Import bot')}
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
