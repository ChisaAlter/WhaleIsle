/**
 * Report aggregation, atomic JSON export, and terminal scorecard formatting.
 * @module scripts/eval-harness/report
 */

import path from 'node:path';
import { atomicWriteFileSync } from '../../src/shared/fs-safe.js';

/**
 * @typedef {object} EvalTaskMetrics
 * @property {number | null} [step1Bytes]
 * @property {number | null} [step1PromptTokens]
 * @property {number} [totalPromptTokens]
 * @property {number} [totalCompletionTokens]
 * @property {number} [httpRequests]
 * @property {number} [mainHttpRequests]
 * @property {string | null} [step1SystemRole]
 * @property {number | null} [step1ToolCount]
 */

/**
 * @typedef {object} EvalTaskResult
 * @property {string} name
 * @property {boolean} pass
 * @property {number} durationMs
 * @property {EvalTaskMetrics} [metrics]
 * @property {Record<string, unknown>} [details]
 * @property {string} [error]
 */

/**
 * @typedef {object} EvalReport
 * @property {number} schemaVersion
 * @property {'offline' | 'live'} mode
 * @property {string} timestamp
 * @property {string} [model]
 * @property {number} durationMs
 * @property {number} passedCount
 * @property {number} totalCount
 * @property {number} passRate
 * @property {EvalTaskResult[]} results
 */

/**
 * Aggregate individual task outcomes into a canonical report object.
 * @param {{
 *   mode: 'offline' | 'live',
 *   model?: string,
 *   durationMs: number,
 *   results: EvalTaskResult[],
 * }} input
 * @returns {EvalReport}
 */
export function buildReport(input) {
  const totalCount = input.results.length;
  const passedCount = input.results.filter(item => item.pass).length;
  const passRate = totalCount === 0 ? 0 : Number((passedCount / totalCount).toFixed(4));
  return {
    schemaVersion: 1,
    mode: input.mode,
    timestamp: new Date().toISOString(),
    ...input.model !== undefined ? { model: input.model } : {},
    durationMs: Math.round(input.durationMs),
    passedCount,
    totalCount,
    passRate,
    results: input.results,
  };
}

/**
 * Format compact metric summary for one task row.
 * @param {EvalTaskResult} result
 * @returns {string}
 */
function summarizeMetrics(result) {
  const parts = [];
  const metrics = result.metrics;
  if (metrics !== undefined) {
    if (typeof metrics.step1Bytes === 'number') parts.push(`step1=${metrics.step1Bytes}B`);
    if (typeof metrics.step1PromptTokens === 'number') parts.push(`p1=${metrics.step1PromptTokens}`);
    if (typeof metrics.totalPromptTokens === 'number') parts.push(`in=${metrics.totalPromptTokens}`);
    if (typeof metrics.totalCompletionTokens === 'number') parts.push(`out=${metrics.totalCompletionTokens}`);
    if (typeof metrics.httpRequests === 'number') parts.push(`http=${metrics.httpRequests}`);
  }
  if (!result.pass && result.error) {
    parts.push(`err=${result.error}`);
  }
  if (parts.length > 0) return parts.join(' ');
  if (result.details !== undefined) {
    const entries = Object.entries(result.details)
      .slice(0, 3)
      .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : String(v)}`);
    if (entries.length > 0) return entries.join(' ');
  }
  return '-';
}

/**
 * Render an aligned human-readable terminal Scorecard.
 * @param {EvalReport} report
 * @returns {string}
 */
export function formatScorecard(report) {
  const headerParts = [`WhaleIsle Eval Harness (${report.mode})`];
  if (report.model) headerParts.push(`model=${report.model}`);
  const lines = [
    headerParts.join(' | '),
    '-'.repeat(78),
    `${'Task'.padEnd(26)} ${'Status'.padEnd(8)} ${'Time'.padEnd(10)} Summary`,
    '-'.repeat(78),
  ];
  for (const item of report.results) {
    const status = item.pass ? 'PASS' : 'FAIL';
    const time = `${Math.round(item.durationMs)}ms`;
    const summary = summarizeMetrics(item);
    lines.push(`${item.name.padEnd(26)} ${status.padEnd(8)} ${time.padEnd(10)} ${summary}`);
  }
  lines.push('-'.repeat(78));
  const pct = (report.passRate * 100).toFixed(1);
  lines.push(`Passed: ${report.passedCount}/${report.totalCount} (${pct}%) in ${report.durationMs}ms`);
  return lines.join('\n');
}

/**
 * Atomically persist the JSON report to `--out` when specified.
 * @param {string} outPath
 * @param {EvalReport} report
 * @returns {string}
 */
export function writeReportFile(outPath, report) {
  const resolved = path.resolve(outPath);
  atomicWriteFileSync(resolved, `${JSON.stringify(report, null, 2)}\n`);
  return resolved;
}
