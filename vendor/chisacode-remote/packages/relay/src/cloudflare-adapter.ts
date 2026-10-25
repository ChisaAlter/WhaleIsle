/**
 * Cloudflare Durable Objects adapter for the relay.
 *
 * This module provides a Durable Object class that can be deployed to
 * Cloudflare Workers. It uses WebSocket hibernation for cost efficiency.
 *
 * Each session gets its own Durable Object instance, identified by session ID.
 *
 * Wrangler config:
 * ```jsonc
 * {
 *   "durable_objects": {
 *     "bindings": [{ "name": "RELAY", "class_name": "RelayDurableObject" }]
 *   },
 *   "migrations": [{ "tag": "v1", "new_classes": ["RelayDurableObject"] }]
 * }
 * ```
 */

import type { ConnectionRole, RelaySessionAttachment } from "./types.js";
import { verifyRelayServerAuth } from "./crypto.js";

type RelayProtocolVersion = "1" | "2";

const LEGACY_RELAY_VERSION: RelayProtocolVersion = "1";
const CURRENT_RELAY_VERSION: RelayProtocolVersion = "2";
const RELAY_AUTH_MAX_AGE_MS = 5 * 60 * 1000;
const RELAY_AUTH_MAX_FUTURE_SKEW_MS = 30 * 1000;
const RELAY_AUTH_NONCE_RETENTION_MS = RELAY_AUTH_MAX_AGE_MS + RELAY_AUTH_MAX_FUTURE_SKEW_MS;
const RELAY_AUTH_NONCE_STORAGE_KEY = "relay-auth-used-nonces";
const RELAY_AUTH_MAX_TRACKED_NONCES = 512;
const RELAY_AUTH_NONCE_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

// v1 has no E2EE and no authentication on the relay route layer — anyone who
// knows a serverId can read/write all traffic for v1 sessions. Current client
// and daemon source always emit v=2 (see packages/protocol/src/daemon-endpoints.ts
// normalizeRelayProtocolVersion, fallback "2"). v1 is retained ONLY for
// backwards-compat with old deployments that omit `v`. To shut down the v1
// attack surface without breaking old clients in dev, the relay defaults a
// missing/empty `v` to v2 (the current protocol) and rejects an explicit `v=1`
// in production. Set RELAY_ALLOW_V1=1 on the Worker to re-enable v1 (e.g. for
// staged rollouts or local compat testing).
function resolveRelayVersion(rawValue: string | null): RelayProtocolVersion | null {
  if (rawValue == null || rawValue.trim() === "") return CURRENT_RELAY_VERSION;
  const value = rawValue.trim();
  if (value === CURRENT_RELAY_VERSION) return CURRENT_RELAY_VERSION;
  if (value === LEGACY_RELAY_VERSION) {
    if (allowLegacyV1()) return LEGACY_RELAY_VERSION;
    return null;
  }
  return null;
}

function allowLegacyV1(): boolean {
  const flag = Reflect.get(globalThis, "RELAY_ALLOW_V1");
  return flag === "1" || flag === 1 || flag === true;
}

function allowUnsignedServerAuth(): boolean {
  const flag = Reflect.get(globalThis, "RELAY_ALLOW_UNSIGNED_SERVER_AUTH");
  return flag === "1" || flag === 1 || flag === true;
}

// serverId is a bearer credential (72-bit `srv_<base64url>` from server-id.ts)
// but is also interpolated into a Durable Object id, so it must be constrained
// to a safe length/charset to avoid memory exhaustion or injection into the DO
// id namespace. Accept the legacy `srv_...` shape plus any reasonable short
// opaque token used by tests/overrides.
const SERVER_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

function isValidServerId(serverId: string): boolean {
  return SERVER_ID_PATTERN.test(serverId);
}

interface WebSocketPair {
  0: WebSocket;
  1: WebSocket;
}

interface DurableObjectState {
  acceptWebSocket(ws: WebSocket, tags?: string[]): void;
  getWebSockets(tag?: string): WebSocket[];
  storage: {
    get<T>(key: string): Promise<T | undefined>;
    put<T>(key: string, value: T): Promise<void>;
  };
}

interface UsedRelayAuthNonce {
  readonly key: string;
  readonly issuedAt: number;
}

interface RelayAuthCredential {
  readonly publicKeyB64: string;
  readonly nonce: string;
  readonly issuedAt: number;
  readonly signatureB64: string;
}

function readRelayAuthCredential(request: Request): RelayAuthCredential | null {
  const url = new URL(request.url);
  const publicKeyB64 = url.searchParams.get("relayAuthPublicKeyB64")?.trim() ?? "";
  const nonce = url.searchParams.get("relayAuthNonce")?.trim() ?? "";
  const issuedAt = Number(url.searchParams.get("relayAuthIssuedAt")?.trim() ?? "");
  const signatureB64 = url.searchParams.get("relayAuthSignatureB64")?.trim() ?? "";
  if (
    !publicKeyB64 ||
    !RELAY_AUTH_NONCE_PATTERN.test(nonce) ||
    !Number.isSafeInteger(issuedAt) ||
    !signatureB64
  ) {
    return null;
  }
  return { publicKeyB64, nonce, issuedAt, signatureB64 };
}

function isRelayAuthCredentialFresh(issuedAt: number, now = Date.now()): boolean {
  return issuedAt >= now - RELAY_AUTH_MAX_AGE_MS && issuedAt <= now + RELAY_AUTH_MAX_FUTURE_SKEW_MS;
}

function relayAuthRejected(message: string): { allowed: false; response: Response } {
  return { allowed: false, response: new Response(message, { status: 401 }) };
}

interface WebSocketWithAttachment extends WebSocket {
  serializeAttachment(value: unknown): void;
  deserializeAttachment(): unknown;
}

function hasAttachmentMethods(ws: WebSocket): ws is WebSocketWithAttachment {
  // Type-safe check for attachment methods - required for Cloudflare WebSocket hibernation API
  // Use Reflect to check for methods without type assertions
  return (
    "serializeAttachment" in ws &&
    "deserializeAttachment" in ws &&
    typeof Reflect.get(ws, "serializeAttachment") === "function" &&
    typeof Reflect.get(ws, "deserializeAttachment") === "function"
  );
}

function deserializeAttachment(ws: WebSocket): unknown {
  if (!hasAttachmentMethods(ws)) return null;
  try {
    return ws.deserializeAttachment();
  } catch {
    return null;
  }
}

function serializeAttachment(ws: WebSocket, value: unknown): void {
  if (!hasAttachmentMethods(ws)) {
    throw new Error("WebSocket does not support attachments");
  }
  ws.serializeAttachment(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function getRelayAuthPublicKeyFromAttachment(ws: WebSocket): string | null {
  const attachment = deserializeAttachment(ws);
  if (!isRecord(attachment)) return null;
  return getString(attachment, "relayAuthPublicKeyB64") ?? null;
}

function getGlobalWebSocketPair(): (new () => WebSocketPair) | undefined {
  // Access WebSocketPair from global scope (Cloudflare Workers runtime)
  // Use Reflect to access global property without type assertions
  const WebSocketPair = Reflect.get(globalThis, "WebSocketPair") as unknown;
  if (typeof WebSocketPair === "function") {
    return WebSocketPair as new () => WebSocketPair;
  }
  return undefined;
}

interface Env {
  RELAY: DurableObjectNamespace;
}

interface DurableObjectNamespace {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): DurableObjectStub;
}

interface DurableObjectId {
  toString(): string;
}

interface DurableObjectStub {
  fetch(request: Request): Promise<Response>;
}

/**
 * Durable Object that handles WebSocket relay for a single session.
 *
 * v1 WebSockets connect in two shapes:
 * - role=server: daemon socket
 * - role=client: app/client socket
 *
 * v2 WebSockets connect in three shapes:
 * - role=server (no connectionId): daemon control socket (one per serverId)
 * - role=server&connectionId=...: daemon per-connection data socket (one per connectionId)
 * - role=client&connectionId=...: app/client socket (many per connectionId)
 */
interface CFResponseInit extends ResponseInit {
  webSocket?: WebSocket;
}

export class RelayDurableObject {
  private state: DurableObjectState;
  private pendingFrames = new Map<string, Array<string | ArrayBuffer>>();

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  private createWebSocketPair(): [WebSocket, WebSocket] {
    const WebSocketPairCtor = getGlobalWebSocketPair();
    if (!WebSocketPairCtor) {
      throw new Error("WebSocketPair not available in global scope");
    }
    const pair: WebSocketPair = new WebSocketPairCtor();
    return [pair[0], pair[1]];
  }

  private requireWebSocketUpgrade(request: Request): Response | null {
    const upgradeHeader = request.headers.get("Upgrade");
    if (!upgradeHeader || upgradeHeader.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }
    return null;
  }

  private asSwitchingProtocolsResponse(client: WebSocket): Response {
    return new Response(null, {
      status: 101,
      webSocket: client,
    } as CFResponseInit);
  }

  private hasServerDataSocket(connectionId: string): boolean {
    try {
      return this.state.getWebSockets(`server:${connectionId}`).length > 0;
    } catch {
      return false;
    }
  }

  private hasClientSocket(connectionId: string): boolean {
    try {
      return this.state.getWebSockets(`client:${connectionId}`).length > 0;
    } catch {
      return false;
    }
  }

  private closeExistingServerSockets(args: {
    isServerControl: boolean;
    isServerData: boolean;
    resolvedConnectionId: string;
  }): void {
    if (args.isServerControl) {
      for (const ws of this.state.getWebSockets("server-control")) {
        ws.close(1008, "Replaced by new connection");
      }
    } else if (args.isServerData) {
      const previous = this.state.getWebSockets(`server:${args.resolvedConnectionId}`);
      if (previous.length > 0) {
        // A replacement starts a fresh encrypted channel. Existing clients must
        // reconnect before the old socket's delayed close callback can arrive.
        for (const client of this.state.getWebSockets(`client:${args.resolvedConnectionId}`)) {
          client.close(1012, "Server disconnected");
        }
      }
      for (const ws of previous) {
        ws.close(1008, "Replaced by new connection");
      }
    }
  }

  private getBoundRelayAuthPublicKeyB64(): string | null {
    for (const ws of this.state.getWebSockets()) {
      const publicKeyB64 = getRelayAuthPublicKeyFromAttachment(ws);
      if (publicKeyB64) return publicKeyB64;
    }
    return null;
  }

  private async consumeRelayAuthNonce(params: {
    publicKeyB64: string;
    nonce: string;
    issuedAt: number;
  }): Promise<boolean> {
    const now = Date.now();
    const stored =
      (await this.state.storage.get<UsedRelayAuthNonce[]>(RELAY_AUTH_NONCE_STORAGE_KEY)) ?? [];
    const recent = stored.filter((entry) => now - entry.issuedAt <= RELAY_AUTH_NONCE_RETENTION_MS);
    const key = `${params.publicKeyB64}:${params.nonce}`;
    if (recent.some((entry) => entry.key === key)) {
      return false;
    }
    recent.push({ key, issuedAt: params.issuedAt });
    await this.state.storage.put(
      RELAY_AUTH_NONCE_STORAGE_KEY,
      recent.slice(-RELAY_AUTH_MAX_TRACKED_NONCES),
    );
    return true;
  }

  private async verifyServerRelayAuth(params: {
    request: Request;
    serverId: string;
    connectionId: string;
  }): Promise<
    { allowed: true; publicKeyB64: string | null } | { allowed: false; response: Response }
  > {
    if (allowUnsignedServerAuth()) {
      return { allowed: true, publicKeyB64: null };
    }

    const credential = readRelayAuthCredential(params.request);
    if (!credential) {
      return relayAuthRejected("Relay server auth required");
    }

    if (!isRelayAuthCredentialFresh(credential.issuedAt)) {
      return relayAuthRejected("Relay server auth expired");
    }

    const boundPublicKeyB64 = this.getBoundRelayAuthPublicKeyB64();
    if (boundPublicKeyB64 && boundPublicKeyB64 !== credential.publicKeyB64) {
      return relayAuthRejected("Relay server auth key mismatch");
    }

    try {
      const verified = verifyRelayServerAuth({
        publicKeyB64: credential.publicKeyB64,
        signatureB64: credential.signatureB64,
        serverId: params.serverId,
        role: "server",
        connectionId: params.connectionId,
        nonce: credential.nonce,
        issuedAt: credential.issuedAt,
      });
      if (!verified) {
        return relayAuthRejected("Relay server auth failed");
      }
    } catch {
      return relayAuthRejected("Relay server auth failed");
    }

    if (!(await this.consumeRelayAuthNonce(credential))) {
      return relayAuthRejected("Relay server auth replayed");
    }

    return { allowed: true, publicKeyB64: credential.publicKeyB64 };
  }

  // COMPAT(relay-json-ping): Old daemons (< v0.1.76) send JSON {type:"ping"} on the control
  // socket and rely on a JSON {type:"pong"} reply to keep controlLastSeenAt fresh. New daemons
  // use WebSocket protocol pings (auto-answered at the edge, DO stays hibernated). Remove this
  // handler once the supported-daemon floor is >= v0.1.76 (target: 2026-11-13).
  private handleControlKeepalive(ws: WebSocket, message: string): void {
    try {
      const parsed: unknown = JSON.parse(message);
      const parsedRecord = isRecord(parsed) ? parsed : null;
      if (parsedRecord?.type !== "ping") return;
      // Logged so the daemon-side e2e idle test can assert no JSON ping reached the DO
      // (which would indicate a regression to app-level pings that wake the DO).
      console.log("[Relay DO] legacy_json_ping_received");
      try {
        ws.send(JSON.stringify({ type: "pong", ts: Date.now() }));
      } catch {
        // ignore
      }
    } catch {
      // ignore non-JSON control payloads
    }
  }

  private nudgeOrResetControlForConnection(connectionId: string): void {
    // If the daemon's control WS becomes half-open, the DO can't reliably detect it via ws.send errors
    // (Cloudflare may accept writes even if the other side is no longer reading).
    //
    // Instead, observe whether the daemon reacts by opening the per-connection server-data socket.
    // If it doesn't, nudge with a sync message; if still no reaction, force-close the control
    // socket(s) so the daemon reconnects.
    const initialDelayMs = 10_000;
    const secondDelayMs = 5_000;

    setTimeout(() => {
      if (!this.hasClientSocket(connectionId)) return;
      if (this.hasServerDataSocket(connectionId)) return;

      // First nudge: send a full sync list.
      this.notifyControls({ type: "sync", connectionIds: this.listConnectedConnectionIds() });

      setTimeout(() => {
        if (!this.hasClientSocket(connectionId)) return;
        if (this.hasServerDataSocket(connectionId)) return;

        // Still nothing: assume control is stuck and force a reconnect.
        for (const ws of this.state.getWebSockets("server-control")) {
          try {
            ws.close(1011, "Control unresponsive");
          } catch {
            // ignore
          }
        }
      }, secondDelayMs);
    }, initialDelayMs);
  }

  private bufferFrame(connectionId: string, message: string | ArrayBuffer): void {
    const existing = this.pendingFrames.get(connectionId) ?? [];
    existing.push(message);
    // Prevent unbounded memory growth if a daemon never connects.
    if (existing.length > 200) {
      existing.splice(0, existing.length - 200);
    }
    this.pendingFrames.set(connectionId, existing);
  }

  private flushFrames(connectionId: string, serverWs: WebSocket): void {
    const frames = this.pendingFrames.get(connectionId);
    if (!frames || frames.length === 0) return;
    this.pendingFrames.delete(connectionId);
    for (const frame of frames) {
      try {
        serverWs.send(frame);
      } catch {
        // If we can't flush, re-buffer and let the daemon re-establish.
        this.bufferFrame(connectionId, frame);
        break;
      }
    }
  }

  private listConnectedConnectionIds(): string[] {
    const out = new Set<string>();
    for (const ws of this.state.getWebSockets("client")) {
      try {
        const attachmentRaw = deserializeAttachment(ws);
        const attachment = isRecord(attachmentRaw) ? attachmentRaw : null;
        if (
          attachment?.role === "client" &&
          typeof attachment.connectionId === "string" &&
          attachment.connectionId
        ) {
          out.add(attachment.connectionId);
        }
      } catch {
        // ignore
      }
    }
    return Array.from(out);
  }

  private notifyControls(message: unknown): void {
    const text = JSON.stringify(message);
    for (const ws of this.state.getWebSockets("server-control")) {
      try {
        ws.send(text);
      } catch {
        // If the control socket is dead, close it so the daemon can reconnect.
        try {
          ws.close(1011, "Control send failed");
        } catch {
          // ignore
        }
      }
    }
  }

  private fetchV1(request: Request, role: ConnectionRole, serverId: string): Response {
    const upgradeError = this.requireWebSocketUpgrade(request);
    if (upgradeError) return upgradeError;

    for (const ws of this.state.getWebSockets(role)) {
      ws.close(1008, "Replaced by new connection");
    }

    const [client, server] = this.createWebSocketPair();
    this.state.acceptWebSocket(server, [role]);

    const attachment: RelaySessionAttachment = {
      serverId,
      role,
      version: LEGACY_RELAY_VERSION,
      connectionId: null,
      createdAt: Date.now(),
    };
    serializeAttachment(server, attachment);

    console.log(`[Relay DO] v1:${role} connected to session ${serverId}`);

    return this.asSwitchingProtocolsResponse(client);
  }

  private async fetchV2(
    request: Request,
    role: ConnectionRole,
    serverId: string,
    connectionId: string,
  ): Promise<Response> {
    const upgradeError = this.requireWebSocketUpgrade(request);
    if (upgradeError) return upgradeError;

    // If a client didn't provide a connectionId, the relay assigns one for routing.
    const resolvedConnectionId =
      role === "client" && !connectionId
        ? `conn_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`
        : connectionId;

    const isServerControl = role === "server" && !resolvedConnectionId;
    const isServerData = role === "server" && !!resolvedConnectionId;

    const serverAuth =
      role === "server"
        ? await this.verifyServerRelayAuth({
            request,
            serverId,
            connectionId: resolvedConnectionId,
          })
        : { allowed: true as const, publicKeyB64: null };
    if (!serverAuth.allowed) {
      return serverAuth.response;
    }

    // Close any existing server-side connection with the same identity.
    // - server-control: single per serverId
    // - server-data: single per connectionId
    // - client: many sockets per connectionId are allowed
    this.closeExistingServerSockets({ isServerControl, isServerData, resolvedConnectionId });

    const [client, server] = this.createWebSocketPair();

    const tags: string[] = [];
    if (role === "client") {
      tags.push("client", `client:${resolvedConnectionId}`);
    } else if (isServerControl) {
      tags.push("server-control");
    } else {
      tags.push("server", `server:${resolvedConnectionId}`);
    }

    this.state.acceptWebSocket(server, tags);

    const attachment: RelaySessionAttachment = {
      serverId,
      role,
      version: CURRENT_RELAY_VERSION,
      connectionId: resolvedConnectionId || null,
      relayAuthPublicKeyB64: serverAuth.publicKeyB64,
      createdAt: Date.now(),
    };
    serializeAttachment(server, attachment);

    let roleSuffix = "";
    if (isServerControl) {
      roleSuffix = "(control)";
    } else if (isServerData) {
      roleSuffix = `(data:${resolvedConnectionId})`;
    } else if (role === "client") {
      roleSuffix = `(${resolvedConnectionId})`;
    }
    console.log(`[Relay DO] v2:${role}${roleSuffix} connected to session ${serverId}`);

    if (role === "client") {
      this.notifyControls({ type: "connected", connectionId: resolvedConnectionId });
      this.nudgeOrResetControlForConnection(resolvedConnectionId);
    }

    if (isServerControl) {
      // Send current connection list so the daemon can attach existing connections.
      try {
        server.send(
          JSON.stringify({ type: "sync", connectionIds: this.listConnectedConnectionIds() }),
        );
      } catch {
        // ignore
      }
    }

    if (isServerData && resolvedConnectionId) {
      this.flushFrames(resolvedConnectionId, server);
    }

    return this.asSwitchingProtocolsResponse(client);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const roleRaw = url.searchParams.get("role");
    const role = roleRaw === "server" || roleRaw === "client" ? roleRaw : null;
    const serverId = url.searchParams.get("serverId");
    const connectionIdRaw = url.searchParams.get("connectionId");
    const connectionId = typeof connectionIdRaw === "string" ? connectionIdRaw.trim() : "";
    const version = resolveRelayVersion(url.searchParams.get("v"));

    if (!role || (role !== "server" && role !== "client")) {
      return new Response("Missing or invalid role parameter", { status: 400 });
    }

    if (!serverId) {
      return new Response("Missing serverId parameter", { status: 400 });
    }

    if (!isValidServerId(serverId)) {
      return new Response("Invalid serverId parameter", { status: 400 });
    }

    if (!version) {
      return new Response("Invalid v parameter (expected 2; v1 requires RELAY_ALLOW_V1=1)", {
        status: 400,
      });
    }

    if (version === LEGACY_RELAY_VERSION) {
      return this.fetchV1(request, role, serverId);
    }

    return await this.fetchV2(request, role, serverId, connectionId);
  }

  /**
   * Called when a WebSocket message is received (wakes from hibernation).
   */
  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    const attachmentRaw = deserializeAttachment(ws);
    if (!isRecord(attachmentRaw)) {
      console.error("[Relay DO] Message from WebSocket without attachment");
      return;
    }
    const attachment = attachmentRaw;

    const version = getString(attachment, "version") ?? LEGACY_RELAY_VERSION;

    if (version === LEGACY_RELAY_VERSION) {
      const targetRole = attachment.role === "server" ? "client" : "server";
      const targets = this.state.getWebSockets(targetRole);
      for (const target of targets) {
        try {
          target.send(message);
        } catch (error) {
          console.error(`[Relay DO] Failed to forward to ${targetRole}:`, error);
        }
      }
      return;
    }

    const role = getString(attachment, "role");
    const connectionId = getString(attachment, "connectionId");
    if (!connectionId) {
      // Control channel: support simple app-level keepalive.
      if (typeof message === "string") {
        this.handleControlKeepalive(ws, message);
      }
      return;
    }

    if (role === "client") {
      const servers = this.state.getWebSockets(`server:${connectionId}`);
      if (servers.length === 0) {
        this.bufferFrame(connectionId, message);
        return;
      }
      for (const target of servers) {
        try {
          target.send(message);
        } catch (error) {
          console.error(`[Relay DO] Failed to forward client->server(${connectionId}):`, error);
        }
      }
      return;
    }

    // server data socket -> client
    const targets = this.state.getWebSockets(`client:${connectionId}`);
    for (const target of targets) {
      try {
        target.send(message);
      } catch (error) {
        console.error(`[Relay DO] Failed to forward server->client(${connectionId}):`, error);
      }
    }
  }

  /**
   * Called when a WebSocket closes (wakes from hibernation).
   */
  webSocketClose(ws: WebSocket, code: number, reason: string, _wasClean: boolean): void {
    const attachmentRaw = deserializeAttachment(ws);
    if (!isRecord(attachmentRaw)) return;
    const attachment = attachmentRaw;

    const version = getString(attachment, "version") ?? LEGACY_RELAY_VERSION;
    const role = getString(attachment, "role");
    const connectionId = getString(attachment, "connectionId");
    const serverId = getString(attachment, "serverId");
    console.log(
      `[Relay DO] v${version}:${role ?? "unknown"}${connectionId ? `(${connectionId})` : ""} disconnected from session ${serverId ?? "unknown"} (${code}: ${reason})`,
    );

    if (version === LEGACY_RELAY_VERSION) {
      return;
    }

    if (role === "client" && connectionId) {
      const remainingClientSockets = this.state
        .getWebSockets(`client:${connectionId}`)
        .some((socket) => socket !== ws);
      if (remainingClientSockets) {
        return;
      }

      this.pendingFrames.delete(connectionId);
      // Last socket for this session closed: now clean up matching server-data socket.
      for (const serverWs of this.state.getWebSockets(`server:${connectionId}`)) {
        try {
          serverWs.close(1001, "Client disconnected");
        } catch {
          // ignore
        }
      }
      this.notifyControls({ type: "disconnected", connectionId });
      return;
    }

    if (role === "server" && connectionId) {
      const replacementIsOpen = this.state
        .getWebSockets(`server:${connectionId}`)
        .some((socket) => socket !== ws && socket.readyState === WebSocket.OPEN);
      if (replacementIsOpen) return;

      // Force the client to reconnect and re-handshake when the daemon side drops.
      for (const clientWs of this.state.getWebSockets(`client:${connectionId}`)) {
        try {
          clientWs.close(1012, "Server disconnected");
        } catch {
          // ignore
        }
      }
    }
  }

  /**
   * Called on WebSocket error.
   */
  webSocketError(ws: WebSocket, error: unknown): void {
    const attachmentRaw = deserializeAttachment(ws);
    const attachment = isRecord(attachmentRaw) ? attachmentRaw : null;
    const role = attachment ? getString(attachment, "role") : undefined;
    console.error(`[Relay DO] WebSocket error for ${role ?? "unknown"}:`, error);
  }
}

/**
 * Worker entry point that routes requests to the appropriate Durable Object.
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Health check
    if (url.pathname === "/health") {
      return new Response(JSON.stringify({ status: "ok" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // Relay endpoint
    if (url.pathname === "/ws") {
      const serverId = url.searchParams.get("serverId");
      if (!serverId) {
        return new Response("Missing serverId parameter", { status: 400 });
      }

      if (!isValidServerId(serverId)) {
        return new Response("Invalid serverId parameter", { status: 400 });
      }

      const version = resolveRelayVersion(url.searchParams.get("v"));
      if (!version) {
        return new Response("Invalid v parameter (expected 2; v1 requires RELAY_ALLOW_V1=1)", {
          status: 400,
        });
      }

      // Route to a version-isolated Durable Object instance.
      const id = env.RELAY.idFromName(`relay-v${version}:${serverId}`);
      const stub = env.RELAY.get(id);

      const normalizedUrl = new URL(request.url);
      normalizedUrl.searchParams.set("v", version);
      const normalizedRequest = new Request(normalizedUrl.toString(), request);
      return stub.fetch(normalizedRequest);
    }

    return new Response("Not found", { status: 404 });
  },
};
