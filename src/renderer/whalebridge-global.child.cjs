'use strict';
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
app.setPath('userData', process.argv[2]);
const assets = path.resolve(__dirname, '../../vendor/whalebridge/internal/whalebridge/assets');
const names = new Set(fs.readdirSync(assets));
const writes = [], queries = [], errors = [];
let fail = false;
const data = {
  settings: { searcher: 'missing/model', vision: 'missing/vision', imageGen: 'missing/image' },
  searchVendors: [{ id: 'tavily', name: 'Tavily', base: 'https://api.tavily.test', keysURL: 'https://keys.test' }],
  searches: [], searchers: [{ id: 'relay', name: 'Search relay', small: 'gpt', models: [{ id: 'relay/gpt', name: 'Search model' }] }],
  searcherUnused: 'gone', autoSearcher: 'Search relay · Search model', searcher: 'Search relay · Search model',
  visionModels: [{ id: 'relay/vision', name: 'Vision model' }], drawingModels: [{ id: 'codex/gpt-image-2', name: 'GPT Image 2' }],
  autoVision: 'relay/vision', autoDrawer: 'codex/gpt-image-2', visionUnused: true, imageGenUnused: true,
  models: [{ id: 'relay/gpt', name: 'Search model' }], fx: { rate: 7.2 }, sync: {}, modelPrices: {},
};
const summary = { calls: 2, input: 30, output: 8, errors: 0, cache_read: 2, cache_write: 0, cost: 0.25, models: [], accounts: [], providerKeys: [], series: [{ label: '12:00', calls: 2, input: 30, output: 8, cache_read: 2, cost: 0.25 }] };
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    const json = body => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)); };
    if (req.method === 'POST') {
      let raw = ''; for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw); writes.push({ path: url.pathname, body });
      if (fail) { res.writeHead(400); return res.end('fixture save rejected'); }
      if (url.pathname === '/api/global/settings') Object.assign(data.settings, body);
      if (url.pathname === '/api/model-price') data.modelPrices[body.id] = body.price;
      if (url.pathname === '/api/search/save') data.searches = [{ vendor: body.vendor, ready: true, keySet: true, keyMasked: '***' }];
      return json({ ok: true });
    }
    if (url.pathname === '/api/state') return json({ version: 'global-qa', providers: [], presets: [], models: [], hidden: [], groups: [] });
    if (url.pathname === '/api/global') return json(data);
    if (url.pathname === '/api/usage') return json(summary);
    if (url.pathname === '/api/requests') { queries.push(Object.fromEntries(url.searchParams)); return json({ Rows: [{ t: '2026-10-06T18:00:00Z', route_id: 42, model: 'exact-model', provider: 'relay', status: 200, in: 30, out: 8, archive: '2026-10-07/fixture', priced: true, cost: 0.25 }], Total: 1, Providers: ['relay'] }); }
    if (url.pathname === '/api/archive/file') return json({ request: { method: 'POST', path: '/v1/responses', headers: {}, body: 'saved fragment', truncated: true }, response: { status: 200, headers: {}, body: 'reply' } });
    if (url.pathname === '/api/subscriptions/alerts') return json({ sequence: 0, alerts: [] });
    if (url.pathname.startsWith('/api/')) return json({});
    const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    if (!names.has(name)) { res.writeHead(404); return res.end(); }
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' })[path.extname(name)]);
    res.end(fs.readFileSync(path.join(assets, name)));
  } catch (error) { res.writeHead(500); res.end(error.message); }
});
async function run() {
  await app.whenReady(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const win = new BrowserWindow({ width: 1120, height: 800, show: false, webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  const js = source => win.webContents.executeJavaScript(source).catch(error => { throw new Error(`${source}: ${error.message}`); });
  win.webContents.on('console-message', (_e, level, message) => { if (level >= 3) errors.push(message); });
  const wait = async expr => { const end = Date.now() + 5000; while (!await js(`Boolean(${expr})`)) { if (Date.now() > end) throw new Error(`DOM timeout: ${expr}`); await new Promise(resolve => setTimeout(resolve, 20)); } };
  const click = selector => js(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const fill = (selector, value, event = 'input') => js(`(() => {const e=document.querySelector(${JSON.stringify(selector)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event(${JSON.stringify(event)},{bubbles:true}));})()`);
  const ready = () => wait(`document.querySelector('#content').getAttribute('aria-busy')==='false'`);
  const section = async id => { await click(`[data-global-section="${id}"]`); await ready(); };
  try {
    await win.loadURL(`http://127.0.0.1:${server.address().port}`); await ready();
    await click('[data-tab="settings"]'); await ready(); await section('tools');
    assert.equal(await js(`document.querySelector('#f-searcherChoice').value`), 'manual');
    assert.equal(await js(`document.querySelector('#f-vision').value`), 'missing/vision');
    assert.equal(await js(`document.querySelector('#f-imageGen').value`), 'missing/image');
    assert.ok(await js(`document.querySelector('#content').textContent.includes('当前设置未被使用')`));
    await fill('#f-searcherChoice', 'relay/gpt', 'change');
    await section('privacy'); await fill('#f-redactWords', 'private draft');
    await section('tools'); assert.equal(await js(`document.querySelector('#f-searcher').value`), 'relay/gpt');
    await click('#global-form [type="submit"]'); await wait(`document.querySelector('#message-text').textContent==='设置已保存'`); await ready();
    const saved = writes.find(w => w.path === '/api/global/settings').body;
    assert.equal(saved.searcher, 'relay/gpt'); assert.equal(saved.vision, 'missing/vision'); assert.equal(saved.imageGen, 'missing/image');
    assert.equal('searcherChoice' in saved, false);
    await click('[data-global="edit-search"][data-id="tavily"]'); await fill('#search-edit-form [name=key]', 'search-key');
    await click('#search-edit-form [type=submit]'); await wait(`document.querySelector('[data-global="show-search"]')`);
    assert.equal(writes.find(w => w.path === '/api/search/save').body.vendor, 'tavily');
    await section('privacy'); assert.equal(await js(`document.querySelector('#f-redactWords').value`), 'private draft');
    data.fx={rate:0};await section('connection');
    assert.ok(await js(`document.querySelector('#content').textContent.includes('人民币汇率暂不可用')`));
    await fill('#f-currency','cny','change');
    const settingsWritesBeforePrice=writes.filter(w=>w.path==='/api/global/settings').length;
    for (const [name, value] of Object.entries({ model: 'decimal-model', input: '0.8', output: '1.5', cache_read: '0.2', cache_write: '0.6' })) await fill(`#uniform-price-form [name=${name}]`, value);
    await click('#uniform-price-form details summary'); await click('[data-global="add-uniform-tier"]');
    await fill('[data-tier-above]', '200000');
    for (const [name, value] of Object.entries({ input: '1.2', output: '2.5', cache_read: '0.3', cache_write: '0.8' })) await fill(`[data-tier-price=${name}]`, value);
    await click('#uniform-price-form [type=submit]'); await wait(`document.querySelector('[data-global="edit-price"]')`);
    assert.equal(await js(`document.querySelector('#f-currency').value`),'cny','price save must preserve independent settings draft');
    assert.equal(writes.filter(w=>w.path==='/api/global/settings').length,settingsWritesBeforePrice,'price save must not submit settings');
    for (const [name,value] of Object.entries({model:'unsaved-price',input:'0.7'}))await fill(`#uniform-price-form [name=${name}]`,value);
    await click('#global-form [type=submit]');await wait(`document.querySelector('#message-text').textContent==='设置已保存'`);await ready();
    assert.equal(await js(`document.querySelector('#uniform-price-form [name=model]').value`),'unsaved-price','settings save must preserve independent price draft');
    assert.equal(writes.find(w => w.path === '/api/model-price').body.price.input, 0.8);
    assert.equal(writes.find(w => w.path === '/api/model-price').body.price.tiers[0].output, 2.5);
    assert.equal('cache_write_1h' in writes.find(w => w.path === '/api/model-price').body.price.tiers[0], false);
    await click('[data-tab="usage"]'); await ready(); await fill('#usage-trend', 'tokens', 'change'); await ready();
    assert.equal(await js(`document.querySelector('.usage-bar-item span').textContent`), '40');
    await fill('#usage-trend', 'cost', 'change'); await ready(); assert.equal(await js(`document.querySelector('.usage-bar-item span').textContent`), '$0.250');
    await section('ledger');
    for (const [name, value] of Object.entries({ model: 'exact-model', route: '42', purpose: 'search', computer: 'this' })) await fill(`#ledger-filter [name=${name}]`, value);
    await click('#ledger-filter [type=submit]'); await ready();
    assert.deepEqual(Object.fromEntries(['model', 'route', 'purpose', 'computer'].map(k => [k, queries.at(-1)[k]])), { model: 'exact-model', route: '42', purpose: 'search', computer: 'this' });
    const localDate=new Date('2026-10-06T18:00:00Z');
    const localDay=`${localDate.getFullYear()}-${String(localDate.getMonth()+1).padStart(2,'0')}-${String(localDate.getDate()).padStart(2,'0')}`;
    assert.equal(await js(`document.querySelector('[data-global=show-route]').dataset.day`),localDay,'routing archive day must use the same local day as gateway history');
    await click('[data-global="view-archive"]'); await wait(`document.querySelector('#editor').open`);
    assert.ok(await js(`document.querySelector('#fields').textContent.includes('正文已截断')`)); await click('#close-editor');
    await click('[data-tab="settings"]'); await ready(); await section('tools');
    fail = true; await click('#global-form [type=submit]'); await wait(`document.querySelector('#message-text').textContent==='fixture save rejected'`);
    assert.equal(await js(`document.querySelector('#global-form [type=submit]').disabled`), false); fail = false;
    for (const width of [1120, 420]) {
      win.setContentSize(width, 800); await js(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
      assert.ok(await js(`document.documentElement.scrollWidth<=innerWidth+1`), `global page overflows at ${width}`);
      await js(`document.querySelector('#f-searcher').focus()`); assert.equal(await js(`document.activeElement.id`), 'f-searcher');
    }
    assert.deepEqual(errors, []);
    console.log('WHALEBRIDGE_GLOBAL_RESULT:PASS safe candidates, unknown settings, drafts, decimals, metrics, ledger filters, save error, responsive focus');
  } finally { win.destroy(); await new Promise(resolve => server.close(resolve)); }
}
run().then(() => app.exit(0), error => { console.error(error); app.exit(1); });
