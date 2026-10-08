'use strict';
const { app, BrowserWindow, nativeTheme } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
app.disableHardwareAcceleration();
app.setPath('userData', process.argv[2]);
app.on('window-all-closed', () => {});
const assets = path.resolve(__dirname, '../../vendor/whalebridge/internal/whalebridge/assets');
const calls = [];
let installed = false, releaseInstall, releaseStage, releaseCatalog, catalogHeld = false, failing = false;
let globalSettings = {};
let heldPath, releaseRequest, rejectRequest=false, loginStatus="installing";
const provider = { id:'qa', name:'QA supplier', modelCount:1, models:['qa-model'], chat:'http://127.0.0.1:9999/v1' };
const catalog = () => installed
 ? [{id:'cursor-adapter',pid:'cursor',name:'Cursor',plugin:true,methods:[{type:'oauth',label:'OAuth'}]}]
 : [{id:'claude',name:'Claude'},{id:'cursor',name:'Cursor',package:'@fixture/cursor'}];
const server = http.createServer(async (req,res) => {
 const u = new URL(req.url,'http://127.0.0.1'), json = value => { res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(value)); };
 if (!u.pathname.startsWith('/api/')) {
  const name = u.pathname==='/'?'index.html':u.pathname.slice(1);
  if (!fs.readdirSync(assets).includes(name)) { res.writeHead(404);res.end();return; }
  res.setHeader('Content-Type', {'.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.html':'text/html'}[path.extname(name)]||'application/octet-stream');
  res.end(fs.readFileSync(path.join(assets,name)));return;
 }
 let bytes='';for await (const chunk of req)bytes+=chunk;
 const body=bytes?JSON.parse(bytes):undefined;calls.push({path:u.pathname,body});
 if(u.pathname===heldPath){await new Promise(resolve=>releaseRequest=resolve);if(rejectRequest){res.writeHead(500);res.end('requested operation failed');return;}}
 if(u.pathname==='/api/state')return json({version:'controls-test',providers:[provider,{...provider,id:'qa2',name:'Second supplier',account:true}],models:[{id:'qa/qa-model',name:'QA'}],hidden:[],groups:[{id:'qa-group',name:'QA group',members:['qa/qa-model'],routing:'order'}],presets:[]});
 if(u.pathname==='/api/subscriptions') { if(catalogHeld){releaseCatalog=()=>json(catalog());return;}return json(catalog()); }
 if(u.pathname==='/api/subscription/adapter') {
  assert.equal(req.headers.accept,'application/x-ndjson');res.writeHead(200,{'Content-Type':'application/x-ndjson'});
  res.write(JSON.stringify({phase:'downloading'})+'\n');releaseStage=()=>res.write(JSON.stringify({phase:'installing'})+'\n');
  releaseInstall=()=>{if(failing)res.end(JSON.stringify({error:'installation rejected'})+'\n');else{installed=true;res.end(JSON.stringify({ok:true})+'\n');}};return;
 }
 if(u.pathname==='/api/subscription/adapters')return json({installed:[{id:'qa-adapter',package:'@fixture/qa',name:'QA adapter',version:'1.0.0',enabled:true}],available:[],moves:[],bun:true});
 if(u.pathname==='/api/subscription/adapters/page')return json({readme:'QA usage instructions'});
 if(u.pathname==='/api/subscription/adapters/check')return json({plugins:[{package:'@fixture/qa',status:'unknown',error:'registry offline'}]});
 if(u.pathname==='/api/signin')return json({id:'fixture-login',state:loginStatus});
 if(u.pathname==='/api/signin/fixture-login')return json({id:'fixture-login',state:loginStatus,error:'authorization rejected',url:loginStatus==='waiting'?'https://example.com/login':undefined});
 if(u.pathname==='/api/signin/fixture-login/cancel')return json({ok:true});
 if(u.pathname==='/api/accounts/qa2')return json([{user:'Fixture account',active:true}]);
 if(u.pathname==='/api/accounts/qa2/usage')return json({fixture:{user:'Fixture account',balance:'15'}});
 if(u.pathname==='/api/usage')return json({});
 if(u.pathname==='/api/routes')return json({routes:[]});
 if(u.pathname==='/api/routes/history')return json({days:[{day:'2026-10-08'}],routes:[]});
 if(u.pathname==='/api/subscription/settings')return json({});
 if(u.pathname==='/api/global')return json({settings:globalSettings,modelPrices:{}});
 if(u.pathname==='/api/global/settings'){Object.assign(globalSettings,body);return json({ok:true});}
 if(u.pathname==='/api/quotas/history')return json([]);
 if(u.pathname==='/api/provider/test')return json({results:[{ok:true,protocol:'chat',model:'qa-model',ms:3}]});
 if(u.pathname==='/api/provider/live')return json({providers:[]});
 if(u.pathname==='/api/subscriptions/alerts')return json({sequence:0,alerts:[]});
 if(u.pathname==='/api/provider'||u.pathname==='/api/provider/delete'||u.pathname==='/api/provider/fetch'||u.pathname==='/api/provider/order')return json({ok:true});
 res.writeHead(404);res.end('unknown fixture route');
});
async function run(){
 await app.whenReady();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const win=new BrowserWindow({width:1120,height:780,show:false,webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
 if(process.env.WHALEBRIDGE_QA_SCREENSHOTS)win.showInactive();
 win.webContents.on('console-message',details=>{if(details.level==='error')console.error(details.message);});
 const js=async s=>{try{return await win.webContents.executeJavaScript(s);}catch(error){throw Error(`${error.message}\nCommand: ${s}`);}},click=s=>js(`document.querySelector(${JSON.stringify(s)}).click()`);
 const wait=async s=>{const end=Date.now()+7000;while(Date.now()<end){if(await js(`Boolean(${s})`))return;await new Promise(r=>setTimeout(r,20));}throw Error('Unsettled: '+s);};
 const screenshot=async name=>{if(!process.env.WHALEBRIDGE_QA_SCREENSHOTS)return;await js(`Promise.all(document.getAnimations().filter(a=>a.effect.getTiming().iterations!==Infinity).map(a=>a.finished))`);await js(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);fs.mkdirSync(process.env.WHALEBRIDGE_QA_SCREENSHOTS,{recursive:true});fs.writeFileSync(path.join(process.env.WHALEBRIDGE_QA_SCREENSHOTS,name+'.png'),(await win.webContents.capturePage()).toPNG());};
 const close=()=>js(`new Promise(r=>{const d=document.querySelector('#editor');d.addEventListener('close',r,{once:true});d.close();})`);
 const subscribe=async()=>{releaseInstall=undefined;await click('[data-action="subscription"]');await wait(`document.querySelector('#editor').open&&editor?.type==='subscription'&&!editor.closed&&document.querySelector('#f-agent option[value="cursor"]')`);await js(`document.querySelector('#f-agent').value='cursor';document.querySelector('#f-agent').dispatchEvent(new Event('change'))`);};
 const installStarted=async()=>{const end=Date.now()+7000;while(!releaseInstall&&Date.now()<end)await new Promise(r=>setTimeout(r,20));assert.ok(releaseInstall,'installation request reached backend');};
 try{
  await win.loadURL(`http://127.0.0.1:${server.address().port}/`);await wait(`document.querySelector('#content').getAttribute('aria-busy')==='false'`);
  await subscribe();await click('[data-action="install-adapter"]');await wait(`document.querySelector('[data-action="install-adapter"] .button-spinner')`);
  assert.equal(await js(`document.querySelector('#f-agent').disabled&&document.querySelector('#save').disabled`),true);
  assert.equal(await js(`document.querySelector('#adapter-progress progress')`),null,'no progress bar');
  assert.equal(await js(`document.querySelector('[data-action="install-adapter"]').textContent`),'下载中');
  await screenshot('downloading-button');await installStarted();releaseStage();await wait(`document.querySelector('[data-action="install-adapter"]').textContent==='安装中'`);
  await screenshot('installing-button');releaseInstall();await wait(`document.querySelector('#f-agent').value==='cursor-adapter'&&!document.querySelector('#adapter-progress').hidden`);
  assert.match(await js(`document.querySelector('#adapter-progress').textContent`),/已安装/);await close();
  installed=false;failing=true;await subscribe();await click('[data-action="install-adapter"]');await wait(`document.querySelector('[data-action="install-adapter"] .button-spinner')`);await installStarted();releaseInstall();
  await wait(`!document.querySelector('#form-error').hidden`);assert.match(await js(`document.querySelector('#form-error').textContent`),/installation rejected/);
  assert.equal(await js(`document.querySelector('#f-agent').disabled||document.querySelector('#save').disabled`),false);await close();
  failing=false;await subscribe();await click('[data-action="install-adapter"]');await wait(`document.querySelector('[data-action="install-adapter"] .button-spinner')`);await installStarted();releaseStage();catalogHeld=true;releaseInstall();await wait(`document.querySelector('[data-action="install-adapter"]').textContent==='安装中'`);
  while(!releaseCatalog)await new Promise(r=>setTimeout(r,20));
  await close();await click('[data-action="add-provider"]');await wait(`editor?.type==='provider'`);releaseCatalog();catalogHeld=false;
  await wait(`document.querySelector('#editor-title').textContent==='添加供应商'`);assert.equal(await js(`document.querySelector('#adapter-progress').hidden`),true);await close();
  await click('[data-tab="providers"]');await wait(`document.querySelector('details.menu summary')`);
  for(const scheme of ['light','dark']){nativeTheme.themeSource=scheme;
   for(const [width,height] of [[1120,780],[380,520]]){
    win.setContentSize(width,height);
    await wait(`innerWidth===${width}&&innerHeight===${height}`);
    await js(`document.querySelector('.management-table-wrap').scrollLeft=9999`);
    await js(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
    await click('details.menu summary');await wait(`document.querySelector('.menu-content:popover-open')`);
    await screenshot(`menu-${scheme}-${width}`);
    const geometry=await js(`(()=>{const m=document.querySelector('.menu-content:popover-open');if(!m)return {closed:true};const r=m.getBoundingClientRect(),hit=document.elementFromPoint(r.left+10,r.top+10);return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight,hit:hit?.outerHTML,hitMenu:hit?.closest('.menu-content')===m}})()`);
    assert.ok(!geometry.closed&&geometry.left>=0&&geometry.right<=geometry.width&&geometry.top>=0&&geometry.bottom<=geometry.height&&geometry.hitMenu,JSON.stringify({scheme,width,geometry}));
    await js(`document.querySelector('.menu-content:popover-open').dispatchEvent(new Event('scroll'))`);
    assert.equal(await js(`!!document.querySelector('.menu-content:popover-open')`),true,'menu own scroll does not close');
    await js(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
    assert.equal(await js(`!!document.querySelector('.menu-content:popover-open')`),false);assert.equal(await js(`document.activeElement.matches('details.menu summary')`),true);
   }
  }
  win.setContentSize(1120,780);await click('details.menu summary');await click('.menu-content [data-action="toggle-provider"]');await wait(`document.querySelector('#message-text').textContent.includes('已更新')&&!document.querySelector('#refresh').disabled`);
  assert.ok(calls.some(c=>c.path==='/api/provider'&&c.body.off===true));
  await click('[data-action="manage-adapters"]');await wait(`document.querySelector('[data-action="adapter-page"]')`);await click('[data-action="adapter-page"]');await wait(`editor?.type==='adapter-readme'`);await click('#fields [data-action="manage-adapters"]');await wait(`editor?.type==='adapters'`);
  await click('[data-action="adapter-check"]');await wait(`!document.querySelector('#form-error').hidden`);assert.match(await js(`document.querySelector('#form-error').textContent`),/registry offline/);await close();
  await click('[data-tab="routing"]');await wait(`document.querySelector('[data-action="remove-selected-groups"]')`);await click('[data-action="remove-selected-groups"]');await wait(`!document.querySelector('#message').hidden`);
  assert.match(await js(`document.querySelector('#message-text').textContent`),/请先选择/);assert.equal(await js(`document.querySelector('#message').dataset.error`),'true');
  assert.ok(!calls.some(c=>c.path==='/api/group/delete'));
  await click('[data-tab="settings"]');await wait(`document.querySelector('#global-form [name="proxyMode"]')`);
  const changeProxy=mode=>js(`(()=>{const p=document.querySelector('#global-form [name="proxyMode"]');p.value=${JSON.stringify(mode)};p.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await changeProxy('custom');assert.equal(await js(`!document.querySelector('#content #proxy-address').hidden&&document.querySelector('#content [name="proxy"]').required`),true);
  await js(`document.querySelector('#content [name="proxy"]').value='http://127.0.0.1:7890'`);await click('#global-form [type="submit"]');await wait(`!document.querySelector('#refresh').disabled&&document.querySelector('#message-text').textContent==='设置已保存'`);
  assert.equal(globalSettings.proxy,'http://127.0.0.1:7890');await changeProxy('direct');assert.equal(await js(`document.querySelector('#content #proxy-address').hidden&&!document.querySelector('#content [name="proxy"]').required`),true);
  await click('#global-form [type="submit"]');await wait(`!document.querySelector('#refresh').disabled&&globalData.settings.proxy==='direct'`);assert.equal(globalSettings.proxy,'direct');
  // Hold real HTTP responses: feedback must stay in the originating control.
  const held=async()=>{const end=Date.now()+7000;while(!releaseRequest&&Date.now()<end)await new Promise(r=>setTimeout(r,20));assert.ok(releaseRequest,'request reached backend');};
  const release=()=>{heldPath=undefined;const resolve=releaseRequest;releaseRequest=undefined;resolve();};
  await click('[data-tab="providers"]');await wait(`document.querySelector('details.menu summary')`);
  heldPath='/api/provider/fetch';await click('details.menu summary');await click('.menu-content [data-action="fetch-provider"]');await held();
  assert.equal(await js(`!document.querySelector('.menu-content:popover-open')&&!!document.querySelector('details.menu summary .button-spinner')`),true,'closed menu retains spinner in visible trigger');
  await screenshot('menu-refresh-busy');release();await wait(`!document.querySelector('#refresh').disabled&&!document.querySelector('details.menu summary .button-spinner')`);
  await click('[data-action="edit-provider"]');await wait(`editor?.type==='provider'`);
  heldPath='/api/provider/test';rejectRequest=true;await click('[data-action="test-provider"]');await held();
  assert.equal(await js(`document.querySelector('[data-action="test-provider"]').textContent`),'测试中');await screenshot('provider-test-busy');
  release();await wait(`!document.querySelector('#form-error').hidden`);assert.match(await js(`document.querySelector('#form-error').textContent`),/requested operation failed/);
  assert.equal(await js(`document.querySelector('[data-action="test-provider"]').disabled||!!document.querySelector('[data-action="test-provider"] .button-spinner')`),false,'failed test restores button');rejectRequest=false;await close();
  await click('[data-tab="settings"]');await wait(`document.querySelector('#global-form')`);
  heldPath='/api/global/settings';await click('#global-form [type="submit"]');await held();
  assert.equal(await js(`document.querySelector('#global-form [type="submit"]').textContent`),'保存中');for(const scheme of ['light','dark']){nativeTheme.themeSource=scheme;await screenshot('settings-save-busy-'+scheme);const colors=await js(`(()=>{const c=getComputedStyle(document.querySelector('#global-form [type=submit]'));return {text:c.color,background:c.backgroundColor}})()`);assert.notEqual(colors.text,colors.background,'busy primary has visible foreground');}
  release();await wait(`!document.querySelector('#refresh').disabled&&document.querySelector('#global-form [type="submit"]').textContent==='保存设置'`);
  await click('[data-tab="providers"]');await wait(`document.querySelector('[data-action="manage-adapters"]')`);await click('[data-action="manage-adapters"]');await wait(`editor?.type==='adapters'`);
  heldPath='/api/subscription/adapters/check';await click('[data-action="adapter-check"]');await held();
  assert.equal(await js(`document.querySelector('[data-action="adapter-check"]').textContent`),'检查中');await screenshot('adapter-check-busy');release();await wait(`!document.querySelector('#form-error').hidden`);await close();
  heldPath='/api/state';await click('#refresh');await held();assert.equal(await js(`!!document.querySelector('#refresh .button-spinner')`),true);release();await wait(`!document.querySelector('#refresh').disabled`);
  heldPath='/api/accounts/qa2/usage';await click('[data-action="accounts"][data-id="qa2"]');
  await wait(`editor?.type==='accounts'`);await held();
  assert.equal(await js(`document.querySelector('[data-action="accounts-refresh"]').textContent`),'刷新中');
  assert.equal(await js(`document.querySelector('[data-account-quota]').textContent`),'');await screenshot('account-quota-busy');
  release();await wait(`document.querySelector('[data-account-quota]').textContent==='15'&&!document.querySelector('[data-action="accounts-refresh"]').disabled`);await close();
  installed=false;await subscribe();await js(`document.querySelector('#f-agent').value='claude';document.querySelector('#f-agent').dispatchEvent(new Event('change'))`);await click('#save');
  await wait(`document.querySelector('#save').textContent==='准备中'`);assert.equal(await js(`!document.querySelector('#save').hidden&&!!document.querySelector('#save .button-spinner')`),true);await screenshot('auth-tool-busy');
  loginStatus='waiting';await wait(`document.querySelector('#fields a')`);assert.equal(await js(`document.querySelector('#save').textContent`),'等待授权');
  loginStatus='failed';await wait(`!document.querySelector('#form-error').hidden`);assert.equal(await js(`document.querySelector('#save').disabled||!!document.querySelector('#save .button-spinner')`),false);await close();
  await click('[data-tab="usage"]');await wait(`document.querySelector('[data-global-section="routing"]')`);await click('[data-global-section="routing"]');await wait(`document.querySelector('#route-day')`);
  heldPath='/api/routes';await click('[data-global="live-routes"]');await held();const releaseLive=releaseRequest;
  heldPath='/api/routes/history';releaseRequest=undefined;await js(`document.querySelector('#route-day').value='2026-10-08';document.querySelector('#route-day').dispatchEvent(new Event('change'))`);await held();
  releaseLive();await js(`new Promise(r=>setTimeout(r,100))`);assert.equal(await js(`document.querySelector('[data-global="live-routes"]').disabled`),true,'old operation must not unlock newer wait');release();await wait(`!document.querySelector('[data-global="live-routes"]').disabled`);
  console.log('WHALEBRIDGE_CONTROLS_RESULT:'+JSON.stringify({progress:true,failure:true,staleCompletion:true,menu:true,keyboard:true,returnButton:true,updateFailure:true,groupFeedback:true,globalProxy:true,buttonFeedback:true,authPreparation:true,accountQuota:true,busyOwnership:true}));
 }finally{win.destroy();server.closeAllConnections();await new Promise(r=>server.close(r));}
}
run().then(()=>app.exit(0)).catch(error=>{console.error(error.stack);app.exit(1);});
