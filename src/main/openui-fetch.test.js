const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const { buildSync } = require('esbuild');

function loadInjected(t, { source, entryPoint, fetch }) {
  const outfile = path.join(__dirname, 'openui-fetch-test.generated.cjs');
  const result = buildSync({
    ...(source ? { stdin: { contents: source, resolveDir: __dirname } } : { entryPoints: [entryPoint] }),
    outfile, write: false, bundle: true, platform: 'node', format: 'cjs', target: 'node22',
    inject: [path.join(__dirname, 'openui-fetch.mjs')], external: ['electron'],
  });
  const electronPath = require.resolve('electron');
  const previousElectron = require.cache[electronPath];
  const net = { fetch };
  require.cache[electronPath] = { id: electronPath, filename: electronPath, loaded: true, exports: { net } };
  t.after(() => {
    if (previousElectron) require.cache[electronPath] = previousElectron;
    else delete require.cache[electronPath];
  });
  const injected = new Module(outfile, module);
  injected.filename = outfile;
  injected.paths = module.paths;
  injected._compile(result.outputFiles[0].text, outfile);
  return { exports: injected.exports, net };
}

test('injected OpenUI fetch uses Electron networking with the original request and timeout signal', async (t) => {
  const originalFetch = global.fetch;
  const request = 'https://en.wikipedia.org/w/api.php?action=query';
  const init = { headers: { 'User-Agent': 'open-intelligent-ui' }, signal: AbortSignal.timeout(8000) };
  const response = Response.json({ images: ['https://upload.wikimedia.org/photo.jpg'] }, { status: 206 });
  const pending = Promise.resolve(response);
  let calls = 0;
  const loaded = loadInjected(t, {
    source: 'module.exports = fetch;',
    fetch(input, options) {
      calls++;
      assert.equal(this, loaded.net);
      assert.equal(input, request);
      assert.equal(options, init);
      return pending;
    },
  });
  const actual = loaded.exports(request, init);
  assert.equal(actual, pending);
  assert.equal(await actual, response);
  assert.equal(calls, 1);
  assert.equal(global.fetch, originalFetch);
});

test('OpenUI Electron fetch propagates an abort without retrying or invoking Node fetch', async (t) => {
  const reason = new DOMException('Timed out', 'TimeoutError');
  const signal = AbortSignal.abort(reason);
  let calls = 0;
  const loaded = loadInjected(t, {
    source: 'module.exports = fetch;',
    fetch(_input, init) {
      calls++;
      return Promise.reject(init.signal.reason);
    },
  });
  await assert.rejects(() => loaded.exports('https://en.wikipedia.org/', { signal }), error => error === reason);
  assert.equal(calls, 1);
});

test('actual upstream image-search runs through injected Electron fetch and keeps JSON/cache/errors', async (t) => {
  const originalFetch = global.fetch;
  let calls = 0;
  let failed = false;
  global.fetch = () => { throw new Error('Node global fetch must not handle OpenUI resources'); };
  t.after(() => { global.fetch = originalFetch; });
  const loaded = loadInjected(t, {
    entryPoint: path.join(__dirname, '../../vendor/open-intelligent-ui/src/app/api/image-search/route.ts'),
    fetch: async (input, init) => {
      calls++;
      assert.ok(init.signal instanceof AbortSignal);
      assert.equal(init.headers['User-Agent'], 'open-intelligent-ui (https://github.com/thesysdev/open-intelligent-ui)');
      if (failed) return new Response('', { status: 503 });
      const url = new URL(input);
      return Response.json({ query: { pages: url.hostname === 'en.wikipedia.org'
        ? [{ title: 'Sakura blossom', index: 1, thumbnail: { source: 'https://upload.wikimedia.org/sakura.jpg' } }]
        : [{ imageinfo: [{ mime: 'image/jpeg', thumburl: 'https://upload.wikimedia.org/blossom.jpg' }] }] } });
    },
  });
  const request = query => new Request(`https://openui.local/api/image-search?q=${encodeURIComponent(query)}`);
  assert.equal((await loaded.exports.GET(request('a'))).status, 400);
  assert.equal(calls, 0);
  const result = await loaded.exports.GET(request('Sakura blossom'));
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { images: ['https://upload.wikimedia.org/sakura.jpg', 'https://upload.wikimedia.org/blossom.jpg'] });
  const cachedCalls = calls;
  assert.equal((await loaded.exports.GET(request('Sakura blossom'))).status, 200);
  assert.equal(calls, cachedCalls);
  failed = true;
  const failure = await loaded.exports.GET(request('Retry blossom'));
  assert.equal(failure.status, 502);
  assert.deepEqual(await failure.json(), { error: { message: 'Image search unavailable' } });
  assert.equal(calls, cachedCalls + 1);
  assert.equal((await loaded.exports.GET(request('Retry blossom'))).status, 502);
  assert.equal(calls, cachedCalls + 2);
});
