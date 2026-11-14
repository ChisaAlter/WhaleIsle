'use strict';

function createProactiveIpc({ runtime, scheduler, sources = {} }) {
  if (!runtime || !scheduler) throw new TypeError('createProactiveIpc needs runtime and scheduler');

  async function dispatch(action, payload = {}) {
    switch (action) {
      case 'task/create': return runtime.createTask(payload);
      case 'task/transition': return runtime.transition(payload.taskId, payload.state, payload);
      case 'task/get': return runtime.getTask(payload.taskId);
      case 'trace/list':
      case 'task/trace': return runtime.listExecutionTrace(payload);
      case 'inbox/list': return runtime.listInbox();
      case 'outbox/list': return runtime.listOutbox();
      case 'source/state':
      case 'source/state/list': return runtime.listSourceState();
      case 'source/github/sync': {
        const github = sources.github;
        if (!github || (typeof github.sync !== 'function' && typeof github.discover !== 'function')) {
          throw Object.assign(new Error('GitHub source unavailable'), { code: 'proactive/source-unavailable' });
        }
        if (typeof github.sync === 'function') return github.sync(payload);
        const items = await github.discover(payload);
        return runtime.ingestSourceItems(items, {
          source: 'github',
          autonomy: payload.autonomy,
          cursor: payload.cursor ?? payload.since ?? null,
        });
      }
      case 'approval/request': return runtime.requestApproval(payload.taskId, payload);
      case 'approval/decide': return runtime.decideApproval(payload.approvalId, payload.decision, payload);
      case 'schedule/create': return scheduler.schedule(payload.taskId, payload);
      case 'schedule/cancel': return scheduler.cancel(payload.jobId);
      case 'schedule/list': return scheduler.list();
      case 'schedule/poll': return scheduler.poll(payload.at);
      default: throw Object.assign(new Error(`Unknown proactive action: ${action}`), { code: 'proactive/unknown-action' });
    }
  }

  return { dispatch };
}

module.exports = { createProactiveIpc };
