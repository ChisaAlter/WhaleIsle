'use strict';

// Exercise the installed Go component through the production native window.
// Every agent/config home and every write belongs to one temporary profile.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const { createHash } = require('node:crypto');
const { spawn } = require('node:child_process');
const repo = path.resolve(__dirname, '..');
const marker = 'WHALEBRIDGE_AGENTS_QA:';
// QA owns this isolation boundary; the host does not need the component's
// Go source tree to run its native integration acceptance.
const agentEnvironment = [
 'CLAUDE_CONFIG_DIR', 'CODEX_HOME', 'COPILOT_HOME', 'GEMINI_CLI_HOME',
 'CLINE_DIR', 'CLINE_DATA_DIR', 'CLINE_SESSION_DATA_DIR', 'CLINE_MCP_SETTINGS_PATH',
 'PI_CODING_AGENT_DIR', 'PI_CODING_AGENT_SESSION_DIR', 'PI_CONFIG_DIR', 'PI_PROFILE',
 'OMO_CODING_AGENT_DIR', 'SENPI_CODING_AGENT_DIR', 'OMP_PROFILE',
 'QODER_CONFIG_DIR', 'QODERCN_CONFIG_DIR', 'GROK_HOME', 'GROK_BIN_DIR',
 'KIMI_CODE_HOME', 'KIMI_SHARE_DIR', 'MIMOCODE_HOME', 'MINIMAX_DATA_DIR',
 'HANA_HOME', 'HERMES_HOME', 'DSH_HOME', 'WORKBUDDY_CONFIG_DIR',
 'MISTER_MORPH_CONFIG', 'T3CODE_HOME', 'ATOMCODE_HOME', 'CURSOR_CONFIG_DIR', 'CURSOR_DATA_DIR',
 'OPENCODE_CONFIG_DIR', 'OPENCODE_DB', 'OPENCHAMBER_DATA_DIR',
 'FACTORY_HOME_OVERRIDE', 'WINDSURF_API_SERVER_URL', 'ZCODE_CREDENTIAL_SECRET',
];

async function launch() {
 const electron = process.env.ELECTRON_PATH || path.join(repo, 'node_modules/electron/dist/electron.exe');
 assert.ok(fs.existsSync(electron), 'provide ELECTRON_PATH for the production Electron runtime');
 const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'whalebridge-agents-'));
 const output = path.resolve(process.env.WHALEBRIDGE_QA_SCREENSHOTS || path.join(repo, '.tmp/whalebridge-agents-qa'));
 const payload = path.resolve(process.env.WHALEBRIDGE_QA_PACKAGE || path.join(repo, '.tmp/whalebridge-package'));
 fs.mkdirSync(output, { recursive: true });
 const env = { ...process.env }, home = path.join(profile, 'home');
 for(const key of Object.keys(env))if(agentEnvironment.includes(key.toUpperCase()) || /^(MAGPIE|WHALEBRIDGE|LAUNCHER_COMPONENT)_/i.test(key) || key.toUpperCase()==='ELECTRON_RUN_AS_NODE')delete env[key];
 Object.assign(env, { HOME: home, USERPROFILE: home, APPDATA: path.join(home, 'AppData/Roaming'),
  LOCALAPPDATA: path.join(home, 'AppData/Local'), XDG_CONFIG_HOME: path.join(home, '.config'),
  XDG_DATA_HOME: path.join(home, '.local/share'), XDG_STATE_HOME: path.join(home, '.local/state'),
  XDG_CACHE_HOME: path.join(home, '.cache'), CODEX_HOME: path.join(home, '.codex'),
  CLAUDE_CONFIG_DIR: path.join(home, '.claude'), TEMP: path.join(profile, 'temp'), TMP: path.join(profile, 'temp') });
 for(const directory of [home, env.APPDATA, env.LOCALAPPDATA, env.CODEX_HOME, env.CLAUDE_CONFIG_DIR, env.TEMP])fs.mkdirSync(directory, { recursive: true });
 let stdout='', stderr='', timedOut=false;
 try {
  const code=await new Promise((resolve,reject)=>{
   const child=spawn(electron,[__filename,'--child',profile,output,payload,...process.argv.filter(arg=>['--visual-only','--error-only','--split-smoke'].includes(arg))],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});
   child.stdout.on('data',data=>{stdout+=data;});
   child.stderr.on('data',data=>{stderr+=data;process.stderr.write(data);});
   const timer=setTimeout(()=>{timedOut=true;require('../src/main/git-exec').killProcessTree(child);},150000);
   child.once('error',error=>{clearTimeout(timer);reject(error);});
   child.once('close',code=>{clearTimeout(timer);resolve(code);});
  });
  const line=stdout.split(/\r?\n/).find(line=>line.startsWith(marker));
  if(line){const result=JSON.parse(line.slice(marker.length));fs.writeFileSync(path.join(output,result.splitSmoke?'split-native-result.json':result.errorOnly?'inline-error-result.json':result.visualOnly?'visual-fields-result.json':'result.json'),JSON.stringify(result,null,2));}
  if(code!==0 || !line || timedOut)throw new Error(`Agent native QA ${timedOut?'timed out':`exit ${code}`}\n${stderr}\n${stdout}`);
  process.stdout.write(line+'\n');
 } finally {
  const relative=path.relative(path.resolve(os.tmpdir()),path.resolve(profile));
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative),'temporary cleanup stays inside os.tmpdir');
  fs.rmSync(profile,{recursive:true,force:true});
 }
}

async function runNative() {
 // Electron initializes its app loader before honoring the development
 // dependency path supplied by the parent Node process.
 if(process.env.NODE_PATH)require('node:module').Module._initPaths();
 const { app, BrowserWindow, nativeTheme } = require('electron');
 const profile=process.argv[3], output=process.argv[4], payload=process.argv[5];
 app.setPath('userData',path.join(profile,'electron'));
 app.on('window-all-closed',()=>{});
 const { createWhaleBridgeService }=require('../src/launcher/whalebridge');
 const { openWhaleBridgeWindow, closeWhaleBridgeWindow }=require('../src/main/whalebridge-window');
 const { isPidAlive }=require('../src/launcher/components/lifecycle');
 const root=path.join(profile,'component'), dshHome=path.join(profile,'dsh'), codexPath=path.join(process.env.CODEX_HOME,'config.toml');
 const dshPatch=path.join(dshHome,'profiles/web/cordis.patch.yml');
 const original='model = "qa-original"\nmodel_reasoning_effort = "low"\n';
 fs.writeFileSync(codexPath,original);
 fs.mkdirSync(path.dirname(dshPatch),{recursive:true});
 fs.writeFileSync(dshPatch,'- id: agent-default-model\n  config:\n    provider: qa-original-provider\n    model: qa-original-model\n');
 const manifest=JSON.parse(fs.readFileSync(path.join(payload,'WhaleBridge-component.json'),'utf8'));
 const binary=fs.readFileSync(path.join(payload,'WhaleBridge-win32-x64.exe'));
 const result={binary:{version:manifest.version,size:binary.length,sha256:createHash('sha256').update(binary).digest('hex')},visualOnly:process.argv.includes('--visual-only'),errorOnly:process.argv.includes('--error-only'),splitSmoke:process.argv.includes('--split-smoke'),checks:[],screenshots:[],layouts:[],requests:[],rendererErrors:[]};
 const record=(name,data)=>{result.checks.push({name,...data});process.stderr.write(`agents QA: ${name}\n`);};
 let service,win,pid;
 const vendor=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1');
  for await(const unused of req) { /* Drain the local request body. */ }
  const json=value=>{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
  if(url.pathname==='/v1/models')return json({data:[{id:'qa-model-a',name:'QA model A',context_window:128000},{id:'qa-model-b',name:'QA model B',context_window:256000}]});
  if(url.pathname==='/v1/chat/completions')return json({id:'qa-completion',object:'chat.completion',choices:[{index:0,message:{role:'assistant',content:'QA component connected'},finish_reason:'stop'}],usage:{prompt_tokens:1,completion_tokens:3,total_tokens:4}});
  if(url.pathname==='/v1/responses')return json({id:'qa-response',object:'response',status:'completed',output:[{id:'qa-message',type:'message',role:'assistant',content:[{type:'output_text',text:'QA component connected',annotations:[]}]}],usage:{input_tokens:1,output_tokens:3,total_tokens:4}});
  res.writeHead(404);res.end('unknown local QA vendor route');
 });
 const freePort=async()=>{const listener=net.createServer();await new Promise(resolve=>listener.listen(0,'127.0.0.1',resolve));const port=listener.address().port;await new Promise(resolve=>listener.close(resolve));return port;};
 try {
  await app.whenReady();await new Promise(resolve=>vendor.listen(0,'127.0.0.1',resolve));
  const gatewayPort=await freePort();
  service=createWhaleBridgeService({root,dshHome,devPackage:payload,spawn:(file,args,options)=>spawn(file,args,{...options,env:{...options.env,MAGPIE_ADDR:`127.0.0.1:${gatewayPort}`}})});
  const installed=await service.install();assert.equal(installed.ok,true,installed.message);
  pid=service.state().pid;
  const management=new URL(service.state().url), cookie=`magpie_web_${management.port}=${management.searchParams.get('k')}`;
  const backend=async(route,body)=>{
   const response=await fetch(`${management.origin}/api/${route}`,{method:body===undefined?'GET':'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
   const text=await response.text();assert.ok(response.ok,`${route}: HTTP ${response.status}: ${text}`);return JSON.parse(text);
  };
  const vendorBase=`http://127.0.0.1:${vendor.address().port}/v1`;
  await backend('provider',{id:'qa',name:'QA local vendor',new:true,key:'qa-local-vendor-key',chat:vendorBase,responses:vendorBase,models:['qa-model-a','qa-model-b'],modelPrefs:{'qa-model-a':{efforts:['low','medium','high']},'qa-model-b':{efforts:['low','medium','high']}}});
  openWhaleBridgeWindow(service.state().url,{activate:false});
  win=BrowserWindow.getAllWindows()[0];assert.ok(win,'production native WhaleBridge window exists');
  win.webContents.on('console-message',details=>{if(details.level==='error')result.rendererErrors.push(details.message);});
  win.webContents.session.webRequest.onBeforeRequest((details,callback)=>{
   const url=new URL(details.url);if(url.origin===management.origin && url.pathname.startsWith('/api/'))result.requests.push({method:details.method,path:url.pathname});callback({});
  });
  const js=source=>win.webContents.executeJavaScript(source);
  const wait=async(condition,label=condition)=>{const end=Date.now()+10000;while(Date.now()<end){if(await js(`Boolean(${condition})`))return;await new Promise(resolve=>setTimeout(resolve,40));}throw new Error(`native renderer did not settle: ${label}`);};
  const click=selector=>js(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const chooseAgent=async id=>{await js(`(()=>{const target=document.querySelector('#agent-target');target.value=${JSON.stringify(id)};target.dispatchEvent(new Event('change',{bubbles:true}));})()`);await wait(`document.querySelector('#agent-target')?.value===${JSON.stringify(id)}`);};
  const awaitWrite=()=>wait(`document.querySelector('#agents-page') && document.querySelector('#agent-target')?.disabled===false && !document.querySelector('#agents-page [aria-busy="true"]')`);
  const capture=async name=>{await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');const image=await win.webContents.capturePage();assert.ok(!image.isEmpty(),'native target screenshot has rendered pixels');const file=path.join(output,name+'.png');fs.writeFileSync(file,image.toPNG());result.screenshots.push({file,...image.getSize()});};
  const fieldState=key=>js(`(()=>{const form=document.querySelector('[data-agent-field='+CSS.escape(${JSON.stringify(key)})+']');return {value:form.querySelector('select').value,current:form.querySelector('.agent-field-heading .caption').textContent,disabled:form.querySelector('button').disabled}})()`);
  const selectField=(key,value)=>js(`(()=>{const select=document.querySelector('[data-agent-field='+CSS.escape(${JSON.stringify(key)})+'] select');select.value=${JSON.stringify(value)};select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  const applyField=async key=>{await click(`[data-agent-field="${key}"] button`);await awaitWrite();};
  const resize=async(width,height)=>{
   win.setBounds({width,height});
   const actual=win.getContentBounds();
   await wait(`innerWidth===${actual.width} && innerHeight===${actual.height}`);
   const geometry={requested:{width,height},bounds:win.getBounds(),contentBounds:actual,renderer:await js('({width:innerWidth,height:innerHeight,dpr:devicePixelRatio})')};
   assert.ok(Math.abs(actual.width-width)<=1 && Math.abs(actual.height-height)<=1,'native dimensions remain in the requested normal/narrow scenario');
   return geometry;
  };
  await wait(`document.querySelector('#content').getAttribute('aria-busy')==='false' && document.querySelector('[data-tab="agents"]')`);
  await click('[data-tab="agents"]');await wait(`document.querySelector('#agent-target') && document.querySelector('#content').getAttribute('aria-busy')==='false'`);
  assert.equal(await js(`document.querySelector('#agent-target').value`),'dsh');
  assert.equal(await js(`document.querySelector('#agent-target').options[0].value`),'dsh');
  assert.equal(await js(`document.querySelectorAll('[data-agent-field]').length`),0);
  assert.equal(await js(`!!document.querySelector('[data-agent-action="disconnect"],[data-agent-action="connect"]')`),false);
  const dshBefore=fs.readFileSync(dshPatch,'utf8');assert.match(dshBefore,/qa-original-provider/);assert.match(dshBefore,/qa-original-model/);
  record('default whale connection',{selected:'dsh',nativeVisible:win.isVisible(),nativeFocused:win.isFocused()});
  if(result.splitSmoke){nativeTheme.themeSource='light';result.layouts.push({native:await resize(380,600)});await capture('split-default-whale-light-380x600');}
  else if(!result.errorOnly)await capture('default-whale-light-1120x780');
  const writesBefore=result.requests.filter(row=>row.method==='POST').length;
  await chooseAgent('codex');
  assert.equal(fs.readFileSync(codexPath,'utf8'),original);
  assert.equal(result.requests.filter(row=>row.method==='POST').length,writesBefore);
  const rows=await backend('agents'), codex=rows.agents.find(row=>row.id==='codex');
  assert.ok(codex.detected && !codex.connected);assert.ok(path.resolve(codex.path).startsWith(path.resolve(profile)+path.sep));
  record('browse has no writes',{agentCount:rows.agents.length,detected:codex.detected,connected:codex.connected});
  await click('[data-agent-action="connect"]');await awaitWrite();
  assert.ok((await backend('agents')).agents.find(row=>row.id==='codex').connected);
  const connectedConfig=fs.readFileSync(codexPath,'utf8');assert.match(connectedConfig,/model_provider\s*=\s*"magpie"/);assert.match(connectedConfig,/qa-model-/);
  record('explicit native Codex connection',{configWritten:true});
  if(result.splitSmoke){
   if(await js(`!document.querySelector('#message').hidden`))await click('#dismiss-message');
   await js(`document.querySelector('.agent-card').scrollIntoView({block:'start'})`);
   await capture('split-codex-connected-light-380x600');
   assert.equal(await js(`document.querySelector('#narrow-page').value`),'agents');
   await click('[data-agent-action="disconnect"]');await awaitWrite();
   const row=(await backend('agents')).agents.find(row=>row.id==='codex');assert.ok(!row.connected && !row.managed);
   const restored=fs.readFileSync(codexPath,'utf8');assert.match(restored,/model\s*=\s*"qa-original"/);assert.match(restored,/model_reasoning_effort\s*=\s*"low"/);
   assert.equal(fs.readFileSync(dshPatch,'utf8'),dshBefore,'standalone component client actions preserve the WhaleIsle route and default');
   assert.equal(win.isFocused(),false);assert.deepEqual(result.rendererErrors,[]);
   record('standalone package native disconnect',{originalModelRestored:true,originalEffortRestored:true,whaleProfileUnchanged:true});
   result.ok=true;return;
  }
  if(result.errorOnly){
   const config=fs.readFileSync(codexPath,'utf8'), drifted=config.replace(/^[ \t]*base_url\s*=\s*"[^"]*"/m,'base_url = "http://127.0.0.1:9/v1"');
   assert.notEqual(drifted,config);fs.writeFileSync(codexPath,drifted);
   await click('#refresh');await wait(`document.querySelector('.agent-sync-error') && !document.querySelector('#refresh').disabled`);
   nativeTheme.themeSource='light';const native=await resize(1120,780);
   if(await js(`!document.querySelector('#message').hidden`))await click('#dismiss-message');
   await js(`document.querySelector('.agent-card').scrollIntoView({block:'start'})`);
   const row=(await backend('agents')).agents.find(row=>row.id==='codex');
   assert.ok(row.managed && !row.connected && row.syncError);
   assert.equal(row.fields.find(field=>field.key==='model').value,'qa/qa-model-a');
   assert.equal(await js(`document.querySelector('.agent-card').textContent.includes('已切换到自身模型')`),false,'gateway drift never claims the user selected a native model');
   assert.ok(await js(`!!document.querySelector('.agent-sync-error[role="alert"]')`));
   assert.ok(await js(`!!document.querySelector('[data-agent-action="disconnect"]') && document.querySelector('[data-agent-field="model"] select').disabled`),'protected configuration and cleanup actions remain intact');
   await capture('inline-sync-error-final-light-1120x780');
   record('drift error copy and protected actions',{nativeModelClaimAbsent:true,specificErrorVisible:true,protectedFields:true,cleanupReachable:true});
   result.layouts.push({native});result.ok=true;return;
  }
  if(result.visualOnly){
   await resize(380,600);
   assert.ok(await js(`document.querySelector('#narrow-page').getBoundingClientRect().height>0 && document.querySelector('#narrow-page').labels[0].textContent==='页面选择'`),'the narrow page selector is visible and has an accessible label');
   const narrowPages=await js(`Array.from(document.querySelector('#narrow-page').options,option=>option.value)`);
   assert.deepEqual(narrowPages,['overview','agents','providers','models','routing','usage','settings','help'],'the compact selector retains every original page');
   const choosePage=async value=>{await js(`(()=>{const select=document.querySelector('#narrow-page');select.value=${JSON.stringify(value)};select.dispatchEvent(new Event('change',{bubbles:true}));})()`);await wait(`document.querySelector('#content').getAttribute('aria-busy')==='false' && document.querySelector('#narrow-page').value===${JSON.stringify(value)}`);};
   await choosePage('help');assert.ok(await js(`!!document.querySelector('.help-intro')`));
   await choosePage('models');assert.ok(await js(`!!document.querySelector('#model-list')`));
   await choosePage('agents');await wait(`document.querySelector('#agent-target')?.value==='codex'`);
   record('compact native select navigation',{allPagesPreserved:true,helpAndModelsReached:true,agentSelectionRetained:true});
   const dismiss=async()=>{if(await js(`!document.querySelector('#message').hidden`))await click('#dismiss-message');};
   const inspect=async(scheme,width,height,selector,name)=>{
    nativeTheme.themeSource=scheme;const native=await resize(width,height);await dismiss();
    await js(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'start'})`);await capture(name);
    const geometry=await js(`(()=>{const main=document.querySelector('#main');const overflow=[...document.querySelectorAll('#agents-page select,#agents-page textarea,#agents-page button,#agents-page label,.agent-path dd,.agent-sync-error')].flatMap(node=>{const r=node.getBoundingClientRect();return r.width && (r.left< -1 || r.right>innerWidth+1)?[{tag:node.tagName,left:r.left,right:r.right}]:[]});return {documentOverflow:document.documentElement.scrollWidth-innerWidth,mainOverflow:main.scrollWidth-main.clientWidth,mainVisibleHeight:main.getBoundingClientRect().height,sidebarHeight:document.querySelector('.sidebar').getBoundingClientRect().height,overflow}})()`);
    assert.ok(geometry.documentOverflow===0 && geometry.mainOverflow===0 && geometry.overflow.length===0,JSON.stringify(geometry));
    if(width===380)assert.ok(geometry.mainVisibleHeight>=400,'compact navigation leaves enough main viewport for agent actions and fields');
    result.layouts.push({name,scheme,native,...geometry});
   };
   for(const scheme of ['light','dark']){
    await inspect(scheme,1120,780,'#content',`connected-${scheme}-1120x780`);
    await inspect(scheme,1120,780,'.agent-fields',`connected-fields-${scheme}-1120x780`);
    await inspect(scheme,380,600,'#content',`connected-${scheme}-380x600`);
    await inspect(scheme,380,600,'.agent-card',`connected-card-${scheme}-380x600`);
    await inspect(scheme,380,600,'.agent-fields',`connected-fields-${scheme}-380x600`);
   }
   await chooseAgent('cindy');await click('[data-agent-action="import"]');await awaitWrite();
   await inspect('light',380,600,'.agent-material','cindy-import-material-light-380x600');
   await chooseAgent('agy');await click('[data-agent-action="connect"]');await awaitWrite();await click('[data-agent-action="launch"]');await awaitWrite();
   await inspect('dark',380,600,'.agent-material','agy-launch-material-dark-380x600');
   await chooseAgent('codex');
   const config=fs.readFileSync(codexPath,'utf8');fs.writeFileSync(codexPath,config.replace(/^[ \t]*base_url\s*=\s*"[^"]*"/m,'base_url = "http://127.0.0.1:9/v1"'));
   await click('#refresh');await wait(`document.querySelector('.agent-sync-error') && !document.querySelector('#refresh').disabled`);
   await inspect('light',1120,780,'.agent-card','inline-sync-error-light-1120x780');
   assert.equal(win.isFocused(),false,'visual inspection never takes user input focus');
   record('settled native fields/material/error visuals',{horizontalOverflow:0});
   result.ok=true;return;
  }
  const catalogRef=connectedConfig.match(/^model_catalog_json\s*=\s*"([^"]+)"/m)?.[1];
  assert.ok(catalogRef && !path.isAbsolute(catalogRef),'Windows catalog reference is relative to the agent config');
  assert.ok(fs.existsSync(path.resolve(path.dirname(codexPath),catalogRef)),'the relative reference resolves to the generated catalog');
  const codexExe=process.env.WHALEBRIDGE_QA_CODEX || 'C:\\Users\\48818\\Tools\\codex\\bin\\codex.exe';
  assert.ok(fs.existsSync(codexExe),'the local Codex CLI is available for catalog readback');
  const cliOutput=await new Promise((resolve,reject)=>{
   const child=spawn(codexExe,['debug','models'],{cwd:process.env.CODEX_HOME,env:{...process.env},windowsHide:true,stdio:['ignore','pipe','pipe']});
   let stdout='',stderr='';child.stdout.on('data',data=>stdout+=data);child.stderr.on('data',data=>stderr+=data);
   const timeout=setTimeout(()=>{require('../src/main/git-exec').killProcessTree(child);reject(new Error('Codex catalog readback timed out'));},20000);
   child.once('error',error=>{clearTimeout(timeout);reject(error);});
   child.once('close',code=>{clearTimeout(timeout);if(code!==0)return reject(new Error(`Codex debug models exit ${code}: ${stderr}`));resolve(stdout);});
  });
  const loaded=JSON.parse(cliOutput), loadedModels=Array.isArray(loaded)?loaded:loaded.models;
  assert.ok(Array.isArray(loadedModels) && loadedModels.some(model=>JSON.stringify(model).includes('qa-model-')),'the actual Codex CLI loads the generated QA models');
  record('actual Codex CLI catalog readback',{modelCount:loadedModels.length,qaModelsLoaded:true,relativeCatalog:catalogRef});
  const fields=(await backend('agents')).agents.find(row=>row.id==='codex').fields;
  const model=fields.find(field=>field.key==='model'), next=model.options.find(option=>option.value.includes('qa-model-b') && option.value!==model.value);
  assert.ok(next,'the actual upstream picker offers the second local vendor model');
  const beforeDraft=fs.readFileSync(codexPath,'utf8');await selectField('model',next.value);
  assert.equal(fs.readFileSync(codexPath,'utf8'),beforeDraft);assert.equal((await fieldState('model')).disabled,false);
  await applyField('model');assert.equal((await backend('agents')).agents.find(row=>row.id==='codex').fields.find(field=>field.key==='model').value,next.value);
  assert.match(fs.readFileSync(codexPath,'utf8'),/qa-model-b/);
  const effort=(await backend('agents')).agents.find(row=>row.id==='codex').fields.find(field=>field.key==='effort');
  const nextEffort=effort.options.find(option=>option.value==='high' && option.value!==effort.value) || effort.options.find(option=>option.value && option.value!==effort.value);
  assert.ok(nextEffort,'the actual upstream picker offers a different reasoning effort');
  await selectField('effort',nextEffort.value);await applyField('effort');
  assert.equal((await backend('agents')).agents.find(row=>row.id==='codex').fields.find(field=>field.key==='effort').value,nextEffort.value);
  assert.ok(fs.readFileSync(codexPath,'utf8').includes(`model_reasoning_effort = "${nextEffort.value}"`));
  record('explicit model and effort apply',{model:next.value,effort:nextEffort.value});
  assert.ok(await js(`!!document.querySelector('[data-agent-field="effort"] option[value=""]')`),'a nonempty field offers its upstream default reset');
  await selectField('effort','');await applyField('effort');
  assert.ok(!/^model_reasoning_effort\s*=/m.test(fs.readFileSync(codexPath,'utf8')),'default reset removes the explicit native key');
  const resetEffort=(await backend('agents')).agents.find(row=>row.id==='codex').fields.find(field=>field.key==='effort').value;
  assert.equal((await fieldState('effort')).value,resetEffort,'UI reads the actual model default after reset');
  record('explicit default reset',{nativeKeyRemoved:true,currentEffort:resetEffort});
  for(const scheme of ['light','dark']){
   nativeTheme.themeSource=scheme;
   for(const [width,height] of [[1120,780],[380,600]]){
    const resized=await resize(width,height);
    await js(`document.querySelector('#main').scrollTop=0`);
    await capture(`connected-${scheme}-${width}x${height}`);
    const geometry=await js(`(()=>{const main=document.querySelector('#main'),content=document.querySelector('#content');const overflow=[...document.querySelectorAll('#agents-page select,#agents-page button,#agents-page label,.agent-path dd,.agent-sync-error')].flatMap(node=>{const r=node.getBoundingClientRect();return r.width && (r.left< -1 || r.right>innerWidth+1)?[{tag:node.tagName,text:node.textContent.slice(0,80),left:r.left,right:r.right}]:[]});return {width:innerWidth,height:innerHeight,documentOverflow:document.documentElement.scrollWidth-innerWidth,mainOverflow:main.scrollWidth-main.clientWidth,contentOverflow:content.scrollWidth-content.clientWidth,overflow}})()`);
    assert.ok(geometry.documentOverflow<=1 && geometry.mainOverflow<=1 && geometry.contentOverflow<=1 && geometry.overflow.length===0,JSON.stringify({scheme,...geometry}));result.layouts.push({scheme,native:resized,...geometry});
    if(width===380){await js(`document.querySelector('#main').scrollTop=document.querySelector('#main').scrollHeight`);await capture(`connected-${scheme}-${width}x${height}-bottom`);}
   }
  }
  assert.equal(win.isFocused(),false,'QA never takes user input focus');
  const key=fs.readFileSync(path.join(root,'data/gateway.key'),'utf8').trim();
  assert.ok(!JSON.stringify(await backend('agents')).includes(key),'management agent state never exposes the gateway credential');
  assert.ok(!(await js('document.body.innerText')).includes(key),'rendered agent page never exposes the gateway credential');
  const goodConfig=fs.readFileSync(codexPath,'utf8');
  const drifted=goodConfig.replace(/^[ \t]*base_url\s*=\s*"[^"]*"/m, 'base_url = "http://127.0.0.1:9/v1"');
  assert.notEqual(drifted,goodConfig,'failure fixture changes the provider table URL, not openai_base_url');
  fs.writeFileSync(codexPath,drifted);
  await resize(1120,780);nativeTheme.themeSource='light';await click('#refresh');
  await wait(`document.querySelector('.agent-sync-error') && document.querySelector('#agent-target')?.disabled===false`);
  assert.match(await js(`document.querySelector('.agent-sync-error').textContent`),/其他网关|已更改/);
  await click('[data-agent-action="connect"]');await awaitWrite();
  assert.equal(await js(`document.querySelector('#message').dataset.error`),'true');
  assert.match(await js(`document.querySelector('#message-text').textContent`),/其他网关|已更改/);
  assert.equal(await js(`document.querySelector('[data-agent-action="connect"]').disabled`),false);
  await capture('connect-failure-and-sync-error-light-1120x780');
  record('native failure feedback',{syncErrorVisible:true,failedButtonRestored:true});
  fs.writeFileSync(codexPath,goodConfig);await click('#refresh');await wait(`document.querySelector('[data-agent-action="disconnect"]') && !document.querySelector('#refresh').disabled`);
  await click('[data-agent-action="disconnect"]');await awaitWrite();
  assert.ok(!(await backend('agents')).agents.find(row=>row.id==='codex').connected);
  const restored=fs.readFileSync(codexPath,'utf8');assert.match(restored,/model\s*=\s*"qa-original"/);assert.match(restored,/model_reasoning_effort\s*=\s*"low"/);assert.ok(!/model_provider\s*=\s*"magpie"/.test(restored));
  const dshAfter=fs.readFileSync(dshPatch,'utf8');assert.equal(dshAfter,dshBefore,'other agent actions preserve WhaleIsle route and default model');
  record('explicit native Codex disconnect',{originalModelRestored:true,originalEffortRestored:true,whaleProfileUnchanged:true});
  // Import-only clients must generate useful material without claiming the
  // external app has accepted it, opening it, or writing its database.
  await chooseAgent('cindy');
  assert.equal(await js(`!!document.querySelector('[data-agent-action="connect"],[data-agent-action="disconnect"]')`),false);
  assert.equal(await js(`document.querySelectorAll('[data-agent-field]').length`),0);
  await click('[data-agent-action="import"]');await awaitWrite();
  const link=await js(`document.querySelector('#agent-material-value').value`), imported=JSON.parse(Buffer.from(new URL(link).searchParams.get('data'),'base64url').toString('utf8'));
  assert.equal(imported.id,'whalebridge');assert.equal(imported.name,'鲸桥');assert.equal(imported.auth.apiKey,key+'-cindy');
  assert.equal(await js(`document.querySelector('#agent-material-value').readOnly`),true);
  assert.ok(await js(`!!document.querySelector('[data-agent-action="copy-material"]')`));
  assert.ok(!(await backend('agents')).agents.find(row=>row.id==='cindy').added,'generating material never reports the external confirmation as completed');
  await capture('cindy-import-material-light-1120x780');
  await click('[data-tab="overview"]');await wait(`document.querySelector('.hero')`);await click('[data-tab="agents"]');await wait(`document.querySelector('#agent-target')?.value==='cindy'`);
  assert.equal(await js(`!!document.querySelector('#agent-material-value')`),false,'leaving the page clears generated connection material');
  record('Cindy explicit import and material ownership',{provider:'whalebridge',credentialValid:true,externalConfirmationRequired:true,materialClearedOnLeave:true});
  await chooseAgent('agy');await click('[data-agent-action="connect"]');await awaitWrite();
  assert.ok((await backend('agents')).agents.find(row=>row.id==='agy').connected);
  await click('[data-agent-action="launch"]');await awaitWrite();
  const command=await js(`document.querySelector('#agent-material-value').value`);
  assert.ok(command.includes(key+'-agy') && command.includes('agy --model') && !command.includes('[鲸桥密钥]'),'explicit launch material contains a working target credential');
  assert.ok(!JSON.stringify(await backend('agents')).includes(key),'ordinary GET state still never exposes generated credentials');
  await capture('agy-launch-material-light-1120x780');
  await chooseAgent('dsh');assert.equal(await js(`!!document.querySelector('#agent-material-value')`),false,'switching targets clears launch material');
  await chooseAgent('agy');await click('[data-agent-action="disconnect"]');await awaitWrite();
  record('Antigravity explicit launch and target clear',{validCommand:true,automaticExecution:false,materialClearedOnSwitch:true});
  // A client can choose its own model while retaining our provider block.
  // The independent managed flag must keep the cleanup action reachable.
  await chooseAgent('opencode');await click('[data-agent-action="connect"]');await awaitWrite();
  const openRow=(await backend('agents')).agents.find(row=>row.id==='opencode');
  assert.ok(openRow.connected && openRow.managed && path.resolve(openRow.path).startsWith(path.resolve(profile)+path.sep));
  const openConfig=JSON.parse(fs.readFileSync(openRow.path,'utf8'));openConfig.model='opencode/big-pickle';fs.writeFileSync(openRow.path,JSON.stringify(openConfig,null,2));
  await click('#refresh');await wait(`document.querySelector('#agent-target')?.value==='opencode' && !document.querySelector('#refresh').disabled`);
  const nativeRow=(await backend('agents')).agents.find(row=>row.id==='opencode');assert.ok(nativeRow.managed && !nativeRow.connected);
  assert.ok(await js(`!!document.querySelector('[data-agent-action="disconnect"]')`),'cleanup remains reachable after switching to a native model');
  assert.ok(await js(`document.querySelector('[data-agent-field="model"] select').disabled`));
  await capture('native-model-managed-cleanup-light-1120x780');
  await click('[data-agent-action="disconnect"]');await awaitWrite();
  const cleanConfig=fs.readFileSync(openRow.path,'utf8');assert.equal(JSON.parse(cleanConfig).model,'opencode/big-pickle');assert.ok(!cleanConfig.includes(key),'owned gateway credentials are removed');
  record('managed cleanup after native model',{disconnectReachable:true,nativeModelPreserved:true,ownedCredentialRemoved:true});
  assert.deepEqual(result.rendererErrors,[],'the production management UI has no renderer errors');
  result.ok=true;
 } catch(error) {
  result.ok=false;result.error=String(error.stack || error);
  const log=path.join(root,'data/component.log');if(fs.existsSync(log)){let text=fs.readFileSync(log,'utf8');const keyFile=path.join(root,'data/gateway.key');if(fs.existsSync(keyFile))text=text.replaceAll(fs.readFileSync(keyFile,'utf8').trim(),'[gateway key]');fs.writeFileSync(path.join(output,'component-failure.log'),text);}
 } finally {
  closeWhaleBridgeWindow();
  if(service){const stopped=await service.stop();result.cleanup={stopped:stopped.ok,...(pid?{pidAlive:isPidAlive(pid)}:{})};if(!stopped.ok || pid && isPidAlive(pid)){result.ok=false;result.cleanup.error=stopped.message || 'QA component is still alive';}}
  await new Promise(resolve=>{vendor.close(resolve);vendor.closeAllConnections();});
  process.stdout.write(marker+JSON.stringify(result)+'\n',()=>app.exit(result.ok?0:1));
 }
}

(process.versions.electron?runNative():launch()).catch(error=>{process.stderr.write(String(error.stack || error)+'\n');if(process.versions.electron)require('electron').app.exit(1);else process.exitCode=1;});
