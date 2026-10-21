# Owned language source

The language, parser, library and runtime TypeScript started from OpenUI SDK `@openuidev/lang-core` 1.0.0, commit `f7109dd01b7bdfb14c8c9006eaca5a8b3cfc3a20` (MIT). Original TS came from the installed package's `index.mjs.map` `sourcesContent`; the omitted token and export barrels were recovered from the same fixed upstream revision. See [LICENSE](./LICENSE).

Whale UI maintains these files directly. Its build imports `index.ts`, never the donor's compiled output. Telemetry, installation hooks and cloud entrypoints were excluded. Local library functions, runtime parser, prompt/schema generation and the provider-neutral Query/Mutation interface remain available. The viewer supplies no business tool provider.

Local repairs include explicit settled incomplete/unresolved diagnostics, Unicode identifiers and quoted object-key serialization, literal-only state defaults, bounded parsing/materialization/evaluation/rendering/store work, evaluated prop validation, deferred sequential actions and explicit null assignment semantics. Repeated declaration references share normalized expression nodes within one parse result; component value instances and runtime evaluations remain independent, so state reads, deferred actions and random calls keep their evaluation timing.
