---
description: "Browser approval UI that answers Host permission requests through the scoped interaction path."
kind: "package-reference"
---
# @deepseek-ai/dsh-client-ui-approval

English | [中文](README.zh.md)

## Summary

Browser approval presentation over the Agent-scoped Remote Event waterfall. The plugin publishes each pending request through `ctx.uiSession`, takes over the Conversation composer, optionally renders correlated Tool detail, and returns the user's decision to the waiting Host request. Use it when a browser must collect approval for a waiting Host operation.


The takeover matches the resident input card's actual width and height, including saved resize preferences and window changes. The hidden input remains measurable outside normal flow; approval detail scrolls inside the matched card while the action row remains visible.

Managed Project requests can appear in the Lead composer with the requesting work title, actual child command, and cwd snapshot. The child need not be retained in the browser. This changes presentation only; the Host keeps the decision and execution audit on that child. The session-scoped `conversation.approval.actions` list provides relevant session actions during composer takeover; Project uses it for the same Host stop command, including when its coordinator is running or a worker is preparing.


## Table of Contents

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

Focus the approval detail region to approve with Enter or reject with Escape. The mounted plugin reserves both keys against editable shortcuts. Enter on the focused Reject button retains its native reject action. Input controls and IME candidates keep their own keys. Keyboard and pointer actions share one pending-request lock; a withdrawn or replaced request cannot accept another answer, and an earlier failed answer cannot unlock its replacement.

When offered, **Always allow** is the highlighted primary button. Otherwise, the current-request allow action is primary. Enter in the detail region always grants the limited scope: once for a tool approval, or the current session for CUA. Persistent access requires explicitly activating Always allow. The shortcut reference uses Allow because the caller supplies that scope.

<a id="model-experience"></a>
## Model Experience

None, as this package presents approval requests in the browser and registers nothing model-facing.

#### KV Cache effect

None; approval request and response rendering does not alter a model request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The shared `conversation.approval.card` Factory presents reject, allow and an optional always-allow action, with caller-owned scope, subject metadata and answer callbacks. Tool approvals retain their two outcomes. Application consent can reuse the card without adopting tool-approval policy. Subject metadata enables left-aligned content and wrapping actions; callers that omit it retain inherited alignment and a single action row. Icons and labels identify the subject visually; the caller owns identity verification and saved grants.


<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
