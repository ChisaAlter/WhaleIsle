import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";

import {
  RELAY_DEVICE_AUTH_VERSION,
  buildRelayDeviceAuthTranscript,
  computeRelayDeviceAuthProof,
  createRelayAuthChallenge,
  verifyRelayDeviceAuthProof,
} from "./relay-device-auth.js";
import { RelayDeviceCredentialStore } from "./relay-device-credential-store.js";

describe("relay device auth crypto", () => {
  test("builds stable transcript and verifies matching proofs", () => {
    const fields = {
      serverId: "srv_test",
      daemonPublicKeyB64: "daemon-pub",
      clientPublicKeyB64: "client-pub",
      deviceId: "dev_abc",
      challenge: "challenge-1",
    };
    const transcriptA = buildRelayDeviceAuthTranscript({
      version: RELAY_DEVICE_AUTH_VERSION,
      ...fields,
    });
    const transcriptB = buildRelayDeviceAuthTranscript({
      version: RELAY_DEVICE_AUTH_VERSION,
      ...fields,
    });
    expect(transcriptA).toBe(transcriptB);

    const secret = "device-secret-value";
    const proof = computeRelayDeviceAuthProof(secret, fields);
    const proof2 = computeRelayDeviceAuthProof(secret, fields);
    expect(verifyRelayDeviceAuthProof(proof, proof2)).toBe(true);
    expect(
      verifyRelayDeviceAuthProof(proof, computeRelayDeviceAuthProof("other-secret", fields)),
    ).toBe(false);
  });

  test("createRelayAuthChallenge returns high-entropy unique values", () => {
    const a = createRelayAuthChallenge();
    const b = createRelayAuthChallenge();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(20);
  });
});

describe("RelayDeviceCredentialStore", () => {
  const cleanup: string[] = [];

  afterEach(() => {
    for (const dir of cleanup.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("issues pairing token, consumes once, rejects replay", () => {
    const home = mkdtempSync(join(tmpdir(), "relay-dev-store-"));
    cleanup.push(home);
    const store = new RelayDeviceCredentialStore(home);
    const { token } = store.issuePairingToken(60_000);
    expect(store.consumePairingToken(token)).toBe(true);
    expect(store.consumePairingToken(token)).toBe(false);
  });

  test("desktop token mint and stale daemon device writes do not discard each other", () => {
    const home = mkdtempSync(join(tmpdir(), "relay-dev-store-"));
    cleanup.push(home);
    const daemon = new RelayDeviceCredentialStore(home);
    const desktop = new RelayDeviceCredentialStore(home);
    const first = desktop.issuePairingToken();
    const device = daemon.issueDevice("phone", "dev_independent");
    const second = desktop.issuePairingToken();
    const reopened = new RelayDeviceCredentialStore(home);
    expect(reopened.verifyDeviceSecret(device.deviceId, device.deviceSecret)).toBe(true);
    expect(reopened.isPairingTokenActive(first.token)).toBe(true);
    expect(daemon.consumePairingToken(first.token)).toBe(true);
    expect(desktop.consumePairingToken(first.token)).toBe(false);
    expect(reopened.consumePairingToken(second.token)).toBe(true);
  });

  test("rejects QR at the exact expiry boundary and reports consumed tokens inactive", () => {
    vi.useFakeTimers();
    try {
      const home = mkdtempSync(join(tmpdir(), "relay-dev-store-"));
      cleanup.push(home);
      const store = new RelayDeviceCredentialStore(home);
      const expiring = store.issuePairingToken(600_000);
      vi.advanceTimersByTime(600_000);
      expect(store.isPairingTokenActive(expiring.token)).toBe(false);
      expect(store.consumePairingToken(expiring.token)).toBe(false);
      const used = store.issuePairingToken();
      expect(store.consumePairingToken(used.token)).toBe(true);
      expect(store.isPairingTokenActive(used.token)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  test("issues device with preferred id and verifies secret/proof", () => {
    const home = mkdtempSync(join(tmpdir(), "relay-dev-store-"));
    cleanup.push(home);
    const store = new RelayDeviceCredentialStore(home);
    const { deviceId, deviceSecret } = store.issueDevice("phone", "dev_preferred_1");
    expect(deviceId).toBe("dev_preferred_1");
    expect(store.verifyDeviceSecret(deviceId, deviceSecret)).toBe(true);
    expect(store.verifyDeviceSecret(deviceId, "wrong")).toBe(false);

    const challenge = createRelayAuthChallenge();
    const proof = computeRelayDeviceAuthProof(deviceSecret, {
      serverId: "srv_1",
      daemonPublicKeyB64: "daemon-pub",
      clientPublicKeyB64: "client-pub",
      deviceId,
      challenge,
    });
    expect(
      store.verifyDeviceProof({
        deviceId,
        proof,
        challenge,
        serverId: "srv_1",
        daemonPublicKeyB64: "daemon-pub",
        clientPublicKeyB64: "client-pub",
      }),
    ).toBe(true);
    // challenge replay rejected
    expect(
      store.verifyDeviceProof({
        deviceId,
        proof,
        challenge,
        serverId: "srv_1",
        daemonPublicKeyB64: "daemon-pub",
        clientPublicKeyB64: "client-pub",
      }),
    ).toBe(false);

    expect(store.revokeDevice(deviceId)).toBe(true);
    expect(store.verifyDeviceSecret(deviceId, deviceSecret)).toBe(false);
  });

  test("rejects expired pairing token", () => {
    const home = mkdtempSync(join(tmpdir(), "relay-dev-store-"));
    cleanup.push(home);
    const store = new RelayDeviceCredentialStore(home);
    const { token } = store.issuePairingToken(-1);
    expect(store.consumePairingToken(token)).toBe(false);
  });

  test("stores the client-reported label and caps it at 120 chars", () => {
    const home = mkdtempSync(join(tmpdir(), "relay-dev-store-"));
    cleanup.push(home);
    const store = new RelayDeviceCredentialStore(home);
    store.issueDevice("iPhone · iOS 18.2", "dev_label_short");
    store.issueDevice(`${"x".repeat(200)}`, "dev_label_long");
    store.issueDevice("   ", "dev_label_blank");
    const labels = new Map(store.listDevices().map((device) => [device.deviceId, device.label]));
    expect(labels.get("dev_label_short")).toBe("iPhone · iOS 18.2");
    expect(labels.get("dev_label_long")).toBe("x".repeat(120));
    expect(labels.get("dev_label_blank")).toBeUndefined();
  });

  test("renames a bound device, rejects revoked or missing targets", () => {
    const home = mkdtempSync(join(tmpdir(), "relay-dev-store-"));
    cleanup.push(home);
    const store = new RelayDeviceCredentialStore(home);
    const { deviceId } = store.issueDevice("relay-pair", "dev_rename_me");
    expect(store.renameDevice(deviceId, "  Pixel 8  ")).toBe(true);
    expect(store.listDevices().find((device) => device.deviceId === deviceId)?.label).toBe(
      "Pixel 8",
    );
    // Idempotent and empty-label no-ops stay successful without changing the label.
    expect(store.renameDevice(deviceId, "Pixel 8")).toBe(true);
    expect(store.renameDevice(deviceId, "   ")).toBe(true);
    expect(store.listDevices().find((device) => device.deviceId === deviceId)?.label).toBe(
      "Pixel 8",
    );
    expect(store.renameDevice("dev_missing", "Pixel 8")).toBe(false);

    // Rename survives a store re-open: the desktop shell writes through its
    // own store instance beside the daemon (file-backed handoff).
    const reopened = new RelayDeviceCredentialStore(home);
    expect(reopened.renameDevice(deviceId, "Pixel 8a")).toBe(true);
    const reread = new RelayDeviceCredentialStore(home);
    expect(reread.listDevices().find((device) => device.deviceId === deviceId)?.label).toBe(
      "Pixel 8a",
    );

    reread.revokeDevice(deviceId);
    expect(reread.renameDevice(deviceId, "Pixel 9")).toBe(false);
  });
});
