# DSH With ChatGPT Bridge

Read-only workspace access for ChatGPT planning and review. DSH owns all
editing, command execution, and task orchestration; ChatGPT receives no write,
delete, commit, or shell tools.

This package is the bridge component of the DSH plugin, not a model provider or
a browser extension. The plugin manages its own per-DSH-session checkpoint and
browser workflow. The standalone `d2c session` commands only retain a legacy
workspace-level chat pointer and are not used as a cross-session task store.

## Runtime

Node.js 20 or newer is required. Build with `pnpm install --frozen-lockfile`
and `pnpm build`. Distribution includes `dist/`, `bin/d2c.js`, runtime
dependencies, and the license/notice. Use a Node subprocess for the CLI rather
than importing its process-global command parser inside a plugin process.

```sh
node bin/d2c.js workspace -w /path/to/workspace --json
node bin/d2c.js setup -w /path/to/workspace --json
node bin/d2c.js doctor -w /path/to/workspace --json
node bin/d2c.js pair -w /path/to/workspace --json
node bin/d2c.js unpair -w /path/to/workspace
```

`setup` starts a loopback bridge and public tunnel. `setup --no-tunnel` is for
local development only and cannot expose the connector to ChatGPT. Normal
`doctor` may repair this product's bridge/tunnel; `doctor --no-fix` observes
without starting or repairing them. The DSH plugin owns ChatGPT configuration
and confirms the actual connected workspace before running a task.

Public access requires `cloudflared`. `tunnel choose --mode quick` uses an
ephemeral URL; named tunnels retain a hostname and require a Cloudflare account
and domain. DSH-created named tunnel resources have a `d2c-` prefix and do not
reuse Codex-with-ChatGPT tunnel names or connector names.
Failed named-hostname configuration reports the error and retains the prior
connection settings; it never silently switches to an ephemeral URL.

## Isolation And Policy

- State defaults to the platform-local `dsh-with-chatgpt` directory. Override
  with `D2C_STATE_DIR`; `C2C_STATE_DIR` is never read.
- The service identifies as `d2c-bridge`; connectors are `DSH with ChatGPT`
  plus the workspace name.
- `.d2c.json` can set a workspace display name and `maxIterations`.
  Iteration limits are enforced by the DSH orchestrator, not by this CLI.
- `.d2cignore` hides additional workspace-relative files. Built-in sensitive
  file rules remain non-overridable. Path containment resolves symlinks.
- Unauthenticated `/mcp` is rejected with 401; tokens are workspace-bound.
  Authorization uses a short-lived one-time pairing code and PKCE S256.
- No command reads or writes Codex config, installs a skill, updates a git
  checkout, stashes user changes, or modifies another product's state.

The ten MCP tools are `workspace_info`, `list_directory`, `read_file`,
`read_image`, `search_workspace`, `git_status`, `git_diff`, `test_status`,
`execution_summary`, and `execution_output`. All are read-only.

The local executor may record an iteration with `d2c record --executor dsh`.
Command output is opt-in, sanitized and capped; private-key bodies are
restricted. Missing executor values remain unknown, not implicitly DSH.
Media import accepts only an original download, validates its content and
workspace containment, and never overwrites an existing destination.

See `NOTICE.md` and `LICENSE` for upstream attribution.
