'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {killProcessTree}=require('../main/git-exec');
const electron=process.env.ELECTRON_PATH||path.resolve(__dirname,'../../node_modules/electron/dist/electron.exe');
test('WhaleBridge installation feedback, provider menus and audited dead controls',{skip:!fs.existsSync(electron)},async()=>{
 const tempRoot=path.resolve(os.tmpdir()),profile=fs.mkdtempSync(path.join(tempRoot,'whalebridge-controls-'));
 try{
  const result=await new Promise((resolve,reject)=>{
   const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
   const child=spawn(electron,[path.join(__dirname,'whalebridge-controls.child.cjs'),profile],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});
   let out='',err='';child.stdout.on('data',d=>out+=d);child.stderr.on('data',d=>err+=d);
   const timer=setTimeout(()=>killProcessTree(child),60000);
   child.once('error',reject);child.once('close',code=>{clearTimeout(timer);const row=out.split(/\r?\n/).find(x=>x.startsWith('WHALEBRIDGE_CONTROLS_RESULT:'));if(code!==0||!row)reject(Error(`controls renderer ${code}\n${err}\n${out}`));else resolve(JSON.parse(row.slice('WHALEBRIDGE_CONTROLS_RESULT:'.length)));});
  });
  for(const [name,passed] of Object.entries(result))assert.equal(passed,true,name);
 }finally{
  const relative=path.relative(tempRoot,path.resolve(profile));assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));fs.rmSync(profile,{recursive:true,force:true});
 }
});
