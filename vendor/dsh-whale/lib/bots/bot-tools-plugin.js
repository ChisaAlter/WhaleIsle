/**
 * `dsh-whale/bot-tools` — preset-scoped tool plugin mounted by `dsh-bot`.
 * Registers native `bot_*` tools without mounting legacy conflicting `whale_*` tools.
 */
import z from '@deepseek-ai/schemastery';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { registerBotTools } from './bot-tools-registry.js';

export const name = 'dsh-whale-bot-tools';
export const inject = ['tools'];
export const Config = z.object({});

/** @param {any} ctx */
export function apply(ctx) {
  const dispose = registerBotTools(ctx, { defineTool });
  ctx.effect?.(() => dispose, 'dsh-whale:bot-tools');
}
