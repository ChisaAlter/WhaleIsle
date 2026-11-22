# WhaleIsle Projects (`dsh-project`)

Three-column Projects workspace plugin for DeepSeek Harness & WhaleIsle Desktop.

## Architecture

- **Data layout** under `$DSH_HOME/projects/<projectId>/`:
  - `project.json`: project metadata and tasks (`0o600` atomic write, per-project serial write queue).
  - `memory/MEMORY.md`: generated read-only index of topic memory files.
  - `memory/<slug>.md`: per-topic markdown memory files with YAML frontmatter (`name`, `description`, `type`, `modified`).
  - `memory/archive/`: whole topic files moved out by auto-compaction.
- **Worktrees** (opt-in `worktreeIsolation`):
  - Created outside the user's repo under `$DSH_HOME/project-worktrees/<projectId>/<taskId>` on branch `project/<taskId>`.
  - Supports unified diff inspection, safe clean-merge checks, and forced cleanup.
- **Agent tools** (`lib/tools.js`):
  - `projects_list`, `projects_create`, `projects_update`, `projects_get`, `projects_add_task`, `projects_update_task`, `projects_memory`, `projects_dispatch`.
- **HTTP + SSE API** (`/projects-api/*`, `lib/http.js`):
  - Connection-authenticated (`ctx.connection.admit`) with JSON + `x-projects-api: 1` write fence.
  - Real-time SSE stream at `GET /projects-api/events`.
  - Task controls for approve, stop, retry, resolve/review, diff, worktree merge/cleanup, and safe delete with optional session archiving.
- **Cross-plugin services** (`ctx.provide('projects', service)`):
  - `inspect()` and `schedule()` for `dsh-task-control`.
  - `listBridgeSummaries()`, `inspectBridgeProject()`, and `acceptAuthorizedHandoff()` for `dsh-whale`.
