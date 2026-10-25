import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import { z } from "zod/v3";

import { ensurePrivateFile, writePrivateFileAtomicSync } from "./private-files.js";
import { computeRelayDeviceAuthProof, verifyRelayDeviceAuthProof } from "./relay-device-auth.js";

const DEVICE_STORE_FILENAME = "relay-devices.json";
const MAX_RECENT_CHALLENGES = 32;

const DeviceRecordSchema = z.object({
  deviceId: z.string().min(8),
  /**
   * Raw device secret kept only in this private local file (mode 0600).
   * Required for HMAC proof verification on reconnect.
   */
  secret: z.string().min(32),
  secretHash: z.string().min(32),
  createdAt: z.string().min(1),
  lastUsedAt: z.string().min(1).nullable(),
  revokedAt: z.string().min(1).nullable(),
  label: z.string().max(120).optional(),
  recentChallengeHashes: z.array(z.string().min(16)).default([]),
});

const PairingTokenRecordSchema = z.object({
  tokenHash: z.string().min(32),
  expiresAtMs: z.number().int().positive(),
  consumedAt: z.string().min(1).nullable(),
  createdAt: z.string().min(1),
});

const DeviceStoreSchema = z.object({
  v: z.literal(1),
  devices: z.array(DeviceRecordSchema),
  pairingTokens: z.array(PairingTokenRecordSchema),
});

export type RelayDeviceRecord = z.infer<typeof DeviceRecordSchema>;
type DeviceStore = z.infer<typeof DeviceStoreSchema>;

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

function safeEqualHex(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}

/**
 * File-backed registry of relay-paired devices and one-time pairing tokens.
 * Device secrets remain local-private (0600 file) for HMAC verification.
 */
export class RelayDeviceCredentialStore {
  private readonly filePath: string;
  private readonly pairingTokenDir: string;
  private data: DeviceStore;

  constructor(chisacodeHome: string) {
    this.filePath = path.join(chisacodeHome, DEVICE_STORE_FILENAME);
    this.pairingTokenDir = path.join(chisacodeHome, "relay-pairing-tokens");
    this.data = this.load();
  }

  listDevices(): Array<Omit<RelayDeviceRecord, "secret">> {
    return this.data.devices.map(({ secret: _secret, ...device }) => ({ ...device }));
  }

  getDevice(deviceId: string): RelayDeviceRecord | null {
    return this.data.devices.find((device) => device.deviceId === deviceId) ?? null;
  }

  /**
   * Issue a short-lived one-time pairing token for inclusion in a connection offer.
   * @param ttlMs Token lifetime in milliseconds
   * @returns Raw token (caller embeds in offer; never log)
   */
  issuePairingToken(ttlMs = 10 * 60_000): { token: string; expiresAtMs: number } {
    const token = randomToken(32);
    const expiresAtMs = Date.now() + ttlMs;
    const record = {
      tokenHash: sha256Hex(token),
      expiresAtMs,
      consumedAt: null,
      createdAt: new Date().toISOString(),
    };
    // The desktop mints beside the daemon, which writes devices. Separate files
    // prevent either process from restoring a stale copy of the other's data.
    mkdirSync(this.pairingTokenDir, { recursive: true, mode: 0o700 });
    for (const name of readdirSync(this.pairingTokenDir)) {
      if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
      const file = path.join(this.pairingTokenDir, name);
      try {
        const previous = PairingTokenRecordSchema.parse(JSON.parse(readFileSync(file, "utf8")));
        if (previous.expiresAtMs <= Date.now()) unlinkSync(file);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    writePrivateFileAtomicSync(this.pairingTokenPath(token), `${JSON.stringify(record)}\n`);
    return { token, expiresAtMs };
  }

  /**
   * Consume a pairing token if valid and unexpired.
   * @param token Raw pairing token
   */
  consumePairingToken(token: string): boolean {
    const tokenHash = sha256Hex(token);
    const record = this.readPairingToken(token);
    if (!record || record.consumedAt || record.expiresAtMs <= Date.now()) return false;
    const file = this.pairingTokenPath(token);
    if (existsSync(file)) {
      // unlink is the claim: two processes may read, but only one can consume.
      try {
        unlinkSync(file);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
        throw error;
      }
      return true;
    }
    // COMPAT(pairingTokenFiles): accept pre-2026-10-25 offers in relay-devices.json.
    // Remove after the supported desktop floor includes per-token files.
    this.data = this.load();
    const legacy = this.data.pairingTokens.find((entry) =>
      safeEqualHex(entry.tokenHash, tokenHash),
    );
    if (!legacy || legacy.consumedAt || legacy.expiresAtMs <= Date.now()) return false;
    legacy.consumedAt = new Date().toISOString();
    this.persist();
    return true;
  }

  /** Whether the displayed QR remains unexpired and has not been used. */
  isPairingTokenActive(token: string): boolean {
    const record = this.readPairingToken(token);
    return Boolean(record && !record.consumedAt && record.expiresAtMs > Date.now());
  }

  private pairingTokenPath(token: string): string {
    return path.join(this.pairingTokenDir, `${sha256Hex(token)}.json`);
  }

  private readPairingToken(token: string): z.infer<typeof PairingTokenRecordSchema> | null {
    try {
      return PairingTokenRecordSchema.parse(
        JSON.parse(readFileSync(this.pairingTokenPath(token), "utf8")),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const tokenHash = sha256Hex(token);
    return (
      this.load().pairingTokens.find((entry) => safeEqualHex(entry.tokenHash, tokenHash)) ?? null
    );
  }

  /**
   * Register a new device, optionally with a client-chosen device id.
   * @param label Optional operator label
   * @param preferredDeviceId Optional client-provided device id
   * @returns deviceId + raw deviceSecret (return once; never log)
   */
  issueDevice(
    label?: string,
    preferredDeviceId?: string,
  ): { deviceId: string; deviceSecret: string } {
    const deviceId = preferredDeviceId?.trim() || `dev_${randomToken(12)}`;
    if (deviceId.length < 8) {
      throw new Error("deviceId must be at least 8 characters");
    }
    if (this.getDevice(deviceId) && !this.getDevice(deviceId)?.revokedAt) {
      throw new Error("deviceId already registered");
    }
    const deviceSecret = randomToken(32);
    const now = new Date().toISOString();
    // Replace revoked record with same id if present.
    this.data.devices = this.data.devices.filter((device) => device.deviceId !== deviceId);
    // Label cap matches DeviceRecordSchema; an overlong persisted label would
    // make the whole store file fail to parse (and drop every device) on load.
    const normalizedLabel = label?.trim().slice(0, 120);
    this.data.devices.push({
      deviceId,
      secret: deviceSecret,
      secretHash: sha256Hex(deviceSecret),
      createdAt: now,
      lastUsedAt: now,
      revokedAt: null,
      recentChallengeHashes: [],
      ...(normalizedLabel ? { label: normalizedLabel } : {}),
    });
    this.persist();
    return { deviceId, deviceSecret };
  }

  /**
   * Rename a bound device's operator label.
   * @param deviceId Device id
   * @param label New operator label (trimmed, capped at 120 chars)
   * @returns true when the device exists un-revoked; an unchanged label is a no-op success
   */
  renameDevice(deviceId: string, label: string): boolean {
    const device = this.getDevice(deviceId);
    if (!device || device.revokedAt) {
      return false;
    }
    const next = label.trim().slice(0, 120);
    if (next && device.label !== next) {
      device.label = next;
      this.persist();
    }
    return true;
  }

  /**
   * Verify a device secret without logging it.
   * @param deviceId Device id
   * @param deviceSecret Raw secret
   */
  verifyDeviceSecret(deviceId: string, deviceSecret: string): boolean {
    const device = this.getDevice(deviceId);
    if (!device || device.revokedAt) {
      return false;
    }
    const ok = safeEqualHex(device.secretHash, sha256Hex(deviceSecret));
    if (ok) {
      device.lastUsedAt = new Date().toISOString();
      this.persist();
    }
    return ok;
  }

  /**
   * Strict HMAC proof verification with challenge replay protection.
   * @param input Proof material from hello
   */
  verifyDeviceProof(input: {
    deviceId: string;
    proof: string;
    challenge: string;
    serverId: string;
    daemonPublicKeyB64: string;
    clientPublicKeyB64: string;
  }): boolean {
    const device = this.getDevice(input.deviceId);
    if (!device || device.revokedAt) {
      return false;
    }
    const challengeHash = sha256Hex(input.challenge);
    if (device.recentChallengeHashes.some((entry) => safeEqualHex(entry, challengeHash))) {
      return false;
    }
    const expected = computeRelayDeviceAuthProof(device.secret, {
      serverId: input.serverId,
      daemonPublicKeyB64: input.daemonPublicKeyB64,
      clientPublicKeyB64: input.clientPublicKeyB64,
      deviceId: input.deviceId,
      challenge: input.challenge,
    });
    if (!verifyRelayDeviceAuthProof(expected, input.proof)) {
      return false;
    }
    device.lastUsedAt = new Date().toISOString();
    device.recentChallengeHashes = [...device.recentChallengeHashes, challengeHash].slice(
      -MAX_RECENT_CHALLENGES,
    );
    this.persist();
    return true;
  }

  /**
   * Revoke a device. Subsequent proofs fail.
   * @param deviceId Device id
   */
  revokeDevice(deviceId: string): boolean {
    const device = this.getDevice(deviceId);
    if (!device) {
      return false;
    }
    if (!device.revokedAt) {
      device.revokedAt = new Date().toISOString();
      this.persist();
    }
    return true;
  }

  private load(): DeviceStore {
    if (!existsSync(this.filePath)) {
      return { v: 1, devices: [], pairingTokens: [] };
    }
    try {
      ensurePrivateFile(this.filePath);
      const raw = readFileSync(this.filePath, "utf8");
      const parsed = DeviceStoreSchema.parse(JSON.parse(raw));
      // Drop records missing secret (pre-strict store) so they must re-pair.
      parsed.devices = parsed.devices.filter(
        (device) => device.secret && device.secret.length >= 32,
      );
      return parsed;
    } catch {
      return { v: 1, devices: [], pairingTokens: [] };
    }
  }

  private persist(): void {
    writePrivateFileAtomicSync(this.filePath, `${JSON.stringify(this.data, null, 2)}\n`);
  }
}
