# Visual replies

Opt-in, self-contained HTML replies rendered inside the conversation. General settings owns the toggle, which defaults to off. Switching it off prevents new previews and publications; previously published pages remain available.

## Model Experience

When enabled, `html_preview` renders a complete HTML document in an isolated hidden Chromium page and returns a durable PNG, page height, console messages, and missing images. It also warns about SVG tags that the current Chromium renderer does not recognize, without rewriting or rejecting the page. A route that can consume images is required for screenshot inspection. `html_render` publishes the prepared document as a durable session attachment. The agent should inspect its screenshot before publishing, and use visual replies for explanations that benefit from diagrams, comparisons, or interactive controls.

Pages use inline CSS and JavaScript and embedded images. External network requests are disabled. Local images are embedded through the session filesystem authority. Pages have no access to the application's origin, filesystem, credentials, or tool invocation. This feature is separate from MCP Apps.

The client resolves page bytes through the owning session. The desktop renders an opaque-origin sandboxed iframe, vetoes document navigation, adapts height and theme, and offers an expanded view, HTML source, and save action. Ordinary browser and mobile clients offer source and save without executing generated HTML. Preview screenshots remain in the `html_preview` tool record rather than the published page card. Failed and unrecognized tool results remain readable. Page size and theme are the complete parent/frame message bridge.

Within a mounted desktop reply, inline and expanded preview share one loaded page. Switching to source and back, or closing the expanded view, preserves its interactive state. Missing, damaged, unauthorized, oversized, or invalid UTF-8 attachments show a localized reason without a reload action; temporary and unknown loading failures retain an explicit manual reload.
