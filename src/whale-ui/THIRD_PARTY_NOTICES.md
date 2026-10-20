# Whale UI source and dependency notices

Whale UI owns its runtime and component source under this directory. The language and React adapters derive from the MIT-licensed OpenUI SDK 1.0.0 at commit `f7109dd01b7bdfb14c8c9006eaca5a8b3cfc3a20` in <https://github.com/thesysdev/openui>. Their original license texts remain in [language/LICENSE](language/LICENSE) and [react/LICENSE](react/LICENSE).

The specialized visual components, constrained mathematical plot evaluator, schema validation, and artifact implementation derive from MIT-licensed dsh-genui 0.13.0 at commit `e64819af5968cf98e8bd28fd72a1cda977309214` in <https://github.com/omdsh-dev/dsh-genui>. The original license and its icon attribution remain in [genui/LICENSE](genui/LICENSE) and [genui/THIRD_PARTY_NOTICES.md](genui/THIRD_PARTY_NOTICES.md).

The basic component implementations, utility functions, theme, resource handlers and host integration are WhaleIsle code. Open Intelligent UI's published component and function APIs inform historical program support; its application source, private styles and media are not copied into this implementation or consumed by its build.

The build emits the actual runtime dependency license texts beside the viewer and engine bundles. React, Zod, Lucide, MapLibre, KaTeX, ECharts, Mermaid, three.js, their runtime dependencies, and the inherited OpenAI SVG glyph data retain their own licenses. The generated notices ship with the renderer rather than relying on a development installation.
