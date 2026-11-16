/**
 * Pure mermaid source utilities — no mermaid import, so this module can ship
 * in the main client bundle while the heavy mermaid engine lives in a lazy
 * asset bundle (`lib/assets/mermaid.js`, loaded on demand by mermaid-lazy).
 * @module @changfenhuang/dsh-genui/client/mermaid-safe
 */

/** Elements mermaid 11 emits across the whitelisted diagram kinds (verified
 * against real renders of flowchart, sequence, class, state, gantt, pie, er,
 * journey, gitGraph, timeline and quadrantChart) plus the inert SVG
 * vocabulary those kinds may produce under other inputs (gradients,
 * clipPath, patterns, filters, linked `<use>`/`<a>`/`<image>`). mermaid's
 * default `htmlLabels` renders label text inside `foreignObject` as XHTML —
 * journey emits it even with htmlLabels off — so the HTML formatting
 * elements mermaid can generate for labels (marked's vocabulary) are
 * whitelisted too. Everything scriptable or embedding foreign content
 * (`script`, `iframe`, `object`, `embed`, `audio`, `video`, `form`, `meta`,
 * `link`, `math`, SMIL animation, …) is absent, hence rejected.
 * Compared lowercased: XML parsing is case-sensitive while the injected
 * markup is re-parsed by the case-folding HTML parser. */
const SAFE_SVG_ELEMENTS = new Set([
  // document structure
  'svg', 'g', 'defs', 'symbol', 'use', 'switch', 'title', 'desc',
  // geometry and text
  'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
  'text', 'tspan', 'textpath',
  // paint servers, clipping, markers
  'marker', 'clippath', 'mask', 'pattern',
  'lineargradient', 'radialgradient', 'stop',
  // filters (all primitives are inert; url-bearing attributes are checked below)
  'filter', 'feblend', 'fecolormatrix', 'fecomponenttransfer', 'fecomposite',
  'feconvolvematrix', 'fediffuselighting', 'fedisplacementmap', 'fedistantlight',
  'fedropshadow', 'feflood', 'fefunca', 'fefuncb', 'fefuncg', 'fefuncr',
  'fegaussianblur', 'feimage', 'femerge', 'femergenode', 'femorphology',
  'feoffset', 'fepointlight', 'fespecularlighting', 'fespotlight', 'fetile',
  'feturbulence',
  // embedded diagram stylesheet (content checked separately)
  'style',
  // links / images — URL attributes are checked below
  'a', 'image', 'img',
  // htmlLabels: the XHTML label body mermaid emits inside <foreignObject>
  'foreignobject',
  'div', 'span', 'p', 'br', 'wbr', 'hr',
  'em', 'strong', 'b', 'i', 'u', 's', 'del', 'ins', 'code', 'pre',
  'kbd', 'samp', 'var', 'sub', 'sup', 'small', 'mark', 'abbr', 'cite', 'q',
  'dfn', 'time', 'bdi', 'bdo',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'blockquote',
  'table', 'caption', 'colgroup', 'col', 'thead', 'tbody', 'tfoot',
  'tr', 'th', 'td',
  // markdown task lists render a disabled checkbox
  'input',
])

/** Attributes whose value is navigated to or fetched: only `#` fragments and
 * `http(s):` survive; `javascript:`, `vbscript:`, `data:` and everything else
 * throw. Compared by local name so `xlink:href` is covered. */
const SVG_URL_ATTRIBUTES = new Set([
  'href', 'src', 'data', 'action', 'formaction', 'poster', 'ping',
  'background', 'lowsrc', 'dynsrc', 'base', 'cite', 'longdesc', 'profile',
])

/** Whitespace, control and format characters a URL loader ignores — stripped
 * before scheme matching so `java\tscript:` or `&#xAD;` splits cannot hide a
 * scheme. */
const URL_NOISE = /[\s\p{Cc}\p{Cf}]/gu

/** CSS constructs that reach script or the network: `@import`, `expression(`,
 * `-moz-binding`, `behavior:`, `vbscript:`/`javascript:` in any value, and
 * `url(...)` whose target is not a same-document `#` fragment. Matched on the
 * normalized (noise-stripped, lowercased) text. */
const CSS_HAZARD = /@import|expression\(|behaviou?r:|-moz-binding|javascript:|vbscript:/
const CSS_URL = /url\(['"]?/g

function assertSafeCssText(compact: string, where: string): void {
  if (CSS_HAZARD.test(compact)) {
    throw new Error(`mermaid output failed the sanitization check: unsafe CSS in ${where}`)
  }
  CSS_URL.lastIndex = 0
  let match
  while ((match = CSS_URL.exec(compact)) !== null) {
    if (compact[CSS_URL.lastIndex] !== '#') {
      throw new Error(`mermaid output failed the sanitization check: external url() in ${where}`)
    }
  }
}

/** Throws when `svg` — parsed as XML, the same text that will be re-parsed by
 * the HTML parser at the injection point — contains a non-whitelisted
 * element, an `on*` event-handler attribute, a URL attribute pointing outside
 * the document, or hostile CSS. Under mermaid's strict security level a
 * legitimate diagram contains none of these, so a hit means the sanitizer
 * failed (a mermaid regression or a bypass): throw and let the caller show
 * the plain source fallback instead of injecting the markup. Exported for
 * tests; `renderMermaid` is the only caller in production. */
export function assertSafeSvg(svg: string): void {
  const fail = (reason: string): never => {
    throw new Error(`mermaid output failed the sanitization check: ${reason}; refusing to render`)
  }
  // A processing instruction (`<?xml-stylesheet href=…?>`) can attach an
  // external stylesheet to the document; mermaid output never carries one.
  if (svg.includes('<?')) fail('processing instruction')
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml')
  if (doc.doctype !== null || doc.getElementsByTagName('parsererror').length > 0) {
    fail('unparseable or DTD-bearing markup')
  }
  const root = doc.documentElement
  if (root === null || root.localName.toLowerCase() !== 'svg') fail('root is not <svg>')
  const elements = root.getElementsByTagName('*')
  for (let index = -1; index < elements.length; index++) {
    const el = index === -1 ? root : elements[index]!
    const tag = el.localName.toLowerCase()
    if (!SAFE_SVG_ELEMENTS.has(tag)) fail(`element <${el.tagName}>`)
    const attrs = el.attributes
    for (let i = 0; i < attrs.length; i++) {
      const attr = attrs[i]!
      const name = attr.name.toLowerCase()
      const local = (attr.localName ?? name).toLowerCase()
      if (name.startsWith('on') || local.startsWith('on')) {
        fail(`event handler ${attr.name}`)
      }
      const compact = attr.value.toLowerCase().replace(URL_NOISE, '')
      if (SVG_URL_ATTRIBUTES.has(local) || SVG_URL_ATTRIBUTES.has(name)) {
        if (!compact.startsWith('#') && !compact.startsWith('http:') && !compact.startsWith('https:')) {
          fail(`URL ${attr.name}=${JSON.stringify(attr.value)}`)
        }
      }
      assertSafeCssText(compact, `attribute ${attr.name}`)
    }
    if (tag === 'style') {
      assertSafeCssText((el.textContent ?? '').toLowerCase().replace(URL_NOISE, ''), '<style>')
    }
  }
}

/**
 * Best-effort repair of common model-authored label mistakes in graph /
 * flowchart sources, used only when the original fails to render:
 * - drop backticks — lexically illegal in mermaid labels (models embed
 *   ```dsh-ui style fences, which break the parser with "Lexical error");
 * - strip `<br/>` tags, which require htmlLabels (never enabled here);
 * - quote unquoted node labels containing CJK, spaces, or other characters
 *   mermaid's bare-label grammar rejects (observed live: `A[模型生成 spec]`).
 * Conservative by design: already-quoted labels, plain ASCII labels without
 * spaces, and non-flowchart kinds are left untouched (apart from the
 * backtick/`<br/>` sanitation above, which is harmless everywhere in a
 * flowchart).
 *
 * Labeled-edge spans (`-- 文本 -->`, `== 文本 ==>`, `-. 文本 .->`) are free
 * text and must never be quoted: wrapping them breaks the parser
 * ("Expecting 'LINK' … got 'STR'"), observed live with
 * `H -- 否(流式中) --> J`. Each span is swapped for a bracket-free
 * placeholder before quoting and restored verbatim afterwards, so the quote
 * pass can neither corrupt it nor be thrown off by inserted quotes
 * elsewhere on the line.
 *
 * Pipe-style edge labels (`-->|文本|`) are the opposite: an UNQUOTED pipe
 * label containing `@`, `[` or `]` breaks the parser ("Parse error", observed
 * live with `-->|6. 用户交互 → [genui-action]|`) because the brackets are
 * node grammar. Quoting the label text is display-neutral (mermaid renders
 * `-->|"文本"|` without the quotes) and parses. These spans are masked too,
 * so the node-label quote pass below cannot reach inside them and produce
 * nested quotes, and restored last.
 */
export function mermaidKind(code: string): string {
  const source = code.replace(/^\s*%%[^\n]*(?:\n|$)/gm, '').trim()
  return /^([A-Za-z]+)/.exec(source)?.[1] ?? ''
}

export function repairMermaidSource(code: string): string {
  const kind = mermaidKind(code)
  if (kind !== 'graph' && kind !== 'flowchart') return code
  const cleaned = code.replace(/`/g, '').replace(/<br\s*\/?>/gi, ' ')
  // A labeled edge is `--`/`==`/`-.` (not immediately `-->`/`==>`), a label
  // made of non-dash chars or single dashes (never `--`, which would start a
  // new edge), then the arrow. `[ \t]*` — never newlines — keeps the span on
  // one line.
  const EDGE = /(--|==|-\.)(?!>)[ \t]*([^-\n]|-(?!--))*?[ \t]*(-->|==>|\.->)/g
  const spans: string[] = []
  const masked = cleaned.replace(EDGE, (span) => {
    // Extra-length arrows are operator-only links, not free-text labels.
    if (/^[-=.<>]+$/.test(span)) return span
    spans.push(span)
    return `\uE000${spans.length - 1}\uE001`
  })
  // Only a link outside node shapes, quoted text and comments can introduce
  // a pipe edge label. Mask every such label before the node-quoting pass,
  // including already-quoted labels and labels containing parentheses.
  const PIPE_LINK = /(?:<|[ox])?(?:-{2,}[>ox]?|={2,}[>ox]?|-\.+-[>ox]?)[ \t]*\|/y
  const pipeSpans: string[] = []
  const closers: string[] = []
  let inQuote = false
  let copied = 0
  let maskedPipes = ''
  for (let i = 0; i < masked.length; i++) {
    const ch = masked[i]!
    if (inQuote) {
      if (ch === '\\') i++
      else if (ch === '"') inQuote = false
      continue
    }
    if (ch === '"') { inQuote = true; continue }
    if (ch === '%' && masked[i + 1] === '%') {
      const end = masked.indexOf('\n', i)
      if (end === -1) break
      i = end
      continue
    }
    if ('[({'.includes(ch)) { closers.push(ch === '[' ? ']' : ch === '(' ? ')' : '}'); continue }
    if (ch === closers[closers.length - 1]) { closers.pop(); continue }
    if (closers.length > 0 || !'<ox-='.includes(ch)) continue
    // Do not retry suffixes of a long operator run when no pipe follows it.
    if (i > 0 && '-=.'.includes(masked[i - 1]!)) continue
    PIPE_LINK.lastIndex = i
    const link = PIPE_LINK.exec(masked)
    if (link === null) continue
    const start = PIPE_LINK.lastIndex
    let end = start
    let labelQuote = false
    for (; end < masked.length && masked[end] !== '\n'; end++) {
      if (masked[end] === '\\' && labelQuote) { end++; continue }
      if (masked[end] === '"') labelQuote = !labelQuote
      if (masked[end] === '|' && !labelQuote) break
    }
    if (masked[end] !== '|') continue
    const text = masked.slice(start, end)
    const trimmed = text.trim()
    const label = /[@\[\]]/.test(trimmed) && !trimmed.includes('"') ? `"${trimmed}"` : text
    pipeSpans.push(`${link[0]}${label}|`)
    maskedPipes += masked.slice(copied, i) + `\uE002${pipeSpans.length - 1}\uE003`
    copied = end + 1
    i = end
  }
  maskedPipes += masked.slice(copied)
  const quoted = maskedPipes.replace(
    /([\[\(])([^\[\]\(\)\{\}"'\n]*)([\]\)])/g,
    (whole, open: string, label: string, close: string) => {
      const trimmed = label.trim()
      if (trimmed === '') return whole
      if (/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(trimmed) || /\s/.test(trimmed)) {
        return `${open}"${trimmed}"${close}`
      }
      return whole
    },
  )
  // PIPE spans can contain an earlier EDGE placeholder: restore inside-out.
  return quoted
    .replace(/\uE002(\d+)\uE003/g, (whole, i: string) => pipeSpans[Number(i)] ?? whole)
    .replace(/\uE000(\d+)\uE001/g, (whole, i: string) => spans[Number(i)] ?? whole)
}

/** Flowchart edge arrows. The negative lookahead on `-->(?!>)` keeps
 * sequence-diagram message arrows (`-->>`) from matching. */
const FLOWCHART_EDGE = /-->(?!>)|==>|-\.->/

/**
 * Lenient repair for sources that omit the mandatory diagram-type
 * declaration line — the #1 failure mode of model-generated mermaid (chat
 * assistants routinely emit `A --> B` without the leading `graph TD`).
 *
 * When the first token is not an already-declared `graph`/`flowchart` kind
 * but the body contains flowchart edge arrows, prepend `graph TD` so the
 * diagram renders instead of tripping the kind gate. Anything else — an
 * explicitly declared kind, a sequence/gantt/pie body (no flowchart edges),
 * or plain text — is returned unchanged: we never guess at the diagram type.
 */
export function ensureFlowchartKind(code: string): string {
  const trimmed = code.trim()
  const kind = mermaidKind(trimmed)
  if (['graph', 'flowchart', 'sequenceDiagram', 'classDiagram', 'stateDiagram', 'gantt', 'pie', 'erDiagram', 'journey', 'gitGraph'].includes(kind)) return code
  if (!FLOWCHART_EDGE.test(trimmed)) return code
  return `graph TD\n${trimmed}`
}
