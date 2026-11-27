import { mkdtempSync, rmSync } from "node:fs";
import type { Server as HTTPServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type pino from "pino";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  createClientChannel,
  exportPublicKey,
  generateKeyPair,
  type Transport as RelayTransport,
} from "@chisacode/relay/e2ee";

import type { AgentManager } from "./agent/agent-manager.js";
import type { AgentStorage } from "./agent/agent-storage.js";
import type { CheckoutDiffManager } from "./checkout-diff-manager.js";
import type { DaemonConfigStore } from "./daemon-config-store.js";
import type { FileBackedChatService } from "./chat/chat-service.js";
import type { DownloadTokenStore } from "./file-download/token-store.js";
import type { LoopService } from "./loop-service.js";
import { computeRelayDeviceAuthProof } from "./relay-device-auth.js";
import { RelayDeviceCredentialStore } from "./relay-device-credential-store.js";
import { attachEncryptedSocket } from "./relay-transport.js";
import type { ScheduleService } from "./schedule/service.js";
import { createStub } from "./test-utils/class-mocks.js";
import { createProviderSnapshotManagerStub } from "./test-utils/session-stubs.js";

const wsModuleMock = vi.hoisted(() => {
  class MockWebSocketServer {
    on() {
      return this;
    }
    close() {}
  }
  return { MockWebSocketServer };
});

const sessionMock = vi.hoisted(() => {
  const instances: MockSession[] = [];
  class MockSession {
    cleanup = vi.fn(async () => {});
    handleMessage = vi.fn(async () => {});
    handleBinaryFrame = vi.fn(() => {});
    supports = vi.fn(() => false);
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
    constructor(readonly args: Record<string, unknown>) {
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
    async sendPush(): Promise<void> {}
  },
}));

import { VoiceAssistantWebSocketServer } from "./websocket-server.js";

type SocketListener = (...args: unknown[]) => void;

class MockSocket {
  readyState = 1;
  bufferedAmount = 0;
  sent: unknown[] = [];
  closeCalls: Array<{ code?: number; reason?: string }> = [];
  private listeners = new Map<string, SocketListener[]>();

  on(event: "open" | "message" | "close" | "error" | "pong", listener: SocketListener): void {
    const list = this.listeners.get(event) ?? [];
    list.push(listener);
    this.listeners.set(event, list);
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
    this.closeCalls.push({ code, reason });
    this.readyState = 3;
    this.emit("close", code ?? 1000, reason ?? "");
  }

  terminate(): void {
    this.readyState = 3;
    this.emit("close", 1006, "");
  }

  ping(): void {}

  emit(event: string, ...args: unknown[]): void {
    for (const listener of (this.listeners.get(event) ?? []).slice()) {
      listener(...args);
    }
  }

  private off(event: "close" | "error", listener: SocketListener): void {
    const list = this.listeners.get(event) ?? [];
    this.listeners.set(
      event,
      list.filter((entry) => entry !== listener),
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

function createServer() {
  return new VoiceAssistantWebSocketServer(
    createStub<HTTPServer>({}),
    createStub<pino.Logger>(createLogger()),
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
    createStub<DaemonConfigStore>({ onChange: vi.fn(() => () => {}) }),
    null,
    { allowedOrigins: new Set() },
    undefined,
    undefined,
    undefined,
    "1.2.3-test",
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

async function attachAuthenticatedRelayHello(params: {
  server: VoiceAssistantWebSocketServer;
  socket: MockSocket;
  home: string;
  deviceId: string;
  deviceSecret: string;
  clientId: string;
  challenge: string;
  clientPub?: string;
}) {
  const clientPublicKeyB64 = params.clientPub ?? `client_pub_${params.challenge}`;
  const daemonPublicKeyB64 = "daemon_pub_b64";
  const serverId = "srv_test";
  await params.server.attachExternalSocket(params.socket, {
    transport: "relay",
    requireDeviceAuth: true,
    chisacodeHome: params.home,
    serverId,
    daemonPublicKeyB64,
    relayClientPublicKeyB64: clientPublicKeyB64,
    relayAuthChallenge: params.challenge,
  });
  const proof = computeRelayDeviceAuthProof(params.deviceSecret, {
    serverId,
    daemonPublicKeyB64,
    clientPublicKeyB64,
    deviceId: params.deviceId,
    challenge: params.challenge,
  });
  params.socket.emit(
    "message",
    JSON.stringify({
      type: "hello",
      clientId: params.clientId,
      clientType: "cli",
      protocolVersion: 1,
      relayDeviceAuth: {
        version: 1,
        deviceId: params.deviceId,
        proof,
        challenge: params.challenge,
        clientPublicKeyB64,
      },
    }),
  );
  await Promise.resolve();
}

describe("WebSocket server device revocation & E2EE handshake timeout", () => {
  const cleanup: string[] = [];

  afterEach(() => {
    vi.useRealTimers();
    sessionMock.instances.length = 0;
    for (const dir of cleanup.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a) disconnectDevice revokes pending, dual-socket active, and 90s-grace sessions (returns 3) and clears grace timers", async () => {
    vi.useFakeTimers();
    const home = mkdtempSync(join(tmpdir(), "ws-revoke-states-"));
    cleanup.push(home);
    const store = new RelayDeviceCredentialStore(home);
    const targetDev = store.issueDevice("Phone A", "dev_revoked_target");

    const server = createServer();
    const internals = server as unknown as {
      pendingConnections: Map<MockSocket, { authenticatedDeviceId?: string }>;
      sessions: Map<MockSocket, unknown>;
      externalSessionsByKey: Map<string, { authenticatedDeviceId?: string | null }>;
    };

    // 1. Active session with 2 sockets on same clientId + deviceId
    const activeWs1 = new MockSocket();
    const activeWs2 = new MockSocket();
    await attachAuthenticatedRelayHello({
      server,
      socket: activeWs1,
      home,
      ...targetDev,
      clientId: "cid-active",
      challenge: "challenge_active_socket_01",
    });
    await attachAuthenticatedRelayHello({
      server,
      socket: activeWs2,
      home,
      ...targetDev,
      clientId: "cid-active",
      challenge: "challenge_active_socket_02",
    });

    // 2. Session disconnected into 90s reconnect grace window (0 open sockets)
    const graceWs = new MockSocket();
    await attachAuthenticatedRelayHello({
      server,
      socket: graceWs,
      home,
      ...targetDev,
      clientId: "cid-grace",
      challenge: "challenge_grace_socket_01",
    });
    graceWs.emit("close", 1006, "");
    expect(internals.externalSessionsByKey.size).toBe(2);

    // 3. Pending connection with authenticatedDeviceId (awaiting promotion)
    const pendingWs = new MockSocket();
    await server.attachExternalSocket(pendingWs, { transport: "relay" });
    const pendingEntry = internals.pendingConnections.get(pendingWs);
    expect(pendingEntry).toBeTruthy();
    if (pendingEntry) {
      pendingEntry.authenticatedDeviceId = targetDev.deviceId;
    }

    expect(sessionMock.instances).toHaveLength(2);
    const [activeSession, graceSession] = sessionMock.instances;

    const disconnected = await server.disconnectDevice(targetDev.deviceId);
    expect(disconnected).toBe(3);

    for (const sock of [pendingWs, activeWs1, activeWs2]) {
      expect(sock.closeCalls).toContainEqual({ code: 4003, reason: "Device revoked" });
    }
    expect(activeSession.cleanup).toHaveBeenCalledTimes(1);
    expect(graceSession.cleanup).toHaveBeenCalledTimes(1);
    for (const conn of internals.externalSessionsByKey.values()) {
      expect(conn.authenticatedDeviceId).not.toBe(targetDev.deviceId);
    }

    await vi.advanceTimersByTimeAsync(90_000);
    expect(graceSession.cleanup).toHaveBeenCalledTimes(1);

    await server.close();
  });

  test("d) disconnectDevice leaves another authenticated device session intact", async () => {
    const home = mkdtempSync(join(tmpdir(), "ws-revoke-bystander-"));
    cleanup.push(home);
    const store = new RelayDeviceCredentialStore(home);
    const targetDev = store.issueDevice("Phone A", "dev_revoked_target_2");
    const bystanderDev = store.issueDevice("Phone B", "dev_bystander_ok");

    const server = createServer();
    const activeWs = new MockSocket();
    await attachAuthenticatedRelayHello({
      server,
      socket: activeWs,
      home,
      ...targetDev,
      clientId: "cid-target",
      challenge: "challenge_target_socket_01",
    });
    const bystanderWs = new MockSocket();
    await attachAuthenticatedRelayHello({
      server,
      socket: bystanderWs,
      home,
      ...bystanderDev,
      clientId: "cid-bystander",
      challenge: "challenge_bystander_ok_01",
    });
    const [targetSession, bystanderSession] = sessionMock.instances;

    expect(await server.disconnectDevice(targetDev.deviceId)).toBe(1);
    expect(targetSession.cleanup).toHaveBeenCalledTimes(1);
    expect(bystanderWs.readyState).toBe(1);
    expect(bystanderWs.closeCalls).toHaveLength(0);
    expect(bystanderSession.cleanup).not.toHaveBeenCalled();

    await server.close();
  });

  test("b) device revoked mid-E2EE-handshake fails hello auth with 4401 even when carrying prior clientId", async () => {
    const home = mkdtempSync(join(tmpdir(), "ws-revoke-handshake-"));
    cleanup.push(home);
    const store = new RelayDeviceCredentialStore(home);
    const dev = store.issueDevice("Mid Handshake Phone", "dev_mid_handshake");
    const daemonKeyPair = generateKeyPair();
    const daemonPubB64 = exportPublicKey(daemonKeyPair.publicKey);

    const server = createServer();
    const internals = server as unknown as { sessions: Map<MockSocket, unknown> };
    const serverSocket = new MockSocket();
    const queuedClientFrames: Array<string | Uint8Array | ArrayBuffer> = [];
    let releaseHandshake = false;

    let clientOnMessage: ((data: string | ArrayBuffer) => void) | null = null;
    const clientTransport: RelayTransport = {
      send(data) {
        if (releaseHandshake) {
          serverSocket.emit("message", data);
        } else {
          queuedClientFrames.push(data);
        }
      },
      close() {},
      set onmessage(fn: ((data: string | ArrayBuffer) => void) | null) {
        clientOnMessage = fn;
      },
      get onmessage() {
        return clientOnMessage;
      },
      onclose: null,
      onerror: null,
    };

    serverSocket.send = (data: unknown) => {
      serverSocket.sent.push(data);
      if (typeof data === "string" || data instanceof ArrayBuffer) {
        clientOnMessage?.(data);
      }
    };

    const serverLogger = createStub<pino.Logger>(createLogger());
    const attachDone = attachEncryptedSocket(
      serverSocket,
      daemonKeyPair,
      serverLogger,
      async (ws, metadata) => {
        await server.attachExternalSocket(ws, metadata);
      },
      {
        transport: "relay",
        requireDeviceAuth: true,
        chisacodeHome: home,
        serverId: "srv_test",
        daemonPublicKeyB64: daemonPubB64,
      },
      { enableWebRtcUpgrade: false },
    );

    const clientClosed: Array<{ code?: number; reason?: string }> = [];
    const clientChannel = await createClientChannel(clientTransport, daemonPubB64, {
      onclose: (code, reason) => clientClosed.push({ code, reason }),
    });

    // Device is paused before e2ee_hello arrives; revoke it now mid-handshake.
    expect(store.revokeDevice(dev.deviceId)).toBe(true);
    await server.disconnectDevice(dev.deviceId);

    // Flush queued e2ee_hello so handshake finishes and yields securityContext
    releaseHandshake = true;
    for (const frame of queuedClientFrames.splice(0)) {
      serverSocket.emit("message", frame);
    }
    await new Promise((r) => setTimeout(r, 40));

    const ctx = clientChannel.getSecurityContext();
    expect(ctx).toBeTruthy();
    if (!ctx) {
      throw new Error("Expected security context after E2EE handshake");
    }
    const proof = computeRelayDeviceAuthProof(dev.deviceSecret, {
      serverId: "srv_test",
      daemonPublicKeyB64: daemonPubB64,
      clientPublicKeyB64: ctx.clientPublicKeyB64,
      deviceId: dev.deviceId,
      challenge: ctx.authChallenge,
    });
    clientChannel.send(
      JSON.stringify({
        type: "hello",
        clientId: "cid-existing-grace",
        clientType: "cli",
        protocolVersion: 1,
        relayDeviceAuth: {
          version: 1,
          deviceId: dev.deviceId,
          proof,
          challenge: ctx.authChallenge,
          clientPublicKeyB64: ctx.clientPublicKeyB64,
        },
      }),
    );

    await attachDone;
    await new Promise((r) => setTimeout(r, 40));

    expect(internals.sessions.size).toBe(0);
    expect(serverSocket.closeCalls).toContainEqual({
      code: 4401,
      reason: "Relay device auth failed",
    });
    expect(clientClosed.length).toBeGreaterThanOrEqual(0);
    await server.close();
  });

  test("c) attachEncryptedSocket closes silent half-open connection with 1008 after handshakeTimeoutMs", async () => {
    const daemonKeyPair = generateKeyPair();
    const stalledSocket = new MockSocket();
    const serverLogger = createStub<pino.Logger>(createLogger());

    await attachEncryptedSocket(
      stalledSocket,
      daemonKeyPair,
      serverLogger,
      async () => {},
      undefined,
      { enableWebRtcUpgrade: false, handshakeTimeoutMs: 50 },
    );

    expect(stalledSocket.closeCalls).toEqual([{ code: 1008, reason: "E2EE handshake timeout" }]);
  });
});
