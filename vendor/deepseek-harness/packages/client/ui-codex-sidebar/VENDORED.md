# Vendored Codex sidebar

This package is adapted from [ice-ai-lab/dsh-plugin-codex-ui](https://github.com/ice-ai-lab/dsh-plugin-codex-ui)
(`dsh-plugin-codex-ui` 0.2.0, MIT, Copyright (c) 2026 ice-ai-lab).

Whale Isle changes:

- The sidebar installs only while `html[data-dsh-skin='codex']` is active.
  Leaving the Codex skin disposes its slot registrations, stylesheet and
  dictionaries, so the shipped sidebar returns for Claude and DeepSeek.
- The wordmark is `Whale Isle`; the empty state uses the English product name.
- The package is a workspace dependency of `@deepseek-ai/dsh-web-app`; its
  `cordis.patch.yml` row is not applied separately because the web-app patch
  already inserts the row.

The upstream README and MIT LICENSE are kept beside this notice. The generated
`lib/client.js` and `lib/index.js` are copied verbatim except for the skin
activation wrapper described above; `lib/types/` stubs satisfy the host bundle
entry scan.
