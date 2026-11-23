import {createRequire} from 'node:module';
import {createHmac} from 'node:crypto';
import readline from 'node:readline';
import {createDaemonChannel} from '../../../build/test-peer/e2ee.mjs';
const require=createRequire(new URL('../../../test-support/package.json',import.meta.url));
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
} else if(process.argv[2]==='webrtc_framing') {
 const lines=readline.createInterface({input:process.stdin});
 for await(const line of lines) {
  const input=JSON.parse(line);
  const clientKey=Buffer.from(input.key,'base64');
  // Reassemble RTCH chunks (or accept single unchunked DSHU frame) from Kotlin
  const rawChunks=input.chunks.map(c=>Buffer.from(c,'base64'));
  let dshu;
  if(rawChunks.length===1 && rawChunks[0].subarray(0,4).toString('ascii')!=='RTCH') {
   dshu=rawChunks[0];
  } else {
   const parts=[];
   let msgId=null, total=null;
   for(let i=0;i<rawChunks.length;i++) {
    const f=rawChunks[i];
    if(f.subarray(0,4).toString('ascii')!=='RTCH') throw new Error('Expected RTCH magic');
    const id=f.readUInt32BE(4), idx=f.readUInt16BE(8), tot=f.readUInt16BE(10);
    if(msgId===null) { msgId=id; total=tot; }
    if(id!==msgId || idx!==i || tot!==total) throw new Error('Bad RTCH header');
    const body=f.subarray(12);
    if(i<total-1 && body.length!==8192) throw new Error('Non-last chunk must be 8192B');
    parts.push(body);
   }
   if(parts.length!==total) throw new Error('Incomplete RTCH message');
   dshu=Buffer.concat(parts);
  }
  if(dshu.subarray(0,4).toString('ascii')!=='DSHU') throw new Error('Expected DSHU magic');
  const headerSeq=dshu.readBigUInt64BE(4);
  const bundle=dshu.subarray(12);
  const bundleSeq=bundle.readBigUInt64LE(16);
  if(headerSeq!==bundleSeq) throw new Error(`Seq mismatch: ${headerSeq} vs ${bundleSeq}`);
  const opened=nacl.box.open(bundle.subarray(24),bundle.subarray(0,24),clientKey,keys.secretKey);
  if(!opened) throw new Error('Failed to open Kotlin binary box');
  const plainText=Buffer.from(opened).toString('utf8');

  // Produce a >64 KiB Node response wrapped in raw TweetNaCl -> DSHU -> RTCH chunks
  const replyPlain=`node-ack:${plainText.length}:${'N'.repeat(70000)}`;
  const replySeq=BigInt(input.replySeq??5);
  const nonce=Buffer.alloc(24,0x2a);
  nonce.writeBigUInt64LE(replySeq,16);
  const boxed=Buffer.from(nacl.box(Buffer.from(replyPlain,'utf8'),nonce,clientKey,keys.secretKey));
  const replyBundle=Buffer.concat([nonce,boxed]);
  const replyDshu=Buffer.alloc(12+replyBundle.length);
  replyDshu.write('DSHU',0,'ascii');
  replyDshu.writeBigUInt64BE(replySeq,4);
  replyBundle.copy(replyDshu,12);
  const CHUNK=8192;
  const total=Math.ceil(replyDshu.length/CHUNK);
  const outChunks=[];
  for(let i=0;i<total;i++) {
   const slice=replyDshu.subarray(i*CHUNK,Math.min((i+1)*CHUNK,replyDshu.length));
   const frame=Buffer.alloc(12+slice.length);
   frame.write('RTCH',0,'ascii');
   frame.writeUInt32BE(0x00000007,4);
   frame.writeUInt16BE(i,8);
   frame.writeUInt16BE(total,10);
   slice.copy(frame,12);
   outChunks.push(frame.toString('base64'));
  }
  console.log(JSON.stringify({plainLength:plainText.length,headerSeq:Number(headerSeq),replyPlainLength:replyPlain.length,chunks:outChunks}));
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
