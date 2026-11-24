// Bot Settings Drill-down Subpages A (6 of 12):
// 1. agent (model & reasoning effort)
// 2. permissions (starting permission mode)
// 3. computer (host & Home folder path + copy)
// 4. look-around (toggle, cadence, weekdaysOnly, focus, look now)
// 5. tidy-up (toggle, cadence, status, tidy now, undo)
// 6. soul (SOUL.md read/edit dual mode, auto-save on blur & close, changed-on-disk leave guard)

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  LOOK_AROUND_EVERY_CHOICES,
  LOOK_AROUND_EVERY_LABELS,
  LOOK_AROUND_FOCUS_MAX_LENGTH,
  botLookAround,
  nextLookAroundAt,
} from '../../shared/bot-look-around.js';
import { TIDY_UP_HOURS, botTidyUp } from '../../shared/bot-tidy-up.js';
import { botsStore, useBotsLocale, useBotsState } from '../store/bots-store';
import {
  BotRpcError,
  RPC_METHODS,
  callBotRpc,
  type BotRecord,
} from '../store/rpc';
import {
  IconAlertTriangle,
  IconCheck,
  IconCopy,
  IconEdit,
  IconEye,
  IconRefresh,
  IconUndo,
} from './Icons';

export type BotSettingsLeaveGuard = () => Promise<boolean> | boolean;

export interface SubpageProps {
  bot: BotRecord;
  onRegisterLeaveGuard?: (guard: BotSettingsLeaveGuard | null) => void;
}

const unsavedSoulBots = new Set<string>();
const SOUL_DRAFT_SESSION_PREFIX = 'dsh-bots.unsavedSoul:';

export function hasUnsavedSoulDraft(botId: string): boolean {
  if (unsavedSoulBots.has(botId)) {
    return true;
  }
  if (typeof window !== 'undefined' && window.sessionStorage) {
    try {
      return window.sessionStorage.getItem(`${SOUL_DRAFT_SESSION_PREFIX}${botId}`) === '1';
    } catch {
      return false;
    }
  }
  return false;
}

export function clearUnsavedSoulDraftFlag(botId: string): void {
  unsavedSoulBots.delete(botId);
  if (typeof window !== 'undefined' && window.sessionStorage) {
    try {
      window.sessionStorage.removeItem(`${SOUL_DRAFT_SESSION_PREFIX}${botId}`);
    } catch {
      // Ignore storage failures.
    }
  }
}

function setUnsavedSoulDraftFlag(botId: string, dirty: boolean): void {
  if (dirty) {
    unsavedSoulBots.add(botId);
  } else {
    unsavedSoulBots.delete(botId);
  }
  if (typeof window !== 'undefined' && window.sessionStorage) {
    try {
      const key = `${SOUL_DRAFT_SESSION_PREFIX}${botId}`;
      if (dirty) window.sessionStorage.setItem(key, '1');
      else window.sessionStorage.removeItem(key);
    } catch {
      // Ignore storage failures.
    }
  }
}

type ExtendedBot = BotRecord & {
  launch?: { provider?: string; model?: string; reasoningEffort?: string };
  permissionMode?: string;
};

const LOOK_LABELS_ZH: Record<string, string> = {
  'every-4h': '每 4 小时（8:00–20:00）',
  'every-2h': '每 2 小时（8:00–20:00）',
  'twice-daily': '每天两次（8:00 和 13:00）',
  mornings: '每天早晨 8:00',
};

const PERMISSION_MODES = [
  { id: '', zhTitle: '与普通聊天相同', enTitle: 'Same as ordinary chat', zhDesc: '继承 WhaleIsle 默认权限策略。', enDesc: 'Inherits the default WhaleIsle permission policy.' },
  { id: 'read-only', zhTitle: '只读模式', enTitle: 'Read-only', zhDesc: '仅允许读取文件与查询，不修改磁盘或执行命令。', enDesc: 'Read files and inspect context without writing.' },
  { id: 'workspace-write', zhTitle: '工作区可写', enTitle: 'Workspace write', zhDesc: '允许在工作区和队友 Home 目录内读写。', enDesc: 'Allow edits inside workspace and bot home directory.' },
  { id: 'auto-review', zhTitle: '自动审批（高危确认）', enTitle: 'Auto review', zhDesc: '常规操作放行，高危操作弹出确认。', enDesc: 'Routine actions proceed; high-risk tools require confirmation.' },
  { id: 'full-access', zhTitle: '完全权限', enTitle: 'Full access', zhDesc: '允许该队友直接调用所有已授权工具。', enDesc: 'Permit all authorized tools without extra prompts.' },
];

export function BotAgentSubpage({ bot }: SubpageProps) {
  const { locale, tr } = useBotsLocale();
  const zh = locale === 'zh-CN';
  const models = useBotsState((state) => state.models);
  const ext = bot as ExtendedBot;

  useEffect(() => {
    if (models.length === 0) {
      void botsStore.refreshModels();
    }
  }, [models.length]);

  const currentModelValue = ext.launch?.provider && ext.launch?.model
    ? `${ext.launch.provider}/${ext.launch.model}`
    : (ext.launch?.model || ext.model || '');
  const currentEffort = ext.launch?.reasoningEffort || ext.reasoningEffort || '';

  const saveLaunch = async (modelVal: string, effortVal: string) => {
    const slash = modelVal.indexOf('/');
    const launch = modelVal
      ? (slash > 0
        ? { provider: modelVal.slice(0, slash), model: modelVal.slice(slash + 1), ...(effortVal ? { reasoningEffort: effortVal } : {}) }
        : { model: modelVal, ...(effortVal ? { reasoningEffort: effortVal } : {}) })
      : { ...(effortVal ? { reasoningEffort: effortVal } : {}) };
    await botsStore.updateBot(bot.id, {
      launch,
      model: modelVal || null,
      reasoningEffort: effortVal || null,
    } as Partial<BotRecord>);
    botsStore.pushToast({ message: zh ? '已更新模型配置' : 'Model settings saved', tone: 'success' });
  };

  const runtimeName = !bot.agent || bot.agent === 'deepseek-harness'
    ? tr('bots.runtime.local', zh ? '鲸屿内核' : 'WhaleIsle Core')
    : bot.agent;

  return (
    <div className="dsh-bots-psection">
      <div className="dsh-bots-pcard">
        <div style={{ fontWeight: 600 }}>{zh ? '底层智能体' : 'Agent runtime'}</div>
        <div className="dsh-bots-muted">{runtimeName}</div>
      </div>

      <div className="dsh-bots-pcard" style={{ gap: 8 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <span style={{ fontWeight: 500 }}>{zh ? '默认模型' : 'Default model'}</span>
          <select
            className="dsh-bots-pselect"
            value={currentModelValue}
            onChange={(e) => void saveLaunch(e.target.value, currentEffort)}
          >
            <option value="">{zh ? '跟随会话默认模型' : 'Follow session default'}</option>
            {models.map((m) => {
              const val = m.provider && !m.id.includes('/') ? `${m.provider}/${m.id}` : m.id;
              return <option key={val} value={val}>{m.label || val}</option>;
            })}
          </select>
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <span style={{ fontWeight: 500 }}>{zh ? '推理强度' : 'Reasoning effort'}</span>
          <select
            className="dsh-bots-pselect"
            value={currentEffort}
            onChange={(e) => void saveLaunch(currentModelValue, e.target.value)}
          >
            <option value="">{zh ? '默认' : 'Default'}</option>
            <option value="low">{zh ? '低 (low)' : 'Low'}</option>
            <option value="medium">{zh ? '中 (medium)' : 'Medium'}</option>
            <option value="high">{zh ? '高 (high)' : 'High'}</option>
          </select>
        </label>

        <div className="dsh-bots-muted">
          {zh
            ? '切换模型将立即同步到该队友的主对话与后续新建的支线聊天。'
            : 'Model changes apply to this bot’s Home Chat and new side chats.'}
        </div>
      </div>
    </div>
  );
}

export function BotPermissionsSubpage({ bot }: SubpageProps) {
  const { locale } = useBotsLocale();
  const zh = locale === 'zh-CN';
  const currentMode = (bot as ExtendedBot).permissionMode ?? '';

  return (
    <div className="dsh-bots-psection">
      <div className="dsh-bots-muted">
        {zh ? '配置该队友会话启动时的默认权限等级：' : 'Choose the starting permission mode for this bot:'}
      </div>
      {PERMISSION_MODES.map((opt) => {
        const active = currentMode === opt.id;
        return (
          <button
            key={opt.id || 'default'}
            type="button"
            className="dsh-bots-ask-option"
            data-selected={active ? 'true' : 'false'}
            onClick={() => void botsStore.updateBot(bot.id, { permissionMode: opt.id || null } as Partial<BotRecord>)}
          >
            <input type="radio" readOnly checked={active} style={{ marginTop: 2 }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600 }}>{zh ? opt.zhTitle : opt.enTitle}</div>
              <div className="dsh-bots-muted">{zh ? opt.zhDesc : opt.enDesc}</div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

export function BotComputerSubpage({ bot }: SubpageProps) {
  const { locale, tr } = useBotsLocale();
  const zh = locale === 'zh-CN';
  const homePath = bot.homePath || '';

  return (
    <div className="dsh-bots-psection">
      <div className="dsh-bots-pcard">
        <div className="dsh-bots-row">
          <span style={{ fontWeight: 500 }}>{zh ? '运行主机' : 'Host computer'}</span>
          <span className="dsh-bots-badge">{bot.hostName || (zh ? '本机 (Local)' : 'Local')}</span>
        </div>
      </div>

      <div className="dsh-bots-pcard" style={{ gap: 8 }}>
        <div className="dsh-bots-row">
          <span style={{ fontWeight: 500 }}>{zh ? '队友 Home 目录' : 'Bot home folder'}</span>
          <button
            type="button"
            className="dsh-bots-pbtn dsh-bots-pbtn-xs"
            disabled={!homePath}
            onClick={() => {
              void botsStore.copyToClipboard(homePath).then((ok) => {
                botsStore.pushToast({
                  message: ok ? (zh ? '已复制目录路径' : 'Path copied') : (zh ? '复制失败' : 'Copy failed'),
                  tone: ok ? 'success' : 'error',
                });
              });
            }}
          >
            <IconCopy size={11} />
            <span>{tr('bots.row.copyPath', 'Copy Path')}</span>
          </button>
        </div>
        <div
          className="dsh-bots-muted"
          style={{ fontFamily: 'var(--ds-font-family-code)', wordBreak: 'break-all', fontSize: 12 }}
        >
          {homePath || '—'}
        </div>
        <div className="dsh-bots-muted">
          {zh
            ? 'SOUL.md、MEMORY.md、memory/ 主题文件、skills/ 与 bot.json 均存储在此目录中；移除队友时默认保留此目录。'
            : 'Stores SOUL.md, MEMORY.md, memory/ topic files, skills/, and bot.json. Preserved when deleting the bot.'}
        </div>
      </div>
    </div>
  );
}

interface LookNowRpcResult {
  ok?: boolean;
  started?: boolean;
  background?: boolean;
  alreadyRunning?: boolean;
  skipped?: boolean;
  reason?: string;
  summary?: string;
  error?: string;
}

function formatLookNowFailure(res: LookNowRpcResult, zh: boolean): string {
  if (res.reason === 'budget_exceeded') {
    return zh ? '巡视跳过：超出预算限制' : 'Look around skipped: budget_exceeded';
  }
  const detail = res.summary || res.error || res.reason;
  if (res.skipped) {
    return detail
      ? (zh ? `巡视跳过：${detail}` : `Look around skipped: ${detail}`)
      : (zh ? '巡视已跳过' : 'Look around skipped');
  }
  return detail
    ? (zh ? `巡视失败：${detail}` : `Look around failed: ${detail}`)
    : (zh ? '巡视失败' : 'Look around failed');
}

export function BotLookAroundSubpage({ bot }: SubpageProps) {
  const { locale, tr } = useBotsLocale();
  const zh = locale === 'zh-CN';
  const cfg = botLookAround(bot);
  const [focusDraft, setFocusDraft] = useState(cfg.focus ?? '');
  const [running, setRunning] = useState(false);

  useEffect(() => {
    setFocusDraft(cfg.focus ?? '');
  }, [cfg.focus]);

  const patchLook = async (patch: Record<string, unknown>) => {
    await callBotRpc(RPC_METHODS.LOOK_AROUND_SET, { botId: bot.id, ...patch });
    await botsStore.refresh();
  };

  const nextTs = bot.paused ? null : nextLookAroundAt(cfg, Date.now());

  return (
    <div className="dsh-bots-psection">
      <div className="dsh-bots-settings-row">
        <div>
          <div style={{ fontWeight: 500 }}>{zh ? '启用定期巡视' : 'Enable Look around'}</div>
          <div className="dsh-bots-muted">
            {zh ? '定期只读扫描上下文并提出 Up Next 行动建议。' : 'Periodically scan context and surface Up Next suggestions.'}
          </div>
        </div>
        <button
          type="button"
          role="switch"
          className="dsh-bots-switch"
          aria-checked={cfg.on}
          onClick={() => void patchLook({ on: !cfg.on })}
        >
          <span className="dsh-bots-switch-thumb" />
        </button>
      </div>

      <div className="dsh-bots-pcard" style={{ gap: 8 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <span style={{ fontWeight: 500 }}>{zh ? '巡视周期' : 'Cadence'}</span>
          <select
            className="dsh-bots-pselect"
            disabled={!cfg.on}
            value={cfg.every}
            onChange={(e) => void patchLook({ every: e.target.value })}
          >
            {LOOK_AROUND_EVERY_CHOICES.map((choice) => (
              <option key={choice} value={choice}>
                {zh ? (LOOK_LABELS_ZH[choice] ?? choice) : (LOOK_AROUND_EVERY_LABELS[choice as keyof typeof LOOK_AROUND_EVERY_LABELS] ?? choice)}
              </option>
            ))}
          </select>
        </label>

        <div className="dsh-bots-row">
          <span style={{ fontWeight: 500 }}>{zh ? '仅工作日巡视（周一至周五）' : 'Weekdays only'}</span>
          <button
            type="button"
            role="switch"
            className="dsh-bots-switch"
            aria-checked={cfg.weekdaysOnly}
            disabled={!cfg.on}
            onClick={() => void patchLook({ weekdaysOnly: !cfg.weekdaysOnly })}
          >
            <span className="dsh-bots-switch-thumb" />
          </button>
        </div>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <div className="dsh-bots-row">
            <span style={{ fontWeight: 500 }}>{zh ? '关注重点 (Focus)' : 'Focus instructions'}</span>
            <span className="dsh-bots-muted">{focusDraft.length}/{LOOK_AROUND_FOCUS_MAX_LENGTH}</span>
          </div>
          <textarea
            className="dsh-bots-ptextarea"
            rows={3}
            maxLength={LOOK_AROUND_FOCUS_MAX_LENGTH}
            placeholder={zh ? '告诉机器人巡视时重点检查哪些 PR、任务或风险…' : 'Tell the bot what to watch for…'}
            value={focusDraft}
            onChange={(e) => setFocusDraft(e.target.value)}
            onBlur={() => {
              if (focusDraft !== (cfg.focus ?? '')) {
                void patchLook({ focus: focusDraft });
              }
            }}
          />
        </label>

        <div className="dsh-bots-row">
          <span className="dsh-bots-muted">
            {zh ? '下次巡视：' : 'Next run: '}
            {nextTs ? new Date(nextTs).toLocaleString(locale) : '—'}
          </span>
          <button
            type="button"
            className="dsh-bots-pbtn dsh-bots-pbtn-xs dsh-bots-pbtn-primary"
            disabled={running || bot.paused}
            onClick={async () => {
              setRunning(true);
              try {
                const res = await callBotRpc<LookNowRpcResult | null>(RPC_METHODS.LOOK_AROUND_NOW, {
                  botId: bot.id,
                  background: true,
                });
                if (res && res.ok === false) {
                  botsStore.pushToast({ message: formatLookNowFailure(res, zh), tone: 'error' });
                  return;
                }
                if (res && res.alreadyRunning) {
                  botsStore.pushToast({
                    message: zh ? '巡视正在进行中' : 'Look around is already running',
                    tone: 'info',
                  });
                  return;
                }
                botsStore.pushToast({
                  message: zh ? '已启动立即巡视' : 'Look around sweep started',
                  tone: 'success',
                });
              } catch (err) {
                botsStore.pushToast({ message: err instanceof Error ? err.message : String(err), tone: 'error' });
              } finally {
                setRunning(false);
              }
            }}
          >
            <IconRefresh size={11} />
            <span>{running ? tr('settings.bots.lookAround.looking', 'Looking…') : tr('bots.upNext.lookNow', 'Look now')}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

interface TidyUpStatus {
  config?: { on: boolean; every: 'night' | 'week' };
  nextRunAt?: number | null;
  lastRunAt?: number | null;
  lastStatus?: string | null;
  lastError?: string | null;
  lastChangeId?: string | null;
  lastChangesCount?: number;
}

export function BotTidyUpSubpage({ bot }: SubpageProps) {
  const { locale, tr } = useBotsLocale();
  const zh = locale === 'zh-CN';
  const cfg = botTidyUp(bot);
  const [status, setStatus] = useState<TidyUpStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await callBotRpc<TidyUpStatus>(RPC_METHODS.TIDY_UP_GET, { botId: bot.id });
      setStatus(res);
    } catch (err) {
      console.warn('[dsh-bots] tidyUp.get failed', err);
    }
  }, [bot.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const updateTidy = async (patch: Partial<{ on: boolean; every: 'night' | 'week' }>) => {
    await botsStore.updateBot(bot.id, {
      tidyUp: { ...cfg, ...patch },
    } as Partial<BotRecord>);
    void load();
  };

  const computeNextTidy = (every: 'night' | 'week', on: boolean): number | null => {
    if (!on) {
      return null;
    }
    const d = new Date();
    d.setHours(TIDY_UP_HOURS.from, 0, 0, 0);
    if (d.getTime() <= Date.now()) {
      d.setDate(d.getDate() + 1);
    }
    if (every === 'week') {
      while (d.getDay() !== 0) {
        d.setDate(d.getDate() + 1);
      }
    }
    return d.getTime();
  };

  const nextTs = status?.nextRunAt ?? (bot.paused ? null : computeNextTidy(cfg.every, cfg.on));

  return (
    <div className="dsh-bots-psection">
      <div className="dsh-bots-settings-row">
        <div>
          <div style={{ fontWeight: 500 }}>{zh ? '自动记忆维护 (Tidy up)' : 'Automatic memory tidy-up'}</div>
          <div className="dsh-bots-muted">
            {zh ? '定期精简 MEMORY.md 并归档陈旧事实至 memory/archive.md，绝不编造新条目。' : 'Periodically condense MEMORY.md and archive superseded facts.'}
          </div>
        </div>
        <button
          type="button"
          role="switch"
          className="dsh-bots-switch"
          aria-checked={cfg.on}
          onClick={() => void updateTidy({ on: !cfg.on })}
        >
          <span className="dsh-bots-switch-thumb" />
        </button>
      </div>

      <div className="dsh-bots-pcard" style={{ gap: 8 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <span style={{ fontWeight: 500 }}>{zh ? '整理频率' : 'Frequency'}</span>
          <select
            className="dsh-bots-pselect"
            disabled={!cfg.on}
            value={cfg.every}
            onChange={(e) => void updateTidy({ every: e.target.value as 'night' | 'week' })}
          >
            <option value="night">{zh ? '每晚（凌晨 3:00）' : 'Nightly (3:00 AM)'}</option>
            <option value="week">{zh ? '每周（周日凌晨 3:00）' : 'Weekly (Sunday 3:00 AM)'}</option>
          </select>
        </label>

        <div className="dsh-bots-muted">
          {zh ? '下次计划整理：' : 'Next tidy: '}
          {nextTs ? new Date(nextTs).toLocaleString(locale) : '—'}
        </div>
        {status?.lastRunAt && (
          <div className="dsh-bots-muted">
            {zh ? '上次整理：' : 'Last run: '}
            {new Date(status.lastRunAt).toLocaleString(locale)} · {status.lastStatus || 'ok'}
            {status.lastChangesCount ? ` (${status.lastChangesCount})` : ''}
          </div>
        )}
        {status?.lastError && (
          <div className="dsh-bots-error-text">{status.lastError}</div>
        )}

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="dsh-bots-pbtn dsh-bots-pbtn-xs dsh-bots-pbtn-primary"
            disabled={busy || bot.paused}
            onClick={async () => {
              setBusy(true);
              try {
                await callBotRpc(RPC_METHODS.TIDY_UP_NOW, { botId: bot.id });
                botsStore.pushToast({ message: zh ? '记忆整理已完成' : 'Memory tidied', tone: 'success' });
                await load();
              } catch (err) {
                botsStore.pushToast({ message: err instanceof Error ? err.message : String(err), tone: 'error' });
              } finally {
                setBusy(false);
              }
            }}
          >
            <IconRefresh size={11} />
            <span>{tr('settings.bots.tidyUp.now', 'Tidy now')}</span>
          </button>

          {status?.lastChangeId && (
            <button
              type="button"
              className="dsh-bots-pbtn dsh-bots-pbtn-xs"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await callBotRpc(RPC_METHODS.TIDY_UP_UNDO, {
                    botId: bot.id,
                    changeId: status.lastChangeId,
                  });
                  botsStore.pushToast({ message: zh ? '已撤销上次整理' : 'Reverted last tidy-up', tone: 'success' });
                  await load();
                } catch (err) {
                  botsStore.pushToast({ message: err instanceof Error ? err.message : String(err), tone: 'error' });
                } finally {
                  setBusy(false);
                }
              }}
            >
              <IconUndo size={11} />
              <span>{zh ? '撤销上次整理' : 'Undo last tidy'}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function BotSoulSubpage({ bot, onRegisterLeaveGuard }: SubpageProps) {
  const { locale, tr } = useBotsLocale();
  const zh = locale === 'zh-CN';
  const [mode, setMode] = useState<'read' | 'edit'>('read');
  const [diskText, setDiskText] = useState('');
  const [draft, setDraft] = useState('');
  const [signature, setSignature] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);
  const [conflict, setConflict] = useState<{ diskContent: string; diskSignature?: string } | null>(null);
  const [leaveGuardPending, setLeaveGuardPending] = useState(false);

  const draftRef = useRef(draft);
  const diskTextRef = useRef(diskText);
  const signatureRef = useRef(signature);
  const conflictRef = useRef(conflict);
  const savingRef = useRef(saving);
  const leaveResolverRef = useRef<((allowLeave: boolean) => void) | null>(null);

  draftRef.current = draft;
  diskTextRef.current = diskText;
  signatureRef.current = signature;
  conflictRef.current = conflict;
  savingRef.current = saving;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await callBotRpc<{ content?: string; signature?: string }>(RPC_METHODS.SOUL_READ, {
        botId: bot.id,
      });
      const text = typeof res?.content === 'string' ? res.content : '';
      setDiskText(text);
      setDraft(text);
      setSignature(res?.signature);
      setConflict(null);
      setUnsavedSoulDraftFlag(bot.id, false);
    } catch (err) {
      botsStore.pushToast({ message: err instanceof Error ? err.message : String(err), tone: 'error' });
    } finally {
      setLoading(false);
    }
  }, [bot.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const dirty = draft !== diskText;
  const lineCount = draft ? draft.split(/\r?\n/).length : 0;

  // Keep global unsaved-soul flag in sync so DeleteBotConfirmDialog can guard against data loss.
  useEffect(() => {
    setUnsavedSoulDraftFlag(bot.id, dirty || Boolean(conflict));
  }, [bot.id, conflict, dirty]);

  const saveSoul = useCallback(async (forceSignature?: string | null): Promise<'saved' | 'conflict' | 'error'> => {
    const contentToSave = draftRef.current;
    if (savingRef.current) {
      return 'saved';
    }
    setSaving(true);
    setSavedNotice(false);
    try {
      const res = await callBotRpc<{ content?: string; signature?: string }>(RPC_METHODS.SOUL_WRITE, {
        botId: bot.id,
        content: contentToSave,
        ...(forceSignature === null ? {} : { expectedSignature: forceSignature ?? signatureRef.current }),
      });
      const persisted = res?.content ?? contentToSave;
      setDiskText(persisted);
      setDraft(persisted);
      setSignature(res?.signature);
      setConflict(null);
      setSavedNotice(true);
      setUnsavedSoulDraftFlag(bot.id, false);
      void botsStore.refresh();
      return 'saved';
    } catch (err) {
      if (err instanceof BotRpcError && err.code === 'changed-on-disk') {
        const details = (err.details ?? {}) as { diskContent?: string; diskSignature?: string };
        setConflict({
          diskContent: details.diskContent ?? diskTextRef.current,
          diskSignature: details.diskSignature,
        });
        setMode('edit');
        return 'conflict';
      }
      botsStore.pushToast({ message: err instanceof Error ? err.message : String(err), tone: 'error' });
      return 'error';
    } finally {
      setSaving(false);
    }
  }, [bot.id]);

  // Register leave guard with BotSettingsView: auto-save on leave, block & prompt on disk conflict.
  useEffect(() => {
    if (!onRegisterLeaveGuard) {
      return undefined;
    }
    const guard: BotSettingsLeaveGuard = async () => {
      if (conflictRef.current) {
        setLeaveGuardPending(true);
        return new Promise<boolean>((resolve) => {
          leaveResolverRef.current = resolve;
        });
      }
      if (draftRef.current !== diskTextRef.current) {
        const outcome = await saveSoul();
        if (outcome === 'saved') {
          return true;
        }
        if (outcome === 'conflict') {
          setLeaveGuardPending(true);
          return new Promise<boolean>((resolve) => {
            leaveResolverRef.current = resolve;
          });
        }
        return false;
      }
      return true;
    };
    onRegisterLeaveGuard(guard);
    return () => {
      onRegisterLeaveGuard(null);
      if (leaveResolverRef.current) {
        leaveResolverRef.current(false);
        leaveResolverRef.current = null;
      }
    };
  }, [onRegisterLeaveGuard, saveSoul]);

  // Auto-save on component unmount (e.g. closing settings drawer) if dirty without disk conflict.
  useEffect(() => () => {
    if (draftRef.current !== diskTextRef.current && !conflictRef.current) {
      void callBotRpc(RPC_METHODS.SOUL_WRITE, {
        botId: bot.id,
        content: draftRef.current,
        ...(signatureRef.current ? { expectedSignature: signatureRef.current } : {}),
      }).then(() => {
        setUnsavedSoulDraftFlag(bot.id, false);
        void botsStore.refresh();
      }).catch(() => {
        // Keep unsaved flag set if unmount save failed (e.g. disk conflict).
      });
    }
  }, [bot.id]);

  const resolvePendingLeave = (allow: boolean) => {
    setLeaveGuardPending(false);
    const resolver = leaveResolverRef.current;
    leaveResolverRef.current = null;
    resolver?.(allow);
  };

  const handleKeepMine = async () => {
    if (!conflict) return;
    const outcome = await saveSoul(conflict.diskSignature ?? null);
    if (outcome === 'saved' && leaveGuardPending) {
      resolvePendingLeave(true);
    }
  };

  const handleUseDisk = () => {
    if (!conflict) return;
    setDiskText(conflict.diskContent);
    setDraft(conflict.diskContent);
    setSignature(conflict.diskSignature);
    setConflict(null);
    setUnsavedSoulDraftFlag(bot.id, false);
    if (leaveGuardPending) {
      resolvePendingLeave(true);
    }
  };

  const handleSwitchMode = async (nextMode: 'read' | 'edit') => {
    if (nextMode === 'read' && mode === 'edit' && dirty && !conflict) {
      const outcome = await saveSoul();
      if (outcome !== 'saved') {
        return;
      }
    }
    setMode(nextMode);
  };

  return (
    <div className="dsh-bots-psection">
      <div className="dsh-bots-row">
        <div className="dsh-bots-picker-seg">
          <button
            type="button"
            className="dsh-bots-picker-seg-btn"
            aria-pressed={mode === 'read'}
            onClick={() => void handleSwitchMode('read')}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
          >
            <IconEye size={12} />
            <span>{tr('settings.bots.soulRead', 'Read')}</span>
          </button>
          <button
            type="button"
            className="dsh-bots-picker-seg-btn"
            aria-pressed={mode === 'edit'}
            onClick={() => void handleSwitchMode('edit')}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
          >
            <IconEdit size={12} />
            <span>{tr('settings.bots.soulEdit', 'Edit')}</span>
          </button>
        </div>

        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span className="dsh-bots-muted">
            {draft.length} {zh ? '字' : 'chars'} · {lineCount} {zh ? '行' : 'lines'}
          </span>
          {saving && (
            <span className="dsh-bots-badge">{tr('settings.bots.saving', zh ? '保存中…' : 'Saving…')}</span>
          )}
          {!saving && dirty && (
            <span className="dsh-bots-badge dsh-bots-badge-warn">{tr('settings.bots.unsaved', 'Unsaved')}</span>
          )}
          {!saving && !dirty && savedNotice && (
            <span className="dsh-bots-badge dsh-bots-badge-success">
              <IconCheck size={10} /> {tr('settings.bots.saved', 'Saved')}
            </span>
          )}
          {mode === 'edit' && (
            <button
              type="button"
              className="dsh-bots-pbtn dsh-bots-pbtn-xs dsh-bots-pbtn-primary"
              disabled={!dirty || saving}
              onClick={() => void saveSoul()}
            >
              {saving ? tr('settings.bots.saving', 'Saving…') : (zh ? '保存' : 'Save')}
            </button>
          )}
        </div>
      </div>

      {conflict && (
        <div
          className="dsh-bots-pcard dsh-bots-pcard-warn dsh-bots-soul-conflict"
          role="alertdialog"
          aria-label={zh ? 'SOUL.md 磁盘冲突' : 'SOUL.md disk conflict'}
        >
          <div className="dsh-bots-row-left" style={{ fontWeight: 600 }}>
            <IconAlertTriangle size={14} className="dsh-bots-text-warn" />
            <span>
              {leaveGuardPending
                ? (zh ? '离开前请先处理 SOUL.md 磁盘冲突' : 'Resolve SOUL.md conflict before leaving')
                : tr('settings.bots.soulConflict', 'SOUL.md changed on disk.')}
            </span>
          </div>
          <div className="dsh-bots-muted">
            {zh
              ? '在你编辑期间磁盘上的 SOUL.md 已被外部修改，自动保存已暂停。请选择要保留的版本：'
              : 'SOUL.md was modified on disk while you were editing. Choose which version to keep:'}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            <button
              type="button"
              className="dsh-bots-pbtn dsh-bots-pbtn-xs dsh-bots-pbtn-primary"
              disabled={saving}
              onClick={() => void handleKeepMine()}
            >
              {leaveGuardPending
                ? (zh ? '保留我的修改并离开' : 'Keep mine & leave')
                : (zh ? '保留我的修改（覆盖）' : 'Keep mine')}
            </button>
            <button
              type="button"
              className="dsh-bots-pbtn dsh-bots-pbtn-xs"
              disabled={saving}
              onClick={handleUseDisk}
            >
              {leaveGuardPending
                ? (zh ? '采用磁盘版本并离开' : 'Use disk version & leave')
                : (zh ? '采用磁盘版本' : 'Use disk version')}
            </button>
            {leaveGuardPending && (
              <button
                type="button"
                className="dsh-bots-pbtn dsh-bots-pbtn-xs dsh-bots-pbtn-ghost"
                onClick={() => resolvePendingLeave(false)}
              >
                {zh ? '留在此页' : 'Stay'}
              </button>
            )}
          </div>
        </div>
      )}

      {loading ? (
        <div className="dsh-bots-muted">{zh ? '正在读取 SOUL.md…' : 'Loading SOUL.md…'}</div>
      ) : mode === 'read' ? (
        <div
          className="dsh-bots-soul-read"
          title={tr('settings.bots.soulDoubleClickHint', 'Double-click to edit')}
          onDoubleClick={() => setMode('edit')}
        >
          {draft.trim() || <span className="dsh-bots-muted">{tr('settings.bots.soulEmpty', 'No instructions yet.')}</span>}
        </div>
      ) : (
        <>
          <textarea
            className="dsh-bots-ptextarea dsh-bots-ptextarea-mono"
            style={{ minHeight: 280 }}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setSavedNotice(false);
            }}
            onBlur={() => {
              if (draftRef.current !== diskTextRef.current && !conflictRef.current && !savingRef.current) {
                void saveSoul();
              }
            }}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
                e.preventDefault();
                if (dirty) {
                  void saveSoul();
                }
              }
            }}
          />
          <div className="dsh-bots-muted">
            {zh ? '失焦或离开页面时会自动保存；如遇磁盘冲突将弹出确认防止覆盖丢失。' : 'Auto-saves on blur and close; disk conflicts trigger a guard prompt.'}
          </div>
        </>
      )}
    </div>
  );
}
