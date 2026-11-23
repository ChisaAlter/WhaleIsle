import { z } from "zod/v3";

import { RelayAuthBootstrapSchema } from "./relay-device-auth.js";

/**
 * Default public STUN servers used when neither the pairing offer nor user
 * settings configure custom ICE servers.
 */
export const DEFAULT_PUBLIC_STUN_URLS = [
  "stun:stun.cloudflare.com:3478",
  "stun:stun.l.google.com:19302",
] as const;

export const IceServerConfigSchema = z.object({
  urls: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
  username: z.string().optional(),
  credential: z.string().optional(),
});

export type IceServerConfig = z.infer<typeof IceServerConfigSchema>;

export const ConnectionOfferLanSchema = z.object({
  endpoints: z.array(z.string().min(1)).min(1),
  useTls: z.boolean().optional(),
});

export type ConnectionOfferLan = z.infer<typeof ConnectionOfferLanSchema>;

export const ConnectionOfferRelaySchema = z.object({
  endpoint: z.string().min(1),
  useTls: z.boolean().optional(),
});

export type ConnectionOfferRelay = z.infer<typeof ConnectionOfferRelaySchema>;

/**
 * Returns default public STUN server entries when no custom ICE servers are configured.
 */
export function getDefaultIceServers(): IceServerConfig[] {
  return DEFAULT_PUBLIC_STUN_URLS.map((urls) => ({ urls }));
}

/**
 * Resolves effective ICE servers from optional offer + user overrides,
 * falling back to `getDefaultIceServers()` when both are empty.
 */
export function resolveOfferIceServers(
  offerIceServers?: readonly IceServerConfig[] | null,
  extraIceServers?: readonly IceServerConfig[] | null,
): IceServerConfig[] {
  const combined: IceServerConfig[] = [];
  if (Array.isArray(extraIceServers)) {
    for (const server of extraIceServers) {
      combined.push(server);
    }
  }
  if (Array.isArray(offerIceServers)) {
    for (const server of offerIceServers) {
      combined.push(server);
    }
  }
  return combined.length > 0 ? combined : getDefaultIceServers();
}

/**
 * Pairing offer v2 (supports relay, pure LAN without external servers, or both).
 *
 * `serverId` is a stable daemon identifier scoped to `CHISACODE_HOME`, and is also
 * used as the relay session identifier.
 */
export const ConnectionOfferV2Schema = z
  .object({
    v: z.literal(2),
    serverId: z.string().min(1),
    daemonPublicKeyB64: z.string().min(1),
    relayAuthPublicKeyB64: z.string().min(1).optional(),
    /**
     * Optional client-auth bootstrap for handshake v2. Old parsers ignore this
     * field (optional missing keys remain valid; unknown keys are stripped).
     */
    authBootstrap: RelayAuthBootstrapSchema.optional(),
    relay: ConnectionOfferRelaySchema.optional(),
    lan: ConnectionOfferLanSchema.optional(),
    iceServers: z.array(IceServerConfigSchema).optional(),
  })
  .refine(
    (offer) => Boolean(offer.relay?.endpoint) || (offer.lan?.endpoints?.length ?? 0) > 0,
    {
      message: "Connection offer must provide either relay.endpoint or at least one lan.endpoints entry",
    },
  );

export type ConnectionOfferV2 = z.infer<typeof ConnectionOfferV2Schema>;

export const ConnectionOfferSchema = ConnectionOfferV2Schema;
export type ConnectionOffer = ConnectionOfferV2;

function decodeBase64UrlToUtf8(input: string): string {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  const binary = globalThis.atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

export function decodeOfferFragmentPayload(encoded: string): unknown {
  const json = decodeBase64UrlToUtf8(encoded);
  return JSON.parse(json) as unknown;
}

const OFFER_FRAGMENT_PREFIX = "#offer=";

function extractOfferFragmentEncoded(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const fragmentIndex = trimmed.indexOf(OFFER_FRAGMENT_PREFIX);
  if (fragmentIndex === -1) return null;
  const encoded = trimmed.slice(fragmentIndex + OFFER_FRAGMENT_PREFIX.length).trim();
  return encoded.length > 0 ? encoded : null;
}

/**
 * Parse a pairing-offer URL of the form `https://app.chisacode.sh/#offer=<base64url>`.
 *
 * Returns `null` if the input has no `#offer=` fragment. Throws if the fragment
 * exists but the payload is malformed or fails schema validation.
 */
export function parseConnectionOfferFromUrl(input: string): ConnectionOffer | null {
  const encoded = extractOfferFragmentEncoded(input);
  if (!encoded) return null;
  const payload = decodeOfferFragmentPayload(encoded);
  return ConnectionOfferSchema.parse(payload);
}
