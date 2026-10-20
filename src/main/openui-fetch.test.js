const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const { buildSync } = require('esbuild');

function loadResource(t, fetch) {
  const outfile = path.join(__dirname, 'whale-ui-resource-test.generated.cjs');
  const result = buildSync({
    entryPoints: [path.join(__dirname, '../whale-ui/resources/route.mjs')],
    outfile, write: false, bundle: true, platform: 'node', format: 'cjs', target: 'node22',
    external: ['electron'], define: { __WHALE_RESOURCE_OPERATION__: '"image-search"' },
  });
  const electronPath = require.resolve('electron');
  const previousElectron = require.cache[electronPath];
  const net = { fetch };
  require.cache[electronPath] = { id: electronPath, filename: electronPath, loaded: true, exports: { net } };
  t.after(() => {
    if (previousElectron) require.cache[electronPath] = previousElectron;
    else delete require.cache[electronPath];
  });
  const loaded = new Module(outfile, module);
  loaded.filename = outfile;
  loaded.paths = module.paths;
  loaded._compile(result.outputFiles[0].text, outfile);
  return loaded.exports;
}
const request = query => new Request(`https://whale-ui.local/api/image-search?q=${encodeURIComponent(query)}`);

test('owned image-search uses Electron networking and retains JSON, successful cache and visible errors', async (t) => {
  const originalFetch = global.fetch;
  let calls = 0;
  let failed = false;
  global.fetch = () => { throw new Error('Node global fetch must not handle Whale UI resources'); };
  t.after(() => { global.fetch = originalFetch; });
  const route = loadResource(t, async (input, init) => {
    calls++;
    assert.ok(init.signal instanceof AbortSignal);
    assert.match(init.headers['User-Agent'], /^WhaleIsle\/WhaleUI/);
    if (failed) return new Response('', { status: 503 });
    const url = new URL(input);
    assert.ok(['en.wikipedia.org', 'commons.wikimedia.org'].includes(url.hostname));
    return Response.json({ query: { pages: url.hostname === 'en.wikipedia.org'
      ? [{ title: 'Sakura blossom', index: 1, thumbnail: { source: 'https://upload.wikimedia.org/sakura.jpg' } }]
      : [{ imageinfo: [{ mime: 'image/jpeg', thumburl: 'https://upload.wikimedia.org/blossom.jpg' }] }] } });
  });
  assert.equal((await route.GET(request('a'))).status, 400);
  assert.equal(calls, 0);
  const result = await route.GET(request('Sakura blossom'));
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { images: ['https://upload.wikimedia.org/sakura.jpg', 'https://upload.wikimedia.org/blossom.jpg'] });
  const cachedCalls = calls;
  assert.equal((await route.GET(request('Sakura blossom'))).status, 200);
  assert.equal(calls, cachedCalls);
  failed = true;
  const failure = await route.GET(request('Retry blossom'));
  assert.equal(failure.status, 502);
  assert.deepEqual(await failure.json(), { error: { message: 'Resource service returned 503.' } });
  assert.equal(calls, cachedCalls + 1);
  assert.equal((await route.GET(request('Retry blossom'))).status, 502);
  assert.equal(calls, cachedCalls + 2);
  assert.notEqual(global.fetch, originalFetch);
});

test('resource timeout reaches the caller without retries or caching a failed search', async (t) => {
  let calls = 0;
  const route = loadResource(t, async (_input, init) => {
    calls++;
    assert.ok(init.signal instanceof AbortSignal);
    throw new DOMException('Timed out', 'TimeoutError');
  });
  for (const expectedCalls of [1, 2]) {
    const response = await route.GET(request('Timeout blossom'));
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: { message: 'Timed out' } });
    assert.equal(calls, expectedCalls);
  }
});
