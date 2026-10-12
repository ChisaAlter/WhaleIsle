import fs from "node:fs";
import path from "node:path";
import { execFile, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { AuthStore } from "../src/auth/store.js";
import { startBridge } from "../src/bridge/server.js";
import { writeRuntimeState } from "../src/bridge/runtime.js";
import { Workspace } from "../src/workspace/manager.js";
import { SERVICE_NAME, VERSION } from "../src/version.js";
import { cleanup, makeTmpDir, write } from "./helpers.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entry = path.join(projectRoot, "bin", "d2c.js");
const execute = promisify(execFile);
const dirs: string[] = [];
const previousStateDir = process.env.D2C_STATE_DIR;

function directory(name: string): string {
  const dir = makeTmpDir(name);
  dirs.push(dir);
  return dir;
}

function run(args: string[], stateDir: string, extraEnv: NodeJS.ProcessEnv = {}) {
  return spawnSync(process.execPath, [entry, ...args, "--json"], {
    cwd: projectRoot,
    env: { ...process.env, D2C_STATE_DIR: stateDir, ...extraEnv },
    encoding: "utf8",
    windowsHide: true,
  });
}

function authorize(workspace: Workspace): { store: AuthStore; token: string } {
  const store = new AuthStore(workspace.id);
  const client = store.registerClient({ redirectUris: ["https://chatgpt.com/callback"] });
  const tokens = store.issueTokens({ clientId: client.clientId, scopes: ["workspace.read", "offline_access"] });
  return { store, token: tokens.accessToken };
}

afterEach(() => {
  for (const dir of dirs) cleanup(dir);
  dirs.length = 0;
  if (previousStateDir === undefined) delete process.env.D2C_STATE_DIR;
  else process.env.D2C_STATE_DIR = previousStateDir;
});

describe("DSH standalone CLI boundaries", () => {
  it("refuses cold or uncertain pairing without starting a bridge", () => {
    const state = directory("dsh-pair-stopped-state");
    const root = directory("dsh-pair-stopped-workspace");
    const stopped = run(["pair", "-w", root], state);
    expect(stopped.status).toBe(1);
    expect(JSON.parse(stopped.stdout)).toMatchObject({ ok: false });
    expect(JSON.parse(stopped.stdout).error).toMatch(/stopped.*setup/);
    expect(fs.existsSync(path.join(state, "logs"))).toBe(false);
    expect(fs.readdirSync(path.join(state, "runtime"))).toEqual([]);

    process.env.D2C_STATE_DIR = state;
    const workspace = new Workspace(root);
    writeRuntimeState({
      service: SERVICE_NAME, version: VERSION, workspaceId: workspace.id, workspaceRoot: root,
      pid: process.pid, port: 1, adminToken: "d2c_admin_synthetic", publicUrl: null, startedAt: new Date().toISOString(),
    });
    const uncertain = run(["pair", "-w", root], state);
    expect(uncertain.status).toBe(1);
    expect(JSON.parse(uncertain.stdout).error).toMatch(/uncertain.*pairing is not available/);
    expect(fs.existsSync(path.join(state, "logs"))).toBe(false);
  });

  it("keeps preferences and read-only diagnostics independent of Codex config and C2C state", () => {
    const state = directory("dsh-cli-state");
    const foreign = directory("c2c-state-sentinel");
    const codexHome = directory("codex-config-sentinel");
    const workspace = directory("dsh-cli-workspace");
    const config = write(codexHome, "config.toml", "do_not_change = true\n");
    const sentinel = write(foreign, "keep.txt", "foreign product state\n");
    const env = { CODEX_HOME: codexHome, C2C_STATE_DIR: foreign };

    const saved = run(["prefs", "set", "--setup-mode", "manual"], state, env);
    expect(saved.status, saved.stderr).toBe(0);
    expect(JSON.parse(saved.stdout)).toMatchObject({ ok: true, setupMode: "manual" });
    expect(fs.readdirSync(state)).toEqual(["prefs.json"]);

    const diagnosis = run(["doctor", "--no-fix", "-w", workspace], state, env);
    expect(diagnosis.status).toBe(1);
    expect(JSON.parse(diagnosis.stdout).report).not.toHaveProperty("sandbox");
    expect(fs.readFileSync(config, "utf8")).toBe("do_not_change = true\n");
    expect(fs.readFileSync(sentinel, "utf8")).toBe("foreign product state\n");
    expect(fs.readdirSync(foreign)).toEqual(["keep.txt"]);
  });

  it("does not report successful revocation when a live bridge cannot be identified", () => {
    const state = directory("dsh-unpair-unknown-state");
    const root = directory("dsh-unpair-unknown-workspace");
    process.env.D2C_STATE_DIR = state;
    const workspace = new Workspace(root);
    const { token } = authorize(workspace);
    writeRuntimeState({
      service: SERVICE_NAME, version: VERSION, workspaceId: workspace.id, workspaceRoot: root,
      pid: process.pid, port: 1, adminToken: "d2c_admin_synthetic", publicUrl: null, startedAt: new Date().toISOString(),
    });

    const result = run(["unpair", "-w", root], state);
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: false });
    expect(JSON.parse(result.stdout).error).toMatch(/revocation is not confirmed/);
    expect(new AuthStore(workspace.id).verifyAccessToken(token).ok).toBe(true);
  });

  it("revokes persisted tokens with JSON output when the bridge is stopped", () => {
    const state = directory("dsh-unpair-offline-state");
    const root = directory("dsh-unpair-offline-workspace");
    process.env.D2C_STATE_DIR = state;
    const workspace = new Workspace(root);
    const { token } = authorize(workspace);

    const result = run(["unpair", "-w", root], state);
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, workspaceId: workspace.id, revoked: 2 });
    expect(new AuthStore(workspace.id).verifyAccessToken(token).ok).toBe(false);
  });

  it("revokes live in-memory tokens and pairing codes through the actual local admin endpoint", async () => {
    const state = directory("dsh-unpair-live-state");
    const root = directory("dsh-unpair-live-workspace");
    process.env.D2C_STATE_DIR = state;
    const bridge = await startBridge({ workspaceRoot: root, port: 0 });
    const client = bridge.authStore.registerClient({ redirectUris: ["https://chatgpt.com/callback"] });
    const tokens = bridge.authStore.issueTokens({ clientId: client.clientId, scopes: ["workspace.read"] });
    bridge.pairing.create();
    try {
      const result = await execute(process.execPath, [entry, "unpair", "-w", root, "--json"], {
        cwd: projectRoot, env: { ...process.env, D2C_STATE_DIR: state }, windowsHide: true,
      });
      expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, workspaceId: bridge.workspace.id, revoked: 1 });
      expect(bridge.authStore.verifyAccessToken(tokens.accessToken).ok).toBe(false);
      expect(bridge.pairing.hasActiveSession()).toBe(false);
    } finally {
      await bridge.close();
    }
  });
});
