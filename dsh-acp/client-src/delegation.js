import {
  h,
  useState,
  useEffect,
  StateDot,
  IconAgentPresetOutlineRegular,
  IconChevronRightOutlineRegular,
} from './primitives.js';
import { ADD_PROVIDER_CARDS, safeHttpsIconUrl } from './utils.js';

const WAITING_INTERACTION_KINDS = new Set(['approval', 'question']);

// Separate, durable reply content: delegation must remain visible when
// the surrounding tool/process disclosure is collapsed.
export const delegationDefinition = {
  kind: 'acp-delegation',
  target: 'chat',
  match(event) {
    if (event.type === 'acp-delegation/start') return { id: event.data.runId, role: 'start' };
    if (event.type === 'acp-delegation/end') return { id: event.data.runId, role: 'update' };
    if (event.type === 'acp-delegation/state') return { id: event.data.runId, role: 'update' };
    return null;
  },
  start: (_context, match) => match.event.data,
  update: (context, match) => ({ ...context.state, ...match.event.data }),
  buildViewNode(context) {
    if (!context.start || !context.state) return null;
    const abandoned = ['interrupted', 'forked'].includes(context.start.location.turn?.end?.data?.reason?.kind);
    return {
      key: context.key,
      id: context.id,
      kind: 'acp-delegation',
      target: 'chat',
      anchorSeq: context.start.event.seq,
      location: context.start.location,
      visibility: 'visible',
      processVisibility: 'independent',
      data: { ...context.state, ...(abandoned && !context.state.endedAt ? { stopReason: 'aborted' } : {}) },
    };
  },
};

function delegationStatusOf(stopReason) {
  if (!stopReason) return 'running';
  if (stopReason === 'completed') return 'completed';
  if (stopReason === 'aborted') return 'cancelled';
  return 'failed';
}

function delegationStateDot(status, quiet, pendingLabel) {
  if (quiet || pendingLabel || status === 'cancelled') return 'warning';
  if (status === 'running') return 'ongoing';
  if (status === 'completed') return 'done';
  if (status === 'failed') return 'error';
  return 'warning';
}

function formatElapsedSeconds(seconds) {
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function resolveAgentIcon(data) {
  const explicit = safeHttpsIconUrl(data?.agentIcon);
  if (explicit) return explicit;
  const candidates = [data?.baseAgentId, data?.agentId]
    .map((id) => (typeof id === 'string' ? id.trim().toLowerCase() : ''))
    .filter(Boolean);
  for (const id of candidates) {
    const exact = ADD_PROVIDER_CARDS.find((card) => card.id === id);
    if (exact?.icon) return safeHttpsIconUrl(exact.icon);
  }
  for (const id of candidates) {
    const prefixed = ADD_PROVIDER_CARDS.find((card) => id.startsWith(`${card.id}-`));
    if (prefixed?.icon) return safeHttpsIconUrl(prefixed.icon);
  }
  return null;
}

export function buildDelegationViewModel(data, now, t) {
  const status = delegationStatusOf(data?.stopReason);
  const startedAt = Number(data?.startedAt);
  const endedAt = Number(data?.endedAt);
  const endTime = Number.isFinite(endedAt) && endedAt > 0 ? endedAt : now;
  const seconds =
    Number.isFinite(startedAt) && startedAt > 0
      ? Math.max(0, Math.floor((endTime - startedAt) / 1000))
      : 0;
  const elapsed = formatElapsedSeconds(seconds);
  const model = data?.modelName || data?.model || '';
  const agentName = String(data?.agentName || data?.agentId || '').replace(/\s*[（(]反重力[）)]/g, '').trim();
  const interactionKind = data?.pendingInteraction?.kind;
  const pendingLabel = data?.pendingInteraction
    ? WAITING_INTERACTION_KINDS.has(interactionKind)
      ? t(`delegate.waiting_${interactionKind}`)
      : t('delegate.running')
    : null;
  const quiet = status === 'running' && data?.quiet;
  const stateLabel = pendingLabel || (quiet ? t('delegate.awaiting_activity') : t(`delegate.${status}`));
  const details = [
    t('delegate.child'),
    agentName,
    model,
    data?.task,
    stateLabel,
    elapsed,
    status === 'running' && data?.usagePending ? t('delegate.usage_pending') : null,
    data?.lastActivityAt ? `${t('delegate.last_activity')}: ${new Date(data.lastActivityAt).toLocaleTimeString()}` : null,
    ...(data?.activeTools || []).map((tool) => tool.title),
    data?.diagnostic || data?.preview,
  ]
    .filter(Boolean)
    .join(' · ');
  return {
    status,
    dotState: delegationStateDot(status, quiet, pendingLabel),
    agentName,
    model,
    stateLabel,
    elapsedText: status === 'running' && data?.usagePending ? `${elapsed} · ${t('delegate.usage_pending')}` : elapsed,
    taskText: status === 'failed' ? data?.diagnostic || data?.task : data?.task,
    details,
  };
}

export function DelegationRow({ node, openChild, readStatus, t }) {
  const [recoveredState, setRecoveredState] = useState(null);
  const recovered = recoveredState && recoveredState.runId === node.data.runId ? recoveredState.value : null;
  const useRecovered =
    recovered
    && !node.data.endedAt
    && (recovered.endedAt || (recovered.lastActivityAt || 0) > (node.data.lastActivityAt || 0));
  const data = { ...node.data, ...(useRecovered ? recovered : {}) };

  useEffect(() => {
    setRecoveredState((cur) => (cur && cur.runId === node.data.runId ? cur : null));
    if (node.data.endedAt || !readStatus) return undefined;
    let active = true;
    readStatus(node.data)
      .then((value) => {
        if (active && value && (!value.runId || value.runId === node.data.runId)) {
          setRecoveredState({ runId: node.data.runId, value });
        }
      })
      .catch((error) => console.warn('[dsh-acp-agents] Unable to read child status', error));
    return () => {
      active = false;
    };
  }, [node.data.runId, node.data.endedAt, readStatus]);

  const [now, setNow] = useState(Date.now);
  const [failedIconUrl, setFailedIconUrl] = useState(null);
  const agentIcon = resolveAgentIcon(data);
  const iconFailed = Boolean(agentIcon && failedIconUrl === agentIcon);
  const vm = buildDelegationViewModel(data, now, t);

  useEffect(() => {
    if (vm.status !== 'running') return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [vm.status]);

  return h(
    'section',
    { className: 'dsh-acp-child', 'data-acp-delegation': data.childId, 'data-status': vm.status },
    h(
      'button',
      {
        type: 'button',
        className: 'dsh-acp-child-open',
        onClick: () => openChild(data.childId),
        title: vm.details,
        'aria-label': `${t('delegate.open')} · ${vm.details}`,
      },
      h(
        'span',
        { className: 'dsh-acp-child-icon', 'aria-hidden': true },
        agentIcon && !iconFailed
          ? h('img', {
              src: agentIcon,
              alt: '',
              decoding: 'async',
              referrerPolicy: 'no-referrer',
              onError: () => setFailedIconUrl(agentIcon),
            })
          : h(IconAgentPresetOutlineRegular, { size: 16 }),
      ),
      h(
        'span',
        { className: 'dsh-acp-child-identity' },
        h('span', { className: 'dsh-acp-child-agent' }, vm.agentName),
        h('span', { className: 'dsh-acp-child-model' }, vm.model),
      ),
      h('span', { className: 'dsh-acp-child-task' }, vm.taskText),
      h(
        'span',
        { className: 'dsh-acp-child-status', 'aria-live': 'polite' },
        h(StateDot, { state: vm.dotState, size: 6 }),
        vm.stateLabel,
      ),
      h('span', { className: 'dsh-acp-child-elapsed' }, vm.elapsedText),
      h(IconChevronRightOutlineRegular, { size: 12 }),
    ),
  );
}
