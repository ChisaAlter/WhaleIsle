import crypto from 'node:crypto';
import http from 'node:http';
import { INTERNAL_SECRETS_KEY } from '../lib/internal-secret.mjs';

function sameHeader(actual, expected) {
  const left = crypto.createHash('sha256').update(String(actual || ''), 'utf8').digest();
  const right = crypto.createHash('sha256').update(String(expected || ''), 'utf8').digest();
  return crypto.timingSafeEqual(left, right);
}

/** Stub the desktop confirmation loopback channel with an explicit allow for tests. */
export async function allowDesktopConfirm(t) {
  const expectedAuth = 'Bearer acp-test-token';
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/desktop/confirm' && sameHeader(req.headers.authorization, expectedAuth)) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const prevUrl = process.env.DSH_DESKTOP_INSTALL_URL;
  const prevStore = globalThis[INTERNAL_SECRETS_KEY];
  process.env.DSH_DESKTOP_INSTALL_URL = `http://127.0.0.1:${server.address().port}`;
  globalThis[INTERNAL_SECRETS_KEY] = Object.freeze({
    get: (name) => (name === 'DSH_DESKTOP_INSTALL_TOKEN' ? 'acp-test-token' : undefined),
  });
  let disposed = false;
  const dispose = () => new Promise((resolve) => {
    if (disposed) {
      resolve();
      return;
    }
    disposed = true;
    if (prevUrl === undefined) delete process.env.DSH_DESKTOP_INSTALL_URL;
    else process.env.DSH_DESKTOP_INSTALL_URL = prevUrl;
    if (prevStore === undefined) delete globalThis[INTERNAL_SECRETS_KEY];
    else globalThis[INTERNAL_SECRETS_KEY] = prevStore;
    server.close(resolve);
  });
  t?.after?.(dispose);
  return dispose;
}
