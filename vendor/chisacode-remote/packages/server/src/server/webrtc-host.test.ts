import { EventEmitter } from "node:events";
import pino from "pino";
import { describe, expect, it, vi } from "vitest";

const createdPeerConnections: FakePeerConnection[] = [];

class FakeDataChannel {
  readonly label: string;
  readyState: "open" | "closed" = "open";
  stateChanged = {
    subscribe: (_cb: (state: string) => void) => ({ unSubscribe: () => {} }),
  };
  onMessage = {
    subscribe: (_cb: (raw: Buffer) => void) => ({ unSubscribe: () => {} }),
  };
  error = {
    subscribe: (_cb: (err: unknown) => void) => ({ unSubscribe: () => {} }),
  };
  closed = false;

  constructor(label: string) {
    this.label = label;
  }

  send(_data: Buffer): void {}

  close(): void {
    this.closed = true;
    this.readyState = "closed";
  }
}

class FakePeerConnection {
  closed = false;
  localDescription: { sdp: string; type: string } | null = null;
  private readonly dcListeners: Array<(dc: FakeDataChannel) => void> = [];
  onDataChannel = {
    subscribe: (cb: (dc: FakeDataChannel) => void) => {
      this.dcListeners.push(cb);
      return { unSubscribe: () => {} };
    },
  };
  onIceCandidate = {
    subscribe: (_cb: (cand: unknown) => void) => ({ unSubscribe: () => {} }),
  };
  iceConnectionStateChange = {
    subscribe: () => ({ unSubscribe: () => {} }),
  };
  ice = {
    connectionState: "connected",
    nominated: null,
  };

  constructor(_opts: unknown) {
    createdPeerConnections.push(this);
  }

  emitDataChannel(dc: FakeDataChannel): void {
    for (const cb of this.dcListeners) cb(dc);
  }

  async setRemoteDescription(_desc: unknown): Promise<void> {}

  async createAnswer(): Promise<{ sdp: string; type: string }> {
    return { sdp: "v=0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n", type: "answer" };
  }

  async setLocalDescription(desc: { sdp: string; type: string }): Promise<void> {
    this.localDescription = desc;
  }

  async addIceCandidate(_cand: unknown): Promise<void> {}

  async getStats(): Promise<Map<string, unknown>> {
    return new Map<string, unknown>([
      ["t1", { id: "t1", type: "transport", selectedCandidatePairId: "cp1" }],
      ["lc1", { id: "lc1", type: "local-candidate", candidateType: "host", address: "192.168.1.10" }],
      ["rc1", { id: "rc1", type: "remote-candidate", candidateType: "host", address: "192.168.1.20" }],
      ["cp1", { id: "cp1", type: "candidate-pair", state: "succeeded", nominated: true, localCandidateId: "lc1", remoteCandidateId: "rc1" }],
    ]);
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

vi.mock("werift", () => ({
  RTCPeerConnection: FakePeerConnection,
  RTCSessionDescription: class {
    constructor(
      public readonly sdp: string,
      public readonly type: string,
    ) {}
  },
  RTCIceCandidate: class {
    constructor(public readonly init: unknown) {}
  },
}));

const { WebRtcHostSessionController } = await import("./webrtc-host.js");

function createFakeChannel() {
  let webRtcActive = false;
  let primaryLegDrained = false;
  let dcTransport: {
    onmessage: ((data: ArrayBuffer | Uint8Array) => void) | null;
    onclose: ((code: number, reason: string) => void) | null;
    onerror: ((err: Error) => void) | null;
    close: (code?: number, reason?: string) => void;
  } | null = null;
  const fallbackListeners: Array<(reason: string) => void> = [];
  const sent: string[] = [];
  const closedEvents: Array<{ code: number; reason: string }> = [];

  const channel = {
    sent,
    closedEvents,
    isOpen: () => true,
    isWebRtcActive: () => webRtcActive,
    isPrimaryLegDrained: () => primaryLegDrained,
    async send(data: string | ArrayBuffer) {
      sent.push(String(data));
    },
    attachWebRtcReceiveLeg(dc: NonNullable<typeof dcTransport>) {
      dcTransport = dc;
      dc.onclose = (code, reason) => {
        if (webRtcActive) {
          if (!primaryLegDrained) {
            channel.fallbackToPrimaryLeg("dc_closed_before_drain");
            return;
          }
          closedEvents.push({ code, reason });
        } else {
          dcTransport = null;
        }
      };
    },
    detachWebRtcReceiveLeg(dc?: NonNullable<typeof dcTransport>) {
      if (webRtcActive) return;
      if (dc && dcTransport !== dc) return;
      if (dcTransport) {
        dcTransport.onmessage = null;
        dcTransport.onclose = null;
        dcTransport.onerror = null;
        dcTransport = null;
      }
    },
    activateWebRtcLeg(params: {
      dcTransport: NonNullable<typeof dcTransport>;
      peerPreviousLegEndSeq?: bigint;
      buildFinalPrimaryLegMessage?: (seq: bigint) => string;
    }) {
      if (params.buildFinalPrimaryLegMessage) {
        sent.push(params.buildFinalPrimaryLegMessage(1n));
      }
      channel.attachWebRtcReceiveLeg(params.dcTransport);
      webRtcActive = true;
      // Leave primaryLegDrained = false to exercise pre-drain abort/close window
    },
    fallbackToPrimaryLeg(reason = "webrtc_fallback") {
      if (primaryLegDrained || !webRtcActive) return false;
      webRtcActive = false;
      channel.detachWebRtcReceiveLeg();
      for (const cb of [...fallbackListeners]) cb(reason);
      return true;
    },
    onWebRtcFallback(cb: (reason: string) => void) {
      fallbackListeners.push(cb);
      return () => {
        const idx = fallbackListeners.indexOf(cb);
        if (idx >= 0) fallbackListeners.splice(idx, 1);
      };
    },
    setDrained(value: boolean) {
      primaryLegDrained = value;
    },
    triggerDcClose(code = 1000, reason = "client_closed") {
      dcTransport?.onclose?.(code, reason);
    },
  };
  return channel;
}

const VALID_OFFER_SDP = "v=0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n";

describe("WebRtcHostSessionController race hardening", () => {
  it("supersedes earlier pending handleOffer via offerGeneration while detectHostCandidates is awaiting", async () => {
    createdPeerConnections.length = 0;
    const channel = createFakeChannel();
    const resolvers: Array<() => void> = [];
    const controller = new WebRtcHostSessionController({
      channel: channel as never,
      logger: pino({ level: "silent" }),
      detectHostCandidates: () =>
        new Promise((resolve) => {
          resolvers.push(() =>
            resolve({ ipv4: ["127.0.0.1"], ipv6: [], blockedHostIps: new Set() }),
          );
        }),
    });
    controller.markAuthenticated();

    controller.handleSignalingMessage({
      type: "rtc_upgrade_offer",
      attemptId: "offer-1",
      sdp: VALID_OFFER_SDP,
    });
    controller.handleSignalingMessage({
      type: "rtc_upgrade_offer",
      attemptId: "offer-2",
      sdp: VALID_OFFER_SDP,
    });

    expect(resolvers.length).toBe(2);
    // Resolve offer-1 first -> superseded by offer-2, must NOT construct an RTCPeerConnection
    resolvers[0]();
    await new Promise((r) => setTimeout(r, 10));
    expect(createdPeerConnections.length).toBe(0);

    // Resolve offer-2 -> constructs exactly one RTCPeerConnection and sends answer for offer-2
    resolvers[1]();
    await new Promise((r) => setTimeout(r, 10));
    expect(createdPeerConnections.length).toBe(1);
    const answers = channel.sent.map((s) => JSON.parse(s)).filter((m) => m.type === "rtc_upgrade_answer");
    expect(answers.map((a) => a.attemptId)).toEqual(["offer-2"]);

    controller.dispose();
  });

  it("retains activated attempt until drain completes and falls back to Relay WS on abort or dc close", async () => {
    createdPeerConnections.length = 0;
    const channel = createFakeChannel();
    const modes: string[] = [];
    const controller = new WebRtcHostSessionController({
      channel: channel as never,
      logger: pino({ level: "silent" }),
      onTransportModeChange: (mode) => modes.push(mode),
      detectHostCandidates: async () => ({
        ipv4: ["127.0.0.1"],
        ipv6: [],
        blockedHostIps: new Set(),
      }),
    });
    controller.markAuthenticated();

    controller.handleSignalingMessage({
      type: "rtc_upgrade_offer",
      attemptId: "att-race-1",
      sdp: VALID_OFFER_SDP,
    });
    await new Promise((r) => setTimeout(r, 20));
    const pc1 = createdPeerConnections[0];
    expect(pc1).toBeDefined();
    const dc1 = new FakeDataChannel("dsh");
    pc1.emitDataChannel(dc1);

    controller.handleSignalingMessage({
      type: "rtc_upgrade_activate",
      attemptId: "att-race-1",
      clientPreviousLegEndSeq: 1,
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(channel.isWebRtcActive()).toBe(true);
    expect(modes).toEqual(["lan"]);

    // Client sends rtc_upgrade_abort before Relay WS drain completes
    controller.handleSignalingMessage({
      type: "rtc_upgrade_abort",
      attemptId: "att-race-1",
      reason: "activate_timeout",
    });
    expect(channel.isWebRtcActive()).toBe(false);
    expect(channel.closedEvents).toEqual([]);
    expect(pc1.closed).toBe(true);
    expect(dc1.closed).toBe(true);
    expect(modes).toEqual(["lan", "relay"]);

    // Second attempt: dcTransport.onclose fires before Relay WS drain completes
    controller.handleSignalingMessage({
      type: "rtc_upgrade_offer",
      attemptId: "att-race-2",
      sdp: VALID_OFFER_SDP,
    });
    await new Promise((r) => setTimeout(r, 20));
    const pc2 = createdPeerConnections[1];
    const dc2 = new FakeDataChannel("dsh");
    pc2.emitDataChannel(dc2);

    controller.handleSignalingMessage({
      type: "rtc_upgrade_activate",
      attemptId: "att-race-2",
      clientPreviousLegEndSeq: 2,
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(channel.isWebRtcActive()).toBe(true);

    channel.triggerDcClose(1000, "client_aborted");
    expect(channel.isWebRtcActive()).toBe(false);
    expect(channel.closedEvents).toEqual([]);
    expect(pc2.closed).toBe(true);
    expect(modes).toEqual(["lan", "relay", "lan", "relay"]);

    controller.dispose();
  });
});

// Keep EventEmitter import intentionally unused check satisfied if needed
void EventEmitter;
