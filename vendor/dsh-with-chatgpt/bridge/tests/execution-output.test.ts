import { afterEach, describe, expect, it } from "vitest";
import { sanitizeExecutionOutput, MAX_OUTPUT_LINES } from "../src/execution/sanitize.js";
import { listExecutionOutputs, readExecutionOutput, saveExecutionOutput } from "../src/execution/output.js";
import { cleanup, isolateStateDir } from "./helpers.js";

describe("sanitizeExecutionOutput", () => {
  it("redacts bearer tokens and pairing-code shaped strings", () => {
    const result = sanitizeExecutionOutput(
      "Authorization: Bearer d2c_at_abcdefghijklmnopqrstuv\ncode ABCD-EFGH failed"
    );
    expect(result.allowed).toBe(true);
    if (result.allowed) {
      expect(result.text).not.toMatch(/d2c_at_/);
      expect(result.text).toContain("[REDACTED]");
      expect(result.text).not.toContain("ABCD-EFGH");
    }
  });

  it("rejects private keys entirely", () => {
    const result = sanitizeExecutionOutput("oops\n-----BEGIN RSA PRIVATE KEY-----\nMIIE\n-----END RSA PRIVATE KEY-----");
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toBe("private_key");
  });

  it("rejects PGP private key blocks", () => {
    const result = sanitizeExecutionOutput("-----BEGIN PGP PRIVATE KEY BLOCK-----\nversion\n-----END PGP PRIVATE KEY BLOCK-----");
    expect(result.allowed).toBe(false);
  });

  it("redacts home paths", () => {
    const result = sanitizeExecutionOutput("wrote /Users/alice/proj/src/a.ts");
    expect(result.allowed).toBe(true);
    if (result.allowed) {
      expect(result.text).not.toContain("/Users/alice");
      expect(result.text).toContain("/Users/[user]");
    }
  });

  it("truncates giant logs", () => {
    const raw = Array.from({ length: MAX_OUTPUT_LINES + 50 }, (_, i) => `line ${i}`).join("\n");
    const result = sanitizeExecutionOutput(raw);
    expect(result.allowed).toBe(true);
    if (result.allowed) {
      expect(result.truncated).toBe(true);
      expect(result.text.split("\n").length).toBeLessThanOrEqual(MAX_OUTPUT_LINES + 2);
    }
  });
});

describe("execution output store", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs) cleanup(dir);
    dirs.length = 0;
    delete process.env.D2C_STATE_DIR;
  });

  it("stores readable output and hides restricted bodies", () => {
    dirs.push(isolateStateDir());
    const okItem = saveExecutionOutput("ws1", {
      command: "pnpm test",
      raw: "2 failed\nAssertionError: expected 1 to be 2",
      exitCode: 1,
      taskId: "d2c_aa",
      iteration: 3,
    });
    expect(okItem.allowed).toBe(true);
    const listed = listExecutionOutputs("ws1");
    expect(listed.some((item) => item.id === okItem.id && item.allowed)).toBe(true);
    const read = readExecutionOutput("ws1", okItem.id);
    expect(read.ok).toBe(true);
    if (read.ok) expect(read.text).toContain("AssertionError");

    const blocked = saveExecutionOutput("ws1", {
      command: "cat key",
      raw: "-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----",
      exitCode: 0,
    });
    expect(blocked.allowed).toBe(false);
    const denied = readExecutionOutput("ws1", blocked.id);
    expect(denied).toEqual({ ok: false, error: "OUTPUT_RESTRICTED" });
  });

  it("redacts token-shaped text in the stored command", () => {
    dirs.push(isolateStateDir());
    const item = saveExecutionOutput("ws1", {
      command: "curl -H Bearer d2c_at_abcdefghijklmnopqrstuv",
      raw: "ok",
      exitCode: 0,
    });
    expect(item.command).not.toMatch(/d2c_at_/);
    expect(item.command).toContain("[REDACTED]");
  });

  it("sanitizes command metadata even when its output body is restricted", () => {
    dirs.push(isolateStateDir());
    const token = `sk-${"x".repeat(24)}`;
    const privateKey = "-----BEGIN OPENSSH PRIVATE KEY-----\nfixture\n-----END OPENSSH PRIVATE KEY-----";
    const item = saveExecutionOutput("ws1", {
      command: `fixture-check --api-key ${token}`,
      raw: privateKey,
    });
    expect(item.allowed).toBe(false);
    expect(item.command.includes(token)).toBe(false);
    expect(item.command).toContain("[REDACTED]");
    expect(listExecutionOutputs("ws1")[0].command).toBe(item.command);
    expect(readExecutionOutput("ws1", item.id)).toEqual({ ok: false, error: "OUTPUT_RESTRICTED" });

    const rejectedCommand = saveExecutionOutput("ws1", { command: privateKey, raw: "fixture passed" });
    expect(rejectedCommand.command).toBe("[RESTRICTED]");
    const read = readExecutionOutput("ws1", rejectedCommand.id);
    expect(read.ok).toBe(true);
    if (read.ok) expect(read.meta.command).toBe("[RESTRICTED]");
  });
});
