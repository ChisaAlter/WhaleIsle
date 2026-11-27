/// <reference lib="dom" />
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";
import type pino from "pino";
import {
  createDaemonChannel,
  type EncryptedChannel,
  type Transport as RelayTransport,
  type KeyPair,
  type RelayAuthKeyPair,
  exportRelayAuthPublicKey,
  signRelayServerAuth,
} from "@chisacode/relay/e2ee";
import { buildRelayWebSocketUrl } from "@chisacode/protocol/daemon-endpoints";
import type { IceServerConfig } from "@chisacode/protocol/connection-offer";
import {
  isRtcUpgradeMessageType,
  type TransportMode,
} from "@chisacode/protocol/webrtc-signaling";
import type { ExternalSocketMetadata } from "./websocket-server.js";
import { WEBSOCKET_MAX_PAYLOAD_BYTES } from "./websocket-limits.js";
import {
  WebRtcHostSessionController,
  type DetectedHostCandidates,
} from "./webrtc-host.js";

interface RelayTransportOptions {
  logger: pino.Logger;
  attachSocket: (ws: RelaySocketLike, metadata?: ExternalSocketMetadata) => Promise<void>;
  relayEndpoint: string; // "host:port"
  relayUseTls: boolean;
  serverId: string;
  daemonKeyPair?: KeyPair;
  daemonRelayAuthKeyPair?: RelayAuthKeyPair;
  createWebSocket?: RelayWebSocketFactory;
  chisacodeHome?: string;
  daemonPublicKeyB64?: string;
  /**
   * When true, reject relay hellos without device auth. Defaults true.
   */
  requireDeviceAuth?: boolean;
  iceServers?: readonly IceServerConfig[];
  enableWebRtcUpgrade?: boolean;
  onTransportModeChange?: (info: { connectionId: string; mode: TransportMode }) => void;
}

export interface RelayTransportController {
  stop: () => Promise<void>;
}

export interface RelaySocketLike {
  readyState: number;
  send: (data: string | Uint8Array | ArrayBuffer) => void;
  close: (code?: number, reason?: string) => void;
  on: (event: "message" | "close" | "error", listener: (...args: unknown[]) => void) => void;
  once: (event: "close" | "error", listener: (...args: unknown[]) => void) => void;
}

export interface AttachEncryptedSocketOptions {
  connectionId?: string;
  initialMode?: TransportMode;
  handshakeTimeoutMs?: number;
  iceServers?: readonly IceServerConfig[];
  enableWebRtcUpgrade?: boolean;
  onTransportModeChange?: (mode: TransportMode) => void;
  detectHostCandidates?: () => Promise<DetectedHostCandidates>;
}

interface RelayWebSocketLike extends RelaySocketLike {
  terminate: () => void;
  ping: () => void;
  on: (
    event: "open" | "message" | "close" | "error" | "pong",
    listener: (...args: unknown[]) => void,
  ) => void;
}

interface RelayWebSocketFactoryOptions {
  readonly handshakeTimeout: number;
  readonly perMessageDeflate: false;
  readonly maxPayload?: number;
}

type RelayWebSocketFactory = (
  url: string,
  options: RelayWebSocketFactoryOptions,
) => RelayWebSocketLike;

type ControlMessage =
  | { type: "sync"; connectionIds: string[] }
  | { type: "connected"; connectionId: string }
  | { type: "disconnected"; connectionId: string }
  | { type: "ping" }
  | { type: "pong" };

const CONTROL_PING_INTERVAL_MS = 10_000;
const CONTROL_STALE_TIMEOUT_MS = 30_000;
const CONTROL_READY_TIMEOUT_MS = 8_000;
const MAX_RELAY_CONNECTION_IDS = 256;
const MAX_RELAY_CONNECTION_ID_LENGTH = 128;
const MAX_RELAY_SYNC_CONNECTION_IDS_INSPECTED = 512;
const RELAY_CONNECTION_ID_PATTERN = /^[A-Za-z0-9_-]+$/u;
const RELAY_CONTROL_MAX_PAYLOAD_BYTES = 64 * 1024;
const RELAY_ENCRYPTION_BINARY_OVERHEAD_BYTES = 24 + 16;

/**
 * Returns the UTF-8 byte length of the relay's base64 ciphertext frame for a plaintext payload.
 * The E2EE codec prepends a 24-byte nonce, adds a 16-byte Poly1305 authenticator, then base64
 * encodes the binary bundle for WebSocket text compatibility.
 * @param plaintextBytes Plaintext payload byte length
 * @returns Encrypted base64 WebSocket frame byte length
 */
export function getRelayEncryptedPayloadBytes(plaintextBytes: number): number {
  const encryptedBytes = plaintextBytes + RELAY_ENCRYPTION_BINARY_OVERHEAD_BYTES;
  return 4 * Math.ceil(encryptedBytes / 3);
}

/** Maximum relay wire frame for one allowed encrypted plaintext WebSocket payload. */
export const RELAY_DATA_MAX_PAYLOAD_BYTES = getRelayEncryptedPayloadBytes(
  WEBSOCKET_MAX_PAYLOAD_BYTES,
);

const RELAY_WEBSOCKET_BASE_OPTIONS = {
  handshakeTimeout: 10_000,
  perMessageDeflate: false,
} as const;
const RELAY_DATA_WEBSOCKET_OPTIONS: RelayWebSocketFactoryOptions = {
  ...RELAY_WEBSOCKET_BASE_OPTIONS,
  maxPayload: RELAY_DATA_MAX_PAYLOAD_BYTES,
};
const RELAY_CONTROL_WEBSOCKET_OPTIONS: RelayWebSocketFactoryOptions = {
  ...RELAY_WEBSOCKET_BASE_OPTIONS,
  maxPayload: RELAY_CONTROL_MAX_PAYLOAD_BYTES,
};

function createDefaultRelayWebSocket(
  url: string,
  options: RelayWebSocketFactoryOptions,
): RelayWebSocketLike {
  return new WebSocket(url, options);
}

function normalizeRelaySendPayload(data: string | Uint8Array | ArrayBuffer): string | ArrayBuffer {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return data;
  if (ArrayBuffer.isView(data)) {
    const view = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    const out = new Uint8Array(view.byteLength);
    out.set(view);
    return out.buffer;
  }
  return String(data);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeRelayConnectionId(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const connectionId = value.trim();
  if (
    connectionId.length === 0 ||
    connectionId.length > MAX_RELAY_CONNECTION_ID_LENGTH ||
    !RELAY_CONNECTION_ID_PATTERN.test(connectionId)
  ) {
    return null;
  }
  return connectionId;
}

function tryParseControlMessage(raw: unknown): ControlMessage | null {
  try {
    let text: string;
    if (typeof raw === "string") {
      text = raw;
    } else if (Buffer.isBuffer(raw)) {
      text = raw.toString("utf8");
    } else {
      text = String(raw);
    }
    const parsed = JSON.parse(text);
    if (!isRecord(parsed)) return null;
    if (parsed.type === "ping") return { type: "ping" };
    if (parsed.type === "pong") return { type: "pong" };
    if (parsed.type === "sync" && Array.isArray(parsed.connectionIds)) {
      const connectionIds: string[] = [];
      const seenConnectionIds = new Set<string>();
      const inspectionLimit = Math.min(
        parsed.connectionIds.length,
        MAX_RELAY_SYNC_CONNECTION_IDS_INSPECTED,
      );
      for (let index = 0; index < inspectionLimit; index += 1) {
        const value = parsed.connectionIds[index];
        const connectionId = normalizeRelayConnectionId(value);
        if (!connectionId || seenConnectionIds.has(connectionId)) {
          continue;
        }
        seenConnectionIds.add(connectionId);
        connectionIds.push(connectionId);
        if (connectionIds.length >= MAX_RELAY_CONNECTION_IDS) {
          break;
        }
      }
      return { type: "sync", connectionIds };
    }
    if (parsed.type === "connected") {
      const connectionId = normalizeRelayConnectionId(parsed.connectionId);
      return connectionId ? { type: "connected", connectionId } : null;
    }
    if (parsed.type === "disconnected") {
      const connectionId = normalizeRelayConnectionId(parsed.connectionId);
      return connectionId ? { type: "disconnected", connectionId } : null;
    }
    return null;
  } catch {
    return null;
  }
}

export function startRelayTransport({
  logger,
  attachSocket,
  relayEndpoint,
  relayUseTls,
  serverId,
  daemonKeyPair,
  daemonRelayAuthKeyPair,
  createWebSocket = createDefaultRelayWebSocket,
  chisacodeHome,
  daemonPublicKeyB64,
  requireDeviceAuth = true,
  iceServers,
  enableWebRtcUpgrade = true,
  onTransportModeChange,
}: RelayTransportOptions): RelayTransportController {
  const relayLogger = logger.child({ module: "relay-transport" });

  let stopped = false;
  let controlWs: RelayWebSocketLike | null = null;
  let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  let reconnectAttempt = 0;
  const dataSockets = new Map<string, RelayWebSocketLike>(); // connectionId -> ws
  let controlKeepaliveInterval: ReturnType<typeof setInterval> | null = null;
  let controlReadyTimeout: ReturnType<typeof setTimeout> | null = null;
  let controlLastSeenAt = 0;
  let controlConnectionSeq = 0;
  let dataSocketCapacityWarningEmitted = false;

  const resetDataSocketCapacityWarning = (): void => {
    if (dataSockets.size < MAX_RELAY_CONNECTION_IDS) {
      dataSocketCapacityWarningEmitted = false;
    }
  };

  const stop = async (): Promise<void> => {
    stopped = true;
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout);
      reconnectTimeout = null;
    }
    if (controlKeepaliveInterval) {
      clearInterval(controlKeepaliveInterval);
      controlKeepaliveInterval = null;
    }
    if (controlReadyTimeout) {
      clearTimeout(controlReadyTimeout);
      controlReadyTimeout = null;
    }
    if (controlWs) {
      try {
        controlWs.close();
      } catch {
        // ignore
      }
      controlWs = null;
    }
    for (const ws of dataSockets.values()) {
      try {
        ws.close();
      } catch {
        // ignore
      }
    }
    dataSockets.clear();
  };

  const connectControl = (): void => {
    if (stopped) return;

    const connectionId = ++controlConnectionSeq;
    const url = buildRelayWebSocketUrl({
      endpoint: relayEndpoint,
      useTls: relayUseTls,
      serverId,
      role: "server",
      relayAuth: daemonRelayAuthKeyPair
        ? createRelayAuthQuery({
            keyPair: daemonRelayAuthKeyPair,
            serverId,
            connectionId: "",
          })
        : undefined,
    });
    const socket = createWebSocket(url, RELAY_CONTROL_WEBSOCKET_OPTIONS);
    controlWs = socket;
    let controlConnected = false;

    const markControlReady = () => {
      if (controlWs !== socket) return;
      if (controlConnected) return;
      controlConnected = true;
      reconnectAttempt = 0;
      if (controlReadyTimeout) {
        clearTimeout(controlReadyTimeout);
        controlReadyTimeout = null;
      }
      relayLogger.info({ connectionId }, "relay_control_connected");
    };

    socket.on("open", () => {
      if (controlWs !== socket) return;

      controlLastSeenAt = Date.now();
      if (controlKeepaliveInterval) {
        clearInterval(controlKeepaliveInterval);
        controlKeepaliveInterval = null;
      }
      if (controlReadyTimeout) {
        clearTimeout(controlReadyTimeout);
        controlReadyTimeout = null;
      }
      controlReadyTimeout = setTimeout(() => {
        if (stopped) return;
        if (controlWs !== socket) return;
        if (controlConnected) return;
        relayLogger.warn(
          { url, connectionId, waitedMs: CONTROL_READY_TIMEOUT_MS },
          "relay_control_ready_timeout_terminating",
        );
        try {
          socket.terminate();
        } catch {
          // ignore
        }
      }, CONTROL_READY_TIMEOUT_MS);
      controlKeepaliveInterval = setInterval(() => {
        if (stopped) return;
        if (controlWs !== socket) return;
        if (socket.readyState !== WebSocket.OPEN) return;

        const now = Date.now();
        const staleForMs = now - controlLastSeenAt;
        // If the control socket is half-open or silently dropped, ws may never emit "close".
        // Use a WebSocket protocol ping to detect staleness and force a reconnect.
        // Cloudflare's runtime auto-responds to protocol pings at the edge without waking the
        // hibernated relay Durable Object, so this keepalive does not incur DO CPU billing.
        if (staleForMs > CONTROL_STALE_TIMEOUT_MS) {
          relayLogger.warn(
            { url, staleForMs, connectionId, staleTimeoutMs: CONTROL_STALE_TIMEOUT_MS },
            "relay_control_stale_terminating",
          );
          try {
            socket.terminate();
          } catch {
            // ignore
          }
          return;
        }

        try {
          socket.ping();
        } catch (error) {
          relayLogger.warn({ err: error, connectionId }, "relay_control_ping_send_failed");
          try {
            socket.terminate();
          } catch {
            // ignore
          }
        }
      }, CONTROL_PING_INTERVAL_MS);
      try {
        socket.ping();
      } catch (error) {
        relayLogger.warn({ err: error, connectionId }, "relay_control_ping_send_failed");
        try {
          socket.terminate();
        } catch {
          // ignore
        }
      }
      relayLogger.debug({ connectionId }, "relay_control_open_waiting_for_ready");
    });

    socket.on("close", (code, reason) => {
      if (controlWs !== socket) return;
      relayLogger.warn(
        { code, reason: reason?.toString?.(), url, connectionId },
        "relay_control_disconnected",
      );
      controlWs = null;
      if (controlKeepaliveInterval) {
        clearInterval(controlKeepaliveInterval);
        controlKeepaliveInterval = null;
      }
      if (controlReadyTimeout) {
        clearTimeout(controlReadyTimeout);
        controlReadyTimeout = null;
      }
      scheduleReconnect();
    });

    socket.on("error", (err) => {
      if (controlWs !== socket) return;
      relayLogger.warn({ err, connectionId }, "relay_error");
      // close event will schedule reconnect
    });

    socket.on("pong", () => {
      if (controlWs !== socket) return;
      controlLastSeenAt = Date.now();
      relayLogger.debug({ connectionId }, "relay_control_pong_received");
    });

    socket.on("message", (data) => {
      if (controlWs !== socket) return;
      controlLastSeenAt = Date.now();
      const msg = tryParseControlMessage(data);
      if (msg) {
        markControlReady();
      }
      if (!msg) return;
      if (msg.type === "ping") {
        try {
          socket.send(JSON.stringify({ type: "pong", ts: Date.now() }));
        } catch {
          // ignore
        }
        return;
      }
      if (msg.type === "pong") return;
      if (msg.type === "sync") {
        for (const clientConnectionId of msg.connectionIds) {
          ensureClientDataSocket(clientConnectionId);
        }
        return;
      }
      if (msg.type === "connected") {
        ensureClientDataSocket(msg.connectionId);
        return;
      }
      if (msg.type === "disconnected") {
        const existing = dataSockets.get(msg.connectionId);
        if (existing) {
          try {
            existing.close(1001, "Client disconnected");
          } catch {
            // ignore
          }
        }
      }
    });
  };

  const scheduleReconnect = (): void => {
    if (stopped) return;
    if (reconnectTimeout) return;

    reconnectAttempt += 1;
    const delayMs = Math.min(30000, 1000 * reconnectAttempt);
    reconnectTimeout = setTimeout(() => {
      reconnectTimeout = null;
      connectControl();
    }, delayMs);
  };

  const ensureClientDataSocket = (connectionId: string): void => {
    if (stopped) return;
    if (!connectionId) return;
    if (dataSockets.has(connectionId)) return;
    if (dataSockets.size >= MAX_RELAY_CONNECTION_IDS) {
      if (!dataSocketCapacityWarningEmitted) {
        dataSocketCapacityWarningEmitted = true;
        relayLogger.warn(
          {
            connectionCount: dataSockets.size,
            maxConnectionIds: MAX_RELAY_CONNECTION_IDS,
          },
          "relay_data_socket_capacity_reached",
        );
      }
      return;
    }

    const url = buildRelayWebSocketUrl({
      endpoint: relayEndpoint,
      useTls: relayUseTls,
      serverId,
      role: "server",
      connectionId,
      relayAuth: daemonRelayAuthKeyPair
        ? createRelayAuthQuery({
            keyPair: daemonRelayAuthKeyPair,
            serverId,
            connectionId,
          })
        : undefined,
    });
    const socket = createWebSocket(url, RELAY_DATA_WEBSOCKET_OPTIONS);
    dataSockets.set(connectionId, socket);

    let attached = false;
    const openTimeout = setTimeout(() => {
      if (stopped) return;
      if (socket.readyState === WebSocket.OPEN) return;
      relayLogger.warn({ connectionId }, "relay_data_open_timeout_terminating");
      try {
        socket.terminate();
      } catch {
        // ignore
      }
    }, 15_000);

    socket.on("open", () => {
      clearTimeout(openTimeout);
      relayLogger.info({ connectionId }, "relay_data_connected");
      if (attached) return;
      attached = true;
      const externalMetadata: ExternalSocketMetadata = {
        transport: "relay",
        externalSessionKey: `session:${connectionId}`,
        requireDeviceAuth,
        chisacodeHome,
        daemonPublicKeyB64,
        serverId,
      };
      if (daemonKeyPair) {
        const connLogger = relayLogger.child({ connectionId });
        connLogger.info({ connectionId, mode: "relay" }, "remote_client_transport_mode");
        onTransportModeChange?.({ connectionId, mode: "relay" });
        void attachEncryptedSocket(
          socket,
          daemonKeyPair,
          connLogger,
          attachSocket,
          externalMetadata,
          {
            connectionId,
            initialMode: "relay",
            iceServers,
            enableWebRtcUpgrade,
            onTransportModeChange: (mode) => {
              connLogger.info({ connectionId, mode }, "remote_client_transport_mode");
              onTransportModeChange?.({ connectionId, mode });
            },
          },
        );
      } else {
        void attachSocket(socket, externalMetadata);
      }
    });

    socket.on("close", (code, reason) => {
      clearTimeout(openTimeout);
      relayLogger.warn(
        { code, reason: reason?.toString?.(), url, connectionId },
        "relay_data_disconnected",
      );
      if (dataSockets.get(connectionId) === socket) {
        dataSockets.delete(connectionId);
        resetDataSocketCapacityWarning();
      }
    });

    socket.on("error", (err) => {
      relayLogger.warn({ err, connectionId }, "relay_data_error");
    });
  };

  connectControl();

  return { stop };
}

function createRelayAuthQuery(params: {
  readonly keyPair: RelayAuthKeyPair;
  readonly serverId: string;
  readonly connectionId: string;
}): {
  readonly publicKeyB64: string;
  readonly nonce: string;
  readonly issuedAt: number;
  readonly signatureB64: string;
} {
  const nonce = randomUUID();
  const issuedAt = Date.now();
  return {
    publicKeyB64: exportRelayAuthPublicKey(params.keyPair.publicKey),
    nonce,
    issuedAt,
    signatureB64: signRelayServerAuth({
      secretKey: params.keyPair.secretKey,
      serverId: params.serverId,
      role: "server",
      connectionId: params.connectionId,
      nonce,
      issuedAt,
    }),
  };
}

function tryExtractRtcUpgradeSignaling(data: string | ArrayBuffer): Record<string, unknown> | null {
  if (typeof data !== "string") return null;
  if (!data.includes("rtc_upgrade_")) return null;
  try {
    const parsed: unknown = JSON.parse(data);
    if (isRecord(parsed) && isRtcUpgradeMessageType(parsed.type)) {
      return parsed;
    }
  } catch {
    // Not valid JSON; let normal handler deal with it.
  }
  return null;
}

function isPositiveRelayDeviceAuthResult(data: string | ArrayBuffer): boolean {
  if (typeof data !== "string" || !data.includes("relay_device_auth_result")) {
    return false;
  }
  try {
    const parsed: unknown = JSON.parse(data);
    return (
      isRecord(parsed) &&
      parsed.type === "relay_device_auth_result" &&
      parsed.ok === true
    );
  } catch {
    return false;
  }
}

const DEFAULT_E2EE_HANDSHAKE_TIMEOUT_MS = 15_000;

async function createDaemonChannelWithTimeout(
  relayTransport: RelayTransport,
  daemonKeyPair: KeyPair,
  callbacks: Parameters<typeof createDaemonChannel>[2],
  socket: RelayWebSocketLike,
  handshakeTimeoutMs: number,
  onTimeout: () => void,
): Promise<EncryptedChannel> {
  if (!(handshakeTimeoutMs > 0) || !Number.isFinite(handshakeTimeoutMs)) {
    return createDaemonChannel(relayTransport, daemonKeyPair, callbacks);
  }
  let timer: ReturnType<typeof setTimeout> | null = null;
  const handshakePromise = createDaemonChannel(relayTransport, daemonKeyPair, callbacks);
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      onTimeout();
      try {
        socket.close(1008, "E2EE handshake timeout");
      } catch {
        // ignore close errors
      }
      reject(new Error(`E2EE handshake timed out after ${handshakeTimeoutMs}ms`));
    }, handshakeTimeoutMs);
    timer.unref?.();
  });
  try {
    return await Promise.race([handshakePromise, timeoutPromise]);
  } finally {
    if (timer !== null) {
      clearTimeout(timer);
    }
    // Avoid unhandled rejection if handshake settles after timeout rejection.
    void handshakePromise.catch(() => {});
  }
}

export async function attachEncryptedSocket(
  socket: RelayWebSocketLike,
  daemonKeyPair: KeyPair,
  logger: pino.Logger,
  attachSocket: (ws: RelaySocketLike, metadata?: ExternalSocketMetadata) => Promise<void>,
  metadata?: ExternalSocketMetadata,
  upgradeOptions?: AttachEncryptedSocketOptions,
): Promise<void> {
  let rtcController: WebRtcHostSessionController | null = null;
  let handshakeTimedOut = false;
  const connectionId = upgradeOptions?.connectionId;
  try {
    const relayTransport = createRelayTransportAdapter(socket, logger);
    const emitter = new EventEmitter();
    const pendingMessages: Array<string | ArrayBuffer> = [];
    let attached = false;
    const emitMessage = (data: string | ArrayBuffer) => {
      const signaling = tryExtractRtcUpgradeSignaling(data);
      if (signaling && rtcController) {
        rtcController.handleSignalingMessage(signaling);
        return;
      }
      if (attached) {
        emitter.emit("message", data);
        return;
      }
      pendingMessages.push(data);
    };
    let closeFinalized = false;
    const finalizeClose = (code?: number, reason?: string) => {
      if (closeFinalized) {
        return;
      }
      closeFinalized = true;
      rtcController?.dispose();
      rtcController = null;
      if (connectionId) {
        logger.info({ connectionId, code, reason }, "remote_client_disconnected");
      }
      emitter.emit("close", code, reason);
    };
    const channel = await createDaemonChannelWithTimeout(
      relayTransport,
      daemonKeyPair,
      {
        onmessage: emitMessage,
        onclose: finalizeClose,
        onerror: (error) => {
          logger.warn({ err: error }, "relay_e2ee_error");
          emitter.emit("error", error);
        },
      },
      socket,
      upgradeOptions?.handshakeTimeoutMs ?? DEFAULT_E2EE_HANDSHAKE_TIMEOUT_MS,
      () => {
        handshakeTimedOut = true;
      },
    );
    if (upgradeOptions?.enableWebRtcUpgrade !== false) {
      rtcController = new WebRtcHostSessionController({
        channel,
        logger,
        iceServers: upgradeOptions?.iceServers,
        onTransportModeChange: upgradeOptions?.onTransportModeChange,
        detectHostCandidates: upgradeOptions?.detectHostCandidates,
      });
    }
    const encryptedSocket = createEncryptedSocket(
      channel,
      emitter,
      () => {
        rtcController?.markAuthenticated();
      },
      finalizeClose,
    );
    const securityContext = channel.getSecurityContext();
    const boundMetadata: ExternalSocketMetadata | undefined = metadata
      ? {
          ...metadata,
          ...(securityContext
            ? {
                relayClientPublicKeyB64: securityContext.clientPublicKeyB64,
                relayAuthChallenge: securityContext.authChallenge,
              }
            : {}),
          onAuthenticated: (deviceId) => {
            rtcController?.markAuthenticated();
            metadata.onAuthenticated?.(deviceId);
          },
        }
      : undefined;
    await attachSocket(encryptedSocket, boundMetadata);
    attached = true;
    for (const message of pendingMessages) {
      const signaling = tryExtractRtcUpgradeSignaling(message);
      if (signaling && rtcController) {
        rtcController.handleSignalingMessage(signaling);
        continue;
      }
      emitter.emit("message", message);
    }
    pendingMessages.length = 0;
  } catch (error) {
    rtcController?.dispose();
    rtcController = null;
    logger.warn({ err: error }, "relay_e2ee_handshake_failed");
    if (!handshakeTimedOut) {
      try {
        socket.close(1011, "E2EE handshake failed");
      } catch {
        // ignore
      }
    }
  }
}

function createRelayTransportAdapter(
  socket: RelayWebSocketLike,
  logger: pino.Logger,
): RelayTransport {
  const relayTransport: RelayTransport = {
    send: (data) => {
      try {
        socket.send(data);
      } catch (err) {
        // Socket likely transitioned to closed between checks; let onclose/onerror
        // drive cleanup. Without this guard the synchronous throw would propagate
        // up as an uncaughtException and take down the daemon.
        logger.warn({ err }, "relay_socket_send_failed");
      }
    },
    close: (code?: number, reason?: string) => socket.close(code, reason),
    onmessage: null,
    onclose: null,
    onerror: null,
  };

  socket.on("message", (data, isBinary) => {
    relayTransport.onmessage?.(normalizeMessageData(data, isBinary === true));
  });
  socket.on("close", (code, reason) => {
    const closeCode = typeof code === "number" ? code : 1006;
    relayTransport.onclose?.(closeCode, String(reason ?? ""));
  });
  socket.on("error", (err) => {
    relayTransport.onerror?.(err instanceof Error ? err : new Error(String(err)));
  });

  return relayTransport;
}

function createEncryptedSocket(
  channel: EncryptedChannel,
  emitter: EventEmitter,
  onAuthResultSent?: () => void,
  onClose?: (code?: number, reason?: string) => void,
): RelaySocketLike {
  let readyState = 1;

  channel.setState("open");

  const close = (code?: number, reason?: string) => {
    if (readyState === 3) return;
    readyState = 3;
    channel.close(code, reason);
    onClose?.(code, reason);
  };

  emitter.on("close", () => {
    if (readyState === 3) return;
    readyState = 3;
  });

  return {
    get readyState() {
      return readyState;
    },
    send: (data) => {
      const outbound = normalizeRelaySendPayload(data);
      if (onAuthResultSent && isPositiveRelayDeviceAuthResult(outbound)) {
        onAuthResultSent();
      }
      void channel.send(outbound).catch((error) => {
        emitter.emit("error", error);
      });
    },
    close,
    on: (event, listener) => {
      emitter.on(event, listener);
    },
    once: (event, listener) => {
      emitter.once(event, listener);
    },
  };
}

function normalizeMessageData(data: unknown, isBinary: boolean): string | ArrayBuffer {
  if (!isBinary) {
    if (typeof data === "string") return data;
    const buffer = bufferFromWsData(data);
    if (buffer) return buffer.toString("utf8");
    return String(data);
  }

  if (data instanceof ArrayBuffer) return data;

  const buffer = bufferFromWsData(data);
  if (buffer) {
    const view = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const out = new Uint8Array(view.byteLength);
    out.set(view);
    return out.buffer;
  }

  return String(data);
}

function bufferFromWsData(data: unknown): Buffer | null {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) {
    const buffers: Buffer[] = [];
    for (const part of data) {
      if (Buffer.isBuffer(part)) {
        buffers.push(part);
      } else if (part instanceof ArrayBuffer) {
        buffers.push(Buffer.from(part));
      } else if (ArrayBuffer.isView(part)) {
        buffers.push(Buffer.from(part.buffer, part.byteOffset, part.byteLength));
      } else if (typeof part === "string") {
        buffers.push(Buffer.from(part, "utf8"));
      } else {
        return null;
      }
    }
    return Buffer.concat(buffers);
  }
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  }
  return null;
}
