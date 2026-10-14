import { defineTool } from '@deepseek-ai/dsh-tools';
/** Runtime lookup avoids a role-mount/recovery dependency cycle. */
export function projectTool(ctx, { name, description, parameters, method, finish = false }) {
  ctx.tools.register(defineTool({ name, description, parameters, timeoutMs: 60000,
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute(args, exec) {
      const service = ctx.get('projects');
      if (!service?.available) throw new Error(service?.error || 'Project Host is unavailable.');
      const result = await service[method](service.actor(exec.agent), args, exec);
      if (finish) exec.concludeTurn();
      return result;
    },
  }));
}
