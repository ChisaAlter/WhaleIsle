/**
 * WhaleIsle Projects — Host plugin entry point.
 *
 * Mounts:
 * - `projects` service (`ctx.provide('projects', service)`) for `dsh-task-control` & `dsh-whale`
 * - Dynamic coordinator system prompt section (`projects:coordinator`, order 700)
 * - Lightweight compatibility aliases for legacy Project preset ids
 * - `/projects-api` HTTP + SSE routes
 * - The 8 `projects_*` agent tools
 * - `subagent/end` settlement listener
 */
import z from '@deepseek-ai/schemastery';
import { internalSecret } from './internal-secret.mjs';
import { registerProjectsHttp } from './http.js';
import {
  COORDINATOR_CONTEXT_NAME,
  COORDINATOR_CONTEXT_ORDER,
  COORDINATOR_SECTION_NAME,
  COORDINATOR_SECTION_ORDER,
} from './runner.js';
import { messageOf } from './schema.js';
import { createWorkerScopeGuard } from './scope-guard.js';
import { ProjectService } from './service.js';
import { registerProjectTools } from './tools.js';

export const name = 'dsh-project';
export const inject = ['tools'];
export const Config = z.object({});

const LEGACY_PRESET_ALIASES = Object.freeze([
  'project-coordinator',
  'project-worker',
  'project-worker-readonly',
  'project-worker-research',
  'project-worker-docs',
  'project-worker-development',
]);

function createDesktopBridge() {
  return async (action, payload = {}) => {
    const base = process.env.DSH_DESKTOP_INSTALL_URL;
    const token = internalSecret('DSH_DESKTOP_INSTALL_TOKEN');
    if (!base || !token) {
      const error = new Error('Project desktop bridge is unavailable.');
      error.status = 503;
      throw error;
    }
    const response = await fetch(new URL('/desktop/project', base), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ action, ...payload }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.ok === false) {
      const error = new Error(result.error || `Project desktop request failed (${response.status}).`);
      error.status = response.ok ? 500 : response.status;
      throw error;
    }
    return result;
  };
}

function registerLegacyPresetAliases(ctx) {
  ctx.inject(['agentPresets'], async (presetCtx) => {
    const registry = presetCtx.agentPresets;
    if (!registry || typeof registry.register !== 'function') return;
    let existing = new Set();
    try {
      if (typeof registry.list === 'function') {
        const rows = await registry.list();
        existing = new Set((Array.isArray(rows) ? rows : []).map((row) => row?.id).filter(Boolean));
      }
    } catch {
      existing = new Set();
    }
    for (const id of LEGACY_PRESET_ALIASES) {
      if (existing.has(id)) continue;
      try {
        const dispose = await registry.register({
          id,
          name: `Legacy ${id}`,
          hidden: true,
          plugins: [],
        });
        if (typeof dispose === 'function') {
          presetCtx.effect(() => dispose, `dsh-project: legacy preset alias ${id}`);
        }
      } catch (error) {
        console.warn(`dsh-project: could not register legacy preset alias ${id}: ${messageOf(error)}`);
      }
    }
  });
}

export function apply(ctx) {
  const service = new ProjectService(ctx, {
    home: process.env.DSH_HOME || process.env.DSHD_HOME || '',
    desktop: createDesktopBridge(),
  });

  ctx.provide('projects', service);

  ctx.effect(() => () => {
    service.dispose();
  }, 'dsh-project: dispose workers and permits');

  ctx.inject(['systemPrompt'], (promptCtx) => {
    try {
      promptCtx.effect(
        () =>
          promptCtx.systemPrompt.section({
            name: COORDINATOR_SECTION_NAME,
            order: COORDINATOR_SECTION_ORDER,
            interpolate: false,
            text: (context) => service.runner.coordinatorSectionFor(context),
          }),
        'dsh-project: coordinator system prompt section',
      );
      if (typeof promptCtx.systemPrompt.context === 'function') {
        promptCtx.effect(
          () =>
            promptCtx.systemPrompt.context({
              name: COORDINATOR_CONTEXT_NAME,
              order: COORDINATOR_CONTEXT_ORDER,
              interpolate: false,
              required: true,
              text: (context) => service.runner.coordinatorDynamicContextFor(context),
            }),
          'dsh-project: coordinator dynamic runtime context',
        );
      } else {
        promptCtx.effect(
          () =>
            promptCtx.systemPrompt.section({
              name: COORDINATOR_CONTEXT_NAME,
              order: COORDINATOR_SECTION_ORDER + 50,
              interpolate: false,
              text: (context) => service.runner.coordinatorDynamicContextFor(context),
            }),
          'dsh-project: coordinator dynamic runtime section fallback',
        );
      }
    } catch (error) {
      console.warn(`dsh-project: could not register coordinator prompt section: ${messageOf(error)}`);
    }
  });

  if (typeof ctx.tools?.guard === 'function') {
    try {
      const disposeGuard = ctx.tools.guard(createWorkerScopeGuard(service));
      if (typeof disposeGuard === 'function') {
        ctx.effect(() => disposeGuard, 'dsh-project: worker scopeCeiling guard');
      }
    } catch (error) {
      console.warn(`dsh-project: could not register worker scope guard: ${messageOf(error)}`);
    }
  }

  registerLegacyPresetAliases(ctx);
  registerProjectsHttp(ctx, service);
  registerProjectTools(ctx, service);

  if (typeof ctx.on === 'function') {
    try {
      ctx.on('subagent/end', (info) => {
        void service.settleWorker(info).catch((error) => {
          console.warn(`dsh-project: could not settle worker ${info?.id}: ${messageOf(error)}`);
        });
      });
    } catch (error) {
      console.warn(`dsh-project: subagent/end listener unavailable: ${messageOf(error)}`);
    }
  }
}

export { ProjectService };
