/**
 * The client's ONE syntax highlighter: a synchronous fine-grained shiki core
 * (JavaScript regex engine — no oniguruma WASM, bundle-friendly) with an
 * explicit grammar allowlist and a CSS-variables theme. Colors live in the
 * theme package's token sheets as `--shiki-*` custom properties (light and
 * dark blocks), never here — the repo's tokens-only styling rule.
 *
 * Only the three markdown-fence and `run_code` grammars (TypeScript, shell,
 * JSON) load into the singleton at boot — the set every session renders. Every
 * other language in the shared extension table
 * (`@deepseek-ai/dsh-util-code-language`: python, rust, yaml, markup, …) is
 * imported lazily and registered the first time such a language is requested,
 * so a session that never opens a code surface in one of those languages pays
 * neither the grammar modules nor their synchronous init. The first render of a
 * lazy language falls back to plain text while its grammar loads, then
 * {@link subscribeGrammarLoaded} notifies subscribers to re-render with
 * highlighting. An unknown or absent language falls back to plain text (no
 * highlighting, still monospace) — never an error.
 *
 * The engine machinery lives in `./highlight-engine.ts` — a worker-safe module
 * with no dynamic imports, so the review-diff highlighter can bundle it into a
 * Worker without pulling this table's lazy grammars along. This file re-exports
 * the shared surface so existing import sites stay put.
 */

import {
  grammarForHint, grammarRegistered, highlighter, lineSpans, registerGrammarModules,
  type HighlightSpan, type LangModule,
} from './highlight-engine.ts'
import type { GrammarState, ThemedToken } from 'shiki/core'

/** Bound main-thread tokenization cost for assistant-authored long lines. */
const TOKENIZE_MAX_LINE_LENGTH = 1000

export {
  grammarForHint, grammarRegistered, highlighterWarmed, isHighlighterWarm, lineSpans,
  registerGrammarModules, supportsHighlighting, warmHighlighter,
} from './highlight-engine.ts'
export type { HighlightSpan, LangModule } from './highlight-engine.ts'

/**
 * The non-boot extension grammars, each behind a dynamic import so its module
 * stays out of the boot chunk until a code surface renders that language.
 * Keyed by the grammar id (`LanguageRegistration.name`) the aliases resolve to.
 * `@shikijs/langs`' default export is a `LanguageRegistration[]`; the loader
 * hands the whole array to `loadLanguageSync`, which registers each entry
 * (including embedded sub-grammars). The three boot grammars are absent —
 * already loaded, so no alias value ever points at a missing entry here.
 */
const LAZY_GRAMMARS = new Map<string, () => Promise<LangModule>>([
  ['python', () => import('@shikijs/langs/python')],
  ['ruby', () => import('@shikijs/langs/ruby')],
  ['go', () => import('@shikijs/langs/go')],
  ['rust', () => import('@shikijs/langs/rust')],
  ['java', () => import('@shikijs/langs/java')],
  ['c', () => import('@shikijs/langs/c')],
  ['cpp', () => import('@shikijs/langs/cpp')],
  ['csharp', () => import('@shikijs/langs/csharp')],
  ['kotlin', () => import('@shikijs/langs/kotlin')],
  ['swift', () => import('@shikijs/langs/swift')],
  ['php', () => import('@shikijs/langs/php')],
  ['yaml', () => import('@shikijs/langs/yaml')],
  ['toml', () => import('@shikijs/langs/toml')],
  ['ini', () => import('@shikijs/langs/ini')],
  ['markdown', () => import('@shikijs/langs/markdown')],
  ['mdx', () => import('@shikijs/langs/mdx')],
  ['html', () => import('@shikijs/langs/html')],
  ['css', () => import('@shikijs/langs/css')],
  ['scss', () => import('@shikijs/langs/scss')],
  ['less', () => import('@shikijs/langs/less')],
  ['sql', () => import('@shikijs/langs/sql')],
  ['xml', () => import('@shikijs/langs/xml')],
  ['lua', () => import('@shikijs/langs/lua')],
  ['bat', () => import('@shikijs/langs/bat')],
  ['powershell', () => import('@shikijs/langs/powershell')],
  ['fish', () => import('@shikijs/langs/fish')],
  ['dotenv', () => import('@shikijs/langs/dotenv')],
  ['log', () => import('@shikijs/langs/log')],
  ['csv', () => import('@shikijs/langs/csv')],
  ['diff', () => import('@shikijs/langs/diff')],
  ['http', () => import('@shikijs/langs/http')],
  ['rst', () => import('@shikijs/langs/rst')],
  ['latex', () => import('@shikijs/langs/latex')],
  ['bibtex', () => import('@shikijs/langs/bibtex')],
  ['asciidoc', () => import('@shikijs/langs/asciidoc')],
  ['r', () => import('@shikijs/langs/r')],
  ['julia', () => import('@shikijs/langs/julia')],
  ['dart', () => import('@shikijs/langs/dart')],
  ['scala', () => import('@shikijs/langs/scala')],
  ['clojure', () => import('@shikijs/langs/clojure')],
  ['erlang', () => import('@shikijs/langs/erlang')],
  ['elixir', () => import('@shikijs/langs/elixir')],
  ['haskell', () => import('@shikijs/langs/haskell')],
  ['fsharp', () => import('@shikijs/langs/fsharp')],
  ['vb', () => import('@shikijs/langs/vb')],
  ['perl', () => import('@shikijs/langs/perl')],
  ['verilog', () => import('@shikijs/langs/verilog')],
  ['system-verilog', () => import('@shikijs/langs/system-verilog')],
  ['graphql', () => import('@shikijs/langs/graphql')],
  ['proto', () => import('@shikijs/langs/proto')],
  ['hcl', () => import('@shikijs/langs/hcl')],
  ['nix', () => import('@shikijs/langs/nix')],
  ['vue', () => import('@shikijs/langs/vue')],
  ['svelte', () => import('@shikijs/langs/svelte')],
  ['make', () => import('@shikijs/langs/make')],
  ['cmake', () => import('@shikijs/langs/cmake')],
  ['groovy', () => import('@shikijs/langs/groovy')],
])

/** Grammar ids whose lazy import is in flight or done, so it is requested once. */
const requested = new Set<string>()
/** Subscribers re-rendered after a lazy grammar registers (React callers). */
const listeners = new Set<() => void>()
/** Bumped on each lazy-grammar load; the `useSyncExternalStore` snapshot. */
let loadCount = 0

/**
 * Subscribe to lazy-grammar load completions; `listener` fires after a
 * {@link LAZY_GRAMMARS} grammar finishes registering on the singleton, so a
 * caller that rendered its plain fallback while the grammar loaded can
 * re-highlight. Uses the `useSyncExternalStore` subscribe signature; pair it with
 * {@link grammarLoadCount} as the snapshot. Returns an unsubscribe function.
 * @param listener - invoked (no args) on each grammar-load completion.
 * @returns a disposer that removes the listener.
 */
export function subscribeGrammarLoaded(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/**
 * The lazy-grammar load counter — a value that changes on every load, so a
 * `useSyncExternalStore` snapshot re-renders the subscriber when a grammar
 * registers. Opaque: only its identity across renders matters.
 * @returns the current load count.
 */
export function grammarLoadCount(): number {
  return loadCount
}

/**
 * Ensure the grammar `resolved` names is registered. A boot grammar (not in
 * {@link LAZY_GRAMMARS}) and an already-loaded lazy grammar report ready
 * synchronously; a lazy grammar not yet loaded starts its import (once) and
 * reports not-ready, so the caller renders plain until a
 * {@link subscribeGrammarLoaded} listener fires.
 * @param resolved - the grammar id an alias resolved to.
 * @returns whether the grammar is registered and ready to tokenize now.
 */
function ensureGrammar(resolved: string): boolean {
  const load = LAZY_GRAMMARS.get(resolved)
  // A boot grammar (already registered) has no lazy loader; it is always ready.
  if (load === undefined) return true
  if (grammarRegistered(resolved)) return true
  if (!requested.has(resolved)) {
    requested.add(resolved)
    void load().then((mod) => {
      registerGrammarModules(mod.default)
      loadCount += 1
      for (const listener of listeners) listener()
    })
  }
  return false
}

/**
 * Grammar-module requests keyed by grammar id, memoized so repeated diffs in
 * one language share a single lazy chunk fetch.
 */
const grammarModules = new Map<string, Promise<LangModule['default'] | undefined>>()

/**
 * Fetch one lazy grammar's registration data WITHOUT registering it on this
 * realm's singleton — the review-diff Worker registers posted registrations on
 * its own highlighter. Resolves `undefined` when `resolved` names a boot
 * grammar (already in every realm) or a failed import; the caller then treats
 * the job as unhighlightable rather than retrying.
 * @param resolved - a grammar id that {@link grammarForHint} produced.
 * @returns the `LanguageRegistration[]` to `postMessage`, or `undefined`.
 */
export function fetchGrammarModule(resolved: string): Promise<LangModule['default'] | undefined> {
  const load = LAZY_GRAMMARS.get(resolved)
  if (load === undefined) return Promise.resolve(undefined)
  let pending = grammarModules.get(resolved)
  if (pending === undefined) {
    pending = load().then(mod => mod.default, () => undefined)
    grammarModules.set(resolved, pending)
  }
  return pending
}

/**
 * Highlight `code` into shiki's HTML (a single `<pre class="shiki">` tree)
 * when `lang` maps to a registered grammar; `undefined` means the caller
 * renders its plain fallback. A lazy grammar not yet loaded returns `undefined`
 * for this call and loads in the background; subscribe with
 * {@link subscribeGrammarLoaded} to re-highlight once it registers.
 * @param code - the source text.
 * @param lang - the language hint (a markdown fence info string or a fixed caller id).
 * @returns the highlighted HTML, or `undefined` for unknown or not-yet-loaded languages.
 */
export function highlightToHtml(code: string, lang: string | undefined): string | undefined {
  const resolved = grammarForHint(lang)
  if (resolved === undefined) return undefined
  if (!ensureGrammar(resolved)) return undefined
  return highlighter().codeToHtml(code, {
    lang: resolved, theme: 'css-variables', tokenizeMaxLineLength: TOKENIZE_MAX_LINE_LENGTH,
  })
}

/**
 * Incremental highlighter for one growing streaming fence. TextMate
 * tokenization is line-based and forward-only — a line's tokens depend only on
 * its own text and the grammar state entering it — so appended text never
 * changes a completed line's tokens. The session caches the spans of every
 * completed line together with the grammar state after them;
 * {@link updateFrame} reports only newly completed lines plus the still-growing
 * last line, while {@link update} materializes the complete compatibility
 * result. Per-call tokenization cost therefore excludes the completed prefix,
 * and the result equals a from-scratch tokenization of the same code.
 * Non-append input and a change of resolved grammar reset the cache and
 * re-tokenize fully, so any input stays correct.
 */
export class StreamingHighlightSession {
  /** Grammar id the cache was built with; a different resolution resets it. */
  private resolved: string | undefined
  /** Newline-terminated source prefix covered by {@link spans}. */
  private prefix = ''
  /** Cached spans, one entry per completed line of {@link prefix}. */
  private spans: HighlightSpan[][] = []
  /** Grammar state after {@link prefix}; undefined = the grammar's initial state. */
  private state: GrammarState | undefined
  private lastCode: string | undefined
  private lastLang: string | undefined
  private lastResult: HighlightSpan[][] | undefined
  private generation = 0
  private lastFrame: StreamingHighlightFrame | undefined

  private reset(resolved: string | undefined): void {
    this.resolved = resolved
    this.prefix = ''
    this.spans = []
    this.state = undefined
    this.generation += 1
    this.lastFrame = undefined
  }

  /** Tokenize `text` with `resolved`, resuming from the cached grammar state when one exists. */
  private tokenize(resolved: string, text: string): ThemedToken[][] {
    return highlighter().codeToTokensBase(text, {
      lang: resolved,
      theme: 'css-variables',
      tokenizeMaxLineLength: TOKENIZE_MAX_LINE_LENGTH,
      ...(this.state === undefined ? {} : { grammarState: this.state }),
    })
  }

  /**
   * Tokenize one update as a delta for a retained renderer.
   * @param code - the fence text accumulated so far.
   * @param lang - the language hint.
   * @returns Newly completed lines plus the current tail, or `undefined` for the plain arm.
   */
  updateFrame(code: string, lang: string | undefined): StreamingHighlightFrame | undefined {
    if (code === this.lastCode && lang === this.lastLang && this.lastFrame !== undefined) {
      return this.lastFrame
    }
    this.lastCode = code
    this.lastLang = lang
    this.lastResult = undefined
    const resolved = grammarForHint(lang)
    if (resolved === undefined || !ensureGrammar(resolved)) {
      this.reset(undefined)
      return undefined
    }
    if (resolved !== this.resolved || !code.startsWith(this.prefix)) this.reset(resolved)
    const firstNewLine = this.spans.length
    const rest = code.slice(this.prefix.length)
    const lastNewline = rest.lastIndexOf('\n')
    if (lastNewline >= 0) {
      const grownEnd = rest[lastNewline - 1] === '\r' ? lastNewline - 1 : lastNewline
      const tokens = this.tokenize(resolved, rest.slice(0, grownEnd))
      for (const line of tokens) this.spans.push(lineSpans(line))
      this.state = highlighter().getLastGrammarState(tokens)
      this.prefix = code.slice(0, this.prefix.length + lastNewline + 1)
    }
    this.lastFrame = {
      generation: this.generation,
      appended: this.spans.slice(firstNewLine),
      tail: this.tokenize(resolved, rest.slice(lastNewline + 1)).map(lineSpans),
    }
    return this.lastFrame
  }

  /**
   * Tokenize the fence's current text into per-line highlighted runs;
   * `undefined` means the caller renders its plain fallback. Idempotent per
   * (`code`, `lang`) input — repeated calls return the identical result array —
   * and a retained line keeps its span-array identity across growing calls, so
   * a React caller can reuse cached line elements. A lazy grammar not yet
   * loaded returns `undefined` and loads in the background exactly as
   * {@link highlightToHtml} does; the next call after it registers highlights.
   * @param code - the fence text accumulated so far (display-trimmed, no synthetic trailing newline).
   * @param lang - the language hint (a markdown fence info string).
   * @returns one entry per line of `code` (each an array of runs), or `undefined` for unknown or not-yet-loaded languages.
   */
  update(code: string, lang: string | undefined): readonly HighlightSpan[][] | undefined {
    if (code === this.lastCode && lang === this.lastLang && this.lastResult !== undefined) {
      return this.lastResult
    }
    const frame = this.updateFrame(code, lang)
    if (frame === undefined) return undefined
    this.lastResult = [...this.spans, ...frame.tail]
    return this.lastResult
  }
}

/** One retained-renderer update from {@link StreamingHighlightSession.updateFrame}. */
export interface StreamingHighlightFrame {
  /** Changes whenever prior completed lines must be discarded. */
  readonly generation: number
  /** Completed lines added since the preceding frame in this generation. */
  readonly appended: readonly HighlightSpan[][]
  /** The still-growing final line or lines, replaced by the next frame. */
  readonly tail: readonly HighlightSpan[][]
}

/**
 * Tokenize `code` into per-line highlighted runs when `lang` maps to a
 * registered grammar; `undefined` means the caller renders its plain fallback.
 * A line-numbered view needs the token runs split per line (one gutter number
 * per line), which the single-`<pre>` {@link highlightToHtml} does not expose,
 * so this returns shiki's own 2D line/token structure narrowed to what a run
 * renders. Each run's color is a `--shiki-*` custom property, keeping token
 * colors on the theme package's sheets exactly as the HTML path does; the
 * markup font-style bits the theme lets through (bold/italic/underline in
 * markdown scopes) are dropped — the line-numbered file view renders
 * color-only runs. The trailing newline shiki appends as a final empty line
 * is dropped so the run count matches the caller's own line array.
 * @param code - the source text.
 * @param lang - the language hint (a file-extension-derived language id).
 * @returns one entry per source line (each an array of runs), or `undefined` for unknown or not-yet-loaded languages.
 */
export function highlightLines(code: string, lang: string | undefined): HighlightSpan[][] | undefined {
  const resolved = grammarForHint(lang)
  if (resolved === undefined) return undefined
  if (!ensureGrammar(resolved)) return undefined
  const { tokens } = highlighter().codeToTokens(code, {
    lang: resolved, theme: 'css-variables', tokenizeMaxLineLength: TOKENIZE_MAX_LINE_LENGTH,
  })
  // shiki tokenizes `a\nb` into two lines; a trailing newline (`a\n`) adds a
  // third, empty line the caller's own line array does not carry. Drop that
  // one terminator line so the two structures stay in step. The explicit
  // `last !== undefined` (over `tokens[...]?.length`) keeps a single branch for
  // per-file coverage, matching TerminalBlock's terminator check.
  const last = tokens[tokens.length - 1]
  const lines = tokens.length > 1 && last !== undefined && last.length === 0
    ? tokens.slice(0, -1)
    : tokens
  return lines.map(line => line.map(token => ({ text: token.content, style: { color: token.color } })))
}
