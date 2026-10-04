import {createRequire} from 'node:module';
import {createHmac} from 'node:crypto';
import readline from 'node:readline';
import {createDaemonChannel} from '../../../../../../vendor/chisacode-remote/packages/relay/dist/e2ee.js';
const require=createRequire(new URL('../../../../../../vendor/chisacode-remote/package.json',import.meta.url));
const nacl=require('tweetnacl');
const {WebSocketServer}=require('ws');
const keys=nacl.box.keyPair.fromSecretKey(Uint8Array.from({length:32},(_,i)=>i+1));
const daemonKey=Buffer.from(keys.publicKey).toString('base64');
const secret='native-interop-secret-012345678901234567890';
const transcript=(key,id,challenge)=>['v=1','serverId=native-test',`daemonPublicKeyB64=${daemonKey}`,`clientPublicKeyB64=${key}`,`deviceId=${id}`,`challenge=${challenge}`].join('\n');
const proof=(key,id,challenge)=>createHmac('sha256',secret).update(transcript(key,id,challenge)).digest('base64url');
if(process.argv[2]==='crypto') {
 const lines=readline.createInterface({input:process.stdin});
 for await(const line of lines) {
  const input=JSON.parse(line), bytes=Buffer.from(input.frame,'base64');
  const key=Buffer.from(input.key,'base64');
  const plaintext=nacl.box.open(bytes.subarray(24),bytes.subarray(0,24),key,keys.secretKey);
  const encrypt=(seq,salt=7)=>{
   const nonce=Buffer.alloc(24,salt); nonce.writeBigUInt64LE(BigInt(seq),16);
   return Buffer.concat([nonce,Buffer.from(nacl.box(Buffer.from('桌面回复'),nonce,key,keys.secretKey))]).toString('base64');
  };
  console.log(JSON.stringify({plain:Buffer.from(plaintext).toString(),frame0:encrypt(0),frame1:encrypt(1),changedSalt:encrypt(2,9),proof:proof(input.key,'device-test','challenge-test')}));
  break;
 }
} else {
 const wss=new WebSocketServer({host:'127.0.0.1',port:0});
 wss.on('listening',()=>console.log(JSON.stringify({port:wss.address().port,key:daemonKey})));
 wss.on('connection',async(socket,request)=>{
  const url=new URL(request.url,'http://localhost');
  if(url.searchParams.get('serverId')!=='native-test'||url.searchParams.get('role')!=='client'||url.searchParams.get('v')!=='2'||url.searchParams.has('connectionId')) return socket.close(1008,'Bad relay URL');
  const transport={send:data=>socket.send(data),close:(code,reason)=>socket.close(code,reason),onmessage:null,onclose:null,onerror:null};
  let firstHello=true;
  socket.on('message',bytes=>{
   const text=bytes.toString();
   // Real relay data-socket startup can miss the first key handshake.
   if(firstHello && text.startsWith('{')) { firstHello=false; return; }
   transport.onmessage?.(text);
  });
  socket.on('close',(code,reason)=>transport.onclose?.(code,reason.toString()));
  socket.on('error',error=>transport.onerror?.(error));
  let channel, authenticated=false;
  channel=await createDaemonChannel(transport,keys,{onmessage:text=>{
   const wire=JSON.parse(text);
   const frame=wire.type==='session'?wire.message:wire;
   const sessionSend=message=>channel.send(JSON.stringify({type:'session',message}));
   if(frame.type==='hello') {
    const binding=frame.relayDeviceAuth, context=channel.getSecurityContext();
    authenticated=binding?.version===1 && binding.clientPublicKeyB64===context.clientPublicKeyB64 && binding.challenge===context.authChallenge &&
      (binding.pairingToken==='fresh-pairing-token-123456789' || binding.proof===proof(context.clientPublicKeyB64,binding.deviceId,context.authChallenge));
    if(binding.pairingToken || !authenticated) channel.send(JSON.stringify({type:'relay_device_auth_result',version:1,ok:authenticated,...(binding.pairingToken&&authenticated?{deviceSecret:secret}:{})}));
    if(authenticated) sessionSend({type:'status',payload:{status:'server_info',hostname:'Native test desktop'}});
   } else if(!authenticated) socket.close(4403,'Unauthorized');
   else if(frame.type==='dshd.host.rpc.request'||frame.type==='dshd.git.rpc.request') {
    if(wire.type!=='session') return socket.close(1008,'Missing session envelope');
    const type=frame.type.replace('.request','.response');
    sessionSend({type,payload:{requestId:frame.requestId,ok:frame.method!=='fail',value:{method:frame.method,action:frame.action,payload:frame.payload,cwd:frame.cwd},error:{message:'Expected RPC failure'}}});
   } else if(frame.type==='dshd.host.mux.subscribe') sessionSend({type:'dshd.host.mux.frame',payload:{envelope:{type:'session/event',sessionId:'s1',event:{seq:1,type:'turn/start',data:{}}}}});
  }});
 });
 process.on('SIGTERM',()=>wss.close(()=>process.exit()));
}
