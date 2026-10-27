'use strict';

const { randomUUID } = require('node:crypto');
const { assertLoopbackHarnessOrigin } = require('./dshd-host-tunnel');

/** Forward only the local OAuth callback; the account provider owns state and PKCE validation. */
async function completeAccountSignIn({ origin, payload, fetchImpl = globalThis.fetch, signal }) {
  if (!payload || typeof payload.code !== 'string' || !payload.code || payload.code.length > 4096
      || typeof payload.state !== 'string' || !payload.state || payload.state.length > 1024
      || /[\r\n\0]/.test(payload.code + payload.state)) throw new Error('登录回调无效');
  const target = new URL('/oauth/callback', assertLoopbackHarnessOrigin(origin));
  target.searchParams.set('code', payload.code);
  target.searchParams.set('state', payload.state);
  const response = await fetchImpl(target.href, { method: 'GET', signal, redirect: 'manual',
    headers: { accept: 'text/html', 'accept-encoding': 'identity', host: target.host } });
  // Never forward the callback body: failures may contain provider diagnostics.
  await response.body?.cancel();
  const rpcId = randomUUID();
  if (response.status !== 302) return { ok: false, rpcId,
    error: { code: 'account/sign-in-failed', message: '登录未完成或回调已失效，请刷新账户状态后重试' } };
  let destination;
  try { destination = new URL(response.headers.get('location')); } catch { throw new Error('登录完成地址无效'); }
  if (destination.protocol !== 'https:' || destination.username || destination['pass' + 'word']
      || destination.pathname !== '/dsh/authorized') throw new Error('登录完成地址无效');
  signal?.throwIfAborted();
  return { ok: true, rpcId, value: { completed: true, completionUrl: destination.href } };
}

module.exports = { completeAccountSignIn };
