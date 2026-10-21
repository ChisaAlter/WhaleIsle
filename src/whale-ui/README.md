# Whale UI

Whale UI owns the interactive-answer runtime used by WhaleIsle. The primary `whale-ui` language, historical `openui` / `openui-lang`, declarative `dsh-ui`, tool cards, and Session-local panels share one viewer, component registry, durable document store, host action bridge and diagnostic path.

## Source ownership

`language/` and `react/` contain owned TypeScript derived from the fixed MIT OpenUI SDK sources. `genui/` contains the fixed MIT specialized renderer and artifact sources, with its supported host interfaces documented in [genui/README.md](genui/README.md). `components/`, `functions/`, `resources/`, `runtime/` and `viewer/` are independent WhaleIsle implementations. [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) names donor revisions and licensing. No Open Intelligent UI application source or styles enter the build.

## Build and integration

Run `npm run prepare:whale-ui`; `prepare:openui` is the historical alias. The build checks this package's exact dependency and build-tool versions, synchronizes stale or missing installations from its frozen lockfile, generates the actual registry guide, bundles the opaque React19 viewer and fixed resource handlers, creates six lazy graph/export bundles, emits the Node tool validator, and collects runtime dependency licenses. The host chat shell retains React18. Generated files live in `src/renderer/whale-ui` and are excluded from source control. The Node validator is unpacked for the spawned Harness process.

The viewer uses the desktop [token mirror](../shared/dsh-webui-tokens.css), then applies the host's resolved semantic values to its document without remounting. Components and the generated guide follow the shared [design language](../../docs/design-language.md). Responsive grids stack within a narrow conversation; SVG charts measure their available width so axis text retains its size instead of shrinking with a fixed viewBox.

The desktop shell supplies the trusted viewer through its existing main-frame preload. `viewer/protocol.ts` defines channel `whale-ui`, protocol version 2, exact frame identity, resource replies, action receipts and engine bytes. The vendored chat package keeps the same wire constants locally because it cannot import source outside its compiler root. Its host plugin only registers the generated guide and `render_ui` tool when desktop capability is declared. Tool-owned successful metadata uses `{whaleUi:{version:1,language,program}}` and persists through the normal tool log.

## State and actions

Each viewer owns `createPersistentStore(createStore)`. Versioned saved values distinguish explicit fields from business objects and keep user edits separate from streamed defaults. Component state is stored in a reserved per-document bucket excluded from form payloads. The legacy adapter marks only exact old field wrappers and preserves unmatched values. Document identity belongs to the parent Session/message/block/fence; the viewer cannot choose an active Session or forge a panel sequence.

`@Set` and `@Reset` are local. Sequential action arguments evaluate immediately before execution. Conversation sends, clipboard, external links and downloads await host receipts; rejected or failed operations remain visible and stop the sequence. Resource requests accept only the three fixed paths and graph bundle requests accept only six fixed names. Generated frames have no filesystem, credential or arbitrary business-tool provider.

## Verification

`npm run typecheck:whale-ui` checks the owned source. `node --test src/whale-ui/tests/<suite>.mjs` runs focused regressions; browser-DOM suites need process isolation because each owns its global DOM. `host-runtime.mjs` consumes the generated validator and requires `prepare:whale-ui` first. Component and specialized engine doubles cover state and lifecycle without claiming real GPU/network output. Source Electron and actual Chromium integration checks cover those surfaces separately, with actual results in the PR.
