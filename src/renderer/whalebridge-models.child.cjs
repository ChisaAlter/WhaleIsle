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
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const json = body => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)); };
  if (url.pathname === '/api/state') {
    reads++;
    return json({ version: 'test', providers: [], models: rows.filter(m => !hidden.has(m.id)), hidden: rows.filter(m => hidden.has(m.id)), groups: [] });
  }
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
    console.log('WHALEBRIDGE_MODELS_RESULT:PASS scroll, stable DOM, grouped sources, scoped switches, fold, queued writes, failure rollback, filters and mobile layout');
  } finally { win.destroy(); await new Promise(resolve => server.close(resolve)); }
}
run().then(() => app.exit(0), error => { console.error(error); app.exit(1); });
