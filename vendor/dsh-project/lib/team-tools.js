/** Project roles expose native Team reads and bounded peer collaboration. */
import { projectTool } from './tool.js';

export function registerTeamTools(ctx) {
  projectTool(ctx, { name: 'list_agents', method: 'teamMembers', description: 'List the actual members of this Project Team. Use target names for peer messages. Inactive is not completed.', parameters: {} });
  projectTool(ctx, { name: 'team_task_list', method: 'teamTasks', description: 'Read the native Team task board, owners, dependencies and revisions. Project reports and native settlement control completion.', parameters: {} });
  projectTool(ctx, { name: 'send_message', method: 'teamSend', description: 'Share needed evidence or interface information with another member of this Team. This does not grant permissions or restart stopped/completed work. Report completion with project_report instead. Lead assignments use project_delegate.', parameters: { target: { type: 'string', required: true }, message: { type: 'string', required: true } } });
}
