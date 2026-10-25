# `@deepseek-ai/dsh-client-ui-settings-remote`

English | [中文](README.zh.md)

Desktop-only **Remote** surfaces:

Connection choices are LAN / Server. Server (`relay`) is selected when no mode is saved; an explicit LAN choice remains available. This default does not enable pairing or change relay endpoints.

1. Account menu Remote action (`settings.launcher.action` id `remote`) — on/off, pairing QR, bound devices with inline rename. When the account launcher is absent, the sidebar footer control (`sidebar.footer.action`) provides the same popup.
2. Settings section id `remote` with tabs (`settings.remote.tab`) — **gateway** (LAN/relay mode, port, bind, LAN TLS, relay URL/token, rotate pairing token) and **channels** (preset `@xmanrui/dsh-im`).

Registration requires Electron `window.shell` `getRemote` / `saveRemote` / `rotateRemoteToken` / `unbindRemoteDevice` / `renameRemoteDevice`. Plain `dsh web` has neither surface.

The pairing popup keeps a QR-sized loading frame while enabling, while the snapshot reports daemon startup, or while the relay handshake has no result. The QR and copy controls appear only after the listener, relay, and pairing offer are ready. Settled service or relay failures retain their retry controls and localized Toast; failed status reads leave loading and remain retryable. A read started before a mutation cannot overwrite that mutation's result.

See desktop feature cards `remote-settings` and `mobile-remote`.

With the `chisacode-v2` gateway, retired host credentials appear only in a collapsed legacy-cleanup row. `legacyRelayTokenSet` indicates whether there is a stored token to clear; the normal gateway form has no host-token input or save action. Other protocols retain their existing credential controls.

No runtime invariant companion is published; this package owns no independent durable event relationship, and focused package tests cover its UI or service behavior.
