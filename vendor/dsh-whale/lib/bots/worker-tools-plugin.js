/**
 * `dsh-whale/worker-tools` — preset-scoped tool plugin mounted by `dsh-bot-worker`.
 * Exposes ONLY worker-safe reporting/lookup tools and strips orchestration,
 * external reply, automation, and MCP-management tools.
 */
import z from '@deepseek-ai/schemastery';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { WORKER_ALLOWED_TOOLS, registerWorkerTools } from './bot-tools-registry.js';

export const name = 'dsh-whale-worker-tools';
export const inject = ['tools'];
export const Config = z.object({});

export { WORKER_ALLOWED_TOOLS, registerWorkerTools };

/** @param {any} ctx */
export function apply(ctx) {
  const dispose = registerWorkerTools(ctx, { defineTool });
  ctx.effect?.(() => dispose, 'dsh-whale:worker-tools');
}
