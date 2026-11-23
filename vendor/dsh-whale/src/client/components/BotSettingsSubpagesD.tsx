// Bot Settings Drill-down Subpages D (2 new subpages):
// 13. inspector (Read-only Prompt & Active Tools inspection + Historical Snapshot Diff)
// 14. budget (Per-bot daily USD/Token budget, auto-pause on exceed, off-peak-only toggle,
//     today's peak/off-peak cost breakdown & cache hit rate)

import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_BOT_BUDGET } from '../../shared/bot-types.js';
import { botsStore, useBotsLocale } from '../store/bots-store';
import {
  diffBotPrompt,
  getBotBudget,
  getBotBudgetUsage,
  inspectBotPrompt,
  setBotBudget,
  type BotBudgetConfig,
  type BotBudgetUsageSummary,
  type BotPromptDiffResult,
  type BotPromptInspectResult,
  type BotPromptToolInfo,
} from '../store/rpc';
import { BotChevron, BotDisclosure } from './BotDisclosure';
import type { SubpageProps } from './BotSettingsSubpagesA';
import {
  IconAlertTriangle,
  IconCheck,
  IconClock,
  IconEye,
  IconRefresh,
  IconShield,
  IconWrench,
} from './Icons';

function formatToolEntry(entry: string | BotPromptToolInfo): BotPromptToolInfo {
  if (typeof entry === 'string') {
    return { name: entry };
  }
  return entry;
}

function formatUsd(value: number | null | undefined): string {
  const num = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  return `$${num.toFixed(num > 0 && num < 0.01 ? 4 : 2)}`;
}

function formatCountdown(ms: number | null | undefined, zh: boolean): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) {
    return '';
  }
  const remainingMs = ms > 1e12 ? ms - Date.now() : ms;
  if (remainingMs <= 0) {
    return '';
  }
  const totalMin = Math.max(1, Math.round(remainingMs / 60_000));
  const hours = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  if (hours > 0) {
    return zh ? `${hours} 小时 ${mins} 分钟后切换` : `Switches in ${hours}h ${mins}m`;
  }
  return zh ? `${mins} 分钟后切换` : `Switches in ${mins}m`;
}

export function BotInspectorSubpage({ bot }: SubpageProps) {
  const { locale } = useBotsLocale();
  const zh = locale === 'zh-CN';
  const [data, setData] = useState<BotPromptInspectResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [toolsOpen, setToolsOpen] = useState(true);
  const [promptOpen, setPromptOpen] = useState(false);
  const [diffOpen, setDiffOpen] = useState(false);
  const [fromIdx, setFromIdx] = useState(1);
  const [toIdx, setToIdx] = useState(0);
  const [diff, setDiff] = useState<BotPromptDiffResult | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);

  const loadInspect = useCallback(async () => {
    setLoading(true);
    try {
      const res = await inspectBotPrompt(bot.id);
      setData(res);
      const count = res?.snapshots?.length ?? 0;
      if (count >= 2) {
        setFromIdx(1);
        setToIdx(0);
      }
    } catch (err) {
      console.warn('[dsh-bots] prompt.inspect unavailable', err);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [bot.id]);

  useEffect(() => {
    void loadInspect();
  }, [loadInspect]);

  const loadDiff = useCallback(async (from: number, to: number) => {
    setDiffLoading(true);
    try {
      const res = await diffBotPrompt(bot.id, from, to);
      setDiff(res);
    } catch (err) {
      console.warn('[dsh-bots] prompt.diff unavailable', err);
      setDiff(null);
    } finally {
      setDiffLoading(false);
    }
  }, [bot.id]);

  const latest = data?.latest ?? data?.snapshots?.[0] ?? null;
  const snapshots = data?.snapshots ?? [];
  const rawTools = (latest?.tools?.length ? latest.tools : data?.tools) ?? [];
  const tools = rawTools.map(formatToolEntry);
  const linkedSkills = (latest?.linkedSkills?.length ? latest.linkedSkills : (latest?.skills ?? data?.linkedSkills)) ?? [];
  const promptText = latest?.systemPrompt ?? data?.systemPrompt ?? latest?.promptPreview ?? '';

  return (
    <div className="dsh-bots-psection" data-dsh-bots-subpage="inspector">
      <div className="dsh-bots-row">
        <span className="dsh-bots-section-title">
          <IconEye size={13} />
          <span>{zh ? 'Prompt 与实跑工具透视（只读）' : 'Prompt & Active Tools Inspector'}</span>
        </span>
        <button
          type="button"
          className="dsh-bots-pbtn dsh-bots-pbtn-xs"
          disabled={loading}
          onClick={() => void loadInspect()}
        >
          <IconRefresh size={11} />
          <span>{loading ? (zh ? '刷新中…' : 'Loading…') : (zh ? '刷新' : 'Refresh')}</span>
        </button>
      </div>

      {!loading && !latest && !promptText && tools.length === 0 ? (
        <div className="dsh-bots-empty">
          {zh
            ? '暂无运行期 Prompt 快照。向该队友发送消息后，此处将自动记录最近 10 次实跑 Prompt 与工具列表。'
            : 'No runtime prompt snapshots recorded yet.'}
        </div>
      ) : (
        <>
          <div className="dsh-bots-pcard">
            <div className="dsh-bots-row">
              <span style={{ fontWeight: 600 }}>{zh ? '最近一次运行快照' : 'Latest runtime snapshot'}</span>
              {(latest?.at || latest?.timestamp || data?.updatedAt) && (
                <span className="dsh-bots-muted">
                  {new Date(latest?.at ?? latest?.timestamp ?? data?.updatedAt ?? 0).toLocaleString(locale)}
                </span>
              )}
            </div>
            <div className="dsh-bots-decision-meta">
              {latest?.model && (
                <span className="dsh-bots-badge">
                  {[latest.provider, latest.model].filter(Boolean).join('/')}
                </span>
              )}
              {typeof latest?.tokenEstimate === 'number' && (
                <span className="dsh-bots-badge dsh-bots-badge-accent">
                  ~{latest.tokenEstimate} tokens
                </span>
              )}
              {typeof latest?.systemChars === 'number' && (
                <span className="dsh-bots-badge">
                  {latest.systemChars} chars
                </span>
              )}
              {latest?.hasCrewMd && (
                <span className="dsh-bots-badge dsh-bots-badge-success">CREW.md</span>
              )}
              {latest?.hasPlanMd && (
                <span className="dsh-bots-badge dsh-bots-badge-success">plan.md</span>
              )}
              <span className="dsh-bots-badge">
                {zh ? `技能 ${linkedSkills.length}` : `${linkedSkills.length} skills`}
              </span>
            </div>
            {linkedSkills.length > 0 && (
              <div className="dsh-bots-muted">
                {zh ? '已注入技能：' : 'Injected skills: '}
                {linkedSkills.join('、')}
              </div>
            )}
          </div>

          <div className="dsh-bots-pcard">
            <button
              type="button"
              className="dsh-bots-item-group-btn"
              onClick={() => setToolsOpen((prev) => !prev)}
            >
              <BotChevron open={toolsOpen} size={12} />
              <IconWrench size={12} />
              <span>{zh ? '实跑工具清单' : 'Active runtime tools'}</span>
              <span className="dsh-bots-badge">{tools.length}</span>
            </button>
            <BotDisclosure open={toolsOpen}>
              {tools.length === 0 ? (
                <div className="dsh-bots-muted">{zh ? '未记录工具列表。' : 'No tools recorded.'}</div>
              ) : (
                <div className="dsh-bots-tool-pills">
                  {tools.map((tool) => (
                    <span key={tool.name} className="dsh-bots-tool-pill">
                      <span className="dsh-bots-tsv-mono">{tool.name}</span>
                      {tool.effect && <span className="dsh-bots-badge">{tool.effect}</span>}
                    </span>
                  ))}
                </div>
              )}
            </BotDisclosure>
          </div>

          <div className="dsh-bots-pcard">
            <button
              type="button"
              className="dsh-bots-item-group-btn"
              onClick={() => setPromptOpen((prev) => !prev)}
            >
              <BotChevron open={promptOpen} size={12} />
              <span>{zh ? '组装 System Prompt 原文' : 'Assembled system prompt'}</span>
            </button>
            <BotDisclosure open={promptOpen}>
              <pre className="dsh-bots-code-pre dsh-bots-code-pre-tall">
                {promptText || (zh ? '（无正文快照）' : '(Empty prompt snapshot)')}
              </pre>
            </BotDisclosure>
          </div>

          <div className="dsh-bots-pcard" data-dsh-bots-prompt-diff="">
            <button
              type="button"
              className="dsh-bots-item-group-btn"
              onClick={() => {
                const next = !diffOpen;
                setDiffOpen(next);
                if (next && snapshots.length >= 2 && !diff) {
                  void loadDiff(fromIdx, toIdx);
                }
              }}
            >
              <BotChevron open={diffOpen} size={12} />
              <span>{zh ? '历史快照 Diff 对比' : 'Snapshot history diff'}</span>
              <span className="dsh-bots-badge">{snapshots.length}</span>
            </button>
            <BotDisclosure open={diffOpen}>
              {snapshots.length < 2 ? (
                <div className="dsh-bots-muted">
                  {zh ? '至少需要 2 次运行快照才能对比变更。' : 'Need at least 2 snapshots to compare.'}
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 6 }}>
                  <div className="dsh-bots-row">
                    <select
                      className="dsh-bots-pselect"
                      aria-label={zh ? '基准快照' : 'From snapshot'}
                      value={fromIdx}
                      onChange={(e) => setFromIdx(Number(e.target.value))}
                    >
                      {snapshots.map((snap, idx) => (
                        <option key={`from-${snap.id ?? idx}`} value={idx}>
                          {`#${idx + 1} ${snap.at || snap.timestamp ? new Date(snap.at ?? snap.timestamp ?? 0).toLocaleTimeString(locale) : ''}`}
                        </option>
                      ))}
                    </select>
                    <span className="dsh-bots-muted">→</span>
                    <select
                      className="dsh-bots-pselect"
                      aria-label={zh ? '目标快照' : 'To snapshot'}
                      value={toIdx}
                      onChange={(e) => setToIdx(Number(e.target.value))}
                    >
                      {snapshots.map((snap, idx) => (
                        <option key={`to-${snap.id ?? idx}`} value={idx}>
                          {`#${idx + 1} ${snap.at || snap.timestamp ? new Date(snap.at ?? snap.timestamp ?? 0).toLocaleTimeString(locale) : ''}`}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="dsh-bots-pbtn dsh-bots-pbtn-xs dsh-bots-pbtn-primary"
                      disabled={diffLoading}
                      onClick={() => void loadDiff(fromIdx, toIdx)}
                    >
                      {diffLoading ? (zh ? '对比中…' : 'Diffing…') : (zh ? '对比' : 'Compare')}
                    </button>
                  </div>

                  {diff && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {((diff.addedTools?.length ?? 0) > 0 || (diff.removedTools?.length ?? 0) > 0) && (
                        <div className="dsh-bots-decision-meta">
                          {(diff.addedTools ?? []).map((t) => (
                            <span key={`+t-${t}`} className="dsh-bots-badge dsh-bots-badge-success">+ {t}</span>
                          ))}
                          {(diff.removedTools ?? []).map((t) => (
                            <span key={`-t-${t}`} className="dsh-bots-badge dsh-bots-badge-danger">- {t}</span>
                          ))}
                        </div>
                      )}
                      {(diff.addedLines ?? []).map((line, i) => (
                        <div key={`a-${i}`} className="dsh-bots-diff-add">+ {line}</div>
                      ))}
                      {(diff.removedLines ?? []).map((line, i) => (
                        <div key={`r-${i}`} className="dsh-bots-diff-del">− {line}</div>
                      ))}
                      {diff.diffText && (diff.addedLines?.length ?? 0) === 0 && (diff.removedLines?.length ?? 0) === 0 && (
                        <pre className="dsh-bots-code-pre">{diff.diffText}</pre>
                      )}
                      {diff.changed === false && (
                        <div className="dsh-bots-muted">{zh ? '两次快照内容一致，无差异。' : 'No differences between snapshots.'}</div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </BotDisclosure>
          </div>
        </>
      )}
    </div>
  );
}

export function BotBudgetSubpage({ bot }: SubpageProps) {
  const { locale } = useBotsLocale();
  const zh = locale === 'zh-CN';
  const [usage, setUsage] = useState<BotBudgetUsageSummary | null>(null);
  const [dailyLimitUsd, setDailyLimitUsd] = useState('');
  const [dailyLimitTokens, setDailyLimitTokens] = useState('');
  const [alertThresholdPct, setAlertThresholdPct] = useState(String(DEFAULT_BOT_BUDGET.alertThresholdPct));
  const [pauseOnExceed, setPauseOnExceed] = useState<boolean>(DEFAULT_BOT_BUDGET.pauseOnExceed);
  const [offPeakOnly, setOffPeakOnly] = useState<boolean>(DEFAULT_BOT_BUDGET.offPeakOnly);
  const [saving, setSaving] = useState(false);

  const applyBudgetToForm = (cfg: BotBudgetConfig | null | undefined) => {
    setDailyLimitUsd(typeof cfg?.dailyLimitUsd === 'number' ? String(cfg.dailyLimitUsd) : '');
    setDailyLimitTokens(typeof cfg?.dailyLimitTokens === 'number' ? String(cfg.dailyLimitTokens) : '');
    setAlertThresholdPct(String(typeof cfg?.alertThresholdPct === 'number' ? cfg.alertThresholdPct : DEFAULT_BOT_BUDGET.alertThresholdPct));
    setPauseOnExceed(cfg?.pauseOnExceed !== false);
    setOffPeakOnly(cfg?.offPeakOnly === true);
  };

  const load = useCallback(async () => {
    const [cfgRes, usageRes] = await Promise.allSettled([
      getBotBudget(bot.id),
      getBotBudgetUsage(bot.id),
    ]);
    const usageVal = usageRes.status === 'fulfilled' ? usageRes.value : null;
    if (usageVal) {
      setUsage(usageVal);
    }
    const cfgVal = cfgRes.status === 'fulfilled' ? cfgRes.value : null;
    if (cfgVal || usageVal?.budget) {
      applyBudgetToForm(cfgVal ?? usageVal?.budget);
    }
  }, [bot.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const parsedUsd = dailyLimitUsd.trim() === '' ? null : Number(dailyLimitUsd);
      const parsedTokens = dailyLimitTokens.trim() === '' ? null : Math.round(Number(dailyLimitTokens));
      const parsedAlert = Number(alertThresholdPct);
      const patch: Partial<BotBudgetConfig> = {
        dailyLimitUsd: parsedUsd !== null && Number.isFinite(parsedUsd) && parsedUsd >= 0 ? parsedUsd : null,
        dailyLimitTokens: parsedTokens !== null && Number.isFinite(parsedTokens) && parsedTokens >= 0 ? parsedTokens : null,
        alertThresholdPct: Number.isFinite(parsedAlert) ? Math.min(100, Math.max(10, Math.round(parsedAlert))) : 80,
        pauseOnExceed,
        offPeakOnly,
      };
      const saved = await setBotBudget(bot.id, patch);
      if (saved) applyBudgetToForm(saved);
      botsStore.pushToast({ message: zh ? '已保存预算与峰谷策略' : 'Budget policy saved', tone: 'success' });
      void load();
    } catch (err) {
      botsStore.pushToast({ message: err instanceof Error ? err.message : String(err), tone: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const cacheHitPct = typeof usage?.cacheHitRate === 'number' && Number.isFinite(usage.cacheHitRate)
    ? Math.round(usage.cacheHitRate <= 1 ? usage.cacheHitRate * 100 : usage.cacheHitRate)
    : 0;
  const countdownText = formatCountdown(usage?.nextPeakSwitchMs, zh);

  return (
    <div className="dsh-bots-psection" data-dsh-bots-subpage="budget">
      {/* Today's cost, peak/off-peak & cache hit rate */}
      <div className="dsh-bots-pcard">
        <div className="dsh-bots-row">
          <span className="dsh-bots-section-title">
            <IconClock size={13} />
            <span>{zh ? '今日峰谷费用与缓存命中率' : 'Today’s cost & peak/off-peak'}</span>
          </span>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {usage?.isOffPeak !== undefined && (
              <span className={`dsh-bots-badge ${usage.isOffPeak ? 'dsh-bots-badge-success' : 'dsh-bots-badge-warn'}`}>
                {usage.isOffPeak ? (zh ? '当前谷段' : 'Off-peak') : (zh ? '当前峰段' : 'Peak')}
              </span>
            )}
            <button
              type="button"
              className="dsh-bots-pbtn dsh-bots-pbtn-xs dsh-bots-pbtn-icon"
              title={zh ? '刷新用量' : 'Refresh usage'}
              onClick={() => void load()}
            >
              <IconRefresh size={11} />
            </button>
          </div>
        </div>

        <div className="dsh-bots-budget-grid">
          <div className="dsh-bots-budget-metric">
            <span className="dsh-bots-muted">{zh ? '今日总计' : 'Total today'}</span>
            <strong className="dsh-bots-num">{formatUsd(usage?.costUsd)}</strong>
          </div>
          <div className="dsh-bots-budget-metric">
            <span className="dsh-bots-muted">{zh ? '峰段费用' : 'Peak'}</span>
            <strong className="dsh-bots-num">{formatUsd(usage?.peakCostUsd)}</strong>
          </div>
          <div className="dsh-bots-budget-metric">
            <span className="dsh-bots-muted">{zh ? '谷段费用' : 'Off-peak'}</span>
            <strong className="dsh-bots-num">{formatUsd(usage?.offPeakCostUsd)}</strong>
          </div>
          <div className="dsh-bots-budget-metric">
            <span className="dsh-bots-muted">{zh ? '缓存命中率' : 'Cache hit'}</span>
            <strong className="dsh-bots-num">{cacheHitPct}%</strong>
          </div>
        </div>

        {countdownText && (
          <div className="dsh-bots-muted">{countdownText}</div>
        )}

        {usage?.exceeded && (
          <div className="dsh-bots-timeline-entry">
            <div className="dsh-bots-row-left">
              <IconAlertTriangle size={13} />
              <span style={{ fontWeight: 600, fontSize: 12 }}>
                {zh ? '已触及今日预算熔断上限' : 'Daily budget limit reached'}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Budget limits & off-peak controls */}
      <div className="dsh-bots-pcard" style={{ gap: 10 }}>
        <div className="dsh-bots-section-title">
          <IconShield size={13} />
          <span>{zh ? '日预算上限与自动治理' : 'Daily limits & governance'}</span>
        </div>

        <label className="dsh-bots-field">
          <span className="dsh-bots-muted">{zh ? '每日费用上限（USD，留空不限）' : 'Daily USD limit (blank = unlimited)'}</span>
          <input
            type="number"
            min="0"
            step="0.1"
            className="dsh-bots-pinput"
            placeholder="5.00"
            value={dailyLimitUsd}
            onChange={(e) => setDailyLimitUsd(e.target.value)}
          />
        </label>

        <label className="dsh-bots-field">
          <span className="dsh-bots-muted">{zh ? '每日 Token 上限（留空不限）' : 'Daily token limit (blank = unlimited)'}</span>
          <input
            type="number"
            min="0"
            step="10000"
            className="dsh-bots-pinput"
            placeholder="2000000"
            value={dailyLimitTokens}
            onChange={(e) => setDailyLimitTokens(e.target.value)}
          />
        </label>

        <label className="dsh-bots-field">
          <span className="dsh-bots-muted">{zh ? '预警阈值 (%)' : 'Alert threshold (%)'}</span>
          <input
            type="number"
            min="10"
            max="100"
            step="5"
            className="dsh-bots-pinput"
            value={alertThresholdPct}
            onChange={(e) => setAlertThresholdPct(e.target.value)}
          />
        </label>

        <div className="dsh-bots-settings-row">
          <div>
            <div style={{ fontWeight: 500 }}>{zh ? '超额自动挂起' : 'Pause on exceed'}</div>
            <div className="dsh-bots-muted">
              {zh ? '触及日上限后暂停自动执行并生成拍板卡提醒你确认。' : 'Pause background runs and notify you when daily budget is exceeded.'}
            </div>
          </div>
          <button
            type="button"
            role="switch"
            className="dsh-bots-switch"
            aria-checked={pauseOnExceed}
            aria-label={zh ? '超额自动挂起' : 'Pause on exceed'}
            onClick={() => setPauseOnExceed((prev) => !prev)}
          >
            <span className="dsh-bots-switch-thumb" />
          </button>
        </div>

        <div className="dsh-bots-settings-row">
          <div>
            <div style={{ fontWeight: 500 }}>{zh ? '仅谷段跑后台任务' : 'Off-peak only for background runs'}</div>
            <div className="dsh-bots-muted">
              {zh ? '工作日峰段（09:00–12:00 / 14:00–18:00）自动顺延定时巡视与整理任务至谷段执行。' : 'Defer scheduled sweeps and tidy-up tasks during peak hours.'}
            </div>
          </div>
          <button
            type="button"
            role="switch"
            className="dsh-bots-switch"
            aria-checked={offPeakOnly}
            aria-label={zh ? '仅谷段跑后台任务' : 'Off-peak only for background runs'}
            onClick={() => setOffPeakOnly((prev) => !prev)}
          >
            <span className="dsh-bots-switch-thumb" />
          </button>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            type="button"
            className="dsh-bots-pbtn dsh-bots-pbtn-primary"
            disabled={saving}
            onClick={() => void handleSave()}
          >
            <IconCheck size={12} />
            <span>{saving ? (zh ? '保存中…' : 'Saving…') : (zh ? '保存预算策略' : 'Save budget')}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
