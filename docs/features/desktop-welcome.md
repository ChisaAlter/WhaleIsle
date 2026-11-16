# Feature: Desktop welcome

| Field | Value |
| --- | --- |
| **id** | `desktop-welcome` |
| **status** | `active` |
| **last verified** | 2026-09-29 — first-run opt-out: 27 account client tests + 27 preload/smoke tests passed; official client rebuild and fresh-profile source smoke passed without automatic dismissal (workspace, PTY, titlebar hits). Packaging paused. |

## User paths

1. Startup enters the desktop workspace even without account credentials or a provider key.
2. Configure account sign-in and provider keys later in Settings; sign-out or session expiration never reopens upstream welcome.
3. Fresh installations do not show the purpose/process setup wizard. Existing preferences remain unchanged and editable in General Settings.

## Invariants

- Upstream welcome does not own desktop entry. Do not simulate skip or store fake credentials.
- The trusted desktop preload disables automatic onboarding before client startup. Do not mount its controller, write completion markers or auto-dismiss it in smoke tests.
- Account watching, browser authorization and embedded Platform session refresh remain available without hiding the workspace.
- Source and packaged smoke reject an unexpected welcome window rather than clicking through it. Retained welcome resources have standalone rendering coverage only.

## Allowed touch

- `src/preload/index.js`, `shell-api.test.js`, `src/main/smoke/index.js` and its tests, `vendor/deepseek-harness/packages/client/ui-settings-account/src/client/index.ts` and its apply test: desktop first-run onboarding opt-out requested by the user.

- `src/main/index.js`, `src/main/welcome-entry.test.js`, and the boot-lifecycle handbook: entry wiring and account watching only, as requested by the user.

- `src/renderer/welcome.html`, `welcome-layout.css`, `welcome/`, `assets/welcome-brand.svg`, `assets/window-material.css`.
- `src/main/welcome-window.js`, `src/main/welcome*.test.js`, `src/preload/welcome.js`, `src/preload/welcome.test.js`, `src/main/smoke/client-ready.js` and its tests.
- `src/main/smoke/welcome-presentation.js`, `src/renderer/welcome-renderer.test.js`, `src/renderer/welcome-renderer.child.cjs`.
- This card, design language, build-release handbook and release QA evidence.

## Gates

- Real Electron welcome renderer test, including broken-layout and broken-image detection.
- Source and packaged smoke enter the workspace without first-run welcome or automatic skip clicks.

## Sources

- Decision: [Direct desktop entry](../decisions/implemented/product/2026-09-29-direct-desktop-entry.md)

- Decision: [Upstream desktop bridges](../decisions/implemented/architecture/2026-09-26-upstream-desktop-bridges.md)
- Decision: [Welcome resource closure](../decisions/implemented/bug-fix/2026-09-29-welcome-resource-closure.md)
- Design: [Desktop welcome](../design-language.md#桌面欢迎窗)
- Implementation entry: `src/main/welcome-window.js`, `src/renderer/welcome.html`
