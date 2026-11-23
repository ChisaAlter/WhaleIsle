import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import pino from "pino";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import { RTCIceCandidate, RTCPeerConnection, RTCSessionDescription } from "werift";
import {
  createClientChannel,
  exportPublicKey,
  generateKeyPair,
  type Transport,
} from "@chisacode/relay/e2ee";
import { RTC_DATA_CHANNEL_LABEL } from "@chisacode/protocol/webrtc-signaling";
import { attachEncryptedSocket, type RelaySocketLike } from "./relay-transport.js";
import { LAN_E2EE_WS_PATH, startLanE2eeTransport } from "./lan-e2ee-transport.js";
import {
  classifySelectedCandidatePair,
  createWeriftDataChannelTransport,
  detachWeriftMessageBytes,
  filterSdpCandidates,
  isAllowedIceCandidateLine,
  orderIceServersForWerift,
} from "./webrtc-host.js";

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

function createClientWsTransport(ws: WebSocket): Transport & {
  closedWith: { code?: number; reason?: string } | null;
} {
  const transport: Transport & { closedWith: { code?: number; reason?: string } | null } = {
    closedWith: null,
    onmessage: null,
    onclose: null,
    onerror: null,
    send(data) {
      ws.send(data);
    },
    close(code, reason) {
      this.closedWith = { code, reason };
      ws.close(code, reason);
    },
  };
  ws.on("message", (data, isBinary) => {
    if (isBinary) {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
      const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
      transport.onmessage?.(ab as ArrayBuffer);
    } else {
      transport.onmessage?.(typeof data === "string" ? data : Buffer.from(data as Buffer).toString("utf8"));
    }
  });
  ws.on("close", (code, reason) => {
    const reasonStr = reason.toString("utf8");
    if (!transport.closedWith) {
      transport.closedWith = { code, reason: reasonStr };
    }
    transport.onclose?.(code, reasonStr);
  });
  ws.on("error", (err) => {
    transport.onerror?.(err);
  });
  return transport;
}

async function openWs(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

describe("werift helper unit checks", () => {
  it("orders ICE servers strictly: stun < turn?tcp < turns?tcp < turn?udp < turns < turn", () => {
    const ordered = orderIceServersForWerift([
      { urls: "turn:a.example.com:3478", username: "u", credential: "p" },
      { urls: "turns:b.example.com:5349", username: "u", credential: "p" },
      { urls: "turn:c.example.com:3478?transport=udp", username: "u", credential: "p" },
      { urls: "turns:d.example.com:5349?transport=tcp", username: "u", credential: "p" },
      { urls: "turn:e.example.com:3478?transport=tcp", username: "u", credential: "p" },
      { urls: ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"] },
    ]);
    expect(ordered.map((s) => s.urls)).toEqual([
      "stun:stun.cloudflare.com:3478",
      "stun:stun.l.google.com:19302",
      "turn:e.example.com:3478?transport=tcp",
      "turns:d.example.com:5349?transport=tcp",
      "turn:c.example.com:3478?transport=udp",
      "turns:b.example.com:5349",
      "turn:a.example.com:3478",
    ]);
  });

  it("filters proxy RFC 2544 fake IPs and virtual TUN host candidates", () => {
    const blocked = new Set(["172.25.0.1"]);
    const sdp = [
      "v=0",
      "a=candidate:1 1 UDP 1 198.18.0.1 5000 typ host",
      "a=candidate:2 1 UDP 1 172.25.0.1 5001 typ host",
      "a=candidate:3 1 UDP 1 192.168.1.20 5002 typ host",
      "a=candidate:4 1 UDP 1 203.0.113.10 5003 typ srflx raddr 192.168.1.20 rport 5002",
    ].join("\r\n");

    expect(isAllowedIceCandidateLine("candidate:1 1 UDP 1 198.18.0.1 5000 typ host", blocked)).toBe(false);
    expect(isAllowedIceCandidateLine("candidate:2 1 UDP 1 172.25.0.1 5001 typ host", blocked)).toBe(false);
    expect(isAllowedIceCandidateLine("candidate:3 1 UDP 1 192.168.1.20 5002 typ host", blocked)).toBe(true);

    const filtered = filterSdpCandidates(sdp, blocked);
    expect(filtered).not.toContain("198.18.0.1");
    expect(filtered).not.toContain("172.25.0.1");
    expect(filtered).toContain("192.168.1.20");
    expect(filtered).toContain("203.0.113.10");
  });

  it("classifies selected candidate pairs into lan / p2p / turn", () => {
    expect(
      classifySelectedCandidatePair(
        { candidateType: "relay", address: "1.2.3.4" },
        { candidateType: "host", address: "192.168.1.5" },
      ),
    ).toBe("turn");
    expect(
      classifySelectedCandidatePair(
        { candidateType: "host", address: "192.168.1.10" },
        { candidateType: "host", address: "192.168.1.20" },
      ),
    ).toBe("lan");
    expect(
      classifySelectedCandidatePair(
        { candidateType: "host", address: "127.0.0.1" },
        { candidateType: "prflx", address: "127.0.0.1" },
      ),
    ).toBe("lan");
    expect(
      classifySelectedCandidatePair(
        { candidateType: "host", address: "100.100.1.2" },
        { candidateType: "host", address: "100.100.1.3" },
      ),
    ).toBe("p2p");
    expect(
      classifySelectedCandidatePair(
        { candidateType: "srflx", address: "198.51.100.1" },
        { candidateType: "srflx", address: "203.0.113.2" },
      ),
    ).toBe("p2p");
  });

  it("detaches werift Buffer slice from shared Node 8 KiB slab pool", () => {
    const slab = Buffer.allocUnsafe(8192);
    slab.fill(0xaa);
    const view = slab.subarray(100, 120);
    view.fill(0x55);

    const detached = detachWeriftMessageBytes(view)!;
    expect(detached.byteLength).toBe(20);
    expect(detached.buffer.byteLength).toBe(20);
    // Mutating original slab must not corrupt detached bytes
    slab.fill(0x00);
    expect(detached[0]).toBe(0x55);
    expect(detached[19]).toBe(0x55);
  });
});

describe("LAN E2EE direct transport & real werift<->werift WebRTC upgrade", () => {
  it("(a) completes LAN E2EE direct WS auth + RPC with zero relay server", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "chisacode-lan-test-"));
    cleanupFns.push(() => fs.rmSync(home, { recursive: true, force: true }));

    const serverId = "srv_lan_direct_test";
    const daemonKeyPair = generateKeyPair();
    const daemonPublicKeyB64 = exportPublicKey(daemonKeyPair.publicKey);

    const httpServer = http.createServer((_req, res) => {
      res.writeHead(404);
      res.end("not found");
    });
    await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
    cleanupFns.push(
      () =>
        new Promise<void>((resolve) => {
          httpServer.closeAllConnections();
          httpServer.close(() => resolve());
        }),
    );

    const addr = httpServer.address();
    if (!addr || typeof addr === "string") throw new Error("Expected TCP address");

    const observedModes: Array<{ connectionId: string; mode: string }> = [];
    const lanTransport = startLanE2eeTransport({
      httpServer,
      logger,
      serverId,
      daemonKeyPair,
      chisacodeHome: home,
      daemonPublicKeyB64,
      requireDeviceAuth: true,
      onTransportModeChange: (info) => observedModes.push(info),
      attachSocket: async (ws, metadata) => {
        ws.on("message", (raw) => {
          const msg = JSON.parse(String(raw));
          if (msg.type === "hello") {
            expect(metadata?.requireDeviceAuth).toBe(true);
            expect(metadata?.relayAuthChallenge).toBeTruthy();
            if (msg.relayDeviceAuth?.pairingToken === "valid-lan-token") {
              ws.send(
                JSON.stringify({
                  type: "relay_device_auth_result",
                  version: 1,
                  ok: true,
                  deviceId: "dev_lan_1",
                  deviceSecret: "s".repeat(40),
                  securityLevel: "v2",
                }),
              );
              metadata?.onAuthenticated?.("dev_lan_1");
            } else {
              ws.close(4401, "Auth required");
            }
            return;
          }
          if (msg.type === "session" && msg.message?.type === "ping_rpc") {
            ws.send(
              JSON.stringify({
                type: "session",
                message: { type: "pong_rpc", echo: msg.message.payload },
              }),
            );
          }
        });
      },
    });
    cleanupFns.push(() => lanTransport.stop());

    const ws = await openWs(
      `ws://127.0.0.1:${addr.port}${LAN_E2EE_WS_PATH}?serverId=${encodeURIComponent(serverId)}&role=client&v=2`,
    );
    cleanupFns.push(() => {
      try {
        ws.close();
      } catch {
        // ignore
      }
    });

    const received: Array<Record<string, unknown>> = [];
    const waitForMessage = (predicate: (m: Record<string, unknown>) => boolean, timeoutMs = 5000) =>
      new Promise<Record<string, unknown>>((resolve, reject) => {
        const existing = received.find(predicate);
        if (existing) {
          resolve(existing);
          return;
        }
        const timer = setTimeout(() => reject(new Error("Timed out waiting for message")), timeoutMs);
        const check = setInterval(() => {
          const hit = received.find(predicate);
          if (hit) {
            clearTimeout(timer);
            clearInterval(check);
            resolve(hit);
          }
        }, 10);
      });

    const transport = createClientWsTransport(ws);
    const channel = await createClientChannel(transport, daemonPublicKeyB64, {
      onmessage: (data) => {
        received.push(JSON.parse(String(data)));
      },
    });
    await new Promise<void>((resolve) => {
      if (channel.isOpen()) resolve();
      else channel.onTransitionToOpen(resolve);
    });

    // Pre-auth rtc_upgrade_offer must be rejected with abort (unauthenticated)
    await channel.send(
      JSON.stringify({
        type: "rtc_upgrade_offer",
        attemptId: "pre-auth-1",
        sdp: "v=0\r\n",
      }),
    );
    const preAuthAbort = await waitForMessage(
      (m) => m.type === "rtc_upgrade_abort" && m.attemptId === "pre-auth-1",
    );
    expect(preAuthAbort.reason).toBe("unauthenticated");

    // Authenticate over LAN E2EE
    await channel.send(
      JSON.stringify({
        type: "hello",
        clientId: "lan-client-1",
        protocolVersion: 1,
        relayDeviceAuth: {
          version: 1,
          deviceId: "dev_lan_1",
          pairingToken: "valid-lan-token",
        },
      }),
    );
    const authRes = await waitForMessage((m) => m.type === "relay_device_auth_result");
    expect(authRes.ok).toBe(true);

    // Send RPC over direct LAN E2EE
    await channel.send(
      JSON.stringify({
        type: "session",
        message: { type: "ping_rpc", payload: "hello-zero-relay-lan" },
      }),
    );
    const rpcRes = await waitForMessage(
      (m) => m.type === "session" && (m.message as { type?: string })?.type === "pong_rpc",
    );
    expect((rpcRes.message as { echo?: string }).echo).toBe("hello-zero-relay-lan");
    expect(observedModes.some((m) => m.mode === "lan")).toBe(true);
  });

  it(
    "(b) upgrades Relay WS -> real werift<->werift DataChannel, closes Relay WS, and exchanges >64 KiB RTCH-chunked E2EE payload purely over DataChannel",
    async () => {
      const daemonKeyPair = generateKeyPair();
      const daemonPublicKeyB64 = exportPublicKey(daemonKeyPair.publicKey);

      const relayWss = new WebSocketServer({ host: "127.0.0.1", port: 0 });
      await new Promise<void>((resolve) => relayWss.once("listening", resolve));
      cleanupFns.push(
        () =>
          new Promise<void>((resolve) => {
            for (const c of relayWss.clients) c.terminate();
            relayWss.close(() => resolve());
          }),
      );
      const relayAddr = relayWss.address();
      if (!relayAddr || typeof relayAddr === "string") throw new Error("Expected TCP address");

      let hostRelayWsClosed: { code: number; reason: string } | null = null;
      let hostSocketClosed = false;
      let upgradedModeOnHost: string | null = null;

      relayWss.on("connection", (serverSideWs) => {
        serverSideWs.on("close", (code, reason) => {
          hostRelayWsClosed = { code, reason: reason.toString("utf8") };
        });

        void attachEncryptedSocket(
          serverSideWs,
          daemonKeyPair,
          logger,
          async (encryptedWs: RelaySocketLike, metadata) => {
            encryptedWs.on("close", () => {
              hostSocketClosed = true;
            });
            encryptedWs.on("message", (raw) => {
              const msg = JSON.parse(String(raw));
              if (msg.type === "hello") {
                encryptedWs.send(
                  JSON.stringify({
                    type: "relay_device_auth_result",
                    version: 1,
                    ok: true,
                    deviceId: "dev_rtc_1",
                    deviceSecret: "x".repeat(40),
                    securityLevel: "v2",
                  }),
                );
                metadata?.onAuthenticated?.("dev_rtc_1");
                return;
              }
              if (msg.type === "session" && msg.message?.type === "echo_big") {
                encryptedWs.send(
                  JSON.stringify({
                    type: "session",
                    message: {
                      type: "echo_big_result",
                      data: msg.message.data,
                    },
                  }),
                );
              }
            });
          },
          {
            transport: "relay",
            requireDeviceAuth: true,
          },
          {
            connectionId: "conn-rtc-1",
            iceServers: [],
            onTransportModeChange: (mode) => {
              upgradedModeOnHost = mode;
            },
            detectHostCandidates: async () => ({
              ipv4: ["127.0.0.1"],
              ipv6: [],
              blockedHostIps: new Set(),
            }),
          },
        );
      });

      const clientWs = await openWs(`ws://127.0.0.1:${relayAddr.port}`);
      cleanupFns.push(() => {
        try {
          clientWs.close();
        } catch {
          // ignore
        }
      });

      const clientWsTransport = createClientWsTransport(clientWs);
      let clientChannelClosed = false;
      const clientInbox: Array<Record<string, unknown>> = [];
      const waiters: Array<() => void> = [];
      const notify = () => {
        while (waiters.length > 0) waiters.shift()!();
      };
      const nextMessage = async (
        predicate: (m: Record<string, unknown>) => boolean,
        timeoutMs = 10_000,
      ): Promise<Record<string, unknown>> => {
        const deadline = Date.now() + timeoutMs;
        while (true) {
          const idx = clientInbox.findIndex(predicate);
          if (idx !== -1) {
            return clientInbox.splice(idx, 1)[0];
          }
          const remaining = deadline - Date.now();
          if (remaining <= 0) {
            throw new Error("Timed out waiting for client message");
          }
          await new Promise<void>((resolve) => {
            const t = setTimeout(resolve, Math.min(remaining, 100));
            waiters.push(() => {
              clearTimeout(t);
              resolve();
            });
          });
        }
      };

      const clientChannel = await createClientChannel(clientWsTransport, daemonPublicKeyB64, {
        onmessage: (data) => {
          const parsed = JSON.parse(String(data)) as Record<string, unknown>;
          clientInbox.push(parsed);
          notify();
        },
        onclose: () => {
          clientChannelClosed = true;
        },
      });
      await new Promise<void>((resolve) => {
        if (clientChannel.isOpen()) resolve();
        else clientChannel.onTransitionToOpen(resolve);
      });

      // Step 1: Authenticate over Relay WS
      await clientChannel.send(
        JSON.stringify({
          type: "hello",
          clientId: "rtc-client-1",
          protocolVersion: 1,
        }),
      );
      const auth = await nextMessage((m) => m.type === "relay_device_auth_result");
      expect(auth.ok).toBe(true);

      // Step 2: Client starts real werift PeerConnection & DataChannel "dsh"
      const attemptId = "attempt-real-werift-1";
      const clientPc = new RTCPeerConnection({
        iceServers: [],
        iceUseIpv4: true,
        iceUseIpv6: false,
        iceAdditionalHostAddresses: ["127.0.0.1"],
      });
      cleanupFns.push(() => clientPc.close().catch(() => undefined));

      const clientDc = clientPc.createDataChannel(RTC_DATA_CHANNEL_LABEL, { ordered: true });
      const dcOpened = new Promise<void>((resolve, reject) => {
        if (clientDc.readyState === "open") {
          resolve();
          return;
        }
        const timer = setTimeout(() => reject(new Error("Client DataChannel open timeout")), 8_000);
        const sub = clientDc.stateChanged.subscribe((state) => {
          if (state === "open") {
            clearTimeout(timer);
            sub.unSubscribe();
            resolve();
          }
        });
      });

      clientPc.onIceCandidate.subscribe((cand) => {
        if (!cand) return;
        void clientChannel.send(
          JSON.stringify({
            type: "rtc_upgrade_ice",
            attemptId,
            candidate: {
              candidate: cand.candidate,
              sdpMid: cand.sdpMid ?? null,
              sdpMLineIndex: cand.sdpMLineIndex ?? null,
            },
          }),
        );
      });

      const offer = await clientPc.createOffer();
      await clientPc.setLocalDescription(offer);
      await clientChannel.send(
        JSON.stringify({
          type: "rtc_upgrade_offer",
          attemptId,
          sdp: clientPc.localDescription?.sdp ?? offer.sdp,
        }),
      );

      // Pump Host trickle ICE while waiting for answer
      const answer = await nextMessage((m) => m.type === "rtc_upgrade_answer" && m.attemptId === attemptId);
      await clientPc.setRemoteDescription(new RTCSessionDescription(String(answer.sdp), "answer"));

      // Apply any trickle ICE from Host in the background
      const applyHostIce = async () => {
        for (let i = clientInbox.length - 1; i >= 0; i -= 1) {
          const item = clientInbox[i];
          if (item.type === "rtc_upgrade_ice" && item.attemptId === attemptId) {
            clientInbox.splice(i, 1);
            const c = item.candidate as { candidate?: string; sdpMid?: string | null; sdpMLineIndex?: number | null } | null;
            if (c?.candidate) {
              await clientPc
                .addIceCandidate(
                  new RTCIceCandidate({
                    candidate: c.candidate,
                    sdpMid: c.sdpMid ?? undefined,
                    sdpMLineIndex: c.sdpMLineIndex ?? undefined,
                  }),
                )
                .catch(() => undefined);
            }
          }
        }
      };
      const icePump = setInterval(() => {
        void applyHostIce();
      }, 20);
      cleanupFns.push(() => clearInterval(icePump));
      await applyHostIce();

      await dcOpened;
      clearInterval(icePump);

      // Step 3: Activate WebRTC leg on Client (send rtc_upgrade_activate as final Relay WS frame)
      const clientDcTransport = createWeriftDataChannelTransport(clientDc, clientPc);
      clientChannel.activateWebRtcLeg({
        dcTransport: clientDcTransport,
        buildFinalPrimaryLegMessage: (seq) =>
          JSON.stringify({
            type: "rtc_upgrade_activate",
            attemptId,
            clientPreviousLegEndSeq: Number(seq),
          }),
      });

      // Step 4: Receive rtc_upgrade_activated from Host & drain Client Relay WS
      const activated = await nextMessage(
        (m) => m.type === "rtc_upgrade_activated" && m.attemptId === attemptId,
      );
      expect(["lan", "p2p", "turn"]).toContain(activated.mode);
      expect(typeof activated.hostPreviousLegEndSeq).toBe("number");
      clientChannel.beginPrimaryLegDrain(Number(activated.hostPreviousLegEndSeq));

      // Wait briefly for Relay WS close frames to propagate
      await new Promise((r) => setTimeout(r, 100));
      expect(clientWsTransport.closedWith?.code).toBe(1000);
      expect(clientWsTransport.closedWith?.reason).toBe("upgraded_to_webrtc");
      expect(hostRelayWsClosed).not.toBeNull();
      expect(clientChannelClosed).toBe(false);
      expect(hostSocketClosed).toBe(false);
      expect(upgradedModeOnHost).toBe(activated.mode);

      // Step 5: Round-trip a 72 KiB (>64 KiB, RTCH-chunked) E2EE message purely over DataChannel!
      const largeData = "A".repeat(72 * 1024);
      await clientChannel.send(
        JSON.stringify({
          type: "session",
          message: { type: "echo_big", data: largeData },
        }),
      );
      const bigReply = await nextMessage(
        (m) => m.type === "session" && (m.message as { type?: string })?.type === "echo_big_result",
        10_000,
      );
      expect((bigReply.message as { data?: string }).data).toBe(largeData);
      expect(clientChannelClosed).toBe(false);
      expect(hostSocketClosed).toBe(false);

      clientChannel.close();
    },
    20_000,
  );

  it("(c) keeps Relay WS alive gracefully when WebRTC upgrade fails or aborts", async () => {
    const daemonKeyPair = generateKeyPair();
    const daemonPublicKeyB64 = exportPublicKey(daemonKeyPair.publicKey);

    const relayWss = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await new Promise<void>((resolve) => relayWss.once("listening", resolve));
    cleanupFns.push(
      () =>
        new Promise<void>((resolve) => {
          for (const c of relayWss.clients) c.terminate();
          relayWss.close(() => resolve());
        }),
    );
    const relayAddr = relayWss.address();
    if (!relayAddr || typeof relayAddr === "string") throw new Error("Expected TCP address");

    relayWss.on("connection", (serverSideWs) => {
      void attachEncryptedSocket(
        serverSideWs,
        daemonKeyPair,
        logger,
        async (encryptedWs, metadata) => {
          encryptedWs.on("message", (raw) => {
            const msg = JSON.parse(String(raw));
            if (msg.type === "hello") {
              encryptedWs.send(
                JSON.stringify({
                  type: "relay_device_auth_result",
                  version: 1,
                  ok: true,
                  deviceId: "dev_fallback",
                  deviceSecret: "f".repeat(40),
                  securityLevel: "v2",
                }),
              );
              metadata?.onAuthenticated?.("dev_fallback");
            } else if (msg.type === "session" && msg.message?.type === "still_alive") {
              encryptedWs.send(
                JSON.stringify({
                  type: "session",
                  message: { type: "still_alive_ok" },
                }),
              );
            }
          });
        },
        { transport: "relay", requireDeviceAuth: true },
      );
    });

    const clientWs = await openWs(`ws://127.0.0.1:${relayAddr.port}`);
    cleanupFns.push(() => {
      try {
        clientWs.close();
      } catch {
        // ignore
      }
    });

    const inbox: Array<Record<string, unknown>> = [];
    let closed = false;
    const channel = await createClientChannel(createClientWsTransport(clientWs), daemonPublicKeyB64, {
      onmessage: (data) => inbox.push(JSON.parse(String(data))),
      onclose: () => {
        closed = true;
      },
    });
    await new Promise<void>((resolve) => {
      if (channel.isOpen()) resolve();
      else channel.onTransitionToOpen(resolve);
    });

    const waitFor = (pred: (m: Record<string, unknown>) => boolean) =>
      new Promise<Record<string, unknown>>((resolve, reject) => {
        const deadline = Date.now() + 5000;
        const t = setInterval(() => {
          const hit = inbox.find(pred);
          if (hit) {
            clearInterval(t);
            resolve(hit);
          } else if (Date.now() > deadline) {
            clearInterval(t);
            reject(new Error("timeout"));
          }
        }, 10);
      });

    await channel.send(JSON.stringify({ type: "hello", clientId: "c-fb", protocolVersion: 1 }));
    await waitFor((m) => m.type === "relay_device_auth_result");

    // Send malformed SDP offer -> Host aborts WebRTC upgrade but Relay WS remains alive!
    await channel.send(
      JSON.stringify({
        type: "rtc_upgrade_offer",
        attemptId: "bad-sdp-attempt",
        sdp: "not-a-valid-sdp",
      }),
    );
    const abortMsg = await waitFor(
      (m) => m.type === "rtc_upgrade_abort" && m.attemptId === "bad-sdp-attempt",
    );
    expect(abortMsg.attemptId).toBe("bad-sdp-attempt");
    expect(closed).toBe(false);

    // Relay WS still handles normal RPC traffic seamlessly
    await channel.send(
      JSON.stringify({ type: "session", message: { type: "still_alive" } }),
    );
    const alive = await waitFor(
      (m) => m.type === "session" && (m.message as { type?: string })?.type === "still_alive_ok",
    );
    expect(alive).toBeDefined();
    expect(closed).toBe(false);
    channel.close();
  });
});
