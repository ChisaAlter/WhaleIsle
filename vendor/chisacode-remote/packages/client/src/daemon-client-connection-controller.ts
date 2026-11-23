import { CLIENT_CAPS } from "@chisacode/protocol/client-capabilities";
import {
  SessionInboundMessageSchema,
  type SessionInboundMessage,
} from "@chisacode/protocol/messages";
import { isRelayClientWebSocketUrl } from "@chisacode/protocol/daemon-endpoints";

import {
  createAdaptiveTransportFactory,
  createWebSocketTransportFactory,
  defaultWebSocketFactory,
  describeTransportClose,
  describeTransportError,
  type DaemonTransport,
  type DaemonTransportFactory,
  type IceServerConfig,
  type RtcPeerConnectionFactory,
  type TransportMode,
  type WebSocketFactory,
} from "./daemon-client-transport.js";
import { computeClientRelayDeviceAuthProof } from "./relay-device-credentials.js";

const DEFAULT_RECONNECT_BASE_DELAY_MS = 1_500;
const DEFAULT_RECONNECT_MAX_DELAY_MS = 30_000;
const DEFAULT_CONNECT_TIMEOUT_MS = 15_000;
const DEFAULT_LIVENESS_TIMEOUT_MS = 5_000;
const LIVENESS_FAILURE_RECONNECT_THRESHOLD = 2;

const perfNow: () => number =
  typeof performance !== "undefined" && typeof performance.now === "function"
    ? () => performance.now()
    : () => Date.now();

/** Logging contract used by the daemon client and connection controller. */
export interface Logger {
  debug(obj: object, msg?: string): void;
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

/** Observable connection lifecycle state for a daemon client. */
export type ConnectionState =
  | { status: "idle" }
  | { status: "connecting"; attempt: number }
  | { status: "connected" }
  | { status: "disconnected"; reason?: string }
  | { status: "disposed" };

/** Configuration for constructing and reconnecting a daemon transport. */
export interface DaemonClientConfig {
  url: string;
  clientId: string;
  clientType?: "mobile" | "browser" | "cli" | "mcp";
  appVersion?: string;
  runtimeGeneration?: number | null;
  password?: string;
  authHeader?: string;
  suppressSendErrors?: boolean;
  transportFactory?: DaemonTransportFactory;
  webSocketFactory?: WebSocketFactory;
  logger?: Logger;
  connectTimeoutMs?: number;
  e2ee?: {
    enabled?: boolean;
    daemonPublicKeyB64?: string;
  };
  /**
   * Relay device credential material; proof fields are derived from the live E2EE channel.
   * `deviceName` rides the first-pairing payload as the client-reported operator label.
   */
  relayDeviceAuth?: {
    version: 1;
    serverId: string;
    deviceId: string;
    deviceSecret?: string;
    pairingToken?: string;
    deviceName?: string;
  };
  /**
   * Called when daemon issues a device secret after first pairing.
   */
  onRelayDeviceAuthResult?: (result: {
    ok: boolean;
    deviceId?: string;
    deviceSecret?: string;
    reason?: string;
    securityLevel?: "v2" | "legacy";
  }) => void;
  reconnect?: {
    enabled?: boolean;
    baseDelayMs?: number;
    maxDelayMs?: number;
  };
  /** Optional LAN host:port endpoints tried directly before falling back to relay. */
  lanEndpoints?: string[];
  /** Whether direct LAN WebSocket connections use TLS (default false). */
  lanUseTls?: boolean;
  /** Optional ICE servers (STUN/TURN) for in-band WebRTC upgrade. */
  iceServers?: IceServerConfig[];
  /** Optional injectable RTCPeerConnection factory (defaults to globalThis.RTCPeerConnection). */
  rtcPeerConnectionFactory?: RtcPeerConnectionFactory;
  /** Enable/disable automatic in-band WebRTC upgrade over relay (default true). */
  webrtcUpgrade?: boolean;
  /** Called whenever the active transport mode changes ('lan' | 'p2p' | 'turn' | 'relay'). */
  onTransportModeChange?: (mode: TransportMode) => void;
  runtimeMetricsIntervalMs?: number;
  runtimeMetricsWindowMs?: number;
}

interface LivenessProbe {
  promise: Promise<{ rttMs: number }>;
  resolve(value: { rttMs: number }): void;
  reject(error: Error): void;
  timeoutHandle: ReturnType<typeof setTimeout>;
  startedAt: number;
}

interface ConnectionControllerCallbacks {
  onMessage(data: unknown): void;
  onConnected(): void;
  onReset(error: Error, terminal: boolean): void;
}

interface ReconnectInput {
  reason?: string;
  event?: string;
  reasonCode?: string;
}

/** Owns daemon transport, reconnect, connection state, sending, and liveness. */
export class DaemonConnectionController {
  private transport: DaemonTransport | null = null;
  private transportCleanup: Array<() => void> = [];
  private readonly connectionListeners = new Set<(status: ConnectionState) => void>();
  private readonly transportModeListeners = new Set<(mode: TransportMode) => void>();
  private transportMode: TransportMode | null = null;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private connectTimeout: ReturnType<typeof setTimeout> | null = null;
  private pendingGenericTransportErrorTimeout: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private shouldReconnect = true;
  private connectPromise: Promise<void> | null = null;
  private connectResolve: (() => void) | null = null;
  private connectReject: ((error: Error) => void) | null = null;
  private lastErrorValue: string | null = null;
  private connectionState: ConnectionState = { status: "idle" };
  private livenessProbe: LivenessProbe | null = null;
  private consecutiveLivenessFailures = 0;
  private config: DaemonClientConfig;
  readonly connectionPath: "direct" | "relay";
  readonly serverId: string | null;
  private readonly clientIdHash: string;
  private readonly generation: number | null;

  constructor(
    config: DaemonClientConfig,
    private readonly logger: Logger,
    private readonly callbacks: ConnectionControllerCallbacks,
  ) {
    const clientId = normalizeClientId(config.clientId);
    if (!clientId) {
      throw new Error("Daemon client requires a non-empty clientId");
    }
    this.config = { ...config, clientId };
    const hasLanEndpoints = (config.lanEndpoints?.length ?? 0) > 0;
    this.connectionPath =
      isRelayClientWebSocketUrl(config.url) || hasLanEndpoints ? "relay" : "direct";
    let parsedUrl: URL | null = null;
    try {
      parsedUrl = new URL(config.url);
    } catch {
      parsedUrl = null;
    }
    this.serverId =
      normalizeClientId(parsedUrl?.searchParams.get("serverId")) ??
      normalizeClientId(config.relayDeviceAuth?.serverId) ??
      parsedUrl?.host ??
      null;
    this.clientIdHash = hashForLog(clientId);
    this.generation =
      typeof config.runtimeGeneration === "number" && Number.isFinite(config.runtimeGeneration)
        ? config.runtimeGeneration
        : null;
  }

  async connect(): Promise<void> {
    if (this.connectionState.status === "disposed") {
      throw new Error("Daemon client is disposed");
    }
    if (this.connectionState.status === "connected") return;
    if (this.connectPromise) return this.connectPromise;

    this.shouldReconnect = true;
    this.connectPromise = new Promise((resolve, reject) => {
      this.connectResolve = resolve;
      this.connectReject = reject;
      this.attemptConnect();
    });
    return this.connectPromise;
  }

  async close(): Promise<void> {
    if (this.connectionState.status === "disposed") return;
    this.shouldReconnect = false;
    const error = new Error("Daemon client closed");
    this.rejectConnect(error);
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    this.resetConnectTimeout();
    this.disposeTransport(1_000, "Client closed");
    this.transportMode = null;
    this.rejectLivenessProbe(error);
    this.callbacks.onReset(error, true);
    this.updateConnectionState(
      { status: "disposed" },
      { event: "DISPOSE", reason: "Client closed", reasonCode: "disposed" },
    );
  }

  ensureConnected(): void {
    if (this.connectionState.status === "disposed") return;
    if (!this.shouldReconnect) this.shouldReconnect = true;
    if (
      this.connectionState.status === "connected" ||
      this.connectionState.status === "connecting"
    ) {
      return;
    }
    void this.connect().catch((error: unknown) => {
      const resolvedError = error instanceof Error ? error : new Error(String(error));
      this.logger.warn({ err: resolvedError }, "ensureConnected connect() rejected");
    });
  }

  markConnected(): void {
    if (this.connectionState.status !== "connecting") return;
    this.resetConnectTimeout();
    this.reconnectAttempt = 0;
    this.updateConnectionState({ status: "connected" }, { event: "HELLO_SERVER_INFO" });
    this.callbacks.onConnected();
    this.resolveConnect();
  }

  getState(): ConnectionState {
    return this.connectionState;
  }

  subscribe(listener: (status: ConnectionState) => void): () => void {
    this.connectionListeners.add(listener);
    listener(this.connectionState);
    return () => this.connectionListeners.delete(listener);
  }

  getTransportMode(): TransportMode | null {
    return this.transport?.getTransportMode?.() ?? this.transportMode;
  }

  subscribeTransportMode(listener: (mode: TransportMode) => void): () => void {
    this.transportModeListeners.add(listener);
    const current = this.getTransportMode();
    if (current !== null) {
      try {
        listener(current);
      } catch {
        // no-op
      }
    }
    return () => this.transportModeListeners.delete(listener);
  }

  get isConnected(): boolean {
    return this.connectionState.status === "connected";
  }

  get isConnecting(): boolean {
    return this.connectionState.status === "connecting";
  }

  get lastError(): string | null {
    return this.lastErrorValue;
  }

  setReconnectEnabled(enabled: boolean): void {
    this.config = { ...this.config, reconnect: { ...this.config.reconnect, enabled } };
  }

  sendSessionMessage(message: SessionInboundMessage): void {
    if (!this.transport || !this.isConnected) {
      if (this.config.suppressSendErrors) return;
      throw new Error("Transport not connected (status: " + this.connectionState.status + ")");
    }
    const payload = SessionInboundMessageSchema.parse(message);
    try {
      this.transport.send(JSON.stringify({ type: "session", message: payload }));
    } catch (error) {
      if (this.config.suppressSendErrors) return;
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  sendSessionMessageStrict(message: SessionInboundMessage): void {
    if (!this.transport || !this.isConnected) {
      throw new Error("Transport not connected");
    }
    const payload = SessionInboundMessageSchema.parse(message);
    try {
      this.transport.send(JSON.stringify({ type: "session", message: payload }));
    } catch (error) {
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  sendBinaryFrame(frame: Uint8Array): void {
    if (!this.transport || !this.isConnected) {
      if (this.config.suppressSendErrors) return;
      throw new Error("Transport not connected (status: " + this.connectionState.status + ")");
    }
    try {
      this.transport.send(frame);
    } catch (error) {
      if (this.config.suppressSendErrors) return;
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  checkLiveness(params?: { timeoutMs?: number }): Promise<{ rttMs: number }> {
    if (!this.transport || !this.isConnected) {
      return Promise.reject(
        new Error("Transport not connected (status: " + this.connectionState.status + ")"),
      );
    }
    if (this.livenessProbe) return this.livenessProbe.promise;

    const startedAt = perfNow();
    const timeoutMs = Math.max(1, params?.timeoutMs ?? DEFAULT_LIVENESS_TIMEOUT_MS);
    let resolveProbe: ((value: { rttMs: number }) => void) | null = null;
    let rejectProbe: ((error: Error) => void) | null = null;
    const promise = new Promise<{ rttMs: number }>((resolve, reject) => {
      resolveProbe = resolve;
      rejectProbe = reject;
    });
    const probe: LivenessProbe = {
      promise,
      resolve: (value) => resolveProbe?.(value),
      reject: (error) => rejectProbe?.(error),
      timeoutHandle: setTimeout(() => {
        if (this.livenessProbe !== probe) return;
        this.livenessProbe = null;
        const error = new Error("Liveness check timed out (" + timeoutMs + "ms)");
        probe.reject(error);
        this.recordLivenessFailure(error);
      }, timeoutMs),
      startedAt,
    };
    this.livenessProbe = probe;

    try {
      this.transport.send(JSON.stringify({ type: "ping" }));
    } catch (error) {
      this.clearLivenessProbe();
      const resolvedError = error instanceof Error ? error : new Error(String(error));
      this.recordLivenessFailure(resolvedError);
      return Promise.reject(resolvedError);
    }
    return promise;
  }

  recordInboundActivity(): void {
    this.consecutiveLivenessFailures = 0;
  }

  resolvePong(): void {
    const probe = this.livenessProbe;
    if (!probe) return;
    this.livenessProbe = null;
    clearTimeout(probe.timeoutHandle);
    probe.resolve({ rttMs: perfNow() - probe.startedAt });
  }

  private attemptConnect(): void {
    if (this.connectionState.status === "disposed") {
      this.rejectConnect(new Error("Daemon client is disposed"));
      return;
    }
    if (!this.shouldReconnect) {
      this.rejectConnect(new Error("Daemon client is closed"));
      return;
    }
    if (this.connectionState.status === "connecting") return;

    const headers: Record<string, string> = {};
    const password = normalizePassword(this.config.password);
    if (password) headers.Authorization = "Bearer " + password;
    else if (this.config.authHeader) headers.Authorization = this.config.authHeader;
    const protocols = password ? ["chisacode.bearer." + password] : undefined;

    try {
      this.disposeTransport();
      const baseTransportFactory =
        this.config.transportFactory ??
        createWebSocketTransportFactory(this.config.webSocketFactory ?? defaultWebSocketFactory);
      let transportFactory = baseTransportFactory;
      const hasLanEndpoints = (this.config.lanEndpoints?.length ?? 0) > 0;
      if (
        this.config.e2ee?.enabled === true &&
        (isRelayClientWebSocketUrl(this.config.url) || hasLanEndpoints)
      ) {
        const daemonPublicKeyB64 = this.config.e2ee.daemonPublicKeyB64;
        if (!daemonPublicKeyB64) {
          throw new Error("daemonPublicKeyB64 is required for relay E2EE");
        }
        transportFactory = createAdaptiveTransportFactory({
          baseFactory: baseTransportFactory,
          daemonPublicKeyB64,
          logger: this.logger,
          ...(this.serverId ? { serverId: this.serverId } : {}),
          ...(this.config.lanEndpoints ? { lanEndpoints: this.config.lanEndpoints } : {}),
          ...(this.config.lanUseTls !== undefined ? { lanUseTls: this.config.lanUseTls } : {}),
          ...(this.config.iceServers !== undefined ? { iceServers: this.config.iceServers } : {}),
          ...(this.config.rtcPeerConnectionFactory
            ? { rtcPeerConnectionFactory: this.config.rtcPeerConnectionFactory }
            : {}),
          ...(this.config.webrtcUpgrade !== undefined
            ? { webrtcUpgrade: this.config.webrtcUpgrade }
            : {}),
        });
      }
      const transport = transportFactory({
        url: this.config.url,
        headers,
        ...(protocols ? { protocols } : {}),
      });
      this.transport = transport;
      this.updateConnectionState(
        { status: "connecting", attempt: this.reconnectAttempt },
        { event: "CONNECT_REQUEST" },
      );
      this.resetConnectTimeout();
      const timeoutMs = Math.max(1, this.config.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS);
      this.connectTimeout = setTimeout(() => {
        if (this.connectionState.status !== "connecting") return;
        this.lastErrorValue = "Connection timed out";
        this.disposeTransport(1_001, "Connection timed out");
        this.scheduleReconnect({
          reason: "Connection timed out",
          event: "CONNECT_TIMEOUT",
          reasonCode: "connect_timeout",
        });
      }, timeoutMs);
      this.bindTransport(transport);
    } catch (error) {
      this.resetConnectTimeout();
      const message = error instanceof Error ? error.message : "Failed to connect";
      this.lastErrorValue = message;
      this.scheduleReconnect({
        reason: message,
        event: "CONNECT_FAILED",
        reasonCode: "connect_failed",
      });
      if (this.connectReject) {
        this.rejectConnect(error instanceof Error ? error : new Error(message));
      }
    }
  }

  private bindTransport(transport: DaemonTransport): void {
    this.transportCleanup = [
      transport.onOpen(() => {
        if (this.transport !== transport) return;
        this.clearPendingGenericTransportError();
        this.lastErrorValue = null;
        this.sendHelloMessage();
      }),
      transport.onClose((event) => {
        if (this.transport !== transport) return;
        this.resetConnectTimeout();
        this.clearPendingGenericTransportError();
        const reason = describeTransportClose(event);
        if (reason) this.lastErrorValue = reason;
        this.scheduleReconnect({
          reason,
          event: "TRANSPORT_CLOSE",
          reasonCode: "transport_closed",
        });
      }),
      transport.onError((event) => {
        if (this.transport !== transport) return;
        this.resetConnectTimeout();
        const reason = describeTransportError(event);
        if (reason === "Transport error") {
          this.lastErrorValue ??= reason;
          if (!this.pendingGenericTransportErrorTimeout) {
            this.pendingGenericTransportErrorTimeout = setTimeout(() => {
              this.pendingGenericTransportErrorTimeout = null;
              if (this.isConnected || this.isConnecting) {
                this.lastErrorValue = reason;
                this.scheduleReconnect({
                  reason,
                  event: "TRANSPORT_ERROR",
                  reasonCode: "transport_error",
                });
              }
            }, 250);
          }
          return;
        }
        this.clearPendingGenericTransportError();
        this.lastErrorValue = reason;
        this.scheduleReconnect({
          reason,
          event: "TRANSPORT_ERROR",
          reasonCode: "transport_error",
        });
      }),
      transport.onMessage((data) => this.handleTransportData(data, transport)),
    ];
    if (typeof transport.onTransportModeChange === "function") {
      this.transportCleanup.push(
        transport.onTransportModeChange((mode) => {
          if (this.transport !== transport) return;
          this.updateTransportMode(mode);
        }),
      );
    }
  }

  private updateTransportMode(mode: TransportMode): void {
    if (this.transportMode === mode) return;
    this.transportMode = mode;
    try {
      this.config.onTransportModeChange?.(mode);
    } catch {
      // no-op
    }
    for (const listener of this.transportModeListeners) {
      try {
        listener(mode);
      } catch {
        // no-op
      }
    }
  }

  private handleTransportData(data: unknown, expectedTransport: DaemonTransport): void {
    if (this.transport !== expectedTransport) return;
    const rawData =
      data && typeof data === "object" && "data" in data ? (data as { data: unknown }).data : data;
    if (
      typeof Blob !== "undefined" &&
      rawData instanceof Blob &&
      typeof rawData.arrayBuffer === "function"
    ) {
      void rawData
        .arrayBuffer()
        .then((buffer) => {
          if (this.transport === expectedTransport) this.callbacks.onMessage(buffer);
          return undefined;
        })
        .catch(() => undefined);
      return;
    }
    if (typeof rawData === "string") {
      try {
        const parsed = JSON.parse(rawData) as unknown;
        if (this.handleRelayDeviceAuthResultMessage(parsed)) {
          return;
        }
      } catch {
        // fall through to normal message handling
      }
    }
    this.callbacks.onMessage(rawData);
  }

  private handleRelayDeviceAuthResultMessage(raw: unknown): boolean {
    if (!raw || typeof raw !== "object") {
      return false;
    }
    const message = raw as {
      type?: unknown;
      ok?: unknown;
      deviceId?: unknown;
      deviceSecret?: unknown;
      reason?: unknown;
      securityLevel?: unknown;
    };
    if (message.type !== "relay_device_auth_result") {
      return false;
    }
    this.config.onRelayDeviceAuthResult?.({
      ok: message.ok === true,
      ...(typeof message.deviceId === "string" ? { deviceId: message.deviceId } : {}),
      ...(typeof message.deviceSecret === "string" ? { deviceSecret: message.deviceSecret } : {}),
      ...(typeof message.reason === "string" ? { reason: message.reason } : {}),
      ...(message.securityLevel === "v2" || message.securityLevel === "legacy"
        ? { securityLevel: message.securityLevel }
        : {}),
    });
    return true;
  }

  private sendHelloMessage(): void {
    if (!this.transport) {
      this.scheduleReconnect({
        reason: "Transport unavailable before hello",
        event: "HELLO_TRANSPORT_MISSING",
        reasonCode: "transport_error",
      });
      return;
    }
    try {
      const relayDeviceAuth = this.buildRelayDeviceAuth();
      this.transport.send(
        JSON.stringify({
          type: "hello",
          clientId: this.config.clientId,
          clientType: this.config.clientType ?? "cli",
          protocolVersion: 1,
          capabilities: {
            [CLIENT_CAPS.customModeIcons]: true,
            [CLIENT_CAPS.reasoningMergeEnum]: true,
            [CLIENT_CAPS.generativeUi]: true,
            // COMPAT(cindyModules): added in v0.1.102; advertise so goal/team/learn RPCs are accepted.
            [CLIENT_CAPS.cindyModules]: true,
          },
          ...(this.config.appVersion ? { appVersion: this.config.appVersion } : {}),
          ...(relayDeviceAuth ? { relayDeviceAuth } : {}),
        }),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to send hello message";
      this.lastErrorValue = message;
      this.scheduleReconnect({
        reason: message,
        event: "HELLO_SEND_FAILED",
        reasonCode: "transport_error",
      });
    }
  }

  private buildRelayDeviceAuth(): {
    version: 1;
    deviceId: string;
    proof?: string;
    pairingToken?: string;
    deviceName?: string;
    clientPublicKeyB64: string;
    challenge: string;
  } | null {
    const credential = this.config.relayDeviceAuth;
    const context = this.transport?.getRelaySecurityContext?.();
    if (!credential || !context?.authChallenge) {
      // COMPAT(relayDeviceAuthChallenge): old daemons do not send a challenge and
      // continue to receive a legacy hello from new clients.
      return null;
    }
    const channelBinding = {
      clientPublicKeyB64: context.clientPublicKeyB64,
      challenge: context.authChallenge,
    };
    if (credential.deviceSecret) {
      return {
        version: 1,
        deviceId: credential.deviceId,
        proof: computeClientRelayDeviceAuthProof(credential.deviceSecret, {
          serverId: credential.serverId,
          daemonPublicKeyB64: this.config.e2ee?.daemonPublicKeyB64 ?? "",
          clientPublicKeyB64: channelBinding.clientPublicKeyB64,
          deviceId: credential.deviceId,
          challenge: channelBinding.challenge,
        }),
        ...channelBinding,
      };
    }
    if (credential.pairingToken) {
      return {
        version: 1,
        deviceId: credential.deviceId,
        pairingToken: credential.pairingToken,
        ...(credential.deviceName ? { deviceName: credential.deviceName } : {}),
        ...channelBinding,
      };
    }
    return null;
  }

  private scheduleReconnect(input?: ReconnectInput): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    const wasDisposed = this.connectionState.status === "disposed";
    const reason = input?.reason;
    if (typeof reason === "string" && reason.trim().length > 0) {
      this.lastErrorValue = reason.trim();
    }
    const error = new Error(reason ?? "Connection lost");
    this.rejectLivenessProbe(error);
    this.callbacks.onReset(error, false);
    if (wasDisposed) {
      this.rejectConnect(new Error(reason ?? "Daemon client is disposed"));
      return;
    }
    this.updateConnectionState(
      { status: "disconnected", ...(reason ? { reason } : {}) },
      {
        event: input?.event ?? "TRANSPORT_CLOSE",
        ...(reason ? { reason } : {}),
        ...(input?.reasonCode ? { reasonCode: input.reasonCode } : {}),
      },
    );
    if (!this.shouldReconnect || this.config.reconnect?.enabled === false) {
      this.rejectConnect(new Error(reason ?? "Transport disconnected before connect"));
      return;
    }
    this.armReconnectTimer();
  }

  private armReconnectTimer(): void {
    const attempt = this.reconnectAttempt;
    const baseDelay = this.config.reconnect?.baseDelayMs ?? DEFAULT_RECONNECT_BASE_DELAY_MS;
    const maxDelay = this.config.reconnect?.maxDelayMs ?? DEFAULT_RECONNECT_MAX_DELAY_MS;
    const delay = Math.min(baseDelay * 2 ** attempt, maxDelay);
    this.reconnectAttempt = attempt + 1;
    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      if (this.shouldReconnect) this.attemptConnect();
    }, delay);
  }

  private recordLivenessFailure(error: Error): void {
    this.consecutiveLivenessFailures += 1;
    if (this.consecutiveLivenessFailures < LIVENESS_FAILURE_RECONNECT_THRESHOLD) return;
    this.consecutiveLivenessFailures = 0;
    this.lastErrorValue = error.message;
    this.disposeTransport(1_001, "Liveness check timed out");
    this.scheduleReconnect({
      reason: error.message,
      event: "LIVENESS_TIMEOUT",
      reasonCode: "liveness_timeout",
    });
  }

  private clearLivenessProbe(): void {
    const probe = this.livenessProbe;
    if (!probe) return;
    this.livenessProbe = null;
    clearTimeout(probe.timeoutHandle);
  }

  private rejectLivenessProbe(error: Error): void {
    const probe = this.livenessProbe;
    if (!probe) return;
    this.livenessProbe = null;
    clearTimeout(probe.timeoutHandle);
    probe.reject(error);
  }

  private resolveConnect(): void {
    this.connectResolve?.();
    this.connectPromise = null;
    this.connectResolve = null;
    this.connectReject = null;
  }

  private rejectConnect(error: Error): void {
    this.connectReject?.(error);
    this.connectPromise = null;
    this.connectResolve = null;
    this.connectReject = null;
  }

  private disposeTransport(code = 1_001, reason = "Reconnecting"): void {
    this.cleanupTransport();
    const transport = this.transport;
    this.transport = null;
    if (!transport) return;
    try {
      transport.close(code, reason);
    } catch {
      // no-op
    }
  }

  private cleanupTransport(): void {
    this.resetConnectTimeout();
    this.clearPendingGenericTransportError();
    for (const cleanup of this.transportCleanup) {
      try {
        cleanup();
      } catch {
        // no-op
      }
    }
    this.transportCleanup = [];
  }

  private clearPendingGenericTransportError(): void {
    if (!this.pendingGenericTransportErrorTimeout) return;
    clearTimeout(this.pendingGenericTransportErrorTimeout);
    this.pendingGenericTransportErrorTimeout = null;
  }

  private resetConnectTimeout(): void {
    if (!this.connectTimeout) return;
    clearTimeout(this.connectTimeout);
    this.connectTimeout = null;
  }

  private updateConnectionState(
    next: ConnectionState,
    metadata?: { event: string; reason?: string; reasonCode?: string },
  ): void {
    const previous = this.connectionState;
    this.connectionState = next;
    const reasonFromNext =
      next.status === "disconnected" && typeof next.reason === "string" ? next.reason : null;
    const reason = metadata?.reason ?? reasonFromNext;
    const reasonCode = metadata?.reasonCode ?? toReasonCode(reason);
    this.logger.debug(
      {
        serverId: this.serverId,
        clientIdHash: this.clientIdHash,
        from: previous.status,
        to: next.status,
        event: metadata?.event ?? "STATE_UPDATE",
        connectionPath: this.connectionPath,
        generation: this.generation,
        reasonCode,
        reason,
      },
      "DaemonClientTransition",
    );
    for (const listener of this.connectionListeners) {
      try {
        listener(next);
      } catch {
        // no-op
      }
    }
  }
}

function normalizePassword(value: string | undefined): string | null {
  if (typeof value !== "string") return null;
  return value.length > 0 ? value : null;
}

function normalizeClientId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function hashForLog(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return "h_" + Math.abs(hash).toString(16);
}

function toReasonCode(reason: string | null | undefined): string | null {
  if (!reason) return null;
  const normalized = reason.toLowerCase();
  if (normalized.includes("timed out")) return "connect_timeout";
  if (normalized.includes("disposed")) return "disposed";
  if (normalized.includes("client closed")) return "client_closed";
  if (normalized.includes("transport")) return "transport_error";
  if (normalized.includes("failed to connect")) return "connect_failed";
  return "unknown";
}
