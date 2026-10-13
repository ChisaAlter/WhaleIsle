import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { ensureDir, getStateDir } from "../config/paths.js";
import { sanitizeExecutionOutput } from "./sanitize.js";

/**
 * Lightweight execution records written by the harness after each iteration
 * (via `d2c record`). ChatGPT reads them through the `execution_summary` and
 * `test_status` MCP tools.
 *
 * `executor` is optional so records written before this field existed keep
 * parsing. When it is absent the executor is simply unknown; historically that
 * meant DSH, but the record itself does not say so.
 */
export const executionRecordSchema = z.object({
  taskId: z.string(),
  iteration: z.number().int().nonnegative(),
  changedFiles: z.union([z.array(z.string()), z.number().int().nonnegative()]),
  tests: z.string().nullable(),
  exitStatus: z.string(),
  timestamp: z.string(),
  executor: z.string().min(1).max(80).optional(),
  notes: z.string().optional(),
  outputId: z.number().int().positive().optional(),
  outputAvailable: z.boolean().optional(),
});

export type ExecutionRecord = z.infer<typeof executionRecordSchema>;

function recordsFile(workspaceId: string): string {
  const dir = ensureDir(path.join(getStateDir(), "executions"));
  return path.join(dir, `${workspaceId}.jsonl`);
}

function sanitizeRecord(record: ExecutionRecord): ExecutionRecord {
  // Summary fields are remote-readable just like nominated command output.
  const text = (value: string): string => {
    const sanitized = sanitizeExecutionOutput(value);
    return sanitized.allowed ? sanitized.text : "[RESTRICTED]";
  };
  return {
    ...record,
    taskId: text(record.taskId),
    changedFiles: Array.isArray(record.changedFiles) ? record.changedFiles.map(text) : record.changedFiles,
    tests: record.tests === null ? null : text(record.tests),
    exitStatus: text(record.exitStatus),
    timestamp: text(record.timestamp),
    ...(record.executor === undefined ? {} : { executor: text(record.executor).slice(0, 80) }),
    ...(record.notes === undefined ? {} : { notes: text(record.notes).slice(0, 400) }),
  };
}

export function appendExecutionRecord(workspaceId: string, record: ExecutionRecord): void {
  const file = recordsFile(workspaceId);
  fs.appendFileSync(file, JSON.stringify(executionRecordSchema.parse(sanitizeRecord(record))) + "\n", { mode: 0o600 });
}

export function readExecutionRecords(workspaceId: string, limit = 10): ExecutionRecord[] {
  const file = recordsFile(workspaceId);
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean);
  const records: ExecutionRecord[] = [];
  const requestedLimit = Math.max(1, Math.floor(limit));
  for (let index = lines.length - 1; index >= 0 && records.length < requestedLimit; index--) {
    try {
      const record = executionRecordSchema.safeParse(JSON.parse(lines[index]));
      if (record.success) records.push(sanitizeRecord(record.data));
    } catch {
      // skip corrupt lines
    }
  }
  return records.reverse();
}

export function latestExecutionRecord(workspaceId: string): ExecutionRecord | null {
  const records = readExecutionRecords(workspaceId, 1);
  return records[records.length - 1] ?? null;
}
