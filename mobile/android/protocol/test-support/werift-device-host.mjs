#!/usr/bin/env node
/**
 * Real-device Android <-> Windows Host WebRTC & zero-server LAN interop harness.
 *
 * Starts real production modules from this repository:
 *   - Case 1 (Pure LAN Direct, zero external relay):
 *       real `createMobileWebServer` (`src/main/mobile-web-server.js`) bridging `/ws`
 *       to loopback `/lan-ws` handled by real `startLanE2eeTransport` (`lan-e2ee-transport.ts`).
 *   - Case 2 & 3 (Real Android libwebrtc <-> Windows `werift@0.26.0` WebRTC upgrade):
 *       local Relay WS server attaching every socket to real `attachEncryptedSocket`
 *       (`relay-transport.ts`) + real `WebRtcHostSessionController` (`webrtc-host.ts`).
 *   - Case 4 (WebRTC Failure -> Graceful Relay Fallback):
 *       local Relay WS server attaching every socket to real `attachEncryptedSocket`
 *       with `enableWebRtcUpgrade: false` and explicit `rtc_upgrade_abort` response.
 *   - Control HTTP server exposing `GET /info` and `GET /stats` for instrumentation assertions.
 *
 * Run with Node + tsx loader (reusing repo or task-owned node_modules):
 *   node --import tsx mobile/android/protocol/test-support/werift-device-host.mjs [options]
 */

import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../../..");
const serverPkgPath = path.join(repoRoot, "vendor/chisacode-remote/packages/server/package.json");
const requireFromServer = createRequire(serverPkgPath);
const requireFromRoot = createRequire(path.join(repoRoot, "package.json"));

async function importFromServer(specifier) {
  return import(pathToFileURL(requireFromServer.resolve(specifier)).href);
}

const pino = requireFromServer("pino");
const { WebSocketServer } = requireFromServer("ws");
const { RTCPeerConnection } = await importFromServer("werift");
const { exportPublicKey, generateKeyPair } = await importFromServer("@chisacode/relay/e2ee");
const { getDefaultIceServers } = await importFromServer("@chisacode/protocol/connection-offer");
const { attachEncryptedSocket } = await import(
  pathToFileURL(path.join(repoRoot, "vendor/chisacode-remote/packages/server/src/server/relay-transport.ts")).href
);
const { LAN_E2EE_WS_PATH, startLanE2eeTransport } = await import(
  pathToFileURL(path.join(repoRoot, "vendor/chisacode-remote/packages/server/src/server/lan-e2ee-transport.ts")).href
);
const { RelayDeviceCredentialStore } = await import(
  pathToFileURL(
    path.join(repoRoot, "vendor/chisacode-remote/packages/server/src/server/relay-device-credential-store.ts"),
  ).href
);
const { detectHostCandidates, WebRtcHostSessionController } = await import(
  pathToFileURL(path.join(repoRoot, "vendor/chisacode-remote/packages/server/src/server/webrtc-host.ts")).href
);
const { createMobileWebServer } = requireFromRoot(path.join(repoRoot, "src/main/mobile-web-server.js"));
const { startTurnTcpBridge } = await import(
  pathToFileURL(path.join(__dirname, "turn-tcp-bridge.mjs")).href
);

function parseArgs(argv) {
  const opts = {
    bind: "0.0.0.0",
    controlPort: 0,
    lanPort: 0,
    relayPort: 0,
    fallbackPort: 0,
    turnPort: 0,
    enableTurnBridge: false,
    iceServersJson: "",
    verbose: false,
    extraHostIps: [],
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--bind") opts.bind = argv[++i];
    else if (arg === "--control-port") opts.controlPort = Number(argv[++i]);
    else if (arg === "--lan-port") opts.lanPort = Number(argv[++i]);
    else if (arg === "--relay-port") opts.relayPort = Number(argv[++i]);
    else if (arg === "--fallback-port") opts.fallbackPort = Number(argv[++i]);
    else if (arg === "--turn-port") {
      opts.turnPort = Number(argv[++i]);
      opts.enableTurnBridge = true;
    } else if (arg === "--ice-servers") opts.iceServersJson = argv[++i];
    else if (arg === "--extra-host-ip") opts.extraHostIps.push(argv[++i]);
    else if (arg === "--verbose") opts.verbose = true;
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));

let iceServers = opts.iceServersJson
  ? JSON.parse(opts.iceServersJson)
  : getDefaultIceServers();

const logger = pino({
  level: opts.verbose ? "debug" : "info",
});

// Capture selected candidate pair telemetry & optional signaling trace from WebRtcHostSessionController.
const observedCandidatePairs = [];
const origHandleSignaling = WebRtcHostSessionController.prototype.handleSignalingMessage;
WebRtcHostSessionController.prototype.handleSignalingMessage = function tracedHandleSignaling(raw) {
  if (opts.verbose && raw && typeof raw === "object") {
    const t = raw.type;
    const ts = new Date().toISOString().slice(11, 23);
    if (t === "rtc_upgrade_ice") {
      console.error(`[${ts} sig IN ] ${t} cand=${raw.candidate ? raw.candidate.candidate : "<end>"} mid=${raw.candidate?.sdpMid} mline=${raw.candidate?.sdpMLineIndex}`);
    } else if (t === "rtc_upgrade_offer") {
      console.error(`[${ts} sig IN ] ${t} attemptId=${raw.attemptId} sdpLen=${raw.sdp?.length}`);
    } else {
      console.error(`[${ts} sig IN ] ${JSON.stringify(raw)}`);
    }
  }
  return origHandleSignaling.call(this, raw);
};
const origSendSignaling = WebRtcHostSessionController.prototype.sendSignaling;
WebRtcHostSessionController.prototype.sendSignaling = function tracedSendSignaling(payload) {
  if (opts.verbose && payload && typeof payload === "object") {
    const t = payload.type;
    const ts = new Date().toISOString().slice(11, 23);
    if (t === "rtc_upgrade_ice") {
      console.error(`[${ts} sig OUT] ${t} cand=${payload.candidate ? payload.candidate.candidate : "<end>"} mid=${payload.candidate?.sdpMid} mline=${payload.candidate?.sdpMLineIndex}`);
    } else if (t === "rtc_upgrade_answer") {
      console.error(`[${ts} sig OUT] ${t} attemptId=${payload.attemptId} sdpLen=${payload.sdp?.length}`);
    } else {
      console.error(`[${ts} sig OUT] ${JSON.stringify(payload)}`);
    }
  }
  return origSendSignaling.call(this, payload);
};
const origHandleActivate = WebRtcHostSessionController.prototype.handleActivate;
WebRtcHostSessionController.prototype.handleActivate = async function tracedHandleActivate(attemptId, endSeq) {
  const pc = this.currentAttempt?.pc;
  const res = await origHandleActivate.call(this, attemptId, endSeq);
  if (pc && typeof pc.getStats === "function") {
    try {
      const report = await pc.getStats();
      const entries = report && typeof report.values === "function" ? Array.from(report.values()) : Object.values(report || {});
      const locals = new Map();
      const remotes = new Map();
      const pairs = new Map();
      let selectedPairId = null;
      for (const entry of entries) {
        if (!entry || typeof entry !== "object") continue;
        if (entry.type === "local-candidate" && entry.id) locals.set(entry.id, entry);
        else if (entry.type === "remote-candidate" && entry.id) remotes.set(entry.id, entry);
        else if (entry.type === "candidate-pair" && entry.id) pairs.set(entry.id, entry);
        else if (entry.type === "transport" && entry.selectedCandidatePairId) selectedPairId = entry.selectedCandidatePairId;
      }
      let chosen = selectedPairId ? pairs.get(selectedPairId) : null;
      if (!chosen) {
        for (const pair of pairs.values()) {
          if (pair.selected === true || (pair.nominated === true && pair.state === "succeeded")) {
            chosen = pair;
            break;
          }
        }
      }
      if (!chosen) {
        for (const pair of pairs.values()) {
          if (pair.state === "succeeded") {
            chosen = pair;
            break;
          }
        }
      }
      if (chosen) {
        const local = locals.get(chosen.localCandidateId);
        const remote = remotes.get(chosen.remoteCandidateId);
        if (local || remote) {
          const snapshot = {
            ts: Date.now(),
            state: chosen.state ?? null,
            nominated: Boolean(chosen.nominated),
            local: local
              ? { candidateType: local.candidateType ?? null, protocol: local.protocol ?? null, address: local.address ?? local.ip ?? null, port: local.port ?? null }
              : null,
            remote: remote
              ? { candidateType: remote.candidateType ?? null, protocol: remote.protocol ?? null, address: remote.address ?? remote.ip ?? null, port: remote.port ?? null }
              : null,
          };
          observedCandidatePairs.push(snapshot);
          console.error(`[werift-host] selected ICE pair: ${JSON.stringify(snapshot)}`);
        }
      }
    } catch {
      // ignore telemetry error
    }
  }
  return res;
};
const originalGetStats = RTCPeerConnection.prototype.getStats;
RTCPeerConnection.prototype.getStats = async function patchedGetStats(...args) {
  const report = await originalGetStats.apply(this, args);
  try {
    const entries =
      report && typeof report.values === "function"
        ? Array.from(report.values())
        : Array.isArray(report)
          ? report
          : Object.values(report || {});
    const locals = new Map();
    const remotes = new Map();
    const pairs = new Map();
    let selectedPairId = null;
    for (const entry of entries) {
      if (!entry || typeof entry !== "object") continue;
      if (entry.type === "local-candidate" && entry.id) locals.set(entry.id, entry);
      else if (entry.type === "remote-candidate" && entry.id) remotes.set(entry.id, entry);
      else if (entry.type === "candidate-pair" && entry.id) pairs.set(entry.id, entry);
      else if (entry.type === "transport" && entry.selectedCandidatePairId) {
        selectedPairId = entry.selectedCandidatePairId;
      }
    }
    let chosen = selectedPairId ? pairs.get(selectedPairId) : null;
    if (!chosen) {
      for (const pair of pairs.values()) {
        if (pair.selected === true || (pair.nominated === true && pair.state === "succeeded")) {
          chosen = pair;
          break;
        }
      }
    }
    if (!chosen) {
      for (const pair of pairs.values()) {
        if (pair.state === "succeeded") {
          chosen = pair;
          break;
        }
      }
    }
    if (chosen) {
      const local = locals.get(chosen.localCandidateId);
      const remote = remotes.get(chosen.remoteCandidateId);
      if (local || remote) {
        const snapshot = {
          ts: Date.now(),
          state: chosen.state ?? null,
          nominated: Boolean(chosen.nominated),
          local: local
            ? {
                candidateType: local.candidateType ?? null,
                protocol: local.protocol ?? null,
                address: local.address ?? local.ip ?? null,
                port: local.port ?? null,
              }
            : null,
          remote: remote
            ? {
                candidateType: remote.candidateType ?? null,
                protocol: remote.protocol ?? null,
                address: remote.address ?? remote.ip ?? null,
                port: remote.port ?? null,
              }
            : null,
        };
        const prev = observedCandidatePairs[observedCandidatePairs.length - 1];
        if (!prev || JSON.stringify({ l: prev.local, r: prev.remote }) !== JSON.stringify({ l: snapshot.local, r: snapshot.remote })) {
          observedCandidatePairs.push(snapshot);
          console.error(`[werift-host] selected ICE pair: ${JSON.stringify(snapshot)}`);
        }
      }
    }
  } catch {
    // non-fatal telemetry
  }
  return report;
};

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-werift-device-host-"));
const serverId = `srv_device_${Date.now().toString(36)}`;
const daemonKeyPair = generateKeyPair();
const daemonPublicKeyB64 = exportPublicKey(daemonKeyPair.publicKey);
const credStore = new RelayDeviceCredentialStore(tempHome);

const lanPairing = credStore.issuePairingToken(10 * 60_000);
const relayPairing = credStore.issuePairingToken(10 * 60_000);
const fallbackPairing = credStore.issuePairingToken(10 * 60_000);

const stats = {
  lan: {
    modes: [],
    authCount: 0,
    rpcCount: 0,
    lastRpcMethod: null,
    lastRpcBytes: 0,
  },
  relay: {
    connections: [],
    hostUpgradedModes: [],
    upperSessionClosedCount: 0,
    rpcCount: 0,
    lastRpcMethod: null,
    lastRpcBytes: 0,
  },
  fallback: {
    connections: 0,
    abortSentCount: 0,
    rpcCount: 0,
    lastRpcMethod: null,
    lastRpcBytes: 0,
  },
};

function createSessionHandler(bucketName, options = {}) {
  const { rejectWebRtcOffers = false, onModeGetter } = options;
  return async (encryptedWs, metadata) => {
    encryptedWs.on("close", () => {
      if (bucketName === "relay") {
        stats.relay.upperSessionClosedCount += 1;
      }
    });

    encryptedWs.on("message", (raw) => {
      let msg;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }

      if (msg.type === "hello") {
        const auth = msg.relayDeviceAuth;
        const store = new RelayDeviceCredentialStore(tempHome);
        if (
          !auth ||
          auth.clientPublicKeyB64 !== metadata?.relayClientPublicKeyB64 ||
          auth.challenge !== metadata?.relayAuthChallenge
        ) {
          encryptedWs.close(4401, "Relay device auth channel binding failed");
          return;
        }

        let authenticatedDeviceId;
        if (auth.pairingToken) {
          const accepted = store.consumePairingToken(auth.pairingToken);
          if (!accepted) {
            encryptedWs.close(4401, "Invalid pairing token");
            return;
          }
          const issued = store.issueDevice(auth.deviceName || "android-device-test", auth.deviceId);
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

        if (bucketName === "lan") stats.lan.authCount += 1;
        metadata?.onAuthenticated?.(authenticatedDeviceId);
        encryptedWs.send(
          JSON.stringify({
            type: "session",
            message: {
              type: "status",
              payload: {
                status: "server_info",
                serverId,
                hostname: "WhaleIsle-Device-Test-Host",
                version: "1.0.3",
                capabilities: {},
              },
            },
          }),
        );
        return;
      }

      if (rejectWebRtcOffers && msg.type === "rtc_upgrade_offer" && typeof msg.attemptId === "string") {
        stats.fallback.abortSentCount += 1;
        console.error(`[werift-host] fallback: rejecting rtc_upgrade_offer attemptId=${msg.attemptId}`);
        encryptedWs.send(
          JSON.stringify({
            type: "rtc_upgrade_abort",
            attemptId: msg.attemptId,
            reason: "host_rejected_for_fallback_test",
          }),
        );
        return;
      }

      if (msg.type === "session" && msg.message?.type === "dshd.host.rpc.request") {
        const payloadStr = JSON.stringify(msg.message.payload ?? {});
        const byteLength = Buffer.byteLength(payloadStr, "utf8");
        const bucket = stats[bucketName];
        bucket.rpcCount += 1;
        bucket.lastRpcMethod = msg.message.method ?? null;
        bucket.lastRpcBytes = byteLength;

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
                  byteLength,
                  serverTransportMode: onModeGetter ? onModeGetter() : bucketName,
                },
              },
            },
          }),
        );
      }
    });
  };
}

// ---------------------------------------------------------------------------
// 1. Pure LAN Direct Server: real loopback /lan-ws + real mobile-web-server.js
// ---------------------------------------------------------------------------
const daemonHttp = http.createServer((_req, res) => {
  res.writeHead(404);
  res.end("not found");
});
const daemonMainWss = new WebSocketServer({ noServer: true, path: "/ws" });
daemonHttp.on("upgrade", (req, socket, head) => {
  const rawUrl = req.url ?? "/";
  const q = rawUrl.indexOf("?");
  const pathname = q !== -1 ? rawUrl.slice(0, q) : rawUrl;
  if (pathname === LAN_E2EE_WS_PATH) return;
  if (!daemonMainWss.shouldHandle(req)) {
    socket.write("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }
  daemonMainWss.handleUpgrade(req, socket, head, (ws) => daemonMainWss.emit("connection", ws, req));
});
await new Promise((resolve) => daemonHttp.listen(0, "127.0.0.1", resolve));
const daemonAddr = daemonHttp.address();

const lanTransport = startLanE2eeTransport({
  httpServer: daemonHttp,
  logger,
  serverId,
  daemonKeyPair,
  chisacodeHome: tempHome,
  daemonPublicKeyB64,
  requireDeviceAuth: true,
  onTransportModeChange: ({ mode }) => {
    stats.lan.modes.push(mode);
  },
  attachSocket: createSessionHandler("lan", { onModeGetter: () => "lan" }),
});

const mobileWebServer = createMobileWebServer({
  lanWsTarget: `ws://127.0.0.1:${daemonAddr.port}${LAN_E2EE_WS_PATH}`,
});
await new Promise((resolve) => mobileWebServer.listen(opts.lanPort, opts.bind, resolve));
const lanAddr = mobileWebServer.address();

// ---------------------------------------------------------------------------
// 2. Relay WS + Real werift@0.26.0 WebRTC Host Server (Cases 2 & 3)
// ---------------------------------------------------------------------------
const relayWss = new WebSocketServer({
  host: opts.bind,
  port: opts.relayPort,
  perMessageDeflate: false,
});
await new Promise((resolve) => relayWss.once("listening", resolve));
const relayAddr = relayWss.address();

relayWss.on("connection", (serverSideWs, req) => {
  const connIndex = stats.relay.connections.length;
  const connRecord = {
    index: connIndex,
    remoteAddress: req.socket?.remoteAddress ?? null,
    upgradedMode: null,
    upgradedAtMs: null,
    relayClosed: false,
    relayCloseCode: null,
    relayCloseReason: null,
    hostInitiatedCloseCode: null,
    hostInitiatedCloseReason: null,
    relayFramesAfterUpgrade: 0,
    relayOutboundFramesAfterUpgrade: 0,
  };
  stats.relay.connections.push(connRecord);

  // Wrap send & close to verify zero outbound Relay WS frames after cutover and exact close code/reason
  const originalSend = serverSideWs.send.bind(serverSideWs);
  serverSideWs.send = function trackedSend(...args) {
    if (connRecord.upgradedAtMs !== null) {
      connRecord.relayOutboundFramesAfterUpgrade += 1;
    }
    return originalSend(...args);
  };
  const originalClose = serverSideWs.close.bind(serverSideWs);
  serverSideWs.close = function trackedClose(code, reason) {
    if (connRecord.hostInitiatedCloseCode === null) {
      connRecord.hostInitiatedCloseCode = code ?? null;
      connRecord.hostInitiatedCloseReason = reason !== undefined ? String(reason) : null;
    }
    return originalClose(code, reason);
  };

  serverSideWs.on("message", () => {
    if (connRecord.upgradedAtMs !== null) {
      connRecord.relayFramesAfterUpgrade += 1;
    }
  });
  serverSideWs.on("close", (code, reason) => {
    connRecord.relayClosed = true;
    connRecord.relayCloseCode = code;
    connRecord.relayCloseReason = reason.toString("utf8");
    console.error(
      `[werift-host] relay conn#${connIndex} closed: code=${code} reason=${connRecord.relayCloseReason}`,
    );
  });

  const detectFn =
    opts.extraHostIps.length > 0
      ? async () => {
          const detected = await detectHostCandidates();
          return {
            ipv4: Array.from(new Set([...detected.ipv4, ...opts.extraHostIps])),
            ipv6: detected.ipv6,
            blockedHostIps: detected.blockedHostIps,
          };
        }
      : detectHostCandidates;

  void attachEncryptedSocket(
    serverSideWs,
    daemonKeyPair,
    logger,
    createSessionHandler("relay", {
      onModeGetter: () => connRecord.upgradedMode ?? "relay",
    }),
    {
      transport: "relay",
      requireDeviceAuth: true,
      chisacodeHome: tempHome,
      daemonPublicKeyB64,
      serverId,
    },
    {
      connectionId: `device-rtc-${connIndex}`,
      iceServers,
      detectHostCandidates: detectFn,
      onTransportModeChange: (mode) => {
        connRecord.upgradedMode = mode;
        connRecord.upgradedAtMs = Date.now();
        stats.relay.hostUpgradedModes.push(mode);
        console.error(`[werift-host] relay conn#${connIndex} upgraded to mode=${mode}`);
      },
    },
  );
});

// ---------------------------------------------------------------------------
// 3. Fallback Relay Server (Case 4: WebRTC explicitly rejected via rtc_upgrade_abort)
// ---------------------------------------------------------------------------
const fallbackWss = new WebSocketServer({
  host: opts.bind,
  port: opts.fallbackPort,
  perMessageDeflate: false,
});
await new Promise((resolve) => fallbackWss.once("listening", resolve));
const fallbackAddr = fallbackWss.address();

fallbackWss.on("connection", (serverSideWs) => {
  stats.fallback.connections += 1;
  void attachEncryptedSocket(
    serverSideWs,
    daemonKeyPair,
    logger,
    createSessionHandler("fallback", {
      rejectWebRtcOffers: true,
      onModeGetter: () => "relay",
    }),
    {
      transport: "relay",
      requireDeviceAuth: true,
      chisacodeHome: tempHome,
      daemonPublicKeyB64,
      serverId,
    },
    {
      connectionId: `device-fallback-${stats.fallback.connections}`,
      enableWebRtcUpgrade: false,
    },
  );
});

// ---------------------------------------------------------------------------
// 4. Optional local TURN-over-TCP bridge + Control HTTP Server
// ---------------------------------------------------------------------------
const detectedHost = await detectHostCandidates();
let turnBridge = null;
let clientIceServers = iceServers;
if (opts.enableTurnBridge) {
  const relayIp = detectedHost.ipv4[0] || "127.0.0.1";
  turnBridge = await startTurnTcpBridge({
    bindHost: "127.0.0.1",
    port: opts.turnPort,
    relayIp,
    verbose: opts.verbose,
  });
  clientIceServers = [
    {
      urls: `turn:127.0.0.1:${turnBridge.port}?transport=tcp`,
      username: turnBridge.username,
      credential: turnBridge.credential,
    },
  ];
  // Host (werift) connects directly via local LAN UDP to the TURN bridge's allocated UDP socket.
  iceServers = [];
}

const infoPayload = () => ({
  serverId,
  daemonPublicKeyB64,
  lanPort: lanAddr.port,
  relayPort: relayAddr.port,
  fallbackPort: fallbackAddr.port,
  turnPort: turnBridge ? turnBridge.port : null,
  lanPairingToken: lanPairing.token,
  relayPairingToken: relayPairing.token,
  fallbackPairingToken: fallbackPairing.token,
  iceServers: clientIceServers,
  hostIps: detectedHost.ipv4,
});

const controlServer = http.createServer((req, res) => {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  res.setHeader("content-type", "application/json; charset=utf-8");
  if (req.method === "GET" && url.pathname === "/info") {
    res.end(JSON.stringify(infoPayload()));
    return;
  }
  if (req.method === "GET" && url.pathname === "/stats") {
    res.end(
      JSON.stringify({
        ...stats,
        observedCandidatePairs,
      }),
    );
    return;
  }
  if (req.method === "POST" && url.pathname === "/issue-token") {
    const issued = credStore.issuePairingToken(10 * 60_000);
    res.end(JSON.stringify({ token: issued.token, expiresAtMs: issued.expiresAtMs }));
    return;
  }
  res.writeHead(404);
  res.end(JSON.stringify({ error: "not_found" }));
});
await new Promise((resolve) => controlServer.listen(opts.controlPort, opts.bind, resolve));
const controlAddr = controlServer.address();

const readyInfo = {
  ready: true,
  controlPort: controlAddr.port,
  ...infoPayload(),
};
process.stdout.write(`${JSON.stringify(readyInfo)}\n`);

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    await lanTransport.stop();
  } catch {}
  try {
    await turnBridge?.stop();
  } catch {}
  for (const wss of [daemonMainWss, relayWss, fallbackWss]) {
    try {
      for (const client of wss.clients) client.terminate();
      wss.close();
    } catch {}
  }
  for (const srv of [controlServer, mobileWebServer, daemonHttp]) {
    try {
      srv.closeAllConnections?.();
      await new Promise((resolve) => srv.close(() => resolve()));
    } catch {}
  }
  try {
    fs.rmSync(tempHome, { recursive: true, force: true });
  } catch {}
  process.exit(0);
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
