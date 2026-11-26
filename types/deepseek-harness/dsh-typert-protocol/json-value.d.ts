/**
 * Lossless JSON checks every Remote carrier shares: the Client handle before it
 * queues an uplink item, the Gateway at its wire and codec-less uplink
 * boundaries, and the in-process mock.
 */
/**
 * Test whether a value crosses JSON transport without coercion or omission.
 * @param value - candidate boundary value.
 * @returns whether the value is losslessly JSON-compatible.
 */
export declare function isRemoteJsonValue(value: unknown): boolean;
/**
 * Test whether a value may travel as one uplink item: a lossless JSON value, or
 * a top-level `undefined`, which the wire carries as an `item` frame without
 * `value`. Nested `undefined`, `NaN`, and infinities stay rejected.
 * @param value - candidate uplink item.
 * @returns whether the item crosses every carrier unchanged.
 */
export declare function isRemoteUplinkItem(value: unknown): boolean;
//# sourceMappingURL=json-value.d.ts.map