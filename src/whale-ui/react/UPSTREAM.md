# Owned React adapter

The React19 adapter started from OpenUI SDK `@openuidev/react-lang` 1.0.0, commit `f7109dd01b7bdfb14c8c9006eaca5a8b3cfc3a20` (MIT). Original TS/TSX was recovered from the installed package's `exports-CLfR509v.mjs.map` `sourcesContent`; the export barrel follows the same fixed revision. See [LICENSE](./LICENSE).

Whale UI owns these source files. Imports resolve the sibling owned language runtime. Cloud publication, CLI, developer preview and telemetry hooks were excluded. `Renderer` accepts an optional document-owned `Store` and awaits actual host action acknowledgements. Explicit field records never unwrap ordinary business objects. Form members register independently of storage layout. Durable component state uses deterministic source paths and a reserved store bucket excluded from submissions.

The adapter remains within the existing isolated React19 iframe. It does not create a model, network, filesystem or business tool provider.
