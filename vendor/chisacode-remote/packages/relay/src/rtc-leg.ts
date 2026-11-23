/**
 * Self-contained byte-exact DSHU + RTCH + SequencedCiphertextReorderBuffer
 * implementation for `EncryptedChannel` WebRTC DataChannel leg hot-cutover.
 *
 * Matches `@chisacode/protocol/rtc-chunking` byte-for-byte while keeping
 * `@chisacode/relay` dependency-free from `@chisacode/protocol`.
 */

import { SALT_LENGTH, SEQ_LENGTH } from "./crypto.js";

export interface BinaryDataChannelTransport {
  send(data: Uint8Array): void;
  close(code?: number, reason?: string): void;
  onmessage: ((data: ArrayBuffer | Uint8Array) => void) | null;
  onclose: ((code: number, reason: string) => void) | null;
  onerror: ((error: Error) => void) | null;
}

const DSHU_MAGIC = new Uint8Array([0x44, 0x53, 0x48, 0x55]); // "DSHU"
const DSHU_HEADER_BYTES = 12;
const E2EE_MIN_BUNDLE_BYTES = SALT_LENGTH + SEQ_LENGTH + 16; // 40

const RTCH_MAGIC = new Uint8Array([0x52, 0x54, 0x43, 0x48]); // "RTCH"
const RTCH_HEADER_BYTES = 12;
export const RTC_CHUNK_PAYLOAD_BYTES = 8 * 1024; // 8192
export const RTC_CHUNK_MAX_MESSAGE_BYTES = 4 * 1024 * 1024; // 4 MiB
const RTC_CHUNK_MAX_TOTAL = RTC_CHUNK_MAX_MESSAGE_BYTES / RTC_CHUNK_PAYLOAD_BYTES; // 512
const RTC_CHUNK_MAX_IN_FLIGHT_MESSAGES = 8;
const RTC_CHUNK_MAX_ASSEMBLY_AGE_MS = 30_000;

export const REORDER_MAX_BUFFERED_FRAMES = 256;
export const REORDER_MAX_BUFFERED_BYTES = 4 * 1024 * 1024; // 4 MiB
export const REORDER_GAP_TIMEOUT_MS = 5_000;

export const RTC_DRAIN_TIMEOUT_MS = 3_000;
export const RTC_UPGRADED_CLOSE_CODE = 1000;
export const RTC_UPGRADED_CLOSE_REASON = "upgraded_to_webrtc";

const UINT64_MASK = 0xffffffffffffffffn;

function readUint64BE(source: Uint8Array, offset: number): bigint {
  const view = new DataView(source.buffer, source.byteOffset + offset, 8);
  return view.getBigUint64(0, false);
}

function writeUint64BE(target: Uint8Array, offset: number, value: bigint): void {
  const view = new DataView(target.buffer, target.byteOffset + offset, 8);
  view.setBigUint64(0, value, false);
}

function readUint64LE(source: Uint8Array, offset: number): bigint {
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

export function encodeDshuFrame(seq: bigint, bundle: Uint8Array): Uint8Array {
  if (seq < 0n || seq > UINT64_MASK) {
    throw new RangeError("DSHU seq out of range");
  }
  if (bundle.byteLength < E2EE_MIN_BUNDLE_BYTES) {
    throw new Error(`DSHU bundle too short: ${bundle.byteLength}`);
  }
  const nonceSeq = readUint64LE(bundle, SALT_LENGTH);
  if (nonceSeq !== seq) {
    throw new Error(`DSHU seq mismatch: ${seq.toString()} !== ${nonceSeq.toString()}`);
  }
  const out = new Uint8Array(DSHU_HEADER_BYTES + bundle.byteLength);
  out.set(DSHU_MAGIC, 0);
  writeUint64BE(out, 4, seq);
  out.set(bundle, DSHU_HEADER_BYTES);
  return out;
}

export function decodeDshuFrame(frame: Uint8Array): { seq: bigint; bundle: Uint8Array } {
  if (frame.byteLength < DSHU_HEADER_BYTES + E2EE_MIN_BUNDLE_BYTES) {
    throw new Error(`DSHU frame too short: ${frame.byteLength}`);
  }
  if (!hasMagic(frame, DSHU_MAGIC)) {
    throw new Error("Invalid DSHU magic header");
  }
  const seq = readUint64BE(frame, 4);
  const bundle = frame.slice(DSHU_HEADER_BYTES);
  const nonceSeq = readUint64LE(bundle, SALT_LENGTH);
  if (nonceSeq !== seq) {
    throw new Error(`DSHU seq mismatch: ${seq.toString()} !== ${nonceSeq.toString()}`);
  }
  return { seq, bundle };
}

export class RelayRtcChunker {
  private nextId = 1;

  chunk(payload: Uint8Array): Uint8Array[] {
    if (payload.byteLength === 0) {
      throw new Error("RTCH cannot send empty payload");
    }
    if (payload.byteLength > RTC_CHUNK_MAX_MESSAGE_BYTES) {
      throw new Error(
        `RTCH message exceeds max size: ${payload.byteLength} > ${RTC_CHUNK_MAX_MESSAGE_BYTES}`,
      );
    }
    if (payload.byteLength <= RTC_CHUNK_PAYLOAD_BYTES) {
      return [payload];
    }
    const total = Math.ceil(payload.byteLength / RTC_CHUNK_PAYLOAD_BYTES);
    if (total < 2 || total > RTC_CHUNK_MAX_TOTAL) {
      throw new Error(`RTCH chunk count out of bounds: ${total}`);
    }
    const messageId = this.nextId;
    this.nextId = messageId >= 0xffffffff ? 1 : messageId + 1;

    const chunks: Uint8Array[] = [];
    for (let index = 0; index < total; index += 1) {
      const start = index * RTC_CHUNK_PAYLOAD_BYTES;
      const end = Math.min(start + RTC_CHUNK_PAYLOAD_BYTES, payload.byteLength);
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

interface Assembly {
  createdAtMs: number;
  total: number;
  nextIndex: number;
  totalBytes: number;
  chunks: Uint8Array[];
}

export class RelayRtcChunkReassembler {
  private readonly inFlight = new Map<number, Assembly>();

  clear(): void {
    this.inFlight.clear();
  }

  push(frame: Uint8Array): Uint8Array | null {
    if (!hasMagic(frame, RTCH_MAGIC)) {
      if (frame.byteLength > RTC_CHUNK_MAX_MESSAGE_BYTES) {
        throw new Error(`RTCH unchunked frame exceeds max size: ${frame.byteLength}`);
      }
      return frame;
    }
    if (frame.byteLength <= RTCH_HEADER_BYTES) {
      throw new Error(`RTCH chunk too short: ${frame.byteLength}`);
    }
    const view = new DataView(frame.buffer, frame.byteOffset, RTCH_HEADER_BYTES);
    const messageId = view.getUint32(4, false);
    const index = view.getUint16(8, false);
    const total = view.getUint16(10, false);
    const payload = frame.subarray(RTCH_HEADER_BYTES);

    if (messageId === 0 || total < 2 || total > RTC_CHUNK_MAX_TOTAL || index >= total) {
      throw new Error("RTCH invalid header fields");
    }
    const isLast = index === total - 1;
    if (!isLast && payload.byteLength !== RTC_CHUNK_PAYLOAD_BYTES) {
      throw new Error(`RTCH non-final chunk must be ${RTC_CHUNK_PAYLOAD_BYTES} bytes`);
    }
    if (isLast && (payload.byteLength < 1 || payload.byteLength > RTC_CHUNK_PAYLOAD_BYTES)) {
      throw new Error("RTCH final chunk size out of bounds");
    }

    const nowMs = Date.now();
    const existing = this.inFlight.get(messageId);
    if (!existing) {
      if (index !== 0) {
        throw new Error(`RTCH out-of-order first chunk: index ${index}`);
      }
      for (const [id, assembly] of this.inFlight) {
        if (nowMs - assembly.createdAtMs > RTC_CHUNK_MAX_ASSEMBLY_AGE_MS) {
          this.inFlight.delete(id);
        }
      }
      if (this.inFlight.size >= RTC_CHUNK_MAX_IN_FLIGHT_MESSAGES) {
        throw new Error("RTCH max in-flight messages exceeded");
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

    if (nowMs - existing.createdAtMs > RTC_CHUNK_MAX_ASSEMBLY_AGE_MS) {
      this.inFlight.delete(messageId);
      throw new Error("RTCH assembly expired");
    }
    if (total !== existing.total || index !== existing.nextIndex) {
      this.inFlight.delete(messageId);
      throw new Error("RTCH chunk sequence or total mismatch");
    }
    if (existing.totalBytes + payload.byteLength > RTC_CHUNK_MAX_MESSAGE_BYTES) {
      this.inFlight.delete(messageId);
      throw new Error("RTCH reassembled message exceeds max size");
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

interface TimeoutLike {
  unref?: () => void;
}

export class RelayReorderBuffer {
  private nextExpectedSeq: bigint | null;
  private readonly buffered = new Map<bigint, Uint8Array>();
  private bufferedBytes = 0;
  private gapTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly onGapTimeout: (error: Error) => void;

  constructor(initialExpectedSeq: bigint | null, onGapTimeout: (error: Error) => void) {
    this.nextExpectedSeq = initialExpectedSeq;
    this.onGapTimeout = onGapTimeout;
  }

  push(seq: bigint, bundle: Uint8Array): Array<{ seq: bigint; bundle: Uint8Array }> {
    if (this.nextExpectedSeq === null) {
      this.nextExpectedSeq = seq + 1n;
      return [{ seq, bundle }];
    }
    if (seq < this.nextExpectedSeq) {
      throw new Error("E2EE replay protection violation: seq not strictly increasing");
    }
    if (seq > this.nextExpectedSeq) {
      if (this.buffered.has(seq)) {
        throw new Error("E2EE replay protection violation: duplicate buffered seq");
      }
      if (this.buffered.size >= REORDER_MAX_BUFFERED_FRAMES) {
        throw new Error("E2EE reorder buffer exceeded max frames");
      }
      if (this.bufferedBytes + bundle.byteLength > REORDER_MAX_BUFFERED_BYTES) {
        throw new Error("E2EE reorder buffer exceeded max bytes");
      }
      this.buffered.set(seq, new Uint8Array(bundle));
      this.bufferedBytes += bundle.byteLength;
      if (this.gapTimer === null) {
        this.startGapTimer();
      }
      return [];
    }

    const ready: Array<{ seq: bigint; bundle: Uint8Array }> = [{ seq, bundle }];
    this.nextExpectedSeq = seq + 1n;
    while (this.buffered.has(this.nextExpectedSeq)) {
      const nextBundle = this.buffered.get(this.nextExpectedSeq)!;
      this.buffered.delete(this.nextExpectedSeq);
      this.bufferedBytes -= nextBundle.byteLength;
      ready.push({ seq: this.nextExpectedSeq, bundle: nextBundle });
      this.nextExpectedSeq += 1n;
    }
    if (this.buffered.size === 0) {
      this.clearGapTimer();
    } else {
      this.clearGapTimer();
      this.startGapTimer();
    }
    return ready;
  }

  dispose(): void {
    this.buffered.clear();
    this.bufferedBytes = 0;
    this.clearGapTimer();
  }

  private startGapTimer(): void {
    this.gapTimer = setTimeout(() => {
      this.gapTimer = null;
      if (this.buffered.size === 0) return;
      const err = new Error(
        `E2EE reorder gap timed out waiting for seq ${this.nextExpectedSeq?.toString() ?? "unknown"}`,
      );
      this.dispose();
      this.onGapTimeout(err);
    }, REORDER_GAP_TIMEOUT_MS);
    (this.gapTimer as unknown as TimeoutLike)?.unref?.();
  }

  private clearGapTimer(): void {
    if (this.gapTimer !== null) {
      clearTimeout(this.gapTimer);
      this.gapTimer = null;
    }
  }
}
