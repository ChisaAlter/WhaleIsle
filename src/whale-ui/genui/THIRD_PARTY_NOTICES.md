# Third-party notices

## OpenAI Apps SDK UI icons (MIT)

The icon glyphs bundled in `client/icons/icon-data.ts` and `client/icons/icon-data-full.ts` are copied from the
OpenAI Apps SDK UI icon set:

- Source: <https://github.com/openai/apps-sdk-ui>
- Pinned commit: `0f00143c7a639906f1621fe58e1b6be7b5bea46d`
- Upstream path: `src/components/Icon/svg`
- Vendored as: literal SVG geometry and attributes (no upstream component code), curated to 749 glyphs (64 inlined, 685 lazy-loaded); six glyphs with unsupported nested structures were excluded by the donor generator

```
Copyright 2025 OpenAI

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

The colour values referenced by the `--dsl-g-*` token layer are *not* copied
from that project: they resolve through the host's `--dsw-alias-*` tokens, and
the literals in `GenuiBlock.module.css` are last-resort fallbacks.

## KaTeX / Mermaid / ECharts / three.js

Whale UI builds those engines from the pinned package dependencies as separate
browser IIFE assets and supplies them through its trusted viewer asset bridge.
Standalone HTML exports embed only the assets required by their component tree,
plus the standalone runtime and KaTeX styles/fonts. Distribution must retain the
engines' notices and licenses alongside the central Whale UI notices.

This subtree absorbs dsh-genui 0.13.0 at
`e64819af5968cf98e8bd28fd72a1cda977309214` (MIT), including the embedded
component renderer, schemas, JSON guard/repair, math/diagram/engine helpers and
artifact formats. Its MIT text is retained in `LICENSE`. Host plugin entry,
DOM scanning, session resolver, panel store and achievement runtime were not
absorbed.
