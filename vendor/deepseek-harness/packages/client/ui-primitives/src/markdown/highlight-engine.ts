/**
 * The worker-safe half of the client's shared syntax highlighter
 * (`./highlight.ts` owns the main-thread lazy-grammar machinery). Everything
 * here is free of dynamic imports so a bundler can fold it into a
 * self-contained Worker script without pulling every lazy grammar into the
 * worker text. The Worker is what keeps the one-time-per-rule-set scanner
 * build — an indivisible ~50-200 ms cost inside a single `codeToTokensBase`
 * call — off the main thread entirely.
 *
 * Grammar coverage differs from `highlight.ts` on purpose:
 * {@link grammarRegistered} reports only what the singleton has already
 * registered; a worker never lazy-imports a grammar itself. Grammar data for
 * the non-boot set arrives by `postMessage` and registers through
 * {@link registerGrammarModules}.
 */

import { createHighlighterCoreSync, createCssVariablesTheme } from 'shiki/core'
import { createJavaScriptRegexEngine, defaultJavaScriptRegexConstructor } from 'shiki/engine/javascript'
import langTs from '@shikijs/langs/typescript'
import langBash from '@shikijs/langs/shellscript'
import langJson from '@shikijs/langs/json'
import { HIGHLIGHT_PATTERN_TABLE } from './highlight-pattern-table.generated.ts'
import type { HighlighterCore, ThemedToken } from 'shiki/core'
import type { CSSProperties } from 'react'

/** A shiki grammar module's default export (a `LanguageRegistration[]`), taken
 *  from a boot grammar so no direct `@shikijs/types` dependency is needed. */
export type LangModule = { default: typeof langTs }

/**
 * Grammars the singleton loads at boot; each entry's own `name` is the id
 * `codeToTokens`/`codeToHtml` resolve. The JS-family aliases (js/jsx/ts/tsx)
 * resolve to the TypeScript grammar rather than a separate one: it tokenizes
 * plain TS/JS exactly, and JSX/TSX approximately (shiki's TS grammar is not the
 * dedicated TSX grammar, so JSX elements tokenize imperfectly) — an accepted
 * trade to keep the boot set to one JS-family grammar. Every other language in
 * the shared extension table loads lazily through the main-thread module's
 * grammar table, or arrives by message when this module runs inside a Worker.
 */
const LANGS = [langTs, langBash, langJson]

/**
 * Language ids (and aliases) the highlighter accepts; everything else renders
 * plain. A Map, not an object: fence info strings are assistant-authored, so
 * a label like `constructor` or `__proto__` must miss instead of resolving an
 * inherited property and crashing the renderer inside shiki. Keys cover both
 * the markdown-fence aliases `CodeBlock` uses, the file-extension language ids
 * `@deepseek-ai/dsh-util-code-language` resolves, and the short ids
 * `readLangHintForPath` persists, so every caller resolves the same grammars.
 * A new short name in the shared table must be aliased here too. The JS family maps to the TypeScript grammar (see {@link LANGS} for
 * the JSX/TSX approximation). A value not in {@link LANGS} names a
 * lazy-table grammar on the main thread, or a posted grammar inside a Worker.
 */
const LANG_ALIASES = new Map<string, string>([
  ['typescript', 'typescript'],
  ['ts', 'typescript'],
  ['tsx', 'typescript'],
  ['javascript', 'typescript'],
  ['js', 'typescript'],
  ['jsx', 'typescript'],
  ['shellscript', 'shellscript'],
  ['bash', 'shellscript'],
  ['sh', 'shellscript'],
  ['shell', 'shellscript'],
  ['zsh', 'shellscript'],
  ['json', 'json'],
  ['jsonc', 'json'],
  ['py', 'python'],
  ['python', 'python'],
  ['rb', 'ruby'],
  ['ruby', 'ruby'],
  ['go', 'go'],
  ['rs', 'rust'],
  ['rust', 'rust'],
  ['java', 'java'],
  ['c', 'c'],
  ['cpp', 'cpp'],
  ['cs', 'csharp'],
  ['csharp', 'csharp'],
  ['kotlin', 'kotlin'],
  ['swift', 'swift'],
  ['php', 'php'],
  ['yaml', 'yaml'],
  ['yml', 'yaml'],
  ['toml', 'toml'],
  ['ini', 'ini'],
  ['md', 'markdown'],
  ['markdown', 'markdown'],
  ['mdx', 'mdx'],
  ['html', 'html'],
  ['css', 'css'],
  ['scss', 'scss'],
  ['less', 'less'],
  ['sql', 'sql'],
  ['xml', 'xml'],
  ['lua', 'lua'],
  ['bat', 'bat'],
  ['batch', 'bat'],
  ['powershell', 'powershell'],
  ['ps1', 'powershell'],
  ['ps', 'powershell'],
  ['fish', 'fish'],
  ['properties', 'ini'],
  ['dotenv', 'dotenv'],
  ['env', 'dotenv'],
  ['log', 'log'],
  ['csv', 'csv'],
  ['diff', 'diff'],
  ['patch', 'diff'],
  ['http', 'http'],
  ['rst', 'rst'],
  ['latex', 'latex'],
  ['tex', 'latex'],
  ['bibtex', 'bibtex'],
  ['bib', 'bibtex'],
  ['asciidoc', 'asciidoc'],
  ['adoc', 'asciidoc'],
  ['r', 'r'],
  ['julia', 'julia'],
  ['jl', 'julia'],
  ['dart', 'dart'],
  ['scala', 'scala'],
  ['clojure', 'clojure'],
  ['clj', 'clojure'],
  ['erlang', 'erlang'],
  ['erl', 'erlang'],
  ['elixir', 'elixir'],
  ['ex', 'elixir'],
  ['exs', 'elixir'],
  ['haskell', 'haskell'],
  ['hs', 'haskell'],
  ['fsharp', 'fsharp'],
  ['fs', 'fsharp'],
  ['fsi', 'fsharp'],
  ['fsx', 'fsharp'],
  ['vb', 'vb'],
  ['vbnet', 'vb'],
  ['perl', 'perl'],
  ['pl', 'perl'],
  ['pm', 'perl'],
  ['verilog', 'verilog'],
  // Shiki's own `v` grammar is the V language; the fence label and the `.v`
  // extension both name Verilog here, so a future V registration needs a
  // different alias.
  ['v', 'verilog'],
  ['system-verilog', 'system-verilog'],
  ['systemverilog', 'system-verilog'],
  ['sv', 'system-verilog'],
  ['svh', 'system-verilog'],
  ['graphql', 'graphql'],
  ['gql', 'graphql'],
  ['proto', 'proto'],
  ['protobuf', 'proto'],
  ['hcl', 'hcl'],
  ['tf', 'hcl'],
  ['tfvars', 'hcl'],
  ['nix', 'nix'],
  ['vue', 'vue'],
  ['svelte', 'svelte'],
  ['make', 'make'],
  ['makefile', 'make'],
  ['mk', 'make'],
  ['cmake', 'cmake'],
  ['groovy', 'groovy'],
  ['gradle', 'groovy'],
])

/**
 * Resolve a language hint to the grammar id {@link LANG_ALIASES} selects.
 * @param lang - Language hint from a code surface: a canonical grammar id or the read card's persisted short id.
 * @returns The resolved grammar id, or `undefined` when the table aliases no grammar.
 */
export function grammarForHint(lang: string | undefined): string | undefined {
  return lang === undefined ? undefined : LANG_ALIASES.get(lang.toLowerCase())
}

/**
 * Whether a language hint can use the shared syntax highlighter.
 * @param lang - Language hint from a code surface.
 * @returns Whether the hint resolves to a supported grammar.
 */
export function supportsHighlighting(lang: string | undefined): boolean {
  return grammarForHint(lang) !== undefined
}

/** All token colors resolve through `--shiki-*` custom properties (theme package sheets). */
const cssVariablesTheme = createCssVariablesTheme({
  name: 'css-variables',
  variablePrefix: '--shiki-',
  fontStyle: true,
})

/**
 * The build-time pattern table as a lookup: TextMate pattern to the JavaScript
 * `RegExp` source and flags shiki's engine would otherwise derive on the main
 * thread. Built once at module load by
 * `scripts/generate-highlight-pattern-table.mjs`.
 */
const precompiledPatterns = new Map<string, readonly [string, string]>(HIGHLIGHT_PATTERN_TABLE)

/**
 * Shiki's engine cache, keyed by TextMate pattern. Shiki asks this map for a
 * pattern before calling {@link resolvePattern}, and keeps whatever it holds, so
 * a seeded entry lets the scanner build read a ready `RegExp` instead of
 * translating and compiling one. {@link warmHighlighter} fills it in slices.
 */
const patternCache = new Map<string, RegExp>()

/**
 * Build one pattern's `RegExp`.
 *
 * Shiki's JavaScript engine translates each Oniguruma pattern into JavaScript
 * source when it first builds the scanner that contains it. For the three boot
 * grammars that translation is ~145 ms of synchronous main-thread work
 * (measured; see the syntax-highlight scheduling decision record), so the
 * translated source ships in {@link HIGHLIGHT_PATTERN_TABLE} and this factory
 * only compiles it.
 *
 * Shiki also defers patterns longer than 3,000 characters until their first
 * match; that compilation counts against shiki's 500 ms per-line budget and can
 * return a partial token stream under host contention, so the unlisted fallback
 * compiles eagerly. Unlisted means a lazily loaded read-card grammar, or a
 * grammar whose patterns changed after a dependency upgrade — both keep working
 * at the pre-optimization cost rather than failing, and the package's
 * pattern-table spec fails in CI when the table falls behind the grammars.
 */
function resolvePattern(pattern: string): RegExp {
  const precompiled = precompiledPatterns.get(pattern)
  if (precompiled !== undefined) return new RegExp(precompiled[0], precompiled[1])
  return defaultJavaScriptRegexConstructor(pattern, {
    lazyCompileLength: Number.POSITIVE_INFINITY,
  })
}

const regexEngine = createJavaScriptRegexEngine({
  forgiving: true,
  cache: patternCache,
  regexConstructor: resolvePattern,
})

let singleton: HighlighterCore | undefined

/**
 * Construct the singleton. Grammar construction itself is cheap once the
 * pattern table is available (measured ~4 ms); the per-grammar scanner build
 * and first tokenize are what cost, and {@link warmHighlighter} schedules those.
 */
function createHighlighter(): HighlighterCore {
  return createHighlighterCoreSync({
    themes: [cssVariablesTheme],
    langs: LANGS,
    engine: regexEngine,
  })
}

/** The synchronous highlighter (one instance per document or worker realm). */
export function highlighter(): HighlighterCore {
  singleton ??= createHighlighter()
  return singleton
}

/** True once the singleton exists; warm-up is a no-op after that. */
export function isHighlighterWarm(): boolean {
  return singleton !== undefined
}

/**
 * Whether the grammar `resolved` names is already registered on this realm's
 * singleton — the worker-safe readiness check. Unlike the main thread's lazy
 * ensure, it never starts an import; a miss means the caller must supply the
 * grammar data (main thread) or ask for it (worker).
 * @param resolved - the grammar id an alias resolved to.
 * @returns whether the grammar is registered and ready to tokenize now.
 */
export function grammarRegistered(resolved: string): boolean {
  return highlighter().getLoadedLanguages().includes(resolved)
}

/**
 * Register grammar data that arrived from another realm (the worker receives
 * `LanguageRegistration[]` by `postMessage` — structured-cloneable plain data).
 * @param registrations - one grammar module's default export.
 */
export function registerGrammarModules(registrations: LangModule['default']): void {
  highlighter().loadLanguageSync(registrations)
}

/**
 * Warm-up lines per boot grammar, one scheduled task each.
 *
 * A TextMate grammar builds each rule's scanner the first time tokenizing text
 * descends into that rule, and that construction is the dominant remaining cost
 * (~50-100 ms for the first line that reaches a large rule set, measured). The
 * lines below therefore cover the constructs ordinary fences reach — a single
 * "hello world" line leaves every other rule set to be built inside a later
 * fence's render. They mirror `scripts/generate-highlight-pattern-table.mjs` and
 * the pattern-table spec.
 */
const BOOT_GRAMMAR_WARMUPS: readonly { readonly lang: string; readonly code: string }[] = [
  { lang: 'typescript', code: 'const answer: number = 42' },
  { lang: 'typescript', code: 'export function greet(name: string): string { return `hi ${name}` }' },
  { lang: 'typescript', code: 'interface User { id: number; tags: string[] }' },
  { lang: 'typescript', code: 'class Box<T> { constructor(private readonly value: T) {} }' },
  { lang: 'typescript', code: '// comment\nimport { a } from "mod"' },
  { lang: 'typescript', code: 'enum E { A = 1 }\ntype R = Record<string, () => Promise<void>>' },
  {
    lang: 'typescript',
    // A volume probe: the first real tokenize pays a fixed ~65 ms of cold
    // code-path cost (JIT tier-up plus rule scanners the one-line samples do
    // not reach); a few dozen ordinary lines push the hot path warm so that
    // cost lands here, in the warmup task, not in a reader's first slice.
    code: [
      'import { aggregate } from "./pipeline"',
      'export interface Metric { readonly name: string; weight: number }',
      'const DEFAULT_WEIGHTS = [0.12, 0.48, 0.99] as const',
      'export function score(samples: readonly Metric[], scale = 1): number {',
      '  let total = 0',
      '  for (const [index, sample] of samples.entries()) {',
      '    const weight = DEFAULT_WEIGHTS[index % DEFAULT_WEIGHTS.length] ?? 0',
      '    total += sample.weight * weight * scale',
      '  }',
      '  return Math.round(total * 100) / 100',
      '}',
      'export const label = (m: Metric) => `metric:${m.name}`',
      'async function drain(input: AsyncIterable<string>): Promise<string[]> {',
      '  const out: string[] = []',
      '  for await (const chunk of input) if (chunk.length > 0) out.push(chunk)',
      '  return out',
      '}',
      'switch (kind) { case "add": return 1; default: return 0 }',
      'const rx = /metrics\\.(ts|js)$/u',
      'try { JSON.parse(raw) } catch { /* ignore */ }',
    ].join('\n'),
  },
  { lang: 'shellscript', code: 'printf \'%s\\n\' "$HOME"' },
  { lang: 'shellscript', code: 'for file in *.txt; do wc -l "$file"; done' },
  { lang: 'shellscript', code: 'find . -name "*.ts" -print0 | xargs -0 wc -l' },
  { lang: 'json', code: '{"ready":true}' },
  { lang: 'json', code: '{"users":[{"id":1,"name":"a"}],"ok":false}' },
]

/**
 * How many translated patterns one scheduled task is allowed to prepare.
 * Preparing the whole table in one task is a long task of its own (measured
 * ~100 ms; a single pattern's V8 compile can reach ~14 ms), so the table is
 * seeded in slices and each slice gets its own background task.
 */
const PATTERN_PRECOMPILE_SLICE = 24

/**
 * Text each prepared pattern is run against. V8 compiles a `RegExp` on its
 * first `exec`, and that compile is the largest single step of a cold
 * highlighter build, so running every pattern once here pays it in slices
 * instead of inside the first fence's tokenize.
 */
const PATTERN_PRECOMPILE_PROBE = 'const answer: number = 42\necho "$HOME"\n{"ready":true}'

/**
 * Background-priority scheduling, falling back to a macrotask where the
 * Scheduler API is unavailable. Node timers are unref'd so a non-browser import
 * cannot pin the event loop.
 */
function scheduleWarmupTask(run: () => void): void {
  const scheduler = (globalThis as {
    scheduler?: { postTask?: (cb: () => void, opts?: { priority?: string }) => unknown }
  }).scheduler
  if (typeof scheduler?.postTask === 'function') {
    try {
      scheduler.postTask(run, { priority: 'background' })
      return
    } catch {
      // Fall through to the timer arm.
    }
  }
  const timer = setTimeout(run, 0)
  ;(timer as { unref?: () => void }).unref?.()
}

/**
 * Warm the singleton off the render path.
 *
 * Module load used to schedule `setTimeout(() => highlighter(), 0)`
 * unconditionally, so every document built the engine and tokenized all three
 * grammars during boot even when it never rendered a code fence. Initialization
 * is now requested the first time a code surface with a supported language
 * mounts (see `useViewportHighlighting`), and the work is split into background
 * tasks that keep each one short:
 *
 * 1. Compile the translated patterns in slices of
 *    {@link PATTERN_PRECOMPILE_SLICE}, seeding {@link patternCache}. Shiki's
 *    scanner reuses whatever the cache already holds, so this removes the
 *    oniguruma-to-JavaScript translation (~145 ms for the boot grammars) from
 *    the grammar tasks entirely.
 * 2. Tokenize representative lines per grammar, each in its own task. That
 *    is what builds a grammar's scanners, and the remaining cost is per-grammar
 *    rather than per-table.
 *
 * A surface that renders or scrolls into view before its grammar's task runs
 * still builds it synchronously through the main-thread module; correctness
 * never depends on warm-up, and a sliced task leaves the partially seeded
 * cache in a state the synchronous path can use.
 */
let warmupStarted = false
let warmupDone: Promise<void> | undefined

export function warmHighlighter(): void {
  if (warmupStarted) return
  warmupStarted = true

  warmupDone = new Promise<void>((resolve) => {
    const patterns = [...precompiledPatterns]
    const warmGrammar = (index: number): void => {
      const sample = BOOT_GRAMMAR_WARMUPS[index]
      if (sample === undefined) { resolve(); return }
      // `codeToTokensBase` + `lineSpans` is the same pipeline the retained
      // renderers run per slice, so the lazy rule compilation a real tokenize
      // would pay lands in this background task instead.
      const tokens = highlighter().codeToTokensBase(sample.code, {
        lang: sample.lang,
        theme: 'css-variables',
      })
      for (const line of tokens) lineSpans(line)
      scheduleWarmupTask(() => { warmGrammar(index + 1) })
    }
    const warmPatterns = (offset: number): void => {
      if (offset >= patterns.length) {
        scheduleWarmupTask(() => { warmGrammar(0) })
        return
      }
      for (const [pattern, [source, flags]] of patterns.slice(offset, offset + PATTERN_PRECOMPILE_SLICE)) {
        if (patternCache.has(pattern)) continue
        const regex = new RegExp(source, flags)
        // First exec is where V8 compiles the pattern; do it here, off the
        // render path, rather than inside the fence that first needs it.
        regex.lastIndex = 0
        regex.exec(PATTERN_PRECOMPILE_PROBE)
        patternCache.set(pattern, regex)
      }
      scheduleWarmupTask(() => { warmPatterns(offset + PATTERN_PRECOMPILE_SLICE) })
    }

    // Build the singleton first: `highlighter()` is cheap, and every later task
    // needs it.
    highlighter()
    scheduleWarmupTask(() => { warmPatterns(0) })
  })
}

/**
 * The off-render-path warmup's completion. Resolves immediately when warmup
 * never started or already finished; a caller that needs the one-time grammar
 * scanner build kept out of its own tasks can request {@link warmHighlighter}
 * and queue work behind this promise.
 * @returns a promise settling after the last warmup task.
 */
export function highlighterWarmed(): Promise<void> {
  return warmupDone ?? Promise.resolve()
}

/**
 * One highlighted run of a line: the text and the inline style shiki assigned
 * it. The css-variables theme colors every run through a `--shiki-*` custom
 * property, so `style.color` is always present; it is held as a style object
 * rather than a bare color so a run spreads onto a `<span style>` uniformly.
 * Plain data only — a worker's `postMessage` clones it unchanged.
 */
export interface HighlightSpan {
  text: string
  style: CSSProperties
}

/** vscode-textmate FontStyle bits shiki folds into `text-decoration` values. */
const DECORATION_BITS: readonly (readonly [number, string])[] = [[4, 'underline'], [8, 'line-through']]

/**
 * The inline style shiki's HTML arm assigns one token (`getTokenStyleObject`
 * mirrored onto React style keys): the css-variables color plus the
 * vscode-textmate font-style bits the theme lets through — italic (1), bold
 * (2), and the {@link DECORATION_BITS} decorations (the theme injects bold,
 * italic, and underline rules for markup scopes, so markdown fences carry
 * them). The theme has no per-scope backgrounds, so `background-color` never
 * occurs; the arm-parity tests fail loud if a shiki upgrade changes that.
 */
function spanStyle(token: ThemedToken): CSSProperties {
  const style: CSSProperties = { color: token.color }
  /* v8 ignore next -- fontStyle is optional in ThemedToken's type; tokenizeWithTheme always stamps it. */
  const bits = token.fontStyle ?? 0
  if ((bits & 1) !== 0) style.fontStyle = 'italic'
  if ((bits & 2) !== 0) style.fontWeight = 'bold'
  const decorations = DECORATION_BITS.filter(([bit]) => (bits & bit) !== 0)
  if (decorations.length > 0) style.textDecoration = decorations.map(([, value]) => value).join(' ')
  return style
}

/**
 * Narrow one tokenized line to the runs a `<span style>` renders, folding a
 * whitespace-only run into the token that follows it — shiki's default
 * `mergeWhitespaces` HTML behavior — with each run styled through
 * {@link spanStyle}, so the streaming spans and the settled `codeToHtml`
 * swap render one identical span tree. shiki exempts underlined/struck
 * whitespace from the fold; under the css-variables theme that case cannot
 * occur — its only underline rule styles inline-link scopes, whose spaced
 * text tokenizes as one run, and it injects no strikethrough rule — so the
 * unconditional fold here stays equivalent (the markdown arm-parity test
 * pins it). A line-trailing whitespace-only run has no follower and keeps
 * its own span, as in shiki.
 */
export function lineSpans(line: ThemedToken[]): HighlightSpan[] {
  const spans: HighlightSpan[] = []
  let pendingWhitespace = ''
  for (const [index, token] of line.entries()) {
    if (/^\s+$/.test(token.content) && index + 1 < line.length) {
      pendingWhitespace += token.content
      continue
    }
    spans.push({ text: pendingWhitespace + token.content, style: spanStyle(token) })
    pendingWhitespace = ''
  }
  return spans
}

/**
 * Tokenize `code` into per-line highlighted runs when `lang` maps to a grammar
 * already registered on this realm's singleton; `undefined` means the caller
 * renders (or replies) plain. This is the worker's whole-job entry: the worker
 * has no per-task budget, so it tokenizes the side in one call instead of
 * resuming a session. The trailing newline shiki appends as a final empty
 * token row is dropped so the run count matches the caller's line array.
 * @param code - the source text.
 * @param lang - the language hint (a file-extension-derived language id).
 * @returns one entry per source line (each an array of runs), or `undefined` for unknown or unregistered languages.
 */
export function tokenizeLines(code: string, lang: string | undefined): HighlightSpan[][] | undefined {
  const resolved = grammarForHint(lang)
  if (resolved === undefined || !grammarRegistered(resolved)) return undefined
  const { tokens } = highlighter().codeToTokens(code, {
    lang: resolved, theme: 'css-variables', tokenizeMaxLineLength: 1000,
  })
  // shiki tokenizes `a\nb` into two lines; a trailing newline (`a\n`) adds a
  // third, empty line the caller's own line array does not carry. Drop that
  // one terminator line so the two structures stay in step.
  const last = tokens[tokens.length - 1]
  const lines = tokens.length > 1 && last !== undefined && last.length === 0
    ? tokens.slice(0, -1)
    : tokens
  return lines.map(lineSpans)
}
