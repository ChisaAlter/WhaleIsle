import { t } from "./locale";
import React, { useEffect, useId, useRef, useState } from "react";
import { z } from "zod";
import { useComponentState } from "@whale-ui/react";
import { alignment, alignSchema, color, colorSchema, content, define, justification, justifySchema, length, nodes, radius, radiusSchema, units, type Render } from "./common";

export const Col = define("Col", { children: nodes, gap: z.number().optional(), align: alignSchema.optional() }, "Vertical layout; gap and padding units are 4px. Default gap follows article spacing.", (p, render) => <div className="whale-col" style={{ gap: p.gap == null ? undefined : units(p.gap, 4), alignItems: alignment(p.align) }}>{render(p.children)}</div>);
export const Row = define("Row", { children: nodes, gap: z.number().optional(), align: alignSchema.optional(), justify: justifySchema.optional(), wrap: z.boolean().optional() }, "Horizontal layout with vertically centered children.", (p, render) => <div className="whale-row" style={{ gap: units(p.gap, 2), alignItems: alignment(p.align ?? "center"), justifyContent: justification(p.justify), flexWrap: p.wrap === false ? "nowrap" : "wrap" }}>{render(p.children)}</div>);
export const Box = define("Box", { children: nodes.optional(), direction: z.enum(["row", "col"]).optional(), gap: z.number().optional(), padding: z.number().optional(), background: colorSchema.optional(), radius: radiusSchema.optional(), border: z.boolean().optional(), width: length.optional(), height: length.optional(), flex: z.number().optional(), align: alignSchema.optional(), justify: justifySchema.optional(), wrap: z.boolean().optional() }, "Flexible container. gap and padding use 4px units: padding 3 = 12px, 4 = 16px, 5 = 20px; width and height use pixels/CSS lengths. Named backgrounds use soft theme tints.", (p, render) => <div className="whale-box" style={{ display: "flex", flexDirection: p.direction === "row" ? "row" : "column", gap: units(p.gap, 0), padding: units(p.padding, 0), background: color(p.background, true), borderRadius: p.radius != null ? radius(p.radius) : undefined, border: p.border ? "1px solid var(--whale-border)" : undefined, width: p.width, height: p.height, flex: p.flex, minWidth: 0, overflow: p.radius != null ? "hidden" : undefined, alignItems: alignment(p.align), justifyContent: justification(p.justify), flexWrap: p.wrap ? "wrap" : undefined }}>{render(p.children ?? [])}</div>);
/**
 * Columns for `count` children when `fit` columns of the minimum width fit. A
 * row that cannot hold every child is reflowed so its last row is at least half
 * full (4 → 2×2, 5 → 3+2, 6 → 3+3, 8 → 3+3+2) instead of leaving a single
 * orphan: the fewest rows win, then the fuller last row.
 */
export function balancedColumns(count: number, fit: number): number {
  const max = Math.max(1, Math.min(count, Math.floor(fit)));
  if (count <= max) return max;
  let best = max, bestRows = Infinity, bestFill = -1;
  for (let columns = max; columns >= Math.ceil(max / 2); columns--) {
    const rest = count % columns, fill = rest === 0 ? 1 : rest / columns, rows = Math.ceil(count / columns);
    if (fill < 0.5) continue;
    if (rows < bestRows || (rows === bestRows && fill > bestFill)) { best = columns; bestRows = rows; bestFill = fill; }
  }
  return best;
}
function GridView({ items, columns, minChildWidth, gap, render }: { items: unknown[]; columns?: number; minChildWidth?: number; gap?: number; render: Render }) {
  const root = useRef<HTMLDivElement>(null), [measured, setMeasured] = useState<number | undefined>();
  const min = minChildWidth == null ? undefined : Math.max(1, minChildWidth), gapPx = Math.max(0, gap ?? 4) * 4;
  const cap = columns == null ? items.length : Math.max(1, Math.min(24, Math.trunc(columns)));
  useEffect(() => {
    const element = root.current;
    if (min == null || !element || typeof ResizeObserver === "undefined") return;
    const update = () => setMeasured(balancedColumns(Math.min(items.length, cap), (element.clientWidth + gapPx) / (min + gapPx)));
    const observer = new ResizeObserver(update); observer.observe(element); update();
    return () => observer.disconnect();
  }, [min, gapPx, cap, items.length]);
  // Before measuring (and without ResizeObserver) the CSS auto-fit fallback applies.
  const template = min == null ? `repeat(${Math.max(1, Math.min(24, Math.trunc(columns ?? 2)))},minmax(0,1fr))`
    : measured != null ? `repeat(${measured},minmax(0,1fr))` : `repeat(auto-fit,minmax(min(100%,${min}px),1fr))`;
  return <div ref={root} className="whale-grid" data-fixed-columns={min == null || undefined} data-columns={measured} style={{ display: "grid", gap: units(gap, 4), gridTemplateColumns: template }}>{render(items)}</div>;
}
export const Grid = define("Grid", { children: nodes, columns: z.number().optional(), minChildWidth: z.number().optional(), gap: z.number().optional() }, "Equal columns; use minChildWidth 240–280 for readable responsive fields and cards. With minChildWidth, columns caps the count and a narrower page reflows into balanced rows (4 items → 2×2), never leaving one item alone on the last row.", (p, render) => <GridView items={p.children} columns={p.columns} minChildWidth={p.minChildWidth} gap={p.gap} render={render} />);
export const Card = define("Card", { children: nodes, variant: z.enum(["outline", "soft"]).optional(), padding: z.number().optional(), gap: z.number().optional() }, "Theme-aligned panel. padding and gap are 4px units, not pixels: padding 4 = 16px, padding 5 = 20px (default), gap 3 = 12px. Use a plain section for metrics; do not put each number in a separate card.", (p, render) => <section className="whale-card whale-col" data-variant={p.variant ?? "outline"} style={{ padding: units(p.padding, 5), gap: units(p.gap, 3) }}>{render(p.children)}</section>);
export const Carousel = define("Carousel", { children: nodes, itemWidth: z.number().optional(), gap: z.number().optional() }, "Horizontal, scrollable list with snap-aligned items.", (p, render) => <div className="whale-carousel" style={{ gap: units(p.gap, 3) }} tabIndex={0} role="region" aria-label={t("scrollableItems")}>{p.children.map((child: unknown, index: number) => <div key={index} style={{ flex: `0 0 min(85vw,${Math.max(80, p.itemWidth ?? 240)}px)`, scrollSnapAlign: "start", minWidth: 0 }}>{render(child)}</div>)}</div>);
function PopoverView({ trigger, content: body, render }: { trigger: unknown; content: unknown; render: Render }) {
  const [open, setOpen] = useState(false), id = useId(), root = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); root.current?.querySelector("button")?.focus(); } };
    document.addEventListener("pointerdown", close); document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", key); };
  }, [open]);
  return <span className="whale-popover" ref={root}><button type="button" className="whale-popover-trigger" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>{render(trigger)}</button>{open && <span className="whale-popover-body" id={id} role="dialog" aria-label={t("details")}>{render(body)}</span>}</span>;
}
export const Popover = define("Popover", { trigger: content, content }, "Click to show a small details panel; Escape or outside click closes it.", (p, render) => <PopoverView {...p} render={render} />);
function DetailsView({ label, children, defaultOpen, render }: { label: string; children: unknown[]; defaultOpen?: boolean; render: Render }) {
  const [open, setOpen] = useComponentState("open", defaultOpen ?? false);
  return <details className="whale-details" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary className="whale-details-summary">{label}</summary>
    <div className="whale-details-content">{render(children)}</div>
  </details>;
}
export const Details = define("Details", { label: z.string(), children: nodes, defaultOpen: z.boolean().optional() }, "Expandable secondary content, closed by default. Native keyboard disclosure; child inputs remain mounted and retain edits. Use for fee breakdowns, row editing and explanations after the main result.", (p, render) => <DetailsView {...p} render={render} />);
export const Divider = define("Divider", {}, "A subtle horizontal separator.", () => <hr className="whale-divider" />);
export const Spacer = define("Spacer", {}, "Fill remaining space in a row.", () => <span aria-hidden="true" style={{ flex: 1 }} />);
export const layoutDefinitions = [Col, Row, Box, Grid, Card, Carousel, Popover, Details, Divider, Spacer];
