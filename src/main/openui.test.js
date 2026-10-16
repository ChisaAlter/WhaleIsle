const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

function loadOpenui(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-openui-'));
  fs.mkdirSync(path.join(root, 'openui/api'), { recursive: true });
  fs.writeFileSync(path.join(root, 'openui/viewer.html'), '<!doctype html><title>Trusted local viewer</title>');
  // The generated route contract is GET(Request) -> JSON Response. A module-
  // local cache makes reloading the handler observable without network calls.
  const routeSource = `
    const cache = new Map();
    let requests = 0;
    exports.GET = async (req) => {
      let body = cache.get(req.url);
      if (!body) {
        body = { url: req.url, method: req.method, request: ++requests };
        cache.set(req.url, body);
      }
      return Response.json(body, { status: 207 });
    };
  `;
  for (const name of ['wiki', 'image-search', 'street-route']) {
    fs.writeFileSync(path.join(root, `openui/api/${name}.cjs`), routeSource);
  }
  const pathsPath = require.resolve('./paths');
  const openuiPath = require.resolve('./openui');
  const previousPaths = require.cache[pathsPath];
  const previousOpenui = require.cache[openuiPath];
  require.cache[pathsPath] = {
    id: pathsPath, filename: pathsPath, loaded: true,
    exports: { rendererFile: (name) => path.join(root, name) },
  };
  delete require.cache[openuiPath];
  t.after(() => {
    if (previousPaths) require.cache[pathsPath] = previousPaths;
    else delete require.cache[pathsPath];
    if (previousOpenui) require.cache[openuiPath] = previousOpenui;
    else delete require.cache[openuiPath];
    for (const name of ['wiki', 'image-search', 'street-route']) {
      delete require.cache[path.join(root, `openui/api/${name}.cjs`)];
    }
    fs.rmSync(root, { recursive: true, force: true });
  });
  return require('./openui');
}

test('OpenUI viewer reads only the fixed local HTML artifact', async (t) => {
  const { openuiViewer } = loadOpenui(t);
  assert.equal(await openuiViewer('../../private.html'), '<!doctype html><title>Trusted local viewer</title>');
});

test('OpenUI API dispatches the three fixed GET handlers with encoded query values', async (t) => {
  const { openuiApi } = loadOpenui(t);
  const query = { q: 'a & b? # 🌊', title: 'https://private.example/#fragment', coords: '1,2;3,4' };
  for (const route of ['/api/wiki', '/api/image-search', '/api/street-route']) {
    const result = await openuiApi({ path: route, query });
    assert.equal(result.status, 207);
    assert.equal(result.body.method, 'GET');
    const url = new URL(result.body.url);
    assert.equal(url.origin, 'https://openui.local');
    assert.equal(url.pathname, route);
    assert.equal(url.hash, '');
    assert.deepEqual(Object.fromEntries(url.searchParams), query);
  }
});

test('OpenUI API preserves JSON status/body and module-local cache across calls', async (t) => {
  const { openuiApi } = loadOpenui(t);
  const first = await openuiApi({ path: '/api/wiki', query: { title: 'Kyoto' } });
  assert.deepEqual(await openuiApi({ path: '/api/wiki', query: { title: 'Kyoto' } }), first);
  assert.equal((await openuiApi({ path: '/api/wiki', query: { title: 'Tokyo' } })).body.request, 2);
  assert.equal((await openuiApi({ path: '/api/image-search', query: { q: 'Kyoto' } })).body.request, 1);
});

test('OpenUI API rejects arbitrary paths and non-string query values before dispatch', async (t) => {
  const { openuiApi } = loadOpenui(t);
  for (const input of [undefined, null, [], 'wiki',
    ...['https://private.example/api/wiki', '//private.example/api/wiki', '/api/wiki?title=Kyoto',
      '/api/../wiki', '/api/WIKI', '/api/unknown'].map((route) => ({ path: route, query: {} })),
    ...[undefined, null, [], 'title=Kyoto', new Date(), new Map([['title', 'Kyoto']]),
      new URLSearchParams({ title: 'Kyoto' }), { title: 1 }, { title: true }, { title: null },
      { title: ['Kyoto'] }, { title: {} }].map((query) => ({ path: '/api/wiki', query }))]) {
    await assert.rejects(() => openuiApi(input), /Invalid OpenUI API request/);
  }
  assert.equal((await openuiApi({ path: '/api/wiki', query: {} })).body.request, 1);
});
