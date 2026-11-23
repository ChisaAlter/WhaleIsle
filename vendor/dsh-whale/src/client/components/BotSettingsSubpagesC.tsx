// Bot Settings Drill-down Subpages C (3 of 12):
// 10. tools (Per-Bot MCP CRUD + paste parser)
// 11. skills (scan workspace skills & link up to 20)
// 12. sharing (export BotPackageV1 JSON + import review)

import { useCallback, useEffect, useState } from 'react';
import { BOT_LIMITS } from '../../shared/bot-types.js';
import {
  botToolDetail,
  parseBotToolPaste,
  validateBotToolServer,
} from '../../shared/bot-tools-schema.js';
import { botsStore, useBotsLocale } from '../store/bots-store';
import { RPC_METHODS, callBotRpc, type BotRecord } from '../store/rpc';
import type { SubpageProps } from './BotSettingsSubpagesA';
import {
  IconCopy,
  IconDownload,
  IconEdit,
  IconPlus,
  IconRefresh,
  IconTrash,
} from './Icons';

interface ToolServerRow {
  name: string;
  transport?: string;
  url?: string;
  command?: string;
  args?: string[];
}

export function BotToolsSubpage({ bot }: SubpageProps) {
  const { locale } = useBotsLocale();
  const zh = locale === 'zh-CN';
  const [servers, setServers] = useState<ToolServerRow[]>([]);
  const [pasteInput, setPasteInput] = useState('');
  const [manualMode, setManualMode] = useState<'http' | 'stdio'>('http');
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [command, setCommand] = useState('');
  const [argsText, setArgsText] = useState('');
  const [editingName, setEditingName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await callBotRpc<{ servers?: ToolServerRow[] }>(RPC_METHODS.TOOLS_LIST, { botId: bot.id });
      setServers(Array.isArray(res?.servers) ? res.servers : []);
    } catch (err) {
      botsStore.pushToast({ message: err instanceof Error ? err.message : String(err), tone: 'error' });
    }
  }, [bot.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleQuickPaste = async () => {
    setError(null);
    try {
      const parsed = parseBotToolPaste(pasteInput) as ToolServerRow;
      await callBotRpc(RPC_METHODS.TOOLS_ADD, { botId: bot.id, server: parsed });
      setPasteInput('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleSaveManual = async () => {
    setError(null);
    const server: ToolServerRow = manualMode === 'http'
      ? { name: name.trim(), transport: 'http', url: url.trim() }
      : { name: name.trim(), command: command.trim(), args: argsText.trim() ? argsText.trim().split(/\s+/) : [] };
    const checked = validateBotToolServer(server);
    if (!checked.ok) {
      setError(checked.reason || 'Invalid tool server');
      return;
    }
    try {
      if (editingName) {
        await callBotRpc(RPC_METHODS.TOOLS_UPDATE, { botId: bot.id, name: editingName, patch: server });
      } else {
        await callBotRpc(RPC_METHODS.TOOLS_ADD, { botId: bot.id, server });
      }
      setEditingName(null);
      setName('');
      setUrl('');
      setCommand('');
      setArgsText('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="dsh-bots-psection">
      <div className="dsh-bots-pcard" style={{ gap: 7 }}>
        <div style={{ fontWeight: 600 }}>{zh ? '快速粘贴 MCP 地址或启动命令' : 'Quick paste MCP URL or command'}</div>
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            type="text"
            className="dsh-bots-pinput"
            placeholder="https://mcp.example.com  /  npx -y @org/mcp-server"
            value={pasteInput}
            onChange={(e) => setPasteInput(e.target.value)}
          />
          <button
            type="button"
            className="dsh-bots-pbtn dsh-bots-pbtn-primary"
            disabled={!pasteInput.trim()}
            onClick={() => void handleQuickPaste()}
          >
            {zh ? '解析添加' : 'Add'}
          </button>
        </div>
      </div>

      <div className="dsh-bots-pcard" style={{ gap: 7 }}>
        <div className="dsh-bots-row">
          <span style={{ fontWeight: 600 }}>
            {editingName ? (zh ? `编辑 MCP：${editingName}` : `Edit MCP: ${editingName}`) : (zh ? '手动添加 Per-Bot MCP 工具' : 'Manual MCP server')}
          </span>
          <div className="dsh-bots-picker-seg">
            <button
              type="button"
              className="dsh-bots-picker-seg-btn"
              aria-pressed={manualMode === 'http'}
              onClick={() => setManualMode('http')}
            >
              HTTP
            </button>
            <button
              type="button"
              className="dsh-bots-picker-seg-btn"
              aria-pressed={manualMode === 'stdio'}
              onClick={() => setManualMode('stdio')}
            >
              Stdio
            </button>
          </div>
        </div>
        <input
          type="text"
          className="dsh-bots-pinput"
          placeholder={zh ? '服务名称（字母/数字/-/_）' : 'Server name'}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        {manualMode === 'http' ? (
          <input
            type="text"
            className="dsh-bots-pinput"
            placeholder="https://mcp.example.com/sse"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        ) : (
          <>
            <input
              type="text"
              className="dsh-bots-pinput"
              placeholder={zh ? '可执行程序（如 npx / node）' : 'Executable (e.g. npx)'}
              value={command}
              onChange={(e) => setCommand(e.target.value)}
            />
            <input
              type="text"
              className="dsh-bots-pinput"
              placeholder={zh ? '启动参数（空格分隔）' : 'Arguments (space-separated)'}
              value={argsText}
              onChange={(e) => setArgsText(e.target.value)}
            />
          </>
        )}
        {error && <div className="dsh-bots-error-text">{error}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
          {editingName && (
            <button
              type="button"
              className="dsh-bots-pbtn dsh-bots-pbtn-xs"
              onClick={() => {
                setEditingName(null);
                setName('');
                setUrl('');
                setCommand('');
                setArgsText('');
              }}
            >
              {zh ? '取消编辑' : 'Cancel'}
            </button>
          )}
          <button
            type="button"
            className="dsh-bots-pbtn dsh-bots-pbtn-xs dsh-bots-pbtn-primary"
            disabled={!name.trim()}
            onClick={() => void handleSaveManual()}
          >
            {editingName ? (zh ? '更新工具' : 'Update') : (zh ? '保存工具' : 'Save tool')}
          </button>
        </div>
      </div>

      {servers.length === 0 ? (
        <div className="dsh-bots-empty">{zh ? '该队友尚未配置专属 MCP 工具。' : 'No per-bot MCP tools configured.'}</div>
      ) : (
        servers.map((srv) => (
          <div key={srv.name} className="dsh-bots-settings-row">
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600 }}>{srv.name}</div>
              <div className="dsh-bots-muted dsh-bots-ellipsis" style={{ fontFamily: 'var(--ds-font-family-code)' }}>
                {botToolDetail(srv)}
              </div>
            </div>
            <div style={{ display: 'inline-flex', gap: 3 }}>
              <button
                type="button"
                className="dsh-bots-pbtn dsh-bots-pbtn-xs dsh-bots-pbtn-icon"
                onClick={() => {
                  setEditingName(srv.name);
                  setName(srv.name);
                  if (srv.url) {
                    setManualMode('http');
                    setUrl(srv.url);
                  } else {
                    setManualMode('stdio');
                    setCommand(srv.command ?? '');
                    setArgsText((srv.args ?? []).join(' '));
                  }
                }}
              >
                <IconEdit size={11} />
              </button>
              <button
                type="button"
                className="dsh-bots-pbtn dsh-bots-pbtn-xs dsh-bots-pbtn-icon dsh-bots-pbtn-danger"
                onClick={async () => {
                  await callBotRpc(RPC_METHODS.TOOLS_REMOVE, { botId: bot.id, name: srv.name });
                  void load();
                }}
              >
                <IconTrash size={11} />
              </button>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

interface SkillProjectInfo {
  path: string;
  name: string;
  skills: string[];
}

export function BotSkillsSubpage({ bot }: SubpageProps) {
  const { locale } = useBotsLocale();
  const zh = locale === 'zh-CN';
  const linked = ((bot as BotRecord & { skillProjects?: string[] }).skillProjects ?? []);
  const [scanned, setScanned] = useState<SkillProjectInfo[]>([]);
  const [scanning, setScanning] = useState(false);
  const [customDir, setCustomDir] = useState('');

  const scan = useCallback(async () => {
    setScanning(true);
    try {
      const res = await callBotRpc<SkillProjectInfo[] | { projects?: SkillProjectInfo[] }>(
        RPC_METHODS.SKILL_PROJECTS_SCAN,
        { botId: bot.id },
      );
      setScanned(Array.isArray(res) ? res : (res?.projects ?? []));
    } catch (err) {
      botsStore.pushToast({ message: err instanceof Error ? err.message : String(err), tone: 'error' });
    } finally {
      setScanning(false);
    }
  }, [bot.id]);

  useEffect(() => {
    void scan();
  }, [scan]);

  const toggleProject = async (projectPath: string) => {
    const exists = linked.includes(projectPath);
    if (!exists && linked.length >= BOT_LIMITS.maxSkillProjects) {
      botsStore.pushToast({
        message: zh ? `最多关联 ${BOT_LIMITS.maxSkillProjects} 个技能目录` : `Max ${BOT_LIMITS.maxSkillProjects} skill projects`,
        tone: 'error',
      });
      return;
    }
    const next = exists ? linked.filter((p) => p !== projectPath) : [...linked, projectPath];
    await botsStore.updateBot(bot.id, { skillProjects: next } as Partial<BotRecord>);
  };

  return (
    <div className="dsh-bots-psection">
      <div className="dsh-bots-row">
        <span className="dsh-bots-muted">
          {zh ? `已关联工作区技能目录：${linked.length} / ${BOT_LIMITS.maxSkillProjects}` : `Linked skill projects: ${linked.length} / ${BOT_LIMITS.maxSkillProjects}`}
        </span>
        <button type="button" className="dsh-bots-pbtn dsh-bots-pbtn-xs" disabled={scanning} onClick={() => void scan()}>
          <IconRefresh size={11} />
          <span>{scanning ? (zh ? '扫描中…' : 'Scanning…') : (zh ? '重新扫描' : 'Rescan')}</span>
        </button>
      </div>

      <div className="dsh-bots-row">
        <input
          type="text"
          className="dsh-bots-pinput"
          placeholder={zh ? '手动输入包含 SKILL.md 的目录路径…' : 'Add a folder path containing SKILL.md…'}
          value={customDir}
          onChange={(e) => setCustomDir(e.target.value)}
        />
        <button
          type="button"
          className="dsh-bots-pbtn dsh-bots-pbtn-primary"
          disabled={!customDir.trim()}
          onClick={() => {
            const dir = customDir.trim();
            setCustomDir('');
            if (!linked.includes(dir)) {
              void toggleProject(dir);
            }
          }}
        >
          <IconPlus size={12} />
        </button>
      </div>

      {scanned.map((proj) => {
        const isLinked = linked.includes(proj.path);
        return (
          <div key={proj.path} className="dsh-bots-settings-row">
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600 }}>{proj.name}</div>
              <div className="dsh-bots-muted dsh-bots-ellipsis">{proj.skills.join(', ')}</div>
              <div className="dsh-bots-muted dsh-bots-ellipsis" style={{ fontFamily: 'var(--ds-font-family-code)', fontSize: 11 }}>
                {proj.path}
              </div>
            </div>
            <button
              type="button"
              role="switch"
              className="dsh-bots-switch"
              aria-checked={isLinked}
              onClick={() => void toggleProject(proj.path)}
            >
              <span className="dsh-bots-switch-thumb" />
            </button>
          </div>
        );
      })}

      {linked
        .filter((p) => !scanned.some((s) => s.path === p))
        .map((pathStr) => (
          <div key={pathStr} className="dsh-bots-settings-row">
            <span className="dsh-bots-ellipsis" style={{ fontFamily: 'var(--ds-font-family-code)', fontSize: 12 }}>{pathStr}</span>
            <button
              type="button"
              className="dsh-bots-pbtn dsh-bots-pbtn-xs dsh-bots-pbtn-danger"
              onClick={() => void toggleProject(pathStr)}
            >
              {zh ? '移除' : 'Remove'}
            </button>
          </div>
        ))}
    </div>
  );
}

export function BotSharingSubpage({ bot }: SubpageProps) {
  const { locale } = useBotsLocale();
  const zh = locale === 'zh-CN';
  const [includeSkills, setIncludeSkills] = useState(true);
  const [includeTopics, setIncludeTopics] = useState(false);
  const [exportedJson, setExportedJson] = useState('');
  const [redactedCount, setRedactedCount] = useState(0);
  const [importJson, setImportJson] = useState('');
  const [reviewResult, setReviewResult] = useState<{ manifest?: Record<string, unknown>; warnings?: string[] } | null>(null);
  const [busy, setBusy] = useState(false);

  const exportPkg = async () => {
    setBusy(true);
    try {
      const res = await callBotRpc<{ packageJson?: string; manifest?: unknown; files?: unknown; redactedCount?: number; redactions?: number }>(
        RPC_METHODS.SHARE_PREPARE,
        { botId: bot.id, includeSkills, includeMemoryTopics: includeTopics },
      );
      const jsonText = res?.packageJson ?? JSON.stringify(res, null, 2);
      setExportedJson(jsonText);
      setRedactedCount(res?.redactedCount ?? res?.redactions ?? 0);
    } catch (err) {
      botsStore.pushToast({ message: err instanceof Error ? err.message : String(err), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const reviewImport = async () => {
    setBusy(true);
    try {
      const parsed = JSON.parse(importJson);
      const res = await callBotRpc<{ manifest?: Record<string, unknown>; warnings?: string[] }>('bots.share.review', {
        packageData: parsed,
        packageJson: importJson,
      });
      setReviewResult(res);
    } catch (err) {
      botsStore.pushToast({ message: err instanceof Error ? err.message : String(err), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const confirmImport = async () => {
    setBusy(true);
    try {
      const parsed = JSON.parse(importJson);
      await botsStore.createBot({ fromPackage: parsed });
      setImportJson('');
      setReviewResult(null);
      botsStore.pushToast({ message: zh ? '已从分享包创建机器人' : 'Bot created from package', tone: 'success' });
    } catch (err) {
      botsStore.pushToast({ message: err instanceof Error ? err.message : String(err), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dsh-bots-psection">
      <div className="dsh-bots-pcard" style={{ gap: 8 }}>
        <div style={{ fontWeight: 600 }}>{zh ? '导出分享包 (BotPackageV1)' : 'Export share package'}</div>
        <div className="dsh-bots-muted">
          {zh ? '自动剥离隐私记忆与密钥凭证，仅导出灵魂、技能与公开配置。' : 'Automatically strips private memory and credentials.'}
        </div>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={includeSkills} onChange={(e) => setIncludeSkills(e.target.checked)} />
          <span>{zh ? '包含机器人技能 (skills/)' : 'Include skills/'}</span>
        </label>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={includeTopics} onChange={(e) => setIncludeTopics(e.target.checked)} />
          <span>{zh ? '包含主题知识文件 (memory/*.md)' : 'Include memory topic files'}</span>
        </label>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            type="button"
            className="dsh-bots-pbtn dsh-bots-pbtn-xs dsh-bots-pbtn-primary"
            disabled={busy}
            onClick={() => void exportPkg()}
          >
            <IconDownload size={11} />
            <span>{zh ? '生成分享包 JSON' : 'Generate package JSON'}</span>
          </button>
          {exportedJson && (
            <button
              type="button"
              className="dsh-bots-pbtn dsh-bots-pbtn-xs"
              onClick={() => {
                void botsStore.copyToClipboard(exportedJson).then((ok) => {
                  botsStore.pushToast({ message: ok ? (zh ? '已复制分享包 JSON' : 'Copied JSON') : 'Copy failed', tone: ok ? 'success' : 'error' });
                });
              }}
            >
              <IconCopy size={11} />
              <span>{zh ? '复制 JSON' : 'Copy JSON'}</span>
            </button>
          )}
        </div>
        {exportedJson && (
          <>
            {redactedCount > 0 && (
              <span className="dsh-bots-badge dsh-bots-badge-warn">
                {zh ? `已自动脱敏 ${redactedCount} 处敏感文本` : `Redacted ${redactedCount} secret lines`}
              </span>
            )}
            <textarea className="dsh-bots-ptextarea dsh-bots-ptextarea-mono" rows={6} readOnly value={exportedJson} />
          </>
        )}
      </div>

      <div className="dsh-bots-pcard" style={{ gap: 8 }}>
        <div style={{ fontWeight: 600 }}>{zh ? '导入审核外部机器人包' : 'Review & import package'}</div>
        <textarea
          className="dsh-bots-ptextarea dsh-bots-ptextarea-mono"
          rows={4}
          placeholder={zh ? '粘贴 BotPackageV1 JSON 内容…' : 'Paste BotPackageV1 JSON…'}
          value={importJson}
          onChange={(e) => {
            setImportJson(e.target.value);
            setReviewResult(null);
          }}
        />
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            type="button"
            className="dsh-bots-pbtn dsh-bots-pbtn-xs"
            disabled={!importJson.trim() || busy}
            onClick={() => void reviewImport()}
          >
            {zh ? '校验并预览' : 'Review package'}
          </button>
          {reviewResult && (
            <button
              type="button"
              className="dsh-bots-pbtn dsh-bots-pbtn-xs dsh-bots-pbtn-primary"
              disabled={busy}
              onClick={() => void confirmImport()}
            >
              {zh ? '确认导入并创建' : 'Confirm import'}
            </button>
          )}
        </div>
        {reviewResult?.manifest && (
          <div className="dsh-bots-muted">
            {zh ? '已通过校验：' : 'Validated: '}
            <strong>{String(reviewResult.manifest.name ?? '')}</strong>
            {reviewResult.manifest.purpose ? ` — ${String(reviewResult.manifest.purpose)}` : ''}
          </div>
        )}
      </div>
    </div>
  );
}
