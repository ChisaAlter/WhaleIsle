# Connection and recovery

Use `chatgpt_connection` with `prefs` and `tunnel_status` first. A new machine
needs an explicit auto/manual setup choice and quick/named connection choice;
show the returned prompts, remember the answers using `prefs_set` and
`tunnel_choose`, and leave existing preferences alone. Automatic setup means
operating only the dedicated ChatGPT browser. A fixed hostname must be dedicated
to DSH with ChatGPT, not an existing Codex connector or tunnel. If Cloudflare
authorization is needed, stop for that user's consent; do not repoint an existing
hostname or invent account access.

Call `setup` after choices. It returns this workspace's connector name, address,
and pairing code. Call `doctor` when repairing. Continue to the conversation
only if `report.bridge.ok` and `report.mcp.ok` are true and any `chatgptRepair`
or `namedRepair` has been resolved. An unknown bridge state means unknown, not
stopped. Never start a duplicate connection based on that observation.

Use `chatgpt_browser` to navigate directly to these pages:

- Developer mode: `https://chatgpt.com/#settings/Security` (skip if prefs says confirmed).
- Connector list: `https://chatgpt.com/plugins`.
- Create: `https://chatgpt.com/plugins#settings/Connectors?create-connector=true&redirectAfter=%2Fplugins`.

For auto setup, use snapshot targets to enter the exact connector name, a short
description, returned server URL, and OAuth. Accept only the consent needed for
the user's requested read-only connection. Enter the pairing code in the
plugin's authorization page. For manual setup, give these exact field values
and one next action, using the same dedicated browser. Two explicit failures of
the same automatic configuration step after a concrete repair switch to guided
manual setup; waiting, login and a browser timeout do not count as failures.

When the returned address changed, delete and recreate only this DSH workspace's
connector under the same name. Do not modify Codex or other workspaces'
connectors. When only the browser fails, keep the existing connection. When
authorization succeeds, verify in the actual saved/new ChatGPT conversation:

"Use the connector named <exact connectorName>. Call workspace_info, then
read_file for a non-sensitive file in this workspace. Report the workspace name
and the file heading. Do not claim verification if a tool failed."

Require the expected workspace identity and real file contents before saving a
new `chatUrl`. If verification in an old chat fails after actual connector
replacement, retain its old checkpoint, then open a replacement chat in the
same Project or ask for a new standalone Chat; boot and HANDOFF are defined in
[protocol.md](protocol.md). Save only after identity verification. Connector
creation/health alone is not acceptance.

Disconnect uses `chatgpt_connection` action `unpair`, which revokes tokens. Close
the dedicated browser if requested. Removing the connector is optional and
must touch this workspace's exact name only. Never delete the browser profile
or user's session data just to disconnect.
