# DSH with ChatGPT

An installable DeepSeek Harness Cordis bundle based on
[codex-with-chatgpt](https://github.com/XiaoDuoYa/codex-with-chatgpt).
ChatGPT plans and independently reviews; DSH keeps workspace editing, command
execution and verification. This uses ChatGPT web, not an OpenAI API key.

The bundle supplies a packaged skill and four DSH-native tools:
`chatgpt_connection`, `chatgpt_browser`, `chatgpt_checkpoint`, `chatgpt_record`.
It includes a pinned MIT fork of the original read-only workspace bridge. The
bridge retains OAuth pairing, file and image reads, search, git reads,
execution records, sanitized command-output reads, and secure connections.
See `bridge/NOTICE.md` for upstream revision and retained license.

## Install and use

Requires Node 22.19+ and a DSH `0.2.1-alpha.1`, `0.2.1-alpha.3` or `0.2.1-rc.2`
host providing tools, skills and Agents. The development lockfile targets rc.2
with Cordis `4.0.5` and Schemastery `3.18.5`; later prereleases need their own
compatibility check. Use the
host's Plugin Manager `install_bundle` with this built package's absolute
directory or tarball. From the plugin's own distribution, download the
`dsh-with-chatgpt-0.1.0.tgz` asset, then ask the DSH agent to install its absolute
path through `install_bundle`. Follow the manager's profile restart instruction.
This bundle is optional and is not activated by installing or updating WhaleIsle.
Plugin Manager resolves its runtime npm dependencies and checks the host's peer
dependencies; the tarball does not contain a private copy of the DSH host.

From the WhaleIsle repository root, `npm run prepare:dsh-with-chatgpt-bundle`
or `node scripts/prepare-dsh-with-chatgpt-bundle.mjs` creates
`dist/plugins/dsh-with-chatgpt-0.1.0.tgz` from the current source. The plugin is
published independently; desktop `pack`, `dist`, and `dist:mac` do not prepare
or distribute it. The repository command uses the installed Harness's pinned
pnpm for this independent bundle. Build before local directory installation
(`pnpm install --frozen-lockfile --ignore-workspace --ignore-scripts`,
`node node_modules/typescript/bin/tsc -p bridge/tsconfig.json`); packed distributions
include the compiled bridge and need no install-time build script.

In the DSH conversation, ask "Use DSH with ChatGPT to implement ..." or invoke
the `dsh-with-chatgpt` skill. The agent asks once for automatic or guided manual
connection setup and temporary or fixed connection address. Only login,
CAPTCHA, 2FA and explicit account consent require human interaction. Creating
the ChatGPT connector requires an account supporting custom connectors.

The dedicated ChatGPT browser is a separate managed window, **not** WhaleIsle's
embedded preview or your everyday browser. The plugin discovers an installed
Chromium/Chrome/Edge or uses the configured absolute `browserExecutable`.
Its separate persistent profile retains login across reconnects. One live DSH
Session owns that browser until close/disposal. No arbitrary JavaScript,
shell, selectors, browser cookies, or tokens are exposed by its tool.

Configuration fields on the bundle row: `stateDir`, `node`,
`browserExecutable`, `headless` (default false). Node-hosted DSH reuses its
runtime; Electron uses its confirmed Node mode, and a standalone DSH binary
needs a configured Node executable. This plugin does not change host model,
terminal, generic browser provider, PR permissions or other presets.

## Isolation and safety

State lives in the OS application-state directory `dsh-with-chatgpt`, overridable
by `D2C_STATE_DIR`. Connector names start with `DSH with ChatGPT`; named tunnel
identities start with `d2c-`. Existing Codex bridge, skill, connector, tokens,
configuration and tunnel stay untouched. Choose a separate fixed hostname.
Workspace settings use `.d2c.json` and `.d2cignore`. Secrets, path escapes,
unsupported image content and unsafe nominated output are rejected by the
bridge. Remote tools cannot edit files or execute commands.

Chat URLs/checkpoints are keyed by real workspace path and durable DSH Session
identity, not one shared last chat per workspace. DSH records execution as
`executor: dsh`. Record output files inside the current workspace; sanitizer
decisions are visible and cannot be bypassed through the browser. Control
messages carry summaries, not code/log uploads. Workspace `maxIterations`
defaults to 12; increasing it requires the user's decision.

`chatgpt_connection` `unpair` revokes this workspace's access. Browser `close`
releases its owner and retains the profile. Ordinary disconnect does not delete
data, shut down other workspaces, or touch the Codex version.

Connection calls and execution records for one workspace run in order, so
concurrent Sessions share one bridge and do not overwrite the output index.
Cancelling queued work prevents it from starting. An already-started setup or
repair finishes its persistent connection handoff before reporting cancellation;
it does not terminate the shared connection or release the queue mid-startup.
Other active CLI calls stop before cancellation is reported. Separate DSH host
processes should not manage the same connection state concurrently.

Local bridge checks do not prove that ChatGPT connected. First-use acceptance
requires ChatGPT to call `workspace_info` and `read_file`, followed by a real
INIT -> PLAN -> DSH execution -> EXECUTED -> review round.

This initial bundle does not automatically create workspace Projects or import
ChatGPT-generated downloads. Existing Project URLs can be bound explicitly;
the bridge's local asset importer remains available through `d2c asset import`.
