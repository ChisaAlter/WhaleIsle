// Audit copy of the exact QA runner used for relay ACK tests, not a production daemon entry.
// It ran from <worktree>/.tmp/android-device-qa-20261027/ beside the private control/log files.
// The relative product import below is valid from that ignored QA directory, not this docs directory.
// Opt-in QA runner. Product daemon and encrypted channel remain unchanged.
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
const control=new URL('./fault-control.json',import.meta.url),log=new URL('./fault-events.jsonl',import.meta.url);
const record=value=>fs.appendFileSync(log,JSON.stringify({at:new Date().toISOString(),...value})+'\n');
const installed=new URL('../../src/main/dshd-daemon-runner.mjs',import.meta.url);
await import(installed.href);
const hooks=globalThis.__dshdDesktopRpc;
const host=hooks.hostRpc.bind(hooks);
hooks.hostRpc=async request=>{
 const value=await host(request);
 let plan;try{plan=JSON.parse(fs.readFileSync(control,'utf8'))}catch{return value}
 if(request.method==='session.prompt'&&request.payload?.sessionId===plan.sessionId&&plan.gateNextAck){
  if(value.ok!==true||value.value?.accepted!==true)throw new Error('QA gate requires actual Host accepted:true');
  const started=Date.now(),sessionId=plan.sessionId,businessRequestId=request.payload.requestId;
  plan={...plan,gateNextAck:false,gateWaiting:true,hostAccepted:true,businessRequestId,gateReleased:false};
  fs.writeFileSync(control,JSON.stringify(plan));
  record({kind:'prompt-admitted-ack-gated',sessionId,requestId:businessRequestId,receiptOk:true,accepted:true});
  await new Promise(resolve=>{const timer=setInterval(()=>{
   let current;try{current=JSON.parse(fs.readFileSync(control,'utf8'))}catch{return}
   if(current.sessionId!==sessionId||current.releaseAck===true||Date.now()-started>=60000){
    clearInterval(timer);
    const explicit=current.sessionId===sessionId&&current.releaseAck===true;
    fs.writeFileSync(control,JSON.stringify({...current,gateWaiting:false,gateReleased:true,releasedExplicitly:explicit,releasedAfterMs:Date.now()-started}));
    record({kind:'gated-ack-released',sessionId,requestId:businessRequestId,explicit,afterMs:Date.now()-started});
    resolve();
   }
  },25)});
  return value;
 }
 if(request.method==='session.prompt'&&request.payload?.sessionId===plan.sessionId&&plan.dropNextAck){
  plan.dropNextAck=false;fs.writeFileSync(control,JSON.stringify(plan));
  record({kind:'prompt-admitted-ack-dropped',sessionId:plan.sessionId,requestId:request.payload.requestId,receiptOk:value.ok===true});
  if(plan.disconnect) setTimeout(()=>process.exit(0),20);
  return new Promise(()=>{});
 }
 if(request.method==='session.history'&&request.payload?.sessionId===plan.sessionId){record({kind:'history',beforeSeq:request.payload.beforeSeq,maxMessages:request.payload.maxMessages,hasMore:value.value?.hasMore,count:value.value?.events?.length});}
 return value;
};
record({kind:'fault-hook-installed',pid:process.pid,runtime:process.versions.electron||process.versions.node});
