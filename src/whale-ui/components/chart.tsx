import { t } from "./locale";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { useComponentState } from "@whale-ui/react";
import { color, define, Feedback, Glyph } from "./common";
import { dataFunctions } from "../functions/data";

export type ChartRow = Record<string, string | number>;
export function chartColumns(data: ChartRow[], x?: string, series?: string[]) {
  const keys = [...new Set(data.flatMap(row => Object.keys(row)))];
  const xKey = x ?? keys.find(key => data.some(row => typeof row[key] === "string"));
  return { x: xKey, series: series ?? keys.filter(key => key !== xKey && data.some(row => typeof row[key] === "number" && Number.isFinite(row[key]))) };
}
export function chartDomain(data: ChartRow[], series: string[], stacked: boolean) {
  const values = data.flatMap(row => stacked ? [series.reduce((sum, key) => sum + Math.max(0, Number(row[key]) || 0), 0), series.reduce((sum, key) => sum + Math.min(0, Number(row[key]) || 0), 0)] : series.map(key => Number(row[key]) || 0));
  let min = Math.min(0, ...values), max = Math.max(0, ...values);
  if (min === max) max = min + 1;
  const span = max - min;
  return { min: min < 0 ? min - span * .05 : min, max: max + span * .05 };
}
export function chartTicks(domain: { min: number; max: number }) {
  const rough = (domain.max - domain.min) / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const fraction = rough / magnitude;
  const unit = [1, 2, 2.5, 5, 10].find(value => value >= fraction) ?? 10;
  const step = unit * magnitude;
  const first = Math.floor(domain.min / step), last = Math.ceil(domain.max / step);
  const precision = Math.max(0, -Math.floor(Math.log10(step)) + (unit === 2.5 ? 1 : 0));
  // Integer indices avoid cumulative floating-point drift across fractional ticks.
  const ticks = Array.from({ length: last - first + 1 }, (_, index) => {
    const value = (first + index) * step;
    return value === 0 ? 0 : Number(value.toPrecision(12));
  });
  return { min: ticks[0], max: ticks[ticks.length - 1], step, precision, ticks };
}
const seriesColor = (index: number) => color(`chart${index % 6 + 1}`);
function pieArc(cx: number, cy: number, radius: number, start: number, end: number, inner = 0) {
  // A circle requires two arcs: one full SVG arc has coincident endpoints.
  const span = Math.min(end - start, Math.PI * 2 - .00001);
  const point = (r: number, angle: number) => `${cx + Math.cos(angle) * r},${cy + Math.sin(angle) * r}`;
  const large = span > Math.PI ? 1 : 0;
  const a = point(radius, start), b = point(radius, start + span);
  return inner ? `M${a} A${radius},${radius} 0 ${large} 1 ${b} L${point(inner, start + span)} A${inner},${inner} 0 ${large} 0 ${point(inner, start)} Z` : `M${cx},${cy} L${a} A${radius},${radius} 0 ${large} 1 ${b} Z`;
}
function ChartView(p: any) {
  const columns = useMemo(() => chartColumns(p.data, p.x, p.series), [p.data, p.x, p.series]);
  const [hidden, setHidden] = useComponentState<string[]>("hiddenSeries", []);
  const series = columns.series.filter(key => !hidden.includes(key));
  const figure = useRef<HTMLElement>(null);
  const [width, setWidth] = useState(640);
  const available = p.data.length > 0 && columns.series.length > 0;
  useEffect(() => {
    if (!figure.current || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      const next = Math.round(entry.contentRect.width);
      if (next > 0) setWidth(Math.max(240, next));
    });
    observer.observe(figure.current);
    return () => observer.disconnect();
  }, [available]);
  const height = Math.max(150, p.height ?? 240);
  const format = (value: number) => dataFunctions.Format({ value, kind: p.format ?? "number", currency: p.currency, decimals: Math.abs(value) >= 1000 ? 0 : undefined });
  const category = (row: ChartRow, index: number) => String((columns.x ? row[columns.x] : undefined) ?? index + 1);
  if (!p.data.length || !columns.series.length) return <Feedback>{!p.data.length ? t("noChartData") : t("noNumericSeries")}</Feedback>;
  const cartesian = !["pie", "donut"].includes(p.type);
  const legend = cartesian ? columns.series.map((key, index) => ({ key, label: key, color: seriesColor(index) })) : p.data.map((row: ChartRow, index: number) => ({ key: category(row, index), label: category(row, index), color: seriesColor(index) }));
  let graphic: React.ReactNode;
  if (!cartesian) {
    const key = series[0] ?? columns.series[0], values = p.data.map((row: ChartRow, index: number) => hidden.includes(category(row, index)) ? 0 : Math.max(0, Number(row[key]) || 0)), total = values.reduce((sum: number, n: number) => sum + n, 0);
    const radius = Math.max(12, Math.min(height / 2 - 14, width / 2 - 14, 170));
    let angle = -Math.PI / 2;
    graphic = total <= 0 ? <Feedback>{t("noPositiveValues")}</Feedback> : <svg viewBox={`0 0 ${width} ${height}`} className="whale-chart-svg" role="img" aria-label={`${p.type} chart of ${key}`}><title>{`${key}: ${format(total)}`}</title>{values.map((value: number, index: number) => { const start = angle; angle += value / total * Math.PI * 2; return value <= 0 ? null : <path key={index} d={pieArc(width / 2, height / 2, radius, start, angle, p.type === "donut" ? radius * .62 : 0)} fill={seriesColor(index)} stroke="var(--whale-bg)" strokeWidth={2} tabIndex={0} aria-label={`${category(p.data[index], index)}: ${format(value)}`}><title>{`${category(p.data[index], index)}: ${format(value)} (${dataFunctions.Format({ value: value / total * 100, kind: "percent", decimals: 1 })})`}</title></path>; })}{p.type === "donut" && <text x={width / 2} y={height / 2} textAnchor="middle" dominantBaseline="middle" fill="var(--whale-fg)" fontSize={22} fontWeight={600}>{format(total)}</text>}</svg>;
  } else {
    const left = 68, right = 22, top = 18, bottom = 40, plotWidth = width - left - right, plotHeight = height - top - bottom;
    const domain = chartTicks(chartDomain(p.data, series, !!p.stacked)), y = (value: number) => top + (domain.max - value) / (domain.max - domain.min) * plotHeight;
    const tickFormat = (value: number) => new Intl.NumberFormat(undefined, {
      style: p.format === "currency" ? "currency" : p.format === "percent" ? "percent" : "decimal",
      ...(p.format === "currency" ? { currency: p.currency ?? "USD" } : {}),
      notation: domain.precision > 6 || Math.abs(value) >= 1e9 ? "scientific" : "standard",
      minimumFractionDigits: 0, maximumFractionDigits: domain.precision > 6 || Math.abs(value) >= 1e9 ? 2 : domain.precision,
    }).format(p.format === "percent" ? value / 100 : value);
    const xNumbers = p.data.map((row: ChartRow, index: number) => columns.x ? Number(row[columns.x]) || 0 : index + 1), xMin = Math.min(...xNumbers), xMax = Math.max(...xNumbers);
    const x = (index: number) => p.type === "scatter" ? left + (xNumbers[index] - xMin) / (xMax - xMin || 1) * plotWidth : left + (index + .5) / p.data.length * plotWidth;
    const positive = p.data.map(() => 0), negative = p.data.map(() => 0);
    graphic = <svg viewBox={`0 0 ${width} ${height}`} className="whale-chart-svg" role="img" aria-label={`${p.type} chart of ${series.join(", ")}`}><title>{`${p.type} chart with ${p.data.length} rows`}</title>{domain.ticks.map((value, index) => { const pos = y(value); return <g key={index}><line x1={left} y1={pos} x2={width - right} y2={pos} stroke="var(--whale-border)" strokeDasharray="3 4" /><text className="whale-chart-tick" x={left - 9} y={pos} dy=".35em" textAnchor="end" fill="var(--whale-fg-muted)" fontSize={12}>{tickFormat(value)}</text></g>; })}<line x1={left} y1={y(0)} x2={width - right} y2={y(0)} stroke="var(--whale-fg-muted)" opacity={.5} />{p.data.map((row: ChartRow, index: number) => index % Math.max(1, Math.ceil(p.data.length / Math.max(2, Math.floor(plotWidth / 72)))) === 0 ? <text key={index} x={x(index)} y={height - 12} textAnchor="middle" fill="var(--whale-fg-muted)" fontSize={12}>{category(row, index).length > 14 ? category(row, index).slice(0, 13) + "…" : category(row, index)}</text> : null)}{series.map((key, seriesIndex) => {
      const points: { x: number; y: number; base: number; value: number; index: number }[] = p.data.map((row: ChartRow, index: number) => { const value = Number(row[key]) || 0, totals = value >= 0 ? positive : negative, base = p.stacked ? totals[index] : 0; if (p.stacked) totals[index] += value; return { x: x(index), y: y(base + value), base: y(base), value, index }; });
      const shade = seriesColor(columns.series.indexOf(key));
      if (p.type === "bar") { const band = plotWidth / p.data.length * .78, barWidth = p.stacked ? band : band / Math.max(1, series.length); return <g key={key}>{points.map(point => <rect key={point.index} x={point.x - band / 2 + (p.stacked ? 0 : seriesIndex * barWidth)} y={Math.min(point.y, point.base)} width={Math.max(.5, barWidth - 1)} height={Math.max(.5, Math.abs(point.y - point.base))} fill={shade} rx={2} tabIndex={0} aria-label={`${category(p.data[point.index], point.index)}, ${key}: ${format(point.value)}`}><title>{`${category(p.data[point.index], point.index)} · ${key}: ${format(point.value)}`}</title></rect>)}</g>; }
      const path = points.map((point, index) => `${index ? "L" : "M"}${point.x},${point.y}`).join(" ");
      const area = `${path} ${[...points].reverse().map(point => `L${point.x},${point.base}`).join(" ")} Z`;
      return <g key={key}>{p.type === "area" && <path d={area} fill={shade} opacity={.2} />}{p.type !== "scatter" && <path d={path} stroke={shade} strokeWidth={2.5} strokeLinejoin="round" fill="none" />}{points.map(point => <circle key={point.index} cx={point.x} cy={point.y} r={p.type === "scatter" ? 4 : 3} fill={shade} stroke="var(--whale-bg)" strokeWidth={1} tabIndex={0} aria-label={`${category(p.data[point.index], point.index)}, ${key}: ${format(point.value)}`}><title>{`${category(p.data[point.index], point.index)} · ${key}: ${format(point.value)}`}</title></circle>)}</g>;
    })}</svg>;
  }
  return <figure className="whale-chart" ref={figure}>{graphic}<figcaption className="whale-chart-legend">{legend.map((item: any) => <button type="button" key={item.key} aria-pressed={!hidden.includes(item.key)} title={t("chartLegendScope")} aria-label={`${item.label}: ${t("chartLegendScope")}`} className="whale-chart-key" style={{ opacity: hidden.includes(item.key) ? .45 : 1 }} onClick={() => setHidden(prev => prev.includes(item.key) ? prev.filter(k => k !== item.key) : [...prev, item.key])}><span style={{ background: item.color }} />{item.label}{hidden.includes(item.key) && <Glyph name="eye-off" size={12} />}</button>)}</figcaption></figure>;
}
export const Chart = define("Chart", { type: z.enum(["bar", "line", "area", "pie", "donut", "scatter"]), data: z.array(z.record(z.string(), z.union([z.string(), z.number()]))), x: z.string().optional(), series: z.array(z.string()).optional(), format: z.enum(["number", "currency", "percent"]).optional(), currency: z.string().optional(), stacked: z.boolean().optional(), height: z.number().optional() }, "Accessible SVG chart with interactive series legend; legend buttons only show or hide this chart's series and do not change page filters or summaries. Supports bar, line, area, pie, donut and numeric scatter. Percent values use 45 for 45%.", p => <ChartView {...p} />);
