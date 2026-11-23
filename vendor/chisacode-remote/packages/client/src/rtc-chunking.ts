import { z } from "zod/v3";
import { decodeOfferFragmentPayload } from "@chisacode/protocol/connection-offer";
import { RelayAuthBootstrapSchema } from "@chisacode/protocol/relay-device-auth";
import type { IceServerConfig, TransportMode } from "./daemon-client-transport-types.js";

// ============================================================================
// Wire constants (strictly matching contract #8 & ds-harness-remote)
// ============================================================================

export const RTC_CHUNK_MAGIC = new Uint8Array([0x52, 0x54, 0x43, 0x48]); // "RTCH"
export const RTC_CHUNK_HEADER_BYTES = 12;
export const RTC_CHUNK_PAYLOAD_BYTES = 8 * 1024; // 8192 B
export const RTC_CHUNK_MAX_MESSAGE_BYTES = 4 * 1024 * 1024; // 4 MiB
export const RTC_CHUNK_MAX_CHUNKS = 512; // ceil(4 MiB / 8192)
export const RTC_CHUNK_MAX_IN_FLIGHT = 8;
export const RTC_CHUNK_MAX_ASSEMBLY_AGE_MS = 30_000;

export const DSHU_MAGIC = new Uint8Array([0x44, 0x53, 0x48, 0x55]); // "DSHU"
export const DSHU_HEADER_BYTES = 12;
export const NACL_SALT_BYTES = 16;
export const NACL_SEQ_BYTES = 8;
export const NACL_NONCE_BYTES = NACL_SALT_BYTES + NACL_SEQ_BYTES; // 24
export const NACL_MAC_BYTES = 16;
export const NACL_MIN_BUNDLE_BYTES = NACL_NONCE_BYTES + NACL_MAC_BYTES; // 40

export const REORDER_MAX_BUFFERED_FRAMES = 256;
export const REORDER_MAX_BUFFERED_BYTES = 4 * 1024 * 1024; // 4 MiB
export const REORDER_GAP_TIMEOUT_MS = 5_000;

export const SERIAL_SEND_MAX_QUEUED_BYTES = 8 * 1024 * 1024; // 8 MiB
export const SERIAL_SEND_MAX_QUEUED_FRAMES = 256;

export const DEFAULT_STUN_ICE_SERVERS: readonly IceServerConfig[] = Object.freeze([
  { urls: "stun:stun.cloudflare.com:3478" },
  { urls: "stun:stun.l.google.com:19302" },
]);

export const TRANSPORT_MODE_PRIORITY: Readonly<Record<TransportMode, number>> = Object.freeze({
  lan: 3,
  p2p: 2,
  turn: 1,
  relay: 0,
});

// ============================================================================
// BigInt / Endian helpers
// ============================================================================

export function readUint64BE(bytes: Uint8Array, offset: number): bigint {
  let value = 0n;
  for (let i = 0; i < 8; i += 1) {
    value = (value << 8n) | BigInt(bytes[offset + i]);
  }
  return value;
}

export function writeUint64BE(bytes: Uint8Array, offset: number, value: bigint): void {
  const masked = value & 0xffffffffffffffffn;
  for (let i = 7; i >= 0; i -= 1) {
    bytes[offset + i] = Number((masked >> BigInt((7 - i) * 8)) & 0xffn);
  }
}

export function readUint64LE(bytes: Uint8Array, offset: number): bigint {
  let value = 0n;
  for (let i = 0; i < 8; i += 1) {
    value |= BigInt(bytes[offset + i]) << BigInt(i * 8);
  }
  return value;
}

/** Extracts the uint64 little-endian seq from a TweetNaCl bundle (`[16..24)`). */
export function readBundleSeqLE(bundle: Uint8Array): bigint {
  if (bundle.byteLength < NACL_MIN_BUNDLE_BYTES) {
    throw new Error(
      `Encrypted bundle too short (${bundle.byteLength} < ${NACL_MIN_BUNDLE_BYTES})`,
    );
  }
  return readUint64LE(bundle, NACL_SALT_BYTES);
}

// ============================================================================
// DSHU Framing (12B header + raw NaCl ciphertext bundle)
//   [0..4)  "DSHU" (0x44 0x53 0x48 0x55)
//   [4..12) uint64_be seq (must equal bundle[16..24) uint64_le seq)
//   [12..)  bundle
// ============================================================================

export function isDshuFrame(frame: Uint8Array): boolean {
  return (
    frame.byteLength >= 4 &&
    frame[0] === DSHU_MAGIC[0] &&
    frame[1] === DSHU_MAGIC[1] &&
    frame[2] === DSHU_MAGIC[2] &&
    frame[3] === DSHU_MAGIC[3]
  );
}

export function wrapDshuFrame(seq: bigint, bundle: Uint8Array): Uint8Array {
  if (seq < 0n) {
    throw new Error("DSHU sequence must be non-negative");
  }
  const bundleSeq = readBundleSeqLE(bundle);
  if (bundleSeq !== seq) {
    throw new Error(`DSHU sequence mismatch (header=${seq.toString()}, bundle=${bundleSeq.toString()})`);
  }
  const out = new Uint8Array(DSHU_HEADER_BYTES + bundle.byteLength);
  out.set(DSHU_MAGIC, 0);
  writeUint64BE(out, 4, seq);
  out.set(bundle, DSHU_HEADER_BYTES);
  return out;
}

export function unwrapDshuFrame(frame: Uint8Array): { seq: bigint; bundle: Uint8Array } {
  if (frame.byteLength < DSHU_HEADER_BYTES + NACL_MIN_BUNDLE_BYTES) {
    throw new Error(`DSHU frame too short (${frame.byteLength} bytes)`);
  }
  if (!isDshuFrame(frame)) {
    throw new Error("Invalid DSHU magic header");
  }
  const headerSeq = readUint64BE(frame, 4);
  const bundle = frame.slice(DSHU_HEADER_BYTES);
  const bundleSeq = readBundleSeqLE(bundle);
  if (headerSeq !== bundleSeq) {
    throw new Error(
      `DSHU sequence mismatch (header=${headerSeq.toString()}, bundle=${bundleSeq.toString()})`,
    );
  }
  return { seq: headerSeq, bundle };
}

// ============================================================================
// RTCH Chunking (12B header, only when payload > 8192 B)
//   [0..4)  "RTCH" (0x52 0x54 0x43 0x48)
//   [4..8)  uint32_be messageId (1..0xFFFFFFFF cycling)
//   [8..10) uint16_be index (0..total-1)
//   [10..12) uint16_be total (2..512)
//   [12..)  payload (non-final MUST be 8192B; final 1..8192B)
// ============================================================================

export function isRtchFrame(frame: Uint8Array): boolean {
  return (
    frame.byteLength >= 4 &&
    frame[0] === RTC_CHUNK_MAGIC[0] &&
    frame[1] === RTC_CHUNK_MAGIC[1] &&
    frame[2] === RTC_CHUNK_MAGIC[2] &&
    frame[3] === RTC_CHUNK_MAGIC[3]
  );
}

export function createRtcMessageIdGenerator(initial = 1): () => number {
  let next = ((initial - 1) >>> 0) + 1;
  if (next === 0) next = 1;
  return () => {
    const id = next;
    next = next >= 0xffffffff ? 1 : next + 1;
    return id;
  };
}

export function chunkRtcPayload(
  payload: Uint8Array,
  nextMessageId: () => number,
): Uint8Array[] {
  if (payload.byteLength > RTC_CHUNK_MAX_MESSAGE_BYTES) {
    throw new Error(
      `RTC payload exceeds max message size (${payload.byteLength} > ${RTC_CHUNK_MAX_MESSAGE_BYTES})`,
    );
  }
  if (payload.byteLength <= RTC_CHUNK_PAYLOAD_BYTES) {
    if (isRtchFrame(payload)) {
      throw new Error("Unchunked RTC payload must not start with RTCH magic");
    }
    return [payload];
  }

  const total = Math.ceil(payload.byteLength / RTC_CHUNK_PAYLOAD_BYTES);
  if (total < 2 || total > RTC_CHUNK_MAX_CHUNKS) {
    throw new Error(`Invalid RTC chunk count (${total})`);
  }

  const messageId = nextMessageId() >>> 0;
  if (messageId === 0) {
    throw new Error("RTC chunk messageId must be in 1..0xFFFFFFFF");
  }

  const chunks: Uint8Array[] = [];
  for (let index = 0; index < total; index += 1) {
    const start = index * RTC_CHUNK_PAYLOAD_BYTES;
    const end = Math.min(payload.byteLength, start + RTC_CHUNK_PAYLOAD_BYTES);
    const slice = payload.subarray(start, end);
    const chunk = new Uint8Array(RTC_CHUNK_HEADER_BYTES + slice.byteLength);
    chunk.set(RTC_CHUNK_MAGIC, 0);
    const view = new DataView(chunk.buffer, chunk.byteOffset, RTC_CHUNK_HEADER_BYTES);
    view.setUint32(4, messageId, false);
    view.setUint16(8, index, false);
    view.setUint16(10, total, false);
    chunk.set(slice, RTC_CHUNK_HEADER_BYTES);
    chunks.push(chunk);
  }
  return chunks;
}

interface ChunkAssembly {
  total: number;
  nextIndex: number;
  chunks: Uint8Array[];
  totalBytes: number;
  createdAt: number;
}

export interface RtcChunkReassemblerOptions {
  maxMessageBytes?: number;
  maxChunks?: number;
  maxInFlight?: number;
  maxAssemblyAgeMs?: number;
  now?: () => number;
}

export class RtcChunkReassembler {
  private readonly maxMessageBytes: number;
  private readonly maxChunks: number;
  private readonly maxInFlight: number;
  private readonly maxAssemblyAgeMs: number;
  private readonly now: () => number;
  private readonly inFlight = new Map<number, ChunkAssembly>();

  constructor(options: RtcChunkReassemblerOptions = {}) {
    this.maxMessageBytes = options.maxMessageBytes ?? RTC_CHUNK_MAX_MESSAGE_BYTES;
    this.maxChunks = options.maxChunks ?? RTC_CHUNK_MAX_CHUNKS;
    this.maxInFlight = options.maxInFlight ?? RTC_CHUNK_MAX_IN_FLIGHT;
    this.maxAssemblyAgeMs = options.maxAssemblyAgeMs ?? RTC_CHUNK_MAX_ASSEMBLY_AGE_MS;
    this.now = options.now ?? (() => Date.now());
  }

  push(frame: Uint8Array, nowMs = this.now()): Uint8Array | null {
    if (!isRtchFrame(frame)) {
      if (frame.byteLength > this.maxMessageBytes) {
        throw new Error(
          `RTC frame exceeds max message size (${frame.byteLength} > ${this.maxMessageBytes})`,
        );
      }
      return frame;
    }

    if (frame.byteLength <= RTC_CHUNK_HEADER_BYTES) {
      throw new Error(`RTCH chunk too short (${frame.byteLength} bytes)`);
    }

    const view = new DataView(frame.buffer, frame.byteOffset, RTC_CHUNK_HEADER_BYTES);
    const messageId = view.getUint32(4, false);
    const index = view.getUint16(8, false);
    const total = view.getUint16(10, false);
    const chunkPayload = frame.slice(RTC_CHUNK_HEADER_BYTES);

    if (messageId === 0) {
      throw new Error("RTCH chunk messageId cannot be 0");
    }
    if (total < 2 || total > this.maxChunks) {
      throw new Error(`RTCH chunk total out of bounds (${total})`);
    }
    if (index >= total) {
      throw new Error(`RTCH chunk index out of bounds (${index} >= ${total})`);
    }

    const isLast = index === total - 1;
    if (!isLast && chunkPayload.byteLength !== RTC_CHUNK_PAYLOAD_BYTES) {
      throw new Error(
        `RTCH non-final chunk must be ${RTC_CHUNK_PAYLOAD_BYTES} bytes (got ${chunkPayload.byteLength})`,
      );
    }
    if (isLast && (chunkPayload.byteLength < 1 || chunkPayload.byteLength > RTC_CHUNK_PAYLOAD_BYTES)) {
      throw new Error(
        `RTCH final chunk size invalid (${chunkPayload.byteLength} bytes)`,
      );
    }

    let assembly = this.inFlight.get(messageId);
    if (assembly) {
      if (nowMs - assembly.createdAt > this.maxAssemblyAgeMs) {
        this.inFlight.delete(messageId);
        throw new Error(`RTCH assembly expired for messageId=${messageId}`);
      }
      if (assembly.total !== total) {
        this.inFlight.delete(messageId);
        throw new Error(
          `RTCH chunk total mismatch for messageId=${messageId} (${total} !== ${assembly.total})`,
        );
      }
      if (index !== assembly.nextIndex) {
        this.inFlight.delete(messageId);
        throw new Error(
          `RTCH chunk out-of-order or duplicate for messageId=${messageId} (expected=${assembly.nextIndex}, got=${index})`,
        );
      }
    } else {
      // Expire stale unrelated assemblies before checking in-flight limit.
      for (const [id, entry] of this.inFlight) {
        if (nowMs - entry.createdAt > this.maxAssemblyAgeMs) {
          this.inFlight.delete(id);
        }
      }
      if (index !== 0) {
        throw new Error(`RTCH chunk arrived out-of-order without initial chunk (index=${index})`);
      }
      if (this.inFlight.size >= this.maxInFlight) {
        throw new Error(`RTCH max in-flight assemblies exceeded (${this.maxInFlight})`);
      }
      assembly = {
        total,
        nextIndex: 0,
        chunks: [],
        totalBytes: 0,
        createdAt: nowMs,
      };
      this.inFlight.set(messageId, assembly);
    }

    const nextTotalBytes = assembly.totalBytes + chunkPayload.byteLength;
    if (nextTotalBytes > this.maxMessageBytes) {
      this.inFlight.delete(messageId);
      throw new Error(
        `RTCH reassembled message exceeds max size (${nextTotalBytes} > ${this.maxMessageBytes})`,
      );
    }

    assembly.chunks.push(chunkPayload);
    assembly.totalBytes = nextTotalBytes;
    assembly.nextIndex += 1;

    if (assembly.nextIndex < assembly.total) {
      return null;
    }

    this.inFlight.delete(messageId);
    const out = new Uint8Array(assembly.totalBytes);
    let offset = 0;
    for (const part of assembly.chunks) {
      out.set(part, offset);
      offset += part.byteLength;
    }
    return out;
  }

  getInFlightCount(): number {
    return this.inFlight.size;
  }

  reset(): void {
    this.inFlight.clear();
  }
}

// ============================================================================
// SequencedCiphertextReorderBuffer
//   Limits: 256 frames / 4 MiB / 5s gap timeout
// ============================================================================

export interface ReorderBufferOptions {
  maxFrames?: number;
  maxBytes?: number;
  gapTimeoutMs?: number;
  onGapTimeout?: (error: Error) => void;
}

export class SequencedCiphertextReorderBuffer {
  private readonly maxFrames: number;
  private readonly maxBytes: number;
  private readonly gapTimeoutMs: number;
  private readonly onGapTimeout?: (error: Error) => void;
  private nextExpectedSeq = 0n;
  private readonly buffered = new Map<bigint, Uint8Array>();
  private bufferedBytes = 0;
  private gapTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(options: ReorderBufferOptions = {}) {
    this.maxFrames = options.maxFrames ?? REORDER_MAX_BUFFERED_FRAMES;
    this.maxBytes = options.maxBytes ?? REORDER_MAX_BUFFERED_BYTES;
    this.gapTimeoutMs = options.gapTimeoutMs ?? REORDER_GAP_TIMEOUT_MS;
    this.onGapTimeout = options.onGapTimeout;
  }

  setNextExpectedSeq(seq: bigint): void {
    if (seq < 0n) {
      throw new Error("nextExpectedSeq must be non-negative");
    }
    this.nextExpectedSeq = seq;
  }

  getNextExpectedSeq(): bigint {
    return this.nextExpectedSeq;
  }

  getBufferedCount(): number {
    return this.buffered.size;
  }

  getBufferedBytes(): number {
    return this.bufferedBytes;
  }

  push(seq: bigint, bundle: Uint8Array): Uint8Array[] {
    if (this.disposed) {
      throw new Error("Reorder buffer is disposed");
    }
    if (seq < this.nextExpectedSeq) {
      throw new Error(
        `E2EE replay protection violation: seq ${seq.toString()} < expected ${this.nextExpectedSeq.toString()}`,
      );
    }

    if (seq === this.nextExpectedSeq) {
      const ready: Uint8Array[] = [bundle];
      this.nextExpectedSeq += 1n;
      while (this.buffered.has(this.nextExpectedSeq)) {
        const nextBundle = this.buffered.get(this.nextExpectedSeq)!;
        this.buffered.delete(this.nextExpectedSeq);
        this.bufferedBytes -= nextBundle.byteLength;
        ready.push(nextBundle);
        this.nextExpectedSeq += 1n;
      }
      this.clearGapTimer();
      if (this.buffered.size > 0) {
        this.armGapTimer();
      }
      return ready;
    }

    if (this.buffered.has(seq)) {
      throw new Error(`E2EE replay protection violation: duplicate buffered seq ${seq.toString()}`);
    }
    if (this.buffered.size + 1 > this.maxFrames) {
      throw new Error(
        `Reorder buffer frame limit exceeded (${this.buffered.size + 1} > ${this.maxFrames})`,
      );
    }
    if (this.bufferedBytes + bundle.byteLength > this.maxBytes) {
      throw new Error(
        `Reorder buffer byte limit exceeded (${this.bufferedBytes + bundle.byteLength} > ${this.maxBytes})`,
      );
    }

    this.buffered.set(seq, bundle);
    this.bufferedBytes += bundle.byteLength;
    if (!this.gapTimer) {
      this.armGapTimer();
    }
    return [];
  }

  reset(): void {
    this.clearGapTimer();
    this.buffered.clear();
    this.bufferedBytes = 0;
  }

  dispose(): void {
    this.disposed = true;
    this.reset();
  }

  private armGapTimer(): void {
    if (this.gapTimer || this.disposed) return;
    this.gapTimer = setTimeout(() => {
      this.gapTimer = null;
      if (this.disposed || this.buffered.size === 0) return;
      const err = new Error(
        `Reorder buffer gap timed out after ${this.gapTimeoutMs}ms waiting for seq ${this.nextExpectedSeq.toString()}`,
      );
      this.onGapTimeout?.(err);
    }, this.gapTimeoutMs);
    unrefTimer(this.gapTimer);
  }

  private clearGapTimer(): void {
    if (!this.gapTimer) return;
    clearTimeout(this.gapTimer);
    this.gapTimer = null;
  }
}

// ============================================================================
// SerialSend Queue (8 MiB / 256 frames)
// ============================================================================

export interface SerialSendOptions {
  maxQueuedBytes?: number;
  maxQueuedFrames?: number;
}

export class SerialSend {
  private readonly maxQueuedBytes: number;
  private readonly maxQueuedFrames: number;
  private queuedFrames = 0;
  private queuedBytes = 0;
  private tail: Promise<void> | null = null;

  constructor(options: SerialSendOptions = {}) {
    this.maxQueuedBytes = options.maxQueuedBytes ?? SERIAL_SEND_MAX_QUEUED_BYTES;
    this.maxQueuedFrames = options.maxQueuedFrames ?? SERIAL_SEND_MAX_QUEUED_FRAMES;
  }

  getQueuedFrames(): number {
    return this.queuedFrames;
  }

  getQueuedBytes(): number {
    return this.queuedBytes;
  }

  enqueue<T>(byteLength: number, task: () => T | Promise<T>): Promise<T> {
    const normalizedBytes = Math.max(0, Math.floor(byteLength));
    if (this.queuedFrames + 1 > this.maxQueuedFrames) {
      return Promise.reject(
        new Error(
          `Send queue frame limit exceeded (${this.queuedFrames + 1} > ${this.maxQueuedFrames})`,
        ),
      );
    }
    if (this.queuedBytes + normalizedBytes > this.maxQueuedBytes) {
      return Promise.reject(
        new Error(
          `Send queue byte limit exceeded (${this.queuedBytes + normalizedBytes} > ${this.maxQueuedBytes})`,
        ),
      );
    }

    this.queuedFrames += 1;
    this.queuedBytes += normalizedBytes;

    const release = () => {
      this.queuedFrames = Math.max(0, this.queuedFrames - 1);
      this.queuedBytes = Math.max(0, this.queuedBytes - normalizedBytes);
    };

    if (!this.tail) {
      try {
        const result = task();
        if (result && typeof (result as PromiseLike<T>).then === "function") {
          const chained = Promise.resolve(result).finally(release);
          const marker = chained.then(
            () => {
              if (this.tail === marker) this.tail = null;
            },
            () => {
              if (this.tail === marker) this.tail = null;
            },
          );
          this.tail = marker;
          return chained;
        }
        release();
        return Promise.resolve(result);
      } catch (error) {
        release();
        return Promise.reject(error);
      }
    }

    const run = async (): Promise<T> => {
      try {
        return await task();
      } finally {
        release();
      }
    };

    const resultPromise = this.tail.then(run, run);
    const marker = resultPromise.then(
      () => {
        if (this.tail === marker) this.tail = null;
      },
      () => {
        if (this.tail === marker) this.tail = null;
      },
    );
    this.tail = marker;
    return resultPromise;
  }
}

// ============================================================================
// ICE Server Ordering & Merging
//   Priority: stun/stuns (0) < turn?transport=tcp (10) < turns?transport=tcp (20)
//             < turn?transport=udp (30) < turns (40) < turn (50)
// ============================================================================

function iceUrlRank(rawUrl: string): number {
  const url = rawUrl.trim().toLowerCase();
  if (url.startsWith("stun:") || url.startsWith("stuns:")) return 0;
  const isTurns = url.startsWith("turns:");
  const isTurn = url.startsWith("turn:");
  if (!isTurns && !isTurn) return 60;
  const hasTcp = /[?&]transport=tcp(?:&|$)/.test(url);
  const hasUdp = /[?&]transport=udp(?:&|$)/.test(url);
  if (isTurn && hasTcp) return 10;
  if (isTurns && hasTcp) return 20;
  if (isTurn && hasUdp) return 30;
  if (isTurns) return 40;
  return 50;
}

function iceServerRank(server: IceServerConfig): number {
  const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
  let best = 100;
  for (const url of urls) {
    const r = iceUrlRank(url);
    if (r < best) best = r;
  }
  return best;
}

export function normalizeIceServers(servers: readonly IceServerConfig[] | undefined): IceServerConfig[] {
  if (!Array.isArray(servers)) return [];
  const out: IceServerConfig[] = [];
  const seen = new Set<string>();
  for (const entry of servers) {
    if (!entry || typeof entry !== "object") continue;
    const rawUrls: unknown[] = Array.isArray(entry.urls) ? entry.urls : [entry.urls];
    const urls = rawUrls
      .filter((u: unknown): u is string => typeof u === "string")
      .map((u: string) => u.trim())
      .filter((u: string) => u.length > 0);
    if (urls.length === 0) continue;
    const normalized: IceServerConfig = {
      urls: urls.length === 1 ? urls[0] : urls,
      ...(typeof entry.username === "string" && entry.username.length > 0
        ? { username: entry.username }
        : {}),
      ...(typeof entry.credential === "string" && entry.credential.length > 0
        ? { credential: entry.credential }
        : {}),
    };
    const key = JSON.stringify([
      Array.isArray(normalized.urls) ? normalized.urls : [normalized.urls],
      normalized.username ?? "",
      normalized.credential ?? "",
    ]);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
}

export function orderIceServers(servers: readonly IceServerConfig[]): IceServerConfig[] {
  return normalizeIceServers(servers)
    .map((server, idx) => ({ server, idx, rank: iceServerRank(server) }))
    .sort((a, b) => (a.rank !== b.rank ? a.rank - b.rank : a.idx - b.idx))
    .map((item) => item.server);
}

export function mergeIceServers(
  offerServers?: readonly IceServerConfig[],
  customServers?: readonly IceServerConfig[],
  options: { includeDefaults?: boolean } = {},
): IceServerConfig[] {
  const combined: IceServerConfig[] = [
    ...(offerServers ?? []),
    ...(customServers ?? []),
  ];
  const includeDefaults = options.includeDefaults ?? combined.length === 0;
  if (includeDefaults) {
    combined.push(...DEFAULT_STUN_ICE_SERVERS);
  }
  return orderIceServers(combined);
}

// ============================================================================
// Offer v2 Compatible Extension (lan + iceServers + optional relay)
// ============================================================================

export const IceServerConfigSchema = z.object({
  urls: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
  username: z.string().optional(),
  credential: z.string().optional(),
});

export const AdaptiveConnectionOfferV2Schema = z
  .object({
    v: z.literal(2),
    serverId: z.string().min(1),
    daemonPublicKeyB64: z.string().min(1),
    relayAuthPublicKeyB64: z.string().min(1).optional(),
    authBootstrap: RelayAuthBootstrapSchema.optional(),
    relay: z
      .object({
        endpoint: z.string().min(1),
        useTls: z.boolean().optional(),
      })
      .optional(),
    lan: z
      .object({
        endpoints: z.array(z.string().min(1)).min(1),
        useTls: z.boolean().optional(),
      })
      .optional(),
    iceServers: z.array(IceServerConfigSchema).optional(),
  })
  .refine(
    (offer) => Boolean(offer.relay?.endpoint) || Boolean(offer.lan && offer.lan.endpoints.length > 0),
    { message: "Connection offer requires relay.endpoint or non-empty lan.endpoints" },
  );

export type AdaptiveConnectionOfferV2 = z.infer<typeof AdaptiveConnectionOfferV2Schema>;

const OFFER_FRAGMENT_PREFIX = "#offer=";

export function parseConnectionOfferV2FromUrl(input: string): AdaptiveConnectionOfferV2 | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const fragmentIndex = trimmed.indexOf(OFFER_FRAGMENT_PREFIX);
  if (fragmentIndex === -1) return null;
  const encoded = trimmed.slice(fragmentIndex + OFFER_FRAGMENT_PREFIX.length).trim();
  if (!encoded) return null;
  const payload = decodeOfferFragmentPayload(encoded);
  return AdaptiveConnectionOfferV2Schema.parse(payload);
}

function unrefTimer(timer: unknown): void {
  if (
    typeof timer === "object" &&
    timer !== null &&
    "unref" in timer &&
    typeof (timer as { unref?: unknown }).unref === "function"
  ) {
    (timer as { unref: () => void }).unref();
  }
}
