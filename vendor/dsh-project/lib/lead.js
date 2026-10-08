import { registerTeamTools } from './team-tools.js';
import { projectTool } from './tool.js';
export const name = 'project-coordinator';
export const inject = ['tools', 'systemPrompt'];
export function apply(ctx) {
  ctx.tools.presentAs('native');
  registerTeamTools(ctx);
  ctx.tools.guard(exec => {
    const service = ctx.get('projects');
    return service?.available ? service.guard(exec) : 'Project Host is unavailable.';
  });
  projectTool(ctx, { name: 'project_read_store', method: 'readStoreTool', description: 'Read notes.md, preferences.md or docs/<path> in this Project. notes contains stable workstream IDs, current requirements and pending results. No repository or internal access.', parameters: { path: { type: 'string', required: true }, query: { type: 'string' }, workstreamId: { type: 'string' }, cursor: { type: 'string' } } });
  projectTool(ctx, { name: 'project_delegate', method: 'delegate',
    description: 'Delegate actual work authorized by the current user. Supply the original workstreamId to continue its fixed worker Session. queued means not started. Preserve all restrictions in brief. readonly has no shell or repository writes; docs writes only declared repository document paths and Project deliverables. isolate is only for explicitly requested independent parallel development.',
    parameters: { blockedBy: { type: 'array', items: { type: 'string' }, description: 'Existing workstream IDs whose actual completion is required before this work starts.' }, workstreamId: { type: 'string' }, title: { type: 'string' }, brief: { type: 'string', required: true }, scope: { type: 'string', enum: ['readonly', 'docs', 'development'], required: true }, writePaths: { type: 'array', items: { type: 'string' } }, isolate: { type: 'boolean' } } });
  projectTool(ctx, { name: 'project_stop', method: 'stopTool', description: 'Stop one workstream and its owned activity; omit workstreamId only to stop all Project background work. This interrupts work, does not send another worker prompt, and does not automatically restart.', parameters: { workstreamId: { type: 'string' } } });
  ctx.systemPrompt.section({ name: 'project:preferences', order: 10310, interpolate: false, text: ({ agent }) => ctx.get('projects')?.preferencesFor(agent?.id) ?? '' });
}
