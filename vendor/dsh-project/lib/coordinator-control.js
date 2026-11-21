/** Coordinator subagent control wrapper: exposes list_agents/send_message while omitting wait_agent. */
import * as control from '@deepseek-ai/dsh-tool-subagent-control';
import z from '@deepseek-ai/schemastery';

export const name = 'project-coordinator-control';
export const inject = ['tools', 'subagents', 'agents', 'systemPrompt'];
export const Config = z.object({
  interrupt: z.boolean().default(false),
});

export function apply(ctx, config = { interrupt: false }) {
  const tools = new Proxy(ctx.tools, {
    get(target, prop, receiver) {
      if (prop === 'register') {
        return (tool, ...rest) => (tool?.name === 'wait_agent' ? (() => {}) : target.register(tool, ...rest));
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const scoped = new Proxy(ctx, {
    get(target, prop, receiver) {
      if (prop === 'tools') return tools;
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return control.apply(scoped, { interrupt: config.interrupt === true });
}
