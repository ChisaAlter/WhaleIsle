import { z } from "zod";
import { defineFunction } from "@whale-ui/react";
import { dataFunctions } from "./data";

const any = z.any(), list = z.array(any), number = z.number(), text = z.string();
const numbers = z.array(number), date = z.union([text, number]);
const aggregation = z.enum(["sum", "avg", "count", "min", "max"]).optional();
const optionalText = text.optional(), optionalNumber = number.optional();
const specs = {
  Append: { params: { list, item: any }, returns: list, description: "Copy the list with an item appended." },
  Prepend: { params: { list, item: any }, returns: list, description: "Copy the list with an item prepended." },
  Concat: { params: { list, more: list }, returns: list, description: "Combine two lists without changing either." },
  Remove: { params: { list, field: text, value: any }, returns: list, description: "Remove matching field values; an empty field compares the item itself." },
  RemoveAt: { params: { list, index: number }, returns: list, description: "Remove an item by index; negative indices start at the end." },
  Update: { params: { list, field: text, value: any, setField: text, setValue: any }, returns: list, description: "Copy matching records with setField replaced by setValue." },
  Toggle: { params: { list, item: any }, returns: list, description: "Add an absent item or remove its occurrences." },
  Includes: { params: { list: z.union([list, text]), item: any }, returns: z.boolean(), description: "Test membership in a list or substring membership in text." },
  Find: { params: { list, field: text, value: any }, returns: any, description: "First record matching a field, or null." },
  IndexOf: { params: { list, item: any }, returns: number, description: "Index of an item, or -1." },
  Take: { params: { list, n: number }, returns: list, description: "First n items, or last abs(n) items for a negative count." },
  Slice: { params: { list: z.union([list, text]), start: number, end: optionalNumber }, returns: z.union([list, text]), description: "Slice from start up to end; negative indices count from the end." },
  Unique: { params: { list }, returns: list, description: "Distinct items in first-seen order." },
  Reverse: { params: { list }, returns: list, description: "A reversed copy." },
  Range: { params: { start: number, end: number, step: optionalNumber }, returns: numbers, description: "Numbers starting at start and stopping before end, with nonzero step (default 1)." },
  Pick: { params: { list }, returns: any, description: "Random item, or null for an empty list. Use inside @Set to draw once." },
  Shuffle: { params: { list }, returns: list, description: "Randomly shuffled copy. Use inside @Set to shuffle once." },
  Flatten: { params: { list }, returns: list, description: "Flatten one level of nested lists." },
  Chunk: { params: { list, size: number }, returns: z.array(list), description: "Split into consecutive groups of positive size." },
  Pow: { params: { base: number, exponent: number }, returns: number, description: "Base raised to exponent." },
  Sqrt: { params: { number }, returns: number.nullable(), description: "Square root, or null for a negative input." },
  Random: { params: { min: number, max: number, integer: z.boolean().optional() }, returns: number, description: "Random value from min to max; integer mode includes both bounds. Use inside @Set." },
  Clamp: { params: { number, min: number, max: number }, returns: number, description: "Keep a number within the inclusive bounds." },
  Percent: { params: { part: number, total: number }, returns: number, description: "Part / total × 100; zero when total is zero." },
  Lerp: { params: { a: number, b: number, t: number }, returns: number, description: "Linear interpolation from a to b at fraction t." },
  Allocate: { params: { total: number, weights: numbers, decimals: optionalNumber }, returns: numbers, description: "Distribute total in proportion to nonnegative weights, rounding shares to sum exactly to the rounded total." },
  Payment: { params: { principal: number, rate: number, periods: number }, returns: number.nullable(), description: "Repayment per period using a rate in percent per period." },
  Convert: { params: { value: number, from: text, to: text }, returns: number.nullable(), description: "Convert mm cm m km in ft yd mi; mg g kg oz lb st; ml l tsp tbsp floz cup pt qt gal (US); m/s km/h mph kn; m2 km2 ft2 ha acre; c f k." },
  Format: { params: { value: number, kind: z.enum(["number", "currency", "percent", "compact"]).optional(), decimals: optionalNumber, currency: optionalText }, returns: text, description: "Locale-aware number, currency, percent (45 means 45%), or compact number formatting." },
  Join: { params: { list, sep: optionalText, field: optionalText }, returns: text, description: "Join items or a chosen field, skipping null values. Default separator is comma and space." },
  Plural: { params: { n: number, word: text, plural: optionalText }, returns: text, description: "Count and singular/plural word. Default plural appends s." },
  Pad: { params: { value: z.union([text, number]), length: number, char: optionalText }, returns: text, description: "Pad the beginning to length, using 0 by default." },
  Upper: { params: { text }, returns: text, description: "Uppercase text." },
  Lower: { params: { text }, returns: text, description: "Lowercase text." },
  Trim: { params: { text }, returns: text, description: "Trim surrounding whitespace." },
  Capitalize: { params: { text }, returns: text, description: "Uppercase the first letter of each whitespace-separated word." },
  Split: { params: { text, sep: optionalText }, returns: z.array(text), description: "Split, trim and discard empty strings. Default separator is comma." },
  Replace: { params: { text, find: text, replacement: text }, returns: text, description: "Replace every literal occurrence of find." },
  Duration: { params: { seconds: number, style: z.enum(["short", "clock"]).optional() }, returns: text, description: "Duration as 1h 20m, 4m 05s, 45s, or a clock such as 1:20:00." },
  Default: { params: { value: any.optional(), fallback: any }, returns: any, description: "Return fallback for null, empty string or nonfinite numbers; retain false and zero." },
  MixColor: { params: { from: text, to: text, t: number }, returns: text, description: "Interpolate two #rgb or #rrggbb colors at clamped fraction t." },
  Now: { params: {}, returns: text, description: "Current time as an ISO timestamp." },
  Today: { params: {}, returns: text, description: "Today's local calendar date as YYYY-MM-DD." },
  FormatDate: { params: { date, style: z.enum(["date", "short", "long", "weekday", "month", "time", "datetime", "iso"]).optional() }, returns: text, description: "Format a local date, timestamp or ISO date-time." },
  AddDays: { params: { date, days: number }, returns: text, description: "Calendar date a number of days later (negative for earlier)." },
  AddMonths: { params: { date, months: number }, returns: text, description: "Calendar date months later; constrain the day to the destination month's length." },
  DaysBetween: { params: { from: date, to: date }, returns: number, description: "Signed number of calendar days, independent of DST." },
  MonthsBetween: { params: { from: date, to: date }, returns: number, description: "Signed whole calendar months between dates." },
  StartOf: { params: { date, unit: z.enum(["week", "month", "year"]) }, returns: text, description: "First date of a Monday-based week, month or year." },
  GroupBy: { params: { rows: list, key: text, field: optionalText, agg: aggregation }, returns: list, description: "Aggregate per key in first-seen order; without field count records." },
  Pivot: { params: { rows: list, rowKey: text, colKey: text, field: optionalText, agg: aggregation }, returns: list, description: "One record per rowKey and one aggregate column per colKey." },
  Top: { params: { rows: list, field: text, n: number, direction: z.enum(["desc", "asc"]).optional() }, returns: list, description: "The n greatest field values, or smallest in asc order." },
  Between: { params: { rows: list, field: text, min: any.optional(), max: any.optional() }, returns: list, description: "Inclusive range of field values, with null for an open end; supports YYYY-MM-DD text." },
  Bucket: { params: { rows: list, dateField: text, unit: z.enum(["day", "week", "month"]), field: optionalText, agg: aggregation }, returns: list, description: "Chronological calendar buckets; fill missing periods with zero for sum/count." },
  Cumulative: { params: { rows: list, field: text }, returns: list, description: "Replace a field with its running sum; empty field processes numbers directly." },
  MovingAvg: { params: { rows: list, field: text, window: number }, returns: list, description: "Trailing moving average with a positive window; empty field processes numbers directly." },
  Change: { params: { current: number, previous: number }, returns: number.nullable(), description: "Percent change from previous to current; null when previous is zero." },
  Histogram: { params: { values: numbers, bins: number, min: optionalNumber, max: optionalNumber }, returns: list, description: "Counts in equal-width bins, including the maximum in the final bin." },
  Stats: { params: { values: numbers }, returns: z.object({ count: number, min: number, max: number, mean: number, median: number, stdev: number }), description: "Numeric summary with population standard deviation. All zeros for empty data." },
};

export const functionDefinitions = Object.entries(specs).map(([name, spec]) => defineFunction({
  name, description: spec.description, params: z.object(spec.params), returns: spec.returns,
  // These audited data functions copy their inputs; random/time reads retain per-call behavior.
  pure: !["Pick", "Shuffle", "Random", "Now", "Today"].includes(name),
  fn: dataFunctions[name as keyof typeof dataFunctions] as (args: any) => any,
}));
export { dataFunctions } from "./data";
