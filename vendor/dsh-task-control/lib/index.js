/**
 * dsh-task-control — desktop-owned Host plugin implementing the task
 * admission lock and work inspection behind the Whale Isle quit/update
 * protection flow.
 *
 * Admission surface: every webServer route (present and future registrations,
 * HTTP and upgrade) is gated while a lock is held; the connection `/api`
 * waterfall carries a second gate because that route predates this plugin in
 * the composition. `sessionController.resolveAgent` and `jobs.start` are
 * wrapped so Schedule delivery, IM channels, and Typert lookups cannot start
 * work while locked — delivery refusals keep schedules armed for the next
 * window, which `onUnlock` re-drives.
 *
 * Control surface: `POST /dshd-task-control/<inspect|acquire|renew|release|
 * cancel|status>` gated by the per-boot Bearer token the desktop delivers
 * over the host's stdin secret channel (#427) as `DSHD_TASK_CONTROL_TOKEN`
 * in the in-process store. No token → the route stays closed.
 */

import { internalSecret } from '../../dsh-shared/lib/internal-secret.mjs';
import { admit, createControlState, lockStatus } from './state.js';
import { CONTROL_PREFIX, createControlHandler } from './http.js';
import { admittedBefore, disposeGuards, markAdmitted, undrained, wrapJobs, wrapSessionController, wrapWebServer } from './wrap.js';

export const name = 'dsh-task-control';
/** @type {string[]} */
export const inject = [];

/** @param {import('@deepseek-ai/cordis').Context} ctx */
export function apply(ctx) {
  const state = createControlState();
  const token = internalSecret('DSHD_TASK_CONTROL_TOKEN');
  /** @type {Array<{ webServer: any, route: any, dispose: () => void }>} */
  const controlRoutes = [];
  ctx.provide('desktopTaskAdmission', {
    /** @param {string} label */
    begin(label) {
      const permit = admit(state, label);
      if (!permit.accepted) throw new Error(permit.code);
      const epoch = state.lockEpoch;
      return { done: permit.done, assertCurrent() {
        const current = lockStatus(state);
        if (current.stopping || current.locked || current.lockEpoch !== epoch) throw new Error('桌面正在停止或维护，任务准入已失效。');
      } };
    },
    check() { const current = lockStatus(state); return !current.locked && !current.stopping; },
  });

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
            // Refused schedule deliveries and Project queues stay armed; re-drive both
            // so an unlocked Host dispatches them immediately instead of stalling.
            const schedule = ctx.get('schedule');
            try {
              schedule?.runtime?.requestDrive?.();
            } catch (error) {
              ctx.logger?.warn?.(`task-control: schedule re-drive failed: ${String(error)}`);
            }
            const projects = ctx.get('projects');
            try {
              projects?.schedule?.();
            } catch (error) {
              ctx.logger?.warn?.(`task-control: project schedule re-drive failed: ${String(error)}`);
            }
          },
        }),
      };
      controlRoutes.push({ webServer, route, dispose: webServer.register(route) });
    }
  };

  installGuards();
  ctx.on('internal/service', (/** @type {string} */ serviceName) => {
    if (serviceName === 'webServer' || serviceName === 'sessionController' || serviceName === 'jobs') {
      installGuards();
    }
  });

  // Second gate on the /api waterfall: the connection route was registered
  // before this plugin loaded, so it cannot be gated solely by the wrapped
  // registration path in compositions where the route table is rebuilt.
  // 'connection/request' is a desktop-emitted event absent from cordis's
  // built-in Events map, so the name is cast for the overload check.
  ctx.on(/** @type {any} */ ('connection/request'), async (/** @type {any} */ request, /** @type {any} */ response, /** @type {() => Promise<any>} */ next) => {
    if (admittedBefore(request)) return next();
    const admission = admit(state, `conn ${request.method} ${request.url}`);
    if (!admission.accepted) {
      response.writeHead(503, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ error: { code: admission.code } }));
      return;
    }
    markAdmitted(request);
    if (undrained(request)) {
      admission.done();
      return next();
    }
    try {
      await next();
    } finally {
      admission.done();
    }
  });
}
