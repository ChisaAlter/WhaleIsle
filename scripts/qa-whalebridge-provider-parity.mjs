// Real component HTTP/routing acceptance, with a local vendor and isolated data.
// --ui opens the repository's original WhaleBridge window for manual acceptance.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createWhaleBridgeService } from '../src/launcher/whalebridge.js';
import { reservePort } from './smoke-workspace.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dir=mkdtempSync(join(tmpdir(),'whalebridge-providers-'));
const data=join(dir,'component'),home=join(dir,'dsh');
mkdirSync(home,{recursive:true});
const port=await reservePort(),model='deepseek/deepseek-v4.1-flash';
let held=false,calls=0,releases=[];
const upstream=createServer(async(req,res)=>{
 if(req.url.endsWith('/models')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:[{id:model}]}));return;}
 if(req.url.endsWith('/ai/cline/recommended-models')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({clinePass:[{id:model,name:'DeepSeek V4.1 Flash'}],free:[{id:'cline-free/mimo-v2.6-flash',name:'MiMo 免费'}]}));return;}
 if(req.url==='/balance'){res.setHeader('Content-Type','application/json');res.end('{"balance":42}');return;}
 const chunks=[];for await(const c of req)chunks.push(c);
 const body=JSON.parse(Buffer.concat(chunks));
 assert.equal(req.headers.authorization,'Bearer qa-only-key');
 assert.equal(body.model,model);
	assert.deepEqual(body.providerOptions?.gateway?.only,['deepseek']);
 calls++;
 if(held)await new Promise(r=>releases.push(r));
 res.setHeader('Content-Type','application/json');
 res.end(JSON.stringify({id:'qa-reply',object:'chat.completion',choices:[{index:0,message:{role:'assistant',content:'供应商 QA'},finish_reason:'stop'}],usage:{prompt_tokens:12,completion_tokens:8}}));
});
await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
const env={...process.env,USERPROFILE:dir,HOME:dir,XDG_CONFIG_HOME:join(dir,'config'),CODEX_HOME:join(dir,'codex'),CLAUDE_CONFIG_DIR:join(dir,'claude'),MAGPIE_ADDR:`127.0.0.1:${port}`};
delete env.ELECTRON_RUN_AS_NODE;
const service=createWhaleBridgeService({root:data,dshHome:home,devPackage:join(root,'.tmp/whalebridge-package'),spawn:(file,args,options)=>spawn(file,args,{...options,env:{...options.env,...env},windowsHide:true})});
let electron;
try{
 const installed=await service.install();assert.equal(installed.ok,true,installed.message);
 const state=service.state(),url=new URL(state.url),cookie=`magpie_web_${url.port}=${url.searchParams.get('k')}`;
 const api=async(path,body)=>{
  const r=await fetch(url.origin+'/api/'+path,{method:body===undefined?'GET':'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  assert.ok(r.ok,await r.clone().text());return r.json();
 };
 const base=`http://127.0.0.1:${upstream.address().port}`;
 await api('provider',{id:'qa-clinepass',name:'ClinePass QA',preset:'clinepass',chat:base+'/v1',responses:'',anthropic:'',key:'qa-only-key',models:[model],routing:'order',maxConcurrency:1,queueLimit:1,queueWait:1,priceRate:1.5,pinUpstream:true,balanceURL:base+'/balance',balancePath:'balance',contexts:{'*':64000},outputs:{'*':2000},compacts:{'*':32000}});
 const saved=(await api('state')).providers.find(p=>p.id==='qa-clinepass');assert.ok(saved);
 assert.equal(saved.maxConcurrency,1);assert.equal(saved.queueLimit,1);assert.equal(saved.queueWait,1);assert.equal(saved.priceRate,1.5);assert.equal(saved.pinUpstream,true);
 assert.equal(saved.contexts['*'],64000);assert.equal(saved.outputs['*'],2000);assert.equal(saved.compacts['*'],32000);
 assert.equal(JSON.stringify(saved).includes('qa-only-key'),false);
 const token=readFileSync(join(data,'data/gateway.key'),'utf8').trim();
 const chat=(signal)=>fetch(state.gateway+'/v1/chat/completions',{method:'POST',signal,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json','User-Agent':'deepseek-harness'},body:JSON.stringify({model:'qa-clinepass/'+model,messages:[{role:'user',content:'QA'}]})});
 const until=async(f)=>{for(let i=0;i<100;i++){if(await f())return;await new Promise(r=>setTimeout(r,30));}throw new Error('state did not reach the expected condition');};
 held=true;
 const first=chat();await until(async()=>Object.values(await api('lanes')).some(l=>l.busy===1));
 const queued=chat();await until(async()=>Object.values(await api('lanes')).some(l=>l.waiting===1));
 const excess=await chat();assert.equal(excess.status,429);await excess.text();
 const expired=await queued;assert.equal(expired.status,429);await expired.text();
 assert.equal(calls,1,'queued/rejected calls must not reach the vendor');
 held=false;releases.splice(0).forEach(r=>r());assert.equal((await first).status,200);
 await until(async()=>Object.keys(await api('lanes')).length===0);
 held=true;
 const blocker=chat();await until(async()=>Object.values(await api('lanes')).some(l=>l.busy===1));
 const controller=new AbortController(),canceled=chat(controller.signal).catch(e=>e);
 await until(async()=>Object.values(await api('lanes')).some(l=>l.waiting===1));controller.abort();await canceled;
 await until(async()=>Object.values(await api('lanes')).every(l=>l.waiting===0));
 held=false;releases.splice(0).forEach(r=>r());assert.equal((await blocker).status,200);assert.equal(calls,2);
 assert.equal((await service.stop()).ok,true);assert.equal((await service.start()).ok,true);
 const restarted=new URL(service.state().url),newCookie=`magpie_web_${restarted.port}=${restarted.searchParams.get('k')}`;
 const persisted=await fetch(restarted.origin+'/api/state',{headers:{Cookie:newCookie}}).then(r=>r.json());
 const kept=persisted.providers.find(p=>p.id==='qa-clinepass');
 assert.equal(kept.queueWait,1);assert.equal(kept.priceRate,1.5);assert.equal(kept.pinUpstream,true);
 console.log('PASS native provider fields, masked state, real queue cap/timeout/cancellation, vendor request count and restart persistence');
 if(process.argv.includes('--ui')){
  const session={dir,data,home,url:service.state().url};
  mkdirSync(join(root,'.tmp'),{recursive:true});writeFileSync(join(root,'.tmp/whalebridge-qa-session.json'),JSON.stringify(session,null,2));
  const driver=join(dir,'window.cjs');
  writeFileSync(driver,`const {app}=require("electron");\napp.setPath('userData',${JSON.stringify(join(dir,'electron'))});\napp.whenReady().then(()=>require(${JSON.stringify(join(root,'src/main/whalebridge-window.js'))}).openWhaleBridgeWindow(${JSON.stringify(session.url)}));\napp.on('window-all-closed',()=>app.quit());\n`);
  const executable=process.env.ELECTRON_PATH || createRequire(import.meta.url)('electron');
  electron=spawn(executable,[driver],{env,windowsHide:false,stdio:'inherit'});
  console.log('UI ready; isolated session: '+join(root,'.tmp/whalebridge-qa-session.json'));
  await new Promise((done,fail)=>{electron.once('exit',done);electron.once('error',fail);});
 }
}finally{
 held=false;releases.splice(0).forEach(r=>r());
 if(electron&&!electron.killed)electron.kill();
 if(service.state())await service.stop();
 upstream.closeAllConnections();await new Promise(r=>upstream.close(r));
 // dir was created here and contains only this acceptance run's data.
 assert.ok(resolve(dir).startsWith(resolve(tmpdir())+'\\'));rmSync(dir,{recursive:true,force:true});
}
