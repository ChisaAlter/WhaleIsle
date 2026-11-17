import test from 'node:test';
import assert from 'node:assert/strict';
import { SshPool } from './pool.js';

test('a credential-store failure rejects before attempting SSH and keeps the prompt actionable', async () => {
  const pool = new SshPool({ host: '127.0.0.1', port: 1, username: 'synthetic', hostKeyMode: 'verify' });
  pool.passwordResolver = async () => { throw new Error('SECRET keychain diagnostic'); };
  await assert.rejects(pool.connect(), error => {
    assert.match(error.message, /解锁系统密钥库/);
    assert.doesNotMatch(error.message, /SECRET|ECONNREFUSED/);
    return true;
  });
  assert.equal(pool.connecting, null);
  assert.equal(pool.client, null);
  pool.close();
});
