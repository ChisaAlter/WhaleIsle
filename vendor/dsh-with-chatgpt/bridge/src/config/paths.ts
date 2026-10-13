import os from "node:os";
import path from "node:path";
import fs from "node:fs";

/**
 * State directory resolution, following OS conventions.
 * Override with D2C_STATE_DIR (used heavily by tests).
 */
export function getStateDir(): string {
  const override = process.env.D2C_STATE_DIR;
  if (override && override.trim() !== "") return path.resolve(override);
  const home = os.homedir();
  switch (process.platform) {
    case "darwin":
      return path.join(home, "Library", "Application Support", "dsh-with-chatgpt");
    case "win32":
      return path.join(process.env.LOCALAPPDATA ?? path.join(home, "AppData", "Local"), "dsh-with-chatgpt");
    default: {
      const base = process.env.XDG_STATE_HOME ?? path.join(home, ".local", "state");
      return path.join(base, "dsh-with-chatgpt");
    }
  }
}

export function ensureDir(dir: string): string {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

export function stateSubdir(name: string): string {
  return ensureDir(path.join(getStateDir(), name));
}

/** Write a JSON file with owner-only permissions. */
export function writeSecureJson(file: string, data: unknown): void {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(data, null, 2), { mode: 0o600 });
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    // best effort on platforms without chmod semantics
  }
}

export function readJsonIfExists<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export const DEFAULT_PORT = 48765;
export const DEFAULT_HOST = "127.0.0.1";
