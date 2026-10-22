# Embedded GenUI source

This subtree absorbs the MIT embedded renderer from dsh-genui 0.13.0,
commit `e64819af5968cf98e8bd28fd72a1cda977309214`. The donor license and
OpenAI icon notice are retained here for the central Whale UI notices.

`embed.ts` is the source entry. It exports the renderer, schemas, normalized
spec processing, raw fence resolution with diagnostics, typed child traversal,
source-to-host code-block mapping, asset configuration and artifact APIs.
`client/embed.ts` re-exports that entry for source compatibility.

The host compiles a GenUI spec into its shared document runtime and supplies
`GenuiBlock` with `stateKey`, `initialState`, `onStateChange`, `onStateSnapshot`
and `onAction`. Identity is supplied explicitly; there is no plugin entry,
DOM scanner, current-session lookup, panel store or browser persistence store.
State changes notify the owner synchronously, including the last interaction
before unmount. A new `initialState` snapshot updates the mounted instance.
Fields, grouped answers, grading lock and durable presentation/control state
(`componentState`, addressed by renderer path) round-trip through that owner.
Password fields never enter snapshots or artifact defaults.

Actions return `Promise<GenuiActionAck>` with `status` equal to `queued`,
`completed`, `failed` or `cancelled`. The direct `onAction` prop wins over
`GenuiActionContext`. Bridge errors become failed acknowledgements and visible
errors; buttons show success only after a successful host acknowledgement.
Only slider actions are debounced. Replaced/unmounted slider requests and
requests pending when the spec/source revision changes resolve as cancelled.
The host action adapter maps a successfully queued common bridge result to
`{status: 'queued'}`.

Caught rendering failures use the optional `onRenderDiagnostics(snapshot)`
callback on both block wrappers. Supply `diagnosticSourceId` with the document
and source revision (defaults to `stateKey`, then `genui`). The snapshot is
`{sourceId, diagnostics: [{code, component, path, message}]}`; code is
`engine-error`, `plot-error` or `render-error`. It contains the active caught
ECharts, Mermaid, Three, plot and React render errors. Equal snapshots are not
re-emitted; recovery, removal, source change and unmount clear them. The host
maps nonempty snapshots into render diagnostics and incomplete status for that
source. No DOM alert inspection is needed. Async results from stale effects
cannot report into the next source. Failures show visible alerts and do not
start automatic retries. Plot chrome follows the shared locale.

`genuiChildSlots` in `client/walk-spec.ts` defines renderer-owned children for
layouts, list nodes, tabs, accordion sections and reachable table details.
Repair, validation, normalization, diagnostics, node accounting, rendering,
submissions and artifacts consume this contract. JSON values, file-tree records, chart option
objects, diagram data, meshes and unknown component payloads are opaque.
Unsupported component types produce errors in `processGenuiSpec`, including
structured `unsupportedComponents` entries with code, path and type.
`diagnoseUnsupportedGenuiTypes(value, supportedTypes)` exposes the same check
for the host and browser; the default is the native schema set. A supplied
set must match renderers actually installed by the caller. This embedded
renderer has no custom-component registry. Direct rendering of an unknown
type shows an explicit alert. Partial fence display can retain valid siblings,
but keeps the unavailable-component errors and never reports complete success.
JSON artifacts preserve unknown opaque records for interchange; standalone
HTML export rejects them because it cannot render them.

`resolveFence` distinguishes streaming partial display, complete success,
partial display with errors and failure. Whole JSON repair takes precedence
over prefix parsing; structural completion runs only for settled sources.
Displayed partial content retains validation errors and a false `complete`.
Actual component-node truncation becomes a `processGenuiSpec` error for every
adapter and prevents complete success while preserving the bounded preview.
Alias and unknown optional-field warnings remain non-fatal.
`sourceFencesOf` preserves all Markdown fences, while `sourceCodeBlocksOf` and
`sourceLanguageAt` apply the host predicate (by default excluding `math`,
which the host renders directly). No DOM/session lookup is involved.

## Engine and artifact build entries

The host build owns manifests, React 19 aliasing, output paths, CSS Modules
transformation and delivery. Build each engine independently as a single
browser IIFE with dependencies bundled and no cross-entry chunks:

| Output filename | Source entry | Registered engine |
| --- | --- | --- |
| `mermaid.js` | `client/asset-mermaid.ts` | `window.__GenuiAssets__.mermaid` |
| `three.js` | `client/asset-three.ts` | `window.__GenuiAssets__.three` |
| `echarts-core.js` | `client/asset-echarts-core.ts` | `window.__GenuiAssets__.echartsCore` |
| `echarts-full.js` | `client/asset-echarts.ts` | `window.__GenuiAssets__.echartsFull` |
| `icons.js` | `client/icons/asset-icons.ts` | `window.__GenuiAssets__.icons` |
| `standalone-runtime.js` | `client/standalone/runtime.tsx` | `window.__GenuiStandalone__` |

The regular embedded renderer keeps engines out of its eager bundle. Set
`setGenuiAssetResolver(filename => dataOrBlobURL)` for script-injected IIFEs,
`setGenuiAssetLoader(name => Promise<engine>)` for direct engine ownership, or
preload the registry above. `setGenuiBundleLoader(filename => Promise<Uint8Array>)`
supplies the same allowlisted bundle bytes plus `standalone-runtime.js` for
HTML export. No plugin HTTP route or boot graph is read.

The standalone runtime bundles React/ReactDOM and the local primitive adapter.
Its `standalone/katex-style.ts` marker is a build hook: replace it with KaTeX CSS
whose WOFF2 fonts are inlined. Engine registry preloads work through the ordinary
asset loader; aliasing to `standalone/asset-loader.ts` is optional. Bundle CSS
Modules into the runtime or inject the resulting CSS when executing it.

`setGenuiDownloadHandler((blob, filename) => Promise<void>)` forwards downloads
to the existing host bridge in the opaque viewer. Both JSON and HTML export
await that result and preserve meaningful errors. The native standalone page
can use the ordinary browser anchor download path. HTML includes only the
engines needed by its real component tree and embeds them as non-executable
Base64 payloads, then executes Blob script URLs under its CSP. JSON remains a
versioned `dsh-genui` v1 artifact for compatibility. Model actions are disabled
in an independent HTML artifact; local controls, quizzes, plots and sorting
continue to work. The standalone runtime embeds KaTeX CSS and data-URL fonts;
mathematical notation remains styled offline and its MathML stays accessible
without appearing twice.

Direct runtime dependencies are React 19, ReactDOM 19, KaTeX 0.18.2 and
mdast-util-from-markdown 2.0.3. Engine builds use Mermaid 11.16.1, three 0.180.0,
ECharts 6.1.0 and echarts-wordcloud 2.1.0. All are supplied by the owning package.
The primitive adapter is the donor's original standalone implementation, with
no cross-feature DSH UI value imports. Theme CSS retains scoped `--dsl-g-*`
tokens and consumes the host's `--dsw-*` token mapping. Localization uses the
`whale-ui.genui` namespace and explicit `setGenuiLocale`.

## Focused checks

Run from the repository root:

```sh
node --test src/whale-ui/tests/genui-runtime.mjs src/whale-ui/tests/genui-renderer.mjs
node src/whale-ui/node_modules/typescript/bin/tsc -p src/whale-ui/genui/tsconfig.check.json --pretty false
```

The renderer probes mount real React 19 components in jsdom. Engine lifecycle
probes supply controlled ECharts/three factories to observe selection and
disposal; they do not assert browser pixels or WebGL behavior. The lead owns
the production engine builds and desktop runtime verification.
