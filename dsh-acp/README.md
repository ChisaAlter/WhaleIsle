# Configured coding agents for DeepSeek Harness

Configure a coding agent once, then use it either as the current conversation's agent or as a managed subagent. This is an independently packaged Cordis plugin for DeepSeek Harness and WhaleIsle Desktop.

Source and issues: [ChisaAlter/dsh-acp-agents](https://github.com/ChisaAlter/dsh-acp-agents). This repository contains the plugin and its bundled runtime, not the desktop host.

## Install v0.4.5

Download [`dsh-acp-agents-0.4.5.tgz`](https://github.com/ChisaAlter/dsh-acp-agents/releases/download/v0.4.5/dsh-acp-agents-0.4.5.tgz) from the [v0.4.5 release](https://github.com/ChisaAlter/dsh-acp-agents/releases/tag/v0.4.5), then install it into the profile you use:

```sh
dsh plugin --profile web add ./dsh-acp-agents-0.4.5.tgz
```

Use your host's bundled CLI for a desktop-managed profile. Restart the host normally after installation, then open **Settings → Agent**. Existing agents, credentials, and conversation mappings are retained. The package is distributed through GitHub Releases, not the npm registry.

### What changed

- Native model menu integration preserves model selection, reasoning, keyboard navigation and Team controls. Models without advertised reasoning no longer receive an invented `medium` setting.
- The account-settings shortcut opens the existing Agent settings page on standard DSH, including hosts without `settingsNavigation`.
- Generic ACP select/boolean options, empty Automatic values, v2 credential forms and native background completion use the same capability-driven path across agents.
- Ordinary sign-in verifies existing native credentials first; explicit reauthentication remains separate. Restoration, cancellation, provider errors and managed child cleanup retain their actual outcome.
- A paired DSH server update declares provider-managed context for stateful ACP sessions without guessing a context capacity or disabling ordinary LLM protection.

### Supported and pending host behavior

**DSH `0.2.2-rc.2`:** settings navigation and capability-driven reasoning were exercised in the stock Web host. Switching models after a conversation has history requires the paired [server context-ownership update](tools/host-compat/README.md); the plugin archive alone does not update host modules. Windows terminal sign-in also requires the host's native PTY lifecycle fix.

**DSH `0.2.2-rc.3`:** a reported inability to select models remains under investigation. This release has not been runtime-validated against rc.3. Its published source still contains the unknown-context model-switch guard, and the rc.2 server update must not be applied to rc.3.

## Switch agents in a conversation

1. Open **Settings → Agent**, add an agent instance, complete its authentication, and enable it.
2. Open the conversation's model selector and choose that agent, its model, and reasoning effort.
3. Continue in the same conversation. Switching to another agent does not change the conversation's identity. A newly selected agent receives the visible conversation text; returning to an existing agent relays missed turns while retaining its own ACP session.

Claude Code, Codex, and Antigravity can use managed ACP Registry distributions. Devin uses its local CLI. Other ACP servers can be configured with a command, arguments, and environment. Multiple instances of the same agent can have separate profiles and credentials.

## Delegate to a configured agent

Enabled agents are exposed through two model-facing tools:

- `acp_agents()` lists configured agent instance ids and models, without credentials.
- `acp_delegate({ agent, prompt, description?, model?, reasoning_effort?, client_request_id?, mode?, timeout_ms?, isolation?, interaction_mode?, runtime_mode?, options? })` starts an independent child. Omit `model` to use its first visible configured model. Explicit effort and options must be advertised by discovery.

For example, after discovering the actual instance id:

```json
{
  "agent": "codex",
  "description": "Review session cancellation",
  "prompt": "Review lib/acp-session.js for cancellation races. Do not edit files. Return concrete findings with line references."
}
```

The child shares the parent's working directory, not its conversation. Include the necessary context in `prompt`. Child sessions, result delivery, follow-up messages, cancellation, and delegation depth are managed by the host's subagent service. Agent configuration and permission policy are reused; configuration does not grant additional authority.

Delegation first prepares the actual ACP connection and validates authentication, the requested model, and settings before publishing a child task. The prepared connection is reused for execution; validation sends no task prompt. A preparation rejection creates no child or failed task row. Errors retain protocol details such as an OAuth proxy failure rather than reporting only `Internal error`. Model/authentication/network failures never justify retrying with weaker runtime permissions. Antigravity's live account model list bounds discovery and selection; obsolete configured entries remain in management data but are excluded from usable choices after discovery. Child-scope disposal closes the ACP process and revokes its bridge token before the host reports released resources.

The same tools are injected into external agents through the session-authenticated MCP bridge. Delegation returns `{ taskId, subagentId, status: "running", next }` after acceptance. The host manages child execution and resource release; the plugin assembles errors and final output before delivering one durable completion message. Follow `next`: end the current turn, without polling or launching the task again. A busy parent receives the notice at its next model step; an idle parent resumes in a new turn. Children do not need to send a second final report.

Use `acp_result({ task_id: taskId })` after a completion notice or when the user requests status. The compatibility `agent_id` selects that child's latest task. Exact task lookup retains earlier results. `wait_ms` and delegation `mode: "wait"` support an event-driven wait of up to 20000 ms; a timeout retains automatic completion delivery. Use a stable `client_request_id` to retry identical delegation arguments without starting a second child. Reusing it for different arguments is rejected.

`send_message` resumes a child and records a fresh execution row after its earlier task settles. `interrupt_agent` pauses the current execution and preserves queued input. `acp_cancel({ task_id })` cancels the task, clears its queue, awaits descendant/resource release, and suppresses its completion wake. Completed output remains readable. No operation changes the parent's selected agent.

Use `isolation: "worktree"` for parallel edits in a separate retained checkout from committed HEAD. Uncommitted files are not copied; results name the checkout path. Worktree creation obeys host permissions and does not move the parent. `interaction_mode: "plan"` restricts the child to investigation and planning. `runtime_mode` can inherit or restrict the host policy, never expand it. Discovered non-permission settings can be supplied as `options: [{ id, value }]`.

ACP permission requests remain independent of mirrored tool execution. The current host sandbox and approval policy bound every callback. A delegated operation that needs human consent is presented through the live root conversation's question surface; explicit `never` still refuses it. Antigravity's multiple-choice questions use that same surface and return the selected native option id. Pending questions and approvals appear in task status and the compact row.

Delegations appear as compact horizontal entries with an agent icon, task, status, and elapsed time. The agent name and smaller model label form a stacked identity group, separate from the task. The Antigravity label omits the redundant Chinese translation without changing the configured agent name. Long text is truncated; hover for full details, or click to open the existing child conversation. Narrow entries prioritize the agent, model, and status. Failures show their diagnostic inline instead of expanding the entry. Informational delegation records carry the host's persistence compatibility marker so conversations remain readable after a restart.

## Install and requirements

Standard ACP agents use the same capability-driven path: discover models, dynamic select/boolean options, authentication methods, permissions and forms from the protocol. Adding a Registry agent does not require adding its name or models to plugin code. Provider-specific non-standard extensions retain T3's existing normalizers.

Model changes keep the selected agent model's own reasoning default. The picker only offers reasoning values the agent reports; other discovered model options appear alongside them and are saved per conversation/model. Those options are revalidated against the live session before use. Terminal sign-in uses the host subprocess PTY when available, and an explicit Registry sign-in prepares its distribution first. The optional PTY service is not required for agents that use other authentication methods.

Native configuration updates also refresh the applied model and reasoning state. Automatic/empty reasoning choices use the same value conversion as other select options. Standard ACP v2 `env_var` sign-in methods supply their credential fields directly, without a per-agent field list.

Ordinary sign-in first checks whether the agent can already create a session. Usable native credentials are confirmed without calling `authenticate`, because some agents interpret that call as logging out first. Only an ACP authentication-required response starts interactive sign-in; network and startup failures remain visible errors. **Switch / Re-authenticate** explicitly requests a fresh login. Browser handoffs are shown while waiting, and completion is confirmed by creating a session, not by opening a URL. Cancel and expiry close the owned authentication process. Auth-flow wire ids use protocol-valid slugs while existing credential cache and Antigravity profile paths are retained.

Provider errors and cancellations retain their terminal status. Failed native session restoration reports the original error and retains the saved mapping instead of silently creating a replacement. Native ACP v2 background output resumes through the existing host conversation without issuing a duplicate task prompt. Tool associations are scoped to their owning host conversation.

Antigravity sessions use separate runtime directories and clean up only their own files. A configured executable override may point to the newer `agy` CLI (`agy acp`) or the legacy server; an empty override keeps the existing managed installation. Existing profiles and managed release selection are retained.

- Node.js `^22.19.0 || >=24.0.0`.
- A DeepSeek Harness host with Cordis 4, LLM adapter registration, connection, and web-server services.
- Delegation additionally requires the host's `subagents` and `tools` services with managed local child support (`prepareContinuable` / `startActivation`). Without those services, conversation switching remains available.
- Managed delegation supports both the nested activation request in host subagent 0.2.1 and the flattened request in 0.2.2. Parent, prompt, model and depth are identical in both representations; compatibility does not retry task admission.
- Child listing, running-task status, bounded waits and follow-ups support both host control interfaces. The newer descendant listing is restricted to direct children for these operations. MCP ownership follows the current execution route after an agent switch, not the conversation's creation settings.
- Interactive terminal authentication uses the host's `subprocess.spawnTerminal`. Windows hosts must release the native ConPTY transport after process settlement; updating this plugin does not replace the host's subprocess package.

Install `dsh-acp-agents` through the host's plugin loader. The package declares its server entry, browser client, and composition patch. Produce a distributable archive with `npm pack` and install it through the host's supported local-package flow.

The plugin extends the native model menu through `conversation.input.model.options`; the host keeps ownership of model selection, reasoning, keyboard navigation and Team controls. No browser bundle patch is required. Agent settings activate on standard DSH 0.2.2-rc.2 without desktop-only primitives or `settingsNavigation`. The menu's account-settings button opens the existing settings shell directly at **Agent**: it uses the navigation service where supplied, otherwise shares the standard shell's declared root store and calls its `openSection` action. Windows terminal sign-in still requires the host to release its native PTY after process settlement; the plugin archive cannot update that subprocess library.

## Configuration and existing data

The plugin stores agents in `$DSH_HOME/acp-agents.json`, external session mappings in `acp-agent-sessions.json`, durable task receipts in `acp-tasks.json`, and account profiles in `acp-profiles/`. Task receipts contain prompts/results and should receive the same protection as conversation logs. If `DSH_HOME` is unset, it uses `~/.dsh`.

Existing agent ids, provider ids (`acp:<instance-id>`), profiles, and session mappings remain usable. Existing runtime cache directories are reused to retain managed installations and authentication. Environment credentials remain in the local configuration file; catalog responses mask secret-shaped values and preserve them when unchanged settings are saved.

An explicit `profileDir` takes precedence over inherited or conflicting profile-home environment variables. Antigravity uses that same path for authentication, sessions and account status; without an explicit profile or `GEMINI_HOME` override, its existing instance-specific profile remains unchanged.

## Build the bundled runtime

Clone the standalone repository:

```sh
git clone https://github.com/ChisaAlter/dsh-acp-agents.git
cd dsh-acp-agents
```

The shipped package includes its runtime bundles. Rebuilding them uses the source snapshot inside this project, not another checkout or a T3 Code installation:

```sh
npm ci --prefix tools/runtime-build
npm run build:runtime
```

`tools/runtime-build/upstream/SOURCE.json` records the base snapshot and selected upstream overlays. The overlays include generic form parsing, reasoning option roles, Registry installation/cache fixes and clearer authentication/startup diagnostics; their Crypto calls are adapted to the pinned Effect dependency. The runtime event projection additionally retains ACP v2 work-state notifications for the host bridge. Adapted third-party implementation is isolated there; the plugin owns its agent management, conversation routing, host delegation, and UI. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for provenance and license terms.

## Verify changes

Run `npm test` for native menu contribution, handoff, discovery, and delegation contracts. For client activation against real Cordis, set `DSH_CLIENT_HOST_ROOT` to a supported DSH package directory and run `npm run test:client`. Set `DSH_HARNESS_ROOT` to a built DeepSeek Harness checkout, then run `npm run test:host` for the real Cordis, AgentLoop, child lifecycle, ACP subprocess, and HTTP/MCP bridge integration. The integration test uses scripted ACP agents rather than a paid model or a user's account, and stores its artifacts in a new temporary directory.

For the paired server update, set `DSH_COMPAT_HOST_PACKAGE` to the supported host CLI's `package.json` and run `npm run test:host-compat`. This checks the actual published server transformations, ordinary LLM capacity guards, unsupported versions and preparation cleanup without modifying the installed host.

To verify the shipped desktop contract, set `DSH_INSTALLED_HOST_ROOT` to its `resources/vendor/deepseek-harness` directory and run `npm run test:installed-host`. This loads the installed production host libraries and exercises scripted delegation, running status, HTTP/MCP child listing, agent switching with tools, bounded waiting, follow-up recovery, exact earlier results and cancellation in isolated sessions. An explicit real-account check can additionally set `DSH_NATIVE_HOME`, `DSH_TEST_NATIVE_AGENT` and `DSH_TEST_NATIVE_MODEL`; it uses that configured agent's existing native profile for one short model reply, without starting authentication or changing the daily agent/session/task JSON.

## Current interaction limits

Conversation handoff relays visible text and retained images, not private reasoning or runtime state. Images use stored bytes after ACP image capability negotiation. When text-only capability is already known, the host explicitly marks the image as omitted; an image reaching an unnegotiated ACP image path is rejected. Stored files use resource links (the host may already project files into readable saved-path text).

After restart, opening the parent reconciles task receipts with child history and the durable parent inbox. Undelivered results are offered once. Interrupted work is reported with a recovery diagnostic; no model task is silently replayed. An explicit follow-up resumes the retained child. Existing pre-receipt task rows retain their log-based display recovery.
