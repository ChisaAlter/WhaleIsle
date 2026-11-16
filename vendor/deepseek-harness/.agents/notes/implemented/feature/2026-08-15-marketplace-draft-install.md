# Agent Note: Host install_dsh_plugin control channel

Status: implemented

English | [中文](2026-08-15-marketplace-draft-install.zh.md)

## Problem

A conversation tool that installs a GitHub plugin must use the desktop installer: SHA pinning, DROPPED, the pnpm shim, `allowBuilds`, and Harness restart. Without a Host tool, the model invents `dsh plugin add` and misses those details.

Browser `dsh web` has no Electron installer. Settings catalog install is a separate path and does not use this channel.

## Decision

A desktop-only Host plugin, copied into `$DSH_HOME/profiles/web/desktop-plugins/install-dsh-plugin/` and inserted by a managed `cordis.patch.yml` block, registers `install_dsh_plugin` (`spec`, optional `allowBuilds[]`). Execute POSTs to a loopback control server Electron starts on `127.0.0.1` with a random port and bearer token: `DSH_DESKTOP_INSTALL_URL` rides the Harness child env, while `DSH_DESKTOP_INSTALL_TOKEN` is delivered over the host's stdin secret channel into the in-process store and never enters `process.env` (#427). The handler wraps existing `installPlugin` (SHA pin, DROPPED, pnpm shim, `allowBuilds`). Both layers validate the spec with `isValidGithubSpec` (`github:owner/repo[#ref]`) before anything reaches `pnpm add`: the tool returns a structured failure client-side, the control endpoint answers 400 and never invokes `installPlugin`. `needsAllowBuilds` is a canonical tool result, not a thrown failure. After HTTP 200 for a successful install, Electron waits ~500ms then restarts Harness so `tool/result` can land first; the delay is a fixed grace period, not an ACK — a tool/result slower than the delay would be cut off, which is accepted rather than adding a restart protocol. The plugin is absent from the official web-app bundle.

IPC `shell:install-plugin` remains for other desktop callers; the control channel invokes `installPlugin` in-process. Settings marketplace install calls `installMarketplacePlugin(id)` and does not seed a composer draft or call `installPlugin`; that path is [Desktop marketplace curated catalog](2026-08-18-desktop-marketplace-curated-catalog.md).

## Alternatives considered

**Route Host `install_dsh_plugin` through Settings one-click IPC.** Rejected for this channel: the Host tool is the conversation installer over the loopback control server. Settings catalog one-click is [Desktop marketplace curated catalog](2026-08-18-desktop-marketplace-curated-catalog.md).

**Prefill a composer draft without `install_dsh_plugin`.** Rejected: SHA pinning, the pnpm shim, `allowBuilds`, DROPPED, and restart are desktop installer details the model cannot stably reproduce with bash.

**Put the tool in the official web-app bundle.** Rejected: browser `dsh web` has no Electron installer; a Host tool there would no-op or lie. The profile patch is desktop-owned.

## Consequences

Host `install_dsh_plugin` stays github-only. Settings catalog install does not use this channel. `#path:`, npm names, tarballs, and local paths fail closed at both layers and never reach `pnpm add`.

## Testing

`src/host/install-dsh-plugin-client.test.js` pins `isValidGithubSpec` and `needsAllowBuilds` copy. `src/main/desktop-install-control.test.js` pins: the control server responds before restart; `needsAllowBuilds` does not restart; non-`github:` specs, invalid `allowBuilds`, missing bearer, and invalid JSON fail closed without invoking the installer; `spawnEnv` receives the loopback URL and token. `src/main/plugins.test.js` pins the profile copy and `install_dsh_plugin` registration.

## Related

- [Desktop marketplace curated catalog](2026-08-18-desktop-marketplace-curated-catalog.md)
