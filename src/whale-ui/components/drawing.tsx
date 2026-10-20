import { t } from "./locale";
import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { color, colorSchema, define, fontWeight, length, nodes, weights } from "./common";

export const Svg = define("Svg", { children: nodes, viewBox: z.string(), width: length.optional(), height: length.optional() }, "Responsive SVG drawing; coordinates use the declared viewBox.", (p, render) => <svg className="whale-svg" xmlns="http://www.w3.org/2000/svg" viewBox={p.viewBox} width={p.width ?? "100%"} height={p.height} style={{ maxWidth: "100%", overflow: "visible" }} role="img" aria-label={t("drawing")}>{render(p.children)}</svg>);
export const G = define("G", { children: nodes, transform: z.string().optional(), opacity: z.number().optional() }, "SVG group with transform and opacity.", (p, render) => <g transform={p.transform} opacity={p.opacity}>{render(p.children)}</g>);
const paint = { fill: colorSchema.optional(), stroke: colorSchema.optional(), strokeWidth: z.number().optional(), opacity: z.number().optional() };
const attrs = (p: any) => ({ fill: color(p.fill ?? "none"), stroke: color(p.stroke), strokeWidth: p.strokeWidth, opacity: p.opacity });
export const Circle = define("Circle", { cx: z.number(), cy: z.number(), r: z.number(), ...paint }, "SVG circle.", p => <circle cx={p.cx} cy={p.cy} r={p.r} {...attrs(p)} />);
export const Ellipse = define("Ellipse", { cx: z.number(), cy: z.number(), rx: z.number(), ry: z.number(), ...paint }, "SVG ellipse.", p => <ellipse cx={p.cx} cy={p.cy} rx={p.rx} ry={p.ry} {...attrs(p)} />);
export const Rect = define("Rect", { x: z.number(), y: z.number(), width: z.number(), height: z.number(), ...paint, rx: z.number().optional() }, "SVG rectangle with optional corner rounding.", p => <rect x={p.x} y={p.y} width={p.width} height={p.height} rx={p.rx} {...attrs(p)} />);
export const Line = define("Line", { x1: z.number(), y1: z.number(), x2: z.number(), y2: z.number(), stroke: colorSchema.optional(), strokeWidth: z.number().optional(), opacity: z.number().optional() }, "SVG line.", p => <line x1={p.x1} y1={p.y1} x2={p.x2} y2={p.y2} stroke={color(p.stroke ?? "ink")} strokeWidth={p.strokeWidth ?? 1} opacity={p.opacity} />);
export const Path = define("Path", { d: z.string(), ...paint }, "SVG path using standard path commands.", p => <path d={p.d} {...attrs(p)} />);
export const Polyline = define("Polyline", { points: z.string(), stroke: colorSchema.optional(), strokeWidth: z.number().optional(), fill: colorSchema.optional(), opacity: z.number().optional() }, "SVG polyline using x,y coordinate pairs.", p => <polyline points={p.points} {...attrs({ ...p, stroke: p.stroke ?? "ink" })} />);
export const Polygon = define("Polygon", { points: z.string(), ...paint }, "Closed SVG polygon using x,y coordinate pairs.", p => <polygon points={p.points} {...attrs(p)} />);
export const SvgText = define("SvgText", { text: z.string(), x: z.number(), y: z.number(), size: z.number().optional(), fill: colorSchema.optional(), anchor: z.enum(["start", "middle", "end"]).optional(), weight: weights.optional() }, "SVG text anchored at coordinates.", p => <text x={p.x} y={p.y} fontSize={p.size ?? 14} fill={color(p.fill ?? "ink")} textAnchor={p.anchor ?? "start"} fontWeight={fontWeight(p.weight)} fontFamily="var(--whale-font)">{p.text}</text>);

const THEME_KEYS = ["--whale-fg", "--whale-fg-muted", "--whale-bg", "--whale-surface", "--whale-border", "--whale-accent", "--whale-ok", "--whale-warn", "--whale-danger", "--whale-font", "--whale-mono", "--whale-radius", "--whale-purple", "--whale-pink", ...Array.from({ length: 6 }, (_, i) => `--whale-chart-${i + 1}`)];
const CSP = "default-src 'none'; script-src 'unsafe-inline' https://cdn.jsdelivr.net https://unpkg.com https://esm.sh https://cdnjs.cloudflare.com; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; media-src data: blob:; object-src 'none'; base-uri 'none'; form-action 'none'";
export function htmlDocument(html: string, channel: string): string {
  const bridge = `<meta http-equiv="Content-Security-Policy" content="${CSP}"><style id="whale-base">:root{color-scheme:light dark}body{margin:0;color:var(--whale-fg);background:var(--whale-bg);font-family:var(--whale-font);line-height:1.5}*,*::before,*::after{box-sizing:border-box}button,input,select,textarea{font:inherit}button{cursor:pointer}</style><script>(function(){var channel=${JSON.stringify(channel)};function size(){parent.postMessage({channel:channel,type:'size',height:document.body?Math.max(document.body.scrollHeight,document.body.offsetHeight):0},'*')}addEventListener('message',function(event){if(event.source!==parent||event.data?.channel!==channel||event.data.type!=='theme')return;var data=event.data;Object.keys(data.tokens||{}).forEach(function(key){if(key.startsWith('--whale-'))document.documentElement.style.setProperty(key,data.tokens[key])});document.documentElement.dataset.theme=data.dark?'dark':'light';document.documentElement.style.colorScheme=data.dark?'dark':'light';document.documentElement.classList.toggle('dark',!!data.dark);size()});addEventListener('DOMContentLoaded',function(){if(typeof ResizeObserver!=='undefined'){new ResizeObserver(size).observe(document.documentElement)}size();parent.postMessage({channel:channel,type:'ready'},'*')});addEventListener('load',size)})()<\/script>`;
  if (/<head(?:\s[^>]*)?>/i.test(html)) return html.replace(/<head(?:\s[^>]*)?>/i, match => match + bridge);
  if (/<html(?:\s[^>]*)?>/i.test(html)) return html.replace(/<html(?:\s[^>]*)?>/i, match => match + `<head>${bridge}</head>`);
  return `<!doctype html><html><head>${bridge}</head><body>${html}</body></html>`;
}
function HtmlViewComponent(p: any) {
  const frame = useRef<HTMLIFrameElement>(null), id = useId(), [height, setHeight] = useState(240);
  const channel = `whale-html-${id}`, srcDoc = useMemo(() => htmlDocument(p.html, channel), [p.html, channel]);
  useEffect(() => {
    const sendTheme = () => {
      const style = getComputedStyle(document.documentElement), tokens = Object.fromEntries(THEME_KEYS.map(key => [key, style.getPropertyValue(key).trim()]));
      const root = document.documentElement, dark = root.dataset.theme === "dark" || root.classList.contains("dark") || style.colorScheme === "dark";
      frame.current?.contentWindow?.postMessage({ channel, type: "theme", tokens, dark }, "*");
    };
    const message = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.data?.channel !== channel) return;
      if (event.data.type === "ready") sendTheme();
      if (event.data.type === "size" && typeof event.data.height === "number" && Number.isFinite(event.data.height)) setHeight(Math.max(40, Math.min(12_000, Math.ceil(event.data.height))));
    };
    window.addEventListener("message", message);
    const observer = new MutationObserver(sendTheme); observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style", "data-theme"] });
    const scheme = window.matchMedia?.("(prefers-color-scheme: dark)"); scheme?.addEventListener("change", sendTheme);
    sendTheme();
    return () => { observer.disconnect(); window.removeEventListener("message", message); scheme?.removeEventListener("change", sendTheme); };
  }, [channel]);
  return <iframe ref={frame} className="whale-html-view" sandbox="allow-scripts" title={p.title ?? t("html")} srcDoc={srcDoc} style={{ height: p.height ?? height }} />;
}
export const HtmlView = define("HtmlView", { html: z.string(), height: z.number().optional(), title: z.string().optional() }, "Sandboxed HTML with inline scripts and approved script CDNs. Theme updates preserve iframe state; content height adapts unless fixed.", p => <HtmlViewComponent {...p} />);
export const drawingDefinitions = [Svg, G, Circle, Ellipse, Rect, Line, Path, Polyline, Polygon, SvgText, HtmlView];
