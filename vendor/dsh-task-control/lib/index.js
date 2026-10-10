/**
 * dsh-task-control — desktop-owned Host plugin implementing the task
 * admission lock and work inspection behind the Whale Isle quit/update
 * protection flow.
 *
 * Admission surface: every webServer route (present and future registrations,
 * HTTP and upgrade) is gated while a lock is held; the connection `/api`
 * waterfall carries a second gate because that route predates this plugin in
 * the composition. `sessionController.resolveAgent` and `jobs.start` are
 * wrapped so Schedule delivery, dshbot routines, IM channels, and Typert
 * lookups cannot start work while locked — delivery refusals keep the armed
 * schedule/bot state for the next window, which `onUnlock` re-drives.
 *
 * Control surface: `POST /dshd-task-control/<inspect|acquire|renew|release|
 * cancel|status>` gated by the per-boot Bearer token from
 * `DSHD_TASK_CONTROL_TOKEN`. No token → the route stays closed.
 */

import { admit, createControlState } from './state.js';
import { CONTROL_PREFIX, createControlHandler } from './http.js';
import { disposeGuards, wrapJobs, wrapSessionController, wrapWebServer } from './wrap.js';

export const name = 'dsh-task-control';
export const inject = [];

/** @param {import('@deepseek-ai/cordis').Context} ctx */
export function apply(ctx) {
  const state = createControlState();
  const token = String(process.env.DSHD_TASK_CONTROL_TOKEN || '');
  const controlRoutes = [];

  ctx.effect(() => () => {
    state.stopping = true;
    for (const { webServer, route, dispose } of controlRoutes) {
      // A later owner may have replaced this path after unregistering our row.
      // Its registration must survive disposal of this plugin.
      if (webServer.prefixes.get(CONTROL_PREFIX) === route) dispose();
    }
    disposeGuards(state);
  }, 'dsh-task-control.lifecycle');

  const installGuards = () => {
    if (state.stopping) return;
    wrapSessionController(state, ctx.get('sessionController'));
    wrapJobs(state, ctx.get('jobs'));
    const webServer = ctx.get('webServer');
    if (wrapWebServer(state, webServer)) {
      const route = {
        kind: 'prefix',
        path: CONTROL_PREFIX,
        handler: createControlHandler(ctx, state, {
          token,
          onUnlock() {
            // Refused schedule deliveries stay armed; re-drive the runtime so
            // an unlocked Host dispatches them at the next window instead of
            // waiting for the next registration-side trigger.
            const schedule = ctx.get('schedule');
            try {
              schedule?.runtime?.requestDrive?.();
            } catch (error) {
              ctx.logger?.warn?.(`task-control: schedule re-drive failed: ${String(error)}`);
            }
          },
        }),
      };
      controlRoutes.push({ webServer, route, dispose: webServer.register(route) });
    }
  };

  installGuards();
  ctx.on('internal/service', (serviceName) => {
    if (serviceName === 'webServer' || serviceName === 'sessionController' || serviceName === 'jobs') {
      installGuards();
    }
  });

  // Second gate on the /api waterfall: the connection route was registered
  // before this plugin loaded, so it cannot be gated solely by the wrapped
  // registration path in compositions where the route table is rebuilt.
  ctx.on('connection/request', async (request, response, next) => {
    const admission = admit(state, `conn ${request.method} ${request.url}`);
    if (!admission.accepted) {
      response.writeHead(503, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ error: { code: admission.code } }));
      return;
    }
    try {
      await next();
    } finally {
      admission.done();
    }
  });
}
