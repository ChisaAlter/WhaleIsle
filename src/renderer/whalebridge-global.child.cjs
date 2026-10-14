'use strict';
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
app.setPath('userData', process.argv[2]);
app.on('window-all-closed',()=>{});
const assets = path.resolve(__dirname, '../../vendor/whalebridge/internal/whalebridge/assets');
const names = new Set(fs.readdirSync(assets));
const writes = [], queries = [], errors = [];
let fail = false;
let delayNextSave = false, releaseSave;
let failUsage = false, emptyLedger = false, delayNextGlobal = false, releaseGlobal;
let releaseRouteDay, routeDayFinished=false, delayLiveRoute=false, releaseLiveRoute, liveRouteFinished=false;
const data = {
  settings: { searcher: 'missing/model', vision: 'missing/vision', imageGen: 'missing/image' },
  searchVendors: [{ id: 'tavily', name: 'Tavily', base: 'https://api.tavily.test', keysURL: 'https://keys.test' }, { id: 'searxng', name: 'SearXNG' }],
  searches: [], searchers: [{ id: 'relay', name: 'Search relay', small: 'gpt', models: [{ id: 'relay/gpt', name: 'Search model' }] }],
  searcherUnused: 'gone', autoSearcher: 'Search relay · Search model', searcher: 'Search relay · Search model',
  visionModels: [{ id: 'relay/vision', name: 'Vision model' }], drawingModels: [{ id: 'codex/gpt-image-2', name: 'GPT Image 2' }],
  autoVision: 'relay/vision', autoDrawer: 'codex/gpt-image-2', visionUnused: true, imageGenUnused: true,
  models: [{ id: 'relay/gpt', name: 'Search model' }], fx: { rate: 7.2 }, sync: {}, modelPrices: {},
};
const day = new Date(); day.setHours(0, 0, 0, 0);
const summary = { calls: 2, input: 30, output: 8, errors: 0, cache_read: 2, cache_write: 0, cost: 0.25, models: [], accounts: [], providerKeys: [], bucket: 'hour', series: Array.from({length:24}, (_, hour) => ({ time: new Date(day.getTime()+hour*3600000).toISOString(), calls: hour===12?2:0, input: hour===12?30:0, output: hour===12?8:0, cache_read: hour===12?2:0, cost: hour===12?0.25:0.0 })) };
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    const json = body => { if(!res.headersSent)res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)); };
    if (req.method === 'POST') {
      let raw = ''; for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw); writes.push({ path: url.pathname, body });
      if (fail) { res.writeHead(400); return res.end('fixture save rejected'); }
      if (delayNextSave) { delayNextSave = false; await new Promise(resolve => { releaseSave = resolve; }); }
      if (url.pathname === '/api/global/settings') Object.assign(data.settings, body);
      if (url.pathname === '/api/model-price') data.modelPrices[body.id] = body.price;
      if (url.pathname === '/api/search/save') data.searches = [{ vendor: body.vendor, ready: true, keySet: true, keyMasked: '***' }];
      return json({ ok: true });
    }
    if (url.pathname === '/api/state') return json({ version: 'global-qa', providers: [], presets: [], models: [], hidden: [], groups: [] });
    if (url.pathname === '/api/global') {
      // Send the production no-store policy before holding the body so a
      // concurrent read can finish while this older response is delayed.
      if(delayNextGlobal){delayNextGlobal=false;const stale=JSON.parse(JSON.stringify(data));res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');res.flushHeaders();await new Promise(resolve=>{releaseGlobal=resolve;});return json(stale);}
      return json(data);
    }
    if (url.pathname === '/api/usage') {if(failUsage){res.writeHead(503);return res.end('fixture usage unavailable');}return json(summary);}
    if (url.pathname === '/api/requests') { queries.push(Object.fromEntries(url.searchParams)); return json({ Rows: emptyLedger?[]:[{ t: '2026-10-06T18:00:00Z', route_id: 42, model: 'exact-model', provider: 'relay', status: 200, in: 30, out: 8, archive: '2026-10-07/fixture', priced: true, cost: 0.25 }], Total: emptyLedger?0:1, Providers: ['relay'] }); }
    if (url.pathname === '/api/routes/history') {
      const selected=url.searchParams.get('day');
      if(selected==='2026-10-10'){await new Promise(resolve=>{releaseRouteDay=resolve;});routeDayFinished=true;}
      return json({days:[{day:'2026-10-10'},{day:'2026-10-11'}],routes:selected?[{model:selected,time:'2026-10-11T01:00:00Z',done:true,status:200}]:[]});
    }
    if (url.pathname === '/api/routes') {
      if(delayLiveRoute){delayLiveRoute=false;await new Promise(resolve=>{releaseLiveRoute=resolve;});liveRouteFinished=true;}
      return json({routes:[{model:'live-model',time:'2026-10-11T01:00:00Z',done:true,status:200}]});
    }
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
  const wait = async expr => { const end = Date.now() + 5000; while (!await js(`Boolean(${expr})`)) { if (Date.now() > end) throw new Error(`DOM timeout: ${expr}; ${JSON.stringify(await js(`({tab,renderEpoch,message:document.querySelector('#message-text').textContent,content:document.querySelector('#content').innerText.slice(0,300)})`))}`); await new Promise(resolve => setTimeout(resolve, 20)); } };
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
    delayNextGlobal = true; await click('[data-global-section="privacy"]');
    while (!releaseGlobal) await new Promise(resolve => setTimeout(resolve, 10));
    await fill('#f-searcher', 'relay/during-transition'); releaseGlobal(); releaseGlobal = undefined; await ready();
    assert.equal(await js(`document.querySelector('#f-redactWords').value`), 'private draft', 'editing the previous page during loading must not replace the next section draft');
    await section('tools'); assert.equal(await js(`document.querySelector('#f-searcher').value`), 'relay/during-transition');
    await fill('#f-searcherChoice', 'relay/gpt', 'change');
    await click('#global-form [type="submit"]'); await wait(`document.querySelector('#message-text').textContent==='设置已保存'`); await ready();
    const saved = writes.find(w => w.path === '/api/global/settings').body;
    assert.equal(saved.searcher, 'relay/gpt'); assert.equal(saved.vision, 'missing/vision'); assert.equal(saved.imageGen, 'missing/image');
    assert.equal('searcherChoice' in saved, false);
    await click('[data-global="edit-search"][data-id="tavily"]'); await fill('#search-edit-form [name=key]', 'search-key');
    await fill('#search-edit-form [name=url]', 'https://unsaved-search.test/api');
    await section('privacy'); await click('[data-tab="overview"]'); await ready();
    await click('[data-tab="settings"]'); await ready(); await section('tools');
    assert.equal(await js(`document.querySelector('#search-edit-form [name=key]').value`), 'search-key', 'search API drafts must survive section and sidebar navigation');
    assert.equal(await js(`document.querySelector('#search-edit-form [name=url]').value`), 'https://unsaved-search.test/api');
    await click('[data-global="edit-search"][data-id="searxng"]'); await fill('#search-edit-form [name=url]', 'https://cancelled-search.test/api');
    await click('#close-search-edit'); await click('[data-global="edit-search"][data-id="tavily"]');
    assert.equal(await js(`document.querySelector('#search-edit-form [name=key]').value`), 'search-key', 'cancelling one vendor must preserve another vendor draft');
    delayNextSave = true; await click('#search-edit-form [type=submit]');
    while (!releaseSave) await new Promise(resolve => setTimeout(resolve, 10));
    await fill('#search-edit-form [name=key]', 'edited-while-saving'); releaseSave(); releaseSave = undefined;
    await wait(`document.querySelector('[data-global="show-search"]')`); await ready();
    assert.equal(await js(`document.querySelector('#search-edit-form [name=key]').value`), 'edited-while-saving', 'successful save must clear only the submitted draft');
    await section('privacy'); await section('tools');
    assert.equal(await js(`document.querySelector('#search-edit-form [name=key]').value`), 'edited-while-saving');
    await click('#close-search-edit'); await click('[data-global="edit-search"][data-id="tavily"]');
    assert.equal(await js(`document.querySelector('#search-edit-form [name=key]').value`), '', 'cancelled key drafts must not reappear');
    fail = true; await fill('#search-edit-form [name=key]', 'rejected-key'); await click('#search-edit-form [type=submit]');
    await wait(`document.querySelector('#search-edit-form').getAttribute('aria-busy')==='false'`);
    assert.equal(await js(`document.querySelector('#search-edit-form [name=key]').value`), 'rejected-key');
    assert.equal(await js(`document.querySelector('#search-edit-form [type=submit]').disabled`), false);
    fail = false; await click('#close-search-edit'); await js(`message('')`);
    assert.equal(writes.find(w => w.path === '/api/search/save').body.vendor, 'tavily');
    await section('privacy'); assert.equal(await js(`document.querySelector('#f-redactWords').value`), 'private draft');
    await click('[data-global="add-rule"]'); await click('[data-global="add-rule"]');
    await fill('.redact-rule-row:nth-child(2) [data-rule=kind]', 'KEEP');
    await fill('.redact-rule-row:nth-child(2) [data-rule=mode]', 'regex', 'change');
    await fill('.redact-rule-row:nth-child(2) [data-rule=value]', 'secret-[0-9]+');
    await click('.redact-rule-row:first-child [data-global="remove-rule"]');
    await click('[data-tab="overview"]'); await ready(); await click('[data-tab="settings"]'); await ready();
    assert.equal(await js(`document.querySelectorAll('.redact-rule-row').length`), 1, 'removed dynamic rows must remain removed after sidebar navigation');
    assert.equal(await js(`document.querySelector('[data-rule=kind]').value`), 'KEEP');
    assert.equal(await js(`document.querySelector('[data-rule=mode]').value`), 'regex');
    assert.equal(await js(`document.querySelector('[data-rule=value]').value`), 'secret-[0-9]+');
    await section('backup'); await click('label[for="backup-import-pass"]');
    assert.equal(await js(`document.activeElement.id`), 'backup-import-pass', 'restore passphrase label must focus the restore field');
    assert.equal(await js(`document.querySelectorAll('#backup-export-pass').length`), 1);
    assert.equal(await js(`document.querySelectorAll('#backup-import-pass').length`), 1);
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
    await fill('#f-currency','usd','change');
    await click('[data-global="cancel-price"]');await ready();
    assert.equal(await js(`document.querySelector('#uniform-price-form [name=model]').value`),'','price cancel must clear only price fields');
    assert.equal(await js(`document.querySelectorAll('#uniform-price-tiers .price-tier').length`),0,'price cancel must clear draft tiers');
    assert.equal(await js(`document.querySelector('#f-currency').value`),'usd','price cancel must preserve the settings draft');
    assert.equal(writes.find(w => w.path === '/api/model-price').body.price.input, 0.8);
    assert.equal(writes.find(w => w.path === '/api/model-price').body.price.tiers[0].output, 2.5);
    assert.equal('cache_write_1h' in writes.find(w => w.path === '/api/model-price').body.price.tiers[0], false);
    await click('[data-tab="usage"]'); await ready(); await fill('#usage-trend', 'tokens', 'change'); await ready();
    assert.equal(await js(`document.querySelectorAll('.usage-chart-bar').length`), 24);
    assert.ok(await js(`document.querySelector('.usage-chart-point:nth-of-type(13)').getAttribute('aria-label').endsWith('：40')`));
    assert.equal(await js(`document.querySelectorAll('.usage-chart progress').length`), 0);
    assert.ok(await js(`document.querySelector('.usage-chart-svg').getBoundingClientRect().height<=261`));
    await fill('#usage-trend', 'cost', 'change'); await ready();
    assert.ok(await js(`document.querySelector('.usage-chart-point:nth-of-type(13)').getAttribute('aria-label').endsWith('：$0.250')`));
    failUsage=true;await fill('#global-period','7d','change');await ready();
    assert.ok(await js(`document.querySelector('.usage-page').textContent.includes('fixture usage unavailable')`));
    assert.equal(await js(`document.querySelector('.usage-page .stats')`),null,'failed period must not leave the previous totals visible');
    failUsage=false;await click('[data-usage-retry]');await ready();
    assert.ok(await js(`document.querySelector('.usage-chart-svg')`));
    // A slow response for the previous render must not replace the current
    // currency, including after the responsive chart redraws its values.
    data.fx={rate:7.2};data.settings.currency='usd';delayNextGlobal=true;
    await click('[data-tab="usage"]');
    while(!releaseGlobal)await new Promise(resolve=>setTimeout(resolve,10));
    data.settings.currency='cny';await click('[data-tab="usage"]');
    await ready();
    releaseGlobal();await new Promise(resolve=>setTimeout(resolve,30));
    win.setContentSize(960,800);
    await wait(`document.querySelector('.usage-chart-svg').viewBox.baseVal.width===Math.floor(document.querySelector('.usage-chart').clientWidth)`);
    assert.ok(await js(`document.querySelector('.usage-chart-point:nth-of-type(13)').getAttribute('aria-label').endsWith('：¥1.800')`));
    summary.series[12].input=100000000;await fill('#usage-trend','tokens','change');await ready();
    for(const width of [960,420]){
      win.setContentSize(width,800);
      await wait(`document.querySelector('.usage-chart-svg').viewBox.baseVal.width===Math.max(240,Math.floor(document.querySelector('.usage-chart').clientWidth))`);
      assert.ok(await js(`[...document.querySelectorAll('.usage-chart-axis')].every(t=>t.getBBox().x>=0)`),'large Token axis values must fit the chart');
    }
    summary.series[12].input=30;win.setContentSize(1120,800);
    await section('ledger');
    for (const [name, value] of Object.entries({ model: 'exact-model', route: '42', purpose: 'search', computer: 'this' })) await fill(`#ledger-filter [name=${name}]`, value);
    await click('#ledger-filter [type=submit]'); await ready();
    assert.deepEqual(Object.fromEntries(['model', 'route', 'purpose', 'computer'].map(k => [k, queries.at(-1)[k]])), { model: 'exact-model', route: '42', purpose: 'search', computer: 'this' });
    const localDate=new Date('2026-10-06T18:00:00Z');
    const localDay=`${localDate.getFullYear()}-${String(localDate.getMonth()+1).padStart(2,'0')}-${String(localDate.getDate()).padStart(2,'0')}`;
    assert.equal(await js(`document.querySelector('[data-global=show-route]').dataset.day`),localDay,'routing archive day must use the same local day as gateway history');
    await click('[data-global="view-archive"]'); await wait(`document.querySelector('#editor').open`);
    assert.equal(await js(`document.querySelector('#editor-note').hidden`),true,'read-only detail must not advertise saving settings');
    assert.equal(await js(`document.querySelector('#cancel-editor').textContent`),'关闭');
    assert.ok(await js(`document.querySelector('#fields').textContent.includes('正文已截断')`)); await click('#close-editor');
    emptyLedger=true;await click('#ledger-filter [type=submit]');await ready();
    assert.ok(await js(`document.querySelector('.usage-page').textContent.includes('无匹配记录')`));
    assert.equal(await js(`document.querySelector('.usage-page').textContent.includes('1–0')`),false);
    await section('routing');
    await fill('#route-day','2026-10-10','change');
    while(!releaseRouteDay)await new Promise(resolve=>setTimeout(resolve,10));
    await fill('#route-day','2026-10-11','change');
    await wait(`document.querySelector('#route-records').textContent.includes('2026-10-11')`);
    releaseRouteDay();while(!routeDayFinished)await new Promise(resolve=>setTimeout(resolve,10));
    await new Promise(resolve=>setTimeout(resolve,30));
    assert.ok(await js(`document.querySelector('#route-records').textContent.includes('2026-10-11')`),'old date response must not replace the latest route records');
    assert.equal(await js(`document.querySelector('[data-global=live-routes]').disabled`),false,'latest query must release the busy button');
    delayLiveRoute=true;await click('[data-global="live-routes"]');
    while(!releaseLiveRoute)await new Promise(resolve=>setTimeout(resolve,10));
    await click('[data-tab="settings"]');await ready();
    releaseLiveRoute();while(!liveRouteFinished)await new Promise(resolve=>setTimeout(resolve,10));
    await new Promise(resolve=>setTimeout(resolve,30));
    assert.ok(await js(`document.querySelector('.settings-page')`),'an old route query must not navigate away from settings');
    assert.equal(await js(`document.querySelector('#message-text').textContent.includes('null')`),false,'leaving routes during a query must not report a missing DOM target');
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
  } finally { releaseGlobal?.();releaseRouteDay?.();releaseLiveRoute?.();win.destroy(); await new Promise(resolve => server.close(resolve)); }
}
run().then(() => app.exit(0), error => { console.error(error); app.exit(1); });
