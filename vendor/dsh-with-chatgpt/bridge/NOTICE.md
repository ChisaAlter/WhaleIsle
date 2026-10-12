# Upstream Attribution

The workspace bridge is adapted from
<https://github.com/XiaoDuoYa/codex-with-chatgpt> at commit
`535a07dbb7aee887924c53767d985c09d405319d` (upstream version 0.1.3).

Copyright (c) 2026 codex-with-chatgpt contributors.

The upstream MIT license is retained in `LICENSE`. DSH adaptations isolate
product identity and local state, remove Codex configuration and self-update
commands, and expose the bridge to the DSH plugin. The read-only MCP, OAuth,
pairing, workspace policy, execution records, media import, and tunnel core
derive from that upstream project.
