import { t } from "./locale";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { useComponentState, useIsStreaming } from "@whale-ui/react";
import { isElementNode } from "../language/parser/types";
import { color, colorSchema, content, define, Feedback, Glyph, imageUrl, radius, radiusSchema, textValue, webUrl } from "./common";
export { Chart } from "./chart";

const fit = z.enum(["cover", "contain"]);
function ImageSearch({ query, aspectRatio = 1.5, radius: rounding, fit: fitMode = "cover" }: any) {
  const [result, setResult] = useState<{ query: string; images: string[]; error?: string }>({ query, images: [] });
  const [index, setIndex] = useState(0), [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setIndex(0); setResult({ query, images: [] });
    const load = async () => {
      try {
        const response = await fetch(`/api/image-search?q=${encodeURIComponent(query)}`, { signal: controller.signal });
        const json = await response.json(); if (!response.ok) throw new Error(json.error?.message ?? t("imageSearchFailed"));
        const images = (Array.isArray(json.images) ? json.images : []).filter((src: unknown): src is string => typeof src === "string" && !!imageUrl(src));
        if (!controller.signal.aborted) setResult({ query, images, error: images.length ? undefined : t("noImages") });
      } catch (error) { if (!controller.signal.aborted) setResult({ query, images: [], error: error instanceof Error ? error.message : t("imageSearchFailed") }); }
    };
    void load(); return () => controller.abort();
  }, [query, retry]);
  const current: { query: string; images: string[]; error?: string } = result.query === query ? result : { query, images: [] };
  const src = current.images[index];
  return <div className="whale-image" style={{ aspectRatio: Math.max(.1, aspectRatio), borderRadius: radius(rounding) }}>{src ? <img src={src} alt={query} loading="lazy" style={{ objectFit: fitMode }} onError={() => { if (index + 1 < current.images.length) setIndex(index + 1); else setResult({ query, images: [], error: t("imagesFailed") }); }} /> : <div className="whale-image-status"><Glyph name="image" size={24} /><Feedback error={!!current.error}>{current.error ?? t("loadingImage")}</Feedback>{current.error && <button type="button" className="whale-button" data-variant="ghost" data-size="sm" onClick={() => setRetry(retry + 1)}>{t("retry")}</button>}</div>}</div>;
}
export const SearchImage = define("SearchImage", { query: z.string(), aspectRatio: z.number().optional(), radius: radiusSchema.optional(), fit: fit.optional() }, "Find a real image through the host image-search resource. Failed requests can be retried.", p => <ImageSearch {...p} />);
function ImageView(p: any) {
  const [failed, setFailed] = useState<string | null>(null), src = imageUrl(p.src);
  return !src || failed === p.src ? <ImageSearch query={p.alt} aspectRatio={p.aspectRatio} radius={p.radius} fit={p.fit} /> : <div className="whale-image" style={{ aspectRatio: p.aspectRatio ?? 1.5, borderRadius: radius(p.radius) }}><img src={src} alt={p.alt} loading="lazy" style={{ objectFit: p.fit ?? "cover" }} onError={() => setFailed(p.src)} /></div>;
}
export const ImageComponent = define("Image", { src: z.string(), alt: z.string(), aspectRatio: z.number().optional(), radius: radiusSchema.optional(), fit: fit.optional() }, "Image from a URL; find an image for alt text if loading fails.", p => <ImageView {...p} />);
export const Icon = define("Icon", { name: z.string(), size: z.enum(["sm", "md", "lg", "xl"]).optional(), color: colorSchema.optional() }, "Lucide icon by kebab-case name.", p => <Glyph name={p.name} size={({ sm: 16, md: 16, lg: 24, xl: 32 } as Record<string, number>)[p.size ?? "md"]} style={{ color: color(p.color) }} />);
export const Table = define("Table", { columns: z.array(z.string()), rows: z.array(z.array(z.any())) }, "Scrollable data table with numeric alignment and support for components in cells.", (p, render) => {
  const numeric = p.columns.map((_: string, i: number) => { const values = p.rows.map((row: unknown[]) => row[i]).filter((value: unknown) => value != null); return values.length > 0 && values.every((value: unknown) => typeof value === "number"); });
  return <div className="whale-table-scroll" tabIndex={0} role="region" aria-label={t("table")}><table className="whale-table"><thead><tr>{p.columns.map((heading: string, i: number) => <th key={i} scope="col" style={{ textAlign: numeric[i] ? "right" : undefined }}>{heading}</th>)}</tr></thead><tbody>{p.rows.map((row: unknown[], r: number) => <tr key={r}>{p.columns.map((_: string, i: number) => <td key={i} style={{ textAlign: numeric[i] ? "right" : undefined, fontVariantNumeric: numeric[i] ? "tabular-nums" : undefined }}>{typeof row[i] === "object" && row[i] != null && !Array.isArray(row[i]) && !isElementNode(row[i]) ? textValue(row[i]) : render(row[i])}</td>)}</tr>)}</tbody></table></div>;
});
export function youtubeId(value: string): string | undefined {
  if (/^[\w-]{11}$/.test(value)) return value;
  try { const url = new URL(value), host = url.hostname.replace(/^www\./, ""); if (host === "youtu.be") return /^[\w-]{11}$/.test(url.pathname.slice(1)) ? url.pathname.slice(1) : undefined; if (!["youtube.com", "m.youtube.com", "youtube-nocookie.com"].includes(host)) return; const id = url.searchParams.get("v") ?? /^\/(?:embed|shorts|live)\/([\w-]{11})/.exec(url.pathname)?.[1]; return id && /^[\w-]{11}$/.test(id) ? id : undefined; } catch { return undefined; }
}
export const YouTube = define("YouTube", { video: z.string(), title: z.string().optional() }, "YouTube video by known id or URL, embedded through privacy-enhanced mode.", p => {
  const id = youtubeId(p.video); return id ? <iframe className="whale-youtube" title={p.title ?? t("video")} src={`https://www.youtube-nocookie.com/embed/${id}`} loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerPolicy="strict-origin-when-cross-origin" allowFullScreen /> : <Feedback error>{t("invalidVideo")}</Feedback>;
});
function FlashcardView(p: any) {
  const [flipped, setFlipped] = useComponentState("flipped", false), streaming = useIsStreaming();
  return <button type="button" className="whale-flashcard" data-flipped={flipped || undefined} aria-pressed={flipped} aria-label={flipped ? t("back") : t("front")} disabled={streaming} onClick={() => setFlipped(!flipped)}><span className="whale-flashcard-face">{p.render(flipped ? p.back : p.front)}</span><span className="whale-caption">{flipped ? t("showFront") : p.hint ?? t("reveal")}</span></button>;
}
export const Flashcard = define("Flashcard", { front: content, back: content, hint: z.string().optional() }, "Tap to reveal a flashcard answer; flipped state persists across remounts.", (p, render) => <FlashcardView {...p} render={render} />);
function CelebrationView({ when }: { when: boolean }) {
  const [active, setActive] = useState(false), previous = useRef(false), timer = useRef<number | undefined>(undefined);
  useEffect(() => { if (when && !previous.current) { setActive(true); window.clearTimeout(timer.current); timer.current = window.setTimeout(() => setActive(false), 1800); } previous.current = when; return () => window.clearTimeout(timer.current); }, [when]);
  const particles = useMemo(() => Array.from({ length: 24 }, (_, i) => ({ x: i * 37 % 100, delay: (i % 6) * 45, rotate: (i * 73) % 360 })), []);
  return active ? <div className="whale-celebration" aria-label={t("celebration")} role="status"><span className="whale-sr-only">{t("congratulations")}</span>{particles.map((item, i) => <i key={i} style={{ left: `${item.x}%`, animationDelay: `${item.delay}ms`, background: color(`chart${i % 6 + 1}`), transform: `rotate(${item.rotate}deg)` }} />)}</div> : null;
}
export const Celebration = define("Celebration", { when: z.boolean() }, "Brief confetti when the condition becomes true; respects reduced motion.", p => <CelebrationView when={p.when} />);
export const mediaDefinitions = [SearchImage, ImageComponent, Icon, Table, YouTube, Flashcard, Celebration];
