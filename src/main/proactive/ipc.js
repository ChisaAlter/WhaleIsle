'use strict';

function createProactiveIpc({ runtime, scheduler }) {
  if (!runtime || !scheduler) throw new TypeError('createProactiveIpc needs runtime and scheduler');

  async function dispatch(action, payload = {}) {
    switch (action) {
      case 'task/create': return runtime.createTask(payload);
      case 'task/transition': return runtime.transition(payload.taskId, payload.state, payload);
      case 'task/get': return runtime.getTask(payload.taskId);
      case 'inbox/list': return runtime.listInbox();
      case 'outbox/list': return runtime.listOutbox();
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
