import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import path from "node:path";
import type pino from "pino";
import { z } from "zod/v3";

import { ensurePrivateFile, writePrivateFileAtomicSync } from "./private-files.js";
import { computeRelayDeviceAuthProof, verifyRelayDeviceAuthProof } from "./relay-device-auth.js";

const DEVICE_STORE_FILENAME = "relay-devices.json";
const MAX_RECENT_CHALLENGES = 32;
const LOCK_STALE_MS = 10_000;
const LOCK_WAIT_MS = 2_000;
const LOCK_POLL_MS = 10;
const SLEEP_WAIT_BUFFER = new Int32Array(new SharedArrayBuffer(4));
export const RELAY_DEVICE_STORE_BUSY = "RELAY_DEVICE_STORE_BUSY";

function createStoreBusyError(filePath: string): Error & { code: string } {
  const error = new Error(`Relay device credential store busy: ${filePath}`) as Error & {
    code: string;
  };
  error.code = RELAY_DEVICE_STORE_BUSY;
  return error;
}

function isBusyError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === RELAY_DEVICE_STORE_BUSY,
  );
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function withWindowsRetry<T>(fn: () => T): T {
  const maxAttempts = process.platform === "win32" ? 15 : 1;
  for (let attempt = 1; ; attempt += 1) {
    try {
      return fn();
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      const transient = code === "EPERM" || code === "EACCES" || code === "EBUSY";
      if (!transient || attempt >= maxAttempts) {
        throw error;
      }
      Atomics.wait(SLEEP_WAIT_BUFFER, 0, 0, 10);
    }
  }
}

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
  private readonly logger?: pino.Logger;
  private data: DeviceStore;

  constructor(chisacodeHome: string, options: { logger?: pino.Logger } = {}) {
    this.filePath = path.join(chisacodeHome, DEVICE_STORE_FILENAME);
    this.pairingTokenDir = path.join(chisacodeHome, "relay-pairing-tokens");
    this.logger = options.logger;
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
    try {
      return this.mutate((data) => {
        const legacy = data.pairingTokens.find((entry) =>
          safeEqualHex(entry.tokenHash, tokenHash),
        );
        if (!legacy || legacy.consumedAt || legacy.expiresAtMs <= Date.now()) {
          return { result: false, changed: false };
        }
        legacy.consumedAt = new Date().toISOString();
        return { result: true, changed: true };
      });
    } catch (error) {
      if (isBusyError(error)) {
        return false;
      }
      throw error;
    }
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
    return this.mutate((data) => {
      const existing = data.devices.find((device) => device.deviceId === deviceId);
      if (existing && !existing.revokedAt) {
        throw new Error("deviceId already registered");
      }
      const deviceSecret = randomToken(32);
      const now = new Date().toISOString();
      // Replace revoked record with same id if present.
      data.devices = data.devices.filter((device) => device.deviceId !== deviceId);
      // Label cap matches DeviceRecordSchema; an overlong persisted label would
      // make the whole store file fail to parse (and drop every device) on load.
      const normalizedLabel = label?.trim().slice(0, 120);
      data.devices.push({
        deviceId,
        secret: deviceSecret,
        secretHash: sha256Hex(deviceSecret),
        createdAt: now,
        lastUsedAt: now,
        revokedAt: null,
        recentChallengeHashes: [],
        ...(normalizedLabel ? { label: normalizedLabel } : {}),
      });
      return { result: { deviceId, deviceSecret }, changed: true };
    });
  }

  /**
   * Rename a bound device's operator label.
   * @param deviceId Device id
   * @param label New operator label (trimmed, capped at 120 chars)
   * @returns true when the device exists un-revoked; an unchanged label is a no-op success
   */
  renameDevice(deviceId: string, label: string): boolean {
    const next = label.trim().slice(0, 120);
    return this.mutate((data) => {
      const device = data.devices.find((entry) => entry.deviceId === deviceId);
      if (!device || device.revokedAt) {
        return { result: false, changed: false };
      }
      if (next && device.label !== next) {
        device.label = next;
        return { result: true, changed: true };
      }
      return { result: true, changed: false };
    });
  }

  /**
   * Verify a device secret without logging it.
   * @param deviceId Device id
   * @param deviceSecret Raw secret
   */
  verifyDeviceSecret(deviceId: string, deviceSecret: string): boolean {
    try {
      return this.mutate((data) => {
        const device = data.devices.find((entry) => entry.deviceId === deviceId);
        if (!device || device.revokedAt) {
          return { result: false, changed: false };
        }
        const ok = safeEqualHex(device.secretHash, sha256Hex(deviceSecret));
        if (!ok) {
          return { result: false, changed: false };
        }
        device.lastUsedAt = new Date().toISOString();
        return { result: true, changed: true };
      });
    } catch (error) {
      if (isBusyError(error)) {
        return false;
      }
      throw error;
    }
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
    try {
      return this.mutate((data) => {
        const device = data.devices.find((entry) => entry.deviceId === input.deviceId);
        if (!device || device.revokedAt) {
          return { result: false, changed: false };
        }
        const challengeHash = sha256Hex(input.challenge);
        if (device.recentChallengeHashes.some((entry) => safeEqualHex(entry, challengeHash))) {
          return { result: false, changed: false };
        }
        const expected = computeRelayDeviceAuthProof(device.secret, {
          serverId: input.serverId,
          daemonPublicKeyB64: input.daemonPublicKeyB64,
          clientPublicKeyB64: input.clientPublicKeyB64,
          deviceId: input.deviceId,
          challenge: input.challenge,
        });
        if (!verifyRelayDeviceAuthProof(expected, input.proof)) {
          return { result: false, changed: false };
        }
        device.lastUsedAt = new Date().toISOString();
        device.recentChallengeHashes = [...device.recentChallengeHashes, challengeHash].slice(
          -MAX_RECENT_CHALLENGES,
        );
        return { result: true, changed: true };
      });
    } catch (error) {
      if (isBusyError(error)) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Revoke a device. Subsequent proofs fail.
   * @param deviceId Device id
   */
  revokeDevice(deviceId: string): boolean {
    return this.mutate((data) => {
      const device = data.devices.find((entry) => entry.deviceId === deviceId);
      if (!device) {
        return { result: false, changed: false };
      }
      if (!device.revokedAt) {
        device.revokedAt = new Date().toISOString();
        return { result: true, changed: true };
      }
      return { result: true, changed: false };
    });
  }

  private mutate<T>(fn: (data: DeviceStore) => { result: T; changed: boolean }): T {
    const release = this.acquireLock();
    try {
      this.data = this.load();
      const { result, changed } = fn(this.data);
      if (changed) {
        this.persist();
      }
      return result;
    } finally {
      release();
    }
  }

  private acquireLock(): () => void {
    const lockPath = `${this.filePath}.lock`;
    mkdirSync(path.dirname(lockPath), { recursive: true, mode: 0o700 });
    const deadline = Date.now() + LOCK_WAIT_MS;
    while (true) {
      try {
        const fd = openSync(lockPath, "wx", 0o600);
        try {
          writeSync(fd, JSON.stringify({ pid: process.pid, acquiredAt: Date.now() }));
        } finally {
          closeSync(fd);
        }
        return () => {
          withWindowsRetry(() => {
            try {
              unlinkSync(lockPath);
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
                throw error;
              }
            }
          });
        };
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        const retryableLockError =
          code === "EEXIST" || (process.platform === "win32" && (code === "EPERM" || code === "EACCES"));
        if (!retryableLockError) {
          throw error;
        }
        if (code === "EEXIST" && this.tryReclaimStaleLock(lockPath)) {
          continue;
        }
        if (Date.now() >= deadline) {
          this.emitWarning("relay_device_store_busy", { filePath: this.filePath, lockPath });
          throw createStoreBusyError(this.filePath);
        }
        Atomics.wait(SLEEP_WAIT_BUFFER, 0, 0, LOCK_POLL_MS);
      }
    }
  }

  private tryReclaimStaleLock(lockPath: string): boolean {
    try {
      const stat = statSync(lockPath);
      const staleByAge = Date.now() - stat.mtimeMs > LOCK_STALE_MS;
      let ownerDead = false;
      try {
        const parsed = JSON.parse(readFileSync(lockPath, "utf8")) as { pid?: unknown };
        if (typeof parsed.pid === "number" && Number.isInteger(parsed.pid) && parsed.pid > 0) {
          ownerDead = !isPidAlive(parsed.pid);
        }
      } catch {
        // Corrupt or partially written lock; reclaim only once stale by mtime.
      }
      if (!ownerDead && !staleByAge) {
        return false;
      }
      unlinkSync(lockPath);
      return true;
    } catch (error) {
      // Lock vanished between EEXIST and inspection: retry immediately.
      return (error as NodeJS.ErrnoException).code === "ENOENT";
    }
  }

  private load(): DeviceStore {
    let raw: string;
    try {
      raw = withWindowsRetry(() => {
        ensurePrivateFile(this.filePath);
        return readFileSync(this.filePath, "utf8");
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { v: 1, devices: [], pairingTokens: [] };
      }
      this.emitWarning("relay_device_store_read_failed", {
        err: error,
        filePath: this.filePath,
      });
      throw error;
    }

    try {
      const parsed = DeviceStoreSchema.parse(JSON.parse(raw));
      // Drop records missing secret (pre-strict store) so they must re-pair.
      parsed.devices = parsed.devices.filter(
        (device) => device.secret && device.secret.length >= 32,
      );
      return parsed;
    } catch (error) {
      this.quarantineCorrupt(error);
      return { v: 1, devices: [], pairingTokens: [] };
    }
  }

  /**
   * Preserve corrupt or schema-invalid device store bytes aside as evidence and
   * warn loudly so a subsequent persist() never silently wipes paired devices.
   */
  private quarantineCorrupt(error: unknown): void {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    let corruptPath = `${this.filePath}.corrupt-${stamp}`;
    let suffix = 1;
    while (existsSync(corruptPath)) {
      corruptPath = `${this.filePath}.corrupt-${stamp}-${suffix}`;
      suffix += 1;
    }
    try {
      renameSync(this.filePath, corruptPath);
      ensurePrivateFile(corruptPath);
    } catch (renameError) {
      if ((renameError as NodeJS.ErrnoException).code === "ENOENT") {
        this.emitWarning("relay_device_store_corrupt", {
          err: error,
          filePath: this.filePath,
        });
        return;
      }
      this.emitWarning("relay_device_store_corrupt_quarantine_failed", {
        err: error,
        quarantineErr: renameError,
        filePath: this.filePath,
      });
      throw renameError;
    }
    this.emitWarning("relay_device_store_corrupt_quarantined", {
      err: error,
      filePath: this.filePath,
      corruptPath,
    });
  }

  private emitWarning(message: string, fields: Record<string, unknown>): void {
    if (this.logger) {
      this.logger.warn(fields, message);
    } else {
      console.warn(message, fields);
    }
  }

  private persist(): void {
    const serialized = `${JSON.stringify(this.data, null, 2)}\n`;
    withWindowsRetry(() => {
      writePrivateFileAtomicSync(this.filePath, serialized);
    });
  }
}
