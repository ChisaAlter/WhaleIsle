import {
  h,
  useState,
  useEffect,
  StateDot,
  IconAgentPresetOutlineRegular,
  IconChevronRightOutlineRegular,
} from './primitives.js';
import { ADD_PROVIDER_CARDS } from './utils.js';

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
    const abandoned = ['interrupted', 'forked'].includes(context.start.location.turn?.end?.data.reason.kind);
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

function buildDelegationViewModel(data, now, t) {
  const status = delegationStatusOf(data.stopReason);
  const seconds = Math.max(0, Math.floor(((data.endedAt || now) - data.startedAt) / 1000));
  const elapsed = formatElapsedSeconds(seconds);
  const model = data.modelName || data.model;
  const agentName = data.agentName.replace(/\s*[（(]反重力[）)]/g, '').trim();
  const pendingLabel = data.pendingInteraction ? t(`delegate.waiting_${data.pendingInteraction.kind}`) : null;
  const quiet = status === 'running' && data.quiet;
  const stateLabel = pendingLabel || (quiet ? t('delegate.awaiting_activity') : t(`delegate.${status}`));
  const details = [
    t('delegate.child'),
    agentName,
    model,
    data.task,
    stateLabel,
    elapsed,
    status === 'running' && data.usagePending ? t('delegate.usage_pending') : null,
    data.lastActivityAt ? `${t('delegate.last_activity')}: ${new Date(data.lastActivityAt).toLocaleTimeString()}` : null,
    ...(data.activeTools || []).map((tool) => tool.title),
    data.diagnostic || data.preview,
  ]
    .filter(Boolean)
    .join(' · ');
  return {
    status,
    dotState: delegationStateDot(status, quiet, pendingLabel),
    agentName,
    model,
    stateLabel,
    elapsedText: status === 'running' && data.usagePending ? `${elapsed} · ${t('delegate.usage_pending')}` : elapsed,
    taskText: status === 'failed' ? data.diagnostic || data.task : data.task,
    details,
  };
}

export function DelegationRow({ node, openChild, readStatus, t }) {
  const [recovered, setRecovered] = useState(null);
  const useRecovered =
    recovered
    && !node.data.endedAt
    && (recovered.endedAt || (recovered.lastActivityAt || 0) > (node.data.lastActivityAt || 0));
  const data = { ...node.data, ...(useRecovered ? recovered : {}) };

  useEffect(() => {
    if (node.data.endedAt || !readStatus) return undefined;
    let active = true;
    readStatus(node.data)
      .then((value) => {
        if (active && value) setRecovered(value);
      })
      .catch((error) => console.warn('Unable to read child status', error));
    return () => {
      active = false;
    };
  }, [node.data.runId, node.data.endedAt, readStatus]);

  const [now, setNow] = useState(Date.now);
  const [iconFailed, setIconFailed] = useState(false);
  const agentIcon = ADD_PROVIDER_CARDS.find((agent) => agent.id === data.agentId)?.icon;
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
          ? h('img', { src: agentIcon, alt: '', onError: () => setIconFailed(true) })
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
