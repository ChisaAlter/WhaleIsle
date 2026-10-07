import { randomUUID } from 'node:crypto';
import z from '@deepseek-ai/schemastery';
import { projectDomain, initialState } from './domain.js';
import { acquireWriter } from './files.js';
import { ProjectService } from './service.js';
import { registerProjectTransport } from './transport.js';
import { registerProjectPresets } from './presets.js';
export const name = 'whale-project';
export const inject = ['storageDomain', 'sessionController', 'sessionPersistence', 'sessions', 'agents', 'subagents', 'agentPresets', 'tools', 'workspaceRegistry'];
export const Config = z.object({});

/** Optional Project failure must leave ordinary conversations available. */
export async function apply(ctx) {
  let releaseWriter, domain, service;
  ctx.effect(() => async () => {
    try { await service?.dispose?.({ persist: false }); }
    finally { try { await domain?.close(); } finally { await releaseWriter?.(); } }
  });
  try {
    const home = process.env.DSH_HOME || process.env.DSHD_HOME;
    if (!home) throw new Error('Project requires the active desktop profile DSH_HOME.');
    releaseWriter = await acquireWriter(home, randomUUID());
    domain = await ctx.storageDomain.open(projectDomain);
    const table = domain.table('state'); if (!table.get('catalog')) await table.put('catalog', structuredClone(initialState));
    const desktop = async (action, payload) => {
      const base = process.env.DSH_DESKTOP_INSTALL_URL, token = process.env.DSH_DESKTOP_INSTALL_TOKEN;
      if (!base || !token) throw new Error('Project desktop bridge is unavailable.');
      const response = await fetch(new URL('/desktop/project', base), { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ action, ...payload }) });
      const result = await response.json(); if (!response.ok || result.ok === false) throw new Error(result.error || `Project desktop request failed (${response.status}).`); return result;
    };
    service = new ProjectService(ctx, table, { home, desktop });
    // Dynamic role tool lookup works during recovery without an inject cycle.
    ctx.provide('projects', service);
    await registerProjectPresets(ctx);
    ctx.on('agent/created', async ({ agent }) => {
      const project = service.state().projects.find(item => item.coordinatorSessionId === agent.id);
      const worker = service.state().workers.find(item => item.sessionId === agent.id);
      if (project) agent.session.append('session/presentation', { owner: 'project', title: project.title, workingDirectory: project.canonicalWorkingDirectory });
      else if (worker) agent.session.append('session/presentation', { owner: 'project', title: service.stream(worker.workstreamId).title, composer: 'managed' });
    });
    ctx.on('subagent/start', info => { void service.runStarted(info).catch(error => ctx.logger.warn('Project start accounting failed: %s', error.message)); });
    ctx.on('subagent/end', info => { void service.runEnded(info).catch(error => ctx.logger.warn('Project end accounting failed: %s', error.message)); });
    ctx.on('agent/pre-step', (input, next) => service.preStep(input, next));
    ctx.on('session/event', (session, event) => { void service.assistantReply(session, event).catch(error => ctx.logger.warn('Project summary accounting failed: %s', error.message)); });
    ctx.on('session/before-cancel', ({ agent }) => service.sessionStop(agent.id));
    ctx.on('workspace/session-stop', ({ sessionId }) => service.sessionStop(sessionId));
    ctx.inject(['jobs'], host => host.effect(() => host.jobs.events.subscribe({ owners: 'all' }, event => { void service.jobChanged(event).catch(error => ctx.logger.warn('Project job observation failed: %s', error.message)); })));
    await service.recover();
  } catch (error) {
    ctx.logger.warn('Project unavailable: %s', error.message);
    if (service) { service.available = false; service.error = error.message; }
    else { service = { available: false, error: error.message, async command(endpoint) { if (endpoint === 'list') return { projects: [], available: false, error: this.error }; throw new Error(this.error); } }; ctx.provide('projects', service); }
  }
  registerProjectTransport(ctx, service);
}
