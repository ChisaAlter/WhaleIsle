import { afterEach, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startBridge } from "../src/bridge/server.js";
import {
  findBridgeObservation,
  findLiveBridge,
  readRuntimeState,
  writeRuntimeState,
  type RuntimeState,
} from "../src/bridge/runtime.js";
import { ensureBridge, stopBridge } from "../src/process/daemon.js";
import { SERVICE_NAME, VERSION } from "../src/version.js";
import { Workspace } from "../src/workspace/manager.js";
import { cleanup, isolateStateDir, makeTmpDir, write } from "./helpers.js";

function stubRuntime(workspaceId: string, workspaceRoot: string, pid: number, port: number): RuntimeState {
  return {
    service: SERVICE_NAME,
    version: VERSION,
    workspaceId,
    workspaceRoot,
    pid,
    port,
    adminToken: "test-token",
    publicUrl: null,
    startedAt: new Date().toISOString(),
  };
}

describe("findBridgeObservation", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs) cleanup(dir);
    dirs.length = 0;
    delete process.env.D2C_STATE_DIR;
  });

  it("treats a missing runtime file as stopped", async () => {
    dirs.push(isolateStateDir());
    const root = makeTmpDir("obs-missing");
    dirs.push(root);
    write(root, "a.txt", "a");
    const workspace = new Workspace(root);
    const observation = await findBridgeObservation(workspace.id);
    expect(observation.state).toBe("stopped");
    if (observation.state === "stopped") expect(observation.reason).toBe("runtime_missing");
    expect(await findLiveBridge(workspace.id)).toBeNull();
  });

  it("treats a dead pid plus a failed probe as stopped", async () => {
    dirs.push(isolateStateDir());
    const root = makeTmpDir("obs-dead");
    dirs.push(root);
    write(root, "a.txt", "a");
    const workspace = new Workspace(root);
    writeRuntimeState(stubRuntime(workspace.id, workspace.root, 999_999_999, 1));
    const observation = await findBridgeObservation(workspace.id);
    expect(observation.state).toBe("stopped");
    if (observation.state === "stopped") expect(observation.reason).toBe("pid_missing");
    expect(await findLiveBridge(workspace.id)).toBeNull();
  });

  it("does not treat a live pid plus a failed probe as stopped", async () => {
    dirs.push(isolateStateDir());
    const root = makeTmpDir("obs-unknown");
    dirs.push(root);
    write(root, "a.txt", "a");
    const workspace = new Workspace(root);
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      stdio: "ignore",
      detached: true,
    });
    child.unref();
    try {
      if (!child.pid) throw new Error("failed to spawn helper");
      writeRuntimeState(stubRuntime(workspace.id, workspace.root, child.pid, 1));
      const observation = await findBridgeObservation(workspace.id);
      expect(observation.state).toBe("unknown");
      if (observation.state === "unknown") expect(observation.reason).toBe("probe_failed");
      expect(await findLiveBridge(workspace.id)).toBeNull();
      await expect(ensureBridge(root)).rejects.toThrow(/uncertain/);
    } finally {
      if (child.pid) {
        try {
          process.kill(child.pid, "SIGKILL");
        } catch {
          /* ignore */
        }
      }
    }
  });

  it("reports healthy when the local bridge answers", async () => {
    dirs.push(isolateStateDir());
    const root = makeTmpDir("obs-live");
    dirs.push(root);
    write(root, "a.txt", "a");
    const auth = path.join(makeTmpDir("obs-auth"), "store.json");
    dirs.push(path.dirname(auth));
    const bridge = await startBridge({
      workspaceRoot: root,
      port: 0,
      persistRuntime: true,
      authStoreFile: auth,
    });
    try {
      const observation = await findBridgeObservation(bridge.workspace.id);
      expect(observation.state).toBe("healthy");
      expect(await findLiveBridge(bridge.workspace.id)).not.toBeNull();
    } finally {
      await bridge.close();
    }
  });
});

describe("stopBridge", () => {
  const dirs: string[] = [];
  const children: ChildProcess[] = [];
  const previousStateDir = process.env.D2C_STATE_DIR;

  function directory(name: string): string {
    const dir = makeTmpDir(name);
    dirs.push(dir);
    return dir;
  }

  async function unrelatedProcess(): Promise<ChildProcess> {
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      stdio: "ignore",
      windowsHide: true,
    });
    children.push(child);
    await once(child, "spawn");
    return child;
  }

  function expectStillRunning(child: ChildProcess): void {
    expect(child.exitCode).toBeNull();
    expect(child.signalCode).toBeNull();
    expect(() => process.kill(child.pid!, 0)).not.toThrow();
  }

  afterEach(async () => {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) {
        const exited = once(child, "exit");
        child.kill(); // Only the test-owned process handle, never a cached PID.
        await exited;
      }
    }
    children.length = 0;
    for (const dir of dirs) cleanup(dir);
    dirs.length = 0;
    if (previousStateDir === undefined) delete process.env.D2C_STATE_DIR;
    else process.env.D2C_STATE_DIR = previousStateDir;
  });

  it("returns false for a missing or confirmed stopped bridge", async () => {
    dirs.push(isolateStateDir());
    const workspace = new Workspace(directory("stop-missing"));
    expect(await stopBridge(workspace.root)).toBe(false);
    writeRuntimeState(stubRuntime(workspace.id, workspace.root, 999_999_999, 1));
    expect(await stopBridge(workspace.root)).toBe(false);
  });

  it("does not signal an unrelated live process named by stale runtime state", async () => {
    dirs.push(isolateStateDir());
    const workspace = new Workspace(directory("stop-stale"));
    const unrelated = await unrelatedProcess();
    const runtime = stubRuntime(workspace.id, workspace.root, unrelated.pid!, 1);
    writeRuntimeState(runtime);

    await expect(stopBridge(workspace.root)).rejects.toThrow(/probe_failed.*refusing to stop/);
    expectStillRunning(unrelated);
    expect(readRuntimeState(workspace.id)).toEqual(runtime);
  });

  it("refuses a healthy bridge belonging to another workspace without signalling the cached PID", async () => {
    dirs.push(isolateStateDir());
    const workspace = new Workspace(directory("stop-wrong-workspace"));
    const unrelated = await unrelatedProcess();
    const bridge = await startBridge({
      workspaceRoot: directory("stop-other-workspace"),
      port: 0,
      persistRuntime: false,
      authStoreFile: path.join(directory("stop-other-auth"), "store.json"),
    });
    try {
      writeRuntimeState(stubRuntime(workspace.id, workspace.root, unrelated.pid!, bridge.port));
      await expect(stopBridge(workspace.root)).rejects.toThrow(/workspace_mismatch.*refusing to stop/);
      expectStillRunning(unrelated);
      expect((await findBridgeObservation(workspace.id)).state).toBe("unknown");
    } finally {
      await bridge.close();
    }
  });

  it("reports admin authentication rejection without signalling the cached PID", async () => {
    dirs.push(isolateStateDir());
    const workspace = new Workspace(directory("stop-rejected"));
    const unrelated = await unrelatedProcess();
    const bridge = await startBridge({
      workspaceRoot: workspace.root,
      port: 0,
      persistRuntime: false,
      authStoreFile: path.join(directory("stop-rejected-auth"), "store.json"),
    });
    try {
      writeRuntimeState(stubRuntime(workspace.id, workspace.root, unrelated.pid!, bridge.port));
      await expect(stopBridge(workspace.root)).rejects.toThrow(/Authenticated bridge shutdown failed: Admin request failed \(404\)/);
      expectStillRunning(unrelated);
      expect((await findBridgeObservation(workspace.id)).state).toBe("healthy");
    } finally {
      await bridge.close();
    }
  });

  it("stops an authenticated daemon and permits a fresh daemon for the same workspace", async () => {
    dirs.push(isolateStateDir());
    const workspace = new Workspace(directory("stop-authenticated"));
    const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

    async function spawnDaemon(): Promise<ChildProcess> {
      const child = spawn(process.execPath, [
        "--import", "tsx/esm", "src/cli/index.ts", "serve", "--workspace", workspace.root, "--port", "0",
      ], { cwd: projectRoot, env: { ...process.env }, stdio: "ignore", windowsHide: true });
      children.push(child);
      await once(child, "spawn");
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        const live = await findLiveBridge(workspace.id);
        if (live?.pid === child.pid) return child;
        if (child.exitCode !== null) throw new Error(`Test daemon exited with code ${child.exitCode}`);
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error("Test daemon did not become healthy");
    }

    const first = await spawnDaemon();
    const firstExited = once(first, "exit");
    expect(await stopBridge(workspace.root)).toBe(true);
    expect(await firstExited).toEqual([0, null]);
    expect(readRuntimeState(workspace.id)).toBeNull();

    const second = await spawnDaemon();
    expect(second.pid).not.toBe(first.pid);
    const secondExited = once(second, "exit");
    expect(await stopBridge(workspace.root)).toBe(true);
    expect(await secondExited).toEqual([0, null]);
    expect(await stopBridge(workspace.root)).toBe(false);
  });
});
