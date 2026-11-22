import { describe, expect, test, vi } from "vitest";
import {
  SALT_LENGTH,
  decrypt,
  deriveSharedKey,
  encrypt,
  exportPublicKey,
  generateKeyPair,
  importPublicKey,
  type KeyPair,
  type SharedKey,
} from "@chisacode/relay/e2ee";
import { DaemonClient } from "./daemon-client.js";
import {
  createAdaptiveTransport,
} from "./daemon-client-adaptive-transport.js";
import type {
  DaemonTransport,
  DaemonTransportFactory,
  IceServerConfig,
  RtcDataChannelLike,
  RtcIceCandidateInitLike,
  RtcPeerConnectionLike,
  TransportMode,
} from "./daemon-client-transport-types.js";
import {
  RtcChunkReassembler,
  chunkRtcPayload,
  createRtcMessageIdGenerator,
  isRtchFrame,
  unwrapDshuFrame,
  wrapDshuFrame,
} from "./rtc-chunking.js";

class MockSocketTransport implements DaemonTransport {
  readonly url: string;
  readonly sent: Array<string | Uint8Array | ArrayBuffer> = [];
  closed = false;
  closeCalls: Array<{ code?: number; reason?: string }> = [];
  private openHandlers = new Set<() => void>();
  private closeHandlers = new Set<(event?: unknown) => void>();
  private errorHandlers = new Set<(event?: unknown) => void>();
  private messageHandlers = new Set<(data: unknown) => void>();

  constructor(url: string) {
    this.url = url;
  }

  send(data: string | Uint8Array | ArrayBuffer): void {
    if (this.closed) throw new Error("Socket closed");
    this.sent.push(data);
    this.onClientSend?.(data);
  }

  close(code?: number, reason?: string): void {
    if (this.closed) return;
    this.closed = true;
    this.closeCalls.push({ code, reason });
    for (const h of this.closeHandlers) h({ code, reason });
  }

  onOpen(handler: () => void): () => void {
    this.openHandlers.add(handler);
    return () => this.openHandlers.delete(handler);
  }

  onClose(handler: (event?: unknown) => void): () => void {
    this.closeHandlers.add(handler);
    return () => this.closeHandlers.delete(handler);
  }

  onError(handler: (event?: unknown) => void): () => void {
    this.errorHandlers.add(handler);
    return () => this.errorHandlers.delete(handler);
  }

  onMessage(handler: (data: unknown) => void): () => void {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  onClientSend?: (data: string | Uint8Array | ArrayBuffer) => void;

  emitOpen(): void {
    for (const h of this.openHandlers) h();
  }

  emitMessage(data: unknown): void {
    for (const h of this.messageHandlers) h({ data });
  }

  emitError(err: unknown): void {
    for (const h of this.errorHandlers) h(err);
  }
}

class MockDaemonPeer {
  readonly keyPair: KeyPair;
  readonly publicKeyB64: string;
  sharedKey: SharedKey | null = null;
  readonly sendSalt = new Uint8Array(SALT_LENGTH).fill(0x5a);
  sendSeq = 0n;
  readonly receivedPlaintexts: Array<{ seq: bigint; plaintext: string | ArrayBuffer }> = [];
  readonly wsReceived: Array<{ seq: bigint; plaintext: string | ArrayBuffer }> = [];
  readonly dcReceived: Array<{ seq: bigint; plaintext: string | ArrayBuffer }> = [];
  readonly reassembler = new RtcChunkReassembler();
  readonly nextMsgId = createRtcMessageIdGenerator(100);
  authChallenge = "test-challenge-123";

  constructor() {
    this.keyPair = generateKeyPair();
    this.publicKeyB64 = exportPublicKey(this.keyPair.publicKey);
  }

  attachSocket(sock: MockSocketTransport): void {
    sock.onClientSend = (raw) => {
      if (typeof raw !== "string") return;
      if (raw.startsWith("{")) {
        const parsed = JSON.parse(raw) as { type?: string; key?: string };
        if (parsed.type === "e2ee_hello" && parsed.key) {
          this.sharedKey = deriveSharedKey(this.keyPair.secretKey, importPublicKey(parsed.key));
          sock.emitMessage(
            JSON.stringify({ type: "e2ee_ready", authChallenge: this.authChallenge }),
          );
        }
        return;
      }
      if (!this.sharedKey) throw new Error("Missing sharedKey");
      const bytes = Buffer.from(raw, "base64");
      const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      const { plaintext, seq } = decrypt(this.sharedKey, ab);
      this.receivedPlaintexts.push({ seq, plaintext });
      this.wsReceived.push({ seq, plaintext });
    };
  }

  sendOverWs(sock: MockSocketTransport, payload: string | ArrayBuffer): bigint {
    if (!this.sharedKey) throw new Error("Missing sharedKey");
    const seq = this.sendSeq;
    this.sendSeq += 1n;
    const bundle = encrypt(this.sharedKey, payload, seq, this.sendSalt);
    sock.emitMessage(Buffer.from(bundle).toString("base64"));
    return seq;
  }

  encryptForDc(payload: string | ArrayBuffer): { seq: bigint; chunks: Uint8Array[] } {
    if (!this.sharedKey) throw new Error("Missing sharedKey");
    const seq = this.sendSeq;
    this.sendSeq += 1n;
    const bundle = new Uint8Array(encrypt(this.sharedKey, payload, seq, this.sendSalt));
    const dshu = wrapDshuFrame(seq, bundle);
    const chunks = chunkRtcPayload(dshu, this.nextMsgId);
    return { seq, chunks };
  }

  receiveFromDc(frame: ArrayBuffer | Uint8Array | string): { seq: bigint; plaintext: string | ArrayBuffer } | null {
    if (!this.sharedKey) throw new Error("Missing sharedKey");
    const bytes =
      frame instanceof ArrayBuffer
        ? new Uint8Array(frame)
        : frame instanceof Uint8Array
          ? frame
          : new TextEncoder().encode(frame);
    const assembled = this.reassembler.push(bytes);
    if (!assembled) return null;
    const { seq, bundle } = unwrapDshuFrame(assembled);
    const copy = bundle.buffer.slice(bundle.byteOffset, bundle.byteOffset + bundle.byteLength);
    const decrypted = decrypt(this.sharedKey, copy);
    expect(decrypted.seq).toBe(seq);
    const entry = { seq, plaintext: decrypted.plaintext };
    this.receivedPlaintexts.push(entry);
    this.dcReceived.push(entry);
    return entry;
  }
}

class MockDataChannel implements RtcDataChannelLike {
  label: string;
  readyState = "connecting";
  binaryType = "blob";
  onopen: ((event?: unknown) => void) | null = null;
  onclose: ((event?: unknown) => void) | null = null;
  onerror: ((event?: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  readonly sentFrames: Array<ArrayBuffer | Uint8Array | string> = [];
  closed = false;

  constructor(label: string) {
    this.label = label;
  }

  send(data: ArrayBuffer | Uint8Array | string): void {
    if (this.readyState !== "open") throw new Error("DC not open");
    this.sentFrames.push(data);
    this.onClientSend?.(data);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.readyState = "closed";
  }

  onClientSend?: (data: ArrayBuffer | Uint8Array | string) => void;

  simulateOpen(): void {
    this.readyState = "open";
    this.onopen?.({});
  }

  simulateMessage(data: unknown): void {
    this.onmessage?.({ data });
  }

  simulateClose(): void {
    this.readyState = "closed";
    this.closed = true;
    this.onclose?.({});
  }
}

class MockPeerConnection implements RtcPeerConnectionLike {
  readonly iceServers: IceServerConfig[];
  iceConnectionState = "new";
  connectionState = "new";
  signalingState = "stable";
  onicecandidate: ((event: { candidate: RtcIceCandidateInitLike | null }) => void) | null = null;
  oniceconnectionstatechange: (() => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  channel: MockDataChannel | null = null;
  localSdp: string | null = null;
  remoteSdp: string | null = null;
  readonly addedIceCandidates: Array<RtcIceCandidateInitLike | null> = [];
  closed = false;

  constructor(config: { iceServers: IceServerConfig[] }) {
    this.iceServers = config.iceServers;
  }

  createDataChannel(label: string, options?: { ordered?: boolean }): RtcDataChannelLike {
    expect(options?.ordered).toBe(true);
    this.channel = new MockDataChannel(label);
    return this.channel;
  }

  async createOffer(): Promise<{ type: string; sdp: string }> {
    return { type: "offer", sdp: "v=0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n" };
  }

  async setLocalDescription(desc: { type: string; sdp?: string }): Promise<void> {
    this.localSdp = desc.sdp ?? null;
  }

  async setRemoteDescription(desc: { type: string; sdp?: string }): Promise<void> {
    this.remoteSdp = desc.sdp ?? null;
  }

  async addIceCandidate(candidate: RtcIceCandidateInitLike | null): Promise<void> {
    if (!this.remoteSdp) {
      throw new Error("setRemoteDescription must be called before addIceCandidate");
    }
    this.addedIceCandidates.push(candidate);
  }

  close(): void {
    this.closed = true;
    this.connectionState = "closed";
  }
}

describe("AdaptiveDaemonTransport", () => {
  test("LAN-first zero-external-server path connects directly, never touches relay or WebRTC", async () => {
    const peer = new MockDaemonPeer();
    const socketsByUrl = new Map<string, MockSocketTransport>();
    const baseFactory: DaemonTransportFactory = ({ url }) => {
      const sock = new MockSocketTransport(url);
      socketsByUrl.set(url, sock);
      return sock;
    };

    const rtcFactory = vi.fn();
    const modes: TransportMode[] = [];
    const received: unknown[] = [];

    const transport = createAdaptiveTransport({
      baseFactory,
      daemonPublicKeyB64: peer.publicKeyB64,
      logger: { warn: vi.fn() },
      relayUrl: "wss://ayase.cn:443/ws?serverId=srv_1&role=client&v=2",
      lanEndpoints: ["192.168.1.10:3180", "192.168.1.11:3180"],
      rtcPeerConnectionFactory: rtcFactory,
      onTransportModeChange: (m) => modes.push(m),
    });

    const onOpen = vi.fn();
    transport.onOpen(onOpen);
    transport.onMessage((data) => received.push(data));

    const lan1 = socketsByUrl.get("ws://192.168.1.10:3180/ws?serverId=srv_1&role=client&v=2");
    const lan2 = socketsByUrl.get("ws://192.168.1.11:3180/ws?serverId=srv_1&role=client&v=2");
    expect(lan1).toBeDefined();
    expect(lan2).toBeDefined();
    expect(socketsByUrl.has("wss://ayase.cn:443/ws?serverId=srv_1&role=client&v=2")).toBe(false);

    peer.attachSocket(lan1!);
    lan1!.emitOpen();

    expect(lan2!.closed).toBe(true);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(transport.getTransportMode()).toBe("lan");
    expect(modes).toEqual(["lan"]);

    // Device auth succeeds -> should NOT upgrade to WebRTC since already on LAN
    peer.sendOverWs(lan1!, JSON.stringify({ type: "relay_device_auth_result", ok: true }));
    expect(rtcFactory).not.toHaveBeenCalled();
    expect(received).toHaveLength(1);
    expect(socketsByUrl.has("wss://ayase.cn:443/ws?serverId=srv_1&role=client&v=2")).toBe(false);

    transport.close();
  });

  test("LAN direct failure falls back cleanly to Relay WS", async () => {
    const peer = new MockDaemonPeer();
    const socketsByUrl = new Map<string, MockSocketTransport>();
    const baseFactory: DaemonTransportFactory = ({ url }) => {
      const sock = new MockSocketTransport(url);
      socketsByUrl.set(url, sock);
      return sock;
    };

    const modes: TransportMode[] = [];
    const transport = createAdaptiveTransport({
      baseFactory,
      daemonPublicKeyB64: peer.publicKeyB64,
      logger: { warn: vi.fn() },
      relayUrl: "wss://ayase.cn:443/ws?serverId=srv_2&role=client&v=2",
      lanEndpoints: ["192.168.1.99:3180"],
      webrtcUpgrade: false,
      onTransportModeChange: (m) => modes.push(m),
    });

    const lanSock = socketsByUrl.get("ws://192.168.1.99:3180/ws?serverId=srv_2&role=client&v=2")!;
    lanSock.emitError(new Error("ECONNREFUSED"));

    const relaySock = socketsByUrl.get("wss://ayase.cn:443/ws?serverId=srv_2&role=client&v=2");
    expect(relaySock).toBeDefined();

    peer.attachSocket(relaySock!);
    relaySock!.emitOpen();

    expect(transport.getTransportMode()).toBe("relay");
    expect(modes).toEqual(["relay"]);
    transport.close();
  });

  test("in-band WebRTC upgrade: pendingIce, exact clientPreviousLegEndSeq, reorder drain, Relay close, and >64 KiB payload", async () => {
    const peer = new MockDaemonPeer();
    let relaySock!: MockSocketTransport;
    let createdPc!: MockPeerConnection;

    const baseFactory: DaemonTransportFactory = ({ url }) => {
      relaySock = new MockSocketTransport(url);
      peer.attachSocket(relaySock);
      return relaySock;
    };

    const modes: TransportMode[] = [];
    const upperMessages: unknown[] = [];
    const upperClose = vi.fn();

    const transport = createAdaptiveTransport({
      baseFactory,
      daemonPublicKeyB64: peer.publicKeyB64,
      logger: { warn: vi.fn() },
      relayUrl: "wss://ayase.cn:443/ws?serverId=srv_rtc&role=client&v=2",
      iceServers: [
        { urls: "turn:turn.example:3478?transport=udp", username: "u", credential: "p" },
        { urls: "stun:stun.cloudflare.com:3478" },
      ],
      rtcPeerConnectionFactory: (config) => {
        createdPc = new MockPeerConnection(config);
        return createdPc;
      },
      onTransportModeChange: (m) => modes.push(m),
    });

    transport.onMessage((data) => upperMessages.push(data));
    transport.onClose(upperClose);

    // 1. Open Relay WS & complete E2EE handshake
    relaySock.emitOpen();
    expect(transport.getTransportMode()).toBe("relay");

    // 2. Client sends hello on Relay WS (seq=0)
    transport.send(JSON.stringify({ type: "hello", clientId: "c1" }));
    expect(peer.wsReceived).toHaveLength(1);
    expect(peer.wsReceived[0].seq).toBe(0n);

    // 3. Host sends relay_device_auth_result { ok: true } -> triggers WebRTC upgrade
    peer.sendOverWs(relaySock, JSON.stringify({ type: "relay_device_auth_result", ok: true }));

    // Wait for async createOffer / setLocalDescription
    await vi.waitFor(() => {
      expect(peer.wsReceived.length).toBeGreaterThanOrEqual(2);
    });

    // Verify ICE server ordering (STUN before TURN UDP) & DataChannel settings
    expect(createdPc.iceServers.map((s) => s.urls)).toEqual([
      "stun:stun.cloudflare.com:3478",
      "turn:turn.example:3478?transport=udp",
    ]);
    expect(createdPc.channel?.label).toBe("dsh");
    expect(createdPc.channel?.binaryType).toBe("arraybuffer");

    const offerMsg = JSON.parse(peer.wsReceived[1].plaintext as string) as {
      type: string;
      attemptId: string;
      sdp: string;
    };
    expect(offerMsg.type).toBe("rtc_upgrade_offer");
    expect(offerMsg.attemptId.length).toBeGreaterThan(0);

    // 4. Host sends early trickle ICE BEFORE rtc_upgrade_answer -> must be buffered in pendingIce
    peer.sendOverWs(
      relaySock,
      JSON.stringify({
        type: "rtc_upgrade_ice",
        attemptId: offerMsg.attemptId,
        candidate: { candidate: "candidate:1 1 UDP 2122252543 1.2.3.4 50000 typ host", sdpMid: "0", sdpMLineIndex: 0 },
      }),
    );
    expect(createdPc.addedIceCandidates).toHaveLength(0);

    // 5. Host sends rtc_upgrade_answer -> flushes pendingIce into addIceCandidate
    peer.sendOverWs(
      relaySock,
      JSON.stringify({
        type: "rtc_upgrade_answer",
        attemptId: offerMsg.attemptId,
        sdp: "v=0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n",
      }),
    );
    await vi.waitFor(() => {
      expect(createdPc.addedIceCandidates).toHaveLength(1);
    });

    // 6. Wire DC client->host receiver and open DataChannel
    createdPc.channel!.onClientSend = (frame) => {
      peer.receiveFromDc(frame);
    };
    createdPc.channel!.simulateOpen();

    // Verify rtc_upgrade_activate was sent on Relay WS with exact clientPreviousLegEndSeq === seq
    const activateEntry = peer.wsReceived[peer.wsReceived.length - 1];
    const activateMsg = JSON.parse(activateEntry.plaintext as string) as {
      type: string;
      attemptId: string;
      clientPreviousLegEndSeq: number;
    };
    expect(activateMsg.type).toBe("rtc_upgrade_activate");
    expect(activateMsg.attemptId).toBe(offerMsg.attemptId);
    expect(BigInt(activateMsg.clientPreviousLegEndSeq)).toBe(activateEntry.seq);

    const wsCountBeforeAppSend = peer.wsReceived.length;

    // 7. Client sends a large >64 KiB payload -> MUST go over DataChannel chunked with RTCH + DSHU!
    const largePayload = JSON.stringify({ type: "session", blob: "A".repeat(70_000) });
    transport.send(largePayload);

    // Relay WS must receive ZERO further frames after rtc_upgrade_activate!
    expect(peer.wsReceived.length).toBe(wsCountBeforeAppSend);
    // DataChannel must have sent multiple RTCH chunks <= 8192 + 12 bytes
    expect(createdPc.channel!.sentFrames.length).toBeGreaterThan(8);
    for (const f of createdPc.channel!.sentFrames) {
      const bytes = new Uint8Array(f as ArrayBuffer);
      expect(isRtchFrame(bytes)).toBe(true);
      expect(bytes.byteLength).toBeLessThanOrEqual(8192 + 12);
    }
    expect(peer.dcReceived).toHaveLength(1);
    expect(peer.dcReceived[0].plaintext).toBe(largePayload);
    expect(peer.dcReceived[0].seq).toBe(activateEntry.seq + 1n);

    // 8. Test cross-leg reorder & Relay drain:
    //    Host prepares seq=N (rtc_upgrade_activated on Relay) and seq=N+1 (70 KiB payload on DC),
    //    but DC frame (seq=N+1) arrives BEFORE Relay frame (seq=N)!
    const hostActivatedSeq = peer.sendSeq; // next seq
    peer.sendSeq += 1n; // reserve for rtc_upgrade_activated
    const hostLargeReply = JSON.stringify({ type: "session", reply: "B".repeat(70_000) });
    const dcReply = peer.encryptForDc(hostLargeReply);
    expect(dcReply.seq).toBe(hostActivatedSeq + 1n);
    expect(dcReply.chunks.length).toBeGreaterThan(8);

    // Deliver DC chunks FIRST (out of order relative to hostActivatedSeq)
    for (const chunk of dcReply.chunks) {
      createdPc.channel!.simulateMessage(
        chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength),
      );
    }
    // Not delivered to upper layer yet because hostActivatedSeq is still missing!
    expect(upperMessages).toHaveLength(1); // only relay_device_auth_result so far

    // Now deliver rtc_upgrade_activated (seq=hostActivatedSeq) over Relay WS
    const activatedBundle = encrypt(
      peer.sharedKey!,
      JSON.stringify({
        type: "rtc_upgrade_activated",
        attemptId: offerMsg.attemptId,
        mode: "p2p",
        hostPreviousLegEndSeq: Number(hostActivatedSeq),
      }),
      hostActivatedSeq,
      peer.sendSalt,
    );
    relaySock.emitMessage(Buffer.from(activatedBundle).toString("base64"));

    // Verify mode updated to authoritative "p2p", buffered 70 KiB DC reply flushed,
    // and Relay WS closed cleanly with (1000, "upgraded_to_webrtc") WITHOUT upper disconnect!
    expect(transport.getTransportMode()).toBe("p2p");
    expect(modes).toEqual(["relay", "p2p"]);
    expect(upperMessages).toHaveLength(2);
    expect(upperMessages[1]).toBe(hostLargeReply);
    expect(relaySock.closed).toBe(true);
    expect(relaySock.closeCalls[0]).toEqual({ code: 1000, reason: "upgraded_to_webrtc" });
    expect(upperClose).not.toHaveBeenCalled();

    // 9. Closing DataChannel after activation DOES trigger upper-layer disconnect
    createdPc.channel!.simulateClose();
    expect(upperClose).toHaveBeenCalledTimes(1);
  });

  test("WebRTC abort / host-only timeout closes PC cleanly and keeps Relay WS active", async () => {
    vi.useFakeTimers();
    try {
      const peer = new MockDaemonPeer();
      let relaySock!: MockSocketTransport;
      let createdPc!: MockPeerConnection;

      const transport = createAdaptiveTransport({
        baseFactory: ({ url }) => {
          relaySock = new MockSocketTransport(url);
          peer.attachSocket(relaySock);
          return relaySock;
        },
        daemonPublicKeyB64: peer.publicKeyB64,
        logger: { warn: vi.fn() },
        relayUrl: "wss://ayase.cn:443/ws?serverId=srv_fail&role=client&v=2",
        iceServers: [], // host-only -> 4000ms timeout
        rtcPeerConnectionFactory: (config) => {
          createdPc = new MockPeerConnection(config);
          return createdPc;
        },
      });

      const upperClose = vi.fn();
      transport.onClose(upperClose);
      relaySock.emitOpen();
      peer.sendOverWs(relaySock, JSON.stringify({ type: "relay_device_auth_result", ok: true }));

      await vi.advanceTimersByTimeAsync(10);
      expect(createdPc.closed).toBe(false);

      // Advance to 4000ms host-only negotiation timeout
      await vi.advanceTimersByTimeAsync(4_000);
      expect(createdPc.closed).toBe(true);
      expect(relaySock.closed).toBe(false);
      expect(upperClose).not.toHaveBeenCalled();
      expect(transport.getTransportMode()).toBe("relay");

      // Relay WS continues working for app messages
      transport.send(JSON.stringify({ type: "ping" }));
      const last = JSON.parse(peer.wsReceived[peer.wsReceived.length - 1].plaintext as string);
      expect(last).toEqual({ type: "ping" });

      transport.close();
    } finally {
      vi.useRealTimers();
    }
  });

  test("rtc_upgrade_abort from Host closes PC cleanly and keeps Relay WS active", async () => {
    const peer = new MockDaemonPeer();
    let relaySock!: MockSocketTransport;
    let createdPc!: MockPeerConnection;

    const transport = createAdaptiveTransport({
      baseFactory: ({ url }) => {
        relaySock = new MockSocketTransport(url);
        peer.attachSocket(relaySock);
        return relaySock;
      },
      daemonPublicKeyB64: peer.publicKeyB64,
      logger: { warn: vi.fn() },
      relayUrl: "wss://ayase.cn:443/ws?serverId=srv_abort&role=client&v=2",
      rtcPeerConnectionFactory: (config) => {
        createdPc = new MockPeerConnection(config);
        return createdPc;
      },
    });

    const upperClose = vi.fn();
    transport.onClose(upperClose);
    relaySock.emitOpen();
    peer.sendOverWs(relaySock, JSON.stringify({ type: "relay_device_auth_result", ok: true }));

    await vi.waitFor(() => {
      expect(peer.wsReceived.length).toBeGreaterThanOrEqual(1);
    });
    const offerMsg = JSON.parse(peer.wsReceived[0].plaintext as string) as { attemptId: string };

    peer.sendOverWs(
      relaySock,
      JSON.stringify({ type: "rtc_upgrade_abort", attemptId: offerMsg.attemptId, reason: "policy" }),
    );

    expect(createdPc.closed).toBe(true);
    expect(relaySock.closed).toBe(false);
    expect(upperClose).not.toHaveBeenCalled();
    expect(transport.getTransportMode()).toBe("relay");

    transport.send(JSON.stringify({ type: "ping" }));
    expect(JSON.parse(peer.wsReceived[peer.wsReceived.length - 1].plaintext as string)).toEqual({
      type: "ping",
    });
    transport.close();
  });

  test("pure LAN-only failure with no relayUrl emits error and closes cleanly", () => {
    const peer = new MockDaemonPeer();
    let lanSock!: MockSocketTransport;
    const onError = vi.fn();
    const onClose = vi.fn();

    const transport = createAdaptiveTransport({
      baseFactory: ({ url }) => {
        lanSock = new MockSocketTransport(url);
        return lanSock;
      },
      daemonPublicKeyB64: peer.publicKeyB64,
      logger: { warn: vi.fn() },
      serverId: "srv_lan_only",
      relayUrl: "",
      lanEndpoints: ["192.168.1.222:3180"],
    });
    transport.onError(onError);
    transport.onClose(onClose);

    lanSock.emitError(new Error("EHOSTUNREACH"));
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("stays cleanly on relay when RTCPeerConnection is unavailable", () => {
    const peer = new MockDaemonPeer();
    let relaySock!: MockSocketTransport;

    const transport = createAdaptiveTransport({
      baseFactory: ({ url }) => {
        relaySock = new MockSocketTransport(url);
        peer.attachSocket(relaySock);
        return relaySock;
      },
      daemonPublicKeyB64: peer.publicKeyB64,
      logger: { warn: vi.fn() },
      relayUrl: "wss://ayase.cn:443/ws?serverId=srv_nortc&role=client&v=2",
    });

    const received: unknown[] = [];
    transport.onMessage((data) => received.push(data));
    relaySock.emitOpen();
    peer.sendOverWs(relaySock, JSON.stringify({ type: "relay_device_auth_result", ok: true }));

    expect(transport.getTransportMode()).toBe("relay");
    expect(received).toHaveLength(1);
    expect(peer.wsReceived).toHaveLength(0);
    transport.close();
  });

  test("DaemonClient wires lanEndpoints and exposes getTransportMode / onTransportModeChange", async () => {
    const peer = new MockDaemonPeer();
    let openedUrl = "";
    const modes: TransportMode[] = [];

    const client = new DaemonClient({
      url: "wss://ayase.cn:443/ws?serverId=srv_dc&role=client&v=2",
      clientId: "client_1",
      e2ee: {
        enabled: true,
        daemonPublicKeyB64: peer.publicKeyB64,
      },
      lanEndpoints: ["192.168.1.50:3180"],
      onTransportModeChange: (m) => modes.push(m),
      reconnect: { enabled: false },
      transportFactory: ({ url }) => {
        openedUrl = url;
        const sock = new MockSocketTransport(url);
        peer.attachSocket(sock);
        queueMicrotask(() => {
          sock.emitOpen();
        });
        const origOnClientSend = sock.onClientSend;
        sock.onClientSend = (raw) => {
          origOnClientSend?.(raw);
          if (peer.wsReceived.length > 0) {
            const latest = peer.wsReceived[peer.wsReceived.length - 1];
            const parsed = JSON.parse(latest.plaintext as string) as { type?: string };
            if (parsed.type === "hello") {
              peer.sendOverWs(
                sock,
                JSON.stringify({
                  type: "session",
                  message: {
                    type: "status",
                    payload: {
                      status: "server_info",
                      serverId: "srv_dc",
                      hostname: "TestHost",
                      version: "1.0.0",
                      capabilities: {},
                    },
                  },
                }),
              );
            }
          }
        };
        return sock;
      },
    });

    await client.connect();
    expect(openedUrl).toBe("ws://192.168.1.50:3180/ws?serverId=srv_dc&role=client&v=2");
    expect(client.getTransportMode()).toBe("lan");
    expect(modes).toEqual(["lan"]);

    await client.close();
    expect(client.getTransportMode()).toBeNull();
  });
});
