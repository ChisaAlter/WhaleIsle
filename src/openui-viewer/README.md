# OpenUI answer viewer

This iframe renders the complete component library from the pinned
`vendor/open-intelligent-ui` snapshot. It does not own chat, authentication,
model calls, session history, or native permissions.

## Build and embed

`index.tsx` is the browser bundle entry. The repository's preparation script
bundles React 19.2.3 and the snapshot's locked OpenUI dependencies independently
of the host renderer. Keep the upstream `@/*` alias mapped to the snapshot's
`src` directory. The entry and library import the OpenUI, KaTeX, component, and
map CSS; font assets must be embedded as data URLs.

The browser build aliases `@openuidev/lang-core` to `runtime-core.ts`. This
adapter re-exports the pinned SDK and wraps its public Store operations to
retain dirty-key metadata; it does not change parsing or evaluation. Use the
original package for server builds. Only user-set or persisted keys go back to
the host. Pristine streamed defaults remain replaceable, and `@Reset` makes a
key pristine again. Controls remain usable while the upstream permits them.
Persistence has its own subscription: same-value edits and resets change dirty
identity even when the SDK correctly emits no ordinary value-change event.
The first hydration publishes only after both literal/form fields and reactive
bindings have been restored. Later initialization publishes only changed dirty
data; pristine defaults never enter the persistence map.

Build definitions:

- `process.env.NODE_ENV`: `"production"`
- `process.env.NEXT_PUBLIC_BASE_PATH`: `""`
- `__OPENUI_MAP_WORKER_SOURCE__`: the full, bundled MapLibre worker JavaScript

The worker runs as a self-contained data module. Chromium rejects `blob:null`
module workers in the opaque iframe; using a data URL retains the full MapLibre
worker without granting same-origin access or loading a remote worker script.

`document.cjs` exports `createOpenUiDocument({ script, style })`, which embeds the
trusted built bundle and its stylesheet under a fixed CSP. Pass only build
output to this constructor. Model-authored HTML belongs inside the library's
separately sandboxed `HtmlView`, not in this outer document.

The host sets `iframe.name` to `whale-openui:${instanceId}`, uses
`sandbox="allow-scripts"`, and supplies the fixed trusted document through
`srcDoc`. The viewer reads that id before emitting `ready`. It has no preload.
The parent must check `event.source === iframe.contentWindow` as well as the
channel, version, instance id and message type before taking an action. The
viewer checks the exact parent source and its fixed id for inbound messages.

## Host protocol

`protocol.ts` is the TypeScript contract. Every message has:

```ts
{ channel: "whale-openui", version: 1, instanceId: string, type: string }
```

After `ready`, send `render` with the OpenUI program, `streaming` flag, saved
state map, and `{ appearance: "light" | "dark", variables }` theme. Reuse the
same iframe while a program streams so controls retain their state. Save the
viewer's `state` events in the host's existing UI-instance storage. Echoing
state back as another render is unnecessary.

The viewer maps the host's `--text` and `--text-secondary` variables to OpenUI
text tokens. The SDK's foreground stays opaque because it also supplies inverse
text on solid buttons; the host's translucent `--bg` is not mapped to it. The
viewer body remains transparent. Remaining variables are inherited unchanged,
and the full upstream component, chart and status token sets remain available.

The viewer emits:

- `height`: current content height; the host decides its scroll allocation.
- `state`: the renderer's state map, without another wrapper.
- `assistant`: `message`, optional `formState` and optional action `context`.
  This includes `@ToAssistant` and buttons without an explicit action. The host
  sends it through its existing session/permission path.
- `open-url`: an absolute HTTP(S) URL for the host's approved external opener.
- `clipboard`: `requestId` and text. Reply with `clipboard-response` and a real
  `ok` result; the upstream Code button waits for that result before showing
  its copied state.
- `error`: a message and optional code.
- `resolved`: a completed, successfully parsed and rendered new `program`. The
  parent clears a prior error only if this program matches its current source.
  State, height, and theme changes do not clear errors. A failed React boundary
  recovers when the program changes, without routinely remounting the renderer;
  the most recent state map is retained for recovery hydration.
- `api-request`: `requestId`, one allowed path and string query parameters.

The only bridged helper paths are `/api/wiki`, `/api/image-search` and
`/api/street-route`. Reply with `api-response`, retaining `requestId`, HTTP
`status`, and the JSON `body`. The parent authenticates its own service request;
the iframe receives no session credential. Original helper call sites and
server routes remain in the snapshot. Other resource fetches retain browser
behavior, including map tiles and CDN resources.

No Query tool provider is installed in the chat viewer. The snapshot's
synthetic orders/tickets/traffic providers remain examples in its gallery and
benchmark, not live product data or agent tools.

## Source and permissions

See `vendor/open-intelligent-ui/UPSTREAM.md` for provenance. Its SDK dependencies have their own MIT
licenses. The outer iframe permits the media, map, font and nested HTML
capabilities already present in the snapshot; it is not an offline sandbox.
The Electron main process still owns navigation, child-window and IPC sender
checks. The snapshot's Next app and Cloud chat endpoint are not used by this
viewer.

## State regression checks

With Node 24 and the snapshot's locked dependencies already installed, run from
the repository root:

```sh
node --test src/openui-viewer/state-store.test.mjs
```

This focused check uses the real pinned SDK parser and store. It covers streamed
defaults, same-value dirty transitions, and complete mixed-field hydration. It
runs independently of the host's default test command.
