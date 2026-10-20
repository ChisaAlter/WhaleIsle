# Feature: Tool result images

| Field | Value |
| --- | --- |
| **id** | `tool-result-images` |
| **status** | `active` |
| **last verified** | 2026-10-17 — focused `ui-tool` specs; source-app `read_image` metadata, gallery/lightbox and history at normal and minimum window sizes |

## User paths

1. A browser, MCP, or other Tool returns one or more images → the collapsed Tool
   row shows an image count and expands to the ordered gallery.
2. The tool settles while its assistant turn is still running → the gallery is
   already available without waiting for turn completion.
3. Reopen a historical session → each image loads from its durable attachment,
   not from the original file path.
4. An image attachment cannot be loaded → the gallery shows the existing
   explicit load-failure and retry control.

## Invariants

- The settled result's own `content` image blocks are the only source of durable
  references; `presentationMeta` is not a second copy.
- `ui-tool` never persists image bytes and never resolves attachment URLs; the
  session-authorized loader and attachment presentation plugin own both.
- One shared `tool.call.images` slot serves `read_image` and every generic
  image-bearing Tool; a second declaration or a second persistence layer is
  forbidden.
- Malformed image metadata declines the whole gallery to the existing flattened
  text; partial galleries that misrepresent the result are forbidden.
- `read_image` keeps its path label and complete envelope body, including MIME,
  coordinate-scaling instructions and notes. XML wrappers are not displayed;
  non-image results keep their existing text and error output.

## Allowed touch

- `vendor/deepseek-harness/packages/client/ui-tool/` — generic card, image
  model, slot contract, and tests
- `vendor/deepseek-harness/packages/client/ui-attachment/` — only if the
  existing gallery needs a presentation fix
- `docs/features/tool-result-images.md`, `docs/decisions/implemented/product/`
  — this feature's contract and decision record

## Do not touch

- `packages/mcp/mcp-client/src/tools.ts` image admission and durable storage
- `src/main/*`, workflows, or lockfiles
- The PR #101-owned routing assertions while main is red

## Gates

| Kind | What |
| --- | --- |
| Automated | focused `ui-tool` client specs; `tsc -b packages/client/ui-tool`; governance/doc-sync |
| Manual / QA | live app check for browser screenshot, MCP image, multi-image order, history reopen, and unavailable-image error |

## Sources

- Decision: [Tool result images are visible through one shared gallery](../decisions/implemented/product/2026-09-22-tool-result-images.md)
- Issue: [GitHub issue #96](https://github.com/ChisaAlter/Deepseek-Harness-Desktop/issues/96)
- Implementation entry: `vendor/deepseek-harness/packages/client/ui-tool/src/client/tool/toolviews/GenericToolCard.tsx`
