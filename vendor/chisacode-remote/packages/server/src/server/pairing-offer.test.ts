import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { parseConnectionOfferFromUrl } from "@chisacode/protocol/connection-offer";
import { z } from "zod/v3";

import { generateLocalPairingOffer } from "./pairing-offer.js";
import { RelayDeviceCredentialStore } from "./relay-device-credential-store.js";
import {
  PAIRING_LINK_COMPAT_EXPIRES_AT_MS,
  RelayPairingLinkStore,
} from "./relay-pairing-link-store.js";

const homes: string[] = [];
afterEach(() => {
  vi.useRealTimers();
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

function newHome(): string {
  const home = mkdtempSync(join(tmpdir(), "persistent-pairing-"));
  homes.push(home);
  return home;
}

function offer(url?: string | null) {
  if (!url) throw new Error("missing offer URL");
  const parsed = parseConnectionOfferFromUrl(url);
  if (!parsed?.authBootstrap) throw new Error("missing bootstrap");
  return parsed.authBootstrap;
}

describe("desktop QR and persistent enrollment offers", () => {
  test("keeps v2 persistent links stable across QR refreshes and store reopens", async () => {
    const home = newHome();
    const args = { chisacodeHome: home, includeQr: false, includePersistentLink: true };
    const first = await generateLocalPairingOffer(args);
    const second = await generateLocalPairingOffer(args);
    expect(second.url).not.toBe(first.url);
    expect(second.linkUrl).toBe(first.linkUrl);
    expect(first.expiresAtMs).toBe(offer(first.url).expiresAtMs);
    const persistent = offer(first.linkUrl);
    expect(persistent.kind).toBe("persistent");
    expect(persistent.expiresAtMs).toBe(PAIRING_LINK_COMPAT_EXPIRES_AT_MS);
    expect(Number.isSafeInteger(persistent.expiresAtMs)).toBe(true);
    expect(new Date(persistent.expiresAtMs).toISOString()).toBe("9999-12-31T23:59:59.999Z");
    // Shipped pre-extension JS parsers accept the same version/token/positive expiry.
    const oldBootstrap = z.object({
      version: z.literal(1),
      pairingToken: z.string().min(16).max(256),
      expiresAtMs: z.number().int().positive(),
    });
    expect(oldBootstrap.parse(persistent).pairingToken).toBe(persistent.pairingToken);
    expect(new RelayPairingLinkStore(home).getOrCreate().token).toBe(persistent.pairingToken);
  });

  test("expires one-time QR while a reusable link survives time, device writes, and explicit revocation", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const home = newHome();
    const pair = await generateLocalPairingOffer({
      chisacodeHome: home,
      includeQr: false,
      includePersistentLink: true,
    });
    const qr = offer(pair.url);
    const link = offer(pair.linkUrl);
    const staleDaemonStore = new RelayDeviceCredentialStore(home);
    vi.setSystemTime(Date.now() + 365 * 24 * 60 * 60_000);
    expect(staleDaemonStore.consumePairingToken(qr.pairingToken)).toBe(false);
    expect(new RelayPairingLinkStore(home).accepts(link.pairingToken)).toBe(true);
    expect(new RelayPairingLinkStore(home).accepts(link.pairingToken)).toBe(true);
    const device = staleDaemonStore.issueDevice("already paired", "dev_existing_phone");
    new RelayPairingLinkStore(home).revoke();
    staleDaemonStore.verifyDeviceSecret(device.deviceId, device.deviceSecret);
    expect(new RelayPairingLinkStore(home).accepts(link.pairingToken)).toBe(false);
    expect(
      new RelayDeviceCredentialStore(home).verifyDeviceSecret(device.deviceId, device.deviceSecret),
    ).toBe(true);
    const replacement = await generateLocalPairingOffer({
      chisacodeHome: home,
      includeQr: false,
      includePersistentLink: true,
    });
    expect(replacement.linkUrl).not.toBe(pair.linkUrl);
    expect(new RelayPairingLinkStore(home).accepts(offer(replacement.linkUrl).pairingToken)).toBe(
      true,
    );
    expect(new RelayPairingLinkStore(home).accepts(link.pairingToken)).toBe(false);
  });

  test("cancellation after identity preparation writes no enrollment credentials", async () => {
    const home = newHome();
    await expect(
      generateLocalPairingOffer({
        chisacodeHome: home,
        includeQr: false,
        includePersistentLink: true,
        assertCurrent: () => {
          throw new Error("cancelled");
        },
      }),
    ).rejects.toThrow("cancelled");
    const link = new RelayPairingLinkStore(home);
    expect(link.accepts("link_invalid")).toBe(false);
  });
});
