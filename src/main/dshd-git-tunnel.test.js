'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { MAX_BODY_BYTES, startGitTunnelServer } = require('./dshd-git-tunnel');

const git = {
  gitStatus: async (cwd) => ({ branch: 'main', cwd }),
};

async function post(url, { token, body, path = '/git' }) {
  return fetch(`${url}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { 'x-dshd-git-token': token } : {}),
    },
    body: typeof body === 'string' ? body : JSON.stringify(body || {}),
  });
}

test('git tunnel answers an allowlisted action only for the minted token', async () => {
  const tunnel = await startGitTunnelServer({ git });
  try {
    const ok = await post(tunnel.url, {
      token: tunnel.token,
      body: { action: 'git-status', cwd: '/repo', payload: {} },
    });
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { ok: true, value: { branch: 'main', cwd: '/repo' } });

    // Same length as the real token but different content.
    const wrongSameLength = await post(tunnel.url, {
      token: '0'.repeat(tunnel.token.length),
      body: { action: 'git-status', cwd: '/repo', payload: {} },
    });
    assert.equal(wrongSameLength.status, 403);
    const wrongLength = await post(tunnel.url, {
      token: 'short',
      body: { action: 'git-status', cwd: '/repo', payload: {} },
    });
    assert.equal(wrongLength.status, 403);
    const missing = await post(tunnel.url, { body: { action: 'git-status', cwd: '/repo' } });
    assert.equal(missing.status, 403);
    const wrongPath = await post(tunnel.url, {
      token: tunnel.token,
      path: '/elsewhere',
      body: { action: 'git-status', cwd: '/repo' },
    });
    assert.equal(wrongPath.status, 404);
  } finally {
    await tunnel.close();
  }
});

test('git tunnel rejects a request body over 1 MiB with 413 and keeps serving', async () => {
  const tunnel = await startGitTunnelServer({ git });
  try {
    const oversized = JSON.stringify({
      action: 'git-status',
      cwd: `/repo/${'x'.repeat(MAX_BODY_BYTES)}`,
    });
    assert.ok(Buffer.byteLength(oversized) > MAX_BODY_BYTES);
    const tooLarge = await post(tunnel.url, { token: tunnel.token, body: oversized });
    assert.equal(tooLarge.status, 413);

    const ok = await post(tunnel.url, {
      token: tunnel.token,
      body: { action: 'git-status', cwd: '/repo', payload: {} },
    });
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).ok, true);
  } finally {
    await tunnel.close();
  }
});
