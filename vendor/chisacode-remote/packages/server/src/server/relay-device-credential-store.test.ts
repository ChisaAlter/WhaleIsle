import { mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type pino from "pino";
import { afterEach, describe, expect, test } from "vitest";

import { computeRelayDeviceAuthProof } from "./relay-device-auth.js";
import { RelayDeviceCredentialStore } from "./relay-device-credential-store.js";

function createTestLogger() {
  const warnings: Array<{ fields: unknown; message: string }> = [];
  const logger = {
    warnings,
    warn(fields: unknown, message: string) {
      warnings.push({ fields, message });
    },
  };
  return logger;
}

function makeProofInput(deviceId: string, deviceSecret: string, challenge: string) {
  const base = {
    serverId: "srv_test_1",
    daemonPublicKeyB64: "daemon_pub_b64",
    clientPublicKeyB64: "client_pub_b64",
    deviceId,
    challenge,
  };
  return {
    ...base,
    proof: computeRelayDeviceAuthProof(deviceSecret, base),
  };
}

describe("RelayDeviceCredentialStore locking & revocation serialization", () => {
  const cleanup: string[] = [];

  afterEach(() => {
    for (const dir of cleanup.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a) stale pre-opened store instance cannot clobber concurrent revokeDevice", () => {
    const home = mkdtempSync(join(tmpdir(), "relay-store-lock-a-"));
    cleanup.push(home);

    const setup = new RelayDeviceCredentialStore(home);
    const issued = setup.issueDevice("Pixel", "dev_interleave_a");

    // Stale instance opened before revocation, mimicking cached/hello-time snapshot.
    const staleDaemon = new RelayDeviceCredentialStore(home);
    const desktop = new RelayDeviceCredentialStore(home);

    expect(desktop.revokeDevice(issued.deviceId)).toBe(true);
    expect(
      staleDaemon.verifyDeviceProof(makeProofInput(issued.deviceId, issued.deviceSecret, "ch-1")),
    ).toBe(false);

    const reloaded = new RelayDeviceCredentialStore(home);
    expect(reloaded.getDevice(issued.deviceId)?.revokedAt).toBeTruthy();
  });

  test("b) interleaved renameDevice and revokeDevice preserve both mutations", () => {
    const home = mkdtempSync(join(tmpdir(), "relay-store-lock-b-"));
    cleanup.push(home);

    const setup = new RelayDeviceCredentialStore(home);
    const a = setup.issueDevice("Phone A", "dev_interleave_rename_a");
    const b = setup.issueDevice("Phone B", "dev_interleave_revoke_b");

    const writerA = new RelayDeviceCredentialStore(home);
    const writerB = new RelayDeviceCredentialStore(home);

    expect(writerA.renameDevice(a.deviceId, "Work Pixel")).toBe(true);
    expect(writerB.revokeDevice(b.deviceId)).toBe(true);

    const reopened = new RelayDeviceCredentialStore(home);
    expect(reopened.getDevice(a.deviceId)?.label).toBe("Work Pixel");
    expect(reopened.getDevice(a.deviceId)?.revokedAt).toBeNull();
    expect(reopened.getDevice(b.deviceId)?.revokedAt).toBeTruthy();
  });

  test("c) reclaims stale lock left by a non-existent PID and completes write", () => {
    const home = mkdtempSync(join(tmpdir(), "relay-store-lock-c-"));
    cleanup.push(home);

    const setup = new RelayDeviceCredentialStore(home);
    const issued = setup.issueDevice("Tablet", "dev_stale_lock_1");
    const lockPath = join(home, "relay-devices.json.lock");
    writeFileSync(lockPath, JSON.stringify({ pid: 999_999_999, acquiredAt: Date.now() }), "utf8");

    expect(setup.revokeDevice(issued.deviceId)).toBe(true);
    expect(() => readFileSync(lockPath)).toThrow();
    expect(new RelayDeviceCredentialStore(home).getDevice(issued.deviceId)?.revokedAt).toBeTruthy();
  });

  test("d) live fresh lock holder fails closed on verifyDeviceProof after lock wait without overwriting", { timeout: 10_000 }, () => {
    const home = mkdtempSync(join(tmpdir(), "relay-store-lock-d-"));
    cleanup.push(home);

    const logger = createTestLogger();
    const store = new RelayDeviceCredentialStore(home, {
      logger: logger as unknown as pino.Logger,
    });
    const issued = store.issueDevice("Live Holder", "dev_busy_lock_1");
    const storePath = join(home, "relay-devices.json");
    const beforeRaw = readFileSync(storePath, "utf8");

    const lockPath = join(home, "relay-devices.json.lock");
    writeFileSync(lockPath, JSON.stringify({ pid: process.pid, acquiredAt: Date.now() }), "utf8");
    const now = new Date();
    utimesSync(lockPath, now, now);

    const ok = store.verifyDeviceProof(makeProofInput(issued.deviceId, issued.deviceSecret, "ch-busy"));
    expect(ok).toBe(false);
    expect(logger.warnings.some((entry) => entry.message === "relay_device_store_busy")).toBe(true);
    expect(readFileSync(storePath, "utf8")).toBe(beforeRaw);
  });
});
