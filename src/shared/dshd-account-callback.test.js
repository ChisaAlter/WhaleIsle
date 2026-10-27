'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { forwardHostRpc, isAllowedHostMethod, hostRpcPayload } = require('./dshd-host-tunnel');

const complete = (fetchImpl, payload = { code: 'qa-code', state: 'qa-state' }, origin = 'http://127.0.0.1:53876') =>
  forwardHostRpc({ origin, method: 'account.completeSignIn', payload: { args: payload }, fetchImpl });

test('native OAuth callback reaches only the configured Host and retains provider validation', async () => {
  const result = await complete(async (url, options) => {
    assert.equal(url, 'http://127.0.0.1:53876/oauth/callback?code=qa-code&state=qa-state');
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'manual');
    assert.equal(options.headers.host, '127.0.0.1:53876');
    assert.equal(options.headers.Cookie, undefined);
    return new Response(null, { status: 302, headers: { location: 'https://platform.example/dsh/authorized?login_source=web' } });
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, { completed: true, completionUrl: 'https://platform.example/dsh/authorized?login_source=web' });
});

test('expired invalid and failed callbacks never report success or return provider bodies', async () => {
  for (const status of [200, 204, 400, 410, 500]) {
    const response = status === 204 ? new Response(null, { status }) : new Response('private-provider-diagnostics', { status });
    const result = await complete(async () => response);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'account/sign-in-failed');
    assert.ok(!JSON.stringify(result).includes('private-provider-diagnostics'));
  }
});

test('callback input and completion destination cannot redirect arbitrary host requests', async () => {
  const unexpected = () => { throw new Error('unexpected request'); };
  for (const payload of [{ code: '', state: 's' }, { code: 'x', state: '' }, { code: 'x'.repeat(4097), state: 's' },
    { code: 'x', state: 'bad\r\nvalue' }]) await assert.rejects(complete(unexpected, payload), /无效/);
  await assert.rejects(complete(unexpected, { code: 'x', state: 's' }, 'https://unrelated.example'), /loopback/);
  for (const location of ['http://platform.example/dsh/authorized', 'https://platform.example/other', 'not-a-url']) {
    await assert.rejects(complete(async () => new Response(null, { status: 302, headers: { location } })), /地址无效/);
  }
});

test('Android settings APIs retain exact Typert argument names and deny raw secret reads', () => {
  for (const method of ['workspaceFiles.list', 'workspaceFiles.read', 'workspaceFiles.stat', 'mcpServers.list',
    'skillInventory.get', 'pluginInventory.list', 'pluginManager.setPluginEnabled', 'credentials.describe',
    'credentials.set', 'credentials.unset', 'settings.describe', 'settings.update', 'settings.replace',
    'settings.mutate', 'account.getProfile', 'account.startSignIn']) assert.equal(isAllowedHostMethod(method), true, method);
  for (const method of ['credentials.readRecord', 'credentials.read', 'credentials.get', 'host.pickDirectory',
    'host.openPath', 'terminal.create', 'workspaceFiles.write', 'loader.unload']) assert.equal(isAllowedHostMethod(method), false, method);
  assert.deepEqual(hostRpcPayload('workspaceFiles.read', { workspaceFileScopeId: 's', path: 'x', range: { offset: 1, limit: 200 } }),
    { args: { workspaceFileScopeId: 's', path: 'x', range: { offset: 1, limit: 200 } } });
  assert.deepEqual(hostRpcPayload('mcpServers.setEnabled', { id: 'qa', enabled: false }), { args: { request: { id: 'qa', enabled: false } } });
  assert.deepEqual(hostRpcPayload('skillInventory.get', { name: 'qa', cwd: '/qa' }), { args: { request: { name: 'qa', cwd: '/qa' } } });
  assert.deepEqual(hostRpcPayload('settings.update', { ns: 'test', patch: { enabled: true }, expectedRevision: 7 }),
    { args: { ns: 'test', patch: { enabled: true }, expectedRevision: 7 } });
  assert.deepEqual(hostRpcPayload('credentials.set', { ref: 'QA_KEY', value: 'qa' }), { args: { ref: 'QA_KEY', value: 'qa' } });
});
