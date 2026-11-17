# Feature: Plugin Session Navigation

| Field | Value |
| --- | --- |
| **id** | `plugin-session-navigation` |
| **status** | `active` |
| **last verified** | 2026-09-18 |

历史验证与变更记录见 [docs/history/plugin-session-navigation.md](../history/plugin-session-navigation.md)。

## User paths

1. Plugin-owned persistent sessions remain addressable through the same Session Controller and keep their real title in the conversation surface.
2. Ordinary workspace lists/search and blank reuse exclude owned rows; an ordinary New Session keeps the full session chrome.

## Invariants

- Optional log-only presentation metadata records owner and title; it does not grant execution permissions, change session identity, rewrite old logs or fake a turn. Null metadata releases ownership.
- The conversation surface keeps its normal docked composer before the first message and displays the owner title.
- Managed composer extension: optional presentation `composer: 'managed'` selects the shared editor without independent model, permission shortcut, plan, preset and developer-statistics chrome. It keeps the owner title while suppressing lineage/actions/utilities, multi-view tabs, Session-log download and Git titlebar actions; stale stored view selection falls back to the default conversation view. Root panel and window controls stay available. Its `conversation.input.managed` slot lets the owner open its configuration. This is presentation only, never an authorization bypass.
- The Session model-selection command accepts `saveAsDefault: false` for explicit plugin-local selections; ordinary callers retain the existing default-saving behavior. Managed sessions also suppress implicit default saving from other ordinary session-model entry points, such as the command menu. This is mutation scope, not authorization; selecting a session-local model is not denied by presentation.
- New Session reuse is confirmed by the read-only Host `session.blankReuse({ sessionId })` result through client `ISessions.canReuseBlank(sessionId, signal?)`. `blank` still means that no turn has started: any existing `session/title` pin makes the Session ineligible for New Session reuse, while the old pin remains unchanged when the user explicitly opens that Session. Any current or historical non-null plugin presentation, historical `system/message`, `user/message`, `assistant/message`, `tool/result`, `turn/start`, seeded/forked/inherited identity, or subagent identity also makes the Session ineligible. Missing Sessions return `reusable: false`; other read failures and cancellation remain errors. Ordinary model, permission, and plan setup remains reusable, with no Agent activation, cache schema/version change, or old-log rewrite.
- Workspace and no-directory New Session navigation prefilters summaries, awaits Host confirmation, rechecks current membership and archive state, and coalesces inspection plus creation per target. Reuse preserves existing titles, data, and layout; an ineligible, missing, or changed candidate is skipped for creation, while a real read error or cancellation propagates and does not create.
- These are generic plugin contracts and remain available after Bots/dshbot removal. Preserve existing plugin-owned Sessions and their presentation history; Project and the whale assistant retain their own Session integrations.

- Historical non-empty `agent/inbox/spliced` input, `goal/change`, or `schedule/change` also excludes reuse: these events can persist pending work before the first turn. Later cancellation or goal clearing does not turn that identity into a new draft; empty inbox operations and ordinary configuration remain eligible.

## Allowed touch

- vendored api/session-controller types, commands, list projection and client summaries; client/ui-workspace navigation/tree; ui-conversation root rendering; related focused tests, documentation and built artifacts; generic plugin integration. Preserve unrelated changes and all existing user session data.

## Gates

- projection/command tests, workspace list and draft reuse tests, conversation render tests, official build, and actual retained-plugin first-send/isolation/reload checks. Historical dshbot acceptance is evidence for its recorded revision only; it is not a current workflow or a new validation result.

## Sources

- Decision: [blank Session reuse after presentation release](../decisions/implemented/bug-fix/2026-09-18-blank-session-reuse.md)
- Decision: [alpha.1 merge drift adjudication](../decisions/implemented/bug-fix/2026-09-17-vendor-alpha1-merge-drift-remediation.md)
- Implementation entry: `vendor/deepseek-harness/packages/api/session-controller/`、`vendor/deepseek-harness/packages/client/ui-workspace/`、`vendor/deepseek-harness/packages/client/ui-conversation/`
