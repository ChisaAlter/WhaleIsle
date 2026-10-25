import { afterEach, describe, expect, it, vi } from "vitest";
import {
  exportRelayAuthPublicKey,
  generateRelayAuthKeyPair,
  signRelayServerAuth,
} from "./crypto.js";
import relayWorker, { RelayDurableObject } from "./cloudflare-adapter.js";

type DurableObjectStateArg = ConstructorParameters<typeof RelayDurableObject>[0];
type RelayEnvArg = Parameters<typeof relayWorker.fetch>[1];

type MockSocket = WebSocket & {
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  serializeAttachment: ReturnType<typeof vi.fn>;
  deserializeAttachment: ReturnType<typeof vi.fn>;
};

function createMockSocket(attachment: unknown = null): MockSocket {
  let storedAttachment = attachment;
  return {
    send: vi.fn(),
    close: vi.fn(),
    serializeAttachment: vi.fn((value: unknown) => {
      storedAttachment = value;
    }),
    deserializeAttachment: vi.fn(() => storedAttachment),
  } as unknown as MockSocket;
}

function createMockState() {
  const socketsByTag = new Map<string, WebSocket[]>();
  const storage = new Map<string, unknown>();
  const state = {
    acceptWebSocket: vi.fn(),
    getWebSockets: vi.fn((tag?: string): WebSocket[] => {
      if (!tag) {
        const out: WebSocket[] = [];
        for (const sockets of socketsByTag.values()) out.push(...sockets);
        return out;
      }
      return socketsByTag.get(tag) ?? [];
    }),
    storage: {
      get: vi.fn(async (key: string) => storage.get(key)),
      put: vi.fn(async (key: string, value: unknown) => {
        storage.set(key, value);
      }),
    },
  };

  return {
    state,
    setTagSockets: (tag: string, sockets: WebSocket[]) => {
      socketsByTag.set(tag, sockets);
    },
  };
}

async function withMockWebSocketPair(
  run: (sockets: { clientWs: MockSocket; serverWs: MockSocket }) => Promise<void> | void,
): Promise<void> {
  const serverWs = createMockSocket();
  const clientWs = createMockSocket();
  const WebSocketPairMock = class {
    [index: number]: WebSocket;
    constructor() {
      this[0] = clientWs as unknown as WebSocket;
      this[1] = serverWs as unknown as WebSocket;
    }
  };

  const previousPair = (globalThis as unknown as { WebSocketPair?: unknown }).WebSocketPair;
  (globalThis as unknown as { WebSocketPair: unknown }).WebSocketPair = WebSocketPairMock;
  try {
    await run({ clientWs, serverWs });
  } finally {
    if (previousPair === undefined) {
      delete (globalThis as unknown as { WebSocketPair?: unknown }).WebSocketPair;
    } else {
      (globalThis as unknown as { WebSocketPair: unknown }).WebSocketPair = previousPair;
    }
  }
}

const swallow = () => undefined;

function signedServerUrl(params?: {
  readonly serverId?: string;
  readonly connectionId?: string;
  readonly keyPair?: ReturnType<typeof generateRelayAuthKeyPair>;
  readonly nonce?: string;
  readonly signatureOverride?: string;
  readonly issuedAt?: number;
}): string {
  const serverId = params?.serverId ?? "srv_test";
  const role = "server";
  const connectionId = params?.connectionId ?? "";
  const nonce = params?.nonce ?? "nonce-test-value";
  const issuedAt = params?.issuedAt ?? Date.now();
  const keyPair = params?.keyPair ?? generateRelayAuthKeyPair();
  const publicKeyB64 = exportRelayAuthPublicKey(keyPair.publicKey);
  const signatureB64 =
    params?.signatureOverride ??
    signRelayServerAuth({
      secretKey: keyPair.secretKey,
      serverId,
      role,
      connectionId,
      nonce,
      issuedAt,
    });
  const url = new URL("https://relay.test/ws");
  url.searchParams.set("role", role);
  url.searchParams.set("serverId", serverId);
  url.searchParams.set("v", "2");
  if (connectionId) {
    url.searchParams.set("connectionId", connectionId);
  }
  url.searchParams.set("relayAuthPublicKeyB64", publicKeyB64);
  url.searchParams.set("relayAuthNonce", nonce);
  url.searchParams.set("relayAuthIssuedAt", String(issuedAt));
  url.searchParams.set("relayAuthSignatureB64", signatureB64);
  return url.toString();
}

describe("RelayDurableObject versioning", () => {
  it("rejects legacy v1 sockets by default (v1 has no E2EE / no relay auth)", async () => {
    const { state } = createMockState();
    await withMockWebSocketPair(async () => {
      const relay = new RelayDurableObject(state as unknown as DurableObjectStateArg);
      const req = new Request("https://relay.test/ws?role=client&serverId=srv_test&v=1", {
        headers: {
          Upgrade: "websocket",
        },
      });
      const res = await relay.fetch(req).catch(swallow);
      expect(state.acceptWebSocket).not.toHaveBeenCalled();
      // The relay returns 400 (Invalid v parameter) when v1 is not allowed.
      expect(res?.status ?? 0).toBe(400);
    });
  });

  it("accepts legacy v1 sockets when RELAY_ALLOW_V1=1 is set (compat opt-in)", async () => {
    const { state } = createMockState();
    const previous = (globalThis as unknown as { RELAY_ALLOW_V1?: unknown }).RELAY_ALLOW_V1;
    (globalThis as unknown as { RELAY_ALLOW_V1: unknown }).RELAY_ALLOW_V1 = "1";
    try {
      await withMockWebSocketPair(async () => {
        const relay = new RelayDurableObject(state as unknown as DurableObjectStateArg);
        const req = new Request("https://relay.test/ws?role=client&serverId=srv_test&v=1", {
          headers: {
            Upgrade: "websocket",
          },
        });
        await relay.fetch(req).catch(swallow);
        expect(state.acceptWebSocket).toHaveBeenCalled();
      });
    } finally {
      if (previous === undefined) {
        delete (globalThis as unknown as { RELAY_ALLOW_V1?: unknown }).RELAY_ALLOW_V1;
      } else {
        (globalThis as unknown as { RELAY_ALLOW_V1: unknown }).RELAY_ALLOW_V1 = previous;
      }
    }
  });

  it("defaults a missing v parameter to v2 (not legacy v1)", async () => {
    const { state } = createMockState();
    await withMockWebSocketPair(async ({ serverWs }) => {
      const relay = new RelayDurableObject(state as unknown as DurableObjectStateArg);
      const req = new Request("https://relay.test/ws?role=client&serverId=srv_test", {
        headers: { Upgrade: "websocket" },
      });
      await relay.fetch(req).catch(swallow);
      expect(state.acceptWebSocket).toHaveBeenCalled();
      const attachment = serverWs.deserializeAttachment();
      expect(attachment).toMatchObject({ role: "client", version: "2" });
    });
  });

  it("rejects unsigned v2 server sockets by default", async () => {
    const { state } = createMockState();
    await withMockWebSocketPair(async () => {
      const relay = new RelayDurableObject(state as unknown as DurableObjectStateArg);
      const req = new Request("https://relay.test/ws?role=server&serverId=srv_test&v=2", {
        headers: { Upgrade: "websocket" },
      });

      const response = await relay.fetch(req);

      expect(response.status).toBe(401);
      expect(state.acceptWebSocket).not.toHaveBeenCalled();
    });
  });

  it("accepts v2 server sockets with a valid relay auth signature", async () => {
    const { state } = createMockState();
    await withMockWebSocketPair(async ({ serverWs }) => {
      const relay = new RelayDurableObject(state as unknown as DurableObjectStateArg);
      const req = new Request(signedServerUrl(), { headers: { Upgrade: "websocket" } });

      await relay.fetch(req).catch(swallow);

      expect(state.acceptWebSocket).toHaveBeenCalled();
      expect(serverWs.deserializeAttachment()).toMatchObject({
        role: "server",
        relayAuthPublicKeyB64: expect.any(String),
      });
    });
  });

  it("rejects a second v2 server socket signed by a different relay auth key", async () => {
    const firstKeyPair = generateRelayAuthKeyPair();
    const existingControl = createMockSocket({
      version: "2",
      role: "server",
      connectionId: null,
      serverId: "srv_test",
      relayAuthPublicKeyB64: exportRelayAuthPublicKey(firstKeyPair.publicKey),
      createdAt: Date.now(),
    });
    const { state, setTagSockets } = createMockState();
    setTagSockets("server-control", [existingControl]);

    await withMockWebSocketPair(async () => {
      const relay = new RelayDurableObject(state as unknown as DurableObjectStateArg);
      const req = new Request(signedServerUrl({ keyPair: generateRelayAuthKeyPair() }), {
        headers: { Upgrade: "websocket" },
      });

      const response = await relay.fetch(req);

      expect(response.status).toBe(401);
      expect(existingControl.close).not.toHaveBeenCalled();
      expect(state.acceptWebSocket).not.toHaveBeenCalled();
    });
  });

  it("rejects a replayed relay auth credential before replacing the existing server socket", async () => {
    const keyPair = generateRelayAuthKeyPair();
    const signedUrl = signedServerUrl({ keyPair, nonce: "nonce-replay-test" });
    const existingControl = createMockSocket({
      version: "2",
      role: "server",
      connectionId: null,
      serverId: "srv_test",
      relayAuthPublicKeyB64: exportRelayAuthPublicKey(keyPair.publicKey),
      createdAt: Date.now(),
    });
    const { state, setTagSockets } = createMockState();

    await withMockWebSocketPair(async () => {
      const relay = new RelayDurableObject(state as unknown as DurableObjectStateArg);
      await relay
        .fetch(new Request(signedUrl, { headers: { Upgrade: "websocket" } }))
        .catch(swallow);
      setTagSockets("server-control", [existingControl]);

      const resumedRelay = new RelayDurableObject(state as unknown as DurableObjectStateArg);
      const replayResponse = await resumedRelay.fetch(
        new Request(signedUrl, { headers: { Upgrade: "websocket" } }),
      );

      expect(replayResponse.status).toBe(401);
      expect(existingControl.close).not.toHaveBeenCalled();
      expect(state.acceptWebSocket).toHaveBeenCalledTimes(1);
    });
  });

  it("rejects expired relay auth credentials", async () => {
    const { state } = createMockState();
    await withMockWebSocketPair(async () => {
      const relay = new RelayDurableObject(state as unknown as DurableObjectStateArg);
      const req = new Request(signedServerUrl({ issuedAt: Date.now() - 6 * 60 * 1000 }), {
        headers: { Upgrade: "websocket" },
      });

      const response = await relay.fetch(req);

      expect(response.status).toBe(401);
      expect(state.acceptWebSocket).not.toHaveBeenCalled();
    });
  });

  it("assigns a connectionId when v2 client connects without one", async () => {
    const { state } = createMockState();
    await withMockWebSocketPair(async ({ serverWs }) => {
      const relay = new RelayDurableObject(state as unknown as DurableObjectStateArg);
      const req = new Request("https://relay.test/ws?role=client&serverId=srv_test&v=2", {
        headers: { Upgrade: "websocket" },
      });
      await relay.fetch(req).catch(swallow);
      expect(state.acceptWebSocket).toHaveBeenCalled();
      const attachment = serverWs.deserializeAttachment();
      expect(attachment).toMatchObject({
        role: "client",
        connectionId: expect.stringMatching(/^conn_/),
      });
    });
  });
});

describe("RelayDurableObject control nudge/reset behavior", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not nudge or reset control after the client already disconnected", () => {
    vi.useFakeTimers();
    const clientId = "clt_stale_timer";
    const control = createMockSocket();
    const { state, setTagSockets } = createMockState();

    setTagSockets("server-control", [control]);
    setTagSockets("client", []);
    setTagSockets(`client:${clientId}`, []);
    setTagSockets(`server:${clientId}`, []);

    const relay = new RelayDurableObject(state as unknown as DurableObjectStateArg);
    (
      relay as unknown as { nudgeOrResetControlForConnection(id: string): void }
    ).nudgeOrResetControlForConnection(clientId);

    vi.advanceTimersByTime(15_000);

    expect(control.send).not.toHaveBeenCalled();
    expect(control.close).not.toHaveBeenCalled();
  });

  it("resets control when the client remains connected but no server-data socket appears", () => {
    vi.useFakeTimers();
    const clientId = "clt_waiting_for_daemon";
    const control = createMockSocket();
    const client = createMockSocket({
      role: "client",
      connectionId: clientId,
      serverId: "srv_test",
      createdAt: Date.now(),
    });
    const { state, setTagSockets } = createMockState();

    setTagSockets("server-control", [control]);
    setTagSockets("client", [client]);
    setTagSockets(`client:${clientId}`, [client]);
    setTagSockets(`server:${clientId}`, []);

    const relay = new RelayDurableObject(state as unknown as DurableObjectStateArg);
    (
      relay as unknown as { nudgeOrResetControlForConnection(id: string): void }
    ).nudgeOrResetControlForConnection(clientId);

    vi.advanceTimersByTime(10_000);
    expect(control.send).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(5_000);
    expect(control.close).toHaveBeenCalledWith(1011, "Control unresponsive");
  });

  it("does not replace existing client sockets for the same connectionId", async () => {
    const existingClient = createMockSocket({
      version: "2",
      role: "client",
      connectionId: "clt_same_session",
      serverId: "srv_test",
      createdAt: Date.now(),
    });
    const { state, setTagSockets } = createMockState();
    setTagSockets("client:clt_same_session", [existingClient]);
    setTagSockets("client", [existingClient]);

    await withMockWebSocketPair(async () => {
      const relay = new RelayDurableObject(state as unknown as DurableObjectStateArg);
      const req = new Request(
        "https://relay.test/ws?role=client&serverId=srv_test&connectionId=clt_same_session&v=2",
        {
          headers: {
            Upgrade: "websocket",
          },
        },
      );

      await relay.fetch(req).catch(swallow);
      expect(existingClient.close).not.toHaveBeenCalled();
    });
  });

  it("reconnects existing clients before replacing their encrypted server data channel", async () => {
    const connectionId = "conn_encrypted_replacement";
    const previousServer = createMockSocket();
    const client = createMockSocket();
    const { state, setTagSockets } = createMockState();
    setTagSockets(`server:${connectionId}`, [previousServer]);
    setTagSockets(`client:${connectionId}`, [client]);
    const relay = new RelayDurableObject(state as unknown as DurableObjectStateArg);

    await withMockWebSocketPair(async () => {
      await relay
        .fetch(
          new Request(signedServerUrl({ connectionId }), {
            headers: { Upgrade: "websocket" },
          }),
        )
        .catch(swallow);
    });

    expect(client.close).toHaveBeenCalledWith(1012, "Server disconnected");
    expect(previousServer.close).toHaveBeenCalledWith(1008, "Replaced by new connection");
    expect(client.close.mock.invocationCallOrder[0]).toBeLessThan(
      previousServer.close.mock.invocationCallOrder[0]!,
    );
    expect(state.acceptWebSocket).toHaveBeenCalled();
  });

  it("keeps the replacement client connected when a displaced server data socket closes", () => {
    const connectionId = "conn_replaced";
    const previousServer = createMockSocket({
      version: "2",
      role: "server",
      connectionId,
      serverId: "srv_test",
      createdAt: 1,
    });
    const replacement = createMockSocket({
      version: "2",
      role: "server",
      connectionId,
      serverId: "srv_test",
      createdAt: 2,
    });
    Object.defineProperty(replacement, "readyState", { value: WebSocket.OPEN });
    const client = createMockSocket();
    const { state, setTagSockets } = createMockState();
    setTagSockets(`server:${connectionId}`, [replacement]);
    setTagSockets(`client:${connectionId}`, [client]);
    const relay = new RelayDurableObject(state as unknown as DurableObjectStateArg);

    relay.webSocketClose(previousServer, 1008, "Replaced by new connection", true);

    expect(client.close).not.toHaveBeenCalled();
    relay.webSocketMessage(replacement, "new server data");
    expect(client.send).toHaveBeenCalledWith("new server data");
  });

  it.each([false, true])(
    "closes the client when no open server data socket remains (closing replacement: %s)",
    (closingReplacement) => {
      const connectionId = "conn_dropped";
      const server = createMockSocket({
        version: "2",
        role: "server",
        connectionId,
        serverId: "srv_test",
        createdAt: 1,
      });
      const replacement = createMockSocket();
      Object.defineProperty(replacement, "readyState", { value: WebSocket.CLOSING });
      const client = createMockSocket();
      const { state, setTagSockets } = createMockState();
      setTagSockets(`server:${connectionId}`, closingReplacement ? [server, replacement] : []);
      setTagSockets(`client:${connectionId}`, [client]);
      const relay = new RelayDurableObject(state as unknown as DurableObjectStateArg);

      relay.webSocketClose(server, 1006, "Connection lost", false);

      expect(client.close).toHaveBeenCalledWith(1012, "Server disconnected");
    },
  );

  it("keeps server data socket alive while at least one client socket remains", () => {
    const clientId = "clt_multi";
    const disconnectedClient = createMockSocket({
      version: "2",
      role: "client",
      connectionId: clientId,
      serverId: "srv_test",
      createdAt: Date.now(),
    });
    const stillConnectedClient = createMockSocket({
      version: "2",
      role: "client",
      connectionId: clientId,
      serverId: "srv_test",
      createdAt: Date.now(),
    });
    const serverData = createMockSocket();
    const control = createMockSocket();
    const { state, setTagSockets } = createMockState();

    setTagSockets("server-control", [control]);
    setTagSockets(`server:${clientId}`, [serverData]);
    setTagSockets("client", [stillConnectedClient]);
    setTagSockets(`client:${clientId}`, [stillConnectedClient]);

    const relay = new RelayDurableObject(state as unknown as DurableObjectStateArg);
    relay.webSocketClose(
      disconnectedClient as unknown as WebSocket,
      1001,
      "Client disconnected",
      true,
    );

    expect(serverData.close).not.toHaveBeenCalled();
    expect(control.send).not.toHaveBeenCalledWith(
      JSON.stringify({ type: "disconnected", connectionId: clientId }),
    );
  });
});

describe("relay worker endpoint routing", () => {
  it("routes missing v to the current v2 DO id (not legacy v1)", async () => {
    const fetch = vi.fn(
      async (request: Request) => new Response(`ok:${new URL(request.url).searchParams.get("v")}`),
    );
    const get = vi.fn(() => ({ fetch }));
    const idFromName = vi.fn(() => ({ toString: () => "id" }));

    const response = await relayWorker.fetch(
      new Request("https://relay.test/ws?serverId=srv_test&role=server"),
      { RELAY: { idFromName, get } } as unknown as RelayEnvArg,
    );

    expect(idFromName).toHaveBeenCalledWith("relay-v2:srv_test");
    expect(fetch).toHaveBeenCalledTimes(1);
    await expect(response.text()).resolves.toBe("ok:2");
  });

  it("rejects explicit v=1 when RELAY_ALLOW_V1 is not set", async () => {
    const fetch = vi.fn();
    const get = vi.fn(() => ({ fetch }));
    const idFromName = vi.fn(() => ({ toString: () => "id" }));

    const response = await relayWorker.fetch(
      new Request("https://relay.test/ws?serverId=srv_test&role=server&v=1"),
      { RELAY: { idFromName, get } } as unknown as RelayEnvArg,
    );

    expect(response.status).toBe(400);
    expect(idFromName).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("routes v=2 to v2 isolated DO ids", async () => {
    const fetch = vi.fn(
      async (request: Request) => new Response(`ok:${new URL(request.url).searchParams.get("v")}`),
    );
    const get = vi.fn(() => ({ fetch }));
    const idFromName = vi.fn(() => ({ toString: () => "id" }));

    const response = await relayWorker.fetch(
      new Request("https://relay.test/ws?serverId=srv_test&role=server&v=2"),
      { RELAY: { idFromName, get } } as unknown as RelayEnvArg,
    );

    expect(idFromName).toHaveBeenCalledWith("relay-v2:srv_test");
    expect(fetch).toHaveBeenCalledTimes(1);
    await expect(response.text()).resolves.toBe("ok:2");
  });

  it("rejects invalid v values", async () => {
    const fetch = vi.fn();
    const get = vi.fn(() => ({ fetch }));
    const idFromName = vi.fn(() => ({ toString: () => "id" }));

    const response = await relayWorker.fetch(
      new Request("https://relay.test/ws?serverId=srv_test&role=server&v=nope"),
      { RELAY: { idFromName, get } } as unknown as RelayEnvArg,
    );

    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toBe(
      "Invalid v parameter (expected 2; v1 requires RELAY_ALLOW_V1=1)",
    );
    expect(idFromName).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects an invalid serverId (bad charset or too long)", async () => {
    const fetch = vi.fn();
    const get = vi.fn(() => ({ fetch }));
    const idFromName = vi.fn(() => ({ toString: () => "id" }));

    // Contains a space and a slash — rejected by SERVER_ID_PATTERN.
    const response = await relayWorker.fetch(
      new Request("https://relay.test/ws?serverId=bad%2Fid%20here&role=server&v=2"),
      { RELAY: { idFromName, get } } as unknown as RelayEnvArg,
    );

    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toBe("Invalid serverId parameter");
    expect(idFromName).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});
