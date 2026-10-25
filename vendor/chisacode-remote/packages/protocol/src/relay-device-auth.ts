import { z } from "zod/v3";

/**
 * Relay client-auth handshake version. Append-only evolution only.
 */
export const RELAY_DEVICE_AUTH_VERSION = 1 as const;

/**
 * Close codes used when relay device auth fails before session handlers run.
 * Keep stable; clients may map these to upgrade/re-pair UX.
 */
export const RELAY_AUTH_CLOSE_CODE = {
  REQUIRED: 4401,
  INVALID_PROOF: 4403,
  UNKNOWN_DEVICE: 4404,
  TOKEN_REPLAY: 4409,
  TIMEOUT: 4410,
  BUFFER_OVERFLOW: 4411,
} as const;

export const RelayAuthBootstrapSchema = z.object({
  version: z.literal(RELAY_DEVICE_AUTH_VERSION),
  /**
   * Enrollment credential from a one-time QR or a revocable persistent link.
   * Both exchange for an independent device secret over the encrypted channel.
   */
  pairingToken: z.string().min(16).max(256),
  /**
   * Absolute expiry as unix epoch milliseconds.
   */
  expiresAtMs: z.number().int().positive(),
  /** Missing means a short-lived one-time QR. Persistent links require explicit revocation. */
  kind: z.enum(["persistent"]).optional(),
});

export type RelayAuthBootstrap = z.infer<typeof RelayAuthBootstrapSchema>;

export const RelayDeviceAuthChallengeSchema = z.object({
  type: z.literal("relay_device_auth_challenge"),
  version: z.literal(RELAY_DEVICE_AUTH_VERSION),
  challenge: z.string().min(16).max(256),
  serverId: z.string().min(1),
});

export type RelayDeviceAuthChallenge = z.infer<typeof RelayDeviceAuthChallengeSchema>;

export const RelayDeviceAuthProofSchema = z.object({
  type: z.literal("relay_device_auth_proof"),
  version: z.literal(RELAY_DEVICE_AUTH_VERSION),
  deviceId: z.string().min(8).max(128),
  /**
   * Base64url HMAC-SHA256 over the canonical transcript.
   */
  proof: z.string().min(16).max(256),
  /**
   * When set, this is a first-time pairing exchange consuming the bootstrap token.
   */
  pairingToken: z.string().min(16).max(256).optional(),
});

export type RelayDeviceAuthProof = z.infer<typeof RelayDeviceAuthProofSchema>;

export const RelayDeviceAuthResultSchema = z.object({
  type: z.literal("relay_device_auth_result"),
  version: z.literal(RELAY_DEVICE_AUTH_VERSION),
  ok: z.boolean(),
  /**
   * Issued only on successful first pairing. Never logged by callers.
   */
  deviceSecret: z.string().min(32).max(256).optional(),
  reason: z.string().max(200).optional(),
  securityLevel: z.enum(["v2", "legacy"]).optional(),
});

export type RelayDeviceAuthResult = z.infer<typeof RelayDeviceAuthResultSchema>;

/**
 * Canonical transcript for HMAC proof. Field order is load-bearing.
 * @param input Transcript fields
 * @returns UTF-8 transcript string
 */
export function buildRelayDeviceAuthTranscript(input: {
  version: number;
  serverId: string;
  daemonPublicKeyB64: string;
  clientPublicKeyB64: string;
  deviceId: string;
  challenge: string;
}): string {
  return [
    `v=${input.version}`,
    `serverId=${input.serverId}`,
    `daemonPublicKeyB64=${input.daemonPublicKeyB64}`,
    `clientPublicKeyB64=${input.clientPublicKeyB64}`,
    `deviceId=${input.deviceId}`,
    `challenge=${input.challenge}`,
  ].join("\n");
}
