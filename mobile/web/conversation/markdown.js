/**
 * Minimal, injection-safe Markdown for assistant timeline text. The parser
 * emits a structured block/span tree; the renderer (app.js) builds DOM with
 * createElement/textContent only — raw HTML in the input stays literal text
 * by construction, and link hrefs are limited to http(s).
 *
 * Supported: fenced code blocks (``` / ~~~, indented under list items),
 * headings, unordered/ordered/task lists with nesting and continuation lines,
 * block quotes, pipe tables, thematic breaks, paragraphs; inline code,
 * **bold**, *italic*, ~~strike~~, [label](https://url) and bare http(s) URLs.
 * Everything else renders as plain text — an honest fallback, not a bug.
 */

const INLINE_TOKEN = /(`[^`]+`)|(\*\*[^*]+\*\*)|(~~[^~]+~~)|(\*[^*\s][^*]*\*)|(\[[^\]]+\]\([^)\s]+\))|(https?:\/\/[^\s<>"'`\u0080-￿]+)/;
const LINK_SHAPE = /^\[([^\]]+)\]\(([^)\s]+)\)$/;
const URL_TAIL = /[.,;:!?'"。，；：！？、）】》」』]$/;

function safeHref(raw) {
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Sentence punctuation after a bare URL belongs to the sentence, not the link. */
function trimBareUrl(raw) {
  let url = raw;
  while (url) {
    const unbalanced = url.endsWith(')') && url.split('(').length < url.split(')').length;
    if (!URL_TAIL.test(url) && !unbalanced) break;
    url = url.slice(0, -1);
  }
  return url;
}

/**
 * Parse one line of inline markdown into spans.
 * @param {string} text
 * @returns {Array<{ kind: 'text'|'code'|'strong'|'em'|'strike'|'link', text: string, href?: string }>}
 */
function parseInline(text) {
  const spans = [];
  let rest = String(text ?? '');
  while (rest) {
    const match = INLINE_TOKEN.exec(rest);
    if (!match) {
      spans.push({ kind: 'text', text: rest });
      break;
    }
    if (match.index > 0) {
      spans.push({ kind: 'text', text: rest.slice(0, match.index) });
    }
    let token = match[0];
    if (token.startsWith('`')) {
      spans.push({ kind: 'code', text: token.slice(1, -1) });
    } else if (token.startsWith('**')) {
      spans.push({ kind: 'strong', text: token.slice(2, -2) });
    } else if (token.startsWith('~~')) {
      spans.push({ kind: 'strike', text: token.slice(2, -2) });
    } else if (token.startsWith('*')) {
      spans.push({ kind: 'em', text: token.slice(1, -1) });
    } else if (token.startsWith('[')) {
      const link = LINK_SHAPE.exec(token);
      const href = link ? safeHref(link[2]) : null;
      if (href) {
        spans.push({ kind: 'link', text: link[1], href });
      } else {
        // Unsafe scheme (javascript:, data:, …) or malformed → literal text.
        spans.push({ kind: 'text', text: token });
      }
    } else {
      token = trimBareUrl(token);
      const href = safeHref(token);
      spans.push(href ? { kind: 'link', text: token, href } : { kind: 'text', text: token });
    }
    rest = rest.slice(match.index + token.length);
  }
  return spans;
}

const HEADING = /^\s{0,3}(#{1,6})\s+(.*)$/;
const UL_ITEM = /^(\s*)[-*+]\s+(.*)$/;
const OL_ITEM = /^(\s*)(\d+)[.)]\s+(.*)$/;
const FENCE = /^(\s*)(```|~~~)\s*([\w+#.-]*)\s*$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const RULE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const TASK = /^\[([ xX])\]\s+(.*)$/;
const TABLE_DIVIDER = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function tableCells(line) {
  let body = line.trim();
  if (body.startsWith('|')) body = body.slice(1);
  if (body.endsWith('|') && !body.endsWith('\\|')) body = body.slice(0, -1);
  const cells = [];
  let cell = '';
  for (let i = 0; i < body.length; i += 1) {
    if (body[i] === '\\' && body[i + 1] === '|') {
      cell += '|';
      i += 1;
    } else if (body[i] === '|') {
      cells.push(cell.trim());
      cell = '';
    } else {
      cell += body[i];
    }
  }
  cells.push(cell.trim());
  return cells;
}

function tableAlign(divider) {
  return tableCells(divider).map((cell) => {
    const left = cell.startsWith(':');
    const right = cell.endsWith(':');
    if (left && right) return 'center';
    if (right) return 'right';
    if (left) return 'left';
    return null;
  });
}

/**
 * Parse markdown text into renderable blocks.
 * @param {string} text
 * @returns {Array<object>} blocks: {kind:'code',lang,text} | {kind:'heading',level,spans}
 *   | {kind:'list',ordered,start,items:spans[][],meta:{depth,ordered,checked}[]}
 *   | {kind:'quote',spans} | {kind:'table',align,header,rows} | {kind:'rule'}
 *   | {kind:'paragraph',spans}
 */
function parseMarkdown(text) {
  const lines = String(text ?? '').split('\n');
  const blocks = [];
  let paragraph = [];
  let list = null;
  let fence = null;

  const flushParagraph = () => {
    if (paragraph.length) {
      blocks.push({ kind: 'paragraph', spans: parseInline(paragraph.join('\n')) });
      paragraph = [];
    }
  };
  const flushList = () => {
    if (list) {
      blocks.push(list);
      list = null;
    }
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (fence) {
      if (new RegExp(`^\\s*${fence.marker}\\s*$`).test(line)) {
        blocks.push({ kind: 'code', lang: fence.lang, text: fence.lines.join('\n') });
        fence = null;
      } else {
        // Code nested under a list item carries the item's indentation.
        const indent = /^\s*/.exec(line)[0].length;
        fence.lines.push(line.slice(Math.min(indent, fence.indent)));
      }
      continue;
    }
    const fenceOpen = FENCE.exec(line);
    if (fenceOpen) {
      flushParagraph();
      flushList();
      fence = { indent: fenceOpen[1].length, marker: fenceOpen[2], lang: fenceOpen[3] || '', lines: [] };
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({ kind: 'heading', level: heading[1].length, spans: parseInline(heading[2]) });
      continue;
    }
    if (RULE.test(line)) {
      flushParagraph();
      flushList();
      blocks.push({ kind: 'rule' });
      continue;
    }
    if (line.includes('|') && TABLE_DIVIDER.test(lines[index + 1] || '') && (lines[index + 1] || '').includes('|')) {
      const header = tableCells(line);
      const align = tableAlign(lines[index + 1]);
      if (header.length > 1 || line.trim().startsWith('|')) {
        flushParagraph();
        flushList();
        const rows = [];
        index += 2;
        while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
          rows.push(tableCells(lines[index]).map(parseInline));
          index += 1;
        }
        index -= 1;
        blocks.push({ kind: 'table', align, header: header.map(parseInline), rows });
        continue;
      }
    }
    const quote = QUOTE.exec(line);
    if (quote) {
      flushParagraph();
      flushList();
      const previous = blocks[blocks.length - 1];
      if (previous?.kind === 'quote') {
        previous.spans.push({ kind: 'text', text: '\n' }, ...parseInline(quote[1]));
      } else {
        blocks.push({ kind: 'quote', spans: parseInline(quote[1]) });
      }
      continue;
    }
    const ul = UL_ITEM.exec(line);
    const ol = ul ? null : OL_ITEM.exec(line);
    if (ul || ol) {
      flushParagraph();
      const ordered = Boolean(ol);
      const depth = Math.min(3, Math.floor((ul || ol)[1].length / 2));
      if (!list || (depth === 0 && list.ordered !== ordered)) {
        flushList();
        list = { kind: 'list', ordered, start: ol ? Number(ol[2]) : 1, items: [], meta: [] };
      }
      const body = ul ? ul[2] : ol[3];
      const task = TASK.exec(body);
      list.items.push(parseInline(task ? task[2] : body));
      list.meta.push({ depth, ordered, checked: task ? task[1] !== ' ' : null });
      continue;
    }
    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }
    if (list && /^\s{2,}\S/.test(line)) {
      // An indented line without a marker continues the previous list item.
      list.items[list.items.length - 1].push({ kind: 'text', text: '\n' }, ...parseInline(line.trim()));
      continue;
    }
    flushList();
    paragraph.push(line);
  }
  // An unterminated fence still renders as code — losing it would hide text.
  if (fence) {
    blocks.push({ kind: 'code', lang: fence.lang, text: fence.lines.join('\n') });
  }
  flushParagraph();
  flushList();
  return blocks;
}

export { parseInline, parseMarkdown };
