'use strict';

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

module.exports = { discoverGitHubItems, normalizeIssue };
