/**
 * Admission guards installed on Host services. webServer route registration is
 * wrapped so every plugin route — including rows registered before this plugin
 * loaded — passes through the admission check; the task-admission chokepoints
 * (`sessionController.resolveAgent`, `jobs.start`) reject while locked so
 * Schedule/Bot/IM timer producers cannot sneak work past an HTTP-only lock.
 */

import { admit } from './state.js';
import { CONTROL_PREFIX } from './http.js';

const WRAPPED = Symbol.for('dsh-task-control.wrapped');
const ORIGINAL = Symbol.for('cordis.original');
const GATE_TYPES = new Set(['agent', 'job', 'schedule-task', 'socket', 'request', 'resume']);
const guardsByState = new WeakMap();

function replaceOwnedProperty(guard, target, key, value) {
  const original = Object.getOwnPropertyDescriptor(target, key);
  target[key] = value;
  guard.restores.push(() => {
    if (target[key] !== value) return;
    if (original) Object.defineProperty(target, key, original);
    else delete target[key];
  });
}

function createGuard(state, target) {
  const guard = { active: true, restores: [] };
  replaceOwnedProperty(guard, target, WRAPPED, guard);
  let guards = guardsByState.get(state);
  if (!guards) guardsByState.set(state, guards = []);
  guards.push(guard);
  return guard;
}

/** Remove only this state's guards, leaving later owners' replacements intact. */
export function disposeGuards(state) {
  const guards = guardsByState.get(state) || [];
  guardsByState.delete(state);
  // Later wrappers may retain our functions. Those closures become transparent
  // before their slots are restored, so they never consult a disposed state.
  for (const guard of guards) guard.active = false;
  for (const guard of guards) {
    for (const restore of guard.restores.reverse()) restore();
  }
}

/** Error returned/raised when admission is refused while locked. */
export class AdmissionLockedError extends Error {
  constructor(detail) {
    super(`desktop task admission locked${detail ? `: ${detail}` : ''}`);
    this.name = 'AdmissionLockedError';
    this.code = 'session/agent-busy';
    this.admissionCode = 'dshd/admission-locked';
  }
}

function exempt(path) {
  return path === CONTROL_PREFIX || path.startsWith(`${CONTROL_PREFIX}/`);
}

function gateHttpHandler(state, guard, path, handler) {
  return async function gatedRoute(req, res) {
    if (!guard.active) return handler(req, res);
    const admission = admit(state, `http ${req.method} ${req.url}`);
    if (!admission.accepted) {
      if (!res.headersSent) {
        res.writeHead(503, { 'content-type': 'application/json; charset=utf-8' });
      }
      res.end(JSON.stringify({ error: { code: admission.code } }));
      return;
    }
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      admission.done();
    };
    res.once('close', done);
    try {
      return await handler(req, res);
    } finally {
      done();
    }
  };
}

function gateUpgradeHandler(state, guard, path, handler) {
  return function gatedUpgrade(req, socket, head) {
    if (!guard.active) return handler(req, socket, head);
    const admission = admit(state, `upgrade ${req.url}`);
    if (!admission.accepted) {
      try {
        socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
      } catch {
        // A half-open socket still gets destroyed below.
      }
      socket.destroy();
      return undefined;
    }
    // Upgraded sockets live as long as their transport — holding the admission
    // until close would make every lock drain time out on healthy clients.
    // Connect-time admission still 503s new upgrades while locked; work the
    // socket delivers is gated at the service chokepoints instead.
    admission.done();
    return handler(req, socket, head);
  };
}

function isReadMethod(req) {
  return req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS';
}

function wrapRouteEntry(state, guard, route, upgrade = false) {
  if (route === undefined || route[WRAPPED] || (!upgrade && exempt(route.path))) return;
  const gate = upgrade ? gateUpgradeHandler : gateHttpHandler;
  replaceOwnedProperty(guard, route, 'handler', gate(state, guard, route.path, route.handler));
  replaceOwnedProperty(guard, route, WRAPPED, guard);
}

/**
 * Wrap one WebServer instance: gate already-registered routes in place and
 * intercept future register/registerUpgrade/registerFallback calls.
 * @returns true when the wrap was applied.
 */
export function wrapWebServer(state, webServer) {
  // Cordis creates a new tracing proxy for each lookup. Track ownership on the
  // underlying instance so method identity and repeated installation are stable.
  webServer = webServer?.[ORIGINAL] || webServer;
  if (webServer === undefined || webServer === null || webServer[WRAPPED]) return false;
  if (typeof webServer.register !== 'function') return false;
  const guard = createGuard(state, webServer);

  const originalRegister = webServer.register;
  replaceOwnedProperty(guard, webServer, 'register', function registerGuarded(route) {
    if (guard.active && route) wrapRouteEntry(state, guard, route);
    return originalRegister.call(this, route);
  });
  const originalRegisterUpgrade = typeof webServer.registerUpgrade === 'function'
    ? webServer.registerUpgrade : null;
  if (originalRegisterUpgrade) {
    replaceOwnedProperty(guard, webServer, 'registerUpgrade', function registerUpgradeGuarded(route) {
      if (guard.active && route) wrapRouteEntry(state, guard, route, true);
      return originalRegisterUpgrade.call(this, route);
    });
  }
  const originalRegisterFallback = typeof webServer.registerFallback === 'function'
    ? webServer.registerFallback : null;
  if (originalRegisterFallback) {
    replaceOwnedProperty(guard, webServer, 'registerFallback', function registerFallbackGuarded(handler) {
      const gated = guard.active ? gateFallback(state, guard, handler) : handler;
      const dispose = originalRegisterFallback.call(this, gated);
      if (guard.active) {
        guard.restores.push(() => {
          if (webServer.fallback === gated) webServer.fallback = handler;
        });
      }
      return dispose;
    });
  }

  // Routes registered before this plugin loaded (e.g. the connection `/api`
  // prefix and the gateway upgrade row) escape the wrapped register calls;
  // rewrite their handler slots in place.
  if (webServer.prefixes instanceof Map) {
    for (const route of webServer.prefixes.values()) wrapRouteEntry(state, guard, route);
  }
  if (webServer.exact instanceof Map) {
    for (const route of webServer.exact.values()) wrapRouteEntry(state, guard, route);
  }
  if (webServer.upgrades instanceof Map) {
    for (const route of webServer.upgrades.values()) wrapRouteEntry(state, guard, route, true);
  }
  if (typeof webServer.fallback === 'function' && !webServer.fallback[WRAPPED]) {
    replaceOwnedProperty(guard, webServer, 'fallback', gateFallback(state, guard, webServer.fallback));
  }
  return true;
}

function gateFallback(state, guard, handler) {
  const gated = async function gatedFallback(req, res) {
    if (!guard.active) return handler(req, res);
    // The fallback serves SPA assets; locking it would white-out a visible
    // window during the confirmation wait. Mutating methods on unmatched
    // paths are still gated — they are not reads.
    if (isReadMethod(req)) return handler(req, res);
    const admission = admit(state, `fallback ${req.method} ${req.url}`);
    if (!admission.accepted) {
      res.writeHead(503, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: { code: admission.code } }));
      return undefined;
    }
    return Promise.resolve(handler(req, res)).finally(() => admission.done());
  };
  replaceOwnedProperty(guard, gated, WRAPPED, guard);
  return gated;
}

/**
 * Wrap the Agent-resolution chokepoint shared by Schedule delivery, dshbot
 * routines, IM channels, and Typert lookups. Locked calls fail with the
 * stable `session/agent-busy` result shape so producers keep their armed
 * state instead of crashing.
 */
export function wrapSessionController(state, sessionController) {
  sessionController = sessionController?.[ORIGINAL] || sessionController;
  if (sessionController === undefined || sessionController === null
    || sessionController[WRAPPED]) return false;
  const original = sessionController.resolveAgent;
  if (typeof original !== 'function') return false;
  const guard = createGuard(state, sessionController);
  replaceOwnedProperty(guard, sessionController, 'resolveAgent', async function resolveAgentGuarded(...args) {
    if (!guard.active) return original.apply(this, args);
    const admission = admit(state, 'resolveAgent');
    if (!admission.accepted) {
      return { error: new AdmissionLockedError('session resolution refused while locked') };
    }
    try {
      return await original.apply(this, args);
    } finally {
      admission.done();
    }
  });
  return true;
}

/** Wrap `jobs.start` so background-job producers cannot start during a lock. */
export function wrapJobs(state, jobs) {
  jobs = jobs?.[ORIGINAL] || jobs;
  if (jobs === undefined || jobs === null || jobs[WRAPPED]) return false;
  const original = jobs.start;
  if (typeof original !== 'function') return false;
  const guard = createGuard(state, jobs);
  replaceOwnedProperty(guard, jobs, 'start', function jobsStartGuarded(...args) {
    if (!guard.active) return original.apply(this, args);
    const admission = admit(state, 'jobs.start');
    if (!admission.accepted) {
      throw new AdmissionLockedError('job start refused while locked');
    }
    try {
      // JobRegistry.start is synchronous: shell consumers immediately use
      // its returned JobId in wait/read/kill. Active jobs are inspected
      // separately; admission tracks only this registration operation.
      return original.apply(this, args);
    } finally {
      admission.done();
    }
  });
  return true;
}

export const internals = { WRAPPED, GATE_TYPES };
