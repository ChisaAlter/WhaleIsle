import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, renameSync } from "node:fs";
import path from "node:path";
import type pino from "pino";
import { z } from "zod/v3";

import { ensurePrivateFile, writePrivateFileAtomicSync } from "./private-files.js";

// COMPAT(persistentPairingLink): offer v2 readers require a positive expiry, including
// Android Long readers. This exact JS-safe date denotes a revocable persistent link,
// not a short-lived token whose lifetime has been extended. Added 2026-10-25.
export const PAIRING_LINK_COMPAT_EXPIRES_AT_MS = 253402300799999;

const PairingLinkSchema = z.object({
  v: z.literal(1),
  token: z.string().min(32),
  tokenHash: z.string().min(64),
  createdAt: z.string().min(1),
  revokedAt: z.string().min(1).nullable(),
});

type PairingLink = z.infer<typeof PairingLinkSchema>;

function tokenHash(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * One reusable enrollment link, independent of short pairing tokens and device secrets.
 * Only the desktop issues/revokes it; authorization re-reads the private file so a
 * revoked link cannot be restored by a stale device-store writer in the daemon.
 */
export class RelayPairingLinkStore {
  private readonly filePath: string;
  private readonly logger?: pino.Logger;

  constructor(chisacodeHome: string, options: { logger?: pino.Logger } = {}) {
    this.filePath = path.join(chisacodeHome, "relay-pairing-link.json");
    this.logger = options.logger;
  }

  /** Return the active link credential, creating one only when absent or revoked. */
  getOrCreate(): { token: string; expiresAtMs: number } {
    let link = this.load();
    if (!link || link.revokedAt) {
      const token = `link_${randomBytes(32).toString("base64url")}`;
      link = {
        v: 1,
        token,
        tokenHash: tokenHash(token),
        createdAt: new Date().toISOString(),
        revokedAt: null,
      };
      this.persist(link);
    }
    return { token: link.token, expiresAtMs: PAIRING_LINK_COMPAT_EXPIRES_AT_MS };
  }

  /**
   * Authorize enrollment without consuming the link. Each successful enrollment
   * still receives its own device id and secret through the normal auth gate.
   * @param token Credential from the encrypted pairing hello
   * @returns Whether it matches the active, unrevoked link
   */
  accepts(token: string): boolean {
    const link = this.load();
    if (!link || link.revokedAt) return false;
    const expected = Buffer.from(link.tokenHash, "hex");
    const actual = Buffer.from(tokenHash(token), "hex");
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }

  /** Revoke new enrollments through this link without touching paired devices. */
  revoke(): void {
    const link = this.load();
    if (!link || link.revokedAt) return;
    this.persist({ ...link, revokedAt: new Date().toISOString() });
  }

  private load(): PairingLink | null {
    if (!existsSync(this.filePath)) return null;
    try {
      ensurePrivateFile(this.filePath);
      return PairingLinkSchema.parse(JSON.parse(readFileSync(this.filePath, "utf8")));
    } catch (error) {
      this.quarantineCorrupt(error);
      return null;
    }
  }

  /**
   * A truncated or schema-invalid link file must not wedge getOrCreate,
   * accepts and revoke (all read first): warn, keep the bytes as evidence,
   * and continue as if the link did not exist so getOrCreate can rebuild.
   */
  private quarantineCorrupt(error: unknown): void {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const corruptPath = `${this.filePath}.corrupt-${stamp}`;
    let quarantined = false;
    try {
      renameSync(this.filePath, corruptPath);
      quarantined = true;
    } catch {
      // Quarantine is best effort; the next persist still replaces the file.
    }
    const fields = quarantined
      ? { err: error, filePath: this.filePath, corruptPath }
      : { err: error, filePath: this.filePath };
    const message = quarantined
      ? "relay_pairing_link_corrupt_quarantined"
      : "relay_pairing_link_corrupt";
    if (this.logger) {
      this.logger.warn(fields, message);
    } else {
      console.warn(message, fields);
    }
  }

  private persist(link: PairingLink): void {
    writePrivateFileAtomicSync(this.filePath, `${JSON.stringify(link, null, 2)}\n`);
  }
}
