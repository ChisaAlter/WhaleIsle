import { projectTool } from './tool.js';
export const name = 'project-worker';
export const inject = ['tools'];
export function apply(ctx) {
  ctx.tools.presentAs('native');
  ctx.tools.guard(exec => {
    const service = ctx.get('projects');
    return service?.available ? service.guard(exec) : 'Project Host is unavailable.';
  });
  projectTool(ctx, { name: 'project_read_store', method: 'readStoreTool', description: 'Read this Project notes.md, preferences.md or docs/<path>.', parameters: { path: { type: 'string', required: true } } });
  projectTool(ctx, { name: 'project_report', method: 'report', finish: true,
    description: 'Persist your actual outcome for the delegationRef in the latest brief, then end this turn. completed is your completion report, not independent acceptance. Include partial work, blockers and actual verification boundaries. Native runtime settlement is the only parent notification.',
    parameters: { delegationRef: { type: 'string', required: true }, outcome: { type: 'string', enum: ['completed', 'blocked', 'failed'], required: true }, summary: { type: 'string', required: true }, artifacts: { type: 'array', items: { type: 'string' } }, evidence: { type: 'array', items: { type: 'string' } }, remainingIssues: { type: 'array', items: { type: 'string' }, description: 'Explicit unresolved issues and unverified boundaries; use an empty list only when none remain.' } } });
  projectTool(ctx, { name: 'project_write_artifact', method: 'writeArtifact', description: 'Write a new text deliverable under this workstream’s Project docs directory, or its own internal notes. Existing deliverables are preserved; use a new name for revised outputs. Both roots are outside the repository.', parameters: { path: { type: 'string', required: true }, text: { type: 'string', required: true }, internal: { type: 'boolean' } } });
}
