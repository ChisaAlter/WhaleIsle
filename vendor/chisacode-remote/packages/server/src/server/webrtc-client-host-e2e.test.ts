import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import pino from "pino";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import { RTCIceCandidate, RTCPeerConnection, RTCSessionDescription } from "werift";
import {
  DaemonClient,
  type RtcDataChannelLike,
  type RtcIceCandidateInitLike,
  type RtcPeerConnectionFactory,
  type RtcPeerConnectionLike,
  type TransportMode,
  type WebSocketFactory,
  type WebSocketLike,
} from "@chisacode/client";
import { exportPublicKey, generateKeyPair } from "@chisacode/relay/e2ee";
import { attachEncryptedSocket, type RelaySocketLike } from "./relay-transport.js";
import { LAN_E2EE_WS_PATH, startLanE2eeTransport } from "./lan-e2ee-transport.js";
import { RelayDeviceCredentialStore } from "./relay-device-credential-store.js";
import { detachWeriftMessageBytes } from "./webrtc-host.js";

const logger = pino({ level: "silent" });
const cleanupFns: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  while (cleanupFns.length > 0) {
    const fn = cleanupFns.pop()!;
    try {
      await fn();
    } catch {
      // ignore cleanup errors
    }
  }
});

/**
 * Adapts real `werift` RTCPeerConnection to `@chisacode/client`'s W3C-shaped
 * `RtcPeerConnectionFactory` so the actual `DaemonClient` + adaptive transport
 * runs real ICE/DTLS/SCTP DataChannel negotiation against Host `webrtc-host.ts`.
 */
function createWeriftClientPeerConnectionFactory(): RtcPeerConnectionFactory {
  return (config) => {
    const iceServers = config.iceServers.flatMap((entry) => {
      const urls = Array.isArray(entry.urls) ? entry.urls : [entry.urls];
      return urls.map((url) => ({
        urls: url,
        ...(entry.username ? { username: entry.username } : {}),
        ...(entry.credential ? { credential: entry.credential } : {}),
      }));
    });
    const pc = new RTCPeerConnection({
      iceServers,
      iceUseIpv4: true,
      iceUseIpv6: false,
      iceAdditionalHostAddresses: ["127.0.0.1"],
    });
    const unsubs: Array<() => void> = [];

    const wrapper: RtcPeerConnectionLike = {
      get iceConnectionState() {
        return pc.iceConnectionState;
      },
      get connectionState() {
        return pc.connectionState;
      },
      get signalingState() {
        return pc.signalingState;
      },
      onicecandidate: null,
      oniceconnectionstatechange: null,
      onconnectionstatechange: null,
      createDataChannel(label, options) {
        const rawDc = pc.createDataChannel(label, { ordered: options?.ordered ?? true });
        let openedEmitted = false;
        const dcWrapper: RtcDataChannelLike = {
          label: rawDc.label,
          get readyState() {
            return rawDc.readyState;
          },
          binaryType: "arraybuffer",
          send(data) {
            if (typeof data === "string") {
              rawDc.send(data);
            } else if (data instanceof ArrayBuffer) {
              rawDc.send(Buffer.from(new Uint8Array(data)));
            } else {
              rawDc.send(Buffer.from(data.buffer, data.byteOffset, data.byteLength));
            }
          },
          close() {
            try {
              rawDc.close();
            } catch {
              // ignore
            }
          },
          onopen: null,
          onclose: null,
          onerror: null,
          onmessage: null,
        };

        const subState = rawDc.stateChanged.subscribe((state) => {
          if (state === "open" && !openedEmitted) {
            openedEmitted = true;
            dcWrapper.onopen?.();
          } else if (state === "closed") {
            dcWrapper.onclose?.();
          }
        });
        const subMsg = rawDc.onMessage.subscribe((raw) => {
          const detached = detachWeriftMessageBytes(raw);
          if (!detached) return;
          dcWrapper.onmessage?.({ data: detached.buffer });
        });
        const subErr = rawDc.error.subscribe((err) => {
          dcWrapper.onerror?.(err);
        });
        unsubs.push(
          () => subState.unSubscribe(),
          () => subMsg.unSubscribe(),
          () => subErr.unSubscribe(),
        );
        return dcWrapper;
      },
      async createOffer() {
        const offer = await pc.createOffer();
        return { type: offer.type, sdp: offer.sdp };
      },
      async setLocalDescription(desc) {
        await Promise.resolve(
          pc.setLocalDescription(
            new RTCSessionDescription(desc.sdp ?? "", desc.type as "offer" | "answer"),
          ),
        );
      },
      async setRemoteDescription(desc) {
        await pc.setRemoteDescription(
          new RTCSessionDescription(desc.sdp ?? "", desc.type as "offer" | "answer"),
        );
      },
      async addIceCandidate(candidate: RtcIceCandidateInitLike | null) {
        if (!candidate || !candidate.candidate) return;
        await pc.addIceCandidate(
          new RTCIceCandidate({
            candidate: candidate.candidate,
            sdpMid: candidate.sdpMid ?? undefined,
            sdpMLineIndex: candidate.sdpMLineIndex ?? undefined,
          }),
        );
      },
      close() {
        for (const unsub of unsubs.splice(0)) {
          try {
            unsub();
          } catch {
            // ignore
          }
        }
        void pc.close().catch(() => undefined);
      },
    };

    const subIce = pc.onIceCandidate.subscribe((cand) => {
      if (!cand) {
        wrapper.onicecandidate?.({ candidate: null });
        return;
      }
      wrapper.onicecandidate?.({
        candidate: {
          candidate: cand.candidate ?? "",
          sdpMid: cand.sdpMid ?? null,
          sdpMLineIndex: typeof cand.sdpMLineIndex === "number" ? cand.sdpMLineIndex : null,
        },
      });
    });
    const subIceState = pc.iceConnectionStateChange.subscribe(() => {
      wrapper.oniceconnectionstatechange?.();
    });
    const subConnState = pc.connectionStateChange.subscribe(() => {
      wrapper.onconnectionstatechange?.();
    });
    unsubs.push(
      () => subIce.unSubscribe(),
      () => subIceState.unSubscribe(),
      () => subConnState.unSubscribe(),
    );

    cleanupFns.push(() => wrapper.close());
    return wrapper;
  };
}

interface TrackedSocket {
  url: string;
  ws: WebSocket;
  closedCode: number | null;
  closedReason: string | null;
}

function createTrackedWsFactory(): {
  factory: WebSocketFactory;
  sockets: TrackedSocket[];
} {
  const sockets: TrackedSocket[] = [];
  const factory: WebSocketFactory = (url, options) => {
    const ws = new WebSocket(url, options?.protocols, {
      headers: options?.headers,
      perMessageDeflate: false,
    });
    const record: TrackedSocket = { url, ws, closedCode: null, closedReason: null };
    sockets.push(record);
    ws.on("close", (code, reason) => {
      record.closedCode = code;
      record.closedReason = reason.toString("utf8");
    });
    cleanupFns.push(() => {
      try {
        ws.terminate();
      } catch {
        // ignore
      }
    });
    return ws as unknown as WebSocketLike;
  };
  return { factory, sockets };
}

/**
 * Attaches realistic daemon session auth + RPC handler onto an encrypted host socket,
 * matching `VoiceAssistantWebSocketServer.authorizeRelayHello` semantics:
 * - First pairing (`pairingToken`): issues device via `RelayDeviceCredentialStore`, sends
 *   `relay_device_auth_result { ok: true, deviceId, deviceSecret }` + `server_info`.
 * - Saved-secret reconnect (`proof`): verifies HMAC proof via `RelayDeviceCredentialStore`,
 *   sends ONLY `server_info` (no `relay_device_auth_result`), and calls `metadata.onAuthenticated`.
 * - Echoes `dshd.host.rpc.request` with `dshd.host.rpc.response`.
 */
function createHostSessionHandler(params: {
  serverId: string;
  chisacodeHome: string;
  daemonPublicKeyB64: string;
  onSocketClosed?: () => void;
}) {
  const { serverId, chisacodeHome, daemonPublicKeyB64, onSocketClosed } = params;
  return async (
    encryptedWs: RelaySocketLike,
    metadata?: {
      requireDeviceAuth?: boolean;
      relayClientPublicKeyB64?: string;
      relayAuthChallenge?: string;
      onAuthenticated?: (deviceId: string | null) => void;
    },
  ): Promise<void> => {
    encryptedWs.on("close", () => {
      onSocketClosed?.();
    });
    encryptedWs.on("message", (raw) => {
      const msg = JSON.parse(String(raw)) as {
        type?: string;
        relayDeviceAuth?: {
          deviceId: string;
          deviceName?: string;
          pairingToken?: string;
          proof?: string;
          challenge?: string;
          clientPublicKeyB64?: string;
        };
        message?: {
          type?: string;
          requestId?: string;
          method?: string;
          payload?: unknown;
        };
      };

      if (msg.type === "hello") {
        const auth = msg.relayDeviceAuth;
        const store = new RelayDeviceCredentialStore(chisacodeHome);
        if (
          !auth ||
          auth.clientPublicKeyB64 !== metadata?.relayClientPublicKeyB64 ||
          auth.challenge !== metadata?.relayAuthChallenge
        ) {
          encryptedWs.close(4401, "Relay device auth channel binding failed");
          return;
        }

        let authenticatedDeviceId: string;
        if (auth.pairingToken) {
          const accepted = store.consumePairingToken(auth.pairingToken);
          if (!accepted) {
            encryptedWs.close(4401, "Invalid pairing token");
            return;
          }
          const issued = store.issueDevice(auth.deviceName || "e2e-client", auth.deviceId);
          authenticatedDeviceId = issued.deviceId;
          encryptedWs.send(
            JSON.stringify({
              type: "relay_device_auth_result",
              version: 1,
              ok: true,
              deviceId: issued.deviceId,
              deviceSecret: issued.deviceSecret,
              securityLevel: "v2",
            }),
          );
        } else if (auth.proof && auth.challenge && auth.clientPublicKeyB64) {
          const ok = store.verifyDeviceProof({
            deviceId: auth.deviceId,
            proof: auth.proof,
            challenge: auth.challenge,
            serverId,
            daemonPublicKeyB64,
            clientPublicKeyB64: auth.clientPublicKeyB64,
          });
          if (!ok) {
            encryptedWs.close(4401, "Invalid device proof");
            return;
          }
          authenticatedDeviceId = auth.deviceId;
        } else {
          encryptedWs.close(4401, "Missing device auth");
          return;
        }

        metadata?.onAuthenticated?.(authenticatedDeviceId);
        encryptedWs.send(
          JSON.stringify({
            type: "session",
            message: {
              type: "status",
              payload: {
                status: "server_info",
                serverId,
                hostname: "WhaleIsle-E2E-Host",
                version: "1.0.3",
                capabilities: {},
              },
            },
          }),
        );
        return;
      }

      if (msg.type === "session" && msg.message?.type === "dshd.host.rpc.request") {
        encryptedWs.send(
          JSON.stringify({
            type: "session",
            message: {
              type: "dshd.host.rpc.response",
              payload: {
                requestId: msg.message.requestId,
                ok: true,
                value: {
                  method: msg.message.method,
                  echo: msg.message.payload,
                },
              },
            },
          }),
        );
      }
    });
  };
}

async function waitForCondition(
  predicate: () => boolean,
  timeoutMs: number,
  label: string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`Timed out waiting for: ${label}`);
}

describe("Real cross-end DaemonClient <-> Host werift E2E", () => {
  it(
    "(a) Pure LAN E2EE direct connection via /ws -> /lan-ws bridge with zero external relay server",
    async () => {
      const home = fs.mkdtempSync(path.join(os.tmpdir(), "chisacode-e2e-lan-"));
      cleanupFns.push(() => fs.rmSync(home, { recursive: true, force: true }));

      const serverId = "srv_e2e_lan_only";
      const daemonKeyPair = generateKeyPair();
      const daemonPublicKeyB64 = exportPublicKey(daemonKeyPair.publicKey);
      const store = new RelayDeviceCredentialStore(home);
      const pairing = store.issuePairingToken(60_000);

      // Daemon loopback HTTP server hosting BOTH /ws (non-clobbering) and /lan-ws
      const daemonHttp = http.createServer((_req, res) => {
        res.writeHead(404);
        res.end("not found");
      });
      const mainWss = new WebSocketServer({ noServer: true, path: "/ws" });
      daemonHttp.on("upgrade", (req, socket, head) => {
        const rawUrl = req.url ?? "/";
        const q = rawUrl.indexOf("?");
        const pathname = q !== -1 ? rawUrl.slice(0, q) : rawUrl;
        if (pathname === LAN_E2EE_WS_PATH) return;
        mainWss.handleUpgrade(req, socket, head, (ws) => mainWss.emit("connection", ws, req));
      });
      await new Promise<void>((resolve) => daemonHttp.listen(0, "127.0.0.1", resolve));
      cleanupFns.push(async () => {
        mainWss.close();
        daemonHttp.closeAllConnections();
        await new Promise<void>((resolve) => daemonHttp.close(() => resolve()));
      });
      const daemonAddr = daemonHttp.address();
      if (!daemonAddr || typeof daemonAddr === "string") throw new Error("Expected TCP address");

      const hostModes: string[] = [];
      const lanTransport = startLanE2eeTransport({
        httpServer: daemonHttp,
        logger,
        serverId,
        daemonKeyPair,
        chisacodeHome: home,
        daemonPublicKeyB64,
        requireDeviceAuth: true,
        onTransportModeChange: ({ mode }) => hostModes.push(mode),
        attachSocket: createHostSessionHandler({
          serverId,
          chisacodeHome: home,
          daemonPublicKeyB64,
        }),
      });
      cleanupFns.push(() => lanTransport.stop());

      // Bridge server mimicking mobile-web-server.js (:3180) forwarding /ws -> loopback /lan-ws
      const bridgeHttp = http.createServer((_req, res) => {
        res.writeHead(404);
        res.end("not found");
      });
      const bridgeWss = new WebSocketServer({ noServer: true, perMessageDeflate: false });
      bridgeHttp.on("upgrade", (req, socket, head) => {
        const parsed = new URL(req.url ?? "/", "http://127.0.0.1");
        if (parsed.pathname !== "/ws") {
          socket.destroy();
          return;
        }
        const upstreamUrl = new URL(`ws://127.0.0.1:${daemonAddr.port}${LAN_E2EE_WS_PATH}`);
        for (const key of ["serverId", "role", "v"]) {
          const val = parsed.searchParams.get(key);
          if (val !== null) upstreamUrl.searchParams.set(key, val);
        }
        bridgeWss.handleUpgrade(req, socket, head, (clientWs) => {
          const upstreamWs = new WebSocket(upstreamUrl.toString(), { perMessageDeflate: false });
          const pending: Array<{ data: Buffer | string; isBinary: boolean }> = [];
          upstreamWs.on("open", () => {
            while (pending.length > 0 && upstreamWs.readyState === WebSocket.OPEN) {
              const item = pending.shift()!;
              upstreamWs.send(item.data, { binary: item.isBinary });
            }
          });
          clientWs.on("message", (data, isBinary) => {
            const payload = isBinary ? Buffer.from(data as Buffer) : String(data);
            if (upstreamWs.readyState === WebSocket.OPEN) {
              upstreamWs.send(payload, { binary: isBinary });
            } else {
              pending.push({ data: payload, isBinary });
            }
          });
          upstreamWs.on("message", (data, isBinary) => {
            if (clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(data, { binary: isBinary });
            }
          });
          clientWs.on("close", () => upstreamWs.close());
          upstreamWs.on("close", () => clientWs.close());
        });
      });
      await new Promise<void>((resolve) => bridgeHttp.listen(0, "127.0.0.1", resolve));
      cleanupFns.push(async () => {
        for (const c of bridgeWss.clients) c.terminate();
        bridgeWss.close();
        bridgeHttp.closeAllConnections();
        await new Promise<void>((resolve) => bridgeHttp.close(() => resolve()));
      });
      const bridgeAddr = bridgeHttp.address();
      if (!bridgeAddr || typeof bridgeAddr === "string") throw new Error("Expected TCP address");

      const { factory: wsFactory, sockets } = createTrackedWsFactory();
      const clientModes: TransportMode[] = [];
      let issuedSecret = "";

      const client = new DaemonClient({
        url: "", // ZERO external relay server!
        clientId: "e2e-lan-client-1",
        clientType: "mobile",
        e2ee: { enabled: true, daemonPublicKeyB64 },
        lanEndpoints: [`127.0.0.1:${bridgeAddr.port}`],
        lanUseTls: false,
        relayDeviceAuth: {
          version: 1,
          serverId,
          deviceId: "dev_e2e_lan",
          pairingToken: pairing.token,
          deviceName: "E2E LAN Phone",
        },
        onRelayDeviceAuthResult: (res) => {
          if (res.ok && res.deviceSecret) issuedSecret = res.deviceSecret;
        },
        onTransportModeChange: (m) => clientModes.push(m),
        webSocketFactory: wsFactory,
        reconnect: { enabled: false },
      });
      cleanupFns.push(() => client.close());

      await client.connect();

      expect(client.getTransportMode()).toBe("lan");
      expect(clientModes).toEqual(["lan"]);
      expect(hostModes).toContain("lan");
      expect(issuedSecret.length).toBeGreaterThanOrEqual(32);
      expect(sockets).toHaveLength(1);
      expect(sockets[0].url).toBe(
        `ws://127.0.0.1:${bridgeAddr.port}/ws?serverId=${encodeURIComponent(serverId)}&role=client&v=2`,
      );

      // Authenticated session RPC over pure LAN E2EE
      const rpcRes = await client.hostRpc("session.ping", { greeting: "hello-pure-lan" });
      expect(rpcRes.ok).toBe(true);
      expect(rpcRes.value).toEqual({
        method: "session.ping",
        echo: { greeting: "hello-pure-lan" },
      });

      await client.close();
    },
    20_000,
  );

  it(
    "(b) Relay WS -> real DaemonClient(werift) <-> Host(werift) DataChannel upgrade, Relay WS closed, >64 KiB RTCH round-trip (both first pairing AND saved-secret reconnect)",
    async () => {
      const home = fs.mkdtempSync(path.join(os.tmpdir(), "chisacode-e2e-rtc-"));
      cleanupFns.push(() => fs.rmSync(home, { recursive: true, force: true }));

      const serverId = "srv_e2e_p2p";
      const daemonKeyPair = generateKeyPair();
      const daemonPublicKeyB64 = exportPublicKey(daemonKeyPair.publicKey);
      const store = new RelayDeviceCredentialStore(home);
      const pairing = store.issuePairingToken(60_000);

      // Real local WebSocket relay server attaching each incoming client to real Host attachEncryptedSocket
      const relayWss = new WebSocketServer({ host: "127.0.0.1", port: 0, perMessageDeflate: false });
      await new Promise<void>((resolve) => relayWss.once("listening", resolve));
      cleanupFns.push(async () => {
        for (const c of relayWss.clients) c.terminate();
        await new Promise<void>((resolve) => relayWss.close(() => resolve()));
      });
      const relayAddr = relayWss.address();
      if (!relayAddr || typeof relayAddr === "string") throw new Error("Expected TCP address");

      const hostRelayCloseEvents: Array<{ code: number; reason: string }> = [];
      const hostUpgradedModes: TransportMode[] = [];
      let hostUpperClosedCount = 0;

      relayWss.on("connection", (serverSideWs) => {
        serverSideWs.on("close", (code, reason) => {
          hostRelayCloseEvents.push({ code, reason: reason.toString("utf8") });
        });
        void attachEncryptedSocket(
          serverSideWs,
          daemonKeyPair,
          logger,
          createHostSessionHandler({
            serverId,
            chisacodeHome: home,
            daemonPublicKeyB64,
            onSocketClosed: () => {
              hostUpperClosedCount += 1;
            },
          }),
          {
            transport: "relay",
            requireDeviceAuth: true,
            chisacodeHome: home,
            daemonPublicKeyB64,
            serverId,
          },
          {
            connectionId: `conn-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
            iceServers: [],
            onTransportModeChange: (mode) => hostUpgradedModes.push(mode),
            detectHostCandidates: async () => ({
              ipv4: ["127.0.0.1"],
              ipv6: [],
              blockedHostIps: new Set(),
            }),
          },
        );
      });

      const relayUrl = `ws://127.0.0.1:${relayAddr.port}/ws?serverId=${encodeURIComponent(serverId)}&role=client&v=2`;

      // --- Part 1: First pairing (pairingToken -> relay_device_auth_result + server_info) ---
      const { factory: wsFactory1, sockets: sockets1 } = createTrackedWsFactory();
      const modes1: TransportMode[] = [];
      let enrolledDeviceId = "";
      let enrolledDeviceSecret = "";

      const client1 = new DaemonClient({
        url: relayUrl,
        clientId: "e2e-p2p-client-1",
        clientType: "mobile",
        e2ee: { enabled: true, daemonPublicKeyB64 },
        iceServers: [],
        rtcPeerConnectionFactory: createWeriftClientPeerConnectionFactory(),
        relayDeviceAuth: {
          version: 1,
          serverId,
          deviceId: "dev_e2e_p2p",
          pairingToken: pairing.token,
          deviceName: "E2E P2P Phone",
        },
        onRelayDeviceAuthResult: (res) => {
          if (res.ok && res.deviceId && res.deviceSecret) {
            enrolledDeviceId = res.deviceId;
            enrolledDeviceSecret = res.deviceSecret;
          }
        },
        onTransportModeChange: (m) => modes1.push(m),
        webSocketFactory: wsFactory1,
        reconnect: { enabled: false },
      });
      cleanupFns.push(() => client1.close());

      await client1.connect();
      expect(enrolledDeviceId).toBe("dev_e2e_p2p");
      expect(enrolledDeviceSecret.length).toBeGreaterThanOrEqual(32);

      // Wait for real in-band WebRTC DataChannel upgrade & Relay WS teardown
      await waitForCondition(
        () => {
          const mode = client1.getTransportMode();
          return (
            (mode === "lan" || mode === "p2p") &&
            sockets1.length === 1 &&
            sockets1[0].ws.readyState === WebSocket.CLOSED &&
            hostRelayCloseEvents.length >= 1
          );
        },
        12_000,
        "client1 WebRTC upgrade + Relay WS closed",
      );

      expect(modes1[0]).toBe("relay");
      expect(["lan", "p2p"]).toContain(client1.getTransportMode());
      expect(client1.getConnectionState().status).toBe("connected");
      expect(hostUpperClosedCount).toBe(0);
      expect(sockets1[0].ws.readyState).toBe(WebSocket.CLOSED);
      expect(sockets1[0].closedCode).toBe(1000);
      expect(sockets1[0].closedReason).toBe("upgraded_to_webrtc");
      expect(hostUpgradedModes[0]).toBe(client1.getTransportMode());

      // Round-trip >64 KiB (72 KiB, RTCH-chunked) E2EE RPC while Relay WS is completely CLOSED!
      const payload72k = "W".repeat(72 * 1024);
      const bigRes1 = await client1.hostRpc("echo.large", { blob: payload72k });
      expect(bigRes1.ok).toBe(true);
      expect((bigRes1.value as { echo?: { blob?: string } }).echo?.blob).toBe(payload72k);
      expect(client1.getConnectionState().status).toBe("connected");
      expect(sockets1[0].ws.readyState).toBe(WebSocket.CLOSED);

      await client1.close();

      // --- Part 2: Saved-secret HMAC reconnect (proof ONLY, NO relay_device_auth_result!) ---
      const { factory: wsFactory2, sockets: sockets2 } = createTrackedWsFactory();
      const modes2: TransportMode[] = [];

      const client2 = new DaemonClient({
        url: relayUrl,
        clientId: "e2e-p2p-client-2",
        clientType: "mobile",
        e2ee: { enabled: true, daemonPublicKeyB64 },
        iceServers: [],
        rtcPeerConnectionFactory: createWeriftClientPeerConnectionFactory(),
        relayDeviceAuth: {
          version: 1,
          serverId,
          deviceId: enrolledDeviceId,
          deviceSecret: enrolledDeviceSecret,
        },
        onTransportModeChange: (m) => modes2.push(m),
        webSocketFactory: wsFactory2,
        reconnect: { enabled: false },
      });
      cleanupFns.push(() => client2.close());

      await client2.connect();

      await waitForCondition(
        () => {
          const mode = client2.getTransportMode();
          return (
            (mode === "lan" || mode === "p2p") &&
            sockets2.length === 1 &&
            sockets2[0].ws.readyState === WebSocket.CLOSED &&
            hostRelayCloseEvents.length >= 2
          );
        },
        12_000,
        "client2 saved-secret reconnect WebRTC upgrade + Relay WS closed",
      );

      expect(modes2[0]).toBe("relay");
      expect(["lan", "p2p"]).toContain(client2.getTransportMode());
      expect(client2.getConnectionState().status).toBe("connected");
      expect(sockets2[0].ws.readyState).toBe(WebSocket.CLOSED);

      const payload80k = "R".repeat(80 * 1024);
      const bigRes2 = await client2.hostRpc("echo.reconnect_large", { blob: payload80k });
      expect(bigRes2.ok).toBe(true);
      expect((bigRes2.value as { echo?: { blob?: string } }).echo?.blob).toBe(payload80k);

      await client2.close();
    },
    30_000,
  );

  it(
    "(c) WebRTC failure gracefully keeps Relay WS working with zero dropped requests",
    async () => {
      const home = fs.mkdtempSync(path.join(os.tmpdir(), "chisacode-e2e-fallback-"));
      cleanupFns.push(() => fs.rmSync(home, { recursive: true, force: true }));

      const serverId = "srv_e2e_fallback";
      const daemonKeyPair = generateKeyPair();
      const daemonPublicKeyB64 = exportPublicKey(daemonKeyPair.publicKey);
      const store = new RelayDeviceCredentialStore(home);
      const pairing = store.issuePairingToken(60_000);

      const relayWss = new WebSocketServer({ host: "127.0.0.1", port: 0, perMessageDeflate: false });
      await new Promise<void>((resolve) => relayWss.once("listening", resolve));
      cleanupFns.push(async () => {
        for (const c of relayWss.clients) c.terminate();
        await new Promise<void>((resolve) => relayWss.close(() => resolve()));
      });
      const relayAddr = relayWss.address();
      if (!relayAddr || typeof relayAddr === "string") throw new Error("Expected TCP address");

      relayWss.on("connection", (serverSideWs) => {
        void attachEncryptedSocket(
          serverSideWs,
          daemonKeyPair,
          logger,
          createHostSessionHandler({
            serverId,
            chisacodeHome: home,
            daemonPublicKeyB64,
          }),
          {
            transport: "relay",
            requireDeviceAuth: true,
            chisacodeHome: home,
            daemonPublicKeyB64,
            serverId,
          },
          {
            connectionId: "conn-fallback-1",
            iceServers: [],
          },
        );
      });

      const { factory: wsFactory, sockets } = createTrackedWsFactory();
      let offerCalled = false;

      // Faulty PeerConnection that sends invalid SDP so Host responds rtc_upgrade_abort
      const brokenRtcFactory: RtcPeerConnectionFactory = () => {
        const dc: RtcDataChannelLike = {
          label: "dsh",
          readyState: "connecting",
          binaryType: "arraybuffer",
          send() {},
          close() {
            dc.readyState = "closed";
          },
          onopen: null,
          onclose: null,
          onerror: null,
          onmessage: null,
        };
        return {
          iceConnectionState: "new",
          connectionState: "new",
          signalingState: "stable",
          onicecandidate: null,
          oniceconnectionstatechange: null,
          onconnectionstatechange: null,
          createDataChannel: () => dc,
          createOffer: async () => {
            offerCalled = true;
            return { type: "offer", sdp: "invalid-sdp-triggers-host-abort" };
          },
          setLocalDescription: async () => {},
          setRemoteDescription: async () => {},
          addIceCandidate: async () => {},
          close() {
            dc.readyState = "closed";
          },
        };
      };

      const relayUrl = `ws://127.0.0.1:${relayAddr.port}/ws?serverId=${encodeURIComponent(serverId)}&role=client&v=2`;
      const client = new DaemonClient({
        url: relayUrl,
        clientId: "e2e-fallback-client",
        clientType: "mobile",
        e2ee: { enabled: true, daemonPublicKeyB64 },
        iceServers: [],
        rtcPeerConnectionFactory: brokenRtcFactory,
        relayDeviceAuth: {
          version: 1,
          serverId,
          deviceId: "dev_e2e_fb",
          pairingToken: pairing.token,
          deviceName: "E2E Fallback Phone",
        },
        webSocketFactory: wsFactory,
        reconnect: { enabled: false },
      });
      cleanupFns.push(() => client.close());

      await client.connect();
      await waitForCondition(() => offerCalled, 5_000, "broken offer attempt");
      // Give Host time to process invalid SDP and return rtc_upgrade_abort
      await new Promise((r) => setTimeout(r, 150));

      expect(client.getTransportMode()).toBe("relay");
      expect(client.getConnectionState().status).toBe("connected");
      expect(sockets[0].ws.readyState).toBe(WebSocket.OPEN);

      // Multiple sequential & large RPCs continue working seamlessly over Relay WS
      const r1 = await client.hostRpc("echo.fb1", { seq: 1 });
      const r2 = await client.hostRpc("echo.fb2", { blob: "F".repeat(70 * 1024) });
      expect(r1.ok).toBe(true);
      expect(r1.value).toEqual({ method: "echo.fb1", echo: { seq: 1 } });
      expect(r2.ok).toBe(true);
      expect((r2.value as { echo?: { blob?: string } }).echo?.blob).toBe("F".repeat(70 * 1024));
      expect(client.getTransportMode()).toBe("relay");
      expect(sockets[0].ws.readyState).toBe(WebSocket.OPEN);

      await client.close();
    },
    20_000,
  );
});
