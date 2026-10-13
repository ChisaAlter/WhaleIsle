# DSH with ChatGPT

An optional installable Cordis bundle at `vendor/dsh-with-chatgpt`, based on the
MIT-licensed `XiaoDuoYa/codex-with-chatgpt` bridge. It is not automatically
enabled in WhaleIsle's desktop profile. Plugin Manager installs the built
directory or packed bundle using the normal DSH bundle path.

## Distribution and installation

The plugin is built and published independently of the desktop application.
Desktop `pack`, `dist`, and `dist:mac` do not build or distribute this bundle.
To create `dist/plugins/dsh-with-chatgpt-0.1.0.tgz`,
run `npm run prepare:dsh-with-chatgpt-bundle` (or
`node scripts/prepare-dsh-with-chatgpt-bundle.mjs`) from the repository root.
The script installs the outer bundle's locked build dependencies using its own
vendor directory and lockfile, compiles the current bridge source through `prepack`, and packs the
declared distribution files. It does not reuse an existing tarball.

Use the tarball from the plugin's own distribution. Download it, then ask the DSH agent to install the
absolute `.tgz` path with Plugin Manager's `install_bundle`. The manager
checks the host peer dependencies, selects the bundle in the current profile,
and reports whether a profile restart is needed. The tarball includes the
compiled bridge; installation needs no TypeScript build. Its runtime npm
dependencies are resolved by Plugin Manager rather than embedded into the
desktop installer. The plugin remains an explicit user installation and is
not activated by updating WhaleIsle.

## User behavior

ChatGPT web plans and independently reviews. DSH retains workspace editing,
command execution, verification, and permission decisions. A packaged
`dsh-with-chatgpt` skill uses four native tools: `chatgpt_connection`,
`chatgpt_browser`, `chatgpt_checkpoint`, and `chatgpt_record`.

The agent configures the user's explicitly selected automatic/manual setup and
quick/fixed connection. Login, CAPTCHA, 2FA and account consent remain human
actions. The ChatGPT account must support a custom connector. Connector health
does not prove a completed collaboration: ChatGPT must actually read the
expected workspace and then perform a planning/execution/review round.

## Isolation

- The browser is a separate plugin-owned persistent Chromium profile, not the
  embedded preview or the user's normal browser. Ownership is acquired lazily
  by the requesting live DSH Agent object, never the first unrelated Session.
- Close and Agent/plugin disposal release ownership while retaining login
  data. Concurrent Sessions cannot take over an active browser. New activation
  of the same durable Session is still a different live owner.
- State, connector and fixed-tunnel identities are separate from the Codex
  version. The DSH bridge uses `D2C_STATE_DIR`, `.d2c.json` and `.d2cignore`;
  no Codex sandbox configuration, skill or connector is changed.
- Chat URL and task checkpoints are keyed by canonical workspace plus durable
  DSH Session identity. A second Session cannot silently borrow the first's
  conversation. Pending sent messages survive interruption without resending.
- ChatGPT gets only read-only workspace/git/image/search/execution tools.
  Secrets, escapes and unsafe nominated output are rejected by the bridge.
  Browser control has fixed operations and visible target ids, not arbitrary
  JavaScript, shell, or cookie/token access. Login inputs are human-only.

## Responsible code

`vendor/dsh-with-chatgpt/lib/index.js` owns tool and skill registration.
`lib/browser.js` owns managed-browser actions and lifetime; `lib/state.js`
owns per-Session checkpoints; `lib/bridge-client.js` invokes the isolated
CLI using the proper Node runtime. The pinned bridge source and upstream
attribution live under `bridge/`. The bundle README owns installation and
configuration details; `skills/dsh-with-chatgpt/` owns the cooperation protocol.

This bundle adds no settings frontend, changes no model/terminal/browser
provider, and does not grant PR, merge, release or unrelated account actions.
