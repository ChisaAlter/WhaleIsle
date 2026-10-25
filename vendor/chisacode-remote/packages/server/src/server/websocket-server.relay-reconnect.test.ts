import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RelayPairingLinkStore } from "./relay-pairing-link-store.js";
import { RelayDeviceCredentialStore } from "./relay-device-credential-store.js";
import { computeRelayDeviceAuthProof } from "./relay-device-auth.js";
import type { Server as HTTPServer } from "http";
import type pino from "pino";
import type { AgentManager } from "./agent/agent-manager.js";
import type { AgentStorage } from "./agent/agent-storage.js";
import type { DownloadTokenStore } from "./file-download/token-store.js";
import type { DaemonConfigStore } from "./daemon-config-store.js";
import type { FileBackedChatService } from "./chat/chat-service.js";
import type { LoopService } from "./loop-service.js";
import type { ScheduleService } from "./schedule/service.js";
import type { CheckoutDiffManager } from "./checkout-diff-manager.js";
import { asInternals, createStub } from "./test-utils/class-mocks.js";
import { createProviderSnapshotManagerStub } from "./test-utils/session-stubs.js";
import {
  asUint8Array,
  decodeTerminalStreamFrame,
  encodeTerminalStreamFrame,
  TerminalStreamOpcode,
} from "@chisacode/protocol/terminal-stream-protocol";
import { CLIENT_CAPS } from "@chisacode/protocol/client-capabilities";

type SocketListener = (...args: unknown[]) => void;

const wsModuleMock = vi.hoisted(() => {
  class MockWebSocketServer {
    static instances: MockWebSocketServer[] = [];
    readonly handlers = new Map<string, (...args: unknown[]) => void>();
    readonly options: unknown;

    constructor(options: unknown) {
      this.options = options;
      MockWebSocketServer.instances.push(this);
    }

    on(event: string, handler: (...args: unknown[]) => void) {
      this.handlers.set(event, handler);
      return this;
    }

    close() {
      // no-op
    }
  }

  return { MockWebSocketServer };
});

const sessionMock = vi.hoisted(() => {
  const instances: MockSession[] = [];

  class MockSession {
    cleanup = vi.fn(async () => {});
    handleMessage = vi.fn(async () => {});
    handleBinaryFrame = vi.fn((_frame: unknown) => {});
    supports = vi.fn((capability: string) => this.args.clientCapabilities?.[capability] === true);
    getClientActivity = vi.fn(() => null);
    resetPeakInflight = vi.fn(() => {});
    getRuntimeMetrics = vi.fn(() => ({
      checkoutDiffTargetCount: 0,
      checkoutDiffSubscriptionCount: 0,
      checkoutDiffWatcherCount: 0,
      checkoutDiffFallbackRefreshTargetCount: 0,
      terminalDirectorySubscriptionCount: 0,
      terminalSubscriptionCount: 0,
      inflightRequests: 0,
      peakInflightRequests: 0,
    }));
    readonly args: Record<string, unknown>;

    constructor(args: Record<string, unknown>) {
      this.args = args;
      instances.push(this);
    }
  }

  return { MockSession, instances };
});

vi.mock("ws", () => ({
  WebSocketServer: wsModuleMock.MockWebSocketServer,
}));

vi.mock("./session.js", () => ({
  Session: sessionMock.MockSession,
}));

vi.mock("./push/token-store.js", () => ({
  PushTokenStore: class {
    getAllTokens(): string[] {
      return [];
    }
  },
}));

vi.mock("./push/push-service.js", () => ({
  PushService: class {
    async sendPush(): Promise<void> {
      // no-op
    }
  },
}));

import { z } from "zod/v3";
import {
  MAX_SESSION_INFLIGHT_MESSAGES,
  WEBSOCKET_MAX_PAYLOAD_BYTES,
  VoiceAssistantWebSocketServer,
} from "./websocket-server";
import { parseServerInfoStatusPayload } from "./messages.js";
import type { SpeechReadinessSnapshot } from "./speech/speech-runtime.js";
import { summarizeUntrustedLogIdentifier } from "./log-metadata.js";

interface WebSocketServerInternals {
  attachSocket(ws: unknown, req: unknown): Promise<void>;
  sessions: Map<MockSocket, { session: unknown; authenticatedDeviceId: string | null }>;
}

const TEST_DAEMON_VERSION = "1.2.3-test";

const WireEnvelopeSchema = z.object({
  type: z.string().optional(),
  message: z
    .object({
      type: z.string().optional(),
      payload: z.unknown().optional(),
    })
    .optional(),
});

function parseSentEnvelope(data: unknown): z.infer<typeof WireEnvelopeSchema> {
  if (typeof data !== "string") throw new Error("Expected string frame");
  return WireEnvelopeSchema.parse(JSON.parse(data));
}

const BinaryFrameSchema = z.object({
  opcode: z.number(),
  slot: z.number(),
  payload: z.instanceof(Uint8Array),
});

class MockSocket {
  readyState = 1;
  bufferedAmount = 0;
  sent: unknown[] = [];
  private listeners = new Map<string, SocketListener[]>();

  on(event: "message" | "close" | "error", listener: SocketListener): void {
    const handlers = this.listeners.get(event) ?? [];
    handlers.push(listener);
    this.listeners.set(event, handlers);
  }

  once(event: "close" | "error", listener: SocketListener): void {
    const wrapped: SocketListener = (...args) => {
      this.off(event, wrapped);
      listener(...args);
    };
    this.on(event, wrapped);
  }

  send(data: unknown): void {
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    this.readyState = 3;
    this.emit("close", code ?? 1000, reason ?? "");
  }

  emit(event: "message" | "close" | "error", ...args: unknown[]): void {
    const handlers = this.listeners.get(event) ?? [];
    for (const handler of handlers.slice()) {
      handler(...args);
    }
  }

  private off(event: "close" | "error", listener: SocketListener): void {
    const handlers = this.listeners.get(event) ?? [];
    this.listeners.set(
      event,
      handlers.filter((handler) => handler !== listener),
    );
  }
}

function createLogger() {
  const logger = {
    child: vi.fn(() => logger),
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  return logger;
}

function createServer(options?: {
  speechReadiness?: SpeechReadinessSnapshot | null;
  logger?: ReturnType<typeof createLogger>;
}) {
  const speechReadiness = options?.speechReadiness ?? null;
  const daemonConfigStore = {
    onChange: vi.fn(() => () => {}),
  };
  return new VoiceAssistantWebSocketServer(
    createStub<HTTPServer>({}),
    createStub<pino.Logger>(options?.logger ?? createLogger()),
    "srv_test",
    createStub<AgentManager>({
      setAgentAttentionCallback: vi.fn(),
      getAgent: vi.fn(() => null),
      getMetricsSnapshot: vi.fn(() => ({
        totalAgents: 0,
        idleAgents: 0,
        runningAgents: 0,
        pendingPermissionAgents: 0,
        erroredAgents: 0,
      })),
    }),
    createStub<AgentStorage>({}),
    createStub<DownloadTokenStore>({}),
    "/tmp/chisacode-test",
    createStub<DaemonConfigStore>(daemonConfigStore),
    null,
    { allowedOrigins: new Set() },
    undefined,
    speechReadiness
      ? {
          resolveStt: () => null,
          resolveSttLanguage: () => "en",
          resolveTts: () => null,
          resolveTurnDetection: () => null,
          resolveDictationStt: () => null,
          resolveDictationSttLanguage: () => "en",
          getReadiness: () => speechReadiness,
          onReadinessChange: vi.fn(() => () => {}),
          start: vi.fn(),
          stop: vi.fn(),
          ready: Promise.resolve(),
        }
      : undefined,
    undefined,
    TEST_DAEMON_VERSION,
    undefined,
    undefined,
    undefined,
    createStub<FileBackedChatService>({}),
    createStub<LoopService>({}),
    createStub<ScheduleService>({}),
    createStub<CheckoutDiffManager>({
      subscribe: vi.fn(),
      scheduleRefreshForCwd: vi.fn(),
      getMetrics: vi.fn(() => ({
        checkoutDiffTargetCount: 0,
        checkoutDiffSubscriptionCount: 0,
        checkoutDiffWatcherCount: 0,
        checkoutDiffFallbackRefreshTargetCount: 0,
      })),
      dispose: vi.fn(),
    }),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    createProviderSnapshotManagerStub().manager,
  );
}

function createReadySpeechReadinessSnapshot(): SpeechReadinessSnapshot {
  return {
    generatedAt: "2026-02-14T00:00:00.000Z",
    requiredLocalModelIds: [],
    missingLocalModelIds: [],
    download: {
      inProgress: false,
      error: null,
    },
    dictation: {
      enabled: true,
      available: true,
      reasonCode: "ready",
      message: "Dictation is ready.",
      retryable: false,
      missingModelIds: [],
    },
    realtimeVoice: {
      enabled: true,
      available: true,
      reasonCode: "ready",
      message: "Realtime voice is ready.",
      retryable: false,
      missingModelIds: [],
    },
    voiceFeature: {
      enabled: true,
      available: true,
      reasonCode: "ready",
      message: "Voice features are ready.",
      retryable: false,
      missingModelIds: [],
    },
  };
}

function createDownloadInProgressSpeechReadinessSnapshot(): SpeechReadinessSnapshot {
  return {
    generatedAt: "2026-02-14T00:00:00.000Z",
    requiredLocalModelIds: ["parakeet-tdt-0.6b-v2-int8"],
    missingLocalModelIds: ["parakeet-tdt-0.6b-v2-int8"],
    download: {
      inProgress: true,
      error: null,
    },
    dictation: {
      enabled: true,
      available: false,
      reasonCode: "stt_unavailable",
      message: "Dictation is unavailable: speech-to-text service is not ready.",
      retryable: false,
      missingModelIds: [],
    },
    realtimeVoice: {
      enabled: true,
      available: false,
      reasonCode: "stt_unavailable",
      message: "Realtime voice is unavailable: speech-to-text service is not ready.",
      retryable: false,
      missingModelIds: [],
    },
    voiceFeature: {
      enabled: true,
      available: false,
      reasonCode: "model_download_in_progress",
      message:
        "Voice features are unavailable while models download in the background (parakeet-tdt-0.6b-v2-int8).",
      retryable: true,
      missingModelIds: ["parakeet-tdt-0.6b-v2-int8"],
    },
  };
}

function createHelloMessage(
  clientId: string,
  options?: { capabilities?: Record<string, boolean> },
) {
  return {
    type: "hello" as const,
    clientId,
    clientType: "cli" as const,
    protocolVersion: 1,
    ...(options?.capabilities ? { capabilities: options.capabilities } : {}),
  };
}

function createDirectRequest() {
  return {
    headers: {
      host: "localhost:6767",
      origin: "http://localhost:6767",
      "user-agent": "vitest",
    },
    socket: {
      remoteAddress: "127.0.0.1",
    },
    url: "/ws",
  };
}

async function attachRelayAndHello(params: {
  server: VoiceAssistantWebSocketServer;
  socket: MockSocket;
  clientId: string;
}) {
  await params.server.attachExternalSocket(params.socket, { transport: "relay" });
  params.socket.emit("message", JSON.stringify(createHelloMessage(params.clientId)));
  await Promise.resolve();
  expect(params.socket.sent.length).toBeGreaterThan(0);
  const envelope = parseSentEnvelope(params.socket.sent[0]);
  expect(envelope.type).toBe("session");
  const serverInfo = parseServerInfoStatusPayload(envelope.message?.payload);
  expect(envelope.message?.type).toBe("status");
  expect(serverInfo).not.toBeNull();
  return serverInfo!;
}

async function attachDirectAndHello(params: {
  server: VoiceAssistantWebSocketServer;
  socket: MockSocket;
  clientId: string;
}) {
  await asInternals<WebSocketServerInternals>(params.server).attachSocket(
    params.socket,
    createDirectRequest(),
  );
  params.socket.emit("message", JSON.stringify(createHelloMessage(params.clientId)));
  await Promise.resolve();
  expect(params.socket.sent.length).toBeGreaterThan(0);
  const envelope = parseSentEnvelope(params.socket.sent[0]);
  expect(envelope.type).toBe("session");
  const serverInfo = parseServerInfoStatusPayload(envelope.message?.payload);
  expect(envelope.message?.type).toBe("status");
  expect(serverInfo).not.toBeNull();
  return serverInfo!;
}

describe("relay external socket reconnect behavior", () => {
  beforeEach(() => {
    sessionMock.instances.length = 0;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("persistent link enrolls separate devices, rejects after revoke, and keeps device proofs working", async () => {
    const home = mkdtempSync(join(tmpdir(), "relay-persistent-gate-"));
    const server = createServer();
    const sockets: MockSocket[] = [];
    try {
      const links = new RelayPairingLinkStore(home);
      const persistent = links.getOrCreate();
      const metadata = {
        transport: "relay" as const,
        requireDeviceAuth: true,
        chisacodeHome: home,
        serverId: "srv_test",
        daemonPublicKeyB64: "daemon-key",
        relayClientPublicKeyB64: "client-key",
        relayAuthChallenge: "challenge-persistent-enrollment",
      };
      const enroll = async (
        deviceId: string,
        token: string,
        challenge = metadata.relayAuthChallenge,
        clientId = `cid-${deviceId}`,
      ) => {
        const socket = new MockSocket();
        sockets.push(socket);
        await server.attachExternalSocket(socket, metadata);
        socket.emit(
          "message",
          JSON.stringify({
            ...createHelloMessage(clientId),
            relayDeviceAuth: {
              version: 1,
              deviceId,
              pairingToken: token,
              challenge,
              clientPublicKeyB64: "client-key",
            },
          }),
        );
        await Promise.resolve();
        return socket;
      };
      const first = await enroll("dev_first_phone", persistent.token);
      const second = await enroll("dev_first_phone", persistent.token);
      const resultSchema = z.object({
        type: z.literal("relay_device_auth_result"),
        ok: z.literal(true),
        deviceId: z.string(),
        deviceSecret: z.string().min(32),
      });
      const firstResult = resultSchema.parse(JSON.parse(String(first.sent[0])));
      const secondResult = resultSchema.parse(JSON.parse(String(second.sent[0])));
      expect(first.readyState).toBe(1);
      expect(second.readyState).toBe(1);
      expect(firstResult.deviceId).not.toBe(secondResult.deviceId);
      expect(firstResult.deviceSecret).not.toBe(secondResult.deviceSecret);
      expect(sessionMock.instances).toHaveLength(2);
      const unbound = await enroll("dev_wrong_channel", persistent.token, "different-challenge");
      expect(unbound.readyState).toBe(3);
      expect(sessionMock.instances).toHaveLength(2);
      const staleStore = new RelayDeviceCredentialStore(home);
      links.revoke();
      staleStore.verifyDeviceSecret(firstResult.deviceId, firstResult.deviceSecret);
      const revoked = await enroll("dev_revoked_link", persistent.token);
      expect(revoked.readyState).toBe(3);
      expect(sessionMock.instances).toHaveLength(2);
      const reconnect = new MockSocket();
      sockets.push(reconnect);
      const challenge = "fresh-reconnect-after-link-revocation";
      await server.attachExternalSocket(reconnect, { ...metadata, relayAuthChallenge: challenge });
      const proof = computeRelayDeviceAuthProof(firstResult.deviceSecret, {
        serverId: "srv_test",
        daemonPublicKeyB64: "daemon-key",
        clientPublicKeyB64: "client-key",
        deviceId: firstResult.deviceId,
        challenge,
      });
      reconnect.emit(
        "message",
        JSON.stringify({
          ...createHelloMessage("cid-dev_first_phone"),
          relayDeviceAuth: {
            version: 1,
            deviceId: firstResult.deviceId,
            proof,
            challenge,
            clientPublicKeyB64: "client-key",
          },
        }),
      );
      await Promise.resolve();
      expect(reconnect.readyState).toBe(1);
      expect(parseSentEnvelope(reconnect.sent[0]).type).toBe("session");
      expect(sessionMock.instances).toHaveLength(2);
      const connections = asInternals<WebSocketServerInternals>(server).sessions;
      expect(connections.get(reconnect)).toBe(connections.get(first));
      expect(connections.get(reconnect)?.authenticatedDeviceId).toBe(firstResult.deviceId);
      const secondReconnect = new MockSocket();
      sockets.push(secondReconnect);
      const secondChallenge = "second-device-reconnect-after-reenrollment";
      await server.attachExternalSocket(secondReconnect, {
        ...metadata,
        relayAuthChallenge: secondChallenge,
      });
      const secondProof = computeRelayDeviceAuthProof(secondResult.deviceSecret, {
        serverId: "srv_test",
        daemonPublicKeyB64: "daemon-key",
        clientPublicKeyB64: "client-key",
        deviceId: secondResult.deviceId,
        challenge: secondChallenge,
      });
      secondReconnect.emit(
        "message",
        JSON.stringify({
          ...createHelloMessage("cid-dev_first_phone"),
          relayDeviceAuth: {
            version: 1,
            deviceId: secondResult.deviceId,
            proof: secondProof,
            challenge: secondChallenge,
            clientPublicKeyB64: "client-key",
          },
        }),
      );
      await Promise.resolve();
      expect(secondReconnect.readyState).toBe(1);
      expect(parseSentEnvelope(secondReconnect.sent[0]).type).toBe("session");
      expect(sessionMock.instances).toHaveLength(2);
      expect(connections.get(secondReconnect)).toBe(connections.get(second));
      expect(connections.get(secondReconnect)?.authenticatedDeviceId).toBe(secondResult.deviceId);
      expect(connections.get(secondReconnect)).not.toBe(connections.get(reconnect));
      const replacement = await enroll("dev_replacement_link", links.getOrCreate().token);
      expect(replacement.readyState).toBe(1);
      expect(sessionMock.instances).toHaveLength(3);
      // Pre-extension QR tokens were arbitrary base64url, including this prefix.
      staleStore.issuePairingToken();
      const legacyToken = "link_legacy-random-short-token";
      const legacyHash = createHash("sha256").update(legacyToken).digest("hex");
      writeFileSync(
        join(home, "relay-pairing-tokens", `${legacyHash}.json`),
        JSON.stringify({
          tokenHash: legacyHash,
          expiresAtMs: Date.now() + 600_000,
          consumedAt: null,
          createdAt: new Date().toISOString(),
        }),
      );
      const legacy = await enroll("dev_legacy_prefix", legacyToken);
      expect(legacy.readyState).toBe(1);
      expect(sessionMock.instances).toHaveLength(4);
    } finally {
      for (const socket of sockets) socket.close();
      await server.close();
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("keeps the same session when relay reconnects within grace window", async () => {
    const server = createServer();
    const clientId = "cid-relay-reconnect";

    const socket1 = new MockSocket();
    await attachRelayAndHello({
      server,
      socket: socket1,
      clientId,
    });
    expect(sessionMock.instances).toHaveLength(1);
    const session = sessionMock.instances[0];

    socket1.emit("close", 1006, "");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(session.cleanup).not.toHaveBeenCalled();

    const socket2 = new MockSocket();
    await attachRelayAndHello({
      server,
      socket: socket2,
      clientId,
    });
    expect(sessionMock.instances).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(20_000);
    expect(session.cleanup).not.toHaveBeenCalled();

    await server.close();
  });

  test("configures the direct WebSocket server with the explicit file-compatible payload limit", async () => {
    expect(WEBSOCKET_MAX_PAYLOAD_BYTES).toBe(64 * 1024 * 1024);
    const server = createServer();

    expect(wsModuleMock.MockWebSocketServer.instances.at(-1)?.options).toMatchObject({
      maxPayload: WEBSOCKET_MAX_PAYLOAD_BYTES,
    });

    await server.close();
  });

  test("accepts the exact per-session inflight ceiling and rejects one more with rpc_error", async () => {
    expect(MAX_SESSION_INFLIGHT_MESSAGES).toBe(64);
    const server = createServer();
    const socket = new MockSocket();
    await attachDirectAndHello({ server, socket, clientId: "bounded-session" });
    socket.sent = [];
    const session = sessionMock.instances[0];
    const pending: Array<() => void> = [];
    session.handleMessage.mockImplementation(
      () => new Promise<void>((resolve) => pending.push(resolve)),
    );

    for (let index = 0; index <= MAX_SESSION_INFLIGHT_MESSAGES; index += 1) {
      socket.emit(
        "message",
        JSON.stringify({
          type: "session",
          message: { type: "chat/list", requestId: `request-${index}` },
        }),
      );
    }
    await Promise.resolve();

    expect(session.handleMessage).toHaveBeenCalledTimes(MAX_SESSION_INFLIGHT_MESSAGES);
    expect(socket.sent.map(parseSentEnvelope)).toContainEqual(
      expect.objectContaining({
        message: expect.objectContaining({
          type: "rpc_error",
          payload: expect.objectContaining({ requestId: "request-64", code: "server_busy" }),
        }),
      }),
    );

    for (const resolve of pending) resolve();
    await Promise.resolve();
    await server.close();
  });

  test("does not log payload or error secrets when a session handler rejects", async () => {
    const secret = "TASK10-UNIQUE-PROMPT-SECRET";
    const untrustedId = `${secret}\n\u0000${"x".repeat(20_000)}`;
    const logger = createLogger();
    const server = createServer({ logger });
    const socket = new MockSocket();
    await attachDirectAndHello({ server, socket, clientId: untrustedId });
    sessionMock.instances[0].handleMessage.mockRejectedValueOnce(new Error(secret));

    socket.emit(
      "message",
      JSON.stringify({
        type: "session",
        message: {
          type: "chat/post",
          requestId: untrustedId,
          room: "room",
          body: secret,
        },
      }),
    );
    await Promise.resolve();
    await Promise.resolve();

    expect(
      JSON.stringify([
        logger.child.mock.calls,
        logger.trace.mock.calls,
        logger.debug.mock.calls,
        logger.info.mock.calls,
        logger.warn.mock.calls,
        logger.error.mock.calls,
      ]),
    ).not.toContain(secret);
    await server.close();
  });

  test("logs fixed metadata for malformed hello without received values", async () => {
    const secret = "TASK10-MALFORMED-HELLO-SECRET";
    const logger = createLogger();
    const server = createServer({ logger });
    const socket = new MockSocket();
    await server.attachExternalSocket(socket, { transport: "relay" });

    socket.emit(
      "message",
      JSON.stringify({
        type: "hello",
        clientId: secret,
        clientType: secret,
        protocolVersion: secret,
      }),
    );
    await Promise.resolve();

    const serializedLogs = JSON.stringify([
      logger.child.mock.calls,
      logger.trace.mock.calls,
      logger.debug.mock.calls,
      logger.info.mock.calls,
      logger.warn.mock.calls,
      logger.error.mock.calls,
    ]);
    expect(serializedLogs).not.toContain(secret);
    expect(serializedLogs).toContain('"category":"validation"');
    expect(serializedLogs).toContain('"code":"invalid_hello"');
    await server.close();
  });

  test("summarizes an unvalidated nested request type in active-session logs", async () => {
    const secret = "TASK10-INVALID-REQUEST-TYPE-SECRET";
    const requestType = `${secret}\n\u0000${"z".repeat(20_000)}`;
    const logger = createLogger();
    const server = createServer({ logger });
    const socket = new MockSocket();
    await attachDirectAndHello({ server, socket, clientId: "invalid-request-type-client" });

    socket.emit(
      "message",
      JSON.stringify({
        type: "session",
        message: { type: requestType, requestId: "invalid-request-type-id" },
      }),
    );
    await Promise.resolve();

    const serializedLogs = JSON.stringify([
      logger.child.mock.calls,
      logger.trace.mock.calls,
      logger.debug.mock.calls,
      logger.info.mock.calls,
      logger.warn.mock.calls,
      logger.error.mock.calls,
    ]);
    expect(serializedLogs).not.toContain(secret);
    expect(serializedLogs).toContain(
      JSON.stringify(summarizeUntrustedLogIdentifier(requestType)).slice(1, -1),
    );
    expect(serializedLogs.length).toBeLessThan(5_000);
    await server.close();
  });

  test("passes hello capabilities through to the created session", async () => {
    const server = createServer();
    const socket = new MockSocket();

    await asInternals<WebSocketServerInternals>(server).attachSocket(socket, createDirectRequest());
    socket.emit(
      "message",
      JSON.stringify(
        createHelloMessage("client-capabilities", {
          capabilities: { [CLIENT_CAPS.reasoningMergeEnum]: true },
        }),
      ),
    );
    await Promise.resolve();

    expect(sessionMock.instances).toHaveLength(1);
    const session = sessionMock.instances[0];
    expect(session.args.clientCapabilities).toEqual({
      [CLIENT_CAPS.reasoningMergeEnum]: true,
    });

    await server.close();
  });

  test("closes pending connection when hello timeout elapses", async () => {
    const server = createServer();

    const socket = new MockSocket();
    let closeCode: number | null = null;
    let closeReason = "";
    socket.on("close", (code: unknown, reason: unknown) => {
      closeCode = typeof code === "number" ? code : null;
      closeReason = typeof reason === "string" ? reason : "";
    });

    await asInternals<WebSocketServerInternals>(server).attachSocket(socket, createDirectRequest());
    await vi.advanceTimersByTimeAsync(15_000);

    expect(closeCode).toBe(4001);
    expect(closeReason).toBe("Hello timeout");
    expect(sessionMock.instances).toHaveLength(0);

    await server.close();
  });

  test("returns server_info when clientId reconnects with existing session", async () => {
    const server = createServer();
    const clientId = "cid-resume-flag";

    const firstSocket = new MockSocket();
    await attachRelayAndHello({
      server,
      socket: firstSocket,
      clientId,
    });

    firstSocket.emit("close", 1006, "");
    await vi.advanceTimersByTimeAsync(1_000);

    const secondSocket = new MockSocket();
    await attachRelayAndHello({
      server,
      socket: secondSocket,
      clientId,
    });

    await server.close();
  });

  test("returns server_info for distinct clientIds", async () => {
    const server = createServer();

    const firstSocket = new MockSocket();
    await attachRelayAndHello({
      server,
      socket: firstSocket,
      clientId: "cid-new-1",
    });

    const secondSocket = new MockSocket();
    await attachRelayAndHello({
      server,
      socket: secondSocket,
      clientId: "cid-new-2",
    });
    expect(sessionMock.instances).toHaveLength(2);

    await server.close();
  });

  test("rejects session messages before hello", async () => {
    const server = createServer();
    const socket = new MockSocket();
    let closeCode: number | null = null;
    let closeReason = "";
    socket.on("close", (code: unknown, reason: unknown) => {
      closeCode = typeof code === "number" ? code : null;
      closeReason = typeof reason === "string" ? reason : "";
    });

    await server.attachExternalSocket(socket, { transport: "relay" });
    socket.emit(
      "message",
      JSON.stringify({
        type: "session",
        message: {
          type: "ping",
        },
      }),
    );
    await Promise.resolve();

    expect(closeCode).toBe(4002);
    expect(["Invalid hello", "Session message before hello"]).toContain(closeReason);
    expect(sessionMock.instances).toHaveLength(0);

    await server.close();
  });

  test("reuses direct session when same clientId reconnects within grace window", async () => {
    const server = createServer();
    const clientId = "cid-direct-reconnect";

    const socket1 = new MockSocket();
    await attachDirectAndHello({
      server,
      socket: socket1,
      clientId,
    });
    expect(sessionMock.instances).toHaveLength(1);
    const session = sessionMock.instances[0];

    socket1.emit("close", 1006, "");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(session.cleanup).not.toHaveBeenCalled();

    const socket2 = new MockSocket();
    await attachDirectAndHello({
      server,
      socket: socket2,
      clientId,
    });
    expect(sessionMock.instances).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(20_000);
    expect(session.cleanup).not.toHaveBeenCalled();

    await server.close();
  });

  test("reuses one session when switching from direct to relay with the same clientId", async () => {
    const server = createServer();
    const clientId = "cid-switch-path";

    const directSocket = new MockSocket();
    await attachDirectAndHello({
      server,
      socket: directSocket,
      clientId,
    });
    expect(sessionMock.instances).toHaveLength(1);
    const session = sessionMock.instances[0];

    const relaySocket = new MockSocket();
    await attachRelayAndHello({
      server,
      socket: relaySocket,
      clientId,
    });
    expect(sessionMock.instances).toHaveLength(1);

    const { onMessage } = session.args;
    expect(onMessage).toBeTypeOf("function");
    if (typeof onMessage === "function") {
      onMessage({
        type: "status",
        payload: { status: "ok" },
      });
    }

    expect(directSocket.sent.length).toBeGreaterThan(0);
    expect(relaySocket.sent.length).toBeGreaterThan(0);

    directSocket.emit("close", 1006, "");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(session.cleanup).not.toHaveBeenCalled();

    relaySocket.emit("close", 1006, "");
    await vi.advanceTimersByTimeAsync(90_000);
    expect(session.cleanup).toHaveBeenCalledTimes(1);

    await server.close();
  });

  test("cleans up relay session when reconnect grace expires", async () => {
    const server = createServer();
    const clientId = "cid-relay-grace-expire";

    const socket1 = new MockSocket();
    await attachRelayAndHello({
      server,
      socket: socket1,
      clientId,
    });
    expect(sessionMock.instances).toHaveLength(1);
    const session = sessionMock.instances[0];

    socket1.emit("close", 1006, "");
    await vi.advanceTimersByTimeAsync(90_000);
    expect(session.cleanup).toHaveBeenCalledTimes(1);

    await server.close();
  });

  test("includes voice capabilities in initial server_info when speech readiness exists", async () => {
    const speechReadiness = createReadySpeechReadinessSnapshot();
    const server = createServer({ speechReadiness });

    const socket = new MockSocket();
    const serverInfo = (await attachRelayAndHello({
      server,
      socket,
      clientId: "cid-server-info-capabilities",
    })) as {
      version?: unknown;
      capabilities?: {
        voice?: {
          dictation?: { enabled?: unknown; reason?: unknown };
          voice?: { enabled?: unknown; reason?: unknown };
        };
      };
    };
    expect(serverInfo.version).toBe(TEST_DAEMON_VERSION);
    expect(serverInfo.capabilities?.voice?.dictation?.enabled).toBe(
      speechReadiness.dictation.enabled,
    );
    expect(serverInfo.capabilities?.voice?.dictation?.reason).toBe("");
    expect(serverInfo.capabilities?.voice?.voice?.enabled).toBe(
      speechReadiness.realtimeVoice.enabled,
    );
    expect(serverInfo.capabilities?.voice?.voice?.reason).toBe("");

    await server.close();
  });

  test("broadcasts updated server_info when capabilities change", async () => {
    const server = createServer();

    const socket = new MockSocket();
    await attachRelayAndHello({
      server,
      socket,
      clientId: "cid-server-info-broadcast",
    });
    expect(socket.sent).toHaveLength(1);

    const speechReadiness = createReadySpeechReadinessSnapshot();
    server.publishSpeechReadiness(speechReadiness);
    expect(socket.sent).toHaveLength(2);

    const secondEnvelope = parseSentEnvelope(socket.sent[1]);
    const secondPayload = parseServerInfoStatusPayload(secondEnvelope.message?.payload);
    expect(secondPayload?.capabilities?.voice?.dictation.enabled).toBe(true);
    expect(secondPayload?.capabilities?.voice?.voice.enabled).toBe(true);

    // Same readiness should not produce another server_info broadcast.
    server.publishSpeechReadiness(speechReadiness);
    expect(socket.sent).toHaveLength(2);

    await server.close();
  });

  test("includes temporary retry guidance while models are downloading", async () => {
    const server = createServer();
    const socket = new MockSocket();
    await attachRelayAndHello({
      server,
      socket,
      clientId: "cid-server-info-download-guidance",
    });
    expect(socket.sent).toHaveLength(1);

    server.publishSpeechReadiness(createDownloadInProgressSpeechReadinessSnapshot());
    expect(socket.sent).toHaveLength(2);

    const envelope = parseSentEnvelope(socket.sent[1]);
    const payload = parseServerInfoStatusPayload(envelope.message?.payload);
    expect(payload?.capabilities?.voice?.dictation.enabled).toBe(true);
    expect(payload?.capabilities?.voice?.voice.enabled).toBe(true);
    expect(payload?.capabilities?.voice?.dictation.reason).toContain("Try again in a few minutes.");
    expect(payload?.capabilities?.voice?.voice.reason).toContain("Try again in a few minutes.");

    await server.close();
  });

  test("routes inbound terminal frames to session.handleBinaryFrame", async () => {
    const server = createServer();

    const socket = new MockSocket();
    await attachRelayAndHello({
      server,
      socket,
      clientId: "cid-binary-inbound",
    });
    expect(sessionMock.instances).toHaveLength(1);
    const session = sessionMock.instances[0];

    socket.emit(
      "message",
      Buffer.from(
        encodeTerminalStreamFrame({
          opcode: TerminalStreamOpcode.Input,
          slot: 9,
          payload: new TextEncoder().encode("ls\r"),
        }),
      ),
    );
    await Promise.resolve();

    expect(session.handleBinaryFrame).toHaveBeenCalledTimes(1);
    const frame = BinaryFrameSchema.parse(session.handleBinaryFrame.mock.calls[0]?.[0]);
    expect(frame.opcode).toBe(TerminalStreamOpcode.Input);
    expect(frame.slot).toBe(9);
    expect(new TextDecoder().decode(frame.payload)).toBe("ls\r");

    await server.close();
  });

  test("sends outbound terminal frames from session over websocket", async () => {
    const server = createServer();

    const socket = new MockSocket();
    await attachRelayAndHello({
      server,
      socket,
      clientId: "cid-binary-outbound",
    });
    expect(sessionMock.instances).toHaveLength(1);
    const session = sessionMock.instances[0];

    const { onBinaryMessage } = session.args;
    expect(onBinaryMessage).toBeTypeOf("function");
    if (typeof onBinaryMessage === "function") {
      onBinaryMessage(new Uint8Array([TerminalStreamOpcode.Output, 12, 0x6f, 0x6b]));
    }

    expect(socket.sent).toHaveLength(2);
    const binaryPayload = asUint8Array(socket.sent[1]);
    expect(binaryPayload).not.toBeNull();
    const frame = decodeTerminalStreamFrame(binaryPayload!);
    expect(frame).not.toBeNull();
    expect(frame!.opcode).toBe(TerminalStreamOpcode.Output);
    expect(frame!.slot).toBe(12);
    expect(new TextDecoder().decode(frame!.payload ?? new Uint8Array())).toBe("ok");

    await server.close();
  });

  test("advertises generative UI support in server_info", async () => {
    const server = createServer();
    const socket = new MockSocket();
    const serverInfo = await attachRelayAndHello({
      server,
      socket,
      clientId: "cid-gen-ui-feature",
    });
    expect(serverInfo.features?.generativeUi).toBe(true);
    await server.close();
  });
});
