import { randomUUID } from "node:crypto";
import type { IncomingMessage, Server as HTTPServer } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer } from "ws";
import type pino from "pino";
import type { KeyPair } from "@chisacode/relay/e2ee";
import type { IceServerConfig } from "@chisacode/protocol/connection-offer";
import type { TransportMode } from "@chisacode/protocol/webrtc-signaling";
import type { ExternalSocketMetadata } from "./websocket-server.js";
import {
  RELAY_DATA_MAX_PAYLOAD_BYTES,
  attachEncryptedSocket,
  type RelaySocketLike,
} from "./relay-transport.js";

export const LAN_E2EE_WS_PATH = "/lan-ws";

export interface LanE2eeTransportOptions {
  httpServer: HTTPServer;
  logger: pino.Logger;
  attachSocket: (ws: RelaySocketLike, metadata?: ExternalSocketMetadata) => Promise<void>;
  serverId: string;
  daemonKeyPair: KeyPair;
  chisacodeHome?: string;
  daemonPublicKeyB64?: string;
  /** Always defaults true: LAN E2EE connections require pairing token or device HMAC proof. */
  requireDeviceAuth?: boolean;
  iceServers?: readonly IceServerConfig[];
  onTransportModeChange?: (info: { connectionId: string; mode: TransportMode }) => void;
}

export interface LanE2eeTransportController {
  stop: () => Promise<void>;
}

function isLoopbackRemoteAddress(address: string | undefined): boolean {
  if (!address) return false;
  return (
    address === "127.0.0.1" ||
    address === "::1" ||
    address === "::ffff:127.0.0.1"
  );
}

function rejectUpgrade(socket: Duplex, statusCode: number, reason: string): void {
  try {
    socket.write(
      `HTTP/1.1 ${statusCode} ${reason}\r\nConnection: close\r\nContent-Type: text/plain\r\nContent-Length: ${Buffer.byteLength(reason)}\r\n\r\n${reason}`,
    );
  } catch {
    // ignore
  }
  try {
    socket.destroy();
  } catch {
    // ignore
  }
}

/**
 * Exposes a loopback-only E2EE WebSocket endpoint (`/lan-ws`) on the daemon's
 * loopback HTTP server for zero-external-server LAN pairing and direct LAN RPC.
 *
 * Security invariants:
 * - Accepts upgrades ONLY on `/lan-ws` from loopback (`127.0.0.1` / `::1`) so
 *   only the desktop shell's `mobile-web-server` bridge (or local tests) can reach it.
 * - Never exposes unauthenticated Express routes; every connection goes through
 *   `attachEncryptedSocket` (Curve25519 E2EE) with `requireDeviceAuth: true`.
 */
export function startLanE2eeTransport(
  options: LanE2eeTransportOptions,
): LanE2eeTransportController {
  const {
    httpServer,
    logger,
    attachSocket,
    serverId,
    daemonKeyPair,
    chisacodeHome,
    daemonPublicKeyB64,
    requireDeviceAuth = true,
    iceServers,
    onTransportModeChange,
  } = options;

  const lanLogger = logger.child({ module: "lan-e2ee-transport" });
  const wss = new WebSocketServer({
    noServer: true,
    perMessageDeflate: false,
    maxPayload: RELAY_DATA_MAX_PAYLOAD_BYTES,
  });

  const handleUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer): void => {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(req.url ?? "/", "http://127.0.0.1");
    } catch {
      return;
    }
    if (parsedUrl.pathname !== LAN_E2EE_WS_PATH) {
      return;
    }

    if (!isLoopbackRemoteAddress(req.socket?.remoteAddress)) {
      lanLogger.warn(
        { remoteAddress: req.socket?.remoteAddress },
        "lan_e2ee_rejected_non_loopback",
      );
      rejectUpgrade(socket, 403, "Forbidden");
      return;
    }

    const requestedServerId = parsedUrl.searchParams.get("serverId");
    if (requestedServerId && requestedServerId !== serverId) {
      lanLogger.warn(
        { requestedServerId },
        "lan_e2ee_rejected_server_id_mismatch",
      );
      rejectUpgrade(socket, 404, "Server ID mismatch");
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      const connectionId = `lan-${randomUUID()}`;
      const connLogger = lanLogger.child({ connectionId });
      connLogger.info({ connectionId, mode: "lan" }, "remote_client_transport_mode");
      onTransportModeChange?.({ connectionId, mode: "lan" });

      const externalMetadata: ExternalSocketMetadata = {
        transport: "relay",
        externalSessionKey: `session:${connectionId}`,
        requireDeviceAuth,
        chisacodeHome,
        daemonPublicKeyB64,
        serverId,
      };

      void attachEncryptedSocket(
        ws,
        daemonKeyPair,
        connLogger,
        attachSocket,
        externalMetadata,
        {
          connectionId,
          initialMode: "lan",
          iceServers,
          onTransportModeChange: (mode) => {
            connLogger.info({ connectionId, mode }, "remote_client_transport_mode");
            onTransportModeChange?.({ connectionId, mode });
          },
        },
      );
    });
  };

  httpServer.on("upgrade", handleUpgrade);
  lanLogger.info({ path: LAN_E2EE_WS_PATH }, "lan_e2ee_transport_ready");

  const stop = async (): Promise<void> => {
    httpServer.off("upgrade", handleUpgrade);
    for (const client of wss.clients) {
      try {
        client.close(1001, "Server shutting down");
      } catch {
        // ignore
      }
    }
    await new Promise<void>((resolve) => {
      wss.close(() => resolve());
    });
  };

  return { stop };
}
