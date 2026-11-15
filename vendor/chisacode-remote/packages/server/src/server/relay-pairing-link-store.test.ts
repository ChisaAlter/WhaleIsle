import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type pino from "pino";
import { afterEach, describe, expect, test, vi } from "vitest";

import { RelayPairingLinkStore } from "./relay-pairing-link-store.js";

const LINK_FILE = "relay-pairing-link.json";

const homes: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

function newHome(): string {
  const home = mkdtempSync(join(tmpdir(), "pairing-link-store-"));
  homes.push(home);
  return home;
}

function quarantined(home: string): string[] {
  return readdirSync(home).filter((name) => name.startsWith(`${LINK_FILE}.corrupt-`));
}

describe("RelayPairingLinkStore corrupt file recovery", () => {
  test.each([`{"v":1,"token":`, `{"v":2,"token":"x","tokenHash":"y"}`])(
    "quarantines an unreadable or schema-invalid file and rebuilds: %s",
    (contents) => {
      const home = newHome();
      const filePath = join(home, LINK_FILE);
      writeFileSync(filePath, contents);
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      const store = new RelayPairingLinkStore(home);
      const created = store.getOrCreate();
      expect(created.token.length).toBeGreaterThanOrEqual(32);

      // Corrupt bytes are preserved as evidence, not silently deleted.
      const quarantinedFiles = quarantined(home);
      expect(quarantinedFiles).toHaveLength(1);
      expect(readFileSync(join(home, quarantinedFiles[0]!), "utf8")).toBe(contents);
      expect(warn).toHaveBeenCalled();

      // Every read path works against the rebuilt link.
      expect(store.accepts(created.token)).toBe(true);
      store.revoke();
      expect(store.accepts(created.token)).toBe(false);
    },
  );

  test("accepts and revoke treat a corrupt file as absent instead of throwing", () => {
    const home = newHome();
    writeFileSync(join(home, LINK_FILE), "not json");
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const store = new RelayPairingLinkStore(home);
    expect(store.accepts("link_anything")).toBe(false);
    expect(() => store.revoke()).not.toThrow();
    expect(quarantined(home).length).toBeGreaterThanOrEqual(1);
  });

  test("routes the corruption warning to the injected daemon logger", () => {
    const home = newHome();
    writeFileSync(join(home, LINK_FILE), "not json");
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const warnings: Array<{ fields: unknown; message: string }> = [];
    const logger = {
      warn(fields: unknown, message: string) {
        warnings.push({ fields, message });
      },
    } as unknown as pino.Logger;

    new RelayPairingLinkStore(home, { logger }).getOrCreate();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.message).toBe("relay_pairing_link_corrupt_quarantined");
    expect(consoleWarn).not.toHaveBeenCalled();
  });

  test("a healthy link file survives reopen and still authorizes", () => {
    const home = newHome();
    const created = new RelayPairingLinkStore(home).getOrCreate();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(new RelayPairingLinkStore(home).accepts(created.token)).toBe(true);
    expect(warn).not.toHaveBeenCalled();
    expect(quarantined(home)).toHaveLength(0);
  });
});
