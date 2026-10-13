import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { listExecutionOutputs } from "../src/execution/output.js";
import { appendExecutionRecord, readExecutionRecords, type ExecutionRecord } from "../src/execution/records.js";
import { Workspace } from "../src/workspace/manager.js";
import { cleanup, makeTmpDir, write } from "./helpers.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliEntry = path.join(projectRoot, "src/cli/index.ts");

function runRecord(root: string, args: string[]) {
  return spawnSync(
    process.execPath,
    ["--import", "tsx", cliEntry, "record", "--workspace", root, "--task", "d2c_test", ...args],
    { cwd: projectRoot, encoding: "utf8", env: process.env }
  );
}

function withRecordEnvironment(run: (root: string, workspace: Workspace) => void): void {
  const root = makeTmpDir("record-cli-workspace");
  const stateDir = makeTmpDir("record-cli-state");
  const previousStateDir = process.env.D2C_STATE_DIR;
  process.env.D2C_STATE_DIR = stateDir;

  try {
    run(root, new Workspace(root));
  } finally {
    if (previousStateDir === undefined) delete process.env.D2C_STATE_DIR;
    else process.env.D2C_STATE_DIR = previousStateDir;
    cleanup(root);
    cleanup(stateDir);
  }
}

describe("d2c record", () => {
  it("records valid numeric options and command output", () => {
    withRecordEnvironment((root, workspace) => {
      const result = runRecord(root, [
        "--iteration",
        "2",
        "--changed-files",
        "3",
        "--command",
        "pnpm test",
        "--output",
        "tests passed",
        "--exit-code",
        "1",
      ]);

      expect(result.status).toBe(0);
      expect(readExecutionRecords(workspace.id)).toEqual([
        expect.objectContaining({ taskId: "d2c_test", iteration: 2, changedFiles: 3 }),
      ]);
      expect(listExecutionOutputs(workspace.id)).toEqual([
        expect.objectContaining({ command: "pnpm test", exitCode: 1, iteration: 2 }),
      ]);
    });
  });

  it("records the executor that ran the iteration", () => {
    withRecordEnvironment((root, workspace) => {
      const result = runRecord(root, ["--iteration", "1", "--executor", "claude-code"]);

      expect(result.status).toBe(0);
      expect(readExecutionRecords(workspace.id)).toEqual([
        expect.objectContaining({ taskId: "d2c_test", iteration: 1, executor: "claude-code" }),
      ]);
    });
  });

  it("rejects nominated Git metadata before persisting any execution output", () => {
    withRecordEnvironment((root, workspace) => {
      write(root, ".git/config", "[remote \"origin\"]\nurl = https://fixture-user:fixture-password@example.invalid/repo\n[http]\nextraHeader = Authorization: Basic fixture-git-header\n");
      write(root, "worktree/.git", "gitdir: ../fixture-git-dir\n");

      for (const nominated of [".git/config", "workspace:/.git/config", "worktree/.git"]) {
        const result = runRecord(root, [
          "--iteration", "1", "--command", "git metadata fixture", "--output-file", nominated,
        ]);

        expect(result.status).toBe(1);
        const emitted = `${result.stdout}${result.stderr}`;
        expect(emitted).toContain("ACCESS_DENIED_SENSITIVE_FILE");
        expect(emitted).not.toContain("fixture-password");
        expect(emitted).not.toContain("fixture-git-header");
        expect(emitted).not.toContain("gitdir:");
        expect(readExecutionRecords(workspace.id)).toEqual([]);
        expect(listExecutionOutputs(workspace.id)).toEqual([]);
      }
    });
  });

  it("keeps recording when no executor is given, so older callers still work", () => {
    withRecordEnvironment((root, workspace) => {
      const result = runRecord(root, ["--iteration", "1"]);

      expect(result.status).toBe(0);
      const [record] = readExecutionRecords(workspace.id);
      expect(record.taskId).toBe("d2c_test");
      expect(record.executor).toBeUndefined();
    });
  });

  it("rejects a non-integer iteration without recording the execution", () => {
    withRecordEnvironment((root, workspace) => {
      const result = runRecord(root, ["--iteration", "abc"]);

      expect(result.status).toBe(1);
      expect(readExecutionRecords(workspace.id)).toEqual([]);
    });
  });

  it("rejects an unsafe changed-file count before recording command output", () => {
    withRecordEnvironment((root, workspace) => {
      const result = runRecord(root, [
        "--iteration",
        "1",
        "--changed-files",
        "9".repeat(400),
        "--command",
        "pnpm test",
        "--output",
        "tests passed",
      ]);

      expect(result.status).toBe(1);
      expect(readExecutionRecords(workspace.id)).toEqual([]);
      expect(listExecutionOutputs(workspace.id)).toEqual([]);
    });
  });

  it("rejects a negative changed-file count", () => {
    withRecordEnvironment((root, workspace) => {
      const result = runRecord(root, ["--iteration", "1", "--changed-files=-1"]);

      expect(result.status).toBe(1);
      expect(readExecutionRecords(workspace.id)).toEqual([]);
    });
  });

  it("rejects a non-integer exit code before recording command output", () => {
    withRecordEnvironment((root, workspace) => {
      const result = runRecord(root, [
        "--iteration",
        "1",
        "--command",
        "pnpm test",
        "--output",
        "tests passed",
        "--exit-code",
        "abc",
      ]);

      expect(result.status).toBe(1);
      expect(readExecutionRecords(workspace.id)).toEqual([]);
      expect(listExecutionOutputs(workspace.id)).toEqual([]);
    });
  });
});

describe("execution record persistence", () => {
  it("rejects invalid records at the write boundary", () => {
    withRecordEnvironment((_root, workspace) => {
      const invalidRecord: ExecutionRecord = {
        taskId: "d2c_invalid",
        iteration: Number.NaN,
        changedFiles: 0,
        tests: null,
        exitStatus: "ok",
        timestamp: new Date().toISOString(),
      };

      expect(() => appendExecutionRecord(workspace.id, invalidRecord)).toThrow();
      expect(readExecutionRecords(workspace.id)).toEqual([]);
    });
  });
});
