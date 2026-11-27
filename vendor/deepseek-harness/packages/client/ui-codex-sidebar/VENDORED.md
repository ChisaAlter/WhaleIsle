# Vendored Codex sidebar

This package is adapted from [ice-ai-lab/dsh-plugin-codex-ui](https://github.com/ice-ai-lab/dsh-plugin-codex-ui)
(`dsh-plugin-codex-ui` 0.2.0, MIT, Copyright (c) 2026 ice-ai-lab).

WhaleIsle changes:

- The sidebar installs only while `html[data-dsh-skin='codex']` is active.
  Leaving the Codex skin disposes its slot registrations, stylesheet and
  dictionaries, so the shipped sidebar returns for Claude and DeepSeek.
- The wordmark is `WhaleIsle`; the empty state uses the English product name.
- The package is a workspace dependency of `@deepseek-ai/dsh-web-app`; its
  `cordis.patch.yml` row is not applied separately because the web-app patch
  already inserts the row.

The upstream README and MIT LICENSE are kept beside this notice. The adapted
`lib/` is checked in and consumed as source by the Harness build; no local
build generates it. The `lib/types/` stubs satisfy the host bundle entry scan.
