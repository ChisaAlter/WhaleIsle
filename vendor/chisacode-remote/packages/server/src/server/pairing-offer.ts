import type { Logger } from "pino";

import { createConnectionOfferV2, encodeOfferToFragmentUrl } from "./connection-offer.js";
import { loadOrCreateDaemonKeyPair } from "./daemon-keypair.js";
import { renderPairingQr } from "./pairing-qr.js";
import { RelayDeviceCredentialStore } from "./relay-device-credential-store.js";
import { RelayPairingLinkStore } from "./relay-pairing-link-store.js";
import { getOrCreateServerId } from "./server-id.js";

export interface LocalPairingOffer {
  relayEnabled: boolean;
  url: string | null;
  qr: string | null;
  /** One-time QR expiry; the raw token stays only in the private offer URL. */
  expiresAtMs?: number;
  /** Reusable offer, independently revocable from all enrolled devices. */
  linkUrl?: string;
}

export async function generateLocalPairingOffer(args: {
  chisacodeHome: string;
  relayEnabled?: boolean;
  relayEndpoint?: string;
  relayPublicEndpoint?: string;
  relayUseTls?: boolean;
  relayPublicUseTls?: boolean;
  appBaseUrl?: string;
  includeQr?: boolean;
  /** Desktop copy-link action uses a separately revocable enrollment credential. */
  includePersistentLink?: boolean;
  /** Cancel before writing credentials when the owning desktop startup was replaced. */
  assertCurrent?: () => void;
  logger?: Logger;
}): Promise<LocalPairingOffer> {
  const relayEnabled = args.relayEnabled ?? true;
  if (!relayEnabled) {
    return {
      relayEnabled: false,
      url: null,
      qr: null,
    };
  }

  const relayEndpoint = args.relayEndpoint ?? "relay.chisacode.sh:443";
  const relayPublicEndpoint = args.relayPublicEndpoint ?? relayEndpoint;
  const relayUseTls = args.relayUseTls ?? relayEndpoint === "relay.chisacode.sh:443";
  const relayPublicUseTls = args.relayPublicUseTls ?? relayUseTls;
  const appBaseUrl = args.appBaseUrl ?? "https://app.chisacode.sh";
  const serverId = getOrCreateServerId(args.chisacodeHome, { logger: args.logger });
  const daemonKeyPair = await loadOrCreateDaemonKeyPair(args.chisacodeHome, args.logger);
  args.assertCurrent?.();
  // Issue a short-lived one-time pairing bootstrap token for handshake v2.
  // Old clients ignore authBootstrap; new clients use it for first device bind.
  const deviceStore = new RelayDeviceCredentialStore(args.chisacodeHome);
  const pairing = deviceStore.issuePairingToken(10 * 60_000);
  const offer = await createConnectionOfferV2({
    serverId,
    daemonPublicKeyB64: daemonKeyPair.publicKeyB64,
    relayAuthPublicKeyB64: daemonKeyPair.relayAuthPublicKeyB64,
    authBootstrap: {
      version: 1,
      pairingToken: pairing.token,
      expiresAtMs: pairing.expiresAtMs,
    },
    relay: { endpoint: relayPublicEndpoint, useTls: relayPublicUseTls },
  });
  const url = encodeOfferToFragmentUrl({ offer, appBaseUrl });
  let linkUrl: string | undefined;
  if (args.includePersistentLink) {
    args.assertCurrent?.();
    const link = new RelayPairingLinkStore(args.chisacodeHome).getOrCreate();
    const linkOffer = await createConnectionOfferV2({
      serverId,
      daemonPublicKeyB64: daemonKeyPair.publicKeyB64,
      relayAuthPublicKeyB64: daemonKeyPair.relayAuthPublicKeyB64,
      authBootstrap: {
        version: 1,
        kind: "persistent",
        pairingToken: link.token,
        expiresAtMs: link.expiresAtMs,
      },
      relay: { endpoint: relayPublicEndpoint, useTls: relayPublicUseTls },
    });
    linkUrl = encodeOfferToFragmentUrl({ offer: linkOffer, appBaseUrl });
  }
  const metadata = { expiresAtMs: pairing.expiresAtMs, ...(linkUrl ? { linkUrl } : {}) };

  if (args.includeQr === false) {
    return {
      relayEnabled: true,
      url,
      qr: null,
      ...metadata,
    };
  }

  let qr: string | null = null;
  try {
    qr = await renderPairingQr(url);
  } catch (error) {
    args.logger?.debug({ error }, "Failed to render pairing QR");
  }

  return {
    relayEnabled: true,
    url,
    qr,
    ...metadata,
  };
}
