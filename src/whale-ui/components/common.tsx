import React, { type CSSProperties, type ReactNode } from "react";
import { z } from "zod";
import { defineComponent } from "@whale-ui/react";
import { icons, CircleHelp, CheckCircle, CheckCircle2, AlertCircle, HelpCircle, XCircle, PlusCircle, MinusCircle, Loader2, type LucideIcon } from "lucide-react";

const iconAliases: Record<string, LucideIcon> = { CheckCircle, CheckCircle2, AlertCircle, HelpCircle, XCircle, PlusCircle, MinusCircle, Loader2 };

export type Render = (value: unknown) => ReactNode;
export const nodes = z.array(z.any());
export const content = z.union([z.string(), nodes]);
export const colorSchema = z.string();
export const length = z.union([z.number(), z.string()]);
export const radiusSchema = z.union([z.enum(["sm", "md", "lg", "xl", "full"]), z.number()]);
export const alignSchema = z.enum(["start", "center", "end", "stretch"]);
export const justifySchema = z.enum(["start", "center", "end", "between"]);
export const weights = z.enum(["normal", "medium", "semibold"]);
export const units = (value: number | undefined, fallback: number) => `${Math.max(0, value ?? fallback) * 4}px`;
export const radius = (value: string | number | undefined): string | number => typeof value === "number" ? value : ({ sm: "calc(var(--whale-radius) * .5)", md: "var(--whale-radius)", lg: "calc(var(--whale-radius) * 1.5)", xl: "calc(var(--whale-radius) * 2)", full: "9999px" }[value ?? "md"] ?? "var(--whale-radius)");
const palette: Record<string, string> = { ink: "var(--whale-fg)", muted: "var(--whale-fg-muted)", faint: "color-mix(in srgb, var(--whale-fg-muted) 55%, transparent)", surface: "var(--whale-surface)", info: "var(--whale-accent)", success: "var(--whale-ok)", warning: "var(--whale-warn)", danger: "var(--whale-danger)", purple: "var(--whale-purple, var(--whale-accent))", pink: "var(--whale-pink, var(--whale-danger))", neutral: "var(--whale-fg-muted)", primary: "var(--whale-accent)" };
export function color(value?: string, background = false): string | undefined {
  if (!value) return undefined;
  const chart = /^chart([1-6])$/.exec(value);
  const c = chart ? `var(--whale-chart-${chart[1]}, ${["var(--whale-accent)", "var(--whale-ok)", "var(--whale-warn)", "var(--whale-danger)", "var(--whale-purple, var(--whale-accent))", "var(--whale-pink, var(--whale-danger))"][Number(chart[1]) - 1]})` : palette[value] ?? value;
  return background && value in palette && value !== "surface" ? `color-mix(in srgb, ${c} 12%, var(--whale-bg))` : c;
}
export const fontWeight = (value?: string) => value === "semibold" ? 600 : value === "medium" ? 500 : 400;
export const alignment = (value?: string) => value === "start" ? "flex-start" : value === "end" ? "flex-end" : value;
export const justification = (value?: string) => value === "between" ? "space-between" : alignment(value);
export function define(name: string, shape: Record<string, z.ZodType>, description: string, view: (props: any, renderNode: Render, statementId?: string) => ReactNode) {
  return defineComponent({ name, description, props: z.object(shape), component: ({ props, renderNode, statementId }) => <>{view(props, renderNode, statementId)}</> });
}
export function Glyph({ name, size = 16, style }: { name: string; size?: number; style?: CSSProperties }) {
  const key = String(name).replace(/(^|-)([a-z0-9])/g, (_, _gap, c) => c.toUpperCase());
  const Component = icons[key as keyof typeof icons] ?? iconAliases[key] ?? CircleHelp;
  return <Component size={size} strokeWidth={1.7} aria-hidden="true" style={{ display: "inline-block", verticalAlign: "middle", flexShrink: 0, ...style }} />;
}
export function webUrl(value: string): string | undefined {
  try { const url = new URL(value); return url.protocol === "https:" || url.protocol === "http:" ? url.href : undefined; } catch { return undefined; }
}
export function imageUrl(value: string): string | undefined { return webUrl(value) ?? (/^data:image\/(png|jpeg|webp|gif|avif);base64,/i.test(value) ? value : undefined); }
export const textValue = (value: unknown): string => typeof value === "string" ? value : value == null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
export function Feedback({ children, error = false }: { children: ReactNode; error?: boolean }) { return <p className="whale-feedback" role={error ? "alert" : "status"} data-error={error || undefined}>{children}</p>; }
