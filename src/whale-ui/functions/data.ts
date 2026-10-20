/** First-party implementations of the published Whale UI data-function contract. */
import { DEFAULT_LIMITS } from "../language/runtime/budget.ts";
type Aggregate = "sum" | "avg" | "count" | "min" | "max";
const LIMIT = DEFAULT_LIMITS.collectionItems;
const at = (value: any, field: string) => field === "" ? value : value?.[field];
const numeric = (values: any[]): number[] => values.filter((n): n is number => typeof n === "number" && Number.isFinite(n));
const clamp = (n: number, low: number, high: number) => Math.min(Math.max(n, low), high);
const bounded = (n: number) => { if (!Number.isFinite(n) || n > LIMIT) throw new RangeError(`Result exceeds ${LIMIT} items`); return Math.max(0, Math.trunc(n)); };
const aggregate = (rows: any[], field: string | undefined, agg: Aggregate = "sum") => {
  if (agg === "count" || !field) return rows.length;
  const values = numeric(rows.map(row => at(row, field)));
  if (!values.length) return 0;
  const sum = values.reduce((a, b) => a + b, 0);
  return agg === "avg" ? sum / values.length : agg === "min" ? Math.min(...values) : agg === "max" ? Math.max(...values) : sum;
};
function date(value: string | number): Date {
  const match = typeof value === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null;
  const result = match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : new Date(value);
  if (!Number.isFinite(result.getTime())) throw new RangeError("Invalid date");
  return result;
}
const isoDay = (d: Date) => `${String(d.getFullYear()).padStart(4, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const dayNumber = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000;
function monthShift(value: string | number, months: number): Date {
  const d = date(value), original = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + Math.trunc(months));
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(original, end));
  return d;
}
function start(value: string | number, unit: "day" | "week" | "month" | "year"): Date {
  const d = date(value);
  d.setHours(0, 0, 0, 0);
  if (unit === "week") d.setDate(d.getDate() - (d.getDay() + 6) % 7);
  if (unit === "month" || unit === "year") d.setDate(1);
  if (unit === "year") d.setMonth(0);
  return d;
}
function group(rows: any[], key: string): Map<any, any[]> {
  const groups = new Map<any, any[]>();
  for (const row of rows) { const k = at(row, key); const bucket = groups.get(k) ?? []; bucket.push(row); groups.set(k, bucket); }
  return groups;
}
const units: Record<string, [string, number, number?]> = {
  mm: ["length", .001], cm: ["length", .01], m: ["length", 1], km: ["length", 1000], in: ["length", .0254], ft: ["length", .3048], yd: ["length", .9144], mi: ["length", 1609.344],
  mg: ["mass", .000001], g: ["mass", .001], kg: ["mass", 1], oz: ["mass", .028349523125], lb: ["mass", .45359237], st: ["mass", 6.35029318],
  ml: ["volume", .001], l: ["volume", 1], tsp: ["volume", .00492892159375], tbsp: ["volume", .01478676478125], floz: ["volume", .0295735295625], cup: ["volume", .2365882365], pt: ["volume", .473176473], qt: ["volume", .946352946], gal: ["volume", 3.785411784],
  "m/s": ["speed", 1], "km/h": ["speed", 1 / 3.6], mph: ["speed", .44704], kn: ["speed", 1852 / 3600],
  m2: ["area", 1], km2: ["area", 1_000_000], ft2: ["area", .09290304], ha: ["area", 10_000], acre: ["area", 4046.8564224],
  c: ["temperature", 1, 273.15], f: ["temperature", 5 / 9, 255.3722222222222], k: ["temperature", 1, 0],
};

export const dataFunctions = {
  Append: ({ list, item }: { list: any[]; item: any }) => { bounded(list.length + 1); return [...list, item]; },
  Prepend: ({ list, item }: { list: any[]; item: any }) => { bounded(list.length + 1); return [item, ...list]; },
  Concat: ({ list, more }: { list: any[]; more: any[] }) => { bounded(list.length + more.length); return [...list, ...more]; },
  Remove: ({ list, field, value }: { list: any[]; field: string; value: any }) => list.filter(item => !Object.is(at(item, field), value)),
  RemoveAt: ({ list, index }: { list: any[]; index: number }) => { const i = index < 0 ? list.length + Math.trunc(index) : Math.trunc(index); return list.filter((_, n) => n !== i); },
  Update: ({ list, field, value, setField, setValue }: { list: any[]; field: string; value: any; setField: string; setValue: any }) => list.map(item => Object.is(at(item, field), value) ? { ...item, [setField]: setValue } : item),
  Toggle: ({ list, item }: { list: any[]; item: any }) => list.includes(item) ? list.filter(value => !Object.is(value, item)) : [...list, item],
  Includes: ({ list, item }: { list: any[] | string; item: any }) => typeof list === "string" ? list.includes(String(item)) : list.includes(item),
  Find: ({ list, field, value }: { list: any[]; field: string; value: any }) => list.find(item => Object.is(at(item, field), value)) ?? null,
  IndexOf: ({ list, item }: { list: any[]; item: any }) => list.indexOf(item),
  Take: ({ list, n }: { list: any[]; n: number }) => n < 0 ? list.slice(Math.trunc(n)) : list.slice(0, Math.trunc(n)),
  Slice: ({ list, start, end }: { list: any[] | string; start: number; end?: number }) => list.slice(start, end),
  Unique: ({ list }: { list: any[] }) => [...new Set(list)],
  Reverse: ({ list }: { list: any[] }) => [...list].reverse(),
  Range: ({ start, end, step = 1 }: { start: number; end: number; step?: number }) => {
    if (step === 0 || !Number.isFinite(step)) throw new RangeError("Range step must be finite and nonzero");
    if (![start, end].every(Number.isFinite)) throw new RangeError("Range bounds must be finite");
    const count = bounded(Math.ceil((end - start) / step));
    return Array.from({ length: count }, (_, i) => start + i * step);
  },
  Pick: ({ list }: { list: any[] }) => list.length ? list[Math.floor(Math.random() * list.length)] : null,
  Shuffle: ({ list }: { list: any[] }) => { const copy = [...list]; for (let i = copy.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [copy[i], copy[j]] = [copy[j], copy[i]]; } return copy; },
  Flatten: ({ list }: { list: any[] }) => { bounded(list.reduce((count, value) => count + (Array.isArray(value) ? value.length : 1), 0)); return list.flat(); },
  Chunk: ({ list, size }: { list: any[]; size: number }) => {
    const length = Math.trunc(size); if (!Number.isFinite(length) || length < 1) throw new RangeError("Chunk size must be positive and finite");
    return Array.from({ length: bounded(Math.ceil(list.length / length)) }, (_, i) => list.slice(i * length, (i + 1) * length));
  },
  Pow: ({ base, exponent }: { base: number; exponent: number }) => Math.pow(base, exponent),
  Sqrt: ({ number }: { number: number }) => number < 0 ? null : Math.sqrt(number),
  Random: ({ min, max, integer = false }: { min: number; max: number; integer?: boolean }) => integer ? Math.floor(Math.random() * (Math.floor(max) - Math.ceil(min) + 1)) + Math.ceil(min) : min + Math.random() * (max - min),
  Clamp: ({ number, min, max }: { number: number; min: number; max: number }) => clamp(number, min, max),
  Percent: ({ part, total }: { part: number; total: number }) => total === 0 ? 0 : part / total * 100,
  Lerp: ({ a, b, t }: { a: number; b: number; t: number }) => a + (b - a) * t,
  Allocate: ({ total, weights, decimals = 2 }: { total: number; weights: number[]; decimals?: number }) => {
    bounded(weights.length);
    const scale = 10 ** clamp(Math.trunc(decimals), 0, 10), sign = total < 0 ? -1 : 1;
    const positive = weights.map(n => Math.max(0, n)), sum = positive.reduce((a, b) => a + b, 0);
    if (!positive.length) return [];
    if (!sum) return positive.map(() => 0);
    const target = Math.round(Math.abs(total) * scale), raw = positive.map(n => target * n / sum), shares = raw.map(Math.floor);
    let remaining = target - shares.reduce((a, b) => a + b, 0);
    const order = raw.map((n, i) => ({ i, remainder: n - shares[i] })).sort((a, b) => b.remainder - a.remainder || a.i - b.i);
    for (let i = 0; remaining > 0; i++, remaining--) shares[order[i % order.length].i]++;
    return shares.map(n => sign * n / scale);
  },
  Payment: ({ principal, rate, periods }: { principal: number; rate: number; periods: number }) => {
    if (periods <= 0) return null; const r = rate / 100; if (r === 0) return principal / periods;
    return principal * r / (1 - Math.pow(1 + r, -periods));
  },
  Convert: ({ value, from, to }: { value: number; from: string; to: string }) => {
    const a = units[from.toLowerCase()], b = units[to.toLowerCase()];
    if (!a || !b || a[0] !== b[0]) return null;
    return (value * a[1] + (a[2] ?? 0) - (b[2] ?? 0)) / b[1];
  },
  Format: ({ value, kind = "number", decimals, currency }: { value: number; kind?: "number" | "currency" | "percent" | "compact"; decimals?: number; currency?: string }) => {
    const opts: Intl.NumberFormatOptions = {};
    if (kind === "currency" || (kind === "compact" && currency)) { opts.style = "currency"; opts.currency = currency || "USD"; }
    if (kind === "percent") { opts.style = "percent"; value /= 100; }
    if (kind === "compact") opts.notation = "compact";
    if (decimals != null) opts.minimumFractionDigits = opts.maximumFractionDigits = clamp(Math.trunc(decimals), 0, 20);
    return new Intl.NumberFormat(undefined, opts).format(value);
  },
  Join: ({ list, sep = ", ", field }: { list: any[]; sep?: string; field?: string }) => list.map(item => field ? at(item, field) : item).filter(value => value != null).join(sep),
  Plural: ({ n, word, plural }: { n: number; word: string; plural?: string }) => `${n} ${n === 1 ? word : plural ?? word + "s"}`,
  Pad: ({ value, length, char = "0" }: { value: string | number; length: number; char?: string }) => String(value).padStart(bounded(length), char),
  Upper: ({ text }: { text: string }) => text.toUpperCase(),
  Lower: ({ text }: { text: string }) => text.toLowerCase(),
  Trim: ({ text }: { text: string }) => text.trim(),
  Capitalize: ({ text }: { text: string }) => text.replace(/(^|\s)(\S)/gu, (_, gap, letter) => gap + letter.toLocaleUpperCase()),
  Split: ({ text, sep = "," }: { text: string; sep?: string }) => text.split(sep).map(s => s.trim()).filter(Boolean),
  Replace: ({ text, find, replacement }: { text: string; find: string; replacement: string }) => text.split(find).join(replacement),
  Duration: ({ seconds, style = "short" }: { seconds: number; style?: "short" | "clock" }) => {
    const value = Math.max(0, Math.floor(seconds)), h = Math.floor(value / 3600), m = Math.floor(value / 60) % 60, s = value % 60;
    if (style === "clock") return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
    return h ? `${h}h ${m}m` : m ? `${m}m ${String(s).padStart(2, "0")}s` : `${s}s`;
  },
  Default: ({ value, fallback }: { value?: any; fallback: any }) => value == null || value === "" || (typeof value === "number" && !Number.isFinite(value)) ? fallback : value,
  MixColor: ({ from, to, t }: { from: string; to: string; t: number }) => {
    const channels = (s: string) => { let hex = s.replace(/^#/, ""); if (hex.length === 3) hex = [...hex].map(c => c + c).join(""); if (!/^[\da-f]{6}$/i.test(hex)) throw new Error("Expected a hex color"); return [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16)); };
    const a = channels(from), b = channels(to), amount = clamp(t, 0, 1);
    return "#" + a.map((n, i) => Math.round(n + (b[i] - n) * amount).toString(16).padStart(2, "0")).join("");
  },
  Now: () => new Date().toISOString(),
  Today: () => isoDay(new Date()),
  FormatDate: ({ date: value, style = "date" }: { date: string | number; style?: "date" | "short" | "long" | "weekday" | "month" | "time" | "datetime" | "iso" }) => {
    const d = date(value); if (style === "iso") return isoDay(d);
    const opts: Record<string, Intl.DateTimeFormatOptions> = { date: { month: "short", day: "numeric", year: "numeric" }, short: { month: "short", day: "numeric" }, long: { weekday: "long", month: "long", day: "numeric", year: "numeric" }, weekday: { weekday: "short" }, month: { month: "short", year: "numeric" }, time: { hour: "numeric", minute: "2-digit" }, datetime: { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" } };
    return new Intl.DateTimeFormat(undefined, opts[style]).format(d);
  },
  AddDays: ({ date: value, days }: { date: string | number; days: number }) => { const d = date(value); d.setDate(d.getDate() + Math.trunc(days)); return isoDay(d); },
  AddMonths: ({ date: value, months }: { date: string | number; months: number }) => isoDay(monthShift(value, months)),
  DaysBetween: ({ from, to }: { from: string | number; to: string | number }) => dayNumber(date(to)) - dayNumber(date(from)),
  MonthsBetween: ({ from, to }: { from: string | number; to: string | number }) => {
    const a = date(from), b = date(to), direction = b.getTime() >= a.getTime() ? 1 : -1;
    const early = direction > 0 ? a : b, late = direction > 0 ? b : a;
    let months = (late.getFullYear() - early.getFullYear()) * 12 + late.getMonth() - early.getMonth();
    if (monthShift(early.getTime(), months).getTime() > late.getTime()) months--;
    return direction * months;
  },
  StartOf: ({ date: value, unit }: { date: string | number; unit: "week" | "month" | "year" }) => isoDay(start(value, unit)),
  GroupBy: ({ rows, key, field, agg = "sum" }: { rows: any[]; key: string; field?: string; agg?: Aggregate }) => [...group(rows, key)].map(([key, values]) => ({ key, value: aggregate(values, field, agg) })),
  Pivot: ({ rows, rowKey, colKey, field, agg = "sum" }: { rows: any[]; rowKey: string; colKey: string; field?: string; agg?: Aggregate }) => {
    const columns = [...new Set(rows.map(row => at(row, colKey)))];
    return [...group(rows, rowKey)].map(([key, values]) => Object.fromEntries([[rowKey, key], ...columns.map(col => [String(col), aggregate(values.filter(row => Object.is(at(row, colKey), col)), field, agg)])]));
  },
  Top: ({ rows, field, n, direction = "desc" }: { rows: any[]; field: string; n: number; direction?: "desc" | "asc" }) => [...rows].sort((a, b) => (at(a, field) < at(b, field) ? -1 : at(a, field) > at(b, field) ? 1 : 0) * (direction === "asc" ? 1 : -1)).slice(0, Math.max(0, n)),
  Between: ({ rows, field, min, max }: { rows: any[]; field: string; min?: any; max?: any }) => rows.filter(row => { const n = at(row, field); return n != null && (min == null || n >= min) && (max == null || n <= max); }),
  Bucket: ({ rows, dateField, unit, field, agg = "sum" }: { rows: any[]; dateField: string; unit: "day" | "week" | "month"; field?: string; agg?: Aggregate }) => {
    const groups = new Map<string, any[]>();
    for (const row of rows) { const k = isoDay(start(at(row, dateField), unit)); const values = groups.get(k) ?? []; values.push(row); groups.set(k, values); }
    const keys = [...groups.keys()].sort(); if (!keys.length) return [];
    const result: { key: string; value: number }[] = [], end = keys[keys.length - 1];
    for (let cursor = date(keys[0]); isoDay(cursor) <= end;) {
      if (result.length >= LIMIT) throw new RangeError("Date buckets exceed result budget");
      const k = isoDay(cursor), values = groups.get(k);
      if (values || agg === "sum" || agg === "count") result.push({ key: unit === "month" ? k.slice(0, 7) : k, value: aggregate(values ?? [], field, agg) });
      if (unit === "month") cursor.setMonth(cursor.getMonth() + 1); else cursor.setDate(cursor.getDate() + (unit === "week" ? 7 : 1));
    }
    return result;
  },
  Cumulative: ({ rows, field }: { rows: any[]; field: string }) => { let total = 0; return rows.map(row => { total += Number(at(row, field)) || 0; return field === "" ? total : { ...row, [field]: total }; }); },
  MovingAvg: ({ rows, field, window }: { rows: any[]; field: string; window: number }) => {
    const size = Math.max(1, Math.trunc(window)); let total = 0;
    return rows.map((row, i) => { total += Number(at(row, field)) || 0; if (i >= size) total -= Number(at(rows[i - size], field)) || 0; const value = total / Math.min(i + 1, size); return field === "" ? value : { ...row, [field]: value }; });
  },
  Change: ({ current, previous }: { current: number; previous: number }) => previous === 0 ? null : (current - previous) / previous * 100,
  Histogram: ({ values, bins, min, max }: { values: number[]; bins: number; min?: number; max?: number }) => {
    const nums = numeric(values), count = bounded(Math.max(1, bins));
    const low = min ?? (nums.length ? Math.min(...nums) : 0), high = max ?? (nums.length ? Math.max(...nums) : 1);
    const width = high > low ? (high - low) / count : 1;
    const result = Array.from({ length: count }, (_, i) => ({ key: `${low + i * width}–${low + (i + 1) * width}`, value: 0, start: low + i * width, end: low + (i + 1) * width }));
    for (const n of nums) if (n >= low && n <= high) result[Math.min(count - 1, Math.floor((n - low) / width))].value++;
    return result;
  },
  Stats: ({ values }: { values: number[] }) => {
    const nums = numeric(values).sort((a, b) => a - b), count = nums.length;
    if (!count) return { count: 0, min: 0, max: 0, mean: 0, median: 0, stdev: 0 };
    const mean = nums.reduce((a, b) => a + b, 0) / count, mid = Math.floor(count / 2);
    return { count, min: nums[0], max: nums[count - 1], mean, median: count % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2, stdev: Math.sqrt(nums.reduce((sum, n) => sum + (n - mean) ** 2, 0) / count) };
  },
};
