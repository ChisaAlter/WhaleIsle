---
description: "Whale Isle brand occupants for the sidebar, active only in official builds; for users and maintainers choosing or replacing brand presentation."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-brand-official

English | [中文](README.zh.md)

## Summary

This package fills the sidebar brand slots in an `official` client build with the transparent whale-girl head, a wordmark on one line that follows the interface language: the matching name leads in larger type and the other name follows in smaller type, and “BASED ON DEEPSEEK HARNESS” beneath on desktop and Web. The leading name’s 屿 glyph (Chinese) or ISLE word (English) uses brand blue; the head has no square background. Its mark occupant supplies the same head to the collapsed rail's upper-left expand button, which swaps to the panel icon on hover or keyboard focus; the expanded sidebar hides that duplicate mark. Other build profiles keep the shell's fish mark and local-build label, while the official conversation hero uses a monochrome mask of the same head, inheriting the headline's theme color; other profiles keep the animated fish. It has no runtime state and does not affect model requests.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this plugin in the browser roster of a Whale Isle deployment, then build the client with the `official` profile so the occupants register.

### Choosing the profile

`DSH_CLIENT_BUILD_PROFILE` selects whether these brand slots are occupied. In an `official` build, both desktop and Web show Whale Isle. Any other build profile leaves the shell fallbacks — the fish mark and local-build label — in place. The official conversation hero uses the same head as an alpha mask filled with the headline's primary ink, dark in light themes and light in dark themes. Other profiles keep the animated hero fish from `dsh-client-ui-conversation`. The plugin still loads and validates in both cases; only registration is profile-gated.

### Replacing the brand

A deployment with its own identity leaves this package out and composes another package that occupies the sidebar and hero slots. Occupying a slot is the only composition route; there is no brand configuration surface here.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The two sidebar occupants install as one declaration-aware registration set: nested `ctx.slots.inject()` calls wait on the sidebar declaration and withdraw both occupants when it collapses. The hero mark registers independently through its own `ctx.slots.inject()` and follows the conversation declaration's lifetime. Both registration sets support late declaration and HMR. The browser half is [`src/client/index.ts`](src/client/index.ts); the node half is an empty Loader seat. The browser title is a build-environment concern (`DSH_CLIENT_TITLE`), outside the slot system.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the brand surface is not enough. They move from the slots this package occupies to the shell that renders them.

- [ui-sidebar](../ui-sidebar/README.md) — declares `sidebar.brand.mark` and `sidebar.brand.name` and renders their fallbacks.
- [ui-conversation](../ui-conversation/README.md) — declares `conversation.hero.brand.mark` in the hero.
- [Web client architecture](../../../docs/subsystems/web-client.md) — how browser plugin rows load and register slots.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package contributes browser presentation only; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define how brand presentation is supplied. They are current package constraints, not a brand-design comparison or a task backlog.

- **One occupant set** — alternative presentation belongs in another Cordis package occupying the same slots.
- **The browser title is independent** — `DSH_CLIENT_TITLE` selects title text at build time rather than through a UI slot.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
