// Native Windows lifecycle and HTTP acceptance against a local test vendor.
// No real subscription credentials or paid API calls are used.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
import { createWhaleBridgeService } from '../src/launcher/whalebridge.js';
import { reservePort } from './smoke-workspace.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dir=mkdtempSync(join(tmpdir(),'whalebridge-native-'));
const data=join(dir,'component'), home=join(dir,'dsh'), pkg=join(dir,'package');
const gatewayPort=await reservePort();
mkdirSync(home,{recursive:true});mkdirSync(pkg);
let streamOpen=false,streamReleased=false,releaseStream,pendingStream;
const streamBarrier=new Promise(resolve=>{releaseStream=()=>{streamReleased=true;resolve();};});
const upstream=createServer(async(req,res)=>{
  if(req.url==='/v1/models'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:[{id:'qa-model'}]}));return;}
  const chunks=[];for await(const c of req)chunks.push(c);const body=JSON.parse(Buffer.concat(chunks));
  assert.equal(req.headers.authorization,'Bearer qa-only-key'); assert.equal(body.model,'qa-model');
  assert.equal(body.tools?.[0]?.function?.name,'qa_tool');
  if(body.stream){
    streamOpen=true;res.once('close',()=>{streamOpen=false;});
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    res.write('data: '+JSON.stringify({id:'qa-chat',object:'chat.completion.chunk',choices:[{index:0,delta:{role:'assistant',content:'鲸桥 QA'}}]})+'\n\n');
    // Hold generation until the actual maintenance request has returned.
    // Windows process/status probes can outlive a short wall-clock timer.
    await streamBarrier;
    res.end('data: '+JSON.stringify({id:'qa-chat',object:'chat.completion.chunk',choices:[{index:0,delta:{tool_calls:[{index:0,id:'qa-call',type:'function',function:{name:'qa_tool',arguments:'{}'}}]},finish_reason:'tool_calls'}],usage:{prompt_tokens:12,completion_tokens:8}})+'\n\ndata: [DONE]\n\n');
  }else{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({id:'qa-chat',object:'chat.completion',choices:[{index:0,message:{role:'assistant',content:'鲸桥 QA'},finish_reason:'stop'}],usage:{prompt_tokens:12,completion_tokens:8}}));}
});
await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
const original=JSON.parse(readFileSync(join(root,'.tmp/whalebridge-package/WhaleBridge-component.json')));
const executable=join(root,'.tmp/whalebridge-package/WhaleBridge-win32-x64.exe');
// A second native version is built only to exercise the real update/rollback
// transition, including the binary's version agreeing with the manifest.
copyFileSync(executable,join(pkg,'WhaleBridge-win32-x64.exe'));
writeFileSync(join(pkg,'WhaleBridge-component.json'),JSON.stringify(original));
const profile=join(home,'profiles/web/cordis.patch.yml');mkdirSync(dirname(profile),{recursive:true});
writeFileSync(profile,'# Preserve profile comments and unrelated fields\n- id: llm-pi-ai\n  config:\n    providers:\n      existing:\n        api: openai-completions\n        baseURL: https://existing.invalid/v1\n        models: []\n- id: agent-default-model\n  config:\n    provider: existing\n    model: keep\n- id: unrelated\n  config:\n    value: !!js "1 + 2"\n');
writeFileSync(join(home,'settings.yaml'),'unrelated: legacy-kept\n');
writeFileSync(join(home,'.env'),'EXISTING_KEY=keep\n');
let service;
try{
 service=createWhaleBridgeService({root:data,dshHome:home,devPackage:pkg,spawn:(file,args,options)=>spawn(file,args,{...options,env:{...options.env,MAGPIE_ADDR:`127.0.0.1:${gatewayPort}`,USERPROFILE:dir,HOME:dir,XDG_CONFIG_HOME:join(dir,'config'),CODEX_HOME:join(dir,'codex'),CLAUDE_CONFIG_DIR:join(dir,'claude')}})});
 const installed=await service.install();assert.equal(installed.ok,true,installed.message);
 assert.match(readFileSync(profile,'utf8'),/displayName: 鲸桥/);
 assert.match(readFileSync(profile,'utf8'),/provider: existing/);
 const current=service.state();const url=new URL(current.url),cookie=`magpie_web_${url.port}=${url.searchParams.get('k')}`;
 const api=async(path,body)=>{const res=await fetch(url.origin+'/api/'+path,{method:body===undefined?'GET':'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});assert.ok(res.ok,await res.clone().text());return res.json();};
 assert.equal((await fetch(url.origin+'/api/state')).status,401);
 assert.equal((await fetch(url.origin+'/api/provider',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json',Origin:'https://untrusted.invalid'},body:'{}'})).status,403);
 await api('provider',{name:'QA Vendor',chat:`http://127.0.0.1:${upstream.address().port}/v1`,key:'qa-only-key',models:['qa-model'],routing:''});
 const state=await api('state');assert.equal(state.providers.length,1);assert.equal(state.providers[0].modelCount,1);assert.ok(state.models.some(m=>m.id==='qa-vendor/qa-model'));assert.equal(JSON.stringify(state).includes('qa-only-key'),false);
 const subscriptions=await api('subscriptions');assert.ok(subscriptions.some(s=>s.id==='codex'));assert.ok(subscriptions.some(s=>s.id==='claude'));
 await api('group',{id:'qa-route',name:'QA Route',members:['qa-vendor/qa-model'],routing:'order'});
 assert.match(readFileSync(profile,'utf8'),/group\/qa-route/);
 const token=readFileSync(join(data,'data/gateway.key'),'utf8').trim();
 const gateway=current.gateway || (await api('state')).gateway;
 assert.equal((await fetch(gateway+'/v1/models')).status,401);
 // Responses is part of the supplier gateway; it must still reject a
 // request without the component's private gateway credential.
 assert.equal((await fetch(gateway+'/v1/responses',{method:'POST'})).status,401);
 const response=await fetch(gateway+'/v1/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json','User-Agent':'deepseek-harness'},body:JSON.stringify({model:'group/qa-route',stream:true,messages:[{role:'user',content:'QA'}],tools:[{type:'function',function:{name:'qa_tool',parameters:{type:'object',properties:{}}}}]})});
 assert.equal(response.status,200);
 pendingStream=response.text();
 assert.equal(streamOpen,true);assert.equal(streamReleased,false);
 const busy=await service.stop();assert.equal(busy.ok,false);assert.match(busy.message,/正在生成/);
 assert.equal(streamOpen,true);assert.equal(streamReleased,false);assert.equal(service.state()?.pid,current.pid);
 releaseStream();
 const stream=await pendingStream;assert.match(stream,/鲸桥 QA/);assert.match(stream,/qa_tool/);assert.match(stream,/\[DONE\]/);
 const usage=await api('usage?period=today');assert.equal(usage.calls,1);assert.equal(usage.input,12);assert.equal(usage.output,8);
 assert.equal((await service.stop()).ok,true);
 assert.equal((await service.uninstallInfo()).defaultModel,false);assert.equal(service.state(),null);
 assert.equal((await service.start()).ok,true);
 assert.equal(readFileSync(join(data,'data/gateway.key'),'utf8').trim(),token);
 assert.match(readFileSync(profile,'utf8'),/qa-vendor\/qa-model/);
 const nextVersion=original.version.replace(/(\d+)$/,n=>String(Number(n)+1));
 execFileSync(process.env.WHALEBRIDGE_GO || 'go',['build','-mod=readonly','-trimpath','-ldflags',`-s -w -X main.version=${nextVersion}`,'-o',join(pkg,'WhaleBridge-win32-x64.exe'),'.'],{cwd:join(root,'vendor/whalebridge'),stdio:'inherit',env:{...process.env,GOOS:'windows',GOARCH:'amd64',CGO_ENABLED:'0'}});
 const upgraded=readFileSync(join(pkg,'WhaleBridge-win32-x64.exe'));
 const manifest=structuredClone(original);manifest.version=nextVersion;manifest.platforms['win32-x64'].size=upgraded.length;manifest.platforms['win32-x64'].sha256=createHash('sha256').update(upgraded).digest('hex');
 writeFileSync(join(pkg,'WhaleBridge-component.json'),JSON.stringify(manifest));
 assert.equal((await service.update()).ok,true);assert.equal(service.state().version,nextVersion);assert.equal((await service.api('status')).models,2);
 assert.equal((await service.rollback()).ok,true);assert.equal(service.state().version,original.version);
 assert.equal((await service.uninstall()).ok,true);
 const after=readFileSync(profile,'utf8');assert.doesNotMatch(after,/whalebridge/);assert.match(after,/provider: existing/);assert.match(after,/id: unrelated/);assert.match(after,/!!js/);assert.match(after,/# Preserve profile comments/);assert.equal(readFileSync(join(home,'settings.yaml'),'utf8'),'unrelated: legacy-kept\n');
 assert.equal(readFileSync(join(home,'.env'),'utf8').trim(),'EXISTING_KEY=keep');
 assert.equal((await service.install()).ok,true);assert.equal((await service.api('status')).models,2);
  writeFileSync(profile,readFileSync(profile,'utf8').replace('provider: existing\n    model: keep','provider: whalebridge\n    model: qa-vendor/qa-model'));
 assert.equal((await service.api('status')).defaultModel,true);
 assert.equal((await service.uninstall({removeData:true})).ok,true);
 assert.doesNotMatch(readFileSync(profile,'utf8'),/whalebridge|qa-vendor\/qa-model/);
 console.log('PASS native install, private settings, suppliers/subscription choices, DSH route preservation, routing, streaming/tool calls, usage, busy-stop protection, restart, update, rollback, uninstall and reinstall');
}finally{
 releaseStream();await pendingStream?.catch(()=>{});
 if(service?.state())await service.stop();
 await new Promise(r=>upstream.close(r));rmSync(dir,{recursive:true,force:true});
}
