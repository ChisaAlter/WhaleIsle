# @deepseek-ai/dsh-client-ui-preview

English | [中文](README.zh.md)

Right-panel Browser occupant of `surfaces.browser` (`single`, `session-maybe`, declared by ui-surfaces). Desktop-only preview of an http(s) document. The renderer owns the URL bar and reports the host rectangle; Electron attaches a `BrowserView` on that rectangle through `window.shell.preview*`. Contract: the [slot system standard](../../../.agents/notes/implemented/architecture/2026-07-22-slot-type-chain-implementation.md).

Guest documents may be any `http(s)` URL; the harness main window stays on loopback. `file:` and other non-http(s) document navigations are cancelled. Subresource loads (fonts, scripts, images) from remote CDNs are allowed so Vite/Next apps render. The guest uses a hashed persist partition (`persist:dshd-preview-` plus sha256 of the session cwd, or `shared` when cwd is missing) and never sends the user API key (same spirit as harness web: credentialed requests do not follow redirects). Outside Electron the empty-state card and this panel show `Browser previews are only available in the desktop app.` Discovered loopback ports stay listed while the occupant is mounted; each discovered row is `{ url, port }` only (no process name; Unix `lsof` is omitted too). A chip opens or navigates the guest. Guest `did-navigate` / `did-navigate-in-page` emit `shell:preview-state-change` so the URL bar and back/forward follow in-guest navigation. Chrome is icon Back / Forward / Reload (Stop while the guest is loading), an `Input` that submits on Enter (`Search or enter URL`), a system-browser icon that uses the URL bar even before a guest exists, and a More menu: Hard reload, Developer tools, Open/Close separate preview window, Show/Hide device toolbar, Pick element, Start/Stop recording, Screenshot, Appearance (System / Light / Dark), zoom out / `N%` / zoom in / Reset, Clear cookies, Clear cache. Show device toolbar insets the guest `BrowserView` through `previewResize` (`setBounds`) to the device rectangle (toolbar 32px, rails 10px) and paints that chrome on leftover `.host` letterbox (`--dsw-alias-bg-base`); it does not call CDP `Emulation.setDeviceMetricsOverride`. Pick inserts markdown into the composer when `appendComposerText` and a session exist. Recording is host-renderer `MediaRecorder`; frames arrive over IPC and artifacts land under `userData/preview-recordings/`. Occupancy hide includes More, device preset menus, PiP, and logically foreground renderer Modals/menus. Sidebar, docked, and mini-player presenters suspend native drawing through `previewHide` while a foreground surface owns the screen; closing it restores the same guest and presenter without closing a tab, navigating, or changing history or mini-player geometry. A failed main-frame load shows `This site can't be reached.` Inactive or renderer-occluded surface tabs keep the guest alive while removing its native view (`previewHide`); closing the Browser tab unmounts the panel and calls `previewClose`.

The `/client` exports are the plugin body (`apply`/`inject`) plus the contract types only; PreviewPanel remains package-internal behind the slot registration.

## Model Experience

None, as the Browser surface only previews an http(s) URL; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **One guest at a time** — the surfaces store holds a single preview; there is no tab strip inside the occupant.
- **Device toolbar does not emulate a CSS viewport** — `previewResize` sizes the `BrowserView` to the scaled visible rectangle. When the preset does not fit the host, the page lays out to that smaller view; there is no CDP `Emulation.setDeviceMetricsOverride`.
- **Discovered chips have no process name** — each row is `{ url, port }` on every platform; Unix `lsof` is omitted.

No runtime invariant companion is published; this package owns no independent durable event relationship, and focused package tests cover its UI or service behavior.
