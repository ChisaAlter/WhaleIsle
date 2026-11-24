import { describe, expect, it, vi } from "vitest";
import {
  createClientChannel,
  createDaemonChannel,
  exportPublicKey,
  generateKeyPair,
  type BinaryDataChannelTransport,
  type Transport,
} from "./e2ee.js";

interface PairedTransports {
  a: Transport & { closedWith: { code?: number; reason?: string } | null; sent: Array<string | ArrayBuffer> };
  b: Transport & { closedWith: { code?: number; reason?: string } | null; sent: Array<string | ArrayBuffer> };
  deliverAtoB: (payload: string | ArrayBuffer) => void;
  deliverBtoA: (payload: string | ArrayBuffer) => void;
  setHoldAtoB: (hold: boolean) => void;
  flushAtoB: () => void;
}

function createMockTransportPair(): PairedTransports {
  let holdAtoB = false;
  const heldAtoB: Array<string | ArrayBuffer> = [];

  const a: PairedTransports["a"] = {
    closedWith: null,
    sent: [],
    onmessage: null,
    onclose: null,
    onerror: null,
    send(data) {
      this.sent.push(data);
      if (holdAtoB) {
        heldAtoB.push(data);
      } else {
        b.onmessage?.(data);
      }
    },
    close(code, reason) {
      this.closedWith = { code, reason };
      this.onclose?.(code ?? 1000, reason ?? "");
      if (!b.closedWith) {
        b.closedWith = { code, reason };
        b.onclose?.(code ?? 1000, reason ?? "");
      }
    },
  };

  const b: PairedTransports["b"] = {
    closedWith: null,
    sent: [],
    onmessage: null,
    onclose: null,
    onerror: null,
    send(data) {
      this.sent.push(data);
      a.onmessage?.(data);
    },
    close(code, reason) {
      this.closedWith = { code, reason };
      this.onclose?.(code ?? 1000, reason ?? "");
      if (!a.closedWith) {
        a.closedWith = { code, reason };
        a.onclose?.(code ?? 1000, reason ?? "");
      }
    },
  };

  return {
    a,
    b,
    deliverAtoB: (payload) => b.onmessage?.(payload),
    deliverBtoA: (payload) => a.onmessage?.(payload),
    setHoldAtoB: (hold) => {
      holdAtoB = hold;
    },
    flushAtoB: () => {
      holdAtoB = false;
      while (heldAtoB.length > 0) {
        const next = heldAtoB.shift()!;
        b.onmessage?.(next);
      }
    },
  };
}

function createMockDcPair() {
  const dcA: BinaryDataChannelTransport & { sent: Uint8Array[]; closedWith: { code?: number; reason?: string } | null } = {
    sent: [],
    closedWith: null,
    onmessage: null,
    onclose: null,
    onerror: null,
    send(data) {
      const copy = new Uint8Array(data);
      this.sent.push(copy);
      dcB.onmessage?.(copy);
    },
    close(code, reason) {
      this.closedWith = { code, reason };
      this.onclose?.(code ?? 1000, reason ?? "");
      if (!dcB.closedWith) {
        dcB.closedWith = { code, reason };
        dcB.onclose?.(code ?? 1000, reason ?? "");
      }
    },
  };

  const dcB: BinaryDataChannelTransport & { sent: Uint8Array[]; closedWith: { code?: number; reason?: string } | null } = {
    sent: [],
    closedWith: null,
    onmessage: null,
    onclose: null,
    onerror: null,
    send(data) {
      const copy = new Uint8Array(data);
      this.sent.push(copy);
      dcA.onmessage?.(copy);
    },
    close(code, reason) {
      this.closedWith = { code, reason };
      this.onclose?.(code ?? 1000, reason ?? "");
      if (!dcA.closedWith) {
        dcA.closedWith = { code, reason };
        dcA.onclose?.(code ?? 1000, reason ?? "");
      }
    },
  };

  return { dcA, dcB };
}

async function createPairedChannels() {
  const daemonKeyPair = generateKeyPair();
  const wsPair = createMockTransportPair();
  const clientReceived: Array<string | ArrayBuffer> = [];
  const daemonReceived: Array<string | ArrayBuffer> = [];
  const clientClosed = vi.fn();
  const daemonClosed = vi.fn();

  const daemonPromise = createDaemonChannel(wsPair.b, daemonKeyPair, {
    onmessage: (data) => daemonReceived.push(data),
    onclose: daemonClosed,
  });
  const clientChannel = await createClientChannel(
    wsPair.a,
    exportPublicKey(daemonKeyPair.publicKey),
    {
      onmessage: (data) => clientReceived.push(data),
      onclose: clientClosed,
    },
  );
  const daemonChannel = await daemonPromise;
  return {
    wsPair,
    clientChannel,
    daemonChannel,
    clientReceived,
    daemonReceived,
    clientClosed,
    daemonClosed,
  };
}

describe("EncryptedChannel WebRTC hot-cutover", () => {
  it("performs zero-drop hot-cutover with out-of-order cross-leg delivery, drains Relay WS cleanly, and chunks >64 KiB payloads", async () => {
    const {
      wsPair,
      clientChannel,
      daemonChannel,
      clientReceived,
      daemonReceived,
      clientClosed,
      daemonClosed,
    } = await createPairedChannels();
    const { dcA, dcB } = createMockDcPair();

    // Baseline traffic over primary Relay WS
    await clientChannel.send("before-1");
    await daemonChannel.send("host-before-1");
    expect(daemonReceived).toEqual(["before-1"]);
    expect(clientReceived).toEqual(["host-before-1"]);

    // Host attaches early WebRTC receive leg when DC opens
    daemonChannel.attachWebRtcReceiveLeg(dcB);

    // Simulate slow Relay WS: hold Client->Host WS frames so DataChannel overtakes them!
    wsPair.setHoldAtoB(true);
    expect(clientChannel.peekNextSendSeq()).toBe(1n);

    // Client sends activate as final frame on Relay WS (seq 1) and cuts outbound to DC
    const { finalPrimaryLegSeq: clientEndSeq } = clientChannel.activateWebRtcLeg({
      dcTransport: dcA,
      buildFinalPrimaryLegMessage: (seq) =>
        JSON.stringify({ type: "rtc_upgrade_activate", attemptId: "att-1", clientPreviousLegEndSeq: Number(seq) }),
    });
    expect(clientEndSeq).toBe(1n);

    // Client immediately sends seq 2 and seq 3 over DataChannel BEFORE seq 1 arrives on Relay WS!
    await clientChannel.send("over-dc-seq-2");
    await clientChannel.send("over-dc-seq-3");

    // Daemon must have buffered seq 2 and seq 3 without delivering out-of-order or failing replay
    expect(daemonReceived).toEqual(["before-1"]);
    expect(daemonClosed).not.toHaveBeenCalled();

    // Now the delayed Relay WS frame (seq 1) arrives at Host -> all 3 deliver in exact order 1, 2, 3!
    wsPair.flushAtoB();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(daemonReceived).toEqual([
      "before-1",
      JSON.stringify({ type: "rtc_upgrade_activate", attemptId: "att-1", clientPreviousLegEndSeq: 1 }),
      "over-dc-seq-2",
      "over-dc-seq-3",
    ]);

    // Host now activates WebRTC leg, sending rtc_upgrade_activated as final WS frame and draining Relay WS
    const { finalPrimaryLegSeq: hostEndSeq } = daemonChannel.activateWebRtcLeg({
      dcTransport: dcB,
      peerPreviousLegEndSeq: 1n,
      buildFinalPrimaryLegMessage: (seq) =>
        JSON.stringify({ type: "rtc_upgrade_activated", attemptId: "att-1", mode: "p2p", hostPreviousLegEndSeq: Number(seq) }),
    });
    expect(hostEndSeq).toBe(1n);

    // Host already received seq >= 1, so Host's primary WS was drained & closed with (1000, "upgraded_to_webrtc")
    expect(wsPair.b.closedWith).toEqual({ code: 1000, reason: "upgraded_to_webrtc" });

    // Client starts primary leg drain upon receiving rtc_upgrade_activated
    clientChannel.beginPrimaryLegDrain(hostEndSeq!);
    expect(wsPair.a.closedWith).toEqual({ code: 1000, reason: "upgraded_to_webrtc" });

    // Neither channel emitted upper-layer disconnect when Relay WS closed!
    expect(clientClosed).not.toHaveBeenCalled();
    expect(daemonClosed).not.toHaveBeenCalled();
    expect(clientChannel.isOpen()).toBe(true);
    expect(daemonChannel.isOpen()).toBe(true);

    // Now exchange a large >64 KiB payload purely over WebRTC DataChannel (RTCH-chunked)
    const bigPayload = "X".repeat(70 * 1024);
    const wsSentBefore = wsPair.a.sent.length;
    const dcSentBefore = dcA.sent.length;
    await clientChannel.send(bigPayload);
    expect(wsPair.a.sent.length).toBe(wsSentBefore); // Zero bytes sent over Relay WS!
    expect(dcA.sent.length - dcSentBefore).toBeGreaterThan(8); // Chunked into >8 RTCH frames
    expect(daemonReceived[daemonReceived.length - 1]).toBe(bigPayload);

    const bigReply = "Y".repeat(68 * 1024);
    await daemonChannel.send(bigReply);
    expect(clientReceived[clientReceived.length - 1]).toBe(bigReply);

    // Closing the DataChannel NOW triggers upper-layer disconnect
    dcA.close(1000, "peer closed");
    expect(clientClosed).toHaveBeenCalledTimes(1);
    expect(daemonClosed).toHaveBeenCalledTimes(1);
  });

  it("closes drained Relay WS via 3s fallback timer when peer leg end seq never arrives", async () => {
    vi.useFakeTimers();
    try {
      const { wsPair, clientChannel, clientClosed } = await createPairedChannels();
      const { dcA } = createMockDcPair();

      clientChannel.activateWebRtcLeg({
        dcTransport: dcA,
        peerPreviousLegEndSeq: 99n,
        drainTimeoutMs: 3000,
      });

      expect(wsPair.a.closedWith).toBeNull();
      vi.advanceTimersByTime(3001);
      expect(wsPair.a.closedWith).toEqual({ code: 1000, reason: "upgraded_to_webrtc" });
      expect(clientClosed).not.toHaveBeenCalled();
      expect(clientChannel.isOpen()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects replayed DataChannel frames fatally", async () => {
    const { clientChannel, daemonChannel, daemonClosed } = await createPairedChannels();
    const { dcA, dcB } = createMockDcPair();

    clientChannel.activateWebRtcLeg({ dcTransport: dcA });
    daemonChannel.activateWebRtcLeg({ dcTransport: dcB });

    await clientChannel.send("msg-1");
    const firstWireFrame = dcA.sent[0];
    expect(firstWireFrame).toBeDefined();

    // Replay the exact same DSHU frame on DataChannel -> fatal replay violation!
    dcB.onmessage?.(firstWireFrame);
    expect(daemonClosed).toHaveBeenCalledWith(1011, "E2EE replay protection violation");
  });

  it("falls back to primary Relay WS when DataChannel closes before primary leg drain completes", async () => {
    const {
      wsPair,
      clientChannel,
      daemonChannel,
      clientReceived,
      daemonReceived,
      clientClosed,
      daemonClosed,
    } = await createPairedChannels();
    const { dcA, dcB } = createMockDcPair();

    const daemonFallbacks: string[] = [];
    daemonChannel.onWebRtcFallback((reason) => daemonFallbacks.push(reason));

    // Daemon activated WebRTC leg while still draining primary Relay WS (seq 5n not yet seen)
    daemonChannel.activateWebRtcLeg({
      dcTransport: dcB,
      peerPreviousLegEndSeq: 5n,
      drainTimeoutMs: 3000,
    });
    expect(daemonChannel.isWebRtcActive()).toBe(true);
    expect(daemonChannel.isPrimaryLegDrained()).toBe(false);

    // Client aborts and closes DataChannel before drain completes
    dcA.close(1000, "aborted");

    // Daemon channel must NOT emit close or close Relay WS — it reverts to primary Relay WS!
    expect(daemonClosed).not.toHaveBeenCalled();
    expect(clientClosed).not.toHaveBeenCalled();
    expect(wsPair.b.closedWith).toBeNull();
    expect(daemonChannel.isWebRtcActive()).toBe(false);
    expect(daemonFallbacks).toEqual(["dc_closed_before_drain"]);

    // Bidirectional encrypted traffic continues cleanly over Relay WS
    await daemonChannel.send("after-fallback-from-daemon");
    await clientChannel.send("after-fallback-from-client");
    expect(clientReceived).toEqual(["after-fallback-from-daemon"]);
    expect(daemonReceived).toEqual(["after-fallback-from-client"]);
  });
});
