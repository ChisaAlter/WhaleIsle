'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createGitHubApiSource, createGitHubSourceAdapter, discoverGitHubItems, normalizeIssue } = require('./github-source');

test('normalizes GitHub issues and pull requests into task candidates', () => {
  assert.deepEqual(normalizeIssue({ id: 7, title: 'Fix login', body: 'Investigate', labels: [{ name: 'bug' }], html_url: 'https://github.com/x/y/issues/7' }), {
    id: 'github:7', title: 'Fix login', description: 'Investigate', source: 'github',
    sourceUrl: 'https://github.com/x/y/issues/7', kind: 'issue', labels: ['bug'], updatedAt: null,
  });
});

test('discovers, deduplicates and sorts source items', async () => {
  const result = await discoverGitHubItems({
    listIssues: async () => [{ id: 1, title: 'Old', updated_at: '2026-01-01' }],
    listPulls: async () => [{ id: 2, title: 'New', updated_at: '2026-02-01' }, { id: 1, title: 'Duplicate' }],
  });
  assert.deepEqual(result.map(item => item.id), ['github:2', 'github:1']);
});

test('read-only adapter forwards the cursor to both GitHub collections', async () => {
  const calls = [];
  const adapter = createGitHubSourceAdapter({
    listIssues: async options => { calls.push(['issues', options]); return []; },
    listPulls: async options => { calls.push(['pulls', options]); return []; },
  });

  assert.deepEqual(await adapter.discover({ since: '2026-11-05T00:00:00Z' }), []);
  assert.deepEqual(calls, [
    ['issues', { since: '2026-11-05T00:00:00Z' }],
    ['pulls', { since: '2026-11-05T00:00:00Z' }],
  ]);
});

test('REST adapter only performs read requests for open issues and pull requests', async () => {
  const calls = [];
  const adapter = createGitHubApiSource({
    repository: 'ChisaAlter/WhaleIsle',
    tokenProvider: () => 'ghp_test',
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      return { ok: true, status: 200, json: async () => [] };
    },
  });

  await adapter.discover({ since: '2026-11-05T00:00:00Z' });
  assert.equal(calls.length, 2);
  assert.ok(calls.every(call => call.options.method === 'GET'));
  assert.ok(calls.every(call => call.options.headers.Authorization === 'Bearer ghp_test'));
  assert.ok(calls.every(call => call.url.includes('state=open')));
  assert.ok(calls.some(call => call.url.includes('/issues?')));
  assert.ok(calls.some(call => call.url.includes('/pulls?')));
});
