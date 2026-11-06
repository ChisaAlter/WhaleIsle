'use strict';

const GITHUB_API = 'https://api.github.com';

function normalizeIssue(issue) {
  return {
    id: `github:${issue.id ?? issue.number ?? issue.url}`,
    title: issue.title ?? 'Untitled GitHub item',
    description: issue.body ?? '',
    source: 'github',
    sourceUrl: issue.html_url ?? issue.url ?? null,
    kind: issue.pull_request ? 'pull_request' : 'issue',
    labels: Array.isArray(issue.labels) ? issue.labels.map(label => typeof label === 'string' ? label : label.name).filter(Boolean) : [],
    updatedAt: issue.updated_at ?? issue.updatedAt ?? null,
  };
}

async function discoverGitHubItems({ listIssues, listPulls, since = null } = {}) {
  if (typeof listIssues !== 'function' || typeof listPulls !== 'function') throw new TypeError('GitHub source needs issue and pull request readers');
  const [issues, pulls] = await Promise.all([listIssues({ since }), listPulls({ since })]);
  const seen = new Set();
  return [...(issues ?? []), ...(pulls ?? [])]
    .map(normalizeIssue)
    .filter(item => !seen.has(item.id) && seen.add(item.id))
    .sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')));
}

/**
 * Build the read-only adapter used by the proactive source service. The
 * readers are injected so the service can use a connector (or deterministic
 * test doubles) without giving this module any write capability.
 */
function createGitHubSourceAdapter({ listIssues, listPulls } = {}) {
  if (typeof listIssues !== 'function' || typeof listPulls !== 'function') {
    throw new TypeError('GitHub source needs issue and pull request readers');
  }
  return {
    name: 'github',
    discover: ({ since = null, cursor = undefined } = {}) => discoverGitHubItems({
      listIssues,
      listPulls,
      since: cursor === undefined ? since : cursor,
    }),
  };
}

/**
 * Create a concrete REST-backed read-only adapter. It only performs GETs for
 * open Issues and Pull Requests; writes are intentionally not exposed.
 */
function createGitHubApiSource({
  repository,
  tokenProvider = () => '',
  fetchImpl = globalThis.fetch,
  apiBase = GITHUB_API,
} = {}) {
  if (typeof repository !== 'string' || !/^[^/]+\/[^/]+$/.test(repository)) {
    throw new TypeError('GitHub source needs repository in owner/name form');
  }
  if (typeof fetchImpl !== 'function') throw new TypeError('GitHub source needs fetch');
  const [owner, repo] = repository.split('/');
  const base = String(apiBase).replace(/\/$/, '');

  async function readCollection(kind, { since = null, cursor = undefined } = {}) {
    const effectiveSince = cursor === undefined ? since : cursor;
    const url = new URL(`${base}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${kind}`);
    url.searchParams.set('state', 'open');
    url.searchParams.set('per_page', '100');
    if (effectiveSince !== null && effectiveSince !== undefined && String(effectiveSince).trim()) {
      url.searchParams.set('since', String(effectiveSince));
    }
    const token = typeof tokenProvider === 'function' ? String(tokenProvider() || '').trim() : '';
    const headers = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'WhaleIsle-ProactiveSource',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetchImpl(url.toString(), { method: 'GET', headers });
    if (!response || !response.ok) {
      const status = response && Number.isFinite(response.status) ? `HTTP ${response.status}` : 'network error';
      throw Object.assign(new Error(`GitHub ${kind} read failed: ${status}`), {
        code: 'proactive/source-read-failed',
      });
    }
    const payload = await response.json();
    if (!Array.isArray(payload)) {
      throw Object.assign(new Error(`GitHub ${kind} response was not a list`), {
        code: 'proactive/source-invalid-response',
      });
    }
    return payload;
  }

  return createGitHubSourceAdapter({
    listIssues: options => readCollection('issues', options),
    listPulls: options => readCollection('pulls', options),
  });
}

module.exports = {
  createGitHubApiSource,
  createGitHubSourceAdapter,
  discoverGitHubItems,
  normalizeIssue,
};
