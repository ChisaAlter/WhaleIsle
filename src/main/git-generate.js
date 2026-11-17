/**
 * Commit / PR text: DeepSeek chat when an API key is configured, otherwise a
 * staged name-status heuristic. "Generating…" shows only while this
 * step runs against staged summary + patch.
 */

const { isCleartextBaseUrl } = require('../shared/cleartext-base-url');

const DEFAULT_SUBJECT = 'Update project files';

let textGenerator = null;
let credentialsOverride = null;

/** Test seam: replace the network/heuristic generator. */
function setTextGenerator(generator) {
  textGenerator = generator;
}

/** Test seam: pin API credentials without reading desktop config. */
function setApiCredentials(credentials) {
  credentialsOverride = credentials;
}

/**
 * One-line sanitized subject/title: first line, no trailing period, capped at
 * 72 chars, `DEFAULT_SUBJECT` when empty.
 */
function sanitizeGeneratedLine(value) {
  const raw = String(value || '').trim().split(/\r?\n/g)[0]?.trim() ?? '';
  const line = raw.replace(/[.]+$/g, '').trim();
  return line.length > 0 ? line.slice(0, 72).trimEnd() : DEFAULT_SUBJECT;
}

function sanitizeCommitMessage(generated) {
  const branch = typeof generated?.branch === 'string' ? generated.branch.trim() : '';
  return {
    subject: sanitizeGeneratedLine(generated?.subject),
    body: String(generated?.body || '').trim(),
    ...(branch ? { branch } : {}),
  };
}

function sanitizePrContent(generated, fallbackTitle) {
  return {
    title: sanitizeGeneratedLine(generated?.title || fallbackTitle),
    body: String(generated?.body || '').trim(),
  };
}

function parseNameStatusLine(line) {
  const trimmed = String(line || '').trim();
  if (!trimmed) return null;
  const tab = trimmed.indexOf('\t');
  if (tab < 0) return { status: 'M', path: trimmed };
  const status = trimmed.slice(0, tab).trim();
  const rest = trimmed.slice(tab + 1);
  const parts = rest.split('\t');
  const path = parts[parts.length - 1] || rest;
  return { status, path };
}

function verbForStatus(status) {
  if (status === 'A' || status.startsWith('A')) return 'Add';
  if (status === 'D' || status.startsWith('D')) return 'Remove';
  if (status.startsWith('R')) return 'Rename';
  return 'Update';
}

/**
 * Deterministic subject/body from `git diff --cached --name-status`.
 * @param {string} stagedSummary
 * @returns {{ subject: string, body: string }}
 */
function fallbackFromStaged(stagedSummary) {
  const rows = String(stagedSummary || '')
    .split(/\r?\n/)
    .map((line) => parseNameStatusLine(line))
    .filter(Boolean);
  if (rows.length === 0) return sanitizeCommitMessage({ subject: DEFAULT_SUBJECT, body: '' });
  const first = rows[0];
  const verb = verbForStatus(first.status);
  const subject = rows.length === 1
    ? `${verb} ${first.path}`
    : `${verb} ${first.path} and ${rows.length - 1} other files`;
  const body = rows.map((row) => `${row.status}\t${row.path}`).join('\n');
  return sanitizeCommitMessage({ subject, body });
}

function parseGeneratedJson(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : raw;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

function readApiCredentials() {
  if (credentialsOverride) return credentialsOverride;
  try {
    const { loadConfig } = require('./config');
    const config = loadConfig();
    return {
      apiKey: typeof config.apiKey === 'string' ? config.apiKey : '',
      baseUrl: typeof config.baseUrl === 'string' ? config.baseUrl : '',
    };
  } catch {
    return { apiKey: '', baseUrl: '' };
  }
}

function completionUrl(baseUrl) {
  const root = String(baseUrl || 'https://api.deepseek.com').replace(/\/$/, '');
  return root.endsWith('/v1') ? `${root}/chat/completions` : `${root}/v1/chat/completions`;
}

async function requestJsonCompletion({ system, user }) {
  const { apiKey, baseUrl } = readApiCredentials();
  if (!apiKey) return null;
  // Bearer over off-host http is a credential leak; loopback gateways are
  // allowed (nothing leaves the machine). Fail closed to the heuristic.
  if (isCleartextBaseUrl(baseUrl)) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45_000);
  try {
    const response = await fetch(completionUrl(baseUrl), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        temperature: 0.2,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const payload = await response.json();
    const text = payload?.choices?.[0]?.message?.content;
    return parseGeneratedJson(text);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function limitContext(value, maxChars) {
  const text = String(value || '');
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n[truncated]`;
}

function heuristicPrContent(input) {
  const firstCommit = String(input.commitSummary || '').split(/\r?\n/).find((line) => line.trim());
  const title = firstCommit ? firstCommit.replace(/^[0-9a-f]{7,}\s+/i, '') : input.fallbackTitle;
  return { ...sanitizePrContent({ title, body: String(input.commitSummary || '').trim() }, input.fallbackTitle), source: 'heuristic' };
}

/**
 * Shared generator seams: an injected `textGenerator` wins, then the configured
 * API key (which fail-closes on an unusable model response). Returns null only
 * when neither seam applies, so the caller falls through to its own heuristic.
 */
async function runGenerationSeams({ kind, input, hasText, sanitize, failureMessage, system, user }) {
  if (typeof textGenerator === 'function') {
    const generated = await textGenerator({ kind, ...input });
    if (generated?.error) return { error: String(generated.error) };
    return { ...sanitize(generated), source: generated?.source || 'model' };
  }
  if (!readApiCredentials().apiKey) return null;
  const generated = await requestJsonCompletion({ system, user });
  if (!generated || !hasText(generated)) return { error: failureMessage };
  return { ...sanitize(generated), source: 'model' };
}

/**
 * Produce a commit subject/body from staged context.
 * A configured API key fail-closes; without a key the staged heuristic is the generator.
 * @param {{ stagedSummary: string, stagedPatch: string, includeBranch?: boolean, recentSubjects?: string }} input
 * @returns {Promise<{ subject: string, body: string, branch?: string, source?: string, error?: string }>}
 */
async function generateCommitMessage(input) {
  const stagedSummary = String(input?.stagedSummary || '');
  const stagedPatch = limitContext(input?.stagedPatch || '', 50_000);
  const branchHint = input.includeBranch
    ? ' Also include "branch":"feature/short-kebab-name".'
    : '';
  const viaSeams = await runGenerationSeams({
    kind: 'commit',
    input,
    hasText: (generated) => Boolean(generated.subject || generated.body),
    sanitize: sanitizeCommitMessage,
    system: `You write git commit messages. Reply with JSON only: {"subject":"...","body":"..."${input.includeBranch ? ',"branch":"feature/..."' : ''}}. Subject is imperative, <=72 chars, no trailing period. Body may be empty.${branchHint}`,
    user: `${input.recentSubjects ? `Recent commit subjects:\n${limitContext(input.recentSubjects, 2_000)}\n\n` : ''}Staged name-status:\n${limitContext(stagedSummary, 8_000)}\n\nStaged patch:\n${stagedPatch}`,
    failureMessage: 'Commit message generation failed.',
  });
  if (viaSeams) return viaSeams;
  return { ...fallbackFromStaged(stagedSummary), source: 'heuristic' };
}

/**
 * Produce a change-request title/body from the branch range.
 * @param {{ commitSummary: string, diffSummary: string, diffPatch: string, fallbackTitle: string, changeRequestTemplate?: string }} input
 * @returns {Promise<{ title: string, body: string, source?: string, error?: string }>}
 */
async function generatePrContent(input) {
  const viaSeams = await runGenerationSeams({
    kind: 'pr',
    input,
    hasText: (generated) => Boolean(generated.title || generated.body),
    sanitize: (generated) => sanitizePrContent(generated, input.fallbackTitle),
    system: 'You write pull request copy. Reply with JSON only: {"title":"...","body":"..."}. Title is imperative, <=72 chars. Body is markdown.',
    user: `${input.changeRequestTemplate ? `Follow this pull request template:\n${limitContext(input.changeRequestTemplate, 8_000)}\n\n` : ''}Commits:\n${limitContext(input.commitSummary, 20_000)}\n\nDiff stat:\n${limitContext(input.diffSummary, 20_000)}\n\nPatch:\n${limitContext(input.diffPatch, 60_000)}`,
    failureMessage: 'Pull request content generation failed.',
  });
  if (viaSeams) return viaSeams;
  return heuristicPrContent(input);
}

module.exports = {
  fallbackFromStaged,
  generateCommitMessage,
  generatePrContent,
  parseGeneratedJson,
  sanitizeCommitMessage,
  sanitizeGeneratedLine,
  sanitizePrContent,
  setApiCredentials,
  setTextGenerator,
};
