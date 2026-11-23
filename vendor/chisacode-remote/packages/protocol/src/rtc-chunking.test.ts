import { describe, expect, it, vi } from "vitest";

import {
  DSHU_HEADER_BYTES,
  DSHU_MAGIC,
  E2EE_SALT_BYTES,
  REORDER_GAP_TIMEOUT_MS,
  REORDER_MAX_BUFFERED_BYTES,
  REORDER_MAX_BUFFERED_FRAMES,
  RTC_CHUNK_MAX_ASSEMBLY_AGE_MS,
  RTC_CHUNK_MAX_IN_FLIGHT_MESSAGES,
  RTC_CHUNK_MAX_MESSAGE_BYTES,
  RTC_CHUNK_PAYLOAD_BYTES,
  RTCH_HEADER_BYTES,
  RTCH_MAGIC,
  RtcChunkReassembler,
  RtcChunker,
  SequencedCiphertextReorderBuffer,
  decodeDshuFrame,
  encodeDshuFrame,
  isDshuFrame,
  isRtchChunk,
  writeUint64LE,
} from "./rtc-chunking.js";

function makeBundle(seq: bigint, ciphertextLength = 32): Uint8Array {
  const bundle = new Uint8Array(16 + 8 + ciphertextLength);
  for (let i = 0; i < 16; i += 1) {
    bundle[i] = (i + 1) & 0xff;
  }
  writeUint64LE(bundle, E2EE_SALT_BYTES, seq);
  for (let i = 24; i < bundle.byteLength; i += 1) {
    bundle[i] = (i * 7 + Number(seq & 0xffn)) & 0xff;
  }
  return bundle;
}

describe("DSHU framing", () => {
  it("encodes and decodes byte-exact DSHU frames", () => {
    const seq = 0x01020304050607n;
    const bundle = makeBundle(seq, 48);
    const frame = encodeDshuFrame(seq, bundle);

    expect(frame.byteLength).toBe(DSHU_HEADER_BYTES + bundle.byteLength);
    expect(frame.slice(0, 4)).toEqual(DSHU_MAGIC);
    expect(isDshuFrame(frame)).toBe(true);
    expect(isRtchChunk(frame)).toBe(false);

    // Big-endian seq bytes at [4..12)
    expect(Array.from(frame.slice(4, 12))).toEqual([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07]);

    const decoded = decodeDshuFrame(frame);
    expect(decoded.seq).toBe(seq);
    expect(decoded.bundle).toEqual(bundle);
  });

  it("rejects seq mismatch between DSHU header and bundle nonce", () => {
    const bundle = makeBundle(5n, 24);
    expect(() => encodeDshuFrame(6n, bundle)).toThrow(/mismatch/i);

    const frame = encodeDshuFrame(5n, bundle);
    // Corrupt header seq
    frame[11] = 6;
    expect(() => decodeDshuFrame(frame)).toThrow(/mismatch/i);
  });

  it("rejects short or wrong-magic frames", () => {
    expect(() => decodeDshuFrame(new Uint8Array(10))).toThrow(/short/i);
    const frame = encodeDshuFrame(1n, makeBundle(1n));
    frame[0] = 0x00;
    expect(() => decodeDshuFrame(frame)).toThrow(/magic/i);
  });
});

describe("RTCH chunking and reassembly", () => {
  it("passes payloads <= 8192B raw without RTCH header", () => {
    const chunker = new RtcChunker();
    const reassembler = new RtcChunkReassembler();

    const exactBoundary = new Uint8Array(RTC_CHUNK_PAYLOAD_BYTES);
    exactBoundary.set(DSHU_MAGIC, 0);
    const frames = chunker.chunk(exactBoundary);

    expect(frames).toHaveLength(1);
    expect(frames[0]).toBe(exactBoundary);
    expect(isRtchChunk(frames[0])).toBe(false);
    expect(reassembler.push(frames[0])).toEqual(exactBoundary);
  });

  it("chunks 8193B into 2 chunks and reassembles byte-for-byte", () => {
    const chunker = new RtcChunker();
    const reassembler = new RtcChunkReassembler();

    const payload = new Uint8Array(RTC_CHUNK_PAYLOAD_BYTES + 1);
    for (let i = 0; i < payload.byteLength; i += 1) {
      payload[i] = i & 0xff;
    }

    const chunks = chunker.chunk(payload);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].byteLength).toBe(RTCH_HEADER_BYTES + RTC_CHUNK_PAYLOAD_BYTES);
    expect(chunks[1].byteLength).toBe(RTCH_HEADER_BYTES + 1);
    expect(chunks[0].slice(0, 4)).toEqual(RTCH_MAGIC);
    expect(isRtchChunk(chunks[0])).toBe(true);

    expect(reassembler.push(chunks[0])).toBeNull();
    expect(reassembler.inFlightCount).toBe(1);
    const reassembled = reassembler.push(chunks[1]);
    expect(reassembled).toEqual(payload);
    expect(reassembler.inFlightCount).toBe(0);
  });

  it("round-trips >64 KiB and exact 4 MiB messages and rejects >4 MiB", () => {
    const chunker = new RtcChunker();
    const reassembler = new RtcChunkReassembler();

    const large = new Uint8Array(70 * 1024);
    for (let i = 0; i < large.byteLength; i += 1) large[i] = (i * 13) & 0xff;
    const chunks = chunker.chunk(large);
    expect(chunks.length).toBe(Math.ceil(large.byteLength / RTC_CHUNK_PAYLOAD_BYTES));
    let out: Uint8Array | null = null;
    for (const chunk of chunks) {
      out = reassembler.push(chunk);
    }
    expect(out).toEqual(large);

    const maxSize = new Uint8Array(RTC_CHUNK_MAX_MESSAGE_BYTES);
    maxSize[0] = 0x44;
    maxSize[maxSize.byteLength - 1] = 0x99;
    const maxChunks = chunker.chunk(maxSize);
    expect(maxChunks.length).toBe(512);
    let maxOut: Uint8Array | null = null;
    for (const chunk of maxChunks) {
      maxOut = reassembler.push(chunk);
    }
    expect(maxOut?.byteLength).toBe(RTC_CHUNK_MAX_MESSAGE_BYTES);
    expect(maxOut?.[maxSize.byteLength - 1]).toBe(0x99);

    expect(() => chunker.chunk(new Uint8Array(RTC_CHUNK_MAX_MESSAGE_BYTES + 1))).toThrow(/max size/i);
  });

  it("rejects out-of-order, duplicate, undersized non-final, and excess in-flight chunks", () => {
    const chunker = new RtcChunker();
    const payload = new Uint8Array(RTC_CHUNK_PAYLOAD_BYTES * 3 + 10);
    const chunks = chunker.chunk(payload);

    // Out-of-order first chunk (index 1 before index 0)
    const r1 = new RtcChunkReassembler();
    expect(() => r1.push(chunks[1])).toThrow(/out-of-order/i);

    // Duplicate chunk
    const r2 = new RtcChunkReassembler();
    expect(r2.push(chunks[0])).toBeNull();
    expect(() => r2.push(chunks[0])).toThrow(/sequence error/i);

    // Undersized non-final chunk
    const r3 = new RtcChunkReassembler();
    const shortChunk = chunks[0].slice(0, RTCH_HEADER_BYTES + 100);
    expect(() => r3.push(shortChunk)).toThrow(/non-final chunk/i);

    // Max in-flight limit (8)
    const r4 = new RtcChunkReassembler();
    for (let i = 0; i < RTC_CHUNK_MAX_IN_FLIGHT_MESSAGES; i += 1) {
      const c = chunker.chunk(new Uint8Array(RTC_CHUNK_PAYLOAD_BYTES + 10));
      expect(r4.push(c[0])).toBeNull();
    }
    const ninth = chunker.chunk(new Uint8Array(RTC_CHUNK_PAYLOAD_BYTES + 10));
    expect(() => r4.push(ninth[0])).toThrow(/max in-flight/i);
  });

  it("rejects expired assemblies after 30s", () => {
    let now = 1000;
    const chunker = new RtcChunker();
    const reassembler = new RtcChunkReassembler({ now: () => now });
    const chunks = chunker.chunk(new Uint8Array(RTC_CHUNK_PAYLOAD_BYTES + 5));

    expect(reassembler.push(chunks[0])).toBeNull();
    now += RTC_CHUNK_MAX_ASSEMBLY_AGE_MS + 1;
    expect(() => reassembler.push(chunks[1])).toThrow(/expired/i);
  });
});

describe("SequencedCiphertextReorderBuffer", () => {
  it("delivers in-order and buffers out-of-order frames until gap fills", () => {
    const buf = new SequencedCiphertextReorderBuffer({ initialExpectedSeq: 10n });

    expect(buf.push(10n, new Uint8Array([10]))).toEqual([
      { seq: 10n, payload: new Uint8Array([10]) },
    ]);
    expect(buf.push(12n, new Uint8Array([12]))).toEqual([]);
    expect(buf.push(13n, new Uint8Array([13]))).toEqual([]);
    expect(buf.bufferedCount).toBe(2);

    const drained = buf.push(11n, new Uint8Array([11]));
    expect(drained.map((f) => f.seq)).toEqual([11n, 12n, 13n]);
    expect(buf.bufferedCount).toBe(0);
    expect(buf.expectedSeq).toBe(14n);
  });

  it("rejects duplicate and stale/replayed seq numbers", () => {
    const buf = new SequencedCiphertextReorderBuffer({ initialExpectedSeq: 5n });
    expect(() => buf.push(4n, new Uint8Array([1]))).toThrow(/replay|stale/i);
    expect(buf.push(5n, new Uint8Array([1]))).toHaveLength(1);
    expect(() => buf.push(5n, new Uint8Array([1]))).toThrow(/replay|stale/i);
    expect(buf.push(7n, new Uint8Array([2]))).toEqual([]);
    expect(() => buf.push(7n, new Uint8Array([2]))).toThrow(/duplicate/i);
  });

  it("enforces max frame count (256) and max byte cap (4 MiB)", () => {
    const frameBuf = new SequencedCiphertextReorderBuffer({ initialExpectedSeq: 0n });
    for (let i = 1; i <= REORDER_MAX_BUFFERED_FRAMES; i += 1) {
      expect(frameBuf.push(BigInt(i), new Uint8Array([1]))).toEqual([]);
    }
    expect(() =>
      frameBuf.push(BigInt(REORDER_MAX_BUFFERED_FRAMES + 1), new Uint8Array([1])),
    ).toThrow(/max buffered frames/i);

    const byteBuf = new SequencedCiphertextReorderBuffer({ initialExpectedSeq: 0n });
    const halfMax = new Uint8Array(REORDER_MAX_BUFFERED_BYTES / 2);
    expect(byteBuf.push(1n, halfMax)).toEqual([]);
    expect(byteBuf.push(2n, halfMax)).toEqual([]);
    expect(() => byteBuf.push(3n, new Uint8Array([1]))).toThrow(/max buffered bytes/i);
  });

  it("triggers gap timeout after 5s", () => {
    vi.useFakeTimers();
    try {
      const onGapTimeout = vi.fn();
      const buf = new SequencedCiphertextReorderBuffer({
        initialExpectedSeq: 1n,
        onGapTimeout,
      });
      expect(buf.push(2n, new Uint8Array([2]))).toEqual([]);
      vi.advanceTimersByTime(REORDER_GAP_TIMEOUT_MS + 10);
      expect(onGapTimeout).toHaveBeenCalledTimes(1);
      expect(buf.bufferedCount).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
