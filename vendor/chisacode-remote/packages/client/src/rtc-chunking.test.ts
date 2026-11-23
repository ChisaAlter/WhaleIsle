import { describe, expect, test, vi } from "vitest";
import {
  DEFAULT_STUN_ICE_SERVERS,
  DSHU_HEADER_BYTES,
  RTC_CHUNK_HEADER_BYTES,
  RTC_CHUNK_MAX_IN_FLIGHT,
  RTC_CHUNK_MAX_MESSAGE_BYTES,
  RTC_CHUNK_PAYLOAD_BYTES,
  RtcChunkReassembler,
  SequencedCiphertextReorderBuffer,
  SerialSend,
  chunkRtcPayload,
  createRtcMessageIdGenerator,
  isDshuFrame,
  isRtchFrame,
  mergeIceServers,
  orderIceServers,
  parseConnectionOfferV2FromUrl,
  unwrapDshuFrame,
  wrapDshuFrame,
} from "./rtc-chunking.js";

function makeFakeBundle(seq: bigint, ciphertextLen = 32): Uint8Array {
  const bundle = new Uint8Array(24 + ciphertextLen);
  for (let i = 0; i < 16; i += 1) {
    bundle[i] = (i + 1) & 0xff;
  }
  let v = seq;
  for (let i = 0; i < 8; i += 1) {
    bundle[16 + i] = Number(v & 0xffn);
    v >>= 8n;
  }
  for (let i = 0; i < ciphertextLen; i += 1) {
    bundle[24 + i] = (i * 7 + Number(seq & 0xffn)) & 0xff;
  }
  return bundle;
}

function encodeOfferUrl(payload: unknown): string {
  const b64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `http://192.168.1.10:3180/#offer=${b64}`;
}

describe("DSHU framing", () => {
  test("wraps and unwraps byte-exact DSHU header with 64-bit big-endian seq", () => {
    const seq = 0x00000001_0000002an;
    const bundle = makeFakeBundle(seq, 48);
    const frame = wrapDshuFrame(seq, bundle);

    expect(frame.byteLength).toBe(DSHU_HEADER_BYTES + bundle.byteLength);
    expect(isDshuFrame(frame)).toBe(true);
    expect(isRtchFrame(frame)).toBe(false);
    expect(Array.from(frame.subarray(0, 4))).toEqual([0x44, 0x53, 0x48, 0x55]);
    expect(Array.from(frame.subarray(4, 12))).toEqual([0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x2a]);

    const unwrapped = unwrapDshuFrame(frame);
    expect(unwrapped.seq).toBe(seq);
    expect(Array.from(unwrapped.bundle)).toEqual(Array.from(bundle));
  });

  test("rejects mismatched header seq vs bundle LE seq", () => {
    const bundle = makeFakeBundle(5n);
    expect(() => wrapDshuFrame(6n, bundle)).toThrow(/mismatch/i);

    const frame = wrapDshuFrame(5n, bundle);
    frame[11] = 6; // tamper header seq
    expect(() => unwrapDshuFrame(frame)).toThrow(/mismatch/i);
  });

  test("rejects truncated or non-DSHU frames", () => {
    expect(() => unwrapDshuFrame(new Uint8Array(10))).toThrow(/too short/i);
    const bad = new Uint8Array(64);
    bad.set([0x52, 0x54, 0x43, 0x48], 0);
    expect(() => unwrapDshuFrame(bad)).toThrow(/magic/i);
  });
});

describe("RTCH chunking & reassembly", () => {
  test("sends payloads <= 8192B raw without RTCH header", () => {
    const nextId = createRtcMessageIdGenerator();
    const reassembler = new RtcChunkReassembler();

    const exact = wrapDshuFrame(1n, makeFakeBundle(1n, RTC_CHUNK_PAYLOAD_BYTES - DSHU_HEADER_BYTES - 24));
    expect(exact.byteLength).toBe(RTC_CHUNK_PAYLOAD_BYTES);

    const chunks = chunkRtcPayload(exact, nextId);
    expect(chunks).toHaveLength(1);
    expect(isRtchFrame(chunks[0])).toBe(false);
    expect(Array.from(reassembler.push(chunks[0])!)).toEqual(Array.from(exact));
  });

  test("splits > 8192B and > 64 KiB payloads into RTCH chunks and reassembles byte-exact", () => {
    const nextId = createRtcMessageIdGenerator();
    const reassembler = new RtcChunkReassembler();

    const payload = new Uint8Array(70_000);
    for (let i = 0; i < payload.length; i += 1) {
      payload[i] = (i * 13 + 7) & 0xff;
    }

    const chunks = chunkRtcPayload(payload, nextId);
    const expectedTotal = Math.ceil(70_000 / RTC_CHUNK_PAYLOAD_BYTES);
    expect(chunks).toHaveLength(expectedTotal);

    let result: Uint8Array | null = null;
    for (let i = 0; i < chunks.length; i += 1) {
      const chunk = chunks[i];
      expect(isRtchFrame(chunk)).toBe(true);
      const view = new DataView(chunk.buffer, chunk.byteOffset, RTC_CHUNK_HEADER_BYTES);
      expect(view.getUint32(4, false)).toBe(1);
      expect(view.getUint16(8, false)).toBe(i);
      expect(view.getUint16(10, false)).toBe(expectedTotal);
      if (i < chunks.length - 1) {
        expect(chunk.byteLength).toBe(RTC_CHUNK_HEADER_BYTES + RTC_CHUNK_PAYLOAD_BYTES);
      } else {
        expect(chunk.byteLength).toBe(
          RTC_CHUNK_HEADER_BYTES + (70_000 % RTC_CHUNK_PAYLOAD_BYTES),
        );
      }
      result = reassembler.push(chunk);
      if (i < chunks.length - 1) {
        expect(result).toBeNull();
      }
    }

    expect(result).not.toBeNull();
    expect(Array.from(result!)).toEqual(Array.from(payload));
    expect(reassembler.getInFlightCount()).toBe(0);
  });

  test("messageId generator cycles 0xFFFFFFFF -> 1 without zero", () => {
    const nextId = createRtcMessageIdGenerator(0xfffffffe);
    expect(nextId()).toBe(0xfffffffe);
    expect(nextId()).toBe(0xffffffff);
    expect(nextId()).toBe(1);
    expect(nextId()).toBe(2);
  });

  test("enforces max message size, ordering, duplicate, in-flight limit, and age expiry", () => {
    const nextId = createRtcMessageIdGenerator();
    expect(() => chunkRtcPayload(new Uint8Array(RTC_CHUNK_MAX_MESSAGE_BYTES + 1), nextId)).toThrow(
      /max message size/i,
    );

    const payload = new Uint8Array(RTC_CHUNK_PAYLOAD_BYTES + 10);
    const chunks = chunkRtcPayload(payload, nextId);

    // Out-of-order (index 1 before index 0)
    const r1 = new RtcChunkReassembler();
    expect(() => r1.push(chunks[1])).toThrow(/out-of-order/i);

    // Duplicate index 0
    const r2 = new RtcChunkReassembler();
    expect(r2.push(chunks[0])).toBeNull();
    expect(() => r2.push(chunks[0])).toThrow(/out-of-order|duplicate/i);

    // Non-final chunk smaller than 8192B
    const badNonFinal = chunks[0].slice(0, RTC_CHUNK_HEADER_BYTES + 100);
    const r3 = new RtcChunkReassembler();
    expect(() => r3.push(badNonFinal)).toThrow(/non-final chunk/i);

    // Max in-flight assemblies (8)
    let now = 1_000;
    const r4 = new RtcChunkReassembler({ now: () => now });
    for (let i = 0; i < RTC_CHUNK_MAX_IN_FLIGHT; i += 1) {
      const c = chunkRtcPayload(payload, nextId);
      expect(r4.push(c[0])).toBeNull();
    }
    const overflow = chunkRtcPayload(payload, nextId);
    expect(() => r4.push(overflow[0])).toThrow(/in-flight/i);

    // Age expiry (> 30s)
    const r5 = new RtcChunkReassembler({ now: () => now });
    const aging = chunkRtcPayload(payload, nextId);
    expect(r5.push(aging[0])).toBeNull();
    now += 31_000;
    expect(() => r5.push(aging[1])).toThrow(/expired/i);
  });
});

describe("SequencedCiphertextReorderBuffer", () => {
  test("buffers out-of-order frames and flushes contiguous runs in strict order", () => {
    const buf = new SequencedCiphertextReorderBuffer();
    const b0 = makeFakeBundle(0n);
    const b1 = makeFakeBundle(1n);
    const b2 = makeFakeBundle(2n);
    const b3 = makeFakeBundle(3n);

    expect(buf.push(0n, b0)).toEqual([b0]);
    expect(buf.push(2n, b2)).toEqual([]);
    expect(buf.push(3n, b3)).toEqual([]);
    expect(buf.getBufferedCount()).toBe(2);

    const flushed = buf.push(1n, b1);
    expect(flushed).toEqual([b1, b2, b3]);
    expect(buf.getBufferedCount()).toBe(0);
    expect(buf.getNextExpectedSeq()).toBe(4n);
    buf.dispose();
  });

  test("rejects replay/duplicate seq and enforces frame/byte limits", () => {
    const buf = new SequencedCiphertextReorderBuffer({ maxFrames: 2, maxBytes: 120 });
    expect(buf.push(0n, makeFakeBundle(0n, 16))).toHaveLength(1);
    expect(() => buf.push(0n, makeFakeBundle(0n, 16))).toThrow(/replay/i);

    expect(buf.push(2n, makeFakeBundle(2n, 20))).toEqual([]);
    expect(() => buf.push(2n, makeFakeBundle(2n, 20))).toThrow(/duplicate/i);
    expect(buf.push(3n, makeFakeBundle(3n, 20))).toEqual([]);
    expect(() => buf.push(4n, makeFakeBundle(4n, 20))).toThrow(/frame limit/i);

    const byteLimited = new SequencedCiphertextReorderBuffer({ maxFrames: 10, maxBytes: 80 });
    expect(byteLimited.push(1n, makeFakeBundle(1n, 20))).toEqual([]); // 44B
    expect(() => byteLimited.push(2n, makeFakeBundle(2n, 20))).toThrow(/byte limit/i);
    buf.dispose();
    byteLimited.dispose();
  });

  test("triggers onGapTimeout when gap is not filled within timeout", async () => {
    vi.useFakeTimers();
    try {
      const onGapTimeout = vi.fn();
      const buf = new SequencedCiphertextReorderBuffer({ gapTimeoutMs: 5_000, onGapTimeout });
      buf.push(1n, makeFakeBundle(1n));
      vi.advanceTimersByTime(4_999);
      expect(onGapTimeout).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(onGapTimeout).toHaveBeenCalledTimes(1);
      buf.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("SerialSend queue", () => {
  test("serializes tasks and enforces byte and frame limits", async () => {
    const queue = new SerialSend({ maxQueuedFrames: 2, maxQueuedBytes: 100 });
    const order: number[] = [];
    let releaseFirst!: () => void;
    const p1 = queue.enqueue(60, async () => {
      await new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      order.push(1);
    });
    const p2 = queue.enqueue(30, () => {
      order.push(2);
    });
    await expect(queue.enqueue(5, () => {})).rejects.toThrow(/frame limit/i);

    const queueBytes = new SerialSend({ maxQueuedFrames: 10, maxQueuedBytes: 100 });
    let releaseBytes!: () => void;
    const pb1 = queueBytes.enqueue(80, async () => {
      await new Promise<void>((resolve) => {
        releaseBytes = resolve;
      });
    });
    await expect(queueBytes.enqueue(30, () => {})).rejects.toThrow(/byte limit/i);

    releaseFirst();
    releaseBytes();
    await Promise.all([p1, p2, pb1]);
    expect(order).toEqual([1, 2]);
    expect(queue.getQueuedFrames()).toBe(0);
    expect(queue.getQueuedBytes()).toBe(0);
  });
});

describe("ICE server ordering & Offer v2 parsing", () => {
  test("orders ICE servers STUN < TURN TCP < TURNS TCP < TURN UDP < TURNS < TURN", () => {
    const ordered = orderIceServers([
      { urls: "turn:a.example:3478" },
      { urls: "turns:b.example:5349" },
      { urls: "turn:c.example:3478?transport=udp" },
      { urls: "turns:d.example:443?transport=tcp" },
      { urls: "turn:e.example:3478?transport=tcp" },
      { urls: "stun:stun.cloudflare.com:3478" },
      { urls: "stun:stun.cloudflare.com:3478" }, // duplicate
    ]);
    expect(ordered.map((s) => s.urls)).toEqual([
      "stun:stun.cloudflare.com:3478",
      "turn:e.example:3478?transport=tcp",
      "turns:d.example:443?transport=tcp",
      "turn:c.example:3478?transport=udp",
      "turns:b.example:5349",
      "turn:a.example:3478",
    ]);

    expect(mergeIceServers(undefined, undefined)).toEqual([...DEFAULT_STUN_ICE_SERVERS]);
  });

  test("parses Offer v2 with LAN-only, relay-only, and hybrid LAN+relay+iceServers", () => {
    const lanOnly = parseConnectionOfferV2FromUrl(
      encodeOfferUrl({
        v: 2,
        serverId: "srv_lan",
        daemonPublicKeyB64: "pk_lan",
        lan: { endpoints: ["192.168.1.10:3180"], useTls: false },
      }),
    );
    expect(lanOnly?.serverId).toBe("srv_lan");
    expect(lanOnly?.relay).toBeUndefined();
    expect(lanOnly?.lan?.endpoints).toEqual(["192.168.1.10:3180"]);

    const hybrid = parseConnectionOfferV2FromUrl(
      encodeOfferUrl({
        v: 2,
        serverId: "srv_hyb",
        daemonPublicKeyB64: "pk_hyb",
        relay: { endpoint: "ayase.cn:443", useTls: true },
        lan: { endpoints: ["192.168.1.10:3180"] },
        iceServers: [{ urls: "turn:turn.example:3478", username: "u", credential: "p" }],
      }),
    );
    expect(hybrid?.iceServers).toHaveLength(1);

    expect(() =>
      parseConnectionOfferV2FromUrl(
        encodeOfferUrl({
          v: 2,
          serverId: "srv_none",
          daemonPublicKeyB64: "pk_none",
        }),
      ),
    ).toThrow(/relay\.endpoint or non-empty lan\.endpoints/i);
  });
});
