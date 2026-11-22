// Right-panel Activity tab lower sections:
// 3. Upcoming (Look Around, Tidy Up, Automations CRUD + Run/Pause/Delete, one-shot Waits + Cancel)
// 4. Up Next (Look Around suggestion cards Start/Dismiss + Look Now)

import { useState } from 'react';
import { botLookAround, nextLookAroundAt } from '../../shared/bot-look-around.js';
import { TIDY_UP_HOURS, botTidyUp } from '../../shared/bot-tidy-up.js';
import { botsStore, useBotsLocale } from '../store/bots-store';
import { RPC_METHODS, callBotRpc, type BotRecord } from '../store/rpc';
import {
  IconPause,
  IconPlay,
  IconPlus,
  IconRefresh,
  IconSparkles,
  IconTrash,
  IconZap,
} from './Icons';

export interface AutomationRow {
  id: string;
  botId: string;
  name: string;
  prompt: string;
  schedule?: string | null;
  intervalMinutes?: number | null;
  once?: { by?: number; label?: string } | null;
  enabled: boolean;
  nextRunAt?: number | null;
  lastRunAt?: number | null;
  lastStatus?: string | null;
}

export interface SuggestionRow {
  id: string;
  title: string;
  why?: string;
  summary?: string;
  ask?: string;
  link?: string;
  createdAt?: number;
}

export interface BotActivityUpcomingProps {
  bot: BotRecord;
  now: number;
  automations: AutomationRow[];
  suggestions: SuggestionRow[];
  onReload: () => void;
}

function computeNextTidyUpAt(cfg: { on: boolean; every: 'night' | 'week' }, now: number): number | null {
  if (!cfg.on) {
    return null;
  }
  const d = new Date(now);
  d.setHours(TIDY_UP_HOURS.from, 0, 0, 0);
  if (d.getTime() <= now) {
    d.setDate(d.getDate() + 1);
  }
  if (cfg.every === 'week') {
    while (d.getDay() !== 0) {
      d.setDate(d.getDate() + 1);
    }
  }
  return d.getTime();
}

function formatFutureTime(ts: number | null | undefined, locale: string): string {
  if (!ts || !Number.isFinite(ts)) {
    return '—';
  }
  return new Date(ts).toLocaleString(locale, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function BotActivityUpcoming({
  bot,
  now,
  automations,
  suggestions,
  onReload,
}: BotActivityUpcomingProps) {
  const { locale, tr } = useBotsLocale();
  const zh = locale === 'zh-CN';
  const [lookingNow, setLookingNow] = useState(false);
  const [creatingAuto, setCreatingAuto] = useState(false);
  const [autoName, setAutoName] = useState('');
  const [autoPrompt, setAutoPrompt] = useState('');
  const [autoInterval, setAutoInterval] = useState('60');

  const scheduledAutos = automations.filter((a) => !a.once);
  const oneShotWaits = automations.filter((a) => Boolean(a.once) && a.enabled);
  const lookCfg = botLookAround(bot);
  const tidyCfg = botTidyUp(bot);
  const nextLookTs = bot.paused ? null : nextLookAroundAt(lookCfg, now);
  const nextTidyTs = bot.paused ? null : computeNextTidyUpAt(tidyCfg as { on: boolean; every: 'night' | 'week' }, now);

  const handleLookNow = async () => {
    setLookingNow(true);
    try {
      await callBotRpc(RPC_METHODS.LOOK_AROUND_NOW, { botId: bot.id });
      botsStore.pushToast({
        message: zh ? '已启动立即巡视' : 'Look around sweep started',
        tone: 'success',
      });
      onReload();
    } catch (err) {
      botsStore.pushToast({ message: err instanceof Error ? err.message : String(err), tone: 'error' });
    } finally {
      setLookingNow(false);
    }
  };

  const handleCreateAuto = async () => {
    if (!autoPrompt.trim()) {
      return;
    }
    try {
      await callBotRpc('bots.automations.create', {
        botId: bot.id,
        name: autoName.trim() || (zh ? '定时任务' : 'Scheduled task'),
        prompt: autoPrompt.trim(),
        intervalMinutes: Math.max(5, Number(autoInterval) || 60),
        enabled: true,
      });
      setAutoName('');
      setAutoPrompt('');
      setCreatingAuto(false);
      onReload();
    } catch (err) {
      botsStore.pushToast({ message: err instanceof Error ? err.message : String(err), tone: 'error' });
    }
  };

  return (
    <>
      <div className="dsh-bots-psection">
        <div className="dsh-bots-section-head">
          <span className="dsh-bots-section-title">
            <IconZap size={12} />
            <span>{tr('bots.upcoming.title', 'Upcoming')}</span>
          </span>
          <button
            type="button"
            className="dsh-bots-pbtn dsh-bots-pbtn-xs"
            onClick={() => setCreatingAuto((prev) => !prev)}
          >
            <IconPlus size={11} />
            <span>{zh ? '新建自动化' : 'New automation'}</span>
          </button>
        </div>

        {creatingAuto && (
          <div className="dsh-bots-pcard">
            <input
              type="text"
              className="dsh-bots-pinput"
              placeholder={zh ? '自动化名称（如每日晨报）' : 'Automation name'}
              value={autoName}
              onChange={(e) => setAutoName(e.target.value)}
            />
            <textarea
              className="dsh-bots-ptextarea"
              rows={2}
              placeholder={zh ? '触发时给机器人的指令…' : 'Prompt to run when triggered…'}
              value={autoPrompt}
              onChange={(e) => setAutoPrompt(e.target.value)}
            />
            <div className="dsh-bots-row">
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5 }}>
                <span>{zh ? '间隔(分钟)' : 'Every (min)'}</span>
                <input
                  type="number"
                  min={5}
                  className="dsh-bots-pinput"
                  style={{ width: 72, padding: '3px 6px' }}
                  value={autoInterval}
                  onChange={(e) => setAutoInterval(e.target.value)}
                />
              </label>
              <div style={{ display: 'inline-flex', gap: 6 }}>
                <button type="button" className="dsh-bots-pbtn dsh-bots-pbtn-xs" onClick={() => setCreatingAuto(false)}>
                  {zh ? '取消' : 'Cancel'}
                </button>
                <button
                  type="button"
                  className="dsh-bots-pbtn dsh-bots-pbtn-xs dsh-bots-pbtn-primary"
                  disabled={!autoPrompt.trim()}
                  onClick={() => void handleCreateAuto()}
                >
                  {zh ? '保存' : 'Create'}
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="dsh-bots-pcard" style={{ gap: 5 }}>
          <div className="dsh-bots-row">
            <span style={{ fontWeight: 500 }}>{tr('settings.bots.lookAround.title', 'Look around')}</span>
            <span className="dsh-bots-muted">
              {lookCfg.on ? formatFutureTime(nextLookTs, locale) : (zh ? '已关闭' : 'Off')}
            </span>
          </div>
          <div className="dsh-bots-row">
            <span style={{ fontWeight: 500 }}>{tr('settings.bots.tidyUp.title', 'Tidy up')}</span>
            <span className="dsh-bots-muted">
              {tidyCfg.on ? formatFutureTime(nextTidyTs, locale) : (zh ? '已关闭' : 'Off')}
            </span>
          </div>
        </div>

        {scheduledAutos.map((auto) => (
          <div key={auto.id} className="dsh-bots-pcard">
            <div className="dsh-bots-row">
              <span className="dsh-bots-ellipsis" style={{ fontWeight: 600 }}>{auto.name}</span>
              <div style={{ display: 'inline-flex', gap: 2 }}>
                <button
                  type="button"
                  className="dsh-bots-pbtn dsh-bots-pbtn-xs"
                  onClick={() => {
                    void callBotRpc('bots.automations.runNow', { id: auto.id }).then(() => {
                      botsStore.pushToast({ message: zh ? `已运行：${auto.name}` : `Ran ${auto.name}`, tone: 'success' });
                      onReload();
                    }).catch((err) => {
                      botsStore.pushToast({ message: err instanceof Error ? err.message : String(err), tone: 'error' });
                    });
                  }}
                >
                  <IconPlay size={10} />
                  <span>{zh ? '运行' : 'Run'}</span>
                </button>
                <button
                  type="button"
                  className="dsh-bots-pbtn dsh-bots-pbtn-xs dsh-bots-pbtn-icon"
                  title={auto.enabled ? (zh ? '暂停' : 'Pause') : (zh ? '恢复' : 'Resume')}
                  onClick={() => {
                    void callBotRpc('bots.automations.update', { id: auto.id, enabled: !auto.enabled })
                      .then(() => onReload())
                      .catch((err) => botsStore.pushToast({ message: String(err), tone: 'error' }));
                  }}
                >
                  {auto.enabled ? <IconPause size={11} /> : <IconPlay size={11} />}
                </button>
                <button
                  type="button"
                  className="dsh-bots-pbtn dsh-bots-pbtn-xs dsh-bots-pbtn-icon dsh-bots-pbtn-danger"
                  title={zh ? '删除' : 'Delete'}
                  onClick={() => {
                    void callBotRpc('bots.automations.delete', { id: auto.id })
                      .then(() => onReload())
                      .catch((err) => botsStore.pushToast({ message: String(err), tone: 'error' }));
                  }}
                >
                  <IconTrash size={11} />
                </button>
              </div>
            </div>
            <div className="dsh-bots-muted dsh-bots-ellipsis">
              {auto.enabled ? formatFutureTime(auto.nextRunAt, locale) : (zh ? '已暂停' : 'Paused')}
              {auto.schedule ? ` · ${auto.schedule}` : auto.intervalMinutes ? ` · ${auto.intervalMinutes}m` : ''}
            </div>
          </div>
        ))}

        {oneShotWaits.map((wait) => (
          <div key={wait.id} className="dsh-bots-settings-row">
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="dsh-bots-ellipsis" style={{ fontWeight: 500 }}>{wait.name}</div>
              <div className="dsh-bots-muted">{formatFutureTime(wait.once?.by ?? wait.nextRunAt, locale)}</div>
            </div>
            <button
              type="button"
              className="dsh-bots-pbtn dsh-bots-pbtn-xs"
              onClick={() => {
                void callBotRpc('bots.automations.cancelWait', { botId: bot.id, waitId: wait.id })
                  .then(() => onReload())
                  .catch((err) => botsStore.pushToast({ message: String(err), tone: 'error' }));
              }}
            >
              {zh ? '取消等待' : 'Cancel'}
            </button>
          </div>
        ))}
      </div>

      <div className="dsh-bots-psection">
        <div className="dsh-bots-section-head">
          <span className="dsh-bots-section-title">
            <IconSparkles size={12} />
            <span>{tr('bots.upNext.title', 'Up next')}</span>
            {suggestions.length > 0 && <span className="dsh-bots-badge">{suggestions.length}</span>}
          </span>
          <button
            type="button"
            className="dsh-bots-pbtn dsh-bots-pbtn-xs"
            disabled={lookingNow || bot.paused}
            onClick={() => void handleLookNow()}
          >
            <IconRefresh size={11} />
            <span>{lookingNow ? tr('settings.bots.lookAround.looking', 'Looking…') : tr('bots.upNext.lookNow', 'Look now')}</span>
          </button>
        </div>

        {suggestions.length === 0 ? (
          <div className="dsh-bots-empty">
            {zh ? '暂无巡视建议。点击「立即巡视」让大肥鱼队友扫描近期上下文。' : 'No suggestions right now.'}
          </div>
        ) : (
          suggestions.map((sug) => (
            <div key={sug.id} className="dsh-bots-pcard">
              <div style={{ fontWeight: 600 }}>{sug.title}</div>
              {(sug.why || sug.summary) && (
                <div className="dsh-bots-muted">{sug.why || sug.summary}</div>
              )}
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  type="button"
                  className="dsh-bots-pbtn dsh-bots-pbtn-xs dsh-bots-pbtn-primary"
                  onClick={() => {
                    void callBotRpc(RPC_METHODS.SUGGESTIONS_START, { botId: bot.id, suggestionId: sug.id })
                      .then(() => {
                        onReload();
                        void botsStore.openBotHome(bot.id);
                      })
                      .catch((err) => botsStore.pushToast({ message: String(err), tone: 'error' }));
                  }}
                >
                  {tr('bots.upNext.start', 'Start')}
                </button>
                <button
                  type="button"
                  className="dsh-bots-pbtn dsh-bots-pbtn-xs"
                  onClick={() => {
                    void callBotRpc(RPC_METHODS.SUGGESTIONS_DISMISS, { botId: bot.id, suggestionId: sug.id })
                      .then(() => onReload())
                      .catch((err) => botsStore.pushToast({ message: String(err), tone: 'error' }));
                  }}
                >
                  {tr('bots.upNext.dismiss', 'Dismiss')}
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </>
  );
}
