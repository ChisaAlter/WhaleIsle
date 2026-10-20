import React, { useEffect, useId, useRef, useState } from "react";
import { z } from "zod";
import { action, FormNameContext, reactive, useComponentState, useComponentIdentity, useFormName, useIsStreaming, useStateField, useTriggerAction } from "@whale-ui/react";
import { color, colorSchema, define, Feedback, Glyph, nodes, radius, radiusSchema, units } from "./common";
import { dataFunctions } from "../functions/data";
import { t } from "./locale";

const option = z.union([z.string(), z.object({ value: z.string(), label: z.string() })]);
const radioOption = z.union([z.string(), z.object({ value: z.string(), label: z.string(), description: z.string().optional() })]);
const options = (values: any[]) => values.map(item => typeof item === "string" ? { value: item, label: item } : item);
function useClickAction(label: string, plan: any, disabled?: boolean) {
  const trigger = useTriggerAction(), form = useFormName(), streaming = useIsStreaming();
  const [pending, setPending] = useState(false), [error, setError] = useState("");
  const mounted = useRef(true); useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  return { disabled: !!disabled || streaming || pending, error, click: async () => {
    if (disabled || streaming || pending) return;
    setPending(true); setError("");
    try { await trigger(label, form, plan); }
    catch (problem) { if (mounted.current) setError(problem instanceof Error ? problem.message : t("actionFailed")); }
    finally { if (mounted.current) setPending(false); }
  } };
}
function ButtonView(p: any) { const click = useClickAction(p.label, p.action, p.disabled); return <><button type="button" className="whale-button" data-variant={p.variant ?? "solid"} data-color={p.color ?? "primary"} data-size={p.size ?? "md"} data-block={p.block || undefined} disabled={click.disabled} onClick={click.click}>{p.icon && <Glyph name={p.icon} size={p.size === "lg" ? 20 : 16} />}{p.label}</button>{click.error && <Feedback error>{click.error}</Feedback>}</>; }
export const Button = define("Button", { label: z.string(), action: action().optional(), variant: z.enum(["solid", "outline", "soft", "ghost"]).optional(), color: z.enum(["primary", "danger", "success"]).optional(), size: z.enum(["sm", "md", "lg"]).optional(), icon: z.string().optional(), disabled: z.boolean().optional(), block: z.boolean().optional() }, "Run local or host action steps; without an action, send the button label to the assistant.", p => <ButtonView {...p} />);
function IconButtonView(p: any) { const click = useClickAction(p.label ?? p.icon, p.action); return <><button className="whale-button whale-icon-button" type="button" data-variant={p.variant ?? "outline"} aria-label={p.label ?? p.icon} title={p.label} onClick={click.click} disabled={click.disabled}><Glyph name={p.icon} /></button>{click.error && <Feedback error>{click.error}</Feedback>}</>; }
export const IconButton = define("IconButton", { icon: z.string(), action: action().optional(), label: z.string().optional(), variant: z.enum(["outline", "ghost", "solid"]).optional() }, "Accessible round icon action.", p => <IconButtonView {...p} />);
function PressableView(p: any) { const click = useClickAction(t("select"), p.action); return <><div role="button" tabIndex={click.disabled ? -1 : 0} className="whale-pressable" aria-pressed={!!p.selected} aria-disabled={click.disabled} data-selected={p.selected || undefined} onClick={click.click} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); void click.click(); } }} style={{ padding: units(p.padding, 3), background: color(p.background, true), borderRadius: radius(p.radius) }}>{p.render(p.children)}</div>{click.error && <Feedback error>{click.error}</Feedback>}</>; }
export const Pressable = define("Pressable", { children: nodes, action: action().optional(), selected: z.boolean().optional(), padding: z.number().optional(), background: colorSchema.optional(), radius: radiusSchema.optional() }, "Keyboard-accessible clickable content with optional selected state.", (p, render) => <PressableView {...p} render={render} />);
function Field({ label, id, children }: { label?: string; id: string; children: React.ReactNode }) { return <div className="whale-field">{label && <label className="whale-label" htmlFor={id}>{label}</label>}{children}</div>; }
function InputView(p: any) {
  const field = useStateField(p.label ?? "value", p.value), id = useId(), streaming = useIsStreaming();
  return <Field label={p.label} id={id}><input className="whale-input" id={id} aria-label={p.label ?? p.placeholder ?? t("input")} type={p.type ?? "text"} value={field.value == null ? "" : typeof field.value === "number" ? field.value : String(field.value)} placeholder={p.placeholder} disabled={streaming} onChange={event => field.setValue(p.type === "number" ? event.target.value === "" ? null : Number.isFinite(event.target.valueAsNumber) ? event.target.valueAsNumber : null : event.target.value)} /></Field>;
}
export const Input = define("Input", { value: reactive(z.union([z.string(), z.number()])), label: z.string().optional(), type: z.enum(["text", "number"]).optional(), placeholder: z.string().optional() }, "Bound text or numeric field; numeric edits store numbers, and an empty number stores null.", p => <InputView {...p} />);
function TextAreaView(p: any) { const field = useStateField(p.label ?? "value", p.value), id = useId(), streaming = useIsStreaming(); return <Field label={p.label} id={id}><textarea id={id} className="whale-input" aria-label={p.label ?? p.placeholder ?? t("text")} value={field.value == null ? "" : String(field.value)} rows={Math.max(1, p.rows ?? 3)} placeholder={p.placeholder} disabled={streaming} onChange={event => field.setValue(event.target.value)} /></Field>; }
export const TextArea = define("TextArea", { value: reactive(z.string()), label: z.string().optional(), placeholder: z.string().optional(), rows: z.number().optional() }, "Bound multiline text.", p => <TextAreaView {...p} />);
function SelectView(p: any) { const field = useStateField(p.label ?? "value", p.value), id = useId(), streaming = useIsStreaming(); return <Field label={p.label} id={id}><select className="whale-input" id={id} aria-label={p.label ?? t("select")} value={field.value == null ? "" : String(field.value)} disabled={streaming} onChange={event => field.setValue(event.target.value)}>{p.placeholder && <option value="" disabled>{p.placeholder}</option>}{options(p.options).map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></Field>; }
export const Select = define("Select", { value: reactive(z.string()), options: z.array(option), label: z.string().optional(), placeholder: z.string().optional() }, "Bound dropdown with text or value/label options.", p => <SelectView {...p} />);
function SegmentedView(p: any) {
  const field = useStateField(p.label ?? "value", p.value), streaming = useIsStreaming(), ref = useRef<HTMLDivElement>(null), items = options(p.options);
  return <div className="whale-segments" ref={ref} role="radiogroup" data-block={p.block || undefined} aria-label={t("choices")}>{items.map((item, index) => <button key={item.value} type="button" role="radio" aria-checked={field.value === item.value} disabled={streaming} className="whale-segment" data-selected={field.value === item.value || undefined} tabIndex={field.value === item.value || (!items.some(i => i.value === field.value) && index === 0) ? 0 : -1} onClick={() => field.setValue(item.value)} onKeyDown={event => { const direction = ["ArrowRight", "ArrowDown"].includes(event.key) ? 1 : ["ArrowLeft", "ArrowUp"].includes(event.key) ? -1 : 0; if (direction) { event.preventDefault(); const next = (index + direction + items.length) % items.length; field.setValue(items[next].value); ref.current?.querySelectorAll("button")[next]?.focus(); } }}>{item.label}</button>)}</div>;
}
export const SegmentedControl = define("SegmentedControl", { value: reactive(z.string()), options: z.array(option), block: z.boolean().optional() }, "A bound single selection shown as adjacent buttons with arrow-key navigation.", p => <SegmentedView {...p} />);
function SliderView(p: any) {
  const field = useStateField(p.label ?? "value", p.value), id = useId(), streaming = useIsStreaming(), value = Number.isFinite(field.value) ? Number(field.value) : p.min;
  const formatted = p.unit === "$" ? dataFunctions.Format({ value, kind: "currency", currency: "USD" }) : p.unit === "%" ? dataFunctions.Format({ value, kind: "percent" }) : `${dataFunctions.Format({ value })}${p.unit ?? ""}`;
  return <div className="whale-field"><div className="whale-row whale-field-heading"><label htmlFor={id}>{p.label ?? t("value")}</label><output htmlFor={id}>{formatted}</output></div><input className="whale-range" id={id} type="range" min={p.min} max={p.max} step={p.step ?? 1} value={value} disabled={streaming} list={p.marks?.length ? id + "-marks" : undefined} onChange={event => field.setValue(event.target.valueAsNumber)} />{p.marks?.length > 0 && <><datalist id={id + "-marks"}>{p.marks.map((mark: any) => <option key={mark.value} value={mark.value} label={mark.label} />)}</datalist><div className="whale-slider-marks">{p.marks.map((mark: any) => <span key={mark.value} style={{ left: `${(mark.value - p.min) / Math.max(1, p.max - p.min) * 100}%` }}>{mark.label}</span>)}</div></>}</div>;
}
export const Slider = define("Slider", { value: reactive(z.number()), min: z.number(), max: z.number(), step: z.number().optional(), label: z.string().optional(), unit: z.string().optional(), marks: z.array(z.object({ value: z.number(), label: z.string() })).optional() }, "Bound numeric slider with label, unit and optional tick marks.", p => <SliderView {...p} />);
function CheckboxView(p: any) { const field = useStateField(p.label ?? "checked", p.checked), streaming = useIsStreaming(); return <label className="whale-check"><input type="checkbox" checked={!!field.value} disabled={streaming} onChange={event => field.setValue(event.target.checked)} /><span style={{ textDecoration: p.lineThrough && field.value ? "line-through" : undefined }}>{p.label}</span></label>; }
export const Checkbox = define("Checkbox", { checked: reactive(z.boolean()), label: z.string(), lineThrough: z.boolean().optional() }, "Bound checkbox; optionally strike completed text.", p => <CheckboxView {...p} />);
function RadioView(p: any) { const field = useStateField(p.label ?? "value", p.value), id = useId(), streaming = useIsStreaming(); return <fieldset className="whale-radio-group" data-variant={p.variant ?? "list"}>{p.label && <legend className="whale-label">{p.label}</legend>}{options(p.options).map(item => <label key={item.value} className="whale-radio-option" data-selected={field.value === item.value || undefined}><input type="radio" name={id} value={item.value} checked={field.value === item.value} disabled={streaming} onChange={() => field.setValue(item.value)} /><span><span>{item.label}</span>{item.description && <span className="whale-caption">{item.description}</span>}</span></label>)}</fieldset>; }
export const RadioGroup = define("RadioGroup", { value: reactive(z.string()), options: z.array(radioOption), label: z.string().optional(), variant: z.enum(["list", "pills", "cards"]).optional() }, "Bound radio choices as a list, pills or descriptive cards.", p => <RadioView {...p} />);
function DatePickerView(p: any) { const field = useStateField(p.label ?? "value", p.value), id = useId(), streaming = useIsStreaming(); return <Field label={p.label} id={id}><input type="date" className="whale-input" id={id} aria-label={p.label ?? t("date")} value={field.value == null ? "" : String(field.value)} min={p.min} max={p.max} disabled={streaming} onChange={event => field.setValue(event.target.value)} /></Field>; }
export const DatePicker = define("DatePicker", { value: reactive(z.string()), label: z.string().optional(), min: z.string().optional(), max: z.string().optional() }, "Bound local calendar date in YYYY-MM-DD format.", p => <DatePickerView {...p} />);
export type TimerState = { baseline: number; deadline: number | null; last: number };
export const timerRemaining = (state: TimerState, now: number) => state.deadline == null ? state.last : Math.max(0, Math.ceil((state.deadline - now) / 1000));
function TimerView(p: any) {
  const field = useStateField(p.label ?? "seconds", p.seconds), streaming = useIsStreaming();
  const seconds = Math.max(0, Math.ceil(Number(field.value) || 0));
  const [clock, setClock] = useComponentState<TimerState>("clock", { baseline: seconds, deadline: null, last: seconds });
  const latestField = useRef(field); latestField.current = field;
  const latestClock = useRef(clock); latestClock.current = clock;
  // A change from @Set/@Reset establishes a fresh baseline, including numeric zero.
  useEffect(() => { if (seconds !== clock.last) setClock({ baseline: seconds, deadline: null, last: seconds }); }, [seconds, clock.last, setClock]);
  useEffect(() => {
    if (clock.deadline == null || streaming) return;
    const tick = () => {
      const current = latestClock.current, remaining = timerRemaining(current, Date.now());
      if (remaining !== current.last || remaining === 0) {
        const next = { ...current, last: remaining, deadline: remaining === 0 ? null : current.deadline };
        latestClock.current = next; setClock(next); latestField.current.setValue(remaining);
      }
    };
    tick(); const interval = window.setInterval(tick, 200); return () => window.clearInterval(interval);
  }, [clock.deadline, streaming, setClock]);
  const running = clock.deadline != null;
  return <div className="whale-timer"><span className="whale-label">{p.label ?? t("timer")}</span><output role="timer" aria-label={p.label ?? t("timer")}>{dataFunctions.Duration({ seconds, style: "clock" })}</output><div className="whale-row"><button type="button" className="whale-button" data-variant="solid" disabled={streaming || seconds === 0} onClick={() => { if (running) { const remaining = timerRemaining(clock, Date.now()); setClock({ ...clock, deadline: null, last: remaining }); field.setValue(remaining); } else setClock({ ...clock, last: seconds, deadline: Date.now() + seconds * 1000 }); }}><Glyph name={running ? "pause" : "play"} size={16} />{running ? t("pause") : t("start")}</button><button type="button" className="whale-button" data-variant="outline" disabled={streaming} onClick={() => { setClock({ baseline: clock.baseline, deadline: null, last: clock.baseline }); field.setValue(clock.baseline); }}><Glyph name="rotate-ccw" size={16} />{t("reset")}</button></div></div>;
}
export const Timer = define("Timer", { seconds: reactive(z.number()), label: z.string().optional() }, "Durable countdown with start, pause and reset; updates bound seconds down to zero.", p => <TimerView {...p} />);
function FormView({ children, render, statementId }: any) { const id = useComponentIdentity(); return <FormNameContext.Provider value={statementId ?? id}><form className="whale-form" onSubmit={event => event.preventDefault()}>{render(children)}</form></FormNameContext.Provider>; }
export const Form = define("Form", { children: nodes }, "Group all bound and plain member fields for assistant submission.", (p, render, statementId) => <FormView {...p} render={render} statementId={statementId} />);
export const controlDefinitions = [Button, IconButton, Pressable, Input, TextArea, Select, SegmentedControl, Slider, Checkbox, RadioGroup, DatePicker, Timer, Form];
