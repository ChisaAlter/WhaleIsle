/**
 * Work inspection for task control: aggregates the same active-task
 * predicate as upstream `hasDesktopActiveTasks` plus Host-independent
 * producers (schedule catalog, upgraded sockets, admitted-but-unsettled
 * requests). Coverage marks a producer
 * `intentional-disabled` only when the desktop composition declares it off;
 * anything else unreadable reports `unavailable`, which the shell treats as
 * blocking for unattended commits.
 */

import { BlockList, isIP } from 'node:net';

const LOOPBACK = new BlockList();
LOOPBACK.addSubnet('127.0.0.0', 8, 'ipv4');
LOOPBACK.addAddress('::1', 'ipv6');

// ScheduleRecord.kind discriminators; 'after'/'at' are one-shots.
const RECURRING_KINDS = new Set(['every', 'daily', 'weekly', 'cron']);

function envFlag(name) {
  const value = process.env[name];
  return value === '1' || value === 'true';
}

function hasAgentWork(agent) {
  return agent.status === 'running'
    || (agent.inbox && (agent.inbox.nextTurn.length > 0 || agent.inbox.nextStep.length > 0));
}

function collectAgents(agents, activeWork, coverage) {
  if (agents === undefined || agents === null || typeof agents.list !== 'function') {
    coverage.agents = 'unavailable';
    return [];
  }
  coverage.agents = 'ok';
  let list = [];
  try {
    list = agents.list();
  } catch {
    coverage.agents = 'unavailable';
    return [];
  }
  for (const agent of list) {
    if (hasAgentWork(agent)) {
      activeWork.push({
        kind: 'agent',
        id: String(agent.id),
        detail: agent.status === 'running' ? 'running' : 'queued-inbox',
      });
    }
  }
  return list;
}

function collectJobs(jobs, liveAgents, activeWork, coverage) {
  if (jobs === undefined || jobs === null || typeof jobs.list !== 'function') {
    coverage.jobs = 'unavailable';
    return;
  }
  coverage.jobs = 'ok';
  try {
    for (const owner of [undefined, ...liveAgents]) {
      for (const job of jobs.list(owner?.id)) {
        if (job.status === 'running' || job.status === 'stopping') {
          activeWork.push({
            kind: 'job',
            id: String(job.id ?? job.spec?.id ?? 'job'),
            owner: owner === undefined ? 'host' : `agent:${String(owner.id)}`,
            detail: job.status,
          });
        }
      }
    }
  } catch {
    coverage.jobs = 'unavailable';
  }
}

function isRecurringRecord(record) {
  return RECURRING_KINDS.has(record.kind);
}

async function collectSchedule(ctx, scheduledWork, coverage) {
  // The desktop declares schedule off by not passing DSHD_SCHEDULE_ENABLED;
  // per the coverage contract that is `intentional-disabled`, not damage.
  // Schedule is a built-in of the web bundle — when declared on, a missing
  // service is runtime damage, so coverage fails closed as `unavailable` and
  // blocks unattended commits rather than reading as a deliberate opt-out.
  if (!envFlag('DSHD_SCHEDULE_ENABLED')) {
    coverage.schedule = 'intentional-disabled';
    return;
  }
  const schedule = ctx.get('schedule');
  if (schedule === undefined || schedule === null || typeof schedule.catalog !== 'function') {
    coverage.schedule = 'unavailable';
    return;
  }
  let entries = [];
  try {
    entries = await schedule.catalog();
  } catch {
    coverage.schedule = 'unavailable';
    return;
  }
  coverage.schedule = 'ok';
  const now = Date.now();
  for (const entry of entries) {
    if (entry.status !== 'active') continue;
    const scheduledAt = Date.parse(String(entry.scheduledAt || '')) || 0;
    scheduledWork.push({
      kind: 'schedule-task',
      id: String(entry.id),
      sessionId: String(entry.sessionId ?? ''),
      title: typeof entry.title === 'string' ? entry.title : '',
      due: scheduledAt <= now,
      recurring: isRecurringRecord(entry),
      scheduledAt: Number.isFinite(scheduledAt) ? new Date(scheduledAt).toISOString() : '',
    });
  }
}

function collectSockets(webServer, activeWork) {
  const sockets = webServer && webServer.upgradedSockets;
  if (!(sockets instanceof Set)) return 0;
  let count = 0;
  for (const socket of sockets) {
    if (socket?.destroyed === true) continue;
    const address = socket?.remoteAddress;
    const family = typeof address === 'string' ? isIP(address) : 0;
    // Local UI/account streams are idle transports, not remote user work.
    // BlockList also recognizes IPv4-mapped IPv6; unknown peers stay counted.
    if (family && LOOPBACK.check(address, family === 4 ? 'ipv4' : 'ipv6')) continue;
    count++;
  }
  if (count > 0) activeWork.push({ kind: 'socket', id: 'upgraded-sockets', count });
  return count;
}

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {ReturnType<import('./state.js').createControlState>} state
 * @param {{ now?: () => number }} [options]
 */
export async function collectInspection(ctx, state, options = {}) {
  const observedAt = (options.now ?? Date.now)();
  const activeWork = [];
  const scheduledWork = [];
  const coverage = {};
  const liveAgents = collectAgents(ctx.get('agents'), activeWork, coverage);
  collectJobs(ctx.get('jobs'), liveAgents, activeWork, coverage);
  collectSockets(ctx.get('webServer'), activeWork);
  if (state.pending.size > 0) {
    activeWork.push({ kind: 'request', id: 'pending-requests', count: state.pending.size });
  }
  await collectSchedule(ctx, scheduledWork, coverage);
  return {
    ok: true,
    hostGeneration: state.hostGeneration,
    observedAt,
    locked: state.lock !== null,
    activeWork,
    scheduledWork,
    coverage,
  };
}

export const internals = { RECURRING_KINDS, envFlag };
