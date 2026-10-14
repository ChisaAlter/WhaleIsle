import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { appendExecutionRecord, readExecutionRecords, type ExecutionRecord } from "../src/execution/records.js";
import { listExecutionOutputs, readExecutionOutput } from "../src/execution/output.js";
import { Workspace } from "../src/workspace/manager.js";
import { cleanup, makeTmpDir, write } from "./helpers.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliEntry = path.join(projectRoot, "src/cli/index.ts");
const privateKey = "-----BEGIN OPENSSH PRIVATE KEY-----\nfixture\n-----END OPENSSH PRIVATE KEY-----";

describe("execution metadata boundaries", () => {
  const dirs: string[] = [];
  const previousState = process.env.D2C_STATE_DIR;

  const state = () => {
    const directory = makeTmpDir("execution-metadata-state");
    dirs.push(directory);
    process.env.D2C_STATE_DIR = directory;
    return directory;
  };

  afterEach(() => {
    if (previousState === undefined) delete process.env.D2C_STATE_DIR;
    else process.env.D2C_STATE_DIR = previousState;
    for (const directory of dirs) cleanup(directory);
    dirs.length = 0;
  });

  const summary = (): ExecutionRecord => ({
    taskId: "d2c_test",
    iteration: 1,
    changedFiles: ["src/index.ts"],
    tests: "fixture passed",
    exitStatus: "ok",
    timestamp: "2026-10-12T00:00:00.000Z",
  });

  it("sanitizes every summary string before persistence and remote reads", () => {
    const directory = state();
    const apiToken = `sk-${"a".repeat(24)}`;
    const gitToken = `github_pat_${"b".repeat(24)}`;
    appendExecutionRecord("ws", {
      ...summary(),
      tests: `test used ${apiToken}`,
      exitStatus: `failed ${gitToken}`,
      changedFiles: [`src/${gitToken}.ts`, privateKey],
      executor: `${"fixture ".repeat(20)}${privateKey}`,
      notes: `${"context ".repeat(70)}${privateKey}`,
    });
    const persisted = fs.readFileSync(path.join(directory, "executions", "ws.jsonl"), "utf8");
    expect(persisted.includes(apiToken) || persisted.includes(gitToken) || persisted.includes(privateKey)).toBe(false);
    const [record] = readExecutionRecords("ws");
    expect(record.tests).toBe("test used [REDACTED]");
    expect(record.exitStatus).toBe("failed [REDACTED]");
    expect(record.changedFiles).toEqual(["src/[REDACTED].ts", "[RESTRICTED]"]);
    expect(record.executor).toBe("[RESTRICTED]");
    expect(record.notes).toBe("[RESTRICTED]");
  });

  it("does not publish unsafe metadata in already-persisted records and output indexes", () => {
    const directory = state();
    const token = `sk-${"z".repeat(24)}`;
    write(directory, "executions/ws.jsonl", `${JSON.stringify({ ...summary(), tests: token, notes: privateKey })}\n`);
    write(directory, "execution-outputs/ws/index.json", JSON.stringify({
      nextId: 2,
      items: [{ id: 1, command: token, exitCode: 0, timestamp: summary().timestamp, allowed: true, truncated: false, sizeBytes: 7 }],
    }));
    write(directory, "execution-outputs/ws/bodies/1.txt", "passed\n");
    expect(readExecutionRecords("ws")[0]).toMatchObject({ tests: "[REDACTED]", notes: "[RESTRICTED]" });
    expect(listExecutionOutputs("ws")[0].command).toBe("[REDACTED]");
    const read = readExecutionOutput("ws", 1);
    expect(read.ok).toBe(true);
    if (read.ok) expect(read.meta.command).toBe("[REDACTED]");
  });

  it("enforces workspace source policy for the exported record CLI before saving output", () => {
    const directory = state();
    const root = makeTmpDir("execution-metadata-workspace");
    dirs.push(root);
    write(root, ".env", "SECRET=fixture-only\n");
    write(root, ".d2cignore", "private-result.log\n");
    write(root, "private-result.log", "private fixture\n");
    const outside = write(directory, "outside.log", "outside fixture\n");
    const workspace = new Workspace(root);
    const run = (outputFile: string, metadata: string[] = []) => spawnSync(process.execPath, [
      "--import", "tsx", cliEntry, "record", "-w", root, "--json",
      "--task", "d2c_test", "--iteration", "1", "--command", "fixture-check", "--output-file", outputFile,
      ...metadata,
    ], { cwd: projectRoot, encoding: "utf8", env: process.env, windowsHide: true });

    for (const [outputFile, code] of [[".env", "ACCESS_DENIED_SENSITIVE_FILE"], ["private-result.log", "ACCESS_DENIED_SENSITIVE_FILE"], [outside, "PATH_OUTSIDE_WORKSPACE"]]) {
      const result = run(outputFile);
      expect(result.status).toBe(1);
      const denied = JSON.parse(result.stdout);
      expect(denied.ok).toBe(false);
      expect(denied.error).toContain(code);
      expect(readExecutionRecords(workspace.id)).toEqual([]);
      expect(listExecutionOutputs(workspace.id)).toEqual([]);
    }
    write(root, "check.log", "fixture passed\n");
    const accepted = run("check.log", ["--executor", `${"fixture ".repeat(20)}${privateKey}`]);
    expect(accepted.status).toBe(0);
    expect(JSON.parse(accepted.stdout)).toMatchObject({ ok: true, outputAvailable: true });
    expect(readExecutionRecords(workspace.id)).toEqual([expect.objectContaining({ executor: "[RESTRICTED]" })]);
    const [output] = listExecutionOutputs(workspace.id);
    const read = readExecutionOutput(workspace.id, output.id);
    expect(read.ok).toBe(true);
    if (read.ok) expect(read.text).toBe("fixture passed\n");
  });
});
