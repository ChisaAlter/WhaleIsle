// First-run kickoff progress card (3 steps, scan progress, retry button) AND
// compact collapsible Fleet Status Card when `kickoff.status === 'ready'` (with one-click
// conversational teammate builder entry).

import { useState } from 'react';
import { botsStore, useBotsLocale, useBotsState } from '../store/bots-store';
import { RPC_METHODS, callBotRpc, type BotRecord } from '../store/rpc';
import { BotAvatar } from './BotAvatar';
import { BotChevron, BotDisclosure } from './BotDisclosure';
import {
  IconAlertTriangle,
  IconCheck,
  IconPlus,
  IconRefresh,
  IconSparkles,
  IconSpinner,
  IconUsers,
  IconX,
} from './Icons';

export interface BotFirstScreenProps {
  bot: BotRecord;
  className?: string;
  onDismiss?: () => void;
}

const STEP_ORDER = ['create', 'start', 'first-message', 'done'] as const;

function stepStateOf(
  currentStep: string,
  targetStep: string,
  status: string,
): 'done' | 'active' | 'error' | 'pending' {
  const curIdx = STEP_ORDER.indexOf(currentStep as (typeof STEP_ORDER)[number]);
  const tgtIdx = STEP_ORDER.indexOf(targetStep as (typeof STEP_ORDER)[number]);
  if (curIdx < 0 || tgtIdx < 0) {
    return 'pending';
  }
  if (curIdx > tgtIdx || status === 'ready') {
    return 'done';
  }
  if (curIdx === tgtIdx) {
    return status === 'failed' ? 'error' : 'active';
  }
  return 'pending';
}

export function BotFirstScreen({ bot, className, onDismiss }: BotFirstScreenProps) {
  const { locale, tr } = useBotsLocale();
  const zh = locale === 'zh-CN';
  const bots = useBotsState((state) => state.bots);
  const needsYouMap = useBotsState((state) => state.needsYou);
  const [collapsed, setCollapsed] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [offerPrompt, setOfferPrompt] = useState('');
  const [creatingOffer, setCreatingOffer] = useState(false);

  const kickoff = bot.kickoff;
  if (!kickoff) {
    return null;
  }

  // Ready state -> compact collapsible Fleet Status Card with one-click conversational teammate builder
  if (kickoff.status === 'ready') {
    const fleetBots = bots.length > 0 ? bots : [bot];
    const activeCount = fleetBots.filter((b) => !b.paused).length;
    const totalNeedsYou = fleetBots.reduce((sum, b) => sum + (needsYouMap[b.id] ?? b.needsYouCount ?? 0), 0);

    const handleQuickCreateTeammate = async () => {
      const purpose = offerPrompt.trim();
      if (!purpose) {
        botsStore.openModal({ kind: 'new-bot' });
        return;
      }
      setCreatingOffer(true);
      try {
        await botsStore.submitCreateOffer({ purpose, fromBotId: bot.id });
        setOfferPrompt('');
        botsStore.pushToast({
          message: zh ? '已发起新队友组建提案' : 'Teammate proposal created',
          tone: 'success',
        });
      } catch {
        botsStore.openModal({ kind: 'new-bot', draft: { initialPurpose: purpose } });
      } finally {
        setCreatingOffer(false);
      }
    };

    return (
      <div
        className={`dsh-bots-first-card dsh-bots-fleet-card ${className ?? ''}`.trim()}
        data-dsh-bots-fleet-card="ready"
      >
        <div className="dsh-bots-row">
          <div className="dsh-bots-row-left" style={{ gap: 10 }}>
            <BotAvatar
              botId={bot.id}
              avatar={bot.avatar}
              avatarColor={bot.avatarColor}
              name={bot.name}
              size={32}
              radius={9}
              status={bot.dotState ?? 'idle'}
              paused={bot.paused}
            />
            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 14, lineHeight: '20px', fontWeight: 600 }}>{bot.name}</span>
                <span className="dsh-bots-badge dsh-bots-badge-success">{zh ? '舰队已就绪' : 'Fleet ready'}</span>
              </div>
              <div className="dsh-bots-muted">
                {zh
                  ? `${activeCount}/${fleetBots.length} 位队友在线${totalNeedsYou > 0 ? ` · ${totalNeedsYou} 项待拍板` : ''}`
                  : `${activeCount}/${fleetBots.length} bots active${totalNeedsYou > 0 ? ` · ${totalNeedsYou} needs you` : ''}`}
              </div>
            </div>
          </div>

          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
            <button
              type="button"
              className="dsh-bots-pbtn dsh-bots-pbtn-xs"
              onClick={() => botsStore.setRightPanelTab('home', bot.id)}
            >
              {zh ? '打开战报' : 'Overview'}
            </button>
            <button
              type="button"
              className="dsh-bots-icon-btn"
              aria-label={collapsed ? (zh ? '展开舰队状态' : 'Expand fleet status') : (zh ? '收起舰队状态' : 'Collapse fleet status')}
              onClick={() => setCollapsed((prev) => !prev)}
            >
              <BotChevron open={!collapsed} size={14} />
            </button>
            {onDismiss && (
              <button
                type="button"
                className="dsh-bots-icon-btn"
                aria-label={zh ? '关闭' : 'Close'}
                onClick={onDismiss}
              >
                <IconX size={14} />
              </button>
            )}
          </div>
        </div>

        <BotDisclosure open={!collapsed}>
          <div className="dsh-bots-fleet-body">
            <div className="dsh-bots-fleet-roster">
              {fleetBots.slice(0, 6).map((member) => {
                const count = needsYouMap[member.id] ?? member.needsYouCount ?? 0;
                return (
                  <button
                    key={member.id}
                    type="button"
                    className="dsh-bots-chip"
                    data-active={member.id === bot.id ? 'true' : 'false'}
                    onClick={() => void botsStore.openBotHome(member.id)}
                  >
                    <BotAvatar
                      botId={member.id}
                      avatar={member.avatar}
                      avatarColor={member.avatarColor}
                      name={member.name}
                      size={14}
                      radius={4}
                      paused={member.paused}
                    />
                    <span>{member.name}</span>
                    {count > 0 && <span className="dsh-bots-badge dsh-bots-badge-warn">{count}</span>}
                  </button>
                );
              })}
            </div>

            <div className="dsh-bots-row" style={{ gap: 6 }}>
              <input
                type="text"
                className="dsh-bots-pinput"
                placeholder={zh ? '一句话描述需求，一键对话建队友（如：盯 CI 失败并提修复 PR）' : 'Describe a role to spin up a teammate…'}
                value={offerPrompt}
                onChange={(e) => setOfferPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void handleQuickCreateTeammate();
                  }
                }}
              />
              <button
                type="button"
                className="dsh-bots-pbtn dsh-bots-pbtn-primary"
                data-dsh-bots-quick-teammate=""
                disabled={creatingOffer}
                onClick={() => void handleQuickCreateTeammate()}
              >
                <IconSparkles size={12} />
                <span>{creatingOffer ? (zh ? '组建中…' : 'Creating…') : (zh ? '对话建队友' : 'Build teammate')}</span>
              </button>
              <button
                type="button"
                className="dsh-bots-pbtn dsh-bots-pbtn-icon"
                title={zh ? '新建群聊编队' : 'New bot group'}
                aria-label={zh ? '新建群聊编队' : 'New bot group'}
                onClick={() => botsStore.openModal({ kind: 'group' })}
              >
                <IconUsers size={13} />
              </button>
              <button
                type="button"
                className="dsh-bots-pbtn dsh-bots-pbtn-icon"
                title={zh ? '从模板新建队友' : 'New bot from template'}
                aria-label={zh ? '从模板新建队友' : 'New bot from template'}
                onClick={() => botsStore.openModal({ kind: 'templates' })}
              >
                <IconPlus size={13} />
              </button>
            </div>
          </div>
        </BotDisclosure>
      </div>
    );
  }

  const status = kickoff.status ?? 'running';
  const currentStep = kickoff.step ?? 'start';
  const rawAgent = bot.agent || bot.model || '';
  const agentName = !rawAgent || rawAgent === 'deepseek-harness'
    ? tr('bots.runtime.local', zh ? 'WhaleIsle 内核' : 'WhaleIsle Core')
    : rawAgent;
  const subtitle = bot.purpose || bot.description || '';
  const rawError = kickoff.error?.trim() ?? '';
  const displayError = !rawError || /^first message failed$/i.test(rawError)
    ? (zh ? '首条招呼发送失败，请检查模型配置后重试' : 'First message failed. Check your model settings and retry.')
    : rawError;
  const steps = [
    { id: 'create', label: tr('bots.firstScreen.stepCreate', 'Create bot') },
    { id: 'start', label: tr('bots.firstScreen.stepStart', 'Start {{agent}}', { agent: agentName }) },
    { id: 'first-message', label: tr('bots.firstScreen.stepFirstMessage', 'First message') },
  ];

  const handleRetry = async () => {
    if (retrying) {
      return;
    }
    setRetrying(true);
    try {
      await callBotRpc(RPC_METHODS.KICKOFF_RETRY, { botId: bot.id });
      void botsStore.refresh();
    } catch (err) {
      botsStore.pushToast({
        message: err instanceof Error ? err.message : String(err),
        tone: 'error',
      });
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div className={`dsh-bots-first-card ${className ?? ''}`.trim()}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <BotAvatar
          botId={bot.id}
          avatar={bot.avatar}
          avatarColor={bot.avatarColor}
          name={bot.name}
          size={36}
          radius={10}
          status={status === 'failed' ? 'failed' : 'working'}
        />
        <div style={{ flex: '1 1 auto', minWidth: 0 }}>
          <div style={{ fontSize: 14, lineHeight: '22px', fontWeight: 600 }}>
            {tr('bots.firstScreen.gettingSetUp', 'Getting set up')}
          </div>
          {subtitle && (
            <div style={{ fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {subtitle}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
          {status === 'failed' && (
            <button
              type="button"
              className="dsh-bots-btn"
              data-size="sm"
              data-variant="primary"
              disabled={retrying}
              onClick={() => void handleRetry()}
            >
              <IconRefresh size={12} className={retrying ? 'dsh-bots-spin' : undefined} />
              <span>{tr('bots.firstScreen.retry', 'Retry')}</span>
            </button>
          )}
          <button
            type="button"
            className="dsh-bots-icon-btn"
            aria-label={collapsed ? (zh ? '展开' : 'Expand') : (zh ? '收起' : 'Collapse')}
            onClick={() => setCollapsed((prev) => !prev)}
          >
            <BotChevron open={!collapsed} size={15} />
          </button>
          {onDismiss && (
            <button
              type="button"
              className="dsh-bots-icon-btn"
              aria-label={zh ? '关闭' : 'Close'}
              title={zh ? '关闭' : 'Close'}
              onClick={onDismiss}
            >
              <IconX size={14} />
            </button>
          )}
        </div>
      </div>

      <BotDisclosure open={!collapsed}>
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--dsw-alias-border-l1)', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {steps.map((step) => {
            const state = stepStateOf(currentStep, step.id, status);
            return (
              <div key={step.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, lineHeight: '20px' }}>
                <span style={{ width: 16, display: 'inline-flex', justifyContent: 'center' }}>
                  {state === 'done' ? (
                    <IconCheck size={14} style={{ color: 'var(--dsw-alias-state-success-primary)' }} />
                  ) : state === 'error' ? (
                    <IconAlertTriangle size={14} style={{ color: 'var(--dsw-alias-state-error-primary)' }} />
                  ) : state === 'active' ? (
                    <IconSpinner size={13} style={{ color: 'var(--dsw-alias-state-warn-primary)' }} />
                  ) : (
                    <span style={{ width: 6, height: 6, borderRadius: 999, background: 'var(--dsw-alias-border-l3)' }} />
                  )}
                </span>
                <span style={{ color: state === 'pending' ? 'var(--dsw-alias-label-tertiary)' : 'var(--dsw-alias-label-primary)' }}>
                  {step.label}
                </span>
              </div>
            );
          })}

          {(kickoff.scanItems?.length ?? 0) > 0 && (
            <div style={{ marginTop: 4, paddingLeft: 24, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {kickoff.scanItems?.map((item, idx) => (
                <div key={item.id ?? idx} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-secondary)' }}>
                  {item.done ? <IconCheck size={12} style={{ color: 'var(--dsw-alias-state-success-primary)' }} /> : <IconSpinner size={11} />}
                  <span>{item.label}</span>
                  {item.detail && <span style={{ color: 'var(--dsw-alias-label-tertiary)' }}>· {item.detail}</span>}
                </div>
              ))}
            </div>
          )}

          {status === 'failed' && (
            <div
              style={{
                marginTop: 4,
                padding: '8px 10px',
                borderRadius: 'var(--dsw-radius-sm)',
                background: 'var(--dsw-alias-interactive-bg-hover-danger)',
                color: 'var(--dsw-alias-state-error-primary)',
                fontSize: 12,
                lineHeight: '18px',
              }}
            >
              {displayError}
            </div>
          )}
        </div>
      </BotDisclosure>
    </div>
  );
}
