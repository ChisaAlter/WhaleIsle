import { t } from "./locale";
import React, { createContext, useContext, useState, type ReactNode } from "react";
import { z } from "zod";
import katex from "katex";
import { color, colorSchema, content, define, Feedback, fontWeight, Glyph, nodes, textValue, webUrl, weights } from "./common";

/** Render a small, safe inline Markdown vocabulary without evaluating raw HTML. */
export function inlineMarkdown(text: string, depth = 0): ReactNode {
  if (depth > 8) return text;
  const tokens = /(\*\*([^*\n]+)\*\*|__([^_\n]+)__|`([^`\n]+)`|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|\*([^*\n]+)\*|_([^_\n]+)_|~~([^~\n]+)~~)/g;
  const nodes: ReactNode[] = []; let offset = 0; let match: RegExpExecArray | null;
  while ((match = tokens.exec(text))) {
    if (match.index > offset) nodes.push(text.slice(offset, match.index));
    const key = `m${match.index}`;
    if (match[2] || match[3]) nodes.push(<strong key={key}>{inlineMarkdown(match[2] || match[3], depth + 1)}</strong>);
    else if (match[4]) nodes.push(<code key={key}>{match[4]}</code>);
    else if (match[5]) nodes.push(<a key={key} href={webUrl(match[6])} target="_blank" rel="noopener noreferrer">{inlineMarkdown(match[5], depth + 1)}</a>);
    else if (match[7] || match[8]) nodes.push(<em key={key}>{inlineMarkdown(match[7] || match[8], depth + 1)}</em>);
    else nodes.push(<del key={key}>{match[9]}</del>);
    offset = match.index + match[0].length;
  }
  if (offset < text.length) nodes.push(text.slice(offset));
  return nodes.length ? nodes : text;
}
function CodeView({ code, language }: { code: string; language?: string }) {
  const [status, setStatus] = useState("");
  return <div className="whale-code"><div className="whale-code-tools"><span>{language}</span><button type="button" className="whale-button" data-variant="ghost" data-size="sm" onClick={async () => { try { await navigator.clipboard.writeText(code); setStatus(t("copied")); } catch (error) { setStatus(error instanceof Error ? error.message : t("copyFailed")); } }}><Glyph name="copy" size={14} />{status || t("copy")}</button></div><pre><code className={language ? `language-${language.replace(/[^\w-]/g, "")}` : undefined}>{code}</code></pre></div>;
}
const cells = (line: string) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(s => s.trim());
export function MarkdownView({ text }: { text: string }) {
  const lines = String(text ?? "").replace(/\r\n?/g, "\n").split("\n"), result: ReactNode[] = [];
  for (let i = 0; i < lines.length;) {
    const key = i, line = lines[i];
    if (!line.trim()) { i++; continue; }
    const fence = /^\s*(```+|~~~+)\s*([^\s]*)/.exec(line);
    if (fence) { const body: string[] = []; i++; while (i < lines.length && !lines[i].trim().startsWith(fence[1])) body.push(lines[i++]); i++; result.push(<CodeView key={key} code={body.join("\n")} language={fence[2]} />); continue; }
    const heading = /^(#{1,6})\s+(.*)/.exec(line);
    if (heading) { const Tag = `h${heading[1].length}` as "h1"; result.push(<Tag key={key}>{inlineMarkdown(heading[2])}</Tag>); i++; continue; }
    if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)) { result.push(<hr key={key} />); i++; continue; }
    if (/^\s*>/.test(line)) { const quote: string[] = []; while (i < lines.length && /^\s*>/.test(lines[i])) quote.push(lines[i++].replace(/^\s*>\s?/, "")); result.push(<blockquote key={key}><MarkdownView text={quote.join("\n")} /></blockquote>); continue; }
    const list = /^(\s*)([-+*]|\d+[.)])\s+(.*)/.exec(line);
    if (list) {
      const ordered = /^\d/.test(list[2]), entries: ReactNode[] = [];
      while (i < lines.length) { const item = /^(\s*)([-+*]|\d+[.)])\s+(.*)/.exec(lines[i]); if (!item || /^\d/.test(item[2]) !== ordered) break; const task = /^\[([ xX])\]\s+(.*)/.exec(item[3]); entries.push(<li key={i} style={{ marginInlineStart: `${Math.floor(item[1].length / 2)}em` }}>{task ? <><input type="checkbox" disabled checked={task[1] !== " "} aria-label={task[2]} /> {inlineMarkdown(task[2])}</> : inlineMarkdown(item[3])}</li>); i++; }
      result.push(ordered ? <ol key={key} start={Number.parseInt(list[2], 10)}>{entries}</ol> : <ul key={key}>{entries}</ul>); continue;
    }
    if (line.includes("|") && i + 1 < lines.length && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1])) {
      const headers = cells(line), align = cells(lines[i + 1]).map(cell => cell.endsWith(":") ? cell.startsWith(":") ? "center" : "right" : "left"), rows: string[][] = [];
      i += 2; while (i < lines.length && lines[i].includes("|") && lines[i].trim()) rows.push(cells(lines[i++]));
      result.push(<div className="whale-table-scroll" key={key}><table className="whale-table"><thead><tr>{headers.map((header, j) => <th key={j} style={{ textAlign: align[j] as "left" | "right" | "center" }}>{inlineMarkdown(header)}</th>)}</tr></thead><tbody>{rows.map((row, r) => <tr key={r}>{headers.map((_, j) => <td key={j} style={{ textAlign: align[j] as "left" | "right" | "center" }}>{inlineMarkdown(row[j] ?? "")}</td>)}</tr>)}</tbody></table></div>); continue;
    }
    const paragraph: string[] = [line]; i++;
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|\s*```|\s*~~~|\s*>|\s*[-+*]\s|\s*\d+[.)]\s)/.test(lines[i])) { if (lines[i].includes("|") && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1] ?? "")) break; paragraph.push(lines[i++]); }
    result.push(<p key={key}>{inlineMarkdown(paragraph.join("\n"))}</p>);
  }
  return <div className="whale-markdown">{result}</div>;
}
export const Title = define("Title", { text: z.string(), size: z.enum(["sm", "md", "lg", "xl", "2xl", "3xl"]).optional(), color: colorSchema.optional() }, "Page or section heading. Use md for the single page title, sm for a section; 2xl/3xl only for a key numeric value.", p => <h2 className="whale-title" data-size={p.size ?? "md"} style={{ color: color(p.color) }}>{p.text}</h2>);
export const Text = define("Text", { text: content, size: z.enum(["xs", "sm", "md", "lg"]).optional(), color: colorSchema.optional(), weight: weights.optional(), italic: z.boolean().optional(), lineThrough: z.boolean().optional(), tabularNums: z.boolean().optional(), maxLines: z.number().optional() }, "Paragraph with inline bold, italic, code and links; mixed arrays may contain components.", (p, render) => <div className="whale-text" data-size={p.size ?? "md"} style={{ color: color(p.color), fontWeight: fontWeight(p.weight), fontStyle: p.italic ? "italic" : undefined, textDecoration: p.lineThrough ? "line-through" : undefined, fontVariantNumeric: p.tabularNums ? "tabular-nums" : undefined, display: p.maxLines ? "-webkit-box" : undefined, WebkitLineClamp: p.maxLines ? Math.max(1, Math.trunc(p.maxLines)) : undefined, WebkitBoxOrient: p.maxLines ? "vertical" : undefined, overflow: p.maxLines ? "hidden" : undefined }}>{!Array.isArray(p.text) ? inlineMarkdown(textValue(p.text)) : p.text.map((item: unknown, i: number) => <React.Fragment key={i}>{typeof item === "string" ? inlineMarkdown(item) : render(item)}</React.Fragment>)}</div>);
export const Caption = define("Caption", { text: z.string(), color: colorSchema.optional() }, "Secondary small text.", p => <span className="whale-caption" style={{ color: color(p.color ?? "muted") }}>{p.text}</span>);
export const Label = define("Label", { text: z.string() }, "A field or group label.", p => <span className="whale-label">{p.text}</span>);
export const Badge = define("Badge", { text: z.string(), color: z.enum(["neutral", "info", "success", "warning", "danger", "purple", "pink"]).optional(), icon: z.string().optional() }, "Compact theme-colored tag with optional Lucide icon.", p => <span className="whale-badge" style={{ color: color(p.color ?? "neutral"), background: color(p.color ?? "neutral", true) }}>{p.icon && <Glyph name={p.icon} size={13} />}{p.text}</span>);
export const Link = define("Link", { text: z.string(), url: z.string() }, "Open an HTTP(S) web URL.", p => <a className="whale-link" href={webUrl(p.url)} target="_blank" rel="noopener noreferrer">{p.text}</a>);
const ListContext = createContext({ marker: "bullet", timeline: false });
export const ListItem = define("ListItem", { title: z.string(), description: z.string().optional(), marker: z.string().optional(), children: nodes.optional() }, "A list item with optional description, custom marker and child content.", (p, render) => <ListItemView {...p} render={render} />);
function ListItemView(p: any) { const ctx = useContext(ListContext); return <li className="whale-list-item" data-custom={p.marker != null || undefined} data-timeline={ctx.timeline || undefined}>{p.marker != null && <span className="whale-list-marker">{p.marker}</span>}<div><div className="whale-list-title">{inlineMarkdown(p.title)}</div>{p.description && <div className="whale-caption">{inlineMarkdown(p.description)}</div>}{p.render(p.children ?? [])}</div></li>; }
export const List = define("List", { items: z.array(z.union([z.string(), ListItem.ref])), marker: z.enum(["bullet", "number", "none"]).optional(), timeline: z.boolean().optional() }, "A bullet, numbered or unmarked list; timeline connects item markers.", (p, render) => { const Tag = p.marker === "number" ? "ol" : "ul"; return <ListContext.Provider value={{ marker: p.marker ?? "bullet", timeline: !!p.timeline }}><Tag className="whale-list" data-marker={p.marker ?? "bullet"} data-timeline={p.timeline || undefined}>{p.items.map((item: unknown, i: number) => typeof item === "string" ? <li key={i}>{inlineMarkdown(item)}</li> : <React.Fragment key={i}>{render(item)}</React.Fragment>)}</Tag></ListContext.Provider>; });
export const Markdown = define("Markdown", { text: z.string() }, "Safe Markdown prose including headings, lists, quotes, fenced code and tables.", p => <MarkdownView text={p.text} />);
export const Quote = define("Quote", { text: z.string(), cite: z.string().optional() }, "Quotation with a source attribution.", p => <blockquote className="whale-quote"><div>{inlineMarkdown(p.text)}</div>{p.cite && <cite>{p.cite}</cite>}</blockquote>);
export const Code = define("Code", { code: z.string(), language: z.string().optional() }, "Code block with a host-backed copy button.", p => <CodeView {...p} />);
export const MathComponent = define("Math", { tex: z.string(), inline: z.boolean().optional() }, "KaTeX formula; inline formulas sit within text.", p => {
  try { const html = katex.renderToString(p.tex, { displayMode: !p.inline, throwOnError: true, trust: false, strict: "warn", maxExpand: 1000 }); return <span className="whale-math" data-inline={p.inline || undefined} dangerouslySetInnerHTML={{ __html: html }} />; }
  catch (error) { return <Feedback error>{error instanceof Error ? error.message : textValue(error)}</Feedback>; }
});
export const Progress = define("Progress", { value: z.number(), max: z.number().optional(), label: z.string().optional(), color: z.enum(["info", "success", "warning", "danger", "neutral"]).optional() }, "Full-width progress bar for completion or a share of a goal: value out of max (default 100). With a label it shows the label and the percentage above the bar. Use it instead of drawing a bar from Box widths.", p => {
  const max = Number.isFinite(p.max) && p.max > 0 ? p.max : 100, value = Number.isFinite(p.value) ? Math.min(max, Math.max(0, p.value)) : 0;
  const percent = Math.round(value / max * 100);
  return <div className="whale-progress" role="progressbar" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} aria-label={p.label}>
    {p.label != null && <div className="whale-progress-head"><span>{p.label}</span><span>{percent}%</span></div>}
    <div className="whale-progress-track"><div className="whale-progress-fill" style={{ width: `${percent}%`, background: color(p.color ?? "info") }} /></div>
  </div>;
});
export const textDefinitions = [Title, Text, Caption, Label, Badge, Link, List, ListItem, Markdown, Quote, Code, MathComponent, Progress];
