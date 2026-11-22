/**
 * Byte-exact WebRTC DataChannel framing (`DSHU`), chunking (`RTCH`), and
 * sequenced ciphertext reorder buffer shared across Desktop Host, Web, and Android.
 *
 * Wire format:
 * - Raw TweetNaCl ciphertext bundle:
 *     `[0..16) salt | [16..24) uint64_le seq | [24..) box_ciphertext (>= 16B)`
 * - `DSHU` envelope (12B header + bundle):
 *     `[0..4) "DSHU" (0x44 53 48 55) | [4..12) uint64_be seq | [12..) bundle`
 * - `RTCH` chunking (only when `dshuFrame.byteLength > 8192`):
 *     `[0..4) "RTCH" (0x52 54 43 48) | [4..8) uint32_be messageId (1..0xFFFFFFFF)`
 *     `| [8..10) uint16_be index (0..total-1) | [10..12) uint16_be total (2..512)`
 *     `| [12..) payload (non-final === 8192B, final 1..8192B)`
 */

export const DSHU_MAGIC = new Uint8Array([0x44, 0x53, 0x48, 0x55]); // "DSHU"
export const DSHU_HEADER_BYTES = 12;
export const E2EE_SALT_BYTES = 16;
export const E2EE_SEQ_BYTES = 8;
export const E2EE_NONCE_BYTES = E2EE_SALT_BYTES + E2EE_SEQ_BYTES; // 24
export const E2EE_MAC_BYTES = 16;
export const E2EE_MIN_BUNDLE_BYTES = E2EE_NONCE_BYTES + E2EE_MAC_BYTES; // 40

export const RTCH_MAGIC = new Uint8Array([0x52, 0x54, 0x43, 0x48]); // "RTCH"
export const RTCH_HEADER_BYTES = 12;
export const RTC_CHUNK_PAYLOAD_BYTES = 8 * 1024; // 8192
export const RTC_CHUNK_MAX_MESSAGE_BYTES = 4 * 1024 * 1024; // 4 MiB
export const RTC_CHUNK_MAX_TOTAL = RTC_CHUNK_MAX_MESSAGE_BYTES / RTC_CHUNK_PAYLOAD_BYTES; // 512
export const RTC_CHUNK_MAX_IN_FLIGHT_MESSAGES = 8;
export const RTC_CHUNK_MAX_ASSEMBLY_AGE_MS = 30_000;

export const REORDER_MAX_BUFFERED_FRAMES = 256;
export const REORDER_MAX_BUFFERED_BYTES = 4 * 1024 * 1024; // 4 MiB
export const REORDER_GAP_TIMEOUT_MS = 5_000;

const UINT64_MASK = 0xffffffffffffffffn;

export function writeUint64BE(target: Uint8Array, offset: number, value: bigint): void {
  if (value < 0n || value > UINT64_MASK) {
    throw new RangeError("uint64 value out of range");
  }
  const view = new DataView(target.buffer, target.byteOffset + offset, 8);
  view.setBigUint64(0, value, false);
}

export function readUint64BE(source: Uint8Array, offset: number): bigint {
  const view = new DataView(source.buffer, source.byteOffset + offset, 8);
  return view.getBigUint64(0, false);
}

export function writeUint64LE(target: Uint8Array, offset: number, value: bigint): void {
  if (value < 0n || value > UINT64_MASK) {
    throw new RangeError("uint64 value out of range");
  }
  const view = new DataView(target.buffer, target.byteOffset + offset, 8);
  view.setBigUint64(0, value, true);
}

export function readUint64LE(source: Uint8Array, offset: number): bigint {
  const view = new DataView(source.buffer, source.byteOffset + offset, 8);
  return view.getBigUint64(0, true);
}

function hasMagic(frame: Uint8Array, magic: Uint8Array): boolean {
  return (
    frame.byteLength >= 4 &&
    frame[0] === magic[0] &&
    frame[1] === magic[1] &&
    frame[2] === magic[2] &&
    frame[3] === magic[3]
  );
}

export function isDshuFrame(frame: Uint8Array): boolean {
  return hasMagic(frame, DSHU_MAGIC);
}

export function isRtchChunk(frame: Uint8Array): boolean {
  return hasMagic(frame, RTCH_MAGIC);
}

export function encodeDshuFrame(seq: bigint | number, bundle: Uint8Array): Uint8Array {
  const seqBigInt = typeof seq === "bigint" ? seq : BigInt(seq);
  if (seqBigInt < 0n || seqBigInt > UINT64_MASK) {
    throw new RangeError("DSHU seq must be an unsigned 64-bit integer");
  }
  if (bundle.byteLength < E2EE_MIN_BUNDLE_BYTES) {
    throw new Error(
      `DSHU bundle too short: ${bundle.byteLength} bytes (min ${E2EE_MIN_BUNDLE_BYTES})`,
    );
  }
  const nonceSeq = readUint64LE(bundle, E2EE_SALT_BYTES);
  if (nonceSeq !== seqBigInt) {
    throw new Error(
      `DSHU seq mismatch: header seq ${seqBigInt.toString()} !== bundle nonce seq ${nonceSeq.toString()}`,
    );
  }
  const out = new Uint8Array(DSHU_HEADER_BYTES + bundle.byteLength);
  out.set(DSHU_MAGIC, 0);
  writeUint64BE(out, 4, seqBigInt);
  out.set(bundle, DSHU_HEADER_BYTES);
  return out;
}

export interface DecodedDshuFrame {
  seq: bigint;
  bundle: Uint8Array;
}

export function decodeDshuFrame(frame: Uint8Array): DecodedDshuFrame {
  if (frame.byteLength < DSHU_HEADER_BYTES + E2EE_MIN_BUNDLE_BYTES) {
    throw new Error(`DSHU frame too short: ${frame.byteLength} bytes`);
  }
  if (!isDshuFrame(frame)) {
    throw new Error("Invalid DSHU magic header");
  }
  const seq = readUint64BE(frame, 4);
  const bundle = frame.slice(DSHU_HEADER_BYTES);
  const nonceSeq = readUint64LE(bundle, E2EE_SALT_BYTES);
  if (nonceSeq !== seq) {
    throw new Error(
      `DSHU seq mismatch: header seq ${seq.toString()} !== bundle nonce seq ${nonceSeq.toString()}`,
    );
  }
  return { seq, bundle };
}

export class RtcChunker {
  private nextId = 1;
  private readonly chunkPayloadBytes: number;
  private readonly maxMessageBytes: number;

  constructor(options?: { chunkPayloadBytes?: number; maxMessageBytes?: number }) {
    this.chunkPayloadBytes = options?.chunkPayloadBytes ?? RTC_CHUNK_PAYLOAD_BYTES;
    this.maxMessageBytes = options?.maxMessageBytes ?? RTC_CHUNK_MAX_MESSAGE_BYTES;
  }

  private allocateMessageId(): number {
    const id = this.nextId;
    this.nextId = id >= 0xffffffff ? 1 : id + 1;
    return id;
  }

  chunk(payload: Uint8Array): Uint8Array[] {
    if (payload.byteLength === 0) {
      throw new Error("RTCH cannot send empty payload");
    }
    if (payload.byteLength > this.maxMessageBytes) {
      throw new Error(
        `RTCH message exceeds max size: ${payload.byteLength} > ${this.maxMessageBytes}`,
      );
    }
    if (payload.byteLength <= this.chunkPayloadBytes) {
      return [payload];
    }

    const total = Math.ceil(payload.byteLength / this.chunkPayloadBytes);
    const maxTotal = Math.floor(this.maxMessageBytes / this.chunkPayloadBytes);
    if (total < 2 || total > maxTotal) {
      throw new Error(`RTCH chunk count out of bounds: ${total}`);
    }

    const messageId = this.allocateMessageId();
    const chunks: Uint8Array[] = [];
    for (let index = 0; index < total; index += 1) {
      const start = index * this.chunkPayloadBytes;
      const end = Math.min(start + this.chunkPayloadBytes, payload.byteLength);
      const slice = payload.subarray(start, end);
      const frame = new Uint8Array(RTCH_HEADER_BYTES + slice.byteLength);
      frame.set(RTCH_MAGIC, 0);
      const view = new DataView(frame.buffer, frame.byteOffset, RTCH_HEADER_BYTES);
      view.setUint32(4, messageId, false);
      view.setUint16(8, index, false);
      view.setUint16(10, total, false);
      frame.set(slice, RTCH_HEADER_BYTES);
      chunks.push(frame);
    }
    return chunks;
  }
}

interface InFlightAssembly {
  readonly createdAtMs: number;
  readonly total: number;
  nextIndex: number;
  totalBytes: number;
  readonly chunks: Uint8Array[];
}

export interface RtcChunkReassemblerOptions {
  now?: () => number;
  chunkPayloadBytes?: number;
  maxMessageBytes?: number;
  maxInFlightMessages?: number;
  maxAssemblyAgeMs?: number;
}

export class RtcChunkReassembler {
  private readonly inFlight = new Map<number, InFlightAssembly>();
  private readonly now: () => number;
  private readonly chunkPayloadBytes: number;
  private readonly maxMessageBytes: number;
  private readonly maxTotal: number;
  private readonly maxInFlightMessages: number;
  private readonly maxAssemblyAgeMs: number;

  constructor(options?: RtcChunkReassemblerOptions) {
    this.now = options?.now ?? (() => Date.now());
    this.chunkPayloadBytes = options?.chunkPayloadBytes ?? RTC_CHUNK_PAYLOAD_BYTES;
    this.maxMessageBytes = options?.maxMessageBytes ?? RTC_CHUNK_MAX_MESSAGE_BYTES;
    this.maxTotal = Math.floor(this.maxMessageBytes / this.chunkPayloadBytes);
    this.maxInFlightMessages = options?.maxInFlightMessages ?? RTC_CHUNK_MAX_IN_FLIGHT_MESSAGES;
    this.maxAssemblyAgeMs = options?.maxAssemblyAgeMs ?? RTC_CHUNK_MAX_ASSEMBLY_AGE_MS;
  }

  get inFlightCount(): number {
    return this.inFlight.size;
  }

  clear(): void {
    this.inFlight.clear();
  }

  private pruneExpired(nowMs: number): void {
    for (const [id, assembly] of this.inFlight) {
      if (nowMs - assembly.createdAtMs > this.maxAssemblyAgeMs) {
        this.inFlight.delete(id);
      }
    }
  }

  push(frame: Uint8Array): Uint8Array | null {
    if (!isRtchChunk(frame)) {
      if (frame.byteLength > this.maxMessageBytes) {
        throw new Error(
          `RTCH unchunked frame exceeds max size: ${frame.byteLength} > ${this.maxMessageBytes}`,
        );
      }
      return frame;
    }

    if (frame.byteLength <= RTCH_HEADER_BYTES) {
      throw new Error(`RTCH chunk too short: ${frame.byteLength} bytes`);
    }

    const view = new DataView(frame.buffer, frame.byteOffset, RTCH_HEADER_BYTES);
    const messageId = view.getUint32(4, false);
    const index = view.getUint16(8, false);
    const total = view.getUint16(10, false);
    const payload = frame.subarray(RTCH_HEADER_BYTES);

    if (messageId === 0) {
      throw new Error("RTCH chunk has invalid messageId 0");
    }
    if (total < 2 || total > this.maxTotal) {
      throw new Error(`RTCH chunk total out of bounds: ${total}`);
    }
    if (index >= total) {
      throw new Error(`RTCH chunk index out of bounds: ${index} >= ${total}`);
    }

    const isLast = index === total - 1;
    if (!isLast && payload.byteLength !== this.chunkPayloadBytes) {
      throw new Error(
        `RTCH non-final chunk must be ${this.chunkPayloadBytes} bytes, got ${payload.byteLength}`,
      );
    }
    if (isLast && (payload.byteLength < 1 || payload.byteLength > this.chunkPayloadBytes)) {
      throw new Error(
        `RTCH final chunk size out of bounds: ${payload.byteLength} bytes`,
      );
    }

    const nowMs = this.now();
    const existing = this.inFlight.get(messageId);
    if (!existing) {
      if (index !== 0) {
        throw new Error(
          `RTCH out-of-order first chunk for message ${messageId}: expected index 0, got ${index}`,
        );
      }
      this.pruneExpired(nowMs);
      if (this.inFlight.size >= this.maxInFlightMessages) {
        throw new Error(
          `RTCH max in-flight messages (${this.maxInFlightMessages}) exceeded`,
        );
      }
      this.inFlight.set(messageId, {
        createdAtMs: nowMs,
        total,
        nextIndex: 1,
        totalBytes: payload.byteLength,
        chunks: [new Uint8Array(payload)],
      });
      return null;
    }

    if (nowMs - existing.createdAtMs > this.maxAssemblyAgeMs) {
      this.inFlight.delete(messageId);
      throw new Error(`RTCH assembly expired for message ${messageId}`);
    }
    if (total !== existing.total) {
      this.inFlight.delete(messageId);
      throw new Error(
        `RTCH chunk total mismatch for message ${messageId}: ${total} !== ${existing.total}`,
      );
    }
    if (index !== existing.nextIndex) {
      this.inFlight.delete(messageId);
      throw new Error(
        `RTCH chunk sequence error for message ${messageId}: expected ${existing.nextIndex}, got ${index}`,
      );
    }
    if (existing.totalBytes + payload.byteLength > this.maxMessageBytes) {
      this.inFlight.delete(messageId);
      throw new Error(
        `RTCH reassembled message exceeds max size (${this.maxMessageBytes})`,
      );
    }

    existing.chunks.push(new Uint8Array(payload));
    existing.totalBytes += payload.byteLength;
    existing.nextIndex += 1;

    if (existing.nextIndex < existing.total) {
      return null;
    }

    this.inFlight.delete(messageId);
    const out = new Uint8Array(existing.totalBytes);
    let offset = 0;
    for (const chunk of existing.chunks) {
      out.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return out;
  }
}

export interface SequencedFrame<T = Uint8Array> {
  seq: bigint;
  payload: T;
}

export interface ReorderBufferOptions {
  initialExpectedSeq?: bigint | null;
  maxBufferedFrames?: number;
  maxBufferedBytes?: number;
  gapTimeoutMs?: number;
  now?: () => number;
  onGapTimeout?: (error: Error) => void;
}

interface TimeoutLike {
  unref?: () => void;
}

export class SequencedCiphertextReorderBuffer {
  private nextExpectedSeq: bigint | null;
  private readonly maxBufferedFrames: number;
  private readonly maxBufferedBytes: number;
  private readonly gapTimeoutMs: number;
  private readonly now: () => number;
  private readonly onGapTimeout?: (error: Error) => void;
  private readonly buffered = new Map<bigint, Uint8Array>();
  private bufferedBytes = 0;
  private gapStartedAtMs: number | null = null;
  private gapTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options?: ReorderBufferOptions) {
    this.nextExpectedSeq = options?.initialExpectedSeq ?? null;
    this.maxBufferedFrames = options?.maxBufferedFrames ?? REORDER_MAX_BUFFERED_FRAMES;
    this.maxBufferedBytes = options?.maxBufferedBytes ?? REORDER_MAX_BUFFERED_BYTES;
    this.gapTimeoutMs = options?.gapTimeoutMs ?? REORDER_GAP_TIMEOUT_MS;
    this.now = options?.now ?? (() => Date.now());
    this.onGapTimeout = options?.onGapTimeout;
  }

  get expectedSeq(): bigint | null {
    return this.nextExpectedSeq;
  }

  get bufferedCount(): number {
    return this.buffered.size;
  }

  get totalBufferedBytes(): number {
    return this.bufferedBytes;
  }

  setNextExpectedSeq(seq: bigint): void {
    if (seq < 0n) {
      throw new RangeError("nextExpectedSeq must be non-negative");
    }
    this.nextExpectedSeq = seq;
  }

  checkGapTimeout(nowMs = this.now()): void {
    if (this.gapStartedAtMs !== null && nowMs - this.gapStartedAtMs > this.gapTimeoutMs) {
      const err = new Error(
        `Reorder buffer gap timed out waiting for seq ${this.nextExpectedSeq?.toString() ?? "unknown"}`,
      );
      this.clear();
      throw err;
    }
  }

  push(seq: bigint, payload: Uint8Array): SequencedFrame<Uint8Array>[] {
    if (seq < 0n) {
      throw new RangeError("seq must be non-negative");
    }

    const nowMs = this.now();
    this.checkGapTimeout(nowMs);

    if (this.nextExpectedSeq === null) {
      this.nextExpectedSeq = seq + 1n;
      return [{ seq, payload }];
    }

    if (seq < this.nextExpectedSeq) {
      throw new Error(
        `Reorder buffer replay/stale seq: received ${seq.toString()}, expected >= ${this.nextExpectedSeq.toString()}`,
      );
    }

    if (seq > this.nextExpectedSeq) {
      if (this.buffered.has(seq)) {
        throw new Error(`Reorder buffer duplicate buffered seq: ${seq.toString()}`);
      }
      if (this.buffered.size >= this.maxBufferedFrames) {
        throw new Error(
          `Reorder buffer exceeded max buffered frames (${this.maxBufferedFrames})`,
        );
      }
      if (this.bufferedBytes + payload.byteLength > this.maxBufferedBytes) {
        throw new Error(
          `Reorder buffer exceeded max buffered bytes (${this.maxBufferedBytes})`,
        );
      }
      this.buffered.set(seq, new Uint8Array(payload));
      this.bufferedBytes += payload.byteLength;
      if (this.gapStartedAtMs === null) {
        this.startGapTimer(nowMs);
      }
      return [];
    }

    // seq === this.nextExpectedSeq
    const ready: SequencedFrame<Uint8Array>[] = [{ seq, payload }];
    this.nextExpectedSeq = seq + 1n;

    while (this.buffered.has(this.nextExpectedSeq)) {
      const bufferedPayload = this.buffered.get(this.nextExpectedSeq)!;
      this.buffered.delete(this.nextExpectedSeq);
      this.bufferedBytes -= bufferedPayload.byteLength;
      ready.push({ seq: this.nextExpectedSeq, payload: bufferedPayload });
      this.nextExpectedSeq += 1n;
    }

    if (this.buffered.size === 0) {
      this.clearGapTimer();
    } else {
      this.restartGapTimer(nowMs);
    }

    return ready;
  }

  clear(): void {
    this.buffered.clear();
    this.bufferedBytes = 0;
    this.clearGapTimer();
  }

  dispose(): void {
    this.clear();
  }

  private startGapTimer(nowMs: number): void {
    this.gapStartedAtMs = nowMs;
    if (!this.onGapTimeout) return;
    this.gapTimer = setTimeout(() => {
      this.gapTimer = null;
      if (this.buffered.size === 0) {
        this.gapStartedAtMs = null;
        return;
      }
      const err = new Error(
        `Reorder buffer gap timed out waiting for seq ${this.nextExpectedSeq?.toString() ?? "unknown"}`,
      );
      this.clear();
      this.onGapTimeout?.(err);
    }, this.gapTimeoutMs);
    (this.gapTimer as unknown as TimeoutLike)?.unref?.();
  }

  private restartGapTimer(nowMs: number): void {
    this.clearGapTimer();
    this.startGapTimer(nowMs);
  }

  private clearGapTimer(): void {
    this.gapStartedAtMs = null;
    if (this.gapTimer !== null) {
      clearTimeout(this.gapTimer);
      this.gapTimer = null;
    }
  }
}
