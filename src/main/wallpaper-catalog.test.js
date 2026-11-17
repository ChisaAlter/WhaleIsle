const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const {
  assertResolvedWallpaperHost,
  bingCatalogUrls,
  downloadWallpaper,
  fetchBuffer,
  fetchFailureDetail,
  isBlockedWallpaperHost,
  listWallpaperCatalog,
  parseCatalogJson,
} = require('./wallpaper-catalog');

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise((resolve) => { server.close(() => resolve()); });
}

async function withHttp(handler, run) {
  const previous = process.env.DSHD_WALLPAPER_ALLOW_HTTP;
  process.env.DSHD_WALLPAPER_ALLOW_HTTP = '1';
  const server = http.createServer(handler);
  const port = await listen(server);
  try {
    return await run(`http://127.0.0.1:${port}`);
  } finally {
    await close(server);
    if (previous === undefined) delete process.env.DSHD_WALLPAPER_ALLOW_HTTP;
    else process.env.DSHD_WALLPAPER_ALLOW_HTTP = previous;
  }
}

test('parseCatalogJson maps Bing images and skips wp:false', () => {
  const parsed = parseCatalogJson({
    images: [
      {
        urlbase: '/th?id=OHR.Palmanova_ZH-CN1',
        copyright: '意大利帕尔马诺瓦 (© Example)',
        title: '星形城市',
        hsh: 'abc',
        wp: true,
      },
      {
        urlbase: '/th?id=OHR.SkipMe',
        copyright: 'skip',
        title: 'not wallpaper',
        hsh: 'def',
        wp: false,
      },
    ],
  }, 'https://cn.bing.com/HPImageArchive.aspx?format=js');
  assert.equal(parsed.error, undefined);
  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.items[0].id, 'abc');
  assert.equal(parsed.items[0].title, '星形城市');
  assert.equal(parsed.items[0].copyright, '意大利帕尔马诺瓦 (© Example)');
  assert.equal(
    parsed.items[0].imageUrl,
    'https://cn.bing.com/th?id=OHR.Palmanova_ZH-CN1_1920x1080.jpg',
  );
  assert.equal(
    parsed.items[0].thumbUrl,
    'https://cn.bing.com/th?id=OHR.Palmanova_ZH-CN1_400x240.jpg',
  );
});

test('parseCatalogJson maps a native items catalog', () => {
  const parsed = parseCatalogJson({
    version: 1,
    name: 'My pack',
    items: [
      {
        id: 'lake',
        title: 'Lake',
        thumbUrl: 'https://example.com/lake-thumb.jpg',
        imageUrl: 'https://example.com/lake.jpg',
        copyright: 'CC0',
      },
      { id: 'bad', title: 'Bad', thumbUrl: 'javascript:alert(1)', imageUrl: 'https://example.com/x.jpg' },
      {
        id: 'named',
        title: 'Named',
        thumbUrl: 'https://example.com/n-thumb.jpg',
        imageUrl: 'https://example.com/n.jpg',
        source: 'my-pack',
      },
    ],
  }, 'https://example.com/pack.json');
  assert.equal(parsed.items.length, 2);
  assert.deepEqual(parsed.items[0], {
    id: 'lake',
    title: 'Lake',
    copyright: 'CC0',
    thumbUrl: 'https://example.com/lake-thumb.jpg',
    imageUrl: 'https://example.com/lake.jpg',
    source: 'https://example.com/pack.json',
  });
  assert.equal(parsed.items[1].id, 'named');
  assert.equal(parsed.items[1].source, 'my-pack');
});

test('parseCatalogJson keeps 500 native items and drops the rest', () => {
  const items = Array.from({ length: 501 }, (_, i) => ({
    id: `id-${i}`,
    title: `T${i}`,
    thumbUrl: 'https://example.com/t.jpg',
    imageUrl: 'https://example.com/i.jpg',
  }));
  const parsed = parseCatalogJson({ version: 1, items }, 'https://example.com/pack.json');
  assert.equal(parsed.items.length, 500);
  assert.equal(parsed.items[0].id, 'id-0');
  assert.equal(parsed.items[499].id, 'id-499');
});

test('parseCatalogJson rejects JSON that is neither Bing nor a native catalog', () => {
  const parsed = parseCatalogJson({ plugins: [] }, 'https://example.com/x.json');
  assert.equal(parsed.items.length, 0);
  assert.equal(typeof parsed.error, 'string');
  assert.match(parsed.error, /壁纸目录/);
});

test('listWallpaperCatalog fetches Bing from DSHD_BING_WALLPAPER_URL when HTTP is allowed', async () => {
  const previousBing = process.env.DSHD_BING_WALLPAPER_URL;
  await withHttp((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      images: [{
        urlbase: '/th?id=OHR.Test',
        title: 'Fixture',
        copyright: '© Test',
        hsh: 'fix1',
        wp: true,
      }],
    }));
  }, async (origin) => {
    process.env.DSHD_BING_WALLPAPER_URL = `${origin}/bing.json`;
    const result = await listWallpaperCatalog({ kind: 'bing' });
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].id, 'fix1');
    assert.equal(result.items[0].source, 'bing');
    assert.equal(result.items[0].imageUrl, `${origin}/th?id=OHR.Test_1920x1080.jpg`);
    assert.equal(result.warning, undefined);
  });
  if (previousBing === undefined) delete process.env.DSHD_BING_WALLPAPER_URL;
  else process.env.DSHD_BING_WALLPAPER_URL = previousBing;
});

test('listWallpaperCatalog catalog kind reports a failed catalog without throwing', async () => {
  await withHttp((req, res) => {
    if (req.url === '/good.json') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        version: 1,
        items: [{
          id: 'ok',
          title: 'Ok',
          thumbUrl: 'https://example.com/t.jpg',
          imageUrl: 'https://example.com/i.jpg',
        }],
      }));
      return;
    }
    res.statusCode = 500;
    res.end('nope');
  }, async (origin) => {
    const failed = await listWallpaperCatalog({
      kind: 'catalog',
      url: `${origin}/missing.json`,
    });
    assert.equal(failed.items.length, 0);
    assert.match(failed.warning, /missing\.json|壁纸目录/);

    const result = await listWallpaperCatalog({
      kind: 'catalog',
      url: `${origin}/good.json`,
    });
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].id, 'ok');
    assert.equal(result.items[0].source, `${origin}/good.json`);
    assert.equal(result.warning, undefined);
  });
});

test('listWallpaperCatalog rejects file URLs and http when HTTP is not allowed', async () => {
  delete process.env.DSHD_WALLPAPER_ALLOW_HTTP;
  const fileResult = await listWallpaperCatalog({
    kind: 'catalog',
    url: 'file:///C:/secret.json',
  });
  assert.equal(fileResult.items.length, 0);
  assert.match(fileResult.warning, /file:|壁纸目录/);

  const httpResult = await listWallpaperCatalog({
    kind: 'catalog',
    url: 'http://127.0.0.1:1/x.json',
  });
  assert.equal(httpResult.items.length, 0);
  assert.match(httpResult.warning, /https|壁纸目录/);
});

test('listWallpaperCatalog does not fetch private or link-local HTTPS hosts', async () => {
  delete process.env.DSHD_WALLPAPER_ALLOW_HTTP;
  for (const url of [
    'https://127.0.0.1/secret.json',
    'https://10.0.0.8/secret.json',
    'https://192.168.1.8/secret.json',
    'https://169.254.169.254/latest.json',
    'https://localhost/secret.json',
  ]) {
    const result = await listWallpaperCatalog({ kind: 'catalog', url });
    assert.equal(result.items.length, 0, url);
    assert.match(result.warning, /壁纸目录/, url);
  }
});

test('isBlockedWallpaperHost blocks CGNAT and benchmark ranges but keeps neighbours public', () => {
  delete process.env.DSHD_WALLPAPER_ALLOW_HTTP;
  // 100.64.0.0/10 (carrier-grade NAT)
  assert.equal(isBlockedWallpaperHost('100.64.0.0'), true);
  assert.equal(isBlockedWallpaperHost('100.100.50.1'), true);
  assert.equal(isBlockedWallpaperHost('100.127.255.255'), true);
  assert.equal(isBlockedWallpaperHost('100.63.255.255'), false);
  assert.equal(isBlockedWallpaperHost('100.128.0.0'), false);
  // 198.18.0.0/15 (benchmarking)
  assert.equal(isBlockedWallpaperHost('198.18.0.1'), true);
  assert.equal(isBlockedWallpaperHost('198.19.255.254'), true);
  assert.equal(isBlockedWallpaperHost('198.17.255.255'), false);
  assert.equal(isBlockedWallpaperHost('198.20.0.1'), false);
  // Existing public hosts stay allowed.
  assert.equal(isBlockedWallpaperHost('93.184.216.34'), false);
  assert.equal(isBlockedWallpaperHost('cn.bing.com'), false);
});

test('listWallpaperCatalog rejects HTTPS CGNAT and benchmark IP literals', async () => {
  delete process.env.DSHD_WALLPAPER_ALLOW_HTTP;
  for (const url of [
    'https://100.64.1.2/secret.json',
    'https://198.18.7.7/secret.json',
  ]) {
    const result = await listWallpaperCatalog({ kind: 'catalog', url });
    assert.equal(result.items.length, 0, url);
    assert.match(result.warning, /壁纸目录/, url);
  }
});

test('assertResolvedWallpaperHost rejects hostnames resolving to private addresses', async () => {
  delete process.env.DSHD_WALLPAPER_ALLOW_HTTP;
  const privateLookup = async () => [{ address: '10.11.12.13', family: 4 }];
  await assert.rejects(
    () => assertResolvedWallpaperHost('evil.example.com', 'https://evil.example.com/x.json', privateLookup),
    /解析到不允许的内网地址/,
  );
  const cgnatLookup = async () => [
    { address: '93.184.216.34', family: 4 },
    { address: '100.64.9.9', family: 4 },
  ];
  await assert.rejects(
    () => assertResolvedWallpaperHost('half.example.com', 'https://half.example.com/x.json', cgnatLookup),
    /解析到不允许的内网地址/,
  );
});

test('assertResolvedWallpaperHost keeps public results and tolerates DNS failure', async () => {
  delete process.env.DSHD_WALLPAPER_ALLOW_HTTP;
  const publicLookup = async () => [
    { address: '93.184.216.34', family: 4 },
    { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 },
  ];
  await assertResolvedWallpaperHost('example.com', 'https://example.com/x.json', publicLookup);
  const failingLookup = async () => { throw new Error('getaddrinfo ENOTFOUND'); };
  await assertResolvedWallpaperHost('gone.example.com', 'https://gone.example.com/x.json', failingLookup);
  // IP literals were classified by the shared verdict; the resolver must not be consulted.
  let called = 0;
  const countingLookup = async () => { called += 1; return []; };
  await assertResolvedWallpaperHost('93.184.216.34', 'https://93.184.216.34/x.json', countingLookup);
  await assertResolvedWallpaperHost('[2606:2800::1]', 'https://[2606:2800::1]/x.json', countingLookup);
  assert.equal(called, 0);
});

test('assertResolvedWallpaperHost refuses IPv4-embedded literals without resolving', async () => {
  delete process.env.DSHD_WALLPAPER_ALLOW_HTTP;
  let called = 0;
  const countingLookup = async () => { called += 1; return []; };
  for (const host of ['[::ffff:7f00:1]', '[::7f00:1]', '[64:ff9b::a00:1]']) {
    await assert.rejects(
      () => assertResolvedWallpaperHost(host, `https://${host}/x.json`, countingLookup),
      /解析到不允许的内网地址/,
      host,
    );
  }
  assert.equal(called, 0);
});

// #508: a rebinding resolver answers the post-parse recheck with a public
// (here: the loopback fixture, allowed under the test flag) address, then a
// private one for any second lookup. The connect must reuse the re-checked
// records — no second resolution — so the private answer is never used.
test('fetchBuffer pins the connect to the re-checked records, closing the rebind window', async () => {
  let hostHeader = '';
  await withHttp((req, res) => {
    hostHeader = req.headers.host;
    res.setHeader('Content-Type', 'application/json');
    res.end('{"items":[]}');
  }, async (origin) => {
    const port = new URL(origin).port;
    let calls = 0;
    const rebindLookup = async () => {
      calls += 1;
      return calls === 1
        ? [{ address: '127.0.0.1', family: 4 }]
        : [{ address: '10.203.0.9', family: 4 }];
    };
    const { buffer, finalUrl } = await fetchBuffer(`http://rebind.invalid:${port}/pack.json`, {
      maxBytes: 1024,
      timeoutMs: 5000,
      lookup: rebindLookup,
    });
    assert.equal(calls, 1, 'the connect must not resolve the name a second time');
    assert.equal(buffer.toString('utf8'), '{"items":[]}');
    assert.equal(finalUrl, `http://rebind.invalid:${port}/pack.json`);
    assert.equal(hostHeader, `rebind.invalid:${port}`, 'Host must stay the URL hostname');
  });
});

test('assertResolvedWallpaperHost returns the validated records for the connect pin', async () => {
  delete process.env.DSHD_WALLPAPER_ALLOW_HTTP;
  const records = [{ address: '93.184.216.34', family: 4 }];
  const returned = await assertResolvedWallpaperHost(
    'example.com',
    'https://example.com/x.json',
    async () => records,
  );
  assert.deepEqual(returned, records);
  const failing = async () => { throw new Error('getaddrinfo ENOTFOUND'); };
  assert.equal(
    await assertResolvedWallpaperHost('gone.example.com', 'https://gone.example.com/x', failing),
    null,
  );
  assert.equal(
    await assertResolvedWallpaperHost('93.184.216.34', 'https://93.184.216.34/x', async () => records),
    null,
  );
});

test('listWallpaperCatalog accepts a catalog under 4MB and drops one above it', async () => {
  const item = {
    id: 'ok',
    title: 'Ok',
    thumbUrl: 'https://example.com/t.jpg',
    imageUrl: 'https://example.com/i.jpg',
  };
  const under = `{"items":[${JSON.stringify(item)}],"pad":"${'x'.repeat(2_000_000)}"}`;
  const huge = `{"items":[],"pad":"${'x'.repeat(4_000_010)}"}`;
  await withHttp((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(req.url === '/under.json' ? under : huge);
  }, async (origin) => {
    const kept = await listWallpaperCatalog({
      kind: 'catalog',
      url: `${origin}/under.json`,
    });
    assert.equal(kept.items.length, 1);
    assert.equal(kept.items[0].id, 'ok');
    assert.equal(kept.warning, undefined);

    const dropped = await listWallpaperCatalog({
      kind: 'catalog',
      url: `${origin}/huge.json`,
    });
    assert.equal(dropped.items.length, 0);
    assert.match(dropped.warning, /过大/);
  });
});

test('listWallpaperCatalog does not fetch Bing unless kind is bing', async () => {
  const previousBing = process.env.DSHD_BING_WALLPAPER_URL;
  try {
    await withHttp((req, res) => {
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/pack.json') {
        res.end(JSON.stringify({
          version: 1,
          items: [{
            id: 'ok',
            title: 'Ok',
            thumbUrl: 'https://example.com/t.jpg',
            imageUrl: 'https://example.com/i.jpg',
          }],
        }));
        return;
      }
      res.end(JSON.stringify({
        images: [{ urlbase: '/th?id=OHR.Skip', title: 'Skip', hsh: 'nope', wp: true }],
      }));
    }, async (origin) => {
      process.env.DSHD_BING_WALLPAPER_URL = `${origin}/bing.json`;
      const omitted = await listWallpaperCatalog({});
      assert.equal(omitted.items.length, 0);
      const catalog = await listWallpaperCatalog({ kind: 'catalog', url: `${origin}/pack.json` });
      assert.equal(catalog.items.length, 1);
      assert.equal(catalog.items[0].id, 'ok');
      assert.equal(catalog.items[0].source, `${origin}/pack.json`);
    });
  } finally {
    if (previousBing === undefined) delete process.env.DSHD_BING_WALLPAPER_URL;
    else process.env.DSHD_BING_WALLPAPER_URL = previousBing;
  }
});

test('listWallpaperCatalog aborts a chunked catalog once it exceeds 4MB', async () => {
  const previousHttp = process.env.DSHD_WALLPAPER_ALLOW_HTTP;
  process.env.DSHD_WALLPAPER_ALLOW_HTTP = '1';
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.write('{"items":[],"pad":"');
    res.write('x'.repeat(4_000_010));
  });
  const port = await listen(server);
  try {
    const dropped = await listWallpaperCatalog({
      kind: 'catalog',
      url: `http://127.0.0.1:${port}/huge.json`,
    });
    assert.equal(dropped.items.length, 0);
    assert.match(dropped.warning, /过大/);
  } finally {
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    await close(server);
    if (previousHttp === undefined) delete process.env.DSHD_WALLPAPER_ALLOW_HTTP;
    else process.env.DSHD_WALLPAPER_ALLOW_HTTP = previousHttp;
  }
});

test('downloadWallpaper returns a raster data URL', async () => {
  await withHttp((_req, res) => {
    res.setHeader('Content-Type', 'image/png');
    res.end(PNG);
  }, async (origin) => {
    const result = await downloadWallpaper(`${origin}/dot.png`);
    assert.equal(result.error, undefined);
    assert.match(result.dataUrl, /^data:image\/png;base64,/);
  });
});

test('downloadWallpaper rejects a disallowed URL and a non-image body', async () => {
  const blocked = await downloadWallpaper('file:///C:/photo.png');
  assert.equal(blocked.dataUrl, undefined);
  assert.equal(typeof blocked.error, 'string');

  await withHttp((_req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.end('<html></html>');
  }, async (origin) => {
    const result = await downloadWallpaper(`${origin}/page.html`);
    assert.equal(result.dataUrl, undefined);
    assert.match(result.error, /图片|image/i);
  });
});

test('bingCatalogUrls uses idx 0 and 8 unless a single override is set', () => {
  const previous = process.env.DSHD_BING_WALLPAPER_URL;
  delete process.env.DSHD_BING_WALLPAPER_URL;
  const defaults = bingCatalogUrls();
  assert.deepEqual(defaults, [
    'https://cn.bing.com/HPImageArchive.aspx?format=js&idx=0&n=8&mkt=zh-CN',
    'https://cn.bing.com/HPImageArchive.aspx?format=js&idx=8&n=8&mkt=zh-CN',
  ]);
  process.env.DSHD_BING_WALLPAPER_URL = 'https://example.com/one.json';
  assert.deepEqual(bingCatalogUrls(), ['https://example.com/one.json']);
  process.env.DSHD_BING_WALLPAPER_URL = 'https://example.com/bing.json?idx={idx}';
  assert.deepEqual(bingCatalogUrls(), [
    'https://example.com/bing.json?idx=0',
    'https://example.com/bing.json?idx=8',
  ]);
  if (previous === undefined) delete process.env.DSHD_BING_WALLPAPER_URL;
  else process.env.DSHD_BING_WALLPAPER_URL = previous;
});

test('listWallpaperCatalog merges both Bing idx pages from a {idx} override', async () => {
  const previousBing = process.env.DSHD_BING_WALLPAPER_URL;
  await withHttp((req, res) => {
    const idx = new URL(req.url, 'http://127.0.0.1').searchParams.get('idx');
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      images: [{
        urlbase: `/th?id=OHR.${idx}`,
        title: `Day ${idx}`,
        copyright: '© Test',
        hsh: `h${idx}`,
        wp: true,
      }],
    }));
  }, async (origin) => {
    process.env.DSHD_BING_WALLPAPER_URL = `${origin}/bing.json?idx={idx}`;
    const result = await listWallpaperCatalog({ kind: 'bing' });
    assert.equal(result.items.length, 2);
    assert.deepEqual(result.items.map((item) => item.id).sort(), ['h0', 'h8']);
    assert.equal(result.items[0].source, 'bing');
    assert.equal(result.items[1].source, 'bing');
  });
  if (previousBing === undefined) delete process.env.DSHD_BING_WALLPAPER_URL;
  else process.env.DSHD_BING_WALLPAPER_URL = previousBing;
});

test('downloadWallpaper follows a short redirect chain and rejects too many hops', async () => {
  await withHttp((req, res) => {
    if (req.url === '/dot.png') {
      res.setHeader('Content-Type', 'image/png');
      res.end(PNG);
      return;
    }
    const hop = Number((req.url.match(/hop-(\d+)/) || [])[1]);
    res.statusCode = 302;
    res.setHeader('Location', hop >= 5 ? '/dot.png' : `/hop-${hop + 1}`);
    res.end();
  }, async (origin) => {
    const ok = await downloadWallpaper(`${origin}/hop-3`);
    assert.equal(ok.error, undefined);
    assert.match(ok.dataUrl, /^data:image\/png;base64,/);

    const blocked = await downloadWallpaper(`${origin}/hop-0`);
    assert.equal(blocked.dataUrl, undefined);
    assert.match(blocked.error, /重定向过多/);
  });
});

test('listWallpaperCatalog wallhaven hardcodes purity=100', async () => {
  const previousSearch = process.env.DSHD_WALLHAVEN_SEARCH_URL;
  let recordedUrl = '';
  try {
    await withHttp((req, res) => {
      recordedUrl = req.url || '';
      const origin = `http://${req.headers.host}`;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        data: [
          { id: 'ab', path: `${origin}/full.jpg`, thumbs: { large: `${origin}/t.jpg` } },
          { id: 'cd', path: `${origin}/full2.jpg`, thumbs: { small: `${origin}/s.jpg` } },
        ],
        meta: { current_page: 1, last_page: 2 },
      }));
    }, async (origin) => {
      process.env.DSHD_WALLHAVEN_SEARCH_URL = `${origin}/search`;
      const result = await listWallpaperCatalog({
        kind: 'wallhaven',
        categories: '010',
        q: 'lake',
        purity: '111',
      });
      assert.match(recordedUrl, /purity=100/);
      assert.doesNotMatch(recordedUrl, /purity=111/);
      assert.match(recordedUrl, /categories=010/);
      assert.match(recordedUrl, /sorting=toplist/);
      assert.match(recordedUrl, /atleast=1920x1080/);
      assert.match(recordedUrl, /page=1/);
      assert.match(recordedUrl, /q=lake/);
      assert.equal(result.items.length, 2);
      assert.equal(result.items[0].id, 'wallhaven-ab');
      assert.equal(result.items[0].title, 'ab');
      assert.equal(result.items[0].thumbUrl, `${origin}/t.jpg`);
      assert.equal(result.items[0].imageUrl, `${origin}/full.jpg`);
      assert.equal(result.items[0].source, 'wallhaven');
      assert.equal(result.items[1].id, 'wallhaven-cd');
      assert.equal(result.items[1].thumbUrl, `${origin}/s.jpg`);
      assert.equal(result.nextPage, 2);
    });
  } finally {
    if (previousSearch === undefined) delete process.env.DSHD_WALLHAVEN_SEARCH_URL;
    else process.env.DSHD_WALLHAVEN_SEARCH_URL = previousSearch;
  }
});

test('listWallpaperCatalog wallhaven omits nextPage on the last page', async () => {
  const previousSearch = process.env.DSHD_WALLHAVEN_SEARCH_URL;
  try {
    await withHttp((_req, res) => {
      const origin = `http://${_req.headers.host}`;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        data: [{ id: 'zz', path: `${origin}/full.jpg`, thumbs: { large: `${origin}/t.jpg` } }],
        meta: { current_page: 3, last_page: 3 },
      }));
    }, async (origin) => {
      process.env.DSHD_WALLHAVEN_SEARCH_URL = `${origin}/search`;
      const result = await listWallpaperCatalog({ kind: 'wallhaven', page: 3 });
      assert.equal(result.items.length, 1);
      assert.equal(result.nextPage, undefined);
    });
  } finally {
    if (previousSearch === undefined) delete process.env.DSHD_WALLHAVEN_SEARCH_URL;
    else process.env.DSHD_WALLHAVEN_SEARCH_URL = previousSearch;
  }
});

test('listWallpaperCatalog bing year maps archive json', async () => {
  const previousArchive = process.env.DSHD_BING_ARCHIVE_URL;
  try {
    await withHttp((req, res) => {
      const origin = `http://${req.headers.host}`;
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/CN-zh.2024.json') {
        res.end(JSON.stringify([
          { date: '2024-01-16', title: 'T', copyright: 'C', url: `${origin}/a.jpg` },
          {
            date: '2024-01-17',
            title: 'U',
            copyright: 'D',
            bing_url: `${origin}/b.jpg`,
            url: `${origin}/c.jpg`,
          },
        ]));
        return;
      }
      res.statusCode = 404;
      res.end();
    }, async (origin) => {
      process.env.DSHD_BING_ARCHIVE_URL = `${origin}/CN-zh.{year}.json`;
      const result = await listWallpaperCatalog({ kind: 'bing', year: 2024 });
      assert.equal(result.items.length, 2);
      assert.deepEqual(result.items[0], {
        id: 'bing-2024-01-16',
        title: 'T',
        copyright: 'C',
        thumbUrl: `${origin}/a.jpg`,
        imageUrl: `${origin}/a.jpg`,
        source: 'bing',
      });
      assert.equal(result.items[1].id, 'bing-2024-01-17');
      assert.equal(result.items[1].imageUrl, `${origin}/b.jpg`);
      assert.equal(result.items[1].thumbUrl, `${origin}/b.jpg`);
      assert.equal(result.items[1].source, 'bing');
    });
  } finally {
    if (previousArchive === undefined) delete process.env.DSHD_BING_ARCHIVE_URL;
    else process.env.DSHD_BING_ARCHIVE_URL = previousArchive;
  }
});

test('listWallpaperCatalog bing year keeps 500 items and drops the rest', async () => {
  const previousArchive = process.env.DSHD_BING_ARCHIVE_URL;
  try {
    await withHttp((_req, res) => {
      res.setHeader('Content-Type', 'application/json');
      const entries = Array.from({ length: 501 }, (_, i) => ({
        date: `2024-d-${i}`,
        title: 'T',
        copyright: 'C',
        url: 'https://example.com/a.jpg',
      }));
      res.end(JSON.stringify(entries));
    }, async (origin) => {
      process.env.DSHD_BING_ARCHIVE_URL = `${origin}/CN-zh.{year}.json`;
      const result = await listWallpaperCatalog({ kind: 'bing', year: 2024 });
      assert.equal(result.items.length, 500);
      assert.equal(result.items[0].id, 'bing-2024-d-0');
      assert.equal(result.items[499].id, 'bing-2024-d-499');
    });
  } finally {
    if (previousArchive === undefined) delete process.env.DSHD_BING_ARCHIVE_URL;
    else process.env.DSHD_BING_ARCHIVE_URL = previousArchive;
  }
});

test('fetchFailureDetail unwraps undici TypeError and AbortError', () => {
  assert.equal(fetchFailureDetail(undefined), '网络失败');
  const failed = new TypeError('fetch failed');
  failed.cause = Object.assign(new Error('getaddrinfo ENOTFOUND wallhaven.cc'), { code: 'ENOTFOUND' });
  assert.equal(fetchFailureDetail(failed), '网络失败');
  const aborted = new Error('The operation was aborted');
  aborted.name = 'AbortError';
  assert.equal(fetchFailureDetail(aborted), '超时');
  const timed = new Error('timeout');
  timed.name = 'TimeoutError';
  assert.equal(fetchFailureDetail(timed), '超时');
  assert.equal(fetchFailureDetail(new Error('weird provider text')), 'weird provider text');
});

test('listWallpaperCatalog maps fetch failed to 网络失败 instead of the raw TypeError', async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    const err = new TypeError('fetch failed');
    err.cause = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    throw err;
  };
  try {
    const result = await listWallpaperCatalog({
      kind: 'catalog',
      url: 'https://example.com/pack.json',
    });
    assert.equal(result.items.length, 0);
    assert.match(result.warning, /网络失败/);
    assert.doesNotMatch(result.warning, /fetch failed/);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('listWallpaperCatalog maps AbortError to 超时', async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    const err = new Error('The operation was aborted');
    err.name = 'AbortError';
    throw err;
  };
  try {
    const result = await listWallpaperCatalog({
      kind: 'catalog',
      url: 'https://example.com/pack.json',
    });
    assert.equal(result.items.length, 0);
    assert.match(result.warning, /超时/);
  } finally {
    globalThis.fetch = previousFetch;
  }
});
