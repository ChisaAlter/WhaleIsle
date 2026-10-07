'use strict';
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
app.setPath('userData', process.argv[2]);
const assets = path.resolve(__dirname, '../../vendor/whalebridge/internal/whalebridge/assets');
const names = new Set(fs.readdirSync(assets));
const rows = Array.from({ length: 48 }, (_, i) => ({ id: `channel/model-${String(i).padStart(2, '0')}`, name: `Model ${i}`, channelId: 'channel', channelName: 'QA Channel', supplierId: i < 24 ? 'openai' : 'anthropic', supplierName: i < 24 ? 'OpenAI' : 'Anthropic', context: 272000, efforts: ['low', 'high'] }));
rows.push({ id: 'other/keep', name: 'Keep', channelId: 'other', channelName: 'Other Channel', supplierId: 'other', supplierName: 'Other' });
const hidden = new Set(['other/keep']);
let reads = 0, fail = false;
const writes = [];
let providerFixture;
const providerWrites = [], importWrites = [], settingWrites = [];
const fixturePrice = { input: 1, output: 5, cache_read: 0.25, cache_write: 1.25, cache_write_1h: 2, tiers: [{ above: 200000, input: 2, output: 7.5, cache_read: 0.5, cache_write: 2.5, cache_write_1h: 4 }] };
const subscriptionSettings = { pluginCheckins: { inactive: false }, pluginCheckinsEffective: { daily: true } };
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const json = body => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)); };
  if (url.pathname === '/api/state') {
    reads++;
    return json({ version: 'test', providers: providerFixture ? [providerFixture] : [], presets: [], models: rows.filter(m => !hidden.has(m.id)), hidden: rows.filter(m => hidden.has(m.id)), groups: [] });
  }
  if (url.pathname === '/api/provider' || url.pathname === '/api/provider/import' || (url.pathname === '/api/subscription/settings' && req.method === 'POST')) {
    let text = ''; for await (const chunk of req) text += chunk;
    const body = JSON.parse(text);
    if (url.pathname === '/api/provider') { providerWrites.push(body); return json({ ok: true }); }
    if (url.pathname === '/api/subscription/settings') { settingWrites.push(body); return json({ ok: true }); }
    importWrites.push(body);
    return json(body.preview ? { providers: [{ id: 'imported', name: 'Imported API', chat: 'https://example.test/v1', models: ['long'], keySet: false, keyOptional: false }] } : { ok: true, added: ['imported'] });
  }
  if (url.pathname === '/api/upstream') return json({ vendors: [], providers: {} });
  if (url.pathname === '/api/lanes') return json({});
  if (url.pathname === '/api/usage') return json({ calls: 0, models: [] });
  if (url.pathname === '/api/quotas') return json([]);
  if (url.pathname === '/api/subscription/settings') return json(subscriptionSettings);
  if (url.pathname === '/api/subscriptions') return json([{ id: 'daily-adapter', pid: 'daily', name: 'Daily API', plugin: true, checkin: true }]);
  if (url.pathname === '/api/models/hidden') {
    let text = ''; for await (const chunk of req) text += chunk;
    const body = JSON.parse(text); writes.push(body);
    await new Promise(resolve => setTimeout(resolve, 60));
    if (fail) { res.writeHead(400); return res.end('QA save failed'); }
    for (const id of body.ids) { if (body.hidden) hidden.add(id); else hidden.delete(id); }
    return json({ ok: true });
  }
  const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  if (!names.has(name)) { res.writeHead(404); return res.end(); }
  res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' })[path.extname(name)]);
  res.end(fs.readFileSync(path.join(assets, name)));
});
async function run() {
  await app.whenReady();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const win = new BrowserWindow({ width: 1120, height: 800, show: false, webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  win.webContents.on('console-message', (_event, _level, message) => console.error(message));
  const js = source => win.webContents.executeJavaScript(source).catch(error => { throw new Error(`${source}: ${error.message}`); });
  const wait = async expr => {
    const end = Date.now() + 5000;
    while (!await js(`Boolean(${expr})`)) {
      if (Date.now() > end) throw new Error(`DOM timeout: ${expr}`);
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  };
  const click = selector => js(`document.querySelector(${JSON.stringify(selector)}).click()`);
  try {
    await win.loadURL(`http://127.0.0.1:${server.address().port}`);
    await wait(`document.querySelector('#content').getAttribute('aria-busy')==='false'`);
    await click('[data-tab="models"]');
    assert.equal(await js(`document.querySelectorAll('.model-channel').length`), 2);
    assert.equal(await js(`document.querySelectorAll('.model-supplier').length`), 3, 'every channel keeps its supplier divider, including single-supplier channels');
    assert.equal(await js(`document.querySelectorAll('input[type=checkbox]').length`), 0);
    const rowHeight = await js(`document.querySelector('.model-row').getBoundingClientRect().height`);
    assert.ok(rowHeight <= 76, `compact row height ${rowHeight}`);
    assert.equal(await js(`document.querySelector('.model-meta .caption').textContent`), '思考：low / high');
    const header = await js(`(() => {const toolbar=document.querySelector('.toolbar').getBoundingClientRect(),title=document.querySelector('.top').getBoundingClientRect(),list=document.querySelector('#model-list').getBoundingClientRect();return {toolbar:toolbar.y,title:title.y,list:list.y};})()`);
    assert.ok(header.toolbar <= 20 && header.title <= 80 && header.list <= 190, JSON.stringify(header));
    assert.equal(await js(`document.querySelector('#main').contains(document.querySelector('.toolbar'))`), false, 'the title row stays outside list scrolling');
    assert.ok(await js(`document.querySelector('#main').getBoundingClientRect().y>=48`), 'model switches cannot scroll into the native control strip');
    assert.equal(await js(`getComputedStyle(document.querySelector('.toolbar')).getPropertyValue('-webkit-app-region')`), 'drag', 'empty title-row space moves the window');
    assert.equal(await js(`getComputedStyle(document.querySelector('#refresh')).getPropertyValue('-webkit-app-region')`), 'no-drag', 'refresh remains clickable within the draggable title row');
    const before = await js(`(() => { document.querySelector('#main').scrollTop=900; globalThis.row=document.querySelector('[data-action="hide-model"][data-id="channel/model-12"]'); globalThis.search=document.querySelector('#model-search'); return {scroll:document.querySelector('#main').scrollTop,y:row.getBoundingClientRect().y}; })()`);
    await click('[data-action="hide-model"][data-id="channel/model-12"]');
    await wait(`!document.querySelector('[data-action="hide-model"][data-id="channel/model-12"]').disabled`);
    const after = await js(`({scroll:document.querySelector('#main').scrollTop,y:row.getBoundingClientRect().y,sameRow:row===document.querySelector('[data-id="channel/model-12"][data-action]'),sameSearch:search===document.querySelector('#model-search'),message:document.querySelector('#message').hidden})`);
    assert.equal(after.scroll, before.scroll); assert.equal(after.y, before.y);
    assert.ok(after.sameRow && after.sameSearch); assert.equal(after.message, true, 'single toggles show no toast'); assert.equal(reads, 1);
    assert.equal(await js(`document.querySelector('[data-scope="supplier"]').getAttribute('aria-checked')`), 'mixed');
    await js(`document.querySelector('[data-action="hide-model"][data-id="channel/model-13"]').click();document.querySelector('[data-action="hide-model"][data-id="channel/model-14"]').click()`);
    await wait(`visibilityPending.size===0`);
    assert.ok(hidden.has('channel/model-13') && hidden.has('channel/model-14'));
    // Supplier switch: mixed -> show all in that supplier only.
    await click('[data-scope="supplier"]'); await wait(`visibilityPending.size===0`);
    assert.equal(writes.at(-1).hidden, false); assert.equal(writes.at(-1).ids.length, 3); assert.ok(hidden.has('other/keep'));
    assert.equal(await js(`document.querySelector('[data-scope="supplier"]').getAttribute('aria-checked')`), 'true');
    // Search-scoped select all.
    await js(`(() => {const input=document.querySelector('#model-search');input.value='Model 1';input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    assert.equal(await js(`document.querySelector('[data-count="all"]').textContent`), '已显示 11 / 11');
    assert.equal(await js(`document.querySelectorAll('.model-supplier').length`), 1, 'search keeps the remaining supplier label');
    assert.equal(await js(`document.querySelector('.model-supplier').textContent.includes('OpenAI')`), true);
    assert.equal(await js(`document.querySelector('[data-action="fold-channel"]').getAttribute('aria-expanded')`), 'true');
    await click('[data-action="fold-channel"]');
    assert.equal(await js(`document.querySelector('.model-channel-body').hidden`), true, 'search result collapses on the first click');
    await click('[data-action="fold-channel"]');
    await click('[data-scope="all"]'); await wait(`visibilityPending.size===0`);
    assert.equal(writes.at(-1).hidden, true); assert.equal(writes.at(-1).ids.length, 11); assert.ok(!hidden.has('channel/model-20'));
    await click('[data-scope="all"]'); await wait(`visibilityPending.size===0`);
    assert.equal(writes.at(-1).hidden, false); assert.equal(writes.at(-1).ids.length, 11); assert.ok(hidden.has('other/keep'));
    await js(`(() => {const input=document.querySelector('#model-search');input.value='';input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    // Channel fold keeps other channels in place.
    await click('[data-action="fold-channel"][data-id="channel"]');
    assert.equal(await js(`document.querySelector('.model-channel-body').hidden`), true);
    await click('[data-action="fold-channel"][data-id="channel"]');
    fail = true;
    await click('[data-action="hide-model"][data-id="channel/model-20"]'); await wait(`visibilityPending.size===0`);
    assert.equal(await js(`document.querySelector('[data-action="hide-model"][data-id="channel/model-20"]').getAttribute('aria-checked')`), 'true');
    assert.equal(await js(`document.querySelector('#message-text').textContent`), 'QA save failed');
    assert.equal(await js(`getComputedStyle(document.querySelector('#message')).position`), 'fixed');
    fail = false;
    await click('[data-filter="shown"]');
    await click('[data-action="hide-model"][data-id="channel/model-20"]'); await wait(`visibilityPending.size===0`);
    assert.equal(await js(`document.querySelector('[data-action="hide-model"][data-id="channel/model-20"]')`), null);
    win.setSize(700, 780);
    await js(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
    assert.equal(await js(`document.documentElement.scrollWidth<=window.innerWidth`), true);
    assert.ok(await js(`document.querySelector('.toolbar-actions').getBoundingClientRect().right<=window.innerWidth-112`), 'narrow desktop header clears window controls');
    win.setSize(390, 844);
    await js(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
    assert.equal(await js(`document.documentElement.scrollWidth<=window.innerWidth`), true);
    // Provider edits exercise the rendered form and its submitted API payload.
    providerFixture = { id: 'qa', name: 'QA API', chat: 'https://example.test/v1', keySet: true, keyMasked: 'qa…key', models: ['long'], modelCount: 1, available: [{ id: 'long', name: 'Long Context', price: fixturePrice, ownPrice: true }], modelPrices: { long: fixturePrice } };
    win.setSize(900, 780);
    await click('#refresh'); await wait(`!document.querySelector('#refresh').disabled`);
    await click('[data-tab="providers"]');
    await click('[data-action="edit-provider"][data-id="qa"]');
    await click('.model-setting>summary');
    await js(`(() => {const input=document.querySelector('[data-price="output"]');input.value='9';input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await js(`(() => {const input=document.querySelector('#provider-model-search');input.value='Long';input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    assert.equal(await js(`document.querySelector('[data-price="output"]').value`), '9', 'redrawing the model list retains edited prices');
    await click('[data-action="add-price-tier"]');
    await click('[data-action="remove-price-tier"]');
    await click('#save'); await wait(`!document.querySelector('#editor').open`);
    assert.deepEqual(providerWrites.at(-1).modelPrefs.long.price, { ...fixturePrice, output: 9, tiers: [{ above: 300000, input: 1, output: 9, cache_read: 0.25, cache_write: 1.25, cache_write_1h: 2 }] }, 'editing one price and replacing a tier retains all five price components');
    await click('[data-action="import-provider"]');
    await js(`document.querySelector('#f-source').value='{"name":"Imported API","chat":"https://example.test/v1"}'`);
    await click('#save'); await wait(`document.querySelector('#f-importKey')`);
    assert.equal(importWrites.length, 1, 'preview does not save a supplier');
    assert.equal(importWrites[0].preview, true);
    await js(`document.querySelector('#f-importKey').value='qa-import-key'`);
    await click('#save'); await wait(`!document.querySelector('#editor').open`);
    assert.equal(importWrites.length, 2);
    assert.equal(importWrites[1].key, 'qa-import-key', 'the separate password field supplies credentials only after preview');
    assert.equal(importWrites[1].text, importWrites[0].text);
    await click('[data-tab="usage"]'); await wait(`document.querySelector('[data-action="subscription-settings"]')`);
    await click('[data-action="subscription-settings"]'); await wait(`document.querySelector('[data-plugin-checkin="daily"]')`);
    assert.equal(await js(`document.querySelector('[data-plugin-checkin="daily"]').checked`), true, 'the adapter default comes from the effective setting');
    await click('#save'); await wait(`!document.querySelector('#editor').open`);
    assert.equal(settingWrites.at(-1).pluginCheckins.daily, true, 'saving other settings preserves the effective adapter check-in default');
    assert.equal(settingWrites.at(-1).pluginCheckins.inactive, false, 'saving does not erase the preference of a temporarily disabled adapter');
    console.log('WHALEBRIDGE_MODELS_RESULT:PASS grouped models, scoped visibility, stable position, pricing tiers, import preview and subscription settings');
  } finally { win.destroy(); await new Promise(resolve => server.close(resolve)); }
}
run().then(() => app.exit(0), error => { console.error(error); app.exit(1); });
