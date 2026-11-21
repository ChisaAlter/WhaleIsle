/** Execution error classification, hotspot conflict detection and deterministic evidence probes. */
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { isAbsolute, resolve, relative } from 'node:path';
import { checkedRoot, samePath, within } from './files.js';

const AUTH_PATTERNS = [/\b401\b/, /\b403\b/, /\bauth\b/i, /unauthorized/i, /forbidden/i, /missing[_\s-]?credential/i, /credential/i, /(?:invalid|missing)[_\s-]?api[_\s-]?key/i, /api[_\s-]?key[_\s-]?(?:missing|invalid|required)/i, /authentication/i, /token[\s_-]*expired/i, /invalid[\s_-]*token/i, /permission[_\s-]?denied/i];
const QUOTA_PATTERNS = [/\b402\b/, /\bquota\b/i, /insufficient[_\s-]?quota/i, /quota[_\s-]?exceeded/i, /billing/i, /payment[_\s-]?required/i, /credit/i];
const CONFIG_PATTERNS = [/\b400\b/, /\b404\b/, /invalid[_\s-]?config/i, /invalid[_\s-]?argument/i, /invalid[_\s-]?model/i, /model[_\s-]?not[_\s-]?found/i, /unsupported[_\s-]?model/i, /missing[_\s-]?provider/i, /bad[_\s-]?request/i, /invalid[_\s-]?request/i, /schema/i];
const ENV_PATTERNS = [/\benoent\b/i, /\beacces\b/i, /\beperm\b/i, /\benospc\b/i, /not[_\s-]?a[_\s-]?git[_\s-]?repo/i, /worktree/i, /workspace/i, /permission denied/i];
const TRANSIENT_PATTERNS = [/\b429\b/, /\b50[0234]\b/, /rate[_\s-]?limit/i, /timeout/i, /timed[_\s-]?out/i, /econnreset/i, /econnrefused/i, /etimedout/i, /ehostunreach/i, /network/i, /overloaded/i, /service[_\s-]?unavailable/i, /temporarily/i, /server/i, /transport/i, /stream/i];

/**
 * Strongly classify execution failures into transient vs non-retryable config/auth/quota/environment errors.
 * Non-retryable errors set `retryRequired: true` so automation pauses for human repair instead of burning retry budgets.
 */
export function classifyExecutionError(error) {
  const code = String(error?.code ?? '');
  const message = String(error?.message ?? '');
  const combined = `${code} ${message}`;
  if (AUTH_PATTERNS.some(pattern => pattern.test(combined))) {
    return { category: 'auth', retryable: false, retryRequired: true };
  }
  if (QUOTA_PATTERNS.some(pattern => pattern.test(combined))) {
    return { category: 'quota', retryable: false, retryRequired: true };
  }
  if (CONFIG_PATTERNS.some(pattern => pattern.test(combined))) {
    return { category: 'config', retryable: false, retryRequired: true };
  }
  if (ENV_PATTERNS.some(pattern => pattern.test(combined))) {
    return { category: 'environment', retryable: false, retryRequired: true };
  }
  if (TRANSIENT_PATTERNS.some(pattern => pattern.test(combined))) {
    return { category: 'transient', retryable: true, retryRequired: false };
  }
  return { category: 'unknown', retryable: true, retryRequired: false };
}

const HOTSPOT_BASENAMES = new Set([
  'package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb',
  'tsconfig.json', 'jsconfig.json', 'eslint.config.js', 'eslint.config.mjs', 'eslint.config.cjs',
  'cargo.toml', 'cargo.lock', 'go.mod', 'go.sum', 'pyproject.toml', 'poetry.lock', 'requirements.txt',
  'schema.prisma', 'openapi.json', 'openapi.yaml', 'openapi.yml', 'provenance.json',
  'vite.config.js', 'vite.config.ts', 'vite.config.mjs', 'next.config.js', 'next.config.mjs', 'next.config.ts',
]);

function normalizeRelPath(value) {
  const cleaned = String(value ?? '').trim().replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/+$/, '');
  return process.platform === 'win32' ? cleaned.toLowerCase() : cleaned;
}

function pathsOverlap(a, b) {
  const left = normalizeRelPath(a);
  const right = normalizeRelPath(b);
  if (!left || !right) return false;
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

function isHotspotFile(pathValue) {
  const normalized = normalizeRelPath(pathValue);
  if (!normalized) return false;
  const base = normalized.split('/').at(-1) ?? '';
  return HOTSPOT_BASENAMES.has(base.toLowerCase());
}

function extractMentionedHotspots(text) {
  if (typeof text !== 'string' || !text.trim()) return [];
  const matches = text.match(/(?:[\w.-]+\/)*[\w.-]+\.(?:json|yaml|yml|toml|lock|lockb|prisma|mod|sum|txt|mjs|cjs|js|ts)/gi) ?? [];
  const found = [];
  for (const raw of matches) {
    const normalized = normalizeRelPath(raw);
    if (normalized && isHotspotFile(normalized) && !found.includes(normalized)) found.push(normalized);
  }
  return found;
}

function activeWritePaths(work, worker) {
  const current = work.delegations.find(receipt => receipt.ref === work.currentDelegationRef) ?? work.delegations.at(-1);
  if (current?.writePaths?.length) return current.writePaths;
  if (worker?.writePaths?.length) return worker.writePaths;
  return [];
}

function isActiveWritableWork(work, worker) {
  if (work.archived) return false;
  const current = work.delegations.find(receipt => receipt.ref === work.currentDelegationRef) ?? work.delegations.at(-1);
  const writable = current ? (current.scope === 'worker' || current.scope === 'docs') : (worker?.role === 'worker' || worker?.role === 'docs');
  if (!writable) return false;
  if (worker?.phase === 'active' || worker?.phase === 'provisioning') return true;
  return current?.phase === 'preparing' || current?.phase === 'accepted' || current?.phase === 'queued';
}

/**
 * Statically detect overlapping `writePaths` or shared hotspot contract/config files
 * against other active writable workstreams in the same Project.
 * Readonly/research workstreams and disjoint write paths pass without conflict.
 */
export function detectHotspotConflicts(catalog, project, candidate) {
  const scope = candidate.scope;
  if (scope !== 'worker' && scope !== 'docs') return { conflicts: [], warnings: [], hasWriteOverlap: false };
  const candidatePaths = (candidate.writePaths ?? []).filter(Boolean);
  const candidateHotspots = [...new Set([
    ...candidatePaths.filter(isHotspotFile).map(normalizeRelPath),
    ...extractMentionedHotspots(`${candidate.title ?? ''} ${candidate.brief ?? ''}`),
  ])];
  const dependencyIds = new Set(candidate.blockedBy ?? []);
  const conflicts = [];
  const seen = new Set();

  for (const work of catalog.workstreams) {
    if (work.projectId !== project.id || work.id === candidate.workstreamId) continue;
    if (dependencyIds.has(work.id)) continue;
    const worker = catalog.workers.find(row => row.sessionId === work.workerSessionId);
    if (!isActiveWritableWork(work, worker)) continue;
    const holderPaths = activeWritePaths(work, worker);
    for (const mine of candidatePaths) {
      for (const theirs of holderPaths) {
        if (!pathsOverlap(mine, theirs)) continue;
        const key = `write_overlap:${work.id}:${normalizeRelPath(mine)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        conflicts.push({
          path: mine,
          holderWorkstreamId: work.id,
          holderTitle: work.title,
          kind: 'write_overlap',
        });
      }
    }
    const holderHotspots = new Set([
      ...holderPaths.filter(isHotspotFile).map(normalizeRelPath),
      ...extractMentionedHotspots(`${work.title} ${work.brief}`),
    ]);
    for (const hotspot of candidateHotspots) {
      if (!holderHotspots.has(hotspot)) continue;
      const key = `hotspot:${work.id}:${hotspot}`;
      const overlapKey = `write_overlap:${work.id}:${hotspot}`;
      if (seen.has(key) || seen.has(overlapKey)) continue;
      seen.add(key);
      conflicts.push({
        path: hotspot,
        holderWorkstreamId: work.id,
        holderTitle: work.title,
        kind: 'hotspot',
      });
    }
  }

  const warnings = conflicts.map(item => (
    item.kind === 'write_overlap'
      ? `Overlapping write path "${item.path}" is currently held by workstream "${item.holderTitle}" (${item.holderWorkstreamId}).`
      : `Shared hotspot file "${item.path}" is also referenced by active workstream "${item.holderTitle}" (${item.holderWorkstreamId}).`
  ));
  return {
    conflicts,
    warnings,
    hasWriteOverlap: conflicts.some(item => item.kind === 'write_overlap'),
  };
}

async function sha256OfFile(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

function extractClaimedEvidencePaths(evidenceLines) {
  const claimed = [];
  for (const line of evidenceLines ?? []) {
    if (typeof line !== 'string') continue;
    for (const match of line.matchAll(/`([^`\r\n]{2,180})`/g)) {
      const token = match[1].trim();
      if (!token || token.includes(' ') || token.startsWith('http://') || token.startsWith('https://')) continue;
      if (!/[\\/]/.test(token) && !/\.[a-z0-9]{1,8}$/i.test(token)) continue;
      if (!claimed.includes(token)) claimed.push(token);
    }
  }
  return claimed.slice(0, 12);
}

async function checkClaimedPath(token, allowedRoots) {
  if (isAbsolute(token)) {
    try {
      const actual = await fs.realpath(resolve(token));
      const allowed = allowedRoots.some(root => within(root, actual));
      if (!allowed) return { kind: 'claimed_path', target: token, ok: false, detail: 'Path resolves outside authorized directories.' };
      const stat = await fs.stat(actual);
      return { kind: 'claimed_path', target: token, ok: stat.isFile() || stat.isDirectory() };
    } catch {
      return { kind: 'claimed_path', target: token, ok: false, detail: 'Claimed path does not exist on disk.' };
    }
  }
  for (const root of allowedRoots) {
    const candidate = resolve(root, token);
    if (!within(root, candidate)) continue;
    try {
      const actual = await fs.realpath(candidate);
      if (!within(root, actual)) continue;
      const stat = await fs.stat(actual);
      if (stat.isFile() || stat.isDirectory()) return { kind: 'claimed_path', target: token, ok: true };
    } catch { /* Try next authorized root. */ }
  }
  return null;
}

function toCommandCheck(event, callsById) {
  if (event?.type !== 'tool/result') return null;
  const callId = event.data?.message?.toolCallId;
  const toolName = callsById.get(callId);
  if (!toolName || !['pwsh', 'bash', 'shell'].includes(toolName)) return null;
  const failed = Boolean(event.data?.error || event.data?.message?.isError);
  return {
    kind: 'command_exit',
    target: `${toolName}:${callId}`,
    ok: !failed,
    ...(failed ? { detail: String(event.data?.error?.message ?? 'Command tool returned an error.') } : {}),
  };
}

function inspectCommandEvents(events) {
  if (!Array.isArray(events) || !events.length) return [];
  const callsById = new Map();
  const checks = [];
  for (const event of events) {
    if (event?.type === 'tool/call' && event.data?.callId) callsById.set(event.data.callId, event.data.name);
    const check = toCommandCheck(event, callsById);
    if (check) checks.push(check);
  }
  return checks.slice(-8);
}

/**
 * Deterministically probe claimed report artifacts, hashes, paths and command results against live state.
 */
export async function probeReportEvidence({ report, worker, project, events }) {
  const checks = [];
  const issues = [];
  const roots = [];
  for (const candidate of [worker?.cwd, project?.storageRoot]) {
    if (!candidate) continue;
    try {
      const actual = await checkedRoot(candidate);
      if (!roots.some(existing => samePath(existing, actual))) roots.push(actual);
    } catch { /* Missing or unreadable optional root is handled per check. */ }
  }

  for (const artifact of report.artifacts ?? []) {
    try {
      const actual = await fs.realpath(resolve(artifact.path));
      const inBounds = roots.some(root => within(root, actual));
      if (!inBounds) {
        checks.push({ kind: 'artifact_exists', target: artifact.path, ok: false, detail: 'Artifact is outside authorized directories.' });
        issues.push(`Artifact "${artifact.path}" is outside authorized directories.`);
        continue;
      }
      const stat = await fs.stat(actual);
      if (!stat.isFile()) {
        checks.push({ kind: 'artifact_exists', target: artifact.path, ok: false, detail: 'Artifact is not a regular file.' });
        issues.push(`Artifact "${artifact.path}" is not a regular file.`);
        continue;
      }
      const digest = await sha256OfFile(actual);
      const hashOk = digest === artifact.sha256;
      checks.push({
        kind: 'artifact_hash',
        target: artifact.path,
        ok: hashOk,
        ...(hashOk ? {} : { detail: `Expected ${artifact.sha256.slice(0, 12)}, got ${digest.slice(0, 12)}.` }),
      });
      if (!hashOk) issues.push(`Artifact "${artifact.path}" hash changed since capture.`);
    } catch (error) {
      checks.push({ kind: 'artifact_exists', target: artifact.path, ok: false, detail: error.message });
      issues.push(`Artifact "${artifact.path}" could not be verified: ${error.message}`);
    }
  }

  for (const token of extractClaimedEvidencePaths(report.evidence)) {
    const result = await checkClaimedPath(token, roots);
    if (!result) continue;
    checks.push(result);
    if (!result.ok) issues.push(`Evidence path "${token}": ${result.detail}`);
  }

  const commandChecks = inspectCommandEvents(events);
  checks.push(...commandChecks);

  return {
    evidenceChecks: checks,
    probeSummary: {
      verified: issues.length === 0,
      checkedAt: Date.now(),
      issues,
    },
  };
}
