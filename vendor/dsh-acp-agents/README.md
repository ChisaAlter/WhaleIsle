# dsh-acp-agents

External ACP coding agents integration for DeepSeek Harness & WhaleIsle Desktop, inspired by T3 Code's Agent-first interaction model.

## Features

- **Settings → Agent (`agent-presets`)**:
  - Built-in presets for **Claude Code** (`claude --acp`), **Codex** (`codex acp`), **Antigravity (反重力)** (`agy acp`), and **Devin** (`devin acp`), plus custom ACP agent configurations.
  - Binary readiness indicator (`PATH` and common CLI tool paths) and one-click **Test ACP** handshake verification.
  - Configurable command, arguments, permission policy (`ask`, `allow-once`, `allow-session`), model catalog, and environment variables.
  - Persists configuration in `$DSH_HOME/acp-agents.json`.
- **T3 Code-style Model Selector (`conversation.input.model`)**:
  - Selecting **Agent** first (`DeepSeek Harness` vs. enabled external ACP agents), then **Model**, then **Reasoning Effort**.
  - Interactive multi-turn ACP sessions per DSH session (`session/new`, `session/set_model`, `session/set_config_option`, `session/prompt`, `session/cancel`).
  - Streams thoughts (`agent_thought_chunk`), assistant text (`agent_message_chunk`), tool call cards (`tool_call` / `tool_call_update`), and inline permission requests (`session/request_permission` bridged to `ctx.approval`).
