/**
 * Lazily scanned view of one JSON object's top-level fields, built from text
 * that may still be streaming or from an already parsed object. Nothing is
 * scanned until a reader asks; the view remembers every question it answered
 * and reports changed answers when the owner refreshes for publication.
 * Used for model tool-call arguments: a row reads the fields it
 * cares about at whatever granularity it displays, at every stage of the call.
 * @module @deepseek-ai/dsh-util-values/src/partial-json
 */
import { type JsonValue } from './index.ts';
/** Granularity of a length read; a change is reported only when the rounded-up step moves. */
export interface LengthReadOptions {
    /** Characters per step; defaults to 1 (every character counts). */
    readonly step?: number;
    /** Completed characters included in the displayed total; affects change detection only. */
    readonly offset?: number;
}
/**
 * The view. A streaming instance grows through {@link PartialArguments.append};
 * {@link PartialArguments.fromText} and {@link PartialArguments.fromObject} build
 * sealed instances over a finished call. Every reader is total: an absent or
 * differently typed field answers `undefined` (or `false`), never throws.
 */
export declare class PartialArguments {
    #private;
    /** The view of a call with no arguments available. */
    static readonly EMPTY: PartialArguments;
    /**
     * View finished argument text without scanning it until a reader asks.
     * @param text - the complete argument JSON text.
     * @returns a sealed view.
     */
    static fromText(text: string): PartialArguments;
    /**
     * View an already parsed argument payload, such as a PTC dispatch object.
     * @param value - the parsed argument value.
     * @returns a sealed view; a non-object payload has no fields.
     */
    static fromObject(value: unknown): PartialArguments;
    /**
     * The source: text so far or a parsed object, plus whether it can still grow.
     * These are the only enumerable fields, so two views over the same source
     * compare equal structurally however far each has been read.
     */
    private chunks;
    private object;
    private sealed;
    /** Whether this view rejects further appends; does not scan text or register reads. */
    get isSealed(): boolean;
    /** Whether indexing or a content read found invalid JSON; unread value contents are not validated. */
    get invalid(): boolean;
    /**
     * Retain streamed argument text without scanning or comparing observed answers.
     * @param fragment - the text following every fragment appended before.
     */
    append(fragment: string): void;
    /**
     * Reconcile a streamed prefix with authoritative complete text without joining the fragments.
     * @param text - the final argument text, which replaces missing or conflicting deltas.
     * @returns this view sealed with its caches retained when every character matches; otherwise a new sealed view.
     */
    settle(text: string): PartialArguments;
    /**
     * Compare observed answers and advance their publication baseline. Unread views remain unscanned.
     * @returns whether any observed answer changed since its first read or the preceding refresh.
     */
    refresh(): boolean;
    private refreshRead;
    /**
     * Check whether no further fields can arrive.
     * @returns whether the outer object closed, indexing failed, or the view is sealed; unread values are not validated.
     */
    closed(): boolean;
    /**
     * List discovered fields in first-appearance order.
     * @returns top-level keys seen so far, in first-appearance order.
     */
    keys(): readonly string[];
    /**
     * Check whether a top-level field has appeared.
     * @param key - argument name.
     * @returns whether the field has appeared (a string opened or another value began).
     */
    has(key: string): boolean;
    /**
     * Check whether a field's closing delimiter has arrived, without validating its contents.
     * @param key - argument name.
     * @returns whether its delimiter arrived and no content reader has reported an error for this value.
     */
    complete(key: string): boolean;
    /**
     * Read string length without materializing its text.
     * @param key - argument name.
     * @param options - change granularity for a streaming string.
     * @returns decoded UTF-16 length of the string field so far; undefined when absent or not a string.
     */
    stringLength(key: string, options?: LengthReadOptions): number | undefined;
    /**
     * Check a string against a decoded UTF-16 length limit without materializing it.
     * @param key - argument name.
     * @param maxLength - decoded UTF-16 limit, floored to at least zero.
     * @returns whether the string is longer than the limit; false when absent or not a string.
     */
    stringExceeds(key: string, maxLength: number): boolean;
    /**
     * Read a decoded string, including a streaming prefix.
     * @param key - argument name.
     * @returns the string field's decoded text so far; undefined when absent or not a string.
     */
    text(key: string): string | undefined;
    /**
     * Read at most the first decoded UTF-16 units of a string.
     * @param key - argument name.
     * @param maxLength - maximum decoded UTF-16 length, floored to at least one.
     * @returns the bounded string prefix; undefined when absent or not a string.
     */
    textPrefix(key: string, maxLength: number): string | undefined;
    /**
     * Read a completed non-string argument.
     * @param key - argument name.
     * @returns the parsed non-string value once it closed; undefined while open, absent, or a string.
     */
    value(key: string): JsonValue | undefined;
    /** Answer a question and, on a streaming view, remember it for change detection. */
    private remember;
    private closedNow;
    private keysNow;
    private hasNow;
    private completeNow;
    private lengthNow;
    private textNow;
    private textPrefixNow;
    private valueNow;
    private chunkAt;
    /** Materialize only a requested range, never the cumulative source. */
    private slice;
    private readString;
    /** Locate new field ranges without decoding or parsing their contents. */
    private scan;
    /** Only raw quotes and their preceding backslash runs can terminate a string. */
    private stringBoundary;
    private step;
    private fail;
    private beginKey;
    private stepKey;
    private open;
    private beginValue;
    private stepScalar;
    private stepNested;
    private closeValue;
}
//# sourceMappingURL=partial-json.d.ts.map